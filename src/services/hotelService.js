import { apiGet, apiPost, apiPut, apiDelete } from "./api";
import { getUser, getActiveStoreContext } from "../utils/auth";

const isAuthed = () => {
  const user = getUser();
  return Boolean(user && user.email && user.email !== "nouser");
};

const getScope = () => {
  const user = getUser();
  const active = getActiveStoreContext();
  return {
    storeType: active?.storeType || user?.storeType || "hotel",
    storeId: active?.storeId || user?.storeId || "hotel",
  };
};

// === Hotel bookings (per-store, persisted to MySQL) =========================
// Replaces the legacy JSON-blob storage in hotel_state.tables (which had
// no cross-device sync). Each call carries storeType + storeId as query
// params so the backend scopes the write correctly. Backend matches by
// (kind, refId) within the scope — calling bookTable() twice for the
// same table updates the same row rather than creating duplicates.

export const listBookings = async (filters = {}) => {
  if (!isAuthed()) return [];
  const { storeType, storeId } = getScope();
  return apiGet("/api/hotel/bookings", {
    storeType,
    storeId,
    ...filters,
  });
};

// bookTable: persist a dining table booking. Pass the full table object
// (id, name, zone, partySize, guest, etc.); the backend upserts by
// (kind='dining', tableId) within the store scope.
export const bookTable = async (table) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost(
    "/api/hotel/bookings",
    {
      kind: "dining",
      tableId: table.id || table.tableId,
      tableName: table.name || table.tableName,
      zone: table.zone,
      partySize: table.partySize || table.capacity,
      guestName: table.guest || table.guestName,
      customerMobile: table.customerMobile,
      orderSummary: table.orderSummary,
      orderedMenuItems: table.orderedMenuItems,
      checkInDate: table.checkInDate,
      checkInTime: table.checkInTime,
      status: table.status || "booked",
      notes: table.notes,
    },
    { storeType, storeId }
  );
};

// bookRoom: persist a hotel room booking. Matches by
// (kind='lodging', roomId) within the store scope.
export const bookRoom = async (room) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost(
    "/api/hotel/bookings",
    {
      kind: "lodging",
      roomId: room.id || room.roomId,
      roomNumber: room.number || room.roomNumber,
      guestName: room.guest || room.guestName,
      customerMobile: room.customerMobile,
      checkInDate: room.checkInDate,
      checkInTime: room.checkInTime,
      expectedCheckOut: room.expectedCheckOut,
      status: room.status || "booked",
      notes: room.notes,
    },
    { storeType, storeId }
  );
};

// checkout: free up a booking by reference id (kind + refId). Backend
// marks it checked_out without needing the row id.
export const checkoutBooking = async (kind, refId) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost(
    "/api/hotel/bookings/checkout-by-ref",
    { kind, refId, storeType, storeId },
    { storeType, storeId }
  );
};

export const getTables = async () => apiGet("/api/hotel/tables");
export const createTable = async (payload) => apiPost("/api/hotel/tables", payload);
export const updateTable = async (id, payload) => apiPut(`/api/hotel/tables/${id}`, payload);
export const deleteTable = async (id) => apiDelete(`/api/hotel/tables/${id}`);

export const getWaitingList = async () => apiGet("/api/hotel/waiting");
export const addWaiting = async (payload) => apiPost("/api/hotel/waiting", payload);
export const removeWaiting = async (id) => apiDelete(`/api/hotel/waiting/${id}`);

export const getDiningWaitingList = async () => apiGet("/api/hotel/dining-waiting");
export const addDiningWaiting = async (payload) => apiPost("/api/hotel/dining-waiting", payload);
export const removeDiningWaiting = async (id) => apiDelete(`/api/hotel/dining-waiting/${id}`);

export const getLodgingWaitingList = async () => apiGet("/api/hotel/lodging-waiting");
export const addLodgingWaiting = async (payload) => apiPost("/api/hotel/lodging-waiting", payload);
export const removeLodgingWaiting = async (id) => apiDelete(`/api/hotel/lodging-waiting/${id}`);

export const getCheckoutHistory = async () => apiGet("/api/hotel/checkout-history");
export const addCheckoutHistory = async (payload) =>
  apiPost("/api/hotel/checkout-history", payload);
export const clearCheckoutHistory = async () => apiDelete("/api/hotel/checkout-history");
export const deleteCheckoutHistoryEntry = async (id) =>
  apiDelete(`/api/hotel/checkout-history/${id}`);
export const getDiningBills = async () => apiGet("/api/hotel/dining-bills");
export const saveDiningBill = async (tableId, payload) =>
  apiPut(`/api/hotel/dining-bills/${encodeURIComponent(tableId)}`, payload);
export const clearDiningBill = async (tableId) =>
  apiDelete(`/api/hotel/dining-bills/${encodeURIComponent(tableId)}`);

// Hotel rooms — server-first CRUD. Mirrors the table pattern so the
// cashier's bookings are visible to other POS stations / devices within
// the same store. localStorage stays as an offline cache for booted-without-
// network scenarios.
export const getRooms = async () => apiGet("/api/hotel/rooms");
export const createRoom = async (payload) => apiPost("/api/hotel/rooms", payload);
export const updateRoom = async (id, payload) =>
  apiPut(`/api/hotel/rooms/${encodeURIComponent(id)}`, payload);
export const deleteRoom = async (id) => apiDelete(`/api/hotel/rooms/${encodeURIComponent(id)}`);
// `checkout` is a server-side marker that flips the room status to vacant
// and (optionally) records the checkout in the hotel_checkout_history.
export const checkoutRoom = async (id, payload = {}) =>
  apiPost(`/api/hotel/rooms/${encodeURIComponent(id)}/checkout`, payload);

