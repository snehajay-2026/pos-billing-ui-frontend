import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

// Bail out cleanly when there's no authenticated user — without this,
// pages that load during cold boot (before the auth gate redirects to
// /login) would hit the backend, get a 401, and flood the dev console.
// Read calls return []; write calls throw with a clear message.
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
    storeId: active?.storeId || user?.storeId || null,
  };
};

export const getProducts = async () => {
  if (!isAuthed()) return [];
  const { storeType, email, storeId } = getUserMeta();
  return apiGet("/api/products", { storeType, email, storeId });
};

export const addProduct = async (product) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, email } = getUserMeta();
  return apiPost("/api/products", product, { storeType, email });
};

export const updateProduct = async (product) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, email } = getUserMeta();
  return apiPut(`/api/products/${product.id}`, product, { storeType, email });
};

export const deleteProduct = async (id) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, email } = getUserMeta();
  return apiDelete(`/api/products/${id}`, null, { storeType, email });
};
