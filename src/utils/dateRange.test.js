import {
  RANGE_PILLS,
  buildRange,
  toYmd,
  toApiRange,
  describeRange,
  formatShortDate,
} from "./dateRange";

describe("dateRange", () => {
  // Every assertion builds its own local-time "now" from date parts so the
  // suite never depends on the machine's timezone the way a parsed ISO string
  // would.
  const atLocal = (y, m, d, hh = 12) => {
    const date = new Date(y, m - 1, d, hh, 0, 0, 0);
    jest.useFakeTimers().setSystemTime(date);
    return date;
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  test("exposes the full pill set including Yesterday", () => {
    const keys = RANGE_PILLS.map((p) => p.key);
    expect(keys).toEqual(
      expect.arrayContaining(["TODAY", "YESTERDAY", "WEEK", "MONTH", "YEAR", "CUSTOM"])
    );
  });

  test("TODAY spans local midnight to end of day", () => {
    atLocal(2026, 3, 7, 14);
    const { start, end } = buildRange("TODAY");
    expect(toYmd(start)).toBe("2026-03-07");
    expect(toYmd(end)).toBe("2026-03-07");
    expect(start.getHours()).toBe(0);
  });

  test("YESTERDAY is the day before, not today", () => {
    atLocal(2026, 3, 7, 14);
    expect(toYmd(buildRange("YESTERDAY").start)).toBe("2026-03-06");
    expect(toYmd(buildRange("YESTERDAY").end)).toBe("2026-03-06");
  });

  test("WEEK is the trailing 7 days inclusive", () => {
    atLocal(2026, 3, 7, 14);
    const { start, end } = buildRange("WEEK");
    expect(toYmd(start)).toBe("2026-03-01");
    expect(toYmd(end)).toBe("2026-03-07");
  });

  test("MONTH starts on the 1st", () => {
    atLocal(2026, 3, 7, 14);
    expect(toYmd(buildRange("MONTH").start)).toBe("2026-03-01");
    expect(toYmd(buildRange("MONTH").end)).toBe("2026-03-07");
  });

  test("YEAR starts in January", () => {
    atLocal(2026, 3, 7, 14);
    expect(toYmd(buildRange("YEAR").start)).toBe("2026-01-01");
  });

  test("CUSTOM honours both bounds and clamps a reversed range", () => {
    atLocal(2026, 3, 7, 14);
    expect(toApiRange("CUSTOM", "2026-02-01", "2026-02-28")).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
    // Reversed input must not produce a backwards range.
    const reversed = toApiRange("CUSTOM", "2026-02-28", "2026-02-01");
    expect(reversed.from <= reversed.to).toBe(true);
  });

  test("CUSTOM with no bounds falls back to today rather than invalid dates", () => {
    atLocal(2026, 3, 7, 14);
    expect(toApiRange("CUSTOM", "", "")).toEqual({ from: "2026-03-07", to: "2026-03-07" });
  });

  test("toApiRange emits the inclusive YYYY-MM-DD strings the API expects", () => {
    atLocal(2026, 12, 31, 23);
    // A late-evening local time must not roll back to the previous day.
    expect(toApiRange("TODAY")).toEqual({ from: "2026-12-31", to: "2026-12-31" });
  });

  test("toYmd formats from date parts, not UTC", () => {
    const evening = new Date(2026, 5, 1, 23, 30, 0);
    expect(toYmd(evening)).toBe("2026-06-01");
  });

  test("describeRange names a pill or formats a custom window", () => {
    atLocal(2026, 3, 7, 14);
    expect(describeRange("TODAY")).toBe("Today");
    expect(describeRange("CUSTOM", "2026-02-01", "2026-02-28")).toMatch(/Feb/);
  });

  test("formatShortDate is defensive about malformed input", () => {
    expect(formatShortDate("")).toBe("—");
    expect(formatShortDate("not-a-date")).toBe("not-a-date");
  });
});
