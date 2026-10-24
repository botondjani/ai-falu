import { z } from "zod";
import {
  Rng,
  TICKS_PER_HOUR,
  autopilotDecide,
  count,
  needsDecision,
  tickToTime,
  RULES,
  MINUTES_PER_TICK,
  type ActivityKind,
  type Agent,
  type DesiredActivity,
  type SimEvent,
  type World,
} from "@falu/core";
import { BudgetExceededError, type LlmGateway } from "../llm/gateway";
import type { EventStore } from "../store";
import { personaText, situationText, worldRulesText } from "./prompts";

/** Tickenként a külső döntések (lakó → kívánt tevékenység). */
export interface DecisionProvider {
  decide(world: World): Promise<Record<string, DesiredActivity>>;
  observe?(events: SimEvent[]): void;
}

const KINDS = ["dolgozik", "pihen", "szórakozik", "sétál", "eszik", "alszik"] as const satisfies readonly ActivityKind[];

export function decisionSchema(locationIds: string[]) {
  return z.object({
    gondolat: z.string().describe("A lakó egy mondatos belső indoklása."),
    cselekves: z.enum(KINDS),
    helyszin: z.enum(locationIds as [string, ...string[]]),
    idotartam_perc: z.number().describe("15 és 240 perc között"),
    mondja: z.string().describe("Amit hangosan mond, vagy üres szöveg."),
  });
}
export type Decision = z.infer<ReturnType<typeof decisionSchema>>;

/** Szemantikai ellenőrzés (amit a JSON-séma nem tud kifejezni). Hibaszöveg vagy undefined. */
export function validateDecision(d: Decision, agent: Agent): string | undefined {
  if (d.cselekves === "dolgozik" && d.helyszin !== agent.workplaceId) return `dolgozni csak a munkahelyen (${agent.workplaceId}) lehet`;
  if (d.cselekves === "alszik" && d.helyszin !== agent.homeId) return `aludni csak otthon (${agent.homeId}) lehet`;
  if (d.cselekves === "eszik") {
    if (d.helyszin === agent.homeId && count(agent.inventory, "kenyér") === 0) return "otthon nincs kenyér";
    if (d.helyszin === "kocsma" && agent.money < RULES.mealPrice) return "nincs pénz a kocsmai ételre";
    if (d.helyszin !== agent.homeId && d.helyszin !== "kocsma") return "enni otthon vagy a kocsmában lehet";
  }
  if (!Number.isFinite(d.idotartam_perc)) return "az időtartam nem szám";
  return undefined;
}

export function toDesired(d: Decision): DesiredActivity {
  const minutes = Math.min(240, Math.max(15, Math.round(d.idotartam_perc)));
  return {
    kind: d.cselekves,
    locationId: d.helyszin,
    reason: d.gondolat.slice(0, 200),
    say: d.mondja.trim().slice(0, 200) || undefined,
    durationTicks: Math.round(minutes / MINUTES_PER_TICK),
    source: "llm",
  };
}

export interface LiveDecisionOptions {
  /** Mely lakók döntenek LLM-mel ("all" = mind). */
  llmAgents: Set<string> | "all";
  /** Keret elérésekor: szünet (alap) vagy autopilot. */
  onBudget: "pause" | "autopilot";
}

/** Élő döntések: a döntési ponton álló LLM-lakóknak párhuzamosan kér döntést, és rögzíti a bemenetet. */
export class LiveDecisions implements DecisionProvider {
  private recent = new Map<string, SimEvent[]>();
  budgetPaused?: string;

