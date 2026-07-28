import React, { useMemo, useState } from "react";
import {
  FaBed,
  FaUser,
  FaUserPlus,
  FaDoorOpen,
  FaSnowflake,
  FaWifi,
  FaTv,
  FaBath,
  FaCrown,
  FaFileInvoice,
  FaUsers,
  FaIdCard,
  FaRupeeSign,
  FaCheckCircle,
  FaBan,
  FaHourglassHalf,
  FaTimes,
  FaExclamationTriangle,
} from "react-icons/fa";
import { computeOverstayCharge } from "./folio";
import { getStoreSettings } from "../../services/storeSettingsService";
import "./FloorRoomCard.css";

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

const formatDate = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
};

const todayKey = () => new Date().toISOString().split("T")[0];

const expectedCheckoutOf = (room) => {
  if (!room) return "";
  if (room.expectedCheckout) return room.expectedCheckout;
  // Older bookings store the date under `checkIn`; newer ones use
  // `checkInDate`. Read whichever is populated.
  const checkInDate = room.checkInDate || room.checkIn;
  if (!checkInDate || !room.nights) return "";
  const d = new Date(checkInDate);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + Number(room.nights || 1));
  return d.toISOString().split("T")[0];
};

const stayProgress = (room) => {
  if (!room || room.status !== "occupied") return 0;
  const checkInDate = room.checkInDate || room.checkIn;
  if (!checkInDate || !room.nights) return 0;
  const start = new Date(checkInDate);
  if (Number.isNaN(start.getTime())) return 0;
  const now = new Date();
  const elapsedDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  const total = Math.max(1, Number(room.nights));
  return Math.min(100, Math.max(0, Math.round((elapsedDays / total) * 100)));
};

const minutesToHm = (mins) => {
  const total = Math.round(Number(mins) || 0);
  if (total <= 0) return "";
  const hours = Math.floor(total / 60);
  const rem = total % 60;
  return rem ? `${hours}h ${rem}m` : `${hours}h`;
};

