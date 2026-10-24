import { add, remove, type Item } from "./inventory";
import { addMemory } from "./memory";
import { getLocation, type TileMap } from "./map/types";
import { TICKS_PER_HOUR } from "./time";
import type { Agent, DesiredActivity, SimEvent, VillagerSeed, WorldState } from "./types";

/** Az Isten-mód esemény mechanikus hatásai (az LLM értelmezi a szöveget ezekre). */
export type GodEffect =
  | { type: "haza"; hours: number }
  | { type: "gyules"; locationId: string; hours: number }
  | { type: "keszlet"; locationId: string; item: Item; delta: number }
  | { type: "penz"; agentId: string; delta: number }
  | { type: "hangulat"; mood: string }
  | { type: "idegen"; villager: VillagerSeed };

export interface GodEvent {
  /** A felhasználó eredeti szövege. */
  text: string;
  /** Mi történik (1–2 mondat, ezt hallják a lakók). */
  description: string;
  /** Érintett lakók; üres = mindenki. */
  affected: string[];
  importance: number;
  effects: GodEffect[];
}

const clampHours = (h: number) => Math.max(0, Math.min(12, Math.round(h)));

/**
 * Egy Isten-mód esemény alkalmazása: esemény a naplóba, emlék az érintetteknek (meglepetés → LLM-döntés),
 * mechanikus hatások. Kényszerített tevékenységeket ad vissza (hazamenekülés, gyűlés).
 */
export function applyGodEvent(
  state: WorldState,
  map: TileMap,
  ev: GodEvent,
  events: SimEvent[],
  spotFor: (spots: { x: number; y: number }[], id: string) => { x: number; y: number },
): Record<string, DesiredActivity> {
  const forced: Record<string, DesiredActivity> = {};
  events.push({ tick: state.tick, type: "god_event", text: ev.description });

  for (const eff of ev.effects) {
    if (eff.type === "idegen") {
      const v = eff.villager;
      if (state.agents.some((a) => a.id === v.id)) continue;
      const home = getLocation(map, v.homeId);
      const agent: Agent = {
        ...v,
        traits: [...v.traits],
        pos: spotFor(home.spots, v.id),
        path: [],
        activity: null,
        needs: { hunger: 30, energy: 70 },
        money: v.money ?? 20,
        inventory: { ...(v.inventory ?? {}) },
        workProgress: 0,
        surprised: true,
      };
      state.agents.push(agent);
      state.agents.sort((a, b) => a.id.localeCompare(b.id));
      addMemory(state, v.id, "reflexió", `Most érkeztem a faluba. ${v.secretDesire}`, 8);
    }
  }

  const affected = ev.affected.length ? state.agents.filter((a) => ev.affected.includes(a.id)) : state.agents;
  for (const a of affected) addMemory(state, a.id, "megfigyelés", `Rendkívüli esemény: ${ev.description}`, Math.max(5, ev.importance));

  for (const eff of ev.effects) {
    switch (eff.type) {
      case "haza": {
        const h = clampHours(eff.hours);
        if (h === 0) break;
        for (const a of affected)
          forced[a.id] = { kind: "pihen", locationId: a.homeId, reason: "menedéket keres", source: "isten", durationTicks: h * TICKS_PER_HOUR };
        break;
      }
      case "gyules": {
        const h = clampHours(eff.hours);
        if (h === 0 || !map.locations.some((l) => l.id === eff.locationId)) break;
        for (const a of affected)
          forced[a.id] = { kind: "szórakozik", locationId: eff.locationId, reason: "mindenki odamegy", source: "isten", durationTicks: h * TICKS_PER_HOUR };
        break;
      }
      case "keszlet": {
        const stock = state.stocks[eff.locationId];
        if (!stock) break;
        const d = Math.max(-50, Math.min(50, Math.round(eff.delta)));
        if (d > 0) add(stock, eff.item, d);
        else if (d < 0) remove(stock, eff.item, Math.min(-d, stock[eff.item] ?? 0));
        break;
      }
      case "penz": {
        const a = state.agents.find((x) => x.id === eff.agentId);
        if (a) a.money = Math.max(0, a.money + Math.max(-100, Math.min(100, Math.round(eff.delta))));
        break;
      }
      case "hangulat":
        for (const a of affected) a.mood = eff.mood.slice(0, 40);
        break;
    }
  }
  return forced;
}

/** Suttogás: egy gondolat a lakó fejében (fontos emlék → a következő döntését az LLM hozza). */
export function applyWhisper(state: WorldState, agentId: string, text: string, events: SimEvent[]) {
  if (!state.agents.some((a) => a.id === agentId)) return;
  const t = text.trim().slice(0, 300);
  events.push({ tick: state.tick, type: "whisper", agentId, text: t });
  addMemory(state, agentId, "megfigyelés", `Egy belső hang azt súgja: „${t}”`, 7);
}
