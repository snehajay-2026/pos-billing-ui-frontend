import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/layout/Layout";
import {
  FaBed,
  FaCalendarCheck,
  FaCalendarDay,
  FaDoorOpen,
  FaDollarSign,
  FaUsers,
  FaSearch,
  FaConciergeBell,
  FaPlus,
  FaCheckCircle,
  FaHourglassHalf,
  FaUserPlus,
  FaClock,
  FaFileInvoice,
  FaTrash,
  FaRupeeSign,
  FaBroom,
} from "react-icons/fa";
import "./HotelLodgingPage.css";
import hotelService from "../services/hotelService";
import { persistWaitingQueue } from "../services/hotelWaitingQueue";
import { useUi } from "../context/UiContext";
import {
  resolveHousekeeping,
  getHousekeepingLabel,
  getHousekeepingSwatch,
  getHousekeepingTone,
  isRoomSellable,
  groupRoomsByFloor,
  summarizeRoomsForFloor,
  advanceAndPersistRoomHousekeeping,
  HOUSEKEEPING_STATES,
} from "../components/hotel/housekeeping";
import { findRoomByReservationCode } from "../components/hotel/reservationCodes";
import { lateCheckOutMinutes } from "../components/hotel/folio";
import RoomFolioDrawer from "../components/hotel/RoomFolioDrawer";
import FloorRoomCard from "../components/hotel/FloorRoomCard";
import { onRealtimeSyncEvent } from "../services/realtimeSync";
import { getStoreSettings } from "../services/storeSettingsService";

const WAITING_QUEUE_KEY = "hotel_lodging_waiting_list";
const CHECKOUT_HISTORY_STORAGE_KEY = "hotel_lodging_checkout_history";

// conservative buffer (minutes) to add to estimates
const ESTIMATE_BUFFER_MIN = 5;

const areWaitingQueuesEqual = (left = [], right = []) => {
  const leftItems = Array.isArray(left) ? left : [];
  const rightItems = Array.isArray(right) ? right : [];
  if (leftItems.length !== rightItems.length) return false;
  return leftItems.every((item, index) => {
    const other = rightItems[index];
    if (!item || !other) return item === other;
    const sameId = item.id != null && other.id != null && String(item.id) === String(other.id);
    if (sameId) return true;
    return (
      String(item.name || "") === String(other.name || "") &&
      Number(item.seats || 0) === Number(other.seats || 0)
    );
  });
};

const mergeWaitingQueue = (existingQueue = [], incomingQueue = []) => {
  const existingItems = Array.isArray(existingQueue) ? existingQueue : [];
  const incomingItems = Array.isArray(incomingQueue) ? incomingQueue : [];
  if (areWaitingQueuesEqual(existingItems, incomingItems)) return existingItems;

  const merged = [...existingItems];

  incomingItems.forEach((item) => {
    if (!item) return;

    const itemId = item.id != null ? String(item.id) : "";
    const itemName = String(item.name || "")
      .trim()
      .toLowerCase();
    const itemSeats = Number(item.seats || 0);

    const exists = merged.some((entry) => {
      if (!entry) return false;
      if (itemId && entry.id != null && String(entry.id) === itemId) return true;
      if (!itemId) {
        const existingName = String(entry.name || "")
          .trim()
          .toLowerCase();
        const existingSeats = Number(entry.seats || 0);
        return existingName === itemName && existingSeats === itemSeats;
      }
      return false;
    });

    if (!exists) merged.push(item);
  });

  return merged;
};

const defaultRooms = [
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
    reservationCode: "",
    checkOutTime: "",
    housekeeping: "clean",
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
    reservationCode: "",
    checkOutTime: "",
    housekeeping: "clean",
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
    reservationCode: "",
    checkOutTime: "",
    housekeeping: "clean",
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
    reservationCode: "",
    checkOutTime: "",
    housekeeping: "clean",
  },
];

