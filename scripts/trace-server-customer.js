// scripts/trace-server-customer.js
//
// Round-trip trace for the *deployed* backend in `server/` (which uses
// MySQL with explicit customer_name / customer_mobile columns). The
// fake MySQL pool is created in-process (no separate file) so the script
// is self-contained. Drives createWithStockDecrement() end-to-end and
// observes what gets persisted and what the API returns.
//
// Run from the repo root:  node scripts/trace-server-customer.js

const path = require("path");
const Module = require("module");

// In-memory MySQL pool. The shared state is held in module-level Maps
// inside this IIFE so both .query and .withTransaction see the same data.
const invoices = new Map();
const products = new Map();
let nextInvoiceId = 1;

function runQuery(sql, params) {
  if (/SELECT\s+id,\s*name,\s*stock\s+FROM\s+products/i.test(sql)) {
    const id = params[0];
    const p = products.get(String(id)) || { id, name: "Tea", stock: 100 };
    products.set(String(id), p);
    return [[p]];
  }
  if (/FROM\s+invoices/i.test(sql)) {
    // Any SELECT against the invoices table — return all rows (the
    // production code filters / picks the first match). Also resolve
    // invoice_no = ? by exact key.
    if (/invoice_no\s*=\s*\?/i.test(sql)) {
      const no = String(params[0]);
      const row = invoices.get(no);
      return [row ? [row] : []];
    }
    return [Array.from(invoices.values())];
  }
  const im = sql.match(/INSERT INTO invoices\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/i);
  if (im) {
    const cols = im[1].split(",").map((c) => c.trim().replace(/`/g, ""));
    const row = {};
    cols.forEach((c, i) => { row[c] = params[i]; });
    row.id = row.id || String(nextInvoiceId++);
    invoices.set(String(row.invoice_no), row);
    return [{ insertId: row.id, affectedRows: 1 }];
  }
  if (/UPDATE products SET stock/i.test(sql)) {
    return [{ affectedRows: 1 }];
  }
  return [{ affectedRows: 0 }];
}

const fakePool = {
  query: async (sql, params) => runQuery(sql, params),
  withTransaction: async (fn) => {
    const conn = {
      query: async (sql, params) => runQuery(sql, params),
    };
    return fn(conn);
  },
};

// Replace the real pool require with our in-memory one.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, parent, ...rest) {
  if (req === "../pool" || req === "./pool") {
    return "node:fake-pool";
  }
  return origResolve.call(this, req, parent, ...rest);
};
require.cache["node:fake-pool"] = {
  id: "node:fake-pool",
  filename: "node:fake-pool",
  loaded: true,
  exports: fakePool,
};

const invQ = require(path.join(__dirname, "..", "server", "db", "queries", "invoices.js"));

const baseInvoice = {
  date: "2026-08-11",
  items: [{ id: "p1", name: "Tea", qty: 1, price: 50, gst: 0 }],
  subTotal: 50,
  gstTotal: 0,
  grandTotal: 50,
  paymentMode: "Cash",
  billedBy: "cashier@store",
};

const scenarios = [
  {
    label: "Customer Name + Mobile",
    payload: { ...baseInvoice, invoiceNo: "INV-TRACE-001", customerName: "Ajay Kodag", customerPhone: "9876543210" },
    expectName: "Ajay Kodag",
    expectMobile: "9876543210",
  },
  {
    label: "Customer Name only (no Mobile)",
    payload: { ...baseInvoice, invoiceNo: "INV-TRACE-002", customerName: "Sneha Iyer", customerPhone: "" },
    expectName: "Sneha Iyer",
    expectMobile: "",
  },
  {
    label: "No customer at all",
    payload: { ...baseInvoice, invoiceNo: "INV-TRACE-003", customerName: "", customerPhone: "" },
    expectName: "Walking Customer",
    expectMobile: "",
  },
];

const trim = (v) => (typeof v === "string" ? v.trim() : "");

(async () => {
  let failed = 0;
  for (const sc of scenarios) {
    console.log(`\n=========================================================`);
    console.log(`SCENARIO: ${sc.label}`);
    console.log(`=========================================================`);
    console.log("STEP 1 — POS sends:");
    console.log("  customerName:", JSON.stringify(sc.payload.customerName));
    console.log("  customerPhone:", JSON.stringify(sc.payload.customerPhone));

    const result = await invQ.createWithStockDecrement(sc.payload, () => 1, {
      storeType: "retail",
      storeId: null,
      email: "cashier@store",
    });

    console.log("\nSTEP 2 — backend rowToInvoice returns:");
    console.log("  customerName   :", JSON.stringify(result.invoice.customerName));
    console.log("  customerMobile :", JSON.stringify(result.invoice.customerMobile));

    const inv = result.invoice;
    const name =
      trim(inv.hotelDetails && inv.hotelDetails.guestName) ||
      trim(inv.customerName) ||
      trim(inv.customer) ||
      "Walking Customer";
    const mobile =
      trim(inv.hotelDetails && inv.hotelDetails.customerMobile) ||
      trim(inv.customerPhone) ||
      trim(inv.customerMobile) ||
      "";

    console.log("\nSTEP 3 — renderer shows:");
    console.log("  name :", JSON.stringify(name));
    console.log("  mobile:", JSON.stringify(mobile));

    const nameOk = name === sc.expectName;
    const mobileOk = mobile === sc.expectMobile;
    console.log("\nRESULT:");
    console.log("  name OK    :", nameOk ? "PASS" : `FAIL expected ${JSON.stringify(sc.expectName)}`);
    console.log("  mobile OK  :", mobileOk ? "PASS" : `FAIL expected ${JSON.stringify(sc.expectMobile)}`);
    if (!nameOk || !mobileOk) failed++;
  }
  console.log(`\n=== ${failed === 0 ? "ALL SCENARIOS PASS" : failed + " SCENARIO(S) FAILED"} ===`);
  process.exitCode = failed === 0 ? 0 : 1;
})().catch((e) => { console.error("FATAL", e); process.exit(2); });