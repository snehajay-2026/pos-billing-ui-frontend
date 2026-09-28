import { apiGet } from "./api";

// dashboardService — the mobile Manager Dashboard's single data call.
//
// `GET /api/dashboard/summary` returns the whole screen in one aggregated,
// server-side response. Composing the existing per-resource endpoints instead
// would mean ~8 round-trips on a mobile network, and `/api/invoices` in
// full-list mode ships every line item of every invoice to the browser.
//
// Store scope: `api.js`'s `getScopedParams` already attaches storeType/storeId
// for a store-bound user. That is harmless and intentional — the server derives
// the authorized scope from the session and ignores those params for anyone but
// a SUPER_OWNER, who uses them to narrow deliberately. Never pass a store scope
// here expecting it to grant access; it cannot.
//
// `from` / `to` are inclusive `YYYY-MM-DD` strings produced by `toApiRange` in
// utils/dateRange. Omit them for an unbounded period.

const stripEmpty = (params) => {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
};

export const getDashboardSummary = async (filters = {}) =>
  apiGet("/api/dashboard/summary", stripEmpty(filters));

export default { getDashboardSummary };
