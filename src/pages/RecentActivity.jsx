import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaSearch,
  FaSync,
  FaFilter,
  FaUserCircle,
  FaCheckCircle,
  FaExclamationCircle,
  FaPen,
  FaTrash,
  FaPlus,
  FaArrowLeft,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { getAuditLog } from "../services/auditLogService";
import "./RecentActivity.css";

/**
 * RecentActivity — Admin-visible audit log viewer.
 *
 * Reads from GET /api/audit-log, which is append-only on the server
 * (no UI path can rewrite or delete a row). The backend handles:
 *   - row-count pagination
 *   - per-tenant scoping (SUPER_OWNER can override)
 *   - filters by resource / resourceId / userEmail / method / action / q / date range
 *
 * This page is admin-gated on the server (returns 403 to CASHIER). The
 * client-side guard here is defense in depth — both must be present.
 */

const PAGE_SIZE = 50;

const METHOD_TONE = {
  POST: { bg: "rgba(16, 185, 129, 0.12)", color: "#047857", label: "Created" },
  PUT: { bg: "rgba(59, 130, 246, 0.12)", color: "#1d4ed8", label: "Updated" },
  PATCH: { bg: "rgba(59, 130, 246, 0.12)", color: "#1d4ed8", label: "Updated" },
  DELETE: { bg: "rgba(220, 38, 38, 0.12)", color: "#b91c1c", label: "Deleted" },
};

const RESOURCE_LABEL = {
  products: "Product",
  services: "Service",
  orders: "Order",
  invoices: "Invoice",
  customer_credits: "Customer Credit",
  expenses: "Expense",
  users: "User",
  hotel_tables: "Table",
  hotel_rooms: "Room",
  hotel_room_folios: "Room Charge",
  hotel_waiting: "Waitlist",
  hotel_dining_waiting: "Dining Waitlist",
  hotel_lodging_waiting: "Lodging Waitlist",
  hotel_dining_bills: "Dining Bill",
  hotel_checkout_history: "Checkout",
  laundry_ledger: "Stock Entry",
  res_counters: "Counter",
  store_settings: "Settings",
  notifications: "Notification",
};

const formatRelativeTime = (iso) => {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return iso;
  const deltaSec = (Date.now() - t) / 1000;
  if (deltaSec < 60) return `${Math.round(deltaSec)}s ago`;
  if (deltaSec < 3600) return `${Math.round(deltaSec / 60)}m ago`;
  if (deltaSec < 86400) return `${Math.round(deltaSec / 3600)}h ago`;
  if (deltaSec < 86400 * 7) return `${Math.round(deltaSec / 86400)}d ago`;
  return new Date(iso).toLocaleString();
};

const methodBadge = (method) => {
  const tone = METHOD_TONE[method] || { bg: "#eee", color: "#444", label: method };
  return (
    <span className="ra-pill" style={{ background: tone.bg, color: tone.color }}>
      {tone.label}
    </span>
  );
};

const statusIcon = (row) =>
  row.ok ? (
    <FaCheckCircle style={{ color: "#10b981" }} title={`HTTP ${row.statusCode} — OK`} />
  ) : (
    <FaExclamationCircle
      style={{ color: "#dc2626" }}
      title={`HTTP ${row.statusCode ?? "?"} — failed`}
    />
  );

const methodIcon = (method) => {
  if (method === "POST") return <FaPlus />;
  if (method === "DELETE") return <FaTrash />;
  return <FaPen />;
};

// Pull a human-readable subject out of the body for the row summary.
// e.g. body.name = "Tea" → "Tea", body.email = "alex@…" → "alex@…".
const summarizeRow = (row) => {
  const body = row.body;
  if (!body) return row.resourceId || "—";
  if (typeof body !== "object") return String(body);
  if (body.name) return String(body.name);
  if (body.email) return String(body.email);
  if (body.invoiceNo) return String(body.invoiceNo);
  if (body.productName) return String(body.productName);
  if (body.guest) return String(body.guest);
  if (body.roomName) return String(body.roomName);
  if (body.description) return String(body.description);
  return row.resourceId || "—";
};

