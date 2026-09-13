import {
  calculatePurchaseOrderTotal,
  lowStockSeverity,
  normalizePoLine,
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

  test("classifies low stock severity", () => {
    expect(lowStockSeverity({ stock: 0, lowStock: 10 })).toBe("out");
    expect(lowStockSeverity({ stock: 4, lowStock: 10 })).toBe("critical");
    expect(lowStockSeverity({ stock: 8, lowStock: 10 })).toBe("low");
  });
});
