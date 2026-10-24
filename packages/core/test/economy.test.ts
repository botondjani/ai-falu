import { describe, expect, it } from "vitest";
import {
  BASE_PRICE,
  TARGET_STOCK,
  buyFromShop,
  buyPriceOf,
  exportSurplus,
  ownerOf,
  priceOf,
  sellToShop,
  workHour,
} from "../src/economy";
import { count } from "../src/inventory";
import { Rng } from "../src/rng";
import { VILLAGERS } from "../src/seed/villagers";
import { TICKS_PER_DAY } from "../src/time";
import type { SimEvent } from "../src/types";
import { createWorld, stepWorld } from "../src/world";

const totalMoney = (w: ReturnType<typeof createWorld>) => w.state.agents.reduce((s, a) => s + a.money, 0);
const agent = (w: ReturnType<typeof createWorld>, id: string) => w.state.agents.find((a) => a.id === id)!;

describe("árak", () => {
  it("célkészletnél alapár, hiánynál drágább, bőségnél olcsóbb, korlátok között", () => {
    expect(priceOf({ kenyér: TARGET_STOCK.kenyér }, "kenyér")).toBe(BASE_PRICE.kenyér);
    expect(priceOf({ kenyér: 1 }, "kenyér")).toBeGreaterThan(BASE_PRICE.kenyér);
    expect(priceOf({ kenyér: 100 }, "kenyér")).toBeLessThan(BASE_PRICE.kenyér);
    expect(priceOf({}, "szerszám")).toBeLessThanOrEqual(BASE_PRICE.szerszám * 2.5);
    expect(priceOf({ szerszám: 1000 }, "szerszám")).toBeGreaterThanOrEqual(Math.round(BASE_PRICE.szerszám * 0.5));
    for (let s = 0; s < 40; s++) expect(priceOf({ hal: s + 1 }, "hal")).toBeLessThanOrEqual(priceOf({ hal: s }, "hal"));
  });

  it("a bolt olcsóbban vesz, mint ahogy elad", () => {
    for (const s of [0, 3, 10, 50]) expect(buyPriceOf({ fa: s }, "fa")).toBeLessThan(priceOf({ fa: s }, "fa"));
  });
});

describe("kereskedés", () => {
  it("vásárlás és eladás: a pénz a vevő és a boltos között mozog, összege nem változik", () => {
    const w = createWorld("t", VILLAGERS);
    const owner = ownerOf(w.state, "bolt")!;
    expect(owner.id).toBe("eszter");
    const before = totalMoney(w);
    const mari = agent(w, "mari");
    const ev: SimEvent[] = [];
    const n = buyFromShop(w.state, mari, "kenyér", 2, mari.inventory, ev);
    expect(n).toBe(2);
    expect(totalMoney(w)).toBe(before);
    const lajos = agent(w, "lajos");
    lajos.inventory.hal = 5;
    expect(sellToShop(w.state, lajos, "hal", 5, ev)).toBe(5);
    expect(totalMoney(w)).toBe(before);
    expect(ev.map((e) => e.type)).toEqual(["bought", "sold"]);
  });

  it("pénz nélkül nincs vásárlás; üres bolt nem ad", () => {
    const w = createWorld("t", VILLAGERS);
    const j = agent(w, "joska");
    j.money = 0;
    expect(buyFromShop(w.state, j, "kenyér", 1, j.inventory, [])).toBe(0);
    j.money = 100;
    w.state.stocks.bolt.gyógyfű = 0;
    expect(buyFromShop(w.state, j, "gyógyfű", 1, j.inventory, [])).toBe(0);
  });

  it("csődbe ment boltos nem tud felvásárolni", () => {
    const w = createWorld("t", VILLAGERS);
    agent(w, "eszter").money = 0;
    const p = agent(w, "pista");
    p.inventory.fa = 3;
    expect(sellToShop(w.state, p, "fa", 3, [])).toBe(0);
    expect(p.inventory.fa).toBe(3);
  });

  it("export: a fölösleg a városba megy, a boltos pénzt kap", () => {
    const w = createWorld("t", VILLAGERS);
    w.state.stocks.bolt.gabona = 40;
    const e = agent(w, "eszter");
    const m = e.money;
    const ev: SimEvent[] = [];
    exportSurplus(w.state, ev);
    expect(count(w.state.stocks.bolt, "gabona")).toBe(Math.round(TARGET_STOCK.gabona * 1.5));
    expect(e.money).toBeGreaterThan(m);
    expect(ev[0]).toMatchObject({ type: "exported", item: "gabona" });
  });
});

describe("termelés", () => {
  it("a pék gabonából kenyeret süt, a fölösleget eladja", () => {
    const w = createWorld("t", VILLAGERS);
    const mari = agent(w, "mari");
    mari.inventory = { gabona: 1, kenyér: 2 };
    const ev: SimEvent[] = [];
    workHour(w.state, mari, new Rng(1), ev);
    expect(ev.find((e) => e.type === "produced")).toMatchObject({ item: "kenyér", qty: 2 });
    expect(ev.some((e) => e.type === "sold")).toBe(true);
    expect(count(mari.inventory, "kenyér")).toBe(2);
    expect(count(mari.inventory, "gabona")).toBe(0);
  });

  it("alapanyag nélkül (és ha a boltban sincs) nincs termelés", () => {
    const w = createWorld("t", VILLAGERS);
    const bela = agent(w, "bela");
    bela.inventory = {};
    w.state.stocks.bolt.fa = 0;
    const ev: SimEvent[] = [];
    workHour(w.state, bela, new Rng(1), ev);
    expect(ev.map((e) => e.type)).toEqual(["no_input"]);
  });

  it("szerszámmal többet termel a földműves", () => {
    const w = createWorld("t", VILLAGERS);
    const j = agent(w, "joska");
    j.inventory = { szerszám: 1 };
    w.state.stocks.bolt.gabona = 1000; // ne tudja eladni, hogy lássuk a mennyiséget
    agent(w, "eszter").money = 0;
    const ev: SimEvent[] = [];
    workHour(w.state, j, new Rng(99), ev);
    expect(ev.find((e) => e.type === "produced")).toMatchObject({ qty: 2 });
  });

  it("a teljes falu 10 napig éhezés nélkül, működő piaccal fut", () => {
    const w = createWorld("t", VILLAGERS);
    const types = new Map<string, number>();
    for (let i = 0; i < 10 * TICKS_PER_DAY; i++)
      for (const e of stepWorld(w).events) types.set(e.type, (types.get(e.type) ?? 0) + 1);
    expect(types.get("starving") ?? 0).toBeLessThan(20);
    expect(types.get("sold")).toBeGreaterThan(100);
    expect(types.get("bought")).toBeGreaterThan(50);
    for (const a of w.state.agents) expect(a.money).toBeGreaterThanOrEqual(0);
  });
});
