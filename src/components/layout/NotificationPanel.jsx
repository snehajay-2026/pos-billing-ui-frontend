import React from "react";
import {
  FaBoxOpen,
  FaListAlt,
  FaBell,
  FaExclamationCircle,
  FaCheckCircle,
  FaSyncAlt,
  FaArrowRight,
} from "react-icons/fa";
import "./NotificationPanel.css";

const KIND_ICONS = {
  "orders-pending": FaListAlt,
  "orders-in-progress": FaListAlt,
  "orders-ready": FaCheckCircle,
  "orders-open": FaListAlt,
  "stock-out": FaExclamationCircle,
  "stock-low": FaBoxOpen,
};

const formatRelative = (date) => {
  if (!date) return "just now";
  const diff = Math.max(0, Date.now() - new Date(date).getTime());
  const seconds = Math.floor(diff / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return date.toLocaleDateString();
};

const NotificationItem = ({ notification, onPick }) => {
  const Icon = KIND_ICONS[notification.kind] || FaBell;
  return (
    <button
      type="button"
      className={`notification-item tone-${notification.tone}`}
      onClick={() => onPick(notification)}
      role="menuitem"
    >
      <span className="notification-item-mark" aria-hidden="true">
        <Icon />
      </span>
      <span className="notification-item-text">
        <strong>{notification.title}</strong>
        {notification.detail ? <small>{notification.detail}</small> : null}
      </span>
      <span className="notification-item-go" aria-hidden="true">
        <FaArrowRight />
      </span>
    </button>
  );
};

const NotificationPanel = ({ notifications, loading, error, lastFetchedAt, onPick, onRefresh }) => {
  const hasAny = notifications.length > 0;

  return (
    <div className="notification-panel" role="menu" aria-label="Notifications">
      <div className="notification-panel-head">
        <span className="notification-panel-eyebrow">
          <FaBell />
          Notifications
        </span>
        <button
          type="button"
          className="notification-panel-refresh"
          onClick={onRefresh}
          aria-label="Refresh notifications"
          title="Refresh"
          disabled={loading}
        >
          <FaSyncAlt className={loading ? "is-spinning" : ""} />
        </button>
      </div>

      {error ? (
        <div className="notification-panel-error">
          <FaExclamationCircle />
          <span>{error}</span>
        </div>
      ) : null}

      {!error && !hasAny && !loading ? (
        <div className="notification-panel-empty">
          <FaCheckCircle />
          <strong>All caught up</strong>
          <span>Nothing needs your attention right now.</span>
        </div>
      ) : null}

      {!error && hasAny ? (
        <div className="notification-panel-list">
          {notifications.map((notification) => (
            <NotificationItem key={notification.kind} notification={notification} onPick={onPick} />
          ))}
        </div>
      ) : null}

      <div className="notification-panel-foot">
        <span>{hasAny ? `${notifications.length} active` : "No alerts"}</span>
        <span>{lastFetchedAt ? `Updated ${formatRelative(lastFetchedAt)}` : "Updating…"}</span>
      </div>
    </div>
  );
};

export default NotificationPanel;
