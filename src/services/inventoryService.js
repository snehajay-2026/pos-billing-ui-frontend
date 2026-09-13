import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";
import { getProducts } from "./productService";
import { getServices } from "./serviceService";
import { normalizePurchaseOrderPayload } from "../utils/inventoryPo";

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

export const getPurchaseOrderCatalog = async () => {
  if (!isAuthed()) return { items: [], catalogType: "product", loadingSource: "none" };
  const { storeType } = getScope();
  if (storeType === "service" || storeType === "msme-service") {
    const services = await getServices();
    return {
      catalogType: "service",
      loadingSource: "services",
      items: (Array.isArray(services) ? services : []).map((service) => ({
        ...service,
        id: service.id,
        name: service.name || "",
        price: Number(service.price ?? service.rate ?? 0),
        gst: Number(service.gst || 0),
        unit: service.unit || "unit",
        catalogType: "service",
      })),
    };
  }
  const products = await getProducts();
  return {
    catalogType: "product",
    loadingSource: "products",
    items: (Array.isArray(products) ? products : []).map((product) => ({
      ...product,
      catalogType: "product",
    })),
  };
};

export const getSuppliers = async () => {
  if (!isAuthed()) return [];
  return apiGet("/api/suppliers", getScope());
};
export const createSupplier = (supplier) => {
  if (!isAuthed()) throw new Error("Not signed in");
  return apiPost("/api/suppliers", supplier, getScope());
};
export const updateSupplier = (id, supplier) => {
  if (!isAuthed()) throw new Error("Not signed in");
  return apiPut(`/api/suppliers/${id}`, supplier, getScope());
};
export const deleteSupplier = (id) => {
  if (!isAuthed()) throw new Error("Not signed in");
  return apiDelete(`/api/suppliers/${id}`, null, getScope());
};

export const getPurchaseOrders = async (filters = {}) => {
  if (!isAuthed()) return [];
  return apiGet("/api/purchase-orders", { ...filters, ...getScope() });
};
export const createPurchaseOrder = (po) => {
  if (!isAuthed()) throw new Error("Not signed in");
  return apiPost("/api/purchase-orders", normalizePurchaseOrderPayload(po), getScope());
};
export const updatePurchaseOrder = (id, patch) => {
  if (!isAuthed()) throw new Error("Not signed in");
  return apiPut(
    `/api/purchase-orders/${id}`,
    normalizePurchaseOrderPayload({ ...patch, id }),
    getScope()
  );
};
export const deletePurchaseOrder = (id) => {
  if (!isAuthed()) throw new Error("Not signed in");
  return apiDelete(`/api/purchase-orders/${id}`, null, getScope());
};
export const receivePurchaseOrder = (id) => {
  if (!isAuthed()) throw new Error("Not signed in");
  return apiPost(`/api/purchase-orders/${id}/receive`, {}, getScope());
};

export const getStockMovements = async (filters = {}) => {
  if (!isAuthed()) return [];
  return apiGet("/api/stock-movements", { ...filters, ...getScope() });
};
export const createStockMovement = (movement) => {
  if (!isAuthed()) throw new Error("Not signed in");
  return apiPost("/api/stock-movements", movement, getScope());
};

export const getLowStockAlerts = async () => {
  if (!isAuthed()) return [];
  return apiGet("/api/inventory/low-stock", getScope());
};
