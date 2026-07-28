import { mergeSharedItemsIntoCart, replaceLodgingBillItem } from "./sharedCart";

const item = (overrides = {}) => ({
  id: "row-1",
  type: "lodging",
  meta: { roomId: "R101" },
  name: "Room 101 — Room nights",
  qty: 1,
  rate: 1500,
  total: 1500,
  ...overrides,
});

describe("mergeSharedItemsIntoCart — room scoping", () => {
  test("cart already open for R201 only pulls R201 lodging rows from the shared store", () => {
    const prev = [item({ id: "R201-row", meta: { roomId: "R201" } })];
    const shared = [
      // Stale room booking rows for OTHER rooms (left in the shared store
      // because their bills haven't been saved yet).
      item({ id: "R101-row", meta: { roomId: "R101" } }),
      item({ id: "R102-row", meta: { roomId: "R102" } }),
      // The row for the active room.
      item({ id: "R201-row-extra", meta: { roomId: "R201" } }),
    ];
    const result = mergeSharedItemsIntoCart(prev, shared);
    const rooms = result
      .filter((it) => it.type === "lodging" && it.meta?.roomId)
      .map((it) => it.meta.roomId);
    expect(new Set(rooms)).toEqual(new Set(["R201"]));
    // Both R201 rows are present.
    expect(result.find((it) => it.id === "R201-row")).toBeDefined();
    expect(result.find((it) => it.id === "R201-row-extra")).toBeDefined();
    // R101 and R102 rows were filtered out.
    expect(result.find((it) => it.id === "R101-row")).toBeUndefined();
    expect(result.find((it) => it.id === "R102-row")).toBeUndefined();
  });

  test("empty cart hydrates from the first lodging row in the shared store (fresh Quick Book)", () => {
    // Simulates the path: cashier clicks Quick Book → shared store has the
    // new room's row → cashier navigates to /pos and the cart hydrates.
    const shared = [
      item({ id: "R101-row", meta: { roomId: "R101" } }),
      item({ id: "R102-row", meta: { roomId: "R102" } }),
    ];
    const result = mergeSharedItemsIntoCart([], shared);
    // Whichever room is first in the shared store becomes the active one.
    // The cart must still not pull in both rooms.
    const rooms = result
      .filter((it) => it.type === "lodging" && it.meta?.roomId)
      .map((it) => it.meta.roomId);
    expect(new Set(rooms).size).toBe(1);
  });

  test("non-lodging rows (dining bills, custom additions) are not room-filtered", () => {
    const prev = [item({ id: "R201-row", meta: { roomId: "R201" } })];
    const diningRow = { id: "dining-1", type: "dining", name: "Naan", total: 50 };
    const shared = [diningRow];
    const result = mergeSharedItemsIntoCart(prev, shared);
    expect(result.find((it) => it.id === "dining-1")).toBeDefined();
  });

  test("returns the same array reference when shared is empty", () => {
    const prev = [item({ id: "R201-row", meta: { roomId: "R201" } })];
    expect(mergeSharedItemsIntoCart(prev, [])).toBe(prev);
    expect(mergeSharedItemsIntoCart(prev, null)).toBe(prev);
  });

  test("merges the matched row by id, preserving local cart fields when present", () => {
    const prev = [
      item({
        id: "R201-row",
        meta: { roomId: "R201", gst: 12 },
        // cashier-edited field — should be preserved
        name: "Room 201 — edited name",
      }),
    ];
    const shared = [
      item({
        id: "R201-row",
        meta: { roomId: "R201", gst: 18 },
        name: "Room 201 — Room nights (from store)",
      }),
    ];
    const result = mergeSharedItemsIntoCart(prev, shared);
    const merged = result.find((it) => it.id === "R201-row");
    expect(merged).toBeDefined();
    // The shared version's fields win on merge for that row.
    expect(merged.name).toBe("Room 201 — Room nights (from store)");
    expect(merged.meta.gst).toBe(18);
  });
});

describe("replaceLodgingBillItem", () => {
  test("replaces a lodging row by id and keeps non-lodging items", () => {
    const prev = [
      { id: "dining-1", type: "dining", name: "Naan", total: 50 },
      item({ id: "R201-row", meta: { roomId: "R201" } }),
    ];
    const next = item({ id: "R201-row", meta: { roomId: "R201" }, total: 2400 });
    const result = replaceLodgingBillItem(prev, next);
    expect(result.find((it) => it.id === "dining-1")).toBeDefined();
    expect(result.find((it) => it.id === "R201-row").total).toBe(2400);
    // Only one R201 row remains.
    expect(result.filter((it) => it.meta?.roomId === "R201").length).toBe(1);
  });

  test("inserts a new row when no match exists", () => {
    const result = replaceLodgingBillItem([], item({ id: "R201-row" }));
    expect(result).toHaveLength(1);
  });

  test("returns prevItems unchanged when nextItem is null", () => {
    const prev = [item({ id: "R201-row" })];
    expect(replaceLodgingBillItem(prev, null)).toBe(prev);
  });
});
