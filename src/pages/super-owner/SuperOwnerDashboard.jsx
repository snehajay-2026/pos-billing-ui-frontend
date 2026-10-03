// SuperOwnerDashboard.jsx
//
// Platform overview for SUPER_OWNER. The nine aggregate cards read from
// GET /api/super/overview (SUPER_OWNER-only platform aggregates — no
// personal data, no payment rows). Branches stay unavailable: no branch
// registry table exists, so that card renders "—" with the backend's
// reason until a registry lands. Below the cards the page shows real
// data available today: the unscoped dashboard summary (platform-wide
// for SUPER_OWNER), own subscription, active plans, and the five most
// recent audit-log entries.

import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getPlatformOverview,
  getSuperOwnerContext,
  getRecentPlatformActivity,
  getOwnDashboardSummary,
} from "../../services/superOwnerService";
import { toErrorMessage } from "../../utils/errorMessage";
import { formatINRWhole } from "../../utils/formatCurrency";
import "./SuperOwnerPages.css";

const fmtCount = (v) => (v == null ? "—" : String(v));

const CARDS = [
  { label: "Total Tenants", get: (o) => fmtCount(o?.tenants?.total), note: null },
  {
    label: "Total Stores & Branches",
    get: (o) => (o?.stores?.total == null ? "—" : fmtCount(o.stores.total)),
    note: "branchesUnavailable",
  },
  { label: "Total Users", get: (o) => fmtCount(o?.users?.total), note: null },
  { label: "Active Subscriptions", get: (o) => fmtCount(o?.subscriptions?.active), note: null },
  { label: "Trial Subscriptions", get: (o) => fmtCount(o?.subscriptions?.trialing), note: null },
  { label: "Expired Subscriptions", get: (o) => fmtCount(o?.subscriptions?.expired), note: null },
  {
    label: "Cancelled Subscriptions",
    get: (o) => fmtCount(o?.subscriptions?.cancelled),
    note: null,
  },
  {
    label: "Monthly Revenue",
    get: (o) => (o?.revenue == null ? "—" : formatINRWhole(o.revenue.monthly)),
    note: "revenue",
  },
  {
    label: "Yearly Revenue",
    get: (o) => (o?.revenue == null ? "—" : formatINRWhole(o.revenue.yearly)),
    note: "revenue",
  },
];

const SuperOwnerDashboard = () => {
  const [overview, setOverview] = useState(null);
  const [overviewError, setOverviewError] = useState("");
  const [context, setContext] = useState({ plans: [], subscription: null });
  const [activity, setActivity] = useState([]);
  const [ownSummary, setOwnSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const settled = await Promise.allSettled([
        getPlatformOverview(),
        getSuperOwnerContext(),
        getRecentPlatformActivity(5),
        getOwnDashboardSummary(),
      ]);
      if (cancelled) return;
      const [ov, ctx, recent, summary] = settled;
      if (ov.status === "fulfilled") {
        setOverview(ov.value || null);
      } else {
        setOverviewError(toErrorMessage(ov.reason, "Platform overview is unavailable right now."));
      }
      if (ctx.status === "fulfilled") setContext(ctx.value);
      else setError(toErrorMessage(ctx.reason, "Something went wrong. Please try again."));
      if (recent.status === "fulfilled") setActivity(recent.value);
      if (summary.status === "fulfilled") setOwnSummary(summary.value);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="super-loading">Loading platform overview…</div>;

  return (
    <div className="super-page">
      {error ? <div className="super-error">{error}</div> : null}
      {overviewError ? <div className="super-error">{overviewError}</div> : null}

      {overview ? (
        <div className="super-card-grid">
          {CARDS.map((card) => (
            <div className="super-card" key={card.label}>
              <h3>{card.label}</h3>
              <div className="super-metric">{card.get(overview)}</div>
              {card.note === "branchesUnavailable" && overview?.meta?.branchesUnavailable ? (
                <div className="super-note">{overview.meta.branchesUnavailable}</div>
              ) : card.note === "revenue" && overview?.revenue?.definition ? (
                <div className="super-note">{overview.revenue.definition}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="super-panel">
        <h2>Available Data Today</h2>
        <p style={{ fontSize: 13, color: "#94a3b8", margin: "0 0 8px" }}>
          {ownSummary
            ? "Summary loaded from the existing dashboard API. Note: as SUPER_OWNER without a store scope this reflects unscoped (platform-wide) figures, not just your own tenant."
            : "No dashboard summary returned."}{" "}
          Own subscription:{" "}
          {context.subscription
            ? `${context.subscription.planName || context.subscription.planId || "active"} (${context.subscription.status || "unknown status"})`
            : "none found"}{" "}
          · Active plans: {context.plans.length}. <Link to="/super/subscriptions">View plans</Link>{" "}
          · <Link to="/super/tenants">View tenants</Link>
        </p>
      </div>

      <div className="super-panel">
        <h2>Recent Platform Activity</h2>
        {activity.length === 0 ? (
          <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>No recent audit-log entries.</p>
        ) : (
          <div className="super-table-wrap">
            <table className="super-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Actor</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {activity.map((row, i) => (
                  <tr key={row.id || i}>
                    <td>{row.createdAt || row.created_at || "—"}</td>
                    <td>{row.actorEmail || row.actor_email || row.userEmail || "—"}</td>
                    <td>{row.action || row.event || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 12, color: "#94a3b8", margin: "10px 0 0" }}>
          <Link to="/activity">Open full Platform Audit Log</Link>
        </p>
      </div>
    </div>
  );
};

export default SuperOwnerDashboard;
