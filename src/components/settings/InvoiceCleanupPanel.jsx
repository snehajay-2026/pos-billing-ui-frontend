// InvoiceCleanupPanel — admin-facing retention + permanent invoice cleanup.
//
// Sits inside Store Settings, so it inherits that page's visual language
// (ss-card / ss-section / ss-btn / ss-input) rather than inventing a new one.
//
// The flow is deliberately two-step. Preview is free and safe; execute is
// gated behind a typed confirmation built from the preview's own eligible
// count. The server recomputes that number and re-checks every dependency
// inside the delete transaction, so a number that has gone stale is refused or
// partially skipped — never blindly applied.

import React, { useCallback, useMemo, useState } from "react";
import {
  FaShieldAlt,
  FaSearch,
  FaTrash,
  FaExclamationTriangle,
  FaCheckCircle,
  FaInfoCircle,
  FaTimes,
} from "react-icons/fa";
import { useUi } from "../../context/UiContext";
import {
  previewInvoiceCleanup,
  executeInvoiceCleanup,
  buildConfirmationPhrase,
  canRunInvoiceCleanup,
  RETENTION_SETTING_KEY,
} from "../../services/invoiceCleanupService";
import { getStoreSettings, saveStoreSettings } from "../../services/storeSettingsService";

const RETENTION_OPTIONS = [
  { value: 1, label: "1 year" },
  { value: 2, label: "2 years" },
  { value: 3, label: "3 years" },
  { value: 5, label: "5 years" },
];

