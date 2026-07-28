import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import {
  FaCheckCircle,
  FaExclamationCircle,
  FaSpinner,
  FaTimes,
  FaMoneyBillWave,
  FaMobileAlt,
  FaCreditCard,
} from "react-icons/fa";
import {
  createPaymentIntent,
  getPaymentIntent,
  markPaymentPaid,
  markPaymentFailed,
  simulatePayment,
} from "../../services/paymentService";
import "./PaymentDialog.css";

/**
 * PaymentDialog — modal shown after the cashier picks a non-cash method
 * on the POS. Flow:
 *
 *   1. Create intent on mount (server talks to gateway / mock).
 *   2. Show UPI QR (most common case) so the customer can scan.
 *   3. Poll the intent until status flips to paid / failed / expired.
 *   4. Cashier can also click "Mark as paid" (cash) or "Simulate payment"
 *      (mock only) to drive the lifecycle manually.
 *
 * Whichever adapter is active, the QR payload is the standard `upi://...`
 * URL — most UPI apps will recognize it directly without a gateway.
 */

const PAYMENT_ICONS = {
  cash: <FaMoneyBillWave />,
  upi: <FaMobileAlt />,
  card: <FaCreditCard />,
};

const formatAmount = (v) => {
  const n = Number(v || 0);
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
};

const simulateAvailable = (gatewayInfo) => {
  // Show "Simulate payment" only when the gateway is "mock" / "cash" and
  // we're in dev (gated server-side too — this is a UI hint, not a security
  // boundary).
  if (!gatewayInfo) return false;
  if (gatewayInfo.gateway === "mock" || gatewayInfo.gateway === "cash") return true;
  if (gatewayInfo.mode === "mock") return true;
  return false;
};

