import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveShift, currentStoreNeedsShift } from "../services/shiftService";
import { getUser } from "../utils/auth";

/**
 * useShiftGate — shared hook used by every POS billing page (Retail,
 * Laundry, Service, Hotel). Polls /api/shifts/active for the logged-in
 * user and surfaces the OpenShiftDialog (mandatory) when there is no
 * active shift for a Cashier / Branch Admin in a cash-vertical store.
 *
 * SUPER_OWNER and Admin (Business Owner) bypass the gate entirely
 * because they don't run a drawer. CASHIER/Admin in a `system` store
 * (e.g. SUPER_OWNER working on a non-cash vertical) also bypass because
 * `currentStoreNeedsShift()` returns false.
 *
 * Pass `force: true` to require an open shift for *every* role
 * (including managers / owners). The Hotel Billing page passes this
 * because shift discipline on /pos is part of the daily close-out
 * workflow — managers must also be on a shift to record hotel sales.
 *
 * ## State model
 *
 * `activeShift` is the single source of truth for "is a shift open?". The
 * dialog visibility is **derived** from it — there is no separate boolean
 * `shiftDialogOpen` that can fall out of sync with the active shift.
 *
 *   activeShift !== null  → dialog stays closed
 *   activeShift === null  → dialog opens (subject to role / store gates)
 *
 * A separate `manualOpen` flag exists only for the explicit
 * "Start my shift" CTA on the page hero (where the cashier clicks a
 * button to summon the dialog while a shift IS already open — e.g.
 * to amend the opening float, or re-open after closing). This flag is
 * never set by the auto-pop path.
 *
 * ## Why the previous design had a race
 *
 * The old hook stored `shiftDialogOpen` as a separate boolean. On
 * successful shift-open:
 *   1. closeShiftDialog() flipped the boolean to false.
 *   2. refreshActiveShift() was kicked off in parallel and took
 *      ~tens of ms to resolve.
 *   3. Between (1) and (2), a `useEffect` re-ran with the new
 *      `shiftDialogOpen=false` and the still-stale `activeShift=null`
 *      and scheduled a 250 ms setTimeout.
 *   4. The setTimeout body closed over the *old* `activeShift` value
 *      (null), so when it fired it unconditionally called
 *      `setShiftDialogOpen(true)` and re-opened the dialog.
 *
 * The fix below makes `shiftDialogOpen` a *computed* value from
 * `activeShift` + `manualOpen`, so it can never disagree with the
 * actual shift state.
 */
