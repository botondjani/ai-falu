import { z } from "zod";
import {
  MAX_DELTA,
  Rng,
  getRelation,
  knownGossip,
  lookupFrom,
  retrieve,
  formatTime,
  tickToTime,
  type Agent,
  type Conversation,
  type Sentiment,
  type World,
} from "@falu/core";
import { memoryLines } from "./prompts";

export function conversationSchema(a: Agent, b: Agent, agentIds: string[]) {
  const delta = z.object({
    bizalom: z.number().describe(`-${MAX_DELTA}..${MAX_DELTA}`),
    szimpatia: z.number().describe(`-${MAX_DELTA}..${MAX_DELTA}`),
  });
  return z.object({
    tema: z.string().describe("A beszélgetés témája 2-5 szóban."),
    replikak: z
      .array(z.object({ beszelo: z.enum([a.id, b.id]), szoveg: z.string() }))
      .describe("4-6 rövid, felváltva elhangzó replika"),
    emlek_a: z.string().describe(`Mit jegyez meg ${a.name} ebből, egy mondat, egyes szám első személyben.`),
    emlek_b: z.string().describe(`Mit jegyez meg ${b.name} ebből, egy mondat, egyes szám első személyben.`),
    valtozas_a: delta.describe(`Mennyit változik ${a.name} véleménye – ${b.name}`),
    valtozas_b: delta.describe(`Mennyit változik ${b.name} véleménye – ${a.name}`),
    pletyka: z.object({
      van: z.boolean().describe("Elhangzott-e pletyka egy harmadik lakóról"),
      mondja: z.enum([a.id, b.id]),
      kirol: z.enum(agentIds as [string, ...string[]]),
      szoveg: z.string().describe("A pletyka egy mondatban (üres, ha nincs)"),
      elojel: z.enum(["jó", "rossz", "semleges"]),
      ismert_id: z.number().describe("Ha egy már ismert pletykát ad tovább, annak azonosítója, különben 0"),
    }),
  });
}
export type ConversationOutput = z.infer<ReturnType<typeof conversationSchema>>;

export function validateConversation(o: ConversationOutput, a: Agent, b: Agent, world: World): string | undefined {
  if (o.replikak.length < 2 || o.replikak.length > 8) return "2–8 replika kell";
  const speakers = new Set(o.replikak.map((r) => r.beszelo));
  if (!speakers.has(a.id) || !speakers.has(b.id)) return "mindkét félnek meg kell szólalnia";
  if (o.replikak.some((r) => !r.szoveg.trim())) return "üres replika";
  if (o.pletyka.van) {
    const listener = o.pletyka.mondja === a.id ? b.id : a.id;
    if (o.pletyka.kirol === listener || o.pletyka.kirol === o.pletyka.mondja) return "a pletyka harmadik személyről szóljon";
    if (!o.pletyka.szoveg.trim()) return "üres pletyka";
    if (o.pletyka.ismert_id > 0 && !knownGossip(world.state, o.pletyka.mondja).some((g) => g.id === o.pletyka.ismert_id))
      return `a(z) ${o.pletyka.ismert_id}. pletykát a mondó nem ismeri`;
  }
  return undefined;
}

export function toConversation(o: ConversationOutput, a: Agent, b: Agent): Conversation {
  const d = (x: { bizalom: number; szimpatia: number }) => ({ trust: Math.round(x.bizalom), liking: Math.round(x.szimpatia) });
  return {
    a: a.id,
    b: b.id,
    topic: o.tema.slice(0, 60),
    lines: o.replikak.slice(0, 6).map((r) => ({ speaker: r.beszelo, text: r.szoveg.trim().slice(0, 160) })),
    memoryA: o.emlek_a.slice(0, 200),
    memoryB: o.emlek_b.slice(0, 200),
    deltaA: d(o.valtozas_a),
    deltaB: d(o.valtozas_b),
    ...(o.pletyka.van
      ? {
          gossip: {
            teller: o.pletyka.mondja,
            aboutId: o.pletyka.kirol,
            text: o.pletyka.szoveg.trim().slice(0, 200),
            sentiment: o.pletyka.elojel,
            ...(o.pletyka.ismert_id > 0 ? { gossipId: o.pletyka.ismert_id } : {}),
          },
        }
      : {}),
  };
}

export const CONVERSATION_INSTRUCTIONS = `Most két lakó között egy rövid, élő párbeszédet írsz meg.
- 4–6 rövid replika felváltva, köznapi, ízes magyar nyelven, mindkét fél a saját jellemén keresztül beszél.
- A titkos vágyak csak áttételesen, célzásokban jelenhetnek meg.
- A vélemények (bizalom, szimpátia) csak annyit változzanak, amennyit a párbeszéd indokol (általában -5..+5, nagy fordulatnál több).
- Ha természetes, az egyik fél pletykálhat egy harmadik lakóról (amit hallott vagy látott). A már ismert pletykát az azonosítójával add tovább.`;

function personaShort(x: Agent) {
  return `${x.name} (${x.id}), ${x.age} éves ${x.occupation}; jellem: ${x.traits.join(", ")}; titkos vágy: ${x.secretDesire}${x.mood ? `; hangulat: ${x.mood}` : ""}`;
}

