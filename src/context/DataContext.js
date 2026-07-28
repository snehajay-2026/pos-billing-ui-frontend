import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getOrders } from "../services/orderService";
import { getProducts } from "../services/productService";
import { getUser } from "../utils/auth";

// True when the user is signed in. We don't fetch products/orders for an
// anonymous visitor — every call would 401 and just spam the console.
const useIsAuthenticated = () => {
  const [isAuthed, setIsAuthed] = useState(() => Boolean(getUser()));
  useEffect(() => {
    const sync = () => setIsAuthed(Boolean(getUser()));
    window.addEventListener("authChanged", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("authChanged", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return isAuthed;
};

// Shared cache for the two data sources the bell + global search both need.
// Without this, the header search and the notification panel each issued their
// own /api/products + /api/orders requests on mount and on every 60s poll —
// doubling the load for the same data.
//
// Scope: products + orders only. Invoices aren't currently used by either
// consumer. Add new fetches here when a third consumer appears; don't fan
// out fetches in individual hooks if you can avoid it.

const DataContext = createContext(null);

const REFRESH_INTERVAL_MS = 60_000;

export const DataProvider = ({ children }) => {
  const isAuthenticated = useIsAuthenticated();
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    try {
      const [productResult, orderResult] = await Promise.allSettled([getProducts(), getOrders()]);

      // A 401 here just means the user isn't signed in (or their session
      // expired). Quietly treat that as "no data yet" rather than logging.
      const isAuthFailure = (result) =>
        result.status === "rejected" && /401|Unauthorized/i.test(String(result.reason?.message));

      const failedSources = [];
      let nextProducts = products;
      let nextOrders = orders;
      if (productResult.status === "fulfilled") {
        nextProducts = Array.isArray(productResult.value) ? productResult.value : [];
      } else if (!isAuthFailure(productResult)) {
        failedSources.push("products");
        console.warn("DataContext: getProducts failed", productResult.reason);
      }
      if (orderResult.status === "fulfilled") {
        nextOrders = Array.isArray(orderResult.value) ? orderResult.value : [];
      } else if (!isAuthFailure(orderResult)) {
        failedSources.push("orders");
        console.warn("DataContext: getOrders failed", orderResult.reason);
      }

      setProducts(nextProducts);
      setOrders(nextOrders);
      setError(failedSources.length ? `Couldn't load: ${failedSources.join(", ")}` : null);
      setLastFetchedAt(new Date());
    } finally {
      setLoading(false);
      inFlightRef.current = false;
    }
    // We intentionally don't depend on `products` / `orders` here — that would
    // cause an infinite refetch loop. The functional setters below are not
    // available here because we want to compare failure paths.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial fetch + 60s polling while the tab is visible.
  useEffect(() => {
    if (!isAuthenticated) {
      // User isn't signed in — clear any stale data and don't bother the API.
      setProducts([]);
      setOrders([]);
      setError(null);
      setLoading(false);
      return undefined;
    }

    refresh();

    let intervalId = null;
    const start = () => {
      if (intervalId) return;
      intervalId = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    };
    const stop = () => {
      if (intervalId) {
        window.clearInterval(intervalId);
        intervalId = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        refresh();
        start();
      }
    };

    start();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, isAuthenticated]);

  // Invalidate the cache when the active store or auth state changes.
  useEffect(() => {
    const invalidate = () => {
      setProducts([]);
      setOrders([]);
      setLastFetchedAt(null);
      refresh();
    };
    window.addEventListener("activeStoreChanged", invalidate);
    window.addEventListener("authChanged", invalidate);
    return () => {
      window.removeEventListener("activeStoreChanged", invalidate);
      window.removeEventListener("authChanged", invalidate);
    };
  }, [refresh]);

  const value = {
    products,
    orders,
    loading,
    error,
    lastFetchedAt,
    refresh,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useDataContext = () => {
  const ctx = useContext(DataContext);
  if (!ctx) {
    throw new Error("useDataContext must be used inside <DataProvider>");
  }
  return ctx;
};
