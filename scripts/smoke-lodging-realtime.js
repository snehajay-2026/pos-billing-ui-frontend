// Lodging smoke test — verifies the existing Lodging real-time flow
// still works after the Dining changes (PUT /api/hotel/tables/:id and
// POST /api/hotel/tables/:id/checkout were added without touching the
// Lodging reducer in HotelBilling.jsx).

const http = require("http");
const { EventSource } = (() => {
  class TinyEventSource {
    constructor(url, { headers } = {}) {
      this.url = url;
      this.headers = headers || {};
      this.listeners = {};
      this._buf = "";
      this._req = null;
      this._connect();
    }
    _connect() {
      const u = new URL(this.url);
      const req = http.request(
        {
          hostname: u.hostname,
          port: u.port,
          path: u.pathname + u.search,
          method: "GET",
          headers: { Accept: "text/event-stream", ...this.headers },
        },
        (res) => {
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            this._buf += chunk;
            let idx;
            while ((idx = this._buf.indexOf("\n\n")) !== -1) {
              const raw = this._buf.slice(0, idx);
              this._buf = this._buf.slice(idx + 2);
              let event = "message", data = "", id = "";
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
              const ev = { data, event, lastEventId: id };
              (this.listeners[event] || []).forEach((cb) => cb(ev));
              if (typeof this.onmessage === "function") this.onmessage(ev);
            }
          });
        }
      );
      req.on("error", () => {});
      this._req = req;
      req.end();
    }
    addEventListener(name, cb) {
      (this.listeners[name] = this.listeners[name] || []).push(cb);
    }
    close() {
      try { this._req?.destroy(); } catch {}
    }
  }
  return { EventSource: TinyEventSource };
})();

const BASE = "http://localhost:4001";
const STORE_TYPE = "hotel";
const STORE_ID = "hotel";

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
          try { json = text ? JSON.parse(text) : null; } catch { json = text; }
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
  const res = await request("POST", "/api/login", { body: { email, password } });
  if (res.status !== 200) throw new Error(`login: ${res.status}`);
  const setCookies = res.headers["set-cookie"] || [];
  const cookieHeader = setCookies.map((c) => c.split(";")[0]).join("; ");
  return {
    cookies: cookieHeader,
    csrf: res.body.csrfToken,
    authed: (method, path, body, params) =>
      request(method, path + (params ? "?" + new URLSearchParams(params) : ""), {
        body,
        cookies: cookieHeader,
        headers: { "X-CSRF-Token": res.body.csrfToken },
      }),
    authedGet: (path, params) =>
      request("GET", path + (params ? "?" + new URLSearchParams(params) : ""), { cookies: cookieHeader }),
  };
}

function awaitFrames(cookies, label, predicate, { count = 1, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
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
    es.onmessage = (ev) => {
      if (settled) return;
      let parsed = null;
      try { parsed = JSON.parse(ev.data); } catch { parsed = { raw: ev.data }; }
      const frame = { event: ev.event, data: parsed };
      allFrames.push(frame);
      if (predicate(frame)) {
        matched += 1;
        if (count > 0 && matched >= count) done();
      }
    };
  });
}

let pass = 0, fail = 0;
const failures = [];
function assert(label, cond, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
  else { fail += 1; failures.push({ label, detail }); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

async function main() {
  console.log("Lodging Smoke Test (verify Dining changes didn't break Lodging)\n");
  const admin = await login("owner@test.in", "Test1234!");
  const cashier = await login("cashier@test.in", "Test1234!");

  // Cleanup any prior L99/L98 bookings
  await admin.authed("POST", "/api/hotel/bookings/checkout-by-ref", {
    kind: "lodging", refId: "L99", storeType: STORE_TYPE, storeId: STORE_ID,
  }, { storeType: STORE_TYPE, storeId: STORE_ID });
  await admin.authed("POST", "/api/hotel/bookings/checkout-by-ref", {
    kind: "lodging", refId: "L98", storeType: STORE_TYPE, storeId: STORE_ID,
  }, { storeType: STORE_TYPE, storeId: STORE_ID });

  console.log("\n=== L1: POST /api/hotel/bookings lodging → SSE upserted ===");
  const cashierStream = await awaitFrames(cashier.cookies, "cashier-L", () => true, { count: 0, timeoutMs: 6000 });
  const bookRes = await admin.authed("POST", "/api/hotel/bookings", {
    kind: "lodging",
    roomId: "L99",
    roomNumber: "Lodging 99",
    guestName: "Lodging Guest",
    customerMobile: "9876543210",
    status: "booked",
  }, { storeType: STORE_TYPE, storeId: STORE_ID });
  assert("lodging bookTable HTTP 200", bookRes.status === 200);
  const w1 = await awaitFrames(cashier.cookies, "L1-wait",
    (f) => f.data?.kind === "booking" && f.data?.booking?.kind === "lodging" && String(f.data?.booking?.roomId) === "L99",
    { count: 1, timeoutMs: 4000 });
  assert("cashier received lodging booking", w1.matched >= 1);
  cashierStream.es?.close?.();

  console.log("\n=== L2: POST /api/hotel/rooms/L99/checkout → SSE checked_out ===");
  const cashierStream2 = await awaitFrames(cashier.cookies, "cashier-L2", () => true, { count: 0, timeoutMs: 6000 });
  const checkRes = await admin.authed("POST", "/api/hotel/rooms/L99/checkout", {},
    { storeType: STORE_TYPE, storeId: STORE_ID });
  assert("lodging checkoutRoom HTTP 200", checkRes.status === 200, JSON.stringify(checkRes.body));
  const w2 = await awaitFrames(cashier.cookies, "L2-wait",
    (f) => f.data?.kind === "booking" && f.data?.action === "checked_out" && String(f.data?.booking?.roomId) === "L99",
    { count: 1, timeoutMs: 4000 });
  assert("cashier received lodging checked_out", w2.matched >= 1);
  cashierStream2.es?.close?.();

  console.log(`\nResults: passed=${pass}, failed=${fail}`);
  if (fail > 0) {
    failures.forEach((f) => console.log(`  - ${f.label}: ${f.detail}`));
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
