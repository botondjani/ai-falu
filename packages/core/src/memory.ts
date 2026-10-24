import { describeEvent, lookupFrom } from "./describe";
import type { TileMap } from "./map/types";
import { TICKS_PER_DAY, TICKS_PER_HOUR } from "./time";
import type { ActivityKind, Agent, SimEvent, WorldState } from "./types";

export type MemoryKind = "megfigyelés" | "reflexió" | "terv" | "beszélgetés" | "pletyka";

export interface Memory {
  id: number;
  agentId: string;
  tick: number;
  kind: MemoryKind;
  text: string;
  /** 1 (hétköznapi) – 10 (életre szóló) */
  importance: number;
  keywords: string[];
}

export interface PlanItem {
  fromHour: number;
  toHour: number;
  kind: ActivityKind;
  locationId: string;
  goal: string;
}

export interface DayPlan {
  day: number;
  goal: string;
  items: PlanItem[];
}

export interface MemoryWeights {
  recency: number;
  importance: number;
  relevance: number;
  /** Óránkénti lecsengés (Generative Agents: 0.995). */
  decayPerHour: number;
}

export const DEFAULT_WEIGHTS: MemoryWeights = { recency: 1, importance: 1, relevance: 1.5, decayPerHour: 0.98 };

const STOPWORDS = new Set(
  "a az egy és és is de hogy nem van volt lesz meg már még csak mert ha mint vagy ez azt ezt itt ott én te ő mi ti ők nagyon most majd sem se pedig így úgy mit ki mi mikor hol".split(
    " ",
  ),
);

/** Egyszerű kulcsszókinyerés: kisbetű, írásjelek nélkül, stopszavak nélkül, 6 karakterre vágva (durva tő). */
export function keywords(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    .map((w) => w.slice(0, 6));
  return [...new Set(words)];
}

/** Frissesség 0..1: exponenciális lecsengés a keletkezés óta eltelt játékórákkal. */
export function recencyScore(m: Memory, nowTick: number, decayPerHour: number): number {
  const hours = Math.max(0, nowTick - m.tick) / TICKS_PER_HOUR;
  return Math.pow(decayPerHour, hours);
}

/** Relevancia 0..1: a lekérdezés kulcsszavainak hányada szerepel az emlékben. */
export function relevanceScore(m: Memory, query: string[]): number {
  if (query.length === 0) return 0;
  const set = new Set(m.keywords);
  return query.filter((q) => set.has(q)).length / query.length;
}

export function scoreMemory(m: Memory, nowTick: number, query: string[], w: MemoryWeights = DEFAULT_WEIGHTS): number {
  return (
    w.recency * recencyScore(m, nowTick, w.decayPerHour) +
    w.importance * (m.importance / 10) +
    w.relevance * relevanceScore(m, query)
  );
}

/** A legjobb k emlék egy lakónak (stabil sorrend: pontszám, majd újabb előbb). */
export function retrieve(
  state: WorldState,
  agentId: string,
  queryText: string,
  k: number,
  w: MemoryWeights = DEFAULT_WEIGHTS,
): Memory[] {
  const q = keywords(queryText);
  return state.memories
    .filter((m) => m.agentId === agentId)
    .map((m) => ({ m, s: scoreMemory(m, state.tick, q, w) }))
    .sort((a, b) => b.s - a.s || b.m.tick - a.m.tick || b.m.id - a.m.id)
    .slice(0, k)
    .map((x) => x.m);
}

export function addMemory(
  state: WorldState,
  agentId: string,
  kind: MemoryKind,
  text: string,
  importance: number,
  tick = state.tick,
): Memory {
  const m: Memory = {
    id: state.nextMemoryId++,
    agentId,
    tick,
    kind,
    text,
    importance: Math.max(1, Math.min(10, Math.round(importance))),
    keywords: keywords(text),
  };
  state.memories.push(m);
  // Fontos új emlék: a lakó következő döntését az LLM hozza, nem a terv.
  if (m.importance >= 5 && kind !== "reflexió" && kind !== "terv") {
    const a = state.agents.find((x) => x.id === agentId);
    if (a) a.surprised = true;
  }
  return m;
}

/**
 * Megfigyelések az eseményekből, szabály-alapú fontossággal (LLM nélkül, determinisztikusan).
 * Csak a lakót érintő, érdemi eseményekből lesz emlék.
 */
export function observeEvents(state: WorldState, map: TileMap, events: SimEvent[]) {
  const names = lookupFrom(state.agents, map.locations);
  for (const e of events) {
    switch (e.type) {
      case "activity_started":
        if (e.source !== "auto")
          addMemory(state, e.agentId, "megfigyelés", `${describeEvent(e, names)}`, e.say ? 3 : 2, e.tick);
        break;
      case "ate":
        if (e.locationId !== state.agents.find((a) => a.id === e.agentId)?.homeId)
          addMemory(state, e.agentId, "megfigyelés", `Ettem: ${e.what} (${names.place(e.locationId)}).`, 2, e.tick);
        break;
      case "starving":
        addMemory(state, e.agentId, "megfigyelés", "Nagyon éhes vagyok, és nincs mit ennem.", 6, e.tick);
        break;
      case "arrived": {
        // Kikkel találkozott a helyszínen (házban és munkahelyen nem, ott ez rutin).
        const loc = map.locations.find((l) => l.id === e.locationId);
        if (!loc || loc.kind === "ház") break;
        const others = state.agents.filter(
          (a) => a.id !== e.agentId && a.activity?.arrived && a.activity.locationId === e.locationId,
        );
        if (others.length > 0)
          addMemory(
            state,
            e.agentId,
            "megfigyelés",
            `${loc.name}: ott volt ${others.map((o) => o.name).join(", ")}.`,
            2,
            e.tick,
          );
        break;
      }
    }
  }
}

/** Naponta: régi, kis jelentőségű megfigyelések törlése; lakónként legfeljebb `cap` emlék. */
export function pruneMemories(state: WorldState, keepDays = 3, cap = 300) {
  const cutoff = state.tick - keepDays * TICKS_PER_DAY;
  const byAgent = new Map<string, Memory[]>();
  for (const m of state.memories) {
    if (m.kind === "megfigyelés" && m.importance < 5 && m.tick < cutoff) continue;
    const list = byAgent.get(m.agentId) ?? [];
    list.push(m);
    byAgent.set(m.agentId, list);
  }
  const kept: Memory[] = [];
  for (const list of byAgent.values()) {
    if (list.length > cap) {
      list.sort((a, b) => b.importance - a.importance || b.tick - a.tick);
      list.length = cap;
      list.sort((a, b) => a.id - b.id);
    }
    kept.push(...list);
  }
  kept.sort((a, b) => a.id - b.id);
  state.memories = kept;
}

/** A napi terv aktuális eleme, ha van. */
export function currentPlanItem(agent: Agent, hour: number, day: number): PlanItem | undefined {
  if (!agent.plan || agent.plan.day !== day) return undefined;
  return agent.plan.items.find((i) => hour >= i.fromHour && hour < i.toHour);
}
