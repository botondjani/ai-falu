import { describe, expect, it } from "vitest";
import { add, count, has, remove, transfer, type Inventory } from "../src/inventory";

describe("készlet", () => {
  it("hozzáad és lekérdez", () => {
    const inv: Inventory = {};
    add(inv, "kenyér", 3);
    expect(count(inv, "kenyér")).toBe(3);
    expect(has(inv, "kenyér", 3)).toBe(true);
    expect(has(inv, "kenyér", 4)).toBe(false);
    expect(count(inv, "fa")).toBe(0);
  });

  it("nem enged negatívba menni", () => {
    const inv: Inventory = { fa: 1 };
    expect(remove(inv, "fa", 2)).toBe(false);
    expect(count(inv, "fa")).toBe(1);
    expect(remove(inv, "fa", 1)).toBe(true);
    expect(inv).toEqual({});
  });

  it("érvénytelen mennyiség hibát dob", () => {
    expect(() => add({}, "fa", -1)).toThrow();
    expect(() => add({}, "fa", 1.5)).toThrow();
  });

  it("áthelyezés atomikus", () => {
    const a: Inventory = { gabona: 2 };
    const b: Inventory = {};
    expect(transfer(a, b, "gabona", 3)).toBe(false);
    expect(a).toEqual({ gabona: 2 });
    expect(b).toEqual({});
    expect(transfer(a, b, "gabona", 2)).toBe(true);
    expect(a).toEqual({});
    expect(b).toEqual({ gabona: 2 });
  });
});
