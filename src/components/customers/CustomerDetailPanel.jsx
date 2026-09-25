// CustomerDetailPanel — Customer profile + purchase history (Phase 2A).
//
// Extends the existing Customer Management page; it does not replace it.
// Everything renders inside the page's own `user-mgmt-*` design language so
// the feature reads as a native part of the screen rather than a bolt-on.
//
// READ-ONLY. Nothing here mutates a customer — approve / reject / edit /
// delete all remain exactly where they were in the parent list.
//
// Ordering: the API returns `generated_at DESC, id DESC` and this component
// renders rows in the order received. There is deliberately no `.sort()` and
// no `.reverse()` anywhere in this file.

import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  FaPhoneAlt,
  FaEnvelope,
  FaMapMarkerAlt,
  FaFileInvoice,
  FaStore,
  FaEye,
  FaSyncAlt,
  FaUndo,
  FaExclamationTriangle,
  FaShoppingBag,
  FaChevronLeft,
  FaChevronRight,
} from "react-icons/fa";
import { getCustomerPurchaseHistory, getCustomerSummary } from "../../services/customerService";

// Mirrors the StatusBadge defined inline in CustomerManagement.jsx — same
// `user-mgmt-status-*` classes, same markup, same title behaviour. The parent
// keeps its local copy; duplicating the three-line mapping here avoids
// refactoring a component this feature must not disturb.
const StatusBadge = ({ status, reason }) => {
  if (!status) return null;
  const cls =
    status === "pending"
      ? "user-mgmt-status-pending"
      : status === "approved"
        ? "user-mgmt-status-approved"
        : "user-mgmt-status-rejected";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const title = status === "rejected" && reason ? `Rejected: ${reason}` : `Status: ${label}`;
  return (
    <span className={`user-mgmt-status-badge ${cls}`} title={title}>
      {label}
    </span>
  );
};

