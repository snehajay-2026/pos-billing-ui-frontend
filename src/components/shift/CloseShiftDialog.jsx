import React, { useEffect, useState } from "react";
import { FaCheck, FaTimes } from "react-icons/fa";
import { closeShift, getShiftSummary } from "../../services/shiftService";
import "./shiftDialogs.css";

const CloseShiftDialog = ({ open, shift, onClose, onClosed, title = "Close shift" }) => {
  const [closingCash, setClosingCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loadingSummary, setLoadingSummary] = useState(false);

  useEffect(() => {
    if (!open || !shift) return;
    setClosingCash("");
    setCloseNotes("");
    setError(null);
    (async () => {
      setLoadingSummary(true);
      try {
        const s = await getShiftSummary(shift.id);
        setSummary(s);
      } catch {
        setSummary(null);
      } finally {
        setLoadingSummary(false);
      }
    })();
  }, [open, shift]);

  if (!open || !shift) return null;

  const counted = Number(closingCash) || 0;
  const expected = summary?.closing?.expected ?? 0;
  const variance = closingCash ? Number((counted - expected).toFixed(2)) : null;
  // Zero-difference rule. The shift can close ONLY when the counted
  // cash matches the expected physical cash to the cent. The server
  // enforces this independently (returns 409 CASH_VARIANCE_NOT_ZERO);
  // we mirror the rule on the button so the cashier gets immediate
  // feedback instead of a round-trip failure.
  const varianceIsZero = variance != null && Math.abs(variance) < 0.005;
  const canSubmit =
    !busy && closingCash !== "" && Number.isFinite(Number(closingCash)) && varianceIsZero;
  const openedAt = summary?.openedAt ? new Date(summary.openedAt) : null;
  const closedAt = closingCash ? new Date() : null;
  const durationMin =
    openedAt && closedAt ? Math.max(0, Math.round((closedAt - openedAt) / 60000)) : null;

  return (
    <div className="sh-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="sh-modal">
        <header className="sh-modal-header">
          <h2>{title}</h2>
          <button type="button" className="sh-modal-close" onClick={onClose}>
            <FaTimes />
          </button>
        </header>
        <div className="sh-modal-body">
          {error && <div className="sh-banner sh-banner-error">{error}</div>}
          {/* Zero-difference gate: a non-zero variance blocks the close.
             The button below also disables itself when canSubmit is
             false, but showing the message inline makes the rule
             obvious to the cashier without forcing them to hover the
             button. */}
          {variance != null && !varianceIsZero && (
            <div className="sh-banner sh-banner-error">
              <strong>Shift cannot be closed until the cash difference is exactly ₹0.</strong> You
              entered ₹{counted.toFixed(2)} but the expected cash is ₹{expected.toFixed(2)}{" "}
              (difference {variance < 0 ? "−" : "+"}₹{Math.abs(variance).toFixed(2)}). Please
              reconcile the cash balance and re-enter the counted amount.
            </div>
          )}
          {loadingSummary && <div className="sh-help">Loading shift activity...</div>}
          {!loadingSummary && summary && (
            <>
              <div className="sh-reconcile-section">
                <h4 className="sh-reconcile-h4">Sales during this shift</h4>
                <div className="sh-reconcile-grid sh-reconcile-grid-wide">
                  <div>
                    <span>Total bills</span>
                    <strong>{summary.totals?.bills ?? 0}</strong>
                  </div>
                  <div>
                    <span>Total sales</span>
                    <strong>Rs {(summary.totals?.sales || 0).toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Discounts</span>
                    <strong>Rs {(summary.totals?.discount || 0).toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>GST collected</span>
                    <strong>Rs {(summary.totals?.gst || 0).toFixed(2)}</strong>
                  </div>
                </div>
                <div className="sh-reconcile-grid sh-reconcile-grid-wide">
                  <div>
                    <span>Cash collection</span>
                    <strong>Rs {(summary.sales?.cash || 0).toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Card collection</span>
                    <strong>Rs {(summary.sales?.card || 0).toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>UPI collection</span>
                    <strong>Rs {(summary.sales?.upi || 0).toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Other collection</span>
                    <strong>Rs {(summary.sales?.other || 0).toFixed(2)}</strong>
                  </div>
                </div>
                {(summary.outflows?.refund ||
                  summary.outflows?.drop ||
                  summary.outflows?.paidOut) && (
                  <div className="sh-reconcile-grid sh-reconcile-grid-wide">
                    {summary.outflows?.refund ? (
                      <div className="sh-negative">
                        <span>Refunds</span>
                        <strong>Rs {(summary.outflows.refund || 0).toFixed(2)}</strong>
                      </div>
                    ) : null}
                    {summary.outflows?.drop ? (
                      <div>
                        <span>Cash drops</span>
                        <strong>Rs {Math.abs(summary.outflows.drop || 0).toFixed(2)}</strong>
                      </div>
                    ) : null}
                    {summary.outflows?.paidOut ? (
                      <div>
                        <span>Paid out</span>
                        <strong>Rs {Math.abs(summary.outflows.paidOut || 0).toFixed(2)}</strong>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="sh-reconcile-section">
                <h4 className="sh-reconcile-h4">Cash drawer reconciliation</h4>
                <div className="sh-reconcile-grid sh-reconcile-grid-wide">
                  <div>
                    <span>Opening cash</span>
                    <strong>Rs {(summary.opening?.float || 0).toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Paid in / pickups</span>
                    <strong>
                      Rs{" "}
                      {(
                        (summary.collections?.paidIn || 0) + (summary.collections?.pickup || 0)
                      ).toFixed(2)}
                    </strong>
                  </div>
                  <div>
                    <span>Refunds + drops + paid out</span>
                    <strong>
                      Rs{" "}
                      {(
                        Math.abs(summary.outflows?.refund || 0) +
                        Math.abs(summary.outflows?.drop || 0) +
                        Math.abs(summary.outflows?.paidOut || 0)
                      ).toFixed(2)}
                    </strong>
                  </div>
                  <div>
                    <span>Expected cash in drawer</span>
                    <strong>Rs {expected.toFixed(2)}</strong>
                  </div>
                </div>
                <div className="sh-reconcile-grid sh-reconcile-grid-wide">
                  <div>
                    <span>Counted cash (you)</span>
                    <strong>Rs {counted.toFixed(2)}</strong>
                  </div>
                  {variance != null && (
                    <div
                      className={variance < 0 ? "sh-negative" : variance > 0 ? "sh-positive" : ""}
                    >
                      <span>Cash difference</span>
                      <strong>
                        {variance < 0 ? "Short" : variance > 0 ? "Excess" : "Balanced"} Rs{" "}
                        {Math.abs(variance).toFixed(2)}
                      </strong>
                    </div>
                  )}
                  {openedAt && (
                    <div>
                      <span>Shift opened at</span>
                      <strong>{openedAt.toLocaleString()}</strong>
                    </div>
                  )}
                  {durationMin != null && (
                    <div>
                      <span>Shift duration</span>
                      <strong>{durationMin} min</strong>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          <div className="sh-form-row">
            <label>Counted cash (Rs)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={closingCash}
              onChange={(e) => setClosingCash(e.target.value)}
              autoFocus
            />
          </div>
          <div className="sh-form-row">
            <label>Close notes (optional)</label>
            <textarea
              rows={2}
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
              placeholder="e.g. counted clean, short by 20 (explain)"
            />
          </div>
        </div>
        <footer className="sh-modal-footer">
          <button type="button" className="sh-btn sh-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sh-btn sh-btn-primary"
            onClick={async () => {
              if (!closingCash) {
                setError("Please enter the counted cash");
                return;
              }
              // Belt-and-braces: even if the cashier disabled JS or
              // bypassed the disabled attribute, refuse to call close
              // when variance is non-zero. The backend will reject it
              // anyway (CASH_VARIANCE_NOT_ZERO), but blocking here
              // saves a round-trip and keeps the UI honest.
              if (!varianceIsZero) {
                setError(
                  `Cash difference is ${variance < 0 ? "−" : "+"}₹${Math.abs(variance).toFixed(
                    2
                  )}. The shift can only be closed when the difference is exactly ₹0.`
                );
                return;
              }
              setBusy(true);
              try {
                await closeShift({
                  shiftId: shift.id,
                  closingCash: Number(closingCash),
                  closeNotes,
                });
                onClosed && onClosed(shift);
                onClose();
              } catch (err) {
                // Surface the backend's structured 409 with the same
                // language the cashier sees in the inline banner so the
                // error is consistent across client + server.
                if (err && err.body && err.body.code === "CASH_VARIANCE_NOT_ZERO") {
                  const v = Number(err.body.variance || 0);
                  setError(
                    `Shift cannot be closed — cash difference must be ₹0.00 (counted ₹${Number(
                      err.body.closingCash || 0
                    ).toFixed(2)} vs expected ₹${Number(err.body.expected || 0).toFixed(
                      2
                    )}, variance ${v < 0 ? "−" : "+"}₹${Math.abs(v).toFixed(2)}).`
                  );
                  return;
                }
                setError(err?.body?.error || err.message);
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy || !canSubmit}
            title={
              !canSubmit
                ? "Cash difference must be exactly ₹0 before the shift can close"
                : undefined
            }
          >
            <FaCheck /> {busy ? "Closing..." : "Close shift"}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default CloseShiftDialog;
