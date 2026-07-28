import { apiGet, apiPost } from "./api";

/**
 * paymentService — wraps /api/payments/*.
 *
 * The endpoint surface:
 *   GET    /api/payments/methods
 *   POST   /api/payments/intent                 -> creates an intent for an invoice / amount
 *   GET    /api/payments/intent/:id             -> poll for status
 *   POST   /api/payments/intent/:id/mark-paid   -> manual mark (cash / mock)
 *   POST   /api/payments/intent/:id/mark-failed -> mark a failure
 *
 * Webhook receiver (Razorpay → us) is server-only; the frontend does
 * NOT call it.
 */

export const getPaymentMethods = () => apiGet("/api/payments/methods");

export const createPaymentIntent = ({
  amount,
  currency = "INR",
  method = "upi",
  invoiceNo,
  note,
}) =>
  apiPost("/api/payments/intent", {
    amount,
    currency,
    method,
    invoiceNo,
    note,
  });

export const getPaymentIntent = (id) => apiGet(`/api/payments/intent/${id}`);

export const markPaymentPaid = (id, note = "") =>
  apiPost(`/api/payments/intent/${id}/mark-paid`, note ? { note } : {});

export const markPaymentFailed = (id, note = "") =>
  apiPost(`/api/payments/intent/${id}/mark-failed`, note ? { note } : {});

// Dev-only — disabled when the active gateway is Razorpay with real
// keys. Used by the payment dialog "Simulate payment" button in mock
// mode to flip a pending intent to paid without a real UPI scan.
export const simulatePayment = (id) => apiPost(`/api/payments/intent/${id}/simulate-payment`, {});
