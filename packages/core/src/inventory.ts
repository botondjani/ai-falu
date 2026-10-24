export type Item = "kenyér" | "gabona" | "fa" | "szerszám" | "liszt";
export type Inventory = Partial<Record<Item, number>>;

export function count(inv: Inventory, item: Item): number {
  return inv[item] ?? 0;
}

export function has(inv: Inventory, item: Item, qty = 1): boolean {
  return count(inv, item) >= qty;
}

export function add(inv: Inventory, item: Item, qty = 1): void {
  if (qty < 0 || !Number.isInteger(qty)) throw new Error(`add: invalid qty ${qty}`);
  inv[item] = count(inv, item) + qty;
}

/** Levon; ha nincs elég, nem módosít és false-t ad. */
export function remove(inv: Inventory, item: Item, qty = 1): boolean {
  if (qty < 0 || !Number.isInteger(qty)) throw new Error(`remove: invalid qty ${qty}`);
  const c = count(inv, item);
  if (c < qty) return false;
  if (c === qty) delete inv[item];
  else inv[item] = c - qty;
  return true;
}

/** Atomikus áthelyezés két készlet között. */
export function transfer(from: Inventory, to: Inventory, item: Item, qty = 1): boolean {
  if (!remove(from, item, qty)) return false;
  add(to, item, qty);
  return true;
}
