import {
  Rng,
  TICKS_PER_HOUR,
  autopilotDecide,
  conversationCandidates,
  pairKey,
  needsDecision,
  planDesired,
  tickToTime,
  timeToTick,
  type Agent,
  type DesiredActivity,
  type ExternalInputs,
  type SimEvent,
  type World,
} from "@falu/core";
import { BudgetExceededError, type LlmGateway } from "../llm/gateway";
import type { EventStore } from "../store";
import {
  conversationPromptText,
  conversationSchema,
  mockConversation,
  toConversation,
  validateConversation,
} from "./conversation";
import { GOD_STYLE, godSchema, mockGod, toGodEvent, validateGod } from "./god";
import { decisionSchema, mockDecision, toDesired, validateDecision } from "./decision";
import { mockPlan, planSchema, toDayPlan } from "./plan";
import { personaText, planPromptText, reflectionPromptText, situationText, worldRulesText } from "./prompts";
import { mockReflection, reflectionSchema, toReflection, validateReflection } from "./reflect";

/** Tickenként a külső bemenetek (LLM-döntés, terv, reflexió) forrása. */
export interface InputProvider {
  collect(world: World): Promise<ExternalInputs>;
  observe?(events: SimEvent[]): void;
}

export interface LiveMindOptions {
  /** Mely lakók gondolkodnak LLM-mel ("all" = mind). */
  llmAgents: Set<string> | "all";
  /** Keret elérésekor: szünet (alap) vagy autopilot. */
  onBudget: "pause" | "autopilot";
}

/** Reggel 6:00 napi terv, este 21:30 reflexió. */
export const PLAN_HOUR = 6;
export const REFLECT_HOUR = 21;
export const REFLECT_MINUTE = 30;

/**
 * Élő "elme": a megfelelő pillanatokban LLM-et kérdez (napi terv, reflexió, döntés váratlan
 * helyzetben vagy terv nélkül), és minden választ rögzít a visszajátszáshoz.
 */
export class LiveMind implements InputProvider {
  private recent = new Map<string, SimEvent[]>();
  private pendingGod: { text: string; atTick?: number }[] = [];
  private pendingWhispers: { agentId: string; text: string }[] = [];
  private godSeq = 0;

  /** Isten-mód esemény a következő tickre (vagy egy adott tickre). */
  enqueueGod(text: string, atTick?: number) {
    this.pendingGod.push({ text: text.slice(0, 500), atTick });
  }

  enqueueWhisper(agentId: string, text: string) {
    this.pendingWhispers.push({ agentId, text: text.slice(0, 300) });
  }

  constructor(
    private gateway: LlmGateway,
    private opts: LiveMindOptions,
    private store?: EventStore,
    private runId?: number,
  ) {}

  observe(events: SimEvent[]) {
    for (const e of events) {
      if (!("agentId" in e) || e.type === "earned" || e.type === "produced" || e.type === "arrived") continue;
      const list = this.recent.get(e.agentId) ?? [];
      list.push(e);
      if (list.length > 6) list.shift();
      this.recent.set(e.agentId, list);
    }
  }

  private enabled(a: Agent) {
    return this.opts.llmAgents === "all" || this.opts.llmAgents.has(a.id);
  }

  private record(world: World, kind: string, agentId: string, payload: unknown) {
    if (this.store && this.runId !== undefined) this.store.recordInput(this.runId, world.state.tick, kind, agentId, payload);
  }

  /** Párhuzamosan futtat lakónkénti feladatokat; keretnél szünet vagy tartalék. */
  private async each<I, T>(agents: I[], fn: (a: I) => Promise<T>, fallback: (a: I) => T | undefined) {
    let budgetHit: string | undefined;
    const results = await Promise.all(
      agents.map(async (a) => {
        try {
          return [a, await fn(a)] as const;
        } catch (e) {
          if (!(e instanceof BudgetExceededError)) throw e;
          budgetHit = e.message;
          return [a, fallback(a)] as const;
        }
      }),
    );
    if (budgetHit && this.opts.onBudget === "pause") throw new BudgetExceededError(budgetHit);
    return results;
  }

