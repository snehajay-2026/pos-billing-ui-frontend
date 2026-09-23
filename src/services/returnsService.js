// Frontend service for the Retail Returns / Refunds / Exchanges surface.
//
// Wraps the three /api/returns endpoints:
//   GET    /api/returns[?invoiceNo=…] — list returns for the active store
//   GET    /api/returns/:id           — full return + items
//   POST   /api/returns              — submit a return / refund / exchange
//
// Scope handling matches the rest of the UI: getScope() reads the active
// store context from localStorage so a Super Owner who switched into a
// retail store sends the right storeType/storeId on every call. The
// backend's requireRetailScope guard rejects anything non-retail with
// 403 so a stray submission can never reach a Hotel/Laundry/Service
// invoice.
//
// All errors propagate to the caller with the API's status + code
// preserved, so the UI can surface precise messages (e.g. "Only X
// left of this product — already returned Y") instead of a generic
// "Failed".

import { apiGet, apiPost } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

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

// GET /api/returns — full list. Supports optional filters.
export const getReturns = async (filters = {}) => {
  if (!isAuthed()) return [];
  const params = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && v !== "") params[k] = v;
  }
  return apiGet("/api/returns", { ...params, ...getScope() });
};

// GET /api/returns?invoiceNo=… — history against a single invoice.
// Used by the invoice preview page's "Returns" panel.
export const getReturnsByInvoice = async (invoiceNo) => {
  if (!isAuthed() || !invoiceNo) return [];
  return apiGet("/api/returns", { invoiceNo, ...getScope() });
};

// GET /api/returns/:id — full return + items.
export const getReturn = async (id) => {
  if (!isAuthed()) return null;
  return apiGet(`/api/returns/${id}`, getScope());
};

// POST /api/returns — submit a return / refund / exchange.
//
// `payload` mirrors the server's contract:
//   {
//     invoiceNo, type ('return'|'refund'|'exchange'|'cancel'),
//     scope ('full'|'partial'), refundMethod, reason,
//     replacementInvoiceNo, priceDifference,
//     items: [{ productId, qty or qtyKg, condition, unitPrice, lineDiscount, lineGst }],
//   }
//
// The server validates everything (including over-return + missing
// productId + bad condition), so this helper does no normalization
// — just a straight POST.
export const createReturn = async (payload) => {
  if (!isAuthed()) throw new Error("Not signed in");
  return apiPost("/api/returns", payload, getScope());
};
