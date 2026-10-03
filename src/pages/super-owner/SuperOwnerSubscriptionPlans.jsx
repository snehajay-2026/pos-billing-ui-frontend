// SuperOwnerSubscriptionPlans.jsx
//
// Read-only plan catalogue for SUPER_OWNER plus the Super Owner's own
// subscription row (GET /api/subscriptions/my returns the requester's
// row; for SUPER_OWNER that is their own row, if one exists). Plans come
// from GET /api/subscriptions/plans/active. No edit affordance: the
// Super Owner cannot subscribe, matching the backend.

import React, { useEffect, useState } from "react";
import { getSuperOwnerContext } from "../../services/superOwnerService";
import { toErrorMessage } from "../../utils/errorMessage";
import { formatINR } from "../../utils/formatCurrency";
import "./SuperOwnerPages.css";

const SuperOwnerSubscriptionPlans = () => {
  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ctx = await getSuperOwnerContext();
        if (cancelled) return;
        setPlans(ctx.plans);
        setSubscription(ctx.subscription);
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err, "Something went wrong. Please try again."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="super-loading">Loading subscription plans…</div>;

  return (
    <div className="super-page">
      {error ? <div className="super-error">{error}</div> : null}

      <div className="super-panel">
        <h2>Your Own Subscription</h2>
        {subscription ? (
          <p style={{ margin: 0, fontSize: 13, color: "#e2e8f0" }}>
            Plan: <strong>{subscription.planName || subscription.planId || "—"}</strong> · Status:{" "}
            <span className="super-badge">{subscription.status || "unknown"}</span>
            {subscription.trialEndsAt ? ` · Trial ends ${subscription.trialEndsAt}` : null}
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>
            No subscription row found for this Super Owner account. Per-tenant subscription states
            require <code>GET /api/super/subscriptions</code>, which is not implemented yet.
          </p>
        )}
      </div>

      <div className="super-panel">
        <h2>Active Plans (read-only)</h2>
        {plans.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, color: "#94a3b8" }}>No active plans returned.</p>
        ) : (
          <div className="super-table-wrap">
            <table className="super-table">
              <thead>
                <tr>
                  <th>Plan</th>
                  <th>Monthly</th>
                  <th>Yearly</th>
                  <th>Trial Days</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {plans.map((p, i) => (
                  <tr key={p.id || p.planId || i}>
                    <td>{p.name || p.planName || p.planId || "—"}</td>
                    <td>{p.monthlyPrice != null ? formatINR(p.monthlyPrice) : "—"}</td>
                    <td>{p.yearlyPrice != null ? formatINR(p.yearlyPrice) : "—"}</td>
                    <td>{p.trialDays ?? p.trial_days ?? "—"}</td>
                    <td>
                      <span className="super-badge">
                        {p.status || p.isActive === false ? "inactive" : "active"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p style={{ fontSize: 12, color: "#94a3b8", margin: "10px 0 0" }}>
          Plans are read-only here. Tenant assignment and plan edits require{" "}
          <code>GET /api/super/subscriptions</code> (not implemented).
        </p>
      </div>
    </div>
  );
};

export default SuperOwnerSubscriptionPlans;
