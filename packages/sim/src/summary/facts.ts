import { describeEvent, formatTime, tickToTime, type NameLookup, type SimEvent } from "@falu/core";

/** Egy összefoglalóba való tény: szöveg + fontosság + idő + érintettek. */
export interface Fact {
  /** Típus (a változatos kiemeléshez). */
  kind: string;
  text: string;
  importance: number;
  tick: number;
  agents: string[];
}

/**
 * Az időszak eseményeiből pontozott tények (determinisztikus, LLM nélkül).
 * Az ismétlődő apróságokat összevonja (pl. éhezés, alapanyaghiány, kapcsolatváltozás egy páron).
 */
export function extractFacts(events: SimEvent[], n: NameLookup): Fact[] {
  const facts: Fact[] = [];
  const pairDelta = new Map<string, { a: string; b: string; sum: number; tick: number; talks: number }>();
  const starving = new Map<string, { count: number; tick: number }>();
  const noInput = new Map<string, { count: number; tick: number; item: string }>();
  const money = new Map<string, number>();
  const gossipReach = new Map<number, { text: string; about: string; teller: string; listeners: Set<string>; tick: number }>();
  let firstPrices: Record<string, number> | undefined;
  let lastPrices: Record<string, number> | undefined;
  let lastPriceTick = 0;
  const addMoney = (id: string, v: number) => money.set(id, (money.get(id) ?? 0) + v);

  for (const e of events) {
    switch (e.type) {
      case "conversation": {
        const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
        const sum = e.deltaA.trust + e.deltaA.liking + e.deltaB.trust + e.deltaB.liking;
        const p = pairDelta.get(key) ?? { a: e.a, b: e.b, sum: 0, tick: e.tick, talks: 0 };
        p.sum += sum;
        p.talks++;
        p.tick = e.tick;
        pairDelta.set(key, p);
        const best = e.lines.reduce((x, l) => (l.text.length > x.text.length ? l : x), e.lines[0]);
        const drama = Math.abs(sum) / 5;
        facts.push({ kind: "conversation",
          text: `${n.agent(e.a)} és ${n.agent(e.b)} beszélgetett (${e.topic}); ${n.agent(best.speaker)}: „${best.text}”`,
          importance: 1.5 + drama,
          tick: e.tick,
          agents: [e.a, e.b],
        });
        break;
      }
      case "gossip": {
        if (!e.fresh) break;
        const g = gossipReach.get(e.gossipId) ?? { text: e.text, about: e.aboutId, teller: e.agentId, listeners: new Set(), tick: e.tick };
        g.listeners.add(e.listenerId);
        g.tick = e.tick;
        gossipReach.set(e.gossipId, g);
        break;
      }
      case "reflected":
        facts.push({ kind: "reflected", text: `${n.agent(e.agentId)} este azon tűnődött (${e.mood}): ${e.insights.join(" ")}`, importance: 3, tick: e.tick, agents: [e.agentId] });
        break;
      case "starving": {
        const s = starving.get(e.agentId) ?? { count: 0, tick: e.tick };
        s.count++;
        starving.set(e.agentId, s);
        break;
      }
      case "no_input": {
        const s = noInput.get(e.agentId) ?? { count: 0, tick: e.tick, item: e.item };
        s.count++;
        noInput.set(e.agentId, s);
        break;
      }
      case "tool_broke":
        facts.push({ kind: "tool_broke", text: describeEvent(e, n), importance: 2, tick: e.tick, agents: [e.agentId] });
        break;
      case "activity_started":
        if (e.source === "llm" && e.say) facts.push({ kind: "activity_started", text: `${describeEvent(e, n)}`, importance: 1, tick: e.tick, agents: [e.agentId] });
        break;
      case "prices":
        firstPrices ??= e.prices as Record<string, number>;
        lastPrices = e.prices as Record<string, number>;
        lastPriceTick = e.tick;
        break;
      case "sold":
        addMoney(e.agentId, e.price);
        break;
      case "bought":
        addMoney(e.agentId, -e.price);
        break;
      case "paid":
        addMoney(e.agentId, -e.amount);
        break;
      case "earned":
        addMoney(e.agentId, e.amount);
        break;
      case "exported":
        addMoney(e.agentId, e.price);
        break;
      case "god_event":
        facts.push({ kind: "god_event", text: `RENDKÍVÜLI ESEMÉNY: ${e.text}`, importance: 9, tick: e.tick, agents: [] });
        break;
      case "whisper":
        facts.push({ kind: "whisper", text: `${n.agent(e.agentId)} fejében egy furcsa gondolat motoszkált: „${e.text}”`, importance: 6, tick: e.tick, agents: [e.agentId] });
        break;
    }
  }

  for (const g of gossipReach.values()) {
    facts.push({ kind: "gossip",
      text: `Pletyka terjedt ${n.agent(g.about)} kapcsán („${g.text}”), ${n.agent(g.teller)} indította el; ${g.listeners.size} emberhez jutott el.`,
      importance: 3 + g.listeners.size,
      tick: g.tick,
      agents: [g.about, g.teller, ...g.listeners],
    });
  }
  for (const p of pairDelta.values()) {
    if (Math.abs(p.sum) < 12) continue;
    facts.push({ kind: "relation",
      text: `${n.agent(p.a)} és ${n.agent(p.b)} viszonya ${p.sum > 0 ? "sokat javult" : "megromlott"} (${p.talks} beszélgetés).`,
      importance: 2 + Math.abs(p.sum) / 6,
      tick: p.tick,
      agents: [p.a, p.b],
    });
  }
  for (const [id, s] of starving) facts.push({ kind: "starving", text: `${n.agent(id)} napokig éhezett, nem volt mit ennie.`, importance: 4 + Math.min(4, s.count / 4), tick: s.tick, agents: [id] });
  for (const [id, s] of noInput)
    if (s.count >= 3) facts.push({ kind: "no_input", text: `${n.agent(id)} hiába ment dolgozni: nem volt ${s.item}.`, importance: 3, tick: s.tick, agents: [id] });
  if (firstPrices && lastPrices) {
    for (const [item, p1] of Object.entries(lastPrices)) {
      const p0 = firstPrices[item];
      if (p0 && Math.abs(p1 - p0) / p0 >= 0.3)
        facts.push({ kind: "price", text: `A(z) ${item} ára ${p1 > p0 ? "felment" : "leesett"}: ${p0} → ${p1} tallér.`, importance: 3.5, tick: lastPriceTick, agents: [] });
    }
  }
  const ranked = [...money.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length > 1) {
    const [w, wv] = ranked[0];
    const [l, lv] = ranked[ranked.length - 1];
    if (wv >= 30) facts.push({ kind: "money", text: `${n.agent(w)} jól keresett: +${wv} tallér.`, importance: 2.5, tick: events.at(-1)?.tick ?? 0, agents: [w] });
    if (lv <= -20) facts.push({ kind: "money", text: `${n.agent(l)} sokat költött: ${lv} tallér.`, importance: 2.5, tick: events.at(-1)?.tick ?? 0, agents: [l] });
  }
  return facts;
}

/** A legfontosabb k tény, időrendben. Stabil sorrend azonos fontosságnál. */
export function topFacts(facts: Fact[], k: number): Fact[] {
  return facts
    .map((f, i) => ({ f, i }))
    .sort((a, b) => b.f.importance - a.f.importance || a.i - b.i)
    .slice(0, k)
    .map((x) => x.f)
    .sort((a, b) => a.tick - b.tick);
}

export function factLines(facts: Fact[]): string {
  return facts.map((f, i) => `${i + 1}. [${formatTime(tickToTime(f.tick))}] ${f.text}`).join("\n");
}
