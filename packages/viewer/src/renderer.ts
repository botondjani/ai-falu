import { Application, Container, Graphics, Sprite, Text, Texture, TextureStyle } from "pixi.js";
import { tickToTime, type Point, type TileMap } from "@falu/core";
import type { AgentView } from "@falu/sim";
import { TILE, renderAgentCanvas, renderMapCanvas } from "./tiles";

TextureStyle.defaultOptions.scaleMode = "nearest";

interface AgentSprite {
  root: Container;
  /** Az aktuális animáció útvonala csempékben: [kiindulás, ...lépések]. */
  route: Point[];
  t0: number;
  dur: number;
}

/** Imperatív Pixi-renderer: statikus térkép + interpolált lakók + napszak-sötétítés. */
export class VillageRenderer {
  private app = new Application();
  private world = new Container();
  private agentLayer = new Container();
  private night = new Graphics();
  private sprites = new Map<string, AgentSprite>();
  private map: TileMap | null = null;
  private ready: Promise<void>;
  private destroyed = false;
  onAgentClick?: (id: string) => void;

  constructor(private host: HTMLElement) {
    this.ready = this.init();
  }

  private async init() {
    await this.app.init({ resizeTo: this.host, background: "#1d2b1d", antialias: false });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.app.ticker.add(() => this.animate());
    new ResizeObserver(() => this.fit()).observe(this.host);
  }

  async setMap(map: TileMap) {
    await this.ready;
    if (this.destroyed) return;
    this.map = map;
    this.world.removeChildren();
    this.world.addChild(new Sprite(Texture.from(renderMapCanvas(map))));
    for (const loc of map.locations) {
      if (!loc.door) continue;
      const label = new Text({
        text: loc.name,
        style: { fontFamily: "monospace", fontSize: 7, fill: "#fff", stroke: { color: "#000", width: 2 } },
        resolution: 4,
      });
      label.anchor.set(0.5, 1);
      label.position.set((loc.bounds.x + loc.bounds.w / 2) * TILE, loc.bounds.y * TILE - 1);
      this.world.addChild(label);
    }
    this.world.addChild(this.agentLayer);
    this.night.rect(0, 0, map.width * TILE, map.height * TILE).fill("#0a0a30");
    this.night.alpha = 0;
    this.world.addChild(this.night);
    this.fit();
  }

  private fit() {
    if (!this.map) return;
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    const scale = Math.max(1, Math.min(w / (this.map.width * TILE), h / (this.map.height * TILE)));
    this.world.scale.set(scale);
    this.world.position.set(
      Math.round((w - this.map.width * TILE * scale) / 2),
      Math.round((h - this.map.height * TILE * scale) / 2),
    );
  }

  async frame(tick: number, tickMs: number, agents: AgentView[], moves: Record<string, Point[]>) {
    await this.ready;
    if (this.destroyed) return;
    const now = performance.now();
    // Gyors módban ne lógjon le az animáció a tickről.
    const dur = Math.min(Math.max(tickMs, 16), 1500);
    for (const a of agents) {
      let s = this.sprites.get(a.id);
      if (!s) {
        s = this.createSprite(a);
        this.sprites.set(a.id, s);
      }
      const cur = this.currentPos(s, now);
      const trail = moves[a.id] ?? [];
      s.route = trail.length ? [cur, ...trail] : [a.pos];
      s.t0 = now;
      s.dur = dur;
    }
    this.night.alpha = nightAlpha(tick);
  }

  private createSprite(a: AgentView): AgentSprite {
    const root = new Container();
    const body = new Sprite(Texture.from(renderAgentCanvas(a.color)));
    body.anchor.set(0.5, 0.5);
    const label = new Text({
      text: a.name.split(" ").at(-1) ?? a.name,
      style: { fontFamily: "monospace", fontSize: 6, fill: "#fff", stroke: { color: "#000", width: 2 } },
      resolution: 4,
    });
    label.anchor.set(0.5, 1);
    label.y = -7;
    root.addChild(body, label);
    root.eventMode = "static";
    root.cursor = "pointer";
    root.on("pointertap", () => this.onAgentClick?.(a.id));
    this.agentLayer.addChild(root);
    const s: AgentSprite = { root, route: [a.pos], t0: 0, dur: 1 };
    this.place(s, a.pos);
    return s;
  }

  private currentPos(s: AgentSprite, now: number): Point {
    const r = s.route;
    if (r.length === 1) return r[0];
    const p = Math.min(1, (now - s.t0) / s.dur) * (r.length - 1);
    const i = Math.min(Math.floor(p), r.length - 2);
    const f = p - i;
    return { x: r[i].x + (r[i + 1].x - r[i].x) * f, y: r[i].y + (r[i + 1].y - r[i].y) * f };
  }

  private place(s: AgentSprite, p: Point) {
    s.root.position.set(p.x * TILE + TILE / 2, p.y * TILE + TILE / 2);
  }

  private animate() {
    const now = performance.now();
    for (const s of this.sprites.values()) this.place(s, this.currentPos(s, now));
  }

  destroy() {
    this.destroyed = true;
    if (this.app.renderer) this.app.destroy(true, { children: true });
  }
}

function nightAlpha(tick: number): number {
  const { hour, minute } = tickToTime(tick);
  const h = hour + minute / 60;
  if (h >= 22 || h < 4) return 0.55;
  if (h >= 19) return ((h - 19) / 3) * 0.55;
  if (h < 7) return ((7 - h) / 3) * 0.55;
  return 0;
}
