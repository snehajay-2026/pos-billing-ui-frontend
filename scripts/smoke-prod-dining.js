// Production smoke test for the Hotel Dining real-time routes.
// Verifies that the production backend (Render) has the new
// POST /api/hotel/tables/:id/checkout route shipped and that the
// MySQL production database responds. Reads creds from env.
//
// Run: EMAIL=... PASSWORD=... node scripts/smoke-prod-dining.js

const https = require("https");

const BASE = process.env.BASE || "https://pos-billing-server-backend.onrender.com";
const STORE_TYPE = process.env.STORE_TYPE || "hotel";
const STORE_ID = process.env.STORE_ID || "hotel";

function req(method, path, { body, cookies, csrf } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: {
        "Content-Type": "application/json",
        ...(cookies ? { Cookie: cookies } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
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
    if (body !== undefined) r.write(JSON.stringify(body));
    r.end();
  });
}

let pass = 0, fail = 0;
function check(label, cond, detail) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
}

(async () => {
  console.log(`Hotel Dining production smoke @ ${BASE}\n`);

  const root = await req("GET", "/");
  check("backend reachable", root.status === 200, JSON.stringify(root.body));

  const email = process.env.EMAIL || "ajaykodag47@gmail.com";
  const password = process.env.PASSWORD || "Ajay@123";

  const login = await req("POST", "/api/login", {
    body: { email, password },
  });
  check("login HTTP 200", login.status === 200, JSON.stringify(login.body));
  const cookies = (login.headers["set-cookie"] || [])
    .map((c) => c.split(";")[0]).join("; ");
  const csrf = login.body && login.body.csrfToken;
  check("login cookies + csrf present", Boolean(cookies && csrf));
  console.log(`  role=${login.body?.role} storeType=${login.body?.storeType} storeId=${login.body?.storeId}`);

  if (!cookies || !csrf) {
    console.log(`\npassed=${pass} failed=${fail}`);
    process.exit(1);
  }

  // 1) Hotel Lodging: list rooms
  const rooms = await req("GET", `/api/hotel/rooms?storeType=${STORE_TYPE}&storeId=${STORE_ID}`, { cookies });
  check("GET /api/hotel/rooms HTTP 200", rooms.status === 200, JSON.stringify(rooms.body).slice(0, 200));
  const roomList = Array.isArray(rooms.body) ? rooms.body : [];
  console.log(`  rooms count: ${roomList.length}`);

  // 2) Hotel Dining: list tables
  const tables = await req("GET", `/api/hotel/tables?storeType=${STORE_TYPE}&storeId=${STORE_ID}`, { cookies });
  check("GET /api/hotel/tables HTTP 200", tables.status === 200, JSON.stringify(tables.body).slice(0, 200));
  const tableList = Array.isArray(tables.body) ? tables.body : [];
  console.log(`  tables count: ${tableList.length}`);

  // 3) Book T99 — verifies booking row inserts into hotel_bookings
  const book = await req("POST", `/api/hotel/bookings?storeType=${STORE_TYPE}&storeId=${STORE_ID}`, {
    body: {
      kind: "dining",
      tableId: "T99",
      tableName: "Prod Smoke 99",
      zone: "Main",
      partySize: 2,
      guestName: "Prod Guest",
      status: "booked",
    },
    cookies,
    csrf,
  });
  check("POST /api/hotel/bookings (dining T99) HTTP 200", book.status === 200, JSON.stringify(book.body));

  const list = await req("GET", `/api/hotel/bookings?kind=dining&storeType=${STORE_TYPE}&storeId=${STORE_ID}`, { cookies });
  check("GET /api/hotel/bookings (dining) HTTP 200", list.status === 200);
  const t99 = (list.body || []).find((b) => String(b.tableId || b.id) === "T99");
  check("T99 booking persisted in MySQL", Boolean(t99), `bookings tableIds=${JSON.stringify((list.body || []).map((b) => b.tableId))}`);

  // 4) PUT /api/hotel/tables/T99 (route mounted)
  const put = await req("PUT", `/api/hotel/tables/T99?storeType=${STORE_TYPE}&storeId=${STORE_ID}`, {
    body: { id: "T99", name: "Prod Smoke 99", zone: "Main", status: "occupied" },
    cookies,
    csrf,
  });
  check(
    "PUT /api/hotel/tables/T99 returns 200 (route mounted)",
    put.status === 200,
    `status=${put.status} body=${JSON.stringify(put.body).slice(0, 200)}`
  );

  // 5) New POST /api/hotel/tables/T99/checkout
  const ck = await req("POST", `/api/hotel/tables/T99/checkout?storeType=${STORE_TYPE}&storeId=${STORE_ID}`, {
    body: {},
    cookies,
    csrf,
  });
  check(
    "POST /api/hotel/tables/T99/checkout returns 200",
    ck.status === 200,
    `status=${ck.status} body=${JSON.stringify(ck.body).slice(0, 200)}`
  );

  // 6) Confirm cleared
  const list2 = await req("GET", `/api/hotel/bookings?kind=dining&status=booked&storeType=${STORE_TYPE}&storeId=${STORE_ID}`, { cookies });
  const t99still = (list2.body || []).find((b) => String(b.tableId || b.id) === "T99");
  check("T99 no longer in booked overlay after checkout", !t99still, `still=${JSON.stringify(t99still)}`);

  // 7) Lodging parity: book + clear a room using the existing routes
  const roomBook = await req("POST", `/api/hotel/bookings?storeType=${STORE_TYPE}&storeId=${STORE_ID}`, {
    body: {
      kind: "lodging",
      roomId: "L99",
      roomNumber: "Prod Smoke Room 99",
      guestName: "Prod Guest",
      status: "booked",
    },
    cookies,
    csrf,
  });
  check("POST /api/hotel/bookings (lodging L99) HTTP 200", roomBook.status === 200, JSON.stringify(roomBook.body));

  const roomCk = await req("POST", `/api/hotel/rooms/L99/checkout?storeType=${STORE_TYPE}&storeId=${STORE_ID}`, {
    body: {},
    cookies,
    csrf,
  });
  check("POST /api/hotel/rooms/L99/checkout HTTP 200", roomCk.status === 200, JSON.stringify(roomCk.body).slice(0, 200));

  console.log(`\npassed=${pass} failed=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });