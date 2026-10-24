import { describe, expect, it } from "vitest";
import {
  addMemory,
  keywords,
  pruneMemories,
  recencyScore,
  relevanceScore,
  retrieve,
  scoreMemory,
  type Memory,
} from "../src/memory";
import { DEMO_VILLAGERS } from "../src/seed/demo";
import { TICKS_PER_DAY, TICKS_PER_HOUR } from "../src/time";
import { createWorld, stepWorld } from "../src/world";
import { planDesired } from "../src/autopilot";

const mem = (over: Partial<Memory>): Memory => ({
  id: 1,
  agentId: "a",
  tick: 0,
  kind: "megfigyelés",
  text: "",
  importance: 5,
  keywords: [],
  ...over,
});

describe("memória-pontozás", () => {
  it("kulcsszavak: kisbetű, írásjel és stopszó nélkül, tőre vágva", () => {
    expect(keywords("Béla a Kocsmában volt, és sört ivott!")).toEqual(["béla", "kocsmá", "sört", "ivott"]);
  });

  it("frissesség: azonnal 1, óránként lecseng", () => {
    const m = mem({ tick: 100 });
    expect(recencyScore(m, 100, 0.98)).toBe(1);
    expect(recencyScore(m, 100 + TICKS_PER_HOUR, 0.98)).toBeCloseTo(0.98);
    expect(recencyScore(m, 100 + 10 * TICKS_PER_HOUR, 0.98)).toBeCloseTo(Math.pow(0.98, 10));
  });

  it("relevancia: a lekérdezés kulcsszavainak hányada", () => {
    const m = mem({ keywords: ["béla", "kocsmá"] });
    expect(relevanceScore(m, ["béla"])).toBe(1);
    expect(relevanceScore(m, ["béla", "mari"])).toBe(0.5);
    expect(relevanceScore(m, [])).toBe(0);
  });

  it("összpontszám = frissesség + fontosság/10 + 1.5 × relevancia", () => {
    const m = mem({ tick: 0, importance: 8, keywords: ["béla"] });
    expect(scoreMemory(m, 0, ["béla"])).toBeCloseTo(1 + 0.8 + 1.5);
  });

  it("visszakeresés: a fontos és releváns emlék nyer a friss, jelentéktelen ellen", () => {
    const w = createWorld("t", DEMO_VILLAGERS);
    w.state.memories = [];
    w.state.tick = 0;
    addMemory(w.state, "mari", "reflexió", "Jóska tartozik nekem pénzzel.", 8, 0);
    w.state.tick = 3 * TICKS_PER_DAY;
    addMemory(w.state, "mari", "megfigyelés", "Esett az eső.", 1);
    addMemory(w.state, "bela", "megfigyelés", "Jóska ma a mezőn dolgozott.", 3);
    const top = retrieve(w.state, "mari", "Szabó Jóska itt van", 1);
    expect(top[0].text).toMatch(/tartozik/);
    expect(retrieve(w.state, "mari", "", 10).every((m) => m.agentId === "mari")).toBe(true);
  });

  it("fontos megfigyelés meglepetést jelez, a reflexió nem", () => {
    const w = createWorld("t", DEMO_VILLAGERS);
    const a = w.state.agents.find((x) => x.id === "joska")!;
    addMemory(w.state, "joska", "reflexió", "Valami.", 9);
    expect(a.surprised).toBe(false);
    addMemory(w.state, "joska", "megfigyelés", "Leégett a pajta!", 8);
    expect(a.surprised).toBe(true);
  });

  it("ritkítás: régi, kis jelentőségű megfigyelések törlődnek, a fontosak maradnak", () => {
    const w = createWorld("t", DEMO_VILLAGERS);
    w.state.memories = [];
    addMemory(w.state, "bela", "megfigyelés", "apróság", 2, 0);
    addMemory(w.state, "bela", "megfigyelés", "nagy dolog", 7, 0);
    addMemory(w.state, "bela", "reflexió", "tanulság", 3, 0);
    w.state.tick = 5 * TICKS_PER_DAY;
    pruneMemories(w.state, 3);
    expect(w.state.memories.map((m) => m.text)).toEqual(["nagy dolog", "tanulság"]);
  });

  it("a lakók a napi eseményekből emlékeket gyűjtenek", () => {
    const w = createWorld("t", DEMO_VILLAGERS);
    for (let i = 0; i < TICKS_PER_DAY; i++) stepWorld(w);
    const kinds = new Set(w.state.memories.map((m) => m.agentId));
    expect(kinds.size).toBe(3);
  });
});

describe("napi terv", () => {
  it("a terv aktuális eleme vezérel, LLM nélkül", () => {
    const w = createWorld("t", DEMO_VILLAGERS);
    const plan = { day: 1, goal: "pénzt keresni", items: [{ fromHour: 6, toHour: 9, kind: "sétál" as const, locationId: "folyo", goal: "horgászni" }] };
    stepWorld(w, { plans: { joska: plan } });
    const j = w.state.agents.find((a) => a.id === "joska")!;
    expect(j.plan?.goal).toBe("pénzt keresni");
    expect(j.activity).toMatchObject({ kind: "sétál", locationId: "folyo", source: "terv" });
    expect(j.activity?.commitUntil).toBe(3 * TICKS_PER_HOUR);
    expect(w.state.memories.some((m) => m.agentId === "joska" && m.kind === "terv")).toBe(true);
    w.state.tick = 4 * TICKS_PER_HOUR;
    expect(planDesired(j, w.state)).toBeUndefined();
  });

  it("reflexió: emlék + hangulat", () => {
    const w = createWorld("t", DEMO_VILLAGERS);
    const r = stepWorld(w, { reflections: { bela: { insights: [{ text: "Mari megbízható.", importance: 7 }], mood: "elégedett" } } });
    expect(r.events.some((e) => e.type === "reflected")).toBe(true);
    expect(w.state.agents.find((a) => a.id === "bela")!.mood).toBe("elégedett");
    expect(w.state.memories.some((m) => m.text === "Mari megbízható." && m.importance === 7)).toBe(true);
  });
});
