// Auto-generated reservation codes (RES-XXXX) for hotel bookings.
// Per-store, per-day counter persisted to localStorage as the offline cache;
// the canonical counter lives on the server at
// `/api/hotel/reservation-counter`. The local cache is seeded from the server
// on mount so two POS stations in the same store don't hand out the same code.
import hotelService from "../../services/hotelService";

export const RES_CODE_REGEX = /^RES-(\d{4,})$/i;
const RES_CODE_STORAGE_KEY = "hotel_reservation_counter_v1";

const pad = (n, width) => String(n).padStart(width, "0");

const readStoredCounter = () => {
  try {
    const raw = window.localStorage.getItem(RES_CODE_STORAGE_KEY);
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
    window.localStorage.setItem(RES_CODE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private-mode */
  }
};

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
};

const extractNumeric = (code) => {
  const match = RES_CODE_REGEX.exec(String(code || "").trim());
  return match ? Number(match[1]) : 0;
};

// Seed the localStorage cache with the server's authoritative counter value
// for today. Call once on page mount so subsequent `nextReservationCode`
// calls don't depend on a network round-trip.
export const seedReservationCounterFromServer = async () => {
  try {
    const resp = await hotelService.getReservationCounter();
    if (resp && typeof resp.value === "number" && resp.day) {
      writeStoredCounter({ day: resp.day, value: resp.value });
    }
  } catch (err) {
    // Cashier's offline path keeps the localStorage value intact.
    console.warn("Failed to seed reservation counter from server", err);
  }
};

// Generate the next reservation code, walking past any codes already in use
// (so manually-issued or older-day codes don't collide).
export const nextReservationCode = (existingCodes = []) => {
  const day = todayKey();
  const stored = readStoredCounter();

  const numericExisting = existingCodes
    .map(extractNumeric)
    .filter((n) => Number.isFinite(n) && n > 0);
  const maxExisting = numericExisting.length ? Math.max(...numericExisting) : 0;
  let nextValue;

  if (stored.day === day) {
    nextValue = Math.max(stored.value + 1, maxExisting + 1);
  } else {
    nextValue = Math.max(1, maxExisting + 1);
  }

  writeStoredCounter({ day, value: nextValue });
  // Push the new value to the server. The server only advances its counter
  // forward, so a concurrent booking from another device just makes the
  // counter go faster — never backwards. Fire-and-forget; cashier's UI
  // already shows the new code by the time this resolves.
  if (hotelService && typeof hotelService.postReservationCounter === "function") {
    hotelService.postReservationCounter({ value: nextValue, day }).catch((err) => {
      console.warn("Failed to advance reservation counter on server", err);
    });
  }
  return `RES-${pad(nextValue, 4)}`;
};

// Lookup a room by reservation code (case-insensitive). Returns the room or null.
export const findRoomByReservationCode = (rooms = [], code = "") => {
  const target = String(code || "")
    .trim()
    .toUpperCase();
  if (!target) return null;
  return (
    rooms.find(
      (room) =>
        String(room?.reservationCode || "")
          .trim()
          .toUpperCase() === target
    ) || null
  );
};
