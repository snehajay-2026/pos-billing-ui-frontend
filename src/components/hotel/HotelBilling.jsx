import React, { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { getProducts, updateProduct as updateProductStockApi } from "../../services/productService";
import { saveInvoice } from "../../services/invoiceService";
import { getUser } from "../../utils/auth";
import hotelService from "../../services/hotelService";
import { onRealtimeSyncEvent } from "../../services/realtimeSync";
import { useUi } from "../../context/UiContext";
import {
  FaBed,
  FaUtensils,
  FaChair,
  FaUserTie,
  FaPlus,
  FaTrash,
  FaReceipt,
  FaRupeeSign,
  FaDoorOpen,
  FaTable,
  FaCheckCircle,
  FaBroom,
  FaTimes,
  FaSyncAlt,
  FaCalendarAlt,
  FaSignInAlt,
  FaSignOutAlt,
  FaSearch,
  FaConciergeBell,
  FaArrowRight,
  FaShoppingCart,
  FaInfoCircle,
  FaExclamationTriangle,
  FaCreditCard,
  FaBoxOpen,
  FaCashRegister,
  FaCheck,
  FaLock,
} from "react-icons/fa";
import "./HotelBilling.css";
import ReactDOM from "react-dom/client";
import LodgingInvoice from "./LodgingInvoice";
import DiningInvoice from "./DiningInvoice";
import HotelThermalReceipt from "./HotelThermalReceipt";
import RoomCard from "./RoomCard";
import DiningTableCard from "./DiningTableCard";
import { computeOverstayCharge, resolveLodgingGstRate, syncOverstayIntoBill } from "./folio";
import { resolveHotelMenuCategories } from "./hotelMenuCategories";
import { getStoreSettings } from "../../services/storeSettingsService";
import { mergeSharedItemsIntoCart, replaceLodgingBillItem } from "./sharedCart";
import { recordCashSaleForShift, currentStoreNeedsShift } from "../../services/shiftService";
import OpenShiftDialog from "../shift/OpenShiftDialog";
import ShiftStatusBanner from "../shift/ShiftStatusBanner";
import { useShiftGate } from "../../hooks/useShiftGate";
import { useHotelModuleLock } from "../../hooks/useHotelModuleLock";
import HotelModuleLockScreen from "./HotelModuleLockScreen";

const TABLES_STORAGE_KEY = "hotel_table_booking_state";
const WAITING_QUEUE_KEY = "hotel_dining_waiting_list";
const CHECKOUT_HISTORY_STORAGE_KEY = "hotel_lodging_checkout_history";
const sanitizeGuestName = (value) =>
  String(value || "")
    .replace(/[^A-Za-z ]/g, "")
    .replace(/\s{2,}/g, " ");
const isValidGuestName = (value) => /^[A-Za-z]+(?: [A-Za-z]+)*$/.test(String(value || "").trim());
const defaultHotelTables = [
  { id: "T1", name: "Table 1", seats: 2, status: "empty" },
  { id: "T2", name: "Table 2", seats: 2, status: "empty" },
  { id: "T3", name: "Table 3", seats: 4, status: "empty" },
  { id: "T4", name: "Table 4", seats: 4, status: "empty" },
  { id: "T5", name: "Table 5", seats: 6, status: "empty" },
  { id: "T6", name: "Table 6", seats: 8, status: "empty" },
];

const normalizeDiningTables = (inputTables = []) => {
  const byKey = new Map();
  inputTables.forEach((table, index) => {
    if (!table || typeof table !== "object") return;
    const normalizedTable = {
      ...table,
      id: String(table.id != null ? table.id : table.name || ""),
      _persisted: table._persisted !== false,
    };
    const tableIdentity =
      table.id != null
        ? `id:${String(table.id)}`
        : `name:${String(table.name || "")
            .trim()
            .toLowerCase()}`;
    const rank = new Date(table.updatedAt || table.createdAt || 0).getTime() || index;
    const previous = byKey.get(tableIdentity);
    if (!previous || rank >= previous.rank) {
      byKey.set(tableIdentity, { value: normalizedTable, rank });
    }
  });
  return Array.from(byKey.values()).map((entry) => entry.value);
};

const flattenDiningBills = (bills = []) =>
  bills.flatMap((bill) => {
    const items = Array.isArray(bill.items) ? bill.items : [];
    const normalizedTableId = String(bill.tableId || "");
    return items.map((item, index) => ({
      ...item,
      id: item.id || `${normalizedTableId}-${item.name || "item"}-${index}`,
      type: "dining",
      qty: Number(item.qty || 1),
      rate: Number(item.rate || 0),
      total: Number(item.total || 0),
      gst: Number(item.gst || 0),
      meta: {
        ...(item.meta || {}),
        tableId: normalizedTableId,
        tableName: bill.tableName,
        guest: bill.guestName || item.meta?.guest || "",
        customerMobile: bill.customerMobile || item.meta?.customerMobile || "",
        partySize: bill.partySize || item.meta?.partySize || 0,
        checkInDate: bill.checkInDate || item.meta?.checkInDate || "",
        checkInTime: bill.checkInTime || item.meta?.checkInTime || "",
        checkOutTime: bill.checkOutTime || item.meta?.checkOutTime || "",
      },
    }));
  });

// Drop dining cart lines whose source table no longer has a booking or
// an open bill. Returns the SAME array reference when nothing changes
// so callers can short-circuit and skip the state update.
//
// Why this exists: when the cashier finishes a table (Clear Table +
// Generate Invoice), the server-side dining bill is deleted and the
// `diningBillsByTable[id]` entry is also removed. The local `items`
// cart, however, may still hold a copy of those lines (added when the
// items first landed in the bill). Without this sweep, the Dining tab
// badge keeps showing the stale count even though every active bill has
// been settled — a confusing UX especially right after closing out a
// table with 6 menu items.
//
// Rules:
//   - Keep a dining line when its tableId has an open bill (items > 0)
//     OR when its tableId is currently in `booked` status.
//   - Keep a dining line without a tableId (legacy / orphaned rows — we
//     never silently drop cashier-entered data).
//   - Keep every non-dining line.
export const pruneStaleDiningItems = (items, tables, diningBillsByTable) => {
  if (!Array.isArray(items) || items.length === 0) return items;
  const hasAnyDining = items.some((it) => it && it.type === "dining");
  if (!hasAnyDining) return items;
  const bookedTableIds = new Set(
    (Array.isArray(tables) ? tables : [])
      .filter((table) => String(table.status || "").toLowerCase() === "booked")
      .map((table) => String(table.id || ""))
  );
  const openBillTableIds = new Set(
    Object.keys(diningBillsByTable || {})
      .filter((tableId) => {
        const bill = diningBillsByTable[tableId];
        return bill && Array.isArray(bill.items) && bill.items.length > 0;
      })
      .map((tableId) => String(tableId))
  );
  const allowedTableIds = new Set([...bookedTableIds, ...openBillTableIds]);
  const next = items.filter((it) => {
    if (!it || it.type !== "dining") return true;
    const tableId = String(it.meta?.tableId || "");
    if (!tableId) return true;
    return allowedTableIds.has(tableId);
  });
  return next.length === items.length ? items : next;
};

const buildDiningBillsMap = (bills = []) =>
  bills.reduce((acc, bill) => {
    if (bill?.tableId == null) return acc;
    acc[String(bill.tableId)] = bill;
    return acc;
  }, {});

const summarizeDiningBillItems = (items = []) => {
  if (!Array.isArray(items) || !items.length) return "";
  return items.map((item) => `${Number(item.qty || 1)}x ${item.name || "Item"}`).join(", ");
};

const normalizeOrderedMenuItems = (table) => {
  if (Array.isArray(table?.orderedMenuItems) && table.orderedMenuItems.length) {
    return table.orderedMenuItems
      .map((item) => {
        if (!item) return null;
        if (typeof item === "string") {
          return { name: item, qty: 1 };
        }
        return {
          productId: item.productId || item.id || undefined,
          name: item.name || "Menu Item",
          category: item.category || "",
          qty: Math.max(1, Number(item.qty || 1)),
        };
      })
      .filter(Boolean);
  }

  const summary = String(table?.orderSummary || "").trim();
  if (!summary) return [];

  return summary
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => {
      const match = segment.match(/^(\d+)x\s+(.+)$/i);
      if (match) {
        return { name: match[2].trim(), qty: Math.max(1, Number(match[1] || 1)) };
      }
      return { name: segment, qty: 1 };
    });
};

const summarizeOrderedMenuItems = (items = []) => {
  if (!Array.isArray(items) || !items.length) return "";
  return items
    .map((item) => `${Math.max(1, Number(item.qty || 1))}x ${item.name || "Menu Item"}`)
    .join(", ");
};

