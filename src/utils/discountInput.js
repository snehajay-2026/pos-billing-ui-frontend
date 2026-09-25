// discountInput.js — validation for the POS manual discount editors.
//
// The rules here MIRROR the server's `validateDiscount`
// (backend index.js:1766) exactly. That function is authoritative: it runs
// on both the bill discount and every per-line discount at checkout, and a
// 400 from it aborts the sale. If the frontend were stricter the cashier
// would be blocked from a value the server accepts; if it were looser, the
// request would fail at the till with a raw error instead of inline.
//
// Server rules, verbatim:
//   - value must be a finite number
//   - value cannot be negative
//   - percent cannot exceed 100
//   - type must be "percent" or "flat"
//
// The one rule that is NOT in the backend is the flat-vs-base cap, because
// the server does not know each line's amount. `applyDiscount` in POSBilling
// already clamps with Math.min(base, v), so a flat discount larger than the
// line silently becomes the line value. This module surfaces that as a
// warning rather than inventing a different clamp.
//
// Pure functions only — no React, no store access, no DOM — so the rules are
// unit-testable without a component harness.

export const DISCOUNT_TYPES = ["percent", "flat"];

export const MAX_PERCENT = 100;

// Normalise whatever the number input produced. An empty field, a stray
// decimal point, or "e" all arrive as "" / NaN / garbage depending on the
// browser, so everything funnels through here.
export const parseDiscountValue = (raw) => {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// validateDiscount(input, { base }) -> { ok, value, error, warning }
//
// `input` is { type, value } where type is "percent" | "flat".
// `base` is the amount the discount applies to — used only to warn when a
// flat discount exceeds it. It is optional; without it the cap is skipped
// exactly as the server skips it.
export const validateDiscount = (input, { base = null } = {}) => {
  const type = String(input?.type || "").trim();

  if (!DISCOUNT_TYPES.includes(type)) {
    return { ok: false, error: "Choose a discount type" };
  }

  const value = parseDiscountValue(input?.value);

  if (value === null) {
    return { ok: false, error: "Enter a discount amount" };
  }
  if (value < 0) {
    return { ok: false, error: "Discount cannot be negative" };
  }
  if (type === "percent" && value > MAX_PERCENT) {
    return { ok: false, error: "Percentage cannot exceed 100" };
  }

  // A zero discount is legal (the backend allows value >= 0) and means
  // "no discount" — the caller turns it into an explicit removal rather
  // than writing a redundant { type, value: 0 } to the invoice.
  if (value === 0) {
    return { ok: true, value: 0, error: null, warning: null, isZero: true };
  }

  let warning = null;
  if (type === "flat" && base != null && value > base) {
    warning = `Discount is capped at the line amount (₹${Number(base).toFixed(2)})`;
  }

  return { ok: true, value, error: null, warning, isZero: false };
};

// The exact discount object shape the cart, the checkout payload, and the
// server's validateDiscount all expect: { type, value }. Nothing else is
// added here — `source: "manual"` is stamped where the payload is built.
export const toDiscountObject = (type, value) => ({
  type: String(type),
  value: Number(value),
});

// Human label for the compact editor header, e.g. "Line Discount".
export const discountLabel = (kind) => (kind === "bill" ? "Bill Discount" : "Line Discount");