  async collect(world: World): Promise<ExternalInputs> {
    const { state } = world;
    const t = tickToTime(state.tick);
    const mine = state.agents.filter((a) => this.enabled(a));
    const inputs: ExternalInputs = {};
    const planned = new Set<string>();

    // Isten-mód: a beérkezett szövegek értelmezése (strukturált hatásokra) és a suttogások.
    const due = this.pendingGod.filter((g) => g.atTick === undefined || g.atTick <= state.tick);
    this.pendingGod = this.pendingGod.filter((g) => !due.includes(g));
    for (const g of due) {
      const ev = await this.interpretGod(g.text, world);
      const key = String(++this.godSeq).padStart(4, "0");
      (inputs.god ??= {})[key] = ev;
      this.record(world, "god", key, ev);
    }
    for (const w of this.pendingWhispers.splice(0)) {
      (inputs.whispers ??= {})[w.agentId] = w.text;
      this.record(world, "whisper", w.agentId, w.text);
    }

    if (t.hour === PLAN_HOUR && t.minute === 0) {
      const res = await this.each(mine, (a) => this.plan(a, world, t.day), () => undefined);
      for (const [a, plan] of res) {
        if (!plan) continue;
        (inputs.plans ??= {})[a.id] = plan;
        planned.add(a.id);
        this.record(world, "plan", a.id, plan);
      }
    }

    if (t.hour === REFLECT_HOUR && t.minute === REFLECT_MINUTE) {
      const res = await this.each(mine, (a) => this.reflect(a, world), () => undefined);
      for (const [a, refl] of res) {
        if (!refl) continue;
        (inputs.reflections ??= {})[a.id] = refl;
        this.record(world, "reflection", a.id, refl);
      }
    }

    // Döntés csak ott kell, ahol nincs érvényes tervelem, vagy valami váratlan történt.
    const dueAgents = mine.filter(
      (a) => !planned.has(a.id) && needsDecision(a, state) && (a.surprised || !planDesired(a, state)),
    );
    if (dueAgents.length > 0) {
      const res = await this.each(dueAgents, (a) => this.decide(a, world), (a) => fallbackDecision(a, world));
      for (const [a, d] of res) {
        if (!d) continue;
        (inputs.decisions ??= {})[a.id] = d;
        this.record(world, "decision", a.id, d);
      }
    }
    // Beszélgetések a ráérő, egy helyen lévő párok között.
    const pairs = conversationCandidates(state, world.map).filter(([a, b]) => {
      const A = state.agents.find((x) => x.id === a)!;
      const B = state.agents.find((x) => x.id === b)!;
      return this.enabled(A) || this.enabled(B);
    });
    if (pairs.length > 0) {
      const res = await this.each(pairs, ([a, b]) => this.converse(a, b, world), () => undefined);
      for (const [[a, b], conv] of res) {
        if (!conv) continue;
        const key = pairKey(a, b);
        (inputs.conversations ??= {})[key] = conv;
        this.record(world, "conversation", key, conv);
      }
    }
    return inputs;
  }

  /** Az Isten-mód szöveg értelmezése; keret vagy hiba esetén a kulcsszavas (mock) értelmezés. */
  async interpretGod(text: string, world: World) {
    const schema = godSchema(world.state.agents.map((a) => a.id), world.map.locations.map((l) => l.id));
    try {
      const res = await this.gateway.call(
        {
          purpose: "god",
          tick: world.state.tick,
          tier: "strong",
          system: [{ text: worldRulesText(world) }, { text: GOD_STYLE, cache: true }],
          user: `A falu lakói: ${world.state.agents.map((a) => `${a.id}: ${a.name}, ${a.occupation}`).join("; ")}.\n\nAz esemény: ${text}`,
          schema,
          maxTokens: 3000,
          effort: "low",
          mock: () => mockGod(text, world),
        },
        (o) => validateGod(o, world),
      );
      if (res.data) return toGodEvent(res.data, text);
    } catch {
      // keret: ettől még megtörténik az esemény
    }
    return toGodEvent(mockGod(text, world), text);
  }

