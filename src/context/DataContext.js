import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { getOrders } from "../services/orderService";
import { getProducts } from "../services/productService";
import { getUser } from "../utils/auth";
import { onRealtimeSyncEvent } from "../services/realtimeSync";

// Window event raised when a backend write crossed the low-stock threshold.
// Carried as detail = { productName, stock, lowStock } so listeners (toasts,
// notification bell) can render without re-deriving from full product data.
const LOW_STOCK_EVENT = "low_stock_alert";

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

const getDataScopeKey = () => {
  const user = getUser();
  return JSON.stringify({
    email: user?.email || "",
    role: user?.role || "",
    storeType: user?.storeType || "",
    storeId: user?.storeId || "",
  });
};

export const DataProvider = ({ children }) => {
  const isAuthenticated = useIsAuthenticated();
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastFetchedAt, setLastFetchedAt] = useState(null);
  const productsRef = useRef(products);
  const ordersRef = useRef(orders);
  const inFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const scopeKeyRef = useRef(getDataScopeKey());
  const scopeGenerationRef = useRef(0);
  const requestGenerationRef = useRef(0);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (inFlightRef.current) {
      pendingRefreshRef.current = true;
      return;
    }

    inFlightRef.current = true;
    setLoading(true);
    const requestGeneration = ++requestGenerationRef.current;
    const scopeGeneration = scopeGenerationRef.current;
    const requestScopeKey = scopeKeyRef.current;
    try {
      const [productResult, orderResult] = await Promise.allSettled([getProducts(), getOrders()]);

      // A 401 here just means the user isn't signed in (or their session
      // expired). Quietly treat that as "no data yet" rather than logging.
      const isAuthFailure = (result) =>
        result.status === "rejected" && /401|Unauthorized/i.test(String(result.reason?.message));
      const isCurrent =
        mountedRef.current &&
        requestGeneration === requestGenerationRef.current &&
        scopeGeneration === scopeGenerationRef.current &&
        requestScopeKey === scopeKeyRef.current;

      if (isCurrent) {
        const failedSources = [];
        const nextProducts =
          productResult.status === "fulfilled"
            ? Array.isArray(productResult.value)
              ? productResult.value
              : []
            : productsRef.current;
        const nextOrders =
          orderResult.status === "fulfilled"
            ? Array.isArray(orderResult.value)
              ? orderResult.value
              : []
            : ordersRef.current;
        if (productResult.status !== "fulfilled" && !isAuthFailure(productResult)) {
          failedSources.push("products");
          console.warn("DataContext: getProducts failed", productResult.reason);
        }
        if (orderResult.status !== "fulfilled" && !isAuthFailure(orderResult)) {
          failedSources.push("orders");
          console.warn("DataContext: getOrders failed", orderResult.reason);
        }

        productsRef.current = nextProducts;
        ordersRef.current = nextOrders;
        setProducts(nextProducts);
        setOrders(nextOrders);
        setError(failedSources.length ? `Couldn't load: ${failedSources.join(", ")}` : null);
        setLastFetchedAt(new Date());
      }
    } finally {
      const isCurrentRequest =
        mountedRef.current &&
        requestGeneration === requestGenerationRef.current &&
        scopeGeneration === scopeGenerationRef.current &&
        requestScopeKey === scopeKeyRef.current;
      inFlightRef.current = false;
      if (mountedRef.current && pendingRefreshRef.current && getUser()) {
        pendingRefreshRef.current = false;
        refresh();
      } else if (isCurrentRequest && !pendingRefreshRef.current) {
        setLoading(false);
      }
    }
    // We intentionally keep this callback stable — adding products/orders
    // would cause the polling and realtime listeners to recreate and loop.
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      scopeGenerationRef.current += 1;
      requestGenerationRef.current += 1;
      pendingRefreshRef.current = false;
    };
  }, []);

  // Initial fetch + 60s polling while the tab is visible.
  useEffect(() => {
    if (!isAuthenticated) {
      // User isn't signed in — clear any stale data and don't bother the API.
      productsRef.current = [];
      ordersRef.current = [];
      pendingRefreshRef.current = false;
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
      scopeGenerationRef.current += 1;
      requestGenerationRef.current += 1;
      scopeKeyRef.current = getDataScopeKey();
      productsRef.current = [];
      ordersRef.current = [];
      setProducts([]);
      setOrders([]);
      setError(null);
      setLastFetchedAt(null);
      if (getUser()) {
        refresh();
      } else {
        pendingRefreshRef.current = false;
        setLoading(false);
      }
    };
    window.addEventListener("activeStoreChanged", invalidate);
    window.addEventListener("authChanged", invalidate);
    return () => {
      window.removeEventListener("activeStoreChanged", invalidate);
      window.removeEventListener("authChanged", invalidate);
    };
  }, [refresh]);

  // SSE bridge: refresh product/order data on any backend write that the
  // bell / dashboards care about (invoices, stock movements). Cheap because
  // refresh() is idempotent and in-flight guarded. We deliberately ignore
  // booking + hotel events here — those components refresh themselves.
  //
  // Invoice events also fire the existing `dataUpdated` window event so any
  // page listening for it (Dashboard's todaySales/cashSales/upiSales tiles,
  // InvoiceList, etc.) re-fetches without a 60s wait.
  // Booking events wake the hotel-side stats so Dashboard's
  // Sellable / In-House / Dirty / Due-Out tiles update on the next device.
  //
  // Optional sound: plays a short Web Audio beep per event for users who
  // opted in via Settings. Skipped when the tab is hidden (no point
  // beeping at someone who isn't looking) and when the event was created
  // by the same user (don't beep at yourself).
  useEffect(() => {
    const unsub = onRealtimeSyncEvent((detail) => {
      const kind = detail?.kind;
      if (
        ![
          "invoice",
          "stock",
          "booking",
          "order",
          "service",
          "customer",
          "customer_credit",
          "shift",
        ].includes(kind)
      )
        return;

      // Sound is only supported for the existing invoice/stock/booking
      // notifications. Order and service events are change notifications,
      // not audible alerts.
      const supportsSound = ["invoice", "stock", "booking"].includes(kind);
      const isVisible = typeof document === "undefined" || !document.hidden;
      if (supportsSound && isVisible) {
        try {
          const actor =
            detail?.event?.invoice?.createdBy ||
            detail?.event?.booking?.createdBy ||
            detail?.event?.actor;
          // Best-effort self-suppression: skip the sound when the acting
          // user matches the currently signed-in user. We don't have a
          // global user store here, so we read it lazily.
          const currentUser =
            typeof window !== "undefined" && window.__POS_USER__?.email
              ? window.__POS_USER__.email
              : null;
          const isSelf =
            currentUser &&
            actor &&
            String(actor).toLowerCase() === String(currentUser).toLowerCase();
          if (!isSelf) {
            const kindForSound =
              kind === "stock" && detail?.event?.crossedLowStock ? "low-stock" : kind;
            // Lazy import so the bridge doesn't pull in audio code unless
            // a sound is actually requested.
            import("../services/soundNotifier").then(({ playSound }) => {
              try {
                playSound(kindForSound);
              } catch {
                /* ignore */
              }
            });
          }
        } catch {
          /* ignore */
        }
      }

      // Low-stock breach → broadcast a window event the toast component
      // listens for. Dedupe by product id so a flood of decrements (e.g.
      // many line items on one invoice) collapses to one toast per product.
      if (kind === "stock" && detail?.event?.crossedLowStock) {
        const productId = detail?.event?.product?.id;
        const productName = detail?.event?.product?.name || "Item";
        const stock = Number(detail?.event?.product?.stock) || 0;
        const lowStock = Number(detail?.event?.product?.lowStock) || 0;
        if (!productId) return;
        try {
          window.dispatchEvent(
            new CustomEvent(LOW_STOCK_EVENT, {
              detail: { productId, productName, stock, lowStock },
            })
          );
        } catch {
          /* SSR */
        }
      }

      // Invoice checkout/status change elsewhere in the store → let every
      // page that listens for "dataUpdated" refresh its own copy.
      if (kind === "invoice") {
        try {
          window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "invoices" }));
        } catch {
          /* SSR */
        }
      }

      // Shift writes invalidate active-shift and summary reads. Consumers
      // keep their existing polling fallback and fetch authoritative data.
      if (kind === "shift") {
        try {
          window.dispatchEvent(new Event("shiftUpdated"));
        } catch {
          /* SSR */
        }
      }

      if (kind === "customer") {
        try {
          window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "customers" }));
        } catch {
          /* SSR */
        }
      }

      if (kind === "customer_credit") {
        try {
          window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "customerCredits" }));
        } catch {
          /* SSR */
        }
      }

      // Booking create/update/checkout elsewhere → notify hotel stats
      // listeners. Two events for compatibility:
      //   - `hotel_lodging_rooms_updated` is the legacy per-app event the
      //     Dashboard's loadHotelHkStats already wires up.
      //   - `dataUpdated: "hotel-rooms"` is the generic event used by other
      //     pages (e.g. HotelLodgingPage) so they also wake up.
      if (kind === "booking") {
        try {
          window.dispatchEvent(new Event("hotel_lodging_rooms_updated"));
          window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "hotel-rooms" }));
        } catch {
          /* SSR */
        }
      }

      // F2: orders + services changes elsewhere in the store → refresh the
      // orders list and the services catalog in any open tab. We dispatch
      // BOTH the generic `dataUpdated` event and the per-app event
      // (`servicesUpdated` for the catalog, `ordersUpdated` if any future
      // listener wants it) so existing polling listeners wake up
      // immediately instead of waiting for the next refresh cycle.
      if (kind === "order") {
        try {
          window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "orders" }));
        } catch {
          /* SSR */
        }
      }
      if (kind === "service") {
        try {
          window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "services" }));
          window.dispatchEvent(new CustomEvent("servicesUpdated"));
        } catch {
          /* SSR */
        }
      }

      // Pull fresh products/orders so the shared cache updates without a
      // 60s wait. Service, shift, customer, and credit events have their own
      // consumers and do not belong in this cache.
      if (!["service", "shift", "customer", "customer_credit"].includes(kind)) refresh();
    });
    return unsub;
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

// Re-export so the toast bridge can import the event name from one place.
export { LOW_STOCK_EVENT };
