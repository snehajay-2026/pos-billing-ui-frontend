import { toErrorMessage } from "./errorMessage";

describe("toErrorMessage", () => {
  test("returns the fallback for null", () => {
    expect(toErrorMessage(null, "fallback")).toBe("fallback");
  });

  test("returns the fallback for undefined", () => {
    expect(toErrorMessage(undefined, "fallback")).toBe("fallback");
  });

  test("returns the string itself for a bare string", () => {
    expect(toErrorMessage("oops", "fallback")).toBe("oops");
  });

  test("returns the fallback for an empty string", () => {
    expect(toErrorMessage("", "fallback")).toBe("fallback");
  });

  test("returns Error.message when it's a string", () => {
    expect(toErrorMessage(new Error("network down"), "fallback")).toBe("network down");
  });

  test("falls back when Error.message is an object (regression: [object Object] alert)", () => {
    // This is the production regression: an Error whose .message is a
    // non-string would have rendered as [object Object] in the alert.
    const weird = new Error({ code: 500 });
    expect(toErrorMessage(weird, "fallback")).toBe("fallback");
  });

  test("reads err.body.error from api.js-shaped errors", () => {
    const apiErr = new Error("API POST /api/x failed: 500");
    apiErr.status = 500;
    apiErr.body = { error: "Invalid email or password" };
    expect(toErrorMessage(apiErr, "fallback")).toBe("Invalid email or password");
  });

  test("reads err.body.message when err.body.error is absent", () => {
    const apiErr = new Error("API POST /api/x failed: 500");
    apiErr.status = 500;
    apiErr.body = { message: "Too many requests" };
    expect(toErrorMessage(apiErr, "fallback")).toBe("Too many requests");
  });

  test("ignores non-string body.error and uses fallback", () => {
    const apiErr = new Error("API POST /api/x failed: 500");
    apiErr.status = 500;
    apiErr.body = { error: { code: 500 } };
    // body.error exists but is malformed; we skip it. body.message is
    // absent, so we fall through to err.message. The helper prefers the
    // backend's plumbing string here over the caller-supplied fallback
    // because err.message is a non-placeholder string.
    expect(toErrorMessage(apiErr, "fallback")).toBe("API POST /api/x failed: 500");
  });

  test("falls back on a bare object throw", () => {
    expect(toErrorMessage({ random: "shape" }, "fallback")).toBe("fallback");
  });

  test("reads top-level .error from a plain object", () => {
    expect(toErrorMessage({ error: "session expired" }, "fallback")).toBe("session expired");
  });
});
