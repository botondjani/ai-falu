import type { ActivityKind, Inventory, Needs, Point, SimEvent, TileMap } from "@falu/core";

/** A viewernek küldött lakó-nézet (csak ami a megjelenítéshez kell). */
export interface AgentView {
  id: string;
  name: string;
  occupation: string;
  color: string;
  pos: Point;
  activity: { kind: ActivityKind; locationId: string; reason: string } | null;
  needs: Needs;
  money: number;
  inventory: Inventory;
}

export interface SimStatus {
  running: boolean;
  speed: number; // valós másodperc / szimulált nap
  pausedReason?: string;
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
    }
  | { type: "status"; status: SimStatus };

export type ClientMessage = { type: "pause" } | { type: "resume" } | { type: "speed"; secondsPerDay: number };
