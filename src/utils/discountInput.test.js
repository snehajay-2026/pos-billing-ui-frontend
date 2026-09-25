// src/utils/discountInput.test.js
//
// The rules here MIRROR the server's validateDiscount
// (backend index.js:1766). If the frontend is stricter than the server, the
// cashier is blocked from a value checkout would accept; if it is looser,
// the sale fails at the till with a raw 400 instead of an inline message.
//
// Every "reject" case below corresponds to a line in that function, so a
// change to either side that drifts will fail this file.

import {
  parseDiscountValue,
  validateDiscount,
  toDiscountObject,
  discountLabel,
  MAX_PERCENT,
} from "./discountInput";

describe("parseDiscountValue", () => {
  test("parses numeric strings, including decimals", () => {
    expect(parseDiscountValue("10")).toBe(10);
    expect(parseDiscountValue("7.5")).toBe(7.5);
    expect(parseDiscountValue(0.25)).toBe(0.25);
  });

  test("treats blank / null / non-numeric as null so the editor can prompt", () => {
    expect(parseDiscountValue("")).toBeNull();
    expect(parseDiscountValue("   ")).toBeNull();
    expect(parseDiscountValue(null)).toBeNull();
    expect(parseDiscountValue(undefined)).toBeNull();
    expect(parseDiscountValue("abc")).toBeNull();
    expect(parseDiscountValue("Infinity")).toBeNull();
  });
});

describe("validateDiscount — mirrors the server", () => {
  // --- Accepted: the same values the backend lets through ---

  test("accepts a normal percentage", () => {
    const r = validateDiscount({ type: "percent", value: "10" });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(10);
    expect(r.isZero).toBe(false);
  });

  test("accepts a decimal percentage", () => {
    const r = validateDiscount({ type: "percent", value: "7.5" });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(7.5);
  });

  test("accepts a flat amount", () => {
    const r = validateDiscount({ type: "flat", value: "250" });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(250);
  });

  test("accepts exactly 100% — the server's boundary is inclusive", () => {
    const r = validateDiscount({ type: "percent", value: MAX_PERCENT });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(100);
  });

  test("accepts zero and reports it as an explicit removal, not a stored 0", () => {
    // The server allows value >= 0. We turn 0 into "remove" at the call site
    // rather than writing a meaningless discount object onto the invoice.
    const r = validateDiscount({ type: "percent", value: "0" });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(0);
    expect(r.isZero).toBe(true);
  });

  // --- Rejected: each maps to a specific validateDiscount branch ---

  test("rejects a negative discount", () => {
    const r = validateDiscount({ type: "flat", value: "-5" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/negative/i);
  });

  test("rejects a percentage above 100", () => {
    const r = validateDiscount({ type: "percent", value: "101" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/cannot exceed 100/i);
  });

  test("rejects an empty value", () => {
    const r = validateDiscount({ type: "percent", value: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/enter a discount/i);
  });

  test("rejects non-numeric input", () => {
    const r = validateDiscount({ type: "percent", value: "abc" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/enter a discount/i);
  });

  test("rejects an unknown type", () => {
    const r = validateDiscount({ type: "coupon", value: "10" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/type/i);
  });

  test("rejects a missing type", () => {
    const r = validateDiscount({ value: "10" });
    expect(r.ok).toBe(false);
  });

  // --- The one rule the server cannot enforce (it has no line amounts) ---

  test("warns, but does not reject, when a flat discount exceeds the base", () => {
    // The server has no idea what the line is worth, so it allows this. The
    // POS caps it with Math.min(base, v) in applyDiscount — so this must be
    // a warning, never a hard error, or a legitimate sale would be blocked.
    const r = validateDiscount({ type: "flat", value: "500" }, { base: 200 });
    expect(r.ok).toBe(true);
    expect(r.value).toBe(500);
    expect(r.warning).toMatch(/capped/i);
  });

  test("does not warn when the flat discount is within the base", () => {
    const r = validateDiscount({ type: "flat", value: "150" }, { base: 200 });
    expect(r.ok).toBe(true);
    expect(r.warning).toBeNull();
  });

  test("skips the cap check when no base is supplied", () => {
    const r = validateDiscount({ type: "flat", value: "500" });
    expect(r.ok).toBe(true);
    expect(r.warning).toBeNull();
  });
});

describe("toDiscountObject", () => {
  test("produces exactly the shape the cart, payload and server expect", () => {
    expect(toDiscountObject("percent", 10)).toEqual({ type: "percent", value: 10 });
    expect(toDiscountObject("flat", "25")).toEqual({ type: "flat", value: 25 });
  });

  test("adds no extra keys — validateDiscount rejects unknown fields implicitly", () => {
    // `source: "manual"` is stamped where the checkout payload is built, not
    // here, so this stays a bare { type, value }.
    expect(Object.keys(toDiscountObject("percent", 10)).sort()).toEqual(["type", "value"]);
  });
});

describe("discountLabel", () => {
  test("distinguishes the two discount kinds clearly", () => {
    expect(discountLabel("line")).toBe("Line Discount");
    expect(discountLabel("bill")).toBe("Bill Discount");
  });
});
