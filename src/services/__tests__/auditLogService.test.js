// Frontend Jest tests for auditLogService.
//
// Verifies:
//   1. getAuditLog strips empty/null/undefined values from the params
//      before forwarding to apiGet.
//   2. getAuditLog forwards meaningful filters (q, resource, method,
//      from, to, outcome, order, entityCategory) and pagination
//      (limit, offset).
//   3. exportAuditLogCsv issues a fetch with `format=csv` plus the
//      current filter set, parses Content-Disposition for the filename,
//      and triggers an anchor download via a blob URL.
//
// The apiGet helper is stubbed via jest.mock("../api") so we don't need
// a live backend. The fetch + URL.createObjectURL helpers are stubbed
// the same way.

const mockCalls = [];
let mockNextValue;

jest.mock("../api", () => ({
  apiGet: (...args) => {
    mockCalls.push({ method: "GET", args });
    return Promise.resolve(mockNextValue);
  },
}));

// Stub fetch + DOM helpers needed by exportAuditLogCsv.
const fetchCalls = [];

const fakeBlob = { _isBlob: true, size: 12 };

const fakeAnchor = {
  href: "",
  download: "",
  style: {},
  click: jest.fn(),
  _appended: false,
};

const fakeDocument = {
  _anchors: [],
  createElement: (tag) => {
    if (tag === "a") return fakeAnchor;
    return {};
  },
  body: {
    appendChild: (el) => {
      el._appended = true;
      fakeDocument._anchors.push(el);
      return el;
    },
    removeChild: (el) => {
      el._appended = false;
      fakeDocument._anchors = fakeDocument._anchors.filter((a) => a !== el);
      return el;
    },
  },
};

const createObjectURL = jest.fn(() => "blob:audit-log-test");
const revokeObjectURL = jest.fn();

// Use a jest.fn for fetch so we can configure per-test behavior.
// The auditLogService takes a `deps` parameter that lets us inject
// fetch + document + URL, so we don't need to override globals here.
const fetchMock = jest.fn();
global.fetch = fetchMock;

const auditLogService = require("../auditLogService");

const buildOkResponse = (filename) => ({
  ok: true,
  status: 200,
  headers: {
    get: (name) => {
      if (name === "Content-Disposition" && filename) {
        return `attachment; filename="${filename}"`;
      }
      return null;
    },
  },
  blob: () => Promise.resolve(fakeBlob),
});

const buildErrorResponse = (status, errorMessage) => ({
  ok: false,
  status,
  headers: { get: () => null },
  json: () => Promise.resolve({ error: errorMessage }),
  blob: () => Promise.reject(new Error("not used")),
});

beforeEach(() => {
  mockCalls.length = 0;
  mockNextValue = { rows: [{ id: "1" }], total: 1, limit: 50, offset: 0 };
  fetchCalls.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation((url, init) => {
    fetchCalls.push({ url, init });
    return Promise.resolve(buildOkResponse());
  });
  createObjectURL.mockClear();
  createObjectURL.mockImplementation(() => "blob:audit-log-test");
  revokeObjectURL.mockClear();
  fakeAnchor.click.mockClear();
  fakeAnchor.href = "";
  fakeAnchor.download = "";
  fakeAnchor._appended = false;
  fakeDocument._anchors = [];
});

