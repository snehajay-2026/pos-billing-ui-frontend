// Shared laundry order helpers: status taxonomy, pill colors, token counter.
// Used by LaundryOrderPage, LaundryBilling, LaundryThermalReceipt, Dashboard.

import hotelService from "../../services/hotelService";

export const LAUNDRY_ORDER_STATUSES = [
  { value: "received", label: "Received", color: "#0d6efd", tone: "primary" },
  { value: "in_process", label: "In Process", color: "#fd7e14", tone: "warning" },
  { value: "ready", label: "Ready for Pickup", color: "#198754", tone: "success" },
  { value: "delivered", label: "Delivered", color: "#6c757d", tone: "secondary" },
  { value: "cancelled", label: "Cancelled", color: "#dc3545", tone: "danger" },
];

// Legacy statuses that exist in orders.json from earlier versions. Map them onto the
// new taxonomy so old rows render correctly and the new pill colors apply.
export const LAUNDRY_STATUS_ALIASES = {
  pending: "received", // old "pending for wash" -> "received"
  washed: "in_process", // old "washed" -> "in_process" (washing is one step of processing)
  not_picked_up: "ready", // old "not picked up" actually meant "ready" in the new model
  completed: "delivered",
};

const STATUS_BY_VALUE = LAUNDRY_ORDER_STATUSES.reduce((acc, status) => {
  acc[status.value] = status;
  return acc;
}, {});

export const resolveLaundryStatus = (rawValue) => {
  const raw = String(rawValue || "")
    .trim()
    .toLowerCase();
  if (!raw) return LAUNDRY_ORDER_STATUSES[0];
  if (STATUS_BY_VALUE[raw]) return STATUS_BY_VALUE[raw];
  if (LAUNDRY_STATUS_ALIASES[raw]) return STATUS_BY_VALUE[LAUNDRY_STATUS_ALIASES[raw]];
  return LAUNDRY_ORDER_STATUSES[0];
};

export const getLaundryStatusLabel = (rawValue) => resolveLaundryStatus(rawValue).label;
export const getLaundryStatusColor = (rawValue) => resolveLaundryStatus(rawValue).color;
export const getLaundryStatusTone = (rawValue) => resolveLaundryStatus(rawValue).tone;

// Auto-generated token counter ("LD-0001", "LD-0002" ...). Per-page, per-day,
// resets when the local day rolls over. Cheap, no backend change.
const TOKEN_STORAGE_KEY = "laundry_token_counter_v1";

const readStoredCounter = () => {
  try {
    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return { day: "", value: 0 };
    const parsed = JSON.parse(raw);
    return {
      day: String(parsed?.day || ""),
      value: Number(parsed?.value) || 0,
    };
  } catch {
    return { day: "", value: 0 };
  }
};

const writeStoredCounter = (state) => {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private-mode */
  }
};

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const pad4 = (n) => String(n).padStart(4, "0");

// Seed the localStorage cache with the server's authoritative counter for
// today. Call once on page mount so subsequent `nextLaundryToken` calls
// don't depend on a network round-trip and so two stations in the same
// store can't both hand out the same bag tag.
export const seedLaundryTokenCounterFromServer = async () => {
  try {
    const resp = await hotelService.getLaundryTokenCounter();
    if (resp && typeof resp.value === "number" && resp.day) {
      writeStoredCounter({ day: resp.day, value: resp.value });
    }
  } catch (err) {
    console.warn("Failed to seed laundry token counter from server", err);
  }
};

// Compute the next token. Walks past any existing tokens in the supplied list so we
// never collide with manually-issued tokens or with yesterday's counter.
export const nextLaundryToken = (existingTokens = []) => {
  const day = todayKey();
  const stored = readStoredCounter();

  const numericExisting = existingTokens
    .map((token) => {
      const match = /^LD-(\d{1,})$/i.exec(String(token || "").trim());
      return match ? Number(match[1]) : 0;
    })
    .filter((n) => Number.isFinite(n) && n > 0);

  const maxExisting = numericExisting.length ? Math.max(...numericExisting) : 0;
  let nextValue;

  if (stored.day === day) {
    nextValue = Math.max(stored.value + 1, maxExisting + 1);
  } else {
    nextValue = Math.max(1, maxExisting + 1);
  }

  writeStoredCounter({ day, value: nextValue });
  // Push the new value to the server. The backend only advances the counter
  // forward so a concurrent booking just makes the counter go faster —
  // never backwards. Fire-and-forget; UI already shows the next token.
  if (hotelService && typeof hotelService.postLaundryTokenCounter === "function") {
    hotelService.postLaundryTokenCounter({ value: nextValue, day }).catch((err) => {
      console.warn("Failed to advance laundry token counter on server", err);
    });
  }
  return `LD-${pad4(nextValue)}`;
};

// Helper: total of an order, tolerant to old shapes.
export const orderGrandTotal = (order) => {
  if (!order) return 0;
  if (Number.isFinite(Number(order.total))) return Number(order.total);
  if (Array.isArray(order.items) && order.items.length) {
    return order.items.reduce((sum, item) => {
      const qty = Number(item.qty ?? item.qtyKg ?? 0) || 0;
      const price = Number(item.price || 0) || 0;
      const gst = Number(item.gst || 0) || 0;
      return sum + qty * price * (1 + gst / 100);
    }, 0);
  }
  return 0;
};

// Expected return default: tomorrow, formatted as yyyy-mm-dd for <input type="date">.
export const defaultExpectedReturn = (offsetDays = 1) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().split("T")[0];
};
