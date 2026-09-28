import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  FaRupeeSign,
  FaFileInvoice,
  FaChartLine,
  FaUndo,
  FaWallet,
  FaBoxes,
  FaUsers,
  FaExclamationTriangle,
  FaSyncAlt,
  FaArrowRight,
  FaClock,
  FaShoppingCart,
  FaHotel,
  FaCreditCard,
} from "react-icons/fa";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";

import Layout from "../components/layout/Layout";
import KpiTile from "../components/dashboard/KpiTile";
import DateRangeFilter from "../components/dashboard/DateRangeFilter";
import DashboardState from "../components/dashboard/DashboardState";
import { getDashboardSummary } from "../services/dashboardService";
import { toApiRange, describeRange, formatShortDate } from "../utils/dateRange";
import { formatINR, formatINRWhole, formatINRCompact, formatCount } from "../utils/formatCurrency";
import { toErrorMessage } from "../utils/errorMessage";
import { getUser, getUserStoreType, getUserStoreId } from "../utils/auth";
import {
  buildSalesSummary,
  buildNetSales,
  buildPaymentBreakdown,
  densifyTrend,
  isSingleDayRange,
  buildNeedsAttention,
  isSectionUnavailable,
} from "../utils/dashboardMetrics";
import "./ManagerDashboard.css";

const DEFAULT_RANGE = "TODAY";

// A burst of SSE events during a busy minute (an invoice lands, stock moves, a
// shift opens) would otherwise fire a dozen summary refetches. Coalesce them
// into one trailing refresh.
const REALTIME_DEBOUNCE_MS = 1500;

