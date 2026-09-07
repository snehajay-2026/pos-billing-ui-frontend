import React, { useEffect, useState } from "react";
import Layout from "../components/layout/Layout";
import hotelService from "../services/hotelService";
import {
  FaTable,
  FaCheckCircle,
  FaChair,
  FaClock,
  FaUsers,
  FaHourglassHalf,
  FaPlus,
  FaConciergeBell,
  FaUserPlus,
  FaArrowRight,
  FaInfoCircle,
  FaTrash,
  FaMapMarkerAlt,
  FaSearch,
  FaUserCheck,
  FaTimes,
} from "react-icons/fa";
import "./HotelTableBookingPage.css";
import { useUi } from "../context/UiContext";
import { formatWaitTime, getEstimatedWaitMinutes } from "../utils/diningWaitEstimate";

// Mirror of HotelBilling's `formatTime12Hour` (see HotelBilling.jsx:232).
// Used to stamp the check-in time on a booking row at Assign time so the
// timestamp matches what the cashier would see if they booked the table
// directly from the POS dining tab.
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

const TABLES_STORAGE_KEY = "hotel_table_booking_state";
const WAITING_QUEUE_KEY = "hotel_dining_waiting_list";
const defaultTables = [
  {
    id: "T1",
    name: "Table 1",
    seats: 2,
    zone: "Main",
    status: "empty",
    guest: "",
    partySize: 0,
    orderSummary: "",
  },
  {
    id: "T2",
    name: "Table 2",
    seats: 2,
    zone: "Window",
    status: "empty",
    guest: "",
    partySize: 0,
    orderSummary: "",
  },
  {
    id: "T3",
    name: "Table 3",
    seats: 4,
    zone: "Main",
    status: "empty",
    guest: "",
    partySize: 0,
    orderSummary: "",
  },
  {
    id: "T4",
    name: "Table 4",
    seats: 4,
    zone: "Garden",
    status: "empty",
    guest: "",
    partySize: 0,
    orderSummary: "",
  },
  {
    id: "T5",
    name: "Table 5",
    seats: 6,
    zone: "Window",
    status: "empty",
    guest: "",
    partySize: 0,
    orderSummary: "",
  },
  {
    id: "T6",
    name: "Table 6",
    seats: 8,
    zone: "Main",
    status: "empty",
    guest: "",
    partySize: 0,
    orderSummary: "",
  },
];

const normalizeTables = (inputTables = []) => {
  const byKey = new Map();
  inputTables.forEach((table, index) => {
    if (!table || typeof table !== "object") return;
    const tableIdentity =
      table.id != null
        ? `id:${String(table.id)}`
        : `name:${String(table.name || "")
            .trim()
            .toLowerCase()}`;
    const rank = new Date(table.updatedAt || table.createdAt || 0).getTime() || index;
    const previous = byKey.get(tableIdentity);
    if (!previous || rank >= previous.rank) {
      byKey.set(tableIdentity, { value: { ...table, _persisted: true }, rank });
    }
  });
  return Array.from(byKey.values()).map((entry) => entry.value);
};

