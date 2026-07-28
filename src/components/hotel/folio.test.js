import {
  OVERSTAY_LINE_ID,
  buildFolioLineItems,
  computeOverstayCharge,
  resolveLodgingGstRate,
  syncOverstayIntoBill,
} from "./folio";
import { getStoreSettings } from "../../services/storeSettingsService";

const settings = {
  hotelCheckinTime: "12:00",
  hotelCheckoutTime: "11:00",
  hotelLateCheckoutFeePerHour: 200,
  hotelGst: 12,
};

const occupiedRoom = (overrides = {}) => ({
  status: "occupied",
  checkInDate: "2026-07-14", // check-in yesterday
  nights: 1,
  rate: 1500,
  gst: 12,
  ...overrides,
});

describe("computeOverstayCharge", () => {
  test("returns null for a vacant room", () => {
    expect(
      computeOverstayCharge(
        { status: "vacant", checkInDate: "2026-07-14", nights: 1, rate: 1500, gst: 12 },
        new Date("2026-07-16T12:00:00"),
        settings
      )
    ).toBeNull();
  });

  test("returns null when no rate is configured", () => {
    const now = new Date("2026-07-16T13:00:00"); // past checkout (11:00)
    const result = computeOverstayCharge(occupiedRoom(), now, {
      ...settings,
      hotelLateCheckoutFeePerHour: 0,
    });
    expect(result).toBeNull();
  });

  test("returns null when guest hasn't overstayed yet", () => {
    const now = new Date("2026-07-15T09:00:00"); // before today's 11:00
    expect(computeOverstayCharge(occupiedRoom(), now, settings)).toBeNull();
  });

  test("computes 1 billable hour at the minimum when slightly over", () => {
    // Expected checkout = 2026-07-15 11:00. Now is 11:30 — 30 min over.
    const now = new Date("2026-07-15T11:30:00");
    const result = computeOverstayCharge(occupiedRoom(), now, settings);
    expect(result).not.toBeNull();
    expect(result.minutes).toBe(30);
    expect(result.hours).toBe(1); // min 1
    expect(result.rate).toBe(200);
    expect(result.subtotal).toBe(200);
    expect(result.gstPct).toBe(12);
    expect(result.gstAmount).toBe(24);
    expect(result.total).toBe(224);
  });

  test("rounds up to next whole hour when over by >1h but <2h", () => {
    // Over by 1h 15m → 2 billable hours.
    const now = new Date("2026-07-15T12:15:00");
    const result = computeOverstayCharge(occupiedRoom(), now, settings);
    expect(result.hours).toBe(2);
    expect(result.subtotal).toBe(400);
    expect(result.gstAmount).toBe(48);
    expect(result.total).toBe(448);
  });

  test("respects exact hour boundaries (no rounding up needed)", () => {
    const now = new Date("2026-07-15T14:00:00"); // exactly 3h over
    const result = computeOverstayCharge(occupiedRoom(), now, settings);
    expect(result.hours).toBe(3);
    expect(result.subtotal).toBe(600);
    expect(result.total).toBe(672); // 600 + 12% GST
  });

  test("falls back to settings.hotelGst when room has no gst", () => {
    const now = new Date("2026-07-15T11:30:00");
    const room = occupiedRoom({ gst: null });
    const result = computeOverstayCharge(room, now, { ...settings, hotelGst: 18 });
    expect(result.gstPct).toBe(18);
  });

  test("falls back to 12% when neither room nor settings has GST", () => {
    const now = new Date("2026-07-15T11:30:00");
    const room = occupiedRoom({ gst: null });
    const result = computeOverstayCharge(room, now, {
      hotelLateCheckoutFeePerHour: 200,
    });
    expect(result.gstPct).toBe(12);
  });

  test("falls back to 'today @ settings check-out' when room is missing dates", () => {
    // Graceful degradation: a missing check-in date doesn't return null — the
    // cashier still sees *some* overstay value based on today's standard
    // check-out time. This is the documented behaviour of expectedCheckOut().
    const now = new Date("2026-07-16T12:00:00"); // 1h past 11:00
    const room = occupiedRoom({ checkInDate: null, checkIn: null });
    const result = computeOverstayCharge(room, now, settings);
    expect(result).not.toBeNull();
    expect(result.hours).toBe(1);
    expect(result.minutes).toBe(60);
  });

  test("returns 0 GST when rate is GST-free", () => {
    const now = new Date("2026-07-15T11:30:00");
    const result = computeOverstayCharge(occupiedRoom({ gst: 0 }), now, {
      ...settings,
      hotelGst: 18,
    });
    expect(result.gstPct).toBe(0);
    expect(result.gstAmount).toBe(0);
    expect(result.total).toBe(200);
  });

  // Regression tests for the "14h × ₹200 overstay when entered checkout is 1h
  // after standard" bug. The system should charge only the hours beyond the
  // configured Standard Check-out Time, using the entered checkOutDate +
  // checkOutTime as the actual checkout (not the wall-clock `now`).
  describe("uses entered checkout (checkOutDate + checkOutTime) as actual checkout", () => {
    test("charges only the hours between standard and entered checkout", () => {
      // Check-in 16-07-2026 12:00 PM, 2 nights → expected 18-07 11:00 AM.
      // Entered checkout 18-07-2026 12:00 PM → 1h overstay → ₹200.
      const room = occupiedRoom({
        checkInDate: "2026-07-16",
        nights: 2,
        checkOutDate: "2026-07-18",
        checkOutTime: "12:00",
      });
      // Pick a `now` that would otherwise yield a large overstay — the entered
      // checkout must take precedence over `now`.
      const now = new Date("2026-07-18T01:00:00");
      const result = computeOverstayCharge(room, now, settings);
      expect(result).not.toBeNull();
      expect(result.minutes).toBe(60);
      expect(result.hours).toBe(1);
      expect(result.subtotal).toBe(200);
    });

    test("falls back to wall-clock now when only checkOutDate is set", () => {
      // No checkOutTime → use the wall-clock now for actual checkout.
      // 1h 15m past 11:00 → 2 billable hours.
      const room = occupiedRoom({
        checkInDate: "2026-07-14",
        nights: 1,
        checkOutDate: "2026-07-15",
        checkOutTime: "",
      });
      const now = new Date("2026-07-15T12:15:00");
      const result = computeOverstayCharge(room, now, settings);
      expect(result.hours).toBe(2);
      expect(result.subtotal).toBe(400);
    });

    test("returns null when entered checkout is before expected checkout", () => {
      // Guest entered a checkout time earlier than the standard — no overstay.
      const room = occupiedRoom({
        checkInDate: "2026-07-14",
        nights: 1,
        checkOutDate: "2026-07-15",
        checkOutTime: "10:00",
      });
      const now = new Date("2026-07-15T08:00:00");
      expect(computeOverstayCharge(room, now, settings)).toBeNull();
    });

    test("ignores room.checkOutTime when computing the standard checkout", () => {
      // room.checkOutTime stores the *actual* checkout, not the standard.
      // The standard must come from settings.hotelCheckoutTime (11:00).
      // With nights=1, check-in 14-07, expected = 15-07 11:00.
      // Entered checkout 15-07 12:00 → 1h overstay (NOT 14h to 12:00 if the
      // standard was wrongly read as 12:00 from the room).
      const room = occupiedRoom({
        checkInDate: "2026-07-14",
        nights: 1,
        checkOutTime: "12:00",
        checkOutDate: "2026-07-15",
      });
      const result = computeOverstayCharge(room, new Date("2026-07-15T12:00:00"), settings);
      expect(result.minutes).toBe(60);
      expect(result.hours).toBe(1);
    });
  });
});

