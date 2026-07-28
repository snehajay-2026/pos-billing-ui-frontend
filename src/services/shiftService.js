import { apiGet, apiPost } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

/**
 * shiftService — wraps /api/shifts*. Only enabled for cash-taking
 * verticals (retail / hotel / laundry / service / msme-service /
 * inventory). For other store types the server returns 409, which the
 * UI handles by hiding shift UI.
 */

const isAuthed = () => {
  const user = getUser();
  return Boolean(user && user.email && user.email !== "nouser");
};

const buildParams = (extra = {}) => {
  const params = { ...extra };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") delete params[k];
  }
  return params;
};

const getScope = () => {
  const user = getUser();
  const active = getActiveStoreContext();
  return {
    storeType: active?.storeType || user?.storeType || "nostore",
    storeId: active?.storeId || user?.storeId || null,
  };
};

export const getActiveShift = async () => {
  if (!isAuthed()) return null;
  const { storeType, storeId } = getScope();
  try {
    return await apiGet("/api/shifts/active", { storeType, storeId });
  } catch (err) {
    if (err && err.status === 409) return null; // non-cash store type
    throw err;
  }
};

export const openShift = ({ openingFloat = 0, notes = "" } = {}) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost("/api/shifts", { openingFloat, notes }, { storeType, storeId });
};

export const closeShift = ({ shiftId, closingCash, closeNotes = "" }) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost(
    `/api/shifts/${shiftId}/close`,
    { closingCash, closeNotes },
    { storeType, storeId }
  );
};

export const recordShiftMovement = ({
  shiftId,
  type,
  amount,
  reason = "",
  refType = null,
  refId = null,
}) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost(
    `/api/shifts/${shiftId}/cash-movements`,
    { type, amount, reason, refType, refId },
    { storeType, storeId }
  );
};

export const getShiftMovements = async (shiftId) => {
  if (!isAuthed()) return [];
  const { storeType, storeId } = getScope();
  return apiGet(`/api/shifts/${shiftId}/cash-movements`, { storeType, storeId });
};

export const getShiftReconciliation = (shiftId) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiGet(`/api/shifts/${shiftId}/reconciliation`, { storeType, storeId });
};

// Comprehensive closing summary: sales by payment method + discount +
// GST + expected vs counted + duration. Calls /api/shifts/:id/summary
// which derives everything from the cash_movements ledger.
export const getShiftSummary = (shiftId) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiGet(`/api/shifts/${shiftId}/summary`, { storeType, storeId });
};

export const getShifts = async (filters = {}) => {
  if (!isAuthed()) return [];
  const { storeType, storeId } = getScope();
  return apiGet("/api/shifts", buildParams({ ...filters, storeType, storeId }));
};

export const getShift = (shiftId) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiGet(`/api/shifts/${shiftId}`, { storeType, storeId });
};

// Hook called by the POS when a cash sale completes — records a 'sale'
// cash_movement against the cashier's currently-open shift. Returns
// null when there's no active shift or the store type doesn't use shifts.
export const recordCashSaleForShift = ({ invoiceNo, amount }) => {
  if (!isAuthed()) return Promise.resolve(null);
  const { storeType, storeId } = getScope();
  return apiPost(
    `/api/invoices/checkout/shift/${encodeURIComponent(invoiceNo)}`,
    { paymentMode: "Cash", amount },
    { storeType, storeId }
  ).catch(() => null);
};

// Store types that physically take cash and need a shift. Mirrors
// CASH_STORE_TYPES in db.js. 'system' is intentionally excluded —
// admins shouldn't be running a drawer.
const CASH_STORE_TYPES = new Set([
  "retail",
  "hotel",
  "laundry",
  "service",
  "msme-service",
  "inventory",
]);
export const isCashStoreType = (storeType) =>
  CASH_STORE_TYPES.has(String(storeType || "").toLowerCase());

// Convenience: getUserCashScope() returns true when the current user's
// store uses a cash drawer. The POS uses this to decide whether to
// gate a sale on an open shift.
export const currentStoreNeedsShift = () => {
  if (!isAuthed()) return false;
  return isCashStoreType(getScope().storeType);
};

// canCloseShift(role) — pure client-side mirror of the server's
// canCloseShift. We re-check the active shift's customerEmail against
// the user's rootOwnerEmail before allowing the close, just like the
// server. The server is the source of truth; this is for UX only.
export const canCloseShiftClient = (shift, user) => {
  if (!shift || !user) return false;
  if (user.role === "SUPER_OWNER") return true;
  if (user.role === "ADMIN") {
    const business = String(user.rootOwnerEmail || user.email || "").toLowerCase();
    return String(shift.customerEmail || "").toLowerCase() === business;
  }
  if (user.role === "STORE_ADMIN") {
    return (
      String(shift.storeType || "").toLowerCase() === String(user.storeType || "").toLowerCase() &&
      String(shift.storeId || "").toLowerCase() === String(user.storeId || "").toLowerCase()
    );
  }
  // CASHIER
  return String(shift.userEmail || "").toLowerCase() === String(user.email || "").toLowerCase();
};
