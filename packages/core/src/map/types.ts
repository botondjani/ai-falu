export type TileType =
  | "fű"
  | "út"
  | "víz"
  | "híd"
  | "erdő"
  | "mező"
  | "tér"
  | "fal"
  | "padló"
  | "ajtó";

export interface Point {
  x: number;
  y: number;
}

export type LocationKind =
  | "ház"
  | "kocsma"
  | "bolt"
  | "pékség"
  | "kovácsműhely"
  | "tér"
  | "mező"
  | "erdő"
  | "folyó";

export interface Location {
  id: string;
  kind: LocationKind;
  name: string;
  /** A hely bejárható csempéi, ahol egy lakó "ott van". */
  spots: Point[];
  /** Épületnél az ajtó. */
  door?: Point;
  /** Téglalap (épületnél a falakkal együtt). */
  bounds: { x: number; y: number; w: number; h: number };
}

export interface TileMap {
  width: number;
  height: number;
  tiles: TileType[]; // sorfolytonos: y * width + x
  locations: Location[];
}

/** Lépésköltség; Infinity = járhatatlan. */
export const TILE_COST: Record<TileType, number> = {
  út: 1,
  híd: 1,
  tér: 1,
  ajtó: 1,
  padló: 1,
  fű: 2,
  mező: 2,
  erdő: 3,
  víz: Infinity,
  fal: Infinity,
};

export function tileAt(map: TileMap, x: number, y: number): TileType | undefined {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return undefined;
  return map.tiles[y * map.width + x];
}

export function isWalkable(map: TileMap, x: number, y: number): boolean {
  const t = tileAt(map, x, y);
  return t !== undefined && Number.isFinite(TILE_COST[t]);
}

export function getLocation(map: TileMap, id: string): Location {
  const loc = map.locations.find((l) => l.id === id);
  if (!loc) throw new Error(`Unknown location: ${id}`);
  return loc;
}

export function locationAt(map: TileMap, p: Point): Location | undefined {
  return map.locations.find((l) => l.spots.some((s) => s.x === p.x && s.y === p.y));
}
