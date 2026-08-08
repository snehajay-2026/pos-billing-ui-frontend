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
      if (kind !== "invoice" && kind !== "stock" && kind !== "booking") return;

      // Sound: only when tab is visible AND the event came from another
      // user (the SSE server includes `actor` for invoice events; booking
      // events also include `createdBy`). Falls back to "play anyway" when
      // no actor info is present, since the server still scopes events
      // per-store and this user is one of many.
      const isVisible = typeof document === "undefined" || !document.hidden;
      if (isVisible) {
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

      // Invoice checkout elsewhere in the store → let every page that
      // listens for "dataUpdated" refresh its own copy.
      if (kind === "invoice") {
        try {
          window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "invoices" }));
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

      // Pull fresh products so the bell badge updates without a 60s wait.
      refresh();
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
