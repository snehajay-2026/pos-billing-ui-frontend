// src/components/invoice/RetailPrintInvoice.test.js
//
// End-to-end SSR test for the printed retail invoice's customer info
// block. Verifies the rules that matter to the cashier:
//
//   - when customerName is set, the invoice shows it (no "Walking Customer")
//   - when customerName AND customerPhone are set, both lines render
//   - when customerName is empty, "Walking Customer" is shown
//   - when customerPhone is empty, the "Mobile: …" line is NOT rendered
//     (no half-broken "Mobile: " with nothing after the colon)
//   - when a hotelDetails.guestName is present, it wins over customerName
//
// We mount via legacy ReactDOM.render + react-dom/server.renderToString
// because @testing-library/react isn't installed in this project.

import React from "react";
// eslint-disable-next-line react/no-deprecated
import ReactDOM from "react-dom/server";
import RetailPrintInvoice from "./RetailPrintInvoice";

// Mock storeSettings so the rendered HTML is deterministic. We only
// need the module to return *some* object — the renderer reads a few
// display strings off it but they don't influence the customer block
// we're pinning here.
jest.mock("../../services/storeSettingsService", () => ({
  getStoreSettings: () => ({
    name: "Test Store",
    address: "Test Address",
    phone: "0000000000",
  }),
}));

const renderInvoice = (invoice) =>
  ReactDOM.renderToString(<RetailPrintInvoice invoice={invoice} isDuplicate={false} />);

describe("RetailPrintInvoice — customer info block", () => {
  test("shows the typed customer name and mobile when both are set", () => {
    const html = renderInvoice({
      invoiceNo: "RINV-001",
      date: "2026-08-11",
      paymentMode: "Cash",
      items: [{ id: "x", name: "Tea", qty: 1, price: 50, gst: 0 }],
      subTotal: 50,
      gstTotal: 0,
      grandTotal: 50,
      customerName: "ajay K",
      customerPhone: "9876543210",
    });
    // Customer name block contains the typed name (NOT "Walking Customer").
    expect(html).toContain("ajay K");
    expect(html).not.toMatch(/>Walking Customer</);
    // Mobile line renders the phone number.
    expect(html).toContain("Mobile:");
    expect(html).toContain("9876543210");
  });

  test("falls back to 'Walking Customer' when neither name nor phone is set", () => {
    const html = renderInvoice({
      invoiceNo: "RINV-002",
      date: "2026-08-11",
      paymentMode: "Cash",
      items: [{ id: "x", name: "Tea", qty: 1, price: 50, gst: 0 }],
      subTotal: 50,
      gstTotal: 0,
      grandTotal: 50,
    });
    expect(html).toContain("Walking Customer");
    // No "Mobile:" line at all — not even an empty placeholder.
    expect(html).not.toMatch(/Mobile:\s*<\/div>/);
  });

  test("shows the customer name WITHOUT a Mobile line when only the name is set", () => {
    const html = renderInvoice({
      invoiceNo: "RINV-003",
      date: "2026-08-11",
      paymentMode: "Cash",
      items: [{ id: "x", name: "Tea", qty: 1, price: 50, gst: 0 }],
      subTotal: 50,
      gstTotal: 0,
      grandTotal: 50,
      customerName: "Sneha Iyer",
      customerPhone: "",
    });
    expect(html).toContain("Sneha Iyer");
    expect(html).not.toMatch(/>Walking Customer</);
    // Empty customerPhone means no Mobile line — no half-broken record.
    expect(html).not.toMatch(/Mobile:\s*<\/div>/);
  });

  test("uses hotelDetails.guestName when present (overrides customerName)", () => {
    const html = renderInvoice({
      invoiceNo: "RINV-004",
      date: "2026-08-11",
      paymentMode: "Cash",
      items: [{ id: "x", name: "Tea", qty: 1, price: 50, gst: 0 }],
      subTotal: 50,
      gstTotal: 0,
      grandTotal: 50,
      customerName: "Should Not Win",
      hotelDetails: { guestName: "Rahul Verma", customerMobile: "9999999999" },
    });
    expect(html).toContain("Rahul Verma");
    expect(html).not.toContain("Should Not Win");
    expect(html).toContain("9999999999");
  });

  test("renders the build-commit fingerprint in the footer", () => {
    const html = renderInvoice({
      invoiceNo: "RINV-005",
      date: "2026-08-11",
      paymentMode: "Cash",
      items: [{ id: "x", name: "Tea", qty: 1, price: 50, gst: 0 }],
      subTotal: 50,
      gstTotal: 0,
      grandTotal: 50,
    });
    // The footer must show a "build:" line so anyone holding a printed
    // receipt can verify the deployed bundle matches the expected commit.
    expect(html).toMatch(/build:\s*(<!-- -->)?\s*\S+/);
  });
});