const RecentActivity = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState(null);

  const [filters, setFilters] = useState({
    q: "",
    resource: "",
    method: "",
    userEmail: "",
    from: "",
    to: "",
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);

  const fetchPage = useCallback(
    async (filterValues, off) => {
      setLoading(true);
      try {
        const params = { limit: PAGE_SIZE, offset: off, ...filterValues };
        const data = await getAuditLog(params);
        setRows(
          off === 0 ? data.rows || [] : [...(Array.isArray(rows) ? rows : []), ...(data.rows || [])]
        );
        setTotal(data.total || 0);
      } catch (err) {
        // 403 here just means the user isn't admin — the route already
        // gates this on the server. Quietly drop to empty.
        if (err && err.status === 403) {
          setRows([]);
          setTotal(0);
        } else {
          // eslint-disable-next-line no-console
          console.error("Failed to load audit log:", err);
        }
      } finally {
        setLoading(false);
      }
    },
    [rows]
  );

  // Reload whenever filters or offset change at the page boundary.
  useEffect(() => {
    fetchPage(appliedFilters, 0);
    setOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFilters]);

  const hasMore = rows.length < total;

  const loadMore = () => {
    const next = offset + PAGE_SIZE;
    setOffset(next);
    fetchPage(appliedFilters, next);
  };

  const refresh = () => fetchPage(appliedFilters, 0);

  const applyFilters = () => setAppliedFilters(filters);

  const clearFilters = () => {
    const empty = { q: "", resource: "", method: "", userEmail: "", from: "", to: "" };
    setFilters(empty);
    setAppliedFilters(empty);
  };

  const resourceOptions = useMemo(() => Object.keys(RESOURCE_LABEL), []);

  return (
    <div className="ra-page">
      <header className="ra-header">
        <button type="button" className="ra-back-btn" onClick={() => navigate(-1)}>
          <FaArrowLeft /> Back
        </button>
        <div>
          <h1>Recent Activity</h1>
          <p className="ra-subtitle">
            Tamper-proof audit trail of every mutating change. {total.toLocaleString("en-IN")}{" "}
            entries in the window.
          </p>
        </div>
        <button type="button" className="ra-refresh" onClick={refresh} disabled={loading}>
          <FaSync className={loading ? "ra-spin" : ""} /> Refresh
        </button>
      </header>

      <section className="ra-filters">
        <div className="ra-filter-row">
          <div className="ra-filter-field">
            <label>Search</label>
            <div className="ra-input-wrap">
              <FaSearch />
              <input
                type="text"
                placeholder="Path, user, resource id…"
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              />
            </div>
          </div>
          <div className="ra-filter-field">
            <label>Resource</label>
            <select
              value={filters.resource}
              onChange={(e) => setFilters({ ...filters, resource: e.target.value })}
            >
              <option value="">All</option>
              {resourceOptions.map((r) => (
                <option key={r} value={r}>
                  {RESOURCE_LABEL[r] || r}
                </option>
              ))}
            </select>
          </div>
          <div className="ra-filter-field">
            <label>Action</label>
            <select
              value={filters.method}
              onChange={(e) => setFilters({ ...filters, method: e.target.value })}
            >
              <option value="">All</option>
              <option value="POST">Created</option>
              <option value="PUT">Updated</option>
              <option value="PATCH">Patched</option>
              <option value="DELETE">Deleted</option>
            </select>
          </div>
        </div>

        <div className="ra-filter-row">
          <div className="ra-filter-field ra-grow">
            <label>User</label>
            <input
              type="text"
              placeholder="email@…"
              value={filters.userEmail}
              onChange={(e) => setFilters({ ...filters, userEmail: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            />
          </div>
          <div className="ra-filter-field">
            <label>From</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            />
          </div>
          <div className="ra-filter-field">
            <label>To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            />
          </div>
          <div className="ra-filter-actions">
            <button
              type="button"
              className="ra-btn-primary"
              onClick={applyFilters}
              disabled={loading}
            >
              <FaFilter /> Apply
            </button>
            <button
              type="button"
              className="ra-btn-secondary"
              onClick={clearFilters}
              disabled={loading}
            >
              Clear
            </button>
          </div>
        </div>
      </section>

      <section className="ra-list">
        {rows.length === 0 && !loading && (
          <div className="ra-empty">No activity matches the current filters.</div>
        )}
        {rows.map((row) => {
          const isOpen = expandedId === row.id;
          const subject = summarizeRow(row);
          const resourceLabel = RESOURCE_LABEL[row.resource] || row.resource || "—";
          return (
            <article key={row.id} className={`ra-row ${isOpen ? "ra-row-open" : ""}`}>
              <header
                className="ra-row-summary"
                onClick={() => setExpandedId(isOpen ? null : row.id)}
              >
                <div className="ra-row-left">
                  {methodBadge(row.method)}
                  <span className="ra-row-icon">{methodIcon(row.method)}</span>
                  <div>
                    <div className="ra-row-title">
                      <span className="ra-row-action">{resourceLabel.toLowerCase()}</span>
                      {": "}
                      <span className="ra-row-subject">{subject}</span>
                      {row.action ? <span className="ra-row-action-tag">/{row.action}</span> : null}
                    </div>
                    <div className="ra-row-meta">
                      <FaUserCircle />
                      <span>{row.userEmail || "system"}</span>
                      {row.userRole ? <span className="ra-role-chip">{row.userRole}</span> : null}
                      {row.ip ? <span className="ra-ip-chip">{row.ip}</span> : null}
                    </div>
                  </div>
                </div>
                <div className="ra-row-right">
                  <span className="ra-row-time" title={row.at}>
                    {formatRelativeTime(row.at)}
                  </span>
                  {statusIcon(row)}
                </div>
              </header>
              {isOpen && (
                <div className="ra-row-detail">
                  <dl className="ra-detail-list">
                    <div>
                      <dt>Path</dt>
                      <dd className="ra-mono">{row.path}</dd>
                    </div>
                    {row.resourceId ? (
                      <div>
                        <dt>Resource ID</dt>
                        <dd className="ra-mono">{row.resourceId}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Method</dt>
                      <dd className="ra-mono">{row.method}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>
                        HTTP {row.statusCode ?? "?"}
                        {row.errorMessage ? ` — ${row.errorMessage}` : ""}
                      </dd>
                    </div>
                    {row.userAgent ? (
                      <div>
                        <dt>User agent</dt>
                        <dd className="ra-mono ra-truncate">{row.userAgent}</dd>
                      </div>
                    ) : null}
                  </dl>
                  {row.body ? (
                    <div className="ra-body-block">
                      <h4>Request body</h4>
                      <pre className="ra-pre">{JSON.stringify(row.body, null, 2)}</pre>
                    </div>
                  ) : null}
                </div>
              )}
            </article>
          );
        })}
      </section>

      <footer className="ra-footer">
        <span>
          Showing {rows.length.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
        </span>
        {hasMore && (
          <button type="button" className="ra-btn-secondary" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </footer>
    </div>
  );
};

export default RecentActivity;
