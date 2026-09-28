import React from "react";

// Compact KPI tile. Value is rendered as text with a tabular-nums font so the
// digit columns line up between tiles and don't jitter when an SSE event
// updates one of them.
//
// `tone` is a colour accent only — every tile also carries its own label and
// sub-label, so meaning never depends on colour alone (WCAG 1.4.1).
const KpiTile = ({ label, value, sub, icon, tone = "default", emphasis = false }) => (
  <article className={`mm-kpi mm-kpi-${tone} ${emphasis ? "is-emphasis" : ""}`.trim()}>
    <div className="mm-kpi-head">
      <span className="mm-kpi-label">{label}</span>
      {icon ? (
        <span className="mm-kpi-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
    </div>
    <strong className="mm-kpi-value">{value}</strong>
    {sub ? <span className="mm-kpi-sub">{sub}</span> : null}
  </article>
);

export default KpiTile;
