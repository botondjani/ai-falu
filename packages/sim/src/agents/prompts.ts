import {
  count,
  currentPrices,
  currentPlanItem,
  mealPrice,
  describeEvent,
  formatTime,
  lookupFrom,
  retrieve,
  tickToTime,
  type Agent,
  type Memory,
  type SimEvent,
  type World,
} from "@falu/core";

/** Közös, állandó világleírás (minden lakó promptjának eleje, cache-elhető). */
export function worldRulesText(world: World): string {
  const places = world.map.locations.map((l) => `- ${l.id}: ${l.name} (${l.kind})`).join("\n");
  return `Egy kis magyar falu szimulációjában egy lakót alakítasz. A világot a program viszi (idő, mozgás, pénz, éhség); te csak azt döntöd el, mit csinál most a lakó, és mit mond.

A FALU HELYEI (azonosító: név):
${places}

TEVÉKENYSÉGEK:
- dolgozik: csak a saját munkahelyén. A termelők (gabona, fa, hal, gyógyfű, kenyér, szerszám) óránként termelnek, a fölösleget eladják a boltnak; a pék gabonából, a kovács fából dolgozik. A bolt a haszonból, a kocsma az ételből él, a többiek órabért kapnak.
- vásárol: a boltban (bolt) kenyeret vesz haza.
- eszik: otthon, ha van kenyér vagy hal; vagy a kocsmában (a kenyér boltbeli ára + 3 tallérért), ha van ott étel.
- pihen: bárhol, leginkább otthon.
- szórakozik: a kocsmában vagy a téren, társaságban.
- sétál: a téren, a folyóparton, az erdőben vagy a mezőn.
- alszik: csak otthon.

SZABÁLYOK:
- Az idő 5 perces lépésekben halad. A munkaidő nagyjából 8 és 17 óra között van, éjjel (22-6) mindenki alszik.
- Éhség (0 jóllakott – 100 éhezik) és energia (0 kimerült – 100 kipihent). Ha nagyon éhes vagy fáradt, a program magától elküldi enni vagy aludni.
- Pénz nélkül nincs étel. A munka pénzt hoz.
- GAZDASÁG: a bolt árai a készlettől függnek: ha kevés van valamiből, drágább, ha sok, olcsóbb. A bolt csak addig vásárol fel, amíg van rá pénze és helye.

A VÁLASZOD:
- Válassz egy tevékenységet és helyszínt, és hogy hány percig tartson (15–240).
- "gondolat": a lakó egy mondatos belső indoklása, a saját jellemén keresztül.
- "mondja": amit hangosan mond (rövid, élő, jellemhű magyar mondat), vagy üres szöveg, ha hallgat.
- Légy következetes a jellemmel és a titkos vággyal, de ne mondd ki a titkot nyíltan.`;
}

/** A lakó állandó személyleírása (a cache-elt prefix második fele). */
export function personaText(agent: Agent, world: World): string {
  const n = lookupFrom(world.state.agents, world.map.locations);
  const rel = (agent.relationships ?? []).map((r) => `${n.agent(r.with)} (${r.kind})`).join(", ") || "nincs különösebb";
  return `A LAKÓ, AKIT ALAKÍTASZ:
Név: ${agent.name}, ${agent.age} éves ${agent.occupation}.
Jellem: ${agent.traits.join(", ")}.
Titkos vágy: ${agent.secretDesire}
Kapcsolatok: ${rel}.
Otthon: ${n.place(agent.homeId)} (${agent.homeId}). Munkahely: ${n.place(agent.workplaceId)} (${agent.workplaceId}).`;
}

