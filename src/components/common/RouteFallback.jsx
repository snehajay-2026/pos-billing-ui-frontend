import React from "react";
import "./RouteFallback.css";

/**
 * Lightweight loading state shown while a lazy-loaded route chunk is being
 * fetched. Intentionally simple — no spinner library, no animation framework.
 * Uses a CSS keyframe pulse so it renders once and animates without JS work.
 */
const RouteFallback = () => (
  <div className="route-fallback" role="status" aria-live="polite">
    <span className="route-fallback-dot" />
    <span className="route-fallback-dot" />
    <span className="route-fallback-dot" />
    <span className="route-fallback-label">Loading…</span>
  </div>
);

export default RouteFallback;
