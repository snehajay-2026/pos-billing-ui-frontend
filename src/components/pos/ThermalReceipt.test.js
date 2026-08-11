// src/components/pos/ThermalReceipt.test.js
//
// End-to-end SSR test for the ESC/POS Bluetooth thermal receipt. We want
// the same customer-info rules as the PDF preview (RetailPrintInvoice) —
// the cashier should never see "Walking Customer" on the printed receipt
// when a real name was typed in the POS billing screen.

import React from "react";
// eslint-disable-next-line react/no-deprecated
import ReactDOM from "react-dom/server";
import ThermalReceipt from "./ThermalReceipt";

jest.mock("../../services/storeSettingsService", () => ({
  getStoreSettings: () => ({
    name: "Test Store",
    address: "Test Address",
    phone: "0000000000",
    theme: "light",
    businessType: "retail",
  }),
}));

const render = (invoice) =>
  ReactDOM.renderToString(<ThermalReceipt invoice={invoice} isDuplicate={false} />);

describe("ThermalReceipt — customer info block", () => {
  test("shows the typed customer name when set, not 'Walking Customer'", () => {
    const html = render({
      invoiceNo: "RINV-100",
      date: "2026-08-11",
      paymentMode: "Cash",
      items: [{ id: "x", name: "Tea", qty: 1, price: 50, gst: 0 }],
      subTotal: 50,
      gstTotal: 0,
      grandTotal: 50,
      customerName: "ajay K",
      customerPhone: "9876543210",
    });
    expect(html).toContain("ajay K");
    expect(html).not.toMatch(/Customer: Walking Customer/);
    expect(html).toContain("9876543210");
  });

  test("falls back to 'Walking Customer' when neither name nor phone is set", () => {
    const html = render({
      invoiceNo: "RINV-101",
      date: "2026-08-11",
      paymentMode: "Cash",
      items: [{ id: "x", name: "Tea", qty: 1, price: 50, gst: 0 }],
      subTotal: 50,
      gstTotal: 0,
      grandTotal: 50,
    });
    expect(html).toMatch(/Customer:\s*(<!-- -->)?\s*Walking Customer/);
    expect(html).not.toMatch(/Mobile:<\/div>/);
  });

  test("does not show Mobile line when phone is missing or whitespace", () => {
    const html = render({
      invoiceNo: "RINV-102",
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
    expect(html).not.toMatch(/Mobile:<\/div>/);
  });

  test("honours hotelDetails.guestName when present (retail-from-hotel receipt)", () => {
    const html = render({
      invoiceNo: "RINV-103",
      date: "2026-08-11",
      paymentMode: "Cash",
      items: [{ id: "x", name: "Tea", qty: 1, price: 50, gst: 0 }],
      subTotal: 50,
      gstTotal: 0,
      grandTotal: 50,
      customerName: "Should Not Win",
      hotelDetails: { guestName: "Rahul Verma" },
    });
    expect(html).toMatch(/Guest:\s*(<!-- -->)?\s*Rahul Verma/);
    expect(html).not.toContain("Should Not Win");
  });
});