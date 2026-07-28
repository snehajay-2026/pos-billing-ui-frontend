// HotelModuleAccessPage — Super-Owner-only management page.
//
// Lists every hotel customer (ADMIN role with storeType='hotel') in
// the system and lets the Super Owner toggle their Lodging / Dining
// lock state. Each toggle hits the backend
// (PUT /api/hotel/module-locks/:customerEmail/:module), which stamps
// lockedBy / lockedAt and broadcasts the change. The frontend
// dispatches a `hotelModuleAccessChanged` event so other open tabs
// re-read their lock state without polling.

import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  FaKey,
  FaLock,
  FaLockOpen,
  FaSyncAlt,
  FaBed,
  FaUtensils,
  FaReceipt,
  FaSearch,
  FaUserShield,
  FaExclamationTriangle,
  FaCheckCircle,
} from "react-icons/fa";
import { getAllHotelLocks, setHotelLock } from "../services/hotelModuleAccessService";
import { useUi } from "../context/UiContext";
import "./UserManagement.css"; // reuse the um-* / um-panel styles

const fmtLockMeta = (row) => {
  if (!row || !row.locked) return null;
  const parts = [];
  if (row.lockedBy) parts.push(`Locked by ${row.lockedBy}`);
  if (row.lockedAt) {
    try {
      const d = new Date(row.lockedAt);
      if (!Number.isNaN(d.getTime())) {
        parts.push(`on ${d.toLocaleString()}`);
      }
    } catch {
      /* ignore */
    }
  }
  return parts.length ? parts.join(" · ") : "Locked";
};

