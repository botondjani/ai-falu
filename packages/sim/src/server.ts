import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { Runner } from "./runner";
import type { SummaryService } from "./summary/service";
import type { ClientMessage, ServerMessage } from "./protocol";
import { handleClientMessage, initMessage, tickMessage, type GodControls } from "./session";

export type { GodControls };

export interface ServeOptions {
  /** A lefordított viewer könyvtára; ha meg van adva, ugyanazon a porton a weboldalt is kiszolgálja. */
  staticDir?: string;
  /** Ha meg van adva, csak ezzel a jelszóval lehet csatlakozni (?pw=...). */
  password?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

/** WebSocket-szerver: init üzenet csatlakozáskor, utána tickenként frissítés. */
export function startServer(
  runner: Runner,
  port: number,
  summaries?: SummaryService,
  god?: GodControls,
  opts: ServeOptions = {},
): WebSocketServer {
  // Egy HTTP-szerver a weboldalnak és a WebSocketnek, hogy egy HTTPS-cím mögött is működjön.
  const http = createServer((req, res) => {
    if (!opts.staticDir) {
      res.writeHead(404).end();
      return;
    }
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "");
    let file = join(opts.staticDir, path);
    if (!file.startsWith(opts.staticDir) || !existsSync(file) || statSync(file).isDirectory()) file = join(opts.staticDir, "index.html");
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  const wss = new WebSocketServer({
    server: http,
    verifyClient: ({ req }: { req: IncomingMessage }) => !opts.password || new URL(req.url ?? "/", "http://x").searchParams.get("pw") === opts.password,
  });
  http.listen(port);
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
