import type { Inventory, Item } from "./inventory";
import type { Point } from "./map/types";

export interface Needs {
  /** 0 = jóllakott, 100 = éhezik */
  hunger: number;
  /** 0 = kimerült, 100 = kipihent */
  energy: number;
}

export type ActivityKind = "alszik" | "dolgozik" | "eszik" | "pihen" | "szórakozik" | "sétál";

export interface Activity {
  kind: ActivityKind;
  locationId: string;
  reason: string;
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
}

export interface WorldState {
  seed: string;
  tick: number;
  rngState: number;
  agents: Agent[];
  /** Helyszínek készlete (pl. pékség kenyérkészlete). */
  stocks: Record<string, Inventory>;
}

interface EventBase {
  tick: number;
}

export type SimEvent = EventBase &
  (
    | { type: "day_started"; day: number }
    | { type: "activity_started"; agentId: string; kind: ActivityKind; locationId: string; reason: string }
    | { type: "arrived"; agentId: string; locationId: string }
    | { type: "ate"; agentId: string; what: string; locationId: string }
    | { type: "produced"; agentId: string; item: Item; qty: number; locationId: string }
    | { type: "paid"; agentId: string; amount: number; to: string; reason: string }
    | { type: "earned"; agentId: string; amount: number; reason: string }
    | { type: "took"; agentId: string; item: Item; qty: number; from: string }
    | { type: "starving"; agentId: string }
  );

export type SimEventType = SimEvent["type"];

/** Amit egy döntéshozó (autopilot vagy később LLM) kér. */
export interface DesiredActivity {
  kind: ActivityKind;
  locationId: string;
  reason: string;
}
