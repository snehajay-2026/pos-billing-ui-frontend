// src/components/common/Toasts.test.js
//
// Verifies that the toast container collapses a flood of low-stock events
// into a single summary toast. The hotel dining "Clear Table" flow
// decrements stock for every menu item on the table — when 6 of those items
// cross the low-stock threshold, the user used to see 6 stacked toasts.
// After the fix, all 6 collapse into one "6 items are low on stock" toast
// (plus a separate single-product toast if a later, unrelated alert lands
// outside the batch window).
//
// The project doesn't ship @testing-library/react, so we mount with the
// stock react-dom/test-utils `act` + legacy ReactDOM.render. The legacy
// renderer logs a deprecation warning under React 18 — that's harmless
// for these tests, but we silence it via a one-off console.error filter
// so the test output isn't all warnings.

import React from "react";
// eslint-disable-next-line react/no-deprecated
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { LOW_STOCK_EVENT } from "../../context/DataContext";
import Toasts from "./Toasts";

// Replace the UiContext hook with a controllable stub. The factory must
// not capture out-of-scope variables — only references prefixed `mock`
// survive Babel's Jest hoist guard.
const mockShowToast = jest.fn();
jest.mock("../../context/UiContext", () => ({
  useUi: () => ({
    toasts: [],
    removeToast: jest.fn(),
    showToast: mockShowToast,
  }),
}));

const getShowToast = () => mockShowToast;

const fireLowStock = (productId, productName, stock) => {
  const evt = new CustomEvent(LOW_STOCK_EVENT, {
    detail: { productId, productName, stock },
  });
  window.dispatchEvent(evt);
};

const advanceTimers = (ms) => {
  jest.advanceTimersByTime(ms);
};

describe("Toasts — low-stock event batching", () => {
  let container;
  let showToast;

  beforeEach(() => {
    // Silence React 18 deprecation warnings from the legacy renderer so
    // test output stays focused on assertion failures.
    jest.spyOn(console, "error").mockImplementation(() => {});
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
      // eslint-disable-next-line react/no-deprecated
      ReactDOM.render(<Toasts />, container);
    });
    showToast = getShowToast();
    showToast.mockClear();
  });

  afterEach(() => {
    act(() => {
      // eslint-disable-next-line react/no-deprecated
      ReactDOM.unmountComponentAtNode(container);
    });
    document.body.removeChild(container);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("collapses 6 low-stock events within the batch window into one summary toast", () => {
    // Simulate the dining "Clear Table" flow: 6 menu items all crossing
    // the low-stock threshold at once.
    act(() => {
      fireLowStock("p1", "Idli", 2);
      fireLowStock("p2", "Dosa", 1);
      fireLowStock("p3", "Vada", 3);
      fireLowStock("p4", "Sambar Rice", 2);
      fireLowStock("p5", "Rasam", 1);
      fireLowStock("p6", "Curd Rice", 2);
    });

    // Nothing should fire yet — the batch is still buffering.
    expect(showToast).not.toHaveBeenCalled();

    // Advance just past the batch window.
    act(() => {
      advanceTimers(1600);
    });

    // One summary toast, not six.
    expect(showToast).toHaveBeenCalledTimes(1);
    const [type, text] = showToast.mock.calls[0];
    expect(type).toBe("warning"); // stock > 0 → "low"
    expect(text).toMatch(/6 items are low on stock/);
    expect(text).toContain("Idli");
    expect(text).toContain("Dosa");
    expect(text).toContain("Vada");
    // The first three names should fit; the rest collapse to "+3 more".
    expect(text).toMatch(/\+3 more/);
  });

  test("mix of out-of-stock and low-stock in one batch reports the more urgent (out)", () => {
    act(() => {
      fireLowStock("a1", "Coffee", 0); // out
      fireLowStock("a2", "Tea", 1); // low
      fireLowStock("a3", "Milk", 0); // out
    });
    act(() => {
      advanceTimers(1600);
    });

    expect(showToast).toHaveBeenCalledTimes(1);
    const [type, text] = showToast.mock.calls[0];
    expect(type).toBe("error"); // mixed → error wins
    expect(text).toMatch(/reached reorder point/);
    expect(text).toMatch(/2 out, 1 low/);
  });

  test("an event landing AFTER the batch window fires its own toast", () => {
    act(() => {
      fireLowStock("b1", "Soup", 1);
    });
    act(() => {
      advanceTimers(1600);
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toMatch(/Soup/);
    expect(showToast.mock.calls[0][1]).toMatch(/low on stock/);

    // A later, separate event for a different product must NOT be merged
    // into the previous batch — it's its own alert.
    act(() => {
      fireLowStock("b2", "Salad", 2);
    });
    act(() => {
      advanceTimers(1600);
    });
    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast.mock.calls[1][1]).toMatch(/Salad/);
    expect(showToast.mock.calls[1][1]).toMatch(/low on stock/);
  });

  test("same product twice within the dedupe window does not fire twice", () => {
    act(() => {
      fireLowStock("c1", "Paneer", 2);
    });
    act(() => {
      advanceTimers(1600);
    });
    act(() => {
      fireLowStock("c1", "Paneer", 1); // same product, within LOW_STOCK_DEDUPE_MS
    });
    act(() => {
      advanceTimers(1600);
    });

    // Only the first event cleared the dedupe gate; the second is dropped
    // before it ever enters the batch.
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0][1]).toMatch(/Paneer/);
  });
});
