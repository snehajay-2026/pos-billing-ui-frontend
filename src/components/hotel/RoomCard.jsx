import React, { useMemo, useState } from "react";
import {
  FaBed,
  FaUserTie,
  FaDoorOpen,
  FaPhoneAlt,
  FaIdCard,
  FaSnowflake,
  FaWifi,
  FaTv,
  FaBath,
  FaCrown,
  FaRegStickyNote,
  FaFileInvoice,
  FaEdit,
  FaSignOutAlt,
  FaCalendarCheck,
  FaCalendarDay,
  FaUsers,
  FaRupeeSign,
  FaCopy,
  FaCheck,
  FaExclamationTriangle,
} from "react-icons/fa";
import { computeOverstayCharge } from "./folio";
import { getStoreSettings } from "../../services/storeSettingsService";
import "./RoomCard.css";

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

const RoomCard = ({
  room,
  isEditing = false,
  quickEditEnabled = false,
  onQuickBook,
  onQuickEdit,
  onCheckout,
  onOpenFolio,
  onCopyMobile,
}) => {
  const [copiedMobile, setCopiedMobile] = useState(false);

  const occupied = room.status === "occupied";
  const progress = useMemo(() => stayProgress(room), [room]);
  const expectedCheckout = useMemo(() => expectedCheckoutOf(room), [room]);
  const dueToday = occupied && expectedCheckout && expectedCheckout === todayKey();
  const overstay =
    occupied && expectedCheckout && new Date(expectedCheckout) < new Date(todayKey());
  // Auto-computed overstay charge — uses the same helper as the checkout flow
  // so the preview here matches what's added to the bill at settlement.
  // `settings` only needs to refresh when the room identifies change (e.g.
  // active store switch); getStoreSettings() is a cached singleton that reads
  // from module state, so it's effectively stable per room identity.
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
      /* clipboard may be unavailable */
    }
  };

  const amenityList = [];
  if (room.ac === "AC" || room.ac === true)
    amenityList.push({ icon: <FaSnowflake />, label: "AC" });
  if (room.wifi) amenityList.push({ icon: <FaWifi />, label: "Wi-Fi" });
  if (room.tv) amenityList.push({ icon: <FaTv />, label: "TV" });
  if (room.modern) amenityList.push({ icon: <FaBath />, label: "Modern" });

  const rateINR = Number(room.rate || 0);
  const gstPct = room.gst != null && room.gst !== "" ? Number(room.gst) : null;
  // Stay Total is the base room cost only — rate × nights. GST is shown as
  // a separate pill below it ("GST 12%") so it must NOT be baked into the
  // total. Extra Hours Charges are likewise excluded; they appear in their
  // own "Extra Hours Charges" section above and get added at bill time, not
  // here in the card preview.
  const totalINR = useMemo(() => {
    if (!occupied) return null;
    const nights = Number(room.nights || 1);
    return rateINR * nights;
  }, [occupied, room.nights, rateINR]);

  const tone = overstay
    ? "is-overstay"
    : dueToday
      ? "is-due"
      : occupied
        ? "is-occupied"
        : "is-vacant";

  return (
    <article className={`rc-room ${tone}`}>
      {/* Top color stripe */}
      <span className="rc-stripe" aria-hidden="true" />

      {/* Header */}
      <header className="rc-head">
        <div className="rc-head-left">
          <span className="rc-room-no">{room.name || room.id}</span>
          <span className="rc-room-type">{room.type || "Standard"}</span>
        </div>
        <div className="rc-head-right">
          {isEditing && <span className="rc-badge rc-badge-edit">Editing</span>}
          <span className={`rc-pill rc-pill-${occupied ? "occupied" : "vacant"}`}>
            {overstay ? "Overstay" : dueToday ? "Due Today" : occupied ? "Occupied" : "Vacant"}
          </span>
        </div>
      </header>

      {/* Hero — guest or "Available" */}
      {occupied ? (
        <div className="rc-guest">
          <div className="rc-avatar">
            {room.guest ? initialsFromName(room.guest) : <FaUserTie />}
          </div>
          <div className="rc-guest-meta">
            <strong className="rc-guest-name">{room.guest || "Guest"}</strong>
            <div className="rc-guest-sub">
              <span>
                <FaUsers /> {room.members || 1} guest{Number(room.members) === 1 ? "" : "s"}
              </span>
              {room.customerMobile && (
                <button
                  type="button"
                  className="rc-mobile"
                  onClick={() => handleCopy(room.customerMobile)}
                  title="Click to copy"
                >
                  <FaPhoneAlt />
                  <span>{room.customerMobile}</span>
                  {copiedMobile ? <FaCheck /> : <FaCopy />}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="rc-guest rc-guest-vacant">
          <div className="rc-avatar rc-avatar-vacant">
            <FaBed />
          </div>
          <div className="rc-guest-meta">
            <strong className="rc-guest-name">Available for check-in</strong>
            <div className="rc-guest-sub">
              <span>
                <FaCalendarCheck /> Ready when you are
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Stay strip (only when occupied) */}
      {occupied && (
        <div className="rc-stay">
          <div className="rc-stay-row">
            <div className="rc-stay-cell">
              <span>Check-in</span>
              <strong>
                <FaDoorOpen /> {formatDate(room.checkInDate || room.checkIn)}
              </strong>
            </div>
            <div className="rc-stay-cell">
              <span>Nights</span>
              <strong>
                <FaBed /> {room.nights || 1}
              </strong>
            </div>
            <div className="rc-stay-cell">
              <span>Check-out</span>
              <strong className={overstay ? "is-overdue" : dueToday ? "is-due-strong" : ""}>
                <FaCalendarDay /> {formatDate(expectedCheckout)}
              </strong>
            </div>
          </div>
          <div className="rc-progress">
            <div
              className={`rc-progress-fill ${overstay ? "is-overstay" : dueToday ? "is-due" : ""}`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <small className="rc-progress-label">{progress}% of stay completed</small>
          {overstayCharge ? (
            <div className="rc-overstay" role="status" aria-live="polite">
              <span className="rc-overstay-icon" aria-hidden="true">
                <FaExclamationTriangle />
              </span>
              <div className="rc-overstay-body">
                <strong>Extra Hours Charges</strong>
                <span className="rc-overstay-line">
                  {overstayCharge.hours}h × ₹{overstayCharge.rate}
                  {overstayCharge.gstPct > 0 ? ` + ${overstayCharge.gstPct}% GST` : ""}={" "}
                  <strong>₹{overstayCharge.total}</strong>
                </span>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Amenities + capacity */}
      <div className="rc-meta-row">
        <div className="rc-amenities">
          {amenityList.length === 0 ? (
            <span className="rc-amenity-empty">Standard amenities</span>
          ) : (
            amenityList.map((a, i) => (
              <span key={i} className="rc-amenity" title={a.label}>
                {a.icon}
              </span>
            ))
          )}
        </div>
        <div className="rc-beds">
          {Array.from({ length: Math.max(0, Number(room.beds) || 0) }).map((_, i) => (
            <FaBed key={i} />
          ))}
          <span>
            {room.beds || 0} bed{Number(room.beds) === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {/* Rate card */}
      <div className="rc-rate-card">
        <div className="rc-rate-main">
          <span>Room rate</span>
          <strong>
            <FaRupeeSign />
            {rateINR.toLocaleString("en-IN")}
            <small>/night</small>
          </strong>
        </div>
        <div className="rc-rate-meta">
          {gstPct != null ? (
            <span className="rc-rate-meta-pill">GST {gstPct}%</span>
          ) : (
            <span className="rc-rate-meta-pill subtle">No GST</span>
          )}
          {totalINR != null && (
            <span className="rc-rate-total">
              <small>Stay total</small>
              <strong>
                <FaRupeeSign />
                {totalINR.toLocaleString("en-IN")}
              </strong>
            </span>
          )}
        </div>
      </div>

      {/* Optional fields — ID proof, notes */}
      {(room.idProof?.type || room.notes) && (
        <div className="rc-extras">
          {room.idProof?.type && (
            <div className="rc-extra-row">
              <FaIdCard />
              <span>
                <strong>ID:</strong> {room.idProof.type}
                {room.idProof.number ? ` · ${room.idProof.number}` : ""}
              </span>
            </div>
          )}
          {room.notes && (
            <div className="rc-extra-row rc-extra-notes">
              <FaRegStickyNote />
              <span>{room.notes}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <footer className="rc-actions">
        {occupied ? (
          <>
            {onOpenFolio && (
              <button
                type="button"
                className="rc-btn rc-btn-soft"
                onClick={() => onOpenFolio(room)}
                title="Open folio"
              >
                <FaFileInvoice />
                <span>Folio</span>
              </button>
            )}
            {quickEditEnabled && onQuickEdit && (
              <button
                type="button"
                className="rc-btn rc-btn-soft"
                onClick={() => onQuickEdit(room.id)}
                title="Quick edit"
              >
                <FaEdit />
                <span>Edit</span>
              </button>
            )}
            {onCheckout && (
              <button
                type="button"
                className="rc-btn rc-btn-danger"
                onClick={() => onCheckout(room.id)}
                title="Checkout"
              >
                <FaSignOutAlt />
                <span>Checkout</span>
              </button>
            )}
          </>
        ) : (
          onQuickBook && (
            <button
              type="button"
              className="rc-btn rc-btn-primary"
              onClick={() => onQuickBook(room.id)}
              title="Book this room"
            >
              <FaCrown />
              <span>Quick Book</span>
            </button>
          )
        )}
      </footer>
    </article>
  );
};

export default RoomCard;
