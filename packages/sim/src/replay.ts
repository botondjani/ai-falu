import { restoreWorld, stepWorld, type ExternalInputs, type SimEvent, type World } from "@falu/core";
import type { EventStore } from "./store";

/** Világ a futás `fromTick` előtti legutóbbi snapshotjából, odaléptetve `fromTick`-ig. */
export function worldAt(store: EventStore, runId: number, fromTick: number): World {
  const snap = store.loadSnapshot(runId, fromTick);
  if (!snap) throw new Error(`Nincs snapshot a(z) ${runId}. futáshoz`);
  const world = restoreWorld(snap);
  const inputs = recordedInputs(store, runId);
  while (world.state.tick < fromTick) stepWorld(world, inputs.get(world.state.tick) ?? {});
  return world;
}

const INPUT_FIELDS: Record<string, keyof ExternalInputs> = {
  decision: "decisions",
  plan: "plans",
  reflection: "reflections",
  conversation: "conversations",
};

/** A rögzített külső bemenetek (döntés, terv, reflexió) tickenként. */
export function recordedInputs(store: EventStore, runId: number): Map<number, ExternalInputs> {
  const m = new Map<number, ExternalInputs>();
  for (const i of store.inputs(runId)) {
    const field = INPUT_FIELDS[i.kind];
    if (!field) continue;
    const rec = m.get(i.tick) ?? {};
    ((rec[field] ??= {}) as Record<string, unknown>)[i.key] = i.payload;
    m.set(i.tick, rec);
  }
  return m;
}

export interface VerifyResult {
  ok: boolean;
  ticks: number;
  events: number;
  firstMismatch?: { index: number; expected?: SimEvent; actual?: SimEvent };
}

/**
 * Determinizmus-ellenőrzés: a futást a seedből (0. tick snapshot) újraszimulálja,
 * és összeveti a naplóval eseményről eseményre.
 */
export function verifyRun(store: EventStore, runId: number): VerifyResult {
  const run = store.getRun(runId);
  if (!run) throw new Error(`Nincs ilyen futás: ${runId}`);
  const logged = store.events(runId);
  const world = worldAt(store, runId, 0);
  const actual: SimEvent[] = [];
  const endTick = run.lastTick + 1;
  const inputs = recordedInputs(store, runId);
  while (world.state.tick < endTick) actual.push(...stepWorld(world, inputs.get(world.state.tick) ?? {}).events);
  const n = Math.max(logged.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (JSON.stringify(logged[i]) !== JSON.stringify(actual[i])) {
      return { ok: false, ticks: endTick, events: logged.length, firstMismatch: { index: i, expected: logged[i], actual: actual[i] } };
    }
  }
  return { ok: true, ticks: endTick, events: logged.length };
}