  async converse(aId: string, bId: string, world: World) {
    const a = world.state.agents.find((x) => x.id === aId)!;
    const b = world.state.agents.find((x) => x.id === bId)!;
    const schema = conversationSchema(a, b, world.state.agents.map((x) => x.id));
    const res = await this.gateway.call(
      {
        purpose: "conversation",
        tick: world.state.tick,
        agentId: a.id,
        tier: "routine",
        system: [{ text: worldRulesText(world), cache: true }],
        user: conversationPromptText(a, b, world),
        schema,
        maxTokens: 3000,
        effort: "low",
        mock: () => mockConversation(a, b, world),
      },
      (o) => validateConversation(o, a, b, world),
    );
    return res.data ? toConversation(res.data, a, b) : undefined;
  }

  private system(agent: Agent, world: World) {
    return [{ text: worldRulesText(world) }, { text: personaText(agent, world), cache: true }];
  }

  async decide(agent: Agent, world: World): Promise<DesiredActivity> {
    const schema = decisionSchema(world.map.locations.map((l) => l.id));
    const res = await this.gateway.call(
      {
        purpose: "decision",
        tick: world.state.tick,
        agentId: agent.id,
        tier: "routine",
        system: this.system(agent, world),
        user: situationText(agent, world, this.recent.get(agent.id) ?? []),
        schema,
        maxTokens: 2000,
        effort: "low",
        mock: () => mockDecision(agent, world),
      },
      (d) => validateDecision(d, agent, world.state),
    );
    if (res.data) return toDesired(res.data);
    this.gateway.noteFallback();
    return fallbackDecision(agent, world);
  }

  async plan(agent: Agent, world: World, day: number) {
    const schema = planSchema(world.map.locations.map((l) => l.id));
    const res = await this.gateway.call(
      {
        purpose: "plan",
        tick: world.state.tick,
        agentId: agent.id,
        tier: "routine",
        system: this.system(agent, world),
        user: planPromptText(agent, world),
        schema,
        maxTokens: 3000,
        effort: "low",
        mock: () => mockPlan(agent, world, day),
      },
      (p) => (toDayPlan(p, agent, day).plan.items.length === 0 ? "nincs egyetlen érvényes lépés sem" : undefined),
    );
    if (!res.data) return undefined; // terv nélkül döntésekkel él a nap
    return toDayPlan(res.data, agent, day).plan;
  }

  async reflect(agent: Agent, world: World) {
    const dayStart = timeToTick(tickToTime(world.state.tick).day, 0);
    const todays = world.state.memories.filter((m) => m.agentId === agent.id && m.tick >= dayStart);
    const res = await this.gateway.call(
      {
        purpose: "reflection",
        tick: world.state.tick,
        agentId: agent.id,
        tier: "strong",
        system: this.system(agent, world),
        user: reflectionPromptText(agent, world, todays),
        schema: reflectionSchema,
        maxTokens: 3000,
        effort: "low",
        mock: () => mockReflection(agent, world, todays),
      },
      validateReflection,
    );
    return res.data ? toReflection(res.data) : undefined;
  }
}

/** Hiba vagy keret esetén: autopilot döntés, 1 órás kötelezettséggel (hogy ne kérdezzünk újra minden tickben). */
export function fallbackDecision(agent: Agent, world: World): DesiredActivity {
  const rng = Rng.fromSeed(`${agent.id}:${world.state.tick}`);
  const d = autopilotDecide({ ...agent, activity: null }, world.state, rng);
  return { ...d, source: "fallback", durationTicks: TICKS_PER_HOUR };
}

/** Visszajátszás: a rögzített bemenetek tickenként. */
export class ReplayInputs implements InputProvider {
  constructor(private byTick: Map<number, ExternalInputs>) {}
  async collect(world: World) {
    return this.byTick.get(world.state.tick) ?? {};
  }
}
