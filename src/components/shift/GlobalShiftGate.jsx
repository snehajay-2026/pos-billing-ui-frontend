import React from "react";
import { useLocation } from "react-router-dom";
import { useShiftGate } from "../../hooks/useShiftGate";
import OpenShiftDialog from "./OpenShiftDialog";

// Paths where the global shift gate must NOT auto-pop — these are
// either unauthenticated (public share links, login/register pages)
// or the bootstrap loading screen. Mirrors PUBLIC_PATH_PREFIXES in
// App.js so the two never disagree.
const GATE_SKIP_PREFIXES = ["/login", "/register", "/password-reset", "/invoice"];

/**
 * GlobalShiftGate — App-level mandatory shift gate.
 *
 * Mounted once, inside <BrowserRouter>, alongside
 * <SessionExpiredListener>. Its purpose is to make Open Shift the
 * FIRST popup a logged-in cashier sees after login, on EVERY
 * authenticated route — not just `/pos`. Pages like `/dashboard`,
 * `/inventory`, `/customers`, `/service-orders`, etc., had no shift
 * UI at all, so a cashier redirected there by role never saw the
 * gate.
 *
 * Role policy (matches the existing useShiftGate default):
 *   - CASHIER in a cash-vertical store → gate fires.
 *   - SUPER_OWNER / ADMIN / STORE_ADMIN / BRANCH_ADMIN → no gate
 *     (they don't own a drawer per the existing business rule).
 *   - Non-cash-vertical stores → no gate.
 *
 * The dialog is rendered with `inescapable: true`:
 *   - No × button.
 *   - Escape key is trapped (see OpenShiftDialog keydown handler).
 *   - Backdrop is non-interactive.
 *   - Only "Open shift" or "Log out" buttons are reachable.
 *
 * Server-side enforcement remains the final line of defense —
 * POST /api/invoices* returns 409 NO_ACTIVE_SHIFT for cashiers.
 * Frontend cannot bypass the backend by dev-tools tampering because
 * the backend has no role bypass for cashier-equivalents; see
 * attachShiftContext in backend/index.js.
 */
const GlobalShiftGate = () => {
  const location = useLocation();
  const pathname = location?.pathname || "";

  // Skip the gate on public / unauthenticated routes. Computed BEFORE
  // the hook call so the hooks-order check passes — `useShiftGate`
  // and `useMandatoryShiftDialogProps` must always be invoked
  // regardless of path.
  const onSkipPath =
    pathname === "/" ||
    GATE_SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));

  // `global: true` flips the hook into inescapable mode (no × button,
  // optOut is ignored, every poll re-evaluates).
  const { useMandatoryShiftDialogProps } = useShiftGate({ global: true });

  // Always invoke the props builder — calling it conditionally
  // violates React Hooks rules. We then null out `props.open` when
  // the gate is supposed to skip this path, so the dialog below
  // does not mount.
  const props = useMandatoryShiftDialogProps();
  if (onSkipPath) return null;

  // Defensive: only render the dialog when `open` is true and the
  // user is actually eligible for the gate. The hook already
  // encodes both conditions, but a redundant guard keeps the
  // portal from mounting on routes where the cashier is irrelevant
  // (e.g. cold-start before `loadCurrentUser` resolves).
  if (!props.open) {
    // Make sure the cross-component flag is cleared when the
    // global dialog is unmounting (covers a successful shift open
    // that flips props.open to false — the dialog's onClose
    // handler may not fire on the unmount path).
    if (typeof window !== "undefined") {
      window.__GLOBAL_SHIFT_GATE_OPEN__ = false;
    }
    return null;
  }

  // Cross-component de-duplication: pages that have their own
  // pre-flight dialog (POSBilling pending-invoice resume) read this
  // window flag to know they should NOT mount a second dialog. The
  // flag is set while the global dialog is mounted and cleared on
  // unmount. Pages without a pending flow don't need to consult
  // it — they already pass `skipAutoPop: true` to their per-page
  // hook and don't render a dialog at all.
  if (typeof window !== "undefined") {
    window.__GLOBAL_SHIFT_GATE_OPEN__ = true;
  }

  return (
    <OpenShiftDialog
      {...props}
      onClose={() => {
        // Clear the cross-component flag alongside the dialog's
        // own close handler so any per-page dialog can re-mount on
        // its next pre-flight.
        if (typeof window !== "undefined") {
          window.__GLOBAL_SHIFT_GATE_OPEN__ = false;
        }
        if (props.onClose) props.onClose();
      }}
      onOpened={async (shift) => {
        // Wrap the hook-provided onOpened so we ALSO dispatch a
        // window event. Per-page billing components (POSBilling
        // especially) listen for this to resume a pending invoice
        // they stashed in their pre-flight when their own dialog
        // was suppressed due to the global gate.
        if (typeof window !== "undefined") {
          window.__GLOBAL_SHIFT_GATE_OPEN__ = false;
          try {
            window.dispatchEvent(new CustomEvent("globalShiftOpened", { detail: shift || null }));
          } catch {
            // CustomEvent constructor can throw on old browsers;
            // nothing critical depends on this so swallow.
          }
        }
        if (props.onOpened) await props.onOpened(shift);
      }}
    />
  );
};

export default GlobalShiftGate;
