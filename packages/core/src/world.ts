import { autopilotDecide, needsDecision, planDesired } from "./autopilot";
import { addMemory, observeEvents, pruneMemories } from "./memory";
import { add, count, remove, transfer } from "./inventory";
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
  const state: WorldState = { seed, tick: 0, rngState: Rng.fromSeed(seed).state, agents, stocks, memories: [], nextMemoryId: 1 };
  // Kezdő emlékek a kapcsolatokból.
  for (const a of agents) {
    for (const r of a.relationships ?? []) {
      const other = agents.find((o) => o.id === r.with);
      if (other) addMemory(state, a.id, "reflexió", `${other.name}: ${r.kind}.`, 6, 0);
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
  const external = inputs.decisions ?? {};

  if (tick % TICKS_PER_DAY === 0) {
    events.push({ tick, type: "day_started", day: tickToTime(tick).day });
    if (tick > 0) pruneMemories(state);
  }
  applyMindInputs(state, inputs, events);

  for (const agent of state.agents) {
    updateNeeds(agent);

    const ext = external[agent.id] ?? (needsDecision(agent, state) && !agent.surprised ? planDesired(agent, state) : undefined);
    if (external[agent.id]) agent.surprised = false;
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

    if (agent.activity?.arrived) performActivity(world, agent, events);

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

function performActivity(world: World, agent: Agent, events: SimEvent[]) {
  const a = agent.activity!;
  const tick = world.state.tick;

  if (a.kind === "eszik" && a.untilTick !== undefined && tick >= a.untilTick) {
    if (a.locationId === agent.homeId && remove(agent.inventory, "kenyér")) {
      events.push({ tick, type: "ate", agentId: agent.id, what: "kenyér", locationId: a.locationId });
    } else if (agent.money >= RULES.mealPrice) {
      agent.money -= RULES.mealPrice;
      events.push({ tick, type: "paid", agentId: agent.id, amount: RULES.mealPrice, to: a.locationId, reason: "étel" });
      events.push({ tick, type: "ate", agentId: agent.id, what: "meleg étel", locationId: a.locationId });
    } else {
      // Nincs mit enni: abbahagyja, a következő döntésnél mást választ.
      agent.activity = null;
      return;
    }
    agent.needs.hunger = clamp(agent.needs.hunger - RULES.eatHungerRelief);
    agent.activity = null;
    return;
  }

  if (a.kind === "dolgozik" && a.locationId === agent.workplaceId) {
    agent.workProgress++;
    if (agent.workProgress >= RULES.workTicksPerProduct) {
      agent.workProgress = 0;
      if (agent.produces) {
        add(world.state.stocks[a.locationId], agent.produces, 1);
        events.push({ tick, type: "produced", agentId: agent.id, item: agent.produces, qty: 1, locationId: a.locationId });
      }
      agent.money += RULES.wagePerProduct;
      events.push({ tick, type: "earned", agentId: agent.id, amount: RULES.wagePerProduct, reason: "munka" });
    }
    // A pék a műszak végén hazavisz egy kenyeret, ha kevés van otthon.
    const { hour, minute } = tickToTime(tick);
    if (
      hour === RULES.workEndHour - 1 &&
      minute === 55 &&
      agent.produces === "kenyér" &&
      count(agent.inventory, "kenyér") < 2 &&
      transfer(world.state.stocks[a.locationId], agent.inventory, "kenyér", 1)
    ) {
      events.push({ tick, type: "took", agentId: agent.id, item: "kenyér", qty: 1, from: a.locationId });
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
