import { apiGet } from "./api";

/**
 * reportService — calls /api/reports/* and /api/reports/export.
 *
 * All endpoints are admin-only on the server (returns 403 to CASHIER).
 *
 * Sales response shape:
 *   { from, to, scope, totals, buckets, byType, byPayment }
 *
 * GST response shape:
 *   { from, to, scope, totals, b2cs[], hsn[], notes }
 *
 * P&L response shape:
 *   { from, to, scope, totals, monthly[], expensesByCategory[], cogsByCategory[]|null, cogsAvailable, note }
 */

const buildParams = (extra = {}) => {
  const params = { ...extra };
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") delete params[k];
  }
  return params;
};

export const getSalesReport = (filters = {}) => apiGet("/api/reports/sales", buildParams(filters));

export const getGstReport = (filters = {}) => apiGet("/api/reports/gst", buildParams(filters));

export const getPnlReport = (filters = {}) => apiGet("/api/reports/pnl", buildParams(filters));

// Trigger a CSV download for one of the three report types. The browser
// saves the file with the suggested filename via the Content-Disposition
// header. The fetch is made plain (no credentials: include handled by api).
export const exportReportUrl = (type, filters = {}) => {
  const params = new URLSearchParams({ type, ...buildParams(filters) });
  const apiBase =
    process.env.REACT_APP_API_BASE?.trim() ||
    (process.env.NODE_ENV === "development" ? "http://localhost:4000" : "");
  return `${apiBase}/api/reports/export?${params.toString()}`;
};
