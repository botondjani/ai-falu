import { WebSocketServer, type WebSocket } from "ws";
import type { Runner } from "./runner";
import type { ClientMessage, ServerMessage } from "./protocol";

/** WebSocket-szerver: init üzenet csatlakozáskor, utána tickenként frissítés. */
export function startServer(runner: Runner, port: number): WebSocketServer {
  const wss = new WebSocketServer({ port });
  const send = (ws: WebSocket, msg: ServerMessage) => ws.send(JSON.stringify(msg));
  const broadcast = (msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const c of wss.clients) if (c.readyState === c.OPEN) c.send(data);
  };

  wss.on("connection", (ws) => {
    send(ws, {
      type: "init",
      map: runner.world.map,
      tick: runner.world.state.tick,
      agents: runner.agentViews(),
      recentEvents: runner.recentEvents(),
      status: runner.status(),
    });
    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "pause") runner.pause("kézi szünet");
      else if (msg.type === "resume") runner.start();
      else if (msg.type === "speed" && msg.secondsPerDay >= 10 && msg.secondsPerDay <= 3600) {
        runner.setSpeed(msg.secondsPerDay);
      }
    });
  });

  runner.onStatus(() => broadcast({ type: "status", status: runner.status() }));

  runner.onTick((r, world) => {
    broadcast({
      type: "tick",
      tick: world.state.tick,
      tickMs: runner.tickMs,
      agents: runner.agentViews(),
      moves: r.moves,
      events: r.events,
    });
  });

  return wss;
}
