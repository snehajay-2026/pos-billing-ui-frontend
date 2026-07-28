import React, { useEffect, useState } from "react";
import { FaCashRegister, FaCheckCircle, FaTimes } from "react-icons/fa";
import {
  getActiveShift,
  currentStoreNeedsShift,
  canCloseShiftClient,
} from "../../services/shiftService";
import { getUser } from "../../utils/auth";
import "./shiftStatusBanner.css";

/**
 * ShiftStatusBanner — inline POS banner that surfaces the current
 * shift state. Two states:
 *
 *   - "no active shift"  → amber CTA: "Start my shift"
 *   - "shift open"        → green info: shift is open + Close button
 *
 * The component polls every 30 s + on auth/focus events, so it stays
 * in sync when the cashier opens a shift in another tab or via the
 * header. When the user clicks the inline Close button, this component
 * delegates to the parent so the parent can open its CloseShiftDialog.
 */
const ShiftStatusBanner = ({ onOpen, onClose, onOpened }) => {
  const [activeShift, setActiveShift] = useState(null);
  const [user] = useState(() => getUser());

  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;

    const refresh = async () => {
      if (!currentStoreNeedsShift()) {
        setActiveShift(null);
        return;
      }
      try {
        const s = await getActiveShift();
        if (!cancelled) setActiveShift(s);
      } catch {
        if (!cancelled) setActiveShift(null);
      }
    };

    refresh();
    const interval = setInterval(refresh, 30000);
    const onAuthChange = () => refresh();
    const onFocus = () => refresh();
    window.addEventListener("authChanged", onAuthChange);
    window.addEventListener("activeStoreChanged", onAuthChange);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("authChanged", onAuthChange);
      window.removeEventListener("activeStoreChanged", onAuthChange);
      window.removeEventListener("focus", onFocus);
    };
  }, [user]);

  if (!user || !currentStoreNeedsShift()) return null;

  // State 1 — no active shift
  if (!activeShift) {
    return (
      <div className="shb-banner shb-banner-action">
        <FaCashRegister className="shb-banner-icon" />
        <div className="shb-banner-text">
          <strong>Start your shift to take cash sales</strong>
          <span>No drawer is open for this store. Click below to set your opening float.</span>
        </div>
        <button type="button" className="shb-banner-cta" onClick={onOpen}>
          <FaCashRegister /> Start my shift
        </button>
      </div>
    );
  }

  // State 2 — shift open
  const canClose = canCloseShiftClient(activeShift, user);
  const branchLabel = activeShift.branchName
    ? `${activeShift.branchName} · ${activeShift.storeType}/${activeShift.storeId || ""}`
    : `${activeShift.storeType}/${activeShift.storeId || ""}`;

  return (
    <div className="shb-banner shb-banner-info">
      <FaCheckCircle className="shb-banner-icon" />
      <div className="shb-banner-text">
        <strong>Shift is open</strong>
        <span>
          Opening float ₹{Number(activeShift.openingFloat || 0).toFixed(2)} · {branchLabel}
        </span>
      </div>
      {canClose && (
        <button type="button" className="shb-banner-cta shb-banner-cta-secondary" onClick={onClose}>
          <FaTimes /> Close shift
        </button>
      )}
    </div>
  );
};

export default ShiftStatusBanner;
