import { describe, expect, it } from "vitest";
import { DEMO_VILLAGERS, TICKS_PER_DAY, createWorld, type World } from "@falu/core";
import { decisionSchema, mockDecision, validateDecision, type Decision } from "../src/agents/decision";
import { LiveMind } from "../src/agents/mind";
import { LlmGateway } from "../src/llm/gateway";
import { MockClient } from "../src/llm/mock";
import { costUsd } from "../src/llm/pricing";
import type { LlmClient, LlmRequest, RawCompletion } from "../src/llm/types";
import { verifyRun } from "../src/replay";
import { Runner } from "../src/runner";
import { EventStore } from "../src/store";

const MODELS = { routine: "claude-haiku-5-5", strong: "claude-sonnet-5-5" };
const BUDGET = { maxUsdTotal: 1, maxUsdPerRealDay: 1, maxCallsPerSimDay: 1000 };
const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** Előre megadott válaszokat adó kliens. */
class ScriptedClient implements LlmClient {
  readonly mock = false;
  calls = 0;
  constructor(private answers: unknown[]) {}
  async complete<T>(_req: LlmRequest<T>, model: string): Promise<RawCompletion> {
    const json = this.answers[Math.min(this.calls++, this.answers.length - 1)];
    return { json, usage, model };
  }
}

/** Világ a reggeli tervezés utáni tickről (hogy csak döntés-hívás legyen). */
function afterPlanning(): World {
  const w = createWorld("t", DEMO_VILLAGERS);
  w.state.tick = 1;
  return w;
}

function joska(world: World) {
  return world.state.agents.find((a) => a.id === "joska")!;
}

const good: Decision = { gondolat: "Dolgozni kell.", cselekves: "dolgozik", helyszin: "mezo", idotartam_perc: 120, mondja: "Hajrá!" };

describe("árazás", () => {
  it("Haiku: 1M input = $0.10, cache-olvasás 10%", () => {
    expect(costUsd("claude-haiku-5-5", { ...usage, inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.1);
    expect(costUsd("claude-haiku-5-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBeCloseTo(0.01);
    expect(costUsd("claude-sonnet-5-5", { ...usage, inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(10);
  });
});

describe("döntés validálása", () => {
  const world = createWorld("t", DEMO_VILLAGERS);
  const a = joska(world);
  it("munka csak a munkahelyen", () => {
    expect(validateDecision(good, a)).toBeUndefined();
    expect(validateDecision({ ...good, helyszin: "kocsma" }, a)).toMatch(/munkahely/);
  });
  it("evés pénz/kenyér nélkül nem megy", () => {
    expect(validateDecision({ ...good, cselekves: "eszik", helyszin: a.homeId }, { ...a, inventory: {} })).toMatch(/kenyér/);
    expect(validateDecision({ ...good, cselekves: "eszik", helyszin: "kocsma" }, { ...a, money: 0 })).toMatch(/pénz/);
  });
  it("a mock döntés mindig érvényes", () => {
    const schema = decisionSchema(world.map.locations.map((l) => l.id));
    for (let t = 0; t < 200; t += 7) {
      world.state.tick = t;
      for (const ag of world.state.agents) {
        const d = mockDecision(ag, world);
        expect(schema.safeParse(d).success).toBe(true);
        expect(validateDecision(d, ag)).toBeUndefined();
      }
    }
  });
});

describe("LLM gateway", () => {
  it("érvénytelen válasz után újrapróbál", async () => {
    const client = new ScriptedClient([{ ...good, cselekves: "repül" }, good]);
    const gw = new LlmGateway(client, MODELS, BUDGET);
    const world = afterPlanning();
    const dec = new LiveMind(gw, { llmAgents: new Set(["joska"]), onBudget: "pause" });
    const out = (await dec.collect(world)).decisions!;
    expect(client.calls).toBe(2);
    expect(out.joska).toMatchObject({ kind: "dolgozik", locationId: "mezo", source: "llm", durationTicks: 24, say: "Hajrá!" });
    expect(gw.stats.calls).toBe(2);
    expect(gw.stats.usd).toBeGreaterThan(0);
  });

  it("két hiba után biztonságos autopilot-tartalék", async () => {
    const client = new ScriptedClient([{ nonsense: true }]);
    const gw = new LlmGateway(client, MODELS, BUDGET);
    const dec = new LiveMind(gw, { llmAgents: new Set(["joska"]), onBudget: "pause" });
    const out = (await dec.collect(afterPlanning())).decisions!;
    expect(out.joska.source).toBe("fallback");
    expect(out.joska.durationTicks).toBeGreaterThan(0);
    expect(gw.stats.failures).toBe(1);
    expect(gw.stats.fallbacks).toBe(1);
  });

  it("költségkeret elérésekor a szimuláció szünetel", async () => {
    const stroll: Decision = { ...good, cselekves: "sétál", helyszin: "ter", idotartam_perc: 30 };
    const client = new ScriptedClient([stroll]);
    const gw = new LlmGateway(client, MODELS, { ...BUDGET, maxCallsPerSimDay: 3 });
    const runner = new Runner({
      world: afterPlanning(),
      secondsPerDay: 600,
      inputs: new LiveMind(gw, { llmAgents: "all", onBudget: "pause" }),
    });
    await runner.runTicks(TICKS_PER_DAY);
    expect(runner.pausedReason).toMatch(/költségkeret/);
    expect(runner.world.state.tick).toBeLessThan(TICKS_PER_DAY);
    expect(gw.stats.calls).toBe(3);
  });

  it("keretnél autopilot módban tovább fut", async () => {
    const gw = new LlmGateway(new ScriptedClient([good]), MODELS, { ...BUDGET, maxCallsPerSimDay: 3 });
    const runner = new Runner({
      world: afterPlanning(),
      secondsPerDay: 600,
      inputs: new LiveMind(gw, { llmAgents: "all", onBudget: "autopilot" }),
    });
    await runner.runTicks(TICKS_PER_DAY);
    expect(runner.world.state.tick).toBe(TICKS_PER_DAY + 1);
  });

  it("LLM-döntésekkel is pontosan visszajátszható", async () => {
    const store = new EventStore(":memory:");
    const runId = store.createRun("t");
    const gw = new LlmGateway(new MockClient(), MODELS, BUDGET, store, runId);
    const runner = new Runner({
      world: createWorld("t", DEMO_VILLAGERS),
      secondsPerDay: 600,
      store,
      runId,
      inputs: new LiveMind(gw, { llmAgents: "all", onBudget: "pause" }, store, runId),
    });
    await runner.runTicks(2 * TICKS_PER_DAY);
    expect(gw.stats.calls).toBeGreaterThan(10);
    expect(gw.stats.usd).toBe(0);
    expect(gw.stats.estimatedUsd).toBeGreaterThan(0);
    expect(verifyRun(store, runId).ok).toBe(true);
  });
});