const HotelTableBookingPage = () => {
  const [tables, setTables] = useState(defaultTables);
  const [newTableName, setNewTableName] = useState("");
  const [newTableSeats, setNewTableSeats] = useState(2);
  const [newTableZone, setNewTableZone] = useState("Main");
  const [waitingName, setWaitingName] = useState("");
  const [waitingSeats, setWaitingSeats] = useState(2);
  const [waitingQueue, setWaitingQueue] = useState(() => {
    if (typeof window === "undefined") return [];
    const savedWaiting = window.localStorage.getItem(WAITING_QUEUE_KEY);
    if (!savedWaiting) return [];
    try {
      const parsedWaiting = JSON.parse(savedWaiting);
      return Array.isArray(parsedWaiting) ? parsedWaiting : [];
    } catch (err) {
      console.error("Failed to parse waiting queue state", err);
      return [];
    }
  });
  const [newGuests, setNewGuests] = useState([]);
  const [waitingMessage, setWaitingMessage] = useState(null);
  const [waitingAddLoading, setWaitingAddLoading] = useState(false);
  const [waitingRemovingId, setWaitingRemovingId] = useState(null);
  const [addTableMessage, setAddTableMessage] = useState(null);
  // Assign-waiting-guest flow — picks a table for a queued customer.
  // `assigningEntry` is the queue entry being seated; `assignModalOpen`
  // gates the modal; `assignTableId` is the table the cashier selected.
  // The entry is removed from `waitingQueue` only AFTER the server-side
  // bookTable succeeds — a partial local removal would lose the entry
  // on a network error.
  const [assigningEntry, setAssigningEntry] = useState(null);
  const [assignModalOpen, setAssignModalOpen] = useState(false);
  const [assignTableId, setAssignTableId] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  // Tracks whether the initial async load (server → localStorage → defaults)
  // has finished. While `false`, the persistence effect below MUST NOT write
  // to localStorage — otherwise the seed `defaultTables` would clobber a
  // booking the user just made in HotelBilling's dining tab before the load
  // resolved. This was the root cause of "table booking disappears when I
  // open the Dining Tables page and go back".
  const [tablesHydrated, setTablesHydrated] = useState(false);
  const { showToast, activeStore } = useUi();

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const resp = await hotelService.getTables();
        if (mounted && Array.isArray(resp) && resp.length > 0) {
          setTables(normalizeTables(resp));
          // Hydrate only after the load has actually populated `tables`.
          // Flipping the gate inside the load callback (instead of via a
          // setTimeout microtask) ensures the persistence effect cannot fire
          // with the seed `defaultTables` and clobber localStorage before
          // this completes.
          setTablesHydrated(true);
          return;
        }
      } catch (err) {
        // fallback to localStorage
      }

      const saved = window.localStorage.getItem(TABLES_STORAGE_KEY);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setTables(normalizeTables(parsed));
            setTablesHydrated(true);
            return;
          }
        } catch (err) {
          console.error("Failed to parse saved hotel table state", err);
        }
      }

      // No data anywhere — seed defaults but still mark hydrated so we don't
      // re-persist defaults every render. The defaults will only be persisted
      // when the user makes a real change (adding a table, booking one, etc.).
      setTables(defaultTables);
      setTablesHydrated(true);
    };
    load();
    return () => {
      mounted = false;
    };
  }, [activeStore]);

  useEffect(() => {
    // Skip persistence until the initial async load has finished. Without
    // this gate the seed `defaultTables` would be written to localStorage on
    // first render — wiping any booking the cashier just made in
    // HotelBilling's dining tab.
    if (!tablesHydrated) return;
    const normalizedTables = normalizeTables(tables);
    window.localStorage.setItem(TABLES_STORAGE_KEY, JSON.stringify(normalizedTables));
    // try persisting to server
    (async () => {
      try {
        // naive approach: replace server state by upserting each table
        for (const t of normalizedTables) {
          if (!t._persisted) {
            const created = await hotelService.createTable(t).catch(() => null);
            if (created) {
              t.id = created.id;
              t._persisted = true;
            }
          } else {
            await hotelService.updateTable(t.id, t).catch(() => null);
          }
        }
      } catch (err) {
        // ignore persistence errors
      }
    })();
  }, [tables, tablesHydrated]);

  useEffect(() => {
    const onWaitingListUpdated = (e) => {
      try {
        const list = e.detail || JSON.parse(window.localStorage.getItem(WAITING_QUEUE_KEY) || "[]");
        if (Array.isArray(list)) setWaitingQueue(list);
      } catch (err) {}
    };
    window.addEventListener("hotel_dining_waiting_list_updated", onWaitingListUpdated);
    return () =>
      window.removeEventListener("hotel_dining_waiting_list_updated", onWaitingListUpdated);
  }, [activeStore]);

  useEffect(() => {
    const updated = waitingQueue || [];
    try {
      window.localStorage.setItem(WAITING_QUEUE_KEY, JSON.stringify(updated));
      window.dispatchEvent(
        new CustomEvent("hotel_dining_waiting_list_updated", { detail: updated })
      );
    } catch (err) {
      // ignore
    }
    (async () => {
      try {
        for (const w of updated) {
          if (!w._persisted) {
            const created = await hotelService.addDiningWaiting(w).catch(() => null);
            if (created) {
              w.id = created.id;
              w._persisted = true;
            }
          }
        }
      } catch (err) {}
    })();
  }, [waitingQueue]);

  const seatOptions = [2, 4, 6, 8, 10];
  const zoneOptions = ["Main", "Window", "Garden", "Terrace"];

  const findSuitableTablesForSeats = (seats) =>
    tables
      .filter((table) => table.status === "empty" && table.seats >= seats)
      .sort((a, b) => a.seats - b.seats);

  const summary = {
    total: tables.length,
    empty: tables.filter((t) => t.status === "empty").length,
    booked: tables.filter((t) => t.status === "booked").length,
    bySeats: seatOptions.map((seats) => ({
      seats,
      total: tables.filter((t) => t.seats === seats).length,
      empty: tables.filter((t) => t.seats === seats && t.status === "empty").length,
      booked: tables.filter((t) => t.seats === seats && t.status === "booked").length,
    })),
  };

  const handleAddToWaitingList = () => {
    if (!waitingName.trim()) {
      setWaitingMessage({
        type: "error",
        text: "Enter customer name to add to the waiting queue.",
      });
      return;
    }

    const entry = { id: `W${Date.now()}`, name: waitingName.trim(), seats: waitingSeats };
    setWaitingAddLoading(true);
    setWaitingQueue((prev) => [...prev, entry]);
    setNewGuests((prev) => [...prev, entry.id]);
    setTimeout(() => setNewGuests((prev) => prev.filter((id) => id !== entry.id)), 1600);
    setWaitingName("");
    setWaitingSeats(2);
    setWaitingMessage({ type: "success", text: "Customer added to the waiting queue." });
    (async () => {
      try {
        await hotelService.addDiningWaiting({ name: entry.name, seats: entry.seats });
      } catch (err) {
        // Non-blocking: keep the entry locally and let the sync effect retry later.
        console.warn("Dining waiting sync failed (src), will retry later", err);
      } finally {
        setWaitingAddLoading(false);
      }
    })();
  };

  const getInitials = (name) => {
    if (!name) return "";
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    const first = parts[0] ? parts[0][0] : "";
    const second = parts[1] ? parts[1][0] : "";
    return (first + second).toUpperCase();
  };

  const colorForString = (s) => {
    const text = String(s || "guest");
    let h = 0;
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
    const h2 = (h + 40) % 360;
    return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${h2} 70% 45%))`;
  };

  const availableTableCount = tables.filter((table) => table.status === "empty").length;
  const nextWaitingMinutes =
    waitingQueue.length > 0
      ? getEstimatedWaitMinutes({ queueIndex: 0, seats: waitingQueue[0].seats, tables })
      : 0;
  const averageWaitingMinutes =
    waitingQueue.length > 0
      ? Math.round(
          waitingQueue.reduce(
            (sum, entry, index) =>
              sum + getEstimatedWaitMinutes({ queueIndex: index, seats: entry.seats, tables }),
            0
          ) / waitingQueue.length
        )
      : 0;
  const longestWaitingMinutes =
    waitingQueue.length > 0
      ? Math.max(
          ...waitingQueue.map((entry, index) =>
            getEstimatedWaitMinutes({ queueIndex: index, seats: entry.seats, tables })
          )
        )
      : 0;
  const waitingCapacity = waitingQueue.reduce((sum, entry) => sum + Number(entry.seats || 0), 0);
  const openSeatCapacity = tables
    .filter((table) => table.status === "empty")
    .reduce((sum, table) => sum + Number(table.seats || 0), 0);

  const getWaitTone = (minutes) => {
    if (minutes <= 15) return "fast";
    if (minutes <= 35) return "steady";
    return "busy";
  };

  const getWaitLabel = (minutes) => {
    if (minutes <= 15) return "Ready soon";
    if (minutes <= 35) return "On track";
    return "High demand";
  };

  const getReadinessPercent = (minutes) =>
    Math.max(12, Math.min(100, Math.round(100 - (Math.min(minutes, 75) / 75) * 72)));

  const handleRemoveFromWaitingList = (entryId) => {
    setWaitingRemovingId(entryId);
    setWaitingQueue((prev) => prev.filter((entry) => entry.id !== entryId));
    (async () => {
      try {
        await hotelService.removeDiningWaiting(entryId);
      } catch (err) {
        showToast("error", "Failed to remove from server.");
      } finally {
        setWaitingRemovingId(null);
      }
    })();
  };

  // === Assign: seat a waiting customer at a chosen dining table ===
  //
  // Open the picker modal. The cashier selects an available table sized
  // for the guest; confirm posts to /api/hotel/bookings via
  // hotelService.bookTable (which fans out the SSE `kind:"booking",
  // action:"upserted"` event so every device in the same store flips
  // the table to Booked). On success the queue entry is removed.
  const handleOpenAssign = (entry) => {
    if (!entry) return;
    setAssigningEntry(entry);
    setAssignTableId("");
    setAssignModalOpen(true);
  };

  const handleCloseAssign = () => {
    if (assignBusy) return;
    setAssignModalOpen(false);
    setAssigningEntry(null);
    setAssignTableId("");
  };

  const handleConfirmAssign = async () => {
    if (assignBusy || !assigningEntry) return;
    const entry = assigningEntry;
    const table = tables.find((t) => String(t.id) === String(assignTableId));
    if (!table) {
      showToast("error", "Please select a table to assign.");
      return;
    }
    if (table.status !== "empty") {
      // Server-side upsert would still work, but we keep the UI honest
      // by rejecting a table that became booked while the modal was open.
      showToast("error", `${table.name} is no longer available. Pick another table.`);
      setAssignTableId("");
      return;
    }
    if (Number(table.seats || 0) < Number(entry.seats || 0)) {
      showToast(
        "error",
        `${table.name} seats ${table.seats} — too small for a party of ${entry.seats}.`
      );
      setAssignTableId("");
      return;
    }
    setAssignBusy(true);
    const now = new Date();
    const checkInDate = now.toISOString().slice(0, 10);
    const checkInTime = formatTime12Hour(
      `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
    );
    try {
      // Persist to MySQL via /api/hotel/bookings. The backend broadcasts
      // an SSE booking event; HotelBilling's listener merges it into
      // the dining tab tables state and re-renders the card as Booked.
      await hotelService.bookTable({
        id: table.id,
        name: table.name,
        zone: table.zone,
        partySize: Number(entry.seats) || 1,
        guest: entry.name,
        status: "booked",
        checkInDate,
        checkInTime,
      });
      // Best-effort optimistic local flip so this page's stat tiles and
      // the seater grid reflect the new booking without waiting on the
      // SSE round-trip. The SSE listener in HotelBilling is the source
      // of truth on every other device.
      setTables((prev) =>
        prev.map((t) =>
          String(t.id) === String(table.id)
            ? {
                ...t,
                status: "booked",
                guest: entry.name,
                partySize: Number(entry.seats) || 1,
                customerMobile: "",
                checkInDate,
                checkInTime,
                _persisted: true,
              }
            : t
        )
      );
      // Drop the entry from the queue. The existing effect at line ~250
      // mirrors this removal to the server via removeDiningWaiting().
      setWaitingQueue((prev) => prev.filter((w) => w.id !== entry.id));
      setAssignBusy(false);
      setAssignModalOpen(false);
      setAssigningEntry(null);
      setAssignTableId("");
      showToast("success", `${entry.name} assigned to ${table.name}.`);
    } catch (err) {
      setAssignBusy(false);
      // Stay on the modal so the cashier can retry with the same or a
      // different table. The queue entry is preserved.
      showToast("error", err?.message || "Failed to assign table.");
    }
  };

  return (
    <Layout>
      <div className="htb-page">
        <div className="htb-hero">
          <div className="htb-hero-text">
            <span className="htb-eyebrow">
              <FaConciergeBell aria-hidden="true" /> Hotel Store · Dining
            </span>
            <h1 className="htb-hero-title">Dinning Table Booking</h1>
            <p className="htb-hero-sub">
              Manage your floor in real time — add new tables, track the waiting queue with
              intelligent wait-time estimates, and jump into the live table cards inside Hotel
              Billing.
            </p>
          </div>
          <div className="htb-hero-summary">
            <div className="htb-summary-card">
              <div className="htb-summary-card-icon total">
                <FaTable />
              </div>
              <div className="htb-summary-card-body">
                <span>Total Tables</span>
                <strong>{summary.total}</strong>
              </div>
            </div>
            <div className="htb-summary-card">
              <div className="htb-summary-card-icon available">
                <FaCheckCircle />
              </div>
              <div className="htb-summary-card-body">
                <span>Available</span>
                <strong>{summary.empty}</strong>
              </div>
            </div>
            <div className="htb-summary-card">
              <div className="htb-summary-card-icon occupied">
                <FaChair />
              </div>
              <div className="htb-summary-card-body">
                <span>Occupied</span>
                <strong>{summary.booked}</strong>
              </div>
            </div>
          </div>
          <div className="htb-hero-decor" aria-hidden="true">
            <FaConciergeBell />
          </div>
        </div>

        <div className="htb-row-2col">
          <div className="htb-panel">
            <div className="htb-panel-head">
              <div>
                <div className="htb-panel-kicker dining">
                  <FaPlus aria-hidden="true" /> Floor Setup
                </div>
                <h2 className="htb-panel-title">Add a new table</h2>
                <p className="htb-panel-sub">
                  Define a new table by name, seating capacity and zone — it appears instantly on
                  the live floor map.
                </p>
              </div>
            </div>
            {addTableMessage && (
              <div className={`htb-toast ${addTableMessage.type}`}>
                {addTableMessage.type === "success" ? (
                  <FaCheckCircle aria-hidden="true" />
                ) : (
                  <FaInfoCircle aria-hidden="true" />
                )}
                <span>{addTableMessage.text}</span>
              </div>
            )}
            <div className="htb-form-row">
              <div className="htb-form-col">
                <label>
                  <FaChair aria-hidden="true" /> Table name
                </label>
                <input
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder="e.g. Table 7"
                />
              </div>
              <div className="htb-form-col">
                <label>
                  <FaUsers aria-hidden="true" /> Seats
                </label>
                <select
                  value={newTableSeats}
                  onChange={(e) => setNewTableSeats(Number(e.target.value))}
                >
                  {[2, 4, 6, 8, 10].map((seats) => (
                    <option key={seats} value={seats}>
                      {seats} Seater
                    </option>
                  ))}
                </select>
              </div>
              <div className="htb-form-col">
                <label>
                  <FaMapMarkerAlt aria-hidden="true" /> Zone
                </label>
                <select value={newTableZone} onChange={(e) => setNewTableZone(e.target.value)}>
                  {zoneOptions.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="htb-form-actions">
              <button
                className="htb-btn htb-btn-primary"
                type="button"
                onClick={() => {
                  if (!newTableName.trim()) {
                    setAddTableMessage({
                      type: "error",
                      text: "Enter a table name before adding.",
                    });
                    return;
                  }
                  if (
                    tables.some(
                      (table) => table.name.toLowerCase() === newTableName.trim().toLowerCase()
                    )
                  ) {
                    setAddTableMessage({
                      type: "error",
                      text: "A table with this name already exists.",
                    });
                    return;
                  }
                  const nextId = `T${tables.length + 1}`;
                  setTables((prev) => [
                    ...prev,
                    {
                      id: nextId,
                      name: newTableName.trim(),
                      seats: newTableSeats,
                      zone: newTableZone,
                      status: "empty",
                      guest: "",
                      partySize: 0,
                    },
                  ]);
                  setNewTableName("");
                  setNewTableSeats(2);
                  setNewTableZone("Main");
                  setAddTableMessage({
                    type: "success",
                    text: "New table added successfully.",
                  });
                }}
              >
                <FaPlus className="htb-btn-icon" aria-hidden="true" />
                <span>Add Table</span>
              </button>
            </div>
          </div>

          <div className="htb-panel htb-waiting-panel">
            <div className="htb-waiting-head">
              <div>
                <div className="htb-panel-kicker queue">
                  <FaHourglassHalf aria-hidden="true" /> Live Queue
                </div>
                <h2 className="htb-panel-title">Customer waiting queue</h2>
                <p className="htb-panel-sub">
                  Track each guest by party size, table fit, and estimated seating time.
                </p>
              </div>
              <div className={`htb-waiting-pill ${getWaitTone(nextWaitingMinutes)}`}>
                <FaClock aria-hidden="true" />
                <span>{waitingQueue.length ? getWaitLabel(nextWaitingMinutes) : "No wait"}</span>
              </div>
            </div>

            {waitingMessage && (
              <div className={`htb-toast ${waitingMessage.type}`}>
                {waitingMessage.type === "success" ? (
                  <FaCheckCircle aria-hidden="true" />
                ) : (
                  <FaInfoCircle aria-hidden="true" />
                )}
                <span>{waitingMessage.text}</span>
              </div>
            )}

            <div className="htb-form-row two-col">
              <div className="htb-form-col">
                <label>
                  <FaUserPlus aria-hidden="true" /> Customer name
                </label>
                <input
                  value={waitingName}
                  onChange={(e) => setWaitingName(e.target.value)}
                  placeholder="Enter customer name"
                />
              </div>
              <div className="htb-form-col">
                <label>
                  <FaUsers aria-hidden="true" /> Seats required
                </label>
                <select
                  value={waitingSeats}
                  onChange={(e) => setWaitingSeats(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((seats) => (
                    <option key={seats} value={seats}>
                      {seats} Seats
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="htb-form-actions">
              <button
                className="htb-btn htb-btn-primary"
                type="button"
                onClick={handleAddToWaitingList}
                disabled={waitingAddLoading}
                aria-busy={waitingAddLoading}
              >
                {waitingAddLoading ? (
                  <>
                    <span className="htb-spinner" aria-hidden="true" />
                    <span>Adding…</span>
                  </>
                ) : (
                  <>
                    <FaUserPlus className="htb-btn-icon" aria-hidden="true" />
                    <span>Add to waiting list</span>
                  </>
                )}
              </button>
            </div>

            <div className="htb-stats-grid">
              <div className="htb-stat-tile tone-blue">
                <span className="htb-stat-tile-icon">
                  <FaClock aria-hidden="true" /> Next estimate
                </span>
                <strong>
                  {waitingQueue.length ? formatWaitTime(nextWaitingMinutes) : "No wait"}
                </strong>
                <small>
                  {waitingQueue.length
                    ? `${waitingQueue[0].name} is next`
                    : "Add a guest to start tracking"}
                </small>
              </div>
              <div className="htb-stat-tile tone-green">
                <span className="htb-stat-tile-icon">
                  <FaTable aria-hidden="true" /> Available tables
                </span>
                <strong>{availableTableCount}</strong>
                <small>Open tables ready for seating</small>
              </div>
              <div className="htb-stat-tile tone-orange">
                <span className="htb-stat-tile-icon">
                  <FaHourglassHalf aria-hidden="true" /> Avg wait
                </span>
                <strong>
                  {waitingQueue.length ? formatWaitTime(averageWaitingMinutes) : "No wait"}
                </strong>
                <small>
                  {waitingQueue.length
                    ? `Longest wait ${formatWaitTime(longestWaitingMinutes)}`
                    : "Estimated queue time for all guests"}
                </small>
              </div>
              <div className="htb-stat-tile tone-purple">
                <span className="htb-stat-tile-icon">
                  <FaUsers aria-hidden="true" /> Queue load
                </span>
                <strong>{waitingCapacity}</strong>
                <small>{openSeatCapacity} open seats available now</small>
              </div>
            </div>

            {waitingQueue.length === 0 ? (
              <div className="htb-waiting-empty">
                <div className="htb-waiting-empty-icon">
                  <FaCheckCircle />
                </div>
                <strong>No guests waiting</strong>
                <span>New customer entries will appear here with table-fit estimates.</span>
              </div>
            ) : (
              <div className="htb-waiting-list">
                {waitingQueue.map((entry, index) => {
                  const suitableTables = findSuitableTablesForSeats(entry.seats);
                  const exactMatches = suitableTables.filter(
                    (table) => table.seats === entry.seats
                  );
                  const estimateMinutes = getEstimatedWaitMinutes({
                    queueIndex: index,
                    seats: entry.seats,
                    tables,
                  });
                  const waitTone = getWaitTone(estimateMinutes);
                  const bestFitText =
                    exactMatches.length > 0
                      ? `Best fit: ${exactMatches
                          .slice(0, 2)
                          .map((t) => t.name)
                          .join(", ")}`
                      : suitableTables.length > 0
                        ? `Flexible fit: ${suitableTables
                            .slice(0, 2)
                            .map((t) => `${t.name} (${t.seats})`)
                            .join(", ")}`
                        : "Waiting for a table to clear";
                  const readinessPercent = getReadinessPercent(estimateMinutes);
                  return (
                    <div
                      key={entry.id}
                      className={`htb-waiting-item ${waitTone} ${
                        newGuests.includes(entry.id) ? "guest-new" : ""
                      }`}
                    >
                      <div className="htb-waiting-item-main">
                        <div className="htb-waiting-person">
                          <div
                            className="htb-guest-avatar"
                            style={{
                              background: colorForString(entry.id || entry.name),
                            }}
                          >
                            {getInitials(entry.name)}
                          </div>
                          <div className="htb-waiting-person-body">
                            <span className="htb-waiting-position">Queue #{index + 1}</span>
                            <strong className="htb-waiting-name">{entry.name}</strong>
                            <div className="htb-waiting-meta">
                              <span>
                                <FaUsers aria-hidden="true" /> {entry.seats} seats
                              </span>
                              <span>
                                <FaClock aria-hidden="true" /> {formatWaitTime(estimateMinutes)}
                              </span>
                              <span>{getWaitLabel(estimateMinutes)}</span>
                            </div>
                          </div>
                        </div>
                        <div className="htb-waiting-fit">
                          <FaSearch aria-hidden="true" />
                          <span>{bestFitText}</span>
                        </div>
                        <div className="htb-waiting-progress" aria-hidden="true">
                          <div className={waitTone} style={{ width: `${readinessPercent}%` }} />
                        </div>
                      </div>
                      <div className="htb-waiting-item-side">
                        <div className={`htb-wait-time-pill ${waitTone}`}>
                          {formatWaitTime(estimateMinutes)}
                        </div>
                        <div className="htb-waiting-actions">
                          <button
                            className="htb-btn htb-btn-primary htb-btn-assign"
                            type="button"
                            onClick={() => handleOpenAssign(entry)}
                            disabled={assignBusy}
                            title={`Seat ${entry.name} at an available table`}
                          >
                            <FaUserCheck className="htb-btn-icon" aria-hidden="true" />
                            <span>Assign</span>
                          </button>
                          <button
                            className="htb-btn htb-btn-danger"
                            type="button"
                            onClick={() => handleRemoveFromWaitingList(entry.id)}
                            disabled={waitingRemovingId === entry.id}
                            aria-busy={waitingRemovingId === entry.id}
                          >
                            {waitingRemovingId === entry.id ? (
                              <>
                                <span className="htb-spinner" aria-hidden="true" />
                                <span>Removing…</span>
                              </>
                            ) : (
                              <>
                                <FaTrash className="htb-btn-icon" aria-hidden="true" />
                                <span>Remove</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="htb-notice-panel">
          <div className="htb-notice-panel-text">
            <strong>Table Cards live in Hotel Billing</strong>
            <span>
              Interactive table cards (with booking, edit, clear, and live billing) are now
              available only in Hotel Billing under the Dining section.
            </span>
          </div>
          <button
            className="htb-btn htb-btn-primary"
            type="button"
            onClick={() => {
              window.location.href = "/pos";
            }}
          >
            <FaArrowRight className="htb-btn-icon" aria-hidden="true" />
            <span>Open Hotel Billing</span>
          </button>
        </div>

        <div className="htb-panel">
          <div className="htb-panel-head">
            <div>
              <div className="htb-panel-kicker seater">
                <FaChair aria-hidden="true" /> Seating Capacity
              </div>
              <h2 className="htb-panel-title">Table availability by seater</h2>
              <p className="htb-panel-sub">
                Quick glance at how many tables of each size are available right now.
              </p>
            </div>
          </div>
          <div className="htb-seater-grid">
            {summary.bySeats.map((group) => {
              const total = Math.max(1, group.total);
              const availPct = Math.round((group.empty / total) * 100);
              const occPct = 100 - availPct;
              return (
                <div className="htb-seater-tile" key={group.seats}>
                  <div className="htb-seater-tile-head">
                    <span className="htb-seater-tile-name">{group.seats} Seater</span>
                    <span className="htb-seater-tile-total">
                      <FaTable aria-hidden="true" /> {group.total} total
                    </span>
                  </div>
                  <div className="htb-seater-tile-stats">
                    <span className="htb-seater-pill available">
                      <FaCheckCircle aria-hidden="true" /> {group.empty} avail
                    </span>
                    <span className="htb-seater-pill occupied">
                      <FaChair aria-hidden="true" /> {group.booked} occ
                    </span>
                  </div>
                  <div className="htb-seater-progress" aria-hidden="true">
                    <div
                      className="htb-seater-progress-available"
                      style={{ width: `${availPct}%` }}
                    />
                    <div className="htb-seater-progress-occupied" style={{ width: `${occPct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* === Assign modal ============================================
          Opens when the cashier clicks Assign on a waiting-queue
          entry. Shows the customer's name + party size and a grid of
          available (status:"empty") tables sized to fit. Confirm
          POSTs to /api/hotel/bookings via hotelService.bookTable,
          removes the queue entry, and the existing SSE plumbing
          flips the table to Booked on every device.
       */}
      {assignModalOpen && assigningEntry && (
        <AssignTableModal
          entry={assigningEntry}
          queueLength={waitingQueue.length}
          suitableTables={findSuitableTablesForSeats(assigningEntry.seats)}
          totalAvailable={availableTableCount}
          selectedTableId={assignTableId}
          onSelectTable={setAssignTableId}
          onCancel={handleCloseAssign}
          onConfirm={handleConfirmAssign}
          busy={assignBusy}
        />
      )}
    </Layout>
  );
};

