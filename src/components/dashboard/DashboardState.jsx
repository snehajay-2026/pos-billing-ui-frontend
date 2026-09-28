import React from "react";
import { FaExclamationCircle, FaInbox, FaLock, FaSyncAlt } from "react-icons/fa";
import "./DashboardState.css";

// One component for all four non-content states, so "loading", "empty",
// "failed" and "not allowed" can never drift apart in wording or markup as the
// dashboard grows.
//
// The rule this encodes: an ERROR is never rendered as a zero. A failed request
// that fell through to the empty state would tell a manager "no sales today"
// about a day whose numbers simply never arrived.

const DashboardState = ({ status, error, onRetry, emptyMessage, emptyHint }) => {
  if (status === "loading") {
    return (
      <div className="mm-state" role="status" aria-live="polite">
        <div className="mm-state-spinner" aria-hidden="true" />
        <strong>Loading dashboard…</strong>
        <span>Pulling the latest figures for this period.</span>
      </div>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="mm-state mm-state-forbidden" role="alert">
        <FaLock className="mm-state-icon" aria-hidden="true" />
        <strong>Not available for your role</strong>
        <span>The manager dashboard is limited to store administrators.</span>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="mm-state mm-state-error" role="alert">
        <FaExclamationCircle className="mm-state-icon" aria-hidden="true" />
        <strong>Could not load the dashboard</strong>
        <span>{error || "Something went wrong fetching your figures."}</span>
        {onRetry ? (
          <button type="button" className="mm-state-retry" onClick={onRetry}>
            <FaSyncAlt aria-hidden="true" /> Try again
          </button>
        ) : null}
      </div>
    );
  }

  if (status === "empty") {
    return (
      <div className="mm-state" role="status">
        <FaInbox className="mm-state-icon" aria-hidden="true" />
        <strong>{emptyMessage || "Nothing to show for this period"}</strong>
        <span>{emptyHint || "Try a wider date range."}</span>
      </div>
    );
  }

  return null;
};

export default DashboardState;
