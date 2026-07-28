import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/layout/Layout";
import { useUi } from "../context/UiContext";
import {
  HOUSEKEEPING_STATES,
  bucketRoomsByHousekeeping,
  getHousekeepingLabel,
  getHousekeepingSwatch,
  getHousekeepingTone,
  isRoomSellable,
  nextHousekeepingState,
  resolveHousekeeping,
} from "../components/hotel/housekeeping";
import hotelService from "../services/hotelService";
import "./HotelHousekeepingPage.css";

const ROOMS_STORAGE_KEY = "hotel_lodging_rooms";
const ROOMS_UPDATED_EVENT = "hotel_lodging_rooms_updated";

const readRooms = () => {
  try {
    const raw = window.localStorage.getItem(ROOMS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeRooms = (rooms) => {
  try {
    window.localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(rooms));
    window.dispatchEvent(new CustomEvent(ROOMS_UPDATED_EVENT, { detail: rooms }));
  } catch {
    /* ignore */
  }
};

const HotelHousekeepingPage = () => {
  const { showToast, activeStore } = useUi();
  const [rooms, setRooms] = useState(() => readRooms());
  const [filterZone, setFilterZone] = useState("All");
  const [filterFloor, setFilterFloor] = useState("All");

  useEffect(() => {
    const onUpdate = () => setRooms(readRooms());
    window.addEventListener(ROOMS_UPDATED_EVENT, onUpdate);
    window.addEventListener("storage", onUpdate);
    return () => {
      window.removeEventListener(ROOMS_UPDATED_EVENT, onUpdate);
      window.removeEventListener("storage", onUpdate);
    };
  }, [activeStore]);

  // Server-first load: fetch rooms from the backend on mount and merge into
  // local state + localStorage. Without this, two devices in the same store
  // could see different housekeeping states.
  useEffect(() => {
    let mounted = true;
    const loadFromServer = async () => {
      try {
        const resp = await hotelService.getRooms();
        if (mounted && Array.isArray(resp) && resp.length > 0) {
          setRooms(resp);
          try {
            window.localStorage.setItem(ROOMS_STORAGE_KEY, JSON.stringify(resp));
            window.dispatchEvent(new CustomEvent(ROOMS_UPDATED_EVENT, { detail: resp }));
          } catch (_) {
            /* quota / private mode */
          }
        }
      } catch (err) {
        // Network error — keep the localStorage seed.
        console.warn("Failed to sync housekeeping rooms from server", err);
      }
    };
    loadFromServer();
    return () => {
      mounted = false;
    };
  }, [activeStore]);

  const zoneOptions = useMemo(() => {
    const zones = new Set();
    rooms.forEach((room) => {
      if (room.zone) zones.add(room.zone);
      if (room.floor != null && room.floor !== "") zones.add(`Floor ${room.floor}`);
    });
    return ["All", ...Array.from(zones).sort()];
  }, [rooms]);

  const filteredRooms = useMemo(() => {
    return rooms.filter((room) => {
      if (filterZone !== "All") {
        if (filterZone.startsWith("Floor ")) {
          const floor = filterZone.replace("Floor ", "");
          if (String(room.floor ?? "") !== floor) return false;
        } else if (room.zone !== filterZone) {
          return false;
        }
      }
      if (filterFloor !== "All" && String(room.floor ?? "") !== filterFloor) return false;
      return true;
    });
  }, [rooms, filterZone, filterFloor]);

  const buckets = useMemo(() => bucketRoomsByHousekeeping(filteredRooms), [filteredRooms]);
  const totals = useMemo(() => {
    const sellable = filteredRooms.filter((room) => isRoomSellable(room)).length;
    const occupied = filteredRooms.filter((room) => room.status === "occupied").length;
    return { total: filteredRooms.length, sellable, occupied };
  }, [filteredRooms]);

  const updateRoom = (roomId, patch) => {
    const next = rooms.map((room) =>
      String(room.id) === String(roomId) ? { ...room, ...patch } : room
    );
    setRooms(next);
    writeRooms(next);
    // Push the housekeeping state change to the server so other devices in
    // the same store see the same room. Fire-and-forget.
    const updated = next.find((r) => String(r.id) === String(roomId));
    if (updated) {
      hotelService.updateRoom(roomId, updated).catch((err) => {
        console.warn("Failed to sync housekeeping change to server", err);
      });
    }
  };

  const advanceRoom = (room) => {
    const current = resolveHousekeeping(room);
    const next = nextHousekeepingState(room);
    updateRoom(room.id, { housekeeping: next });
    showToast(
      "success",
      `${room.name || room.id} moved from ${getHousekeepingLabel({ housekeeping: current })} to ${getHousekeepingLabel({ housekeeping: next })}.`
    );
  };

  const setOutOfOrder = (room) => {
    updateRoom(room.id, { housekeeping: "out_of_order" });
    showToast("info", `${room.name || room.id} marked Out of Order.`);
  };

  const restoreFromOutOfOrder = (room) => {
    updateRoom(room.id, { housekeeping: "dirty" });
    showToast("success", `${room.name || room.id} back in service (dirty).`);
  };

  return (
    <Layout>
      <div className="hotel-hk-page">
        <header className="hotel-hk-header">
          <div>
            <h3 className="hotel-hk-title">Housekeeping Board</h3>
            <p className="hotel-hk-subtitle">
              Track every room from checkout to ready-to-sell. Click a card to advance its state.
            </p>
          </div>
          <div className="hotel-hk-stats">
            <div className="hotel-hk-stat">
              <span>Total</span>
              <strong>{totals.total}</strong>
            </div>
            <div className="hotel-hk-stat sellable">
              <span>Sellable</span>
              <strong>{totals.sellable}</strong>
            </div>
            <div className="hotel-hk-stat occupied">
              <span>Occupied</span>
              <strong>{totals.occupied}</strong>
            </div>
          </div>
        </header>

        <div className="hotel-hk-toolbar">
          <select
            className="form-control"
            value={filterZone}
            onChange={(e) => setFilterZone(e.target.value)}
          >
            {zoneOptions.map((zone) => (
              <option key={zone} value={zone}>
                {zone === "All" ? "All zones & floors" : zone}
              </option>
            ))}
          </select>
          <select
            className="form-control"
            value={filterFloor}
            onChange={(e) => setFilterFloor(e.target.value)}
          >
            <option value="All">All floors</option>
            {Array.from(new Set(rooms.map((r) => r.floor).filter((f) => f != null && f !== "")))
              .sort()
              .map((floor) => (
                <option key={floor} value={String(floor)}>
                  Floor {floor}
                </option>
              ))}
          </select>
        </div>

        <div className="hotel-hk-board">
          {HOUSEKEEPING_STATES.map((state) => {
            const list = buckets[state.value] || [];
            return (
              <section
                key={state.value}
                className={`hotel-hk-column hotel-hk-column-${state.tone}`}
                aria-label={`${state.label} rooms`}
              >
                <header
                  className="hotel-hk-column-head"
                  style={{ borderTopColor: state.swatch, color: state.swatch }}
                >
                  <strong>{state.label}</strong>
                  <span>{list.length}</span>
                </header>
                <div className="hotel-hk-column-body">
                  {list.length === 0 ? (
                    <div className="hotel-hk-empty">No rooms in this state.</div>
                  ) : (
                    list.map((room) => (
                      <article
                        key={room.id}
                        className={`hotel-hk-card tone-${getHousekeepingTone(room)} ${room.status === "occupied" ? "is-occupied" : ""}`}
                        style={{ borderLeftColor: getHousekeepingSwatch(room) }}
                      >
                        <div className="hotel-hk-card-head">
                          <strong>{room.name || room.id}</strong>
                          {room.reservationCode && (
                            <span className="hotel-hk-card-code">{room.reservationCode}</span>
                          )}
                        </div>
                        <div className="hotel-hk-card-meta">
                          {room.status === "occupied" ? (
                            <span className="hotel-hk-tag occupied">
                              Occupied · {room.guest || "Guest"}
                            </span>
                          ) : (
                            <span className="hotel-hk-tag vacant">Vacant</span>
                          )}
                          {room.ac && <span className="hotel-hk-tag">{room.ac}</span>}
                          {room.modern && <span className="hotel-hk-tag">Modern</span>}
                        </div>
                        <div className="hotel-hk-card-actions">
                          {resolveHousekeeping(room) === "out_of_order" ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => restoreFromOutOfOrder(room)}
                            >
                              Back in service
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary"
                              onClick={() => advanceRoom(room)}
                            >
                              →{" "}
                              {getHousekeepingLabel({ housekeeping: nextHousekeepingState(room) })}
                            </button>
                          )}
                          {resolveHousekeeping(room) !== "out_of_order" && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => setOutOfOrder(room)}
                            >
                              OOO
                            </button>
                          )}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </Layout>
  );
};

export default HotelHousekeepingPage;
