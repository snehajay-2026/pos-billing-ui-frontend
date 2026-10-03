// SuperOwnerRouteGuard.test.jsx
//
// Route-guard + honest-empty-state tests for the Super Owner console.
// Mounts with the stock react-dom/test-utils `act` + ReactDOM.render
// pattern (same as SubscriptionPage.test.jsx — the project does not
// ship @testing-library/react). Mocks sit at the service boundary
// (superOwnerService) the same way SubscriptionPage tests mock
// subscriptionService — no backend, no secrets.

import React from "react";
// eslint-disable-next-line react/no-deprecated
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mockGetSuperOwnerContext = jest.fn();
const mockGetRecentPlatformActivity = jest.fn();
const mockGetOwnDashboardSummary = jest.fn();
const mockListSuperOwnerUsers = jest.fn();
const mockListPlatformTenants = jest.fn();
const mockGetPlatformOverview = jest.fn();
const mockListPlatformPaymentRecords = jest.fn();
const mockListPlatformSubscriptionEvents = jest.fn();

const mockGetTenantDetail = jest.fn();

jest.mock("../../services/superOwnerService", () => ({
  getPlatformOverview: (...args) => mockGetPlatformOverview(...args),
  listPlatformPaymentRecords: (...args) => mockListPlatformPaymentRecords(...args),
  listPlatformSubscriptionEvents: (...args) => mockListPlatformSubscriptionEvents(...args),
  getSuperOwnerContext: (...args) => mockGetSuperOwnerContext(...args),
  getRecentPlatformActivity: (...args) => mockGetRecentPlatformActivity(...args),
  getOwnDashboardSummary: (...args) => mockGetOwnDashboardSummary(...args),
  listSuperOwnerUsers: (...args) => mockListSuperOwnerUsers(...args),
  listPlatformTenants: (...args) => mockListPlatformTenants(...args),
  getTenantDetail: (...args) => mockGetTenantDetail(...args),
}));

// `mockUser` (mock prefix) is the only out-of-scope reference the
// jest.mock factory below may capture.
let mockUser = null;
jest.mock("../../utils/auth", () => ({
  getUser: () => mockUser,
  getUserRole: () => (mockUser ? mockUser.role : null),
  getUserStoreType: () => (mockUser ? mockUser.storeType : null),
  getActiveStoreContext: () => null,
}));

jest.mock("../../context/UiContext", () => ({
  useUi: () => ({ locale: {} }),
}));

jest.mock("../../hooks/useHotelModuleLock", () => ({
  useHotelModuleLock: () => ({ lodgingLocked: false, diningLocked: false }),
}));

// Header pulls in the whole app shell; stub it so the test stays about
// the guard + pages, not the header.
jest.mock("../../components/layout/Header", () => {
  const HeaderMock = () => <div data-testid="stub-header" />;
  return HeaderMock;
});
jest.mock("../../components/layout/HelpChatBot", () => {
  const ChatMock = () => <div data-testid="stub-chatbot" />;
  return ChatMock;
});

import Sidebar from "../../components/layout/Sidebar";
import ProtectedRoute from "../../components/common/ProtectedRoute";
import SuperOwnerLayout from "../../components/super-owner/SuperOwnerLayout";
import SuperOwnerDashboard from "../super-owner/SuperOwnerDashboard";
import SuperOwnerTenants from "../super-owner/SuperOwnerTenants";
import SuperOwnerSubscriptionPlans from "../super-owner/SuperOwnerSubscriptionPlans";
import SuperOwnerPayments from "../super-owner/SuperOwnerPayments";

const SUPER_PATHS = ["/super", "/super/tenants", "/super/subscriptions", "/super/payments"];
const NON_SUPER_ROLES = ["STORE_ADMIN", "ADMIN", "CASHIER"];

const PAGES = {
  "/super": <SuperOwnerDashboard />,
  "/super/tenants": <SuperOwnerTenants />,
  "/super/subscriptions": <SuperOwnerSubscriptionPlans />,
  "/super/payments": <SuperOwnerPayments />,
};

let container = null;

const mount = (ui) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  act(() => {
    // eslint-disable-next-line react/no-deprecated
    ReactDOM.render(ui, container);
  });
  return container;
};