const HotelLodgingPage = () => {
  const [rooms, setRooms] = useState(defaultRooms);
  const [, setDraftRoomIds] = useState([]);
  const [message, setMessage] = useState(null);

  const [waitingQueue, setWaitingQueue] = useState([]);
  const [estimatedWaits, setEstimatedWaits] = useState({});

  const [checkoutHistory, setCheckoutHistory] = useState([]);
  const [initialEstimates, setInitialEstimates] = useState({});
  const [, setTick] = useState(0);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFromDate, setHistoryFromDate] = useState("");
  const [historyToDate, setHistoryToDate] = useState("");
  const [historyClearing, setHistoryClearing] = useState(false);
  const [historyDeletingId, setHistoryDeletingId] = useState(null);
  const [historyMessage, setHistoryMessage] = useState(null);
  const [waitingName, setWaitingName] = useState("");
  const [waitingSeats, setWaitingSeats] = useState(2);
  const [waitingMessage, setWaitingMessage] = useState(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTargetWaiting, setAssignTargetWaiting] = useState(null);
  const [assignSelectedRoomId, setAssignSelectedRoomId] = useState(null);
  const [assignNights, setAssignNights] = useState(1);
  const [assignMembers, setAssignMembers] = useState(1);
  const [assignGst, setAssignGst] = useState("");
  const [assignNotes, setAssignNotes] = useState("");
  const [assignIdType, setAssignIdType] = useState("Aadhar");
  const [assignIdNumber, setAssignIdNumber] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [waitingAddLoading, setWaitingAddLoading] = useState(false);
  const [bookingDraft, setBookingDraft] = useState(null); // { roomId, name, members } or null
  const [waitingRemovingId, setWaitingRemovingId] = useState(null);
  const [newGuests, setNewGuests] = useState([]);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomBeds, setNewRoomBeds] = useState("2");
  const [newRoomRate, setNewRoomRate] = useState("");
  const [newRoomAc, setNewRoomAc] = useState("AC");
  const [newRoomModern, setNewRoomModern] = useState(false);
  const [newRoomErrors, setNewRoomErrors] = useState({ name: false, beds: false, rate: false });
  const [codeLookup, setCodeLookup] = useState("");
  const [hkFilter, setHkFilter] = useState("all");
  const [hkSearch, setHkSearch] = useState("");
  const [hkToggleIds, setHkToggleIds] = useState(() => new Set());
  const [folioRoom, setFolioRoom] = useState(null);

  const { showToast, activeStore } = useUi();
  const navigate = useNavigate();

  useEffect(() => {
    // Recompute estimated waits whenever rooms, waiting queue, or checkout history changes
    // and refresh every minute so remaining minutes count down in real time.
    const computeEstimates = () => {
      try {
        const vacants = rooms.filter((r) => r.status !== "occupied").length;

        // Compute remaining minutes for occupied rooms
        const occupiedRooms = rooms.filter((r) => r.status === "occupied");
        const avgNights = (() => {
          if (!Array.isArray(checkoutHistory) || checkoutHistory.length === 0) return 1;
          const sum = checkoutHistory.reduce((s, it) => s + (Number(it.nights) || 1), 0);
          return Math.max(1, sum / checkoutHistory.length);
        })();

        const now = Date.now();
        const remainingMins = occupiedRooms
          .map((r) => {
            try {
              if (r.checkIn) {
                const checkInDate = new Date(r.checkIn);
                if (!Number.isNaN(checkInDate.getTime())) {
                  const nights = Number(r.nights) || Math.round(avgNights);
                  // assume checkout occurs at 11:00 local time on the day after nights
                  const checkout = new Date(checkInDate);
                  checkout.setDate(checkout.getDate() + nights);
                  checkout.setHours(11, 0, 0, 0);
                  const mins = Math.max(0, Math.round((checkout.getTime() - now) / 60000));
                  return Math.max(1, mins);
                }
              }
            } catch (err) {}
            // fallback to average nights remaining (in minutes)
            return Math.max(1, Math.round((avgNights * 24 * 60) / 2));
          })
          .sort((a, b) => a - b);

        // For each waiting guest, assign estimated wait as sum of earliest freeing rooms they need
        const estimates = {};
        for (let i = 0; i < waitingQueue.length; i++) {
          const entry = waitingQueue[i];
          if (!entry) continue;
          const position = i;
          // how many rooms must free before this position is served
          const needIndex = Math.max(0, position + 1 - vacants);
          if (needIndex <= 0) {
            estimates[entry.id] = 0;
            continue;
          }
          // sum first `needIndex` remaining times (in minutes)
          const slice = remainingMins.slice(0, needIndex);
          const sum = slice.reduce((s, x) => s + x, 0);
          estimates[entry.id] = Math.max(0, sum + ESTIMATE_BUFFER_MIN);
        }

        setEstimatedWaits(estimates);
        // capture initial estimate snapshot for smooth progress bars
        setInitialEstimates((prev) => {
          const next = { ...prev };
          Object.keys(estimates).forEach((id) => {
            const val = Number(estimates[id] || 0);
            if (val > 0 && !next[id]) next[id] = val;
            if (val === 0 && next[id]) delete next[id];
          });
          return next;
        });
      } catch (err) {
        // ignore
      }
    };

    computeEstimates();
    const timer = setInterval(computeEstimates, 60 * 1000);
    return () => clearInterval(timer);
  }, [rooms, waitingQueue, checkoutHistory]);

  // tick to update progress bars smoothly
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    // Seed synchronously from localStorage so the first paint already shows
    // rooms. The async server load below overwrites with the canonical view.
    try {
      const savedRooms = window.localStorage.getItem("hotel_lodging_rooms");
      if (savedRooms) {
        const parsed = JSON.parse(savedRooms);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setRooms(parsed);
        }
      } else {
        setRooms(defaultRooms);
      }
    } catch (err) {
      console.error("Failed to seed lodging rooms", err);
      setRooms(defaultRooms);
    }

    try {
      const savedHistory = window.localStorage.getItem(CHECKOUT_HISTORY_STORAGE_KEY);
      if (savedHistory) {
        const parsedHistory = JSON.parse(savedHistory);
        if (Array.isArray(parsedHistory)) {
          setCheckoutHistory(parsedHistory);
        }
      }
    } catch (err) {
      console.error("Failed to parse checkout history", err);
    }

    let mounted = true;
    const loadRoomsFromServer = async () => {
      try {
        const resp = await hotelService.getRooms();
        if (mounted && Array.isArray(resp) && resp.length > 0) {
          setRooms(resp);
          try {
            window.localStorage.setItem("hotel_lodging_rooms", JSON.stringify(resp));
          } catch (e) {
            /* quota / private mode */
          }
        }
      } catch (err) {
        // Network error / 5xx — keep the localStorage seed we already loaded.
        console.warn("Failed to sync lodging rooms from server", err);
      }
    };
    loadRoomsFromServer();
    return () => {
      mounted = false;
    };
  }, [activeStore]);

  // Real-time sync: listen for `booking` events (lodging) and merge them
  // into the local `rooms` state. A booking made on any device appears
  // on every other device's Room Booking Card instantly.
  useEffect(() => {
    const unsub = onRealtimeSyncEvent((detail) => {
      const event = detail?.event;
      if (!event) return;
      // Only care about lodging booking upserts/checkouts.
      if (event.kind === "booking" && event.booking?.kind === "lodging") {
        const b = event.booking;
        setRooms((prev) => {
          const byKey = new Map(
            prev.map((r) => [String(r.id || r.roomId || r.number), r])
          );
          const key = String(b.roomId || b.roomNumber);
          if (!key) return prev;
          const existing = byKey.get(key) || { id: key, number: b.roomNumber || key };
          const isCheckedOut = event.action === "checked_out";
          byKey.set(key, {
            ...existing,
            id: b.roomId || existing.id,
            number: b.roomNumber || existing.number,
            roomNumber: b.roomNumber || existing.roomNumber,
            guest: b.guestName || existing.guest,
            customerMobile: b.customerMobile || existing.customerMobile,
            checkInDate: b.checkInDate || existing.checkInDate,
            checkInTime: b.checkInTime || existing.checkInTime,
            expectedCheckOut: b.expectedCheckOut || existing.expectedCheckOut,
            status: isCheckedOut ? "vacant" : "occupied",
            _persisted: true,
          });
          return Array.from(byKey.values());
        });
      }
      // Also listen for live_bill updates — the Room Booking Card shows
      // the current bill total, so a folio change on another device should
      // push the updated bill to every room card.
      if (event.kind === "live_bill" && event.data?.tableId) {
        // live_bill events carry tableId (dining) — disregard here since
        // this is the lodging page.
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    const onDraftStart = (e) => {
      try {
        const id = e?.detail?.id;
        if (!id) return;
        setDraftRoomIds((prev) => Array.from(new Set([...prev, id])));
      } catch (err) {}
    };
    const onDraftClear = (e) => {
      try {
        const id = e?.detail?.id;
        if (!id) return;
        setDraftRoomIds((prev) => prev.filter((x) => x !== id));
      } catch (err) {}
    };
    window.addEventListener("hotel_room_draft_started", onDraftStart);
    window.addEventListener("hotel_room_draft_cleared", onDraftClear);
    // Sync room record edits (e.g. Edit Booking / Checkout from the Billing
    // tab) into this Lodging page's `rooms` state so Room Cards and Floor
    // Room Cards refresh without a manual reload. Without this listener,
    // changing `room.checkOutDate` or `room.checkOutTime` from the Billing
    // tab does not propagate — Room Cards would keep showing the stale
    // overstay hours until the page is reloaded.
    const onRoomsUpdated = (e) => {
      try {
        const incoming =
          e?.detail ?? JSON.parse(window.localStorage.getItem("hotel_lodging_rooms") || "[]");
        if (Array.isArray(incoming)) {
          setRooms(incoming);
        }
      } catch (err) {}
    };
    window.addEventListener("hotel_lodging_rooms_updated", onRoomsUpdated);
    const onWaitingListUpdated = (e) => {
      try {
        const incoming =
          e?.detail ?? JSON.parse(window.localStorage.getItem(WAITING_QUEUE_KEY) || "[]");
        const list = Array.isArray(incoming) ? incoming : [];
        setWaitingQueue((prev) => {
          const merged = mergeWaitingQueue(prev, list);
          if (merged !== prev) {
            persistWaitingQueue(merged, WAITING_QUEUE_KEY);
          }
          return merged;
        });
      } catch (err) {}
    };
    const onCheckoutHistoryUpdated = (e) => {
      try {
        const history =
          e.detail || JSON.parse(window.localStorage.getItem(CHECKOUT_HISTORY_STORAGE_KEY) || "[]");
        if (Array.isArray(history)) setCheckoutHistory(history);
      } catch (err) {}
    };
    window.addEventListener("hotel_lodging_waiting_list_updated", onWaitingListUpdated);
    window.addEventListener("hotel_lodging_checkout_history_updated", onCheckoutHistoryUpdated);
    return () => {
      window.removeEventListener("hotel_room_draft_started", onDraftStart);
      window.removeEventListener("hotel_room_draft_cleared", onDraftClear);
      window.removeEventListener("hotel_lodging_rooms_updated", onRoomsUpdated);
      window.removeEventListener("hotel_lodging_waiting_list_updated", onWaitingListUpdated);
      window.removeEventListener(
        "hotel_lodging_checkout_history_updated",
        onCheckoutHistoryUpdated
      );
    };
  }, [activeStore]);

  const formatDateTime = (value) => {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  };

  const formatMinutes = (mins) => {
    if (mins == null) return "-";
    const m = Math.max(0, Math.round(mins));
    if (m < 60) return `${m}m`;
    const hours = Math.floor(m / 60);
    const minutes = m % 60;
    if (hours < 24) return `${hours}h${minutes ? ` ${minutes}m` : ""}`;
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return `${days}d${remHours ? ` ${remHours}h` : ""}`;
  };

  // Auto-clear any legacy "open room" requests from the POS. The booking-details
  // form used to handle this, but it's been replaced by the Assign modal + folio
  // drawer. Keeping the effect here just so old POS requests don't linger.
  useEffect(() => {
    try {
      window.localStorage.removeItem("hotel_open_room");
    } catch (_) {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem("hotel_lodging_rooms", JSON.stringify(rooms));
      // notify same-tab listeners that rooms changed
      try {
        window.dispatchEvent(new CustomEvent("hotel_lodging_rooms_updated", { detail: rooms }));
      } catch (e) {
        // ignore
      }
    } catch (err) {
      console.warn("Failed to persist lodging rooms", err);
    }
  }, [rooms]);

  useEffect(() => {
    let mounted = true;
    const loadWaiting = async () => {
      try {
        const resp = await hotelService.getLodgingWaitingList();
        if (mounted && Array.isArray(resp)) {
          // Merge server list with any locally-saved entries to avoid duplicates on refresh.
          const serverList = resp.map((w) => ({ ...w, _persisted: true }));
          let merged = [...serverList];
          try {
            const saved = window.localStorage.getItem(WAITING_QUEUE_KEY);
            if (saved) {
              const localList = JSON.parse(saved);
              if (Array.isArray(localList) && localList.length) {
                for (const l of localList) {
                  try {
                    if (!l) continue;
                    if (l.id && serverList.find((s) => String(s.id) === String(l.id))) continue;
                    const name = String(l.name || "")
                      .trim()
                      .toLowerCase();
                    const seats = Number(l.seats || 0);
                    if (!name) continue;
                    const duplicate = serverList.find(
                      (s) =>
                        String(s.name || "")
                          .trim()
                          .toLowerCase() === name && Number(s.seats || 0) === seats
                    );
                    if (duplicate) continue;
                    const created = await hotelService
                      .addLodgingWaiting({ name: l.name, seats: l.seats })
                      .catch(() => null);
                    if (created && created.id) {
                      merged.push({ ...created, _persisted: true });
                    } else {
                      merged.push({ ...l, _persisted: false });
                    }
                  } catch (err) {
                    merged.push({ ...l, _persisted: false });
                  }
                }
              }
            }
          } catch (err) {
            // ignore local parse errors
          }
          setWaitingQueue(merged);
          try {
            window.localStorage.setItem(WAITING_QUEUE_KEY, JSON.stringify(merged));
          } catch (e) {}
          return;
        }
      } catch (err) {
        // fallback to localStorage
      }

      try {
        const saved = window.localStorage.getItem(WAITING_QUEUE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setWaitingQueue(parsed);
            return;
          }
        }
      } catch (err) {}
      setWaitingQueue([]);
    };
    loadWaiting();
    return () => {
      mounted = false;
    };
  }, [activeStore]);

  useEffect(() => {
    let mounted = true;
    const loadCheckoutHistory = async () => {
      try {
        const resp = await hotelService.getCheckoutHistory();
        if (mounted && Array.isArray(resp)) {
          setCheckoutHistory(resp);
          try {
            window.localStorage.setItem(CHECKOUT_HISTORY_STORAGE_KEY, JSON.stringify(resp));
          } catch (err) {}
          return;
        }
      } catch (err) {
        // fallback to local storage state already loaded above
      }
    };
    loadCheckoutHistory();
    return () => {
      mounted = false;
    };
  }, [activeStore]);

  useEffect(() => {
    // Sync local waitingQueue to server for entries not yet persisted,
    // then save the authoritative list to localStorage to avoid duplicates on reload.
    (async () => {
      try {
        if (!Array.isArray(waitingQueue)) return;
        if (waitingQueue.length === 0) {
          try {
            window.localStorage.setItem(WAITING_QUEUE_KEY, JSON.stringify([]));
          } catch (e) {}
          try {
            window.dispatchEvent(
              new CustomEvent("hotel_lodging_waiting_list_updated", { detail: [] })
            );
          } catch (e) {}
          return;
        }

        const next = [...waitingQueue];
        let changed = false;
        for (let i = 0; i < next.length; i++) {
          const w = next[i];
          if (!w || w._persisted || w._creating) continue;
          try {
            const created = await hotelService
              .addLodgingWaiting({ name: w.name, seats: w.seats })
              .catch(() => null);
            if (created && created.id) {
              next[i] = { ...w, id: created.id, _persisted: true };
              changed = true;
            }
          } catch (err) {
            // ignore per-item failures
          }
        }

        if (changed) {
          setWaitingQueue(next);
          try {
            window.localStorage.setItem(WAITING_QUEUE_KEY, JSON.stringify(next));
          } catch (e) {}
          try {
            window.dispatchEvent(
              new CustomEvent("hotel_lodging_waiting_list_updated", { detail: next })
            );
          } catch (e) {}
        } else {
          try {
            window.localStorage.setItem(WAITING_QUEUE_KEY, JSON.stringify(waitingQueue || []));
          } catch (e) {}
        }
      } catch (err) {
        try {
          window.localStorage.setItem(WAITING_QUEUE_KEY, JSON.stringify(waitingQueue || []));
        } catch (e) {}
      }
    })();
  }, [waitingQueue]);

  const summary = {
    total: rooms.length,
    vacant: rooms.filter((room) => room.status === "vacant").length,
    occupied: rooms.filter((room) => room.status === "occupied").length,
    revenue: rooms.reduce(
      (total, room) => total + (room.status === "occupied" ? room.rate * room.nights : 0),
      0
    ),
  };

  // Searchable, HK-filterable room list for the floor board. Also groups by
  // floor so housekeeping supervisors see rooms by physical location, not
  // alphabetically — matching the way shift handovers are written on paper.
  const hkFilteredRooms = useMemo(() => {
    const q = hkSearch.trim().toLowerCase();
    return rooms.filter((room) => {
      if (hkFilter !== "all" && resolveHousekeeping(room) !== hkFilter) return false;
      if (!q) return true;
      const haystack = [room.name, room.id, room.reservationCode, room.guest, room.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rooms, hkFilter, hkSearch]);

  const hkGroups = useMemo(() => groupRoomsByFloor(hkFilteredRooms), [hkFilteredRooms]);

  // Compact summary chips for the section header (e.g. "2 dirty · 1 due today").
  const hkBoardSummary = useMemo(() => {
    const buckets = { clean: 0, dirty: 0, inspecting: 0, occupied: 0, dueToday: 0, overdue: 0 };
    const todayKey = new Date().toISOString().split("T")[0];
    rooms.forEach((room) => {
      buckets[resolveHousekeeping(room)] += 1;
      if (room.status === "occupied") buckets.occupied += 1;
      if (room.status !== "occupied") return;
      const nights = Math.max(1, Number(room.nights) || 1);
      if (!room.checkIn) return;
      const out = new Date(room.checkIn);
      if (Number.isNaN(out.getTime())) return;
      out.setDate(out.getDate() + nights);
      const key = out.toISOString().split("T")[0];
      if (key < todayKey) buckets.overdue += 1;
      else if (key === todayKey) buckets.dueToday += 1;
    });
    return buckets;
  }, [rooms]);

  // One-click advance: tap a card's HK pill to cycle Clean → Dirty → Inspecting → Clean.
  // The helper module writes through to localStorage and dispatches the rooms-updated
  // event; the page also subscribes to that event so the UI catches up.
  const handleToggleHkFromCard = async (room) => {
    if (!room || !room.id || hkToggleIds.has(room.id)) return;
    setHkToggleIds((prev) => {
      const next = new Set(prev);
      next.add(room.id);
      return next;
    });
    const updated = advanceAndPersistRoomHousekeeping(room);
    if (updated) {
      setRooms((prev) => prev.map((r) => (String(r.id) === String(room.id) ? updated : r)));
      showToast("success", `${room.name || room.id} → ${getHousekeepingLabel(updated)}.`);
    }
    setHkToggleIds((prev) => {
      const next = new Set(prev);
      next.delete(room.id);
      return next;
    });
  };

  const filteredCheckoutHistory = checkoutHistory.filter((entry) => {
    const query = historySearch.trim().toLowerCase();
    const haystack = [
      entry.roomName,
      entry.roomId,
      entry.guest,
      entry.notes,
      entry.idProof?.type,
      entry.idProof?.number,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (query && !haystack.includes(query)) {
      return false;
    }

    const checkedOutDay = entry.checkedOutAt ? String(entry.checkedOutAt).slice(0, 10) : "";
    if (historyFromDate && checkedOutDay && checkedOutDay < historyFromDate) {
      return false;
    }
    if (historyToDate && checkedOutDay && checkedOutDay > historyToDate) {
      return false;
    }
    if ((historyFromDate || historyToDate) && !checkedOutDay) {
      return false;
    }
    return true;
  });

  const checkoutHistorySummary = filteredCheckoutHistory.reduce(
    (acc, entry) => {
      acc.records += 1;
      acc.nights += Number(entry.nights || 0);
      acc.members += Number(entry.members || 0);
      acc.amount += Number(entry.total || 0);
      return acc;
    },
    { records: 0, nights: 0, members: 0, amount: 0 }
  );

  const averageStayLength = checkoutHistorySummary.records
    ? checkoutHistorySummary.nights / checkoutHistorySummary.records
    : 0;

  const averageBookingAmount = checkoutHistorySummary.records
    ? checkoutHistorySummary.amount / checkoutHistorySummary.records
    : 0;

  const handleClearCheckoutHistory = async () => {
    if (!checkoutHistory.length) {
      setHistoryMessage({ type: "error", text: "No checkout records to clear." });
      return;
    }
    if (!window.confirm("Clear all checkout history for this store?")) {
      return;
    }
    setHistoryClearing(true);
    try {
      await hotelService.clearCheckoutHistory();
      setCheckoutHistory([]);
      try {
        window.localStorage.setItem(CHECKOUT_HISTORY_STORAGE_KEY, JSON.stringify([]));
        window.dispatchEvent(
          new CustomEvent("hotel_lodging_checkout_history_updated", { detail: [] })
        );
      } catch (err) {}
      setHistoryMessage({ type: "success", text: "Checkout history cleared." });
      showToast("success", "Checkout history cleared.");
    } catch (err) {
      setHistoryMessage({ type: "error", text: "Failed to clear checkout history." });
      showToast("error", "Failed to clear checkout history.");
    } finally {
      setHistoryClearing(false);
    }
  };

  const updateCheckoutHistoryState = (nextHistory) => {
    setCheckoutHistory(nextHistory);
    try {
      window.localStorage.setItem(CHECKOUT_HISTORY_STORAGE_KEY, JSON.stringify(nextHistory));
      window.dispatchEvent(
        new CustomEvent("hotel_lodging_checkout_history_updated", { detail: nextHistory })
      );
    } catch (err) {}
  };

  const handleDeleteCheckoutEntry = async (entryId) => {
    if (!entryId) return;
    if (!window.confirm("Delete this checkout record?")) {
      return;
    }
    setHistoryDeletingId(entryId);
    try {
      await hotelService.deleteCheckoutHistoryEntry(entryId);
      const nextHistory = checkoutHistory.filter((entry) => entry.id !== entryId);
      updateCheckoutHistoryState(nextHistory);
      setHistoryMessage({ type: "success", text: "Checkout record deleted." });
      showToast("success", "Checkout record deleted.");
    } catch (err) {
      setHistoryMessage({ type: "error", text: "Failed to delete checkout record." });
      showToast("error", "Failed to delete checkout record.");
    } finally {
      setHistoryDeletingId(null);
    }
  };

  const handleExportCheckoutHistoryCsv = () => {
    if (!filteredCheckoutHistory.length) {
      setHistoryMessage({ type: "error", text: "No checkout records available to export." });
      return;
    }

    const escapeCsv = (value) => {
      const text = value == null ? "" : String(value);
      if (/[",\n]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    const rows = [
      [
        "Room",
        "Guest",
        "Check In",
        "Checkout",
        "Nights",
        "Members",
        "Rate",
        "Total",
        "Notes",
        "ID Type",
        "ID Number",
      ],
      ...filteredCheckoutHistory.map((entry) => [
        entry.roomName || entry.roomId || "",
        entry.guest || "",
        formatDateTime(entry.checkIn),
        formatDateTime(entry.checkedOutAt),
        Number(entry.nights || 0),
        Number(entry.members || 0),
        Number(entry.rate || 0).toFixed(2),
        Number(entry.total || 0).toFixed(2),
        entry.notes || "",
        entry.idProof?.type || "",
        entry.idProof?.number || "",
      ]),
    ];

    const csvContent = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `hotel-checkout-history-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    setHistoryMessage({ type: "success", text: "Checkout history exported to CSV." });
  };

  const handleAddToWaitingList = () => {
    if (!waitingName.trim()) {
      setWaitingMessage({ type: "error", text: "Enter customer name to add to the guest queue." });
      return;
    }
    const tempId = `W${Date.now()}`;
    const entry = { id: tempId, name: waitingName.trim(), seats: waitingSeats, _creating: true };
    setWaitingAddLoading(true);
    setWaitingQueue((prev) => {
      const next = [...prev, entry];
      persistWaitingQueue(next, WAITING_QUEUE_KEY);
      return next;
    });
    // mark entry as new briefly to show pulse animation
    setNewGuests((prev) => [...prev, entry.id]);
    setTimeout(() => setNewGuests((prev) => prev.filter((id) => id !== entry.id)), 1600);
    setWaitingName("");
    setWaitingSeats(2);
    setWaitingMessage({ type: "success", text: "Added to guest queue." });
    showToast("success", "Added to guest queue.");
    (async () => {
      try {
        const created = await hotelService
          .addLodgingWaiting({ name: entry.name, seats: entry.seats })
          .catch(() => null);
        if (created && created.id) {
          setWaitingQueue((prev) => {
            const next = prev.map((w) =>
              w && w.id === tempId
                ? { ...w, id: created.id, _persisted: true, _creating: false }
                : w
            );
            persistWaitingQueue(next, WAITING_QUEUE_KEY);
            return next;
          });
        } else {
          // mark as not creating so sync effect can retry later
          setWaitingQueue((prev) => {
            const next = prev.map((w) => (w && w.id === tempId ? { ...w, _creating: false } : w));
            persistWaitingQueue(next, WAITING_QUEUE_KEY);
            return next;
          });
          // Non-blocking: log and allow background sync to retry.
          console.warn("addLodgingWaiting did not return created id; will retry later");
        }
      } catch (err) {
        setWaitingQueue((prev) => {
          const next = prev.map((w) => (w && w.id === tempId ? { ...w, _creating: false } : w));
          persistWaitingQueue(next, WAITING_QUEUE_KEY);
          return next;
        });
        console.warn("Lodging waiting sync failed, will retry later", err);
      } finally {
        setWaitingAddLoading(false);
      }
    })();
  };

  // Step 1 of "Book" on a vacant room: open a small inline form on the card
  // asking for guest name + members. The cashier types once and the form
  // hands the values to handleBookVacantRoom in step 2.
  const startBookVacantRoom = (room) => {
    if (!room || room.status !== "vacant") return;
    setBookingDraft({ roomId: room.id, name: "", members: room.beds || 1 });
  };

  const cancelBookVacantRoom = () => setBookingDraft(null);

  // Step 2: with guest name + members captured, push a synthetic waiting entry
  // and open the Assign modal pre-filled with the same room. The cashier
  // completes the booking inside the assign modal (which already has the
  // nights, GST, ID proof, and notes fields).
  const handleBookVacantRoom = (room, draft) => {
    if (!room || room.status !== "vacant") return;
    const guestName = (draft?.name || "").trim();
    if (!guestName) {
      showToast("error", "Enter the guest name to book this room.");
      return;
    }
    const members = Math.max(1, Number(draft?.members) || 1);
    setBookingDraft(null);
    const tempId = `W${Date.now()}`;
    const entry = {
      id: tempId,
      name: guestName,
      seats: members,
      _forRoom: room.id,
      _creating: true,
    };
    setWaitingAddLoading(true);
    setWaitingQueue((prev) => {
      const next = [...prev, entry];
      persistWaitingQueue(next, WAITING_QUEUE_KEY);
      return next;
    });
    try {
      window.dispatchEvent(
        new CustomEvent("hotel_lodging_waiting_list_updated", { detail: [...waitingQueue, entry] })
      );
    } catch (e) {
      /* ignore */
    }
    (async () => {
      try {
        await hotelService.addLodgingWaiting({ name: guestName, seats: members });
      } catch (err) {
        console.warn("Lodging waiting sync failed, will retry later", err);
      } finally {
        setWaitingAddLoading(false);
        openAssignModal({ id: entry.id, name: guestName, seats: members, _forRoom: room.id });
        try {
          const el = document.querySelector(".hotel-edit-modal-backdrop");
          if (el && typeof el.scrollIntoView === "function")
            el.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (_) {
          /* ignore */
        }
      }
    })();
  };

  const handleRemoveFromWaitingList = (id) => {
    // optimistic remove locally, but track removal for UI
    setWaitingRemovingId(id);
    setWaitingQueue((prev) => {
      const next = prev.filter((w) => w.id !== id);
      persistWaitingQueue(next, WAITING_QUEUE_KEY);
      return next;
    });
    (async () => {
      try {
        await hotelService.removeLodgingWaiting(id);
      } catch (err) {
        setWaitingMessage({ type: "error", text: "Failed to remove from server." });
        showToast("error", "Failed to remove from server.");
      } finally {
        setWaitingRemovingId(null);
      }
    })();
  };

  const getInitials = (name) => {
    if (!name) return "";
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "";
    const first = parts[0][0] || "";
    const second = parts.length > 1 ? parts[1][0] || "" : "";
    return (first + second).toUpperCase();
  };

  const colorForString = (s) => {
    const text = String(s || "guest");
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
    const h2 = (h + 40) % 360;
    return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${h2} 70% 45%))`;
  };

  const openAssignModal = (waitingEntry) => {
    setAssignTargetWaiting(waitingEntry);
    setAssignSelectedRoomId(null);
    setAssignNights(1);
    setAssignMembers(waitingEntry.seats || 1);
    setAssignGst("");
    setAssignNotes("");
    setAssignIdType("Aadhar");
    setAssignIdNumber("");
    setAssignModalOpen(true);
  };

  const closeAssignModal = () => {
    setAssignModalOpen(false);
    setAssignTargetWaiting(null);
    setAssignSelectedRoomId(null);
  };

  const handleAssignToRoom = () => {
    if (!assignTargetWaiting || !assignSelectedRoomId)
      return setWaitingMessage({ type: "error", text: "Select a room to assign." });
    const roomId = assignSelectedRoomId;
    const guest = assignTargetWaiting.name;
    const nights = Number(assignNights) || 1;
    const members = Number(assignMembers) || 1;
    const targetRoom = rooms.find((r) => r.id === roomId);
    const maxMembers = targetRoom ? targetRoom.beds || 1 : 1;
    if (members < 1 || members > maxMembers)
      return setWaitingMessage({
        type: "error",
        text: `Members must be between 1 and ${maxMembers}`,
      });
    if (nights < 1 || nights > 99)
      return setWaitingMessage({ type: "error", text: "Nights must be between 1 and 99" });
    setAssignLoading(true);
    const gstNum = assignGst !== "" && assignGst != null ? Number(assignGst) : 0;
    const updatedRooms = rooms.map((r) =>
      r.id === roomId
        ? {
            ...r,
            status: "occupied",
            guest: guest,
            checkIn: new Date().toISOString().slice(0, 10),
            nights,
            members: Math.min(members, maxMembers),
            notes: String(assignNotes || "").trim(),
            gst: gstNum,
            idProof: {
              type: String(assignIdType || "").trim(),
              number: String(assignIdNumber || "").trim(),
            },
          }
        : r
    );
    setRooms(updatedRooms);
    try {
      window.localStorage.setItem("hotel_lodging_rooms", JSON.stringify(updatedRooms));
      try {
        window.dispatchEvent(
          new CustomEvent("hotel_lodging_rooms_updated", { detail: updatedRooms })
        );
      } catch (e) {}
    } catch (e) {}

    // Push the new booking to the server so other devices in the store see
    // it. Fire-and-forget — local state already reflects the assignment.
    (async () => {
      try {
        const newRoom = updatedRooms.find((r) => String(r.id) === String(roomId));
        if (!newRoom) return;
        const persisted = newRoom._persisted === true;
        if (persisted) {
          await hotelService.updateRoom(newRoom.id, newRoom);
        } else {
          const created = await hotelService.createRoom(newRoom);
          if (created && (created.id || created._persisted)) {
            setRooms((prev) =>
              prev.map((r) =>
                String(r.id) === String(newRoom.id)
                  ? { ...r, id: created.id || r.id, _persisted: true }
                  : r
              )
            );
          }
        }
      } catch (err) {
        console.warn("Failed to sync assigned-room booking to server", err);
      }
    })();

    // NOTE: shared billing item will be created after navigation so Billing POS can pick it up on mount
    setWaitingQueue((prev) => prev.filter((w) => w.id !== assignTargetWaiting.id));
    // open POS Quick Book for the assigned room; let POS create the billing item on user confirm
    try {
      const updatedRoom = updatedRooms.find((r) => r.id === roomId) || {
        name: roomId,
        rate: 0,
        gst: 0,
      };
      try {
        window.localStorage.setItem("hotel_active_pos", "lodging");
      } catch (e) {}
      try {
        navigate("/pos");
        setTimeout(() => {
          try {
            // create/upsert shared billing item now that POS will be mounted
            try {
              const sharedKey = "hotel_shared_items";
              let existing = JSON.parse(window.localStorage.getItem(sharedKey) || "[]");
              const pr = Number(updatedRoom.rate || 0);
              const gstAmount = Math.round((pr * nights * (gstNum || 0)) / 100);
              const sharedItem = {
                id: `lodging-booking-${roomId}`,
                name: `Room Booking - ${updatedRoom.name}`,
                type: "lodging",
                qty: nights,
                rate: pr,
                gst: gstNum,
                total: pr * nights + gstAmount,
                meta: {
                  roomId,
                  guest: guest.trim(),
                  notes: String(assignNotes || "").trim(),
                  idProof: {
                    type: String(assignIdType || "").trim(),
                    number: String(assignIdNumber || "").trim(),
                  },
                },
                source: "assign",
              };
              try {
                existing = Array.isArray(existing)
                  ? existing.filter((s) => s && s.type !== "lodging")
                  : [];
              } catch (e) {
                existing = [];
              }
              existing.push(sharedItem);
              window.localStorage.setItem(sharedKey, JSON.stringify(existing));
              try {
                window.dispatchEvent(
                  new CustomEvent("hotel_shared_items_updated", { detail: existing })
                );
              } catch (e) {}
            } catch (err) {
              // ignore
            }

            window.dispatchEvent(
              new CustomEvent("hotel_quick_book", {
                detail: {
                  roomId,
                  guest,
                  nights,
                  members,
                  waitingId: assignTargetWaiting?.id,
                  beds: Number(updatedRoom.beds || 1),
                  rate: Number(updatedRoom.rate || 0),
                  gst: gstNum,
                  notes: String(assignNotes || "").trim(),
                  idProof: {
                    type: String(assignIdType || "").trim(),
                    number: String(assignIdNumber || "").trim(),
                  },
                },
              })
            );
          } catch (e) {}
        }, 150);
      } catch (e) {}
    } catch (err) {}
    // try server remove and room update
    (async () => {
      try {
        await hotelService.removeLodgingWaiting(assignTargetWaiting.id);
      } catch (err) {
        setWaitingMessage({ type: "error", text: "Failed to remove waiting entry from server." });
        showToast("error", "Failed to remove waiting entry from server.");
      }
      try {
        await hotelService.updateTable(roomId, updatedRooms.find((r) => r.id === roomId) || {});
      } catch (err) {
        /* best-effort */
      }
      setAssignLoading(false);
    })();
    setWaitingMessage({ type: "success", text: `${guest} assigned to ${assignSelectedRoomId}` });
    closeAssignModal();
  };

  const handleNoShow = (room) => {
    if (!room) return;
    const settings = getStoreSettings();
    const graceHours = Number(settings?.hotelNoShowGraceHours ?? 6) || 6;
    const checkInDate = room.checkIn ? new Date(room.checkIn) : null;
    if (checkInDate && !Number.isNaN(checkInDate.getTime())) {
      const sixPmToday = new Date();
      sixPmToday.setHours(18, 0, 0, 0);
      const earliest = new Date(
        Math.max(checkInDate.getTime() + graceHours * 3600_000, sixPmToday.getTime())
      );
      if (Date.now() < earliest.getTime()) {
        showToast(
          "error",
          `Too early to mark no-show. Try again after ${earliest.toLocaleString()}.`
        );
        return;
      }
    }
    if (
      !window.confirm(
        `Mark ${room.name || room.id} as a no-show? The room will be released and the booking added to history.`
      )
    )
      return;

    setRooms((prev) => {
      const nextRooms = prev.map((r) =>
        r.id === room.id
          ? {
              ...r,
              status: "vacant",
              guest: "",
              checkIn: "",
              nights: 1,
              members: 1,
              notes: "",
              reservationCode: "",
              checkOutTime: "",
              housekeeping: "dirty",
            }
          : r
      );
      // Tell the server the room is now vacant. Fire-and-forget so a
      // transient network error doesn't block the cashier's next action.
      (async () => {
        try {
          const vacated = nextRooms.find((r) => String(r.id) === String(room.id));
          if (vacated) await hotelService.updateRoom(vacated.id, vacated);
        } catch (err) {
          console.warn("Failed to sync no-show room update to server", err);
        }
      })();
      return nextRooms;
    });
    // Append a history row tagged as no-show
    try {
      const historyRaw = window.localStorage.getItem(CHECKOUT_HISTORY_STORAGE_KEY);
      const history = Array.isArray(JSON.parse(historyRaw || "[]"))
        ? JSON.parse(historyRaw || "[]")
        : [];
      const row = {
        id: `no-show-${Date.now()}`,
        roomId: room.id,
        roomName: room.name,
        guest: room.guest || "",
        checkIn: room.checkIn || "",
        nights: Number(room.nights) || 0,
        total: 0,
        outcome: "no_show",
        at: new Date().toISOString(),
        by: getUser()?.email || "",
      };
      const next = [row, ...history];
      window.localStorage.setItem(CHECKOUT_HISTORY_STORAGE_KEY, JSON.stringify(next));
      window.dispatchEvent(
        new CustomEvent("hotel_lodging_checkout_history_updated", { detail: next })
      );
      // Push to server so other devices in the store see this no-show
      // entry. Fire-and-forget — local state already reflects the change.
      hotelService.addCheckoutHistory(row).catch((err) => {
        console.warn("Failed to sync no-show history to server", err);
      });
    } catch (err) {
      console.warn("Failed to write no-show history", err);
    }
    showToast("info", `${room.name || room.id} marked as no-show.`);
  };

  const handleAddRoom = () => {
    const errors = { name: false, beds: false, rate: false };
    if (!newRoomName.trim()) errors.name = true;
    if (!newRoomBeds.trim()) errors.beds = true;
    const numericBeds = Number(newRoomBeds);
    if (newRoomBeds !== "" && (!Number.isInteger(numericBeds) || numericBeds <= 0))
      errors.beds = true;
    if (newRoomRate === "") errors.rate = true;
    const numericRate = Number(newRoomRate);
    if (newRoomRate !== "" && (Number.isNaN(numericRate) || numericRate <= 0)) errors.rate = true;

    if (rooms.some((room) => room.name.toLowerCase() === newRoomName.trim().toLowerCase())) {
      setMessage({ type: "error", text: "A room with this name already exists." });
      return;
    }

    if (errors.name || errors.beds || errors.rate) {
      setNewRoomErrors(errors);
      setMessage({ type: "error", text: "Please fix the highlighted fields." });
      return;
    }

    const nextId = `R${rooms.length + 101}`;
    const rateValue = Number(newRoomRate) || 0;
    const nextRoom = {
      id: nextId,
      name: newRoomName.trim(),
      beds: numericBeds,
      status: "vacant",
      guest: "",
      checkIn: "",
      nights: 1,
      rate: rateValue,
      ac: newRoomAc,
      modern: newRoomModern,
      notes: "",
    };
    setRooms((prev) => [...prev, nextRoom]);
    // Push the new room to the server so other devices in the store see it.
    // Fire-and-forget — local state already reflects the addition, and the
    // server's `POST /api/hotel/rooms` will assign its own id if ours is
    // not stable.
    (async () => {
      try {
        const created = await hotelService.createRoom(nextRoom);
        if (created && (created.id || created._persisted)) {
          const serverId = created.id || nextRoom.id;
          // Update local copy if the server rewrites the id (rare — only
          // happens if the server mints its own).
          if (String(serverId) !== String(nextId)) {
            setRooms((prev) =>
              prev.map((r) =>
                String(r.id) === String(nextId) ? { ...r, id: serverId, _persisted: true } : r
              )
            );
          } else {
            setRooms((prev) =>
              prev.map((r) => (String(r.id) === String(nextId) ? { ...r, _persisted: true } : r))
            );
          }
        }
      } catch (err) {
        console.warn("Failed to sync new-room creation to server", err);
      }
    })();
    setNewRoomName("");
    setNewRoomBeds("2");
    setNewRoomRate("");
    setNewRoomAc("AC");
    setNewRoomModern(false);
    setNewRoomErrors({ name: false, beds: false, rate: false });
    setMessage({ type: "success", text: "New room created successfully." });
  };

  return (
    <Layout>
      <div className="hl-page">
        {/* HERO */}
        <header className="hl-hero">
          <div className="hl-hero-text">
            <span className="hl-eyebrow">
              <FaBed /> Lodging · Operations
            </span>
            <h2 className="hl-hero-title">Hotel Lodging</h2>
            <p className="hl-hero-sub">
              Manage room occupancy, book guests quickly, and track lodging revenue with a dedicated
              hotel booking workflow.
            </p>
            <div className="hl-lookup-row">
              <span className="hl-lookup">
                <FaSearch />
                <input
                  placeholder="Find by reservation code (e.g. RES-0042)"
                  value={codeLookup}
                  onChange={(e) => setCodeLookup(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    const match = findRoomByReservationCode(rooms, codeLookup);
                    if (!match) {
                      showToast("error", `No booking found for ${codeLookup || "(empty)"}.`);
                      return;
                    }
                    if (match.status === "occupied") {
                      setFolioRoom(match);
                    }
                    showToast("success", `Loaded ${match.name} (${match.reservationCode}).`);
                    try {
                      const el = document.querySelector(`[data-room-id="${match.id}"]`);
                      if (el && typeof el.scrollIntoView === "function") {
                        el.scrollIntoView({ behavior: "smooth", block: "center" });
                        el.classList.add("hotel-hk-room-card-flash");
                        setTimeout(() => el.classList.remove("hotel-hk-room-card-flash"), 1600);
                      }
                    } catch (_) {
                      /* ignore */
                    }
                  }}
                />
              </span>
              <button
                type="button"
                className="hl-lookup-btn"
                onClick={() => {
                  const match = findRoomByReservationCode(rooms, codeLookup);
                  if (!match) {
                    showToast("error", `No booking found for ${codeLookup || "(empty)"}.`);
                    return;
                  }
                  if (match.status === "occupied") {
                    setFolioRoom(match);
                  } else {
                    showToast(
                      "info",
                      `${match.name} is vacant. Use the Assign modal from the waiting queue or settle from /pos to book.`
                    );
                  }
                }}
              >
                Find
              </button>
              <select
                className="hl-lookup-select"
                value={hkFilter}
                onChange={(e) => setHkFilter(e.target.value)}
              >
                <option value="all">All housekeeping states</option>
                <option value="clean">Clean</option>
                <option value="dirty">Dirty</option>
                <option value="inspecting">Inspecting</option>
                <option value="out_of_order">Out of Order</option>
              </select>
            </div>
          </div>
          <div className="hl-hero-stats">
            <article className="hl-kpi hl-kpi-blue">
              <div className="hl-kpi-icon">
                <FaBed />
              </div>
              <div className="hl-kpi-meta">
                <span>Total Rooms</span>
                <strong>{summary.total}</strong>
              </div>
            </article>
            <article className="hl-kpi hl-kpi-emerald">
              <div className="hl-kpi-icon">
                <FaDoorOpen />
              </div>
              <div className="hl-kpi-meta">
                <span>Vacant</span>
                <strong>{summary.vacant}</strong>
              </div>
            </article>
            <article className="hl-kpi hl-kpi-amber">
              <div className="hl-kpi-icon">
                <FaCalendarCheck />
              </div>
              <div className="hl-kpi-meta">
                <span>Occupied</span>
                <strong>{summary.occupied}</strong>
              </div>
            </article>
            <article className="hl-kpi hl-kpi-violet">
              <div className="hl-kpi-icon">
                <FaDollarSign />
              </div>
              <div className="hl-kpi-meta">
                <span>Revenue</span>
                <strong>₹{summary.revenue.toLocaleString("en-IN")}</strong>
              </div>
            </article>
          </div>
        </header>

        {assignModalOpen && assignTargetWaiting && (
          <div className="hotel-edit-modal-backdrop">
            <div className="hotel-edit-modal">
              <h4>Assign {assignTargetWaiting.name} to a room</h4>
              <div className="form-grid">
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Select vacant room</label>
                  <select
                    value={assignSelectedRoomId || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      setAssignSelectedRoomId(val);
                      const room = rooms.find((x) => x.id === val);
                      if (room) setAssignMembers(Number(room.beds || 1));
                    }}
                  >
                    <option value="">Choose a room</option>
                    {rooms
                      .filter((r) => r.status === "vacant")
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} · {r.beds} beds · ₹{r.rate}
                        </option>
                      ))}
                  </select>
                  {assignSelectedRoomId &&
                    (() => {
                      const room = rooms.find((x) => x.id === assignSelectedRoomId);
                      if (!room) return null;
                      return (
                        <div style={{ marginTop: 8, fontSize: 13, color: "#444" }}>
                          <strong>Capacity:</strong> {room.beds} members · <strong>Beds:</strong>{" "}
                          {room.beds} · <strong>AC:</strong> {room.ac || "N/A"}
                        </div>
                      );
                    })()}
                </div>
                <div>
                  <label>Nights</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={String(assignNights)}
                    onChange={(e) => {
                      const digits = String(e.target.value || "")
                        .replace(/\D/g, "")
                        .slice(0, 2);
                      const num = digits ? Number(digits) : 1;
                      setAssignNights(num < 1 ? 1 : num);
                    }}
                  />
                </div>
                <div>
                  <label>Members</label>
                  <input type="text" inputMode="numeric" value={String(assignMembers)} disabled />
                  <div className="field-hint">
                    Members are synchronized to room capacity (beds).
                  </div>
                </div>
                <div>
                  <label>GST (%)</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={String(assignGst)}
                    onChange={(e) => {
                      const digits = String(e.target.value || "")
                        .replace(/\D/g, "")
                        .slice(0, 2);
                      setAssignGst(digits);
                    }}
                  />
                  <div className="field-hint">Enter GST percentage (0-99).</div>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <label>Notes</label>
                  <input value={assignNotes} onChange={(e) => setAssignNotes(e.target.value)} />
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
                    <select value={assignIdType} onChange={(e) => setAssignIdType(e.target.value)}>
                      <option>Aadhar</option>
                      <option>Passport</option>
                      <option>Driving License</option>
                      <option>Voter ID</option>
                      <option>Other</option>
                    </select>
                  </div>
                  <div>
                    <label>ID number</label>
                    <input
                      placeholder="Enter ID number"
                      value={assignIdNumber}
                      onChange={(e) => setAssignIdNumber(e.target.value)}
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#666" }}>
                    Optional ID proof for guest (type + number).
                  </div>
                </div>
              </div>
              <div className="modal-actions">
                <button
                  className="product-btn product-btn-secondary"
                  onClick={closeAssignModal}
                  disabled={assignLoading}
                  aria-busy={assignLoading}
                >
                  Cancel
                </button>
                <button
                  className="product-btn product-btn-primary"
                  onClick={handleAssignToRoom}
                  disabled={assignLoading}
                  aria-busy={assignLoading}
                >
                  {assignLoading ? (
                    <>
                      <span className="inline-spinner" />
                      Assigning…
                    </>
                  ) : (
                    "Assign"
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        <section className="hl-section">
          <div className="hl-section-head">
            <div>
              <h5>
                <span className="hl-section-ico">
                  <FaUserPlus />
                </span>
                Guest Queue
              </h5>
              <p>{waitingQueue.length} waiting · assign them to a vacant room when ready.</p>
            </div>
          </div>

          <div className="hl-form-grid" style={{ marginBottom: 14 }}>
            <div className="hl-field">
              <label>Guest name</label>
              <span className="hl-field-row">
                <FaUserPlus />
                <input
                  placeholder="Guest name"
                  value={waitingName}
                  onChange={(e) => setWaitingName(e.target.value)}
                />
              </span>
            </div>
            <div className="hl-field">
              <label>Members</label>
              <span className="hl-field-row">
                <FaUsers />
                <select
                  value={waitingSeats}
                  onChange={(e) => setWaitingSeats(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((s) => (
                    <option key={s} value={s}>
                      {s} members
                    </option>
                  ))}
                </select>
              </span>
            </div>
            <div className="hl-field" style={{ justifyContent: "flex-end" }}>
              <button
                type="button"
                className="hl-btn hl-btn-primary"
                style={{ marginTop: 22 }}
                onClick={handleAddToWaitingList}
                disabled={waitingAddLoading}
                aria-busy={waitingAddLoading}
              >
                {waitingAddLoading ? (
                  <>
                    <span className="hl-spinner" />
                    Adding…
                  </>
                ) : (
                  <>
                    <FaPlus />
                    Add to Queue
                  </>
                )}
              </button>
            </div>
          </div>

          {waitingMessage && (
            <div className={`hl-message ${waitingMessage.type}`}>{waitingMessage.text}</div>
          )}

          {waitingQueue.length === 0 ? (
            <div className="hl-empty">
              <span className="hl-empty-illu">
                <FaConciergeBell />
              </span>
              <div>
                <strong>No guests in queue</strong>
                <span>Add someone above to start tracking wait times.</span>
              </div>
            </div>
          ) : (
            <div className="hl-queue">
              {waitingQueue.map((w) => {
                const remaining = Number(estimatedWaits[w.id] || 0);
                const initial = Number(initialEstimates[w.id] || remaining || 0);
                const pct =
                  initial > 0
                    ? Math.max(0, Math.min(100, Math.round((1 - remaining / initial) * 100)))
                    : remaining === 0
                      ? 100
                      : 0;
                return (
                  <div
                    key={w.id}
                    className={`hl-queue-row ${newGuests.includes(w.id) ? "is-new" : ""}`}
                  >
                    <div
                      className="hl-avatar"
                      style={{ background: colorForString(w.id || w.name) }}
                    >
                      {getInitials(w.name)}
                    </div>
                    <div className="hl-queue-body">
                      <div className="hl-queue-name">{w.name}</div>
                      <div className="hl-queue-meta">
                        <span>
                          <FaUsers /> {w.seats} member{w.seats === 1 ? "" : "s"}
                        </span>
                        <span>·</span>
                        <span>
                          Est wait:{" "}
                          <strong style={{ color: "#4338ca" }}>{formatMinutes(remaining)}</strong>
                        </span>
                      </div>
                      <div className="hl-queue-progress" aria-hidden>
                        <div className="hl-queue-progress-bar" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                    <div className="hl-queue-eta">
                      <strong>{formatMinutes(remaining)}</strong>
                      <small>EST</small>
                    </div>
                    <div className="hl-queue-actions">
                      <button
                        type="button"
                        className="hl-btn hl-btn-soft hl-btn-sm"
                        onClick={() => openAssignModal(w)}
                        disabled={assignLoading}
                        aria-busy={assignLoading}
                      >
                        {assignLoading ? (
                          <>
                            <span className="hl-spinner" />
                            Working…
                          </>
                        ) : (
                          <>
                            <FaCheckCircle /> Assign
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="hl-btn hl-btn-danger hl-btn-sm"
                        onClick={() => handleRemoveFromWaitingList(w.id)}
                        disabled={waitingRemovingId === w.id}
                        aria-busy={waitingRemovingId === w.id}
                      >
                        {waitingRemovingId === w.id ? (
                          <>
                            <span className="hl-spinner" />
                            Removing…
                          </>
                        ) : (
                          <>
                            <FaTrash /> Remove
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="hl-new-room">
          <div className="hl-new-room-head">
            <div>
              <h5>
                <span className="hl-section-ico">
                  <FaPlus />
                </span>
                Add new room
              </h5>
              <p>Register a fresh room — it joins the floor board immediately.</p>
            </div>
          </div>
          <div className="hl-form-grid">
            <div className="hl-field">
              <label>Room name</label>
              <span className={`hl-field-row ${newRoomErrors.name ? "is-error" : ""}`}>
                <FaBed />
                <input
                  value={newRoomName}
                  onChange={(e) => {
                    setNewRoomName(e.target.value);
                    setNewRoomErrors((prev) => ({ ...prev, name: false }));
                  }}
                  placeholder="Room 401"
                />
              </span>
              {newRoomErrors.name && (
                <small className="hl-field-error">Room name is required.</small>
              )}
            </div>
            <div className="hl-field">
              <label>Beds</label>
              <span className={`hl-field-row ${newRoomErrors.beds ? "is-error" : ""}`}>
                <FaUsers />
                <input
                  type="text"
                  inputMode="numeric"
                  value={newRoomBeds}
                  onChange={(e) => {
                    const digits = String(e.target.value || "").replace(/\D/g, "");
                    setNewRoomBeds(digits);
                    setNewRoomErrors((prev) => ({ ...prev, beds: false }));
                  }}
                  placeholder="e.g. 2"
                />
              </span>
              {newRoomErrors.beds && (
                <small className="hl-field-error">Enter a valid bed count (greater than 0).</small>
              )}
            </div>
            <div className="hl-field">
              <label>Rate per night</label>
              <span className={`hl-field-row ${newRoomErrors.rate ? "is-error" : ""}`}>
                <FaRupeeSign />
                <input
                  type="number"
                  min="0"
                  value={newRoomRate}
                  onChange={(e) => {
                    setNewRoomRate(e.target.value);
                    setNewRoomErrors((prev) => ({ ...prev, rate: false }));
                  }}
                  placeholder="e.g. 1200"
                />
              </span>
              {newRoomErrors.rate && (
                <small className="hl-field-error">Enter a valid rate (greater than 0).</small>
              )}
            </div>
            <div className="hl-field">
              <label>AC Type</label>
              <span className="hl-field-row">
                <FaBed />
                <select value={newRoomAc} onChange={(e) => setNewRoomAc(e.target.value)}>
                  <option value="AC">AC</option>
                  <option value="Non-AC">Non-AC</option>
                </select>
              </span>
            </div>
            <div className="hl-field" style={{ justifyContent: "flex-end" }}>
              <label className="hl-checkbox">
                <input
                  type="checkbox"
                  checked={newRoomModern}
                  onChange={(e) => setNewRoomModern(e.target.checked)}
                />
                <span>Modern room</span>
              </label>
            </div>
          </div>
          <div className="hl-form-actions">
            <button type="button" className="hl-btn hl-btn-primary" onClick={handleAddRoom}>
              <FaPlus /> Add Room
            </button>
          </div>
          {message && (
            <div className={`hl-message ${message.type}`} style={{ marginTop: 12 }}>
              {message.text}
            </div>
          )}
        </section>

        <section className="hl-board">
          <div className="hl-board-head">
            <div>
              <h5>
                <span className="hl-section-ico">
                  <FaBroom />
                </span>
                Housekeeping Floor Board
              </h5>
              <p>
                Tap any room's housekeeping badge to advance its state (Clean → Dirty → Inspecting →
                Clean). Rooms are grouped by floor.
              </p>
            </div>
            <div className="hl-board-actions">
              <button
                type="button"
                className="hl-mini-stat"
                onClick={() => window.print()}
                title="Print this board as a paper handover list"
              >
                <FaFileInvoice /> Print
              </button>
              <a href="/hotel-housekeeping" className="hl-mini-stat">
                Kanban View →
              </a>
            </div>
          </div>

          <div className="hl-chip-row" style={{ marginBottom: 16, gap: 8 }}>
            <span className="hl-mini-stat is-teal">{hkBoardSummary.clean} clean</span>
            <span className="hl-mini-stat is-amber">{hkBoardSummary.dirty} dirty</span>
            <span className="hl-mini-stat is-sky">{hkBoardSummary.inspecting} inspecting</span>
            <span className="hl-mini-stat is-rose">{hkBoardSummary.occupied} in-house</span>
            {hkBoardSummary.overdue > 0 && (
              <span className="hl-mini-stat is-red">
                <FaHourglassHalf /> {hkBoardSummary.overdue} overdue
              </span>
            )}
            {hkBoardSummary.overdue === 0 && hkBoardSummary.dueToday > 0 && (
              <span className="hl-mini-stat is-amber">
                <FaClock /> {hkBoardSummary.dueToday} due today
              </span>
            )}
            <span className="hl-mini-stat is-total">
              {hkFilteredRooms.length} of {rooms.length} shown
            </span>
          </div>

          <div className="hl-filter-row" style={{ marginBottom: 16 }}>
            <span className="hl-filter-search">
              <FaSearch />
              <input
                placeholder="Search by room, guest, RES code, notes…"
                value={hkSearch}
                onChange={(e) => setHkSearch(e.target.value)}
              />
            </span>
            <div className="hl-chip-row">
              <button
                type="button"
                className={`hl-chip ${hkFilter === "all" ? "is-active" : ""}`}
                onClick={() => setHkFilter("all")}
              >
                All
              </button>
              {HOUSEKEEPING_STATES.map((state) => (
                <button
                  key={state.value}
                  type="button"
                  className={`hl-chip ${hkFilter === state.value ? "is-active" : ""}`}
                  style={
                    hkFilter === state.value
                      ? { backgroundColor: state.swatch, color: "#fff", borderColor: state.swatch }
                      : undefined
                  }
                  onClick={() => setHkFilter(state.value)}
                >
                  {state.label}
                </button>
              ))}
              <button
                type="button"
                className={`hl-chip ${hkFilter === "occupied" ? "is-active" : ""}`}
                onClick={() => setHkFilter(hkFilter === "occupied" ? "all" : "occupied")}
                title="Show only occupied rooms"
              >
                In-house only
              </button>
            </div>
          </div>

          {hkFilteredRooms.length === 0 ? (
            <div className="hl-empty">
              <span className="hl-empty-illu">
                <FaBroom />
              </span>
              <div>
                <strong>No rooms match</strong>
                <span>Try clearing the housekeeping filter or search query.</span>
              </div>
            </div>
          ) : (
            <div className="hl-floor-list">
              {hkGroups.map((group) => {
                const tone = summarizeRoomsForFloor(group.rooms) || "";
                return (
                  <section key={group.floor} className="hl-floor">
                    <header className="hl-floor-head">
                      <div className="hl-floor-title">
                        <span className="hl-floor-icon">
                          <FaBed />
                        </span>
                        Floor {group.floor}
                      </div>
                      <div className="hl-floor-summary">{tone}</div>
                    </header>
                    <div className="hl-floor-grid">
                      {group.rooms.map((room) => {
                        const swatch = getHousekeepingSwatch(room);
                        const sellable = isRoomSellable(room);
                        const late =
                          room.status === "occupied"
                            ? lateCheckOutMinutes(room, new Date(), getStoreSettings())
                            : 0;
                        const toggling = hkToggleIds.has(room.id);
                        return (
                          <FloorRoomCard
                            key={room.id}
                            room={room}
                            housekeepingLabel={getHousekeepingLabel(room)}
                            housekeepingTone={getHousekeepingTone(room)}
                            housekeepingSwatch={swatch}
                            housekeepingBusy={toggling}
                            sellable={sellable}
                            lateCheckoutMinutes={late}
                            onToggleHousekeeping={handleToggleHkFromCard}
                            onOpenFolio={(r) => setFolioRoom(r)}
                            onBook={startBookVacantRoom}
                            bookingDraft={bookingDraft}
                            onBookDraftChange={setBookingDraft}
                            onBookDraftConfirm={handleBookVacantRoom}
                            onBookDraftCancel={cancelBookVacantRoom}
                            onNoShow={handleNoShow}
                            onSettle={() => (window.location.href = "/pos")}
                            onCopyMobile={(mobile) => showToast?.("info", `Copied ${mobile}`)}
                          />
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </section>

        {/* CHECKOUT HISTORY */}
        <section className="hl-section">
          <div className="hl-section-head">
            <div>
              <h5>
                <span className="hl-section-ico">
                  <FaFileInvoice />
                </span>
                Checkout History
              </h5>
              <p>Past guest checkouts — searchable, exportable, and ready for reporting.</p>
            </div>
          </div>
          {message && (
            <div className={`hl-message ${message.type}`} style={{ marginTop: 12 }}>
              {message.text}
            </div>
          )}
          <div className="hl-history-search-row">
            <div className="hl-field">
              <label>Search</label>
              <span className="hl-field-row">
                <FaSearch />
                <input
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Room, guest, notes, ID proof"
                />
              </span>
            </div>
            <div className="hl-field">
              <label>Checkout from</label>
              <span className="hl-field-row">
                <FaCalendarDay />
                <input
                  type="date"
                  value={historyFromDate}
                  onChange={(e) => setHistoryFromDate(e.target.value)}
                />
              </span>
            </div>
            <div className="hl-field">
              <label>Checkout to</label>
              <span className="hl-field-row">
                <FaCalendarDay />
                <input
                  type="date"
                  value={historyToDate}
                  onChange={(e) => setHistoryToDate(e.target.value)}
                />
              </span>
            </div>
          </div>
          <div className="hl-history-stats">
            <div className="hl-history-stat" style={{ "--hs": "#6366f1" }}>
              <span>Filtered Records</span>
              <strong>{checkoutHistorySummary.records}</strong>
            </div>
            <div className="hl-history-stat" style={{ "--hs": "#0ea5e9" }}>
              <span>Total Nights</span>
              <strong>{checkoutHistorySummary.nights}</strong>
            </div>
            <div className="hl-history-stat" style={{ "--hs": "#ec4899" }}>
              <span>Total Members</span>
              <strong>{checkoutHistorySummary.members}</strong>
            </div>
            <div className="hl-history-stat" style={{ "--hs": "#10b981" }}>
              <span>Total Amount</span>
              <strong>₹{checkoutHistorySummary.amount.toLocaleString("en-IN")}</strong>
            </div>
            <div className="hl-history-stat" style={{ "--hs": "#f59e0b" }}>
              <span>Avg Stay Length</span>
              <strong>{averageStayLength.toFixed(1)} nights</strong>
            </div>
            <div className="hl-history-stat" style={{ "--hs": "#8b5cf6" }}>
              <span>Avg Booking Amount</span>
              <strong>₹{averageBookingAmount.toLocaleString("en-IN")}</strong>
            </div>
          </div>

          <div className="hl-history-actions">
            <span className="hl-history-info">
              Showing <strong>{filteredCheckoutHistory.length}</strong> of{" "}
              <strong>{checkoutHistory.length}</strong> checkout record
              {checkoutHistory.length === 1 ? "" : "s"}.
            </span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="hl-btn hl-btn-soft"
                onClick={handleExportCheckoutHistoryCsv}
              >
                <FaFileInvoice /> Export CSV
              </button>
              <button
                type="button"
                className="hl-btn hl-btn-ghost"
                onClick={() => {
                  setHistorySearch("");
                  setHistoryFromDate("");
                  setHistoryToDate("");
                }}
              >
                Reset Filters
              </button>
              <button
                type="button"
                className="hl-btn hl-btn-danger"
                onClick={handleClearCheckoutHistory}
                disabled={historyClearing}
                aria-busy={historyClearing}
              >
                {historyClearing ? (
                  <>
                    <span className="hl-spinner" /> Clearing…
                  </>
                ) : (
                  <>Clear History</>
                )}
              </button>
            </div>
          </div>
          {historyMessage && (
            <div className={`hl-message ${historyMessage.type}`} style={{ marginBottom: 12 }}>
              {historyMessage.text}
            </div>
          )}
          <div className="hl-history-table-wrap">
            <table className="hl-history-table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Guest</th>
                  <th>Check In</th>
                  <th>Checkout</th>
                  <th className="hl-ta-right">Nights</th>
                  <th className="hl-ta-right">Members</th>
                  <th className="hl-ta-right">Rate</th>
                  <th className="hl-ta-right">Total</th>
                  <th>Notes</th>
                  <th className="hl-ta-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredCheckoutHistory.length === 0 ? (
                  <tr className="hl-empty-row">
                    <td colSpan="10">
                      {checkoutHistory.length === 0
                        ? "No checkout records yet."
                        : "No checkout records match the current filters."}
                    </td>
                  </tr>
                ) : (
                  <>
                    {filteredCheckoutHistory.map((entry) => (
                      <tr key={entry.id}>
                        <td>
                          <div className="hl-room-cell">
                            <strong>{entry.roomName || entry.roomId}</strong>
                            {entry.reservationCode && (
                              <span className="hl-res-pill">{entry.reservationCode}</span>
                            )}
                          </div>
                        </td>
                        <td>{entry.guest || "—"}</td>
                        <td>{formatDateTime(entry.checkIn)}</td>
                        <td>{formatDateTime(entry.checkedOutAt)}</td>
                        <td className="hl-ta-right">{Number(entry.nights || 0)}</td>
                        <td className="hl-ta-right">{Number(entry.members || 0)}</td>
                        <td className="hl-ta-right">
                          ₹{Number(entry.rate || 0).toLocaleString("en-IN")}
                        </td>
                        <td className="hl-ta-right hl-total">
                          ₹{Number(entry.total || 0).toLocaleString("en-IN")}
                        </td>
                        <td>{entry.notes || "—"}</td>
                        <td className="hl-ta-center">
                          <button
                            type="button"
                            className="hl-btn hl-btn-danger hl-btn-sm"
                            onClick={() => handleDeleteCheckoutEntry(entry.id)}
                            disabled={historyDeletingId === entry.id}
                            aria-busy={historyDeletingId === entry.id}
                            title="Delete entry"
                          >
                            {historyDeletingId === entry.id ? (
                              <span className="hl-spinner" />
                            ) : (
                              <FaTrash />
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan="4">Filtered Totals</td>
                      <td className="hl-ta-right">{checkoutHistorySummary.nights}</td>
                      <td className="hl-ta-right">{checkoutHistorySummary.members}</td>
                      <td className="hl-ta-right" style={{ color: "#94a3b8" }}>
                        —
                      </td>
                      <td className="hl-ta-right hl-total">
                        ₹{checkoutHistorySummary.amount.toLocaleString("en-IN")}
                      </td>
                      <td>
                        {checkoutHistorySummary.records} record
                        {checkoutHistorySummary.records === 1 ? "" : "s"}
                      </td>
                      <td />
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* All-rooms board added in v2 (housekeeping + folio + no-show). */}
        {folioRoom && (
          <RoomFolioDrawer
            room={folioRoom}
            settings={getStoreSettings()}
            onClose={() => setFolioRoom(null)}
            onSettleCheckout={() => {
              setFolioRoom(null);
              window.location.href = "/pos";
            }}
            onPrintFolio={() =>
              showToast("info", "Folio preview opened. Use the browser print menu.")
            }
          />
        )}
      </div>
    </Layout>
  );
};

export default HotelLodgingPage;
