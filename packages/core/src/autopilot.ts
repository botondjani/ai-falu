import { count } from "./inventory";
import { RULES } from "./rules";
import { hourBetween, tickToTime } from "./time";
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
    if (count(agent.inventory, "kenyér") > 0) {
      return { kind: "eszik", locationId: agent.homeId, reason: "éhes, van otthon kenyér" };
    }
    if (agent.money >= RULES.mealPrice) {
      return { kind: "eszik", locationId: "kocsma", reason: "éhes, a kocsmában eszik" };
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
  if (cur.kind === "eszik") return false;
  if (cur.kind === "alszik" && cur.source === "auto" && agent.needs.energy < 60) return false;
  return cur.commitUntil === undefined || state.tick >= cur.commitUntil;
}
