import React, { useEffect, useRef, useState } from "react";

const KpiCard = ({ title, value, icon, animate }) => {
  const [displayValue, setDisplayValue] = useState(animate ? 0 : value);
  const ref = useRef();

  useEffect(() => {
    if (!animate) return setDisplayValue(value);
    let start = 0;
    let end = typeof value === "number" ? value : parseFloat((value + "").replace(/[^\d.-]/g, ""));
    if (isNaN(end)) end = 0;
    const duration = 900;
    const step = (timestamp) => {
      if (!ref.current) return;
      if (!ref.current.startTime) ref.current.startTime = timestamp;
      const progress = Math.min((timestamp - ref.current.startTime) / duration, 1);
      const current = start + (end - start) * progress;
      setDisplayValue(
        typeof value === "number"
          ? current.toLocaleString(undefined, { maximumFractionDigits: 2 })
          : value.replace(
              /([\d,.]+)/,
              current.toLocaleString(undefined, { maximumFractionDigits: 2 })
            )
      );
      if (progress < 1) requestAnimationFrame(step);
    };
    ref.current = { startTime: null };
    requestAnimationFrame(step);
    return () => {
      ref.current = null;
    };
  }, [value, animate]);

  return (
    <div className="kpi-card-pro">
      <div className="kpi-icon">{icon}</div>
      <div className="kpi-title">{title}</div>
      <div className="kpi-value">{displayValue}</div>
    </div>
  );
};

export default KpiCard;
