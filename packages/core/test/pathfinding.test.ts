import { describe, expect, it } from "vitest";
import { buildVillageMap } from "../src/map/village";
import { getLocation, isWalkable, type TileMap } from "../src/map/types";
import { findPath, pathCost } from "../src/pathfinding";

function gridFromAscii(rows: string[]): TileMap {
  const tiles = rows.flatMap((r) => [...r].map((c) => (c === "#" ? "fal" : c === "~" ? "víz" : c === "f" ? "erdő" : "út"))) as TileMap["tiles"];
  return { width: rows[0].length, height: rows.length, tiles, locations: [] };
}

describe("útkeresés", () => {
  it("egyenes út nyílt terepen", () => {
    const m = gridFromAscii([".....", ".....", "....."]);
    const p = findPath(m, { x: 0, y: 1 }, { x: 4, y: 1 })!;
    expect(p).toHaveLength(4);
    expect(p.at(-1)).toEqual({ x: 4, y: 1 });
  });

  it("ugyanaz a pont: üres út", () => {
    const m = gridFromAscii(["..."]);
    expect(findPath(m, { x: 1, y: 0 }, { x: 1, y: 0 })).toEqual([]);
  });

  it("megkerüli a falat", () => {
    const m = gridFromAscii([".#...", ".#.#.", "...#."]);
    const p = findPath(m, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(p).not.toBeNull();
    for (const s of p) expect(isWalkable(m, s.x, s.y)).toBe(true);
    // szomszédos lépések
    let prev = { x: 0, y: 0 };
    for (const s of p) {
      expect(Math.abs(s.x - prev.x) + Math.abs(s.y - prev.y)).toBe(1);
      prev = s;
    }
  });

  it("elérhetetlen cél: null", () => {
    const m = gridFromAscii(["..~..", "..~..", "..~.."]);
    expect(findPath(m, { x: 0, y: 0 }, { x: 4, y: 0 })).toBeNull();
    expect(findPath(m, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
  });

  it("az olcsóbb utat választja az erdő helyett", () => {
    const m = gridFromAscii([".fff.", "....."]);
    const p = findPath(m, { x: 0, y: 0 }, { x: 4, y: 0 })!;
    expect(pathCost(m, p)).toBe(6); // le, 4 jobbra, fel = 6 lépés × 1 (erdőn át 1+3+3+3+1 = 11 lenne)
  });

  it("determinisztikus", () => {
    const m = gridFromAscii([".....", ".....", "....."]);
    const a = findPath(m, { x: 0, y: 0 }, { x: 4, y: 2 });
    const b = findPath(m, { x: 0, y: 0 }, { x: 4, y: 2 });
    expect(a).toEqual(b);
  });

  it("a falu minden helyszíne elérhető minden házból", () => {
    const map = buildVillageMap();
    const homes = map.locations.filter((l) => l.kind === "ház");
    for (const h of homes) {
      for (const loc of map.locations) {
        expect(loc.spots.length, loc.id).toBeGreaterThan(0);
        const p = findPath(map, h.spots[0], loc.spots[0]);
        expect(p, `${h.id} -> ${loc.id}`).not.toBeNull();
      }
    }
    expect(getLocation(map, "pekseg").door).toBeDefined();
  });
});