// Hotel room folios — posted incidental charges (Room Service, Minibar, etc.)
// that the cashier rolls into the bill at checkout. Mirrors the read/write/clear
// pattern of the tables and rooms endpoints.
export const getRoomFolio = async (roomId) =>
  apiGet(`/api/hotel/rooms/${encodeURIComponent(roomId)}/folio`);
export const postRoomCharge = async (roomId, charge) =>
  apiPost(`/api/hotel/rooms/${encodeURIComponent(roomId)}/folio`, charge);
export const deleteRoomCharge = async (roomId, chargeId) =>
  apiDelete(`/api/hotel/rooms/${encodeURIComponent(roomId)}/folio/${encodeURIComponent(chargeId)}`);
export const clearRoomFolio = async (roomId) =>
  apiDelete(`/api/hotel/rooms/${encodeURIComponent(roomId)}/folio`);

// Hotel reservation code counter — daily-rolling RES-XXXX sequence.
export const getReservationCounter = async () => apiGet("/api/hotel/reservation-counter");
export const postReservationCounter = async (payload) =>
  apiPost("/api/hotel/reservation-counter", payload || {});

// Laundry token counter — daily-rolling LD-XXXX sequence (bag tag IDs).
// Falls back to a generic apiGet/apiPost so the same call shape works for
// both `get` and `post` against the laundry backend endpoints.
export const getLaundryTokenCounter = async () => apiGet("/api/laundry/token-counter");
export const postLaundryTokenCounter = async (payload) =>
  apiPost("/api/laundry/token-counter", payload || {});

// Laundry inventory ledger — append-only audit log of stock movements.
export const getLaundryLedger = async () => apiGet("/api/laundry/ledger");
export const postLaundryLedger = async (entry) => apiPost("/api/laundry/ledger", entry || {});
export const clearLaundryLedger = async () => apiDelete("/api/laundry/ledger");

export default {
  getTables,
  createTable,
  updateTable,
  deleteTable,
  getWaitingList,
  addWaiting,
  removeWaiting,
  getDiningWaitingList,
  addDiningWaiting,
  removeDiningWaiting,
  getLodgingWaitingList,
  addLodgingWaiting,
  removeLodgingWaiting,
  getCheckoutHistory,
  addCheckoutHistory,
  clearCheckoutHistory,
  deleteCheckoutHistoryEntry,
  getDiningBills,
  saveDiningBill,
  clearDiningBill,
  getRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  checkoutRoom,
  getRoomFolio,
  postRoomCharge,
  deleteRoomCharge,
  clearRoomFolio,
  getReservationCounter,
  postReservationCounter,
  getLaundryTokenCounter,
  postLaundryTokenCounter,
  getLaundryLedger,
  postLaundryLedger,
  clearLaundryLedger,
  // Hotel Store discount feature — coupon validation + management.
  // See db/schema/010_hotel_coupons.sql + server/index.js for the API
  // surface these functions bind to.
  validateCoupon,
  listCoupons,
  createCoupon,
  updateCoupon,
};

// === Hotel Coupons (Discount) =================================================
//
// Backs the Hotel Store discount feature on the cashier's Live Bill
// (manual % + coupon code, mutually exclusive). Validation runs
// cashier-side on every keystroke (so the cashier sees immediate
// feedback), and server-side at `POST /api/invoices` time (so a
// malicious client can't spoof the percent — `validateHotelDiscount`
// in `index.js` re-resolves the coupon row and overwrites the value).
//
// `validateCoupon` is intentionally NOT `isAuthed()`-guarded so a
// recently-timed-out session doesn't block the cashier from
// validating a code on the next page load. The backend endpoint
// `GET /api/hotel/coupons/:code` is also unauthenticated (it's a
// lookup, not a write; the cashier can't bypass anything because
// the only write-side discount validation runs server-side at save
// time, which IS authed).

// Cashier-facing coupon lookup. Returns the normalized
// `{ valid: true, code, type, value, label, minSubtotal }` payload
// from the server, or throws `{ valid: false, message }` if the
// code can't be resolved in scope. The caller is expected to
// `try/catch` and surface the error inline.
export const validateCoupon = async (code) => {
  if (!code) return { valid: false, message: "Enter a coupon code" };
  const { storeType, storeId } = getScope();
  try {
    const res = await apiGet(`/api/hotel/coupons/${encodeURIComponent(String(code).trim())}`, {
      storeType,
      storeId,
    });
    return { valid: true, ...(res || {}) };
  } catch (err) {
    // The backend returns 404 for unresolved codes — normalize that
    // to a friendly invalid-coupon message rather than letting the
    // raw fetch error bubble up.
    const message =
      err?.status === 404 || err?.body?.valid === false
        ? "Invalid coupon code"
        : err?.message || "Could not validate coupon";
    return { valid: false, message };
  }
};

// Settings UI — owner-only list. Caller must enforce role.
export const listCoupons = async () => {
  if (!isAuthed()) return [];
  const { storeType, storeId } = getScope();
  return apiGet("/api/hotel/coupons", { storeType, storeId });
};

// Settings UI — create.
export const createCoupon = async (payload) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPost("/api/hotel/coupons", payload || {}, { storeType, storeId });
};

// Settings UI — update (soft-delete via `active: false`).
export const updateCoupon = async (id, patch) => {
  if (!isAuthed()) throw new Error("Not signed in");
  const { storeType, storeId } = getScope();
  return apiPut(`/api/hotel/coupons/${encodeURIComponent(id)}`, patch || {}, {
    storeType,
    storeId,
  });
};
