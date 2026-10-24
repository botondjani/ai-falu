import { z } from "zod";
import { Rng, TICKS_PER_DAY, type Agent, type Memory, type Reflection, type World } from "@falu/core";

export const reflectionSchema = z.object({
  tanulsagok: z
    .array(
      z.object({
        szoveg: z.string().describe("Magasabb szintű tanulság, egy mondat, pl. 'Béla nem megbízható.'"),
        fontossag: z.number().describe("1 (hétköznapi) – 10 (életre szóló)"),
      }),
    )
    .describe("1–3 tanulság"),
  hangulat: z.string().describe("A lakó hangulata egy-két szóban."),
});
export type ReflectionOutput = z.infer<typeof reflectionSchema>;

export function validateReflection(r: ReflectionOutput): string | undefined {
  if (r.tanulsagok.length === 0) return "legalább egy tanulság kell";
  if (r.tanulsagok.length > 3) return "legfeljebb 3 tanulság";
  if (!r.hangulat.trim()) return "üres hangulat";
  return undefined;
}

export function toReflection(r: ReflectionOutput): Reflection {
  return {
    insights: r.tanulsagok.map((t) => ({
      text: t.szoveg.trim().slice(0, 200),
      importance: Math.max(1, Math.min(10, Math.round(t.fontossag))),
    })),
    mood: r.hangulat.trim().slice(0, 40),
  };
}

/** Mock reflexió a nap emlékeiből (determinisztikus sablonok). */
export function mockReflection(agent: Agent, world: World, todays: Memory[]): ReflectionOutput {
  const rng = Rng.fromSeed(`refl:${agent.id}:${Math.floor(world.state.tick / TICKS_PER_DAY)}`);
  const met = new Map<string, number>();
  for (const m of todays) {
    for (const o of world.state.agents) if (o.id !== agent.id && m.text.includes(o.name)) met.set(o.name, (met.get(o.name) ?? 0) + 1);
  }
  const top = [...met.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const out: ReflectionOutput["tanulsagok"] = [];
  if (top) out.push({ szoveg: rng.pick([`${top[0]} mostanában sokat van a közelemben.`, `Jó lenne jobban megismerni ${top[0]} szándékait.`]), fontossag: 5 });
  out.push(
    agent.money > 60
      ? { szoveg: "A munka meghozza a gyümölcsét, gyűlik a pénzem.", fontossag: 4 }
      : { szoveg: "Kevés a pénzem, jobban be kell osztanom.", fontossag: 6 },
  );
  const moods = agent.money > 60 ? ["elégedett", "derűs", "magabiztos"] : ["aggódó", "fáradt", "türelmetlen"];
  return { tanulsagok: out, hangulat: rng.pick(moods) };
}
