// Multi-device regression test for Hotel Dining real-time sync.
//
// Reproduces the Lodging scenario: two clients (Admin + Cashier) connect
// to the SSE stream in the same hotel store, and the test asserts that
// Admin's table-booking / clear-table actions are observed on Cashier's
// stream within a short deadline.
//
// Run: `node scripts/regression-dining-realtime.js`
//
// Requires:
//   - Backend running on http://localhost:4001
//   - MySQL on 127.0.0.1:3307 with the schema bootstrapped
//   - The two test users (owner@test.in / cashier@test.in) seeded.

const http = require("http");
const https = require("https");
const { EventSource } = (() => {
  // Native EventSource isn't in Node — fall back to a tiny SSE client
  // built on http/https that yields the same `onmessage` / typed
  // addEventListener shape the test expects.
  class TinyEventSource {
    constructor(url, { headers } = {}) {
      this.url = url;
      this.headers = headers || {};
      this.listeners = { message: [], hello: [], booking: [], hotel: [], live_bill: [], invoice: [], stock: [] };
      this.lastEventId = "";
      this.readyState = 0;
      this._req = null;
      this._buf = "";
      this._connect();
    }
    _connect() {
      const u = new URL(this.url);
      const mod = u.protocol === "https:" ? https : http;
      this._req = mod.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: "GET",
          headers: { Accept: "text/event-stream", ...this.headers },
        },
        (res) => {
          if (res.statusCode !== 200) {
            this.readyState = 2;
            return;
          }
          this.readyState = 1;
          res.setEncoding("utf8");
          res.on("data", (chunk) => this._onChunk(chunk));
          res.on("end", () => {
            this.readyState = 2;
          });
        }
      );
      this._req.on("error", () => {
        this.readyState = 2;
      });
      this._req.end();
    }
    _onChunk(chunk) {
      this._buf += chunk;
      let idx;
      while ((idx = this._buf.indexOf("\n\n")) !== -1) {
        const raw = this._buf.slice(0, idx);
        this._buf = this._buf.slice(idx + 2);
        this._dispatch(raw);
      }
    }
    _dispatch(raw) {
      let event = "message";
      let data = "";
      let id = this.lastEventId;
      for (const line of raw.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        if (colon === -1) continue;
        const field = line.slice(0, colon);
        let val = line.slice(colon + 1);
        if (val.startsWith(" ")) val = val.slice(1);
        if (field === "event") event = val;
        else if (field === "data") data += (data ? "\n" : "") + val;
        else if (field === "id") id = val;
      }
      this.lastEventId = id;
      const ev = { data, event, lastEventId: id };
      (this.listeners[event] || []).forEach((cb) => cb(ev));
      (this.listeners.message || []).forEach((cb) => cb(ev));
      if (typeof this.onmessage === "function") this.onmessage(ev);
    }
    addEventListener(name, cb) {
      (this.listeners[name] = this.listeners[name] || []).push(cb);
    }
    close() {
      try {
        this._req?.destroy();
      } catch {}
      this.readyState = 2;
    }
  }
  return { EventSource: TinyEventSource };
})();

const BASE = "http://localhost:4001";
const STORE_TYPE = "hotel";
const STORE_ID = "hotel";

// --- HTTP helpers ------------------------------------------------------------

function request(method, path, { body, headers, cookies } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE + path);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(cookies ? { Cookie: cookies } : {}),
          ...(headers || {}),
        },
      },
      (res) => {
        let chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = text;
          }
          resolve({ status: res.statusCode, headers: res.headers, body: json });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function login(email, password) {
  // Login sets the session cookie + XSRF-TOKEN cookie. The CSRF token
  // must be echoed in `X-CSRF-Token` on every non-GET call.
  const res = await request("POST", "/api/login", { body: { email, password } });
  if (res.status !== 200) {
    throw new Error(`login(${email}) → ${res.status}: ${JSON.stringify(res.body)}`);
  }
  const setCookies = res.headers["set-cookie"] || [];
  const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
  const csrf = res.body.csrfToken;
  if (!cookieHeader || !csrf) {
    throw new Error(`login(${email}) missing cookie/csrf: ${JSON.stringify(res.headers)}`);
  }
  return {
    cookies: cookieHeader,
    csrf,
    user: res.body,
    authedGet: (path, params) =>
      request("GET", path + (params ? "?" + new URLSearchParams(params) : ""), {
        cookies: cookieHeader,
      }),
    authed: (method, path, body, params) => {
      const qs = params ? "?" + new URLSearchParams(params) : "";
      return request(method, path + qs, {
        body,
        cookies: cookieHeader,
        headers: { "X-CSRF-Token": csrf },
      });
    },
  };
}

// --- SSE helpers -------------------------------------------------------------

