import { z } from "zod";
import { Rng, formatTime, lookupFrom, tickToTime, type SimEvent, type World } from "@falu/core";
import { worldRulesText } from "../agents/prompts";
import type { LlmGateway } from "../llm/gateway";
import { extractFacts, factLines, topFacts, type Fact } from "./facts";

export interface Highlight {
  title: string;
  text: string;
  tick: number;
}

export interface Summary {
  fromTick: number;
  toTick: number;
  story: string;
  highlights: Highlight[];
  mock: boolean;
  /** Nem történt semmi említésre méltó. */
  empty?: boolean;
}

export const summarySchema = z.object({
  tortenet: z.string().describe("5–10 mondatos, színes, kicsit humoros, magyar nyelvű elbeszélés"),
  kiemelt: z
    .array(
      z.object({
        sorszam: z.number().describe("a tény sorszáma a listából"),
        cim: z.string().describe("rövid, csattanós cím (max 6 szó)"),
        miert: z.string().describe("egy mondat: miért fontos"),
      }),
    )
    .describe("a 3 legfontosabb esemény"),
});
type SummaryOutput = z.infer<typeof summarySchema>;

const STYLE = `Te vagy a falu krónikása. A felhasználó egy ideig nem figyelte a falut, most elmeséled neki, mi történt.
- 5–10 mondat, történetszerűen, időrendben, színesen és kicsit humorosan, de csak a megadott tények alapján: semmit ne találj ki, ami nem következik belőlük.
- Nevezd meg a szereplőket, és emeld ki a fordulatokat (pletykák, összezördülések, barátságok, gazdasági változások).
- Válaszd ki a 3 legfontosabb eseményt a listából (sorszámmal), mindegyikhez egy csattanós címet és egy mondatot, hogy miért fontos.`;

function span(fromTick: number, toTick: number) {
  return `${formatTime(tickToTime(fromTick))} – ${formatTime(tickToTime(toTick))}`;
}

/** "Amíg nem néztél oda": tények kinyerése, majd elbeszélés generálása. Hibánál sablonos változat. */
export async function summarize(
  world: World,
  events: SimEvent[],
  fromTick: number,
  toTick: number,
  gateway?: LlmGateway,
): Promise<Summary> {
  const n = lookupFrom(world.state.agents, world.map.locations);
  const facts = topFacts(extractFacts(events, n), 25);
  if (facts.length === 0) return { fromTick, toTick, story: "Csend volt a faluban. Mindenki tette a dolgát, senki nem lopta el a harangot.", highlights: [], mock: true, empty: true };

  const mockOut = () => mockSummary(facts, fromTick, toTick);
  if (gateway) {
    try {
      const res = await gateway.call(
        {
          purpose: "summary",
          tick: toTick,
          tier: "strong",
          system: [{ text: worldRulesText(world) }, { text: STYLE, cache: true }],
          user: `Időszak: ${span(fromTick, toTick)}.\nA fontos tények (sorszámmal):\n${factLines(facts)}`,
          schema: summarySchema,
          maxTokens: 4000,
          effort: "medium",
          mock: mockOut,
        },
        (o) => {
          if (o.tortenet.trim().length < 40) return "túl rövid történet";
          if (o.kiemelt.length !== 3) return "pontosan 3 kiemelt esemény kell";
          if (o.kiemelt.some((k) => k.sorszam < 1 || k.sorszam > facts.length)) return "érvénytelen sorszám";
          return undefined;
        },
      );
      if (res.data) return toSummary(res.data, facts, fromTick, toTick, gateway.mock);
    } catch {
      // keret vagy hiba: sablonos összefoglaló
    }
  }
  return toSummary(mockOut(), facts, fromTick, toTick, true);
}

function toSummary(o: SummaryOutput, facts: Fact[], fromTick: number, toTick: number, mock: boolean): Summary {
  return {
    fromTick,
    toTick,
    story: o.tortenet.trim(),
    highlights: o.kiemelt.slice(0, 3).map((k) => {
      const f = facts[Math.round(k.sorszam) - 1];
      return { title: k.cim.trim(), text: k.miert.trim() || f.text, tick: f.tick };
    }),
    mock,
  };
}

const OPENERS = [
  "Amíg nem figyeltél, a falu bizony nem unatkozott.",
  "Na, ülj le, mert lesz mit mesélni.",
  "Ha azt hitted, egy kis faluban nem történik semmi, hát tévedtél.",
];
const LINKS = ["Közben:", "Eközben:", "Nem sokkal később:", "Ráadásul:", "Mintha ez nem lett volna elég:"];
const CLOSERS = [
  "A kocsmában persze már mindenki erről beszél.",
  "Teri néni állítólag mindent feljegyzett a krónikájába.",
  "A falu kutyái mindent láttak, de hallgatnak.",
];

/** Sablonos, determinisztikus összefoglaló (mock mód és tartalék). */
export function mockSummary(facts: Fact[], fromTick: number, toTick: number): SummaryOutput {
  const rng = Rng.fromSeed(`summary:${fromTick}:${toTick}`);
  const chosen = topFacts(facts, 6);
  const sentences = [rng.pick(OPENERS)];
  const links = [...LINKS].sort(() => rng.next() - 0.5);
  chosen.forEach((f, i) => sentences.push(`${i === 0 ? "" : links[(i - 1) % links.length] + " "}${f.text}`.replace(/([^.!?”])$/, "$1.")));
  sentences.push(rng.pick(CLOSERS));
  // a 3 kiemelés lehetőleg különböző fajta esemény legyen
  const ranked = facts.map((f, i) => ({ f, i })).sort((a, b) => b.f.importance - a.f.importance || a.i - b.i);
  const top3: typeof ranked = [];
  for (const x of ranked) if (top3.length < 3 && !top3.some((y) => y.f.kind === x.f.kind)) top3.push(x);
  for (const x of ranked) if (top3.length < 3 && !top3.includes(x)) top3.push(x);
  return {
    tortenet: sentences.join(" "),
    kiemelt: top3.map(({ f, i }) => ({
      sorszam: i + 1,
      cim: f.text.split(/[,;:(]/)[0].split(" ").slice(0, 6).join(" "),
      miert: f.text,
    })),
  };
}
