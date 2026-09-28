// src/utils/dashboardMetrics.js
//
// Pure shaping for the Manager Dashboard.
//
// Everything the screen derives from the `/api/dashboard/summary` response
// lives here rather than in the component, so it is unit-testable as plain
// functions — this project has no @testing-library, and the existing suites are
// pure-function tests for exactly this reason.
//
// The recurring rule: a `null`/`undefined` section means "not available for
// this store type" and must read differently from a real zero. A manager told
// "₹0 returns" when the returns table simply is not deployed will make a
// decision on a number that was never measured.

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

const hasSection = (section) => section !== null && section !== undefined;

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------
// Order the tiles by what a manager decides on first: the money, then the
// count behind it, then the smaller lines.
export const buildSalesSummary = (sales) => {
  if (!hasSection(sales)) return null;
  return {
    grossTotal: num(sales.grossTotal),
    discountTotal: num(sales.discountTotal),
    subTotal: num(sales.subTotal),
    gstTotal: num(sales.gstTotal),
    grandTotal: num(sales.grandTotal),
    invoiceCount: num(sales.netInvoiceCount ?? sales.invoiceCount),
    cancelledCount: num(sales.cancelledCount),
    averageBill: num(sales.averageBill),
    hasDiscount: num(sales.discountTotal) > 0,
  };
};

// Net sales = gross less returns actually settled in the period. Returns that
// are `null` (unavailable) are treated as zero here, but the caller is expected
// to surface that unavailability separately — a null must never quietly become
// a confident-looking net figure on its own.
export const buildNetSales = (salesSummary, returns) => {
  if (!hasSection(salesSummary)) return null;
  const returnTotal = hasSection(returns) ? num(returns.total) : 0;
  return salesSummary.grandTotal - returnTotal;
};

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------
// The server already folds raw `payment_mode` strings into labels; this only
// adds the share and drops empty buckets, and flags Split so the UI can
// footnote it. Split per-mode amounts are NOT persisted anywhere, so we must
// not imply a breakdown that does not exist.
export const buildPaymentBreakdown = (payments) => {
  if (!Array.isArray(payments) || payments.length === 0) return null;
  const total = payments.reduce((sum, p) => sum + num(p.total), 0);
  if (total <= 0) return null;
  return {
    total,
    items: payments
      .filter((p) => num(p.total) > 0)
      .map((p) => ({
        mode: p.mode,
        total: num(p.total),
        invoiceCount: num(p.invoiceCount),
        share: Math.round((num(p.total) / total) * 1000) / 10,
      })),
    hasSplit: payments.some((p) => p.mode === "Other" && num(p.invoiceCount) > 0),
  };
};

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------
// The server returns only days that HAVE invoices. A chart drawn from that
// alone collapses gaps — a Tuesday with no sales vanishes and Tuesday's sales
// appear to belong to Monday. Densify across the requested range so the shape
// reads honestly, and cap the points so a wide range stays legible on a phone.
export const densifyTrend = (trend, { from, to, maxPoints = 31 } = {}) => {
  const rows = Array.isArray(trend) ? trend : [];
  const byDay = new Map(rows.map((r) => [r.day, r]));
  if (!from || !to) return rows.slice(0, maxPoints);

  const days = [];
  const cursor = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime())) {
    return rows.slice(0, maxPoints);
  }
  while (cursor <= end && days.length < maxPoints) {
    const day = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(
      cursor.getDate()
    ).padStart(2, "0")}`;
    const hit = byDay.get(day);
    days.push({
      day,
      revenue: hit ? num(hit.revenue) : 0,
      invoiceCount: hit ? num(hit.invoiceCount) : 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
};

// A single-day period has no trend to draw. Reporting that plainly is better
// than a chart with one bar, which reads as a rendering failure.
export const isSingleDayRange = (from, to) => Boolean(from) && from === to;

// ---------------------------------------------------------------------------
// Needs attention
// ---------------------------------------------------------------------------
// Only items backed by real data. Every entry is actionable and links to the
// existing page that resolves it — this centre never becomes a dead-end list of
// warnings.
export const buildNeedsAttention = (summary = {}) => {
  const items = [];
  const inv = summary.inventory;
  if (hasSection(inv)) {
    const critical = num(inv.outOfStock) + num(inv.critical);
    if (critical > 0) {
      items.push({
        id: "inventory-critical",
        severity: "critical",
        label: "Stock needs attention",
        detail: `${num(inv.outOfStock)} out of stock · ${num(inv.critical)} critical`,
        count: critical,
        href: "/inventory",
      });
    } else if (num(inv.low) > 0) {
      items.push({
        id: "inventory-low",
        severity: "warning",
        label: "Low stock",
        detail: `${num(inv.low)} products below threshold`,
        count: num(inv.low),
        href: "/inventory",
      });
    }
  }

  const returns = summary.returns;
  if (hasSection(returns) && num(returns.unsettledCount) > 0) {
    items.push({
      id: "returns-unsettled",
      severity: "warning",
      label: "Pending returns",
      detail: `${num(returns.unsettledCount)} awaiting approval`,
      count: num(returns.unsettledCount),
      href: "/retail-returns",
    });
  }

  const pos = summary.purchaseOrders;
  if (Array.isArray(pos)) {
    const open = pos
      .filter((p) => p.status === "draft" || p.status === "sent")
      .reduce((sum, p) => sum + num(p.count), 0);
    if (open > 0) {
      items.push({
        id: "purchase-orders-open",
        severity: "info",
        label: "Open purchase orders",
        detail: `${open} awaiting delivery`,
        count: open,
        href: "/inventory-module",
      });
    }
  }

  const customers = summary.customers;
  if (hasSection(customers) && num(customers.pendingCount) > 0) {
    items.push({
      id: "customers-pending",
      severity: "info",
      label: "Customers awaiting approval",
      detail: `${num(customers.pendingCount)} pending`,
      count: num(customers.pendingCount),
      href: "/customers",
    });
  }

  // Severest first, then largest. A stable secondary key keeps the order from
  // shuffling between refreshes when severities tie.
  const rank = { critical: 0, warning: 1, info: 2 };
  return items.sort(
    (a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || b.count - a.count
  );
};

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------
// A section the server marked unavailable is reported as such, never as ₹0.
export const isSectionUnavailable = (section) => section === null || section === undefined;
