// Frontend Jest tests for customerService.
//
// Verifies:
//   1. approveCustomer issues a POST to /api/customers/:id/approve with
//      { status, reason } as the JSON body.
//   2. approveCustomer dispatches a "dataUpdated" event with detail:
//      "customers" so the CustomerManagement page refreshes.
//   3. searchCustomers forwards { name, phone } query parameters to
//      /api/customers.
//   4. createCustomer posts the full record to /api/customers.
//   5. updateCustomer puts the full record to /api/customers/:id.
//   6. deleteCustomer issues DELETE on /api/customers/:id.
//
// The apiGet/apiPost/apiPut/apiDelete helpers are stubbed via
// jest.mock("../api") so we don't need a live backend. The mock factory
// must not capture out-of-scope variables (Jest hoists it), so each test
// sets the next return value via a global accumulator.

const mockCalls = [];
let mockNextValue;

jest.mock("../api", () => ({
  apiGet: (...args) => {
    mockCalls.push({ method: "GET", args });
    return Promise.resolve(mockNextValue);
  },
  apiPost: (...args) => {
    mockCalls.push({ method: "POST", args });
    return Promise.resolve(mockNextValue);
  },
  apiPut: (...args) => {
    mockCalls.push({ method: "PUT", args });
    return Promise.resolve(mockNextValue);
  },
  apiDelete: (...args) => {
    mockCalls.push({ method: "DELETE", args });
    return Promise.resolve(mockNextValue);
  },
}));

// auth helpers aren't on the test path for these calls — the approve
// route never reads storeType/email from the query string. Returning
// stubs keeps the test self-contained.
jest.mock("../../utils/auth", () => ({
  getUser: () => ({ email: "cashier@a.com" }),
  getActiveStoreContext: () => ({ storeType: "service" }),
}));

const customerService = require("../customerService");

describe("customerService.approveCustomer", () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockNextValue = { id: 7, name: "Walk-in", approvalStatus: "approved" };
    if (typeof window === "undefined") {
      global.window = {};
    }
    // Replace dispatchEvent with a spy so the test can assert the event.
    window.dispatchEvent = jest.fn();
  });

  test("POSTs to /api/customers/:id/approve with { status: 'approved' }", async () => {
    await customerService.approveCustomer(7, { status: "approved" });
    const post = mockCalls.find((c) => c.method === "POST");
    expect(post).toBeDefined();
    const [url, data] = post.args;
    expect(url).toBe("/api/customers/7/approve");
    expect(data).toEqual({ status: "approved", reason: "" });
  });

  test("POSTs to /api/customers/:id/approve with the rejection reason", async () => {
    await customerService.approveCustomer(11, {
      status: "rejected",
      reason: "duplicate phone",
    });
    const post = mockCalls.find((c) => c.method === "POST");
    const [url, data] = post.args;
    expect(url).toBe("/api/customers/11/approve");
    expect(data).toEqual({ status: "rejected", reason: "duplicate phone" });
  });

  test("dispatches dataUpdated with detail: 'customers' on success", async () => {
    await customerService.approveCustomer(7, { status: "approved" });
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    const event = window.dispatchEvent.mock.calls[0][0];
    expect(event).toBeInstanceOf(CustomEvent);
    expect(event.type).toBe("dataUpdated");
    expect(event.detail).toBe("customers");
  });

  test("does not dispatch dataUpdated when the API call rejects", async () => {
    // Recreate the mock factory once with a rejected implementation by
    // mutating the imported module's exports is not possible from here.
    // Instead, override mockNextValue on the next POST to throw via a
    // wrapper around the imported helper. Simpler: temporarily replace
    // the api helper on the jest module using jest.requireMock:
    const apiModule = require("../api");
    const originalPost = apiModule.apiPost;
    apiModule.apiPost = jest.fn(async () => {
      throw new Error("403 forbidden");
    });
    try {
      await expect(customerService.approveCustomer(7, { status: "approved" })).rejects.toThrow(
        "403 forbidden"
      );
      expect(window.dispatchEvent).not.toHaveBeenCalled();
    } finally {
      apiModule.apiPost = originalPost;
    }
  });
});

describe("customerService.searchCustomers", () => {
  beforeEach(() => {
    mockCalls.length = 0;
  });

  test("forwards { name, phone } query params to /api/customers", async () => {
    mockNextValue = [{ id: 1, name: "Patel" }];
    await customerService.searchCustomers({ name: "Patel", phone: "9876" });
    const get = mockCalls.find((c) => c.method === "GET");
    const [url, params] = get.args;
    expect(url).toBe("/api/customers");
    expect(params).toEqual({ name: "Patel", phone: "9876" });
  });

  test("returns the array straight from the server", async () => {
    mockNextValue = [
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ];
    const out = await customerService.searchCustomers({ name: "x" });
    expect(out).toHaveLength(2);
  });

  test("omits undefined params from the query string", async () => {
    mockNextValue = [];
    await customerService.searchCustomers({ name: "x", phone: undefined });
    const [, params] = mockCalls.find((c) => c.method === "GET").args;
    expect(params).toEqual({ name: "x" });
  });
});

describe("customerService CRUD wrappers", () => {
  beforeEach(() => {
    mockCalls.length = 0;
  });

  test("createCustomer POSTs the full record", async () => {
    mockNextValue = { id: 1 };
    await customerService.createCustomer({ name: "Patel", phone: "9876" });
    const post = mockCalls.find((c) => c.method === "POST");
    const [url, data] = post.args;
    expect(url).toBe("/api/customers");
    expect(data).toEqual({ name: "Patel", phone: "9876" });
  });

  test("updateCustomer PUTs the full record at /api/customers/:id", async () => {
    mockNextValue = { id: 1 };
    await customerService.updateCustomer(1, { name: "Patel-Updated" });
    const put = mockCalls.find((c) => c.method === "PUT");
    const [url, data] = put.args;
    expect(url).toBe("/api/customers/1");
    expect(data).toEqual({ name: "Patel-Updated" });
  });

  test("deleteCustomer DELETEs /api/customers/:id", async () => {
    await customerService.deleteCustomer(1);
    const del = mockCalls.find((c) => c.method === "DELETE");
    const [url] = del.args;
    expect(url).toBe("/api/customers/1");
  });
});
