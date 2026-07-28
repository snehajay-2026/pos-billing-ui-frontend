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
} from "react-icons/fa";
import "./HotelTableBookingPage.css";
import { useUi } from "../context/UiContext";
import { formatWaitTime, getEstimatedWaitMinutes } from "../utils/diningWaitEstimate";

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
    </Layout>
  );
};

export default HotelTableBookingPage;
