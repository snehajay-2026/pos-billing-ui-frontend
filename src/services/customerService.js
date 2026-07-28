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
