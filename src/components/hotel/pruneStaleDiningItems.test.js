// src/components/hotel/pruneStaleDiningItems.test.js
//
// Pure-function unit tests for `pruneStaleDiningItems`. The companion
// useEffect in HotelBilling calls this on every `diningBillsByTable` /
// `tables` update to keep the Dining tab badge (`diningCount`) honest —
// once a table is settled (no booking, no open bill), any leftover
// dining line in the cart must be dropped so the cashier doesn't see a
// stale "5" badge after clearing all tables.

import { pruneStaleDiningItems } from "./HotelBilling";

const line = (id, tableId, qty = 1) => ({
  id,
  name: `Item ${id}`,
  type: "dining",
  qty,
  rate: 100,
  total: 100 * qty,
  meta: { tableId },
});

describe("pruneStaleDiningItems", () => {
  test("returns the SAME reference when there is nothing to do", () => {
    const items = [];
    const out = pruneStaleDiningItems(items, [], {});
    expect(out).toBe(items);
  });

  test("returns the same reference when no dining items are present", () => {
    const items = [
      { id: "l1", type: "lodging", name: "Room", qty: 1, rate: 100, total: 100, meta: {} },
    ];
    const out = pruneStaleDiningItems(items, [], {});
    expect(out).toBe(items);
  });

  test("keeps dining items when their table is currently booked", () => {
    const items = [line("a", "T1"), line("b", "T2")];
    const tables = [
      { id: "T1", status: "booked" },
      { id: "T2", status: "empty" },
    ];
    const out = pruneStaleDiningItems(items, tables, {});
    // T2 has no booking and no open bill, so it gets dropped.
    expect(out).toEqual([line("a", "T1")]);
  });

  test("keeps dining items when their table has an open bill (even if empty status)", () => {
    const items = [line("a", "T1"), line("b", "T2")];
    const tables = [
      { id: "T1", status: "empty" },
      { id: "T2", status: "empty" },
    ];
    const diningBillsByTable = {
      T1: { tableId: "T1", items: [{ id: "x" }] },
    };
    const out = pruneStaleDiningItems(items, tables, diningBillsByTable);
    expect(out).toEqual([line("a", "T1")]);
  });

  test("drops dining items when their table is neither booked nor has an open bill", () => {
    // Reproduces the user's bug: 5 dining lines for tables T1..T5 after
    // each has been cleared + billed. The server-side bills are gone,
    // the tables are all "empty", but the local cart still holds the
    // lines — the GC pass should drop every one of them.
    const items = [
      line("a", "T1"),
      line("b", "T2"),
      line("c", "T3"),
      line("d", "T4"),
      line("e", "T5"),
    ];
    const tables = [
      { id: "T1", status: "empty" },
      { id: "T2", status: "empty" },
      { id: "T3", status: "empty" },
      { id: "T4", status: "empty" },
      { id: "T5", status: "empty" },
    ];
    const out = pruneStaleDiningItems(items, tables, {});
    expect(out).toEqual([]);
  });

  test("keeps dining items with no tableId (legacy / orphaned rows)", () => {
    const items = [
      line("a", "T1"),
      { id: "legacy", type: "dining", name: "Orphan", qty: 1, rate: 100, total: 100, meta: {} },
    ];
    const out = pruneStaleDiningItems(items, [], {});
    expect(out).toEqual([
      {
        id: "legacy",
        type: "dining",
        name: "Orphan",
        qty: 1,
        rate: 100,
        total: 100,
        meta: {},
      },
    ]);
  });

  test("keeps every non-dining line regardless of meta", () => {
    const items = [
      line("a", "T1"),
      {
        id: "l1",
        type: "lodging",
        name: "Room 101",
        qty: 1,
        rate: 2200,
        total: 2200,
        meta: { roomId: "101" },
      },
      {
        id: "s1",
        type: "service",
        name: "Spa",
        qty: 1,
        rate: 500,
        total: 500,
        meta: {},
      },
    ];
    const out = pruneStaleDiningItems(items, [], {});
    // Only the dining line for T1 is dropped; lodging + service stay.
    expect(out).toHaveLength(2);
    expect(out.map((it) => it.type)).toEqual(["lodging", "service"]);
  });

  test("ignores open bills whose items array is empty", () => {
    // When a bill is freshly cleared by releaseDiningTableAfterBilling,
    // diningBillsByTable[id] may still hold an entry with items: []. That
    // entry should NOT keep the stale cart line alive — we want the GC
    // to drop the line so the badge returns to 0.
    const items = [line("a", "T1")];
    const diningBillsByTable = {
      T1: { tableId: "T1", items: [] },
    };
    const out = pruneStaleDiningItems(items, [], diningBillsByTable);
    expect(out).toEqual([]);
  });

  test("returns the same reference when every dining line is still valid", () => {
    const items = [line("a", "T1"), line("b", "T2")];
    const tables = [
      { id: "T1", status: "booked" },
      { id: "T2", status: "booked" },
    ];
    const out = pruneStaleDiningItems(items, tables, {});
    expect(out).toBe(items);
  });
});
