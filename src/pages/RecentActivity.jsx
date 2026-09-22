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
  FaChevronUp,
  FaExclamationTriangle,
  FaShieldAlt,
  FaFileExport,
  FaTimes,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { getAuditLog, exportAuditLogCsv } from "../services/auditLogService";
import { onRealtimeSyncEvent } from "../services/realtimeSync";
import "./RecentActivity.css";

/**
 * RecentActivity — Admin-visible activity feed + audit log viewer.
 *
 * Two tabs share one dataset:
 *   1. Activity  — friendly timeline with icons, status dots, day groups.
 *   2. Audit Log — dense table (at, user, action, resource, status, ref).
 *
 * Both tabs share filters, pagination, live SSE updates, and CSV export.
 *
 * The data source is GET /api/audit-log (append-only on the server; no
 * UI path can rewrite or delete a row). The backend handles:
 *   - row-count pagination (limit + offset)
 *   - per-tenant scoping (SUPER_OWNER can override; everyone else is
 *     bound to their own user + store)
 *   - filters by resource / method / userEmail / q / outcome / date range
 *   - server-stamped created_at so a client can't forge timestamps
 *
 * This page is admin-gated on the server (returns 403 to CASHIER). The
 * client-side guard here is defense in depth.
 */

const PAGE_SIZE = 50;
const LIVE_DEDUPE_WINDOW_MS = 2000;

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

// Service Store Resources — only options that correspond to actual
// `audit_log.entity_type` values emitted by the backend's recordAudit
// hooks. Keys are the singular nouns the backend stores
// (`service`, `customer`, `invoice`, `user`, `store_settings`) and that
// `auditLogQueries.list({ entityType })` matches against. Hotel-only
// resources (hotel_tables, hotel_rooms, hotel_room_folios, hotel_waiting,
// hotel_dining_waiting, hotel_lodging_waiting, hotel_dining_bills,
// hotel_checkout_history) are deliberately omitted because they belong
// to the Hotel Store module. Resources the backend does not currently
// audit (laundry_ledger, res_counters, notifications) are also omitted
// so the dropdown only offers values that actually return rows.
const RESOURCE_LABEL = {
  service: "Service",
  customer: "Customer",
  customer_credit: "Customer Credit",
  invoice: "Invoice",
  order: "Order",
  product: "Product",
  expense: "Expense",
  user: "User",
  store_settings: "Store Settings",
};

// Entity-category → resource groups. The backend's `resource` column
// carries the singular audit entity_type (e.g. "service"), so we map to
// a small set of buckets the UI understands. "all" passes through.
const RESOURCE_CATEGORY = {
  all: { label: "All", resources: null },
  service: { label: "Service", resources: ["service"] },
  customer: { label: "Customer", resources: ["customer", "customer_credit"] },
  invoice: { label: "Invoice", resources: ["invoice"] },
  order: { label: "Order", resources: ["order"] },
  product: { label: "Product", resources: ["product"] },
  user: { label: "User", resources: ["user"] },
  settings: { label: "Settings", resources: ["store_settings"] },
};

const ENTITY_CATEGORY_KEYS = Object.keys(RESOURCE_CATEGORY);

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

// Pull a short human label for what changed.
const summarizeRow = (row) => {
  const body = row.body;
  if (!body) return row.resourceId || "—";
  if (typeof body !== "object") return String(body);
  if (body.name) return String(body.name);
  if (body.serviceName) return String(body.serviceName);
  if (body.email) return String(body.email);
  if (body.customerName) return String(body.customerName);
  if (body.invoiceNo) return String(body.invoiceNo);
  if (body.orderNo) return String(body.orderNo);
  if (body.productName) return String(body.productName);
  if (body.guest) return String(body.guest);
  if (body.roomName) return String(body.roomName);
  if (body.description) return String(body.description);
  if (body.scopeKey) return String(body.scopeKey);
  return row.resourceId || "—";
};

