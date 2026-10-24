import { describe, expect, it } from "vitest";
import { DEMO_VILLAGERS } from "../src/seed/demo";
import { TICKS_PER_DAY } from "../src/time";
import { createWorld, stepWorld } from "../src/world";
import { Rng } from "../src/rng";

function run(seed: string, ticks: number) {
  const w = createWorld(seed, DEMO_VILLAGERS);
  const events = [];
  for (let i = 0; i < ticks; i++) events.push(...stepWorld(w).events);
  return { w, events };
}

describe("világ", () => {
  it("ugyanabból a seedből ugyanaz a futás", () => {
    const a = run("teszt", TICKS_PER_DAY * 2);
    const b = run("teszt", TICKS_PER_DAY * 2);
    expect(a.events).toEqual(b.events);
    expect(a.w.state).toEqual(b.w.state);
  });

  it("a lakók esznek, dolgoznak, alszanak egy nap alatt", () => {
    const { events } = run("teszt", TICKS_PER_DAY);
    for (const v of DEMO_VILLAGERS) {
      const kinds = new Set(
        events.filter((e) => e.type === "activity_started" && e.agentId === v.id).map((e) => (e as { kind: string }).kind),
      );
      expect(kinds, v.id).toContain("dolgozik");
      expect(kinds, v.id).toContain("alszik");
      expect(events.some((e) => e.type === "ate" && e.agentId === v.id), `${v.id} evett`).toBe(true);
    }
  });

  it("a szükségletek 0..100 között maradnak 5 nap alatt", () => {
    const { w } = run("teszt", TICKS_PER_DAY * 5);
    for (const a of w.state.agents) {
      expect(a.needs.hunger).toBeGreaterThanOrEqual(0);
      expect(a.needs.hunger).toBeLessThanOrEqual(100);
      expect(a.needs.energy).toBeGreaterThanOrEqual(0);
      expect(a.needs.energy).toBeLessThanOrEqual(100);
    }
  });

  it("rng szerializálható", () => {
    const r = Rng.fromSeed("x");
    r.next();
    const copy = new Rng(r.state);
    expect(copy.next()).toBe(r.next());
  });
});
