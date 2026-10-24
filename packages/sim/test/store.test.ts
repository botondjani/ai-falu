import { describe, expect, it } from "vitest";
import { DEMO_VILLAGERS, TICKS_PER_DAY, createWorld } from "@falu/core";
import { verifyRun, worldAt } from "../src/replay";
import { Runner } from "../src/runner";
import { EventStore } from "../src/store";

async function recordedRun(days: number) {
  const store = new EventStore(":memory:");
  const runId = store.createRun("teszt");
  const runner = new Runner({ world: createWorld("teszt", DEMO_VILLAGERS), secondsPerDay: 600, store, runId });
  await runner.runTicks(days * TICKS_PER_DAY);
  return { store, runId, runner };
}

describe("eseménynapló", () => {
  it("minden eseményt sorrendben ment, naponta snapshotot készít", async () => {
    const { store, runId } = await recordedRun(2);
    const events = store.events(runId);
    expect(events.length).toBeGreaterThan(50);
    for (let i = 1; i < events.length; i++) expect(events[i].tick).toBeGreaterThanOrEqual(events[i - 1].tick);
    expect(store.loadSnapshot(runId, 0)?.tick).toBe(0);
    expect(store.loadSnapshot(runId, TICKS_PER_DAY + 10)?.tick).toBe(TICKS_PER_DAY);
  });

  it("a visszajátszás pontosan egyezik a naplóval", async () => {
    const { store, runId } = await recordedRun(3);
    expect(verifyRun(store, runId).ok).toBe(true);
  });

  it("bármely tickre visszaállítható ugyanaz az állapot", async () => {
    const { store, runId } = await recordedRun(2);
    const ref = await recordedRun(2);
    const target = TICKS_PER_DAY + 137;
    const a = worldAt(store, runId, target);
    const b = createWorld("teszt", DEMO_VILLAGERS);
    const r = new Runner({ world: b, secondsPerDay: 600 });
    await r.runTicks(target);
    expect(a.state).toEqual(b.state);
    expect(ref.store.events(ref.runId)).toEqual(store.events(runId));
  });

  it("folytatás: a snapshot utáni rész törlődik, újrafuttatva ugyanaz lesz", async () => {
    const { store, runId } = await recordedRun(2);
    const before = store.events(runId);
    const snap = store.loadSnapshot(runId, TICKS_PER_DAY + 50)!;
    store.truncateFrom(runId, snap.tick);
    const runner = new Runner({ world: worldAt(store, runId, snap.tick), secondsPerDay: 600, store, runId });
    await runner.runTicks(2 * TICKS_PER_DAY - snap.tick);
    expect(store.events(runId)).toEqual(before);
  });
});
