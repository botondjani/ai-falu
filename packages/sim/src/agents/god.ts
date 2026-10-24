import { z } from "zod";
import { Rng, type GodEffect, type GodEvent, type Item, type World } from "@falu/core";

const ITEMS = ["kenyér", "gabona", "fa", "szerszám", "hal", "gyógyfű"] as const satisfies readonly Item[];

export function godSchema(agentIds: string[], locationIds: string[]) {
  return z.object({
    leiras: z.string().describe("Mi történik a faluban, 1–2 élő mondatban (ezt hallják a lakók)."),
    erintettek: z.array(z.enum(agentIds as [string, ...string[]])).describe("Az érintett lakók; üres lista = mindenki."),
    fontossag: z.number().describe("1–10"),
    haza_orak: z.number().describe("Hány órára menekül haza mindenki érintett (0, ha nem kell)."),
    gyules_hely: z.enum(["nincs", ...locationIds] as [string, ...string[]]).describe("Hová gyűlnek össze (vagy 'nincs')."),
    gyules_orak: z.number().describe("Hány órára gyűlnek össze (0, ha nem)."),
    keszlet: z
      .array(z.object({ hely: z.enum(["bolt", "kocsma"]), targy: z.enum(ITEMS), valtozas: z.number().describe("-50..50") }))
      .describe("Készletváltozások (pl. a vihar elveri a gabonát); üres, ha nincs."),
    penz: z.array(z.object({ lako: z.enum(agentIds as [string, ...string[]]), valtozas: z.number().describe("-100..100") })),
    hangulat: z.string().describe("Az érintettek új hangulata egy-két szóban, vagy üres."),
    idegen: z.object({
      van: z.boolean().describe("Érkezik-e új ember a faluba"),
      id: z.string().describe("rövid, ékezet nélküli kisbetűs azonosító"),
      nev: z.string(),
      kor: z.number(),
      foglalkozas: z.string(),
      jellem: z.array(z.string()),
      titkos_vagy: z.string(),
    }),
  });
}
export type GodOutput = z.infer<ReturnType<typeof godSchema>>;

export const GOD_STYLE = `A felhasználó "Isten-módban" egy eseményt dob be a faluba. Fordítsd le a szöveget a szimuláció mechanikus hatásaira.
- Csak azt a hatást használd, ami illik a szöveghez; a többi legyen 0, üres vagy "nincs".
- Vihar, veszély: haza_orak. Ünnep, gyűlés, bejelentés: gyules_hely + gyules_orak. Kár, ajándék, lelet: keszlet / penz.
- Ha új ember érkezik (idegen, vándor, rokon), töltsd ki az idegen mezőit: felnőtt, színes, egy titkos szándékkal.
- A leírás legyen konkrét, élő, és illeszkedjen a falu világába.`;

export function toGodEvent(o: GodOutput, text: string): GodEvent {
  const effects: GodEffect[] = [];
  if (o.haza_orak > 0) effects.push({ type: "haza", hours: o.haza_orak });
  if (o.gyules_hely !== "nincs" && o.gyules_orak > 0) effects.push({ type: "gyules", locationId: o.gyules_hely, hours: o.gyules_orak });
  for (const k of o.keszlet) if (k.valtozas !== 0) effects.push({ type: "keszlet", locationId: k.hely, item: k.targy, delta: k.valtozas });
  for (const p of o.penz) if (p.valtozas !== 0) effects.push({ type: "penz", agentId: p.lako, delta: p.valtozas });
  if (o.hangulat.trim()) effects.push({ type: "hangulat", mood: o.hangulat.trim() });
  if (o.idegen.van) {
    const id = o.idegen.id.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 16) || "idegen";
    effects.push({
      type: "idegen",
      villager: {
        id,
        name: o.idegen.nev.slice(0, 40),
        age: Math.max(18, Math.round(o.idegen.kor)),
        occupation: o.idegen.foglalkozas.slice(0, 40),
        traits: o.idegen.jellem.slice(0, 3),
        secretDesire: o.idegen.titkos_vagy.slice(0, 200),
        homeId: "kocsma", // a kocsmában száll meg
        workplaceId: "ter",
        color: "#d4af37",
        money: 30,
        inventory: { kenyér: 2 },
      },
    });
  }
  return {
    text,
    description: o.leiras.trim().slice(0, 300),
    affected: o.erintettek,
    importance: Math.max(1, Math.min(10, Math.round(o.fontossag))),
    effects,
  };
}

