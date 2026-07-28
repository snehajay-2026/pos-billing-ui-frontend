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
