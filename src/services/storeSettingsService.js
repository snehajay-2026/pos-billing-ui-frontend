import { apiGet, apiPost } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

let storeSettingsCache = null;
let storeSettingsCacheKey = null;

// Drop the legacy `serviceTaxRate` key from any settings payload. The
// Service Store no longer auto-populates GST from this field — the cashier
// enters the rate manually on each bill. We strip it on read so any old
// localStorage / DB row that still carries the key stops surfacing it to
// any future renderer that might otherwise leak it back onto the invoice.
const stripLegacyServiceTaxRate = (settings) => {
  if (!settings || typeof settings !== "object") return settings;
  if (!("serviceTaxRate" in settings)) return settings;
  const { serviceTaxRate: _ignored, ...rest } = settings;
  return rest;
};

const defaultSettings = {
  name: "Ajay Merchant",
  address: "Main Road, India",
  phone: "",
  email: "info@ajaymerchant.com",
  logo: "/airtel.png",
  upiId: "9552813906@ybl",
  qrType: "UPI",
  theme: "classic",
  gstNo: "22AAAAA0000A1Z5",
  panNo: "AAAAA0000A",
  businessType: "retail",
  bankName: "State Bank of India",
  accountNo: "1234567890",
  ifscCode: "SBIN0001234",
  branch: "Main Branch",
  city: "Mumbai",
  state: "Maharashtra",
  pincode: "400001",
  serviceInvoiceTitle: "Invoice Service",
  serviceInvoicePrefix: "SI",
  // serviceTaxRate removed — the Service Store requires the cashier to
  // enter the GST% per bill. Store-level rate is no longer a source.
  serviceDueDays: 0,
  serviceBankAccount: "",
  serviceTerms:
    "Payment is due upon receipt of this invoice.\nLate payments may incur additional charges.\nPlease make checks payable to Your Company Name.",
  serviceFooterPhone: "",
  serviceFooterEmail: "",
  serviceSignatureName: "",
  // Hotel defaults. These mirror the `?? "200"` defaults shown in the
  // settings UI (StoreSettingsSections.jsx) so the overstay charge is
  // computable as soon as the app boots, even for stores that have never
  // saved the Store Settings form. Without these seed values
  // `computeOverstayCharge` returns null because the rate is `undefined`.
  hotelCheckinTime: "12:00",
  hotelCheckoutTime: "11:00",
  hotelLateCheckoutFeePerHour: 200,
  hotelGst: 12,
};

const getStoreSettingsScope = () => {
  const active = getActiveStoreContext();
  const user = getUser();
  return {
    storeType: active?.storeType || user?.storeType || "",
    storeId: active?.storeId || user?.storeId || active?.storeType || user?.storeType || "",
  };
};

const getScopeKey = (scope = getStoreSettingsScope()) => {
  const type = String(scope.storeType || "").trim() || "system";
  const id = String(scope.storeId || type || "global").trim() || type || "global";
  return `store-settings:${type}:${id}`;
};

const getScopeQuery = (scope = getStoreSettingsScope()) => {
  const query = {};
  if (scope.storeType) query.storeType = scope.storeType;
  if (scope.storeId) query.storeId = scope.storeId;
  return query;
};

const getFallbackSettings = (scope = getStoreSettingsScope()) => ({
  ...defaultSettings,
  ...(scope.storeType ? { businessType: scope.storeType } : {}),
});

const parseLocalSettings = (raw) => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.warn("Failed to parse store settings from localStorage", err);
    return null;
  }
};

const resolveStoreSettingsPayload = (payload, scope) => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const scopeKey = getScopeKey(scope);

  if (payload[scopeKey] && typeof payload[scopeKey] === "object") {
    return payload[scopeKey];
  }

  if (payload.global && typeof payload.global === "object") {
    return payload.global;
  }

  const hasScopeKeys = Object.keys(payload).some((key) => key.startsWith("store-settings:"));
  if (hasScopeKeys) {
    return payload[scopeKey] || getFallbackSettings(scope);
  }

  return payload;
};

const saveLocalStoreSettings = (scopeKey, settings) => {
  try {
    localStorage.setItem(scopeKey, JSON.stringify(settings));
  } catch (err) {
    console.warn("Unable to persist store settings locally", err);
  }
};

