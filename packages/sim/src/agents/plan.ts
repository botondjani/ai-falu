import { z } from "zod";
import { Rng, type Agent, type DayPlan, type PlanItem, type World } from "@falu/core";
import { ACTIVITY_KINDS, checkActivity } from "./decision";

export function planSchema(locationIds: string[]) {
  return z.object({
    napi_cel: z.string().describe("A nap fő célja egy rövid mondatban, a lakó jelleméből fakadóan."),
    lepesek: z
      .array(
        z.object({
          tol_ora: z.number().describe("kezdő óra, 6–21"),
          ig_ora: z.number().describe("záró óra, 7–22"),
          cselekves: z.enum(ACTIVITY_KINDS),
          helyszin: z.enum(locationIds as [string, ...string[]]),
          cel: z.string().describe("mit akar elérni ebben a lépésben"),
        }),
      )
      .describe("3–7 időrendi, át nem fedő lépés 6 és 22 óra között"),
  });
}
export type PlanOutput = z.infer<ReturnType<typeof planSchema>>;

/** Érvényes, időrendi, át nem fedő tervvé alakít; érvénytelen lépéseket eldob. */
export function toDayPlan(p: PlanOutput, agent: Agent, day: number): { plan: DayPlan; dropped: string[] } {
  const dropped: string[] = [];
  const items: PlanItem[] = [];
  const sorted = [...p.lepesek].sort((a, b) => a.tol_ora - b.tol_ora);
  let lastEnd = 6;
  for (const s of sorted) {
    const from = Math.max(6, Math.round(s.tol_ora));
    const to = Math.min(22, Math.round(s.ig_ora));
    if (to <= from) {
      dropped.push(`${s.tol_ora}-${s.ig_ora}: rossz időköz`);
      continue;
    }
    if (from < lastEnd) {
      dropped.push(`${from}-${to}: átfedés`);
      continue;
    }
    const err = checkActivity(s.cselekves, s.helyszin, agent, { planning: true });
    if (err) {
      dropped.push(`${from}-${to}: ${err}`);
      continue;
    }
    items.push({ fromHour: from, toHour: to, kind: s.cselekves, locationId: s.helyszin, goal: s.cel.slice(0, 120) });
    lastEnd = to;
  }
  return { plan: { day, goal: p.napi_cel.slice(0, 160), items }, dropped };
}

/** Determinisztikus, foglalkozáshoz és jellemhez illő mock terv. */
export function mockPlan(agent: Agent, world: World, day: number): PlanOutput {
  const rng = Rng.fromSeed(`plan:${agent.id}:${day}`);
  const lazy = agent.traits.some((t) => /lusta|kényelmes/.test(t));
  const social = agent.traits.some((t) => /pletykás|vicces|barátságos|kedves/.test(t));
  const goals = [
    `Ma jól megdolgozom, hogy közelebb kerüljek a célomhoz.`,
    `Kiderítem, mi újság a faluban.`,
    `Ma kicsit magamra is gondolok.`,
    `Félreteszek egy kis pénzt.`,
  ];
  const workStart = lazy ? rng.pick([9, 10]) : 8;
  const steps: PlanOutput["lepesek"] = [
    { tol_ora: 6, ig_ora: workStart, cselekves: "pihen", helyszin: agent.homeId, cel: "kényelmes reggel" },
    { tol_ora: workStart, ig_ora: 12, cselekves: "dolgozik", helyszin: agent.workplaceId, cel: "délelőtti munka" },
    { tol_ora: 12, ig_ora: 13, cselekves: "sétál", helyszin: "ter", cel: "kis szünet a téren" },
    { tol_ora: 13, ig_ora: lazy ? 16 : 17, cselekves: "dolgozik", helyszin: agent.workplaceId, cel: "délutáni munka" },
    {
      tol_ora: 18,
      ig_ora: 22,
      cselekves: "szórakozik",
      helyszin: social || rng.chance(0.5) ? "kocsma" : "ter",
      cel: social ? "meghallgatni a pletykákat" : "egy kis társaság",
    },
  ];
  void world;
  return { napi_cel: rng.pick(goals), lepesek: steps };
}
