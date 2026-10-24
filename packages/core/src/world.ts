import { autopilotDecide, needsDecision, planDesired } from "./autopilot";
import { addMemory, observeEvents, pruneMemories } from "./memory";
import { applyConversation, initialRelation, relKey } from "./social";
import { applyGodEvent, applyWhisper } from "./god";
import { count, remove } from "./inventory";
import { FOOD, SHOP, TAVERN, buyFromShop, currentPrices, exportSurplus, foodAtHome, initialStocks, mealPrice, ownerOf, workHour } from "./economy";
import { buildVillageMap } from "./map/village";
import { getLocation, type Point, type TileMap } from "./map/types";
import { findPath } from "./pathfinding";
import { Rng, hash2 } from "./rng";
import { RULES } from "./rules";
import { TICKS_PER_DAY, tickToTime } from "./time";
import type { Agent, DesiredActivity, ExternalInputs, SimEvent, VillagerSeed, WorldState } from "./types";

export interface World {
  map: TileMap;
  state: WorldState;
}

/** Egy lakó döntését adja. Alapból az autopilot; később ide kötjük be az LLM-et. */
export type Decider = (agent: Agent, state: WorldState, rng: Rng) => DesiredActivity;

export interface StepResult {
  events: SimEvent[];
  /** Lakónként az ebben a tickben bejárt csempék (a viewer animációjához). */
  moves: Record<string, Point[]>;
}