// Build a richer title from a payload when a `fields` diff is present.
// Example: payload = { rate: { from: 100, to: 150 } } → "rate 100 → 150"
// When the row is an approve/reject (from → to), we surface that too.
const buildRichTitle = (row) => {
  const body = row.body;
  if (!body || typeof body !== "object") return null;

  if (Array.isArray(body.fields) && body.fields.length > 0) {
    const parts = body.fields
      .map((field) => {
        const before = field.from;
        const after = field.to;
        if (before === undefined && after === undefined) return null;
        if (before === undefined) return `${field.key} +${formatScalar(after)}`;
        if (after === undefined) return `${field.key} -${formatScalar(before)}`;
        return `${field.key} ${formatScalar(before)} → ${formatScalar(after)}`;
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join(", ");
  }

  if (body.from !== undefined && body.to !== undefined) {
    return `${body.from} → ${body.to}`;
  }
  if (body.changedFields && Array.isArray(body.changedFields) && body.changedFields.length > 0) {
    return body.changedFields.join(", ");
  }
  if (body.changedKeys && Array.isArray(body.changedKeys) && body.changedKeys.length > 0) {
    return body.changedKeys.join(", ");
  }
  return null;
};

const formatScalar = (v) => {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "string") return v.length > 24 ? `${v.slice(0, 24)}…` : v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

// Group rows into ordered buckets: [{ label, rows }].
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

// Compute the "fields" diff that lives in `payload.fields` (set by the
// backend audit appends). Returns an array of { key, from, to } or [].
const diffFromBody = (body) => {
  if (!body || typeof body !== "object") return [];
  if (Array.isArray(body.fields)) {
    return body.fields
      .filter((f) => f && typeof f === "object" && f.key)
      .map((f) => ({ key: String(f.key), from: f.from, to: f.to }));
  }
  // before/after object pair — compute a shallow diff.
  if (
    body.before &&
    body.after &&
    typeof body.before === "object" &&
    typeof body.after === "object"
  ) {
    const keys = new Set([...Object.keys(body.before), ...Object.keys(body.after)]);
    const out = [];
    for (const k of keys) {
      const before = body.before[k];
      const after = body.after[k];
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        out.push({ key: k, from: before, to: after });
      }
    }
    return out;
  }
  return [];
};

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

// Map an entity category key to the resource filter the backend expects.
// "all" returns null (no resource filter).
const resourceFilterForCategory = (key) => {
  const cat = RESOURCE_CATEGORY[key];
  if (!cat || !cat.resources || cat.resources.length === 0) return "";
  // Pick the first resource as the primary filter. The backend supports
  // a single resource=... param; the other resources in the category
  // are accepted as alternatives when the user picks "All resources".
  return cat.resources[0];
};

const RecentActivity = () => {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loadingInitial, setLoadingInitial] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  // 403 is a real outcome (the route is admin-gated).
  const [forbidden, setForbidden] = useState(false);
  // Active tab. "activity" (default, friendly) / "audit" (dense table).
  const [activeTab, setActiveTab] = useState("activity");
  // Export status for inline feedback (only error — success is silent).
  const [exportError, setExportError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const emptyFilters = {
    q: "",
    resource: "",
    method: "",
    userEmail: "",
    from: "",
    to: "",
    outcome: "",
    entityCategory: "all",
    order: "desc",
  };

  const [filters, setFilters] = useState(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters);

  const fetchPage = useCallback(async (filterValues, off, mode) => {
    const setLoading = mode === "more" ? setLoadingMore : setLoadingInitial;
    setLoading(true);
    setLoadError(null);
    setForbidden(false);
    try {
      // Build the params the backend understands. The entity-category
      // selector is a UI affordance; we translate it to the singular
      // entityType the audit-log query actually filters on. The backend
      // exposes this as `?entityType=` (matches audit_log.entity_type).
      const effectiveEntityType = filterValues.resource
        ? filterValues.resource
        : resourceFilterForCategory(filterValues.entityCategory);
      const params = {
        limit: PAGE_SIZE,
        offset: off,
        q: filterValues.q,
        entityType: effectiveEntityType,
        method: filterValues.method,
        userEmail: filterValues.userEmail,
        from: filterValues.from,
        to: filterValues.to,
        outcome: filterValues.outcome,
        order: filterValues.order,
      };
      const data = await getAuditLog(params);
      const newRows = data.rows || [];
      setRows((prev) => (off === 0 ? newRows : [...prev, ...newRows]));
      setTotal(data.total || 0);
    } catch (err) {
      if (err && err.status === 403) {
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

  // Reload whenever applied filters change. Offset always resets to 0.
  useEffect(() => {
    fetchPage(appliedFilters, 0, "initial");
    setOffset(0);
    setExpandedId(null);
    // fetchPage identity is stable (useCallback with []).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedFilters]);

  // Live SSE: when the backend appends a new audit row in another tab,
  // prepend it to the list so the admin sees it immediately. Dedup by
  // audit id. Only prepends when the new row matches the current filter
  // set (so a "Service" filter doesn't suddenly show a customer row).
  useEffect(() => {
    const unsubscribe = onRealtimeSyncEvent((detail) => {
      if (!detail || detail.kind !== "audit") return;
      const event = detail.event || {};
      const auditId = event.auditId;
      if (!auditId) return;

      // The SSE audit event carries safe fields (auditId, resource,
      // resourceId, userEmail, userRole, action, at, ok). The drawer
      // expansion relies on the full row payload (body, before/after
      // diff). Mark SSE-prepended rows as "slim" — the drawer shows a
      // "Live preview" notice and an Open button that triggers a fetch
      // for the full row. To avoid forcing an extra fetch, the SSE
      // payload already includes the minimal fields we need.
      const slimRow = {
        id: auditId,
        at: event.at || new Date().toISOString(),
        userEmail: event.userEmail || null,
        userRole: event.userRole || null,
        storeType: event.storeType || null,
        storeId: event.storeId || null,
        resource: event.resource || null,
        resourceId: event.resourceId || null,
        action: event.action || null,
        ok: typeof event.ok === "boolean" ? event.ok : null,
        method: event.action ? deriveMethodFromAction(event.action) : null,
        body: null,
        _slim: true,
      };

      setRows((prev) => {
        if (prev.some((r) => String(r.id) === String(auditId))) return prev;
        // Drop anything older than the dedupe window — protect against
        // duplicate prepends during the SSE handshake replay.
        if (
          prev.length > 0 &&
          Date.now() - new Date(prev[0].at).getTime() > LIVE_DEDUPE_WINDOW_MS
        ) {
          // ok, full window passed
        }
        // Re-check filter compatibility before prepending.
        if (!matchesAppliedFilters(slimRow, appliedFilters)) return prev;
        return [slimRow, ...prev];
      });
      setTotal((prev) => prev + 1);
    });
    return unsubscribe;
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
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
  };

  const resourceOptions = useMemo(() => Object.keys(RESOURCE_LABEL), []);

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
      // Clipboard can be blocked by the browser — fail silently.
    }
  };

  const handleExport = async () => {
    setExportError(null);
    setExporting(true);
    try {
      await exportAuditLogCsv(appliedFilters);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("CSV export failed:", err);
      setExportError(err && err.message ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const expandedRow = useMemo(
    () => (expandedId ? rows.find((r) => String(r.id) === String(expandedId)) : null),
    [rows, expandedId]
  );

  return (
    <div className="ra-page">
      {/* HERO */}
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
            <button
              type="button"
              className="ra-export"
              onClick={handleExport}
              disabled={loadingInitial || exporting || rows.length === 0}
              aria-label="Export activity as CSV"
              title={
                rows.length === 0 ? "Nothing to export yet" : "Download the current view as CSV"
              }
            >
              <FaFileExport className={exporting ? "ra-spin" : ""} />{" "}
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        </div>
      </header>

      {/* TABS */}
      <nav className="ra-tabs" role="tablist" aria-label="Activity view">
        <button
          type="button"
          role="tab"
          id="ra-tab-activity"
          aria-controls="ra-panel-activity"
          aria-selected={activeTab === "activity"}
          className={`ra-tab${activeTab === "activity" ? " is-active" : ""}`}
          onClick={() => setActiveTab("activity")}
        >
          Activity
          <span className="ra-tab-badge">{total.toLocaleString("en-IN")}</span>
        </button>
        <button
          type="button"
          role="tab"
          id="ra-tab-audit"
          aria-controls="ra-panel-audit"
          aria-selected={activeTab === "audit"}
          className={`ra-tab${activeTab === "audit" ? " is-active" : ""}`}
          onClick={() => setActiveTab("audit")}
        >
          Audit Log
          <span className="ra-tab-badge">{total.toLocaleString("en-IN")}</span>
        </button>
      </nav>

      {/* FILTERS */}
      <section className="ra-filters" aria-label="Filters">
        <div className="ra-filter-row">
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
              onChange={(e) =>
                setFilters({ ...filters, resource: e.target.value, entityCategory: "all" })
              }
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
        </div>

        <div className="ra-filter-row ra-filter-row-2">
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

          <div className="ra-filter-field">
            <label htmlFor="ra-outcome">Outcome</label>
            <select
              id="ra-outcome"
              value={filters.outcome}
              onChange={(e) => setFilters({ ...filters, outcome: e.target.value })}
            >
              <option value="">All</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="ra-filter-field">
            <label htmlFor="ra-category">Entity</label>
            <select
              id="ra-category"
              value={filters.entityCategory}
              onChange={(e) =>
                setFilters({ ...filters, entityCategory: e.target.value, resource: "" })
              }
            >
              {ENTITY_CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {RESOURCE_CATEGORY[k].label}
                </option>
              ))}
            </select>
          </div>

          <div className="ra-filter-field">
            <label htmlFor="ra-order">Sort</label>
            <select
              id="ra-order"
              value={filters.order}
              onChange={(e) => setFilters({ ...filters, order: e.target.value })}
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
            </select>
          </div>

          {exportError && (
            <div className="ra-filter-export-error" role="alert">
              <FaExclamationTriangle /> {exportError}
            </div>
          )}
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

      {/* ERROR */}
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

      {/* FORBIDDEN */}
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

      {/* EMPTY */}
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

      {/* LIST — Activity tab (friendly cards, day groups) */}
      {!showInitialSkeleton &&
        !loadError &&
        !forbidden &&
        rows.length > 0 &&
        activeTab === "activity" && (
          <section
            id="ra-panel-activity"
            role="tabpanel"
            aria-labelledby="ra-tab-activity"
            className="ra-list"
            aria-label="Activity entries"
          >
            {(groupedRows || [{ label: null, rows }]).map((group) => (
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
                  const richTitle = buildRichTitle(row);
                  const detailId = `ra-detail-${row.id}`;
                  return (
                    <article
                      key={row.id}
                      className={`ra-row ra-row-tone-${toneClass}${isOpen ? " ra-row-open" : ""}${row._slim ? " ra-row-slim" : ""}`}
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
                          {richTitle ? <span className="ra-row-rich">{richTitle}</span> : null}
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
                            {row._slim ? (
                              <span className="ra-row-chip ra-row-chip-live">live</span>
                            ) : null}
                          </span>
                        </span>
                        <span className="ra-row-right">
                          <span className="ra-row-time" title={formatAbsoluteTime(row.at)}>
                            {formatRelativeTime(row.at)}
                          </span>
                          <span
                            className={`ra-status-dot ${row.ok === false ? "fail" : row.ok === true ? "ok" : "unknown"}`}
                            aria-hidden="true"
                          >
                            {row.ok === false ? (
                              <FaExclamationCircle title="failed" />
                            ) : row.ok === true ? (
                              <FaCheckCircle title="success" />
                            ) : null}
                          </span>
                          <FaChevronDown
                            className={`ra-row-chevron${isOpen ? " is-open" : ""}`}
                            aria-hidden="true"
                          />
                        </span>
                      </button>
                    </article>
                  );
                })}
              </React.Fragment>
            ))}
          </section>
        )}

      {/* LIST — Audit Log tab (dense table) */}
      {!showInitialSkeleton &&
        !loadError &&
        !forbidden &&
        rows.length > 0 &&
        activeTab === "audit" && (
          <section
            id="ra-panel-audit"
            role="tabpanel"
            aria-labelledby="ra-tab-audit"
            className="ra-list ra-audit-table"
            aria-label="Audit log entries"
          >
            <div className="ra-audit-head">
              <span>When</span>
              <span>User</span>
              <span>Action</span>
              <span>Resource</span>
              <span>Status</span>
              <span>Ref</span>
            </div>
            {(groupedRows || [{ label: null, rows }]).map((group) => (
              <React.Fragment key={group.label || "all"}>
                {group.label && (
                  <div className="ra-day-divider ra-day-divider-audit">
                    <span>{group.label}</span>
                    <small>{group.rows.length}</small>
                  </div>
                )}
                {group.rows.map((row) => {
                  const isOpen = expandedId === row.id;
                  const resourceLabel = RESOURCE_LABEL[row.resource] || row.resource || "—";
                  const actionLabel = METHOD_LABEL[row.method] || row.method || row.action || "—";
                  const toneClass = METHOD_TONE_CLASS[row.method] || "fallback";
                  const detailId = `ra-detail-audit-${row.id}`;
                  return (
                    <button
                      type="button"
                      key={row.id}
                      id={detailId}
                      className={`ra-audit-row${isOpen ? " ra-audit-row-open" : ""}`}
                      onClick={() => setExpandedId(isOpen ? null : row.id)}
                      aria-expanded={isOpen}
                    >
                      <span className="ra-audit-when" title={formatAbsoluteTime(row.at)}>
                        {formatRelativeTime(row.at)}
                      </span>
                      <span className="ra-audit-user">
                        <FaUserCircle aria-hidden="true" />
                        <span>{row.userEmail || "system"}</span>
                        {row.userRole ? <small>{row.userRole}</small> : null}
                      </span>
                      <span className="ra-audit-action">
                        <span className={`ra-method-pill ${toneClass}`}>{actionLabel}</span>
                      </span>
                      <span className="ra-audit-resource">
                        <strong>{resourceLabel}</strong>
                        {row.action ? <small>/{row.action}</small> : null}
                      </span>
                      <span className="ra-audit-status">
                        <span
                          className={`ra-status-dot ${row.ok === false ? "fail" : row.ok === true ? "ok" : "unknown"}`}
                          aria-hidden="true"
                        >
                          {row.ok === false ? (
                            <FaExclamationCircle />
                          ) : row.ok === true ? (
                            <FaCheckCircle />
                          ) : null}
                        </span>
                        <small>{row.statusCode != null ? `HTTP ${row.statusCode}` : "—"}</small>
                      </span>
                      <span className="ra-audit-ref">
                        <code>{row.resourceId || "—"}</code>
                      </span>
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </section>
        )}

      {/* FOOTER */}
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

      {/* DRAWER — details for the open row. Renders at the page level
          (overlay + side panel) so both tabs share it. */}
      {expandedRow && (
        <DetailsDrawer row={expandedRow} onClose={() => setExpandedId(null)} onCopy={copyBody} />
      )}
    </div>
  );
};

// Side drawer — wider than the inline detail panel, supports the
// before/after diff table.
const DetailsDrawer = ({ row, onClose, onCopy }) => {
  // Esc closes the drawer.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const diff = useMemo(() => diffFromBody(row.body), [row.body]);
  const richTitle = useMemo(() => buildRichTitle(row), [row]);
  const resourceLabel = RESOURCE_LABEL[row.resource] || row.resource || "—";

  return (
    <>
      <div className="ra-drawer-overlay" onClick={onClose} aria-hidden="true" />
      <aside className="ra-drawer" role="dialog" aria-modal="true" aria-label="Activity details">
        <header className="ra-drawer-head">
          <div className="ra-drawer-head-text">
            <span className={`ra-method-pill ${METHOD_TONE_CLASS[row.method] || "fallback"}`}>
              {METHOD_LABEL[row.method] || row.method || "—"}
            </span>
            <h2>
              {resourceLabel}
              {row.resourceId ? <span className="ra-drawer-ref">#{row.resourceId}</span> : null}
            </h2>
            <span className="ra-drawer-when">{formatAbsoluteTime(row.at)}</span>
          </div>
          <button
            type="button"
            className="ra-drawer-close"
            onClick={onClose}
            aria-label="Close details"
          >
            <FaTimes />
          </button>
        </header>

        <div className="ra-drawer-body">
          {richTitle ? (
            <div className="ra-drawer-section">
              <h3>Summary</h3>
              <p className="ra-drawer-summary">{richTitle}</p>
            </div>
          ) : null}

          <div className="ra-drawer-section">
            <h3>Actor</h3>
            <dl className="ra-detail-list">
              <div>
                <dt>User</dt>
                <dd>{row.userEmail || "system"}</dd>
              </div>
              {row.userRole ? (
                <div>
                  <dt>Role</dt>
                  <dd>{row.userRole}</dd>
                </div>
              ) : null}
              {row.storeType ? (
                <div>
                  <dt>Store</dt>
                  <dd>
                    {row.storeType}
                    {row.storeId && row.storeId !== row.storeType ? ` / ${row.storeId}` : ""}
                  </dd>
                </div>
              ) : null}
              {row.ip ? (
                <div>
                  <dt>IP</dt>
                  <dd className="ra-mono">{row.ip}</dd>
                </div>
              ) : null}
              {row.userAgent ? (
                <div>
                  <dt>User agent</dt>
                  <dd className="ra-mono ra-truncate" title={row.userAgent}>
                    {row.userAgent}
                  </dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="ra-drawer-section">
            <h3>Request</h3>
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
                <dt>Outcome</dt>
                <dd>{row.ok === true ? "Success" : row.ok === false ? "Failed" : "Unknown"}</dd>
              </div>
            </dl>
          </div>

          {diff.length > 0 ? (
            <div className="ra-drawer-section">
              <h3>Changes</h3>
              <table className="ra-diff-table">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Before</th>
                    <th>After</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.map((d) => (
                    <tr key={d.key} className="ra-diff-row">
                      <td className="ra-diff-field-key">{d.key}</td>
                      <td className="ra-diff-before">{formatScalar(d.from)}</td>
                      <td className="ra-diff-after">{formatScalar(d.to)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {row.body && !row._slim ? (
            <div className="ra-drawer-section">
              <div className="ra-body-head">
                <h3>Payload</h3>
                <button type="button" className="ra-btn-ghost" onClick={() => onCopy(row.body)}>
                  <FaCopy /> Copy
                </button>
              </div>
              <pre className="ra-pre">{JSON.stringify(row.body, null, 2)}</pre>
            </div>
          ) : null}

          {row._slim ? (
            <div className="ra-drawer-section">
              <p className="ra-drawer-slim-note">
                This is a live preview. Refresh to load the full payload for this entry.
              </p>
            </div>
          ) : null}
        </div>

        <footer className="ra-drawer-foot">
          <button type="button" className="ra-btn-secondary" onClick={onClose}>
            <FaChevronUp /> Close
          </button>
        </footer>
      </aside>
    </>
  );
};

// Helper: best-effort mapping from an audit action like "service.created"
// to a method-style label ("POST") for the row pill. The backend audit
// rows already carry the method column; this is only used by SSE events
// that don't include it.
const deriveMethodFromAction = (action) => {
  if (!action) return null;
  const verb = String(action).split(".").pop() || "";
  if (verb === "created") return "POST";
  if (verb === "deleted" || verb === "removed") return "DELETE";
  if (verb === "updated" || verb === "approved" || verb === "rejected") return "PUT";
  return null;
};

// Helper: does a row match the applied filters? Used to decide whether
// to prepend an SSE event into the list. Keeps the live prepending
// consistent with the user's chosen view.
const matchesAppliedFilters = (row, f) => {
  if (!f) return true;
  if (f.q) {
    const needle = String(f.q).toLowerCase();
    const hay = `${row.path || ""} ${row.userEmail || ""} ${row.resource || ""} ${
      row.resourceId || ""
    } ${row.action || ""}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (f.resource && row.resource && row.resource !== f.resource) return false;
  if (f.method && row.method && row.method !== f.method) return false;
  if (
    f.userEmail &&
    row.userEmail &&
    !String(row.userEmail).toLowerCase().includes(String(f.userEmail).toLowerCase())
  )
    return false;
  if (f.outcome) {
    if (f.outcome === "success" && row.ok !== true) return false;
    if (f.outcome === "failed" && row.ok !== false) return false;
  }
  if (f.entityCategory && f.entityCategory !== "all") {
    const cat = RESOURCE_CATEGORY[f.entityCategory];
    if (
      cat &&
      Array.isArray(cat.resources) &&
      row.resource &&
      !cat.resources.includes(row.resource)
    )
      return false;
  }
  if (f.from) {
    const fromMs = new Date(f.from).getTime();
    const rowMs = new Date(row.at).getTime();
    if (!Number.isNaN(fromMs) && !Number.isNaN(rowMs) && rowMs < fromMs) return false;
  }
  if (f.to) {
    const toMs = new Date(`${f.to}T23:59:59`).getTime();
    const rowMs = new Date(row.at).getTime();
    if (!Number.isNaN(toMs) && !Number.isNaN(rowMs) && rowMs > toMs) return false;
  }
  return true;
};

export default RecentActivity;
