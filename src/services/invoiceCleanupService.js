// Frontend service for the admin invoice-cleanup workflow.
//
// Wraps the two endpoints that together are the ONLY sanctioned way to
// permanently delete an invoice:
//
//   POST /api/invoice-cleanup/preview  — read-only analysis
//   POST /api/invoice-cleanup/execute  — permanent deletion
//
// The generic `DELETE /api/invoices/:id` path is refused server-side (409), so
// there is deliberately no delete helper here.
//
// Both calls carry the active store scope, which the server resolves through
// getRequestScope — a STORE_ADMIN or CASHIER is pinned to their own store and
// cannot widen it. CASHIER is rejected outright by the server.
//
// executeCleanup requires an explicit confirmation string built from the
// PREVIEW's eligible count. The server recomputes that number and rejects a
// mismatch, so the phrase is a deliberate operator acknowledgement rather than
// something the client can assert its way past.

import { apiPost } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

const isAuthed = () => {
  const user = getUser();
  return Boolean(user && user.email && user.email !== "nouser");
};

// CASHIER has no cleanup access at any point. Hiding the UI is not the
// security boundary — the server refuses these routes too — but there is no
// reason to let a cashier open a panel that can only ever 403.
export const canRunInvoiceCleanup = () => {
  const user = getUser();
  const role = String(user?.role || "").toUpperCase();
  return ["SUPER_OWNER", "ADMIN", "STORE_ADMIN"].includes(role);
};

// The phrase the operator must type. Exported so the UI and the confirmation
// prompt cannot drift apart — both derive it from the same eligible count.
export const buildConfirmationPhrase = (eligibleCount) =>
  `DELETE ${Number(eligibleCount || 0)} INVOICES`;

const getScope = () => {
  const user = getUser();
  const active = getActiveStoreContext();
  return {
    storeType: active?.storeType || user?.storeType || "nostore",
    storeId: active?.storeId || user?.storeId || null,
  };
};

// Preview: strictly read-only. Never deletes, never mutates.
export const previewInvoiceCleanup = async (retentionYears) => {
  if (!isAuthed()) throw new Error("Not signed in");
  if (!canRunInvoiceCleanup()) throw new Error("Invoice cleanup is restricted to admin roles");
  return apiPost("/api/invoice-cleanup/preview", { retentionYears }, getScope());
};

// Execute: permanent. The server re-runs the dependency check inside the delete
// transaction, so anything that gained a dependency since preview is skipped
// rather than deleted.
export const executeInvoiceCleanup = async ({ retentionYears, eligibleCount }) => {
  if (!isAuthed()) throw new Error("Not signed in");
  if (!canRunInvoiceCleanup()) throw new Error("Invoice cleanup is restricted to admin roles");
  return apiPost(
    "/api/invoice-cleanup/execute",
    { retentionYears, confirmation: buildConfirmationPhrase(eligibleCount) },
    getScope()
  );
};

// Retention lives in store_settings.payload under a namespaced key, so it is
// saved through the existing settings endpoint and inherits its per-store
// scoping. The key is prefixed so the generic settings sanitizer — which
// ignores keys beginning `store-settings:` — leaves it alone.
export const RETENTION_SETTING_KEY = "store-settings:invoiceRetention";

export const readRetentionConfig = (settings) => {
  const raw = settings?.[RETENTION_SETTING_KEY];
  const years = Number(raw?.retentionYears);
  return {
    retentionYears: Number.isInteger(years) && years > 0 ? years : 3,
  };
};