export const getStoreSettings = () => {
  const scope = getStoreSettingsScope();
  const scopeKey = getScopeKey(scope);

  if (storeSettingsCache && storeSettingsCacheKey === scopeKey) {
    return storeSettingsCache;
  }

  const raw = localStorage.getItem(scopeKey);
  const localSettings = parseLocalSettings(raw);
  if (localSettings) {
    storeSettingsCache = stripLegacyServiceTaxRate({
      ...getFallbackSettings(scope),
      ...localSettings,
    });
    storeSettingsCacheKey = scopeKey;
    return storeSettingsCache;
  }

  storeSettingsCache = getFallbackSettings(scope);
  storeSettingsCacheKey = scopeKey;
  return storeSettingsCache;
};

export const loadStoreSettings = async () => {
  const scope = getStoreSettingsScope();
  const scopeKey = getScopeKey(scope);
  try {
    const response = await apiGet("/api/store-settings", getScopeQuery(scope));
    const settingsFromApi = resolveStoreSettingsPayload(response, scope);
    const settings = stripLegacyServiceTaxRate({
      ...getFallbackSettings(scope),
      ...(settingsFromApi || {}),
    });
    storeSettingsCache = settings;
    storeSettingsCacheKey = scopeKey;
    saveLocalStoreSettings(scopeKey, settings);
    return settings;
  } catch (err) {
    const raw = localStorage.getItem(scopeKey);
    const localSettings = parseLocalSettings(raw);
    const settings = stripLegacyServiceTaxRate(
      localSettings
        ? { ...getFallbackSettings(scope), ...localSettings }
        : getFallbackSettings(scope)
    );
    storeSettingsCache = settings;
    storeSettingsCacheKey = scopeKey;
    return settings;
  }
};

export const saveStoreSettings = async (settings) => {
  const scope = getStoreSettingsScope();
  const scopeKey = getScopeKey(scope);
  const scopedSettings = { ...getFallbackSettings(scope), ...settings };
  storeSettingsCache = scopedSettings;
  storeSettingsCacheKey = scopeKey;
  saveLocalStoreSettings(scopeKey, scopedSettings);
  return apiPost("/api/store-settings", scopedSettings, getScopeQuery(scope));
};

export const resetStoreSettingsCache = () => {
  storeSettingsCache = null;
  storeSettingsCacheKey = null;
};

// Synchronously reseed the in-memory cache + theme for a newly-selected store, so callers
// like getStoreSettings() return the new store's values without waiting for the network.
// Used by the header when switching stores to avoid a "Restoring store" flicker.
//
// When the caller passes a fully populated `store` payload (the public
// invoice viewer does — it has the live values from the
// `/api/public/invoices/:no` response), the new payload wins over any
// stale localStorage value. Otherwise the public viewer would show
// whichever store the browser happened to be scoped to last time it was
// signed in — completely unrelated to the store that owns the invoice.
export const seedStoreSettingsForScope = (store) => {
  const scope = {
    storeType: String(store?.storeType || "").trim(),
    storeId: String(store?.storeId || store?.storeType || "").trim(),
  };
  if (!scope.storeType && !scope.storeId) {
    resetStoreSettingsCache();
    return null;
  }
  const scopeKey = getScopeKey(scope);
  const fallback = getFallbackSettings(scope);
  // Heuristic: if the payload carries identifying fields the authed
  // store-settings response carries (`name`, `gstNo`, or `address`),
  // treat it as a full payload that should overwrite both the in-memory
  // cache and localStorage. Otherwise fall back to the previous merge
  // behaviour (cache + localStorage layered over fallback) so the
  // header's switch-store flow keeps its no-flicker behaviour.
  const looksLikeFullPayload =
    !!store &&
    (Object.prototype.hasOwnProperty.call(store, "name") ||
      Object.prototype.hasOwnProperty.call(store, "gstNo") ||
      Object.prototype.hasOwnProperty.call(store, "address"));
  let merged;
  if (looksLikeFullPayload) {
    merged = { ...fallback, ...store };
    try {
      window.localStorage.setItem(scopeKey, JSON.stringify(merged));
    } catch {
      /* ignore */
    }
  } else {
    let fromStorage = {};
    try {
      const raw = window.localStorage.getItem(scopeKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") fromStorage = parsed;
      }
    } catch {
      /* ignore */
    }
    merged = { ...fallback, ...store, ...fromStorage };
  }
  storeSettingsCache = merged;
  storeSettingsCacheKey = scopeKey;
  return storeSettingsCache;
};