const formatTime12Hour = (timeValue) => {
  const rawTime = String(timeValue || "").trim();
  if (!rawTime) return "";
  if (/am|pm/i.test(rawTime)) return rawTime.toUpperCase();

  const match = rawTime.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return rawTime;

  const hours = Number(match[1]);
  const minutes = match[2];
  if (Number.isNaN(hours)) return rawTime;

  const normalizedHour = ((hours % 24) + 24) % 24;
  const suffix = normalizedHour >= 12 ? "PM" : "AM";
  const hour12 = normalizedHour % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${minutes} ${suffix}`;
};

const getDiningProductVariants = (product) => {
  if (!product) return [];
  const variants = [];
  if (product.halfPrice !== null && product.halfPrice !== undefined && product.halfPrice !== "") {
    variants.push({ value: "half", label: "Half", price: Number(product.halfPrice || 0) });
  }
  if (product.fullPrice !== null && product.fullPrice !== undefined && product.fullPrice !== "") {
    variants.push({ value: "full", label: "Full", price: Number(product.fullPrice || 0) });
  }
  if (!variants.length) {
    variants.push({ value: "regular", label: "Regular", price: Number(product.price || 0) });
  }
  return variants;
};

const getDiningStockState = (product) => {
  // Missing/blank stock should NOT hide an item from the table booking picker.
  // Only treat a row as out-of-stock when stock is explicitly present and <= 0.
  const rawStock = product?.stock;
  const hasStockValue = rawStock !== undefined && rawStock !== null && rawStock !== "";
  const stock = Number(rawStock || 0);
  const limit = Number(product?.lowStockLimit || product?.limit || 0);
  if (hasStockValue && stock <= 0) return "out";
  if (limit > 0 && stock > 0 && stock <= limit) return "low";
  return "ok";
};

const buildLodgingBillItem = ({
  room,
  guest,
  customerMobile,
  nights,
  rate,
  notes,
  idProof,
  checkInDate,
  checkInTime,
  checkOutDate,
  checkOutTime,
  gst,
  source,
}) => {
  // Capture the GST that was selected by the cashier at booking time on the
  // bill item itself (`meta.gst` + `gst` field). The bill summary needs to
  // carry this value forward through checkout — even after the room record
  // is reset to vacant — so the printed invoice keeps the original tax rate
  // the cashier chose. Without this, the GST would silently fall back to 0
  // (because checkout resets `room.gst`) and the bill would lose its tax.
  const capturedGst = Number.isFinite(Number(gst)) ? Number(gst) : 0;
  // Snapshot the checkout date/time too, so the bill item stays consistent
  // with the room record after Edit Booking changes. The overstay
  // calculation in `computeOverstayCharge` reads from the room record, but
  // having the snapshot on `meta` lets any consumer (audit, history, a
  // future re-print) reconstruct the booking without the live room state.
  const capturedCheckOutDate = String(checkOutDate || "").trim();
  const capturedCheckOutTime = String(checkOutTime || "").trim();
  return {
    id: `lodging-booking-${room.id}`,
    name: `Room Booking - ${room.name}`,
    type: "lodging",
    qty: 1,
    rate: Number(rate || 0) * Number(nights || 1),
    gst: capturedGst,
    total: Number(rate || 0) * Number(nights || 1),
    meta: {
      roomId: room.id,
      roomName: room.name,
      guest: String(guest || "").trim(),
      customerMobile: String(customerMobile || "").trim(),
      notes: notes || "",
      idProof: idProof || undefined,
      nights: Number(nights || 1),
      roomRate: Number(rate || 0),
      roomAc: String(room.ac || "").trim(),
      roomModern: Boolean(room.modern),
      checkInDate,
      checkInTime,
      // Snapshot of the entered checkout — survives checkout and lets the
      // printed invoice carry the cashier's intended checkout time forward.
      checkOutDate: capturedCheckOutDate,
      checkOutTime: capturedCheckOutTime,
      // Snapshot of the GST rate selected at booking time. Survives checkout.
      gst: capturedGst,
    },
    source,
  };
};

// (merge helpers moved to ./sharedCart.js so they can be unit-tested in
// isolation and reused by other entry points if needed.)

// Merge a `hotel_shared_items` array into the current cart state.
// Used both for the storage-event handler and for the remount hydration path so
// they share one source of truth (and don't double up).
//
// Lodging rows are matched by `id`, NOT by `roomId`. The previous version
// keyed on `roomId`, which collapsed every lodging line for a given room
// (mergeSharedItemsIntoCart moved to ./sharedCart.js)

const defaultLodgingRooms = [
  {
    id: "R101",
    name: "Room 101",
    beds: 2,
    status: "vacant",
    guest: "",
    checkIn: "",
    nights: 1,
    members: 1,
    rate: 1200,
    notes: "",
    ac: "AC",
    modern: false,
  },
  {
    id: "R102",
    name: "Room 102",
    beds: 2,
    status: "vacant",
    guest: "",
    checkIn: "",
    nights: 1,
    members: 1,
    rate: 1200,
    notes: "",
    ac: "Non-AC",
    modern: false,
  },
  {
    id: "R201",
    name: "Room 201",
    beds: 3,
    status: "vacant",
    guest: "",
    checkIn: "",
    nights: 1,
    members: 1,
    rate: 1800,
    notes: "",
    ac: "AC",
    modern: true,
  },
  {
    id: "R301",
    name: "Room 301",
    beds: 4,
    status: "vacant",
    guest: "",
    checkIn: "",
    nights: 1,
    members: 1,
    rate: 2400,
    notes: "",
    ac: "AC",
    modern: false,
  },
];

const HotelBilling = () => {
  const [products, setProducts] = useState([]);
  const [tables, setTables] = useState([]);

  const [notes, setNotes] = useState("");
  // `setNotes` is currently unused — the cashier doesn't edit the bill notes
  // from this screen (notes come from the saved invoice). Kept here for future
  // expansion; ignore lint.
  // eslint-disable-next-line no-unused-vars
  void setNotes;
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [activeTab, setActiveTab] = useState("lodging");

  const [selectedProduct, setSelectedProduct] = useState("");
  const [selectedProductVariant, setSelectedProductVariant] = useState("regular");
  const [quantity, setQuantity] = useState(1);
  const [lodgingDescription, setLodgingDescription] = useState("");
  const [lodgingAmount, setLodgingAmount] = useState("");
  const [items, setItems] = useState([]);
  const [message, setMessage] = useState(null);
  const [lodgingRooms, setLodgingRooms] = useState([]);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);
  const [showSyncToast, setShowSyncToast] = useState(false);
  const [showQuickBookModal, setShowQuickBookModal] = useState(false);
  const [quickBookRoom, setQuickBookRoom] = useState(null);
  const [qbOpenDetails, setQbOpenDetails] = useState(null);
  const [selectedDiningTable, setSelectedDiningTable] = useState(null);
  const [diningGuestName, setDiningGuestName] = useState("");
  const [diningCustomerMobile, setDiningCustomerMobile] = useState("");
  const [diningPartySize, setDiningPartySize] = useState(1);
  // `diningOrderedMenu` is the legacy string summary for a dining bill's
  // menu items — replaced by `selectedDiningMenus` (structured list). The
  // setter is still called in the table-booking modal open/close paths so
  // any leftover callers stay in sync with the new structured state. Track
  // the value too so any future migration has a place to read it.
  const [, setDiningOrderedMenu] = useState("");
  const [selectedDiningMenus, setSelectedDiningMenus] = useState([]);
  const [selectedDiningMenuProductId, setSelectedDiningMenuProductId] = useState("");
  const [diningMenuSearch, setDiningMenuSearch] = useState("");
  const [diningGuestError, setDiningGuestError] = useState("");
  const [diningMobileError, setDiningMobileError] = useState("");
  const [isEditingDiningTable, setIsEditingDiningTable] = useState(false);
  const [editDiningTableName, setEditDiningTableName] = useState("");
  const [editDiningTableSeats, setEditDiningTableSeats] = useState(2);
  const [editDiningTableZone, setEditDiningTableZone] = useState("Main");
  const [waitingQueue, setWaitingQueue] = useState([]);
  const [activeDiningTableId, setActiveDiningTableId] = useState(null);
  const [diningTableSearch, setDiningTableSearch] = useState("");
  const [diningZoneFilter, setDiningZoneFilter] = useState("all");
  const [diningBillsByTable, setDiningBillsByTable] = useState({});
  const { showToast, activeStore } = useUi();
  const [qbGuestName, setQbGuestName] = useState("");
  const [qbCustomerMobile, setQbCustomerMobile] = useState("");
  const [qbNights, setQbNights] = useState(1);
  const [qbMembers, setQbMembers] = useState(1);
  const [qbNotes, setQbNotes] = useState("");
  const [qbIdType, setQbIdType] = useState("");
  const [qbIdNumber, setQbIdNumber] = useState("");
  const [qbRate, setQbRate] = useState("");
  const [qbGst, setQbGst] = useState("");
  const [qbCheckInDate, setQbCheckInDate] = useState("");
  const [qbCheckInTime, setQbCheckInTime] = useState("");
  const [qbSettings, setQbSettings] = useState(null);
  const [qbErrors, setQbErrors] = useState({
    guest: false,
    mobile: false,
    nights: false,
    members: false,
    rate: false,
    gst: false,
    idType: false,
    idNumber: false,
  });
  const [editingRoomErrors, setEditingRoomErrors] = useState({
    guest: false,
    mobile: false,
    nights: false,
    members: false,
    rate: false,
    gst: false,
    checkIn: false,
    checkOutDate: false,
    checkOutTime: false,
    idType: false,
    idNumber: false,
  });
  // feature flag: set to false to hide quick-edit UI. Can also hide by adding `no-quick-edit` class on <body>.
  const QUICK_EDIT_FEATURE = true;
  const quickEditEnabled =
    QUICK_EDIT_FEATURE &&
    !(typeof document !== "undefined" && document.body.classList.contains("no-quick-edit"));

  const user = getUser();
  const billedByDisplayName = user?.name?.trim() || user?.email || "unknown";

  // Mandatory shift gate: Branch Admin / Cashier must open a shift before
  // they can take cash sales in a cash-vertical store. SUPER_OWNER / ADMIN
  // bypass the gate. Hook also handles polling + auth events so the chip
  // stays in sync across tabs / sessions.
  const { openShiftDialog, refreshActiveShift, useMandatoryShiftDialogProps } = useShiftGate({
    force: true,
  });

  // Compute the dialog props once per render. HotelBilling has no early
  // return before JSX so this is safe to call inline, but we pull it out
  // for symmetry with the other billing pages.
  const mandatoryShiftDialogProps = useMandatoryShiftDialogProps();

  // Super-Owner-controlled module access. The Lodging and Dining
  // tabs respect the customer's lock state — locked tabs are hidden
  // and the matching form section is replaced with a lock screen.
  // The Live Bill panels (dining Live Bill KPI, dining table Live
  // Bill stat, lodging "Live Bill" items header) additionally
  // honour `liveBillLocked` from the same hook so the Super Owner
  // can independently disable just the live-bill display without
  // blocking normal Lodging/Dining operation.
  const hotelModuleLock = useHotelModuleLock();
  // The local `activeTab` state is restored from localStorage on mount
  // and may point to a now-locked module. Force a switch to an
  // unlocked tab on every render that detects a stale active tab.
  useEffect(() => {
    if (activeTab === "lodging" && hotelModuleLock.lodgingLocked && !hotelModuleLock.diningLocked) {
      setActiveTab("dining");
    } else if (
      activeTab === "dining" &&
      hotelModuleLock.diningLocked &&
      !hotelModuleLock.lodgingLocked
    ) {
      setActiveTab("lodging");
    }
  }, [activeTab, hotelModuleLock.lodgingLocked, hotelModuleLock.diningLocked]);

  // Holds the save payload when the OpenShiftDialog interrupted us.
  // Same pattern as POSBilling — we re-run the save after the shift opens.
  const pendingInvoiceRef = useRef(null);

  // persist last active POS tab across reloads
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("hotel_active_pos");
      if (saved === "lodging" || saved === "dining") setActiveTab(saved);
    } catch (err) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("hotel_active_pos", activeTab);
    } catch (err) {}
  }, [activeTab]);

  useEffect(() => {
    const load = async () => {
      try {
        const list = await getProducts();
        setProducts(Array.isArray(list) ? list : []);
      } catch (error) {
        console.error("Failed to load hotel products", error);
      }
    };
    load();

    const loadTables = async () => {
      try {
        const resp = await hotelService.getTables();
        if (Array.isArray(resp) && resp.length > 0) {
          setTables(normalizeDiningTables(resp));
          return;
        }
      } catch (error) {
        // fallback to local storage
      }
      const savedTables = window.localStorage.getItem(TABLES_STORAGE_KEY);
      if (savedTables) {
        try {
          const parsed = JSON.parse(savedTables);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setTables(normalizeDiningTables(parsed));
            return;
          }
        } catch (error) {
          // ignore and fallback
        }
      }
      setTables(defaultHotelTables);
    };
    loadTables();

    // Cross-device sync: overlay any active 'booked' dining tables from the
    // server onto the local state. The backend /api/hotel/bookings is the
    // source of truth — locally-cached state is used as a starting point
    // and any server-side booking is applied on top.
    const loadBookingsOverlay = async () => {
      try {
        const bookings = await hotelService.listBookings({ kind: "dining", status: "booked" });
        if (!Array.isArray(bookings) || bookings.length === 0) return;
        setTables((prev) => {
          const byId = new Map(prev.map((t) => [String(t.id), t]));
          bookings.forEach((b) => {
            const id = String(b.tableId || b.id);
            if (!id) return;
            const existing = byId.get(id) || { id: b.tableId, name: b.tableName || id };
            byId.set(id, {
              ...existing,
              id: b.tableId,
              name: b.tableName || existing.name,
              zone: b.zone || existing.zone,
              guest: b.guestName || existing.guest,
              customerMobile: b.customerMobile || existing.customerMobile,
              partySize: b.partySize || existing.partySize,
              orderSummary: b.orderSummary || existing.orderSummary,
              orderedMenuItems: b.orderedMenuItems || existing.orderedMenuItems,
              checkInDate: b.checkInDate || existing.checkInDate,
              checkInTime: b.checkInTime || existing.checkInTime,
              status: "booked",
              _persisted: true,
              _bookedAt: b.updatedAt || b.createdAt,
            });
          });
          return Array.from(byId.values());
        });
      } catch {
        /* network blip on initial mount — keep local state */
      }
    };
    loadBookingsOverlay();
    const loadDiningBills = async () => {
      try {
        const bills = await hotelService.getDiningBills();
        if (Array.isArray(bills)) {
          setDiningBillsByTable(buildDiningBillsMap(bills));
          setItems((prev) => [
            ...prev.filter((item) => item.type !== "dining"),
            ...flattenDiningBills(bills),
          ]);
        }
      } catch (err) {
        console.warn("Failed to load dining bills", err);
      }
    };
    loadDiningBills();
    try {
      const savedWaiting = window.localStorage.getItem(WAITING_QUEUE_KEY);
      if (savedWaiting) {
        const parsedWaiting = JSON.parse(savedWaiting);
        if (Array.isArray(parsedWaiting)) setWaitingQueue(parsedWaiting);
      }
    } catch (err) {
      // ignore
    }
    // ON REMOUNT: re-hydrate the lodging bill from the shared-items store.
    // The previous version did `localStorage.removeItem('hotel_shared_items')` here,
    // which silently cleared the cart every time the user navigated away from
    // /pos and came back. We now keep the data and let the storage event handler
    // merge it into the existing cart state below.
    try {
      const savedShared = window.localStorage.getItem("hotel_shared_items");
      if (savedShared) {
        const parsed = JSON.parse(savedShared);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setItems((prev) => mergeSharedItemsIntoCart(prev, parsed));
        }
      }
    } catch (err) {
      console.warn("Failed to hydrate hotel_shared_items on mount", err);
    }
    // load lodging rooms so billing shows the same cards across devices.
    // Server-first (server has the canonical view); localStorage only seeded
    // synchronously below for instant render — the async overwrite merges in
    // the server response without flickering.
    try {
      const savedRooms = window.localStorage.getItem("hotel_lodging_rooms");
      if (savedRooms) {
        const parsed = JSON.parse(savedRooms);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLodgingRooms(parsed);
        } else {
          setLodgingRooms(defaultLodgingRooms);
        }
      } else {
        setLodgingRooms(defaultLodgingRooms);
      }
    } catch (err) {
      console.warn("Failed to seed lodging rooms from localStorage", err);
      setLodgingRooms(defaultLodgingRooms);
    }

    const loadRooms = async () => {
      try {
        const resp = await hotelService.getRooms();
        if (Array.isArray(resp) && resp.length > 0) {
          const normalized = resp;
          setLodgingRooms(normalized);
          // Re-cache locally so the next mount (with the network down)
          // still has the most recent view.
          try {
            window.localStorage.setItem("hotel_lodging_rooms", JSON.stringify(normalized));
          } catch (e) {
            /* quota / private mode */
          }
        }
      } catch (err) {
        // Network error / 404 / 500 — keep the localStorage seed we just
        // loaded above. The cashier still sees rooms in offline mode.
        console.warn("Failed to sync lodging rooms from server", err);
      }
    };
    loadRooms();

    // Cross-device sync: overlay any active 'booked' lodging rooms from
    // the server onto the local state. /api/hotel/bookings is the source
    // of truth — multiple devices in the same store see each other's
    // bookings.
    const loadRoomBookingsOverlay = async () => {
      try {
        const bookings = await hotelService.listBookings({ kind: "lodging", status: "booked" });
        if (!Array.isArray(bookings) || bookings.length === 0) return;
        setLodgingRooms((prev) => {
          const byKey = new Map(prev.map((r) => [String(r.id || r.roomId || r.number), r]));
          bookings.forEach((b) => {
            const key = String(b.roomId || b.roomNumber);
            if (!key) return;
            const existing = byKey.get(key) || { id: key, number: b.roomNumber || key };
            byKey.set(key, {
              ...existing,
              id: b.roomId || existing.id,
              number: b.roomNumber || existing.number || key,
              guest: b.guestName || existing.guest,
              customerMobile: b.customerMobile || existing.customerMobile,
              checkInDate: b.checkInDate || existing.checkInDate,
              checkInTime: b.checkInTime || existing.checkInTime,
              expectedCheckOut: b.expectedCheckOut || existing.expectedCheckOut,
              status: "booked",
              _persisted: true,
              _bookedAt: b.updatedAt || b.createdAt,
            });
          });
          return Array.from(byKey.values());
        });
      } catch {
        /* network blip on initial mount — keep local state */
      }
    };
    loadRoomBookingsOverlay();
  }, [activeStore]);

  // Real-time sync listener — merges incoming SSE events into the local
  // tables / rooms state so a booking made on another device shows up
  // instantly on this one.
  useEffect(() => {
    const unsub = onRealtimeSyncEvent((detail) => {
      const event = detail?.event;
      if (!event) return;

      // Booking upserted (created or updated) — merge into tables or rooms.
      if (event.kind === "booking" && event.booking) {
        const b = event.booking;
        if (b.kind === "dining") {
          setTables((prev) => {
            const byId = new Map(prev.map((t) => [String(t.id), t]));
            const id = String(b.tableId || b.id);
            const existing = byId.get(id) || { id };
            byId.set(id, {
              ...existing,
              id: b.tableId || b.id,
              name: b.tableName || existing.name,
              zone: b.zone || existing.zone,
              guest: b.guestName || existing.guest,
              customerMobile: b.customerMobile || existing.customerMobile,
              partySize: b.partySize || existing.partySize,
              orderSummary: b.orderSummary || existing.orderSummary,
              orderedMenuItems: b.orderedMenuItems || existing.orderedMenuItems,
              status: event.action === "checked_out" ? "available" : "booked",
              _persisted: true,
            });
            return Array.from(byId.values());
          });
        } else if (b.kind === "lodging") {
          setLodgingRooms((prev) => {
            const byKey = new Map(prev.map((r) => [String(r.id || r.roomId || r.number), r]));
            const key = String(b.roomId || b.roomNumber);
            const existing = byKey.get(key) || { id: key };
            byKey.set(key, {
              ...existing,
              id: b.roomId || existing.id,
              number: b.roomNumber || existing.number,
              guest: b.guestName || existing.guest,
              customerMobile: b.customerMobile || existing.customerMobile,
              checkInDate: b.checkInDate || existing.checkInDate,
              checkInTime: b.checkInTime || existing.checkInTime,
              expectedCheckOut: b.expectedCheckOut || existing.expectedCheckOut,
              status: event.action === "checked_out" ? "available" : "booked",
              _persisted: true,
            });
            return Array.from(byKey.values());
          });
        }
      }

      // Live bill updated — mark the table as having an active bill.
      if (event.kind === "live_bill") {
        const d = event.data;
        if (event.action === "live_bill_updated" && d?.tableId) {
          setTables((prev) =>
            prev.map((t) =>
              String(t.id) === String(d.tableId) ? { ...t, bill: d.bill, hasLiveBill: true } : t
            )
          );
        }
        if (event.action === "live_bill_cleared" && d?.tableId) {
          setTables((prev) =>
            prev.map((t) =>
              String(t.id) === String(d.tableId) ? { ...t, bill: null, hasLiveBill: false } : t
            )
          );
        }
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (!e || !e.key) return;
      try {
        if (e.key === TABLES_STORAGE_KEY) {
          const parsed = JSON.parse(e.newValue || "[]");
          if (Array.isArray(parsed)) setTables(normalizeDiningTables(parsed));
        }
        if (e.key === "hotel_lodging_rooms") {
          const parsed = JSON.parse(e.newValue || "[]");
          if (Array.isArray(parsed)) setLodgingRooms(parsed);
        }
        if (e.key === "hotel_shared_items") {
          const shared = JSON.parse(e.newValue || "[]");
          if (Array.isArray(shared) && shared.length > 0) {
            setItems((prev) => mergeSharedItemsIntoCart(prev, shared));
          } else if (Array.isArray(shared) && shared.length === 0) {
            // Shared store was emptied (e.g. after a successful save). Drop our
            // lodging rows so the cart actually clears; keep other items.
            setItems((prev) =>
              prev.filter((p) => !(p && p.type === "lodging" && p.meta && p.meta.roomId))
            );
          }
        }
      } catch (err) {
        // ignore
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // same-tab listeners (CustomEvent) for instant sync without relying on storage events
  // One effect for all shared-listener bookkeeping so handler scopes stay correct.
  // `openQuickBook` is intentionally excluded from deps: it's recreated every
  // render and we only want to register these window listeners once at mount.
  // eslint-disable react-hooks/exhaustive-deps
  // `openQuickBook` is intentionally excluded from deps: it's recreated every
  // render and we only want to register these window listeners once at mount.
  // The listener captures the latest `openQuickBook` from its enclosing scope.
  useEffect(() => {
    const onSharedEvent = (e) => {
      try {
        const shared =
          e.detail || JSON.parse(window.localStorage.getItem("hotel_shared_items") || "[]");
        if (Array.isArray(shared) && shared.length > 0) {
          setItems((prev) => mergeSharedItemsIntoCart(prev, shared));
          setActiveTab("lodging");
        }
      } catch (err) {
        // ignore
      }
    };

    const onRoomsEvent = (e) => {
      try {
        const rooms =
          e.detail || JSON.parse(window.localStorage.getItem("hotel_lodging_rooms") || "[]");
        if (Array.isArray(rooms)) setLodgingRooms(rooms);
      } catch (err) {
        // ignore
      }
    };

    const onTablesEvent = (e) => {
      try {
        const nextTables =
          e.detail || JSON.parse(window.localStorage.getItem(TABLES_STORAGE_KEY) || "[]");
        if (Array.isArray(nextTables)) setTables(normalizeDiningTables(nextTables));
      } catch (err) {
        // ignore
      }
    };

    const onWaitingListEvent = (e) => {
      try {
        const list = e.detail || JSON.parse(window.localStorage.getItem(WAITING_QUEUE_KEY) || "[]");
        if (Array.isArray(list)) setWaitingQueue(list);
      } catch (err) {
        // ignore
      }
    };

    const onQuickBookEvent = (e) => {
      try {
        const id = e?.detail?.roomId || e?.detail?.id;
        if (id) openQuickBook(id, e?.detail || {});
      } catch (err) {}
    };

    window.addEventListener("hotel_shared_items_updated", onSharedEvent);
    window.addEventListener("hotel_lodging_rooms_updated", onRoomsEvent);
    window.addEventListener("hotel_table_booking_updated", onTablesEvent);
    window.addEventListener("hotel_dining_waiting_list_updated", onWaitingListEvent);
    window.addEventListener("hotel_quick_book", onQuickBookEvent);
    return () => {
      window.removeEventListener("hotel_shared_items_updated", onSharedEvent);
      window.removeEventListener("hotel_lodging_rooms_updated", onRoomsEvent);
      window.removeEventListener("hotel_table_booking_updated", onTablesEvent);
      window.removeEventListener("hotel_dining_waiting_list_updated", onWaitingListEvent);
      window.removeEventListener("hotel_quick_book", onQuickBookEvent);
    };
    // eslint-enable react-hooks/exhaustive-deps
  }, [setActiveTab]);

  const syncDiningTables = (nextTables) => {
    const normalizedTables = normalizeDiningTables(nextTables);
    setTables(normalizedTables);
    try {
      window.localStorage.setItem(TABLES_STORAGE_KEY, JSON.stringify(normalizedTables));
      window.dispatchEvent(
        new CustomEvent("hotel_table_booking_updated", { detail: normalizedTables })
      );
    } catch (err) {
      // ignore
    }
  };

  const applyDiningBillLocally = (table, nextDiningItems) => {
    const normalizedTableId = String(table.id || "");
    const normalizedItems = nextDiningItems.map((item, index) => ({
      ...item,
      id: item.id || `${normalizedTableId}-${item.name || "item"}-${index}`,
      type: "dining",
      qty: Number(item.qty || 1),
      rate: Number(item.rate || 0),
      total: Number(item.total || 0),
      gst: Number(item.gst || 0),
      meta: {
        ...(item.meta || {}),
        tableId: normalizedTableId,
        tableName: table.name,
        guest: table.guest || "",
        customerMobile: table.customerMobile || "",
        partySize: table.partySize || 0,
        checkInDate: table.checkInDate || "",
        checkInTime: table.checkInTime || "",
      },
    }));

    setItems((prev) => [
      ...prev.filter(
        (item) => !(item.type === "dining" && String(item.meta?.tableId) === normalizedTableId)
      ),
      ...normalizedItems,
    ]);
    setDiningBillsByTable((prev) => {
      const next = { ...prev };
      if (!normalizedItems.length) {
        delete next[normalizedTableId];
        return next;
      }
      next[normalizedTableId] = {
        ...(prev[normalizedTableId] || {}),
        tableId: normalizedTableId,
        tableName: table.name,
        guestName: table.guest || "",
        customerMobile: table.customerMobile || "",
        partySize: table.partySize || 0,
        checkInDate: table.checkInDate || "",
        checkInTime: table.checkInTime || "",
        checkOutTime: table.checkOutTime || "",
        items: normalizedItems,
        openItemCount: normalizedItems.reduce((sum, item) => sum + Number(item.qty || 0), 0),
        totalAmount: normalizedItems.reduce((sum, item) => sum + Number(item.total || 0), 0),
        status: normalizedItems.length ? "open" : "closed",
        updatedAt: new Date().toISOString(),
      };
      return next;
    });
  };

  const persistDiningBill = async (table, nextDiningItems) => {
    if (!table?.id) return false;
    applyDiningBillLocally(table, nextDiningItems);
    try {
      const normalizedTableId = String(table.id || "");
      if (!nextDiningItems.length) {
        await hotelService.clearDiningBill(normalizedTableId);
        return true;
      }
      const saved = await hotelService.saveDiningBill(normalizedTableId, {
        tableId: normalizedTableId,
        tableName: table.name,
        guestName: table.guest || "",
        customerMobile: table.customerMobile || "",
        partySize: table.partySize || 0,
        checkInDate: table.checkInDate || "",
        checkInTime: table.checkInTime || "",
        checkOutTime: table.checkOutTime || "",
        items: nextDiningItems.map((item) => ({
          ...item,
          type: "dining",
          meta: {
            ...(item.meta || {}),
            tableId: normalizedTableId,
            tableName: table.name,
            guest: table.guest || "",
            customerMobile: table.customerMobile || "",
            partySize: table.partySize || 0,
            checkInDate: table.checkInDate || "",
            checkInTime: table.checkInTime || "",
            checkOutTime: table.checkOutTime || item.meta?.checkOutTime || "",
          },
        })),
      });
      if (saved) {
        setDiningBillsByTable((prev) => ({ ...prev, [normalizedTableId]: saved }));
        setItems((prev) => [
          ...prev.filter(
            (item) => !(item.type === "dining" && String(item.meta?.tableId) === normalizedTableId)
          ),
          ...flattenDiningBills([saved]),
        ]);
      }
      return true;
    } catch (err) {
      console.warn("Failed to sync dining bill", err);
      showToast("error", "Bill Items updated locally. Server sync failed.");
      return true;
    }
  };

  const openDiningTableBooking = (table) => {
    if (!table) return;
    const orderedMenuItems = normalizeOrderedMenuItems(table);
    setIsEditingDiningTable(false);
    setSelectedDiningTable(table);
    setDiningGuestName(sanitizeGuestName(table.guest || ""));
    setDiningCustomerMobile(table.customerMobile || "");
    setDiningPartySize(table.partySize || 1);
    setSelectedDiningMenus(orderedMenuItems);
    setSelectedDiningMenuProductId("");
    setDiningOrderedMenu(summarizeOrderedMenuItems(orderedMenuItems) || table.orderSummary || "");
    setDiningGuestError("");
    setDiningMobileError("");
    setEditDiningTableName(table.name || "");
    setEditDiningTableSeats(Number(table.seats || 2));
    setEditDiningTableZone(table.zone || "Main");
    setMessage(null);
  };

  const openDiningTableEdit = (table) => {
    if (!table) return;
    const orderedMenuItems = normalizeOrderedMenuItems(table);
    setIsEditingDiningTable(true);
    setSelectedDiningTable(table);
    setDiningGuestName(sanitizeGuestName(table.guest || ""));
    setDiningCustomerMobile(table.customerMobile || "");
    setDiningPartySize(table.partySize || 1);
    setSelectedDiningMenus(orderedMenuItems);
    setSelectedDiningMenuProductId("");
    setDiningOrderedMenu(summarizeOrderedMenuItems(orderedMenuItems) || table.orderSummary || "");
    setDiningGuestError("");
    setDiningMobileError("");
    setEditDiningTableName(table.name || "");
    setEditDiningTableSeats(Number(table.seats || 2));
    setEditDiningTableZone(table.zone || "Main");
    setMessage(null);
  };

  const closeDiningTableBooking = () => {
    setSelectedDiningTable(null);
    setIsEditingDiningTable(false);
    setDiningGuestName("");
    setDiningCustomerMobile("");
    setDiningPartySize(1);
    setDiningOrderedMenu("");
    setSelectedDiningMenus([]);
    setSelectedDiningMenuProductId("");
    setDiningGuestError("");
    setDiningMobileError("");
    setEditDiningTableName("");
    setEditDiningTableSeats(2);
    setEditDiningTableZone("Main");
  };

  const handleDiningTableBook = async () => {
    if (!selectedDiningTable) return;
    const sanitizedDiningGuestName = sanitizeGuestName(diningGuestName).trim();
    const invalidGuestName =
      !sanitizedDiningGuestName || !isValidGuestName(sanitizedDiningGuestName);
    const invalidMobileNumber = !/^\d{10}$/.test(diningCustomerMobile.trim());
    if (invalidGuestName) {
      setDiningGuestError("Guest name must contain only letters and spaces.");
    }
    if (invalidMobileNumber) {
      setDiningMobileError(
        diningCustomerMobile.trim()
          ? "Mobile number must be exactly 10 digits."
          : "Enter mobile number to book the table."
      );
    }
    if (invalidGuestName || invalidMobileNumber) {
      showToast(
        "error",
        invalidGuestName && invalidMobileNumber
          ? "Enter a valid guest name and a valid 10-digit mobile number to confirm booking."
          : invalidGuestName
            ? "Guest name must contain only letters and spaces."
            : diningCustomerMobile.trim()
              ? "Mobile number must be exactly 10 digits."
              : "Enter mobile number to confirm booking."
      );
      return;
    }
    setDiningGuestError("");
    setDiningMobileError("");
    const maxSeats = Number(selectedDiningTable.seats || 1);
    if (!diningPartySize || diningPartySize < 1 || diningPartySize > maxSeats) {
      setMessage({ type: "error", text: `Party size must be between 1 and ${maxSeats}.` });
      return;
    }

    const orderSummary = summarizeOrderedMenuItems(selectedDiningMenus);
    const selectedDiningTableId = String(selectedDiningTable.id || "");
    const bookingTimestamp = new Date();
    const resolvedCheckInDate =
      isEditingDiningTable && selectedDiningTable.checkInDate
        ? selectedDiningTable.checkInDate
        : bookingTimestamp.toISOString().slice(0, 10);
    const resolvedCheckInTime =
      isEditingDiningTable && selectedDiningTable.checkInTime
        ? selectedDiningTable.checkInTime
        : formatTime12Hour(
            `${String(bookingTimestamp.getHours()).padStart(2, "0")}:${String(bookingTimestamp.getMinutes()).padStart(2, "0")}`
          );
    const nextTables = tables.map((table) =>
      String(table.id) === selectedDiningTableId
        ? {
            ...table,
            name: isEditingDiningTable ? editDiningTableName.trim() : table.name,
            seats: isEditingDiningTable
              ? Number(editDiningTableSeats || table.seats || 2)
              : table.seats,
            zone: isEditingDiningTable ? editDiningTableZone : table.zone,
            status: "booked",
            guest: sanitizedDiningGuestName,
            customerMobile: diningCustomerMobile.trim(),
            partySize: Number(diningPartySize),
            orderSummary,
            orderedMenuItems: selectedDiningMenus,
            checkInDate: resolvedCheckInDate,
            checkInTime: resolvedCheckInTime,
          }
        : table
    );
    syncDiningTables(nextTables);
    setActiveDiningTableId(selectedDiningTableId);
    const updatedTable = nextTables.find((table) => String(table.id) === selectedDiningTableId);
    const existingBill = diningBillsByTable[selectedDiningTableId];
    if (updatedTable && existingBill?.items?.length) {
      persistDiningBill(updatedTable, existingBill.items);
    }
    setMessage({
      type: "success",
      text: `${(isEditingDiningTable ? editDiningTableName : selectedDiningTable.name) || selectedDiningTable.name} booked for ${sanitizedDiningGuestName}.`,
    });
    closeDiningTableBooking();
    try {
      // Persist the booking to MySQL via /api/hotel/bookings (the legacy
      // PUT /api/hotel/tables/:id endpoint was a 501 catch-all — this
      // call now reaches the real backend).
      await hotelService.bookTable({
        id: selectedDiningTable.id,
        name: isEditingDiningTable ? editDiningTableName : selectedDiningTable.name,
        zone: isEditingDiningTable ? editDiningTableZone : selectedDiningTable.zone,
        partySize: Number(diningPartySize),
        guest: sanitizedDiningGuestName,
        customerMobile: diningCustomerMobile.trim(),
        orderSummary,
        orderedMenuItems: selectedDiningMenus,
        checkInDate: resolvedCheckInDate,
        checkInTime: resolvedCheckInTime,
        status: "booked",
      });
    } catch (err) {
      showToast("error", "Failed to sync table booking to server.");
    }
  };

  const handleDiningTableClear = async (tableId) => {
    const normalizedTableId = String(tableId);
    const sourceTable = tables.find((table) => String(table.id) === normalizedTableId);
    if (!sourceTable) return;
    const existingBill = diningBillsByTable[normalizedTableId];
    const existingBillItems = Array.isArray(existingBill?.items) ? existingBill.items : [];
    const orderedMenuItems = normalizeOrderedMenuItems(sourceTable);
    const clearTimestamp = new Date();
    const checkOutTime = formatTime12Hour(
      `${String(clearTimestamp.getHours()).padStart(2, "0")}:${String(clearTimestamp.getMinutes()).padStart(2, "0")}`
    );
    const orderedMenuBillEntries = [];

    for (const orderedItem of orderedMenuItems) {
      const matchingProduct = products.find((product) => {
        if (orderedItem.productId) {
          return String(product.id) === String(orderedItem.productId);
        }
        return (
          String(product.name || "")
            .trim()
            .toLowerCase() ===
          String(orderedItem.name || "")
            .trim()
            .toLowerCase()
        );
      });

      if (!matchingProduct) {
        setMessage({
          type: "error",
          text: `${orderedItem.name || "Booked menu item"} is missing from Hotel Menu, so the table cannot be cleared into billing yet.`,
        });
        return;
      }

      const existingQty = existingBillItems
        .filter((item) => {
          const sameProductId =
            orderedItem.productId &&
            item.meta?.productId &&
            String(item.meta.productId) === String(orderedItem.productId);
          const sameName =
            String(item.name || "")
              .replace(/\s*\([^)]*\)\s*$/, "")
              .trim()
              .toLowerCase() ===
            String(orderedItem.name || "")
              .trim()
              .toLowerCase();
          return sameProductId || sameName;
        })
        .reduce((sum, item) => sum + Number(item.qty || 0), 0);

      const qtyToAdd = Math.max(0, Number(orderedItem.qty || 0) - existingQty);
      if (qtyToAdd <= 0) continue;

      orderedMenuBillEntries.push({
        orderedItem,
        product: matchingProduct,
        qtyToAdd,
      });
    }

    const deductedStock = [];
    for (const entry of orderedMenuBillEntries) {
      if (Number(entry.product.stock || 0) < entry.qtyToAdd) {
        setMessage({
          type: "error",
          text: `Only ${Number(entry.product.stock || 0)} unit(s) available for ${entry.product.name}. Clear the table after updating the bill or stock.`,
        });
        return;
      }

      const stockResult = await syncProductStock(entry.product, -entry.qtyToAdd);
      if (!stockResult.ok) {
        for (const rollbackEntry of deductedStock.reverse()) {
          await syncProductStock(rollbackEntry.product, rollbackEntry.qty);
        }
        setMessage({
          type: "error",
          text: `Failed to move ${entry.product.name} into Bill Items.`,
        });
        return;
      }

      deductedStock.push({
        product: stockResult.product || entry.product,
        qty: entry.qtyToAdd,
      });
    }

    const generatedBillItems = orderedMenuBillEntries.map((entry, index) => {
      const itemRate = Number(entry.product.fullPrice || entry.product.price || 0);
      const itemName =
        String(entry.orderedItem.name || entry.product.name || "").trim() ||
        String(entry.product.name || "").trim();
      const itemCategory = String(
        entry.orderedItem.category || entry.product.category || "Dining"
      ).trim();
      const itemProductId = entry.orderedItem.productId || entry.product.id;
      const normalizedTableId = String(sourceTable.id || "");
      return {
        id: `${normalizedTableId}-${itemProductId || itemName}-clear-${Date.now()}-${index}`,
        name: itemName,
        type: "dining",
        qty: entry.qtyToAdd,
        rate: itemRate,
        gst: Number(entry.product.gst || 0),
        total: entry.qtyToAdd * itemRate,
        category: itemCategory || "Dining",
        meta: {
          tableId: normalizedTableId,
          checkOutTime,
          productId: itemProductId,
          variant: String(entry.orderedItem.variant || "regular"),
          variantLabel: String(
            entry.orderedItem.variantLabel ||
              (entry.orderedItem.variant === "half" ? "Half" : "Regular")
          ),
          source: "clear-table-booking-menu",
        },
      };
    });

    const nextDiningItems = [...existingBillItems, ...generatedBillItems];
    let persisted = true;
    if (nextDiningItems.length) {
      persisted = await persistDiningBill({ ...sourceTable, checkOutTime }, nextDiningItems);
      if (!persisted) {
        for (const rollbackEntry of deductedStock.reverse()) {
          await syncProductStock(rollbackEntry.product, rollbackEntry.qty);
        }
        setMessage({ type: "error", text: "Failed to move the table menu into Bill Items." });
        return;
      }
    }

    const hasPendingDiningBill = nextDiningItems.length > 0;
    const nextTables = tables.map((table) =>
      String(table.id) === normalizedTableId
        ? {
            ...table,
            status: "empty",
            guest: "",
            customerMobile: "",
            partySize: 0,
            orderSummary: "",
            orderedMenuItems: [],
            checkInDate: undefined,
            checkInTime: undefined,
            checkOutTime,
          }
        : table
    );
    syncDiningTables(nextTables);
    if (String(selectedDiningTable?.id) === normalizedTableId) closeDiningTableBooking();
    if (hasPendingDiningBill) {
      setActiveTab("dining");
      setActiveDiningTableId(normalizedTableId);
    } else if (String(activeDiningTableId) === normalizedTableId) {
      setActiveDiningTableId(null);
    }
    setMessage({
      type: "success",
      text: hasPendingDiningBill
        ? "Dining table cleared. This table menu is now available in Bill Items for billing and settlement."
        : "Dining table cleared and marked available.",
    });
    try {
      if (!hasPendingDiningBill) {
        await hotelService.clearDiningBill(tableId);
      }
      await hotelService.updateTable(tableId, {
        status: "empty",
        guest: "",
        customerMobile: "",
        partySize: 0,
        orderSummary: "",
        orderedMenuItems: [],
        checkInDate: undefined,
        checkInTime: undefined,
        checkOutTime,
      });
    } catch (err) {
      showToast("error", "Failed to sync table clear to server.");
    }
  };

  const handleDiningTableDelete = async (tableId) => {
    const normalizedTableId = String(tableId || "");
    const existingBill = diningBillsByTable[normalizedTableId];
    const nextTables = tables.filter((table) => String(table.id) !== normalizedTableId);
    syncDiningTables(nextTables);
    if (String(selectedDiningTable?.id) === normalizedTableId) closeDiningTableBooking();
    if (String(activeDiningTableId) === normalizedTableId) {
      setActiveDiningTableId(null);
    }
    applyDiningBillLocally(
      {
        id: normalizedTableId,
        name: "",
        guest: "",
        partySize: 0,
        checkInDate: "",
        checkInTime: "",
      },
      []
    );
    setMessage({ type: "success", text: "Dining table deleted successfully." });
    try {
      if (Array.isArray(existingBill?.items)) {
        for (const billItem of existingBill.items) {
          const sourceProduct = products.find(
            (product) => String(product.id) === String(billItem.meta?.productId)
          );
          if (sourceProduct) {
            await syncProductStock(sourceProduct, Number(billItem.qty || 0));
          }
        }
      }
      await hotelService.clearDiningBill(tableId);
      await hotelService.deleteTable(tableId);
    } catch (err) {
      showToast("error", "Failed to delete table from server.");
    }
  };

  const releaseDiningTableAfterBilling = async (tableId) => {
    if (!tableId) return;
    const normalizedTableId = String(tableId);
    // Capture checkout time when table is cleared
    const checkOutTime = new Date().toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const nextTables = tables.map((table) =>
      String(table.id) === normalizedTableId
        ? {
            ...table,
            status: "empty",
            guest: "",
            customerMobile: "",
            partySize: 0,
            orderSummary: "",
            orderedMenuItems: [],
            checkInDate: undefined,
            checkInTime: undefined,
            checkOutTime,
          }
        : table
    );

    syncDiningTables(nextTables);
    if (String(activeDiningTableId) === normalizedTableId) {
      setActiveDiningTableId(null);
    }
    if (String(selectedDiningTable?.id) === normalizedTableId) {
      closeDiningTableBooking();
    }

    await hotelService.clearDiningBill(tableId);
    applyDiningBillLocally(
      {
        id: tableId,
        name: "",
        guest: "",
        partySize: 0,
        checkInDate: "",
        checkInTime: "",
        checkOutTime,
      },
      []
    );
    await hotelService.updateTable(tableId, {
      checkOutTime,
      status: "empty",
      guest: "",
      customerMobile: "",
      partySize: 0,
      orderSummary: "",
      orderedMenuItems: [],
      checkInDate: undefined,
      checkInTime: undefined,
    });
  };

  // ----- Date / checkout helpers (used by both Quick Book & Edit Modal) -----
  //
  // The "Nights ↔ Check-out date" pair is bidirectional: changing one auto-
  // updates the other so the values stay in sync across the Edit Modal, the
  // Room Card, the Live Bill, and the printed Invoice. This mirrors the
  // Quick Book auto-fill (checkInDate + nights @ standard checkout time).
  //
  // Example:
  //   Check-in = 16-07-2026 12:00 PM
  //   Nights   = 1 (so Check-out = 17-07-2026 11:00 AM)
  //   Cashier edits Check-out date to 18-07-2026 (guest actually stayed one
  //   extra night) → Nights auto-updates to 2.
  //
  // Or the reverse:
  //   Cashier edits Nights from 1 → 2 → Check-out date auto-updates to
  //   18-07-2026 (CheckInDate + 2 nights).
  //
  // The "add 1 night when checkout time crosses past standard checkout" rule
  // is intentionally NOT applied here — the cashier types the checkout time
  // they want, and Extra Hours Charges handles any overstay on top of the
  // scheduled checkout. This matches the user's spec: "Extra Hours = Actual
  // − Expected, never Stay Total × Rate."
  const ymdOf = (d) => {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const diffNights = (checkInDate, checkOutDate) => {
    if (!checkInDate || !checkOutDate) return null;
    const ci = new Date(checkInDate);
    const co = new Date(checkOutDate);
    if (Number.isNaN(ci.getTime()) || Number.isNaN(co.getTime())) return null;
    // Truncate to date portion to avoid TZ drift — compare dates only.
    ci.setHours(0, 0, 0, 0);
    co.setHours(0, 0, 0, 0);
    const deltaDays = Math.round((co.getTime() - ci.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, deltaDays + 1);
  };

  const addNights = (checkInDate, nights) => {
    if (!checkInDate) return "";
    const ci = new Date(checkInDate);
    if (Number.isNaN(ci.getTime())) return "";
    ci.setDate(ci.getDate() + Math.max(1, Number(nights) || 1));
    return ymdOf(ci);
  };

  const openQuickEdit = (roomId) => {
    const room = lodgingRooms.find((r) => r.id === roomId);
    if (!room) return setMessage({ type: "error", text: "Room not found." });
    if (room.status !== "occupied") {
      setMessage({ type: "error", text: "Quick Edit is available only for occupied rooms." });
      return;
    }
    // use a shallow copy so edits don't mutate the card until saved
    const today = new Date();
    const fallbackDate = today.toISOString().slice(0, 10);
    const fallbackTime = `${String(today.getHours()).padStart(2, "0")}:${String(
      today.getMinutes()
    ).padStart(2, "0")}`;
    const draft = {
      ...room,
      checkInDate: room.checkInDate || fallbackDate,
      checkInTime: room.checkInTime || fallbackTime,
      checkOutDate: room.checkOutDate || "",
      checkOutTime: room.checkOutTime || "",
    };
    setEditingRoom(draft);
    setEditingRoomErrors({
      guest: false,
      mobile: false,
      nights: false,
      members: false,
      rate: false,
      gst: false,
      checkIn: false,
      checkOutDate: false,
      checkOutTime: false,
      idType: false,
      idNumber: false,
    });
    setShowEditModal(true);
    try {
      window.dispatchEvent(
        new CustomEvent("hotel_room_draft_started", { detail: { id: roomId, draft } })
      );
    } catch (e) {
      // ignore
    }
  };

  const openQuickBook = (roomId, details = {}) => {
    const room = lodgingRooms.find((r) => r.id === roomId);
    if (!room) return setMessage({ type: "error", text: "Room not found." });
    setQuickBookRoom({ ...room });
    setQbOpenDetails(details || null);
    setQbGuestName(sanitizeGuestName(details.guest || ""));
    setQbCustomerMobile(details.customerMobile || room.customerMobile || "");
    setQbNights(details.nights || 1);
    setQbMembers(details.members || 1);
    setQbNotes(details.notes || "");

    // Read store settings once at open so we can pre-fill defaults the
    // cashier would otherwise have to type in by hand: standard check-in time
    // (instead of "now"), default GST rate.
    const settings = getStoreSettings();
    setQbSettings(settings);
    setQbIdType(
      details.idProof && details.idProof.type
        ? details.idProof.type
        : room.idProof && room.idProof.type
          ? room.idProof.type
          : ""
    );
    setQbIdNumber(
      details.idProof && details.idProof.number
        ? details.idProof.number
        : room.idProof && room.idProof.number
          ? room.idProof.number
          : ""
    );
    setQbRate(
      details.rate != null && details.rate !== ""
        ? String(details.rate)
        : room.rate != null
          ? String(room.rate)
          : ""
    );
    setQbGst(
      details.gst != null && details.gst !== ""
        ? String(details.gst)
        : room.gst != null
          ? String(room.gst)
          : settings?.hotelGst != null
            ? String(settings.hotelGst)
            : ""
    );
    // default check-in date/time — prefer the hotel's standard check-in time
    // from store settings over "now", so the booking is logged correctly even
    // when the cashier opens the modal in the afternoon.
    const today = new Date();
    const defaultDate = details.checkInDate
      ? details.checkInDate
      : room.checkInDate
        ? room.checkInDate
        : today.toISOString().slice(0, 10);
    const defaultTime = details.checkInTime
      ? details.checkInTime
      : room.checkInTime
        ? room.checkInTime
        : settings?.hotelCheckinTime ||
          `${String(today.getHours()).padStart(2, "0")}:${String(today.getMinutes()).padStart(2, "0")}`;
    setQbCheckInDate(defaultDate);
    setQbCheckInTime(defaultTime);
    setQbErrors({
      guest: false,
      mobile: false,
      nights: false,
      members: false,
      rate: false,
      gst: false,
      idType: false,
      idNumber: false,
    });
    setShowQuickBookModal(true);
    try {
      window.dispatchEvent(new CustomEvent("hotel_room_draft_started", { detail: { id: roomId } }));
    } catch (e) {}
  };

  const handleQuickBook = () => {
    if (!quickBookRoom) return;
    const errs = {
      guest: false,
      mobile: false,
      nights: false,
      members: false,
      rate: false,
      gst: false,
      idType: false,
      idNumber: false,
    };
    // include checkIn validation flag
    errs.checkIn = false;
    const sanitizedGuestName = sanitizeGuestName(qbGuestName).trim();
    if (!sanitizedGuestName || !isValidGuestName(sanitizedGuestName)) errs.guest = true;
    if (!/^\d{10}$/.test(String(qbCustomerMobile || "").trim())) errs.mobile = true;
    const nr = Number(qbNights);
    if (!nr || nr < 1 || nr > 99 || !Number.isInteger(nr)) errs.nights = true;
    const nm = Number(qbMembers);
    const bedCount = Number(quickBookRoom.beds) || 1;
    if (!nm || nm < 1 || nm > bedCount) errs.members = true;

    // determine rate string: prefer explicit qbRate, fall back to room.rate
    const rateSource =
      qbRate !== "" && qbRate != null
        ? String(qbRate)
        : quickBookRoom.rate != null
          ? String(quickBookRoom.rate)
          : "";
    if (!/^[0-9]{1,5}$/.test(rateSource) || Number(rateSource) <= 0) errs.rate = true;
    const gstSource = qbGst !== "" && qbGst != null ? String(qbGst) : "";
    if (!/^[0-9]{1,2}$/.test(gstSource) || Number(gstSource) < 0 || Number(gstSource) > 99)
      errs.gst = true;
    if (!String(qbIdType || "").trim()) errs.idType = true;
    if (!String(qbIdNumber || "").trim()) errs.idNumber = true;
    setQbErrors(errs);
    if (
      errs.guest ||
      errs.mobile ||
      errs.nights ||
      errs.members ||
      errs.rate ||
      errs.gst ||
      errs.idType ||
      errs.idNumber
    )
      return setMessage({ type: "error", text: "Please fix booking fields." });
    // require check-in date/time
    if (!qbCheckInDate || !qbCheckInTime)
      return setMessage({ type: "error", text: "Please provide check-in date and time." });

    // prevent overwriting existing occupied rooms
    const original = lodgingRooms.find((r) => r.id === quickBookRoom.id);
    if (original && original.status === "occupied") {
      setMessage({
        type: "error",
        text: "Room is already occupied. Quick Book will not overwrite existing booking.",
      });
      return;
    }

    const pr = Number(rateSource);
    const gstNum = qbGst !== "" && qbGst != null ? Number(qbGst) : 0;

    // Auto-fill the entered checkout (date + time) so the overstay calculation
    // locks onto `check-in + nights at standard checkout` instead of falling
    // back to wall-clock `now`. Without this, a Quick Book with no checkout
    // fields would show the cumulative hours-from-now-to-checkin as
    // "overstay" (e.g. 48h for a 2-night booking viewed a day late).
    // The cashier can still override these later via the Edit Modal if the
    // guest actually checks out late — that's the whole point of the
    // checkOutDate/checkOutTime fields.
    const qbSettings = getStoreSettings();
    const qbCheckoutTime = String(qbSettings?.hotelCheckoutTime || "11:00");
    let qbCheckOutDate = "";
    try {
      const ci = new Date(qbCheckInDate);
      if (!Number.isNaN(ci.getTime())) {
        ci.setDate(ci.getDate() + nr);
        const yyyy = ci.getFullYear();
        const mm = String(ci.getMonth() + 1).padStart(2, "0");
        const dd = String(ci.getDate()).padStart(2, "0");
        qbCheckOutDate = `${yyyy}-${mm}-${dd}`;
      }
    } catch {
      qbCheckOutDate = "";
    }

    const updatedRooms = lodgingRooms.map((r) =>
      r.id === quickBookRoom.id
        ? {
            ...r,
            status: "occupied",
            guest: sanitizedGuestName,
            customerMobile: String(qbCustomerMobile || "").trim(),
            checkInDate: qbCheckInDate,
            checkInTime: qbCheckInTime,
            checkOutDate: qbCheckOutDate,
            checkOutTime: qbCheckOutDate ? qbCheckoutTime : "",
            nights: nr,
            members: nm,
            notes: qbNotes.trim(),
            rate: pr,
            gst: gstNum,
            idProof: {
              type: String(qbIdType || "").trim(),
              number: String(qbIdNumber || "").trim(),
            },
          }
        : r
    );

    try {
      setLodgingRooms(updatedRooms);
      window.localStorage.setItem("hotel_lodging_rooms", JSON.stringify(updatedRooms));
      window.dispatchEvent(
        new CustomEvent("hotel_lodging_rooms_updated", { detail: updatedRooms })
      );
    } catch (err) {
      /* ignore */
    }
    // Push the booking to the server so other devices in the same store see
    // it. Fire-and-forget — the local state already reflects the booking, so a
    // transient network error must not block the cashier. The server write
    // creates the room if it doesn't exist (first Quick Book for this room)
    // or updates it if it does.
    (async () => {
      try {
        const nextRoom = updatedRooms.find((r) => String(r.id) === String(quickBookRoom.id));
        if (!nextRoom) return;
        // Persist via /api/hotel/bookings — the legacy /api/hotel/rooms/:id
        // PUT endpoint was a 501 catch-all; the new booking endpoint
        // upserts by (kind='lodging', roomId) within the active store
        // scope so every device sees the same reservation.
        await hotelService.bookRoom({
          id: nextRoom.id,
          number: nextRoom.number || nextRoom.roomNumber,
          guest: sanitizedGuestName,
          customerMobile: qbCustomerMobile,
          checkInDate: nextRoom.checkInDate || resolvedCheckInDate,
          checkInTime: nextRoom.checkInTime || resolvedCheckInTime,
          expectedCheckOut: nextRoom.expectedCheckOut,
          status: "booked",
          notes: nextRoom.notes,
        });
      } catch (err) {
        console.warn("Failed to sync room booking to server", err);
      }
    })();

    // add shared item for Billing POS
    try {
      const sharedKey = "hotel_shared_items";
      let existing = JSON.parse(window.localStorage.getItem(sharedKey) || "[]");
      const sharedItem = buildLodgingBillItem({
        room: quickBookRoom,
        guest: sanitizedGuestName,
        customerMobile: qbCustomerMobile,
        nights: nr,
        rate: pr,
        notes: qbNotes,
        idProof: { type: String(qbIdType || "").trim(), number: String(qbIdNumber || "").trim() },
        checkInDate: qbCheckInDate,
        checkInTime: qbCheckInTime,
        checkOutDate: qbCheckOutDate,
        checkOutTime: qbCheckOutDate ? qbCheckoutTime : "",
        gst: gstNum,
        source: "booking",
      });
      // Replace only the shared item for this room.
      try {
        existing = Array.isArray(existing)
          ? existing.filter(
              (s) => !(s && s.type === "lodging" && s.meta && s.meta.roomId === quickBookRoom.id)
            )
          : [];
      } catch (e) {
        existing = [];
      }
      existing.push(sharedItem);
      setItems((prev) => replaceLodgingBillItem(prev, sharedItem));
      window.localStorage.setItem(sharedKey, JSON.stringify(existing));
      window.dispatchEvent(new CustomEvent("hotel_shared_items_updated", { detail: existing }));
    } catch (err) {
      /* ignore */
    }

    // clear draft and close modal
    try {
      window.dispatchEvent(
        new CustomEvent("hotel_room_draft_cleared", { detail: { id: quickBookRoom.id } })
      );
    } catch (e) {}
    setShowQuickBookModal(false);
    setQuickBookRoom(null);
    setShowSyncToast(true);
    setTimeout(() => setShowSyncToast(false), 3000);

    // If this Quick Book originated from an assign (waiting entry), remove that waiting entry locally and on server
    try {
      const waitingId = qbOpenDetails?.waitingId;
      if (waitingId) {
        // remove from local storage waiting list
        try {
          const key = "hotel_dining_waiting_list";
          const raw = window.localStorage.getItem(key) || "[]";
          const parsed = JSON.parse(raw);
          const updated = Array.isArray(parsed) ? parsed.filter((w) => w.id !== waitingId) : [];
          window.localStorage.setItem(key, JSON.stringify(updated));
          try {
            window.dispatchEvent(
              new CustomEvent("hotel_dining_waiting_list_updated", { detail: updated })
            );
          } catch (e) {}
        } catch (err) {}

        // best-effort server removal
        (async () => {
          try {
            await hotelService.removeDiningWaiting(waitingId);
          } catch (err) {
            showToast && showToast("error", "Failed to remove waiting from server.");
          }
          try {
            await hotelService.updateTable(
              quickBookRoom.id,
              updatedRooms.find((r) => r.id === quickBookRoom.id) || {}
            );
          } catch (err) {
            /* ignore */
          }
        })();
      }
    } catch (err) {}
    setQbOpenDetails(null);
  };

  const saveRoomEdits = () => {
    if (!editingRoom) return;
    // validate booking edits (guest, nights, members, rate, gst, check-in)
    const errs = {
      guest: false,
      mobile: false,
      nights: false,
      members: false,
      rate: false,
      gst: false,
      checkIn: false,
      checkOutDate: false,
      checkOutTime: false,
      idType: false,
      idNumber: false,
    };
    if (!editingRoom.guest || !String(editingRoom.guest).trim()) errs.guest = true;
    if (!/^\d{10}$/.test(String(editingRoom.customerMobile || "").trim())) errs.mobile = true;
    const nightsNum = Number(editingRoom.nights);
    if (!nightsNum || nightsNum < 1 || nightsNum > 99 || !Number.isInteger(nightsNum))
      errs.nights = true;
    const membersNum = Number(editingRoom.members);
    const bedCount = Number(editingRoom.beds) || 1;
    if (!membersNum || membersNum < 1 || membersNum > bedCount) errs.members = true;
    const rateStr = String(editingRoom.rate || "");
    // rate must be digits only, up to 5 digits, and > 0 (rupees)
    if (!/^[0-9]{1,5}$/.test(rateStr) || Number(rateStr) <= 0) errs.rate = true;
    const gstStr = editingRoom.gst != null ? String(editingRoom.gst) : "";
    if (!/^[0-9]{1,2}$/.test(gstStr) || Number(gstStr) < 0 || Number(gstStr) > 99) errs.gst = true;
    // check-in: both date and time are required (block submit if either is empty)
    if (
      !String(editingRoom.checkInDate || "").trim() ||
      !String(editingRoom.checkInTime || "").trim()
    )
      errs.checkIn = true;
    // checkout is optional — but if either date OR time is filled in, both must be filled in
    // so we never persist a half-checkout.
    let coDate = String(editingRoom.checkOutDate || "").trim();
    let coTime = String(editingRoom.checkOutTime || "").trim();
    if ((coDate && !coTime) || (!coDate && coTime)) {
      // mark whichever side is empty so the user sees what's missing
      if (!coDate) errs.checkOutDate = true;
      if (!coTime) errs.checkOutTime = true;
    }
    if (coTime && !/^\d{1,2}:\d{2}$/.test(coTime)) errs.checkOutTime = true;
    if (coDate && coTime && coDate < String(editingRoom.checkInDate || "").trim()) {
      // checkout date can't be earlier than check-in date
      errs.checkOutDate = true;
    }
    // Auto-fill an entered checkout when the cashier left both fields blank.
    //
    // Without this safety net, an Edit Modal save that clears both fields
    // would persist a half-booking to the room record. The next time anyone
    // reads it, `resolveActualCheckout` falls back to wall-clock `now` and
    // overstay grows by the hours-since-checkin (the original "48h"
    // symptom). Auto-filling to `checkInDate + nights @ standard checkout`
    // matches the user's spec exactly: the booking is locked at its expected
    // checkout unless the cashier explicitly edits it later.
    if (!errs.checkOutDate && !errs.checkOutTime && !coDate && !coTime) {
      try {
        const editSettings =
          typeof window !== "undefined" && getStoreSettings ? getStoreSettings() : null;
        const standardTime = String(editSettings?.hotelCheckoutTime || "11:00");
        const ciDate = new Date(String(editingRoom.checkInDate || "").trim());
        if (!Number.isNaN(ciDate.getTime())) {
          ciDate.setDate(ciDate.getDate() + Number(editingRoom.nights || 1));
          const yyyy = ciDate.getFullYear();
          const mm = String(ciDate.getMonth() + 1).padStart(2, "0");
          const dd = String(ciDate.getDate()).padStart(2, "0");
          coDate = `${yyyy}-${mm}-${dd}`;
          coTime = standardTime;
        }
      } catch {
        /* leave blank — overstay will fall back to wall-clock now */
      }
    }
    if (!String(editingRoom.idProof?.type || "").trim()) errs.idType = true;
    if (!String(editingRoom.idProof?.number || "").trim()) errs.idNumber = true;
    setEditingRoomErrors(errs);
    if (
      errs.guest ||
      errs.mobile ||
      errs.nights ||
      errs.members ||
      errs.rate ||
      errs.gst ||
      errs.checkIn ||
      errs.checkOutDate ||
      errs.checkOutTime ||
      errs.idType ||
      errs.idNumber
    ) {
      const messages = [];
      if (errs.checkIn) messages.push("check-in date and time");
      if (errs.checkOutDate && errs.checkOutTime) {
        messages.push("checkout date and time (provide both, or leave both blank)");
      } else if (errs.checkOutDate) {
        messages.push("checkout date (or clear checkout time)");
      } else if (errs.checkOutTime) {
        messages.push("checkout time (HH:MM, or clear checkout date)");
      }
      if (errs.guest) messages.push("guest name");
      if (errs.mobile) messages.push("10-digit mobile");
      if (errs.nights) messages.push("nights (1-99)");
      if (errs.members) messages.push(`members (1-${bedCount})`);
      if (errs.rate) messages.push("rate");
      if (errs.gst) messages.push("GST (0-99)");
      if (errs.idType || errs.idNumber) messages.push("ID proof");
      const detail = messages.length
        ? `Missing/invalid: ${messages.join(", ")}.`
        : "Fix highlighted booking fields in quick edit.";
      setMessage({ type: "error", text: detail });
      return;
    }

    const updated = lodgingRooms.map((r) =>
      r.id === editingRoom.id
        ? {
            ...r,
            status: "occupied",
            guest: String(editingRoom.guest).trim(),
            customerMobile: String(editingRoom.customerMobile || "").trim(),
            checkInDate: String(editingRoom.checkInDate).trim(),
            checkInTime: String(editingRoom.checkInTime).trim(),
            checkOutDate: coDate,
            checkOutTime: coTime,
            nights: Number(editingRoom.nights),
            members: Number(editingRoom.members),
            notes: editingRoom.notes || "",
            rate: Number(editingRoom.rate),
            gst: editingRoom.gst != null && editingRoom.gst !== "" ? Number(editingRoom.gst) : 0,
            idProof: editingRoom.idProof
              ? {
                  type: String(editingRoom.idProof.type || "").trim(),
                  number: String(editingRoom.idProof.number || "").trim(),
                }
              : undefined,
          }
        : r
    );

    setLodgingRooms(updated);
    try {
      window.localStorage.setItem("hotel_lodging_rooms", JSON.stringify(updated));
      window.dispatchEvent(new CustomEvent("hotel_lodging_rooms_updated", { detail: updated }));
    } catch (err) {
      // ignore
    }
    // Push the edit to the server so other devices see the same booking.
    // The room exists locally with status="occupied" — it's the canonical
    // record we want the server to mirror.
    (async () => {
      try {
        const nextRoom = updated.find((r) => String(r.id) === String(editingRoom.id));
        if (!nextRoom) return;
        const persisted = nextRoom._persisted === true;
        if (persisted) {
          await hotelService.updateRoom(nextRoom.id, nextRoom);
        } else {
          const created = await hotelService.createRoom(nextRoom);
          if (created && (created.id || created._persisted)) {
            setLodgingRooms((prev) =>
              prev.map((r) =>
                String(r.id) === String(nextRoom.id)
                  ? { ...r, id: created.id || r.id, _persisted: true }
                  : r
              )
            );
          }
        }
      } catch (err) {
        console.warn("Failed to sync room edit to server", err);
      }
    })();
    // Update any existing shared billing items for this room to reflect edited GST/rate/notes/idProof
    try {
      const key = "hotel_shared_items";
      const raw = window.localStorage.getItem(key) || "[]";
      const shared = JSON.parse(raw);
      if (Array.isArray(shared)) {
        // remove any lodging items for this room and replace with a single consolidated item
        const remaining = shared.filter(
          (s) => !(s && s.type === "lodging" && s.meta && s.meta.roomId === editingRoom.id)
        );
        const nights = Number(editingRoom.nights || 1);
        const rate = Number(editingRoom.rate || 0);
        const consolidated = buildLodgingBillItem({
          room: editingRoom,
          guest: editingRoom.guest,
          customerMobile: editingRoom.customerMobile,
          nights,
          rate,
          notes: editingRoom.notes,
          idProof: editingRoom.idProof || undefined,
          checkInDate: editingRoom.checkInDate,
          checkInTime: editingRoom.checkInTime,
          // Pass the entered checkout snapshot too. Without it, the bill
          // item in `hotel_shared_items` would silently keep the *original*
          // checkout from Quick Book, while the room record carries the
          // cashier's updated value — Edit Booking would then desync the
          // two. The overstay calculation reads from the room record, so
          // the math stays correct either way; this keeps the snapshots
          // consistent so audit surfaces show the same value.
          checkOutDate: coDate,
          checkOutTime: coTime,
          // Carry forward whatever GST is currently on the room record.
          // After saveRoomEdits updates `lodgingRooms`, editingRoom.gst is the
          // value the cashier just confirmed.
          gst: editingRoom.gst != null && editingRoom.gst !== "" ? Number(editingRoom.gst) : 0,
          source: "edit",
        });
        const updatedShared = [...remaining, consolidated];
        setItems((prev) => replaceLodgingBillItem(prev, consolidated));
        window.localStorage.setItem(key, JSON.stringify(updatedShared));
        try {
          window.dispatchEvent(
            new CustomEvent("hotel_shared_items_updated", { detail: updatedShared })
          );
        } catch (e) {}
      }
    } catch (e) {}
    setShowEditModal(false);
    try {
      window.dispatchEvent(
        new CustomEvent("hotel_room_draft_cleared", { detail: { id: editingRoom.id } })
      );
    } catch (e) {}
    setEditingRoom(null);
    setShowSyncToast(true);
    setTimeout(() => setShowSyncToast(false), 3000);
  };

  const handleCheckoutFromBilling = (roomId) => {
    try {
      const roomToCheckout = lodgingRooms.find((room) => room.id === roomId);
      let overstayInfo = null;

      // Before clearing the room, push the auto-computed overstay charge into
      // the live bill as a separate line item — exactly like the preview on
      // the Room Booking Card. Without this step, a guest who checks out via
      // the room card never sees the Extra Hours Charges line in the cart,
      // and the printed invoice would be short by that amount.
      //
      // We use `syncOverstayIntoBill` so the qty/rate/total stay aligned with
      // the rest of the app — same id (`OVERSTAY_LINE_ID`), same label
      // ("Extra Hours Charges"), same per-hour rate × ceil(minutes/60) math.
      // The line is added to both `items` (cart state) and the
      // `hotel_shared_items` store so the storage-event handler on other tabs
      // (e.g. the Lodging page) sees the same view.
      if (roomToCheckout) {
        const checkoutSettings = getStoreSettings();
        overstayInfo = computeOverstayCharge(roomToCheckout, new Date(), checkoutSettings);
        const syncedItems = syncOverstayIntoBill(
          items,
          roomToCheckout,
          new Date(),
          checkoutSettings
        );
        if (syncedItems !== items) {
          setItems(syncedItems);
          // The Room Booking line stays exactly as booked — we never strip it
          // here. We *only* update the local cart. Writing the shared store
          // and re-dispatching `hotel_shared_items_updated` would trigger the
          // shared-listener merge path, which uses `roomId` as the key and
          // therefore collapses all lodging items for this room down to a
          // single row — wiping the Room Booking line out of the cart. The
          // checkout action only needs to add the Extra Hours Charges line
          // to the cashier's local cart so it can be saved + printed; the
          // Lodging tab and other tabs see no booking changes because the
          // room itself is already being marked vacant below.
        }
      }

      if (roomToCheckout && (roomToCheckout.guest || roomToCheckout.checkIn)) {
        const existingHistory = JSON.parse(
          window.localStorage.getItem(CHECKOUT_HISTORY_STORAGE_KEY) || "[]"
        );
        const nextHistory = Array.isArray(existingHistory) ? existingHistory : [];
        const historyEntry = {
          id: `checkout-${roomId}-${Date.now()}`,
          roomId: roomToCheckout.id,
          roomName: roomToCheckout.name,
          guest: roomToCheckout.guest || "",
          checkIn: roomToCheckout.checkIn || "",
          nights: Number(roomToCheckout.nights || 1),
          members: Number(roomToCheckout.members || 1),
          rate: Number(roomToCheckout.rate || 0),
          total: Number(roomToCheckout.rate || 0) * Number(roomToCheckout.nights || 1),
          notes: roomToCheckout.notes || "",
          idProof: roomToCheckout.idProof || null,
          checkedOutAt: new Date().toISOString(),
        };
        const updatedHistory = [historyEntry, ...nextHistory].slice(0, 200);
        window.localStorage.setItem(CHECKOUT_HISTORY_STORAGE_KEY, JSON.stringify(updatedHistory));
        try {
          window.dispatchEvent(
            new CustomEvent("hotel_lodging_checkout_history_updated", { detail: updatedHistory })
          );
        } catch (e) {
          // ignore
        }
        (async () => {
          try {
            await hotelService.addCheckoutHistory(historyEntry);
          } catch (err) {
            console.warn("Failed to sync checkout history to server", err);
          }
        })();
      }

      const updated = lodgingRooms.map((r) =>
        r.id === roomId
          ? {
              ...r,
              status: "vacant",
              guest: "",
              checkIn: "",
              nights: 1,
              members: 1,
              notes: "",
              idProof: undefined,
              // Keep `gst` from the previous booking on the room record.
              // When the room is vacant, `gst` is a fallback for any pending
              // Room Booking bill items still in the cart (whose own meta.gst
              // may be missing on older bookings). Resetting it to 0 would
              // silently zero out the Room Booking GST on the bill right
              // after checkout — see the "GST becomes 0 after checkout" bug.
              gst: Number(r.gst || 0),
              customerMobile: "",
            }
          : r
      );
      setLodgingRooms(updated);
      window.localStorage.setItem("hotel_lodging_rooms", JSON.stringify(updated));
      try {
        window.dispatchEvent(new CustomEvent("hotel_lodging_rooms_updated", { detail: updated }));
      } catch (e) {
        // ignore
      }
      // Tell the server the room is now vacant. Use the dedicated checkout
      // endpoint so the server can record this as a checkout event in
      // check-out history (when wired) — fire-and-forget.
      (async () => {
        try {
          await hotelService.checkoutRoom(settleRoom.id);
        } catch (err) {
          console.warn("Failed to sync room checkout to server", err);
        }
      })();
      // The shared lodging items store is intentionally left untouched.
      // The Room Booking line (added when the room was booked) stays in
      // place so it can still be saved as part of the bill, and the
      // Extra Hours Charges line we just pushed into the local cart isn't
      // duplicated in the shared store — that would trigger the
      // roomId-based merge logic in `mergeSharedItemsIntoCart`, which
      // collapses multiple lodging rows for the same room down to a
      // single row and would silently drop the booking line from the
      // cart. The shared store is reconciled again at save time via
      // `savedIds` (see `handleSave`).

      // Clear quick book modal and fields
      setShowQuickBookModal(false);
      setQuickBookRoom(null);
      setQbGuestName("");
      setQbCustomerMobile("");
      setQbNights(1);
      setQbMembers(1);
      setQbNotes("");
      setQbIdType("");
      setQbIdNumber("");
      setQbRate("");
      setQbGst("");
      setQbCheckInDate("");
      setQbCheckInTime("");

      setMessage({
        type: "success",
        text: overstayInfo
          ? `Room checked out. Extra Hours Charges (${overstayInfo.hours}h × ₹${overstayInfo.rate} = ₹${overstayInfo.subtotal}) added to the bill.`
          : "Room checked out.",
      });
    } catch (err) {
      setMessage({ type: "error", text: "Failed to checkout room." });
    }
  };

  // Categories are read live from storeSettings so the admin and the POS
  // agree on what counts as a dining item. See hotelMenuCategories.js.
  const diningCategories = resolveHotelMenuCategories();

  const productOptions = products
    .filter((product) => diningCategories.includes(product.category) && product.available !== false)
    .map((product) => ({
      value: product.id || product.name,
      label: `${product.name} • ₹${Number(product.fullPrice || product.price || 0)} • ${product.category || "Dining"}${getDiningStockState(product) === "out" ? " • Out of stock" : getDiningStockState(product) === "low" ? " • Low stock" : ""}`,
      product,
    }));
  const bookingMenuOptions = productOptions
    .filter((option) => getDiningStockState(option.product) !== "out")
    .sort((left, right) =>
      String(left.product?.name || "").localeCompare(String(right.product?.name || ""))
    );
  const bookingMenuOptionsByCategory = diningCategories
    .map((category) => ({
      category,
      options: bookingMenuOptions.filter((option) => (option.product?.category || "") === category),
    }))
    .filter((group) => group.options.length > 0);

  const totalTables = tables.length;
  const emptyTables = tables.filter((t) => t.status === "empty").length;
  const bookedTables = tables.filter((t) => t.status === "booked").length;

  const totalRooms = lodgingRooms.length;
  const vacantRooms = lodgingRooms.filter((r) => r.status === "vacant").length;
  const occupiedRooms = lodgingRooms.filter((r) => r.status === "occupied").length;
  const bookableRevenue = lodgingRooms.reduce((sum, room) => {
    if (room.status === "occupied") {
      const nights = Number(room.nights || 1);
      const rate = Number(room.rate || 0);
      return sum + rate * nights;
    }
    return sum;
  }, 0);

  const activeProduct = productOptions.find((option) => option.value === selectedProduct)?.product;
  const activeProductVariants = getDiningProductVariants(activeProduct);
  const activeVariant =
    activeProductVariants.find((variant) => variant.value === selectedProductVariant) ||
    activeProductVariants[0] ||
    null;
  const activeProductStockState = getDiningStockState(activeProduct);
  const itemGST = activeProduct ? Number(activeProduct.gst || 0) : 0;
  const activeDiningTable =
    tables.find((table) => String(table.id) === String(activeDiningTableId)) || null;
  const activeDiningBill = activeDiningTableId
    ? diningBillsByTable[String(activeDiningTableId)]
    : null;

  // The room currently being billed in the lodging tab (derived from the cart's
  // first lodging line). Used by both the active-bill banner and handleSave so
  // the two paths stay in sync. Falls back to null when the cart has no lodging
  // row yet.
  const settleRoom = (() => {
    if (activeTab !== "lodging") return null;
    const roomId = items.find((it) => it.meta && it.meta.roomId)?.meta?.roomId;
    if (!roomId) return null;
    return lodgingRooms.find((r) => String(r.id) === String(roomId)) || null;
  })();

  // Keep a tiny in-component tick so the auto-computed overstay charge refreshes
  // every minute while the lodging tab is open. Using state (instead of
  // setItems spread) lets us schedule the next tick only after the previous
  // sync completes — no risk of overlapping renders.
  const [overstayTick, setOverstayTick] = useState(0);
  useEffect(() => {
    if (!settleRoom) return undefined;
    const handle = setInterval(() => setOverstayTick((t) => t + 1), 60_000);
    return () => window.clearInterval(handle);
  }, [settleRoom]);

  // Auto-attach the Extra Hours Charges line to the live bill. Idempotent: running
  // it twice with the same data returns the same array reference. Once a
  // cashier manually edits the line (qty/rate), the auto-sync leaves it
  // alone — the `meta.edited` flag breaks the loop.
  const lastOverstaySyncRef = useRef(0);
  useEffect(() => {
    if (!settleRoom) return;
    const settings = getStoreSettings();
    setItems((prev) => {
      const result = syncOverstayIntoBill(prev, settleRoom, new Date(), settings);
      // Avoid re-rendering when sync is a no-op (same array, same contents).
      if (result === prev) return prev;
      // Throttle: don't run sync more than once per ~250ms even if the effect
      // is triggered multiple times by cascading renders.
      const now = Date.now();
      if (now - lastOverstaySyncRef.current < 250) return prev;
      lastOverstaySyncRef.current = now;
      return result;
    });
  }, [settleRoom, overstayTick, lodgingRooms]);

  const activeDiningSummary =
    summarizeDiningBillItems(activeDiningBill?.items) ||
    summarizeOrderedMenuItems(activeDiningTable?.orderedMenuItems) ||
    activeDiningTable?.orderSummary ||
    "";
  const activeDiningCheckIn = [
    activeDiningBill?.checkInDate || activeDiningTable?.checkInDate || "",
    formatTime12Hour(activeDiningBill?.checkInTime || activeDiningTable?.checkInTime || ""),
  ]
    .filter(Boolean)
    .join(" · ");
  const isDiningBillEditable = activeDiningTable?.status === "booked";
  const getDiningCardSummary = (table) =>
    summarizeDiningBillItems(diningBillsByTable[String(table.id || "")]?.items) ||
    summarizeOrderedMenuItems(table?.orderedMenuItems) ||
    table.orderSummary ||
    "";

  const syncSelectedDiningMenus = (nextMenus) => {
    setSelectedDiningMenus(nextMenus);
    setDiningOrderedMenu(summarizeOrderedMenuItems(nextMenus));
  };

  const buildNewMenuEntry = (product) => ({
    productId: product?.id || undefined,
    name: product?.name || "",
    category: product?.category || "",
    price: Number(product?.fullPrice || product?.price || 0) || 0,
    gst: Number(product?.gst || 0) || 0,
    qty: 1,
  });

  const mergeMenuEntry = (existingList, product) => {
    if (!product) return existingList;
    const existingIndex = existingList.findIndex(
      (item) => String(item.productId || "") === String(product.id || "")
    );
    if (existingIndex >= 0) {
      return existingList.map((item, index) =>
        index === existingIndex ? { ...item, qty: Number(item.qty || 1) + 1 } : item
      );
    }
    return [...existingList, buildNewMenuEntry(product)];
  };

  const handleAddSelectedDiningMenu = () => {
    const selectedOption = bookingMenuOptions.find(
      (option) => String(option.value) === String(selectedDiningMenuProductId)
    );
    if (!selectedOption?.product) return;
    syncSelectedDiningMenus(mergeMenuEntry(selectedDiningMenus, selectedOption.product));
    setSelectedDiningMenuProductId("");
  };

  // Tap-to-add from the visible menu gallery. Behaves like the dropdown path
  // but lets the cashier click a card instead of using the select.
  const handleAddMenuCard = (product) => {
    if (!product) return;
    if (getDiningStockState(product) === "out") return;
    syncSelectedDiningMenus(mergeMenuEntry(selectedDiningMenus, product));
    showToast("success", `Added "${product.name}" to table order.`);
  };

  const handleDiningMenuQtyChange = (menuIndex, delta) => {
    const nextMenus = selectedDiningMenus
      .map((item, index) => {
        if (index !== menuIndex) return item;
        return { ...item, qty: Math.max(0, Number(item.qty || 1) + delta) };
      })
      .filter((item) => Number(item.qty || 0) > 0);
    syncSelectedDiningMenus(nextMenus);
  };

  const handleRemoveSelectedDiningMenu = (menuIndex) => {
    syncSelectedDiningMenus(selectedDiningMenus.filter((_, index) => index !== menuIndex));
  };

  useEffect(() => {
    if (!activeProduct) {
      setSelectedProductVariant("regular");
      return;
    }
    const variants = getDiningProductVariants(activeProduct);
    if (!variants.some((variant) => variant.value === selectedProductVariant)) {
      setSelectedProductVariant(variants[0]?.value || "regular");
    }
  }, [activeProduct, selectedProductVariant]);

  // Garbage-collect stale dining cart items. A dining line in `items` is
  // valid only when its source table either has an open bill in
  // `diningBillsByTable` OR is currently in `booked` state. Without this
  // sweep, the Dining tab badge (`diningCount`) keeps showing items that
  // were already cleared + billed — the cashier finishes a table, the
  // server-side dining bill is deleted, but a leftover line in the cart
  // never gets cleaned up. We run this whenever the bill map or the
  // tables list changes so the badge returns to 0 once everything is
  // settled.
  useEffect(() => {
    setItems((prev) => {
      const next = pruneStaleDiningItems(prev, tables, diningBillsByTable);
      return next === prev ? prev : next;
    });
    // We intentionally don't depend on `items` here — the setter accepts
    // a functional update and re-running on every cart mutation would
    // cause an infinite render loop. The bill + tables snapshots are the
    // inputs that decide what should be live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diningBillsByTable, tables]);

  const syncProductStock = async (product, delta) => {
    if (!product?.id) return { ok: false };
    const currentStock = Number(product.stock || 0);
    const nextStock = currentStock + Number(delta || 0);
    if (nextStock < 0) {
      return { ok: false, reason: "insufficient" };
    }
    try {
      const updated = await updateProductStockApi({ ...product, stock: nextStock });
      setProducts((prev) =>
        prev.map((entry) => (String(entry.id) === String(updated.id) ? updated : entry))
      );
      return { ok: true, product: updated };
    } catch (error) {
      console.error("Failed to update hotel menu stock", error);
      return { ok: false, reason: "sync" };
    }
  };

  const addDiningItem = async () => {
    if (!activeProduct) return setMessage({ type: "error", text: "Select a dining item to add." });
    if (!quantity || quantity <= 0)
      return setMessage({ type: "error", text: "Enter a valid quantity." });
    if (!activeDiningTableId || !activeDiningTable || activeDiningTable.status !== "booked") {
      return setMessage({
        type: "error",
        text: "Select a booked dining table before adding bill items.",
      });
    }
    if (activeProduct.available === false) {
      return setMessage({ type: "error", text: "This menu item is unavailable." });
    }
    if (activeProductStockState === "out") {
      return setMessage({
        type: "error",
        text: `${activeProduct.name} is out of stock and cannot be billed.`,
      });
    }

    const billQuantity = Number(quantity);
    if (Number(activeProduct.stock || 0) < billQuantity) {
      return setMessage({
        type: "error",
        text: `Only ${Number(activeProduct.stock || 0)} unit(s) available in stock.`,
      });
    }

    const stockResult = await syncProductStock(activeProduct, -billQuantity);
    if (!stockResult.ok) {
      return setMessage({
        type: "error",
        text:
          stockResult.reason === "insufficient"
            ? "Insufficient stock for this item."
            : "Failed to update item stock.",
      });
    }

    const item = {
      id: `${activeDiningTableId}-${activeProduct.id || activeProduct.name}-${Date.now()}`,
      name:
        activeVariant?.label && activeVariant.value !== "regular"
          ? `${activeProduct.name} (${activeVariant.label})`
          : activeProduct.name,
      type: "dining",
      qty: billQuantity,
      rate: Number(activeVariant?.price ?? activeProduct.price ?? 0),
      gst: itemGST,
      total: billQuantity * Number(activeVariant?.price ?? activeProduct.price ?? 0),
      category: activeProduct.category || "Dining",
      meta: {
        tableId: activeDiningTable.id,
        tableName: activeDiningTable.name,
        guest: activeDiningTable.guest || "",
        partySize: activeDiningTable.partySize || 0,
        productId: activeProduct.id,
        variant: activeVariant?.value || "regular",
        variantLabel: activeVariant?.label || "Regular",
      },
    };

    const existingItems = items.filter(
      (existingItem) =>
        existingItem.type === "dining" &&
        String(existingItem.meta?.tableId || "") === String(activeDiningTableId)
    );
    const nextDiningItems = [...existingItems, item];
    const persisted = await persistDiningBill(activeDiningTable, nextDiningItems);
    if (!persisted) {
      await syncProductStock(stockResult.product || activeProduct, billQuantity);
      return setMessage({ type: "error", text: "Failed to save item to the dining bill." });
    }
    setSelectedProduct("");
    setSelectedProductVariant("regular");
    setQuantity(1);
    setMessage(null);
  };

  const addLodgingCharge = () => {
    const amount = Number(lodgingAmount);
    if (!lodgingDescription.trim())
      return setMessage({ type: "error", text: "Enter lodging charge description." });
    if (!amount || amount <= 0)
      return setMessage({ type: "error", text: "Enter a valid lodging amount." });

    const item = {
      id: `lodging-${Date.now()}`,
      name: lodgingDescription,
      type: "lodging",
      qty: 1,
      rate: amount,
      gst: 0,
      total: amount,
      category: "Lodging",
    };

    setItems((prev) => [...prev, item]);
    setLodgingDescription("");
    setLodgingAmount("");

    setMessage(null);
  };

  const removeItem = async (id) => {
    const targetItem = items.find((item) => item.id === id);
    if (targetItem?.type === "dining" && targetItem.meta?.tableId) {
      const targetTable = tables.find(
        (table) => String(table.id || "") === String(targetItem.meta.tableId || "")
      );
      if (targetTable) {
        const remaining = items.filter(
          (item) =>
            !(
              item.type === "dining" &&
              String(item.meta?.tableId || "") === String(targetItem.meta.tableId || "") &&
              item.id === id
            )
        );
        const nextDiningItems = remaining.filter(
          (item) =>
            item.type === "dining" &&
            String(item.meta?.tableId || "") === String(targetItem.meta.tableId || "")
        );
        const persisted = await persistDiningBill(targetTable, nextDiningItems);
        if (!persisted) {
          setMessage({ type: "error", text: "Failed to remove dining item from the bill." });
          return;
        }
        const sourceProduct = products.find(
          (product) => String(product.id) === String(targetItem.meta?.productId)
        );
        if (sourceProduct) {
          await syncProductStock(sourceProduct, Number(targetItem.qty || 0));
        }
        return;
      }
    }
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const lodgingCount = items.filter((i) => i.type === "lodging").length;
  const diningCount = items.filter((i) => i.type === "dining").length;
  const otherTabHasItems = activeTab === "lodging" ? diningCount : lodgingCount;

  // only show items and totals relevant to the active POS tab (lodging or dining)
  const filteredItems = items.filter((item) => {
    if (item.type !== activeTab) return false;
    if (activeTab !== "dining") return true;
    if (!activeDiningTableId) return false;
    return String(item.meta?.tableId || "") === String(activeDiningTableId);
  });
  // GST fallback policy lives in folio.js (resolveLodgingGstRate). It reads
  // settings.hotelGst as a final fallback and uses the same chain the bill
  // summary uses, so the Room Booking GST is preserved across checkout.
  const settingsForGst = getStoreSettings();

  const subtotal = filteredItems.reduce((sum, item) => sum + item.total, 0);
  const gstAmount = filteredItems.reduce((sum, item) => {
    try {
      // Extra Hours Charges line — taxed as 0%. Per the checkout rules, GST
      // applies only to the Room Booking amount, not to the late check-out
      // fee. Recognise the line via its stable meta kind so this stays
      // accurate even after manual qty/rate edits.
      if (item.meta?.kind === "late_checkout") return sum;
      if (item.type === "lodging") {
        const roomId = item.meta?.roomId;
        const room = roomId ? lodgingRooms.find((r) => r.id === roomId) : null;
        const gstRate = resolveLodgingGstRate(room, item, settingsForGst);
        const qty = Number(item.qty || 1);
        const base = Number(item.rate || 0) * qty;
        return sum + Math.round(base * gstRate) / 100;
      }
      const rateGst = Number(item.gst || 0);
      return sum + Math.round(Number(item.total || 0) * rateGst) / 100;
    } catch (e) {
      return sum;
    }
  }, 0);
  const grandTotal = subtotal + gstAmount;

  const generateAndPreview = async () => {
    if (!filteredItems.length) {
      setMessage({ type: "error", text: "Add at least one service item to generate invoice." });
      return;
    }

    // Mandatory-shift gate: for cash sales in a cash-vertical store, the
    // cashier must have an open shift. If the user lands here without one,
    // show the OpenShiftDialog first; once they open a shift, the success
    // handler re-runs the save. Same flow as Retail POSBilling.
    if (paymentMode === "Cash" && currentStoreNeedsShift()) {
      const shift = await refreshActiveShift();
      if (!shift) {
        pendingInvoiceRef.current = { kind: "hotel" };
        openShiftDialog();
        return;
      }
    }
    // Super-Owner-controlled module lock — defense in depth. The
    // tab/buttons are hidden in the UI, but a stale localStorage
    // activeTab or a hand-built event could still trigger a save. We
    // bail with a toast here and the backend's POST /api/invoices
    // lock check is the final guard.
    if (activeTab === "lodging" && hotelModuleLock.lodgingLocked) {
      setMessage({ type: "error", text: "Lodging module is locked for this customer." });
      return;
    }
    if (activeTab === "dining" && hotelModuleLock.diningLocked) {
      setMessage({ type: "error", text: "Dining module is locked for this customer." });
      return;
    }
    // try to attach guest and room info if available from shared items or lodgingRooms
    const roomItem =
      filteredItems.find((it) => it.meta && it.meta.roomId) ||
      filteredItems.find((it) => it.type === "lodging");
    const roomId = roomItem?.meta?.roomId || null;
    const roomObj = roomId ? lodgingRooms.find((r) => r.id === roomId) : null;
    const guestName = roomItem?.meta?.guest || roomObj?.guest || "";
    const roomNumber = roomObj?.name || roomId || "";
    const idProof = roomItem?.meta?.idProof || roomObj?.idProof || null;

    const diningTableForInvoice = activeTab === "dining" ? activeDiningTable : null;
    // Live "moment of invoice generation" stamp. The schema's `date`
    // column is a MySQL DATE (no time-of-day), and `created_at` is the
    // server's NOW(3) — but we also need a cashier-perceived moment
    // here-and-now to display on the printed receipt. Three fields all
    // derived from a single `generatedAt` capture so the preview,
    // saved row, and rendered date stay perfectly aligned.
    const generatedAt = new Date();
    const invoiceDate = generatedAt.toISOString().split("T")[0];
    const invoiceTime = `${String(generatedAt.getHours()).padStart(2, "0")}:${String(generatedAt.getMinutes()).padStart(2, "0")}`;
    const invoiceDateTime = generatedAt.toISOString();
    // Resolve the per-line GST rate the same way the bill summary does, so
    // the saved invoice (and the printed LodgingInvoice / DiningInvoice)
    // shows the correct per-line GST. Previously we hard-coded 0 here and
    // relied on `invoice.gstTotal` for the total, but the per-line display
    // silently dropped the cashier's selected GST for Room Booking and
    // Dining Menu lines — see "GST not shown on hotel invoice" complaint.
    const lineGst = (item) => {
      try {
        if (item.meta?.kind === "late_checkout") return 0;
        if (item.type === "lodging") {
          const rId = item.meta?.roomId;
          const room = rId ? lodgingRooms.find((r) => r.id === rId) : null;
          return resolveLodgingGstRate(room, item, settingsForGst);
        }
        return Number(item.gst || 0);
      } catch (e) {
        return 0;
      }
    };
    const invoicePayload = {
      invoiceNo: `HINV-${Date.now()}`,
      date: invoiceDate,
      // Live capture of the moment Generate Invoice was clicked. The
      // Dining renderer reads `invoiceDateTime` first and falls back to
      // `generatedAt` (persisted into the `invoices.generated_at`
      // DATETIME(3) column on save) on the Public Invoice, where the
      // cashier-side field isn't shipped — and finally to `createdAt`
      // (server NOW(3)) for legacy rows. `invoiceTime` is the cashier's
      // local-clock HH:mm — a stable backup if both ISO-shaped sources
      // are missing.
      invoiceTime,
      invoiceDateTime,
      generatedAt: generatedAt.toISOString(),
      paymentMode: paymentMode,
      items: filteredItems.map((i, idx) => ({
        name: i.name,
        qty: i.qty || 1,
        rate: i.rate,
        total: i.total,
        gst: lineGst(i),
        category: i.category,
        type: i.type,
        // Stow the cashier's exact click moment on the first line's meta
        // so the Public Invoice round-trip can recover it. The cashier's
        // top-level `invoiceDateTime` lives only on the in-memory payload
        // and the persisted `invoices.date` is a DATE-only column — so
        // without this stow, the Public Invoice falls through to the
        // server `created_at` (UTC, off by a few hundred ms) or, worse,
        // to `date` parsed as UTC midnight (renders as 05:30 AM IST).
        // The public sanitizer hoists `meta.invoiceDateTime` back to a
        // top-level field so the renderer chain
        // `invoiceDateTime → generatedAt → createdAt → date` picks it
        // up first. Only the first line carries it — every other line
        // has the same dining meta (mirroring how tableName/guest/etc.
        // already ride on items[0].meta via persistDiningBill).
        meta: {
          ...(i.meta || {}),
          ...(idx === 0 ? { invoiceDateTime: generatedAt.toISOString() } : {}),
        },
      })),
      notes,
      subTotal: subtotal,
      gstTotal: gstAmount,
      grandTotal: grandTotal,
      total: grandTotal,
      storeType: "hotel",
      hotelDetails:
        activeTab === "dining"
          ? {
              tableId: activeDiningBill?.tableId || diningTableForInvoice?.id,
              tableName: activeDiningBill?.tableName || diningTableForInvoice?.name,
              guestName: activeDiningBill?.guestName || diningTableForInvoice?.guest || undefined,
              customerMobile:
                activeDiningBill?.customerMobile ||
                diningTableForInvoice?.customerMobile ||
                undefined,
              partySize:
                activeDiningBill?.partySize || diningTableForInvoice?.partySize || undefined,
              checkInDate:
                activeDiningBill?.checkInDate || diningTableForInvoice?.checkInDate || undefined,
              checkInTime:
                activeDiningBill?.checkInTime || diningTableForInvoice?.checkInTime || undefined,
              checkOutTime:
                activeDiningBill?.checkOutTime || diningTableForInvoice?.checkOutTime || undefined,
              orderSummary: activeDiningSummary || undefined,
              notes: notes || undefined,
            }
          : {
              guestName: guestName || undefined,
              roomNumber: roomNumber || undefined,
              notes: notes || undefined,
              idProof: idProof || undefined,
            },
      customerName:
        activeTab === "dining"
          ? activeDiningBill?.guestName ||
            diningTableForInvoice?.guest ||
            activeDiningBill?.tableName ||
            diningTableForInvoice?.name ||
            "Dining Guest"
          : guestName || "Hotel Guest",
      customerId:
        activeTab === "dining"
          ? activeDiningBill?.tableName ||
            diningTableForInvoice?.name ||
            activeDiningBill?.tableId ||
            diningTableForInvoice?.id ||
            "Dining Table"
          : roomNumber || "Hotel Room",
      billedBy: billedByDisplayName,
      createdAt: new Date().toISOString(),
    };

    let savedInvoice = null;
    try {
      savedInvoice = await saveInvoice(invoicePayload);
      setMessage({ type: "success", text: "Invoice generated." });

      // For cash sales in a cash-vertical store, record the sale against
      // the cashier's currently-open shift so the variance at end-of-shift
      // is accurate. Fire-and-forget — the invoice is already saved.
      if (invoicePayload.paymentMode === "Cash" && currentStoreNeedsShift()) {
        recordCashSaleForShift({
          invoiceNo: savedInvoice.invoiceNo || invoicePayload.invoiceNo,
          amount: invoicePayload.grandTotal,
        });
      }
    } catch (err) {
      console.error("Save invoice failed", err);
      setMessage({
        type: "error",
        text: "Failed to save invoice to server — opening preview only.",
      });
    }

    // The server response (`savedInvoice`) is the persisted row read
    // back via `findByInvoiceNo` — it does NOT carry the cashier's
    // top-level `invoiceDateTime` (that field is not in any DB column).
    // On a pre-migration prod DB it also lacks `generatedAt`, so the
    // renderer would otherwise fall through to `createdAt` (server
    // NOW(3) UTC, off by a few hundred ms) or `date` (DATE-only,
    // renders as 05:30 AM IST). To keep the cashier-side Invoice
    // Preview showing the same Time as the Public Invoice — and to
    // match what the cashier actually clicked Generate Invoice at —
    // prefer the cashier's `invoicePayload` (which carries the live
    // `new Date()` moment) and overlay the server response on top so
    // any server-stamped fields (id, generatedAt once the migration
    // runs, etc.) still win.
    const invoiceToPreview = savedInvoice
      ? { ...invoicePayload, ...savedInvoice, invoiceDateTime: invoicePayload.invoiceDateTime }
      : invoicePayload;

    // open popup and render preview
    try {
      // Honor the cashier's saved hotel layout preference (A4 or 80mm
      // thermal) when the live preview prints. Without this, the popup
      // would always render the A4 layout even if the cashier had
      // previously switched the InvoiceView to thermal.
      let hotelLayoutPreference = "a4";
      try {
        const stored = window.localStorage.getItem("hotel_invoice_layout");
        if (stored === "thermal" || stored === "a4") hotelLayoutPreference = stored;
      } catch (e) {
        /* ignore */
      }
      const w = window.open("", "_blank", "width=420,height=760");
      if (!w) throw new Error("Popup blocked");
      // Also append the layout preference as a class on the popup's
      // <body> so the print stylesheet can scope print-only rules to the
      // chosen layout (e.g. force `@page size: 80mm auto` when thermal).
      w.document.write(
        '<!doctype html><html><head><title>Invoice Preview</title></head><body class="hotel-preview-popup"><div id="root"></div></body></html>'
      );
      Array.from(document.querySelectorAll('link[rel="stylesheet"], style')).forEach((node) => {
        try {
          w.document.head.appendChild(node.cloneNode(true));
        } catch (e) {}
      });
      const root = w.document.getElementById("root");
      const reactRoot = ReactDOM.createRoot(root);
      // The popup is dedicated to the hotel invoice, so it uses the
      // choice stored in InvoiceView — when the cashier is on "thermal"
      // we mount the thermal renderer; otherwise the existing A4 path.
      const isThermal = hotelLayoutPreference === "thermal";
      const InvoiceComponent = isThermal
        ? HotelThermalReceipt
        : activeTab === "dining"
          ? DiningInvoice
          : LodgingInvoice;
      // Mark the popup body so the print CSS can scope its rules
      // correctly (force 80mm @page when thermal; otherwise the default
      // A4 page setup).
      try {
        w.document.body.classList.add(isThermal ? "hotel-preview-thermal" : "hotel-preview-a4");
      } catch (e) {
        /* ignore */
      }
      reactRoot.render(<InvoiceComponent invoice={invoiceToPreview} isDuplicate={false} />);
      setTimeout(() => {
        try {
          w.print();
        } catch (e) {
          console.warn(e);
        }
      }, 500);
    } catch (err) {
      console.error("Preview open failed", err);
      setMessage({ type: "error", text: "Failed to open print preview. Allow popups." });
      return;
    }

    // if save succeeded, clear local items and shared items
    if (savedInvoice) {
      try {
        // Open saved invoice route and let InvoiceView auto-select lodging/dining layout.
        // Honor the cashier's saved hotel layout choice (A4 or 80mm thermal)
        // by threading the same value through ?preview= so InvoiceView boots
        // straight into the right renderer instead of forcing another toggle.
        let hotelLayoutPreference = "a4";
        try {
          const stored = window.localStorage.getItem("hotel_invoice_layout");
          if (stored === "thermal" || stored === "a4") hotelLayoutPreference = stored;
        } catch (e) {
          /* ignore */
        }
        const url =
          `/invoice/${encodeURIComponent(savedInvoice.invoiceNo)}/preview` +
          (hotelLayoutPreference === "thermal" ? "?preview=thermal" : "");
        const w = window.open(url, "_blank", "width=820,height=1000");
        if (!w) {
          // popup blocked — fall back to rendering in current tab
          window.location.href = url;
        }

        const savedIds = filteredItems.map((i) => i.id);
        setItems((prev) => prev.filter((it) => !savedIds.includes(it.id)));
        if (activeTab === "dining" && activeDiningTable) {
          await releaseDiningTableAfterBilling(activeDiningTable.id);
        }
        const sharedKey = "hotel_shared_items";
        const shared = JSON.parse(window.localStorage.getItem(sharedKey) || "[]");
        const remaining = Array.isArray(shared)
          ? shared.filter((s) => !savedIds.includes(s.id))
          : [];
        window.localStorage.setItem(sharedKey, JSON.stringify(remaining));
      } catch (e) {
        console.warn("Cleanup after save failed", e);
      }
    } else {
      // save failed — we already opened a local preview earlier; do not clear items
    }
  };

  return (
    <div className="hotel-billing-page">
      <ShiftStatusBanner onOpen={() => openShiftDialog()} />

      {showSyncToast && (
        <div
          style={{ position: "fixed", right: 24, top: 24, zIndex: 1400 }}
          className="hotel-sync-toast"
        >
          Rooms synchronized
        </div>
      )}
      <div className="hotel-billing-header">
        <div className="hotel-billing-header-main">
          <div className="hotel-billing-title-row">
            <div className="hotel-billing-title-icon" data-tone={activeTab}>
              {activeTab === "lodging" ? <FaBed /> : <FaUtensils />}
            </div>
            <div>
              <div className="hotel-billing-eyebrow">Hotel POS</div>
              <h2>Hotel Billing</h2>
              <p>
                Record room charges, guest services and print a hotel invoice quickly. Switch
                between lodging and dining from the tabs below.
              </p>
            </div>
          </div>
        </div>
        <div className="hotel-billing-meta">
          <div className="hotel-billing-meta-card">
            <span>Cashier</span>
            <strong>{billedByDisplayName || "Guest"}</strong>
          </div>
          <div className="hotel-billing-meta-card">
            <span>Active tab</span>
            <strong data-tone={activeTab}>{activeTab === "lodging" ? "Lodging" : "Dining"}</strong>
          </div>
          <div className="hotel-billing-meta-card revenue">
            <span>Live cart</span>
            <strong>Rs {Math.round(grandTotal).toLocaleString("en-IN")}</strong>
          </div>
        </div>
      </div>

      <div className="hotel-table-status-panel">
        {activeTab === "lodging" && hotelModuleLock.lodgingLocked ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <HotelModuleLockScreen
              module="lodging"
              customerEmail={hotelModuleLock.customerEmail}
              bypassForSuperOwner={hotelModuleLock.bypassForSuperOwner}
            />
          </div>
        ) : activeTab === "dining" && hotelModuleLock.diningLocked ? (
          <div style={{ gridColumn: "1 / -1" }}>
            <HotelModuleLockScreen
              module="dining"
              customerEmail={hotelModuleLock.customerEmail}
              bypassForSuperOwner={hotelModuleLock.bypassForSuperOwner}
            />
          </div>
        ) : activeTab === "lodging" ? (
          <>
            <div className="hotel-status-card status-total">
              <div className="hotel-status-icon">
                <FaBed />
              </div>
              <div>
                <div className="hotel-status-title">Total Rooms</div>
                <strong className="hotel-status-value">{totalRooms}</strong>
              </div>
            </div>
            <div className="hotel-status-card status-vacant">
              <div className="hotel-status-icon">
                <FaDoorOpen />
              </div>
              <div>
                <div className="hotel-status-title">Vacant</div>
                <strong className="hotel-status-value">{vacantRooms}</strong>
              </div>
            </div>
            <div className="hotel-status-card status-occupied">
              <div className="hotel-status-icon">
                <FaUserTie />
              </div>
              <div>
                <div className="hotel-status-title">Occupied</div>
                <strong className="hotel-status-value">{occupiedRooms}</strong>
              </div>
            </div>
            <div className="hotel-status-card status-revenue">
              <div className="hotel-status-icon">
                <FaRupeeSign />
              </div>
              <div>
                <div className="hotel-status-title">Bookable Revenue</div>
                <strong className="hotel-status-value">₹{bookableRevenue}</strong>
              </div>
            </div>
            <div className="hotel-status-card hotel-status-card-cta">
              <div className="hotel-status-icon">
                <FaBroom />
              </div>
              <div>
                <div className="hotel-status-title">Housekeeping</div>
                <Link to="/hotel-housekeeping" className="hotel-status-link">
                  Open board
                </Link>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="hotel-status-card status-total">
              <div className="hotel-status-icon">
                <FaChair />
              </div>
              <div>
                <div className="hotel-status-title">Total Tables</div>
                <strong className="hotel-status-value">{totalTables}</strong>
              </div>
            </div>
            <div className="hotel-status-card status-vacant">
              <div className="hotel-status-icon">
                <FaDoorOpen />
              </div>
              <div>
                <div className="hotel-status-title">Empty Tables</div>
                <strong className="hotel-status-value">{emptyTables}</strong>
              </div>
            </div>
            <div className="hotel-status-card status-occupied">
              <div className="hotel-status-icon">
                <FaUserTie />
              </div>
              <div>
                <div className="hotel-status-title">Booked Tables</div>
                <strong className="hotel-status-value">{bookedTables}</strong>
              </div>
            </div>
            <div className="hotel-status-card hotel-status-link-card status-link">
              <div className="hotel-status-icon">
                <FaReceipt />
              </div>
              <div>
                <div className="hotel-status-title">Manage Tables</div>
                <Link to="/hotel-tables" className="hotel-status-link">
                  Open Table Booking
                </Link>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="hotel-billing-grid">
        <div className="hotel-billing-card hotel-billing-form">
          <div className="hotel-billing-tabs" data-active={activeTab}>
            <div className="hotel-billing-tabs-indicator" />
            {!hotelModuleLock.lodgingLocked ? (
              <button
                type="button"
                className={`hotel-billing-tab ${activeTab === "lodging" ? "active" : ""}`}
                onClick={() => setActiveTab("lodging")}
              >
                <FaBed />
                <span className="hotel-billing-tab-label">Lodging</span>
                {lodgingCount > 0 && (
                  <span className="hotel-billing-tab-badge">{lodgingCount}</span>
                )}
              </button>
            ) : null}
            {!hotelModuleLock.diningLocked ? (
              <button
                type="button"
                className={`hotel-billing-tab ${activeTab === "dining" ? "active" : ""}`}
                onClick={() => setActiveTab("dining")}
              >
                <FaUtensils />
                <span className="hotel-billing-tab-label">Dining</span>
                {diningCount > 0 && <span className="hotel-billing-tab-badge">{diningCount}</span>}
              </button>
            ) : null}
            <Link to="/hotel-tables" className="hotel-billing-tab hotel-billing-tab-link">
              <FaChair />
              <span className="hotel-billing-tab-label">Tables</span>
            </Link>
          </div>

          {/* Live "active bill" banner: shows what's in the cart right now, regardless of tab */}
          {filteredItems.length > 0 && (
            <div className="hotel-billing-active-banner" data-tone={activeTab}>
              <div className="hotel-billing-active-banner-icon">
                {activeTab === "lodging" ? <FaBed /> : <FaUtensils />}
              </div>
              <div className="hotel-billing-active-banner-text">
                <strong>
                  {activeTab === "lodging"
                    ? settleRoom?.name || activeDiningTable?.name || "Active lodging bill"
                    : activeDiningTable?.name ||
                      activeDiningBill?.tableName ||
                      "Active dining bill"}
                </strong>
                <span>
                  {filteredItems.length} item{filteredItems.length === 1 ? "" : "s"} · Subtotal Rs{" "}
                  {subtotal.toFixed(0)} · GST Rs {gstAmount.toFixed(0)} · Total Rs{" "}
                  {grandTotal.toFixed(0)}
                </span>
              </div>
              {otherTabHasItems && (
                <button
                  type="button"
                  className="hotel-billing-active-banner-cta"
                  onClick={() => setActiveTab(activeTab === "lodging" ? "dining" : "lodging")}
                >
                  {otherTabHasItems} {activeTab === "lodging" ? "dining" : "lodging"} item
                  {otherTabHasItems === 1 ? "" : "s"} waiting
                </button>
              )}
            </div>
          )}

          {activeTab === "lodging" ? (
            <div className="hotel-pos-section hotel-pos-section-lodging">
              <div className="hotel-pos-hero">
                <div>
                  <div className="hotel-pos-eyebrow">Lodging POS</div>
                  <div className="hotel-pos-heading-row">
                    <h3>Room billing and check-in workspace</h3>
                    <span className="hotel-pos-chip">{occupiedRooms} occupied</span>
                  </div>
                  <p>
                    Review room status, check guests in faster, and add manual lodging charges from
                    one focused workspace.
                  </p>
                </div>
                <div className="hotel-pos-hero-stats">
                  <div className="hotel-pos-mini-stat">
                    <span>Vacant rooms</span>
                    <strong>{vacantRooms}</strong>
                  </div>
                  <div className="hotel-pos-mini-stat accent-warm">
                    <span>Revenue view</span>
                    <strong>₹{bookableRevenue}</strong>
                  </div>
                </div>
              </div>
              {/* Quick-add and quick-edit UI injected above the lodging grid */}
              {/* Edit modal */}
              {quickEditEnabled && showEditModal && editingRoom && (
                <div className="hotel-edit-modal-backdrop">
                  <div className="hotel-edit-modal hotel-edit-booking-modal">
                    <div className="hotel-edit-booking-header">
                      <div>
                        <div className="hotel-quickbook-kicker">Edit Booking</div>
                        <h4>Edit booking {editingRoom.name}</h4>
                        <div className="hotel-quickbook-subtitle">
                          Update guest details, stay info and check-in/out timings.
                        </div>
                      </div>
                    </div>
                    <div className="form-grid">
                      <div>
                        <label>Guest name</label>
                        <input
                          className={editingRoomErrors.guest ? "error-input" : ""}
                          value={editingRoom.guest || ""}
                          onChange={(e) => {
                            setEditingRoom({ ...editingRoom, guest: e.target.value });
                            setEditingRoomErrors((prev) => ({ ...prev, guest: false }));
                          }}
                        />
                        {editingRoomErrors.guest && (
                          <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                            Guest name is required.
                          </small>
                        )}
                      </div>
                      <div>
                        <label>Guest mobile number</label>
                        <input
                          className={editingRoomErrors.mobile ? "error-input" : ""}
                          inputMode="numeric"
                          maxLength={10}
                          value={editingRoom.customerMobile || ""}
                          onChange={(e) => {
                            setEditingRoom({
                              ...editingRoom,
                              customerMobile: String(e.target.value || "")
                                .replace(/\D/g, "")
                                .slice(0, 10),
                            });
                            setEditingRoomErrors((prev) => ({ ...prev, mobile: false }));
                          }}
                          placeholder="Enter 10-digit mobile number"
                        />
                        {editingRoomErrors.mobile && (
                          <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                            Mobile number must be exactly 10 digits.
                          </small>
                        )}
                      </div>
                      <div>
                        <label>Nights</label>
                        <input
                          className={editingRoomErrors.nights ? "error-input" : ""}
                          type="text"
                          inputMode="numeric"
                          value={editingRoom.nights || 1}
                          onChange={(e) => {
                            const digits = String(e.target.value || "")
                              .replace(/\D/g, "")
                              .slice(0, 2);
                            const nextNights = digits ? Number(digits) : 1;
                            // Bidirectional wiring: changing Nights auto-fills
                            // the Check-out date (CheckInDate + Nights) so the
                            // Room Card, Live Bill, and printed Invoice stay
                            // consistent without a manual refresh.
                            const nextCheckOutDate = addNights(editingRoom.checkInDate, nextNights);
                            // If the cashier had already typed a checkout
                            // time, keep it (the overstay calc uses
                            // checkOutTime vs the standard; we don't change
                            // the time on Nights edits).
                            const nextCheckOutTime =
                              editingRoom.checkOutTime ||
                              String(getStoreSettings()?.hotelCheckoutTime || "11:00");
                            setEditingRoom({
                              ...editingRoom,
                              nights: nextNights,
                              checkOutDate: nextCheckOutDate,
                              checkOutTime: nextCheckOutTime,
                            });
                            setEditingRoomErrors((prev) => ({
                              ...prev,
                              nights: false,
                              checkOutDate: false,
                              checkOutTime: false,
                            }));
                          }}
                        />
                        {editingRoom.checkOutDate && editingRoom.checkInDate && (
                          <div className="field-hint">
                            Check-out: {editingRoom.checkOutDate} (auto from Nights)
                          </div>
                        )}
                      </div>
                      <div>
                        <label>Members</label>
                        <input
                          className={editingRoomErrors.members ? "error-input" : ""}
                          type="text"
                          inputMode="numeric"
                          value={editingRoom.members || 1}
                          onChange={(e) => {
                            const digits = String(e.target.value || "")
                              .replace(/\D/g, "")
                              .slice(0, 3);
                            const num = digits ? Number(digits) : 1;
                            const bedCount = Number(editingRoom.beds) || 1;
                            setEditingRoom({
                              ...editingRoom,
                              members: num > bedCount ? bedCount : num < 1 ? 1 : num,
                            });
                          }}
                        />
                        <div className="field-hint">
                          Max {editingRoom.beds || 1} members for this room.
                        </div>
                      </div>
                      <div className="hotel-edit-time-row">
                        <label>
                          <FaCalendarAlt aria-hidden="true" /> Check-in date
                        </label>
                        <input
                          type="date"
                          className={editingRoomErrors.checkIn ? "error-input" : ""}
                          value={editingRoom.checkInDate || ""}
                          onChange={(e) => {
                            const nextCheckInDate = e.target.value;
                            // When check-in date shifts, the Check-out date
                            // shifts with it (if Nights is unchanged). This
                            // keeps the bidirectional wiring tight: change
                            // any of {Check-in, Nights, Check-out} and the
                            // other two adjust to preserve the relationship.
                            const nextCheckOutDate = addNights(
                              nextCheckInDate,
                              editingRoom.nights || 1
                            );
                            setEditingRoom({
                              ...editingRoom,
                              checkInDate: nextCheckInDate,
                              checkOutDate: nextCheckOutDate,
                            });
                            setEditingRoomErrors((prev) => ({
                              ...prev,
                              checkIn: false,
                              checkOutDate: false,
                              checkOutTime: false,
                            }));
                          }}
                        />
                      </div>
                      <div className="hotel-edit-time-row">
                        <label>
                          <FaSignInAlt aria-hidden="true" /> Check-in time
                        </label>
                        <input
                          type="time"
                          className={editingRoomErrors.checkIn ? "error-input" : ""}
                          value={editingRoom.checkInTime || ""}
                          onChange={(e) => {
                            setEditingRoom({ ...editingRoom, checkInTime: e.target.value });
                            setEditingRoomErrors((prev) => ({ ...prev, checkIn: false }));
                          }}
                        />
                        {editingRoomErrors.checkIn && (
                          <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                            Check-in date and time are required.
                          </small>
                        )}
                      </div>
                      <div className="hotel-edit-time-row">
                        <label>
                          <FaSignOutAlt aria-hidden="true" /> Checkout date
                        </label>
                        <input
                          type="date"
                          className={
                            editingRoomErrors.checkOutDate || editingRoomErrors.checkOutTime
                              ? "error-input"
                              : ""
                          }
                          value={editingRoom.checkOutDate || ""}
                          min={editingRoom.checkInDate || undefined}
                          onChange={(e) => {
                            const nextCheckOutDate = e.target.value;
                            // Bidirectional wiring: changing the checkout
                            // date auto-updates Nights to stay in sync, so
                            // the guest's actual stay matches what the
                            // cashier books. Example: cashier books 1 night
                            // (Check-in 16-07, Check-out 17-07), guest stays
                            // until 18-07 → cashier changes Check-out to
                            // 18-07 → Nights auto-updates 1 → 2.
                            const computedNights = nextCheckOutDate
                              ? diffNights(editingRoom.checkInDate, nextCheckOutDate)
                              : null;
                            const updates = {
                              ...editingRoom,
                              checkOutDate: nextCheckOutDate,
                            };
                            if (computedNights && computedNights >= 1) {
                              updates.nights = computedNights;
                            }
                            // If the cashier had no checkout time yet,
                            // seed it to the standard (matches Quick Book
                            // auto-fill).
                            if (nextCheckOutDate && !editingRoom.checkOutTime) {
                              updates.checkOutTime = String(
                                getStoreSettings()?.hotelCheckoutTime || "11:00"
                              );
                            }
                            setEditingRoom(updates);
                            setEditingRoomErrors((prev) => ({
                              ...prev,
                              checkOutDate: false,
                              checkOutTime: false,
                            }));
                          }}
                        />
                        {editingRoom.checkOutDate &&
                          editingRoom.checkInDate &&
                          diffNights(editingRoom.checkInDate, editingRoom.checkOutDate) !==
                            null && (
                            <div className="field-hint">
                              Nights:{" "}
                              {diffNights(editingRoom.checkInDate, editingRoom.checkOutDate)}
                              (auto from Check-out)
                            </div>
                          )}
                      </div>
                      <div className="hotel-edit-time-row">
                        <label>
                          <FaSignOutAlt aria-hidden="true" /> Checkout time
                        </label>
                        <input
                          type="time"
                          className={
                            editingRoomErrors.checkOutDate || editingRoomErrors.checkOutTime
                              ? "error-input"
                              : ""
                          }
                          value={editingRoom.checkOutTime || ""}
                          onChange={(e) => {
                            setEditingRoom({ ...editingRoom, checkOutTime: e.target.value });
                            setEditingRoomErrors((prev) => ({
                              ...prev,
                              checkOutDate: false,
                              checkOutTime: false,
                            }));
                          }}
                        />
                        {(editingRoomErrors.checkOutDate || editingRoomErrors.checkOutTime) && (
                          <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                            {editingRoomErrors.checkOutDate && !editingRoom.checkOutTime
                              ? "Enter a checkout date or clear the checkout time."
                              : editingRoomErrors.checkOutTime && !editingRoom.checkOutDate
                                ? "Enter a checkout time or clear the checkout date."
                                : "Enter both checkout date and time (HH:MM)."}
                          </small>
                        )}
                        {!editingRoomErrors.checkOutDate && !editingRoomErrors.checkOutTime && (
                          <div className="field-hint">
                            Optional. Provide both date and time, or leave both blank.
                          </div>
                        )}
                      </div>
                      <div>
                        <label>Rate (₹)</label>
                        <input
                          className={editingRoomErrors.rate ? "error-input" : ""}
                          inputMode="numeric"
                          value={editingRoom.rate != null ? String(editingRoom.rate) : ""}
                          onChange={(e) => {
                            const digits = String(e.target.value || "").replace(/\D/g, "");
                            const truncated = digits.slice(0, 5);
                            setEditingRoom({ ...editingRoom, rate: truncated });
                          }}
                        />
                      </div>
                      <div>
                        <label>GST (%)</label>
                        <input
                          className={editingRoomErrors.gst ? "error-input" : ""}
                          inputMode="numeric"
                          value={editingRoom.gst != null ? String(editingRoom.gst) : ""}
                          onChange={(e) => {
                            const digits = String(e.target.value || "")
                              .replace(/\D/g, "")
                              .slice(0, 2);
                            setEditingRoom({ ...editingRoom, gst: digits });
                            setEditingRoomErrors((prev) => ({ ...prev, gst: false }));
                          }}
                        />
                        {editingRoomErrors.gst && (
                          <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                            GST is required. Enter a value from 0 to 99.
                          </small>
                        )}
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <label>Notes</label>
                        <input
                          value={editingRoom.notes || ""}
                          onChange={(e) =>
                            setEditingRoom({ ...editingRoom, notes: e.target.value })
                          }
                        />
                      </div>
                      <div
                        style={{
                          gridColumn: "1 / -1",
                          display: "grid",
                          gridTemplateColumns: "180px 1fr",
                          gap: 8,
                        }}
                      >
                        <div>
                          <label>ID type</label>
                          <select
                            className={editingRoomErrors.idType ? "error-input" : ""}
                            value={(editingRoom.idProof && editingRoom.idProof.type) || "Aadhar"}
                            onChange={(e) => {
                              setEditingRoom({
                                ...editingRoom,
                                idProof: { ...(editingRoom.idProof || {}), type: e.target.value },
                              });
                              setEditingRoomErrors((prev) => ({ ...prev, idType: false }));
                            }}
                          >
                            <option>Aadhar</option>
                            <option>Passport</option>
                            <option>Driving License</option>
                            <option>Voter ID</option>
                            <option>Other</option>
                          </select>
                          {editingRoomErrors.idType && (
                            <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                              ID proof type is required.
                            </small>
                          )}
                        </div>
                        <div>
                          <label>ID number</label>
                          <input
                            className={editingRoomErrors.idNumber ? "error-input" : ""}
                            placeholder="Enter ID number"
                            value={(editingRoom.idProof && editingRoom.idProof.number) || ""}
                            onChange={(e) => {
                              setEditingRoom({
                                ...editingRoom,
                                idProof: { ...(editingRoom.idProof || {}), number: e.target.value },
                              });
                              setEditingRoomErrors((prev) => ({ ...prev, idNumber: false }));
                            }}
                          />
                          {editingRoomErrors.idNumber && (
                            <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                              ID proof number is required.
                            </small>
                          )}
                        </div>
                        <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#666" }}>
                          ID proof is required for quick edit.
                        </div>
                      </div>
                    </div>
                    <div className="modal-actions hotel-quickbook-actions">
                      <button
                        type="button"
                        className="hotel-quickbook-btn hotel-quickbook-btn-cancel"
                        onClick={() => {
                          setShowEditModal(false);
                          if (editingRoom && editingRoom.id) {
                            try {
                              window.dispatchEvent(
                                new CustomEvent("hotel_room_draft_cleared", {
                                  detail: { id: editingRoom.id },
                                })
                              );
                            } catch (e) {}
                          }
                          setEditingRoom(null);
                        }}
                      >
                        <FaTimes className="hotel-quickbook-btn-icon" aria-hidden="true" />
                        <span>Cancel</span>
                      </button>
                      <button
                        type="button"
                        className="hotel-quickbook-btn hotel-quickbook-btn-confirm"
                        onClick={saveRoomEdits}
                      >
                        <FaSyncAlt className="hotel-quickbook-btn-icon" aria-hidden="true" />
                        <span>Save &amp; Sync</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Quick Book modal */}
              {showQuickBookModal && quickBookRoom && (
                <div className="hotel-edit-modal-backdrop hotel-quickbook-backdrop">
                  <div className="hotel-edit-modal hotel-quickbook-modal">
                    <div className="hotel-quickbook-header">
                      <div>
                        <div className="hotel-quickbook-kicker">Room Booking</div>
                        <h4>Quick Book {quickBookRoom.name}</h4>
                        <div className="hotel-quickbook-subtitle">
                          Capacity: {qbOpenDetails?.beds ?? quickBookRoom.beds ?? 1} members · Beds:{" "}
                          {quickBookRoom.beds ?? 1}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="hotel-quickbook-close"
                        aria-label="Close quick book modal"
                        onClick={() => {
                          setShowQuickBookModal(false);
                          try {
                            window.dispatchEvent(
                              new CustomEvent("hotel_room_draft_cleared", {
                                detail: { id: quickBookRoom.id },
                              })
                            );
                          } catch (e) {}
                          setQuickBookRoom(null);
                        }}
                      >
                        ×
                      </button>
                    </div>
                    {qbSettings ? (
                      <div className="hotel-quickbook-settings-pill" role="note">
                        <span>
                          <strong>Check-in:</strong> {qbSettings.hotelCheckinTime || "12:00"}
                        </span>
                        <span>
                          <strong>Check-out:</strong> {qbSettings.hotelCheckoutTime || "11:00"}
                        </span>
                        {Number(qbSettings.hotelLateCheckoutFeePerHour) > 0 ? (
                          <span>
                            <strong>Late fee:</strong> ₹{qbSettings.hotelLateCheckoutFeePerHour}/hr
                          </span>
                        ) : null}
                        {Number(qbSettings.hotelEarlyCheckinFee) > 0 ? (
                          <span>
                            <strong>Early fee:</strong> ₹{qbSettings.hotelEarlyCheckinFee}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="form-grid">
                      <div>
                        <label>Guest name</label>
                        <input
                          className={qbErrors.guest ? "error-input" : ""}
                          value={qbGuestName}
                          onChange={(e) => {
                            setQbGuestName(sanitizeGuestName(e.target.value));
                            setQbErrors((prev) => ({ ...prev, guest: false }));
                          }}
                          placeholder="Guest name"
                        />
                        {qbErrors.guest && (
                          <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                            Guest name must contain only letters and spaces.
                          </small>
                        )}
                      </div>
                      <div>
                        <label>Guest mobile number</label>
                        <input
                          className={qbErrors.mobile ? "error-input" : ""}
                          inputMode="numeric"
                          maxLength={10}
                          value={qbCustomerMobile}
                          onChange={(e) => {
                            setQbCustomerMobile(
                              String(e.target.value || "")
                                .replace(/\D/g, "")
                                .slice(0, 10)
                            );
                            setQbErrors((prev) => ({ ...prev, mobile: false }));
                          }}
                          placeholder="Enter 10-digit mobile number"
                        />
                        {qbErrors.mobile && (
                          <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                            Mobile number must be exactly 10 digits.
                          </small>
                        )}
                      </div>
                      <div>
                        <label>Nights</label>
                        <input
                          className={qbErrors.nights ? "error-input" : ""}
                          type="text"
                          inputMode="numeric"
                          value={qbNights}
                          onChange={(e) => {
                            const digits = String(e.target.value || "")
                              .replace(/\D/g, "")
                              .slice(0, 2);
                            setQbNights(digits ? Number(digits) : 1);
                          }}
                        />
                      </div>
                      <div>
                        <label>Members</label>
                        <input
                          className={qbErrors.members ? "error-input" : ""}
                          type="text"
                          inputMode="numeric"
                          value={qbMembers}
                          onChange={(e) => {
                            const digits = String(e.target.value || "")
                              .replace(/\D/g, "")
                              .slice(0, 3);
                            const num = digits ? Number(digits) : 1;
                            const bedCount = Number(quickBookRoom.beds) || 1;
                            setQbMembers(num > bedCount ? bedCount : num < 1 ? 1 : num);
                          }}
                        />
                        <div className="field-hint">
                          Max {quickBookRoom.beds || 1} members for this room.
                        </div>
                      </div>
                      <div>
                        <label>Rate (₹)</label>
                        <input
                          className={qbErrors.rate ? "error-input" : ""}
                          inputMode="numeric"
                          value={qbRate}
                          onChange={(e) => {
                            const digits = String(e.target.value || "").replace(/\D/g, "");
                            const truncated = digits.slice(0, 5);
                            setQbRate(truncated);
                          }}
                        />
                      </div>
                      <div>
                        <label>Check-in Date</label>
                        <input
                          type="date"
                          value={qbCheckInDate}
                          onChange={(e) => setQbCheckInDate(e.target.value)}
                        />
                      </div>
                      <div>
                        <label>Check-in Time</label>
                        <input
                          type="time"
                          value={qbCheckInTime}
                          onChange={(e) => setQbCheckInTime(e.target.value)}
                        />
                      </div>
                      <div>
                        <label>GST (%)</label>
                        <input
                          className={qbErrors.gst ? "error-input" : ""}
                          inputMode="numeric"
                          value={qbGst}
                          onChange={(e) => {
                            const digits = String(e.target.value || "").replace(/\D/g, "");
                            const truncated = digits.slice(0, 2);
                            setQbGst(truncated);
                            setQbErrors((prev) => ({ ...prev, gst: false }));
                          }}
                        />
                        {qbErrors.gst && (
                          <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                            GST is required. Enter a value from 0 to 99.
                          </small>
                        )}
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <label>Notes</label>
                        <input value={qbNotes} onChange={(e) => setQbNotes(e.target.value)} />
                      </div>
                      <div
                        style={{
                          gridColumn: "1 / -1",
                          display: "grid",
                          gridTemplateColumns: "180px 1fr",
                          gap: 8,
                        }}
                      >
                        <div>
                          <label>ID type</label>
                          <select
                            className={qbErrors.idType ? "error-input" : ""}
                            value={qbIdType}
                            onChange={(e) => {
                              setQbIdType(e.target.value);
                              setQbErrors((prev) => ({ ...prev, idType: false }));
                            }}
                          >
                            <option value="" disabled>
                              Select ID type
                            </option>
                            <option>Aadhar</option>
                            <option>Passport</option>
                            <option>Driving License</option>
                            <option>Voter ID</option>
                            <option>Other</option>
                          </select>
                          {qbErrors.idType && (
                            <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                              ID proof type is required.
                            </small>
                          )}
                        </div>
                        <div>
                          <label>ID number</label>
                          <input
                            className={qbErrors.idNumber ? "error-input" : ""}
                            placeholder="Enter ID number"
                            value={qbIdNumber}
                            onChange={(e) => {
                              setQbIdNumber(e.target.value);
                              setQbErrors((prev) => ({ ...prev, idNumber: false }));
                            }}
                          />
                          {qbErrors.idNumber && (
                            <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                              ID proof number is required.
                            </small>
                          )}
                        </div>
                        <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#666" }}>
                          ID proof is required for quick booking.
                        </div>
                      </div>
                    </div>
                    <div className="modal-actions hotel-quickbook-actions">
                      <button
                        type="button"
                        className="hotel-quickbook-btn hotel-quickbook-btn-cancel"
                        onClick={() => {
                          setShowQuickBookModal(false);
                          try {
                            window.dispatchEvent(
                              new CustomEvent("hotel_room_draft_cleared", {
                                detail: { id: quickBookRoom.id },
                              })
                            );
                          } catch (e) {}
                          setQuickBookRoom(null);
                        }}
                      >
                        <FaTimes className="hotel-quickbook-btn-icon" aria-hidden="true" />
                        <span>Cancel</span>
                      </button>
                      <button
                        type="button"
                        className="hotel-quickbook-btn hotel-quickbook-btn-confirm"
                        onClick={handleQuickBook}
                      >
                        <FaSyncAlt className="hotel-quickbook-btn-icon" aria-hidden="true" />
                        <span>Book &amp; Sync</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
              <div className="hotel-pos-layout">
                <div className="hotel-pos-panel hotel-pos-panel-main">
                  <div className="hotel-pos-panel-head">
                    <div>
                      <div className="hotel-section-title">Live Room Board</div>
                      <p>
                        Track availability, current guests, pricing, and checkout actions at a
                        glance.
                      </p>
                    </div>
                    <span className="hotel-pos-chip subtle">{lodgingRooms.length} rooms</span>
                  </div>
                  <div className="hotel-table-grid">
                    {lodgingRooms.map((room) => (
                      <RoomCard
                        key={room.id}
                        room={room}
                        isEditing={editingRoom && editingRoom.id === room.id}
                        quickEditEnabled={quickEditEnabled}
                        onQuickBook={openQuickBook}
                        onQuickEdit={openQuickEdit}
                        onCheckout={handleCheckoutFromBilling}
                        onCopyMobile={(mobile) => showToast?.("info", `Copied ${mobile}`)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div className="hotel-pos-panel hotel-charge-panel">
                <div className="hotel-pos-panel-head">
                  <div>
                    <div className="hotel-section-title">Add Lodging Charge</div>
                    <p>
                      Add extra charges like late checkout, service fees, or custom room
                      adjustments.
                    </p>
                  </div>
                </div>
                <div className="hotel-form-split">
                  <div className="hotel-field-row">
                    <label>Description</label>
                    <input
                      value={lodgingDescription}
                      onChange={(e) => setLodgingDescription(e.target.value)}
                      placeholder="Room charge, service charge, late checkout"
                    />
                  </div>
                  <div className="hotel-field-row">
                    <label>Amount</label>
                    <input
                      type="number"
                      min="0"
                      value={lodgingAmount}
                      onChange={(e) => setLodgingAmount(e.target.value)}
                      placeholder="Enter amount"
                    />
                  </div>
                </div>
                <div className="hotel-add-actions">
                  <button
                    type="button"
                    className="btn-add-item"
                    onClick={addLodgingCharge}
                    disabled={hotelModuleLock.liveBillLocked}
                    title={
                      hotelModuleLock.liveBillLocked
                        ? "Live Bill is locked by the Super Owner"
                        : undefined
                    }
                  >
                    <FaPlus /> Add Lodging Charge
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="hotel-pos-section hotel-pos-section-dining">
              <div className="hotel-pos-hero dining">
                <div className="hotel-pos-hero-decor" aria-hidden="true">
                  <FaConciergeBell />
                </div>
                <div>
                  <div className="hotel-pos-eyebrow">Dining POS</div>
                  <div className="hotel-pos-heading-row">
                    <h3>Floor service and live table billing</h3>
                    <span className="hotel-pos-chip dining">{bookedTables} active tables</span>
                  </div>
                  <p>
                    Manage active tables, attach menu items quickly, and keep service teams aligned
                    with one clean dining console.
                  </p>
                </div>
                <div className="hotel-pos-hero-stats">
                  <div className="hotel-pos-mini-stat dining">
                    <span>Empty tables</span>
                    <strong>{emptyTables}</strong>
                  </div>
                  <div className="hotel-pos-mini-stat accent-gold">
                    <span>Open bill items</span>
                    <strong>{activeDiningBill?.openItemCount || 0}</strong>
                  </div>
                </div>
              </div>

              <div className="hotel-dashboard-stats">
                <div className="hotel-stat-card stat-total">
                  <div className="hotel-stat-card-icon">
                    <FaTable />
                  </div>
                  <div className="hotel-stat-card-body">
                    <span>Total Tables</span>
                    <strong>{tables.length}</strong>
                  </div>
                </div>
                <div className="hotel-stat-card stat-available">
                  <div className="hotel-stat-card-icon">
                    <FaCheckCircle />
                  </div>
                  <div className="hotel-stat-card-body">
                    <span>Available</span>
                    <strong>{emptyTables}</strong>
                  </div>
                </div>
                <div className="hotel-stat-card stat-occupied">
                  <div className="hotel-stat-card-icon">
                    <FaChair />
                  </div>
                  <div className="hotel-stat-card-body">
                    <span>Occupied</span>
                    <strong>{bookedTables}</strong>
                  </div>
                </div>
                {hotelModuleLock.liveBillLocked ? (
                  <div className="hotel-stat-card stat-bill is-locked">
                    <div className="hotel-stat-card-icon">
                      <FaLock aria-hidden="true" />
                    </div>
                    <div className="hotel-stat-card-body">
                      <span>Live Bill Total</span>
                      <strong style={{ fontSize: 14, color: "#dc2626" }}>Locked</strong>
                    </div>
                  </div>
                ) : (
                  <div className="hotel-stat-card stat-bill">
                    <div className="hotel-stat-card-icon">
                      <FaReceipt />
                    </div>
                    <div className="hotel-stat-card-body">
                      <span>Live Bill Total</span>
                      <strong>₹{Number(activeDiningBill?.totalAmount || 0).toFixed(0)}</strong>
                    </div>
                  </div>
                )}
              </div>

              <div
                className={`hotel-pos-panel hotel-dining-brief ${
                  activeDiningTable ? "is-active" : "is-empty"
                }`}
                style={{ marginBottom: 18 }}
              >
                <div className="hotel-pos-panel-head">
                  <div>
                    <div className="hotel-section-title">Table Billing</div>
                    <p>
                      Use the active table context below to add menu items to the correct dining
                      bill.
                    </p>
                  </div>
                </div>
                {activeDiningTable ? (
                  <div className="hotel-dining-brief-grid">
                    <div className="hotel-dining-brief-stat">
                      <div className="hotel-dining-brief-stat-icon table">
                        <FaChair />
                      </div>
                      <div className="hotel-dining-brief-stat-body">
                        <span>Table</span>
                        <strong>{activeDiningBill?.tableName || activeDiningTable.name}</strong>
                      </div>
                    </div>
                    <div className="hotel-dining-brief-stat">
                      <div className="hotel-dining-brief-stat-icon guest">
                        <FaUtensils />
                      </div>
                      <div className="hotel-dining-brief-stat-body">
                        <span>Guest</span>
                        <strong>
                          {activeDiningBill?.guestName || activeDiningTable.guest || "Walk-in"}
                        </strong>
                      </div>
                    </div>
                    <div className="hotel-dining-brief-stat">
                      <div className="hotel-dining-brief-stat-icon party">
                        <FaUserTie />
                      </div>
                      <div className="hotel-dining-brief-stat-body">
                        <span>Party</span>
                        <strong>
                          {activeDiningBill?.partySize || activeDiningTable.partySize || 0} pax
                        </strong>
                      </div>
                    </div>
                    {activeDiningCheckIn && (
                      <div className="hotel-dining-brief-stat">
                        <div className="hotel-dining-brief-stat-icon time">
                          <FaCalendarAlt />
                        </div>
                        <div className="hotel-dining-brief-stat-body">
                          <span>Check-in</span>
                          <strong>{activeDiningCheckIn}</strong>
                        </div>
                      </div>
                    )}
                    {hotelModuleLock.liveBillLocked ? (
                      <div className="hotel-dining-brief-stat is-locked">
                        <div className="hotel-dining-brief-stat-icon bill">
                          <FaLock aria-hidden="true" />
                        </div>
                        <div className="hotel-dining-brief-stat-body">
                          <span>Live Bill</span>
                          <strong style={{ color: "#dc2626" }}>Locked</strong>
                        </div>
                      </div>
                    ) : (
                      <div className="hotel-dining-brief-stat">
                        <div className="hotel-dining-brief-stat-icon bill">
                          <FaReceipt />
                        </div>
                        <div className="hotel-dining-brief-stat-body">
                          <span>Live Bill</span>
                          <strong>
                            {activeDiningBill?.openItemCount || 0} item(s) · ₹
                            {Number(activeDiningBill?.totalAmount || 0).toFixed(0)}
                          </strong>
                        </div>
                      </div>
                    )}
                    {activeDiningSummary && (
                      <div className="hotel-dining-brief-summary">
                        <FaUtensils aria-hidden="true" />
                        <span>{activeDiningSummary}</span>
                      </div>
                    )}
                    <div className="hotel-dining-brief-cta">
                      <FaArrowRight aria-hidden="true" />
                      <span>Choose a dining item below and add it to this table bill.</span>
                    </div>
                  </div>
                ) : (
                  <div className="hotel-dining-brief-empty">
                    <div className="hotel-dining-brief-empty-icon">
                      <FaConciergeBell />
                    </div>
                    <div className="hotel-dining-brief-empty-body">
                      <strong>No active table yet</strong>
                      <span>
                        1. Book a table. 2. Click the booked table card. 3. Select a dining item and
                        add it to the bill.
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {selectedDiningTable && (
                <div className="hotel-edit-modal-backdrop">
                  <div className="hotel-edit-modal hotel-quickbook-modal hotel-dining-booking-modal">
                    <div className="hotel-quickbook-header hotel-dining-booking-header">
                      <div>
                        <div className="hotel-quickbook-kicker">
                          {isEditingDiningTable ? "Edit Table Booking" : "Quick Table Booking"}
                        </div>
                        <h4>
                          <FaTable
                            className="hotel-dining-booking-header-icon"
                            aria-hidden="true"
                          />
                          {isEditingDiningTable
                            ? `Edit ${selectedDiningTable.name}`
                            : `Book ${selectedDiningTable.name}`}
                        </h4>
                        <div className="hotel-quickbook-subtitle">
                          {isEditingDiningTable
                            ? "Update guest details, party size and pre-ordered items."
                            : "Capture guest details, party size and pre-order items before seating."}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="hotel-quickbook-close"
                        onClick={closeDiningTableBooking}
                        aria-label="Close table booking"
                        title="Close"
                      >
                        <FaTimes aria-hidden="true" />
                      </button>
                    </div>
                    <div className="form-grid hotel-dining-booking-grid">
                      {isEditingDiningTable && (
                        <>
                          <div>
                            <label>Table name</label>
                            <input
                              value={editDiningTableName}
                              onChange={(e) => setEditDiningTableName(e.target.value)}
                            />
                          </div>
                          <div>
                            <label>Seats</label>
                            <select
                              value={editDiningTableSeats}
                              onChange={(e) => setEditDiningTableSeats(Number(e.target.value))}
                            >
                              {[2, 4, 6, 8, 10].map((seatCount) => (
                                <option key={seatCount} value={seatCount}>
                                  {seatCount} seats
                                </option>
                              ))}
                            </select>
                          </div>
                          <div style={{ gridColumn: "1 / -1" }}>
                            <label>Zone</label>
                            <select
                              value={editDiningTableZone}
                              onChange={(e) => setEditDiningTableZone(e.target.value)}
                            >
                              {["Main", "Window", "Garden", "Terrace"].map((zone) => (
                                <option key={zone} value={zone}>
                                  {zone}
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}
                      <div>
                        <label>Guest name</label>
                        <input
                          className={diningGuestError ? "error-input" : ""}
                          value={diningGuestName}
                          onChange={(e) => {
                            setDiningGuestName(sanitizeGuestName(e.target.value));
                            setDiningGuestError("");
                          }}
                          placeholder="Guest name"
                        />
                        {diningGuestError && (
                          <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                            {diningGuestError}
                          </small>
                        )}
                      </div>
                      <div>
                        <label>Customer mobile number</label>
                        <input
                          type="tel"
                          inputMode="numeric"
                          className={diningMobileError ? "error-input" : ""}
                          value={diningCustomerMobile}
                          onChange={(e) => {
                            setDiningCustomerMobile(
                              e.target.value.replace(/[^0-9]/g, "").slice(0, 10)
                            );
                            setDiningMobileError("");
                          }}
                          placeholder="Enter mobile number"
                        />
                        {diningMobileError && (
                          <small style={{ color: "#d11a2a", display: "block", marginTop: 4 }}>
                            {diningMobileError}
                          </small>
                        )}
                      </div>
                      <div>
                        <label>Party Size</label>
                        <input
                          type="number"
                          min="1"
                          max={selectedDiningTable.seats}
                          value={diningPartySize}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            const clamped = Number.isNaN(value)
                              ? 1
                              : Math.max(
                                  1,
                                  Math.min(value, Number(selectedDiningTable.seats || 1))
                                );
                            setDiningPartySize(clamped);
                          }}
                        />
                        <div className="field-hint">
                          Allowed seats: 1 to {selectedDiningTable.seats}.
                        </div>
                      </div>
                      <div style={{ gridColumn: "1 / -1" }}>
                        <label>
                          <FaUtensils aria-hidden="true" /> Ordered menu
                        </label>
                        <div className="hotel-booking-menu-picker">
                          <div className="hotel-booking-menu-picker-search">
                            <input
                              className="form-control"
                              placeholder="Search menu…"
                              value={diningMenuSearch}
                              onChange={(e) => setDiningMenuSearch(e.target.value)}
                            />
                          </div>
                          <div className="hotel-booking-menu-picker-select">
                            <select
                              value={selectedDiningMenuProductId}
                              onChange={(e) => setSelectedDiningMenuProductId(e.target.value)}
                              className="form-control"
                            >
                              <option value="">Select Hotel Menu item</option>
                              {bookingMenuOptionsByCategory.map((group) => (
                                <optgroup key={group.category} label={group.category}>
                                  {group.options.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </div>
                          <button
                            className="hotel-booking-menu-add-btn"
                            type="button"
                            onClick={handleAddSelectedDiningMenu}
                            disabled={
                              hotelModuleLock.liveBillLocked || !selectedDiningMenuProductId
                            }
                            title={
                              hotelModuleLock.liveBillLocked
                                ? "Live Bill is locked by the Super Owner"
                                : selectedDiningMenuProductId
                                  ? "Add selected menu item"
                                  : "Pick an item first"
                            }
                          >
                            <FaPlus
                              className="hotel-booking-menu-add-btn-icon"
                              aria-hidden="true"
                            />
                            <span>Add</span>
                          </button>
                        </div>
                        <div className="field-hint">
                          Tap any card below to add it to the table order. Items reflect the live
                          Hotel Menu catalog.
                        </div>

                        {/* Visible menu gallery — grouped by category, all items tap-to-add */}
                        {bookingMenuOptionsByCategory.length === 0 ? (
                          <div className="hotel-booking-menu-empty">
                            No available Hotel Menu items found. Add items in Hotel Menu first.
                          </div>
                        ) : (
                          <div className="hotel-booking-menu-gallery">
                            {bookingMenuOptionsByCategory.map((group) => {
                              const filteredOptions = diningMenuSearch.trim()
                                ? group.options.filter((o) => {
                                    const q = diningMenuSearch.trim().toLowerCase();
                                    return (
                                      String(o.product?.name || "")
                                        .toLowerCase()
                                        .includes(q) ||
                                      String(o.product?.category || "")
                                        .toLowerCase()
                                        .includes(q)
                                    );
                                  })
                                : group.options;
                              if (filteredOptions.length === 0) return null;
                              return (
                                <div key={group.category} className="hotel-booking-menu-group">
                                  <div className="hotel-booking-menu-group-title">
                                    {group.category}
                                  </div>
                                  <div className="hotel-booking-menu-grid">
                                    {filteredOptions.map((option) => {
                                      const p = option.product || {};
                                      const stockState = getDiningStockState(p);
                                      const isVeg = p.isVeg !== false;
                                      const isJain = p.isJain === true;
                                      return (
                                        <button
                                          type="button"
                                          key={option.value}
                                          className={`hotel-booking-menu-card ${stockState !== "ok" ? `is-${stockState}` : ""} ${isVeg ? "is-veg" : "is-nonveg"}`}
                                          onClick={() => handleAddMenuCard(option.product)}
                                          disabled={
                                            hotelModuleLock.liveBillLocked || stockState === "out"
                                          }
                                          title={
                                            hotelModuleLock.liveBillLocked
                                              ? "Live Bill is locked by the Super Owner"
                                              : stockState === "out"
                                                ? "Out of stock"
                                                : `Tap to add ${p.name}`
                                          }
                                        >
                                          <div
                                            className="hotel-booking-menu-card-dot"
                                            aria-hidden="true"
                                          >
                                            {isVeg ? "●" : "○"}
                                          </div>
                                          <div className="hotel-booking-menu-card-body">
                                            <strong>{p.name}</strong>
                                            {isJain && (
                                              <span className="hotel-booking-menu-card-jain">
                                                Jain
                                              </span>
                                            )}
                                          </div>
                                          <div className="hotel-booking-menu-card-price">
                                            Rs {Number(p.fullPrice || p.price || 0).toFixed(0)}
                                          </div>
                                          {stockState === "low" && (
                                            <span className="hotel-booking-menu-card-stock low">
                                              Low
                                            </span>
                                          )}
                                          {stockState === "out" && (
                                            <span className="hotel-booking-menu-card-stock out">
                                              Out
                                            </span>
                                          )}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {selectedDiningMenus.length > 0 ? (
                          <div className="hotel-booking-menu-list">
                            <div className="hotel-booking-menu-list-head">
                              <div className="hotel-booking-menu-list-count">
                                <FaUtensils
                                  className="hotel-booking-menu-list-count-icon"
                                  aria-hidden="true"
                                />
                                <strong>
                                  {selectedDiningMenus.length} item
                                  {selectedDiningMenus.length === 1 ? "" : "s"} added
                                </strong>
                              </div>
                              <span className="hotel-booking-menu-list-total">
                                Subtotal Rs{" "}
                                {selectedDiningMenus
                                  .reduce(
                                    (s, m) =>
                                      s + Number(m.price || 0) * Math.max(1, Number(m.qty || 1)),
                                    0
                                  )
                                  .toFixed(0)}
                              </span>
                            </div>
                            {selectedDiningMenus.map((menuItem, index) => (
                              <div
                                key={`${menuItem.productId || menuItem.name}-${index}`}
                                className="hotel-booking-menu-chip"
                              >
                                <div className="hotel-booking-menu-chip-info">
                                  <strong>{menuItem.name}</strong>
                                  {menuItem.category && (
                                    <span>
                                      {menuItem.category} · Rs{" "}
                                      {Number(menuItem.price || 0).toFixed(0)}
                                    </span>
                                  )}
                                </div>
                                <div className="hotel-booking-menu-chip-actions">
                                  <div className="hotel-booking-menu-qty">
                                    <button
                                      type="button"
                                      className="hotel-booking-menu-qty-btn"
                                      onClick={() => handleDiningMenuQtyChange(index, -1)}
                                      aria-label="Decrease quantity"
                                      title="Decrease quantity"
                                    >
                                      −
                                    </button>
                                    <span className="hotel-booking-menu-qty-value">
                                      {Math.max(1, Number(menuItem.qty || 1))}
                                    </span>
                                    <button
                                      type="button"
                                      className="hotel-booking-menu-qty-btn"
                                      onClick={() => handleDiningMenuQtyChange(index, 1)}
                                      aria-label="Increase quantity"
                                      title="Increase quantity"
                                    >
                                      +
                                    </button>
                                  </div>
                                  <button
                                    type="button"
                                    className="hotel-booking-menu-chip-remove"
                                    onClick={() => handleRemoveSelectedDiningMenu(index)}
                                    aria-label={`Remove ${menuItem.name}`}
                                    title="Remove from order"
                                  >
                                    <FaTrash aria-hidden="true" />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="hotel-booking-menu-empty">
                            <FaUtensils
                              className="hotel-booking-menu-empty-icon"
                              aria-hidden="true"
                            />
                            <span>No menu item selected yet. Tap a card above to add.</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="modal-actions hotel-quickbook-actions hotel-dining-booking-actions">
                      <button
                        type="button"
                        className="hotel-quickbook-btn hotel-quickbook-btn-cancel"
                        onClick={closeDiningTableBooking}
                      >
                        <FaTimes className="hotel-quickbook-btn-icon" aria-hidden="true" />
                        <span>Cancel</span>
                      </button>
                      <button
                        type="button"
                        className="hotel-quickbook-btn hotel-quickbook-btn-confirm"
                        onClick={handleDiningTableBook}
                      >
                        {isEditingDiningTable ? (
                          <FaSyncAlt className="hotel-quickbook-btn-icon" aria-hidden="true" />
                        ) : (
                          <FaCheckCircle className="hotel-quickbook-btn-icon" aria-hidden="true" />
                        )}
                        <span>{isEditingDiningTable ? "Save & Sync" : "Confirm Booking"}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="hotel-pos-panel hotel-pos-panel-main" style={{ marginBottom: 18 }}>
                <div className="hotel-pos-panel-head">
                  <div>
                    <div className="hotel-quickbook-kicker hotel-dining-floor-kicker">
                      <FaChair aria-hidden="true" /> Dining Floor
                    </div>
                    <div className="hotel-section-title">Dining Floor Map</div>
                    <p>
                      Pick a table card to view or add billing items, or book a new guest on an open
                      table.
                    </p>
                  </div>
                </div>
                <div className="hotel-page-toolbar">
                  <div className="hotel-page-toolbar-search">
                    <FaSearch className="hotel-page-toolbar-search-icon" aria-hidden="true" />
                    <input
                      type="text"
                      placeholder="Search table by name…"
                      value={diningTableSearch}
                      onChange={(e) => setDiningTableSearch(e.target.value)}
                      aria-label="Search dining tables"
                    />
                    {diningTableSearch && (
                      <button
                        type="button"
                        className="hotel-page-toolbar-search-clear"
                        onClick={() => setDiningTableSearch("")}
                        aria-label="Clear table search"
                        title="Clear"
                      >
                        <FaTimes aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <div
                    className="hotel-page-toolbar-filters"
                    role="tablist"
                    aria-label="Zone filter"
                  >
                    {[
                      { value: "all", label: "All zones", icon: FaTable },
                      { value: "Main", label: "Main", icon: FaChair },
                      { value: "Window", label: "Window", icon: FaChair },
                      { value: "Garden", label: "Garden", icon: FaChair },
                      { value: "Terrace", label: "Terrace", icon: FaChair },
                    ].map((filter) => {
                      const Icon = filter.icon;
                      const isActive = diningZoneFilter === filter.value;
                      return (
                        <button
                          key={filter.value}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          className={`hotel-page-toolbar-filter ${isActive ? "is-active" : ""}`}
                          onClick={() => setDiningZoneFilter(filter.value)}
                        >
                          <Icon aria-hidden="true" />
                          <span>{filter.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="hotel-table-grid">
                  {(() => {
                    const query = diningTableSearch.trim().toLowerCase();
                    const filteredTables = tables.filter((table) => {
                      if (
                        diningZoneFilter !== "all" &&
                        String(table.zone || "Main") !== diningZoneFilter
                      ) {
                        return false;
                      }
                      if (!query) return true;
                      return (
                        String(table.name || "")
                          .toLowerCase()
                          .includes(query) ||
                        String(table.zone || "")
                          .toLowerCase()
                          .includes(query) ||
                        String(table.guest || "")
                          .toLowerCase()
                          .includes(query)
                      );
                    });
                    if (filteredTables.length === 0) {
                      return (
                        <div className="hotel-table-grid-empty">
                          <div className="hotel-table-grid-empty-icon">
                            <FaConciergeBell />
                          </div>
                          <strong>No tables match your filter</strong>
                          <span>Try a different search term or zone to see more tables.</span>
                          <button
                            type="button"
                            className="hotel-quickbook-btn hotel-quickbook-btn-cancel"
                            onClick={() => {
                              setDiningTableSearch("");
                              setDiningZoneFilter("all");
                            }}
                          >
                            <FaTimes className="hotel-quickbook-btn-icon" aria-hidden="true" />
                            <span>Reset filters</span>
                          </button>
                        </div>
                      );
                    }
                    return filteredTables.map((table) => {
                      const isActive = String(activeDiningTableId) === String(table.id);
                      const isSelected = String(selectedDiningTable?.id) === String(table.id);
                      const waitingMatch =
                        table.status === "empty"
                          ? waitingQueue.filter((entry) => table.seats >= entry.seats).length
                          : 0;
                      return (
                        <DiningTableCard
                          key={table.id}
                          table={table}
                          isActive={isActive}
                          isSelected={isSelected}
                          waitingMatch={waitingMatch}
                          getCardSummary={getDiningCardSummary}
                          onActivate={(t) => setActiveDiningTableId(String(t.id))}
                          onBook={openDiningTableBooking}
                          onEdit={openDiningTableEdit}
                          onClear={handleDiningTableClear}
                          onDelete={handleDiningTableDelete}
                          onCopyPhone={(mobile) => showToast?.("info", `Copied ${mobile}`)}
                        />
                      );
                    });
                  })()}
                </div>
              </div>

              <div className="hotel-pos-panel hotel-charge-panel">
                <div className="hotel-pos-panel-head">
                  <div>
                    <div className="hotel-quickbook-kicker hotel-charge-kicker">
                      <FaUtensils aria-hidden="true" /> Add Dining Item
                    </div>
                    <div className="hotel-section-title">Send items to active table</div>
                    <p>
                      Send food and beverage items to the active table bill with clear product,
                      variant, and quantity controls.
                    </p>
                  </div>
                </div>
                <div
                  className={`hotel-context-strip ${
                    activeDiningTable
                      ? isDiningBillEditable
                        ? "is-active"
                        : "is-cleared"
                      : "is-empty"
                  }`}
                  style={{ marginBottom: 14 }}
                >
                  <div className="hotel-context-strip-icon">
                    {activeDiningTable ? (
                      isDiningBillEditable ? (
                        <FaShoppingCart />
                      ) : (
                        <FaCheckCircle />
                      )
                    ) : (
                      <FaInfoCircle />
                    )}
                  </div>
                  <div className="hotel-context-strip-body">
                    <strong>
                      {activeDiningTable
                        ? isDiningBillEditable
                          ? `Adding items to ${activeDiningBill?.tableName || activeDiningTable.name}`
                          : `Viewing cleared bill for ${activeDiningBill?.tableName || activeDiningTable.name}`
                        : "No active table selected"}
                    </strong>
                    <span>
                      {activeDiningTable
                        ? `${activeDiningBill?.guestName || activeDiningTable.guest || "Walk-in"}${
                            activeDiningTable.partySize
                              ? ` · Party of ${activeDiningTable.partySize}`
                              : ""
                          }`
                        : "Select a booked table card first. Billing items are always added table-wise."}
                    </span>
                  </div>
                </div>
                <div className="hotel-form-split hotel-form-split-wide">
                  <div className="hotel-field-row">
                    <label>
                      <FaUtensils aria-hidden="true" /> Select dining item
                    </label>
                    <select
                      value={selectedProduct}
                      onChange={(e) => setSelectedProduct(e.target.value)}
                      disabled={!isDiningBillEditable}
                    >
                      <option value="">Choose a dining product</option>
                      {productOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {activeProduct && (
                    <>
                      <div className="hotel-product-info">
                        {activeProduct.description && (
                          <div className="hotel-product-info-desc">
                            <FaInfoCircle aria-hidden="true" />
                            <span>
                              {activeProduct.description || "No menu description available."}
                            </span>
                          </div>
                        )}
                        <div className={`hotel-stock-badge stock-${activeProductStockState}`}>
                          {activeProductStockState === "out" ? (
                            <FaTimes aria-hidden="true" />
                          ) : activeProductStockState === "low" ? (
                            <FaExclamationTriangle aria-hidden="true" />
                          ) : (
                            <FaCheck aria-hidden="true" />
                          )}
                          <span>
                            {activeProductStockState === "out"
                              ? `Out of stock — ${activeProduct.name} cannot be added to the bill`
                              : activeProductStockState === "low"
                                ? `Low stock — only ${Number(activeProduct.stock || 0)} unit(s) left`
                                : `Available — ${Number(activeProduct.stock || 0)} unit(s) in stock`}
                          </span>
                        </div>
                      </div>
                      <div className="hotel-field-row small-row">
                        <label>
                          <FaConciergeBell aria-hidden="true" /> Variant
                        </label>
                        <select
                          value={selectedProductVariant}
                          onChange={(e) => setSelectedProductVariant(e.target.value)}
                          disabled={!isDiningBillEditable}
                        >
                          {activeProductVariants.map((variant) => (
                            <option key={variant.value} value={variant.value}>
                              {variant.label} • ₹{variant.price}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                  <div className="hotel-field-row small-row">
                    <label>
                      <FaPlus aria-hidden="true" /> Quantity
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                      disabled={!isDiningBillEditable}
                    />
                  </div>
                </div>
                <div className="hotel-add-actions">
                  <button
                    type="button"
                    className="hotel-quickbook-btn hotel-quickbook-btn-confirm hotel-add-bill-btn"
                    onClick={addDiningItem}
                    disabled={
                      hotelModuleLock.liveBillLocked ||
                      !isDiningBillEditable ||
                      activeProductStockState === "out"
                    }
                    title={
                      hotelModuleLock.liveBillLocked
                        ? "Live Bill is locked by the Super Owner"
                        : undefined
                    }
                  >
                    <FaPlus className="hotel-quickbook-btn-icon" aria-hidden="true" />
                    <span>Add To Table Bill</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {hotelModuleLock.liveBillLocked ? (
          // Live Bill (Super-Owner-controlled) — gates the entire bill
          // summary + items + payment + invoice block in one place so the
          // Super Owner can disable the full Live Bill workflow with a
          // single toggle. The "Add Bill Item" entry points elsewhere on
          // the page are also disabled below (see the disabled-when-locked
          // checks on each Add button) so the section cannot be repopulated
          // while locked. Lodging/Dining checkout flows stay unaffected.
          <HotelModuleLockScreen
            module="liveBill"
            customerEmail={hotelModuleLock.customerEmail}
            bypassForSuperOwner={hotelModuleLock.bypassForSuperOwner}
          />
        ) : (
          <div className="hotel-billing-card hotel-billing-items">
            <div className="hotel-billing-items-head">
              <div className="hotel-quickbook-kicker hotel-bill-items-kicker">
                <FaReceipt aria-hidden="true" /> Live Bill
              </div>
              <div className="hotel-section-title">Bill Items</div>
            </div>
            {filteredItems.length === 0 ? (
              <div className="hotel-empty-state hotel-empty-state-rich">
                <div className="hotel-empty-state-icon">
                  <FaBoxOpen />
                </div>
                <strong>No items for this POS yet</strong>
                <span>Add charges from the service list to build the bill.</span>
              </div>
            ) : (
              <div className="hotel-items-list">
                {filteredItems.map((item) => {
                  const roomId = item.meta && item.meta.roomId;
                  const roomName = roomId
                    ? lodgingRooms.find((r) => r.id === roomId)?.name || roomId
                    : null;
                  return (
                    <div
                      key={item.id}
                      className={`hotel-item-row ${item.type === "lodging" ? "is-lodging" : "is-dining"}`}
                    >
                      <div className="hotel-item-row-info">
                        <div className="hotel-item-row-head">
                          <span
                            className={`hotel-item-type-pill type-${item.type}`}
                            aria-hidden="true"
                          >
                            {item.type === "lodging" ? <FaBed /> : <FaUtensils />}
                          </span>
                          <span className="hotel-item-name">{item.name}</span>
                        </div>
                        {item.type === "lodging" ? (
                          (() => {
                            // The Extra Hours Charges line is non-taxable per the
                            // checkout spec — skip the GST pill and nights/room
                            // rate metadata which only apply to the room booking.
                            const isOverstayLine = item.meta?.kind === "late_checkout";
                            const roomId = item.meta?.roomId;
                            const room = roomId ? lodgingRooms.find((r) => r.id === roomId) : null;
                            // Single source of truth — same fallback chain as the
                            // bill summary. item.meta.gst (booking-time snapshot)
                            // wins so the original Room Booking GST is preserved
                            // through checkout.
                            const gstRate = isOverstayLine
                              ? 0
                              : resolveLodgingGstRate(room, item, settingsForGst);
                            const qty = Number(item.qty || 1);
                            const base = Number(item.rate || 0) * qty;
                            const gstAmt = Math.round(base * gstRate) / 100;
                            const nights = Number(item.meta?.nights || room?.nights || 1);
                            const roomRate = Number(item.meta?.roomRate || 0);
                            return (
                              <div className="hotel-item-meta hotel-item-meta-grid">
                                <span>
                                  <FaUserTie aria-hidden="true" /> {item.meta?.guest || "—"}
                                </span>
                                {roomName && (
                                  <span>
                                    <FaDoorOpen aria-hidden="true" /> {roomName}
                                  </span>
                                )}
                                <span>
                                  {isOverstayLine
                                    ? `Qty ${item.qty} · ${item.qty}h overstay`
                                    : `Qty ${item.qty}${nights > 0 ? ` · ${nights} night${nights > 1 ? "s" : ""}` : ""}`}
                                </span>
                                {!isOverstayLine && roomRate > 0 && (
                                  <span>
                                    <FaRupeeSign aria-hidden="true" /> {roomRate}/night
                                  </span>
                                )}
                                {gstRate > 0 && (
                                  <span className="hotel-item-meta-gst">
                                    GST {gstRate}% · ₹{gstAmt.toFixed(0)}
                                  </span>
                                )}
                              </div>
                            );
                          })()
                        ) : (
                          <div className="hotel-item-meta hotel-item-meta-grid">
                            <span>
                              <FaChair aria-hidden="true" /> {item.meta?.tableName || "—"}
                            </span>
                            <span>
                              <FaUserTie aria-hidden="true" /> {item.meta?.guest || "—"}
                            </span>
                            <span>Qty {item.qty}</span>
                            <span>
                              <FaRupeeSign aria-hidden="true" /> {Number(item.rate || 0).toFixed(0)}{" "}
                              each
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="hotel-item-actions">
                        <div className="hotel-item-total">₹{item.total.toFixed(2)}</div>
                        <button
                          type="button"
                          className="hotel-item-remove"
                          onClick={() => removeItem(item.id)}
                          aria-label={`Remove ${item.name}`}
                          title="Remove from bill"
                        >
                          <FaTrash aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="hotel-summary-card">
              <div className="hotel-summary-row">
                <span>
                  <FaReceipt aria-hidden="true" /> Subtotal
                </span>
                <span>₹{subtotal.toFixed(2)}</span>
              </div>
              <div className="hotel-summary-row">
                <span>
                  <FaRupeeSign aria-hidden="true" /> GST
                </span>
                <span>₹{gstAmount.toFixed(2)}</span>
              </div>
              <div className="hotel-summary-total">
                <strong>
                  <FaCashRegister aria-hidden="true" /> Grand Total
                </strong>
                <strong>₹{grandTotal.toFixed(2)}</strong>
              </div>
            </div>

            <div className="hotel-summary-actions">
              <div className="hotel-payment-picker">
                <span className="hotel-payment-picker-label">
                  <FaCreditCard aria-hidden="true" /> Payment
                </span>
                <select
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                  aria-label="Payment mode"
                >
                  <option>Cash</option>
                  <option>UPI</option>
                  <option>Card</option>
                </select>
              </div>
              <button
                type="button"
                className="hotel-quickbook-btn hotel-quickbook-btn-confirm hotel-print-bill-btn"
                onClick={generateAndPreview}
              >
                <FaReceipt className="hotel-quickbook-btn-icon" aria-hidden="true" />
                <span>Generate Invoice</span>
              </button>
            </div>
            {message && (
              <div className={`hotel-message ${message.type}`}>
                {message.type === "error" ? (
                  <FaExclamationTriangle aria-hidden="true" />
                ) : (
                  <FaCheckCircle aria-hidden="true" />
                )}
                <span>{message.text}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <OpenShiftDialog
        {...mandatoryShiftDialogProps}
        title="Open a shift before recording a hotel sale"
        // When the cashier opens a shift, refresh the active shift so the
        // banner + chip update, then re-run the pending save if there was
        // one. Without this, the "Generate Invoice" click would be lost.
        onOpened={() => {
          refreshActiveShift();
          const pending = pendingInvoiceRef.current;
          pendingInvoiceRef.current = null;
          if (pending && pending.kind === "hotel") {
            // Resume the original save flow now that a shift is open.
            generateAndPreview();
          }
        }}
      />
    </div>
  );
};

export default HotelBilling;