  constructor(
    private gateway: LlmGateway,
    private opts: LiveDecisionOptions,
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

  async decide(world: World): Promise<Record<string, DesiredActivity>> {
    const due = world.state.agents.filter((a) => this.enabled(a) && needsDecision(a, world.state));
    if (due.length === 0) return {};
    const out: Record<string, DesiredActivity> = {};
    let budgetHit: string | undefined;
    const results = await Promise.all(
      due.map(async (a) => {
        try {
          return [a, await this.decideOne(a, world)] as const;
        } catch (e) {
          if (!(e instanceof BudgetExceededError)) throw e;
          budgetHit = e.message;
          return [a, null] as const;
        }
      }),
    );
    if (budgetHit && this.opts.onBudget === "pause") {
      this.budgetPaused = budgetHit;
      throw new BudgetExceededError(budgetHit);
    }
    for (const [a, d] of results) {
      const desired = d ?? fallback(a, world);
      out[a.id] = desired;
      this.store?.recordInput(this.runId!, world.state.tick, "decision", a.id, desired);
    }
    return out;
  }

  private async decideOne(agent: Agent, world: World): Promise<DesiredActivity> {
    const schema = decisionSchema(world.map.locations.map((l) => l.id));
    const res = await this.gateway.call(
      {
        purpose: "decision",
        tick: world.state.tick,
        agentId: agent.id,
        tier: "routine",
        system: [{ text: worldRulesText(world) }, { text: personaText(agent, world), cache: true }],
        user: situationText(agent, world, this.recent.get(agent.id) ?? []),
        schema,
        maxTokens: 2000,
        effort: "low",
        mock: () => mockDecision(agent, world),
      },
      (d) => validateDecision(d, agent),
    );
    if (res.data) return toDesired(res.data);
    this.gateway.noteFallback();
    return fallback(agent, world);
  }
}

/** Hiba esetén: autopilot döntés, 1 órás kötelezettséggel (hogy ne kérdezzünk újra minden tickben). */
function fallback(agent: Agent, world: World): DesiredActivity {
  const rng = Rng.fromSeed(`${agent.id}:${world.state.tick}`);
  const d = autopilotDecide({ ...agent, activity: null }, world.state, rng);
  return { ...d, source: "fallback", durationTicks: TICKS_PER_HOUR };
}

/** Visszajátszás: a rögzített döntések tickenként. */
export class ReplayDecisions implements DecisionProvider {
  constructor(private byTick: Map<number, Record<string, unknown>>) {}
  async decide(world: World) {
    return (this.byTick.get(world.state.tick) ?? {}) as Record<string, DesiredActivity>;
  }
}

const LINES: Record<(typeof KINDS)[number], string[]> = {
  dolgozik: ["Na, lássunk neki!", "Munka nélkül nincs kalács.", "Ma kétszer annyit csinálok.", ""],
  pihen: ["Egy kis szusszanás nem árt.", "Ráér az még.", ""],
  szórakozik: ["Ki fizeti a következő kört?", "Mi újság a faluban?", "Hallottátok, mi történt?"],
  sétál: ["Szép idő van ma.", "Megnézem, mi van a téren.", ""],
  eszik: ["Korog a gyomrom.", "Egy kis harapnivaló jólesne.", ""],
  alszik: ["Lefekszem korán.", ""],
};

/** Determinisztikus, jellemhez és napszakhoz illő mock döntés (API nélkül). */
export function mockDecision(agent: Agent, world: World): Decision {
  const rng = Rng.fromSeed(`mock:${agent.id}:${world.state.tick}`);
  const { hour } = tickToTime(world.state.tick);
  const lazy = agent.traits.some((t) => /lusta|kényelmes/.test(t));
  const workHours = hour >= RULES.workStartHour && hour < RULES.workEndHour;
  let kind: (typeof KINDS)[number];
  const r = rng.next();
  if (workHours) kind = r < (lazy ? 0.55 : 0.8) ? "dolgozik" : r < 0.9 ? "sétál" : "pihen";
  else if (hour >= 17) kind = r < 0.6 ? "szórakozik" : r < 0.8 ? "sétál" : "pihen";
  else kind = r < 0.5 ? "pihen" : "sétál";
  const loc =
    kind === "dolgozik"
      ? agent.workplaceId
      : kind === "szórakozik"
        ? rng.pick(["kocsma", "kocsma", "ter"])
        : kind === "sétál"
          ? rng.pick(["ter", "folyo", "erdo"])
          : agent.homeId;
  const thoughts: Record<string, string> = {
    dolgozik: lazy ? "Muszáj dolgozni, ha pénzt akarok." : "A munka az első.",
    sétál: "Kell egy kis friss levegő.",
    pihen: "Fáradt vagyok egy kicsit.",
    szórakozik: "Kíváncsi vagyok, ki van ma a kocsmában.",
  };
  return {
    gondolat: thoughts[kind] ?? "Ez most jó ötletnek tűnik.",
    cselekves: kind,
    helyszin: loc,
    idotartam_perc: kind === "dolgozik" ? rng.pick([120, 180, 240]) : rng.pick([30, 45, 60, 90]),
    mondja: rng.pick(LINES[kind]),
  };
}
