import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

/**
 * inventoryService — wrappers around /api/suppliers, /api/purchase-orders,
 * /api/stock-movements, and /api/inventory/low-stock. All endpoints are
 * admin-gated; we bail silently on read calls when no user is signed in,
 * and throw on write calls — same pattern as the other services.
 */

const isAuthed = () => {
  const user = getUser();
  return Boolean(user && user.email && user.email !== "nouser");
};

const getScope = () => {
  const user = getUser();
  const active = getActiveStoreContext();
  return {
    storeType: active?.storeType || user?.storeType || "nostore",
    storeId: active?.storeId || user?.storeId || null,
  };
};

// --- Suppliers ---
export const getSuppliers = async () => {
  if (!isAuthed()) return [];
  const { storeType, storeId } = getScope();
  return apiGet("/api/suppliers", { storeType, storeId });
};
export const createSupplier = (supplier) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost("/api/suppliers", supplier, { storeType, storeId });
};
export const updateSupplier = (id, supplier) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPut(`/api/suppliers/${id}`, supplier, { storeType, storeId });
};
export const deleteSupplier = (id) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiDelete(`/api/suppliers/${id}`, null, { storeType, storeId });
};

// --- Purchase Orders ---
export const getPurchaseOrders = async () => {
  if (!isAuthed()) return [];
  const { storeType, storeId } = getScope();
  return apiGet("/api/purchase-orders", { storeType, storeId });
};
export const createPurchaseOrder = (po) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost("/api/purchase-orders", po, { storeType, storeId });
};
export const updatePurchaseOrder = (id, patch) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPut(`/api/purchase-orders/${id}`, patch, { storeType, storeId });
};
export const deletePurchaseOrder = (id) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiDelete(`/api/purchase-orders/${id}`, null, { storeType, storeId });
};
export const receivePurchaseOrder = (id) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost(`/api/purchase-orders/${id}/receive`, {}, { storeType, storeId });
};

// --- Stock Movements ---
export const getStockMovements = async (filters = {}) => {
  if (!isAuthed()) return [];
  const { storeType, storeId } = getScope();
  return apiGet("/api/stock-movements", { ...filters, storeType, storeId });
};
export const createStockMovement = (movement) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost("/api/stock-movements", movement, { storeType, storeId });
};

// --- Derived: low-stock alerts ---
export const getLowStockAlerts = async () => {
  if (!isAuthed()) return [];
  const { storeType, storeId } = getScope();
  return apiGet("/api/inventory/low-stock", { storeType, storeId });
};
