import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

// Same auth guard as productService: skip protected calls when no user
// is signed in, so the cold-boot dashboard doesn't fire 401s.
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

export const getOrders = async (type) => {
  if (!isAuthed()) return [];
  const { storeType, email } = getUserMeta();
  return apiGet("/api/orders", { storeType, email, type });
};

export const createOrder = async (order) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, email } = getUserMeta();
  return apiPost("/api/orders", order, { storeType, email });
};

export const updateOrder = async (order) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, email } = getUserMeta();
  return apiPut(`/api/orders/${order.id}`, order, { storeType, email });
};

export const deleteOrder = async (orderId) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, email } = getUserMeta();
  return apiDelete(`/api/orders/${orderId}`, null, { storeType, email });
};

// F1: convert a service order into an invoice. Backend endpoint
// POST /api/orders/:id/invoice atomically creates the invoice row and
// flips the order's status to 'invoiced' + stamps invoice_no back-link.
// Throws with err.status + err.body so callers can branch on:
//   - 409 ORDER_ALREADY_INVOICED  → already billed (existing bill id in body.invoiceNo)
//   - 409 NO_ACTIVE_SHIFT         → cashier needs to open a shift first
//   - 404                         → order vanished from scope (rare)
// `paymentMode` is required (Cash/UPI/Card/Bank Transfer). `gstRate` and
// `customerEmail`/`customerAddress`/`customerGst`/`customerState` are
// optional overrides — the order already pinned the customer identity
// at intake, so the invoice mirrors whatever the order stored unless
// the cashier fills in extras here.
export const createInvoiceFromOrder = async (
  orderId,
  { paymentMode, gstRate, remarks, customerEmail, customerAddress, customerGst, customerState }
) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, email } = getUserMeta();
  const body = {
    paymentMode: String(paymentMode || "").trim(),
    ...(gstRate !== "" && gstRate != null ? { gstRate: Number(gstRate) } : {}),
    ...(remarks ? { remarks: String(remarks) } : {}),
    ...(customerEmail ? { customerEmail: String(customerEmail) } : {}),
    ...(customerAddress ? { customerAddress: String(customerAddress) } : {}),
    ...(customerGst ? { customerGst: String(customerGst) } : {}),
    ...(customerState ? { customerState: String(customerState) } : {}),
  };
  return apiPost(`/api/orders/${orderId}/invoice`, body, { storeType, email });
};
