import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FaCheck, FaTimes, FaSignOutAlt } from "react-icons/fa";
import { openShift } from "../../services/shiftService";
import "./shiftDialogs.css";

/**
 * OpenShiftDialog — shared modal used by ShiftsPage (admin workflow)
 * and POSBilling (cash-sale preflight + mandatory gate).
 *
 * Props:
 *  - open:                visibility toggle.
 *  - onClose:             cancel handler (skipped when mandatory=true).
 *  - onOpened(shift):     called with the freshly-opened shift object.
 *  - title, message:       customizable copy.
 *  - defaultBranchName:    prefills the Branch / counter field.
 *  - mandatory:            when true, the X button and Cancel button
 *                          are hidden, and clicking the backdrop does
 *                          not close the dialog. The only way to dismiss
 *                          is by opening the shift or logging out. A
 *                          "Log out" link appears in the footer.
 *  - user, storeLabel:     read-only display fields shown in mandatory
 *                          mode (User name + Branch name + current
 *                          date/time).
 */
const OpenShiftDialog = ({
  open,
  onClose,
  onOpened,
  onLogout,
  title = "Open shift",
  message,
  defaultBranchName = "",
  mandatory = false,
  user = null,
  storeLabel = null,
}) => {
  const [openingFloat, setOpeningFloat] = useState("");
  const [notes, setNotes] = useState("");
  const [branchName, setBranchName] = useState(defaultBranchName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const currentDateTime = useMemo(() => {
    const d = new Date();
    return d.toLocaleString("en-IN", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }, [open]);

  useEffect(() => {
    if (open) {
      setOpeningFloat("");
      setNotes("");
      setBranchName(defaultBranchName);
      setError(null);
    }
  }, [open, defaultBranchName]);

  // Lock body scroll while the dialog is open so the underlying billing
  // screen cannot be scrolled behind the backdrop. The mandatory gate
  // relies on this — without it, the cashier could sidestep the dialog
  // by scrolling / interacting with the page underneath. Must run on
  // every render so the React Hooks order check passes — the effect
  // itself no-ops on closed-state.
  useEffect(() => {
    if (!open) return undefined;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    // Avoid layout jump when the scrollbar disappears.
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [open]);

  if (!open) return null;

  // In mandatory mode, prevent backdrop clicks from closing the dialog
  // — the only way to dismiss is to open the shift (success path) or
  // log out.
  function handleOverlayClick(e) {
    if (mandatory) {
      e.stopPropagation();
      return;
    }
    onClose && onClose();
  }

  // Render via a portal to document.body so the overlay escapes any
  // ancestor that may have a transform / filter / will-change that
  // creates a containing block or stacking context. Without this,
  // the dialog could be clipped by overflow ancestors or appear behind
  // sibling chrome (e.g. the sticky header at z-index 1040) when its
  // own z-index loses to a higher-numbered descendant of a transformed
  // parent.
  const overlay = (
    <div
      className={`sh-overlay ${mandatory ? "sh-overlay-mandatory" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={handleOverlayClick}
    >
      <div className="sh-modal" onClick={(e) => e.stopPropagation()}>
        <header className="sh-modal-header">
          <h2>{title}</h2>
          {/*
            Close (×) button. Visible in both modes:
              - Non-mandatory: standard dismiss.
              - Mandatory:    an explicit dismiss. The dialog's purpose
                              is to remind the cashier to open a shift;
                              closing it lets them navigate / inspect the
                              page (e.g. a manager who doesn't need to
                              open a shift just wants to peek at /pos).
                              Billing attempts are independently re-gated
                              at generateAndPreview, so closing the dialog
                              does not let a cashier record a cash sale
                              without a shift.
          */}
          <button
            type="button"
            className="sh-modal-close"
            onClick={onClose}
            aria-label="Close"
            title={mandatory ? "Close (billing is blocked without an open shift)" : "Close"}
          >
            <FaTimes />
          </button>
        </header>
        <div className="sh-modal-body">
          {error && <div className="sh-banner sh-banner-error">{error}</div>}
          {mandatory && (
            <p className="sh-help sh-help-mandatory">
              <strong>You must open your shift before starting billing.</strong> Count the cash in
              your drawer and enter the opening float below. The shift can&apos;t be skipped —
              it&apos;s the only way the system tracks every bill you generate today.
            </p>
          )}
          {!mandatory && message && <p className="sh-help">{message}</p>}
          {!mandatory && !message && (
            <p className="sh-help">
              Count the bills already in the drawer at the start of the shift and enter the total
              here. This becomes your <em>opening float</em> — the cash-leak detector adds sales,
              refunds, drops, and paid-outs on top of it to compute <em>expected cash at close</em>.
            </p>
          )}
          {mandatory && (
            <div className="sh-form-grid-2">
              <div className="sh-form-row sh-form-row-readonly">
                <label>User name</label>
                <input
                  type="text"
                  readOnly
                  value={
                    (user && (user.name || user.email)) ||
                    (typeof window !== "undefined" &&
                      (JSON.parse(localStorage.getItem("user") || "{}").name ||
                        JSON.parse(localStorage.getItem("user") || "{}").email)) ||
                    "—"
                  }
                />
              </div>
              <div className="sh-form-row sh-form-row-readonly">
                <label>Branch</label>
                <input type="text" readOnly value={storeLabel || defaultBranchName || "—"} />
              </div>
              <div className="sh-form-row sh-form-row-readonly">
                <label>Date &amp; time</label>
                <input type="text" readOnly value={currentDateTime} />
              </div>
              <div className="sh-form-row sh-form-row-readonly">
                <label>Role</label>
                <input
                  type="text"
                  readOnly
                  value={
                    (user && user.role) ||
                    (typeof window !== "undefined" &&
                      (JSON.parse(localStorage.getItem("user") || "{}").role || "—"))
                  }
                />
              </div>
            </div>
          )}
          <div className="sh-form-row">
            <label>
              Opening float (₹) <span className="sh-required">*</span>
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={openingFloat}
              onChange={(e) => setOpeningFloat(e.target.value)}
              autoFocus={mandatory}
              required
            />
          </div>
          <div className="sh-form-row">
            <label>Branch / counter name (optional)</label>
            <input
              type="text"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="e.g. Baner Main"
              readOnly={mandatory}
            />
          </div>
          <div className="sh-form-row">
            <label>Notes (optional)</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. morning shift, working solo"
            />
          </div>
        </div>
        <footer className="sh-modal-footer">
          {mandatory ? (
            <button
              type="button"
              className="sh-btn sh-btn-secondary sh-btn-logout"
              onClick={() => {
                if (onLogout) onLogout();
                else onClose && onClose();
              }}
            >
              <FaSignOutAlt /> Log out
            </button>
          ) : (
            <button type="button" className="sh-btn sh-btn-secondary" onClick={onClose}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="sh-btn sh-btn-primary"
            onClick={async () => {
              const v = Number(openingFloat);
              if (Number.isNaN(v) || v < 0) {
                setError("Opening float must be a non-negative number");
                return;
              }
              setBusy(true);
              try {
                const s = await openShift({ openingFloat: v, notes, branchName });
                // Wait for the page's onOpened to finish — for the
                // mandatory gate that means refreshing the active-shift
                // state — so the dialog only closes AFTER the shift is
                // confirmed active. This closes the race where the
                // hook's auto-pop effect would re-open the dialog 250 ms
                // later because `activeShift` was still null.
                if (onOpened) await onOpened(s);
                onClose();
              } catch (err) {
                // Keep the dialog open so the cashier can correct the
                // error (bad opening float, network failure, store
                // not eligible for shifts, etc.). Show the error inline.
                setError(err?.body?.error || err.message);
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
          >
            <FaCheck /> {busy ? "Opening…" : "Open shift"}
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
};

export default OpenShiftDialog;
