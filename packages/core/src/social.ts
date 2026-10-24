import { addMemory } from "./memory";
import type { TileMap } from "./map/types";
import { Rng } from "./rng";
import { RULES } from "./rules";
import { TICKS_PER_HOUR, hourBetween, tickToTime } from "./time";
import type { Agent, SimEvent, WorldState } from "./types";

/** A irányú vélemény B-ről (-100..100). */
export interface Relation {
  trust: number;
  liking: number;
}

export type Sentiment = "jó" | "rossz" | "semleges";

export interface Gossip {
  id: number;
  aboutId: string;
  originId: string;
  text: string;
  sentiment: Sentiment;
  tick: number;
  knownBy: string[];
}

export interface ConversationLine {
  speaker: string;
  text: string;
}

/** Egy lezajlott beszélgetés (az LLM vagy a mock adja; rögzített bemenet). */
export interface Conversation {
  a: string;
  b: string;
  topic: string;
  lines: ConversationLine[];
  /** Mit jegyez meg A, illetve B. */
  memoryA: string;
  memoryB: string;
  /** A véleményváltozása B-ről, és fordítva. */
  deltaA: Relation;
  deltaB: Relation;
  gossip?: {
    teller: string;
    aboutId: string;
    text: string;
    sentiment: Sentiment;
    /** Ha egy már ismert pletykát ad tovább. */
    gossipId?: number;
  };
}

export const MAX_DELTA = 15;
const FREE_KINDS = new Set(["pihen", "szórakozik", "sétál"]);
const PAIR_COOLDOWN_TICKS = 3 * TICKS_PER_HOUR;
const AGENT_COOLDOWN_TICKS = TICKS_PER_HOUR;

export function relKey(a: string, b: string) {
  return `${a}>${b}`;
}

export function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function getRelation(state: WorldState, a: string, b: string): Relation {
  return state.relations[relKey(a, b)] ?? { trust: 0, liking: 0 };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function adjustRelation(state: WorldState, a: string, b: string, d: Relation): Relation {
  const r = getRelation(state, a, b);
  const next = { trust: clamp(Math.round(r.trust + d.trust), -100, 100), liking: clamp(Math.round(r.liking + d.liking), -100, 100) };
  state.relations[relKey(a, b)] = next;
  return next;
}

/** Kezdő vélemény a seed-kapcsolat szövegéből (egyszerű kulcsszavas becslés). */
export function initialRelation(kind: string): Relation {
  const k = kind.toLowerCase();
  if (/gyanak|rivális|vetélyt|nem bízik|nem hisz|kerüli|fél tőle/.test(k)) return { trust: -30, liking: -15 };
  if (/tartozik/.test(k)) return { trust: -20, liking: -5 };
  if (/szerelm|tetszik|kacérkod/.test(k)) return { trust: 10, liking: 50 };
  if (/barát|cimbor/.test(k)) return { trust: 40, liking: 45 };
  if (/anyja|apja|öccse|húga|bátyja|nővére|férje|felesége|lánya|fia/.test(k)) return { trust: 35, liking: 30 };
  return { trust: 10, liking: 10 };
}

function isFree(a: Agent, tick: number): boolean {
  const act = a.activity;
  if (!act || !act.arrived || !FREE_KINDS.has(act.kind)) return false;
  if (a.needs.hunger >= RULES.hungryThreshold || a.needs.energy < RULES.exhaustedThreshold) return false;
  return a.lastTalkTick === undefined || tick - a.lastTalkTick >= AGENT_COOLDOWN_TICKS;
}

/**
 * Kik kezdenek most beszélgetést: ugyanazon a helyen lévő, ráérő lakópárok,
 * pár-cooldownnal és helyfüggő eséllyel. Determinisztikus (seed + tick).
 */
export function conversationCandidates(state: WorldState, map: TileMap, maxPairs = 2): [string, string][] {
  const { hour } = tickToTime(state.tick);
  if (hourBetween(hour, RULES.sleepHour, RULES.wakeHour)) return [];
  const rng = Rng.fromSeed(`${state.seed}:talk:${state.tick}`);
  const free = state.agents.filter((a) => isFree(a, state.tick));
  const used = new Set<string>();
  const pairs: [string, string][] = [];
  for (let i = 0; i < free.length && pairs.length < maxPairs; i++) {
    const a = free[i];
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < free.length; j++) {
      const b = free[j];
      if (used.has(b.id) || a.activity!.locationId !== b.activity!.locationId) continue;
      const last = state.lastTalk[pairKey(a.id, b.id)];
      if (last !== undefined && state.tick - last < PAIR_COOLDOWN_TICKS) continue;
      const loc = map.locations.find((l) => l.id === a.activity!.locationId);
      const social = loc?.kind === "kocsma" || loc?.kind === "tér";
      if (!rng.chance(social ? 0.12 : 0.05)) continue;
      pairs.push([a.id, b.id]);
      used.add(a.id).add(b.id);
      break;
    }
  }
  return pairs;
}

