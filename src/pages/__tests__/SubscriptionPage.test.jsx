// Tests for the ADMIN Subscription page contract.
//
// The project doesn't ship @testing-library/react, so we mount with the
// stock react-dom/test-utils `act` + legacy ReactDOM.render (same pattern
// as Toasts.test.js).
//
// Role visibility (navigation + route guard):
//   ADMIN → Subscription nav item + /subscription route
//   STORE_ADMIN / CASHIER → no Subscription nav item, /subscription denied
//   SUPER_OWNER → no ADMIN Subscription nav item (separate platform UI later)
//
// Page behaviour (mocked at the service boundary):
//   plans + tenant subscription load, plan + cycle selection works,
//   subscribe posts only planId + billingCycle, refresh shows backend
//   status (never faked active), expired tenants still reach the UI,
//   API errors render.

import React from "react";
// eslint-disable-next-line react/no-deprecated
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";
import { MemoryRouter, Routes, Route } from "react-router-dom";

const mockGetActivePlans = jest.fn();
const mockGetMySubscription = jest.fn();
const mockCreateSubscription = jest.fn();
const mockCancelSubscription = jest.fn();
const mockVerifySubscriptionPayment = jest.fn();

jest.mock("../../services/subscriptionService", () => ({
  getActivePlans: (...args) => mockGetActivePlans(...args),
  getMySubscription: (...args) => mockGetMySubscription(...args),
  createSubscription: (...args) => mockCreateSubscription(...args),
  cancelSubscription: (...args) => mockCancelSubscription(...args),
  verifySubscriptionPayment: (...args) => mockVerifySubscriptionPayment(...args),
}));

// Layout shell is irrelevant to these assertions; stub it out.
jest.mock("../../components/layout/Layout", () => {
  const LayoutMock = ({ children }) => <>{children}</>;
  return LayoutMock;
});

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

import Sidebar from "../../components/layout/Sidebar";
import SubscriptionPage from "../SubscriptionPage";
import ProtectedRoute from "../../components/common/ProtectedRoute";

const PLANS = [
  {
    id: 5,
    name: "Growth",
    monthlyPrice: 499,
    yearlyPrice: 4999,
    trialDays: 7,
    active: true,
  },
];

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

const findButton = (root, label) =>
  Array.from(root.querySelectorAll("button")).find((b) => textOf(b).includes(label)) || null;

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.clearAllMocks();
  mockUser = { role: "ADMIN", email: "admin@example.com", storeType: "retail" };
  // window.location.search is read by the callback effect; default to the
  // no-callback state. Tests that need callback params override the URL
  // (jsdom supports history.replaceState, which the page also uses to
  // clean the params afterwards).
  window.history.replaceState({}, "", "/subscription");
  // window.location.href assignment is the hosted-checkout redirect.
  // jsdom does not implement navigation, so tests observe it here.
  delete window.location;
  window.location = { href: "", search: "", pathname: "/subscription", hash: "" };
  mockVerifySubscriptionPayment.mockResolvedValue({ verified: true });
});

afterEach(() => {
  unmount();
  jest.restoreAllMocks();
});

describe("Subscription navigation visibility", () => {
  test("ADMIN sees the Subscription navigation item", () => {
    mockUser = { role: "ADMIN", email: "admin@example.com", storeType: "retail" };
    const root = mount(
      <MemoryRouter>
        <Sidebar collapsed={false} isMobile={false} />
      </MemoryRouter>
    );
    expect(textOf(root).includes("Subscription")).toBe(true);
  });

  test.each([["STORE_ADMIN"], ["CASHIER"], ["SUPER_OWNER"]])(
    "%s does not see the ADMIN Subscription navigation item",
    (role) => {
      mockUser = { role, email: `${role}@example.com`, storeType: "retail" };
      const root = mount(
        <MemoryRouter>
          <Sidebar collapsed={false} isMobile={false} />
        </MemoryRouter>
      );
      expect(textOf(root).includes("Subscription")).toBe(false);
    }
  );
});