export function createWorld(seed: string, villagers: VillagerSeed[]): World {
  const map = buildVillageMap();
  const agents: Agent[] = villagers
    .map((v) => {
      const home = getLocation(map, v.homeId);
      return {
        ...v,
        traits: [...v.traits],
        pos: spotFor(home.spots, v.id),
        path: [],
        activity: null,
        needs: { hunger: 10 + Math.round(hash2(v.id.length, v.id.charCodeAt(0)) * 30), energy: 90 },
        money: v.money ?? 30,
        inventory: { ...(v.inventory ?? { kenyér: 2 }) },
        workProgress: 0,
        surprised: false,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const stocks: WorldState["stocks"] = {};
  for (const loc of map.locations) stocks[loc.id] = {};
  Object.assign(stocks, initialStocks());
  const state: WorldState = {
    seed,
    tick: 0,
    rngState: Rng.fromSeed(seed).state,
    agents,
    stocks,
    memories: [],
    nextMemoryId: 1,
    relations: {},
    lastTalk: {},
    gossip: [],
    nextGossipId: 1,
  };
  // Kezdő emlékek és vélemények a kapcsolatokból.
  for (const a of agents) {
    for (const r of a.relationships ?? []) {
      const other = agents.find((o) => o.id === r.with);
      if (!other) continue;
      addMemory(state, a.id, "reflexió", `${other.name}: ${r.kind}.`, 6, 0);
      state.relations[relKey(a.id, other.id)] = initialRelation(r.kind);
    }
  }
  return { map, state };
}

/** Világ visszaállítása snapshotból (a térkép kódból épül újra). */
export function restoreWorld(state: WorldState): World {
  return { map: buildVillageMap(), state: structuredClone(state) };
}

/** Egy tick előreléptetése. Determinisztikus: ugyanabból az állapotból ugyanaz jön ki. */
export function stepWorld(world: World, inputs: ExternalInputs = {}, decide: Decider = autopilotDecide): StepResult {
  const { state, map } = world;
  const rng = new Rng(state.rngState);
  const events: SimEvent[] = [];
  const moves: Record<string, Point[]> = {};
  const tick = state.tick;
  const external: Record<string, DesiredActivity> = {};

  if (tick % TICKS_PER_DAY === 0) {
    events.push({ tick, type: "day_started", day: tickToTime(tick).day });
    exportSurplus(state, events);
    events.push({ tick, type: "prices", prices: currentPrices(state) });
    if (tick > 0) pruneMemories(state);
  }
  applyMindInputs(state, inputs, events);
  // Isten-mód: az események kényszerített tevékenységei felülírják a többi döntést.
  for (const key of Object.keys(inputs.god ?? {}).sort()) {
    Object.assign(external, applyGodEvent(state, map, inputs.god![key], events, spotFor));
  }
  for (const id of Object.keys(inputs.whispers ?? {}).sort()) applyWhisper(state, id, inputs.whispers![id], events);
  for (const [id, d] of Object.entries(inputs.decisions ?? {})) external[id] ??= d;

  for (const agent of state.agents) {
    updateNeeds(agent);

    const ext = external[agent.id] ?? (needsDecision(agent, state) && !agent.surprised ? planDesired(agent, state) : undefined);
    // Csak az LLM saját döntése "dolgozza fel" a meglepetést; a kényszerített (Isten-mód) nem.
    if (inputs.decisions?.[agent.id] && external[agent.id] === inputs.decisions[agent.id]) agent.surprised = false;
    const desired = ext ? { source: "llm" as const, ...ext } : decide(agent, state, rng);
    const cur = agent.activity;
    if (ext || !cur || cur.kind !== desired.kind || cur.locationId !== desired.locationId) {
      startActivity(world, agent, desired, events);
    }

    moves[agent.id] = moveAlongPath(agent);
    if (agent.activity && !agent.activity.arrived && agent.path.length === 0) {
      agent.activity.arrived = true;
      events.push({ tick, type: "arrived", agentId: agent.id, locationId: agent.activity.locationId });
      onArrive(agent, tick);
    }

    if (agent.activity?.arrived) performActivity(world, agent, events, rng);

    if (agent.needs.hunger >= RULES.starvingThreshold && tick % 12 === 0) {
      events.push({ tick, type: "starving", agentId: agent.id });
    }
  }

  observeEvents(state, map, events);
  state.rngState = rng.state;
  state.tick++;
  return { events, moves };
}

/** Napi terv és esti reflexió beépítése (külső, rögzített bemenetből). */
function applyMindInputs(state: WorldState, inputs: ExternalInputs, events: SimEvent[]) {
  const tick = state.tick;
  for (const key of Object.keys(inputs.conversations ?? {}).sort()) {
    applyConversation(state, inputs.conversations![key], events);
  }
  for (const agent of state.agents) {
    const plan = inputs.plans?.[agent.id];
    if (plan) {
      agent.plan = plan;
      const steps = plan.items.map((i) => `${i.fromHour}-${i.toHour}h ${i.kind} (${i.locationId})`).join(", ");
      addMemory(state, agent.id, "terv", `Mai tervem: ${plan.goal}. ${steps}`, 4);
      events.push({ tick, type: "planned", agentId: agent.id, goal: plan.goal, items: plan.items.length });
    }
    const refl = inputs.reflections?.[agent.id];
    if (refl) {
      for (const i of refl.insights) addMemory(state, agent.id, "reflexió", i.text, i.importance);
      agent.mood = refl.mood;
      events.push({ tick, type: "reflected", agentId: agent.id, insights: refl.insights.map((i) => i.text), mood: refl.mood });
    }
  }
}

function updateNeeds(agent: Agent) {
  const asleep = agent.activity?.kind === "alszik" && agent.activity.arrived;
  const n = agent.needs;
  n.hunger = clamp(n.hunger + (asleep ? RULES.hungerPerTickAsleep : RULES.hungerPerTickAwake));
  n.energy = clamp(n.energy + (asleep ? RULES.energyPerTickAsleep : -RULES.energyPerTickAwake));
}

function startActivity(world: World, agent: Agent, d: DesiredActivity, events: SimEvent[]) {
  const prev = agent.activity;
  const loc = getLocation(world.map, d.locationId);
  const already = loc.spots.some((s) => s.x === agent.pos.x && s.y === agent.pos.y);
  const target = already ? agent.pos : spotFor(loc.spots, agent.id);
  const path = findPath(world.map, agent.pos, target) ?? [];
  agent.path = path;
  const tick = world.state.tick;
  const source = d.source ?? "auto";
  agent.activity = {
    kind: d.kind,
    locationId: d.locationId,
    reason: d.reason,
    source,
    commitUntil: d.durationTicks !== undefined ? tick + d.durationTicks : undefined,
    say: d.say || undefined,
    startedTick: tick,
    arrived: false,
  };
  // Ugyanazt folytatja (pl. az LLM a munka folytatását választja): ne induljon újra az út.
  if (prev?.arrived && prev.kind === d.kind && prev.locationId === d.locationId) {
    agent.activity.arrived = true;
    agent.activity.untilTick = prev.untilTick;
    agent.activity.startedTick = prev.startedTick;
  }
  events.push({
    tick,
    type: "activity_started",
    agentId: agent.id,
    kind: d.kind,
    locationId: d.locationId,
    reason: d.reason,
    source,
    ...(d.say ? { say: d.say } : {}),
  });
}

function onArrive(agent: Agent, tick: number) {
  if (agent.activity?.kind === "eszik") agent.activity.untilTick = tick + RULES.eatDurationTicks;
}

function moveAlongPath(agent: Agent): Point[] {
  const trail: Point[] = [];
  for (let i = 0; i < RULES.moveTilesPerTick && agent.path.length > 0; i++) {
    agent.pos = agent.path.shift()!;
    trail.push(agent.pos);
  }
  return trail;
}

function performActivity(world: World, agent: Agent, events: SimEvent[], rng: Rng) {
  const a = agent.activity!;
  const state = world.state;
  const tick = state.tick;

  if (a.kind === "eszik" && a.untilTick !== undefined && tick >= a.untilTick) {
    const homeFood = a.locationId === agent.homeId ? foodAtHome(agent) : undefined;
    const tavern = state.stocks[TAVERN];
    const tavernFood = a.locationId === TAVERN ? FOOD.find((f) => count(tavern, f) > 0) : undefined;
    const owner = ownerOf(state, TAVERN);
    const price = owner === agent ? 0 : mealPrice(state);
    if (homeFood) {
      remove(agent.inventory, homeFood);
      events.push({ tick, type: "ate", agentId: agent.id, what: homeFood, locationId: a.locationId });
    } else if (tavernFood && agent.money >= price) {
      remove(tavern, tavernFood);
      if (price > 0) {
        agent.money -= price;
        if (owner) owner.money += price;
        events.push({ tick, type: "paid", agentId: agent.id, amount: price, to: a.locationId, reason: "étel" });
      }
      events.push({ tick, type: "ate", agentId: agent.id, what: tavernFood === "hal" ? "sült hal" : "zsíros kenyér", locationId: a.locationId });
    } else {
      // Nincs mit enni: abbahagyja, a következő döntésnél mást választ.
      agent.activity = null;
      return;
    }
    agent.needs.hunger = clamp(agent.needs.hunger - RULES.eatHungerRelief);
    agent.activity = null;
    return;
  }

  if (a.kind === "vásárol") {
    // Megérkezett a boltba: élelmet vesz (legfeljebb 3 legyen otthon).
    if (a.locationId === SHOP) {
      const have = FOOD.reduce((n, f) => n + count(agent.inventory, f), 0);
      if (have < 3) buyFromShop(state, agent, "kenyér", 3 - have, agent.inventory, events);
    }
    agent.activity = null;
    return;
  }

  if (a.kind === "dolgozik" && a.locationId === agent.workplaceId) {
    agent.workProgress++;
    if (agent.workProgress >= RULES.workTicksPerProduct) {
      agent.workProgress = 0;
      workHour(state, agent, rng, events);
    }
  }
}

/** Determinisztikus hely-választás egy helyszínen belül, hogy a lakók ne álljanak egymáson. */
export function spotFor(spots: Point[], agentId: string): Point {
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) | 0;
  return spots[Math.floor(hash2(h, spots.length) * spots.length)];
}

function clamp(v: number): number {
  return Math.max(0, Math.min(100, v));
}
