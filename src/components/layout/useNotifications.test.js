import { deriveNotifications } from "./useNotifications";

describe("deriveNotifications — orders", () => {
  const storeType = "laundry";

  test("skips delivered and cancelled orders", () => {
    const orders = [
      { id: "1", status: "delivered" },
      { id: "2", status: "cancelled" },
      { id: "3", status: "completed" },
    ];
    const result = deriveNotifications(orders, [], storeType);
    expect(result).toHaveLength(0);
  });

  test("buckets pending orders", () => {
    const orders = [
      { id: "1", status: "pending" },
      { id: "2", status: "received" },
    ];
    const result = deriveNotifications(orders, [], storeType);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("orders-pending");
    expect(result[0].title).toContain("2 orders");
  });

  test("buckets in-progress orders", () => {
    const orders = [{ id: "1", status: "in_process" }];
    const result = deriveNotifications(orders, [], storeType);
    expect(result[0].kind).toBe("orders-in-progress");
    expect(result[0].title).toContain("1 order"); // singular
    expect(result[0].title).not.toContain("orders");
  });

  test("buckets ready orders", () => {
    const orders = [{ id: "1", status: "ready" }];
    const result = deriveNotifications(orders, [], storeType);
    expect(result[0].kind).toBe("orders-ready");
  });

  test("deep-links use the store's order list route", () => {
    const orders = [{ id: "1", status: "pending" }];
    expect(deriveNotifications(orders, [], "laundry")[0].href).toBe("/laundry-orders");
    expect(deriveNotifications(orders, [], "service")[0].href).toBe("/service-orders");
    expect(deriveNotifications(orders, [], "hotel")[0].href).toBe("/hotel-tables");
  });

  test("emits one notification per active status bucket", () => {
    const orders = [
      { id: "1", status: "pending" },
      { id: "2", status: "in_process" },
      { id: "3", status: "ready" },
    ];
    const result = deriveNotifications(orders, [], storeType);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.kind).sort()).toEqual([
      "orders-in-progress",
      "orders-pending",
      "orders-ready",
    ]);
  });
});

describe("deriveNotifications — inventory", () => {
  test("flags out-of-stock products", () => {
    // No threshold set, so only the out-of-stock branch triggers.
    const products = [{ id: "1", name: "Detergent", stockQty: 0 }];
    const result = deriveNotifications([], products, "retail");
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("stock-out");
    expect(result[0].title).toContain("1 item");
  });

  test("flags low-stock products below threshold", () => {
    const products = [{ id: "1", name: "Soap", stockQty: 50, lowStockThreshold: 100 }];
    const result = deriveNotifications([], products, "retail");
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe("stock-low");
  });

  test("does not flag products above threshold", () => {
    const products = [{ id: "1", name: "Shampoo", stockQty: 500, lowStockThreshold: 100 }];
    const result = deriveNotifications([], products, "retail");
    expect(result).toHaveLength(0);
  });

  test("samples up to 3 product names in detail", () => {
    const products = [
      { id: "1", name: "A", stockQty: 0 },
      { id: "2", name: "B", stockQty: 0 },
      { id: "3", name: "C", stockQty: 0 },
      { id: "4", name: "D", stockQty: 0 },
      { id: "5", name: "E", stockQty: 0 },
    ];
    const result = deriveNotifications([], products, "retail");
    expect(result[0].detail).toContain("A");
    expect(result[0].detail).toContain("C");
    expect(result[0].detail).not.toContain("D"); // truncated
    expect(result[0].detail).toContain("…");
  });
});

describe("deriveNotifications — defensive", () => {
  test("handles null orders/products without crashing", () => {
    expect(() => deriveNotifications(null, null, "retail")).not.toThrow();
    expect(deriveNotifications(null, null, "retail")).toEqual([]);
  });

  test("handles unknown store type with safe fallback routes", () => {
    const orders = [{ id: "1", status: "pending" }];
    const result = deriveNotifications(orders, [], "unknown_store");
    expect(result[0].href).toBe("/pos");
  });
});
