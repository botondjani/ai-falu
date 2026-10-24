import { TILE_COST, tileAt, type Point, type TileMap } from "./map/types";

const DIRS: Point[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

/** Bináris min-heap; azonos f esetén a beszúrási sorrend dönt (determinizmus). */
class Heap {
  private items: { key: number; f: number; seq: number }[] = [];
  private seq = 0;
  get size() {
    return this.items.length;
  }
  push(key: number, f: number) {
    this.items.push({ key, f, seq: this.seq++ });
    this.up(this.items.length - 1);
  }
  pop(): number {
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      this.down(0);
    }
    return top.key;
  }
  private less(a: number, b: number) {
    const A = this.items[a];
    const B = this.items[b];
    return A.f < B.f || (A.f === B.f && A.seq < B.seq);
  }
  private up(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      [this.items[i], this.items[p]] = [this.items[p], this.items[i]];
      i = p;
    }
  }
  private down(i: number) {
    const n = this.items.length;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < n && this.less(l, m)) m = l;
      if (r < n && this.less(r, m)) m = r;
      if (m === i) break;
      [this.items[i], this.items[m]] = [this.items[m], this.items[i]];
      i = m;
    }
  }
}

/**
 * A* 4-irányú rácson, csempeköltséggel. A visszaadott út nem tartalmazza a kiindulópontot,
 * de tartalmazza a célt. Elérhetetlen célnál null; ha from === to, üres tömb.
 */
export function findPath(map: TileMap, from: Point, to: Point): Point[] | null {
  if (from.x === to.x && from.y === to.y) return [];
  const goalTile = tileAt(map, to.x, to.y);
  if (goalTile === undefined || !Number.isFinite(TILE_COST[goalTile])) return null;

  const W = map.width;
  const start = from.y * W + from.x;
  const goal = to.y * W + to.x;
  const g = new Float64Array(map.width * map.height).fill(Infinity);
  const came = new Int32Array(map.width * map.height).fill(-1);
  const closed = new Uint8Array(map.width * map.height);
  const h = (k: number) => Math.abs((k % W) - to.x) + Math.abs(Math.floor(k / W) - to.y);

  const open = new Heap();
  g[start] = 0;
  open.push(start, h(start));

  while (open.size > 0) {
    const cur = open.pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (const d of DIRS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      const t = tileAt(map, nx, ny);
      if (t === undefined) continue;
      const cost = TILE_COST[t];
      if (!Number.isFinite(cost)) continue;
      const nk = ny * W + nx;
      const ng = g[cur] + cost;
      if (ng < g[nk]) {
        g[nk] = ng;
        came[nk] = cur;
        open.push(nk, ng + h(nk));
      }
    }
  }

  if (came[goal] === -1) return null;
  const path: Point[] = [];
  for (let k = goal; k !== start; k = came[k]) path.push({ x: k % W, y: Math.floor(k / W) });
  return path.reverse();
}

export function pathCost(map: TileMap, path: Point[]): number {
  return path.reduce((s, p) => s + TILE_COST[tileAt(map, p.x, p.y)!], 0);
}
