import React, { useRef } from "react";
import { RANGE_PILLS } from "../../utils/dateRange";

// Horizontal, thumb-scrollable pill row.
//
// The pills overflow a 360px screen by design rather than wrapping onto three
// lines and pushing the KPIs below the fold — this is the one place on the
// screen where horizontal scrolling is genuinely useful, since the alternatives
// are a cramped 3-across grid or a native picker sheet. The row is keyboard
// reachable and announced as a group, and the scroll container is focusable so
// a keyboard user can scroll it with the arrow keys.
const DateRangeFilter = ({ value, onChange, customFrom, customTo, onCustomChange }) => {
  const scrollerRef = useRef(null);

  const isCustom = value === "CUSTOM";

  const handleCustom = (key) => (event) => {
    if (!onCustomChange) return;
    onCustomChange(key, event.target.value);
  };

  return (
    <div className="mm-range" role="group" aria-label="Date range">
      <div
        className="mm-range-scroller"
        ref={scrollerRef}
        tabIndex={0}
        role="radiogroup"
        aria-label="Choose a date range"
      >
        {RANGE_PILLS.map((pill) => (
          <button
            key={pill.key}
            type="button"
            role="radio"
            aria-checked={value === pill.key}
            className={`mm-range-pill ${value === pill.key ? "is-active" : ""}`.trim()}
            onClick={() => onChange(pill.key)}
          >
            {pill.label}
          </button>
        ))}
      </div>

      {isCustom ? (
        <div className="mm-range-custom">
          <label className="mm-range-field">
            <span>From</span>
            <input
              type="date"
              value={customFrom || ""}
              max={customTo || undefined}
              onChange={handleCustom("from")}
            />
          </label>
          <label className="mm-range-field">
            <span>To</span>
            <input
              type="date"
              value={customTo || ""}
              min={customFrom || undefined}
              onChange={handleCustom("to")}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
};

export default DateRangeFilter;
