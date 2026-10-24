import type { Inventory, Item } from "./inventory";
import type { Point } from "./map/types";
import type { DayPlan, Memory } from "./memory";
import type { Conversation, ConversationLine, Gossip, Relation } from "./social";

export interface Needs {
  /** 0 = jóllakott, 100 = éhezik */
  hunger: number;
  /** 0 = kimerült, 100 = kipihent */
  energy: number;
}

export type ActivityKind = "alszik" | "dolgozik" | "eszik" | "pihen" | "szórakozik" | "sétál";

/** Ki döntött: szabály-alapú autopilot, LLM, vagy LLM-hiba utáni tartalék. */
export type DecisionSource = "auto" | "llm" | "fallback" | "terv";

export interface Activity {
  kind: ActivityKind;
  locationId: string;
  reason: string;
  source: DecisionSource;
  /** Eddig a tickig tart a döntés (sürgős szükséglet felülírhatja). */
  commitUntil?: number;
  /** Amit hangosan mondott a lakó. */
  say?: string;
  startedTick: number;
  /** Megérkezett-e már a helyszínre. */
  arrived: boolean;
  /** Időtartamos tevékenységnél (pl. evés) a befejezés tickje; megérkezéskor áll be. */
  untilTick?: number;
}

export interface VillagerSeed {
  id: string;
  name: string;
  age: number;
  occupation: string;
  traits: string[];
  secretDesire: string;
  homeId: string;
  workplaceId: string;
  /** Mit termel munka közben (ha bármit). */
  produces?: Item;
  color: string;
  relationships?: { with: string; kind: string }[];
  money?: number;
  inventory?: Inventory;
}

export interface Agent extends VillagerSeed {
  pos: Point;
  path: Point[];
  activity: Activity | null;
  needs: Needs;
  money: number;
  inventory: Inventory;
  /** Munkával töltött tickek a legutóbbi termelés óta. */
  workProgress: number;
  /** Az esti reflexióból (pl. "elégedett", "gyanakvó"). */
  mood?: string;
  plan?: DayPlan;
  /** Történt-e valami váratlan (fontos emlék) az utolsó LLM-döntés óta. */
  surprised: boolean;
  lastTalkTick?: number;
}

export interface WorldState {
  seed: string;
  tick: number;
  rngState: number;
  agents: Agent[];
  /** Helyszínek készlete (pl. pékség kenyérkészlete). */
  stocks: Record<string, Inventory>;
  memories: Memory[];
  nextMemoryId: number;
  /** "a>b" → A véleménye B-ről */
  relations: Record<string, Relation>;
  /** "a|b" → utolsó beszélgetés tickje */
  lastTalk: Record<string, number>;
  gossip: Gossip[];
  nextGossipId: number;
}

export interface Reflection {
  insights: { text: string; importance: number }[];
  mood: string;
}

/** Külső bemenetek egy tickre (LLM vagy Isten-mód); ezeket rögzítjük a visszajátszáshoz. */
export interface ExternalInputs {
  decisions?: Record<string, DesiredActivity>;
  plans?: Record<string, DayPlan>;
  reflections?: Record<string, Reflection>;
  /** kulcs: "a|b" */
  conversations?: Record<string, Conversation>;
}

interface EventBase {
  tick: number;
}

export type SimEvent = EventBase &
  (
    | { type: "day_started"; day: number }
    | {
        type: "activity_started";
        agentId: string;
        kind: ActivityKind;
        locationId: string;
        reason: string;
        source: DecisionSource;
        say?: string;
      }
    | { type: "arrived"; agentId: string; locationId: string }
    | { type: "ate"; agentId: string; what: string; locationId: string }
    | { type: "produced"; agentId: string; item: Item; qty: number; locationId: string }
    | { type: "paid"; agentId: string; amount: number; to: string; reason: string }
    | { type: "earned"; agentId: string; amount: number; reason: string }
    | { type: "took"; agentId: string; item: Item; qty: number; from: string }
    | { type: "starving"; agentId: string }
    | { type: "planned"; agentId: string; goal: string; items: number }
    | { type: "conversation"; agentId: string; a: string; b: string; topic: string; lines: ConversationLine[] }
    | {
        type: "gossip";
        agentId: string;
        listenerId: string;
        aboutId: string;
        gossipId: number;
        text: string;
        fresh: boolean;
      }
    | { type: "reflected"; agentId: string; insights: string[]; mood: string }
  );

export type SimEventType = SimEvent["type"];

/** Amit egy döntéshozó (autopilot vagy később LLM) kér. */
export interface DesiredActivity {
  kind: ActivityKind;
  locationId: string;
  reason: string;
  source?: DecisionSource;
  /** Meddig tartson (tick). Csak külső döntésnél. */
  durationTicks?: number;
  say?: string;
}