const fmtINR = (v) =>
  `₹${Number(v || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const fmtDate = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const itemCount = (inv) => (Array.isArray(inv.items) ? inv.items.length : 0);

// Return state is derived server-side from invoice_returns. Rendered as a
// small pill so a refunded invoice is obvious at a glance.
const ReturnBadge = ({ state, count }) => {
  if (!state || state === "none") return <span className="cdh-return-none">—</span>;
  const label =
    state === "full" ? "Fully returned" : count > 1 ? `Returned (${count})` : "Returned";
  return (
    <span className={`cdh-return cdh-return-${state}`}>
      <FaUndo aria-hidden="true" /> {label}
    </span>
  );
};

const Stat = ({ label, value, hint }) => (
  <div className="cdh-stat">
    <span className="cdh-stat-label">{label}</span>
    <strong className="cdh-stat-value">{value}</strong>
    {hint && <span className="cdh-stat-hint">{hint}</span>}
  </div>
);

const CustomerDetailPanel = ({ customer, onClose }) => {
  const [history, setHistory] = useState({ items: [], pagination: null });
  const [summary, setSummary] = useState(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [error, setError] = useState("");

  const pageSize = 10;

  const load = useCallback(async () => {
    if (!customer?.id) return;
    setLoading(true);
    setError("");
    try {
      const data = await getCustomerPurchaseHistory(customer.id, { page, pageSize });
      setHistory({
        items: Array.isArray(data?.items) ? data.items : [],
        pagination: data?.pagination || null,
      });
    } catch (err) {
      setError(err?.message || "Could not load purchase history");
      setHistory({ items: [], pagination: null });
    } finally {
      setLoading(false);
    }
  }, [customer?.id, page]);

  const loadSummary = useCallback(async () => {
    if (!customer?.id) return;
    setSummaryLoading(true);
    try {
      const data = await getCustomerSummary(customer.id);
      setSummary(data?.summary || null);
    } catch {
      // The summary is supplementary — a failure here must not blank the
      // history table, which is the primary content.
      setSummary(null);
    } finally {
      setSummaryLoading(false);
    }
  }, [customer?.id]);

  useEffect(() => {
    setPage(1);
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    load();
  }, [load]);

  // Esc closes, matching the rest of the app's modal behaviour.
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!customer) return null;

  const status = customer.approvalStatus || "approved";
  const pagination = history.pagination;
  const totalPages = pagination?.totalPages || 1;
  const from = pagination?.total ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const to = pagination?.total
    ? Math.min(pagination.page * pagination.pageSize, pagination.total)
    : 0;

  return (
    <div className="cdh-overlay" role="dialog" aria-modal="true" aria-label="Customer details">
      <div className="cdh-panel">
        {/* Profile header */}
        <header className="cdh-head">
          <div className="cdh-head-main">
            <span className="cdh-avatar" aria-hidden="true">
              {(customer.name || "?").charAt(0).toUpperCase()}
            </span>
            <div>
              <h3 className="cdh-name">{customer.name || "Unnamed customer"}</h3>
              <div className="cdh-head-meta">
                <StatusBadge status={status} reason={customer.rejectionReason} />
                {customer._storeType && (
                  <span className="cdh-chip">
                    <FaStore aria-hidden="true" /> {customer._storeType}
                    {customer._storeId ? ` / ${customer._storeId}` : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="cdh-head-actions">
            <button
              type="button"
              className="user-mgmt-action-btn"
              onClick={() => {
                load();
                loadSummary();
              }}
              disabled={loading}
              aria-label="Refresh purchase history"
              title="Refresh"
            >
              <FaSyncAlt className={loading ? "cdh-spin" : undefined} />
            </button>
            <button
              type="button"
              className="user-mgmt-action-btn"
              onClick={onClose}
              aria-label="Close customer details"
              title="Close"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="cdh-body">
          {/* Customer information */}
          <section className="cdh-section">
            <h4 className="cdh-section-title">Customer Information</h4>
            <div className="cdh-info-grid">
              <div>
                <span className="cdh-info-label">Mobile</span>
                <span className="cdh-info-value">
                  {customer.phone ? (
                    <>
                      <FaPhoneAlt aria-hidden="true" /> {customer.phone}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <div>
                <span className="cdh-info-label">Email</span>
                <span className="cdh-info-value">
                  {customer.email ? (
                    <>
                      <FaEnvelope aria-hidden="true" /> {customer.email}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <div>
                <span className="cdh-info-label">GSTIN</span>
                <span className="cdh-info-value cdh-mono">{customer.gstin || "—"}</span>
              </div>
              <div>
                <span className="cdh-info-label">Address</span>
                <span className="cdh-info-value">
                  {customer.address ? (
                    <>
                      <FaMapMarkerAlt aria-hidden="true" /> {customer.address}
                    </>
                  ) : (
                    "—"
                  )}
                </span>
              </div>
              <div>
                <span className="cdh-info-label">Created</span>
                <span className="cdh-info-value">{fmtDate(customer.createdAt)}</span>
              </div>
              <div>
                <span className="cdh-info-label">Created by</span>
                <span className="cdh-info-value">{customer.createdByEmail || "—"}</span>
              </div>
            </div>
          </section>

          {/* Purchase summary */}
          <section className="cdh-section">
            <h4 className="cdh-section-title">Purchase Summary</h4>
            {summaryLoading ? (
              <div className="cdh-stats cdh-stats-skeleton" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="cdh-stat cdh-stat-skeleton" />
                ))}
              </div>
            ) : (
              <div className="cdh-stats">
                <Stat
                  label="Invoices"
                  value={(summary?.totalInvoices ?? 0).toLocaleString("en-IN")}
                  hint="All time"
                />
                <Stat
                  label="Total purchase"
                  value={fmtINR(summary?.totalPurchaseAmount)}
                  hint="Gross, incl. GST"
                />
                <Stat label="Total GST" value={fmtINR(summary?.totalGst)} />
                <Stat
                  label="Total returned"
                  value={fmtINR(summary?.totalReturnedAmount)}
                  hint="Settled returns"
                />
                <Stat
                  label="Total discount"
                  value={fmtINR(summary?.totalDiscount)}
                  hint="Bill level"
                />
                <Stat label="Average order" value={fmtINR(summary?.averageOrderValue)} />
                <Stat label="First purchase" value={fmtDate(summary?.firstPurchaseDate)} />
                <Stat label="Last purchase" value={fmtDate(summary?.lastPurchaseDate)} />
              </div>
            )}
          </section>

          {/* Purchase history */}
          <section className="cdh-section">
            <h4 className="cdh-section-title">
              <FaFileInvoice aria-hidden="true" /> Purchase History
            </h4>

            {error && (
              <div className="cdh-alert" role="alert">
                <FaExclamationTriangle aria-hidden="true" />
                <span>{error}</span>
                <button type="button" onClick={load} className="cdh-retry">
                  Retry
                </button>
              </div>
            )}

            {!error && loading ? (
              <div className="cdh-table-skeleton" aria-hidden="true">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="cdh-skeleton-row" />
                ))}
              </div>
            ) : !error && history.items.length === 0 ? (
              <div className="cdh-empty">
                <FaShoppingBag aria-hidden="true" />
                <strong>No purchase history found for this customer.</strong>
                <span>
                  Invoices are matched by customer id, so only bills raised against this customer
                  appear here.
                </span>
              </div>
            ) : !error ? (
              <>
                <div className="cdh-table-wrap">
                  <table className="cdh-table">
                    <thead>
                      <tr>
                        <th>Invoice No</th>
                        <th>Date</th>
                        <th className="cdh-th-num">Items</th>
                        <th className="cdh-th-num">Subtotal</th>
                        <th className="cdh-th-num">Discount</th>
                        <th className="cdh-th-num">GST</th>
                        <th className="cdh-th-num">Total</th>
                        <th>Payment</th>
                        <th>Status</th>
                        <th>Return</th>
                        <th aria-label="actions" />
                      </tr>
                    </thead>
                    <tbody>
                      {/* Rendered in the order the API returned — newest first.
                          Do NOT sort or reverse here. */}
                      {history.items.map((inv) => (
                        <tr key={inv.id || inv.invoiceNo}>
                          <td className="cdh-mono cdh-strong">{inv.invoiceNo || "—"}</td>
                          <td>{fmtDate(inv.generatedAt || inv.date)}</td>
                          <td className="cdh-num">{itemCount(inv)}</td>
                          <td className="cdh-num">{fmtINR(inv.subTotal)}</td>
                          <td className="cdh-num">{inv.discount ? fmtINR(inv.discount) : "—"}</td>
                          <td className="cdh-num">{fmtINR(inv.gstTotal)}</td>
                          <td className="cdh-num cdh-strong">{fmtINR(inv.grandTotal)}</td>
                          <td>{inv.paymentMode || "—"}</td>
                          <td>{inv.status || <span className="cdh-muted">—</span>}</td>
                          <td>
                            <ReturnBadge state={inv.returnState} count={inv.returnCount} />
                          </td>
                          <td className="cdh-action-cell">
                            <Link
                              className="user-mgmt-action-btn"
                              to={`/invoice/${encodeURIComponent(inv.invoiceNo || "")}/preview`}
                              aria-label={`View invoice ${inv.invoiceNo}`}
                              title="View invoice"
                            >
                              <FaEye />
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {pagination?.total > 0 && (
                  <div className="cdh-pagination">
                    <span>
                      Showing <strong>{from}</strong>–<strong>{to}</strong> of{" "}
                      <strong>{pagination.total}</strong>
                    </span>
                    <div className="cdh-pager">
                      <button
                        type="button"
                        className="cdh-pager-btn"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1 || loading}
                        aria-label="Previous page"
                      >
                        <FaChevronLeft />
                      </button>
                      <span className="cdh-pager-label">
                        Page {pagination.page} of {totalPages}
                      </span>
                      <button
                        type="button"
                        className="cdh-pager-btn"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages || loading}
                        aria-label="Next page"
                      >
                        <FaChevronRight />
                      </button>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
};

export default CustomerDetailPanel;
