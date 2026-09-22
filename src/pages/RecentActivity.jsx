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
  FaHistory,
  FaCopy,
  FaChevronDown,
  FaExclamationTriangle,
  FaShieldAlt,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { getAuditLog } from "../services/auditLogService";
import "./RecentActivity.css";

/**
 * RecentActivity — Admin-visible audit log viewer.
 *
 * Reads from GET /api/audit-log, which is append-only on the server
 * (no UI path can rewrite or delete a row). The backend handles:
 *   - row-count pagination (limit + offset)
 *   - per-tenant scoping (SUPER_OWNER can override)
 *   - filters by resource / method / userEmail / q / date range
 *
 * This page is admin-gated on the server (returns 403 to CASHIER). The
 * client-side guard here is defense in depth — both must be present.
 *
 * The UI is intentionally global: it shows audit entries for every
 * resource in the system (services, invoices, hotel rooms, etc.),
 * because the audit log is a cross-vertical compliance surface, not a
 * Service-Store sub-page. The sidebar entry lives in the global
 * "Manage" array, visible to all admin roles.
 */

const PAGE_SIZE = 50;

const METHOD_TONE_CLASS = {
  POST: "post",
  PUT: "put",
  PATCH: "patch",
  DELETE: "delete",
};

const METHOD_LABEL = {
  POST: "Created",
  PUT: "Updated",
  PATCH: "Patched",
  DELETE: "Deleted",
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

const formatAbsoluteTime = (iso) => {
  if (!iso) return "";
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  return t.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

// Day bucket key used by the client-side grouping (Today / Yesterday / Earlier).
// Returns null if iso is unparseable — the caller skips grouping for those rows.
const dayBucket = (iso, now = new Date()) => {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86400000;
  const tStart = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  if (tStart === todayStart) return "Today";
  if (tStart === yesterdayStart) return "Yesterday";
  return "Earlier";
};

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

// Group rows into ordered buckets: [{ label, rows }]. The server already
// returns rows newest-first; we don't re-sort, only partition.
const groupByDay = (rows) => {
  const order = ["Today", "Yesterday", "Earlier"];
  const buckets = { Today: [], Yesterday: [], Earlier: [] };
  for (const r of rows) {
    const k = dayBucket(r.at) || "Earlier";
    buckets[k].push(r);
  }
  return order
    .filter((k) => buckets[k].length > 0)
    .map((k) => ({
      label: k,
      rows: buckets[k],
    }));
};

// Skeleton placeholder row — used while the initial page is loading so
// layout doesn't jump when real rows arrive.
const SkeletonRow = () => (
  <div className="ra-row ra-skeleton-row" aria-hidden="true">
    <div className="ra-skeleton-pill" />
    <div className="ra-skeleton-icon" />
    <div className="ra-skeleton-lines">
      <div className="ra-skeleton-line ra-skeleton-line-title" />
      <div className="ra-skeleton-line ra-skeleton-line-meta" />
    </div>
  </div>
);

const RecentActivity = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // 403 is a real outcome (the route is admin-gated); render an
  // explanatory empty card instead of a confusing blank page.
  const [forbidden, setForbidden] = useState(false);

  const [filters, setFilters] = useState({
    q: "",
    resource: "",
    method: "",
    userEmail: "",
    from: "",
    to: "",
  });
  const [appliedFilters, setAppliedFilters] = useState(filters);

  const fetchPage = useCallback(async (filterValues, off, mode) => {
    const setLoading = mode === "more" ? setLoadingMore : setLoadingInitial;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    try {
      const params = { limit: PAGE_SIZE, offset: off, ...filterValues };
      const data = await getAuditLog(params);
      const newRows = data.rows || [];
      setRows((prev) => (off === 0 ? newRows : [...prev, ...newRows]));
      setTotal(data.total || 0);
    } catch (err) {
      if (err && err.status === 403) {
        // Quietly drop to empty + flag the forbidden state so the UI
        // can render a permission-required card. The route guard on
        // the server is the source of truth here; this just makes the
        // empty state honest.
        setRows([]);
        setTotal(0);
        setForbidden(true);
      } else {
        // eslint-disable-next-line no-console
        console.error("Failed to load audit log:", err);
        setLoadError(err && err.message ? err.message : "Could not load activity.");
        if (off === 0) {
          setRows([]);
          setTotal(0);
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever applied filters change. Offset always resets to 0
  // so changing a filter doesn't leave us mid-window on the previous
  // window's pagination.
  useEffect(() => {
    fetchPage(appliedFilters, 0, "initial");
    setOffset(0);
    setExpandedId(null);
    // fetchPage identity is stable (useCallback with []).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFilters]);

  const hasMore = rows.length < total;

  const loadMore = () => {
    if (loadingMore || loadingInitial) return;
    const next = offset + PAGE_SIZE;
    setOffset(next);
    fetchPage(appliedFilters, next, "more");
  };

  const refresh = () => fetchPage(appliedFilters, 0, "initial");

  const applyFilters = () => setAppliedFilters({ ...filters });

  const clearFilters = () => {
    const empty = { q: "", resource: "", method: "", userEmail: "", from: "", to: "" };
    setFilters(empty);
    setAppliedFilters(empty);
  };

  const resourceOptions = useMemo(() => Object.keys(RESOURCE_LABEL), []);

  // Only group when the user hasn't pinned a date range — otherwise
  // the buckets would mislead (e.g. "Today" with only entries older
  // than today because from=2025-01-01).
  const groupedRows = useMemo(() => {
    if (appliedFilters.from || appliedFilters.to) return null;
    return groupByDay(rows);
  }, [rows, appliedFilters.from, appliedFilters.to]);

  const showInitialSkeleton = loadingInitial && rows.length === 0 && !loadError && !forbidden;
  const showEmpty = !loadingInitial && !loadError && !forbidden && rows.length === 0;

  const copyBody = async (body) => {
    if (!body) return;
    try {
      const text = typeof body === "string" ? body : JSON.stringify(body, null, 2);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // Clipboard can be blocked by the browser — fail silently; the
      // <pre> stays visible and the user can copy manually.
    }
  };

  return (
    <div className="ra-page">
      {/* HERO — matches the modernized cluster's header treatment. */}
      <header className="ra-hero">
        <div className="ra-hero-bg" aria-hidden="true" />
        <div className="ra-hero-content">
          <div className="ra-hero-text">
            <span className="ra-hero-eyebrow">
              <FaShieldAlt /> Audit Trail
            </span>
            <h1 className="ra-hero-title">Recent Activity</h1>
            <p className="ra-hero-subtitle">
              Tamper-proof record of every mutating change across stores and resources.
            </p>
            <div className="ra-hero-meta">
              <span className="ra-hero-pill tone-sky">{total.toLocaleString("en-IN")} entries</span>
              {loadingInitial && <span className="ra-hero-pill tone-amber">Loading…</span>}
              {loadError && <span className="ra-hero-pill tone-rose">Load failed</span>}
            </div>
          </div>
          <div className="ra-hero-actions">
            <button
              type="button"
              className="ra-back-btn"
              onClick={() => navigate(-1)}
              aria-label="Back"
            >
              <FaArrowLeft /> Back
            </button>
            <button
              type="button"
              className="ra-refresh"
              onClick={refresh}
              disabled={loadingInitial}
              aria-label="Refresh activity"
            >
              <FaSync className={loadingInitial ? "ra-spin" : ""} /> Refresh
            </button>
          </div>
        </div>
      </header>

      {/* FILTERS — single-row strip on desktop, collapses on mobile. */}
      <section className="ra-filters" aria-label="Filters">
        <div className="ra-search">
          <FaSearch aria-hidden="true" />
          <input
            type="text"
            placeholder="Search path, user, invoice, room…"
            value={filters.q}
            onChange={(e) => setFilters({ ...filters, q: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
            aria-label="Search activity"
          />
        </div>

        <div className="ra-filter-field">
          <label htmlFor="ra-resource">Resource</label>
          <select
            id="ra-resource"
            value={filters.resource}
            onChange={(e) => setFilters({ ...filters, resource: e.target.value })}
          >
            <option value="">All resources</option>
            {resourceOptions.map((r) => (
              <option key={r} value={r}>
                {RESOURCE_LABEL[r] || r}
              </option>
            ))}
          </select>
        </div>

        <div className="ra-filter-field">
          <label htmlFor="ra-method">Action</label>
          <select
            id="ra-method"
            value={filters.method}
            onChange={(e) => setFilters({ ...filters, method: e.target.value })}
          >
            <option value="">All actions</option>
            <option value="POST">Created</option>
            <option value="PUT">Updated</option>
            <option value="PATCH">Patched</option>
            <option value="DELETE">Deleted</option>
          </select>
        </div>

        <div className="ra-filter-field ra-filter-field-grow">
          <label htmlFor="ra-user">User</label>
          <input
            id="ra-user"
            type="text"
            placeholder="email@…"
            value={filters.userEmail}
            onChange={(e) => setFilters({ ...filters, userEmail: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && applyFilters()}
          />
        </div>

        <div className="ra-filter-field">
          <label htmlFor="ra-from">From</label>
          <input
            id="ra-from"
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ ...filters, from: e.target.value })}
          />
        </div>

        <div className="ra-filter-field">
          <label htmlFor="ra-to">To</label>
          <input
            id="ra-to"
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
            disabled={loadingInitial}
          >
            <FaFilter /> Apply
          </button>
          <button
            type="button"
            className="ra-btn-secondary"
            onClick={clearFilters}
            disabled={loadingInitial}
          >
            Clear
          </button>
        </div>
      </section>

      {/* INITIAL-LOAD skeleton. */}
      {showInitialSkeleton && (
        <section className="ra-list" aria-busy="true" aria-live="polite">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </section>
      )}

      {/* ERROR — non-403 failures surface here with a retry button. */}
      {loadError && (
        <section className="ra-card ra-error" role="alert">
          <div className="ra-error-icon" aria-hidden="true">
            <FaExclamationTriangle />
          </div>
          <div className="ra-error-meta">
            <strong>Couldn't load activity</strong>
            <span>{loadError}</span>
          </div>
          <button type="button" className="ra-btn-primary" onClick={refresh}>
            <FaSync /> Retry
          </button>
        </section>
      )}

      {/* FORBIDDEN — honest empty state for non-admin users. */}
      {forbidden && (
        <section className="ra-card ra-empty">
          <div className="ra-empty-icon" aria-hidden="true">
            <FaShieldAlt />
          </div>
          <strong>Permission required</strong>
          <span>
            The audit log is only visible to admin roles. Ask a store admin or super owner if you
            need access.
          </span>
        </section>
      )}

      {/* EMPTY (no rows, no error, not loading, not forbidden). */}
      {showEmpty && (
        <section className="ra-card ra-empty">
          <div className="ra-empty-icon" aria-hidden="true">
            <FaHistory />
          </div>
          <strong>No activity matches the current filters</strong>
          <span>
            Try widening the date range, switching the resource, or clearing the filters to see
            older entries.
          </span>
          <button type="button" className="ra-btn-secondary" onClick={clearFilters}>
            Clear filters
          </button>
        </section>
      )}

      {/* LIST */}
      {!showInitialSkeleton && !loadError && !forbidden && rows.length > 0 && (
        <section className="ra-list" aria-label="Activity entries">
          {(groupedRows || [{ label: null, rows }]).map((group, gi) => (
            <React.Fragment key={group.label || "all"}>
              {group.label && (
                <div className="ra-day-divider">
                  <span>{group.label}</span>
                  <small>{group.rows.length}</small>
                </div>
              )}
              {group.rows.map((row) => {
                const isOpen = expandedId === row.id;
                const subject = summarizeRow(row);
                const resourceLabel = RESOURCE_LABEL[row.resource] || row.resource || "—";
                const toneClass = METHOD_TONE_CLASS[row.method] || "fallback";
                const actionLabel = METHOD_LABEL[row.method] || row.method || "—";
                const detailId = `ra-detail-${row.id}`;
                return (
                  <article
                    key={row.id}
                    className={`ra-row ra-row-tone-${toneClass}${isOpen ? " ra-row-open" : ""}`}
                  >
                    <button
                      type="button"
                      className="ra-row-summary"
                      onClick={() => setExpandedId(isOpen ? null : row.id)}
                      aria-expanded={isOpen}
                      aria-controls={detailId}
                    >
                      <span className={`ra-method-pill ${toneClass}`}>{actionLabel}</span>
                      <span className="ra-row-icon" aria-hidden="true">
                        {row.method === "POST" ? (
                          <FaPlus />
                        ) : row.method === "DELETE" ? (
                          <FaTrash />
                        ) : (
                          <FaPen />
                        )}
                      </span>
                      <span className="ra-row-text">
                        <span className="ra-row-title">
                          <span className="ra-row-resource">{resourceLabel.toLowerCase()}</span>
                          <span className="ra-row-sep">·</span>
                          <span className="ra-row-subject">{subject}</span>
                          {row.action ? (
                            <span className="ra-row-action-tag">/{row.action}</span>
                          ) : null}
                        </span>
                        <span className="ra-row-meta">
                          <FaUserCircle aria-hidden="true" />
                          <span className="ra-row-user">{row.userEmail || "system"}</span>
                          {row.userRole ? (
                            <span className="ra-row-chip">{row.userRole}</span>
                          ) : null}
                          {row.storeType ? (
                            <span className="ra-row-chip">{row.storeType}</span>
                          ) : null}
                          {row.ip ? <span className="ra-row-chip">{row.ip}</span> : null}
                        </span>
                      </span>
                      <span className="ra-row-right">
                        <span className="ra-row-time" title={formatAbsoluteTime(row.at)}>
                          {formatRelativeTime(row.at)}
                        </span>
                        <span
                          className={`ra-status-dot ${row.ok ? "ok" : "fail"}`}
                          aria-hidden="true"
                        >
                          {row.ok ? (
                            <FaCheckCircle title={`HTTP ${row.statusCode} — OK`} />
                          ) : (
                            <FaExclamationCircle title={`HTTP ${row.statusCode ?? "?"} — failed`} />
                          )}
                        </span>
                        <FaChevronDown
                          className={`ra-row-chevron${isOpen ? " is-open" : ""}`}
                          aria-hidden="true"
                        />
                      </span>
                    </button>
                    {isOpen && (
                      <div id={detailId} className="ra-row-detail">
                        <dl className="ra-detail-list">
                          <div>
                            <dt>Path</dt>
                            <dd className="ra-mono">{row.path || "—"}</dd>
                          </div>
                          <div>
                            <dt>Method</dt>
                            <dd className="ra-mono">{row.method || "—"}</dd>
                          </div>
                          {row.resourceId ? (
                            <div>
                              <dt>Resource ID</dt>
                              <dd className="ra-mono">{row.resourceId}</dd>
                            </div>
                          ) : null}
                          <div>
                            <dt>Status</dt>
                            <dd>
                              HTTP {row.statusCode ?? "?"}
                              {row.errorMessage ? ` — ${row.errorMessage}` : ""}
                            </dd>
                          </div>
                          <div>
                            <dt>At</dt>
                            <dd>{formatAbsoluteTime(row.at)}</dd>
                          </div>
                          {row.userAgent ? (
                            <div>
                              <dt>User agent</dt>
                              <dd className="ra-mono ra-truncate" title={row.userAgent}>
                                {row.userAgent}
                              </dd>
                            </div>
                          ) : null}
                        </dl>
                        {row.body ? (
                          <div className="ra-body-block">
                            <div className="ra-body-head">
                              <h4>Request body</h4>
                              <button
                                type="button"
                                className="ra-btn-ghost"
                                onClick={() => copyBody(row.body)}
                              >
                                <FaCopy /> Copy
                              </button>
                            </div>
                            <pre className="ra-pre">{JSON.stringify(row.body, null, 2)}</pre>
                          </div>
                        ) : null}
                      </div>
                    )}
                  </article>
                );
              })}
            </React.Fragment>
          ))}
        </section>
      )}

      {/* FOOTER — Load more + counter, only when we actually have rows. */}
      {!showInitialSkeleton && !loadError && !forbidden && rows.length > 0 && (
        <footer className="ra-footer">
          <span>
            Showing {rows.length.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
          </span>
          {hasMore && (
            <button
              type="button"
              className="ra-btn-secondary"
              onClick={loadMore}
              disabled={loadingMore || loadingInitial}
            >
              {loadingMore ? (
                <>
                  <span className="ra-spinner-inline" aria-hidden="true" /> Loading…
                </>
              ) : (
                "Load more"
              )}
            </button>
          )}
        </footer>
      )}
    </div>
  );
};

export default RecentActivity;