const unmount = () => {
  if (!container) return;
  act(() => {
    // eslint-disable-next-line react/no-deprecated
    ReactDOM.unmountComponentAtNode(container);
  });
  document.body.removeChild(container);
  container = null;
};

// Flush pending promise microtasks (service calls resolving).
const flush = async () => {
  await act(async () => {});
};

const textOf = (el) => (el ? el.textContent : "");

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.clearAllMocks();
  mockUser = { role: "SUPER_OWNER", email: "owner@example.com", storeType: "retail" };
  mockGetSuperOwnerContext.mockResolvedValue({ plans: [], subscription: null });
  mockGetRecentPlatformActivity.mockResolvedValue([]);
  mockGetOwnDashboardSummary.mockResolvedValue(null);
  mockListSuperOwnerUsers.mockResolvedValue([]);
  mockListPlatformTenants.mockResolvedValue({ tenants: [], total: 0, page: 1, limit: 25 });
  mockGetTenantDetail.mockResolvedValue(null);
  mockGetPlatformOverview.mockRejectedValue({});
  mockListPlatformPaymentRecords.mockResolvedValue({ records: [], total: 0, page: 1, limit: 25 });
  mockListPlatformSubscriptionEvents.mockResolvedValue({
    events: [],
    total: 0,
    page: 1,
    limit: 25,
  });
});

afterEach(() => {
  unmount();
  jest.restoreAllMocks();
});

