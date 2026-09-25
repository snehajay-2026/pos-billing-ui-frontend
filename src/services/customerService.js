import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

const getUserMeta = () => {
  const active = getActiveStoreContext();
  const user = getUser();
  return {
    storeType: active?.storeType || user?.storeType || "nostore",
    email: user?.email || "nouser",
  };
};

export const getCreditCustomers = async () => {
  const { storeType, email } = getUserMeta();
  return apiGet("/api/customer-credits", { storeType, email });
};

export const saveCreditCustomer = async (customer) => {
  const { storeType, email } = getUserMeta();
  const nextCustomer = await apiPost("/api/customer-credits", customer, { storeType, email });
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "customerCredits" }));
  return nextCustomer;
};

export const updateCreditCustomer = async (customer) => {
  const { storeType, email } = getUserMeta();
  const updated = await apiPut(`/api/customer-credits/${customer.id}`, customer, {
    storeType,
    email,
  });
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "customerCredits" }));
  return updated;
};

export const deleteCreditCustomer = async (customerId) => {
  const { storeType, email } = getUserMeta();
  await apiDelete(`/api/customer-credits/${customerId}`, null, { storeType, email });
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "customerCredits" }));
  return customerId;
};

export const addCreditPayment = async (customerId, paymentAmount) => {
  const { storeType, email } = getUserMeta();
  const updated = await apiPut(
    `/api/customer-credits/${customerId}`,
    { amount: paymentAmount },
    { storeType, email }
  );
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "customerCredits" }));
  return updated;
};

// ============================================================================
// Customer entity (slice E): persistent customer records with POS attach.
// Customers live in server/data/customers.json and are auto-routed via the
// generic /api/:resource handlers in the server (see server/index.js
// resourceFiles). Scope fields (_storeType/_storeId/_userEmail) are set
// automatically on POST by getRequestScope.
//
// Search uses server-side filterByQuery which is exact-equality — pass full
// substrings (e.g. last 4 digits of a phone) rather than wildcards.
// ============================================================================

export const getCustomers = async () => apiGet("/api/customers");

export const createCustomer = async (customer) => apiPost("/api/customers", customer);

export const updateCustomer = async (id, customer) =>
  apiPut(`/api/customers/${encodeURIComponent(id)}`, customer);

export const deleteCustomer = async (id) => apiDelete(`/api/customers/${encodeURIComponent(id)}`);

export const searchCustomers = async ({ name, phone } = {}) => {
  const params = {};
  if (name) params.name = name;
  if (phone) params.phone = phone;
  return apiGet("/api/customers", params);
};

// Approve or reject a pending customer. The backend route lives at
// POST /api/customers/:id/approve (placed before the generic
// /api/:resource/:id route so it isn't shadowed). Status must be either
// "approved" or "rejected"; rejected requires a non-empty reason. On
// success we dispatch a window event so all CustomerManagement tabs and
// the POS customer-search dropdown refresh without waiting for SSE.
export const approveCustomer = async (id, { status, reason } = {}) => {
  const updated = await apiPost(`/api/customers/${encodeURIComponent(id)}/approve`, {
    status,
    reason: reason || "",
  });
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "customers" }));
  return updated;
};

// ============================================================================
// Purchase history (Phase 2A — read-only)
//
// Derived server-side from the `invoices` ledger. There is no history table
// to keep in sync, and no client-side sorting: the backend already returns
// `generated_at DESC, id DESC` and this layer passes the rows through in the
// order received. Re-sorting or reversing here is the exact bug fixed in
// commit 132dfd8 and must not be reintroduced.
//
// Both endpoints resolve the customer through the caller's authorized store
// server-side, so a cross-store customer id returns 404 rather than data.
// ============================================================================

export const getCustomerPurchaseHistory = async (id, { page = 1, pageSize = 10 } = {}) => {
  if (!id) return { items: [], pagination: { page: 1, pageSize, total: 0, totalPages: 1 } };
  return apiGet(`/api/customers/${encodeURIComponent(id)}/purchase-history`, { page, pageSize });
};

export const getCustomerSummary = async (id) => {
  if (!id) return null;
  return apiGet(`/api/customers/${encodeURIComponent(id)}/summary`);
};
