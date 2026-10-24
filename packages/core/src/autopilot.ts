import { count } from "./inventory";
import { SHOP, TAVERN, FOOD, foodAtHome, mealPrice, ownerOf, priceOf } from "./economy";
import { RULES } from "./rules";
import { currentPlanItem } from "./memory";
import { hourBetween, tickToTime, timeToTick } from "./time";
import type { Agent, DesiredActivity, WorldState } from "./types";
import type { Rng } from "./rng";

/**
 * Szabály-alapú viselkedés: alvás, evés, munka, esti kikapcsolódás.
 * Akkor is ez fut, ha az LLM nem elérhető, vagy rutinhelyzet van.
 */
export function autopilotDecide(agent: Agent, state: WorldState, rng: Rng): DesiredActivity {
  const { hour } = tickToTime(state.tick);
  const cur = agent.activity;

  // Folyamatban lévő evést nem szakítunk meg.
  if (cur?.kind === "eszik" && (cur.untilTick === undefined || state.tick < cur.untilTick)) {
    return keep(cur);
  }

  if (agent.needs.energy < RULES.exhaustedThreshold) {
    return { kind: "alszik", locationId: agent.homeId, reason: "kimerült" };
  }

  const night = hourBetween(hour, RULES.sleepHour, RULES.wakeHour);
  if (cur?.kind === "alszik" && (night || agent.needs.energy < 60)) return keep(cur);
  if (night) return { kind: "alszik", locationId: agent.homeId, reason: "késő van" };

  if (agent.needs.hunger >= RULES.hungryThreshold) {
    const food = foodAtHome(agent);
    if (food) return { kind: "eszik", locationId: agent.homeId, reason: `éhes, van otthon ${food}` };
    if (cur?.kind === "vásárol" && !cur.arrived) return keep(cur);
    const shop = state.stocks[SHOP];
    if (count(shop, "kenyér") > 0 && agent.money >= priceOf(shop, "kenyér")) {
      return { kind: "vásárol", locationId: SHOP, reason: "éhes, kenyeret vesz a boltban" };
    }
    const tavern = state.stocks[TAVERN];
    const tavernOwner = ownerOf(state, TAVERN) === agent;
    if (FOOD.some((f) => count(tavern, f) > 0) && (tavernOwner || agent.money >= mealPrice(state))) {
      return { kind: "eszik", locationId: TAVERN, reason: "éhes, a kocsmában eszik" };
    }
    // nincs étel és pénz: dolgozik tovább, hátha keres valamit
  }

  // Külső (LLM) döntés: amíg tart, tiszteletben tartjuk.
  if (cur?.commitUntil !== undefined && state.tick < cur.commitUntil) return keep(cur);

  if (hourBetween(hour, RULES.workStartHour, RULES.workEndHour)) {
    return { kind: "dolgozik", locationId: agent.workplaceId, reason: "munkaidő" };
  }

  if (hourBetween(hour, 18, RULES.sleepHour)) {
    if (cur?.kind === "szórakozik") return keep(cur);
    const where = rng.chance(0.6) ? "kocsma" : "ter";
    return { kind: "szórakozik", locationId: where, reason: "esti kikapcsolódás" };
  }

  if (cur?.kind === "pihen" || cur?.kind === "sétál") return keep(cur);
  if (rng.chance(0.3)) return { kind: "sétál", locationId: "ter", reason: "kis séta a téren" };
  return { kind: "pihen", locationId: agent.homeId, reason: "otthon pihen" };
}

function keep(a: { kind: DesiredActivity["kind"]; locationId: string; reason: string }): DesiredActivity {
  return { kind: a.kind, locationId: a.locationId, reason: a.reason };
}

/**
 * Döntési pont: igaz, ha a lakó szabad, nincs sürgős szükséglete, és nincs futó döntése.
 * Ilyenkor kérdezhetjük az LLM-et; minden más helyzetet az autopilot visz.
 */
export function needsDecision(agent: Agent, state: WorldState): boolean {
  const { hour } = tickToTime(state.tick);
  if (hourBetween(hour, RULES.sleepHour, RULES.wakeHour)) return false;
  if (agent.needs.hunger >= RULES.hungryThreshold || agent.needs.energy < RULES.exhaustedThreshold) return false;
  const cur = agent.activity;
  if (!cur) return true;
  if (cur.kind === "eszik" || (cur.kind === "vásárol" && !cur.arrived)) return false;
  if (cur.kind === "alszik" && cur.source === "auto" && agent.needs.energy < 60) return false;
  return cur.commitUntil === undefined || state.tick >= cur.commitUntil;
}

/** Ha a napi terv lefedi a mostani órát, a terv szerinti tevékenység (LLM nélkül). */
export function planDesired(agent: Agent, state: WorldState): DesiredActivity | undefined {
  const t = tickToTime(state.tick);
  const item = currentPlanItem(agent, t.hour, t.day);
  if (!item) return undefined;
  const until = timeToTick(t.day, item.toHour);
  if (until <= state.tick) return undefined;
  return {
    kind: item.kind,
    locationId: item.locationId,
    reason: `terv szerint: ${item.goal}`,
    source: "terv",
    durationTicks: until - state.tick,
  };
}
