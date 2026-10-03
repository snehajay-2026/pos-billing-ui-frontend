// SuperOwnerPayments.jsx
//
// Payments view for SUPER_OWNER. Two clearly separated platform sections:
// payment records (GET /api/super/payment-records, paginated, status
// filter allowlisted against the payment_records ENUM) and subscription
// lifecycle events (GET /api/super/subscription-events, paginated, no
// filter — event_type IS the lifecycle marker). Tenant identity comes
// from each row's parent subscription — no tenant filter is sent from
// the UI. Below both tables the page keeps the Super Owner's own latest
// payment state (from GET /api/subscriptions/my) for context.

import React, { useCallback, useEffect, useState } from "react";
import {
  getSuperOwnerContext,
  listPlatformPaymentRecords,
  listPlatformSubscriptionEvents,
} from "../../services/superOwnerService";
import { toErrorMessage } from "../../utils/errorMessage";
import { formatINR } from "../../utils/formatCurrency";
import "./SuperOwnerPages.css";

const STATUSES = ["", "created", "authorized", "captured", "failed", "refunded"];
const PAGE_SIZE = 25;

const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString("en-IN");
};

const SuperOwnerPayments = () => {
  const [context, setContext] = useState({ plans: [], subscription: null });
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [tableLoading, setTableLoading] = useState(true);
  const [error, setError] = useState("");
  const [tableError, setTableError] = useState("");
  const [events, setEvents] = useState([]);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState("");

  const loadTable = useCallback(async (nextPage, nextStatus) => {
    setTableLoading(true);
    setTableError("");
    try {
      const res = await listPlatformPaymentRecords({
        status: nextStatus || undefined,
        page: nextPage,
        limit: PAGE_SIZE,
      });
      setRecords(Array.isArray(res?.records) ? res.records : []);
      setTotal(Number.isFinite(Number(res?.total)) ? Number(res.total) : 0);
      setPage(Number(res?.page) || nextPage);
    } catch (err) {
      setRecords([]);
      setTableError(toErrorMessage(err, "Platform payment history is unavailable right now."));
    } finally {
      setTableLoading(false);
    }
  }, []);

  const loadEvents = useCallback(async (nextPage) => {
    setEventsLoading(true);
    setEventsError("");
    try {
      const res = await listPlatformSubscriptionEvents({
        page: nextPage,
        limit: PAGE_SIZE,
      });
      setEvents(Array.isArray(res?.events) ? res.events : []);
      setEventsTotal(Number.isFinite(Number(res?.total)) ? Number(res.total) : 0);
      setEventsPage(Number(res?.page) || nextPage);
    } catch (err) {
      setEvents([]);
      setEventsError(
        toErrorMessage(err, "Platform subscription events are unavailable right now.")
      );
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getSuperOwnerContext();
        if (!cancelled) setContext(ctx);
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err, "Something went wrong. Please try again."));
      } finally {
        if (!cancelled) setLoading(false);
      }
      await loadTable(1, "");
      if (!cancelled) await loadEvents(1);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadTable, loadEvents]);

  const onStatusChange = (next) => {
    setStatus(next);
    setPage(1);
    loadTable(1, next);
  };

  const onPageChange = (next) => {
    setPage(next);
    loadTable(next, status);
  };

  const onEventsPageChange = (next) => {
    setEventsPage(next);
    loadEvents(next);
  };

  if (loading) return <div className="super-loading">Loading payments…</div>;

  const sub = context.subscription;
  const lastPayment = sub?.lastPayment || sub?.latestPayment || sub?.last_payment || null;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const eventsTotalPages = Math.max(1, Math.ceil(eventsTotal / PAGE_SIZE));

  return (
    <div className="super-page">
      {error ? <div className="super-error">{error}</div> : null}
      {tableError ? <div className="super-error">{tableError}</div> : null}
      {eventsError ? <div className="super-error">{eventsError}</div> : null}

      <div className="super-panel">
        <h2>Platform Payment History</h2>
        <div style={{ marginBottom: 10 }}>
          <label
            htmlFor="super-pay-status"
            style={{ fontSize: 12, color: "#94a3b8", marginRight: 8 }}
          >
            Status
          </label>
          <select
            id="super-pay-status"
            value={status}
            onChange={(e) => onStatusChange(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUSES.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {tableLoading ? (
          <div className="super-loading">Loading payment records…</div>
        ) : records.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
            No payment records found{status ? ` with status "${status}"` : ""}.
          </p>
        ) : (
          <>
            <div className="super-table-wrap">
              <table className="super-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Tenant</th>
                    <th>Subscription</th>
                    <th>Amount</th>
                    <th>Status</th>
                    <th>Provider Ref</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td>{r.id ?? "—"}</td>
                      <td>{r.tenantEmail || "—"}</td>
                      <td>{r.subscriptionId ?? "—"}</td>
                      <td>{formatINR(r.amount)}</td>
                      <td>{r.status || "—"}</td>
                      <td>{r.providerPaymentId || "—"}</td>
                      <td>{fmtDate(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="super-pagination" style={{ marginTop: 10 }}>
              <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                Previous
              </button>
              <span>
                Page {page} of {totalPages} ({total} records)
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>

      <div className="super-panel">
        <h2>Platform Subscription Events</h2>
        {eventsLoading ? (
          <div className="super-loading">Loading subscription events…</div>
        ) : events.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>No subscription events found.</p>
        ) : (
          <>
            <div className="super-table-wrap">
              <table className="super-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Event</th>
                    <th>Tenant</th>
                    <th>Subscription</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>{e.id ?? "—"}</td>
                      <td>{e.eventType || "—"}</td>
                      <td>{e.tenantEmail || "—"}</td>
                      <td>{e.subscriptionId ?? "—"}</td>
                      <td>{fmtDate(e.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="super-pagination" style={{ marginTop: 10 }}>
              <button
                type="button"
                disabled={eventsPage <= 1}
                onClick={() => onEventsPageChange(eventsPage - 1)}
              >
                Previous
              </button>
              <span>
                Page {eventsPage} of {eventsTotalPages} ({eventsTotal} events)
              </span>
              <button
                type="button"
                disabled={eventsPage >= eventsTotalPages}
                onClick={() => onEventsPageChange(eventsPage + 1)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>

      <div className="super-panel">
        <h2>Your Latest Payment State</h2>
        {!sub ? (
          <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
            No subscription row found for this Super Owner account, so there is no payment state to
            show.
          </p>
        ) : lastPayment ? (
          <div className="super-table-wrap">
            <table className="super-table">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Provider Ref</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{lastPayment.amount ?? lastPayment.amountPaise ?? "—"}</td>
                  <td>{lastPayment.status || "—"}</td>
                  <td>{lastPayment.providerPaymentId || lastPayment.razorpayPaymentId || "—"}</td>
                  <td>{lastPayment.createdAt || lastPayment.created_at || "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
            Plan: <strong>{sub.planName || sub.planId || "—"}</strong> · Status:{" "}
            <span className="super-badge">{sub.status || "unknown"}</span> · No discrete payment
            record is attached to this subscription response.
          </p>
        )}
      </div>
    </div>
  );
};

export default SuperOwnerPayments;
