import { apiGet } from "./api";

/**
 * auditLogService — thin wrapper around GET /api/audit-log.
 *
 * The endpoint is read-only (append-only on the server). Filters are
 * passed as URL query params and the backend does the scoping/sorting.
 *
 * Response shape (from server):
 *   { rows: AuditEntry[], total: number, limit: number, offset: number }
 *
 * An AuditEntry is:
 *   {
 *     id: string,                // BIGINT-as-string for stable sort
 *     at: string,                // ISO timestamp
 *     userEmail, userRole, storeType, storeId,
 *     method: "POST"|"PUT"|"DELETE"|"PATCH",
 *     path: string,              // full URL path
 *     resource, resourceId, action,
 *     ip, userAgent,
 *     statusCode,
 *     ok: boolean,
 *     body: object | null,      // request body, passwords redacted
 *     errorMessage: string | null,
 *   }
 */
export const getAuditLog = async (filters = {}) => {
  // Strip empty/null/undefined values so the URL stays clean.
  const params = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === "") continue;
    params[k] = v;
  }
  return apiGet("/api/audit-log", params);
};