// Regression test for the "48h × ₹200 overstay on a fresh 2-night booking"
// bug. Quick Book previously saved the room without `checkOutDate` /
// `checkOutTime`, which made `resolveActualCheckout` fall back to wall-clock
// `now`. A cashier opening the bill any time after standard checkout would
// then see the cumulative `now − expectedCheckout` as overstay hours.
// The fix: Quick Book now auto-fills `checkOutDate`/`checkOutTime` from
// `checkInDate + nights @ standardCheckoutTime`. This test pins down that a
// freshly booked room shows 0h overstay (until the cashier edits the actual
// checkout to be later).
describe("Quick Book auto-fill — overstay locks at 0h at booking time", () => {
  test("a freshly booked 2-night room shows 0 overstay regardless of when the bill is viewed", () => {
    // Booked 16-07 12:00, 2 nights → expected 18-07 11:00. Auto-filled
    // checkOutDate=2026-07-18, checkOutTime=11:00 → actual matches expected
    // → 0h overstay, even when the bill is viewed 48 hours later.
    const room = occupiedRoom({
      checkInDate: "2026-07-16",
      checkInTime: "12:00",
      nights: 2,
      checkOutDate: "2026-07-18",
      checkOutTime: "11:00",
    });
    expect(computeOverstayCharge(room, new Date("2026-07-20T12:00:00"), settings)).toBeNull();
  });

  test("if the guest actually checks out 1h late, overstay is 1h (not 48h)", () => {
    // Cashier edits the actual checkout via Edit Modal to 18-07 12:00.
    // Expected 18-07 11:00 → 1h overstay.
    const room = occupiedRoom({
      checkInDate: "2026-07-16",
      checkInTime: "12:00",
      nights: 2,
      checkOutDate: "2026-07-18",
      checkOutTime: "12:00",
    });
    const result = computeOverstayCharge(room, new Date("2026-07-20T12:00:00"), settings);
    expect(result).not.toBeNull();
    expect(result.minutes).toBe(60);
    expect(result.hours).toBe(1);
    expect(result.subtotal).toBe(200);
  });

  // User-spec regression: total stay duration must NEVER be the basis for
  // overstay. The user's example explicitly states:
  //   Check-in: 16-07-2026 12:00 PM, Nights: 2, Standard Check-out: 11:00 AM,
  //   Actual Check-out: 18-07-2026 12:00 PM
  //   → Total Stay = 48 hours (correct, but irrelevant for overstay)
  //   → Extra Hours = 1 hour (correct: 12 PM − 11 AM)
  //   → Extra Charges = ₹200
  // The wall-clock `now` parameter is irrelevant when both
  // `checkOutDate` and `checkOutTime` are set on the room — those fields
  // are the cashier's intended checkout, not the wall-clock.
  test("user spec example: 2-night booking, 12 PM checkout → 1h overstay, not 48h", () => {
    const room = occupiedRoom({
      checkInDate: "2026-07-16",
      checkInTime: "12:00",
      nights: 2,
      checkOutDate: "2026-07-18",
      checkOutTime: "12:00",
    });
    // Viewed at any time after standard checkout — calculation must use
    // 12:00 PM as actual checkout, not the wall-clock `now`.
    const result = computeOverstayCharge(room, new Date("2026-07-22T15:30:00"), settings);
    expect(result).not.toBeNull();
    expect(result.hours).toBe(1); // NOT 24, NOT 48, NOT 144
    expect(result.subtotal).toBe(200); // NOT 4800, NOT 9600, NOT 28800
    expect(result.minutes).toBe(60);
  });
});