describe("Subscription route guard", () => {
  beforeEach(() => {
    mockGetActivePlans.mockResolvedValue([]);
    mockGetMySubscription.mockResolvedValue(null);
  });

  const mountGuarded = (user) => {
    mockUser = user;
    return mount(
      <MemoryRouter initialEntries={["/subscription"]}>
        <Routes>
          <Route
            path="/subscription"
            element={
              <ProtectedRoute roles={["ADMIN"]}>
                <SubscriptionPage />
              </ProtectedRoute>
            }
          />
          <Route path="/" element={<div>home</div>} />
        </Routes>
      </MemoryRouter>
    );
  };

  test("ADMIN reaches the page", async () => {
    const root = mountGuarded({ role: "ADMIN", email: "admin@example.com" });
    await flush();
    expect(textOf(root).includes("Current subscription")).toBe(true);
  });

  test.each([["STORE_ADMIN"], ["CASHIER"], ["SUPER_OWNER"]])(
    "%s is redirected away from the ADMIN page",
    async (role) => {
      const root = mountGuarded({ role, email: `${role}@example.com` });
      await flush();
      expect(textOf(root).includes("home")).toBe(true);
      expect(textOf(root).includes("Current subscription")).toBe(false);
    }
  );
});

describe("SubscriptionPage", () => {
  const mountPage = () =>
    mount(
      <MemoryRouter>
        <SubscriptionPage />
      </MemoryRouter>
    );

  test("plans and current tenant subscription load", async () => {
    mockGetActivePlans.mockResolvedValue(PLANS);
    mockGetMySubscription.mockResolvedValue({
      id: 9,
      planId: 5,
      planName: "Growth",
      billingCycle: "monthly",
      subscribedPrice: 499,
      status: "active",
      startedAt: "2026-09-01T00:00:00.000Z",
      expiresAt: null,
      payments: [],
    });
    const root = mountPage();
    await flush();
    expect(mockGetActivePlans).toHaveBeenCalledTimes(1);
    expect(mockGetMySubscription).toHaveBeenCalledTimes(1);
    expect(textOf(root).includes("Growth")).toBe(true);
    expect(textOf(root).includes("Active")).toBe(true);
  });

  test("plan + billing cycle selection sends only planId and billingCycle", async () => {
    mockGetActivePlans.mockResolvedValue(PLANS);
    mockGetMySubscription.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 10,
      planId: 5,
      planName: "Growth",
      billingCycle: "yearly",
      subscribedPrice: 4999,
      status: "trialing",
      startedAt: "2026-10-01T00:00:00.000Z",
      expiresAt: null,
      payments: [],
    });
    mockCreateSubscription.mockResolvedValue({ id: 10, status: "trialing" });
    const root = mountPage();
    await flush();

    const planRadio = root.querySelector('input[name="plan"][value="5"]');
    expect(planRadio).not.toBeNull();
    act(() => {
      planRadio.click();
    });
    const yearly = root.querySelector('input[name="billingCycle"][value="yearly"]');
    expect(yearly).not.toBeNull();
    act(() => {
      yearly.click();
    });
    const btn = findButton(root, "Subscribe");
    expect(btn).not.toBeNull();
    await act(async () => {
      btn.click();
    });
    await flush();

    expect(mockCreateSubscription).toHaveBeenCalledTimes(1);
    expect(mockCreateSubscription).toHaveBeenCalledWith({
      planId: 5,
      billingCycle: "yearly",
    });
    const body = mockCreateSubscription.mock.calls[0][0];
    expect(Object.keys(body).sort()).toEqual(["billingCycle", "planId"]);
  });

  test("after creation the backend status is shown, never faked active", async () => {
    mockGetActivePlans.mockResolvedValue(PLANS);
    mockGetMySubscription
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 10, planName: "Growth", status: "trialing" });
    mockCreateSubscription.mockResolvedValue({
      subscription: { id: 10, status: "trialing" },
      checkout: { shortUrl: null },
    });
    const root = mountPage();
    await flush();
    const planRadio = root.querySelector('input[name="plan"][value="5"]');
    act(() => {
      planRadio.click();
    });
    const btn = findButton(root, "Subscribe");
    await act(async () => {
      btn.click();
    });
    await flush();
    expect(textOf(root).includes("Trial")).toBe(true);
    expect(textOf(root).includes("Active")).toBe(false);
    // No hosted URL: nothing redirects, but the backend status was shown.
    expect(window.location.href).toBe("");
  });

  test("expired subscription still allows the management UI with renewal prompt", async () => {
    mockGetActivePlans.mockResolvedValue(PLANS);
    mockGetMySubscription.mockResolvedValue({
      id: 9,
      planId: 5,
      planName: "Growth",
      billingCycle: "monthly",
      subscribedPrice: 499,
      status: "expired",
      startedAt: "2026-08-01T00:00:00.000Z",
      expiresAt: "2026-09-01T00:00:00.000Z",
      payments: [],
    });
    const root = mountPage();
    await flush();
    // Status is visible, renewal controls stay reachable — the page
    // itself is never locked for an expired tenant.
    expect(textOf(root).includes("Expired")).toBe(true);
    expect(findButton(root, "Subscribe / renew")).not.toBeNull();
    expect(root.querySelector(".sub-plan-name")).not.toBeNull();
  });

  test("API errors display correctly", async () => {
    mockGetActivePlans.mockRejectedValue(new Error("Failed to load plans"));
    mockGetMySubscription.mockResolvedValue(null);
    const root = mountPage();
    await flush();
    expect(textOf(root).includes("Failed to load plans")).toBe(true);
  });

  test("successful create with hosted URL redirects to Razorpay checkout", async () => {
    mockGetActivePlans.mockResolvedValue(PLANS);
    mockGetMySubscription.mockResolvedValue(null);
    mockCreateSubscription.mockResolvedValue({
      subscription: { id: 10, status: "trialing" },
      checkout: { shortUrl: "https://rzp.io/i/abc123" },
    });
    const root = mountPage();
    await flush();
    const planRadio = root.querySelector('input[name="plan"][value="5"]');
    act(() => {
      planRadio.click();
    });
    const btn = findButton(root, "Subscribe");
    await act(async () => {
      btn.click();
    });
    await flush();
    expect(window.location.href).toBe("https://rzp.io/i/abc123");
    // The page never fakes activation: nothing was re-read, nothing says Active.
    expect(mockGetMySubscription).toHaveBeenCalledTimes(1);
    expect(textOf(root).includes("Active")).toBe(false);
  });

  test("missing shortUrl shows a safe actionable error and no redirect", async () => {
    mockGetActivePlans.mockResolvedValue(PLANS);
    mockGetMySubscription
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 10, planName: "Growth", status: "trialing" });
    mockCreateSubscription.mockResolvedValue({
      subscription: { id: 10, status: "trialing" },
      checkout: {},
    });
    const root = mountPage();
    await flush();
    const planRadio = root.querySelector('input[name="plan"][value="5"]');
    act(() => {
      planRadio.click();
    });
    const btn = findButton(root, "Subscribe");
    await act(async () => {
      btn.click();
    });
    await flush();
    expect(window.location.href).toBe("");
    expect(textOf(root).includes("no hosted payment page was returned")).toBe(true);
    expect(textOf(root).includes("Trial")).toBe(true);
  });

  test("callback params verify against the backend, then refresh shows backend status", async () => {
    mockGetActivePlans.mockResolvedValue(PLANS);
    mockGetMySubscription
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 10, planName: "Growth", status: "trialing" });
    mockVerifySubscriptionPayment.mockResolvedValue({ verified: true });
    delete window.location;
    window.location = {
      href: "",
      search: "?razorpay_payment_id=pay_AAA&razorpay_subscription_id=sub_X&razorpay_signature=sig",
      pathname: "/subscription",
      hash: "",
    };
    const root = mountPage();
    await flush();
    await flush();
    // ONLY the three provider params are forwarded — no local id, no tenant.
    expect(mockVerifySubscriptionPayment).toHaveBeenCalledTimes(1);
    expect(mockVerifySubscriptionPayment).toHaveBeenCalledWith({
      razorpay_payment_id: "pay_AAA",
      razorpay_subscription_id: "sub_X",
      razorpay_signature: "sig",
    });
    const verifyBody = mockVerifySubscriptionPayment.mock.calls[0][0];
    expect(Object.keys(verifyBody).sort()).toEqual([
      "razorpay_payment_id",
      "razorpay_signature",
      "razorpay_subscription_id",
    ]);
    // After verify the authoritative status is re-read and rendered as-is.
    expect(mockGetMySubscription).toHaveBeenCalledTimes(2);
    expect(textOf(root).includes("Trial")).toBe(true);
    expect(textOf(root).includes("waiting for payment confirmation")).toBe(true);
    expect(textOf(root).includes("Active")).toBe(false);
  });

  test("forged verification shows an error and never fakes Active", async () => {
    mockGetActivePlans.mockResolvedValue(PLANS);
    mockGetMySubscription.mockResolvedValue(null);
    mockVerifySubscriptionPayment.mockRejectedValue(new Error("Invalid payment signature"));
    delete window.location;
    window.location = {
      href: "",
      search: "?razorpay_payment_id=pay_AAA&razorpay_subscription_id=sub_X&razorpay_signature=bad",
      pathname: "/subscription",
      hash: "",
    };
    const root = mountPage();
    await flush();
    await flush();
    expect(textOf(root).includes("Invalid payment signature")).toBe(true);
    expect(textOf(root).includes("Active")).toBe(false);
  });
});
