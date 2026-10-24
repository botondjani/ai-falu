import type { ActivityKind, DecisionSource, Inventory, Needs, Point, SimEvent, TileMap } from "@falu/core";
import type { LlmStats } from "./llm/gateway";

export type { LlmStats };

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
  runId?: number;
  llm?: LlmStats;
}

export interface MarketView {
  prices: Partial<Record<string, number>>;
  shop: Inventory;
  tavern: Inventory;
  mealPrice: number;
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
    }
  | {
      type: "tick";
      tick: number;
      tickMs: number;
      agents: AgentView[];
      moves: Record<string, Point[]>;
      events: SimEvent[];
      llm?: LlmStats;
      market: MarketView;
    }
  | { type: "status"; status: SimStatus };

export type ClientMessage = { type: "pause" } | { type: "resume" } | { type: "speed"; secondsPerDay: number };