const FloorRoomCard = ({
  room,
  housekeepingLabel,
  housekeepingTone,
  housekeepingSwatch,
  housekeepingBusy = false,
  sellable = true,
  lateCheckoutMinutes = 0,
  bookingDraft = null, // { roomId, name, members } | null
  onToggleHousekeeping,
  onOpenFolio,
  onBook,
  onBookDraftChange,
  onBookDraftConfirm,
  onBookDraftCancel,
  onNoShow,
  onCopyMobile,
  onSettle,
}) => {
  const [copiedMobile, setCopiedMobile] = useState(false);
  const draftActive = bookingDraft && bookingDraft.roomId === room.id;

  const occupied = room.status === "occupied";
  const progress = useMemo(() => stayProgress(room), [room]);
  const expectedCheckout = useMemo(() => expectedCheckoutOf(room), [room]);
  const dueToday = occupied && expectedCheckout && expectedCheckout === todayKey();
  const overstay =
    occupied && expectedCheckout && new Date(expectedCheckout) < new Date(todayKey());
  // Same shared helper as RoomCard + checkout flow — single source of truth.
  // settings is a cached singleton read inside getStoreSettings(), so we don't
  // need to re-read it on every `room` change — the overstay line below reads
  // the live values itself.
  const settings = useMemo(() => getStoreSettings(), []);
  const overstayCharge = useMemo(
    () => (occupied ? computeOverstayCharge(room, new Date(), settings) : null),
    [room, settings, occupied]
  );

  const handleCopy = async (mobile) => {
    if (!mobile) return;
    try {
      await navigator.clipboard.writeText(String(mobile));
      setCopiedMobile(true);
      if (onCopyMobile) onCopyMobile(mobile);
      setTimeout(() => setCopiedMobile(false), 1400);
    } catch {
      /* ignore */
    }
  };

  const amenityList = [];
  if (room.ac === "AC" || room.ac === true || room.ac === undefined)
    amenityList.push({ icon: <FaSnowflake />, label: "AC" });
  if (room.wifi) amenityList.push({ icon: <FaWifi />, label: "Wi-Fi" });
  if (room.tv) amenityList.push({ icon: <FaTv />, label: "TV" });
  if (room.modern) amenityList.push({ icon: <FaBath />, label: "Modern" });

  const rateINR = Number(room.rate || 0);
  const gstPct = room.gst != null && room.gst !== "" ? Number(room.gst) : null;
  const totalINR = useMemo(() => {
    if (!occupied) return null;
    const nights = Number(room.nights || 1);
    const base = rateINR * nights;
    if (gstPct && gstPct > 0) return base + (base * gstPct) / 100;
    return base;
  }, [occupied, room.nights, rateINR, gstPct]);

  const tone = overstay
    ? "is-overstay"
    : dueToday
      ? "is-due"
      : occupied
        ? "is-occupied"
        : "is-vacant";

  const displayHkLabel = housekeepingLabel || "Clean";
  const displayHkTone = housekeepingTone || "clean";
  const displayHkSwatch = housekeepingSwatch || "#10b981";

  const showCardBookingDraft = !occupied && draftActive && bookingDraft;

  return (
    <article
      className={`fk-room ${tone} ${showCardBookingDraft ? "is-booking" : ""}`}
      data-room-id={room.id}
      style={{ overflow: "visible" }}
    >
      {/* Top color stripe */}
      <span className="fk-stripe" aria-hidden="true" />

      {/* Header */}
      <header className="fk-head">
        <div className="fk-head-left">
          <span className="fk-room-no">{room.name || room.id}</span>
          {room.reservationCode && <span className="fk-res-pill">{room.reservationCode}</span>}
        </div>
        <button
          type="button"
          className={`hk-pill tone-${displayHkTone}`}
          style={{ backgroundColor: displayHkSwatch }}
          onClick={() => onToggleHousekeeping && onToggleHousekeeping(room)}
          disabled={housekeepingBusy}
          aria-busy={housekeepingBusy}
          title="Tap to advance housekeeping state"
        >
          {housekeepingBusy ? <span className="fk-spinner" /> : displayHkLabel}
        </button>
      </header>

      {/* Guest / vacant hero block */}
      {occupied ? (
        <div className="fk-guest">
          <div className="fk-avatar">{initialsFromName(room.guest)}</div>
          <div className="fk-guest-meta">
            <strong className="fk-guest-name">{room.guest || "Guest"}</strong>
            <div className="fk-guest-sub">
              <span>
                <FaUsers /> {room.members || 1} guest
                {Number(room.members || 1) === 1 ? "" : "s"}
              </span>
              {room.customerMobile && (
                <button
                  type="button"
                  className="fk-mobile"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(room.customerMobile);
                  }}
                  title="Click to copy"
                >
                  <span>📞</span>
                  <span>{room.customerMobile}</span>
                  {copiedMobile ? <FaCheckCircle /> : null}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="fk-guest fk-guest-vacant">
          <div className="fk-avatar fk-avatar-vacant">
            <FaBed />
          </div>
          <div className="fk-guest-meta">
            <strong className="fk-guest-name">{sellable ? "Ready to sell" : "Not sellable"}</strong>
            <div className="fk-guest-sub">
              <span>
                <FaBed /> {room.beds || 1} beds · {room.ac || "AC"}
                {room.modern ? " · Modern" : ""}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Stay strip (occupied only) */}
      {occupied && (
        <div className="fk-stay">
          <div className="fk-stay-row">
            <div className="fk-stay-cell">
              <span>Check-in</span>
              <strong>
                <FaDoorOpen /> {formatDate(room.checkInDate || room.checkIn)}
              </strong>
            </div>
            <div className="fk-stay-cell">
              <span>Nights</span>
              <strong>
                <FaBed /> {room.nights || 1}
              </strong>
            </div>
            <div className="fk-stay-cell">
              <span>Check-out</span>
              <strong className={overstay ? "is-overdue" : dueToday ? "is-due-strong" : ""}>
                {formatDate(expectedCheckout)}
              </strong>
            </div>
          </div>
          <div className="fk-progress">
            <div
              className={`fk-progress-fill ${overstay ? "is-overstay" : dueToday ? "is-due" : ""}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <small className="fk-progress-label">
            {progress}% of stay completed
            {lateCheckoutMinutes > 0 && (
              <span className="fk-late-tag">
                <FaHourglassHalf /> Late {minutesToHm(lateCheckoutMinutes)}
              </span>
            )}
          </small>
          {overstayCharge ? (
            <div className="fk-overstay" role="status" aria-live="polite">
              <span className="fk-overstay-icon" aria-hidden="true">
                <FaExclamationTriangle />
              </span>
              <div className="fk-overstay-body">
                <strong>Extra Hours Charges</strong>
                <span className="fk-overstay-line">
                  {overstayCharge.hours}h × ₹{overstayCharge.rate}
                  {overstayCharge.gstPct > 0 ? ` + ${overstayCharge.gstPct}% GST` : ""}={" "}
                  <strong>₹{overstayCharge.total}</strong>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Amenities */}
      <div className="fk-amenities">
        {amenityList.length === 0 ? (
          <span className="fk-amenity-empty">Standard amenities</span>
        ) : (
          amenityList.map((a, i) => (
            <span key={i} className="fk-amenity" title={a.label}>
              {a.icon}
            </span>
          ))
        )}
      </div>

      {/* Rate card (vacant → primary info, occupied → total) */}
      <div className="fk-rate-card">
        {occupied ? (
          <>
            <div className="fk-rate-main">
              <span>
                Stay total ({room.nights || 1} night{Number(room.nights || 1) === 1 ? "" : "s"})
              </span>
              <strong>
                <FaRupeeSign />
                {totalINR ? totalINR.toLocaleString("en-IN") : "—"}
              </strong>
            </div>
            <div className="fk-rate-meta">
              <span className="fk-rate-meta-pill">₹{rateINR.toLocaleString("en-IN")}/night</span>
              {gstPct != null && <span className="fk-rate-meta-pill subtle">GST {gstPct}%</span>}
            </div>
          </>
        ) : (
          <>
            <div className="fk-rate-main">
              <span>Room rate</span>
              <strong>
                <FaRupeeSign />
                {rateINR.toLocaleString("en-IN")}
                <small>/night</small>
              </strong>
            </div>
            <div className="fk-rate-meta">
              {gstPct != null ? (
                <span className="fk-rate-meta-pill">GST {gstPct}%</span>
              ) : (
                <span className="fk-rate-meta-pill subtle">No GST</span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Extras — ID proof + notes for occupied rooms */}
      {occupied && room.idProof?.type && (
        <div className="fk-extras">
          <div className="fk-extra-row">
            <FaIdCard />
            <span>
              <strong>ID:</strong> {room.idProof.type}
              {room.idProof.number ? ` · ${room.idProof.number}` : ""}
            </span>
          </div>
        </div>
      )}

      {/* Actions */}
      <footer className="fk-actions">
        {occupied ? (
          <>
            {onOpenFolio && (
              <button
                type="button"
                className="fk-btn fk-btn-soft"
                onClick={() => onOpenFolio(room)}
                title="Open folio"
              >
                <FaFileInvoice /> <span>Folio</span>
              </button>
            )}
            {onNoShow && (
              <button
                type="button"
                className="fk-btn fk-btn-warn"
                onClick={() => onNoShow(room)}
                title="Mark as no-show"
              >
                <FaBan /> <span>No-Show</span>
              </button>
            )}
            {onSettle && (
              <button
                type="button"
                className="fk-btn fk-btn-success"
                onClick={() => onSettle(room)}
                title="Settle & checkout"
              >
                <FaCheckCircle /> <span>Settle</span>
              </button>
            )}
          </>
        ) : (
          onBook && (
            <button
              type="button"
              className={`fk-btn fk-btn-primary ${draftActive ? "is-active" : ""}`}
              onClick={() => onBook(room)}
              title="Book this vacant room"
            >
              <FaCrown /> <span>{draftActive ? "Booking…" : "Book"}</span>
            </button>
          )
        )}
      </footer>

      {/* Inline "Who is checking in?" draft — only on the room being booked */}
      {!occupied && draftActive && bookingDraft && (
        <div className="fk-book-draft" role="group" aria-label={`Book ${room.name}`}>
          <div className="fk-book-draft-title">
            <FaUserPlus /> Who is checking in?
          </div>
          <div className="fk-book-draft-row">
            <div className="fk-book-field">
              <FaUser />
              <input
                className="fk-book-input"
                autoFocus
                placeholder="Guest name"
                value={bookingDraft.name}
                onChange={(e) =>
                  onBookDraftChange && onBookDraftChange({ ...bookingDraft, name: e.target.value })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onBookDraftConfirm && onBookDraftConfirm(room, bookingDraft);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    onBookDraftCancel && onBookDraftCancel();
                  }
                }}
              />
            </div>
            <div className="fk-book-field">
              <FaUsers />
              <input
                className="fk-book-input"
                type="number"
                min="1"
                max={room.beds || 1}
                placeholder="Members"
                value={bookingDraft.members}
                onChange={(e) =>
                  onBookDraftChange &&
                  onBookDraftChange({
                    ...bookingDraft,
                    members: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onBookDraftConfirm && onBookDraftConfirm(room, bookingDraft);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    onBookDraftCancel && onBookDraftCancel();
                  }
                }}
              />
            </div>
          </div>
          <div className="fk-book-draft-actions">
            <button
              type="button"
              className="fk-btn fk-btn-soft"
              onClick={() => onBookDraftCancel && onBookDraftCancel()}
            >
              Cancel
            </button>
            <button
              type="button"
              className="fk-btn fk-btn-success"
              onClick={() => onBookDraftConfirm && onBookDraftConfirm(room, bookingDraft)}
              disabled={!bookingDraft.name || String(bookingDraft.name).trim().length === 0}
            >
              <FaCheckCircle /> Continue
            </button>
          </div>
        </div>
      )}

      {/* Optional decorative badge when room is flagged "not sellable" */}
      {!occupied && !sellable && (
        <span className="fk-overlay-tag">
          <FaTimes /> Out of order
        </span>
      )}
    </article>
  );
};

export default FloorRoomCard;
