// src/components/invoice/resolveRetailCustomer.test.js
//
// Pins the customer-info resolution used by the Retail Print Invoice.
// The bug we fixed: printed retail invoices showed "Walking Customer"
// even when the cashier had typed a name in the POS billing screen.
// Root cause was twofold:
//   1. The retail renderer only looked at invoice.customerName — if the
//      save round-trip dropped that field (or it was never set), the
//      printed invoice fell back to "Walking Customer" with no chance of
//      recovery.
//   2. The renderer also showed a bare "Mobile: <empty>" line whenever
//      `customerPhone` was missing, which looked like a half-broken
//      record instead of "this customer is a walk-in".
//
// The `resolveRetailCustomer` helper centralises the resolution rules:
//   - name: hotelDetails.guestName -> customerName -> customer -> "Walking Customer"
//   - mobile: hotelDetails.customerMobile -> customerPhone -> customerMobile -> ""
// The renderer never shows "Mobile: …" for an empty string, and never
// shows the name field as "blank placeholder data".

import { resolveRetailCustomer } from "./RetailPrintInvoice";

describe("resolveRetailCustomer", () => {
  test("returns Walking Customer + empty mobile when nothing is set", () => {
    expect(resolveRetailCustomer({})).toEqual({
      name: "Walking Customer",
      mobile: "",
    });
  });

  test("uses invoice.customerName when set", () => {
    expect(resolveRetailCustomer({ customerName: "ajay K" })).toEqual({
      name: "ajay K",
      mobile: "",
    });
  });

  test("uses hotelDetails.guestName when present (retail invoice from a hotel receipt)", () => {
    expect(
      resolveRetailCustomer({
        hotelDetails: { guestName: "  Rahul Verma  " },
        customerName: "Should Not Win",
      })
    ).toEqual({ name: "Rahul Verma", mobile: "" });
  });

  test("falls back to legacy invoice.customer string field", () => {
    expect(resolveRetailCustomer({ customer: "Priya Nair" })).toEqual({
      name: "Priya Nair",
      mobile: "",
    });
  });

  test("returns empty mobile string when customerPhone is missing", () => {
    expect(
      resolveRetailCustomer({ customerName: "Sneha Iyer", customerPhone: "" })
    ).toEqual({ name: "Sneha Iyer", mobile: "" });
  });

  test("returns empty mobile string when customerPhone is whitespace only", () => {
    expect(
      resolveRetailCustomer({ customerName: "Sneha", customerPhone: "   " })
    ).toEqual({ name: "Sneha", mobile: "" });
  });

  test("uses invoice.customerPhone when set", () => {
    expect(
      resolveRetailCustomer({
        customerName: "ajay K",
        customerPhone: "9876543210",
      })
    ).toEqual({ name: "ajay K", mobile: "9876543210" });
  });

  test("prefers hotelDetails.customerMobile over customerPhone", () => {
    expect(
      resolveRetailCustomer({
        customerName: "Rahul",
        customerPhone: "1111111111",
        hotelDetails: { customerMobile: "9999999999" },
      })
    ).toEqual({ name: "Rahul", mobile: "9999999999" });
  });

  test("falls back to legacy customerMobile string field", () => {
    expect(
      resolveRetailCustomer({
        customerName: "Priya",
        customerMobile: "9876501234",
      })
    ).toEqual({ name: "Priya", mobile: "9876501234" });
  });

  test("treats null/undefined invoice defensively", () => {
    expect(resolveRetailCustomer(null)).toEqual({
      name: "Walking Customer",
      mobile: "",
    });
    expect(resolveRetailCustomer(undefined)).toEqual({
      name: "Walking Customer",
      mobile: "",
    });
  });

  test("trims whitespace-only customerName down to the placeholder", () => {
    expect(resolveRetailCustomer({ customerName: "   " })).toEqual({
      name: "Walking Customer",
      mobile: "",
    });
  });
});
