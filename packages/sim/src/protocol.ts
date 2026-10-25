import type { ActivityKind, DecisionSource, Inventory, Needs, Point, SimEvent, TileMap } from "@falu/core";
import type { Summary } from "./summary/summary";

export type { Summary };

/** A viewernek küldött lakó-nézet (csak ami a megjelenítéshez kell). */
export interface AgentView {
  id: string;
  name: string;
  occupation: string;
  color: string;
  pos: Point;
  activity: { kind: ActivityKind; locationId: string; reason: string; source: DecisionSource; say?: string } | null;
  needs: Needs;
  money: number;
  inventory: Inventory;
  mood?: string;
  planGoal?: string;
  /** A lakó véleménye másokról (csak a nem semlegesek). */
  relations: { with: string; trust: number; liking: number }[];
  knownGossip: number;
}

export interface SimStatus {
  running: boolean;
  speed: number; // valós másodperc / szimulált nap
  pausedReason?: string;
  mode: "élő" | "visszajátszás";
  /** Elérhető-e az Isten-mód (visszajátszásnál nem). */
  godMode?: boolean;
  runId?: number;
}

export interface MarketView {
  prices: Partial<Record<string, number>>;
  shop: Inventory;
  tavern: Inventory;
  mealPrice: number;
}

export interface ProfileView {
  id: string;
  name: string;
  age: number;
  occupation: string;
  traits: string[];
  secretDesire: string;
  homeId: string;
  workplaceId: string;
  mood?: string;
  plan?: { goal: string; items: { fromHour: number; toHour: number; kind: string; locationId: string; goal: string }[] };
  /** Mások átlagos véleménye róla (a nem semlegesekből). */
  reputation: { trust: number; liking: number; count: number };
  /** Ő hogyan látja a többieket, és ők őt. */
  relations: { with: string; out: { trust: number; liking: number }; in: { trust: number; liking: number } }[];
  gossip: { id: number; aboutId: string; text: string; sentiment: string; spread: number; origin: boolean }[];
  /** Pletykák róla, és hányan tudnak róluk. */
  gossipAbout: { id: number; text: string; sentiment: string; spread: number }[];
  memories: { id: number; tick: number; kind: string; text: string; importance: number }[];
}

export type ServerMessage =
  | {
      type: "init";
      map: TileMap;
      tick: number;
      agents: AgentView[];
      recentEvents: SimEvent[];
      status: SimStatus;
      market: MarketView;
      lastSeenTick: number;
    }
  | {
      type: "tick";
      tick: number;
      tickMs: number;
      agents: AgentView[];
      moves: Record<string, Point[]>;
      events: SimEvent[];
      market: MarketView;
    }
  | { type: "status"; status: SimStatus }
  | { type: "summary"; summary: Summary }
  | { type: "profile"; profile: ProfileView | null };

export type ClientMessage =
  | { type: "pause" }
  | { type: "resume" }
  | { type: "speed"; secondsPerDay: number }
  | { type: "summary"; mode: "since_seen" | "last_day" }
  | { type: "seen" }
  | { type: "god"; text: string }
  | { type: "whisper"; agentId: string; text: string }
  | { type: "profile"; agentId: string };
