import React, { useEffect, useRef } from "react";
import { useUi } from "../../context/UiContext";
import { LOW_STOCK_EVENT } from "../../context/DataContext";

// How long between duplicate low-stock toasts for the same product. Prevents
// a single checkout with 8 line items from spamming 8 toasts in 8ms — one is
// plenty until the user does something that changes stock again.
const LOW_STOCK_DEDUPE_MS = 8000;

const Toasts = () => {
  const { toasts = [], removeToast, showToast } = useUi();
  const lastByProductRef = useRef({});

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onLowStock = (e) => {
      const detail = e?.detail || {};
      const productId = detail.productId;
      if (!productId) return;
      const now = Date.now();
      const last = lastByProductRef.current[productId] || 0;
      if (now - last < LOW_STOCK_DEDUPE_MS) return;
      lastByProductRef.current[productId] = now;

      const stock = Number(detail.stock) || 0;
      const out = stock <= 0;
      const verb = out ? "out of stock" : "low on stock";
      showToast(
        out ? "error" : "warning",
        `${detail.productName || "Item"} is ${verb} (${stock} left).`,
        5000
      );
    };
    window.addEventListener(LOW_STOCK_EVENT, onLowStock);
    return () => window.removeEventListener(LOW_STOCK_EVENT, onLowStock);
  }, [showToast]);

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
