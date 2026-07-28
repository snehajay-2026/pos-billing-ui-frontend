// Folio helpers: expected check-out time, late-checkout fee, posted-charges store.
//
// Posted charges (Room Service, Minibar, Damage, etc.) live in two layers:
//   1. localStorage under `hotel_room_folios_v1` for instant sync / offline use.
//   2. Server under `/api/hotel/rooms/:id/folio` for multi-device consistency.
//
// The synchronous helpers stay as the localStorage cache (used by
// `buildFolioLineItems` during invoice assembly, which has to be sync). The
// async helpers mirror writes to the server and are called fire-and-forget
// by RoomFolioDrawer / HotelBilling so the cashier's UI doesn't block on
// the network.

import hotelService from "../../services/hotelService";

const FOLIO_STORAGE_KEY = "hotel_room_folios_v1";
const FOLIO_EVENT = "hotel_room_folios_updated";

const safeRead = () => {
  try {
    const raw = window.localStorage.getItem(FOLIO_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const safeWrite = (folios) => {
  try {
    window.localStorage.setItem(FOLIO_STORAGE_KEY, JSON.stringify(folios || {}));
    window.dispatchEvent(new CustomEvent(FOLIO_EVENT, { detail: folios || {} }));
  } catch {
    /* ignore quota / private-mode */
  }
};

// Compose a stable key for a room, preferring id, falling back to name.
const roomKey = (room) => String(room?.id || room?.name || "").trim();

// Time helpers ------------------------------------------------------------

const parseTime = (value) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
};

// Compute expected check-out timestamp for an occupied room.
// Falls back to today @ 11:00 if check-in or nights are missing.
//
// "Standard check-out time" is read only from settings (`hotelCheckoutTime`)
// — never from `room.checkOutTime`, because that field stores the cashier's
// *entered actual* checkout, not the standard.
export const expectedCheckOut = (room, settings = {}) => {
  const checkoutTime = parseTime(settings?.hotelCheckoutTime) || { hh: 11, mm: 0 };
  // Older rooms store the date under `checkIn`; newer ones use `checkInDate`.
  // Read whichever is populated.
  const rawCheckIn = room?.checkInDate || room?.checkIn;
  if (!rawCheckIn) {
    const today = new Date();
    today.setHours(checkoutTime.hh, checkoutTime.mm, 0, 0);
    return today;
  }
  const checkInDate = new Date(rawCheckIn);
  if (Number.isNaN(checkInDate.getTime())) {
    const today = new Date();
    today.setHours(checkoutTime.hh, checkoutTime.mm, 0, 0);
    return today;
  }
  const nights = Math.max(1, Number(room.nights) || 1);
  const out = new Date(checkInDate);
  out.setDate(out.getDate() + nights);
  out.setHours(checkoutTime.hh, checkoutTime.mm, 0, 0);
  return out;
};

export const expectedCheckOutLabel = (room, settings = {}) => {
  const ts = expectedCheckOut(room, settings);
  if (Number.isNaN(ts.getTime())) return "—";
  return ts.toLocaleString();
};

// Resolve the "actual checkout moment" for the overstay calculation.
//
// Policy: when both `room.checkOutDate` and `room.checkOutTime` are set, use
// those as the actual checkout — the cashier's intended checkout time is
// what the guest will be billed against. This is what the user wants
// (per-night rolling checkout, charge only hours beyond the standard check-out
// time, NOT total stay duration).
//
// Falls back to the wall-clock `now` when either field is missing, so a guest
// who is still in the room past standard check-out still sees the overstay
// ticker increase minute-by-minute.
const resolveActualCheckout = (room, now) => {
  const date = String(room?.checkOutDate || "").trim();
  const time = String(room?.checkOutTime || "").trim();
  if (!date || !time) return now;
  const parsed = parseTime(time);
  if (!parsed) return now;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return now;
  d.setHours(parsed.hh, parsed.mm, 0, 0);
  return d;
};

export const lateCheckOutMinutes = (room, now = new Date(), settings = {}) => {
  if (room?.status !== "occupied") return 0;
  const ts = expectedCheckOut(room, settings);
  if (Number.isNaN(ts.getTime())) return 0;
  const actual = resolveActualCheckout(room, now);
  const delta = Math.round((actual.getTime() - ts.getTime()) / 60000);
  return Math.max(0, delta);
};

// Auto-compute the overstay charge for an occupied room. Single source of
// truth — used by the room card (preview) and the checkout flow (final bill).
//
// Returns null when:
//   - the room isn't occupied,
//   - the guest hasn't overstayed yet,
//   - no late-checkout rate is configured (`hotelLateCheckoutFeePerHour`),
//   - the room is missing the dates needed to compute expected check-out.
//
// All inputs are read defensively — invalid dates, missing fields, or
// zero/negative rates all degrade cleanly to `null`.
// Stable id used for the overstay line in the live bill. Keeps the line
// recognisable across re-renders so we don't append a fresh "Late check-out"
// every minute.
export const OVERSTAY_LINE_ID = "folio-overstay-charge";

// Auto-compute the overstay charge for an occupied room. Single source of
// truth — used by the room card (preview), the live bill (auto-sync), and
// the checkout flow (final bill).
//
// Returns null when:
//   - the room isn't occupied,
//   - the guest hasn't overstayed yet,
//   - no late-checkout rate is configured (`hotelLateCheckoutFeePerHour`),
//   - the room is missing the dates needed to compute expected check-out.
//
// All inputs are read defensively — invalid dates, missing fields, or
// zero/negative rates all degrade cleanly to `null`.
export const computeOverstayCharge = (room, now = new Date(), settings = {}) => {
  if (!room || room.status !== "occupied") return null;

  const rate = Number(settings?.hotelLateCheckoutFeePerHour);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  const minutes = lateCheckOutMinutes(room, now, settings);
  if (minutes <= 0) return null;

  const hours = Math.max(1, Math.ceil(minutes / 60));
  const subtotal = hours * rate;
  const gstPct = Math.max(0, Number(room?.gst ?? settings?.hotelGst ?? 12) || 0);
  const gstAmount = Math.round((subtotal * gstPct) / 100);
  const total = subtotal + gstAmount;

  return {
    minutes,
    hours,
    rate,
    subtotal,
    gstPct,
    gstAmount,
    total,
  };
};

/**
 * Synchronise the auto-computed overstay charge into an existing bill's
 * items array.
 *
 * Rules:
 *   - If the room isn't overstaying (or no rate is configured), the items
 *     array is returned unchanged — any pre-existing overstay line is left
 *     alone so the cashier can keep it visible or remove it manually.
 *   - If an overstay charge applies but no line exists yet, a new one is
 *     appended with a stable id (so future ticks update the same row).
 *   - If a line exists, its qty / rate / subtotal are refreshed to match
 *     the latest calculation — *unless* the cashier has manually edited it
 *     (we mark edits via `meta.edited = true`), in which case the auto-sync
 *     leaves the row alone and the cashier's adjustment sticks.
 *
 * Pure function — the caller is responsible for setItems(prev => result).
 */
export const syncOverstayIntoBill = (items, room, now = new Date(), settings = {}) => {
  if (!Array.isArray(items)) return [];
  const safeItems = items;
  const charge = computeOverstayCharge(room, now, settings);

  // No overstay charge → leave any pre-existing line alone (the cashier may
  // have intentionally kept it). Returning a new array reference would
  // trigger a useless re-render.
  if (!charge) return safeItems;

  const existingIdx = safeItems.findIndex((it) => it && it.id === OVERSTAY_LINE_ID);

  // Build the canonical line item.
  const next = {
    id: OVERSTAY_LINE_ID,
    name: "Extra Hours Charges",
    qty: charge.hours,
    rate: charge.rate,
    gst: 0, // GST is computed at line-total level by the bill screen
    total: charge.subtotal,
    type: "lodging",
    category: "Lodging",
    meta: {
      kind: "late_checkout",
      roomId: room?.id,
      roomName: room?.name,
      lateMinutes: charge.minutes,
      hours: charge.hours,
      rate: charge.rate,
      // updatedAt drives the auto-sync — overwritten each refresh tick.
      updatedAt: new Date().toISOString(),
    },
  };

  if (existingIdx === -1) {
    return [...safeItems, next];
  }

  const existing = safeItems[existingIdx];
  // Respect manual edits: if the cashier has tweaked qty/rate on this line,
  // we leave it alone. They can re-enable auto-sync by removing and
  // re-adding the room, or by un-setting the edited flag.
  if (existing && existing.meta && existing.meta.edited) {
    return safeItems;
  }

  // Replace the line in-place while preserving array identity for any other
  // items.
  const out = safeItems.slice();
  out[existingIdx] = next;
  return out;
};

// Resolve the GST rate for a Room Booking bill item.
//
// Priority order:
//   1. The bill item's own `meta.gst` (booking-time snapshot). This is the
//      authoritative source once the item is in the cart — even after the
//      room is marked vacant at checkout, the item still carries the GST
//      the cashier selected at booking. Preserves the "carry forward" rule.
//   2. The bill item's own `gst` field (legacy / direct-storage version of
//      the snapshot).
//   3. The room record's `gst` field, when it's a real value (including
//      explicit 0). Used for rooms that were booked before this fallback
//      logic was added, whose stored bill items have no `meta.gst`.
//   4. The hotel's configured default (settings.hotelGst).
//   5. 0 (no GST) — last-resort fallback.
//
// Settings is passed in so the function is pure and testable; the
// component layer resolves `getStoreSettings()` itself and threads it
// through.
export const resolveLodgingGstRate = (room, item, settings = {}) => {
  const itemMetaGst = item?.meta?.gst;
  if (itemMetaGst !== undefined && itemMetaGst !== null && itemMetaGst !== "") {
    return Number(itemMetaGst) || 0;
  }
  const itemGst = item?.gst;
  if (itemGst !== undefined && itemGst !== null && itemGst !== "") {
    return Number(itemGst) || 0;
  }
  const roomGst = room?.gst;
  if (roomGst !== undefined && roomGst !== null && roomGst !== "") {
    return Number(roomGst) || 0;
  }
  const settingsGst = settings?.hotelGst ?? (typeof window !== "undefined" ? null : null);
  if (settingsGst !== undefined && settingsGst !== null && settingsGst !== "") {
    return Number(settingsGst) || 0;
  }
  return 0;
};

// Folio posted-charges store ---------------------------------------------

export const getRoomFolio = (room) => {
  const key = roomKey(room);
  if (!key) return [];
  const folios = safeRead();
  return Array.isArray(folios[key]) ? folios[key] : [];
};

export const postCharge = (room, charge) => {
  const key = roomKey(room);
  if (!key) return [];
  const folios = safeRead();
  const existing = Array.isArray(folios[key]) ? folios[key] : [];
  const id = `CHG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const next = [
    ...existing,
    {
      id,
      name: String(charge?.name || "Charge").trim() || "Charge",
      qty: Math.max(1, Number(charge?.qty) || 1),
      rate: Math.max(0, Number(charge?.rate) || 0),
      gst: Math.max(0, Number(charge?.gst) || 0),
      note: String(charge?.note || "").trim(),
      postedAt: new Date().toISOString(),
      postedBy: String(charge?.postedBy || ""),
    },
  ];
  folios[key] = next;
  safeWrite(folios);
  return next;
};

export const removeCharge = (room, chargeId) => {
  const key = roomKey(room);
  if (!key) return [];
  const folios = safeRead();
  const existing = Array.isArray(folios[key]) ? folios[key] : [];
  const next = existing.filter((c) => c.id !== chargeId);
  folios[key] = next;
  safeWrite(folios);
  return next;
};

export const clearFolio = (room) => {
  const key = roomKey(room);
  if (!key) return;
  const folios = safeRead();
  delete folios[key];
  safeWrite(folios);
};

// Async helpers — fetch / write / clear against the server. Mirror the
// server response into localStorage so the next sync read returns it
// without a network round-trip. All entries are tagged with `_storeType`,
// `_storeId`, `_userEmail` by the backend; we keep that envelope intact.
//
// These never throw back to the caller — the cashier's UI should not fail
// when the network is flaky. Errors are logged and the caller falls back
// to whatever the localStorage cache already has.

export const fetchFolioFromServer = async (room) => {
  const key = roomKey(room);
  if (!key || typeof hotelService?.getRoomFolio !== "function") return [];
  try {
    const list = await hotelService.getRoomFolio(key);
    if (!Array.isArray(list)) return [];
    // Mirror into localStorage.
    const folios = safeRead();
    folios[key] = list;
    safeWrite(folios);
    return list;
  } catch (err) {
    console.warn("Failed to fetch room folio from server", err);
    return [];
  }
};

export const postChargeToServer = async (room, charge) => {
  const key = roomKey(room);
  if (!key || typeof hotelService?.postRoomCharge !== "function") return null;
  try {
    const created = await hotelService.postRoomCharge(key, charge);
    if (created) return created;
  } catch (err) {
    console.warn("Failed to post room charge to server", err);
  }
  return null;
};

export const removeChargeFromServer = async (room, chargeId) => {
  const key = roomKey(room);
  if (!key || typeof hotelService?.deleteRoomCharge !== "function") return false;
  try {
    await hotelService.deleteRoomCharge(key, chargeId);
    return true;
  } catch (err) {
    console.warn("Failed to remove room charge on server", err);
    return false;
  }
};

export const clearFolioOnServer = async (room) => {
  const key = roomKey(room);
  if (!key || typeof hotelService?.clearRoomFolio !== "function") return false;
  try {
    await hotelService.clearRoomFolio(key);
    return true;
  } catch (err) {
    console.warn("Failed to clear room folio on server", err);
    return false;
  }
};

// Compose invoice line items from a room: room nights (rate × nights) + posted charges.
// Exported so HotelBilling can call this when settling the invoice.
// `now` defaults to the current time and is overridable so tests can pin a
// deterministic overstay duration.
export const buildFolioLineItems = (room, settings = {}, now = new Date()) => {
  const items = [];
  const nights = Math.max(1, Number(room?.nights) || 1);
  const rate = Math.max(0, Number(room?.rate) || 0);
  const gst = Math.max(0, Number(room?.gst ?? settings?.hotelGst ?? 12) || 0);

  if (rate > 0) {
    items.push({
      name: `${room?.name || "Room"} — Room nights`,
      qty: nights,
      rate,
      total: rate * nights,
      gst,
      type: "lodging",
      meta: {
        roomId: room?.id,
        roomName: room?.name,
        nights,
        checkInDate: room?.checkIn,
        guest: room?.guest,
        idProof: room?.idProof,
        ac: room?.ac,
        modern: !!room?.modern,
      },
    });
  }

  // Late check-out fee (per-hour, rounded up to the next whole hour, minimum 1h).
  // Uses the shared computeOverstayCharge helper so the room card preview and
  // this checkout line item never drift out of sync.
  const overstay = computeOverstayCharge(room, now, settings);
  if (overstay) {
    items.push({
      name: "Extra Hours Charges",
      qty: overstay.hours,
      rate: overstay.rate,
      total: overstay.subtotal,
      gst,
      type: "lodging",
      meta: {
        roomId: room?.id,
        roomName: room?.name,
        kind: "late_checkout",
        lateMinutes: overstay.minutes,
        hours: overstay.hours,
        rate: overstay.rate,
      },
    });
  }

  // Posted incidentals
  const charges = getRoomFolio(room);
  charges.forEach((charge) => {
    const lineGst = Math.max(0, Number(charge.gst) || gst);
    items.push({
      name: charge.name,
      qty: charge.qty,
      rate: charge.rate,
      total: charge.rate * charge.qty,
      gst: lineGst,
      type: "lodging",
      meta: {
        roomId: room?.id,
        roomName: room?.name,
        kind: "posted_charge",
        chargeId: charge.id,
      },
    });
  });

  return items;
};

// Sum the folio for display: subtotal only (GST is added by the invoicer).
export const folioSubtotal = (room, settings = {}) =>
  buildFolioLineItems(room, settings).reduce((sum, line) => sum + (Number(line.total) || 0), 0);

// Parse "HH:MM" (24h) to a Date today at that time. Used by the early-check-in check.
export const timeTodayAt = (value) => {
  const parsed = parseTime(value);
  if (!parsed) return null;
  const d = new Date();
  d.setHours(parsed.hh, parsed.mm, 0, 0);
  return d;
};
