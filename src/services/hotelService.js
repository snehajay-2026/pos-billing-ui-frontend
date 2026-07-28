import { apiGet, apiPost, apiPut, apiDelete } from "./api";

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
};
