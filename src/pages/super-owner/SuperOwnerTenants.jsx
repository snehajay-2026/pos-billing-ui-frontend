// SuperOwnerTenants.jsx
//
// Tenant directory for SUPER_OWNER. Reads from GET /api/super/tenants
// (SUPER_OWNER-only, server-paginated). Each row is a distinct
// business-owner identity derived via root_owner_email || owner_email ||
// email — branch users fold into their owner's tenant, SUPER_OWNER rows
// are excluded. Subscription status/plan come from the tenant's
// subscriptions row when one exists (null otherwise). Fields with no
// schema support (owner display name, per-tenant revenue, branch
// breakdowns) are not shown; the notice below says so explicitly.

import React, { useCallback, useEffect, useState } from "react";
import { getTenantDetail, listPlatformTenants } from "../../services/superOwnerService";
import { toErrorMessage } from "../../utils/errorMessage";
import "./SuperOwnerPages.css";

const PAGE_SIZE = 25;

const fmtDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-IN");
};

const SuperOwnerTenants = () => {
  const [tenants, setTenants] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEmail, setSelectedEmail] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const loadPage = useCallback(async (nextPage) => {
    setLoading(true);
    setError("");
    try {
      const res = await listPlatformTenants({ page: nextPage, limit: PAGE_SIZE });
      setTenants(Array.isArray(res?.tenants) ? res.tenants : []);
      setTotal(Number.isFinite(Number(res?.total)) ? Number(res.total) : 0);
      setPage(Number(res?.page) || nextPage);
    } catch (err) {
      setTenants([]);
      setError(toErrorMessage(err, "Platform tenant directory is unavailable right now."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadPage(1);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPage]);

  const onPageChange = (next) => {
    setPage(next);
    loadPage(next);
  };

  const onSearchChange = (v) => {
    setSearch(v);
    setPage(1);
  };

  const openDetail = useCallback(async (tenantEmail) => {
    if (!tenantEmail) return;
    setSelectedEmail(tenantEmail);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const res = await getTenantDetail(tenantEmail);
      setDetail(res || null);
    } catch (err) {
      const status = err?.response?.status ?? err?.status;
      setDetailError(
        toErrorMessage(
          err,
          status === 404 ? "That tenant was not found." : "Tenant detail is unavailable right now."
        )
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedEmail("");
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);
  }, []);

  if (loading && tenants.length === 0 && !error)
    return <div className="super-loading">Loading tenants…</div>;

  const q = search.trim().toLowerCase();
  const visible = q
    ? tenants.filter((t) =>
        String(t.tenantEmail || "")
          .toLowerCase()
          .includes(q)
      )
    : tenants;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="super-page">
      {error ? <div className="super-error">{error}</div> : null}
      <div className="super-notice">
        Per-tenant revenue and branch breakdowns are unavailable: no schema supports them, so this
        directory shows identity, user/store counts, and subscription state only.
      </div>

      <div className="super-toolbar">
        <input
          type="search"
          placeholder="Search tenant email…"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          aria-label="Search tenants"
        />
        <span className="super-badge">
          {total} tenant{total === 1 ? "" : "s"}
        </span>
      </div>

      {loading ? (
        <div className="super-loading">Loading tenants…</div>
      ) : visible.length === 0 ? (
        <div className="super-panel">
          <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
            {total === 0 ? "No tenants found." : "No tenants match the current search."}
          </p>
        </div>
      ) : (
        <div className="super-panel">
          <div className="super-table-wrap">
            <table className="super-table">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Users</th>
                  <th>Stores</th>
                  <th>Subscription</th>
                  <th>Plan</th>
                  <th>First Seen</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((t) => (
                  <tr key={t.tenantEmail}>
                    <td>{t.tenantEmail || "—"}</td>
                    <td>{t.userCount ?? "—"}</td>
                    <td>{t.storeCount ?? "—"}</td>
                    <td>{t.subscriptionStatus || "none"}</td>
                    <td>{t.planName || "—"}</td>
                    <td>{fmtDate(t.firstSeen)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() => openDetail(t.tenantEmail)}
                        disabled={detailLoading && selectedEmail === t.tenantEmail}
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="super-pagination">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </button>
        <span>
          Page {page} of {pageCount} ({total} tenants)
        </span>
        <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          Next
        </button>
      </div>

      {selectedEmail ? (
        <div className="super-panel" aria-live="polite">
          <div className="super-toolbar">
            <strong>Tenant detail: {selectedEmail}</strong>
            <button type="button" onClick={closeDetail}>
              Back to Tenants
            </button>
          </div>
          {detailLoading ? (
            <div className="super-loading">Loading tenant detail…</div>
          ) : detailError ? (
            <div className="super-error">{detailError}</div>
          ) : detail ? (
            <>
              <p style={{ margin: "0 0 8px", fontSize: 13 }}>
                {detail.tenant?.userCount ?? "—"} users · {detail.tenant?.storeCount ?? "—"} stores
                · first seen {fmtDate(detail.tenant?.firstSeen)} · subscription{" "}
                {detail.tenant?.subscription
                  ? `${detail.tenant.subscription.status || "none"} / ${detail.tenant.subscription.planName || "—"}`
                  : "none"}
              </p>
              <h4>Users ({detail.users?.length ?? 0})</h4>
              {detail.users?.length ? (
                <div className="super-table-wrap">
                  <table className="super-table">
                    <thead>
                      <tr>
                        <th>Email</th>
                        <th>Role</th>
                        <th>Store</th>
                        <th>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.users.map((u) => (
                        <tr key={u.email}>
                          <td>{u.email || "—"}</td>
                          <td>{u.role || "—"}</td>
                          <td>{[u.storeType, u.storeId].filter(Boolean).join(" / ") || "—"}</td>
                          <td>{fmtDate(u.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
                  No users found for this tenant.
                </p>
              )}
              <h4>Stores ({detail.stores?.length ?? 0})</h4>
              {detail.stores?.length ? (
                <div className="super-table-wrap">
                  <table className="super-table">
                    <thead>
                      <tr>
                        <th>Store Type</th>
                        <th>Store ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.stores.map((s) => (
                        <tr key={`${s.storeType}/${s.storeId}`}>
                          <td>{s.storeType || "—"}</td>
                          <td>{s.storeId || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
                  No stores found for this tenant.
                </p>
              )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default SuperOwnerTenants;