const formatBytes = (bytes) => {
  const n = Number(bytes || 0);
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

const formatCutoff = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const InvoiceCleanupPanel = () => {
  const { showToast } = useUi();
  const settings = getStoreSettings();
  const savedRetention = settings?.[RETENTION_SETTING_KEY]?.retentionYears;
  const [retentionYears, setRetentionYears] = useState(
    Number.isInteger(savedRetention) && savedRetention > 0 ? savedRetention : 3
  );
  const [savingRetention, setSavingRetention] = useState(false);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [executing, setExecuting] = useState(false);

  const allowed = canRunInvoiceCleanup();

  const requiredPhrase = useMemo(
    () => buildConfirmationPhrase(preview?.eligible || 0),
    [preview?.eligible]
  );
  const canConfirm = typed.trim().toUpperCase() === requiredPhrase;

  const onRetentionChange = async (next) => {
    setRetentionYears(next);
    setSavingRetention(true);
    try {
      await saveStoreSettings({
        ...settings,
        [RETENTION_SETTING_KEY]: { retentionYears: next },
      });
      showToast("success", "Invoice retention updated");
      // A different window means the previous preview no longer describes
      // what would happen, so it is cleared rather than left misleading.
      setPreview(null);
      setResult(null);
      setError(null);
    } catch (err) {
      showToast("error", err?.message || "Could not save retention");
    } finally {
      setSavingRetention(false);
    }
  };

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    setError(null);
    setResult(null);
    try {
      const data = await previewInvoiceCleanup(retentionYears);
      setPreview(data);
      if (!data.eligible) {
        showToast("info", "No invoices are currently eligible for cleanup");
      }
    } catch (err) {
      setError(err?.message || "Could not analyse invoices");
      setPreview(null);
    } finally {
      setPreviewing(false);
    }
  }, [retentionYears, showToast]);

  const openConfirm = () => {
    setTyped("");
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    if (executing) return;
    setConfirmOpen(false);
    setTyped("");
  };

  const runExecute = async () => {
    setExecuting(true);
    setError(null);
    try {
      const data = await executeInvoiceCleanup({
        retentionYears,
        eligibleCount: preview?.eligible || 0,
      });
      setResult(data);
      setConfirmOpen(false);
      setTyped("");
      if (data.skipped > 0) {
        showToast(
          "info",
          `Cleanup completed. ${data.skipped} invoice(s) were skipped because new dependencies were detected.`
        );
      } else {
        showToast("success", "Cleanup completed successfully.");
      }
    } catch (err) {
      setError(err?.message || "Cleanup could not be completed");
      setConfirmOpen(false);
      showToast(
        "error",
        "Cleanup could not be completed. No unsafe partial deletion should have occurred."
      );
    } finally {
      setExecuting(false);
    }
  };

  // Cashier sees nothing at all — not a disabled panel. The server refuses
  // these routes for them regardless, so this is purely about not offering
  // controls that could only ever 403. Declared after every hook so the hook
  // order stays stable across renders.
  if (!allowed) return null;

  return (
    <section className="ss-section icp" aria-label="Invoice cleanup">
      <div className="ss-section-title">
        <span className="ss-section-title-ico icp-ico">
          <FaShieldAlt />
        </span>
        <div>
          <h6>Invoice Cleanup</h6>
          <p>
            Permanently remove invoices older than your retention window. Every deletion is
            dependency-checked first.
          </p>
        </div>
      </div>

      {/* Retention */}
      <div className="ss-field">
        <label className="ss-field-label" htmlFor="icp-retention">
          Retention period
        </label>
        <select
          id="icp-retention"
          className="ss-select"
          value={retentionYears}
          disabled={savingRetention || executing}
          onChange={(e) => onRetentionChange(Number(e.target.value))}
        >
          {RETENTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="icp-actions">
        <button
          type="button"
          className="ss-btn ss-btn-soft"
          onClick={runPreview}
          disabled={previewing || executing}
        >
          <FaSearch />
          {previewing ? "Analyzing invoices…" : "Preview cleanup"}
        </button>
      </div>

      {error && (
        <div className="icp-alert icp-alert-error" role="alert">
          <FaExclamationTriangle aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Preview result */}
      {preview && (
        <div className="icp-preview">
          <div className="icp-grid">
            <div className="icp-metric">
              <span className="icp-metric-label">Older than cutoff</span>
              <strong className="icp-metric-value">{preview.totalCandidates}</strong>
              <span className="icp-metric-hint">before {formatCutoff(preview.cutoffDate)}</span>
            </div>
            <div className="icp-metric icp-metric-ok">
              <span className="icp-metric-label">Eligible</span>
              <strong className="icp-metric-value">{preview.eligible}</strong>
              <span className="icp-metric-hint">safe to delete</span>
            </div>
            <div className="icp-metric icp-metric-blocked">
              <span className="icp-metric-label">Blocked</span>
              <strong className="icp-metric-value">{preview.blocked}</strong>
              <span className="icp-metric-hint">kept for a reason</span>
            </div>
          </div>

          {preview.truncated && (
            <p className="icp-note">
              <FaInfoCircle aria-hidden="true" />
              Analysed the first {preview.analysedCandidates} of {preview.totalCandidates}{" "}
              candidates. Counts may be higher than shown.
            </p>
          )}

          {Object.keys(preview.blockedReasons || {}).length > 0 && (
            <div className="icp-reasons">
              <h6>Why invoices are blocked</h6>
              <ul>
                {Object.entries(preview.blockedReasons).map(([code, count]) => (
                  <li key={code}>
                    <span>{preview.blockedLabels?.[code] || code}</span>
                    <strong>{count}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="icp-note">
            <FaInfoCircle aria-hidden="true" />
            Estimated invoice data eligible for cleanup:{" "}
            <strong>{formatBytes(preview.estimatedBytes)}</strong>. This is an estimate of row data,
            not a guarantee of disk space recovered.
          </p>

          <ul className="icp-warnings">
            {(preview.warnings || []).map((w) => (
              <li key={w.code}>
                <FaExclamationTriangle aria-hidden="true" />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>

          <div className="icp-actions">
            <button
              type="button"
              className="ss-btn ss-btn-danger-soft"
              onClick={openConfirm}
              disabled={preview.eligible === 0 || executing}
            >
              <FaTrash />
              Cleanup {preview.eligible} invoice{preview.eligible === 1 ? "" : "s"}
            </button>
          </div>
        </div>
      )}

      {/* Execution result */}
      {result && (
        <div
          className={result.skipped > 0 ? "icp-alert icp-alert-warn" : "icp-alert icp-alert-ok"}
          role="status"
        >
          {result.skipped > 0 ? (
            <FaExclamationTriangle aria-hidden="true" />
          ) : (
            <FaCheckCircle aria-hidden="true" />
          )}
          <div>
            <strong>
              {result.skipped > 0
                ? "Cleanup completed. Some invoices were skipped because new dependencies were detected."
                : "Cleanup completed successfully."}
            </strong>
            <span className="icp-result-line">
              Candidates {result.totalCandidates} · Eligible {result.eligible} · Blocked{" "}
              {result.blocked} · Deleted {result.deletedCount} · Skipped {result.skipped}
            </span>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {confirmOpen && (
        <div
          className="icp-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirm permanent invoice cleanup"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeConfirm();
          }}
        >
          <div className="icp-modal">
            <header className="icp-modal-head">
              <h6>Permanently delete {preview?.eligible} invoices?</h6>
              <button
                type="button"
                className="icp-modal-close"
                onClick={closeConfirm}
                aria-label="Close"
                disabled={executing}
              >
                <FaTimes />
              </button>
            </header>

            <div className="icp-modal-body">
              <p>
                This permanently deletes <strong>{preview?.eligible}</strong> invoice
                {preview?.eligible === 1 ? "" : "s"} generated before{" "}
                <strong>{formatCutoff(preview?.cutoffDate)}</strong> in{" "}
                <strong>
                  {preview?.storeType} / {preview?.storeId}
                </strong>
                .
              </p>
              <p className="icp-modal-warn">
                <FaExclamationTriangle aria-hidden="true" />
                This cannot be undone from the application. Invoices that gained a dependency since
                the preview will be skipped, not deleted.
              </p>

              <label className="ss-field-label" htmlFor="icp-confirm">
                Type <code>{requiredPhrase}</code> to confirm
              </label>
              <input
                id="icp-confirm"
                type="text"
                className="ss-input"
                value={typed}
                autoComplete="off"
                disabled={executing}
                placeholder={requiredPhrase}
                onChange={(e) => setTyped(e.target.value)}
              />
            </div>

            <footer className="icp-modal-foot">
              <button
                type="button"
                className="ss-btn ss-btn-soft"
                onClick={closeConfirm}
                disabled={executing}
              >
                Cancel
              </button>
              <button
                type="button"
                className="ss-btn ss-btn-danger-soft"
                onClick={runExecute}
                disabled={!canConfirm || executing}
              >
                <FaTrash />
                {executing ? "Cleaning up…" : "Permanently cleanup"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
};

export default InvoiceCleanupPanel;
