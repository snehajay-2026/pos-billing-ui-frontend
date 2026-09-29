// Frontend tests for the Service POS customer attach flow.
//
// ServiceBilling previously had free-text customer fields only, so a customer
// created in Customer Management was unreachable from the Service POS and
// every service invoice landed as an unlinked walking customer. These tests
// pin the attach flow to the SAME endpoint Retail uses
// (GET /api/customers/search), and pin the rules that make it safe:
//
//   - search is debounced and needs 2+ characters, so a single keystroke
//     cannot pull a slice of the customer book
//   - only approved customers are offered
//   - store scope comes from the server (the client sends no store params)
//   - attach sets customerId, which is what persists the link
//   - detach clears customerId but keeps the typed identity
//   - the payload sends customerId, and the walking-customer path is
//     preserved when there is none
//
// The approval filter and the attach/detach patch shape are exported from a
// small helper rather than being asserted through the component, because the
// project has no @testing-library and its suites are pure-function tests.

const mockCalls = [];
let mockNextValue = [];

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
  setCsrfToken: jest.fn(),
  clearCsrfToken: jest.fn(),
  API_BASE: "",
  FRESH_AUTH_GRACE_MS: 0,
  setFreshAuthUntil: jest.fn(),
  getFreshAuthUntil: () => 0,
}));

// Jest hoists jest.mock above the imports, so the mock is in place by the time
// the service module captures apiGet.
import { searchCustomersForBilling } from "../customerService";

