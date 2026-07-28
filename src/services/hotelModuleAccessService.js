// Hotel Store module access (Lodging / Dining lock state).
//
// The Super Owner uses /api/hotel/module-locks to view every hotel
// customer's lock state and to flip the toggles. Every other user
// (Admin / Branch Admin / Cashier) reads their own customer lock
// state via /api/hotel/module-locks/me — that's what
// useHotelModuleLock hooks into.
//
// Backend authoritative code lives in index.js — the PUT endpoint
// is Super-Owner-only and stamps lockedBy/lockedAt. The frontend
// dispatches a `hotelModuleAccessChanged` window event on every
// successful write so other open tabs / pages can re-read their
// lock state without polling.

import { apiGet, apiPut } from "./api";

const ENDPOINT_ALL = "/api/hotel/module-locks";
const ENDPOINT_ME = "/api/hotel/module-locks/me";

// Custom event fired on every successful setLock(). The
// useHotelModuleLock hook re-fetches on this.
export const HOTEL_MODULE_ACCESS_CHANGED_EVENT = "hotelModuleAccessChanged";
const fireChanged = (detail) => {
  try {
    window.dispatchEvent(new CustomEvent(HOTEL_MODULE_ACCESS_CHANGED_EVENT, { detail }));
  } catch {
    /* noop */
  }
};

const isAuthed = () => {
  try {
    const { getUser } = require("../utils/auth");
    const u = getUser();
    return Boolean(u && u.email && u.email !== "nouser");
  } catch {
    return false;
  }
};

const getScope = () => {
  try {
    const { getActiveStoreContext, getUser } = require("../utils/auth");
    const active = getActiveStoreContext();
    const user = getUser();
    return {
      storeType: active?.storeType || user?.storeType || "",
      storeId: active?.storeId || user?.storeId || user?.storeType || "",
    };
  } catch {
    return { storeType: "", storeId: "" };
  }
};

const buildParams = (extra = {}) => {
  const { storeType, storeId } = getScope();
  const params = { ...extra };
  if (storeType) params.storeType = storeType;
  if (storeId) params.storeId = storeId;
  return params;
};

// Super Owner only — list every hotel customer's lock state.
export const getAllHotelLocks = async () => {
  if (!isAuthed()) return [];
  return apiGet(ENDPOINT_ALL, buildParams());
};

// Any signed-in user — returns their own customer's lock state.
// Non-hotel users and the Super Owner in system mode get
// `{lodging: false, dining: false}`.
export const getMyHotelLocks = async () => {
  if (!isAuthed()) return { lodging: false, dining: false };
  return apiGet(ENDPOINT_ME, buildParams());
};

// Super Owner only — flip one customer's lock toggle.
export const setHotelLock = async (customerEmail, module, locked) => {
  if (!isAuthed()) throw new Error("Not signed in");
  if (!customerEmail) throw new Error("customerEmail is required");
  if (module !== "lodging" && module !== "dining" && module !== "liveBill") {
    throw new Error('module must be "lodging", "dining", or "liveBill"');
  }
  const updated = await apiPut(
    `${ENDPOINT_ALL}/${encodeURIComponent(String(customerEmail).toLowerCase())}/${encodeURIComponent(module)}`,
    { locked: !!locked },
    buildParams()
  );
  fireChanged({ customerEmail, module, locked: !!locked });
  return updated;
};