const PaymentDialog = ({
  open,
  onClose,
  onComplete,
  amount,
  currency = "INR",
  method = "upi",
  invoiceNo,
  note,
}) => {
  const [intent, setIntent] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [pollError, setPollError] = useState(null);
  const [methodsInfo, setMethodsInfo] = useState({ methods: [], gateway: { gateway: "mock" } });
  const pollRef = useRef(null);
  const completedRef = useRef(false);

  // 1. Load gateway info + create intent when modal opens.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setError(null);
    setPollError(null);
    setIntent(null);
    completedRef.current = false;

    (async () => {
      try {
        const info = await import("../../services/paymentService").then((m) =>
          m.getPaymentMethods()
        );
        if (cancelled) return;
        setMethodsInfo(info);

        const created = await createPaymentIntent({
          amount,
          currency,
          method,
          invoiceNo,
          note,
        });
        if (cancelled) return;
        setIntent(created);
      } catch (err) {
        if (cancelled) return;
        setError(err?.message || "Failed to start payment");
      }
    })();

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearTimeout(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [open, amount, currency, method, invoiceNo, note]);

  // 2. Poll for status once an intent exists, until terminal.
  const intentId = intent?.id;
  const intentStatus = intent?.status;
  const intentIdRef = useRef(null);
  // Hold the latest onComplete in a ref so the polling effect doesn't have
  // to depend on a parent-supplied callback that may change every render.
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => {
    if (!open || !intentId) return undefined;
    if (intentStatus && intentStatus !== "pending") return undefined;
    intentIdRef.current = intentId;
    let cancelled = false;

    const tick = async () => {
      const currentId = intentIdRef.current;
      if (!currentId) return;
      try {
        const fresh = await getPaymentIntent(currentId);
        if (cancelled) return;
        setIntent(fresh);
        if (fresh.status === "paid" && !completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current && onCompleteRef.current({ ...fresh, source: "polled" });
        } else if (fresh.status === "failed" || fresh.status === "expired") {
          // Stop polling; user must take action or close.
        } else {
          pollRef.current = setTimeout(tick, 2500);
        }
      } catch (err) {
        if (cancelled) return;
        setPollError(err?.message || "Lost connection");
        pollRef.current = setTimeout(tick, 5000);
      }
    };

    pollRef.current = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [open, intentId, intentStatus]);

  // 3. ESC closes the dialog.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // ----- User actions -----

  const onMarkPaid = useCallback(async () => {
    if (!intent || busy) return;
    setBusy(true);
    try {
      const updated = await markPaymentPaid(intent.id, "Cashier marked as paid");
      setIntent(updated);
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete && onComplete({ ...updated, source: "manual" });
      }
    } catch (err) {
      setError(err?.message || "Could not mark as paid");
    } finally {
      setBusy(false);
    }
  }, [intent, busy, onComplete]);

  const onMarkFailed = useCallback(async () => {
    if (!intent || busy) return;
    setBusy(true);
    try {
      const updated = await markPaymentFailed(intent.id, "Cashier marked failed");
      setIntent(updated);
    } catch (err) {
      setError(err?.message || "Could not mark as failed");
    } finally {
      setBusy(false);
    }
  }, [intent, busy]);

  const onSimulate = useCallback(async () => {
    if (!intent || busy) return;
    setBusy(true);
    try {
      const updated = await simulatePayment(intent.id);
      setIntent(updated);
      if (!completedRef.current) {
        completedRef.current = true;
        onComplete && onComplete({ ...updated, source: "simulated" });
      }
    } catch (err) {
      setError(err?.message || "Could not simulate payment");
    } finally {
      setBusy(false);
    }
  }, [intent, busy, onComplete]);

  const isPaid = intent && intent.status === "paid";
  // const isFailed = intent && (intent.status === "failed" || intent.status === "expired");

  const showSimulate = useMemo(() => simulateAvailable(methodsInfo.gateway), [methodsInfo]);

  if (!open) return null;
  const methodIcon = PAYMENT_ICONS[method] || <FaMobileAlt />;

  return (
    <div className="pd-overlay" role="dialog" aria-modal="true" aria-label="Collect payment">
      <div className="pd-card">
        <button type="button" className="pd-close" onClick={onClose} aria-label="Close">
          <FaTimes />
        </button>

        <header className="pd-header">
          <span className="pd-method-icon">{methodIcon}</span>
          <div>
            <h2>Collect payment</h2>
            <p className="pd-sub">
              {invoiceNo ? `Invoice ${invoiceNo} · ` : ""}
              {methodsInfo.gateway?.gateway === "razorpay"
                ? `Razorpay (${methodsInfo.gateway.mode || "test"} mode)`
                : `Mock gateway`}
              {showSimulate ? " · simulate-payment enabled" : ""}
            </p>
          </div>
          <div className="pd-amount">{formatAmount(amount)}</div>
        </header>

        {error && (
          <div className="pd-banner pd-banner-error">
            <FaExclamationCircle /> {error}
          </div>
        )}
        {pollError && (
          <div className="pd-banner pd-banner-warn">
            <FaExclamationCircle /> Lost connection: {pollError}. Retrying…
          </div>
        )}

        {!intent && !error && (
          <div className="pd-loading">
            <FaSpinner className="pd-spin" /> Creating payment intent…
          </div>
        )}

        {intent && (
          <>
            <div className="pd-status-row">
              <span className={`pd-status pd-status-${intent.status}`}>
                {intent.status === "pending" && <FaSpinner className="pd-spin" />}
                {intent.status === "paid" && <FaCheckCircle />}
                {(intent.status === "failed" || intent.status === "expired") && (
                  <FaExclamationCircle />
                )}
                {intent.status}
              </span>
              <span className="pd-id">intent: {intent.id}</span>
            </div>

            {intent.qrPayload && intent.method === "upi" && intent.status === "pending" && (
              <div className="pd-qr-wrap">
                <QRCodeCanvas value={intent.qrPayload} size={224} includeMargin />
                <p className="pd-qr-hint">
                  Customer scans this with any UPI app (PhonePe, GPay, Paytm, BHIM…). The cashier
                  does not need to do anything — payment auto-confirms here within a few seconds.
                </p>
              </div>
            )}

            {method === "cash" && intent.status === "pending" && (
              <div className="pd-cash-wrap">
                <p>
                  Collect <strong>{formatAmount(intent.amount)}</strong> in cash from the customer.
                  Once received, mark as paid to record the invoice.
                </p>
              </div>
            )}

            {intent.status === "pending" && (
              <div className="pd-actions">
                <button
                  type="button"
                  className="pd-btn pd-btn-primary"
                  onClick={onMarkPaid}
                  disabled={busy}
                >
                  {busy ? <FaSpinner className="pd-spin" /> : <FaCheckCircle />} Mark as paid
                </button>
                <button
                  type="button"
                  className="pd-btn pd-btn-secondary"
                  onClick={onMarkFailed}
                  disabled={busy}
                >
                  Mark failed
                </button>
                {showSimulate && (
                  <button
                    type="button"
                    className="pd-btn pd-btn-secondary"
                    onClick={onSimulate}
                    disabled={busy}
                    title="DEV / mock mode — pretend the customer paid"
                  >
                    Simulate payment
                  </button>
                )}
              </div>
            )}

            {isPaid && (
              <div className="pd-banner pd-banner-ok">
                <FaCheckCircle /> Payment received. Recording invoice…
              </div>
            )}

            {(intent.status === "failed" || intent.status === "expired") && (
              <div className="pd-actions">
                <button
                  type="button"
                  className="pd-btn pd-btn-primary"
                  onClick={() => {
                    setIntent(null);
                    setError(null);
                  }}
                  disabled={busy}
                >
                  Try again
                </button>
                <button
                  type="button"
                  className="pd-btn pd-btn-secondary"
                  onClick={onMarkPaid}
                  disabled={busy}
                >
                  Mark paid anyway
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PaymentDialog;
