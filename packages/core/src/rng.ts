/** Seedelt, szerializálható PRNG (mulberry32). Az állapot egyetlen uint32, így snapshotba menthető. */
export class Rng {
  constructor(public state: number) {
    this.state = state >>> 0;
  }

  static fromSeed(seed: string | number): Rng {
    if (typeof seed === "number") return new Rng(seed);
    // FNV-1a hash a szöveges seedhez
    let h = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return new Rng(h >>> 0);
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** egész [min, max] */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("pick: empty array");
    return items[Math.floor(this.next() * items.length)];
  }
}

/** Állapotmentes determinisztikus hash egészekhez (pl. térkép-dekorációhoz). */
export function hash2(x: number, y: number, salt = 0): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