describe("syncOverstayIntoBill", () => {
  test("appends an 'Extra Hours Charges' line when overstaying", () => {
    const result = syncOverstayIntoBill(
      [],
      occupiedRoom(),
      new Date("2026-07-15T12:15:00"), // -> 2 billable hours
      settings
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(OVERSTAY_LINE_ID);
    expect(result[0].name).toBe("Extra Hours Charges");
    expect(result[0].qty).toBe(2);
    expect(result[0].rate).toBe(200);
    expect(result[0].type).toBe("lodging");
    expect(result[0].meta.kind).toBe("late_checkout");
    expect(result[0].meta.hours).toBe(2);
    // `lateMinutes` (the existing field) carries the elapsed minutes so audit
    // surfaces can still read it; the structured `hours`/`rate` fields are
    // what the bill UI renders directly.
    expect(result[0].meta.lateMinutes).toBe(75);
    expect(result[0].meta.rate).toBe(200);
  });

  test("refreshes qty/rate when the overstay duration grows on the next tick", () => {
    const t1 = new Date("2026-07-15T12:15:00"); // 2 billable hours
    const t2 = new Date("2026-07-15T13:15:00"); // 3 billable hours
    const room = occupiedRoom();
    const first = syncOverstayIntoBill([], room, t1, settings);
    const second = syncOverstayIntoBill(first, room, t2, settings);
    // Same array length — the line is updated in place, not duplicated.
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(OVERSTAY_LINE_ID);
    expect(second[0].qty).toBe(3);
    expect(second[0].meta.hours).toBe(3);
  });

  test("respects meta.edited and does not overwrite cashier changes", () => {
    const items = [
      {
        id: OVERSTAY_LINE_ID,
        name: "Extra Hours Charges",
        qty: 99,
        rate: 1,
        total: 99,
        type: "lodging",
        meta: { kind: "late_checkout", edited: true },
      },
    ];
    const result = syncOverstayIntoBill(
      items,
      occupiedRoom(),
      new Date("2026-07-15T12:15:00"),
      settings
    );
    expect(result).toBe(items);
  });
});

describe("buildFolioLineItems — overstay line", () => {
  test("emits an 'Extra Hours Charges' line with hours/rate in meta", () => {
    const lines = buildFolioLineItems(occupiedRoom(), settings, new Date("2026-07-15T12:15:00"));
    const lateLine = lines.find((l) => l.meta?.kind === "late_checkout");
    expect(lateLine).toBeDefined();
    expect(lateLine.name).toBe("Extra Hours Charges");
    expect(lateLine.qty).toBe(2);
    expect(lateLine.rate).toBe(200);
    expect(lateLine.meta.hours).toBe(2);
    expect(lateLine.meta.rate).toBe(200);
  });
});

// Regression test for the "Overstay charges missing everywhere" bug: when no
// store settings have been persisted yet, getStoreSettings() returns the seeded
// fallback. Those fallbacks must include a positive late-checkout rate so
// computeOverstayCharge can produce a value as soon as the user opens the
// Lodging tab.
describe("getStoreSettings fallback — overstay defaults are seeded", () => {
  beforeEach(() => {
    // Reset the module-level cache so each test sees a fresh read.
    jest.resetModules();
  });

  test("default settings include a usable hotel late-checkout rate", () => {
    const settings = getStoreSettings();
    expect(Number(settings.hotelLateCheckoutFeePerHour)).toBeGreaterThan(0);
    expect(settings.hotelCheckinTime).toMatch(/^\d{2}:\d{2}$/);
    expect(settings.hotelCheckoutTime).toMatch(/^\d{2}:\d{2}$/);
  });

  test("computeOverstayCharge produces a value using only the fallback defaults", () => {
    const settings = getStoreSettings();
    const now = new Date("2026-07-15T12:15:00"); // 1h 15m past 11:00 check-out
    const result = computeOverstayCharge(
      { status: "occupied", checkInDate: "2026-07-14", nights: 1, rate: 1500, gst: 12 },
      now,
      settings
    );
    expect(result).not.toBeNull();
    expect(result.rate).toBe(Number(settings.hotelLateCheckoutFeePerHour));
    expect(result.hours).toBe(2);
    expect(result.subtotal).toBe(Number(settings.hotelLateCheckoutFeePerHour) * 2);
  });
});

// Regression tests for the "GST becomes 0 after checkout" bug. The original
// Room Booking GST must be carried forward through the entire checkout flow,
// even when the room record is reset to vacant (which historically zeroed out
// `room.gst`).
describe("resolveLodgingGstRate", () => {
  test("prefers the bill item's snapshot gst over room/settings", () => {
    const item = { meta: { gst: 18 }, gst: 18 };
    const room = { gst: 0 };
    expect(resolveLodgingGstRate(room, item, settings)).toBe(18);
  });

  test("falls back to item.gst when meta.gst is missing", () => {
    const item = { gst: 8 };
    const room = { gst: 0 };
    expect(resolveLodgingGstRate(room, item, settings)).toBe(8);
  });

  test("falls back to room.gst when item has no gst at all", () => {
    const item = { meta: {} };
    const room = { gst: 5 };
    expect(resolveLodgingGstRate(room, item, settings)).toBe(5);
  });

  test("explicit 0 on the room is preserved (do not silently upgrade)", () => {
    // A cashier who booked with GST=0 means "no GST". Don't paper over it.
    const item = { meta: {} };
    const room = { gst: 0 };
    expect(resolveLodgingGstRate(room, item, settings)).toBe(0);
  });

  test("falls back to settings.hotelGst when neither item nor room has gst", () => {
    const item = { meta: {} };
    const room = {};
    expect(resolveLodgingGstRate(room, item, { hotelGst: 12 })).toBe(12);
  });

  test("checkout scenario: room.gst=0 (post-checkout) but item.meta.gst=12", () => {
    // This is the exact scenario from the bug report: after checkout the
    // room is reset to gst=0, but the bill item still carries the GST the
    // cashier chose at booking. The Room Booking line should still show 12%.
    const item = { meta: { roomId: "R201", gst: 12 } };
    const room = { id: "R201", status: "vacant", gst: 0 };
    expect(resolveLodgingGstRate(room, item, settings)).toBe(12);
  });
});
