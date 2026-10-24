import { add, count, has, remove, type Inventory, type Item } from "./inventory";
import type { Rng } from "./rng";
import type { Agent, SimEvent, WorldState } from "./types";

/** Alapár tallérban (ekkora áron ad el a bolt, ha a készlet épp a célszinten van). */
export const BASE_PRICE: Record<Item, number> = { kenyér: 4, gabona: 3, fa: 3, szerszám: 12, liszt: 3, hal: 5, gyógyfű: 6 };
/** A bolt kívánt készlete; e fölött olcsóbb, alatta drágább. Az ötszöröséig vásárol fel (raktár). */
export const TARGET_STOCK: Record<Item, number> = { kenyér: 12, gabona: 8, fa: 8, szerszám: 3, liszt: 0, hal: 6, gyógyfű: 4 };
export const FOOD: Item[] = ["kenyér", "hal"];
export const SALARY_PER_HOUR = 2;
export const BUY_MARGIN = 0.7;

export const SHOP = "bolt";
export const TAVERN = "kocsma";

/** Termelés óránként: mi kell hozzá és mennyi lesz belőle. */
export const RECIPES: Partial<Record<Item, { input?: Item; output: number; toolBonus?: number }>> = {
  gabona: { output: 1, toolBonus: 1 },
  fa: { output: 1, toolBonus: 1 },
  hal: { output: 1, toolBonus: 1 },
  gyógyfű: { output: 1 },
  kenyér: { input: "gabona", output: 2 },
  szerszám: { input: "fa", output: 1 },
};
/** A városi vásár ennyit fizet az alapár arányában (a falu fölöslegéért). */
export const EXPORT_PRICE_RATIO = 0.5;
/** Ennyit tart meg a termelő a saját termékéből (a többit eladja a boltnak). */
const KEEP: Partial<Record<Item, number>> = { kenyér: 2, hal: 2 };
const TOOL_BREAK_CHANCE = 0.04;

/** A bolt eladási ára: alapár × √(cél / készlet), 0.5×–2.5× között. */
export function priceOf(stock: Inventory, item: Item): number {
  const ratio = Math.sqrt((TARGET_STOCK[item] + 1) / (count(stock, item) + 1));
  return Math.max(1, Math.round(BASE_PRICE[item] * Math.min(2.5, Math.max(0.5, ratio))));
}

/** Ennyit fizet a bolt, ha felvásárol. */
export function buyPriceOf(stock: Inventory, item: Item): number {
  return Math.max(1, Math.floor(priceOf(stock, item) * BUY_MARGIN));
}

export function mealPrice(state: WorldState): number {
  return priceOf(state.stocks[SHOP], "kenyér") + 3;
}

export function currentPrices(state: WorldState): Partial<Record<Item, number>> {
  const out: Partial<Record<Item, number>> = {};
  for (const item of Object.keys(TARGET_STOCK) as Item[]) if (TARGET_STOCK[item] > 0) out[item] = priceOf(state.stocks[SHOP], item);
  return out;
}

/** A hely tulajdonosa (boltos, kocsmáros): az első, aki ott dolgozik és nem alkalmazott. */
export function ownerOf(state: WorldState, locationId: string): Agent | undefined {
  const workers = state.agents.filter((a) => a.workplaceId === locationId);
  return workers.find((a) => /boltos|kocsmáros/.test(a.occupation)) ?? workers[0];
}

export function foodAtHome(agent: Agent): Item | undefined {
  return FOOD.find((f) => has(agent.inventory, f));
}

/** Vásárlás a boltból (pénz a boltos tulajdonoshoz). Ennyit tudott venni. */
export function buyFromShop(state: WorldState, buyer: Agent, item: Item, qty: number, into: Inventory, events: SimEvent[]): number {
  const shop = state.stocks[SHOP];
  const owner = ownerOf(state, SHOP);
  let bought = 0;
  let paid = 0;
  while (bought < qty && has(shop, item)) {
    const price = priceOf(shop, item);
    if (buyer.money < price) break;
    remove(shop, item);
    add(into, item);
    buyer.money -= price;
    if (owner && owner !== buyer) owner.money += price;
    bought++;
    paid += price;
  }
  if (bought > 0) events.push({ tick: state.tick, type: "bought", agentId: buyer.id, item, qty: bought, price: paid, from: SHOP });
  return bought;
}

/** Eladás a boltnak, amíg a bolt akar és tud fizetni. */
export function sellToShop(state: WorldState, seller: Agent, item: Item, qty: number, events: SimEvent[]): number {
  const shop = state.stocks[SHOP];
  const owner = ownerOf(state, SHOP);
  let sold = 0;
  let got = 0;
  while (sold < qty && count(shop, item) < TARGET_STOCK[item] * 5) {
    const price = buyPriceOf(shop, item);
    if (owner && owner !== seller) {
      if (owner.money < price) break;
      owner.money -= price;
    }
    if (!remove(seller.inventory, item)) break;
    add(shop, item);
    seller.money += price;
    sold++;
    got += price;
  }
  if (sold > 0) events.push({ tick: state.tick, type: "sold", agentId: seller.id, item, qty: sold, price: got, to: SHOP });
  return sold;
}