// AssignTableModal — picker for seating a waiting customer.
// Shows the guest summary and a grid of available tables sized
// to fit the party. The parent owns the open/close + selection state
// and persists via hotelService.bookTable.
const AssignTableModal = ({
  entry,
  queueLength,
  suitableTables,
  totalAvailable,
  selectedTableId,
  onSelectTable,
  onCancel,
  onConfirm,
  busy,
}) => {
  const seatFor = Number(entry?.seats || 1);
  const canConfirm = !busy && !!selectedTableId;

  return (
    <div className="htb-assign-backdrop" onClick={busy ? undefined : onCancel}>
      <div
        className="htb-assign-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Assign ${entry.name} to a table`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="htb-assign-header">
          <div>
            <div className="htb-panel-kicker queue">
              <FaUserCheck aria-hidden="true" /> Assign to Table
            </div>
            <h3 className="htb-assign-title">Seat {entry.name}</h3>
            <p className="htb-assign-sub">
              Party of <strong>{entry.seats}</strong>
              {queueLength > 1 ? (
                <>
                  {" · "}
                  <span>
                    {queueLength - 1} other guest{queueLength - 1 === 1 ? "" : "s"} still waiting
                  </span>
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            className="htb-assign-close"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
          >
            <FaTimes aria-hidden="true" />
          </button>
        </header>

        <div className="htb-assign-body">
          {suitableTables.length === 0 ? (
            <div className="htb-assign-empty">
              <div className="htb-assign-empty-icon">
                <FaInfoCircle aria-hidden="true" />
              </div>
              <strong>No matching table available</strong>
              <span>
                No empty table seats at least {seatFor}. Wait for one to clear or add a larger table
                from the floor setup before assigning this guest.
              </span>
              {totalAvailable > 0 ? (
                <small>
                  {totalAvailable} empty table{totalAvailable === 1 ? "" : "s"} on the floor, but
                  none fit a party of {seatFor}.
                </small>
              ) : null}
            </div>
          ) : (
            <>
              <div className="htb-assign-hint">
                Pick an available table sized for the party. Booking is server-authoritative — once
                confirmed the table flips to Booked on every connected device.
              </div>
              <div
                className="htb-assign-tables-grid"
                role="radiogroup"
                aria-label="Available tables"
              >
                {suitableTables.map((table) => {
                  const isSelected = String(selectedTableId) === String(table.id);
                  return (
                    <button
                      key={table.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      className={`htb-assign-table-card ${isSelected ? "is-selected" : ""}`}
                      onClick={() => onSelectTable(String(table.id))}
                      disabled={busy}
                    >
                      <div className="htb-assign-table-head">
                        <span className="htb-assign-table-name">
                          <FaChair aria-hidden="true" /> {table.name}
                        </span>
                        <span className="htb-assign-table-zone">
                          <FaMapMarkerAlt aria-hidden="true" /> {table.zone || "Main"}
                        </span>
                      </div>
                      <div className="htb-assign-table-meta">
                        <span>
                          <FaUsers aria-hidden="true" /> {table.seats} seater
                        </span>
                        <span className="htb-assign-table-fit">
                          {table.seats === seatFor ? "Exact fit" : `Fits party of ${seatFor}`}
                        </span>
                      </div>
                      {isSelected ? (
                        <div className="htb-assign-table-selected-badge">
                          <FaCheckCircle aria-hidden="true" /> Selected
                        </div>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <footer className="htb-assign-footer">
          <button
            type="button"
            className="htb-btn htb-btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            <FaTimes className="htb-btn-icon" aria-hidden="true" />
            <span>Cancel</span>
          </button>
          <button
            type="button"
            className="htb-btn htb-btn-primary"
            onClick={onConfirm}
            disabled={!canConfirm || suitableTables.length === 0}
            aria-busy={busy}
          >
            {busy ? (
              <>
                <span className="htb-spinner" aria-hidden="true" />
                <span>Assigning…</span>
              </>
            ) : (
              <>
                <FaUserCheck className="htb-btn-icon" aria-hidden="true" />
                <span>Confirm Assign</span>
              </>
            )}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default HotelTableBookingPage;