export function validateGod(o: GodOutput, world: World): string | undefined {
  if (o.leiras.trim().length < 5) return "üres leírás";
  if (o.idegen.van) {
    if (!o.idegen.nev.trim()) return "az idegennek kell név";
    if (o.idegen.kor < 18) return "az idegen legyen felnőtt";
    const id = o.idegen.id.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (world.state.agents.some((a) => a.id === id)) return `már van ilyen azonosító: ${id}`;
  }
  return undefined;
}

const STRANGERS = [
  { id: "vandor", nev: "Vándor Viktor", foglalkozas: "vándorköszörűs", jellem: ["titokzatos", "bőbeszédű"], titkos_vagy: "Egy régi adósságot jött behajtani valakin a faluban." },
  { id: "rozika", nev: "Ruzsa Rozina", foglalkozas: "jósnő", jellem: ["rejtélyes", "ravasz"], titkos_vagy: "Gazdag férjet keres magának." },
  { id: "bence", nev: "Bakó Bence", foglalkozas: "városi írnok", jellem: ["nagyképű", "kíváncsi"], titkos_vagy: "A vármegye küldte, hogy kémkedjen a bíró után." },
];

/** Kulcsszó-alapú mock értelmezés (API nélkül). */
export function mockGod(text: string, world: World): GodOutput {
  const t = text.toLowerCase();
  const rng = Rng.fromSeed(`god:${text}:${world.state.tick}`);
  const out: GodOutput = {
    leiras: text.trim().replace(/\.?$/, "."),
    erintettek: [],
    fontossag: 8,
    haza_orak: 0,
    gyules_hely: "nincs",
    gyules_orak: 0,
    keszlet: [],
    penz: [],
    hangulat: "",
    idegen: { van: false, id: "", nev: "", kor: 30, foglalkozas: "", jellem: [], titkos_vagy: "" },
  };
  if (/vihar|eső|jég|árvíz|szél|villám/.test(t)) {
    out.leiras = `Fekete felhők gyűlnek, és ${/árvíz/.test(t) ? "kiönt a folyó" : "hatalmas vihar csap le a falura"}. Mindenki fedezéket keres.`;
    out.haza_orak = 3;
    out.keszlet = [{ hely: "bolt", targy: "gabona", valtozas: -5 }];
    out.hangulat = "nyugtalan";
  }
  if (/idegen|vándor|érkez|jövevény|utazó/.test(t)) {
    const s = STRANGERS.find((x) => !world.state.agents.some((a) => a.id === x.id)) ?? { ...STRANGERS[0], id: `idegen${world.state.tick}` };
    out.leiras = `Poros úton egy idegen érkezik a faluba: ${s.nev}, ${s.foglalkozas}. A kocsmában száll meg.`;
    out.idegen = { van: true, id: s.id, nev: s.nev, kor: rng.int(25, 60), foglalkozas: s.foglalkozas, jellem: s.jellem, titkos_vagy: s.titkos_vagy };
    out.hangulat = "kíváncsi";
  }
  if (/ünnep|bál|lakodalom|vásár|búcsú|gyűlés|bejelent/.test(t)) {
    out.leiras = `${text.trim().replace(/\.?$/, ".")} Az egész falu összegyűlik a téren.`;
    out.gyules_hely = "ter";
    out.gyules_orak = 3;
    out.hangulat = "vidám";
  }
  if (/kincs|pénz|örökség|aranyat/.test(t)) {
    const lucky = rng.pick(world.state.agents);
    out.penz = [{ lako: lucky.id, valtozas: 50 }];
    out.leiras = `${text.trim().replace(/\.?$/, ".")} A szerencsés: ${lucky.name}.`;
  }
  if (/tűz|leég|lángok/.test(t)) {
    out.leiras = "Tűz üt ki a boltban! A falu összefut oltani, de a készlet egy része odavész.";
    out.keszlet = [
      { hely: "bolt", targy: "kenyér", valtozas: -6 },
      { hely: "bolt", targy: "fa", valtozas: -6 },
    ];
    out.gyules_hely = "bolt";
    out.gyules_orak = 1;
    out.hangulat = "megrémült";
  }
  return out;
}

