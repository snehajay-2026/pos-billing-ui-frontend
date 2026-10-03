import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaCreditCard,
  FaCheckCircle,
  FaExclamationTriangle,
  FaTimesCircle,
  FaSyncAlt,
  FaBan,
} from "react-icons/fa";
import Layout from "../components/layout/Layout";
import {
  getActivePlans,
  getMySubscription,
  createSubscription,
  cancelSubscription,
  verifySubscriptionPayment,
} from "../services/subscriptionService";
import "./SubscriptionPage.css";

const currency = (v) => {
  const n = Number(v || 0);
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const STATUS_META = {
  active: { label: "Active", tone: "ok", icon: <FaCheckCircle /> },
  trialing: { label: "Trial", tone: "info", icon: <FaCheckCircle /> },
  past_due: { label: "Past due", tone: "warn", icon: <FaExclamationTriangle /> },
  expired: { label: "Expired", tone: "bad", icon: <FaTimesCircle /> },
  cancelled: { label: "Cancelled", tone: "bad", icon: <FaBan /> },
};

const statusMeta = (status) =>
  STATUS_META[String(status || "").toLowerCase()] || {
    label: status || "Unknown",
    tone: "warn",
    icon: <FaExclamationTriangle />,
  };

const formatDate = (v) => {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
};

// One tenant = one subscription. Branches share the parent ADMIN tenant's
// subscription; the page never renders per-branch cards or payments.
const SubscriptionPage = () => {
  const [plans, setPlans] = useState([]);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [billingCycle, setBillingCycle] = useState("monthly");
  // Set while the Razorpay redirect callback is being verified. Kept
  // separate from actionLoading so the callback path cannot be confused
  // with a create/cancel in progress.
  const [verifying, setVerifying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [planList, mine] = await Promise.all([getActivePlans(), getMySubscription()]);
      setPlans(Array.isArray(planList) ? planList : []);
      setSubscription(mine || null);
      if (mine?.planId) setSelectedPlanId(String(mine.planId));
      if (mine?.billingCycle) setBillingCycle(mine.billingCycle);
    } catch (e) {
      setError(e?.message || "Failed to load subscription");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Razorpay hosted-checkout callback. After the user pays on the hosted
  // page, Razorpay redirects back to this page with the three provider
  // params in the query string. Correlation needs NO client-side storage:
  // razorpay_subscription_id already survives the redirect (Razorpay puts
  // it there), and the backend resolves the local row server-side via
  // findByRazorpayId + the authenticated session tenant. The callback URL
  // is cleaned afterwards so a refresh does not re-verify.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search || "");
    const razorpay_payment_id = params.get("razorpay_payment_id");
    const razorpay_subscription_id = params.get("razorpay_subscription_id");
    const razorpay_signature = params.get("razorpay_signature");
    if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) return;
    let cancelled = false;
    const run = async () => {
      setVerifying(true);
      setError(null);
      setNotice(null);
      try {
        // ONLY the three provider params are forwarded. No local
        // subscription id, no tenant email — the backend derives both.
        await verifySubscriptionPayment({
          razorpay_payment_id,
          razorpay_subscription_id,
          razorpay_signature,
        });
        // Re-read the authoritative backend status. If the webhook has
        // not arrived yet the row is still `trialing` — render it as-is
        // and tell the user activation is pending, never flip to active.
        const mine = await getMySubscription();
        if (cancelled) return;
        setSubscription(mine || null);
        const stillWaiting = String(mine?.status || "").toLowerCase() !== "active";
        setNotice(
          stillWaiting
            ? "Payment verified. Your subscription is waiting for payment confirmation " +
                "(webhook) before it becomes active — press Refresh after a moment."
            : "Payment verified and your subscription is active."
        );
      } catch (e) {
        if (!cancelled) setError(e?.message || "Payment verification failed");
      } finally {
        if (!cancelled) {
          setVerifying(false);
          // Strip the provider params so a page refresh does not re-post
          // the same (now single-use) verification. Built from the live
          // search string rather than parsing href, so it cannot throw.
          try {
            const clean = new URLSearchParams(window.location.search || "");
            clean.delete("razorpay_payment_id");
            clean.delete("razorpay_subscription_id");
            clean.delete("razorpay_signature");
            const rest = clean.toString();
            const path =
              (window.location.pathname || "/subscription") +
              (rest ? `?${rest}` : "") +
              (window.location.hash || "");
            window.history.replaceState({}, "", path);
          } catch {
            // Best-effort cleanup; verification already succeeded or failed.
          }
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPlan = useMemo(
    () => plans.find((p) => String(p.id) === String(selectedPlanId)) || null,
    [plans, selectedPlanId]
  );

  const selectedPrice = useMemo(() => {
    if (!selectedPlan) return null;
    return billingCycle === "yearly" ? selectedPlan.yearlyPrice : selectedPlan.monthlyPrice;
  }, [selectedPlan, billingCycle]);

  const handleSubscribe = async () => {
    if (!selectedPlanId) {
      setError("Select a plan first.");
      return;
    }
    setActionLoading(true);
    setError(null);
    setNotice(null);
    try {
      // The frontend sends ONLY planId + billingCycle. Price, provider
      // plan IDs, and tenant email are resolved server-side.
      const created = await createSubscription({ planId: Number(selectedPlanId), billingCycle });
      // Hosted checkout: the backend returns { subscription, checkout }.
      // Redirect the browser to the hosted Razorpay page. This unloads
      // the app, so nothing about this subscription is kept in component
      // state — correlation after the redirect relies on the provider
      // subscription id (see the callback effect above), not on memory.
      const shortUrl = created?.checkout?.shortUrl || null;
      if (shortUrl) {
        window.location.href = shortUrl;
        return;
      }
      // No hosted URL (provider did not return one): stay on the page,
      // re-read the authoritative backend status, and show it as-is.
      // Never mark the subscription active locally.
      const mine = await getMySubscription();
      setSubscription(mine || null);
      setNotice(
        "Subscription request recorded, but no hosted payment page was returned. " +
          "If the status shows Trial, contact support to complete payment — " +
          "activation follows payment verification (webhook)."
      );
    } catch (e) {
      setError(e?.message || "Failed to create subscription");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!subscription?.id) return;
    if (!window.confirm("Cancel this subscription? You will need to re-subscribe to continue.")) {
      return;
    }
    setActionLoading(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await cancelSubscription(subscription.id);
      setSubscription(updated || null);
    } catch (e) {
      setError(e?.message || "Failed to cancel subscription");
    } finally {
      setActionLoading(false);
    }
  };

  const meta = statusMeta(subscription?.status);
  const needsRenewal =
    subscription &&
    ["expired", "past_due", "cancelled"].includes(String(subscription.status || "").toLowerCase());
  const canCancel =
    subscription?.id &&
    ["active", "trialing", "past_due"].includes(String(subscription.status || "").toLowerCase());

  return (
    <Layout>
      <div className="sub-page">
        <div className="sub-header">
          <div>
            <h1>Subscription</h1>
            <p className="sub-subtitle">
              One subscription covers your whole tenant — all branches included.
            </p>
          </div>
          <button
            className="sub-refresh"
            onClick={load}
            disabled={loading || actionLoading || verifying}
          >
            <FaSyncAlt /> Refresh
          </button>
        </div>

        {verifying && (
          <div className="sub-alert sub-alert-info" role="status">
            <FaSyncAlt /> Verifying your payment with the backend…
          </div>
        )}

        {error && (
          <div className="sub-alert sub-alert-error" role="alert">
            <FaExclamationTriangle /> {error}
          </div>
        )}
        {notice && (
          <div className="sub-alert sub-alert-info" role="status">
            <FaCheckCircle /> {notice}
          </div>
        )}

        {loading ? (
          <div className="sub-card">
            <p>Loading subscription…</p>
          </div>
        ) : (
          <>
            <div className="sub-card">
              <h2>Current subscription</h2>
              {!subscription ? (
                <p className="sub-muted">
                  No subscription yet. Choose a plan below to get started.
                </p>
              ) : (
                <dl className="sub-facts">
                  <div>
                    <dt>Current plan</dt>
                    <dd>{subscription.planName || `Plan #${subscription.planId}`}</dd>
                  </div>
                  <div>
                    <dt>Current billing cycle</dt>
                    <dd>{subscription.billingCycle || "—"}</dd>
                  </div>
                  <div>
                    <dt>Billed price</dt>
                    <dd>{currency(subscription.subscribedPrice)}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>
                      <span className={`sub-status sub-status-${meta.tone}`}>
                        {meta.icon} {meta.label}
                      </span>
                    </dd>
                  </div>
                  {String(subscription.status || "").toLowerCase() === "trialing" && (
                    <div>
                      <dt>Trial</dt>
                      <dd>
                        Your subscription is in trial. It becomes active only after the first
                        payment is verified — creating the subscription does not activate it.
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Started</dt>
                    <dd>{formatDate(subscription.startedAt)}</dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd>{formatDate(subscription.expiresAt)}</dd>
                  </div>
                  {Array.isArray(subscription.payments) && subscription.payments.length > 0 && (
                    <div>
                      <dt>Latest payment</dt>
                      <dd>
                        {currency(subscription.payments[0]?.amount)} —{" "}
                        {subscription.payments[0]?.status || "—"} (
                        {formatDate(
                          subscription.payments[0]?.capturedAt ||
                            subscription.payments[0]?.createdAt
                        )}
                        )
                      </dd>
                    </div>
                  )}
                </dl>
              )}
              {needsRenewal && (
                <div className="sub-alert sub-alert-warn" role="status">
                  <FaExclamationTriangle /> Your subscription needs attention ({meta.label}). Renew
                  below — this page always stays reachable so you can pay.
                </div>
              )}
              {canCancel && (
                <button
                  className="sub-btn sub-btn-danger"
                  onClick={handleCancel}
                  disabled={actionLoading}
                >
                  <FaBan /> Cancel subscription
                </button>
              )}
            </div>

            <div className="sub-card">
              <h2>{subscription ? "Change plan / renew" : "Choose a plan"}</h2>
              {plans.length === 0 ? (
                <p className="sub-muted">No active plans are available right now.</p>
              ) : (
                <>
                  <div className="sub-plans">
                    {plans.map((plan) => (
                      <label
                        key={plan.id}
                        className={`sub-plan${String(selectedPlanId) === String(plan.id) ? " selected" : ""}`}
                      >
                        <input
                          type="radio"
                          name="plan"
                          value={plan.id}
                          checked={String(selectedPlanId) === String(plan.id)}
                          onChange={() => setSelectedPlanId(String(plan.id))}
                        />
                        <span className="sub-plan-name">{plan.name}</span>
                        <span className="sub-plan-prices">
                          <span>{currency(plan.monthlyPrice)} / month</span>
                          <span>{currency(plan.yearlyPrice)} / year</span>
                        </span>
                        {plan.trialDays > 0 && (
                          <span className="sub-plan-trial">{plan.trialDays}-day trial</span>
                        )}
                      </label>
                    ))}
                  </div>

                  <div className="sub-cycle">
                    <span>Billing cycle:</span>
                    <label>
                      <input
                        type="radio"
                        name="billingCycle"
                        value="monthly"
                        checked={billingCycle === "monthly"}
                        onChange={() => setBillingCycle("monthly")}
                      />
                      Monthly
                    </label>
                    <label>
                      <input
                        type="radio"
                        name="billingCycle"
                        value="yearly"
                        checked={billingCycle === "yearly"}
                        onChange={() => setBillingCycle("yearly")}
                      />
                      Yearly
                    </label>
                  </div>

                  {selectedPrice != null && (
                    <p className="sub-total">
                      Payable price: <strong>{currency(selectedPrice)}</strong> ({billingCycle})
                    </p>
                  )}

                  <button
                    className="sub-btn sub-btn-primary"
                    onClick={handleSubscribe}
                    disabled={actionLoading || !selectedPlanId}
                  >
                    <FaCreditCard />{" "}
                    {actionLoading
                      ? "Processing…"
                      : subscription
                        ? "Subscribe / renew"
                        : "Subscribe"}
                  </button>
                  <p className="sub-fineprint">
                    Payment is completed with the provider and verified by the backend webhook
                    before your subscription becomes active. This page always shows the current
                    backend status.
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};

export default SubscriptionPage;
