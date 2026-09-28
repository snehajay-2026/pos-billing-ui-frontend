// src/utils/dateRange.js
//
// Shared date-range pills + range builder.
//
// Extracted verbatim from `ServiceAdminDashboard.jsx` so the desktop service
// dashboard and the mobile Manager Dashboard cannot drift apart — every
// dashboard that offers "Today / This Week / …" should read from here rather
// than re-declaring its own. `ServiceAdminDashboard` re-imports these and its
// local copies are gone.
//
// Everything is LOCAL time. The `invoices.date` column is a DATE, and every
// server-side aggregation filters it with inclusive `YYYY-MM-DD` string
// bounds, so the range is emitted as those same inclusive strings by
// `toApiRange` rather than as a pair of Date objects. Constructing bounds from
// date parts (rather than parsing an ISO string, which is parsed as UTC and
// therefore lands on the previous day west of Greenwich) is deliberate.

export const RANGE_PILLS = [
  { key: "TODAY", label: "Today" },
  { key: "YESTERDAY", label: "Yesterday" },
  { key: "WEEK", label: "This Week" },
  { key: "MONTH", label: "This Month" },
  { key: "YEAR", label: "This Year" },
  { key: "CUSTOM", label: "Custom" },
];

// `new Date("2026-02-28")` is parsed as UTC midnight, which is the *previous*
// local day anywhere east of Greenwich — and this app is used from IST, where
// that silently shifted every custom range a day earlier. Parse the parts
// directly so a date the user picked is the date they get.
const parseYmdAsLocal = (ymdString) => {
  const [y, m, d] = String(ymdString).split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
};

// Resolve a pill + optional custom bounds to an inclusive [start, end] window.
export const buildRange = (range, customFrom, customTo) => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (range === "TODAY") {
    start.setHours(0, 0, 0, 0);
  } else if (range === "YESTERDAY") {
    start.setDate(now.getDate() - 1);
    start.setHours(0, 0, 0, 0);
    end.setDate(now.getDate() - 1);
    end.setHours(23, 59, 59, 999);
  } else if (range === "WEEK") {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (range === "MONTH") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (range === "YEAR") {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  } else if (range === "CUSTOM") {
    if (customFrom) start.setTime(parseYmdAsLocal(customFrom).getTime());
    else start.setHours(0, 0, 0, 0);
    if (customTo) {
      const customEnd = parseYmdAsLocal(customTo);
      customEnd.setHours(23, 59, 59, 999);
      end.setTime(customEnd.getTime());
    }
  }

  // A reversed custom range would ask the API for an empty window; collapse it
  // to the later bound so the user sees a single day rather than nothing.
  if (start.getTime() > end.getTime()) start.setTime(end.getTime());

  return { start, end };
};

// Local-time YYYY-MM-DD. `toISOString()` would shift to UTC and can report the
// previous day for an evening local time in IST, so the parts are formatted
// directly instead.
export const toYmd = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
};

// The `{ from, to }` pair every server-side report/dashboard filter expects,
// as inclusive YYYY-MM-DD strings. This is the ONLY shape the API accepts, so
// callers should never hand Date objects to the service layer.
export const toApiRange = (range, customFrom, customTo) => {
  const { start, end } = buildRange(range, customFrom, customTo);
  return { from: toYmd(start), to: toYmd(end) };
};

// Human label for the header, e.g. "Today" or "1 Mar 2026 — 7 Mar 2026".
export const describeRange = (range, customFrom, customTo) => {
  const pill = RANGE_PILLS.find((p) => p.key === range);
  if (range !== "CUSTOM" && pill) return pill.label;
  const { from, to } = toApiRange(range, customFrom, customTo);
  if (from === to) return formatShortDate(from);
  return `${formatShortDate(from)} — ${formatShortDate(to)}`;
};

export const formatShortDate = (ymdString) => {
  if (!ymdString) return "—";
  const [y, m, d] = String(ymdString).split("-").map(Number);
  if (!y || !m || !d) return String(ymdString);
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return String(ymdString);
  return date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
};