const HotelModuleAccessPage = () => {
  const { showToast } = useUi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | locked | unlocked

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAllHotelLocks();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load hotel module access");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onToggle = useCallback(
    async (row, module, nextLocked) => {
      const key = `${row.customerEmail}::${module}`;
      setBusy((prev) => ({ ...prev, [key]: true }));
      try {
        await setHotelLock(row.customerEmail, module, nextLocked);
        // Optimistic local update.
        setRows((prev) =>
          prev.map((r) =>
            r.customerEmail === row.customerEmail
              ? {
                  ...r,
                  [module]: {
                    locked: !!nextLocked,
                    lockedBy: nextLocked ? window.__CURRENT_USER__?.email || "you" : null,
                    lockedAt: nextLocked ? new Date().toISOString() : null,
                  },
                }
              : r
          )
        );
        showToast(
          "success",
          `${module.charAt(0).toUpperCase() + module.slice(1)} ${
            nextLocked ? "locked" : "unlocked"
          } for ${row.customerEmail}`
        );
      } catch (err) {
        showToast("error", err.message || `Failed to ${nextLocked ? "lock" : "unlock"} ${module}`);
      } finally {
        setBusy((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }
    },
    [showToast]
  );

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const haystack = [r.customerEmail, r.name, r.storeId, r.storeType]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filter === "locked") {
        return r.lodging.locked || r.dining.locked || r.liveBill.locked;
      }
      if (filter === "unlocked") {
        return !r.lodging.locked && !r.dining.locked && !r.liveBill.locked;
      }
      return true;
    });
  }, [rows, search, filter]);

  const stats = useMemo(() => {
    return {
      total: rows.length,
      lockedLodging: rows.filter((r) => r.lodging.locked).length,
      lockedDining: rows.filter((r) => r.dining.locked).length,
      lockedLiveBill: rows.filter((r) => r.liveBill.locked).length,
    };
  }, [rows]);

  return (
    <div className="um-page">
      <header className="um-hero">
        <div className="um-hero-text">
          <span className="um-eyebrow">
            <FaKey /> Super Owner · Hotel Module Access
          </span>
          <h2 className="um-hero-title">Hotel Module Access</h2>
          <p className="um-hero-sub">
            Enable or disable the <strong>Lodging</strong>,<strong> Dining</strong>, and{" "}
            <strong>Live Bill</strong>
            modules for each hotel customer independently. Locked modules become inaccessible to
            every user belonging to that customer — Admin, Branch Admin, and Cashier alike.
          </p>
        </div>
        <div className="um-hero-stats">
          <article className="um-kpi um-kpi-blue">
            <div className="um-kpi-icon">
              <FaUserShield />
            </div>
            <div className="um-kpi-meta">
              <span>Hotel customers</span>
              <strong>{stats.total}</strong>
            </div>
          </article>
          <article className="um-kpi um-kpi-amber">
            <div className="um-kpi-icon">
              <FaBed />
            </div>
            <div className="um-kpi-meta">
              <span>Lodging locked</span>
              <strong>{stats.lockedLodging}</strong>
            </div>
          </article>
          <article className="um-kpi um-kpi-violet">
            <div className="um-kpi-icon">
              <FaUtensils />
            </div>
            <div className="um-kpi-meta">
              <span>Dining locked</span>
              <strong>{stats.lockedDining}</strong>
            </div>
          </article>
          <article className="um-kpi um-kpi-rose">
            <div className="um-kpi-icon">
              <FaReceipt />
            </div>
            <div className="um-kpi-meta">
              <span>Live Bill locked</span>
              <strong>{stats.lockedLiveBill}</strong>
            </div>
          </article>
        </div>
      </header>

      <section className="um-panel">
        <div className="um-panel-head">
          <div>
            <h5>
              <FaKey className="um-section-ico" /> Lock / Unlock per customer
            </h5>
            <p>
              All toggles take effect immediately. The Super Owner is exempt from locks and can
              still inspect any customer.
            </p>
          </div>
          <div className="um-panel-actions">
            <button type="button" className="um-btn um-btn-soft" onClick={load} disabled={loading}>
              <FaSyncAlt className={loading ? "um-spin" : ""} /> Refresh
            </button>
          </div>
        </div>

        <div className="um-history-actions" style={{ marginBottom: 12 }}>
          <span className="hl-history-info" style={{ color: "#475569" }}>
            <FaSearch style={{ marginRight: 6 }} />
            <input
              type="text"
              placeholder="Search by customer email, name or storeId…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "6px 10px",
                minWidth: 280,
                fontSize: 14,
              }}
            />
          </span>
          <div className="hl-chip-row" style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}>
            {[
              { key: "all", label: "All" },
              { key: "locked", label: "Any locked" },
              { key: "unlocked", label: "All unlocked" },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`hl-chip ${filter === opt.key ? "is-active" : ""}`}
                onClick={() => setFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="um-message um-message-error">
            <FaExclamationTriangle /> {error}
          </div>
        ) : null}

        <div className="um-history-table-wrap">
          <table className="um-history-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Store / Branch</th>
                <th style={{ width: 200 }}>Lodging</th>
                <th style={{ width: 200 }}>Dining</th>
                <th style={{ width: 200 }}>Live Bill</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 ? (
                <tr className="um-empty-row">
                  <td colSpan="5">Loading…</td>
                </tr>
              ) : filteredRows.length === 0 ? (
                <tr className="um-empty-row">
                  <td colSpan="5">
                    {rows.length === 0
                      ? "No hotel customers yet. Create an ADMIN user with storeType='hotel' from the User Management page."
                      : "No customers match the current filter."}
                  </td>
                </tr>
              ) : (
                filteredRows.map((r) => {
                  const lodgingMeta = fmtLockMeta(r.lodging);
                  const diningMeta = fmtLockMeta(r.dining);
                  const liveBillMeta = fmtLockMeta(r.liveBill);
                  const lodBusy = !!busy[`${r.customerEmail}::lodging`];
                  const dinBusy = !!busy[`${r.customerEmail}::dining`];
                  const lbBusy = !!busy[`${r.customerEmail}::liveBill`];
                  return (
                    <tr key={r.customerEmail}>
                      <td>
                        <div className="um-room-cell">
                          <strong>{r.name || r.customerEmail}</strong>
                          <small style={{ color: "#94a3b8" }}>{r.customerEmail}</small>
                        </div>
                      </td>
                      <td>
                        <div>
                          <strong>{r.storeId || r.storeType || "—"}</strong>
                          <small style={{ color: "#94a3b8" }}>{r.storeType}</small>
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            className={`um-btn ${r.lodging.locked ? "um-btn-danger" : "um-btn-primary"}`}
                            onClick={() => onToggle(r, "lodging", !r.lodging.locked)}
                            disabled={lodBusy}
                            aria-busy={lodBusy}
                            title={r.lodging.locked ? "Click to unlock" : "Click to lock"}
                            style={{ minWidth: 110 }}
                          >
                            {r.lodging.locked ? <FaLock /> : <FaLockOpen />}
                            <span>{r.lodging.locked ? "Locked" : "Unlocked"}</span>
                          </button>
                          {lodgingMeta ? (
                            <small style={{ color: "#dc2626" }}>{lodgingMeta}</small>
                          ) : (
                            <small style={{ color: "#94a3b8" }}>Available</small>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            className={`um-btn ${r.dining.locked ? "um-btn-danger" : "um-btn-primary"}`}
                            onClick={() => onToggle(r, "dining", !r.dining.locked)}
                            disabled={dinBusy}
                            aria-busy={dinBusy}
                            title={r.dining.locked ? "Click to unlock" : "Click to lock"}
                            style={{ minWidth: 110 }}
                          >
                            {r.dining.locked ? <FaLock /> : <FaLockOpen />}
                            <span>{r.dining.locked ? "Locked" : "Unlocked"}</span>
                          </button>
                          {diningMeta ? (
                            <small style={{ color: "#dc2626" }}>{diningMeta}</small>
                          ) : (
                            <small style={{ color: "#94a3b8" }}>Available</small>
                          )}
                        </div>
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button
                            type="button"
                            className={`um-btn ${r.liveBill.locked ? "um-btn-danger" : "um-btn-primary"}`}
                            onClick={() => onToggle(r, "liveBill", !r.liveBill.locked)}
                            disabled={lbBusy}
                            aria-busy={lbBusy}
                            title={r.liveBill.locked ? "Click to unlock" : "Click to lock"}
                            style={{ minWidth: 110 }}
                          >
                            {r.liveBill.locked ? <FaLock /> : <FaLockOpen />}
                            <span>{r.liveBill.locked ? "Locked" : "Unlocked"}</span>
                          </button>
                          {liveBillMeta ? (
                            <small style={{ color: "#dc2626" }}>{liveBillMeta}</small>
                          ) : (
                            <small style={{ color: "#94a3b8" }}>Available</small>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div
          style={{
            marginTop: 14,
            padding: "10px 12px",
            background: "rgba(99, 102, 241, 0.08)",
            borderRadius: 8,
            color: "#3730a3",
            fontSize: 13,
          }}
        >
          <FaCheckCircle style={{ marginRight: 6 }} />
          All modules default to <strong>Unlocked</strong> for every hotel customer. Lock only the
          module the customer has not purchased. Toggles propagate instantly to every open tab.
        </div>
      </section>
    </div>
  );
};

export default HotelModuleAccessPage;
