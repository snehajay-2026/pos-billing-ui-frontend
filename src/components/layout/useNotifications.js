import { useMemo } from "react";
import { useDataContext } from "../../context/DataContext";
import { getUserStoreType } from "../../utils/auth";
import { isLaundryConsumable, stockStatus } from "../laundry/laundryConsumables";

// Each store type has its own canonical list page for orders and inventory.
// Centralizing the mapping here keeps the bell's deep-links in sync with the
// routes defined in App.js.
const ROUTES_BY_STORE = {
  laundry: { orders: "/laundry-orders", stock: "/laundry-inventory" },
  service: { orders: "/service-orders", stock: "/inventory" },
  "msme-service": { orders: "/service-orders", stock: "/inventory" },
  hotel: { orders: "/hotel-tables", stock: "/inventory" },
  inventory: { orders: "/invoices", stock: "/inventory" },
  retail: { orders: "/invoices", stock: "/inventory" },
};

const routesForStoreType = (storeType) =>
  ROUTES_BY_STORE[storeType] || { orders: "/pos", stock: "/inventory" };

// Map order.status → friendly label used in notification copy.
const READY_STATUSES = new Set(["ready", "ready_for_pickup", "completed"]);
const IN_PROGRESS_STATUSES = new Set(["in_process", "in_progress", "processing"]);
const PENDING_STATUSES = new Set(["pending", "received", "new"]);

const bucketOrder = (status) => {
  const value = String(status || "").toLowerCase();
  if (READY_STATUSES.has(value)) return "ready";
  if (IN_PROGRESS_STATUSES.has(value)) return "inProgress";
  if (PENDING_STATUSES.has(value)) return "pending";
  return "open";
};

// Pure function — easy to unit-test if we ever add tests for the bell.
export const deriveNotifications = (orders, products, storeType) => {
  const safeOrders = Array.isArray(orders) ? orders : [];
  const safeProducts = Array.isArray(products) ? products : [];
  const routes = routesForStoreType(storeType);

  const ordersByStatus = safeOrders.reduce((acc, order) => {
    const status = String(order.status || "").toLowerCase();
    if (status === "delivered" || status === "cancelled" || status === "completed") return acc;
    const bucket = bucketOrder(order.status);
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});

  const orderNotifications = [];
  if (ordersByStatus.pending) {
    orderNotifications.push({
      kind: "orders-pending",
      title: `${ordersByStatus.pending} order${ordersByStatus.pending === 1 ? "" : "s"} awaiting pickup`,
      detail: "New drop-offs that haven't started yet.",
      href: routes.orders,
      tone: "amber",
    });
  }
  if (ordersByStatus.inProgress) {
    orderNotifications.push({
      kind: "orders-in-progress",
      title: `${ordersByStatus.inProgress} order${ordersByStatus.inProgress === 1 ? "" : "s"} in progress`,
      detail: "Items currently being processed.",
      href: routes.orders,
      tone: "blue",
    });
  }
  if (ordersByStatus.ready) {
    orderNotifications.push({
      kind: "orders-ready",
      title: `${ordersByStatus.ready} order${ordersByStatus.ready === 1 ? "" : "s"} ready`,
      detail: "Ready for delivery or pickup.",
      href: routes.orders,
      tone: "emerald",
    });
  }
  if (ordersByStatus.open) {
    orderNotifications.push({
      kind: "orders-open",
      title: `${ordersByStatus.open} open order${ordersByStatus.open === 1 ? "" : "s"}`,
      detail: "Active orders that need attention.",
      href: routes.orders,
      tone: "blue",
    });
  }

  const stockNotifications = [];
  let lowCount = 0;
  let outCount = 0;
  const lowSamples = [];
  const outSamples = [];

  for (const product of safeProducts) {
    const qty = Number(product.stockQty);
    const threshold = Number(product.lowStockThreshold);
    const isConsumable = storeType === "laundry" && isLaundryConsumable(product);
    const status = isConsumable
      ? stockStatus(product)
      : Number.isFinite(qty) && Number.isFinite(threshold) && threshold > 0 && qty <= threshold
        ? { key: "low", label: "Low stock" }
        : Number.isFinite(qty) && qty <= 0
          ? { key: "out", label: "Out of stock" }
          : null;
    if (!status) continue;
    if (status.key === "out") {
      outCount += 1;
      if (outSamples.length < 3) outSamples.push(product.name || "Item");
    } else if (status.key === "low") {
      lowCount += 1;
      if (lowSamples.length < 3) lowSamples.push(product.name || "Item");
    }
  }

  if (outCount > 0) {
    stockNotifications.push({
      kind: "stock-out",
      title: `${outCount} item${outCount === 1 ? "" : "s"} out of stock`,
      detail: outSamples.join(", ") + (outCount > outSamples.length ? "…" : ""),
      href: routes.stock,
      tone: "rose",
    });
  }
  if (lowCount > 0) {
    stockNotifications.push({
      kind: "stock-low",
      title: `${lowCount} item${lowCount === 1 ? "" : "s"} low on stock`,
      detail: lowSamples.join(", ") + (lowCount > lowSamples.length ? "…" : ""),
      href: routes.stock,
      tone: "amber",
    });
  }

  return [...orderNotifications, ...stockNotifications];
};

// Pure derived hook. No fetching — all data flows in through DataContext.
export const useNotifications = () => {
  const { products, orders, loading, error, refresh, lastFetchedAt } = useDataContext();
  const storeType = getUserStoreType();
  const notifications = useMemo(
    () => deriveNotifications(orders, products, storeType),
    [orders, products, storeType]
  );

  return {
    notifications,
    loading,
    error,
    refresh,
    lastFetchedAt,
  };
};
