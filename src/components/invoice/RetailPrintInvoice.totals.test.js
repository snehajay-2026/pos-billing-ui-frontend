// src/components/invoice/RetailPrintInvoice.totals.test.js
//
// Financial-terminology regression test for the Retail receipt.
//
// `subTotal` is ALREADY net of both line and bill discounts, so the receipt
// labels it "Taxable Subtotal" and places the gross + discount rows ABOVE it
// as context. The risk this file guards is the opposite: a future edit that
// makes those rows read as further deductions, or that double-subtracts them
// from the subtotal.
//
// It pins the §37 worked example end-to-end through the rendered HTML:
//     Gross 1040 − Line 50 − Bill 90 = Taxable Subtotal 900
//     900 + GST 81 = Grand Total 981
//     You Saved = 140
//
// The values come straight off a stored invoice — this asserts DISPLAY
// semantics, not a recalculation. Mounted with renderToString because
// @testing-library/react isn't installed in this project.

import React from "react";
// eslint-disable-next-line react/no-deprecated
import ReactDOM from "react-dom/server";
import RetailPrintInvoice from "./RetailPrintInvoice";

jest.mock("../../services/storeSettingsService", () => ({
  getStoreSettings: () => ({
    name: "Test Store",
    address: "Test Address",
    phone: "0000000000",
  }),
}));

const render = (invoice) =>
  ReactDOM.renderToString(<RetailPrintInvoice invoice={invoice} isDuplicate={false} />);

// The §37 example, exactly as a POS checkout would have persisted it.
const DISCOUNTED = {
  invoiceNo: "RINV-DISC",
  date: "2026-09-24",
  items: [{ name: "Widget", qty: 1, price: 1040, gst: 0 }],
  subTotal: 900, // already net of 50 line + 90 bill
  gstTotal: 81,
  grandTotal: 981,
  paymentMode: "Cash",
  discount: { type: "percent", value: 10 },
  discountBreakdown: {
    line: [{ productId: 1, productName: "Widget", saved: 50 }],
    bill: { type: "percent", value: 10 },
    totalSavings: 140,
  },
};

const NO_DISCOUNT = {
  invoiceNo: "RINV-PLAIN",
  date: "2026-09-24",
  items: [{ name: "Widget", qty: 1, price: 900, gst: 9 }],
  subTotal: 900,
  gstTotal: 81,
  grandTotal: 981,
  paymentMode: "Cash",
};

// Pull the numeric text that follows a label.
//
// React's server renderer interleaves `<!-- -->` comment markers between
// adjacent text nodes (e.g. `Bill Discount<!-- --> (10%)`), and inserts one
// between a `₹` literal and the number, so a naive /₹([0-9.]+)/ match would
// miss every amount. Strip the markers, then read the first number that
// follows the label.
const stripMarkers = (html) => html.replace(/<!-- -->/g, "");

const amountAfter = (rawHtml, label) => {
  const html = stripMarkers(rawHtml);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}[\\s\\S]{0,200}?₹\\s*([0-9,]+(?:\\.[0-9]+)?)`);
  const m = html.match(re);
  return m ? m[1] : null;
};

describe("RetailPrintInvoice — financial summary terminology", () => {
  test("labels the post-discount amount 'Taxable Subtotal', not 'Subtotal'", () => {
    const html = render(DISCOUNTED);
    expect(html).toContain("Taxable Subtotal");
    // The ambiguous bare label must be gone.
    expect(html).not.toMatch(/>\s*Subtotal\s*</);
  });

  test("renders the §37 breakdown: gross 1040, discounts 50 + 90, subtotal 900", () => {
    const html = render(DISCOUNTED);
    expect(amountAfter(html, "Gross Amount")).toBe("1040.00");
    expect(amountAfter(html, "Line Discount")).toBe("50.00");
    expect(amountAfter(html, "Bill Discount")).toBe("90.00");
    expect(amountAfter(html, "Taxable Subtotal")).toBe("900.00");
    expect(amountAfter(html, "GST")).toBe("81.00");
    expect(amountAfter(html, "Grand Total")).toBe("981.00");
  });

  test("the breakdown reconciles: gross − line − bill === taxable subtotal", () => {
    const html = render(DISCOUNTED);
    const gross = Number(amountAfter(html, "Gross Amount"));
    const line = Number(amountAfter(html, "Line Discount"));
    const bill = Number(amountAfter(html, "Bill Discount"));
    const subtotal = Number(amountAfter(html, "Taxable Subtotal"));
    // This is the identity that proves nothing is double-subtracted: the
    // displayed subtotal is what remains AFTER both discounts, and the
    // receipt never asks the reader to subtract them again.
    expect(Number((gross - line - bill).toFixed(2))).toBe(subtotal);
  });

  test("subtotal + GST === grand total", () => {
    const html = render(DISCOUNTED);
    const subtotal = Number(amountAfter(html, "Taxable Subtotal"));
    const gst = Number(amountAfter(html, "GST"));
    const grand = Number(amountAfter(html, "Grand Total"));
    expect(Number((subtotal + gst).toFixed(2))).toBe(grand);
  });

  test("'You Saved' equals line + bill discount, and sits below Grand Total", () => {
    const html = render(DISCOUNTED);
    expect(amountAfter(html, "You Saved")).toBe("140.00");
    // Ordering, not just presence.
    expect(html.indexOf("Grand Total")).toBeLessThan(html.indexOf("You Saved"));
  });

  test("omits gross and discount rows entirely when there is no discount", () => {
    const html = render(NO_DISCOUNT);
    expect(html).not.toContain("Gross Amount");
    expect(html).not.toContain("Line Discount");
    expect(html).not.toContain("Bill Discount");
    expect(html).not.toContain("You Saved");
    // The compact no-discount receipt keeps its original three rows.
    expect(html).toContain("Taxable Subtotal");
    expect(amountAfter(html, "Taxable Subtotal")).toBe("900.00");
  });

  test("Grand Total remains the visually dominant row", () => {
    const html = render(DISCOUNTED);
    // The grand-total block is a distinct, emphasised class in the markup.
    expect(html).toContain("rpi-total-row-grand");
  });
});
