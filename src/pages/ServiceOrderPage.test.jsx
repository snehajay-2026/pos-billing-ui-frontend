import React from "react";
// eslint-disable-next-line react/no-deprecated
import ReactDOM from "react-dom";
import { act } from "react-dom/test-utils";

const mockNavigate = jest.fn();
const mockGetUser = jest.fn(() => ({
  email: "owner@example.com",
  role: "SUPER_OWNER",
  storeType: "service",
  storeId: "store-a",
}));
const mockUi = { activeStore: { storeType: "service", storeId: "store-a" } };
const mockGetOrders = jest.fn(() => Promise.resolve([]));
const mockLoadServices = jest.fn(() => Promise.resolve([{ id: "svc-1", name: "Massage" }]));
const mockCreateOrder = jest.fn();
const mockUpdateOrder = jest.fn();
const mockDeleteOrder = jest.fn();
const mockCreateInvoiceFromOrder = jest.fn();
let mockSetStore;

function TestHarness() {
  const [store, setStore] = React.useState(mockUi.activeStore);
  mockSetStore = setStore;
  mockUi.activeStore = store;
  return <ServiceOrderPage />;
}

jest.mock("react-router-dom", () => {
  const actual = jest.requireActual("react-router-dom");
  return { ...actual, useNavigate: () => mockNavigate };
});
jest.mock("../utils/auth", () => ({ getUser: (...args) => mockGetUser(...args) }));
jest.mock("../context/UiContext", () => ({ useUi: () => mockUi }));
jest.mock("../components/layout/Layout", () => {
  function LayoutMock({ children }) {
    return <>{children}</>;
  }
  return LayoutMock;
});
jest.mock("../services/orderService", () => ({
  getOrders: (...args) => mockGetOrders(...args),
  createOrder: (...args) => mockCreateOrder(...args),
  updateOrder: (...args) => mockUpdateOrder(...args),
  deleteOrder: (...args) => mockDeleteOrder(...args),
  createInvoiceFromOrder: (...args) => mockCreateInvoiceFromOrder(...args),
}));
jest.mock("../services/serviceService", () => ({
  loadServices: (...args) => mockLoadServices(...args),
}));

import ServiceOrderPage from "./ServiceOrderPage";

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const renderPage = (container) => {
  act(() => {
    // eslint-disable-next-line react/no-deprecated
    ReactDOM.render(<TestHarness />, container);
  });
};

const setInput = (container, name, value) => {
  const input = container.querySelector(`[name="${name}"]`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
};

const clickButton = (container, text) => {
  const button = [...container.querySelectorAll("button")].find(
    (node) => node.textContent.includes(text) || node.getAttribute("aria-label") === text
  );
  expect(button).toBeTruthy();
  act(() => button.click());
};

const orderForStoreA = {
  id: "a-1",
  customer: "Store A customer",
  service: "Massage",
  hours: 1,
  status: "pending",
};

const remountWithOrder = async (container, order = orderForStoreA) => {
  act(() => {
    // eslint-disable-next-line react/no-deprecated
    ReactDOM.unmountComponentAtNode(container);
  });
  mockUi.activeStore = { storeType: "service", storeId: "store-a" };
  mockGetOrders.mockImplementationOnce(() => Promise.resolve([order]));
  renderPage(container);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const switchToStoreB = async () => {
  act(() => {
    mockSetStore({ storeType: "service", storeId: "store-b" });
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("ServiceOrderPage mutation scope", () => {
  let container;

  beforeEach(async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    window.confirm = jest.fn(() => true);
    window.scrollTo = jest.fn();
    mockUi.activeStore = { storeType: "service", storeId: "store-a" };
    mockGetOrders.mockImplementation(() => Promise.resolve([]));
    mockLoadServices.mockImplementation(() => Promise.resolve([{ id: "svc-1", name: "Massage" }]));
    mockCreateOrder.mockReset();
    mockUpdateOrder.mockReset();
    mockDeleteOrder.mockReset();
    mockCreateInvoiceFromOrder.mockReset();
    mockNavigate.mockReset();
    container = document.createElement("div");
    document.body.appendChild(container);
    renderPage(container);
    await act(async () => {});
  });

  afterEach(() => {
    act(() => {
      // eslint-disable-next-line react/no-deprecated
      ReactDOM.unmountComponentAtNode(container);
    });
    document.body.removeChild(container);
    jest.restoreAllMocks();
  });

  test("ignores a Store A save response after switching to Store B", async () => {
    const save = deferred();
    mockCreateOrder.mockReturnValueOnce(save.promise);
    setInput(container, "customer", "Store A customer");
    clickButton(container, "Create order");

    await switchToStoreB();

    await act(async () => save.resolve({ id: "a-1", customer: "Store A customer" }));
    expect(container.textContent).not.toContain("Store A customer");
    expect(container.textContent).toContain("No orders yet");
  });

  test("ignores stale delete, status, and invoice responses", async () => {
    await remountWithOrder(container);

    const deleted = deferred();
    mockDeleteOrder.mockReturnValueOnce(deleted.promise);
    clickButton(container, "Delete");
    await switchToStoreB();
    await act(async () => deleted.resolve());
    expect(container.textContent).not.toContain("Store A customer");

    await remountWithOrder(container);
    const updated = deferred();
    mockUpdateOrder.mockReturnValueOnce(updated.promise);
    clickButton(container, "Start");
    await switchToStoreB();
    await act(async () => updated.resolve({ ...orderForStoreA, status: "in_progress" }));
    expect(container.textContent).not.toContain("Store A customer");

    await remountWithOrder(container);
    clickButton(container, "Create invoice");
    const invoiced = deferred();
    mockCreateInvoiceFromOrder.mockReturnValueOnce(invoiced.promise);
    clickButton(container, "Generate invoice");
    await switchToStoreB();
    await act(async () => invoiced.resolve({ invoice: { invoiceNo: "INV-A" } }));
    expect(container.textContent).not.toContain("INV-A");
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockCreateInvoiceFromOrder).toHaveBeenCalledTimes(1);
  });

  test("resets edit state when switching stores", async () => {
    await remountWithOrder(container);
    clickButton(container, "Edit");
    expect(container.querySelector('[name="customer"]').value).toBe("Store A customer");

    await switchToStoreB();
    expect(container.querySelector('[name="customer"]').value).toBe("");
    expect(container.textContent).not.toContain("Editing order");
  });

  test("resets invoice dialog state when switching stores", async () => {
    await remountWithOrder(container);
    clickButton(container, "Create invoice");
    expect(container.textContent).toContain("Create invoice from order");

    await switchToStoreB();
    expect(container.textContent).not.toContain("Create invoice from order");
  });

  test("ignores a Store A mutation error after switching to Store B", async () => {
    const save = deferred();
    mockCreateOrder.mockReturnValueOnce(save.promise);
    setInput(container, "customer", "Store A customer");
    clickButton(container, "Create order");

    await switchToStoreB();
    await act(async () => save.reject(new Error("Store A failed")));
    expect(container.textContent).not.toContain("Store A failed");
  });
});