const ManagerDashboard = () => {
  const [range, setRange] = useState(DEFAULT_RANGE);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  const debounceRef = useRef(null);
  // Guards against a slow response for an old range/store overwriting a newer
  // one — the failure mode when a manager taps through date pills quickly.
  const requestIdRef = useRef(0);
  const { from, to } = useMemo(
    () => toApiRange(range, customFrom, customTo),
    [range, customFrom, customTo]
  );

  const storeLabel = useMemo(() => {
    const type = getUserStoreType();
    const id = getUserStoreId();
    if (!type) return "All stores";
    return id && id !== type ? `${id} (${type})` : String(type);
  }, []);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setRefreshing(true);
    try {
      const data = await getDashboardSummary({ from, to });
      if (requestId !== requestIdRef.current) return;
      setSummary(data);
      setStatus("ready");
      setError("");
      setLastUpdated(Date.now());
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      // A 403 is a permission outcome, not a failure to report as an error.
      if (err?.status === 403) {
        setStatus("forbidden");
        setSummary(null);
        return;
      }
      setError(toErrorMessage(err, "Could not load the dashboard."));
      setStatus("error");
    } finally {
      if (requestId === requestIdRef.current) setRefreshing(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  // Existing SSE only — no new events, no polling, no Socket.IO. The
  // dashboard listens to the channels the app already publishes and refetches
  // the aggregate rather than patching a card from partial event payloads.
  useEffect(() => {
    let cancelled = false;
    let realtime;
    const setup = async () => {
      try {
        const sync = await import("../services/realtimeSync");
        if (cancelled) return;
        realtime = sync.onRealtimeSyncEvent(({ kind }) => {
          if (!DASHBOARD_REALTIME_KINDS.has(kind)) return;
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(load, REALTIME_DEBOUNCE_MS);
        });
      } catch {
        // Realtime is an enhancement; the manual refresh still works without it.
      }
    };
    setup();
    return () => {
      cancelled = true;
      clearTimeout(debounceRef.current);
      if (realtime) realtime();
    };
  }, [load]);

  const sales = useMemo(() => buildSalesSummary(summary?.sales), [summary]);
  const payments = useMemo(() => buildPaymentBreakdown(summary?.payments), [summary]);
  const netSales = useMemo(() => buildNetSales(sales, summary?.returns), [sales, summary]);
  const trend = useMemo(() => densifyTrend(summary?.trend, { from, to }), [summary, from, to]);
  const attention = useMemo(() => buildNeedsAttention(summary || {}), [summary]);

  const userName = useMemo(() => {
    const user = getUser();
    return (user?.name || user?.email || "Manager").split("@")[0];
  }, []);

  // "Empty" is a genuine absence of data, never a failed request — a failure
  // stays in the `error` state where it is labelled as such.
  const isEmpty = useMemo(() => {
    if (status !== "ready" || !summary) return false;
    return !sales || (sales.invoiceCount === 0 && sales.grandTotal === 0);
  }, [status, summary, sales]);

  // No client-side store-type branching: the server already omits sections a
  // vertical cannot support (`inventory`/`purchaseOrders` for service, `hotel`
  // for everyone else), so the page renders whatever is present and treats an
  // absent section as "not applicable" rather than guessing.

  return (
    <Layout>
      <div className="mm-page">
        <header className="mm-header">
          <div className="mm-header-text">
            <p className="mm-eyebrow">{storeLabel}</p>
            <h1 className="mm-title">Manager Dashboard</h1>
            <p className="mm-meta">
              {userName} · {describeRange(range, customFrom, customTo)}
              {lastUpdated ? (
                <span className="mm-meta-updated"> · updated {relativeTime(lastUpdated)}</span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            className="mm-refresh"
            onClick={load}
            disabled={refreshing || status === "loading"}
            aria-label="Refresh dashboard"
          >
            <FaSyncAlt className={refreshing ? "is-spinning" : ""} aria-hidden="true" />
          </button>
        </header>

        <DateRangeFilter
          value={range}
          onChange={setRange}
          customFrom={customFrom}
          customTo={customTo}
          onCustomChange={(key, value) => {
            if (key === "from") setCustomFrom(value);
            else setCustomTo(value);
          }}
        />

        {status === "loading" ? (
          <DashboardState status="loading" />
        ) : status === "forbidden" ? (
          <DashboardState status="forbidden" />
        ) : status === "error" ? (
          <DashboardState status="error" error={error} onRetry={load} />
        ) : isEmpty ? (
          <DashboardState
            status="empty"
            emptyMessage={`No sales found for ${describeRange(range, customFrom, customTo).toLowerCase()}`}
            emptyHint="Try a wider date range, or check that a shift was open."
          />
        ) : (
          <>
            {/* 1 — the money, first. */}
            <section className="mm-kpi-grid" aria-label="Key figures">
              <KpiTile
                label="Net sales"
                value={netSales == null ? "—" : formatINRCompact(netSales)}
                sub={netSales != null && sales?.hasDiscount ? "after returns" : "collected"}
                icon={<FaRupeeSign />}
                tone="primary"
                emphasis
              />
              <KpiTile
                label="Invoices"
                value={formatCount(sales.invoiceCount)}
                sub={
                  sales.cancelledCount > 0
                    ? `${sales.cancelledCount} cancelled`
                    : `avg ${formatINRWhole(sales.averageBill)}`
                }
                icon={<FaFileInvoice />}
                tone="violet"
              />
              <KpiTile
                label="Returns"
                value={
                  isSectionUnavailable(summary.returns)
                    ? "—"
                    : formatINRCompact(summary.returns.total)
                }
                sub={
                  isSectionUnavailable(summary.returns)
                    ? "not available"
                    : `${formatCount(summary.returns.returnCount)} returns`
                }
                icon={<FaUndo />}
                tone="amber"
              />
              <KpiTile
                label="Expenses"
                value={
                  isSectionUnavailable(summary.expenses)
                    ? "—"
                    : formatINRCompact(summary.expenses.total)
                }
                sub={
                  isSectionUnavailable(summary.expenses)
                    ? "not available"
                    : `${formatCount(summary.expenses.entryCount)} entries`
                }
                icon={<FaWallet />}
                tone="rose"
              />
            </section>

            {attention.length > 0 ? (
              <section className="mm-section" aria-label="Needs attention">
                <h2 className="mm-section-title">
                  <FaExclamationTriangle aria-hidden="true" /> Needs attention
                </h2>
                <ul className="mm-attention">
                  {attention.map((item) => (
                    <li key={item.id}>
                      <Link to={item.href} className={`mm-attention-item mm-sev-${item.severity}`}>
                        <span className="mm-attention-text">
                          <strong>{item.label}</strong>
                          <span>{item.detail}</span>
                        </span>
                        <FaArrowRight className="mm-attention-arrow" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* 2 — the grand financial picture. */}
            <section className="mm-section" aria-label="Sales summary">
              <h2 className="mm-section-title">Sales summary</h2>
              <dl className="mm-rows">
                <Row label="Gross sales" value={formatINR(sales.grossTotal)} />
                {sales.hasDiscount ? (
                  <Row
                    label="Discount"
                    value={`− ${formatINR(sales.discountTotal)}`}
                    tone="credit"
                  />
                ) : null}
                <Row label="Taxable" value={formatINR(sales.subTotal)} />
                <Row label="GST" value={formatINR(sales.gstTotal)} />
                <Row label="Net sales" value={formatINR(sales.grandTotal)} strong />
                <Row
                  label="Less returns"
                  value={
                    isSectionUnavailable(summary.returns)
                      ? "Not tracked for this store"
                      : `− ${formatINR(summary.returns.total)}`
                  }
                  tone={isSectionUnavailable(summary.returns) ? "muted" : "credit"}
                />
                <Row
                  label="Net after returns"
                  value={formatINR(netSales ?? sales.grandTotal)}
                  strong
                />
              </dl>
            </section>

            {/* 3 — payments. */}
            {payments ? (
              <section className="mm-section" aria-label="Payments">
                <h2 className="mm-section-title">Payments</h2>
                <ul className="mm-payments">
                  {payments.items.map((item) => (
                    <li key={item.mode} className="mm-payment">
                      <span className="mm-payment-mode">{item.mode}</span>
                      <span className="mm-payment-bar" aria-hidden="true">
                        <span style={{ width: `${Math.min(100, item.share)}%` }} />
                      </span>
                      <span className="mm-payment-value">{formatINR(item.total)}</span>
                      <span className="mm-payment-share">{item.share}%</span>
                    </li>
                  ))}
                </ul>
                {payments.hasSplit ? (
                  <p className="mm-footnote">
                    Split payments are stored as one combined amount, so their per-mode split
                    isn&apos;t available.
                  </p>
                ) : null}
              </section>
            ) : null}

            {/* 4 — trend. */}
            <section className="mm-section" aria-label="Sales trend">
              <h2 className="mm-section-title">Sales trend</h2>
              {isSingleDayRange(from, to) ? (
                <p className="mm-footnote">
                  A single day has no trend to plot. Pick a week or month to see the shape.
                </p>
              ) : (
                <div
                  className="mm-chart"
                  role="img"
                  aria-label={`Sales by day from ${from} to ${to}`}
                >
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        vertical={false}
                        stroke="rgba(148,163,184,0.25)"
                      />
                      <XAxis
                        dataKey="day"
                        tickFormatter={formatShortDate}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tickFormatter={(v) => formatINRCompact(v).replace("₹", "")}
                        tick={{ fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={52}
                      />
                      <Tooltip
                        formatter={(value) => [formatINR(value), "Sales"]}
                        labelFormatter={(label) => formatShortDate(label)}
                        contentStyle={{ fontSize: 12, borderRadius: 8 }}
                      />
                      <Bar dataKey="revenue" fill="#4f46e5" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* 5 — operational sections, store-type aware. */}
            {summary.inventory ? (
              <section className="mm-section" aria-label="Inventory">
                <h2 className="mm-section-title">
                  <FaBoxes aria-hidden="true" /> Inventory
                </h2>
                <ul className="mm-stat-row">
                  <Stat
                    label="Out of stock"
                    value={formatCount(summary.inventory.outOfStock)}
                    tone="critical"
                  />
                  <Stat
                    label="Critical"
                    value={formatCount(summary.inventory.critical)}
                    tone="warning"
                  />
                  <Stat label="Low" value={formatCount(summary.inventory.low)} tone="info" />
                </ul>
                {summary.inventory.criticalItems?.length > 0 ? (
                  <ul className="mm-mini-list">
                    {summary.inventory.criticalItems.map((item) => (
                      <li key={item.id}>
                        <span className="mm-mini-name">{item.name}</span>
                        <span className={`mm-mini-value mm-sev-${item.severity}`}>
                          {item.stock} / {item.lowStock}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <Link to="/inventory" className="mm-section-link">
                  View inventory <FaArrowRight aria-hidden="true" />
                </Link>
              </section>
            ) : null}

            {isSectionUnavailable(summary.returns) ? (
              <section className="mm-section" aria-label="Returns">
                <h2 className="mm-section-title">
                  <FaUndo aria-hidden="true" /> Returns
                </h2>
                <p className="mm-footnote">
                  Returns data isn&apos;t available for this store — the returns ledger isn&apos;t
                  set up on this deployment. This is not a zero.
                </p>
              </section>
            ) : null}

            {summary.shifts ? (
              <section className="mm-section" aria-label="Current shift">
                <h2 className="mm-section-title">
                  <FaClock aria-hidden="true" /> Current shift
                </h2>
                <dl className="mm-rows">
                  <Row label="Opened" value={formatTime(summary.shifts.openedAt)} />
                  <Row label="Opening cash" value={formatINR(summary.shifts.openingFloat)} />
                  <Row
                    label="Expected cash"
                    value={formatINR(summary.shifts.expectedCash)}
                    strong
                  />
                </dl>
                <Link to="/shifts" className="mm-section-link">
                  View shifts <FaArrowRight aria-hidden="true" />
                </Link>
              </section>
            ) : null}

            {summary.hotel ? (
              <section className="mm-section" aria-label="Hotel occupancy">
                <h2 className="mm-section-title">
                  <FaHotel aria-hidden="true" /> Bookings
                </h2>
                <ul className="mm-stat-row">
                  {summary.hotel.bookings.map((b) => (
                    <Stat key={b.kind} label={b.kind} value={formatCount(b.total)} tone="info" />
                  ))}
                </ul>
                <p className="mm-footnote">
                  Live table and room occupancy isn&apos;t shown here — it comes from the
                  hotel&apos;s live sync, which this dashboard doesn&apos;t read.
                </p>
              </section>
            ) : null}

            {summary.customers ? (
              <section className="mm-section" aria-label="Customers">
                <h2 className="mm-section-title">
                  <FaUsers aria-hidden="true" /> Customers
                </h2>
                <ul className="mm-stat-row">
                  <Stat
                    label="New"
                    value={formatCount(summary.customers.newInPeriod)}
                    tone="primary"
                  />
                  <Stat label="Total" value={formatCount(summary.customers.total)} tone="default" />
                  {summary.customers.pendingCount > 0 ? (
                    <Stat
                      label="Pending"
                      value={formatCount(summary.customers.pendingCount)}
                      tone="warning"
                    />
                  ) : null}
                </ul>
                <Link to="/customers" className="mm-section-link">
                  View customers <FaArrowRight aria-hidden="true" />
                </Link>
              </section>
            ) : null}

            {Array.isArray(summary.purchaseOrders) && summary.purchaseOrders.length > 0 ? (
              <section className="mm-section" aria-label="Purchase orders">
                <h2 className="mm-section-title">
                  <FaShoppingCart aria-hidden="true" /> Purchase orders
                </h2>
                <ul className="mm-stat-row">
                  {summary.purchaseOrders.map((po) => (
                    <Stat
                      key={po.status}
                      label={po.status}
                      value={formatCount(po.count)}
                      tone="default"
                    />
                  ))}
                </ul>
                <Link to="/inventory-module" className="mm-section-link">
                  View purchase orders <FaArrowRight aria-hidden="true" />
                </Link>
              </section>
            ) : null}
          </>
        )}

        {status === "ready" && !isEmpty ? (
          <div className="mm-footer">
            <Link to="/dashboard" className="mm-footer-link">
              <FaChartLine aria-hidden="true" /> Full dashboard
            </Link>
            <Link to="/invoices" className="mm-footer-link">
              <FaFileInvoice aria-hidden="true" /> All invoices
            </Link>
            <Link to="/reports" className="mm-footer-link">
              <FaCreditCard aria-hidden="true" /> Reports
            </Link>
          </div>
        ) : null}
      </div>
    </Layout>
  );
};

// Only the channels that can change a figure on this screen. A `customer` or
// `audit` event does not alter the dashboard totals, so ignoring it avoids
// pointless refetches.
const DASHBOARD_REALTIME_KINDS = new Set([
  "invoice",
  "stock",
  "shift",
  "return",
  "order",
  "customer_credit",
]);

const Row = ({ label, value, strong, tone }) => (
  <div className={`mm-row ${strong ? "is-strong" : ""} ${tone ? `is-${tone}` : ""}`.trim()}>
    <dt className="mm-row-label">{label}</dt>
    <dd className="mm-row-value">{value}</dd>
  </div>
);

const Stat = ({ label, value, tone = "default" }) => (
  <li className={`mm-stat mm-stat-${tone}`}>
    <strong className="mm-stat-value">{value}</strong>
    <span className="mm-stat-label">{label}</span>
  </li>
);

const relativeTime = (timestamp) => {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
};

const formatTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};

export default ManagerDashboard;
