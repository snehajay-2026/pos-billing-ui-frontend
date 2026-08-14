import { getUser } from "../utils/auth";

export const API_BASE =
  process.env.REACT_APP_API_BASE?.trim() ||
  (process.env.NODE_ENV === "development" ? "http://localhost:4000" : "");

// Production guard: in prod the bundle MUST use the Vercel proxy (empty
// API_BASE → same-origin /api/*) so the session cookie is host-only on the
// frontend origin. If a stray REACT_APP_API_BASE env var is set on Vercel
// pointing at the Render backend, every fetch goes cross-origin, Chrome
// drops the sessionId cookie, and the user sees an endless stream of 401s.
// Surface this loudly in the browser console so misconfiguration is visible
// without DevTools Network inspection.
if (
  typeof window !== "undefined" &&
  process.env.NODE_ENV === "production" &&
  API_BASE &&
  !window.location.origin.includes("localhost") &&
  !API_BASE.startsWith(window.location.origin)
) {
  console.warn(
    "[pos-billing-ui] REACT_APP_API_BASE is set to a cross-origin URL in production " +
      `(${API_BASE}). Expected empty string so requests go through the Vercel /api/* proxy. ` +
      "Clear the REACT_APP_API_BASE env var in the Vercel project settings to restore same-origin " +
      "session cookies (Lax/HostOnly). Cross-origin requests will 401 because Chrome blocks the " +
      "sessionId cookie on cross-site /api/* calls."
  );
}

// Endpoints where a 401 is *not* a session-expiry signal. They're either
// public (login/register/password-reset) or called during the App bootstrap
// before we know whether the user has a session. Excluding these stops the
// global listener from redirecting on the very first page load or on a
// genuine wrong-password login attempt.
//
// `/api/store-settings` is included here so a cold-start bootstrap fetch
// (App.js:bootstrapApp) returning 401 for an unauthenticated visitor
// doesn't arm the session-expired redirect. The bootstrap is explicitly
// designed to handle "no auth" gracefully via `.catch(() => null)`.
const NON_SESSION_401_PATHS = [
  "/api/login",
  "/api/register",
  "/api/register/available",
  "/api/auth/user",
  "/api/store-settings",
  "/api/password-reset/request",
  "/api/password-reset/confirm",
];

// Fresh-auth grace window. Right after a successful login the very first
// protected fetch can race with the new sessionId cookie being persisted
// (the browser has just parsed a Set-Cookie header from the login
// response). A single 401 in that window is not a real session-expiry
// signal — it's cookie propagation, Vercel proxy warming, or the CSRF
// token hand-off. Suppressing the redirect during this window stops
// transient post-login 401s from kicking a freshly signed-in user out.
//
// `App.js:SessionExpiredListener` opens this window whenever the
// `authChanged` window event fires with a non-null user detail (see
// setCurrentUser in authService.js). We expose a getter here so callers
// don't have to import App.js internals.
const FRESH_AUTH_GRACE_MS = 15000;
let freshAuthUntil = 0;
const setFreshAuthUntil = (ts) => {
  freshAuthUntil = Number(ts) || 0;
};
const getFreshAuthUntil = () => freshAuthUntil;

const isSessionExpiry401 = (url, status) => {
  if (status !== 401) return false;
  // Suppress all 401s during the fresh-auth grace window. See the
  // FRESH_AUTH_GRACE_MS comment above for why a single 401 right after
  // login isn't a real session-expiry.
  if (Date.now() < freshAuthUntil) return false;
  return !NON_SESSION_401_PATHS.some(
    (p) => url === p || url.startsWith(p + "/") || url.startsWith(p + "?")
  );
};

export { FRESH_AUTH_GRACE_MS, setFreshAuthUntil, getFreshAuthUntil };

