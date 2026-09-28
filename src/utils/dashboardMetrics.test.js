import {
  buildSalesSummary,
  buildNetSales,
  buildPaymentBreakdown,
  densifyTrend,
  isSingleDayRange,
  buildNeedsAttention,
  isSectionUnavailable,
} from "./dashboardMetrics";

describe("dashboardMetrics", () => {
  describe("buildSalesSummary", () => {
    test("returns null when the section is unavailable, not a zeroed object", () => {
      expect(buildSalesSummary(null)).toBeNull();
      expect(buildSalesSummary(undefined)).toBeNull();
    });

    test("prefers netInvoiceCount so cancelled bills are not counted as sales", () => {
      const s = buildSalesSummary({
        invoiceCount: 10,
        netInvoiceCount: 8,
        cancelledCount: 2,
        grandTotal: 1000,
        subTotal: 900,
        gstTotal: 100,
        discountTotal: 50,
        grossTotal: 950,
        averageBill: 100,
      });
      expect(s.invoiceCount).toBe(8);
      expect(s.cancelledCount).toBe(2);
    });

    test("coerces string decimals from the DB into numbers", () => {
      const s = buildSalesSummary({
        grandTotal: "45280.50",
        subTotal: "40000",
        discountTotal: "0",
        netInvoiceCount: "128",
      });
      expect(s.grandTotal).toBe(45280.5);
      expect(s.invoiceCount).toBe(128);
      expect(s.hasDiscount).toBe(false);
    });
  });

  describe("buildNetSales", () => {
    test("subtracts returns from gross sales", () => {
      const sales = buildSalesSummary({ grandTotal: 1000, netInvoiceCount: 5 });
      expect(buildNetSales(sales, { total: 250 })).toBe(750);
    });

    test("treats unavailable returns as zero rather than NaN", () => {
      const sales = buildSalesSummary({ grandTotal: 1000, netInvoiceCount: 5 });
      expect(buildNetSales(sales, null)).toBe(1000);
    });
  });

  describe("buildPaymentBreakdown", () => {
    test("returns null for an empty or zero-total period", () => {
      expect(buildPaymentBreakdown([])).toBeNull();
      expect(buildPaymentBreakdown(null)).toBeNull();
      expect(buildPaymentBreakdown([{ mode: "Cash", total: 0, invoiceCount: 0 }])).toBeNull();
    });

    test("computes each bucket's share of the total", () => {
      const b = buildPaymentBreakdown([
        { mode: "Cash", total: 20000, invoiceCount: 40 },
        { mode: "UPI", total: 15000, invoiceCount: 30 },
        { mode: "Card", total: 10000, invoiceCount: 20 },
      ]);
      expect(b.total).toBe(45000);
      expect(b.items[0].share).toBe(44.4);
      expect(b.items[1].share).toBe(33.3);
    });

    test("drops zero-value buckets but keeps the real ones", () => {
      const b = buildPaymentBreakdown([
        { mode: "Cash", total: 100, invoiceCount: 1 },
        { mode: "Card", total: 0, invoiceCount: 0 },
      ]);
      expect(b.items).toHaveLength(1);
      expect(b.items[0].mode).toBe("Cash");
    });

    test("flags that split/other payments exist so the UI can footnote them", () => {
      const b = buildPaymentBreakdown([{ mode: "Other", total: 500, invoiceCount: 2 }]);
      expect(b.hasSplit).toBe(true);
    });
  });

  describe("densifyTrend", () => {
    test("fills days with no invoices so gaps do not collapse the chart", () => {
      const points = densifyTrend(
        [
          { day: "2026-03-01", revenue: 100, invoiceCount: 1 },
          { day: "2026-03-03", revenue: 300, invoiceCount: 2 },
        ],
        { from: "2026-03-01", to: "2026-03-03" }
      );
      expect(points).toHaveLength(3);
      expect(points[1].revenue).toBe(0);
      expect(points[2].revenue).toBe(300);
    });

    test("caps the number of points so a wide range stays legible", () => {
      const points = densifyTrend([], { from: "2026-01-01", to: "2026-12-31", maxPoints: 5 });
      expect(points).toHaveLength(5);
    });

    test("falls back to raw rows when the range is unusable", () => {
      const rows = [{ day: "2026-03-01", revenue: 100, invoiceCount: 1 }];
      expect(densifyTrend(rows, { from: "", to: "" })).toEqual(rows);
      expect(densifyTrend(rows, { from: "junk", to: "junk" })).toEqual(rows);
    });
  });

  test("isSingleDayRange identifies a period with no trend to draw", () => {
    expect(isSingleDayRange("2026-03-07", "2026-03-07")).toBe(true);
    expect(isSingleDayRange("2026-03-01", "2026-03-07")).toBe(false);
  });

  describe("buildNeedsAttention", () => {
    test("is empty for a healthy period", () => {
      expect(buildNeedsAttention({})).toEqual([]);
      expect(
        buildNeedsAttention({ inventory: { outOfStock: 0, critical: 0, low: 0 }, returns: null })
      ).toEqual([]);
    });

    test("treats an unavailable section as absent, not as an alert", () => {
      const items = buildNeedsAttention({ inventory: null, returns: null, customers: null });
      expect(items).toEqual([]);
    });

    test("escalates out-of-stock ahead of low stock and orders by severity", () => {
      const items = buildNeedsAttention({
        inventory: { outOfStock: 2, critical: 3, low: 5 },
        customers: { pendingCount: 1 },
      });
      expect(items[0].id).toBe("inventory-critical");
      expect(items[0].detail).toBe("2 out of stock · 3 critical");
      expect(items.some((i) => i.id === "customers-pending")).toBe(true);
    });

    test("falls back to a low-stock-only entry when nothing is critical", () => {
      const items = buildNeedsAttention({ inventory: { outOfStock: 0, critical: 0, low: 5 } });
      expect(items).toHaveLength(1);
      expect(items[0].id).toBe("inventory-low");
    });

    test("only counts draft/sent purchase orders as open", () => {
      const items = buildNeedsAttention({
        purchaseOrders: [
          { status: "draft", count: 2 },
          { status: "sent", count: 1 },
          { status: "received", count: 9 },
        ],
      });
      const po = items.find((i) => i.id === "purchase-orders-open");
      expect(po?.count).toBe(3);
    });

    test("every alert links somewhere actionable", () => {
      const items = buildNeedsAttention({
        inventory: { outOfStock: 1, critical: 0, low: 0 },
        returns: { unsettledCount: 2 },
        purchaseOrders: [{ status: "sent", count: 1 }],
        customers: { pendingCount: 1 },
      });
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(typeof item.href).toBe("string");
        expect(item.href.length).toBeGreaterThan(0);
        expect(item.label).toBeTruthy();
      }
    });
  });

  test("isSectionUnavailable distinguishes missing from zero", () => {
    expect(isSectionUnavailable(null)).toBe(true);
    expect(isSectionUnavailable(undefined)).toBe(true);
    expect(isSectionUnavailable({ total: 0 })).toBe(false);
  });
});