// Track every frame seen on a stream. Resolve `predicate(event)` once
// it returns true, or reject after `timeoutMs`.
function openSseStream(cookies, label, predicate, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}/api/events?storeType=${STORE_TYPE}&storeId=${STORE_ID}`;
    const es = new EventSource(url, {
      headers: { Cookie: cookies },
    });
    const allFrames = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      es.close();
      reject(new Error(`[${label}] timed out waiting for predicate after ${timeoutMs}ms`));
    }, timeoutMs);
    const onMessage = (ev) => {
      if (settled) return;
      let parsed = null;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        parsed = { raw: ev.data };
      }
      const frame = { event: ev.event, data: parsed, id: ev.lastEventId };
      allFrames.push(frame);
      try {
        if (predicate(frame)) {
          settled = true;
          clearTimeout(timer);
          es.close();
          resolve({ matched: frame, allFrames });
        }
      } catch (e) {
        // ignore predicate errors
      }
    };
    // TinyEventSource routes all events through `message` and typed
    // listeners. Use onmessage to catch everything (the `event` field
    // carries the typed name).
    es.onmessage = onMessage;
  });
}

// Wait until the predicate is true OR `count` matching frames arrive
// within `timeoutMs`. Returns {matched, count, allFrames}.
function awaitFrames(cookies, label, predicate, { count = 1, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = `${BASE}/api/events?storeType=${STORE_TYPE}&storeId=${STORE_ID}`;
    const es = new EventSource(url, { headers: { Cookie: cookies } });
    const allFrames = [];
    let matched = 0;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      es.close();
      resolve({ es, matched, count: allFrames.length, allFrames });
    };
    const timer = setTimeout(done, timeoutMs);
    const onMessage = (ev) => {
      if (settled) return;
      let parsed = null;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        parsed = { raw: ev.data };
      }
      const frame = { event: ev.event, data: parsed, id: ev.lastEventId };
      allFrames.push(frame);
      if (predicate(frame)) {
        matched += 1;
        if (count > 0 && matched >= count) {
          done();
        }
      }
    };
    es.onmessage = onMessage;
  });
}

// --- Test harness ------------------------------------------------------------

let pass = 0;
let fail = 0;
const failures = [];

function assert(label, cond, detail) {
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${label}`);
  } else {
    fail += 1;
    failures.push({ label, detail });
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function header(label) {
  console.log(`\n=== ${label} ===`);
}

async function clearTablesForTest(admin, cashier) {
  // Wipe any state from prior runs.
  await admin.authed("DELETE", "/api/hotel/dining-bills/T99", undefined, {
    storeType: STORE_TYPE,
    storeId: STORE_ID,
  });
  await admin.authed("POST", "/api/hotel/bookings/checkout-by-ref", {
    kind: "dining",
    refId: "T99",
    storeType: STORE_TYPE,
    storeId: STORE_ID,
  }, { storeType: STORE_TYPE, storeId: STORE_ID });
  await admin.authed("DELETE", "/api/hotel/dining-bills/T98", undefined, {
    storeType: STORE_TYPE,
    storeId: STORE_ID,
  });
  await admin.authed("POST", "/api/hotel/bookings/checkout-by-ref", {
    kind: "dining",
    refId: "T98",
    storeType: STORE_TYPE,
    storeId: STORE_ID,
  }, { storeType: STORE_TYPE, storeId: STORE_ID });
}

async function main() {
  console.log("Hotel Dining Real-Time Sync Regression Test\n");

  header("Setup: log in Admin + Cashier");
  const admin = await login("owner@test.in", "Test1234!");
  console.log(`  admin: ${admin.user.email} (role=${admin.user.role})`);
  const cashier = await login("cashier@test.in", "Test1234!");
  console.log(`  cashier: ${cashier.user.email} (role=${cashier.user.role})`);

  await clearTablesForTest(admin, cashier);

  header("T1: Cashier connects to SSE, receives hello frame");
  const cashierStream = await openSseStream(
    cashier.cookies,
    "cashier",
    (f) => f.event === "hello",
    5000
  );
  assert("hello frame received", cashierStream.matched?.event === "hello");

  header("T2: Admin books Table T99 — Cashier sees dining booking event");
  const bookWait = awaitFrames(
    cashier.cookies,
    "cashier-book",
    (f) =>
      f.event === "booking" &&
      f.data?.kind === "booking" &&
      f.data?.booking?.kind === "dining" &&
      String(f.data?.booking?.tableId || f.data?.booking?.id) === "T99",
    { count: 1, timeoutMs: 5000 }
  );
  const bookAction = await admin.authed(
    "POST",
    "/api/hotel/bookings",
    {
      kind: "dining",
      tableId: "T99",
      tableName: "Test Table 99",
      zone: "Main",
      partySize: 2,
      guestName: "Test Guest",
      customerMobile: "9876543210",
      orderSummary: "2x Coffee",
      orderedMenuItems: [{ productId: "p1", name: "Coffee", qty: 2 }],
      status: "booked",
    },
    { storeType: STORE_TYPE, storeId: STORE_ID }
  );
  assert("bookTable HTTP 200", bookAction.status === 200, JSON.stringify(bookAction.body));
  // Wait for the resulting SSE frame on cashier
  const check = await awaitFrames(
    cashier.cookies,
    "cashier-book-wait",
    (f) =>
      f.event === "booking" &&
      f.data?.kind === "booking" &&
      f.data?.booking?.kind === "dining" &&
      String(f.data?.booking?.tableId || f.data?.booking?.id) === "T99",
    { count: 1, timeoutMs: 5000 }
  );
  assert("cashier received dining booking event", check.matched >= 1);

  header("T3: Admin adds a bill item — Cashier sees live_bill_updated");
  // Open cashier SSE FIRST so we don't miss the live_bill_updated event
  // (T3 fires the PUT right after; awaitFrames opens the stream at the
  // start of T3).
  const cashierBillStream = await awaitFrames(
    cashier.cookies,
    "cashier-bill-stream",
    () => true,
    { count: 0, timeoutMs: 6000 }
  );
  // Fire the PUT (the SSE listener will catch the event in flight)
  const billRes = await admin.authed(
    "PUT",
    "/api/hotel/dining-bills/T99",
    {
      tableId: "T99",
      tableName: "Test Table 99",
      guestName: "Test Guest",
      items: [{ id: "i1", name: "Coffee", qty: 2, rate: 100, total: 200, type: "dining" }],
    },
    { storeType: STORE_TYPE, storeId: STORE_ID }
  );
  assert("saveDiningBill HTTP 200", billRes.status === 200);
  // Wait for the live_bill_updated frame to arrive (max 4s)
  const liveBillWait = await awaitFrames(
    cashier.cookies,
    "cashier-bill-wait",
    (f) =>
      f.data?.kind === "live_bill" &&
      f.data?.action === "live_bill_updated" &&
      String(f.data?.data?.tableId) === "T99",
    { count: 1, timeoutMs: 4000 }
  );
  assert("cashier received live_bill_updated", liveBillWait.matched >= 1, `got ${liveBillWait.matched} live_bill frames`);
  cashierBillStream.es?.close?.();

  header("T4: Admin clears Table T99 — Cashier sees booking.checked_out");
  const clearRes = await admin.authed(
    "POST",
    "/api/hotel/tables/T99/checkout",
    {},
    { storeType: STORE_TYPE, storeId: STORE_ID }
  );
  assert("checkoutTable HTTP 200", clearRes.status === 200, JSON.stringify(clearRes.body));
  const clearCheck = await awaitFrames(
    cashier.cookies,
    "cashier-clear",
    (f) =>
      f.event === "booking" &&
      f.data?.kind === "booking" &&
      f.data?.action === "checked_out" &&
      String(f.data?.booking?.tableId || f.data?.booking?.id) === "T99",
    { count: 1, timeoutMs: 5000 }
  );
  assert("cashier received booking.checked_out", clearCheck.matched >= 1);

  header("T5: Cashier books Table T98 — Admin sees dining booking event");
  const adminStream = await openSseStream(
    admin.cookies,
    "admin",
    (f) => f.event === "hello",
    5000
  );
  assert("admin received hello", adminStream.matched?.event === "hello");
  const cashierBookRes = await cashier.authed(
    "POST",
    "/api/hotel/bookings",
    {
      kind: "dining",
      tableId: "T98",
      tableName: "Test Table 98",
      zone: "Window",
      partySize: 4,
      guestName: "Reverse Guest",
      customerMobile: "9876543211",
      status: "booked",
    },
    { storeType: STORE_TYPE, storeId: STORE_ID }
  );
  assert("cashier bookTable HTTP 200", cashierBookRes.status === 200);
  const adminSees = await awaitFrames(
    admin.cookies,
    "admin-cashier-book",
    (f) =>
      f.event === "booking" &&
      f.data?.kind === "booking" &&
      f.data?.booking?.kind === "dining" &&
      String(f.data?.booking?.tableId || f.data?.booking?.id) === "T98",
    { count: 1, timeoutMs: 5000 }
  );
  assert("admin sees cashier's booking", adminSees.matched >= 1);

  header("T6: Cashier clears Table T98 — Admin sees booking.checked_out");
  const cashierClearRes = await cashier.authed(
    "POST",
    "/api/hotel/tables/T98/checkout",
    {},
    { storeType: STORE_TYPE, storeId: STORE_ID }
  );
  assert("cashier checkoutTable HTTP 200", cashierClearRes.status === 200);
  const adminSeesClear = await awaitFrames(
    admin.cookies,
    "admin-cashier-clear",
    (f) =>
      f.event === "booking" &&
      f.data?.kind === "booking" &&
      f.data?.action === "checked_out" &&
      String(f.data?.booking?.tableId || f.data?.booking?.id) === "T98",
    { count: 1, timeoutMs: 5000 }
  );
  assert("admin sees cashier's clear", adminSeesClear.matched >= 1);

  header("T7: No duplicate events per channel per publish");
  // The hub fans out to (channel + ALL). So a single publish produces
  // AT MOST 2 frames per subscriber (one on bookings:hotel:hotel,
  // one on *). More than 2 = duplicate bug.
  const allFrames = adminSeesClear.allFrames.concat(adminSees.allFrames);
  const clearFrames = allFrames.filter(
    (f) =>
      f.event === "booking" &&
      f.data?.kind === "booking" &&
      f.data?.action === "checked_out" &&
      String(f.data?.booking?.tableId || f.data?.booking?.id) === "T98"
  );
  assert(
    "≤ 2 frames for T98 checked_out (1 channel + 1 ALL)",
    clearFrames.length <= 2,
    `got ${clearFrames.length}`
  );

  header("T8: Bookings overlay reflects cleared state");
  const overlayRes = await cashier.authedGet("/api/hotel/bookings", {
    kind: "dining",
    status: "booked",
    storeType: STORE_TYPE,
    storeId: STORE_ID,
  });
  assert("overlay HTTP 200", overlayRes.status === 200);
  const stillBooked = (overlayRes.body || []).filter(
    (b) => String(b.tableId || b.id) === "T99" || String(b.tableId || b.id) === "T98"
  );
  assert(
    "neither T99 nor T98 in booked overlay",
    stillBooked.length === 0,
    `still booked: ${JSON.stringify(stillBooked.map((b) => b.tableId))}`
  );

  header("T9: Store isolation — event carries correct storeType/storeId");
  // When Admin books T97, the event must carry storeType=hotel and
  // storeId=hotel. A retail dashboard listening on a different scope
  // should never see this event appear with mutated retail state.
  const isolationStream = await awaitFrames(
    cashier.cookies,
    "cashier-iso",
    () => true,
    { count: 0, timeoutMs: 6000 }
  );
  const isoRes = await admin.authed(
    "POST",
    "/api/hotel/bookings",
    {
      kind: "dining",
      tableId: "T97",
      tableName: "Test Table 97",
      zone: "Main",
      partySize: 2,
      guestName: "Isolation Guest",
      status: "booked",
    },
    { storeType: STORE_TYPE, storeId: STORE_ID }
  );
  assert("isolation bookTable HTTP 200", isoRes.status === 200);
  // Wait for the event to arrive
  const isoEventWait = await awaitFrames(
    cashier.cookies,
    "cashier-iso-wait",
    (f) =>
      f.data?.kind === "booking" &&
      f.data?.booking?.kind === "dining" &&
      String(f.data?.booking?.tableId || f.data?.booking?.id) === "T97",
    { count: 1, timeoutMs: 4000 }
  );
  const isoEvent = isoEventWait.matched >= 1 ? isoEventWait.allFrames.filter(
    (f) =>
      f.data?.kind === "booking" &&
      f.data?.booking?.kind === "dining" &&
      String(f.data?.booking?.tableId || f.data?.booking?.id) === "T97"
  )[0] : null;
  assert("isolation event arrived", isoEventWait.matched >= 1);
  assert(
    "event.storeType is 'hotel'",
    isoEvent?.data?.storeType === "hotel",
    `got storeType=${isoEvent?.data?.storeType}`
  );
  assert(
    "event.storeId is 'hotel'",
    isoEvent?.data?.storeId === "hotel",
    `got storeId=${isoEvent?.data?.storeId}`
  );
  assert(
    "event.channel is bookings:hotel:hotel",
    isoEvent?.data?.channel === "bookings:hotel:hotel",
    `got channel=${isoEvent?.data?.channel}`
  );
  // Cleanup the isolated booking so the next run starts clean.
  await admin.authed(
    "POST",
    "/api/hotel/tables/T97/checkout",
    {},
    { storeType: STORE_TYPE, storeId: STORE_ID }
  );
  isolationStream.es?.close?.();

  header("Results");
  console.log(`  passed: ${pass}`);
  console.log(`  failed: ${fail}`);
  if (fail > 0) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f.label}: ${f.detail}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Test crashed:", err);
  process.exit(2);
});
