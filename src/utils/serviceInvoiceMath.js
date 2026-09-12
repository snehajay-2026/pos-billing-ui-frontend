import { round2 } from "./billingMath";

const finiteNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const hasNumber = (value) =>
  value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));

export const clampPercent = (value) => Math.min(100, Math.max(0, finiteNumber(value, 0)));

/**
 * Service catalog lines use hours as their quantity. Older invoices may use
 * qty, qtyKg, units, quantity, or omit a quantity entirely. Keep this order
 * stable so billing, reprints, and public invoices calculate the same amount.
 */
export const getServiceUnits = (item = {}) => {
  const keys = ["hours", "qty", "qtyKg", "units", "quantity"];
  const key = keys.find((candidate) => hasNumber(item[candidate]));
  return key ? finiteNumber(item[key]) : 1;
};

export const getServiceRate = (item = {}) =>
  hasNumber(item.price) ? finiteNumber(item.price) : finiteNumber(item.rate, 0);

export const getServiceGstRate = (item = {}, fallback = 0) =>
  clampPercent(hasNumber(item.gst) ? item.gst : fallback);

export const getServiceLine = (item = {}, index = 0, billGstRate = null) => {
  const units = getServiceUnits(item);
  const rate = getServiceRate(item);
  const taxableAmount = round2(units * rate);
  const gstRate = billGstRate == null ? getServiceGstRate(item) : clampPercent(billGstRate);
  return {
    ...item,
    key: item.id ?? `${index}`,
    description: item.serviceDescription || item.name || "Service",
    hsn: item.hsn || item.hsnSac || item.sac || "",
    units,
    rate,
    gstRate,
    taxableAmount,
    taxAmount: round2((taxableAmount * gstRate) / 100),
    amount: taxableAmount,
  };
};

export const calculateServiceTotals = (items, gstRate = 0, discountPct = 0) => {
  const safeItems = Array.isArray(items) ? items : [];
  const safeGstRate = clampPercent(gstRate);
  const safeDiscountPct = clampPercent(discountPct);
  const lines = safeItems.map((item, index) => getServiceLine(item, index, safeGstRate));
  const subTotal = round2(lines.reduce((sum, line) => sum + line.taxableAmount, 0));
  const gstTotal = round2((subTotal * safeGstRate) / 100);
  // Preserve the existing Service Billing policy: discount applies after GST.
  const discountAmt = round2(((subTotal + gstTotal) * safeDiscountPct) / 100);
  const grandTotal = round2(Math.max(0, subTotal + gstTotal - discountAmt));
  return {
    lines,
    subTotal,
    gstRate: safeGstRate,
    gstTotal,
    discountPct: safeDiscountPct,
    discountAmt,
    taxableAfterDiscount: round2(Math.max(0, subTotal - discountAmt)),
    grandTotal,
  };
};

const firstFinite = (...values) => values.find((value) => hasNumber(value));

/**
 * Resolve a renderer view-model without changing saved historical totals.
 * Populated invoice columns win, including a legitimate zero grand total.
 */
export const resolvePersistedServiceTotals = (invoice = {}) => {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const firstMeta = items.find((item) => item?.meta)?.meta || {};
  const inferredRate = firstFinite(
    invoice.gstRate,
    firstMeta.gstRate,
    invoice.subTotal && invoice.gstTotal
      ? (Number(invoice.gstTotal) / Number(invoice.subTotal)) * 100
      : null,
    items.find((item) => hasNumber(item?.gst))?.gst,
    0
  );
  const discountObject = invoice.discount || {};
  const discountBreakdown = invoice.discountBreakdown || {};
  const discountPct = firstFinite(
    invoice.discountPct,
    firstMeta.discountPct,
    discountObject.value,
    0
  );
  const calculated = calculateServiceTotals(items, inferredRate, discountPct);
  const subTotal = hasNumber(invoice.subTotal) ? round2(invoice.subTotal) : calculated.subTotal;
  const gstTotal = hasNumber(invoice.gstTotal) ? round2(invoice.gstTotal) : calculated.gstTotal;
  const savedGrandTotal = firstFinite(invoice.grandTotal, invoice.grand_total);
  const grandTotal =
    savedGrandTotal !== undefined ? round2(savedGrandTotal) : calculated.grandTotal;
  const explicitDiscount = firstFinite(
    invoice.discountAmt,
    firstMeta.discountAmt,
    discountBreakdown.bill,
    discountBreakdown.amount
  );
  const discountAmt =
    explicitDiscount !== undefined
      ? round2(Math.max(0, explicitDiscount))
      : round2(Math.max(0, subTotal + gstTotal - grandTotal));

  return {
    ...calculated,
    lines: items.map((item, index) => getServiceLine(item, index, inferredRate)),
    subTotal,
    gstRate: clampPercent(inferredRate),
    gstTotal,
    discountPct: clampPercent(discountPct),
    discountAmt,
    taxableAfterDiscount: round2(Math.max(0, subTotal - discountAmt)),
    grandTotal,
  };
};

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

const twoDigitsToWords = (value) =>
  value < 20
    ? ONES[value]
    : `${TENS[Math.floor(value / 10)]}${value % 10 ? ` ${ONES[value % 10]}` : ""}`;

const threeDigitsToWords = (value) => {
  const hundreds = Math.floor(value / 100);
  const remainder = value % 100;
  return `${hundreds ? `${ONES[hundreds]} Hundred` : ""}${remainder ? `${hundreds ? " " : ""}${twoDigitsToWords(remainder)}` : ""}`;
};

export const numberToWordsIndian = (value) => {
  const amount = Math.abs(finiteNumber(value));
  const whole = Math.floor(amount);
  const paise = Math.round((amount - whole) * 100);
  if (whole === 0 && paise === 0) return "Rupees Zero Only";
  const crore = Math.floor(whole / 10000000);
  const lakh = Math.floor((whole % 10000000) / 100000);
  const thousand = Math.floor((whole % 100000) / 1000);
  const rest = whole % 1000;
  const parts = [];
  if (crore) parts.push(`${threeDigitsToWords(crore)} Crore`);
  if (lakh) parts.push(`${threeDigitsToWords(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigitsToWords(thousand)} Thousand`);
  if (rest) parts.push(threeDigitsToWords(rest));
  let words = `Rupees ${parts.join(" ") || "Zero"}`;
  if (paise) words += ` and ${twoDigitsToWords(paise)} Paise`;
  return `${words} Only`;
};

export const resolveTaxSplit = (taxAmount, rate, customerState, storeState) => {
  const amount = round2(taxAmount);
  const effectiveRate = clampPercent(rate);
  const normalize = (value) =>
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  const customer = normalize(customerState);
  const store = normalize(storeState);
  const interState = Boolean(customer && store && customer !== store);
  if (interState) return [{ label: "IGST", rate: effectiveRate, amount }];
  const cgst = round2(amount / 2);
  return [
    { label: "CGST", rate: round2(effectiveRate / 2), amount: cgst },
    { label: "SGST", rate: round2(effectiveRate / 2), amount: round2(amount - cgst) },
  ];
};
