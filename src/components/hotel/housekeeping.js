// Housekeeping state machine for hotel rooms.
// Used by HotelHousekeepingPage, HotelLodgingPage, HotelBilling, and Dashboard tiles.

import hotelService from "../../services/hotelService";

export const HOUSEKEEPING_STATES = [
  { value: "clean", label: "Clean", tone: "success", swatch: "#198754" },
  { value: "dirty", label: "Dirty", tone: "warning", swatch: "#fd7e14" },
  { value: "inspecting", label: "Inspecting", tone: "info", swatch: "#0dcaf0" },
  { value: "out_of_order", label: "Out of Order", tone: "danger", swatch: "#dc3545" },
];

const STATE_BY_VALUE = HOUSEKEEPING_STATES.reduce((acc, state) => {
  acc[state.value] = state;
  return acc;
}, {});

export const resolveHousekeeping = (room) => {
  const raw = String(room?.housekeeping || "")
    .trim()
    .toLowerCase();
  if (STATE_BY_VALUE[raw]) return raw;
  // Legacy rooms from before this field existed default to "clean" only if vacant,
  // otherwise dirty. This is the "housekeeping starts here" backwards-compat default.
  if (room?.status === "occupied") return "dirty";
  return "clean";
};

export const getHousekeepingLabel = (room) => {
  const value = resolveHousekeeping(room);
  return STATE_BY_VALUE[value].label;
};

export const getHousekeepingTone = (room) => STATE_BY_VALUE[resolveHousekeeping(room)].tone;

export const getHousekeepingSwatch = (room) => STATE_BY_VALUE[resolveHousekeeping(room)].swatch;

// Linear "advance" cycle: clean -> dirty -> inspecting -> clean
// (Out-of-order is a separate path, set explicitly.)
export const nextHousekeepingState = (room) => {
  const current = resolveHousekeeping(room);
  if (current === "out_of_order") return "dirty";
  if (current === "clean") return "dirty";
  if (current === "dirty") return "inspecting";
  if (current === "inspecting") return "clean";
  return "clean";
};

// A room is sellable only when it's vacant AND clean.
export const isRoomSellable = (room) => {
  if (!room) return false;
  if (room.status !== "vacant") return false;
  return resolveHousekeeping(room) === "clean";
};

// Group rooms into kanban columns by housekeeping state. Used by the housekeeping page.
export const bucketRoomsByHousekeeping = (rooms = []) => {
  const buckets = HOUSEKEEPING_STATES.reduce((acc, state) => {
    acc[state.value] = [];
    return acc;
  }, {});
  rooms.forEach((room) => {
    if (!room) return;
    const key = resolveHousekeeping(room);
    buckets[key].push(room);
  });
  return buckets;
};

// Group rooms by floor number. Floors without an explicit number go to "—".
// Returns [{ floor, rooms }] sorted by floor ascending (with unnumbered last).
export const groupRoomsByFloor = (rooms = []) => {
  const buckets = new Map();
  rooms.forEach((room) => {
    if (!room) return;
    const key = room.floor != null && room.floor !== "" ? String(room.floor) : "—";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(room);
  });
  return Array.from(buckets.entries())
    .map(([floor, list]) => ({
      floor,
      rooms: list.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
    }))
    .sort((a, b) => {
      if (a.floor === "—") return 1;
      if (b.floor === "—") return -1;
      const an = Number(a.floor);
      const bn = Number(b.floor);
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
      return String(a.floor).localeCompare(String(b.floor));
    });
};

// Compact summary string for a list of rooms: "2 clean · 1 dirty · 1 in-house".
// Used by the housekeeping floor board's per-floor subheader.
export const summarizeRoomsForFloor = (rooms = []) => {
  if (!rooms.length) return "";
  const counts = {
    clean: 0,
    dirty: 0,
    inspecting: 0,
    out_of_order: 0,
    occupied: 0,
    vacant: 0,
    overdue: 0,
    dueToday: 0,
  };
  const todayKey = new Date().toISOString().split("T")[0];
  rooms.forEach((room) => {
    counts[resolveHousekeeping(room)] += 1;
    counts[room.status === "occupied" ? "occupied" : "vacant"] += 1;
    if (room.status === "occupied") {
      const nights = Math.max(1, Number(room.nights) || 1);
      if (room.checkIn) {
        const out = new Date(room.checkIn);
        if (!Number.isNaN(out.getTime())) {
          out.setDate(out.getDate() + nights);
          const key = out.toISOString().split("T")[0];
          if (key < todayKey) counts.overdue += 1;
          else if (key === todayKey) counts.dueToday += 1;
        }
      }
    }
  });
  const parts = [];
  if (counts.clean) parts.push(`${counts.clean} clean`);
  if (counts.dirty) parts.push(`${counts.dirty} dirty`);
  if (counts.inspecting) parts.push(`${counts.inspecting} inspecting`);
  if (counts.out_of_order) parts.push(`${counts.out_of_order} OOO`);
  if (counts.occupied) parts.push(`${counts.occupied} in-house`);
  if (counts.vacant) parts.push(`${counts.vacant} vacant`);
  if (counts.overdue) parts.push(`${counts.overdue} overdue`);
  else if (counts.dueToday) parts.push(`${counts.dueToday} due today`);
  return parts.join(" · ");
};

// Advance the housekeeping state of a room and persist + broadcast the change.
// Used by the housekeeping floor board for in-card HK toggling.
const ROOMS_STORAGE_KEY = "hotel_lodging_rooms";
const ROOMS_UPDATED_EVENT = "hotel_lodging_rooms_updated";

export const advanceAndPersistRoomHousekeeping = (room) => {
  if (!room || !room.id) return null;
  const next = nextHousekeepingState(room);
  const updated = { ...room, housekeeping: next };
  try {
    const raw = window.localStorage.getItem(ROOMS_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (Array.isArray(list)) {
      const nextList = list.map((r) => (String(r.id) === String(room.id) ? updated : r));
      window.localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(nextList));
      try {
        window.dispatchEvent(new CustomEvent(ROOMS_UPDATED_EVENT, { detail: nextList }));
      } catch (_) {}
    }
  } catch (_) {
    // best-effort
  }
  // Push the housekeeping change to the server so other devices in the
  // same store see the same room state. Fire-and-forget — local state
  // already reflects the change, so a transient failure must not block
  // the cashier from advancing further.
  if (hotelService && typeof hotelService.updateRoom === "function") {
    hotelService.updateRoom(room.id, updated).catch((err) => {
      console.warn("Failed to sync housekeeping state to server", err);
    });
  }
  return updated;
};
