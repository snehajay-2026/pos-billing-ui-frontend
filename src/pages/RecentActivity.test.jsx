import React from "react";
// eslint-disable-next-line react/no-deprecated
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";

// Mock the navigation hook.
const mockNavigate = jest.fn();
jest.mock("react-router-dom", () => {
  const actual = jest.requireActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});

// Stub the user context — the page doesn't read auth directly, but the
// Layout shell does; mocking it keeps the test self-contained.
jest.mock("../utils/auth", () => ({
  getUser: () => ({ email: "admin@example.com", role: "SUPER_OWNER" }),
  getActiveStoreContext: () => ({ storeType: "service", storeId: "A" }),
}));

// Stub the Layout shell — the page composes inside it.
jest.mock("../components/layout/Layout", () => {
  function LayoutMock({ children }) {
    return <>{children}</>;
  }
  return LayoutMock;
});

// Audit-log service stubs.
const mockGetAuditLog = jest.fn();
const mockExportAuditLogCsv = jest.fn(() => Promise.resolve("audit-log-test.csv"));
jest.mock("../services/auditLogService", () => ({
  getAuditLog: (...args) => mockGetAuditLog(...args),
  exportAuditLogCsv: (...args) => mockExportAuditLogCsv(...args),
}));

// Realtime SSE bridge — record subscribers + emit helpers.
// We define a jest.fn() and set its implementation in beforeEach so
// the closure over `mockRealtimeSubscribers` is set up after the
// jest.mock hoisting pass (the factory pattern can't capture this
// scope reliably across the babel + react-scripts jest setup).
const mockRealtimeSubscribers = [];
const mockOnRealtimeSyncEvent = jest.fn();
jest.mock("../services/realtimeSync", () => ({
  onRealtimeSyncEvent: (...args) => mockOnRealtimeSyncEvent(...args),
}));

import RecentActivity from "./RecentActivity";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const sampleRow = {
  id: "101",
  at: "2026-09-22T10:00:00.000Z",
  userEmail: "admin@example.com",
  userRole: "SUPER_OWNER",
  storeType: "service",
  storeId: "A",
  resource: "services",
  resourceId: "9",
  action: "service.rate_changed",
  method: "PUT",
  path: "/api/services/9",
  ip: "127.0.0.1",
  userAgent: "jest",
  statusCode: 200,
  ok: true,
  body: {
    serviceName: "Plumbing",
    fields: [
      { key: "rate", from: 100, to: 150 },
      { key: "gst", from: 18, to: 18 },
    ],
    before: { rate: 100, gst: 18 },
    after: { rate: 150, gst: 18 },
  },
  errorMessage: null,
};

const sampleRow2 = {
  id: "100",
  at: "2026-09-21T09:00:00.000Z",
  userEmail: "cashier@example.com",
  userRole: "CASHIER",
  storeType: "service",
  storeId: "A",
  resource: "invoices",
  resourceId: "INV-44",
  action: "invoice.created",
  method: "POST",
  path: "/api/invoices/checkout",
  ip: "10.0.0.2",
  statusCode: 201,
  ok: true,
  body: { invoiceNo: "INV-44", total: 950 },
  errorMessage: null,
};

const renderPage = (container) => {
  act(() => {
    // eslint-disable-next-line react/no-deprecated
    ReactDOM.render(<RecentActivity />, container);
  });
};

const unmount = (container) => {
  act(() => {
    // eslint-disable-next-line react/no-deprecated
    ReactDOM.unmountComponentAtNode(container);
  });
};

beforeEach(() => {
  mockNavigate.mockReset();
  mockGetAuditLog.mockReset();
  mockExportAuditLogCsv.mockReset();
  mockRealtimeSubscribers.length = 0;
  mockOnRealtimeSyncEvent.mockReset();
  mockOnRealtimeSyncEvent.mockImplementation((handler) => {
    mockRealtimeSubscribers.push(handler);
    return () => {
      const i = mockRealtimeSubscribers.indexOf(handler);
      if (i >= 0) mockRealtimeSubscribers.splice(i, 1);
    };
  });
  if (typeof window === "undefined") global.window = {};
  if (!window.dispatchEvent || jest.isMockFunction(window.dispatchEvent) === false) {
    window.dispatchEvent = jest.fn();
  } else {
    window.dispatchEvent.mockClear && window.dispatchEvent.mockClear();
  }
});

