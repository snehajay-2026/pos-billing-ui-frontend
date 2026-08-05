// src/services/realtimeSync.js
//
// Client-side wrapper around EventSource for cross-device real-time sync.
// One connection per browser tab, scoped to the active store. Listens
// for `booking` + `hotel` events and dispatches them on a window custom
// event so any component can subscribe without owning the connection.
//
// Why EventSource: native browser API, no library, automatic reconnect,
// survives proxies (Render, Cloudflare). The backend uses Server-Sent
// Events — see server/realtime/sse.js.

const SYNC_EVENT = "realtime_sync_event";
const STATUS_EVENT = "realtime_sync_status";

const isBrowser = typeof window !== "undefined" && typeof EventSource !== "undefined";

let activeSource = null;
let activeUrl = null;
let activeScopeKey = null;
let reconnectTimer = null;

const dispatchStatus = (status, detail = null) => {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: { status, ...detail } }));
  } catch {
    /* SSR safety */
  }
};

const close = () => {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (activeSource) {
    try {
      activeSource.close();
    } catch {
      /* noop */
    }
    activeSource = null;
    activeUrl = null;
    activeScopeKey = null;
    dispatchStatus("closed");
  }
};

const scheduleReconnect = (url, scopeKey) => {
  if (!isBrowser || !url) return;
  if (reconnectTimer) return;
  // Exponential-ish backoff: 1s, 2s, 4s, capped at 8s.
  const delay = Math.min(8000, 1000 * Math.pow(2, Math.min(3, scheduleReconnect.attempts || 0)));
  scheduleReconnect.attempts = (scheduleReconnect.attempts || 0) + 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    connect(url, scopeKey);
  }, delay);
};

const connect = (url, scopeKey) => {
  if (!isBrowser || !url) return;
  // Only skip if the connection is genuinely open for the same scope.
  // A closed/errored EventSource still has a non-null reference but
  // readyState === CLOSED (2) — we must reopen it.
  if (activeSource && activeSource.readyState !== EventSource.CLOSED && activeScopeKey === scopeKey) return;
  close();
  activeScopeKey = scopeKey;
  activeUrl = url;
  scheduleReconnect.attempts = 0;

  let es;
  try {
    es = new EventSource(url, { withCredentials: true });
  } catch (err) {
    scheduleReconnect(url, scopeKey);
    return;
  }
  activeSource = es;
  dispatchStatus("connecting", { url });

  es.addEventListener("hello", (e) => {
    scheduleReconnect.attempts = 0;
    dispatchStatus("open", { data: e.data });
  });

  // Forward booking + hotel events as a single window event so listeners
  // don't have to register per-event-type. The event's kind discriminates.
  const relay = (kind) => (e) => {
    let payload = e.data;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        /* leave as string */
      }
    }
    try {
      window.dispatchEvent(
        new CustomEvent(SYNC_EVENT, {
          detail: { kind: kind === "message" ? payload?.kind || "message" : kind, event: payload },
        })
      );
    } catch {
      /* SSR */
    }
  };

  es.addEventListener("booking", relay("booking"));
  es.addEventListener("hotel", relay("hotel"));
  es.addEventListener("live_bill", relay("live_bill"));
  es.addEventListener("message", relay("message"));

  es.onerror = () => {
    dispatchStatus("error");
    // EventSource auto-reconnects; we just tear down our handle so
    // the next manual connect() call (e.g. after scope change) doesn't
    // fight the native reconnect.
    es.close();
    activeSource = null;
    scheduleReconnect(url, scopeKey);
  };
};

export const connectRealtimeSync = ({ apiBase, storeType, storeId }) => {
  if (!isBrowser) return;
  if (!apiBase) {
    close();
    return;
  }
  const scopeKey = `${storeType || ""}:${storeId || ""}`;
  // Skip reconnect if the scope hasn't changed and the connection is
  // already active (EventSource readyState === 1). If the source is
  // closed (e.g. initial connect was a no-op because the user wasn't
  // ready yet), reopen it.
  if (activeSource && activeSource.readyState === EventSource.OPEN && activeScopeKey === scopeKey) return;

  const params = new URLSearchParams();
  if (storeType) params.append("storeType", storeType);
  if (storeId) params.append("storeId", storeId);
  const query = params.toString();
  const url = `${apiBase}/api/events${query ? `?${query}` : ""}`;
  connect(url, scopeKey);
};

export const disconnectRealtimeSync = () => close();

export const onRealtimeSyncEvent = (handler) => {
  if (!isBrowser) return () => {};
  const wrapped = (e) => handler(e.detail);
  window.addEventListener(SYNC_EVENT, wrapped);
  return () => window.removeEventListener(SYNC_EVENT, wrapped);
};

export const onRealtimeSyncStatus = (handler) => {
  if (!isBrowser) return () => {};
  const wrapped = (e) => handler(e.detail);
  window.addEventListener(STATUS_EVENT, wrapped);
  return () => window.removeEventListener(STATUS_EVENT, wrapped);
};

export const realtimeSyncEvents = {
  SYNC_EVENT,
  STATUS_EVENT,
};
