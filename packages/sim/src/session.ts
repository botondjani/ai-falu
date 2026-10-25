import type { StepResult, World } from "@falu/core";
import type { ClientMessage, ServerMessage } from "./protocol";
import type { Runner } from "./runner";
import type { SummaryService } from "./summary/service";

export interface GodControls {
  god(text: string): void;
  whisper(agentId: string, text: string): void;
}

/** Szállítófüggetlen kliens-kezelés (WebSocket-szerver és böngészős demó közös része). */
export function initMessage(runner: Runner, summaries?: SummaryService): ServerMessage {
  return {
    type: "init",
    map: runner.world.map,
    tick: runner.world.state.tick,
    agents: runner.agentViews(),
    recentEvents: runner.recentEvents(),
    status: runner.status(),
    market: runner.market(),
    lastSeenTick: summaries?.lastSeen() ?? runner.world.state.tick,
  };
}

export function tickMessage(runner: Runner, r: StepResult, world: World): ServerMessage {
  return {
    type: "tick",
    tick: world.state.tick,
    tickMs: runner.tickMs,
    agents: runner.agentViews(),
    moves: r.moves,
    events: r.events,
    llm: runner.llmStats(),
    market: runner.market(),
  };
}

export async function handleClientMessage(
  msg: ClientMessage,
  runner: Runner,
  reply: (m: ServerMessage) => void,
  summaries?: SummaryService,
  god?: GodControls,
) {
  if (msg.type === "pause") runner.pause("kézi szünet");
  else if (msg.type === "resume") runner.start();
  else if (msg.type === "speed" && msg.secondsPerDay >= 10 && msg.secondsPerDay <= 3600) runner.setSpeed(msg.secondsPerDay);
  else if (msg.type === "seen") summaries?.markSeen();
  else if (msg.type === "profile") reply({ type: "profile", profile: runner.profile(msg.agentId) });
  else if (msg.type === "god" && god && typeof msg.text === "string" && msg.text.trim()) god.god(msg.text.trim());
  else if (msg.type === "whisper" && god && typeof msg.text === "string" && msg.text.trim()) god.whisper(msg.agentId, msg.text.trim());
  else if (msg.type === "summary" && summaries) {
    try {
      const summary = await summaries.sinceSeen(msg.mode);
      reply({ type: "summary", summary });
      if (msg.mode === "since_seen") summaries.markSeen(summary.toTick);
    } catch (e) {
      console.error("Összefoglaló hiba:", e);
    }
  }
}