describe.each(SUPER_PATHS)("route %s", (path) => {
  const mountGuarded = (role) => {
    mockUser = { role, email: `${role}@example.com`, storeType: "retail" };
    return mount(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={path}
            element={
              <ProtectedRoute roles={["SUPER_OWNER"]}>
                <SuperOwnerLayout>{PAGES[path]}</SuperOwnerLayout>
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  test("SUPER_OWNER reaches it", async () => {
    const root = mountGuarded("SUPER_OWNER");
    await flush();
    expect(textOf(root).includes("home")).toBe(false);
  });

  test.each(NON_SUPER_ROLES)("%s is redirected away", async (role) => {
    const root = mountGuarded(role);
    await flush();
    expect(textOf(root).includes("home")).toBe(true);
  });
});

describe("honest empty states", () => {
  const mountPage = (role, ui) => {
    mockUser = { role, email: `${role}@example.com`, storeType: "retail" };
    return mount(<MemoryRouter>{ui}</MemoryRouter>);
  };

  test("dashboard renders real overview figures when the endpoint succeeds", async () => {
    mockGetPlatformOverview.mockResolvedValueOnce({
      tenants: { total: 12 },
      stores: { total: 30, branches: null },
      users: { total: 150 },
      subscriptions: { total: 12, trialing: 2, active: 8, past_due: 0, cancelled: 1, expired: 1 },
      revenue: {
        monthly: 4599,
        yearly: 12599,
        currency: "INR",
        definition: "Gross captured test definition.",
      },
      meta: { generatedAt: "2026-01-01T00:00:00.000Z", branchesUnavailable: "No branch registry." },
    });
    mockGetOwnDashboardSummary.mockResolvedValueOnce({ sales: {} });
    const root = mountPage("SUPER_OWNER", <SuperOwnerDashboard />);
    await flush();
    const text = textOf(root);
    expect(text.includes("Total Tenants")).toBe(true);
    expect(text.includes("12")).toBe(true);
    expect(text.includes("150")).toBe(true);
    expect(text.includes("Gross captured test definition.")).toBe(true);
    expect(text.includes("No branch registry.")).toBe(true);
    // Scope label must not claim own-tenant-only figures: an unscoped
    // SUPER_OWNER receives unscoped (platform-wide) dashboard data.
    expect(text.includes("Available Data Today")).toBe(true);
    expect(text.includes("Your Scope Today")).toBe(false);
    expect(text.includes("platform-wide")).toBe(true);
  });

  test("dashboard shows an error and no cards when overview fails", async () => {
    // beforeEach already rejects getPlatformOverview; cards must not render.
    const root = mountPage("SUPER_OWNER", <SuperOwnerDashboard />);
    await flush();
    const text = textOf(root);
    expect(text.includes("Platform overview is unavailable right now.")).toBe(true);
    expect(text.includes("Total Tenants")).toBe(false);
  });

  test("tenants page renders real tenants with counts and subscription state", async () => {
    mockListPlatformTenants.mockResolvedValueOnce({
      tenants: [
        {
          tenantEmail: "a@example.com",
          userCount: 3,
          storeCount: 2,
          subscriptionStatus: "active",
          planName: "Growth",
          firstSeen: "2026-01-05T00:00:00.000Z",
        },
        {
          tenantEmail: "b@example.com",
          userCount: 1,
          storeCount: 1,
          subscriptionStatus: null,
          planName: null,
          firstSeen: "2026-03-11T00:00:00.000Z",
        },
      ],
      total: 27,
      page: 1,
      limit: 25,
    });
    const root = mountPage("SUPER_OWNER", <SuperOwnerTenants />);
    await flush();
    const text = textOf(root);
    expect(text.includes("a@example.com")).toBe(true);
    expect(text.includes("Growth")).toBe(true);
    expect(text.includes("Page 1 of 2 (27 tenants)")).toBe(true);
    // The missing-endpoint notice is gone now that the endpoint is live;
    // the only notice names genuinely unsupported enrichment.
    expect(text.includes("not implemented yet")).toBe(false);
    expect(text.includes("Per-tenant revenue and branch breakdowns are unavailable")).toBe(true);
    expect(mockListPlatformTenants).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 25 })
    );
  });

  test("tenants page paginates, searches, and handles empty and error states", async () => {
    mockListPlatformTenants.mockResolvedValue({
      tenants: [
        {
          tenantEmail: "a@example.com",
          userCount: 3,
          storeCount: 2,
          subscriptionStatus: "active",
          planName: "Growth",
          firstSeen: "2026-01-05T00:00:00.000Z",
        },
      ],
      total: 26,
      page: 1,
      limit: 25,
    });
    const root = mountPage("SUPER_OWNER", <SuperOwnerTenants />);
    await flush();
    const buttons = Array.from(root.querySelectorAll(".super-pagination button"));
    const nextBtn = buttons.find((b) => b.textContent === "Next" && !b.disabled);
    act(() => {
      nextBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(mockListPlatformTenants).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, limit: 25 })
    );
    unmount();
    // Empty: no tenants at all.
    mockListPlatformTenants.mockResolvedValueOnce({ tenants: [], total: 0, page: 1, limit: 25 });
    const emptyRoot = mountPage("SUPER_OWNER", <SuperOwnerTenants />);
    await flush();
    expect(textOf(emptyRoot).includes("No tenants found")).toBe(true);
    unmount();
    // Error: rejects so the fallback renders and the table stays empty.
    mockListPlatformTenants.mockRejectedValueOnce({});
    const errRoot = mountPage("SUPER_OWNER", <SuperOwnerTenants />);
    await flush();
    const errText = textOf(errRoot);
    expect(errText.includes("Platform tenant directory is unavailable right now.")).toBe(true);
    expect(errText.includes("a@example.com")).toBe(false);
  });

  test("tenant detail opens from the row, renders users/stores, and goes back", async () => {
    mockListPlatformTenants.mockResolvedValue({
      tenants: [
        {
          tenantEmail: "a@example.com",
          userCount: 3,
          storeCount: 2,
          subscriptionStatus: "active",
          planName: "Growth",
          firstSeen: "2026-01-05T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
    mockGetTenantDetail.mockResolvedValue({
      tenant: {
        tenantEmail: "a@example.com",
        userCount: 3,
        storeCount: 2,
        subscription: { status: "active", planName: "Growth", billingCycle: "monthly" },
        firstSeen: "2026-01-05T00:00:00.000Z",
      },
      users: [
        {
          email: "a@example.com",
          role: "ADMIN",
          storeType: "retail",
          storeId: "s1",
          createdAt: "2026-01-05T00:00:00.000Z",
        },
        {
          email: "cashier@branch.example.com",
          role: "CASHIER",
          storeType: "retail",
          storeId: "s2",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      ],
      stores: [
        { storeType: "retail", storeId: "s1" },
        { storeType: "retail", storeId: "s2" },
      ],
    });
    const root = mountPage("SUPER_OWNER", <SuperOwnerTenants />);
    await flush();
    const viewBtn = Array.from(root.querySelectorAll("button")).find(
      (b) => b.textContent === "View Details"
    );
    act(() => {
      viewBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    const detailText = textOf(root);
    expect(mockGetTenantDetail).toHaveBeenCalledWith("a@example.com");
    expect(detailText.includes("Tenant detail: a@example.com")).toBe(true);
    expect(detailText.includes("cashier@branch.example.com")).toBe(true);
    expect(detailText.includes("Users (2)")).toBe(true);
    expect(detailText.includes("Stores (2)")).toBe(true);
    const backBtn = Array.from(root.querySelectorAll("button")).find(
      (b) => b.textContent === "Back to Tenants"
    );
    act(() => {
      backBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(textOf(root).includes("Tenant detail: a@example.com")).toBe(false);
  });

  test("tenant detail handles missing subscription, empty collections, and 404", async () => {
    mockListPlatformTenants.mockResolvedValue({
      tenants: [
        {
          tenantEmail: "ghost@example.com",
          userCount: 1,
          storeCount: 0,
          subscriptionStatus: null,
          planName: null,
          firstSeen: "2026-03-11T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
    // Empty collections: summary exists, subscription null, no rows.
    mockGetTenantDetail.mockResolvedValueOnce({
      tenant: {
        tenantEmail: "ghost@example.com",
        userCount: 1,
        storeCount: 0,
        subscription: null,
        firstSeen: "2026-03-11T00:00:00.000Z",
      },
      users: [],
      stores: [],
    });
    const root = mountPage("SUPER_OWNER", <SuperOwnerTenants />);
    await flush();
    const viewBtn = Array.from(root.querySelectorAll("button")).find(
      (b) => b.textContent === "View Details"
    );
    act(() => {
      viewBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(textOf(root).includes("subscription none")).toBe(true);
    expect(textOf(root).includes("No users found for this tenant.")).toBe(true);
    expect(textOf(root).includes("No stores found for this tenant.")).toBe(true);
    unmount();
    // 404: unknown tenant.
    const err = { status: 404 };
    err.response = { status: 404 };
    mockGetTenantDetail.mockRejectedValueOnce(err);
    const errRoot = mountPage("SUPER_OWNER", <SuperOwnerTenants />);
    await flush();
    const errViewBtn = Array.from(errRoot.querySelectorAll("button")).find(
      (b) => b.textContent === "View Details"
    );
    act(() => {
      errViewBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(textOf(errRoot).includes("That tenant was not found.")).toBe(true);
  });

  test("payments page renders real records with pagination and tenant identity", async () => {
    mockListPlatformPaymentRecords.mockResolvedValueOnce({
      records: [
        {
          id: 3,
          tenantEmail: "b@example.com",
          subscriptionId: 20,
          providerPaymentId: "pay_B",
          amount: 999,
          currency: "INR",
          status: "captured",
          createdAt: "2026-09-02T00:00:00.000Z",
        },
        {
          id: 2,
          tenantEmail: "a@example.com",
          subscriptionId: 10,
          providerPaymentId: "pay_A",
          amount: 499,
          currency: "INR",
          status: "failed",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      total: 27,
      page: 1,
      limit: 25,
    });
    mockListPlatformSubscriptionEvents.mockResolvedValueOnce({
      events: [
        {
          id: 7,
          tenantEmail: "b@example.com",
          subscriptionId: 20,
          eventType: "payment_succeeded",
          createdAt: "2026-09-02T00:00:00.000Z",
        },
        {
          id: 5,
          tenantEmail: "a@example.com",
          subscriptionId: 10,
          eventType: "created",
          createdAt: "2026-09-01T00:00:00.000Z",
        },
      ],
      total: 2,
      page: 1,
      limit: 25,
    });
    const root = mountPage("SUPER_OWNER", <SuperOwnerPayments />);
    await flush();
    const text = textOf(root);
    expect(text.includes("Platform Payment History")).toBe(true);
    expect(text.includes("b@example.com")).toBe(true);
    expect(text.includes("pay_B")).toBe(true);
    expect(text.includes("Page 1 of 2 (27 records)")).toBe(true);
    // Both unavailable-endpoint notices are gone now that both endpoints
    // are live.
    expect(text.includes("/api/super/payment-records")).toBe(false);
    expect(text.includes("/api/super/subscription-events")).toBe(false);
    // The events section is clearly distinguished from payment records.
    expect(text.includes("Platform Subscription Events")).toBe(true);
    expect(text.includes("payment_succeeded")).toBe(true);
    expect(text.includes("Page 1 of 1 (2 events)")).toBe(true);
    // Status filter is offered for the ENUM values the backend supports.
    expect(mockListPlatformPaymentRecords).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 25 })
    );
    expect(mockListPlatformSubscriptionEvents).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 25 })
    );
  });

  test("payments page filters by status", async () => {
    mockListPlatformPaymentRecords.mockResolvedValue({
      records: [
        {
          id: 3,
          tenantEmail: "b@example.com",
          subscriptionId: 20,
          providerPaymentId: "pay_B",
          amount: 999,
          currency: "INR",
          status: "captured",
          createdAt: "2026-09-02T00:00:00.000Z",
        },
      ],
      total: 1,
      page: 1,
      limit: 25,
    });
    const root = mountPage("SUPER_OWNER", <SuperOwnerPayments />);
    await flush();
    const select = root.querySelector("select#super-pay-status");
    act(() => {
      select.value = "captured";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await flush();
    expect(mockListPlatformPaymentRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "captured", page: 1 })
    );
    expect(textOf(root).includes("pay_B")).toBe(true);
  });

  test("payments page paginates subscription events", async () => {
    mockListPlatformSubscriptionEvents.mockResolvedValue({
      events: [
        {
          id: 7,
          tenantEmail: "b@example.com",
          subscriptionId: 20,
          eventType: "payment_succeeded",
          createdAt: "2026-09-02T00:00:00.000Z",
        },
      ],
      total: 30,
      page: 1,
      limit: 25,
    });
    const root = mountPage("SUPER_OWNER", <SuperOwnerPayments />);
    await flush();
    expect(textOf(root).includes("Page 1 of 2 (30 events)")).toBe(true);
    const buttons = Array.from(root.querySelectorAll(".super-panel button"));
    const nextBtn = buttons.find((b) => b.textContent === "Next" && !b.disabled);
    act(() => {
      nextBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();
    expect(mockListPlatformSubscriptionEvents).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, limit: 25 })
    );
  });
  test("payments page shows loading then empty and error states", async () => {
    // Empty: resolves with no records and no events.
    mockListPlatformPaymentRecords.mockResolvedValueOnce({
      records: [],
      total: 0,
      page: 1,
      limit: 25,
    });
    mockListPlatformSubscriptionEvents.mockResolvedValueOnce({
      events: [],
      total: 0,
      page: 1,
      limit: 25,
    });
    const emptyRoot = mountPage("SUPER_OWNER", <SuperOwnerPayments />);
    await flush();
    expect(textOf(emptyRoot).includes("No payment records found")).toBe(true);
    expect(textOf(emptyRoot).includes("No subscription events found")).toBe(true);
    unmount();
    // Error: rejects so the fallbacks render and both tables stay empty.
    mockListPlatformPaymentRecords.mockRejectedValueOnce({});
    mockListPlatformSubscriptionEvents.mockRejectedValueOnce({});
    const errRoot = mountPage("SUPER_OWNER", <SuperOwnerPayments />);
    await flush();
    const errText = textOf(errRoot);
    expect(errText.includes("Platform payment history is unavailable right now.")).toBe(true);
    expect(errText.includes("Platform subscription events are unavailable right now.")).toBe(true);
    expect(errText.includes("pay_B")).toBe(false);
    expect(errText.includes("payment_succeeded")).toBe(false);
  });
});

describe("tenant-admin Sidebar visibility", () => {
  const mountSidebar = (role) => {
    mockUser = { role, email: `${role}@example.com`, storeType: "retail" };
    return mount(
      <MemoryRouter>
        <Sidebar collapsed={false} isMobile={false} />
      </MemoryRouter>
    );
  };

  test("SUPER_OWNER sees the Platform entry and no tenant-admin sections", () => {
    const root = mountSidebar("SUPER_OWNER");
    expect(textOf(root).includes("Open Super Owner console")).toBe(true);
    expect(textOf(root).includes("Operations")).toBe(false);
    expect(textOf(root).includes("Insights & Reports")).toBe(false);
    expect(textOf(root).includes("Manage")).toBe(false);
  });

  test.each(NON_SUPER_ROLES)("%s does NOT see the Platform entry", (role) => {
    const root = mountSidebar(role);
    expect(textOf(root).includes("Open Super Owner console")).toBe(false);
  });
});