/** A pillanatnyi helyzet (változó rész, a cache után). */
export function situationText(agent: Agent, world: World, recent: SimEvent[]): string {
  const n = lookupFrom(world.state.agents, world.map.locations);
  const t = tickToTime(world.state.tick);
  const here = agent.activity?.locationId;
  const nearby = world.state.agents
    .filter((o) => o.id !== agent.id && here && o.activity?.locationId === here)
    .map((o) => `${o.name} (${o.activity?.kind})`);
  const inv = Object.entries(agent.inventory).map(([k, v]) => `${k} ×${v}`).join(", ") || "semmi";
  const lines = recent.map((e) => `- ${formatTime(tickToTime(e.tick))}: ${describeEvent(e, n)}`);
  const query = [here ? n.place(here) : "", ...nearby, agent.activity?.kind ?? ""].join(" ");
  const memories = retrieve(world.state, agent.id, query, 5);
  const item = currentPlanItem(agent, t.hour, t.day);
  const plan = agent.plan?.day === t.day ? `Mai célod: ${agent.plan.goal}${item ? ` Most a terv szerint: ${item.kind} (${n.place(item.locationId)}) – ${item.goal}.` : ""}` : "Nincs mai terved.";
  return `MOST: ${formatTime(t)} (${t.phase}).${agent.mood ? ` Hangulatod: ${agent.mood}.` : ""}
${plan}${agent.surprised ? "\nValami váratlan történt, lehet, hogy el kell térned a tervtől." : ""}
Hol vagy: ${here ? n.place(here) : "úton"}${agent.activity ? `, épp: ${agent.activity.kind}` : ""}.
Éhség: ${Math.round(agent.needs.hunger)}/100, energia: ${Math.round(agent.needs.energy)}/100.
Pénz: ${agent.money} tallér. Nálad/otthon: ${inv}.
Árak a boltban: ${Object.entries(currentPrices(world.state)).map(([k, v]) => `${k} ${v}`).join(", ")}; kocsmai étel: ${mealPrice(world.state)}.
Itt van még: ${nearby.length ? nearby.join(", ") : "senki"}.
Legutóbbi történések veled:
${lines.length ? lines.join("\n") : "- semmi különös"}
Ami eszedbe jut:
${memoryLines(memories)}

Mit csinálsz most?`;
}

export function memoryLines(ms: Memory[]): string {
  if (ms.length === 0) return "- semmi különös";
  return ms.map((m) => `- [${m.kind}, ${formatTime(tickToTime(m.tick))}] ${m.text}`).join("\n");
}

export function planPromptText(agent: Agent, world: World): string {
  const t = tickToTime(world.state.tick);
  const ms = retrieve(world.state, agent.id, `${agent.occupation} ${agent.secretDesire}`, 8);
  return `${t.day}. nap reggele van (${formatTime(t)}).${agent.mood ? ` Tegnap este így érezted magad: ${agent.mood}.` : ""}
Pénz: ${agent.money} tallér, otthoni kenyér: ${count(agent.inventory, "kenyér")}.
Legfontosabb emlékeid:
${memoryLines(ms)}

Készítsd el a mai tervedet: 3–7 időrendi lépés 6 és 22 óra között (egész órák), és egy mondatos napi célt.
Az evést és az alvást a program magától intézi, azokat nem kell beleírni. A terv tükrözze a jellemedet és a titkos vágyadat.`;
}

export function reflectionPromptText(agent: Agent, world: World, todays: Memory[]): string {
  const t = tickToTime(world.state.tick);
  const important = [...todays].sort((a, b) => b.importance - a.importance || a.tick - b.tick).slice(0, 25);
  important.sort((a, b) => a.tick - b.tick);
  const earlier = world.state.memories.filter((m) => m.agentId === agent.id && m.kind === "reflexió" && !todays.includes(m)).slice(-5);
  return `A ${t.day}. nap estéje van. Ezek történtek veled ma:
${memoryLines(important)}

Korábbi gondolataid:
${memoryLines(earlier)}

Gondold végig a napot: fogalmazz meg 1–3 magasabb szintű tanulságot az emberekről, magadról vagy a faluról (pl. "Béla nem megbízható.", "A kocsmában mindig megtudok valamit."), mindegyikhez fontosságot 1–10 között, és add meg a hangulatodat egy-két szóban.`;
}
