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

export const openShift = ({
  openingFloat = 0,
  notes = "",
  branchName = "",
  customerEmail = "",
} = {}) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost(
    "/api/shifts",
    { openingFloat, notes, branchName, customerEmail },
    { storeType, storeId }
  );
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
//
// Implementation: the backend already auto-stamps `invoices.shift_id`
// from the cashier's active session at INSERT time, so the summary
// endpoint will pick up the sale via the invoice → shift FK regardless
// of whether we POST a movement. We additionally push a `cash_in`
// movement row to the shift's cash_movements ledger so the close-shift
// reconciliation (which sums `opening_float + cash_in - cash_out`) bumps
// the expected closing cash — without it the close dialog would always
// show "expected = opening_float" because nothing ever moves.
//
// The previous implementation POSTed to /api/invoices/checkout/shift/:no
// which doesn't exist (the backend never had that endpoint), so the
// movement was silently swallowed and every close-shift "expected cash"
// equaled opening float. That's the bug we're fixing here.
export const recordCashSaleForShift = async ({ invoiceNo, amount }) => {
  if (!isAuthed()) return null;
  // Look up the active shift first so we can return null cleanly when
  // the store type doesn't run a drawer (avoids a guaranteed 409).
  let active;
  try {
    active = await getActiveShift();
  } catch (e) {
    return null;
  }
  if (!active || !active.id) return null;
  try {
    return await recordShiftMovement({
      shiftId: Number(active.id),
      type: "cash_in",
      amount: Number(amount) || 0,
      reason: "sale",
      refType: "invoice",
      refId: invoiceNo ? String(invoiceNo) : null,
    });
  } catch (e) {
    // Don't break the POS flow on a shift-write failure — the invoice
    // is already saved and the summary will still see it via the FK.
    return null;
  }
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

// canCloseShiftClient(shift, user) — pure client-side mirror of the
// server's authorizeShiftAccess rule for POST /api/shifts/:id/close.
// The server is the source of truth — this is for hiding/showing the
// "Close shift" CTA only.
//
// Rules (mirrors index.js authorizeShiftAccess + close route):
//   - SUPER_OWNER: unconditional.
//   - ADMIN / STORE_ADMIN / BRANCH_ADMIN: same (storeType, storeId) as
//     the shift. (The backend treats ADMIN as rootOwnerEmail match and
//     STORE_ADMIN/BRANCH_ADMIN as same-store; we collapse them to
//     same-store here for the close CTA — the server still enforces
//     the precise rule at write time.)
//   - CASHIER (and every other role): strict owner match on
//     `shift.userId === user.id`. The previous version compared
//     `shift.userEmail === user.email`, but `userEmail` is no longer
//     surfaced on the shift object (the JOIN to `users` was removed to
//     stop a TiDB planner hang — see the SHIFT_COLUMNS_WITH_USERS
//     comment in db/queries/shifts.js). The owner ID is always
//     available and is what the server actually checks.
export const canCloseShiftClient = (shift, user) => {
  if (!shift || !user) return false;
  const role = String(user.role || "").toUpperCase();
  if (role === "SUPER_OWNER") return true;
  if (role === "ADMIN" || role === "STORE_ADMIN" || role === "BRANCH_ADMIN") {
    return (
      String(shift.storeType || "").toLowerCase() === String(user.storeType || "").toLowerCase() &&
      String(shift.storeId || "").toLowerCase() === String(user.storeId || "").toLowerCase()
    );
  }
  // CASHIER (or any other role): must own the shift.
  return Number(shift.userId) === Number(user.id);
};
