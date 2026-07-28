import { useEffect } from "react";

/**
 * Browser guard against accidental data loss.
 *
 * When `when` is truthy, attaches a `beforeunload` handler that asks the
 * browser to confirm navigation/close. Most modern browsers ignore the
 * custom message and show their own ("Changes you made may not be saved"),
 * but they do honor `preventDefault()` — that's what triggers the prompt.
 *
 * This hook is intentionally narrow: it only covers the page-unload case.
 * For in-app navigation guards (Link clicks, router pushes), pair this with
 * `useBlocker` from react-router (future work).
 *
 * Currently applied in:
 *   - src/components/pos/POSBilling.jsx (active bill has items)
 *   - src/components/laundry/LaundryBilling.jsx (active bill has items)
 *
 * TODO: also apply to src/components/hotel/HotelBilling.jsx once the right
 * "draft state" signal is identified — that file mixes dining + lodging +
 * checkout in one component, so the guard needs a careful condition.
 *
 * @param {boolean} when - true when the page has unsaved/draft state.
 */
const useUnsavedChangesGuard = (when) => {
  useEffect(() => {
    if (!when) return undefined;

    const handler = (event) => {
      // Modern browsers display their own copy; setting returnValue is the
      // standard trigger. Setting both is harmless and older-browser friendly.
      event.preventDefault();
      event.returnValue = "";
      return "";
    };

    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [when]);
};

export default useUnsavedChangesGuard;