export function useShiftGate(options = {}) {
  const [activeShift, setActiveShift] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  // Set true when the user dismisses the dialog with the × button so
  // the auto-pop path stops re-opening it. Resets to false the moment
  // a fresh active shift is detected (so the dialog will pop again
  // after a future shift close), on active-store change, and on
  // logout.
  const [optOut, setOptOut] = useState(false);
  const [user] = useState(() => getUser());
  // Tracks whether we've completed at least one initial poll so the
  // auto-pop path doesn't flash the dialog before the first
  // /api/shifts/active response arrives.
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);

  // Live ref so async callbacks (notably onOpened) always read the
  // freshest activeShift without depending on a stale closure.
  const activeShiftRef = useRef(activeShift);
  useEffect(() => {
    activeShiftRef.current = activeShift;
  }, [activeShift]);

  const refreshActiveShift = useCallback(async () => {
    if (!currentStoreNeedsShift()) {
      setActiveShift(null);
      setHasInitiallyLoaded(true);
      return null;
    }
    try {
      const s = await getActiveShift();
      setActiveShift(s || null);
      setHasInitiallyLoaded(true);
      // An active shift was found — clear the user's previous opt-out
      // so the auto-pop path will fire again the next time the shift
      // closes.
      if (s) setOptOut(false);
      return s || null;
    } catch {
      setActiveShift(null);
      setHasInitiallyLoaded(true);
      return null;
    }
  }, []);

  // ---- Derived dialog visibility -----------------------------------------
  //
  // The popup is open iff:
  //   - we've finished our initial load (no flash before first poll),
  //   - the user is a Cashier only (not SUPER_OWNER / ADMIN /
  //     STORE_ADMIN / BRANCH_ADMIN — managers and owners should not be
  //     blocked by the shift gate; they can open / close a shift at
  //     will from the Shifts page),
  //   - the active store uses shifts (cash-vertical),
  //   - and there is no active shift — OR the user clicked "Start my
  //     shift" manually while a shift is already open.
  const needsShiftGate = useMemo(() => {
    if (!user) return false;
    if (!currentStoreNeedsShift()) return false;
    if (options.force) return true;
    const role = String(user.role || "").toUpperCase();
    // Anyone above Cashier (manager / owner / super-owner) bypasses the
    // gate — they already have permission to open / close shifts at any
    // time from /shifts and should not be blocked from /pos while a
    // Cashier's shift is in progress elsewhere in the business.
    // Pages that require shift discipline for managers (e.g. /pos hotel
    // billing) pass `force: true` so this branch is skipped.
    if (
      role === "SUPER_OWNER" ||
      role === "ADMIN" ||
      role === "STORE_ADMIN" ||
      role === "BRANCH_ADMIN"
    ) {
      return false;
    }
    return true;
  }, [user, options.force]);

  const shiftDialogOpen =
    hasInitiallyLoaded && needsShiftGate && !optOut && (manualOpen || !activeShift);

  // The hook intentionally does NOT use a setTimeout to defer the popup.
  // Visibility is computed synchronously from state on every render, so
  // the moment `activeShift` is set, the dialog's `open` prop flips to
  // false — no race, no re-pop.

  // Polling + window event subscriptions so the chip updates when
  // a shift is opened / closed anywhere in the app.
  useEffect(() => {
    refreshActiveShift();
    const onAuth = () => refreshActiveShift();
    const onFocus = () => refreshActiveShift();
    const onStoreChange = () => {
      // Switching store invalidates the opt-out — the user expects the
      // gate to re-evaluate under the new store's shift rules.
      setOptOut(false);
      refreshActiveShift();
    };
    window.addEventListener("authChanged", onAuth);
    window.addEventListener("activeStoreChanged", onStoreChange);
    window.addEventListener("focus", onFocus);
    const interval = setInterval(refreshActiveShift, 30000);
    return () => {
      window.removeEventListener("authChanged", onAuth);
      window.removeEventListener("activeStoreChanged", onStoreChange);
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [refreshActiveShift]);

  const openShiftDialog = useCallback(() => {
    setManualOpen(true);
    // Re-opening cancels any prior opt-out — the user wants to interact
    // with the dialog again.
    setOptOut(false);
  }, []);
  const closeShiftDialog = useCallback(() => {
    setManualOpen(false);
    // Mark the user's intent to dismiss the dialog. Without this, the
    // derived visibility stays true (because there is still no active
    // shift) and the auto-pop reopens the dialog on the next render.
    // The opt-out is cleared automatically once an active shift is
    // detected, so the dialog will pop again on the next shift close.
    setOptOut(true);
  }, []);

  // Pre-built props for the shared <OpenShiftDialog> component. Using
  // this ensures every billing page uses the exact same mandatory mode
  // and the exact same field layout.
  const useMandatoryShiftDialogProps = useCallback(
    () => ({
      open: shiftDialogOpen,
      mandatory: true,
      user,
      storeLabel: user?.storeId
        ? `${user.storeId} · ${user.storeType || ""}`.replace(/ · $/, "")
        : user?.storeType || "",
      onClose: closeShiftDialog,
      onLogout: () => {
        // Lazy import avoids a hard dependency cycle at module load.
        import("../services/authService").then(({ logout }) => {
          logout();
          window.location.href = "/login";
        });
      },
      // CRITICAL: the dialog awaits this callback before calling
      // onClose. We synchronously commit the freshly-created shift to
      // hook state, which makes the derived `shiftDialogOpen` flip to
      // false on the next render — the dialog's `open` prop is then
      // false, the portal unmounts, and the auto-pop effect's gate
      // (`activeShift` is now truthy) prevents any re-pop.
      onOpened: async (shift) => {
        if (shift) {
          setActiveShift(shift);
          setHasInitiallyLoaded(true);
        } else {
          // Defensive: if the dialog somehow doesn't pass a shift, fall
          // back to the network poll so we still converge on truth.
          await refreshActiveShift();
        }
        setManualOpen(false);
        // Successful open → clear any prior opt-out so the gate will
        // re-evaluate properly the next time this shift closes.
        setOptOut(false);
      },
    }),
    [shiftDialogOpen, user, closeShiftDialog, refreshActiveShift]
  );

  return {
    activeShift,
    shiftDialogOpen,
    openShiftDialog,
    closeShiftDialog,
    refreshActiveShift,
    useMandatoryShiftDialogProps,
  };
}
