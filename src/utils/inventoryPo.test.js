import {
  calculatePurchaseOrderTotal,
  getVisibleInventoryTabKeys,
  isServiceStoreType,
  lowStockSeverity,
  normalizePoLine,
  sanitizeInventoryTab,
  validatePurchaseOrder,
} from "./inventoryPo";

describe("inventory purchase-order helpers", () => {
  test("normalizes legacy line names and calculates totals", () => {
    const line = normalizePoLine({ productId: "12", name: "Soap", qty: "2", unitCost: "15.50" });
    expect(line).toEqual({ productId: 12, productName: "Soap", quantity: 2, unitPrice: 15.5 });
    expect(calculatePurchaseOrderTotal([line])).toBe(31);
  });

  test("requires a supplier and valid purchase-order lines", () => {
    expect(validatePurchaseOrder({ poNumber: "", date: "", lines: [] })).toEqual(
      expect.objectContaining({
        poNumber: expect.any(String),
        date: expect.any(String),
        supplier: expect.any(String),
        items: expect.any(String),
      })
    );
    expect(
      validatePurchaseOrder({
        poNumber: "PO-1",
        date: "2026-09-13",
        supplierName: "Vendor",
        lines: [{ productName: "Soap", quantity: 2, unitPrice: 15 }],
      })
    ).toEqual({});
  });

  test("validates the modal's items payload", () => {
    expect(
      validatePurchaseOrder({
        poNumber: "PO-2",
        date: "2026-09-13",
        supplierName: "Vendor",
        items: [{ productId: 12, productName: "Soap", quantity: 2, unitPrice: 15 }],
      })
    ).toEqual({});
  });

  test("exposes only service-compatible inventory tabs", () => {
    expect(isServiceStoreType("service")).toBe(true);
    expect(isServiceStoreType("msme-service")).toBe(true);
    expect(isServiceStoreType("retail")).toBe(false);
    expect(getVisibleInventoryTabKeys("service")).toEqual(["suppliers", "pos"]);
    expect(getVisibleInventoryTabKeys("msme-service")).toEqual(["suppliers", "pos"]);
    expect(getVisibleInventoryTabKeys("inventory")).toEqual([
      "alerts",
      "suppliers",
      "pos",
      "movements",
    ]);
  });

  test("sanitizes persisted tabs when switching store types", () => {
    expect(sanitizeInventoryTab("alerts", "service")).toBe("suppliers");
    expect(sanitizeInventoryTab("movements", "msme-service")).toBe("suppliers");
    expect(sanitizeInventoryTab("pos", "service")).toBe("pos");
    expect(sanitizeInventoryTab("unknown", "retail")).toBe("alerts");
  });

  test("classifies low stock severity", () => {
    expect(lowStockSeverity({ stock: 0, lowStock: 10 })).toBe("out");
    expect(lowStockSeverity({ stock: 4, lowStock: 10 })).toBe("critical");
    expect(lowStockSeverity({ stock: 8, lowStock: 10 })).toBe("low");
  });
});
