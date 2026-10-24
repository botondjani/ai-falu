/**
 * A kezdő lakosság generálása egy LLM-hívással, majd rögzítése seed fájlba.
 * Használat: npm run generate-villagers -- [--count 15] [--theme "..."]
 * API-kulcs nélkül nem ír felül semmit (a beégetett seed fájl marad).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { VILLAGERS, buildVillageMap, type VillagerSeed } from "@falu/core";
import { llmConfig, loadDotEnv } from "../config";
import { AnthropicClient } from "../llm/anthropic";
import { LlmGateway } from "../llm/gateway";

const SEED_PATH = fileURLToPath(new URL("../../../core/src/seed/villagers.json", import.meta.url));

/** Munkahely → mit termel (a gazdaság ezt használja). */
const WORKPLACES: Record<string, { produces?: VillagerSeed["produces"]; jobs: string }> = {
  kovacs: { produces: "szerszám", jobs: "kovács, kovácsinas" },
  pekseg: { produces: "kenyér", jobs: "pék, pékinas" },
  mezo: { produces: "gabona", jobs: "földműves" },
  erdo: { produces: "fa", jobs: "favágó (vagy füvesasszony, aki gyógyfüvet szed)" },
  folyo: { produces: "hal", jobs: "halász" },
  kocsma: { jobs: "kocsmáros, zenész" },
  bolt: { jobs: "boltos" },
  ter: { jobs: "bíró, nyugalmazott tanító, egyéb közszereplő" },
};

async function main() {
  loadDotEnv();
  const args = process.argv.slice(2);
  const count = Number(args[args.indexOf("--count") + 1]) || 15;
  const theme = args.includes("--theme") ? args[args.indexOf("--theme") + 1] : "";
  const cfg = llmConfig();
  if (!cfg.apiKey) {
    console.log("Nincs ANTHROPIC_API_KEY – a beégetett seed marad:", SEED_PATH);
    return;
  }

  const map = buildVillageMap();
  const homes = map.locations.filter((l) => l.kind === "ház").map((l) => l.id);
  const workplaces = Object.keys(WORKPLACES);
  const schema = z.object({
    lakok: z.array(
      z.object({
        id: z.string().describe("rövid, ékezet nélküli kisbetűs becenév, pl. 'bela'"),
        nev: z.string(),
        kor: z.number(),
        foglalkozas: z.string(),
        jellemvonasok: z.array(z.string()).describe("2-3 jellemvonás"),
        titkos_vagy: z.string(),
        otthon: z.enum(homes as [string, ...string[]]),
        munkahely: z.enum(workplaces as [string, ...string[]]),
        szin: z.string().describe("hex szín, pl. #c0392b"),
        penz: z.number().describe("kezdő pénz tallérban, 5-100"),
        kapcsolatok: z.array(z.object({ kivel: z.string().describe("másik lakó id-ja"), milyen: z.string() })).describe("1-3 kapcsolat"),
      }),
    ),
  });

  const gateway = new LlmGateway(new AnthropicClient(cfg.apiKey), cfg.models, cfg.budget);
  const res = await gateway.call(
    {
      purpose: "generate-villagers",
      tick: 0,
      tier: "strong",
      system: [{ text: "Egy magyar falusi életszimuláció szereplőit találod ki. Színes, kicsit humoros, hihető karakterek kellenek, egymáshoz kötődő titkokkal és konfliktusokkal." }],
      user: `Készíts ${count} lakót. ${theme}
Otthonok (egy házban 1-2 ember lakjon, családok együtt): ${homes.join(", ")}.
Munkahelyek és illő foglalkozások: ${Object.entries(WORKPLACES).map(([k, v]) => `${k}: ${v.jobs}`).join("; ")}.
Mindenkinek legyen 1-3 kapcsolata a többiekkel (a "kivel" egy másik lakó id-ja), és egy titkos vágya, ami bonyodalmat okozhat. Mindenki felnőtt (18+).`,
      schema,
      maxTokens: 16000,
      effort: "medium",
      mock: () => ({ lakok: [] }),
    },
    (out) => {
      const ids = new Set(out.lakok.map((l) => l.id));
      if (out.lakok.length < 3) return "túl kevés lakó";
      if (ids.size !== out.lakok.length) return "ismétlődő id";
      for (const l of out.lakok) {
        if (l.kor < 18) return `${l.nev} kiskorú`;
        for (const k of l.kapcsolatok) if (!ids.has(k.kivel)) return `ismeretlen kapcsolat: ${k.kivel}`;
      }
      return undefined;
    },
  );
  if (!res.data) throw new Error(`Sikertelen generálás: ${res.error}`);

  const villagers: VillagerSeed[] = res.data.lakok.map((l) => ({
    id: l.id,
    name: l.nev,
    age: Math.round(l.kor),
    occupation: l.foglalkozas,
    traits: l.jellemvonasok.slice(0, 3),
    secretDesire: l.titkos_vagy,
    homeId: l.otthon,
    workplaceId: l.munkahely,
    ...(WORKPLACES[l.munkahely].produces ? { produces: WORKPLACES[l.munkahely].produces } : {}),
    color: /^#[0-9a-f]{6}$/i.test(l.szin) ? l.szin : "#888888",
    relationships: l.kapcsolatok.map((k) => ({ with: k.kivel, kind: k.milyen })),
    money: Math.max(5, Math.min(100, Math.round(l.penz))),
    inventory: { kenyér: 2 },
  }));
  writeFileSync(SEED_PATH, JSON.stringify(villagers, null, 2) + "\n");
  console.log(`${villagers.length} lakó mentve: ${SEED_PATH} (korábban: ${VILLAGERS.length}). Költség: $${gateway.stats.usd.toFixed(4)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
