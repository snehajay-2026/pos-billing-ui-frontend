import { apiGet, apiPost } from "./api";

// Tenant subscription API. The backend is the source of truth for tenant
// resolution, pricing, and provider plan selection — the frontend sends
// only the minimum business input (planId + billingCycle) on create and
// never amount, provider plan IDs, tenant email, or store scope.
//
// Hosted-checkout note: POST /api/subscriptions returns
// { subscription, checkout: { shortUrl } } and the frontend redirects the
// browser to that hosted Razorpay URL. That flow needs NO Checkout.js and
// NO public key, so there is deliberately no getSubscriptionConfig helper
// here — GET /api/subscriptions/config exists for a future embedded flow
// and must not be called by the hosted redirect.
//
// After the external redirect the provider appends razorpay_payment_id,
// razorpay_subscription_id, and razorpay_signature to the callback URL.
// verifySubscriptionPayment forwards ONLY those three provider params.
// The backend resolves the local subscription server-side by provider id
// + authenticated session tenant — the frontend never sends a local
// subscription id or a tenant email with the verify call.

export const getActivePlans = () => apiGet("/api/subscriptions/plans/active");

export const getMySubscription = () => apiGet("/api/subscriptions/my");

export const createSubscription = ({ planId, billingCycle }) =>
  apiPost("/api/subscriptions", { planId, billingCycle });

export const cancelSubscription = (subscriptionId) =>
  apiPost(`/api/subscriptions/${subscriptionId}/cancel`, {});

export const verifySubscriptionPayment = ({
  razorpay_payment_id,
  razorpay_subscription_id,
  razorpay_signature,
}) =>
  apiPost("/api/subscriptions/verify", {
    razorpay_payment_id,
    razorpay_subscription_id,
    razorpay_signature,
  });
