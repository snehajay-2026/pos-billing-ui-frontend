import { apiGet, apiPost, apiPut } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

// Same auth guard as productService/orderService: skip protected calls
// when no user is signed in, so the cold-boot dashboard doesn't fire 401s.
const isAuthed = () => {
  const user = getUser();
  return Boolean(user && user.email && user.email !== "nouser");
};

const getUserMeta = () => {
  const active = getActiveStoreContext();
  const user = getUser();
  return {
    storeType: active?.storeType || user?.storeType || "nostore",
    email: user?.email || "nouser",
  };
};

export const saveInvoice = async (invoice) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, email } = getUserMeta();
  const saved = await apiPost("/api/invoices", invoice, { storeType, email });
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "invoices" }));
  return saved;
};

// Server-authoritative checkout: validates and decrements stock atomically,
// then saves the invoice. Returns { invoice, updatedStock } — callers should
// merge updatedStock into their local products state and re-render. A 409
// response carries { available, requested, productId, productName } so the
// UI can show "insufficient stock" precisely.
export const checkoutInvoice = async (invoice) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, email } = getUserMeta();
  const result = await apiPost("/api/invoices/checkout", invoice, { storeType, email });
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "invoices" }));
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "products" }));
  return result;
};

export const getInvoices = async () => {
  if (!isAuthed()) return [];
  const { storeType, email } = getUserMeta();
  return apiGet("/api/invoices", { storeType, email });
};

export const getInvoiceByNo = async (invoiceNo) => {
  if (!invoiceNo) return undefined;
  if (!isAuthed()) return undefined;
  const { storeType, email } = getUserMeta();
  return apiGet(`/api/invoices/${encodeURIComponent(invoiceNo)}`, { storeType, email });
};

// Public counterpart of getInvoiceByNo: no auth check, no scope params.
// Used by the WhatsApp/Email share link so a customer can open the
// invoice URL without logging in. Returns `{ invoice, store }` where
// `invoice` is sanitized (no internal scoping, no cashier email, no
// items[].meta) and `store` is the store-settings payload the thermal
// renderers need.
export const getPublicInvoiceByNo = async (invoiceNo) => {
  if (!invoiceNo) return undefined;
  return apiGet(`/api/public/invoices/${encodeURIComponent(invoiceNo)}`);
};

export const updateInvoice = async (invoiceNo, patch) => {
  if (!invoiceNo) throw new Error("invoiceNo is required");
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, email } = getUserMeta();
  const updated = await apiPut(`/api/invoices/${encodeURIComponent(invoiceNo)}`, patch, {
    storeType,
    email,
  });
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "invoices" }));
  return updated;
};
