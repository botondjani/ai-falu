import { describe, expect, it } from "vitest";
import { VILLAGERS, TICKS_PER_DAY, createWorld, lookupFrom, type SimEvent } from "@falu/core";
import { LiveMind } from "../src/agents/mind";
import { LlmGateway } from "../src/llm/gateway";
import { MockClient } from "../src/llm/mock";
import type { LlmClient, LlmRequest, RawCompletion } from "../src/llm/types";
import { Runner } from "../src/runner";
import { EventStore } from "../src/store";
import { extractFacts, topFacts } from "../src/summary/facts";
import { SummaryService } from "../src/summary/service";
import { summarize } from "../src/summary/summary";

const world = createWorld("t", VILLAGERS);
const n = lookupFrom(world.state.agents, world.map.locations);

const talk = (tick: number, a: string, b: string, d: number): SimEvent => ({
  tick,
  type: "conversation",
  agentId: a,
  a,
  b,
  topic: "a munka",
  lines: [
    { speaker: a, text: "Szia!" },
    { speaker: b, text: "Na mi van, öreg?" },
  ],
  deltaA: { trust: d, liking: d },
  deltaB: { trust: d, liking: d },
});

describe("tények", () => {
  it("összevonja a pletyka terjedését és a kapcsolatváltozást", () => {
    const events: SimEvent[] = [
      { tick: 1, type: "gossip", agentId: "bela", listenerId: "mari", aboutId: "gabor", gossipId: 1, text: "Gábor sikkasztott.", fresh: true },
      { tick: 2, type: "gossip", agentId: "mari", listenerId: "teri", aboutId: "gabor", gossipId: 1, text: "Gábor sikkasztott.", fresh: true },
      { tick: 3, type: "gossip", agentId: "teri", listenerId: "rozsi", aboutId: "gabor", gossipId: 1, text: "Gábor sikkasztott.", fresh: true },
      talk(4, "joska", "gizi", -8),
      talk(5, "joska", "gizi", -8),
    ];
    const facts = extractFacts(events, n);
    const gossip = facts.find((f) => f.kind === "gossip")!;
    expect(gossip.text).toMatch(/3 emberhez/);
    expect(gossip.importance).toBe(6);
    expect(facts.find((f) => f.kind === "relation")!.text).toMatch(/megromlott/);
  });

  it("árváltozás 30% fölött tény lesz", () => {
    const facts = extractFacts(
      [
        { tick: 0, type: "prices", prices: { kenyér: 4, fa: 3 } },
        { tick: 288, type: "prices", prices: { kenyér: 8, fa: 3 } },
      ],
      n,
    );
    expect(facts).toHaveLength(1);
    expect(facts[0].text).toMatch(/kenyér ára felment: 4 → 8/);
  });

  it("topFacts: a legfontosabbak, időrendben", () => {
    const f = (tick: number, importance: number) => ({ kind: "x", text: `${tick}`, importance, tick, agents: [] });
    expect(topFacts([f(5, 1), f(3, 9), f(1, 5), f(4, 7)], 2).map((x) => x.tick)).toEqual([3, 4]);
  });
});

describe("összefoglaló", () => {
  it("üres időszak: rövid, üres jelzésű összefoglaló, LLM nélkül", async () => {
    const s = await summarize(world, [], 0, 10);
    expect(s.empty).toBe(true);
  });

  it("mock: 3 különböző fajta kiemelés, a történet a tényekből áll", async () => {
    const events: SimEvent[] = [
      { tick: 1, type: "gossip", agentId: "bela", listenerId: "mari", aboutId: "gabor", gossipId: 1, text: "Gábor sikkasztott.", fresh: true },
      talk(4, "joska", "gizi", -8),
      talk(5, "joska", "gizi", -8),
      { tick: 6, type: "tool_broke", agentId: "pista" },
    ];
    const gw = new LlmGateway(new MockClient());
    const s = await summarize(world, events, 0, 10, gw);
    expect(s.highlights).toHaveLength(3);
    expect(new Set(s.highlights.map((h) => h.title)).size).toBe(3);
    expect(s.story).toMatch(/Gábor sikkasztott/);
    expect(gw.calls).toBe(1);
  });

  it("generálási hiba esetén sablonos tartalék", async () => {
    const broken: LlmClient = {
      mock: false,
      async complete<T>(_r: LlmRequest<T>): Promise<RawCompletion> {
        return { json: { rossz: true } };
      },
    };
    const s = await summarize(world, [talk(4, "joska", "gizi", -8)], 0, 10, new LlmGateway(broken));
    expect(s.mock).toBe(true);
    expect(s.story.length).toBeGreaterThan(20);
  });

  it("a megtekintés óta: gyorsítótárazva, az utolsó megnézés tárolva", async () => {
    const store = new EventStore(":memory:");
    const runId = store.createRun("t");
    const gw = new LlmGateway(new MockClient());
    const runner = new Runner({
      world: createWorld("t", VILLAGERS),
      secondsPerDay: 600,
      store,
      runId,
      inputs: new LiveMind(gw, { llmAgents: "all" }, store, runId),
    });
    const svc = new SummaryService(runner, gw, store, runId);
    await runner.runTicks(TICKS_PER_DAY / 2);
    const s1 = await svc.sinceSeen();
    expect(s1.fromTick).toBe(0);
    expect(s1.highlights.length).toBeGreaterThan(0);
    const calls = gw.calls;
    await svc.sinceSeen();
    expect(gw.calls).toBe(calls); // cache
    svc.markSeen();
    expect(store.getLastSeen(runId)).toBe(runner.world.state.tick);
  });
});