/** Egy munkaóra hatása: termelés (alapanyag-vásárlással), eladás, fizetés, kocsmai utánpótlás. */
export function workHour(state: WorldState, agent: Agent, rng: Rng, events: SimEvent[]) {
  const tick = state.tick;
  const item = agent.produces;
  const recipe = item ? RECIPES[item] : undefined;

  if (item && recipe) {
    if (recipe.input && !has(agent.inventory, recipe.input)) buyFromShop(state, agent, recipe.input, 2, agent.inventory, events);
    if (recipe.input && !remove(agent.inventory, recipe.input)) {
      events.push({ tick, type: "no_input", agentId: agent.id, item: recipe.input });
    } else {
      const withTool = recipe.toolBonus !== undefined && has(agent.inventory, "szerszám");
      const qty = recipe.output + (withTool ? recipe.toolBonus! : 0);
      add(agent.inventory, item, qty);
      events.push({ tick, type: "produced", agentId: agent.id, item, qty, locationId: agent.workplaceId });
      if (withTool && rng.chance(TOOL_BREAK_CHANCE)) {
        remove(agent.inventory, "szerszám");
        events.push({ tick, type: "tool_broke", agentId: agent.id });
      }
    }
    const surplus = count(agent.inventory, item) - (KEEP[item] ?? 0);
    if (surplus > 0) sellToShop(state, agent, item, surplus, events);
    // A szerszámmal dolgozók pótolják az eltört szerszámot, ha telik rá.
    if (recipe.toolBonus !== undefined && !has(agent.inventory, "szerszám")) {
      const p = priceOf(state.stocks[SHOP], "szerszám");
      if (agent.money >= p * 2) buyFromShop(state, agent, "szerszám", 1, agent.inventory, events);
    }
    return;
  }

  const shopOwner = ownerOf(state, SHOP);
  const tavernOwner = ownerOf(state, TAVERN);
  if (agent === shopOwner) return; // a boltos a haszonkulcsból él
  if (agent === tavernOwner) {
    // utánpótlás: legyen étel a kocsmában
    const tavern = state.stocks[TAVERN];
    const food = FOOD.reduce((n, f) => n + count(tavern, f), 0);
    if (food < 4) {
      const cheaper = FOOD.slice().sort((x, y) => priceOf(state.stocks[SHOP], x) - priceOf(state.stocks[SHOP], y));
      for (const f of cheaper) if (buyFromShop(state, agent, f, 3, tavern, events) > 0) break;
    }
    return;
  }
  // Alkalmazottak és közszereplők: órabér (a kocsma alkalmazottjának a kocsmáros fizet, ha tud).
  const payer = agent.workplaceId === TAVERN && tavernOwner && tavernOwner.money >= SALARY_PER_HOUR ? tavernOwner : undefined;
  if (payer) payer.money -= SALARY_PER_HOUR;
  agent.money += SALARY_PER_HOUR;
  events.push({ tick, type: "earned", agentId: agent.id, amount: SALARY_PER_HOUR, reason: payer ? `bér (${payer.name})` : "bér" });
}

/**
 * Reggelente a boltos a célszint kétszerese fölötti készletet elviszi a városi vásárba.
 * Ez a falu külső piaca: pénzt hoz be, és megakadályozza, hogy a bolt megteljen és leálljon a felvásárlás.
 */
export function exportSurplus(state: WorldState, events: SimEvent[]) {
  const shop = state.stocks[SHOP];
  const owner = ownerOf(state, SHOP);
  for (const item of Object.keys(TARGET_STOCK) as Item[]) {
    // a célszint másfélszeresére visszük le a készletet
    const qty = count(shop, item) - Math.round(TARGET_STOCK[item] * 1.5);
    if (qty <= 0) continue;
    remove(shop, item, qty);
    const income = Math.floor(qty * BASE_PRICE[item] * EXPORT_PRICE_RATIO);
    if (owner) owner.money += income;
    events.push({ tick: state.tick, type: "exported", agentId: owner?.id ?? "", item, qty, price: income });
  }
}

/** Kezdő készletek a boltban és a kocsmában. */
export function initialStocks(): Record<string, Inventory> {
  return {
    [SHOP]: { kenyér: 10, gabona: 6, fa: 6, szerszám: 3, hal: 4, gyógyfű: 2 },
    [TAVERN]: { kenyér: 4, hal: 4 },
  };
}
