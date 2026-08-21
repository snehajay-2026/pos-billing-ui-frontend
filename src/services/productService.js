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

// === Image upload (Upload Picture) =========================================
//
// `file` must be a real File / Blob. Returns the updated product row from
// the backend. Validation lives in both places: the backend re-validates
// MIME + size so a tampered client can't sneak through.
export const uploadProductImage = async (id, file) => {
  if (!isAuthed()) throw new Error("Not signed in");
  if (!id) throw new Error("Product id required");
  if (!file) throw new Error("Image file required");
  const { storeType, email } = getUserMeta();
  const form = new FormData();
  form.append("image", file);
  // CSRF: read the live cookie so the header matches what the backend
  // compares against. Multipart requests must NOT set Content-Type
  // (browsers add the multipart boundary automatically).
  const csrfMatch =
    typeof document !== "undefined" ? document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/) : null;
  const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : null;
  const headers = { Accept: "application/json" };
  if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  const params = new URLSearchParams();
  if (storeType) params.set("storeType", storeType);
  if (email) params.set("email", email);
  const qs = params.toString();
  const urlBase =
    (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) || "";
  const url = `${urlBase}/api/products/${id}/image${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers,
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    const err = new Error(body.error || body.message || `Image upload failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return JSON.parse(text || "null");
};

export const deleteProductImage = async (id) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, email } = getUserMeta();
  return apiDelete(`/api/products/${id}/image`, null, { storeType, email });
};
