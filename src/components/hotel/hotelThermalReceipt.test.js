// src/components/hotel/hotelThermalReceipt.test.js
//
// Verifies the 80 mm thermal hotel renderer:
//   - shows the booking-card guest name (the same one that appears on
//     LodgingInvoice / DiningInvoice, resolved from hotelDetails.guestName
//     -> customerName -> meta.guest -> "Walking Guest")
//   - falls back to meta.guest when only the persisted items column is
//     present (re-print path)
//   - prints the table name on dining invoices and the room number on
//     lodging invoices
//   - formats the grand total to two decimals in the totals block
//   - never falls back to "Walking Guest" / "Walking Customer" when the
//     booking card actually captured a name

import React from "react";
import { renderToString } from "react-dom/server";
import HotelThermalReceipt from "./HotelThermalReceipt";

// Same invoice shape that HotelBilling feeds LodgingInvoice / DiningInvoice
// when the cashier clicks "Generate Invoice" right after a booking.
const freshLodging = {
  invoiceNo: "HINV-THERMAL-L001",
  date: "2026-08-10T12:00:00Z",
  paymentMode: "Cash",
  billedBy: "Front Desk",
  storeType: "hotel",
  customerName: "Rahul Verma",
  hotelDetails: {
    guestName: "Rahul Verma",
    roomNumber: "204",
    idProof: { type: "Aadhaar", number: "XXXX-XXXX-1234" },
  },
  items: [
    {
      id: "lodging-booking-room-204",
      name: "Room Booking - 204",
      type: "lodging",
      qty: 1,
      rate: 2200,
      total: 2200,
      gst: 12,
      meta: {
        roomId: "room-204",
        roomName: "204",
        guest: "Rahul Verma",
        customerMobile: "9000000001",
        nights: 1,
        checkInDate: "2026-08-10",
        checkInTime: "11:00",
      },
    },
  ],
  subTotal: 2200,
  gstTotal: 264,
  grandTotal: 2464,
};

const freshDining = {
  invoiceNo: "HINV-THERMAL-D001",
  date: "2026-08-10T19:00:00Z",
  paymentMode: "UPI",
  billedBy: "Service Team",
  storeType: "hotel",
  customerName: "Priya Nair",
  hotelDetails: {
    guestName: "Priya Nair",
    tableName: "T7",
    partySize: 3,
    customerMobile: "9000000002",
  },
  items: [
    {
      id: "table-T7-item-0",
      name: "Veg Biryani",
      type: "dining",
      qty: 3,
      rate: 220,
      total: 660,
      gst: 5,
      meta: {
        tableId: "T7",
        tableName: "T7",
        guest: "Priya Nair",
        customerMobile: "9000000002",
        partySize: 3,
      },
    },
  ],
  subTotal: 660,
  gstTotal: 33,
  grandTotal: 693,
};

// A re-printed invoice — server only persisted the JSON `items` column,
// no top-level customer / hotelDetails fields.
const rePrintedLodging = {
  invoiceNo: "HINV-THERMAL-L002",
  date: "2026-08-10T12:00:00Z",
  paymentMode: "Cash",
  billedBy: "Front Desk",
  storeType: "hotel",
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

describe("HotelThermalReceipt — 80mm thermal layout for hotel store", () => {
  test("renders fresh lodging invoice with booking-card name + room + total", () => {
    const html = renderToString(<HotelThermalReceipt invoice={freshLodging} />);
    expect(html).toContain("Rahul Verma");
    expect(html).toContain("Room:"); // meta.roomName surfaces on the lodging branch
    expect(html).toContain("204");
    expect(html).toContain("LODGING");
    // total is rendered in the totals block (formatted to 2dp)
    expect(html).toContain("2464.00");
    // guest cell must not fall back to the placeholder when a real name exists
    expect(html).not.toMatch(/Walking Guest/);
    expect(html).not.toMatch(/Walking Customer/);
  });

  test("renders fresh dining invoice with booking-card name + table + total", () => {
    const html = renderToString(<HotelThermalReceipt invoice={freshDining} />);
    expect(html).toContain("Priya Nair");
    expect(html).toContain("DINING");
    expect(html).toContain("T7");
    expect(html).toContain("Party:"); // party size surfaces on the dining branch
    expect(html).toContain("693.00");
    expect(html).not.toMatch(/Walking Guest/);
    expect(html).not.toMatch(/Walking Customer/);
  });

  test("falls back to meta.guest on a re-printed invoice (no top-level fields)", () => {
    // Mirrors the existing LodgingInvoice / DiningInvoice fallback test
    // — the server only kept the JSON `items` column, so the name must
    // still resolve from meta.guest.
    const html = renderToString(<HotelThermalReceipt invoice={rePrintedLodging} />);
    expect(html).toContain("Riya Sharma");
    expect(html).toContain("9876543210");
    expect(html).not.toMatch(/Walking Guest/);
    expect(html).not.toMatch(/Walking Customer/);
    expect(html).toContain("LODGING");
  });
});
