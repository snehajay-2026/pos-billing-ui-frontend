// DiscountEditor — shared manual discount input for Retail POS.
//
// Used by BOTH the line editor and the bill editor so the validation,
// keyboard handling, live amount preview, and Apply/Cancel semantics are
// written once. The two differ only in `label`, `base`, and what `onApply`
// does with the result.
//
// Rules come from utils/discountInput, which mirrors the server's
// validateDiscount (backend index.js:1766) exactly. Nothing here
// recalculates GST, subtotal, or the grand total — the editor only reports
// the discount amount, and the existing POS calculation picks it up from
// cart state.
//
// The quick chips are intentionally NOT part of this component. They already
// exist in both call sites, apply instantly on click, and the brief asks that
// they be kept — so they stay where they are and this sits beside them.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { FaCheck, FaTimes } from "react-icons/fa";
import { validateDiscount, toDiscountObject, discountLabel } from "../../utils/discountInput";

const fmt2 = (n) => (Number(n) || 0).toFixed(2);

// Mirrors applyDiscount() in POSBilling so the live preview shows exactly
// what the summary will show. Flat is capped at the base, matching
// Math.min(base, v) there — this is a PREVIEW of the same rule, not a
// second one.
const previewAmount = (base, type, value) => {
  const b = Number(base) || 0;
  if (type === "percent") return Math.min(b, (b * value) / 100);
  return Math.min(b, value);
};

const DiscountEditor = ({
  label,
  base,
  current, // { type, value } | null
  onApply, // (discount | null) => void   — null means "remove"
  onCancel,
  inputMode = "decimal",
}) => {
  const initialType = current?.type === "flat" ? "flat" : "percent";
  const [type, setType] = useState(initialType);
  const [text, setText] = useState(current ? String(current.value) : "");
  const [touched, setTouched] = useState(false);
  const inputRef = useRef(null);

  // Focus + select on open so the cashier can retype over the old value.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const parsed = validateDiscount({ type, value: text }, { base });

  // Live preview: what this discount is worth against `base`. Only shown
  // once the input is valid, so a half-typed "1." never shows a bogus amount.
  const preview = useMemo(() => {
    if (!parsed.ok || parsed.isZero) return null;
    return previewAmount(base, type, parsed.value);
  }, [parsed, base, type]);

  const submit = (e) => {
    e?.stopPropagation();
    e?.preventDefault(); // Enter must never submit the payment form
    if (!parsed.ok) {
      setTouched(true);
      return;
    }
    // A zero discount is an explicit removal rather than a stored {0},
    // so the invoice line does not carry a meaningless discount object.
    onApply(parsed.isZero ? null : toDiscountObject(type, parsed.value));
  };

  const cancel = (e) => {
    e?.stopPropagation();
    onCancel?.();
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      submit(e);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel(e);
    }
  };

  const showError = touched && !parsed.ok;

  return (
    <div
      className="disc-editor"
      onClick={(e) => e.stopPropagation()}
      role="group"
      aria-label={discountLabel(label)}
    >
      <div className="disc-editor-head">
        <span className="disc-editor-label">{discountLabel(label)}</span>
        {current && (
          <span className="disc-editor-current">
            Current: {current.type === "percent" ? `${current.value}%` : `₹${current.value}`}
          </span>
        )}
      </div>

      <div className="disc-editor-row">
        <div className="disc-editor-modes" role="radiogroup" aria-label="Discount type">
          <button
            type="button"
            role="radio"
            aria-checked={type === "percent"}
            className={`disc-mode${type === "percent" ? " is-active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setType("percent");
              setTouched(false);
            }}
          >
            %
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={type === "flat"}
            className={`disc-mode${type === "flat" ? " is-active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              setType("flat");
              setTouched(false);
            }}
          >
            Flat ₹
          </button>
        </div>

        <input
          ref={inputRef}
          type="number"
          inputMode={inputMode}
          min="0"
          step="any"
          className={`disc-input${showError ? " is-invalid" : ""}`}
          placeholder={type === "percent" ? "e.g. 10" : "e.g. 20"}
          value={text}
          aria-label={`${discountLabel(label)} value`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="disc-editor-preview" aria-live="polite">
        {showError && <span className="disc-editor-error">{parsed.error}</span>}
        {!showError && preview != null && (
          <span className="disc-editor-amount">
            Discount Amount: <strong>₹{fmt2(preview)}</strong>
          </span>
        )}
        {!showError && preview == null && !parsed.isZero && text.trim() === "" && (
          <span className="disc-editor-hint">Enter a value to see the amount</span>
        )}
        {!showError && parsed.warning && (
          <span className="disc-editor-warning">{parsed.warning}</span>
        )}
      </div>

      <div className="disc-editor-actions">
        {current && (
          <button
            type="button"
            className="disc-btn disc-btn-remove"
            onClick={(e) => {
              e.stopPropagation();
              onApply(null);
            }}
          >
            <FaTimes /> Remove
          </button>
        )}
        <span className="disc-editor-spacer" />
        <button type="button" className="disc-btn disc-btn-cancel" onClick={cancel}>
          Cancel
        </button>
        <button
          type="button"
          className="disc-btn disc-btn-apply"
          onClick={submit}
          disabled={!parsed.ok}
        >
          <FaCheck /> Apply
        </button>
      </div>
    </div>
  );
};

export default DiscountEditor;