// CSRF: read the XSRF-TOKEN cookie (set by the backend on login, NOT
// HttpOnly so JS can read it) and echo it as the X-CSRF-Token header on
// every non-GET request. The server compares header to cookie and rejects
// mismatches with 403. A cross-site attacker can't read the cookie, so
// they can't produce the header.
// In-memory CSRF token store. Login (and register, when used) echo the
// freshly-minted XSRF token in the JSON response body; authService stores
// it here. When the frontend lives on a different origin than the
// backend (Vercel -> Render), document.cookie can't see the XSRF-TOKEN
// cookie (cross-origin), so we must source it from the JSON response
// instead. On same-origin setups, the cookie path below also works.
//
// Persisted to sessionStorage so a hard page reload keeps it.
const CSRF_STORAGE_KEY = "pos_billing_csrf_token";

let csrfTokenMemory = null;
try {
  if (typeof sessionStorage !== "undefined") {
    csrfTokenMemory = sessionStorage.getItem(CSRF_STORAGE_KEY) || null;
  }
} catch {
  /* SSR or storage disabled — fall through */
}

export const setCsrfToken = (token) => {
  csrfTokenMemory = token || null;
  try {
    if (typeof sessionStorage !== "undefined") {
      if (token) sessionStorage.setItem(CSRF_STORAGE_KEY, token);
      else sessionStorage.removeItem(CSRF_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
};
export const clearCsrfToken = () => setCsrfToken(null);

const getCsrfToken = () => {
  if (csrfTokenMemory) return csrfTokenMemory;
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
};

const getScopedParams = (params = {}) => {
  const user = getUser();
  if (!user) return params || {};

  const shouldScope =
    user.role !== "SUPER_OWNER" || (user.storeType && user.storeType !== "system");
  if (!shouldScope) return params || {};

  return {
    ...(params || {}),
    ...(user.storeType ? { storeType: user.storeType } : {}),
    ...(user.storeId ? { storeId: user.storeId } : {}),
  };
};

const buildQuery = (url, params = {}) => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (typeof value === "object") {
      searchParams.append(key, JSON.stringify(value));
    } else {
      searchParams.append(key, String(value));
    }
  });
  const queryString = searchParams.toString();
  return queryString ? `${url}?${queryString}` : url;
};

const request = async (method, url, data, params, options = {}) => {
  const scopedParams = getScopedParams(params);
  const finalUrl = Object.keys(scopedParams).length ? buildQuery(url, scopedParams) : url;
  const fullUrl = `${API_BASE}${finalUrl}`;
  const init = {
    method,
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  };

  // Inject CSRF token on state-changing requests. The server's
  // csrfProtection middleware requires the header to match the cookie;
  // public endpoints exempt themselves server-side so this is harmless
  // even on login/register.
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrfToken = getCsrfToken();
    if (csrfToken) {
      init.headers["X-CSRF-Token"] = csrfToken;
    }
  }

  if (data && method !== "GET" && method !== "HEAD") {
    init.body = JSON.stringify(data);
  }

  let response;
  try {
    response = await fetch(fullUrl, init);
  } catch (err) {
    const origin =
      API_BASE || (typeof window !== "undefined" ? window.location.origin : "<unknown origin>");
    throw new Error(`Unable to connect to backend at ${origin}${finalUrl}. ${err.message}`);
  }

  const text = await response.text();
  if (!response.ok) {
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    const message =
      body.error || body.message || `API ${method} ${finalUrl} failed: ${response.status}`;
    const err = new Error(message);
    // Attach structured fields so callers can branch on HTTP status
    // (e.g. 409 insufficient stock → body.available / body.requested).
    err.status = response.status;
    err.body = body;

    // Dispatch a global session-expired signal for protected endpoints.
    // The listener in App.js decides whether to redirect based on the
    // current pathname (avoids redirecting on a public page).
    if (isSessionExpiry401(finalUrl, response.status)) {
      try {
        window.dispatchEvent(new CustomEvent("sessionExpired"));
      } catch {
        /* SSR safety — no-op */
      }
    }

    throw err;
  }

  try {
    return JSON.parse(text || "null");
  } catch {
    return text;
  }
};

export const apiGet = async (url, params) => request("GET", url, null, params);
export const apiPost = async (url, data, params) => request("POST", url, data, params);
export const apiPut = async (url, data, params) => request("PUT", url, data, params);
export const apiDelete = async (url, data, params) => request("DELETE", url, data, params);
