// Stringify any error into a human-readable message.
//
// `api.js` already throws `new Error(body.error || body.message || fallback)`,
// so `err.message` is normally a string. But the catch handlers across the
// app used to write `setError(err.message)` directly — and if anything in
// the chain ever produces an Error whose `.message` is a non-string, or a
// plain object that's been re-thrown, React renders it in the alert as
// `[object Object]`. The user sees a useless alert and can't tell what
// happened.
//
// `toErrorMessage` normalizes every plausible shape:
//   - Error instance: returns `.message` only if it's a non-empty string,
//     otherwise walks to `.body.error` / `.body.message` / fallback.
//   - String: returns it.
//   - Plain object: reads `.message` / `.error` / `.body.error` etc.
//   - null / undefined / anything else: returns the fallback.
//
// Keep the fallback as a required argument so each call site stays
// self-documenting — the user-facing copy for that specific failure mode
// lives next to the call site, not buried in a shared module.

export const toErrorMessage = (err, fallback) => {
  if (err == null) return fallback;

  if (typeof err === "string") return err || fallback;

  // If the response body has a usable error/message string, prefer it —
  // the backend put it there on purpose and it's the user-facing copy
  // we want to show. A malformed body (object/array) is treated as opaque
  // and we skip it rather than leak it.
  if (typeof err.body?.error === "string" && err.body.error) return err.body.error;
  if (typeof err.body?.message === "string" && err.body.message) return err.body.message;

  // Error constructor coerces a non-string argument to "[object Object]".
  // Treat that placeholder as missing — it's never what we want to show.
  const isObjectPlaceholder = (s) => s === "[object Object]";
  if (typeof err.message === "string" && err.message && !isObjectPlaceholder(err.message)) {
    return err.message;
  }

  if (typeof err.error === "string" && err.error) return err.error;

  return fallback;
};
