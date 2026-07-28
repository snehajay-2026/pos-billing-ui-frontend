const getCurrentUser = () => {
  return typeof window !== "undefined" ? window.__CURRENT_USER__ || null : null;
};

const ACTIVE_STORE_KEY_PREFIX = "pos_active_store_context";

const getActiveStoreStorageKey = (email = "") =>
  `${ACTIVE_STORE_KEY_PREFIX}:${String(email || "")
    .trim()
    .toLowerCase()}`;

const normalizeActiveStoreContext = (store) => {
  const storeType = String(store?.storeType || "").trim();
  const storeId = String(store?.storeId || "").trim();
  if (!storeType && !storeId) {
    return null;
  }
  return { storeType, storeId };
};

const readActiveStoreContext = (email) => {
  if (typeof window === "undefined" || !email) return null;
  try {
    const raw = window.localStorage.getItem(getActiveStoreStorageKey(email));
    if (!raw) return null;
    return normalizeActiveStoreContext(JSON.parse(raw));
  } catch {
    return null;
  }
};

const resolveUserWithActiveStore = (user) => {
  if (!user || user.role !== "SUPER_OWNER") {
    return user;
  }

  const activeStore = readActiveStoreContext(user.email);
  if (!activeStore) {
    return user;
  }

  return {
    ...user,
    storeType: activeStore.storeType || user.storeType,
    storeId: activeStore.storeId || user.storeId,
  };
};

export const loginUser = (user) => {
  if (typeof window !== "undefined") {
    window.__CURRENT_USER__ = user;
    window.dispatchEvent(
      new CustomEvent("authChanged", { detail: resolveUserWithActiveStore(user) })
    );
  }
  return user;
};

export const getUser = () => {
  try {
    return resolveUserWithActiveStore(getCurrentUser());
  } catch {
    return null;
  }
};

export const updateUser = (updates) => {
  const currentUser = getCurrentUser();
  if (!currentUser) return null;

  const nextUser = { ...currentUser, ...updates };
  if (typeof window !== "undefined") {
    window.__CURRENT_USER__ = nextUser;
    window.dispatchEvent(
      new CustomEvent("authChanged", { detail: resolveUserWithActiveStore(nextUser) })
    );
  }
  return nextUser;
};

export const getUserRole = () => {
  const u = getCurrentUser();
  return u ? u.role : null;
};

export const getUserStoreType = () => {
  const u = getUser();
  return u ? u.storeType : null;
};

export const getUserStoreId = () => {
  const u = getUser();
  return u ? u.storeId : null;
};

export const getActiveStoreContext = () => {
  const user = getCurrentUser();
  if (!user || user.role !== "SUPER_OWNER") {
    return null;
  }
  return readActiveStoreContext(user.email);
};

export const setActiveStoreContext = (store) => {
  const user = getCurrentUser();
  if (!user || user.role !== "SUPER_OWNER" || typeof window === "undefined") {
    return null;
  }

  const storageKey = getActiveStoreStorageKey(user.email);
  const normalizedStore = normalizeActiveStoreContext(store);

  if (!normalizedStore) {
    window.localStorage.removeItem(storageKey);
  } else {
    window.localStorage.setItem(storageKey, JSON.stringify(normalizedStore));
  }

  // Clear known per-store local caches to prevent cross-store leakage
  try {
    const clearStoreLocalCache = (storeCtx) => {
      const keysToClear = [
        "hotel_table_booking_state",
        "hotel_dining_waiting_list",
        "hotel_lodging_waiting_list",
        "hotel_lodging_rooms",
        "hotel_lodging_checkout_history",
        "hotel_shared_items",
        "laundry_products_cache",
        "product_list_cache",
        "store_settings_cache",
      ];
      keysToClear.forEach((k) => {
        try {
          window.localStorage.removeItem(k);
        } catch (e) {}
      });
    };
    clearStoreLocalCache(normalizedStore);
  } catch (e) {
    // ignore
  }

  const resolvedUser = resolveUserWithActiveStore(user);
  window.dispatchEvent(new CustomEvent("authChanged", { detail: resolvedUser }));
  window.dispatchEvent(new CustomEvent("activeStoreChanged", { detail: normalizedStore }));
  return normalizedStore;
};

export const isAdminRole = () => {
  const role = getUserRole();
  return ["SUPER_OWNER", "STORE_ADMIN", "ADMIN"].includes(role);
};

export const logout = () => {
  if (typeof window !== "undefined") {
    window.__CURRENT_USER__ = null;
    window.dispatchEvent(new CustomEvent("authChanged", { detail: null }));
    window.location.href = "/login";
  }
};
