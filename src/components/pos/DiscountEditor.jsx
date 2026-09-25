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
// Quick presets, when supplied, populate the DRAFT rather than applying.
// Nothing here ever touches the bill on its own — the committed `current`
// discount stays live until the cashier presses Apply, so a mis-click on a
// chip cannot silently discount a sale. The line editor uses this
// uncontrolled; the bill summary drives it with an explicit draft so the
// chips and the numeric input share one state and one Apply.

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
  current, // { type, value } | null  — the COMMITTED discount
  onApply, // (discount | null) => void   — null means "remove"
  onCancel,
  inputMode = "decimal",
  // Optional quick presets. A chip does NOT apply — it populates the same
  // draft the numeric input writes to, so quick and custom share one draft
  // state and one Apply action. The committed `current` discount stays live
  // in the bill until Apply is pressed.
  quickOptions = [],
  // Optional controlled draft, so a caller can drive the editor from outside
  // (the bill summary renders its chips inside the row). When omitted the
  // editor owns its draft internally.
  draft: controlledDraft,
  onDraftChange,
}) => {
  const initialType = current?.type === "flat" ? "flat" : "percent";
  const [localType, setLocalType] = useState(initialType);
  const [localText, setLocalText] = useState(current ? String(current.value) : "");
  const [touched, setTouched] = useState(false);
  const inputRef = useRef(null);

  // Controlled draft: falls back to local state when the caller doesn't
  // supply one, so the line editor can stay uncontrolled.
  const isControlled = controlledDraft !== undefined;
  const type = isControlled ? controlledDraft.type : localType;
  const text = isControlled ? controlledDraft.text : localText;
  const setType = isControlled
    ? (next) => onDraftChange({ ...controlledDraft, type: next })
    : setLocalType;
  const setText = isControlled
    ? (next) => onDraftChange({ ...controlledDraft, text: next })
    : setLocalText;

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

  // A chip fills the draft; it never touches the bill. The cashier still has
  // to press Apply, so a mis-click on 10% can't silently discount a sale.
  const applyQuick = (option, e) => {
    e?.stopPropagation();
    if (isControlled) {
      onDraftChange({ type: option.type, text: String(option.value) });
    } else {
      setLocalType(option.type);
      setLocalText(String(option.value));
    }
    setTouched(false);
  };

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

  // Cancel discards the DRAFT and leaves the committed discount alone. The
  // bill was never touched while typing, so restoring it is just dropping
  // the draft back to whatever is currently applied.
  const cancel = (e) => {
    e?.stopPropagation();
    if (isControlled) {
      onDraftChange({
        type: current?.type === "flat" ? "flat" : "percent",
        text: current ? String(current.value) : "",
      });
    } else {
      setLocalType(initialType);
      setLocalText(current ? String(current.value) : "");
    }
    setTouched(false);
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
            Applied: {current.type === "percent" ? `${current.value}%` : `₹${current.value}`}
          </span>
        )}
      </div>

      {quickOptions.length > 0 && (
        <div className="disc-editor-quick" role="group" aria-label="Quick discounts">
          <span className="disc-editor-quick-label">Quick:</span>
          {quickOptions.map((option) => {
            const isActive = type === option.type && Number(text) === Number(option.value);
            return (
              <button
                key={`${option.type}-${option.value}`}
                type="button"
                className={`disc-quick${isActive ? " is-active" : ""}`}
                onClick={(e) => applyQuick(option, e)}
                title={`Fill the editor with ${option.value}${
                  option.type === "percent" ? "%" : "₹"
                } — press Apply to apply it`}
              >
                {option.type === "percent" ? `${option.value}%` : `₹${option.value}`}
              </button>
            );
          })}
        </div>
      )}

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
