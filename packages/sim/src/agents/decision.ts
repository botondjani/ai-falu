import { z } from "zod";
import {
  MINUTES_PER_TICK,
  RULES,
  Rng,
  count,
  tickToTime,
  type ActivityKind,
  type Agent,
  type DesiredActivity,
  type World,
} from "@falu/core";

export const ACTIVITY_KINDS = ["dolgozik", "pihen", "szórakozik", "sétál", "eszik", "alszik"] as const satisfies readonly ActivityKind[];
const KINDS = ACTIVITY_KINDS;

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

/** Tevékenység + helyszín szabályai. Terveknél az aktuális készletet nem nézzük. */
export function checkActivity(kind: ActivityKind, loc: string, agent: Agent, opts: { planning?: boolean } = {}): string | undefined {
  if (kind === "dolgozik" && loc !== agent.workplaceId) return `dolgozni csak a munkahelyen (${agent.workplaceId}) lehet`;
  if (kind === "alszik" && loc !== agent.homeId) return `aludni csak otthon (${agent.homeId}) lehet`;
  if (kind === "eszik") {
    if (loc !== agent.homeId && loc !== "kocsma") return "enni otthon vagy a kocsmában lehet";
    if (opts.planning) return undefined;
    if (loc === agent.homeId && count(agent.inventory, "kenyér") === 0) return "otthon nincs kenyér";
    if (loc === "kocsma" && agent.money < RULES.mealPrice) return "nincs pénz a kocsmai ételre";
  }
  return undefined;
}

/** Szemantikai ellenőrzés (amit a JSON-séma nem tud kifejezni). Hibaszöveg vagy undefined. */
export function validateDecision(d: Decision, agent: Agent): string | undefined {
  if (!Number.isFinite(d.idotartam_perc)) return "az időtartam nem szám";
  return checkActivity(d.cselekves, d.helyszin, agent);
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
