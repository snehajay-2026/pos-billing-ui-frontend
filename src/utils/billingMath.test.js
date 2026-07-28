import { calcSubTotal, calcGstTotal, calcGrandTotal, round2, formatCurrency } from "./billingMath";

describe("calcSubTotal", () => {
  test("returns 0 for empty array", () => {
    expect(calcSubTotal([])).toBe(0);
  });

  test("returns 0 for non-array input", () => {
    expect(calcSubTotal(null)).toBe(0);
    expect(calcSubTotal(undefined)).toBe(0);
    expect(calcSubTotal("not an array")).toBe(0);
  });

  test("sums price * qty for a single item", () => {
    expect(calcSubTotal([{ price: 100, qty: 2 }])).toBe(200);
  });

  test("sums across multiple items", () => {
    expect(
      calcSubTotal([
        { price: 100, qty: 2 },
        { price: 50, qty: 3 },
      ])
    ).toBe(350);
  });

  test("handles decimal prices", () => {
    expect(calcSubTotal([{ price: 12.5, qty: 4 }])).toBe(50);
  });

  test("coerces string numbers", () => {
    expect(calcSubTotal([{ price: "75", qty: "3" }])).toBe(225);
  });

  test("treats missing qty as 0", () => {
    expect(calcSubTotal([{ price: 100 }])).toBe(0);
  });

  test("treats missing price as 0", () => {
    expect(calcSubTotal([{ qty: 5 }])).toBe(0);
  });

  test("treats NaN values as 0", () => {
    expect(calcSubTotal([{ price: NaN, qty: 5 }])).toBe(0);
    expect(calcSubTotal([{ price: 100, qty: NaN }])).toBe(0);
  });

  test("handles negative quantities (refunds/returns)", () => {
    expect(
      calcSubTotal([
        { price: 100, qty: 2 },
        { price: 50, qty: -1 },
      ])
    ).toBe(150);
  });
});

describe("calcGstTotal", () => {
  test("returns 0 for empty array", () => {
    expect(calcGstTotal([])).toBe(0);
  });

  test("returns 0 when no items have gst", () => {
    expect(calcGstTotal([{ price: 100, qty: 1 }])).toBe(0);
  });

  test("computes 5% GST on a single item", () => {
    // 100 * 2 * 0.05 = 10
    expect(calcGstTotal([{ price: 100, qty: 2, gst: 5 }])).toBe(10);
  });

  test("computes 18% GST across multiple items", () => {
    // (100*1*0.18) + (50*2*0.18) = 18 + 18 = 36
    expect(
      calcGstTotal([
        { price: 100, qty: 1, gst: 18 },
        { price: 50, qty: 2, gst: 18 },
      ])
    ).toBe(36);
  });

  test("mixed GST rates across items", () => {
    // (100*2*0.05) + (200*1*0.12) = 10 + 24 = 34
    expect(
      calcGstTotal([
        { price: 100, qty: 2, gst: 5 },
        { price: 200, qty: 1, gst: 12 },
      ])
    ).toBe(34);
  });

  test("missing gst is treated as 0", () => {
    expect(calcGstTotal([{ price: 100, qty: 1 }])).toBe(0);
  });
});

describe("calcGrandTotal", () => {
  test("subtotal + GST", () => {
    // subtotal = 100 * 2 = 200
    // gst = 200 * 0.05 = 10
    // grand = 210
    expect(calcGrandTotal([{ price: 100, qty: 2, gst: 5 }])).toBe(210);
  });

  test("zero GST returns subtotal", () => {
    expect(calcGrandTotal([{ price: 100, qty: 2, gst: 0 }])).toBe(200);
  });

  test("empty bill returns 0", () => {
    expect(calcGrandTotal([])).toBe(0);
  });
});

describe("round2", () => {
  test("rounds to 2 decimal places", () => {
    expect(round2(1.234)).toBe(1.23);
    expect(round2(1.236)).toBe(1.24);
    expect(round2(99.999)).toBe(100);
  });

  test("rounds negative numbers", () => {
    expect(round2(-1.236)).toBe(-1.24);
  });

  test("treats non-finite as 0", () => {
    expect(round2(NaN)).toBe(0);
    expect(round2(Infinity)).toBe(0);
    expect(round2("not a number")).toBe(0);
  });

  test("rounds cleanly for values already at <=2 decimals (no float drift)", () => {
    // Common money rounding: these all have <=2 decimals and must round-trip.
    expect(round2(19.99)).toBe(19.99);
    expect(round2(0.05)).toBe(0.05);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  test("handles the classic floating-point half-boundary case", () => {
    // 1.005 * 100 = 100.49999... in IEEE 754; without an epsilon this would
    // round down. round2() guards against this so half-cent values round up.
    expect(round2(1.005)).toBe(1.01);
  });
});

describe("formatCurrency", () => {
  test("formats with 2 decimal places", () => {
    // en-IN locale uses lakhs/crores separators — exact digits may vary by
    // Node version. Assert structure rather than exact punctuation.
    const formatted = formatCurrency(1234.5);
    expect(formatted).toMatch(/^[\d,.]+$/);
    expect(formatted).toContain("1,234");
    expect(formatted).toContain(".50");
  });

  test("handles zero", () => {
    expect(formatCurrency(0)).toMatch(/0\.00/);
  });
});
