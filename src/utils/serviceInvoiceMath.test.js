import {
  calculateServiceTotals,
  getServiceLine,
  getServiceUnits,
  numberToWordsIndian,
  resolvePersistedServiceTotals,
  resolveTaxSplit,
} from "./serviceInvoiceMath";

describe("service invoice math", () => {
  test("uses hours as the service quantity", () => {
    const result = calculateServiceTotals([{ name: "Consulting", price: 200, hours: 3 }], 18, 0);
    expect(result.subTotal).toBe(600);
    expect(result.gstTotal).toBe(108);
    expect(result.grandTotal).toBe(708);
    expect(result.lines[0].units).toBe(3);
  });

  test("supports quantity fallbacks and defaults missing quantity to one", () => {
    expect(getServiceUnits({ price: 100, qty: 2 })).toBe(2);
    expect(getServiceUnits({ price: 100, qtyKg: 4 })).toBe(4);
    expect(getServiceUnits({ price: 100, units: 5 })).toBe(5);
    expect(getServiceUnits({ price: 100 })).toBe(1);
  });

  test("calculates multiple lines, GST, and the existing tax-inclusive discount", () => {
    const result = calculateServiceTotals(
      [
        { price: 200, hours: 3 },
        { rate: 500, qty: 1 },
        { price: 0, hours: 1 },
      ],
      18,
      10
    );
    expect(result.subTotal).toBe(1100);
    expect(result.gstTotal).toBe(198);
    expect(result.discountAmt).toBe(129.8);
    expect(result.grandTotal).toBe(1168.2);
  });

  test("preserves populated persisted totals, including zero", () => {
    const result = resolvePersistedServiceTotals({
      items: [{ price: 200, hours: 3, gst: 18 }],
      subTotal: 600,
      gstTotal: 108,
      grandTotal: 0,
    });
    expect(result.subTotal).toBe(600);
    expect(result.gstTotal).toBe(108);
    expect(result.grandTotal).toBe(0);
    expect(result.discountAmt).toBe(708);
  });

  test("derives a legacy discount needed to reconcile saved grand total", () => {
    const result = resolvePersistedServiceTotals({
      items: [{ price: 200, hours: 3, gst: 18 }],
      subTotal: 600,
      gstTotal: 108,
      grandTotal: 600,
    });
    expect(result.discountAmt).toBe(108);
  });

  test("splits intra-state tax and uses IGST inter-state", () => {
    expect(resolveTaxSplit(180, 18, "Maharashtra", "Maharashtra")).toEqual([
      { label: "CGST", rate: 9, amount: 90 },
      { label: "SGST", rate: 9, amount: 90 },
    ]);
    expect(resolveTaxSplit(180, 18, "Gujarat", "Maharashtra")).toEqual([
      { label: "IGST", rate: 18, amount: 180 },
    ]);
  });

  test("formats amount in words from the final total", () => {
    expect(numberToWordsIndian(1298)).toBe("Rupees One Thousand Two Hundred Ninety Eight Only");
  });

  test("normalizes line details for the renderer", () => {
    const line = getServiceLine({ id: 1, name: "Consulting", rate: "500", hours: "2", gst: 18 });
    expect(line.taxableAmount).toBe(1000);
    expect(line.taxAmount).toBe(180);
    expect(line.description).toBe("Consulting");
  });
});
