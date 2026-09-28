// Jest tests for dashboardService.
//
// Verifies the request the Manager Dashboard makes and the parameter hygiene
// around it. The auth/api layer is mocked, so these are unit tests — nothing
// here depends on a running backend or on DB credentials.

const mockCalls = [];
const mockNextValue = { sales: {}, payments: [] };

jest.mock("../api", () => ({
  apiGet: (...args) => {
    mockCalls.push(args);
    return Promise.resolve(mockNextValue);
  },
}));

// Jest hoists jest.mock above the imports, so the mock is in place by the time
// the service module captures apiGet.
import { getDashboardSummary } from "../dashboardService";

describe("dashboardService", () => {
  beforeEach(() => {
    mockCalls.length = 0;
  });

  test("calls the consolidated summary endpoint", async () => {
    await getDashboardSummary({ from: "2026-03-01", to: "2026-03-07" });
    expect(mockCalls).toHaveLength(1);
    expect(mockCalls[0][0]).toBe("/api/dashboard/summary");
  });

  test("forwards the inclusive date range", async () => {
    await getDashboardSummary({ from: "2026-03-01", to: "2026-03-07" });
    expect(mockCalls[0][1]).toEqual({ from: "2026-03-01", to: "2026-03-07" });
  });

  test("strips empty values so the API never sees blank params", async () => {
    await getDashboardSummary({ from: "2026-03-01", to: "", storeType: undefined });
    expect(mockCalls[0][1]).toEqual({ from: "2026-03-01" });
  });

  test("sends no params at all for an unbounded period", async () => {
    await getDashboardSummary();
    expect(mockCalls[0][1]).toEqual({});
  });

  test("returns the server payload unchanged", async () => {
    const result = await getDashboardSummary({});
    expect(result).toBe(mockNextValue);
  });
});