describe("auditLogService.getAuditLog", () => {
  test("strips empty / null / undefined values", async () => {
    const data = await auditLogService.getAuditLog({
      q: "",
      entityType: null,
      method: undefined,
      userEmail: "",
      from: "",
      to: "",
      outcome: "",
      order: "desc",
    });
    expect(data).toEqual(mockNextValue);
    expect(mockCalls).toHaveLength(1);
    const [path, params] = mockCalls[0].args;
    expect(path).toBe("/api/audit-log");
    expect(params).toEqual({ order: "desc" });
  });

  test("forwards meaningful filters + pagination", async () => {
    const data = await auditLogService.getAuditLog({
      q: "plumb",
      entityType: "service",
      method: "PUT",
      userEmail: "admin@",
      from: "2025-01-01",
      to: "2025-12-31",
      outcome: "failed",
      order: "asc",
      limit: 25,
      offset: 50,
    });
    expect(data).toEqual(mockNextValue);
    expect(mockCalls).toHaveLength(1);
    const [, params] = mockCalls[0].args;
    // The service forwards every param straight through. The page passes
    // `entityType` (singular noun) because that's the wire parameter
    // name AND value shape the audit-log route uses to match against
    // audit_log.entity_type.
    expect(params).toEqual({
      q: "plumb",
      entityType: "service",
      method: "PUT",
      userEmail: "admin@",
      from: "2025-01-01",
      to: "2025-12-31",
      outcome: "failed",
      order: "asc",
      limit: 25,
      offset: 50,
    });
  });

  test("defaults limit/offset when not supplied by the caller", async () => {
    await auditLogService.getAuditLog({ q: "x" });
    const [, params] = mockCalls[0].args;
    expect(params.q).toBe("x");
    // getAuditLog doesn't enforce pagination defaults; the page does.
    expect(params.limit).toBeUndefined();
    expect(params.offset).toBeUndefined();
  });
});

describe("auditLogService.exportAuditLogCsv", () => {
  // The auditLogService takes a `deps` object so the test can inject
  // fetch + document + URL. This avoids fighting with jsdom's prototype
  // spy mechanism and keeps the test fully deterministic.
  const makeDeps = () => ({
    fetch: fetchMock,
    document: fakeDocument,
    URL: { createObjectURL, revokeObjectURL },
  });

  test("issues a fetch with format=csv + current filters and triggers a download", async () => {
    fetchMock.mockImplementation((url, init) => {
      fetchCalls.push({ url, init });
      return Promise.resolve(buildOkResponse("audit-log-2026-09-22.csv"));
    });
    const filename = await auditLogService.exportAuditLogCsv(
      {
        q: "rate",
        resource: "services",
        from: "2025-01-01",
        to: "2025-12-31",
      },
      makeDeps()
    );
    expect(filename).toBe("audit-log-2026-09-22.csv");
    expect(fetchCalls).toHaveLength(1);
    const { url, init } = fetchCalls[0];
    expect(url).toContain("/api/audit-log/export?");
    expect(url).toContain("format=csv");
    expect(url).toContain("q=rate");
    expect(url).toContain("resource=services");
    expect(url).toContain("from=2025-01-01");
    expect(url).toContain("to=2025-12-31");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.headers.Accept).toBe("text/csv");
    // Anchor click triggers the download.
    expect(fakeAnchor.click).toHaveBeenCalled();
    expect(fakeAnchor.download).toBe("audit-log-2026-09-22.csv");
    expect(fakeAnchor.href).toBe("blob:audit-log-test");
    expect(createObjectURL).toHaveBeenCalledWith(fakeBlob);
  });

  test("falls back to a default filename when Content-Disposition is missing", async () => {
    fetchMock.mockImplementation((url, init) => {
      fetchCalls.push({ url, init });
      return Promise.resolve(buildOkResponse());
    });
    const filename = await auditLogService.exportAuditLogCsv({}, makeDeps());
    expect(filename).toMatch(/^audit-log-\d+\.csv$/);
  });

  test("rejects with a useful error when the server returns 403", async () => {
    fetchMock.mockImplementation((url, init) => {
      fetchCalls.push({ url, init });
      return Promise.resolve(buildErrorResponse(403, "Audit log access requires an admin role"));
    });
    await expect(auditLogService.exportAuditLogCsv({}, makeDeps())).rejects.toThrow(/admin role/i);
  });

  test("rejects with the HTTP status when the body is not JSON", async () => {
    fetchMock.mockImplementation((url, init) => {
      fetchCalls.push({ url, init });
      return Promise.resolve({
        ok: false,
        status: 500,
        headers: { get: () => null },
        json: () => Promise.reject(new Error("invalid json")),
        blob: () => Promise.reject(new Error("not used")),
      });
    });
    await expect(auditLogService.exportAuditLogCsv({}, makeDeps())).rejects.toThrow(/500/);
  });
});
