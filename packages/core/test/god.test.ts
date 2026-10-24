import { describe, expect, it } from "vitest";
import { applyGodEvent, applyWhisper, type GodEvent } from "../src/god";
import { VILLAGERS } from "../src/seed/villagers";
import { TICKS_PER_HOUR } from "../src/time";
import type { SimEvent } from "../src/types";
import { createWorld, spotFor, stepWorld } from "../src/world";

const ev = (effects: GodEvent["effects"], affected: string[] = []): GodEvent => ({
  text: "teszt",
  description: "Valami nagy dolog történt.",
  affected,
  importance: 8,
  effects,
});

describe("Isten-mód", () => {
  it("vihar: mindenki hazamegy a megadott időre, és emlékszik rá", () => {
    const w = createWorld("t", VILLAGERS);
    stepWorld(w, { god: { "1": ev([{ type: "haza", hours: 3 }]) } });
    for (const a of w.state.agents) {
      expect(a.activity).toMatchObject({ kind: "pihen", locationId: a.homeId });
      expect(a.activity?.commitUntil).toBe(3 * TICKS_PER_HOUR);
      expect(a.surprised).toBe(true);
      expect(w.state.memories.some((m) => m.agentId === a.id && m.text.includes("Rendkívüli esemény"))).toBe(true);
    }
  });

  it("csak az érintettekre hat", () => {
    const w = createWorld("t", VILLAGERS);
    stepWorld(w, { god: { "1": ev([{ type: "gyules", locationId: "ter", hours: 2 }], ["bela", "mari"]) } });
    expect(w.state.agents.find((a) => a.id === "bela")!.activity?.locationId).toBe("ter");
    expect(w.state.agents.find((a) => a.id === "joska")!.activity?.locationId).not.toBe("ter");
  });

  it("készlet és pénz: korlátozva, nem mehet negatívba", () => {
    const w = createWorld("t", VILLAGERS);
    const events: SimEvent[] = [];
    w.state.stocks.bolt.gabona = 4;
    applyGodEvent(
      w.state,
      w.map,
      ev([
        { type: "keszlet", locationId: "bolt", item: "gabona", delta: -30 },
        { type: "penz", agentId: "joska", delta: -1000 },
        { type: "penz", agentId: "mari", delta: 1000 },
      ]),
      events,
      spotFor,
    );
    expect(w.state.stocks.bolt.gabona ?? 0).toBe(0);
    expect(w.state.agents.find((a) => a.id === "joska")!.money).toBe(0);
    expect(w.state.agents.find((a) => a.id === "mari")!.money).toBe(VILLAGERS.find((v) => v.id === "mari")!.money! + 100);
    expect(events[0]).toMatchObject({ type: "god_event" });
  });

  it("idegen érkezik: új lakó a kocsmában, rendezett sorrendben, determinisztikusan", () => {
    const run = () => {
      const w = createWorld("t", VILLAGERS);
      stepWorld(w, {
        god: {
          "1": ev([
            {
              type: "idegen",
              villager: {
                id: "aaron",
                name: "Áron",
                age: 40,
                occupation: "vándor",
                traits: ["csendes"],
                secretDesire: "Kincset keres.",
                homeId: "kocsma",
                workplaceId: "ter",
                color: "#fff",
              },
            },
          ]),
        },
      });
      for (let i = 0; i < 100; i++) stepWorld(w);
      return w;
    };
    const w = run();
    expect(w.state.agents[0].id).toBe("aaron");
    expect(w.state.agents).toHaveLength(16);
    expect(w.state.memories.some((m) => m.agentId === "aaron" && m.text.includes("Kincset keres"))).toBe(true);
    expect(run().state).toEqual(w.state);
  });

  it("suttogás: esemény és fontos emlék (meglepetés)", () => {
    const w = createWorld("t", VILLAGERS);
    const events: SimEvent[] = [];
    applyWhisper(w.state, "gabor", "Valaki tudja a titkodat.", events);
    expect(events[0]).toMatchObject({ type: "whisper", agentId: "gabor" });
    expect(w.state.agents.find((a) => a.id === "gabor")!.surprised).toBe(true);
    applyWhisper(w.state, "nincsilyen", "x", events);
    expect(events).toHaveLength(1);
  });
});