export function conversationPromptText(a: Agent, b: Agent, world: World): string {
  const n = lookupFrom(world.state.agents, world.map.locations);
  const t = tickToTime(world.state.tick);
  const view = (x: Agent, y: Agent) => {
    const r = getRelation(world.state, x.id, y.id);
    const ms = retrieve(world.state, x.id, y.name, 4);
    const gossip = knownGossip(world.state, x.id)
      .filter((g) => g.aboutId !== y.id)
      .slice(-4)
      .map((g) => `  #${g.id} ${n.agent(g.aboutId)} kapcsán: ${g.text}`);
    return `${x.name} véleménye – ${y.name}: bizalom ${r.trust}, szimpátia ${r.liking} (-100..100).
${x.name} emlékei:
${memoryLines(ms)}
${x.name} által ismert pletykák:
${gossip.length ? gossip.join("\n") : "  nincs"}`;
  };
  const others = world.state.agents.filter((x) => x.id !== a.id && x.id !== b.id).map((x) => `${x.id}: ${x.name}, ${x.occupation}`);
  return `${CONVERSATION_INSTRUCTIONS}

HELYZET: ${formatTime(t)}, ${n.place(a.activity?.locationId ?? "")}.
A) ${personaShort(a)}
B) ${personaShort(b)}

${view(a, b)}

${view(b, a)}

A falu többi lakója (pletykához): ${others.join("; ")}.`;
}

const OPENERS = ["Na, mi újság?", "Jó napot! Hogy s mint?", "Hát te is itt?", "Régen láttalak!"];
const SMALLTALK = [
  "Megvagyok, csak sok a munka.",
  "Az idő bezzeg szép, csak a derekam fáj.",
  "Hallottad, mi van a faluban?",
  "Ne is mondd, egész nap talpon voltam.",
  "Mostanában semmi se megy úgy, ahogy kéne.",
];
const CLOSERS = ["Na, megyek is, majd beszélünk.", "Vigyázz magadra!", "Ezt még megbeszéljük.", "Jól van, jól van."];

/** Determinisztikus mock párbeszéd a kapcsolat és az ismert pletykák alapján. */
export function mockConversation(a: Agent, b: Agent, world: World): ConversationOutput {
  const rng = Rng.fromSeed(`talk:${a.id}:${b.id}:${world.state.tick}`);
  const rel = getRelation(world.state, a.id, b.id);
  const friendly = rel.liking >= 0;
  const lines = [
    { beszelo: a.id, szoveg: rng.pick(OPENERS) },
    { beszelo: b.id, szoveg: rng.pick(SMALLTALK) },
    { beszelo: a.id, szoveg: friendly ? "Ha kell segítség, szólj nyugodtan." : "Hát, mindenki a maga baját nyögi." },
    { beszelo: b.id, szoveg: rng.pick(CLOSERS) },
  ];
  const d = () => ({ bizalom: rng.int(-2, 4) * (friendly ? 1 : -1), szimpatia: rng.int(-2, 5) * (friendly ? 1 : -1) });

  let pletyka: ConversationOutput["pletyka"] = { van: false, mondja: a.id, kirol: a.id, szoveg: "", elojel: "semleges", ismert_id: 0 };
  if (rng.chance(0.35)) {
    const teller = rng.chance(0.5) ? a : b;
    const listener = teller === a ? b : a;
    const known = knownGossip(world.state, teller.id).filter((g) => g.aboutId !== listener.id && !g.knownBy.includes(listener.id));
    if (known.length > 0) {
      const g = rng.pick(known);
      pletyka = { van: true, mondja: teller.id, kirol: g.aboutId, szoveg: g.text, elojel: g.sentiment, ismert_id: g.id };
    } else {
      const subjects = world.state.agents.filter((x) => x.id !== a.id && x.id !== b.id);
      const s = rng.pick(subjects);
      const [text, elojel] = rng.pick<[string, Sentiment]>([
        [`${s.name} mostanában sokat jár a kocsmába.`, "rossz"],
        [`${s.name} állítólag pénzt gyűjt valamire.`, "semleges"],
        [`${s.name} segített valakinek a minap, jó szíve van.`, "jó"],
        [`${s.name} titkol valamit, láttam, ahogy sutyorog.`, "rossz"],
      ]);
      pletyka = { van: true, mondja: teller.id, kirol: s.id, szoveg: text, elojel, ismert_id: 0 };
    }
    lines.splice(2, 0, { beszelo: teller.id, szoveg: `Mondok valamit, de köztünk marad: ${pletyka.szoveg}` });
  }
  return {
    tema: pletyka.van ? "falusi pletyka" : rng.pick(["az időjárás", "a munka", "a falu dolgai", "a család"]),
    replikak: lines,
    emlek_a: friendly ? "Kedves volt, jólesett a beszélgetés." : "Elég hűvösen beszélt velem.",
    emlek_b: "Megszólított, elbeszélgettünk.",
    valtozas_a: d(),
    valtozas_b: d(),
    pletyka,
  };
}
