// useHotelModuleLock — read-only access to the current user's
// customer-level Lodging/Dining/Live Bill lock state.
//
// The hook re-fetches:
//   - on mount,
//   - on authChanged (login / logout / role switch),
//   - on activeStoreChanged (Super Owner impersonating a tenant),
//   - on hotelModuleAccessChanged (any Super Owner toggle from any
//     tab in this browser).
//
// The Super Owner is exempt from the lock at the BACKEND (they can
// always act as a hotel customer), so the hook also returns a
// `bypassForSuperOwner` flag that the UI can use to render a banner
// like "you're inspecting a locked module" instead of a hard block.
//
// Returns { lodgingLocked, diningLocked, liveBillLocked, isLoading,
//          refresh, bypassForSuperOwner, customerEmail }.

import { useCallback, useEffect, useState } from "react";
import {
  getMyHotelLocks,
  HOTEL_MODULE_ACCESS_CHANGED_EVENT,
} from "../services/hotelModuleAccessService";
import { getUser } from "../utils/auth";

const isHotelUser = (user) => {
  if (!user) return false;
  const role = String(user.role || "").toUpperCase();
  if (role === "SUPER_OWNER") return true; // may impersonate a hotel store
  return String(user.storeType || "").toLowerCase() === "hotel";
};

const isSuperOwner = (user) => {
  return Boolean(user) && String(user.role || "").toUpperCase() === "SUPER_OWNER";
};

export function useHotelModuleLock() {
  const [state, setState] = useState({
    lodgingLocked: false,
    diningLocked: false,
    liveBillLocked: false,
    isLoading: true,
    customerEmail: null,
  });

  const refresh = useCallback(async () => {
    const user = getUser();
    if (!isHotelUser(user)) {
      setState({
        lodgingLocked: false,
        diningLocked: false,
        liveBillLocked: false,
        isLoading: false,
        customerEmail: null,
      });
      return;
    }
    try {
      const r = await getMyHotelLocks();
      setState({
        lodgingLocked: !!(r && r.lodging),
        diningLocked: !!(r && r.dining),
        liveBillLocked: !!(r && r.liveBill),
        isLoading: false,
        customerEmail: (r && r.customerEmail) || null,
      });
    } catch {
      // Backend unreachable / 403 — treat as unlocked so the UI does
      // not hard-block the user on a transient network blip. The
      // server's middleware is the source of truth.
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, []);

  useEffect(() => {
    refresh();
    const onAuth = () => refresh();
    const onStore = () => refresh();
    const onLock = () => refresh();
    const onFocus = () => refresh();
    window.addEventListener("authChanged", onAuth);
    window.addEventListener("activeStoreChanged", onStore);
    window.addEventListener(HOTEL_MODULE_ACCESS_CHANGED_EVENT, onLock);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("authChanged", onAuth);
      window.removeEventListener("activeStoreChanged", onStore);
      window.removeEventListener(HOTEL_MODULE_ACCESS_CHANGED_EVENT, onLock);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const user = getUser();
  return {
    ...state,
    refresh,
    bypassForSuperOwner: isSuperOwner(user),
  };
}

export default useHotelModuleLock;
