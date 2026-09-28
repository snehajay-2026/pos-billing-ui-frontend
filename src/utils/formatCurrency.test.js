import { formatINR, formatINRWhole, formatINRCompact, formatCount } from "./formatCurrency";

describe("formatCurrency", () => {
  test("formats rupees with en-IN lakh/crore grouping", () => {
    // en-IN groups as 45,280 — the 2,2,3 grouping a manager expects on a
    // receipt. Pinning the locale is the point: the duplicated copies this
    // replaced variously inherited the device locale.
    expect(formatINR(45280)).toBe("₹45,280");
    expect(formatINR(1234567)).toBe("₹12,34,567");
  });

  test("keeps paise when they matter", () => {
    expect(formatINR(45280.5)).toBe("₹45,280.5");
  });

  test("rounds to whole rupees in the whole-number formatters", () => {
    expect(formatINRWhole(45280.6)).toBe("₹45,281");
    expect(formatCount(1234)).toBe("1,234");
  });

  test("returns an em-dash rather than NaN or a misleading zero", () => {
    for (const fn of [formatINR, formatINRWhole, formatINRCompact, formatCount]) {
      expect(fn(undefined)).toBe("—");
      expect(fn(null)).toBe("—");
      expect(fn("")).toBe("—");
      expect(fn(NaN)).toBe("—");
      expect(fn("not-a-number")).toBe("—");
    }
  });

  test("abbreviates only above 100k, so ordinary amounts keep full precision", () => {
    expect(formatINRCompact(45280)).toBe("₹45,280");
    expect(formatINRCompact(45280.6)).toBe("₹45,281");
    expect(formatINRCompact(99999)).toBe("₹99,999");
    expect(formatINRCompact(250000)).toBe("₹2.50L");
    expect(formatINRCompact(15000000)).toBe("₹1.50Cr");
  });

  test("a real zero still prints as zero, unlike a missing value", () => {
    // The distinction the whole dashboard rests on: ₹0 is a measured fact,
    // "—" is that the number was never available.
    expect(formatINR(0)).toBe("₹0");
    expect(formatINRCompact(0)).toBe("₹0");
    expect(formatINR(null)).toBe("—");
  });

  test("abbreviates negative amounts with the sign intact", () => {
    expect(formatINRCompact(-250000)).toBe("-₹2.50L");
  });
});
