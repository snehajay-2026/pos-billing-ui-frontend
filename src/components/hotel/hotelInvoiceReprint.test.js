// src/components/hotel/hotelInvoiceReprint.test.js
//
// Verifies the customer-name + customer-mobile fix end-to-end.
//
// Scenario: a saved hotel invoice comes back from the server WITHOUT the
// top-level `customerName` / `hotelDetails.*` fields (those columns didn't
// exist in MySQL until this fix; the server only persisted the JSON `items`
// column). The guest name + mobile still live inside each line item's
// meta.guest / meta.customerMobile, set at booking time. The invoice
// components must fall back to those so re-printed invoices still show the
// booking-card name.
//
// What this test does NOT cover:
//   - The DB schema migration (that's a separate ops task).
//   - The Item-level meta population logic in HotelBilling (unit-tested
//     implicitly by the booking flow, and visually verified in production).

import React from "react";
import { renderToString } from "react-dom/server";
import LodgingInvoice from "./LodgingInvoice";
import DiningInvoice from "./DiningInvoice";

// A "re-printed" invoice — no top-level customer fields, only the JSON
// `items` column carrying the guest info via each line's meta.
const rePrintedInvoice = {
  invoiceNo: "HINV-TEST-001",
  date: "2026-08-10T12:00:00Z",
  paymentMode: "Cash",
  billedBy: "Front Desk",
  // Intentionally NO: customerName, hotelDetails, items[].meta.guest visible at top level
  items: [
    {
      id: "lodging-booking-room-101",
      name: "Room Booking - 101",
      type: "lodging",
      qty: 1,
      rate: 1500,
      total: 1500,
      gst: 12,
      meta: {
        roomId: "room-101",
        roomName: "101",
        guest: "Riya Sharma",
        customerMobile: "9876543210",
        nights: 1,
      },
    },
  ],
  subTotal: 1500,
  gstTotal: 180,
  grandTotal: 1680,
};

const REPRINTED_DINING_INVOICE = {
  invoiceNo: "HINV-TEST-D002",
  date: "2026-08-10T12:00:00Z",
  paymentMode: "Cash",
  billedBy: "Service Team",
  items: [
    {
      id: "table-T3-item-0",
      name: "Paneer Tikka",
      type: "dining",
      qty: 2,
      rate: 250,
      total: 500,
      gst: 5,
      meta: {
        tableId: "T3",
        tableName: "T3",
        guest: "Arjun Mehta",
        customerMobile: "9123456780",
        partySize: 2,
      },
    },
  ],
  subTotal: 500,
  gstTotal: 25,
  grandTotal: 525,
};

describe("hotel invoices — guest name + mobile survive re-print", () => {
  test("LodgingInvoice shows guest name and mobile when top-level fields are absent", () => {
    const html = renderToString(<LodgingInvoice invoice={rePrintedInvoice} />);
    // The "Stay Summary" cell renders the guest name in the summary-value
    // span. We assert against the exact render string instead of DOM access
    // because react-dom/server output is plain HTML.
    expect(html).toContain("Riya Sharma");
    expect(html).toContain("9876543210");
    // Sanity: did NOT fall back to the placeholder
    expect(html).not.toMatch(/>Walking Guest</);
  });

  test("DiningInvoice shows guest name and mobile when top-level fields are absent", () => {
    const html = renderToString(<DiningInvoice invoice={REPRINTED_DINING_INVOICE} />);
    expect(html).toContain("Arjun Mehta");
    expect(html).toContain("9123456780");
    expect(html).not.toMatch(/>Walking Guest</);
  });

  test("LodgingInvoice still honours live-preview customerName when present", () => {
    // Live preview path: top-level fields exist; they take priority over meta.
    const live = {
      ...rePrintedInvoice,
      customerName: "Live Preview Name",
      hotelDetails: { guestName: "Live Preview Name", roomNumber: "101" },
    };
    const html = renderToString(<LodgingInvoice invoice={live} />);
    expect(html).toContain("Live Preview Name");
    // meta.guest should NOT win over the live preview
    expect(html).not.toContain("Riya Sharma");
  });
});
