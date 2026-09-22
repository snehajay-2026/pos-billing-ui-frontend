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

/**
 * exportAuditLogCsv — fetch the audit log as a CSV blob and trigger a
 * browser download. Reuses the same filter contract as getAuditLog so
 * the admin's currently-applied filter set is exported.
 *
 * The backend caps the export at 5000 rows and returns
 *   Content-Type: text/csv; charset=utf-8
 *   Content-Disposition: attachment; filename="audit-log-<timestamp>.csv"
 * The fetch uses `credentials: "include"` so the auth cookie is sent,
 * matching the rest of the API client.
 *
 * Returns the suggested filename (useful for tests + UI feedback).
 */
export const exportAuditLogCsv = async (filters = {}, deps = {}) => {
  const params = new URLSearchParams();
  params.append("format", "csv");
  for (const [k, v] of Object.entries(filters || {})) {
    if (v === undefined || v === null || v === "") continue;
    params.append(k, String(v));
  }
  const url = `/api/audit-log/export?${params.toString()}`;
  // `deps` lets a test substitute fetch / document / URL. In production
  // these default to the browser globals via the global `fetch`,
  // `document`, and `URL` references.
  const _fetch = deps.fetch || (typeof fetch !== "undefined" ? fetch : null);
  const _document = deps.document || (typeof document !== "undefined" ? document : null);
  const _URL = deps.URL || (typeof URL !== "undefined" ? URL : null);

  const res = await _fetch(url, {
    method: "GET",
    credentials: "include",
    headers: { Accept: "text/csv" },
  });
  if (!res.ok) {
    let message = `Audit log export failed (${res.status})`;
    try {
      const data = await res.json();
      if (data && data.error) message = data.error;
    } catch {
      /* body wasn't JSON; keep the status-only message */
    }
    throw new Error(message);
  }

  const disposition = res.headers.get("Content-Disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  const filename = match ? match[1] : `audit-log-${Date.now()}.csv`;

  const blob = await res.blob();
  // Object URL + anchor click is the most reliable cross-browser trigger.
  const objectUrl =
    _URL && typeof _URL.createObjectURL === "function" ? _URL.createObjectURL(blob) : null;

  if (_document && typeof _document.createElement === "function") {
    const a = _document.createElement("a");
    a.href = objectUrl || url;
    a.download = filename;
    a.style.display = "none";
    if (_document.body && typeof _document.body.appendChild === "function") {
      _document.body.appendChild(a);
    }
    if (typeof a.click === "function") {
      a.click();
    }
    if (_document.body && typeof _document.body.removeChild === "function") {
      _document.body.removeChild(a);
    }
  }
  if (objectUrl && _URL && typeof _URL.revokeObjectURL === "function") {
    // Defer revoke so Safari has time to start the download.
    setTimeout(() => {
      try {
        _URL.revokeObjectURL(objectUrl);
      } catch {
        /* ignore */
      }
    }, 1000);
  }
  return filename;
};
