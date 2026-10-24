import { hash2, type LocationKind, type TileMap, type TileType } from "@falu/core";

export const TILE = 16;

const WALL_COLORS: Partial<Record<LocationKind, [string, string]>> = {
  ház: ["#b07a4f", "#8a5a36"],
  kocsma: ["#7b4a8c", "#5c3569"],
  bolt: ["#3f7ca8", "#2c5c7f"],
  pékség: ["#c9893a", "#9e6a2a"],
  kovácsműhely: ["#6b6b6b", "#4a4a4a"],
};

type Ctx = CanvasRenderingContext2D;

function px(ctx: Ctx, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function speckle(ctx: Ctx, ox: number, oy: number, tx: number, ty: number, colors: string[], density: number, salt: number) {
  for (let y = 0; y < TILE; y++)
    for (let x = 0; x < TILE; x++) {
      const r = hash2(tx * TILE + x, ty * TILE + y, salt);
      if (r < density) px(ctx, ox + x, oy + y, 1, 1, colors[Math.floor((r / density) * colors.length)]);
    }
}

function drawTile(ctx: Ctx, t: TileType, tx: number, ty: number, wall: [string, string]) {
  const ox = tx * TILE;
  const oy = ty * TILE;
  switch (t) {
    case "fű":
      px(ctx, ox, oy, TILE, TILE, "#5a9e4b");
      speckle(ctx, ox, oy, tx, ty, ["#6fb85c", "#4a8a3d", "#7cc466"], 0.12, 1);
      if (hash2(tx, ty, 9) < 0.08) {
        px(ctx, ox + 6, oy + 7, 2, 2, hash2(tx, ty, 10) < 0.5 ? "#f2e35b" : "#e86a9a");
      }
      break;
    case "út":
      px(ctx, ox, oy, TILE, TILE, "#c8a978");
      speckle(ctx, ox, oy, tx, ty, ["#b39566", "#d6bb8c"], 0.1, 2);
      break;
    case "tér":
      px(ctx, ox, oy, TILE, TILE, "#b4b2a8");
      for (let i = 0; i < TILE; i += 4) {
        px(ctx, ox, oy + i, TILE, 1, "#95938a");
        const off = (i / 4) % 2 === 0 ? 0 : 4;
        for (let j = off; j < TILE; j += 8) px(ctx, ox + j, oy + i, 1, 4, "#95938a");
      }
      break;
    case "víz": {
      px(ctx, ox, oy, TILE, TILE, "#3b7dd8");
      for (let i = 0; i < 3; i++) {
        const wx = Math.floor(hash2(tx, ty, 20 + i) * 12);
        const wy = Math.floor(hash2(tx, ty, 30 + i) * 14);
        px(ctx, ox + wx, oy + wy, 4, 1, "#7ab3f5");
      }
      break;
    }
    case "híd":
      px(ctx, ox, oy, TILE, TILE, "#8b5a2b");
      for (let i = 0; i < TILE; i += 4) px(ctx, ox + i, oy, 1, TILE, "#6b4420");
      px(ctx, ox, oy, TILE, 2, "#5b3a1e");
      px(ctx, ox, oy + TILE - 2, TILE, 2, "#5b3a1e");
      break;
    case "erdő": {
      px(ctx, ox, oy, TILE, TILE, "#4f8f42");
      speckle(ctx, ox, oy, tx, ty, ["#3f7a35"], 0.15, 3);
      px(ctx, ox + 7, oy + 10, 2, 5, "#5b3a1e");
      ctx.fillStyle = "#2e6b2e";
      ctx.beginPath();
      ctx.arc(ox + 8, oy + 7, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#3f8a3f";
      ctx.beginPath();
      ctx.arc(ox + 6, oy + 5, 3, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "mező":
      px(ctx, ox, oy, TILE, TILE, "#9b6b3a");
      for (let i = 1; i < TILE; i += 4) {
        px(ctx, ox, oy + i, TILE, 2, "#d9b84f");
        speckle(ctx, ox, oy, tx, ty, ["#f0d36a"], 0.05, 4 + i);
      }
      break;
    case "fal":
      px(ctx, ox, oy, TILE, TILE, wall[0]);
      for (let i = 0; i < TILE; i += 4) {
        px(ctx, ox, oy + i, TILE, 1, wall[1]);
        const off = (i / 4) % 2 === 0 ? 2 : 6;
        for (let j = off; j < TILE; j += 8) px(ctx, ox + j, oy + i, 1, 4, wall[1]);
      }
      break;
    case "padló":
      px(ctx, ox, oy, TILE, TILE, "#c49a6c");
      for (let i = 0; i < TILE; i += 4) px(ctx, ox, oy + i, TILE, 1, "#a67c52");
      break;
    case "ajtó":
      px(ctx, ox, oy, TILE, TILE, "#c49a6c");
      px(ctx, ox + 2, oy + 1, 12, 14, "#5b3a1e");
      px(ctx, ox + 3, oy + 2, 10, 12, "#7a4f2a");
      px(ctx, ox + 10, oy + 8, 2, 2, "#e8c547");
      break;
  }
}

/** A teljes térkép egyetlen vászonra rajzolva (statikus háttér). */
export function renderMapCanvas(map: TileMap): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = map.width * TILE;
  c.height = map.height * TILE;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  const wallOf = (x: number, y: number): [string, string] => {
    const loc = map.locations.find(
      (l) => l.door && x >= l.bounds.x && y >= l.bounds.y && x < l.bounds.x + l.bounds.w && y < l.bounds.y + l.bounds.h,
    );
    return (loc && WALL_COLORS[loc.kind]) ?? ["#9c6b43", "#7a4b2a"];
  };

  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) drawTile(ctx, map.tiles[y * map.width + x], x, y, wallOf(x, y));
  return c;
}

/** Kis pixeles figura a lakó színével. */
export function renderAgentCanvas(color: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = TILE;
  c.height = TILE;
  const ctx = c.getContext("2d")!;
  px(ctx, 4, 14, 8, 2, "rgba(0,0,0,0.25)"); // árnyék
  px(ctx, 5, 1, 6, 2, "#4a2e1a"); // haj
  px(ctx, 5, 3, 6, 4, "#f1c27d"); // fej
  px(ctx, 6, 4, 1, 1, "#222");
  px(ctx, 9, 4, 1, 1, "#222");
  px(ctx, 4, 7, 8, 5, color); // test
  px(ctx, 3, 8, 1, 3, "#f1c27d");
  px(ctx, 12, 8, 1, 3, "#f1c27d");
  px(ctx, 5, 12, 2, 3, "#333");
  px(ctx, 9, 12, 2, 3, "#333");
  return c;
}