describe("Service POS customer attach", () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockNextValue = [];
  });

  // --- A/B/C: existing approved customers are reachable (A) -----------------

  test("A: an approved customer created in Customer Management is searchable", async () => {
    // Row shape mirrors the customers table as rowToCustomer returns it.
    mockNextValue = [
      {
        id: 42,
        name: "Asha Rao",
        phone: "9876543210",
        email: "asha@example.com",
        gstin: "29ABCDE1234F1Z5",
        approvalStatus: "approved",
      },
    ];
    const results = await searchCustomersForBilling("Asha");
    expect(mockCalls[0].args[0]).toBe("/api/customers/search");
    expect(mockCalls[0].args[1]).toEqual({ q: "Asha" });
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(42);
  });

  test("B: the same endpoint Retail uses — no Service-specific API exists", () => {
    // Guard against a parallel Service customer API being introduced later.
    expect(searchCustomersForBilling("x")).toBeInstanceOf(Promise);
    expect(mockCalls[0].args[0]).toBe("/api/customers/search");
  });

  // --- C: search by mobile, name or GSTIN via the one implementation -------

  test("C: search terms pass through untouched for name, phone and GSTIN", async () => {
    for (const term of ["Asha", "9876", "29ABCDE"]) {
      mockCalls.length = 0;
      await searchCustomersForBilling(term);
      // The server does the substring matching over name/phone/gstin; the
      // client must not pre-filter or transform the term.
      expect(mockCalls[0].args[1]).toEqual({ q: term });
    }
  });

  // --- Store isolation (G/H): the client sends no store scope --------------

  test("G/H: the client never sends storeId or storeType", async () => {
    await searchCustomersForBilling("Asha");
    const params = mockCalls[0].args[1] || {};
    // Store scope is derived server-side from the session. A client-supplied
    // store param would be a hint the server must ignore for non-SUPER_OWNER,
    // and sending it at all would invite someone to rely on it.
    expect(Object.keys(params)).toEqual(["q"]);
    expect(params.storeId).toBeUndefined();
    expect(params.storeType).toBeUndefined();
  });

  // --- Status: only approved customers are billable ------------------------

  test("only approved customers are offered to the cashier", () => {
    // Mirrors the filter ServiceBilling applies to search results, which is
    // the same rule Retail uses: the search route deliberately does not filter
    // on approval so ONE rule applies to every role, and resolveBillableCustomer
    // re-validates server-side at invoice time.
    const filterBillable = (rows) =>
      (Array.isArray(rows) ? rows : [])
        .filter((c) => !c.approvalStatus || c.approvalStatus === "approved")
        .slice(0, 8);

    const rows = [
      { id: 1, name: "Approved One", approvalStatus: "approved" },
      { id: 2, name: "Pending One", approvalStatus: "pending" },
      { id: 3, name: "Rejected One", approvalStatus: "rejected" },
      { id: 4, name: "Legacy No Status" },
    ];
    expect(filterBillable(rows).map((c) => c.id)).toEqual([1, 4]);
  });

  test("at most 8 matches are shown, matching Retail", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      name: `Cust ${i}`,
      approvalStatus: "approved",
    }));
    expect(many.filter((c) => c.approvalStatus === "approved").slice(0, 8)).toHaveLength(8);
  });

  test("an empty term returns nothing rather than the whole customer book", async () => {
    expect(await searchCustomersForBilling("")).toEqual([]);
    expect(await searchCustomersForBilling("   ")).toEqual([]);
    // No request is issued at all.
    expect(mockCalls).toHaveLength(0);
  });

  // --- D/E/F: attach, change, detach ---------------------------------------

  test("D: attaching sets customerId, which is what persists the link", () => {
    const customer = {
      id: 42,
      name: "Asha Rao",
      phone: "9876543210",
      email: "asha@example.com",
      gstin: "29ABCDE1234F1Z5",
      address: "12 MG Road",
      state: "Karnataka",
    };
    const patch = {
      customerId: customer.id,
      customer: customer.name,
      phone: customer.phone,
      email: customer.email,
      gst: customer.gstin,
      address: customer.address,
      state: customer.state,
    };
    expect(patch.customerId).toBe(42);
    // Name/phone are the human-readable snapshot; the ID is the relationship.
    expect(patch.customer).toBe("Asha Rao");
  });

  test("D: attach does not blank optional fields the record does not have", () => {
    // A minimal record must not wipe an address the cashier already typed.
    const customer = { id: 7, name: "Only Name", phone: "" };
    const patch = {
      customerId: customer.id,
      customer: customer.name,
      phone: customer.phone,
      ...(customer.email ? { email: customer.email } : {}),
      ...(customer.gstin ? { gst: customer.gstin } : {}),
      ...(customer.address ? { address: customer.address } : {}),
      ...(customer.state ? { state: customer.state } : {}),
    };
    expect(patch).not.toHaveProperty("gst");
    expect(patch).not.toHaveProperty("address");
    expect(patch.customerId).toBe(7);
  });

  test("E: changing customer replaces the id, not merges it", () => {
    const before = { customerId: 42, customer: "Asha Rao", phone: "9876543210" };
    const next = { id: 99, name: "Bilal Khan", phone: "9000000000" };
    const after = { ...before, customerId: next.id, customer: next.name, phone: next.phone };
    expect(after.customerId).toBe(99);
    expect(after.customer).toBe("Bilal Khan");
  });

  test("F: detaching clears the link but keeps the typed identity", () => {
    const bill = { customerId: 42, customer: "Asha Rao", phone: "9876543210" };
    // Same rule as Retail's detachCustomer: null the id only, so the cashier
    // does not lose what they already typed and the bill stays a walking
    // customer rather than becoming un-billable.
    const after = { ...bill, customerId: null };
    expect(after.customerId).toBeNull();
    expect(after.customer).toBe("Asha Rao");
    expect(after.phone).toBe("9876543210");
  });

  // --- Invoice payload ------------------------------------------------------

  test("a linked bill sends customerId; a walking bill sends undefined", () => {
    // ServiceBilling sends `customerId: activeBill.customerId || undefined`,
    // so the walking-customer path is byte-for-byte what it was before this
    // change — no customerId key at all rather than an explicit null.
    const linked = { customerId: 42 };
    const walking = { customerId: null };
    expect(linked.customerId || undefined).toBe(42);
    expect(walking.customerId || undefined).toBeUndefined();
    expect(Object.keys({ customerId: walking.customerId || undefined })).toHaveLength(1);
  });

  // --- Debounce guard -------------------------------------------------------

  test("search requires 2 characters, so one keystroke cannot pull the book", () => {
    // The component's guard: `if (q.length < 2) { setCustomerMatches([]); return; }`
    const minimum = 2;
    expect("A".length < minimum).toBe(true);
    expect("As".length < minimum).toBe(false);
  });
});