/** Egy beszélgetés hatása: esemény, emlékek, kapcsolatváltozás, pletykaterjedés. */
export function applyConversation(state: WorldState, c: Conversation, events: SimEvent[]) {
  const tick = state.tick;
  const A = state.agents.find((x) => x.id === c.a);
  const B = state.agents.find((x) => x.id === c.b);
  if (!A || !B) return;
  const cap = (d: Relation): Relation => ({ trust: clamp(d.trust, -MAX_DELTA, MAX_DELTA), liking: clamp(d.liking, -MAX_DELTA, MAX_DELTA) });
  const dA = cap(c.deltaA);
  const dB = cap(c.deltaB);
  adjustRelation(state, A.id, B.id, dA);
  adjustRelation(state, B.id, A.id, dB);
  state.lastTalk[pairKey(A.id, B.id)] = tick;
  A.lastTalkTick = tick;
  B.lastTalkTick = tick;

  events.push({ tick, type: "conversation", a: A.id, b: B.id, agentId: A.id, topic: c.topic, lines: c.lines, deltaA: dA, deltaB: dB });
  const weight = (d: Relation) => 3 + Math.round((Math.abs(d.trust) + Math.abs(d.liking)) / 6);
  addMemory(state, A.id, "beszélgetés", `Beszélgettem vele: ${B.name} (${c.topic}). ${c.memoryA}`, weight(dA));
  addMemory(state, B.id, "beszélgetés", `Beszélgettem vele: ${A.name} (${c.topic}). ${c.memoryB}`, weight(dB));

  if (c.gossip) spreadGossip(state, c, events);
}

function spreadGossip(state: WorldState, c: Conversation, events: SimEvent[]) {
  const g = c.gossip!;
  const listenerId = g.teller === c.a ? c.b : c.a;
  const teller = state.agents.find((x) => x.id === g.teller);
  const listener = state.agents.find((x) => x.id === listenerId);
  const about = state.agents.find((x) => x.id === g.aboutId);
  if (!teller || !listener || !about || about.id === listener.id) return;

  let gossip = g.gossipId !== undefined ? state.gossip.find((x) => x.id === g.gossipId) : undefined;
  if (gossip && !gossip.knownBy.includes(teller.id)) gossip = undefined; // csak azt adhatja tovább, amit tud
  if (!gossip) {
    gossip = { id: state.nextGossipId++, aboutId: about.id, originId: teller.id, text: g.text, sentiment: g.sentiment, tick: state.tick, knownBy: [teller.id] };
    state.gossip.push(gossip);
  }
  const isNew = !gossip.knownBy.includes(listener.id);
  if (isNew) gossip.knownBy.push(listener.id);

  events.push({
    tick: state.tick,
    type: "gossip",
    agentId: teller.id,
    listenerId: listener.id,
    aboutId: about.id,
    gossipId: gossip.id,
    text: gossip.text,
    fresh: isNew,
  });
  if (!isNew) return;
  addMemory(state, listener.id, "pletyka", `${teller.name} mesélte ${about.name} kapcsán: ${gossip.text}`, 5);
  const effect = gossip.sentiment === "rossz" ? { trust: -6, liking: -8 } : gossip.sentiment === "jó" ? { trust: 3, liking: 5 } : { trust: 0, liking: 0 };
  adjustRelation(state, listener.id, about.id, effect);
}

/** Kifelé: a lakó által ismert pletykák. */
export function knownGossip(state: WorldState, agentId: string): Gossip[] {
  return state.gossip.filter((g) => g.knownBy.includes(agentId));
}
