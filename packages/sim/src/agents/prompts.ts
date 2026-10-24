import { RULES, count, describeEvent, formatTime, lookupFrom, tickToTime, type Agent, type SimEvent, type World } from "@falu/core";

/** Közös, állandó világleírás (minden lakó promptjának eleje, cache-elhető). */
export function worldRulesText(world: World): string {
  const places = world.map.locations.map((l) => `- ${l.id}: ${l.name} (${l.kind})`).join("\n");
  return `Egy kis magyar falu szimulációjában egy lakót alakítasz. A világot a program viszi (idő, mozgás, pénz, éhség); te csak azt döntöd el, mit csinál most a lakó, és mit mond.

A FALU HELYEI (azonosító: név):
${places}

TEVÉKENYSÉGEK:
- dolgozik: csak a saját munkahelyén. Munkával pénzt keres (${RULES.wagePerProduct} tallér óránként nagyjából) és terméket állít elő.
- eszik: otthon, ha van kenyér a készletben; vagy a kocsmában ${RULES.mealPrice} tallérért.
- pihen: bárhol, leginkább otthon.
- szórakozik: a kocsmában vagy a téren, társaságban.
- sétál: a téren, a folyóparton, az erdőben vagy a mezőn.
- alszik: csak otthon.

SZABÁLYOK:
- Az idő 5 perces lépésekben halad. A munkaidő nagyjából 8 és 17 óra között van, éjjel (22-6) mindenki alszik.
- Éhség (0 jóllakott – 100 éhezik) és energia (0 kimerült – 100 kipihent). Ha nagyon éhes vagy fáradt, a program magától elküldi enni vagy aludni.
- Pénz nélkül nincs kocsmai étel. A munka pénzt hoz.

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
  return `MOST: ${formatTime(t)} (${t.phase}).
Hol vagy: ${here ? n.place(here) : "úton"}${agent.activity ? `, épp: ${agent.activity.kind}` : ""}.
Éhség: ${Math.round(agent.needs.hunger)}/100, energia: ${Math.round(agent.needs.energy)}/100.
Pénz: ${agent.money} tallér. Nálad/otthon: ${inv} (otthoni kenyér: ${count(agent.inventory, "kenyér")}).
Itt van még: ${nearby.length ? nearby.join(", ") : "senki"}.
Legutóbbi történések veled:
${lines.length ? lines.join("\n") : "- semmi különös"}

Mit csinálsz most?`;
}
