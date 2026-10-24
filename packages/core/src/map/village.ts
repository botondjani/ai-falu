import { hash2 } from "../rng";
import type { Location, LocationKind, Point, TileMap, TileType } from "./types";

export const MAP_WIDTH = 48;
export const MAP_HEIGHT = 32;

interface BuildingDef {
  id: string;
  kind: LocationKind;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  door: Point;
}

const BUILDINGS: BuildingDef[] = [
  // északi házsor, ajtó alul
  { id: "haz_1", kind: "ház", name: "1. ház", x: 2, y: 2, w: 5, h: 5, door: { x: 4, y: 6 } },
  { id: "haz_2", kind: "ház", name: "2. ház", x: 8, y: 2, w: 5, h: 5, door: { x: 10, y: 6 } },
  { id: "haz_3", kind: "ház", name: "3. ház", x: 14, y: 2, w: 5, h: 5, door: { x: 16, y: 6 } },
  { id: "haz_4", kind: "ház", name: "4. ház", x: 21, y: 2, w: 5, h: 5, door: { x: 23, y: 6 } },
  { id: "haz_5", kind: "ház", name: "5. ház", x: 27, y: 2, w: 5, h: 5, door: { x: 29, y: 6 } },
  // déli házsor, ajtó felül
  { id: "haz_6", kind: "ház", name: "6. ház", x: 14, y: 23, w: 5, h: 5, door: { x: 16, y: 23 } },
  { id: "haz_7", kind: "ház", name: "7. ház", x: 21, y: 23, w: 5, h: 5, door: { x: 23, y: 23 } },
  { id: "haz_8", kind: "ház", name: "8. ház", x: 27, y: 23, w: 5, h: 5, door: { x: 29, y: 23 } },
  // a tér körül
  { id: "kocsma", kind: "kocsma", name: "Kocsma", x: 8, y: 11, w: 6, h: 6, door: { x: 13, y: 14 } },
  { id: "kovacs", kind: "kovácsműhely", name: "Kovácsműhely", x: 2, y: 12, w: 5, h: 5, door: { x: 4, y: 16 } },
  { id: "bolt", kind: "bolt", name: "Bolt", x: 25, y: 10, w: 6, h: 5, door: { x: 25, y: 12 } },
  { id: "pekseg", kind: "pékség", name: "Pékség", x: 25, y: 15, w: 6, h: 4, door: { x: 25, y: 16 } },
];

/** A falu térképe kódból generálva (determinisztikus). */
export function buildVillageMap(): TileMap {
  const W = MAP_WIDTH;
  const H = MAP_HEIGHT;
  const tiles: TileType[] = new Array(W * H).fill("fű");
  const set = (x: number, y: number, t: TileType) => {
    if (x >= 0 && y >= 0 && x < W && y < H) tiles[y * W + x] = t;
  };
  const fill = (x0: number, y0: number, x1: number, y1: number, t: TileType) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, t);
  };

  // erdő keleten, szabálytalan nyugati széllel
  for (let y = 0; y < H; y++)
    for (let x = 36; x < W; x++) if (x >= 37 || hash2(x, y, 1) < 0.6) set(x, y, "erdő");
  // néhány fa szórványosan a falu körül
  for (let y = 0; y < H; y++)
    for (let x = 0; x < 32; x++) if (hash2(x, y, 2) < 0.025) set(x, y, "erdő");

  // folyó
  fill(33, 0, 34, H - 1, "víz");

  // mezők délnyugaton
  fill(2, 22, 12, 29, "mező");

  // tér
  fill(15, 11, 23, 18, "tér");

  // utak
  fill(0, 19, W - 1, 19, "út"); // fő út kelet-nyugat
  fill(33, 19, 34, 19, "híd");
  fill(1, 7, 31, 7, "út"); // északi házsor útja
  fill(19, 7, 19, 11, "út");
  fill(19, 18, 19, 22, "út");
  fill(13, 22, 31, 22, "út"); // déli házsor útja
  fill(14, 14, 14, 14, "út"); // kocsma bejárat
  fill(24, 12, 24, 12, "út"); // bolt bejárat
  fill(24, 16, 24, 16, "út"); // pékség bejárat
  fill(24, 11, 24, 18, "út");
  fill(4, 17, 4, 18, "út"); // kovács bejárat
  fill(7, 20, 7, 21, "út"); // mező bejárat
  fill(35, 19, 37, 19, "út"); // erdei ösvény

  const locations: Location[] = [];

  for (const b of BUILDINGS) {
    const spots: Point[] = [];
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const edge = x === b.x || y === b.y || x === b.x + b.w - 1 || y === b.y + b.h - 1;
        if (edge) set(x, y, "fal");
        else {
          set(x, y, "padló");
          spots.push({ x, y });
        }
      }
    }
    set(b.door.x, b.door.y, "ajtó");
    locations.push({
      id: b.id,
      kind: b.kind,
      name: b.name,
      spots,
      door: b.door,
      bounds: { x: b.x, y: b.y, w: b.w, h: b.h },
    });
  }

  const area = (
    id: string,
    kind: LocationKind,
    name: string,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    accept: (t: TileType) => boolean,
  ) => {
    const spots: Point[] = [];
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (accept(tiles[y * W + x])) spots.push({ x, y });
    locations.push({ id, kind, name, spots, bounds: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } });
  };

  area("ter", "tér", "Falu tere", 15, 11, 23, 18, (t) => t === "tér");
  area("mezo", "mező", "Mező", 2, 22, 12, 29, (t) => t === "mező");
  area("erdo", "erdő", "Erdő", 37, 14, 42, 24, (t) => t === "erdő");
  area("folyo", "folyó", "Folyópart", 32, 4, 32, 30, (t) => t === "fű");

  return { width: W, height: H, tiles, locations };
}
