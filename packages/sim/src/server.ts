import { WebSocketServer, type WebSocket } from "ws";
import type { Runner } from "./runner";
import type { SummaryService } from "./summary/service";
import type { ClientMessage, ServerMessage } from "./protocol";
import { handleClientMessage, initMessage, tickMessage, type GodControls } from "./session";

export type { GodControls };

/** WebSocket-szerver: init üzenet csatlakozáskor, utána tickenként frissítés. */
export function startServer(runner: Runner, port: number, summaries?: SummaryService, god?: GodControls): WebSocketServer {
  const wss = new WebSocketServer({ port });
  const send = (ws: WebSocket, msg: ServerMessage) => ws.send(JSON.stringify(msg));
  const broadcast = (msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === c.OPEN) c.send(data);
  };

  wss.on("connection", (ws) => {
    send(ws, initMessage(runner, summaries));
    ws.on("close", () => summaries?.markSeen());
    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      void handleClientMessage(msg, runner, (m) => send(ws, m), summaries, god);
    });
  });

  runner.onStatus(() => broadcast({ type: "status", status: runner.status() }));
  runner.onTick((r, world) => broadcast(tickMessage(runner, r, world)));
  return wss;
}