describe("RecentActivity", () => {
  test("renders skeleton rows while the initial page loads", async () => {
    const pending = deferred();
    mockGetAuditLog.mockReturnValue(pending.promise);
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderPage(container);

    // Skeletons appear immediately.
    const skeletons = container.querySelectorAll(".ra-skeleton-row");
    expect(skeletons.length).toBeGreaterThan(0);

    pending.resolve({ rows: [sampleRow, sampleRow2], total: 2, limit: 50, offset: 0 });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    unmount(container);
    document.body.removeChild(container);
  });

  test("renders the activity tab rows grouped by day after the fetch resolves", async () => {
    mockGetAuditLog.mockResolvedValue({
      rows: [sampleRow, sampleRow2],
      total: 2,
      limit: 50,
      offset: 0,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderPage(container);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const rows = container.querySelectorAll(".ra-row");
    expect(rows.length).toBe(2);
    const dividers = container.querySelectorAll(".ra-day-divider span");
    // Both rows are from "Today" and "Earlier" depending on real date —
    // we don't pin the exact label, but at least one day divider is shown.
    expect(dividers.length).toBeGreaterThan(0);

    // The rich title is surfaced when fields[] is present.
    const rich = container.querySelector(".ra-row-rich");
    expect(rich).not.toBeNull();
    expect(rich.textContent).toMatch(/rate.*100.*150/);

    unmount(container);
    document.body.removeChild(container);
  });

  test("switches to the audit tab and renders the dense table", async () => {
    mockGetAuditLog.mockResolvedValue({
      rows: [sampleRow, sampleRow2],
      total: 2,
      limit: 50,
      offset: 0,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderPage(container);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const auditTab = [...container.querySelectorAll(".ra-tab")].find((b) =>
      b.textContent.includes("Audit Log")
    );
    expect(auditTab).toBeTruthy();
    act(() => auditTab.click());
    await act(async () => {
      await Promise.resolve();
    });

    const auditRows = container.querySelectorAll(".ra-audit-row");
    expect(auditRows.length).toBe(2);

    unmount(container);
    document.body.removeChild(container);
  });

  test("opens the drawer with a before/after diff when a row is clicked", async () => {
    mockGetAuditLog.mockResolvedValue({
      rows: [sampleRow, sampleRow2],
      total: 2,
      limit: 50,
      offset: 0,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderPage(container);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Click the first row summary to open the drawer.
    const firstSummary = container.querySelector(".ra-row-summary");
    expect(firstSummary).toBeTruthy();
    act(() => firstSummary.click());
    await act(async () => {
      await Promise.resolve();
    });

    const drawer = container.querySelector(".ra-drawer");
    expect(drawer).not.toBeNull();
    const diff = container.querySelector(".ra-diff-table");
    expect(diff).not.toBeNull();
    // The diff should have at least one field row.
    const diffRows = container.querySelectorAll(".ra-diff-row");
    expect(diffRows.length).toBeGreaterThan(0);

    // The summary should show the rate change.
    const summary = container.querySelector(".ra-drawer-summary");
    expect(summary.textContent).toMatch(/rate/);

    unmount(container);
    document.body.removeChild(container);
  });

  test("re-fetches when filters change", async () => {
    mockGetAuditLog.mockResolvedValue({ rows: [], total: 0, limit: 50, offset: 0 });
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderPage(container);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetAuditLog).toHaveBeenCalledTimes(1);

    // Pick a resource from the Resource dropdown and click Apply.
    const resourceSelect = container.querySelector("#ra-resource");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
      setter.call(resourceSelect, "services");
      resourceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const applyBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Apply")
    );
    act(() => applyBtn.click());
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockGetAuditLog).toHaveBeenCalledTimes(2);
    const lastCallParams = mockGetAuditLog.mock.calls[1][0];
    expect(lastCallParams.resource).toBe("services");

    unmount(container);
    document.body.removeChild(container);
  });

  test("dedupes a live SSE audit event with a matching id", async () => {
    mockGetAuditLog.mockResolvedValue({
      rows: [sampleRow],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderPage(container);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // The SSE subscriber is wired in useEffect; it must be present
    // after the first paint settles.
    expect(mockRealtimeSubscribers.length).toBe(1);

    // Fire an SSE event with an id already in the list.
    act(() => {
      mockRealtimeSubscribers[0]({
        kind: "audit",
        event: {
          auditId: "101",
          action: "service.rate_changed",
          resource: "services",
          resourceId: "9",
          userEmail: "admin@example.com",
          userRole: "SUPER_OWNER",
          at: "2026-09-22T11:00:00.000Z",
          ok: true,
        },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    // Row count should still be 1 (dedupe by id).
    expect(container.querySelectorAll(".ra-row").length).toBe(1);

    unmount(container);
    document.body.removeChild(container);
  });

  test("prepends a new SSE audit event with a fresh id", async () => {
    mockGetAuditLog.mockResolvedValue({
      rows: [sampleRow],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderPage(container);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    act(() => {
      mockRealtimeSubscribers[0]({
        kind: "audit",
        event: {
          auditId: "999",
          action: "customer.approved",
          resource: "customers",
          resourceId: "55",
          userEmail: "admin@example.com",
          userRole: "SUPER_OWNER",
          at: new Date().toISOString(),
          ok: true,
        },
      });
    });
    await act(async () => {
      await Promise.resolve();
    });

    const rows = container.querySelectorAll(".ra-row");
    expect(rows.length).toBe(2);
    // The first row in the DOM should be the live one (id 999).
    expect(rows[0].outerHTML).toContain("live");
    expect(rows[0].outerHTML).toContain("customer");

    unmount(container);
    document.body.removeChild(container);
  });

  test("calls exportAuditLogCsv when the Export button is clicked", async () => {
    mockGetAuditLog.mockResolvedValue({
      rows: [sampleRow],
      total: 1,
      limit: 50,
      offset: 0,
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    renderPage(container);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const exportBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent.includes("Export CSV")
    );
    expect(exportBtn).toBeTruthy();
    await act(async () => {
      exportBtn.click();
      await Promise.resolve();
    });

    expect(mockExportAuditLogCsv).toHaveBeenCalledTimes(1);

    unmount(container);
    document.body.removeChild(container);
  });
});
