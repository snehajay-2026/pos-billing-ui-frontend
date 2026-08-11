import React, { useEffect, useRef } from "react";
import { useUi } from "../../context/UiContext";
import { LOW_STOCK_EVENT } from "../../context/DataContext";

// How long between duplicate low-stock toasts for the same product. Prevents
// a single checkout with 8 line items from spamming 8 toasts in 8ms — one is
// plenty until the user does something that changes stock again.
const LOW_STOCK_DEDUPE_MS = 8000;

// Batch window: when several menu items cross the low-stock threshold in
// quick succession (e.g. the cashier clicks "Clear Table" on a dining
// table that had 6 menu items all approaching their reorder point), we
// collapse the flood into a single summary toast instead of 6 stacked
// ones. Long enough to catch a deliberate batch action, short enough that
// a later truly-low alert still surfaces promptly on its own.
const LOW_STOCK_BATCH_MS = 1500;

const Toasts = () => {
  const { toasts = [], removeToast, showToast } = useUi();
  const lastByProductRef = useRef({});
  const batchRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    // Render a single summary toast for everything that landed inside one
    // batch window. "out of stock" wins over "low on stock" when the batch
    // contains both — out is the more urgent state. Defined inside the
    // effect so it captures the current showToast without needing a ref.
    const flushBatch = (batch) => {
      batchRef.current = null;
      const items = Array.from(batch.items.values());
      if (items.length === 0) return;

      const outItems = items.filter((entry) => entry.stock <= 0);
      const lowItems = items.filter((entry) => entry.stock > 0);

      const sample = (entries) =>
        entries
          .slice(0, 3)
          .map((entry) => entry.productName)
          .join(", ") + (entries.length > 3 ? `, +${entries.length - 3} more` : "");

      if (outItems.length >= 1 && lowItems.length === 0) {
        showToast(
          "error",
          `${outItems.length} item${outItems.length === 1 ? " is" : "s are"} out of stock: ${sample(outItems)}`,
          5000
        );
        return;
      }
      if (lowItems.length >= 1 && outItems.length === 0) {
        showToast(
          "warning",
          `${lowItems.length} item${lowItems.length === 1 ? " is" : "s are"} low on stock: ${sample(lowItems)}`,
          5000
        );
        return;
      }
      // Mixed batch — out wins (most urgent).
      showToast(
        "error",
        `${items.length} item${items.length === 1 ? "" : "s"} reached reorder point (${outItems.length} out, ${lowItems.length} low): ${sample(items)}`,
        5000
      );
    };

    const onLowStock = (e) => {
      const detail = e?.detail || {};
      const productId = detail.productId;
      if (!productId) return;
      const now = Date.now();
      const last = lastByProductRef.current[productId] || 0;
      if (now - last < LOW_STOCK_DEDUPE_MS) return;
      lastByProductRef.current[productId] = now;

      // Buffer this event into the current batch. If no batch is active,
      // start one that flushes after LOW_STOCK_BATCH_MS — every event that
      // lands inside the window merges into the same summary toast.
      const entry = {
        productId,
        productName: detail.productName || "Item",
        stock: Number(detail.stock) || 0,
      };
      const existing = batchRef.current;
      if (!existing) {
        const batch = {
          startedAt: now,
          items: new Map([[productId, entry]]),
          flushTimer: null,
        };
        batch.flushTimer = window.setTimeout(() => flushBatch(batch), LOW_STOCK_BATCH_MS);
        batchRef.current = batch;
      } else {
        existing.items.set(productId, entry);
      }
    };
    window.addEventListener(LOW_STOCK_EVENT, onLowStock);
    return () => {
      window.removeEventListener(LOW_STOCK_EVENT, onLowStock);
      const batch = batchRef.current;
      if (batch && batch.flushTimer) {
        window.clearTimeout(batch.flushTimer);
      }
      batchRef.current = null;
    };
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
