import React, { useMemo, useState } from "react";
import {
  FaChair,
  FaUtensils,
  FaUser,
  FaUsers,
  FaMapMarkerAlt,
  FaCalendarAlt,
  FaClock,
  FaEdit,
  FaTrash,
  FaCheckCircle,
  FaHourglassHalf,
  FaCopy,
  FaCheck,
  FaPhoneAlt,
  FaConciergeBell,
  FaShoppingBag,
  FaListUl,
} from "react-icons/fa";
import "./DiningTableCard.css";

const initialsFromName = (name = "") => {
  const cleaned = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!cleaned.length) return "??";
  return cleaned
    .map((w) => w[0])
    .join("")
    .toUpperCase();
};

const formatCheckInTime = (time) => {
  const raw = String(time || "").trim();
  if (!raw) return "";
  if (/am|pm/i.test(raw)) return raw.toUpperCase();
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return raw;
  const hours = Number(match[1]);
  const minutes = match[2];
  if (Number.isNaN(hours)) return raw;
  const normalized = ((hours % 24) + 24) % 24;
  const suffix = normalized >= 12 ? "PM" : "AM";
  const hour12 = normalized % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${minutes} ${suffix}`;
};

const formatCheckInDate = (value) => {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

const ZONE_TONES = {
  main: { bg: "rgba(59, 130, 246, 0.12)", color: "#1d4ed8", border: "rgba(59, 130, 246, 0.22)" },
  window: { bg: "rgba(14, 165, 233, 0.12)", color: "#0369a1", border: "rgba(14, 165, 233, 0.22)" },
  garden: { bg: "rgba(34, 197, 94, 0.14)", color: "#047857", border: "rgba(34, 197, 94, 0.22)" },
  terrace: { bg: "rgba(245, 158, 11, 0.14)", color: "#b45309", border: "rgba(245, 158, 11, 0.22)" },
  private: { bg: "rgba(168, 85, 247, 0.14)", color: "#7c3aed", border: "rgba(168, 85, 247, 0.22)" },
};

const getZoneTone = (zone) =>
  ZONE_TONES[String(zone || "").toLowerCase()] || {
    bg: "rgba(100, 116, 139, 0.12)",
    color: "#475569",
    border: "rgba(100, 116, 139, 0.22)",
  };

const summarizeOrder = (table, getDiningCardSummary) => {
  if (typeof getDiningCardSummary === "function") {
    const result = getDiningCardSummary(table);
    if (result) return result;
  }
  const items = Array.isArray(table?.orderedMenuItems) ? table.orderedMenuItems : [];
  if (items.length) {
    return items
      .filter(Boolean)
      .map((item) => `${Math.max(1, Number(item.qty || 1))}x ${item.name || "Item"}`)
      .join(", ");
  }
  return "";
};

const DiningTableCard = ({
  table,
  isActive = false,
  isSelected = false,
  waitingMatch = null,
  getCardSummary = null,
  onActivate,
  onSelect,
  onBook,
  onEdit,
  onClear,
  onDelete,
  onCopyPhone,
}) => {
  const [copiedPhone, setCopiedPhone] = useState(false);

  const seats = Number(table.seats || 0);
  const partySize = Number(table.partySize || 0);
  const booked = table.status === "booked";
  const selected = isActive || isSelected;
  const zoneTone = getZoneTone(table.zone);

  const partyPct = useMemo(() => {
    if (!seats) return 0;
    return Math.min(100, Math.round((partySize / seats) * 100));
  }, [partySize, seats]);

  const capacityTone = useMemo(() => {
    if (!booked) return "vacant";
    if (partySize === 0) return "light";
    if (partyPct >= 100) return "full";
    if (partyPct >= 70) return "tight";
    return "good";
  }, [booked, partyPct, partySize]);

  const orderSummary = useMemo(
    () => summarizeOrder(table, getCardSummary),
    [table, getCardSummary]
  );

  const checkInDateLabel = formatCheckInDate(table.checkInDate);
  const checkInTimeLabel = formatCheckInTime(table.checkInTime);

  const handleCopy = async (phone) => {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(String(phone));
      setCopiedPhone(true);
      if (onCopyPhone) onCopyPhone(phone);
      setTimeout(() => setCopiedPhone(false), 1400);
    } catch {
      /* clipboard may be unavailable */
    }
  };

  const handleCardClick = () => {
    if (!onActivate) return;
    if (booked || partySize > 0) {
      onActivate(table);
    } else if (onSelect) {
      onSelect(table);
    }
  };

  const handleKey = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleCardClick();
    }
  };

  return (
    <article
      className={`dtc-table ${booked ? "is-booked" : "is-empty"} ${selected ? "is-selected" : ""}`}
      data-zone={String(table.zone || "").toLowerCase()}
      onClick={handleCardClick}
      onKeyDown={handleKey}
      role={booked || partySize > 0 ? "button" : undefined}
      tabIndex={booked || partySize > 0 ? 0 : undefined}
      aria-label={`${table.name}, ${seats} seater, ${booked ? "booked" : "available"}`}
    >
      <span className="dtc-stripe" aria-hidden="true" />

      {/* Selected highlight ring */}
      {selected && <span className="dtc-selected-ring" aria-hidden="true" />}

      {/* Header */}
      <header className="dtc-head">
        <div className="dtc-head-left">
          <span className="dtc-table-name">
            <FaChair /> {table.name}
          </span>
          <span className="dtc-table-meta">
            <span className="dtc-zone-pill" style={zoneTone}>
              <FaMapMarkerAlt /> {table.zone || "Main"}
            </span>
          </span>
        </div>
        <span className={`dtc-status ${booked ? "is-booked" : "is-empty"}`}>
          {booked ? (
            <>
              <FaHourglassHalf /> Booked
            </>
          ) : (
            <>
              <FaCheckCircle /> Available
            </>
          )}
        </span>
      </header>

      {/* Seater scale */}
      <div className="dtc-seater">
        {Array.from({ length: Math.max(0, seats) }).map((_, i) => {
          const seated = booked && i < partySize;
          return (
            <span key={i} className={`dtc-seat ${seated ? "is-seated" : ""}`} aria-hidden="true" />
          );
        })}
        <span className="dtc-seater-label">
          <strong>{seats}</strong> seater
        </span>
      </div>

      {/* Guest / party block */}
      {booked ? (
        <div className="dtc-guest">
          <div className="dtc-avatar" style={{ background: zoneTone.bg, color: zoneTone.color }}>
            {table.guest ? initialsFromName(table.guest) : <FaUser />}
          </div>
          <div className="dtc-guest-meta">
            <strong className="dtc-guest-name">{table.guest || "Guest"}</strong>
            <div className="dtc-guest-sub">
              <span>
                <FaUsers /> {partySize || 1} / {seats}
              </span>
              {table.guestPhone && (
                <button
                  type="button"
                  className="dtc-phone"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(table.guestPhone);
                  }}
                  title="Copy phone"
                >
                  <FaPhoneAlt />
                  <span>{table.guestPhone}</span>
                  {copiedPhone ? <FaCheck /> : <FaCopy />}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="dtc-empty-state">
          <FaConciergeBell />
          <span>Ready for new guests</span>
        </div>
      )}

      {/* Order summary */}
      {booked && (
        <div className="dtc-order">
          <div className="dtc-order-head">
            <FaShoppingBag />
            <span>Current Order</span>
            {partySize > 0 && <span className="dtc-order-count">{partySize} items</span>}
          </div>
          {orderSummary ? (
            <p className="dtc-order-summary">{orderSummary}</p>
          ) : (
            <p className="dtc-order-empty">No items ordered yet</p>
          )}
        </div>
      )}

      {/* Check-in meta */}
      {booked && (checkInDateLabel || checkInTimeLabel) && (
        <div className="dtc-checkin">
          <div className="dtc-checkin-row">
            <FaCalendarAlt />
            <span>Check-in</span>
            <strong>{checkInDateLabel || "—"}</strong>
          </div>
          {checkInTimeLabel && (
            <div className="dtc-checkin-row">
              <FaClock />
              <span>Time</span>
              <strong>{checkInTimeLabel}</strong>
            </div>
          )}
        </div>
      )}

      {/* Capacity bar */}
      <div className="dtc-capacity">
        <div className="dtc-capacity-row">
          <span>
            <FaUsers /> Party
          </span>
          <strong>
            {partySize || 0} / {seats}
          </strong>
        </div>
        <div className="dtc-capacity-track">
          <div
            className={`dtc-capacity-fill dtc-fill-${capacityTone}`}
            style={{ width: `${partyPct}%` }}
          />
        </div>
      </div>

      {/* Suitable for waiting guest (only on empty tables) */}
      {!booked && waitingMatch && (
        <div className="dtc-wait-tag">
          <FaListUl /> Suitable for {waitingMatch} waiting guest
          {waitingMatch > 1 ? "s" : ""}
        </div>
      )}

      {/* Actions */}
      <footer className="dtc-actions" onClick={(e) => e.stopPropagation()}>
        {booked ? (
          <>
            {onEdit && (
              <button
                type="button"
                className="dtc-btn dtc-btn-soft"
                onClick={() => onEdit(table)}
                title="Edit booking"
              >
                <FaEdit /> <span>Edit</span>
              </button>
            )}
            {onClear && (
              <button
                type="button"
                className="dtc-btn dtc-btn-danger"
                onClick={() => onClear(table.id)}
                title="Clear table"
              >
                <FaCheckCircle /> <span>Clear</span>
              </button>
            )}
          </>
        ) : (
          onBook && (
            <button
              type="button"
              className="dtc-btn dtc-btn-primary"
              onClick={() => onBook(table)}
              title="Book this table"
            >
              <FaUtensils /> <span>Book Table</span>
            </button>
          )
        )}
        {onDelete && (
          <button
            type="button"
            className="dtc-btn dtc-btn-ghost"
            onClick={() => onDelete(table.id)}
            title="Delete table"
          >
            <FaTrash /> <span>Delete</span>
          </button>
        )}
      </footer>

      {/* Optional selected ribbon */}
      {selected && <div className="dtc-selected-ribbon">Selected</div>}
    </article>
  );
};

export default DiningTableCard;
