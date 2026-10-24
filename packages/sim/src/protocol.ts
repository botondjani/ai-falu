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
}

export interface SimStatus {
  running: boolean;
  speed: number; // valós másodperc / szimulált nap
  pausedReason?: string;
  mode: "élő" | "visszajátszás";
  runId?: number;
  llm?: LlmStats;
}

export type ServerMessage =
  | { type: "init"; map: TileMap; tick: number; agents: AgentView[]; recentEvents: SimEvent[]; status: SimStatus }
  | {
      type: "tick";
      tick: number;
      tickMs: number;
      agents: AgentView[];
      moves: Record<string, Point[]>;
      events: SimEvent[];
      llm?: LlmStats;
    }
  | { type: "status"; status: SimStatus };

export type ClientMessage = { type: "pause" } | { type: "resume" } | { type: "speed"; secondsPerDay: number };
