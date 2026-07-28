// Pure billing math. Kept dependency-free so it's easy to unit test.
// All inputs accept whatever shape callers pass — defensive `Number()` and
// `|| 0` to handle missing/garbage values without crashing the bill screen.

const toNum = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Compute subtotal (sum of price * qty for each line item).
 * @param {Array<{price: number, qty: number}>} items
 * @returns {number}
 */
export const calcSubTotal = (items) => {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const price = toNum(item?.price);
    const qty = toNum(item?.qty);
    return sum + price * qty;
  }, 0);
};

/**
 * Compute GST total (sum of price * qty * gst% / 100 for each line item).
 * @param {Array<{price: number, qty: number, gst: number}>} items
 * @returns {number}
 */
export const calcGstTotal = (items) => {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const price = toNum(item?.price);
    const qty = toNum(item?.qty);
    const gst = toNum(item?.gst);
    return sum + (price * qty * gst) / 100;
  }, 0);
};

/**
 * Compute the grand total (subtotal + GST).
 * @param {Array} items
 * @returns {number}
 */
export const calcGrandTotal = (items) => {
  return calcSubTotal(items) + calcGstTotal(items);
};

/**
 * Round to 2 decimal places. Uses a tiny epsilon to defend against the
 * classic floating-point edge case where 1.005 * 100 = 100.49999... would
 * otherwise round down to 1.00 instead of 1.01.
 * @param {number} value
 * @returns {number}
 */
export const round2 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  // Math.round((n + Number.EPSILON) * 100) handles the float-drift edge case
  // at half boundaries without affecting normal two-decimal values.
  return Math.round((n + Number.EPSILON) * 100) / 100;
};

/**
 * Format an amount as a currency string ("1,234.50"). Used in invoice messages
 * and receipts. Kept here so the formatting logic is testable.
 * @param {number} value
 * @returns {string}
 */
export const formatCurrency = (value) => {
  const rounded = round2(value);
  return rounded.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
};
