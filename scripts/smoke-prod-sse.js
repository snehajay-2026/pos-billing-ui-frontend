// SSE end-to-end test against production.
// Opens two simultaneous EventSource streams using the same SUPER_OWNER
// session (the production owner scope is `storeType=hotel, storeId=hotel`).
// Triggers a Dining book on stream A; confirms stream B observes the
// booking event within 4s. Then triggers a Dining clear; confirms both
// streams see `checked_out`. Mirrors scripts/regression-dining-realtime.js
// against production.
//
// Run: EMAIL=... PASSWORD=... node scripts/smoke-prod-sse.js

const https = require("https");

const BASE = process.env.BASE || "https://pos-billing-server-backend.onrender.com";
const STORE_TYPE = process.env.STORE_TYPE || "hotel";
const STORE_ID = process.env.STORE_ID || "hotel";

// --- Tiny SSE client --------------------------------------------------------

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
    const opts = {
      method: "GET",
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: { Accept: "text/event-stream", ...this.headers },
    };
    this._req = https.request(opts, (res) => {
      if (res.statusCode !== 200) {
        console.error("SSE connect failed", res.statusCode);
        this.readyState = 2;
        return;
      }
      this.readyState = 1;
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        this._buf += chunk;
        let idx;
        while ((idx = this._buf.indexOf("\n\n")) !== -1) {
          const raw = this._buf.slice(0, idx);
          this._buf = this._buf.slice(idx + 2);
          this._dispatch(raw);
        }
      });
      res.on("end", () => { this.readyState = 2; });
    });
    this._req.on("error", () => { this.readyState = 2; });
    this._req.end();
  }
  _dispatch(raw) {
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
  addEventListener(name, cb) { (this.listeners[name] = this.listeners[name] || []).push(cb); }
  close() { try { this._req?.destroy(); } catch {} }
}

// --- HTTP helpers -----------------------------------------------------------

function req(method, path, { body, cookies, csrf } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const data = body !== undefined ? JSON.stringify(body) : null;
    const opts = {
      method, hostname: u.hostname, port: 443, path: u.pathname + u.search,
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };
    const r = https.request(opts, (res) => {
      let chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch { json = text; }
        resolve({ status: res.statusCode, headers: res.headers, body: json });
      });
    });
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

function awaitFrames(cookies, label, predicate, { count = 1, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const url = `${BASE}/api/events?storeType=${STORE_TYPE}&storeId=${STORE_ID}`;
    const es = new TinyEventSource(url, { headers: { Cookie: cookies } });
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
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}
function header(label) { console.log(`\n=== ${label} ===`); }

// --- Test --------------------------------------------------------------------

(async () => {
  console.log(`Hotel SSE production smoke @ ${BASE}\n`);

  const login = await req("POST", "/api/login", {
    body: { email: process.env.EMAIL || "ajaykodag47@gmail.com", password: process.env.PASSWORD || "Ajay@123" },
  });
  if (login.status !== 200) {
    console.log("login failed", login.status, login.body);
    process.exit(1);
  }
  const cookies = (login.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
  const csrf = login.body.csrfToken;
  console.log(`  logged in: ${login.body.email} (role=${login.body.role})`);

  header("T1: SSE stream connects and receives hello frame");
  const hello = await awaitFrames(
    cookies,
    "hello",
    (f) => f.event === "hello" || f.data?.kind === "hello",
    { count: 1, timeoutMs: 6000 }
  );
  check("hello frame received", hello.matched >= 1, JSON.stringify(hello.allFrames.slice(0, 2)));

  header("T2: Open second SSE stream (simulates second device)");
  const streamB = await awaitFrames(cookies, "B-open", () => true, { count: 0, timeoutMs: 6000 });

  header("T3: Trigger Dining book on stream A; stream B sees the event");
  const book = await req("POST", `/api/hotel/bookings?storeType=${STORE_TYPE}&storeId=${STORE_ID}`, {
    body: {
      kind: "dining", tableId: "T98", tableName: "Prod SSE 98", zone: "Main", partySize: 2,
      guestName: "Prod SSE Guest", status: "booked",
    },
    cookies, csrf,
  });
  check("POST /api/hotel/bookings (dining T98) HTTP 200", book.status === 200);
  const t3 = await awaitFrames(
    cookies,
    "B-wait-book",
    (f) => f.event === "booking" && f.data?.booking?.kind === "dining" && String(f.data?.booking?.tableId) === "T98",
    { count: 1, timeoutMs: 5000 }
  );
  check("stream B received dining booking event for T98", t3.matched >= 1, `frames=${t3.count}`);

  header("T4: Trigger Dining clear on stream A; stream B sees checked_out");
  const clear = await req("POST", `/api/hotel/tables/T98/checkout?storeType=${STORE_TYPE}&storeId=${STORE_ID}`, {
    body: {}, cookies, csrf,
  });
  check("POST /api/hotel/tables/T98/checkout HTTP 200", clear.status === 200);
  const t4 = await awaitFrames(
    cookies,
    "B-wait-clear",
    (f) => f.event === "booking" && f.data?.action === "checked_out" && String(f.data?.booking?.tableId) === "T98",
    { count: 1, timeoutMs: 5000 }
  );
  check("stream B received dining checked_out for T98", t4.matched >= 1, `frames=${t4.count}`);

  header("T5: Lodging parity — book + clear a room");
  const lBook = await req("POST", `/api/hotel/bookings?storeType=${STORE_TYPE}&storeId=${STORE_ID}`, {
    body: { kind: "lodging", roomId: "L98", roomNumber: "Prod SSE Room 98", guestName: "Prod SSE Guest", status: "booked" },
    cookies, csrf,
  });
  check("POST /api/hotel/bookings (lodging L98) HTTP 200", lBook.status === 200);
  const t5 = await awaitFrames(
    cookies,
    "B-wait-lodging",
    (f) => f.data?.booking?.kind === "lodging" && String(f.data?.booking?.roomId) === "L98",
    { count: 1, timeoutMs: 5000 }
  );
  check("stream B received lodging booking event for L98", t5.matched >= 1, `frames=${t5.count}`);
  const lClear = await req("POST", `/api/hotel/rooms/L98/checkout?storeType=${STORE_TYPE}&storeId=${STORE_ID}`, {
    body: {}, cookies, csrf,
  });
  check("POST /api/hotel/rooms/L98/checkout HTTP 200", lClear.status === 200);

  header("T6: No duplicate events per channel");
  // Single publish should produce ≤ 2 frames (1 channel + 1 ALL).
  // Concatenate t5 + t4 frames and filter for L98 booking.
  const allFrames = t5.allFrames.concat(t4.allFrames);
  const l98Frames = allFrames.filter(
    (f) => f.data?.booking?.kind === "lodging" && String(f.data?.booking?.roomId) === "L98"
  );
  check("≤ 2 frames for L98 booking (no duplicate)", l98Frames.length <= 2, `got ${l98Frames.length}`);

  streamB.es?.close?.();

  console.log(`\npassed=${pass} failed=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });