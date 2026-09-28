// src/utils/formatCurrency.js
//
// One currency/count formatter for the whole app.
//
// There were already five near-identical copies of this across the dashboards
// (Dashboard.jsx `fmtINR`, ServiceAdminDashboard.jsx `inr`, Reports.jsx
// `currency`, CashFlowPage.jsx / ShiftsPage.jsx / InventoryDashboard.jsx
// `formatCurrency`), differing in subtle ways — some pinned `en-IN`, some
// passed `undefined` and inherited the browser locale, some forced 2 decimal
// places and some zero. A manager comparing two screens showing the same
// figure needs those to agree, so the shared version pins `en-IN` explicitly
// rather than deferring to the device.

const inrFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const inrWholeFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

const countFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

// `Number(null)` and `Number("")` are both 0, so a naive guard would print
// "₹0" for a metric the server never sent — conflating "no data" with "zero",
// which is precisely the confusion this dashboard exists to avoid. Treat
// nullish/blank as absent and reserve 0 for a real zero.
const toAmount = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

// ₹ with grouping. Returns an em-dash for a missing or non-finite input rather
// than "₹NaN" or a misleading "₹0".
export const formatINR = (value) => {
  const n = toAmount(value);
  if (n === null) return "—";
  return `₹${inrFormatter.format(n)}`;
};

// Whole rupees. Used where paise are noise — KPI tiles, chart axes, dense
// mobile lists — so the figure stays readable at a glance.
export const formatINRWhole = (value) => {
  const n = toAmount(value);
  if (n === null) return "—";
  return `₹${inrWholeFormatter.format(n)}`;
};

export const formatCount = (value) => {
  const n = toAmount(value);
  if (n === null) return "—";
  return countFormatter.format(n);
};

// Compact form for a KPI tile too narrow for the full figure, e.g. ₹1.2L.
// Only kicks in above 100,000 so ordinary amounts are never abbreviated into
// something less precise than the invoice behind them. A negative amount puts
// the sign ahead of the symbol (-₹2.50L) so it reads as a credit, not as a
// currency symbol with a stray minus after it.
export const formatINRCompact = (value) => {
  const n = toAmount(value);
  if (n === null) return "—";
  const abs = Math.abs(n);
  if (abs >= 10000000) return `${n < 0 ? "-" : ""}₹${(abs / 10000000).toFixed(2)}Cr`;
  if (abs >= 100000) return `${n < 0 ? "-" : ""}₹${(abs / 100000).toFixed(2)}L`;
  return formatINRWhole(n);
};
