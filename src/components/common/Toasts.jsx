import React from "react";
import { useUi } from "../../context/UiContext";

const Toasts = () => {
  const { toasts = [], removeToast } = useUi();

  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-item toast-${t.type || "info"}`}
          role="status"
          aria-live="polite"
        >
          <div className="toast-body">{t.text}</div>
          <button className="toast-close" onClick={() => removeToast(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

export default Toasts;
