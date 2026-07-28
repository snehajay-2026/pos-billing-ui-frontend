/**
 * aiAssistantService.js
 *
 * Drives the in-app Help Chatbot. The service returns *structured* replies
 * so the chat UI can render rich cards, lists, step-by-step guides and
 * inline action chips, instead of just plain text.
 *
 * The bot is fully offline — it only consults the data the page already
 * loaded (invoices + products) plus a knowledge base of how-to guides.
 *
 * Reply shape:
 *   {
 *     text:   "string",                // primary message shown in the bubble
 *     type:   "text" | "summary" | "list" | "guide",
 *     cards:  [{ label, value, tone }],   // for type=summary
 *     items:  [{ label, value }],         // for type=list
 *     steps:  ["Step 1", ...],            // for type=guide
 *     actions:[{ label, path }],          // inline nav buttons
 *     intent: "sales" | ...               // for analytics / follow-up
 *   }
 */

const formatCurrency = (value) => {
  const num = Number(value || 0);
  const hasFraction = Math.round(num * 100) % 100 !== 0;
  return `₹${num.toLocaleString("en-IN", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
};

const formatCount = (value) => Number(value || 0).toLocaleString("en-IN");

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

// ---------------------------------------------------------------------------
// Intent detection — covers both English keywords and Hindi/Marathi.
// ---------------------------------------------------------------------------
const INTENT_RULES = [
  {
    intent: "today_sales",
    patterns: [
      /(today|today's|todays|आज|आजचा|आजची|आजचे|आजच्या)/,
      /(sale|sales|revenue|income|earn|sold|sell|selling|बिक्री|महसूल|कमाई|उत्पन्न)/,
    ],
    both: true,
  },
  {
    intent: "month_sales",
    patterns: [
      /(this month|monthly|महीने|महिना|मासिक|महिन्याचा)/,
      /(sale|sales|revenue|income|बिक्री|महसूल)/,
    ],
    both: true,
  },
  {
    intent: "total_invoices",
    patterns: [/(invoice|invoices|bill|bills|बिल|इनवॉइस|बीजक|चालान)/],
  },
  {
    intent: "low_stock",
    patterns: [/(low stock|out of stock|restock|stock|कमी स्टॉक|स्टॉक|साठा|उपलब्ध)/],
  },
  {
    intent: "top_products",
    patterns: [
      /(top|best|popular|selling|sold most|जास्त|सर्वाधिक|लोकप्रिय)/,
      /(product|item|menu|उत्पाद|आयटम|वस्तू)/,
    ],
    both: true,
  },
  {
    intent: "profit_gst",
    patterns: [/(profit|margin|earnings|gst|tax|नफा|मुनाफा|कर|जीएसटी)/],
  },
  {
    intent: "hotel_bookings",
    patterns: [/(hotel|room|booking|booked|होटल|रूम|कमरा|बुकिंग|आरक्षण)/],
  },
  {
    intent: "table_bookings",
    patterns: [/(table|tables|dining|floor|टेबल|डाइनिंग|भोजन)/],
  },
  {
    intent: "housekeeping",
    patterns: [/(housekeep|cleaning|clean|सफाई|स्वच्छता)/],
  },
  {
    intent: "waiting_list",
    patterns: [/(waiting|queue|wait|प्रतीक्षा|रांग|थांबा)/],
  },
  {
    intent: "menu_help",
    patterns: [/(menu|add item|bulk import|मेनू|आयटम जोडा|जोडणे)/],
  },
  {
    intent: "invoice_help",
    patterns: [/(how do i|how to|कसे|कसा|कशी)/, /(invoice|bill|बिल|इनवॉइस)/],
    both: true,
  },
  {
    intent: "product_help",
    patterns: [/(how do i|how to|कसे|कसा|कशी)/, /(product|item|उत्पाद|आयटम|वस्तू)/],
    both: true,
  },
  {
    intent: "cashflow_help",
    patterns: [/(cash flow|cashflow|expense|profit|पैसा|खर्च|नफा|रोख)/],
  },
  {
    intent: "settings_help",
    patterns: [/(setting|settings|theme|सेटिंग|थीम)/],
  },
  {
    intent: "login_help",
    patterns: [/(login|logout|signin|sign in|signout|लॉगिन|लॉगआउट)/],
  },
  {
    intent: "help",
    patterns: [/(help|what can you|how can you|मदत|काय|काय करू शकता|काय मदत)/],
  },
  {
    intent: "greeting",
    patterns: [/^(hi|hello|hey|namaste|hola|नमस्ते|हाय|हॅलो)/],
  },
  {
    intent: "thanks",
    patterns: [/(thanks|thank you|धन्यवाद|थँक्स)/],
  },
];

const detectIntent = (message = "") => {
  const text = String(message || "")
    .trim()
    .toLowerCase();
  if (!text) return "empty";
  for (const rule of INTENT_RULES) {
    const matched = rule.patterns.every((p) => p.test(text));
    if (matched) return rule.intent;
  }
  return "unknown";
};

// ---------------------------------------------------------------------------
// Data summarizers
// ---------------------------------------------------------------------------
const summarizeInvoicesInRange = (invoices = [], sinceMs) => {
  const filtered = (invoices || []).filter((invoice) => {
    const raw = invoice.date || invoice.createdAt || invoice.invoiceDate;
    if (!raw) return false;
    const ts = new Date(raw).getTime();
    return Number.isFinite(ts) && ts >= sinceMs;
  });
  const totalSales = filtered.reduce(
    (sum, inv) => sum + Number(inv.grandTotal || inv.total || 0),
    0
  );
  const totalGst = filtered.reduce((sum, inv) => sum + Number(inv.gstAmount || inv.gst || 0), 0);
  const count = filtered.length;
  return { count, totalSales, totalGst, invoices: filtered };
};

const summarizeToday = (invoices = []) => summarizeInvoicesInRange(invoices, startOfToday());

const summarizeThisMonth = (invoices = []) => summarizeInvoicesInRange(invoices, startOfMonth());

const findLowStockProducts = (products = []) => {
  return (products || [])
    .map((product) => {
      const stock = Number(product.stock || 0);
      const limit = Number(product.lowStockLimit || product.limit || 0);
      return { product, stock, limit, ratio: limit > 0 ? stock / limit : 1 };
    })
    .filter(({ stock, limit }) => limit > 0 && stock <= limit)
    .sort((a, b) => a.ratio - b.ratio)
    .slice(0, 5)
    .map(({ product, stock, limit }) => ({ product, stock, limit }));
};

const findTopSellingProducts = (invoices = [], limit = 5) => {
  const map = new Map();
  (invoices || []).forEach((invoice) => {
    (invoice.items || []).forEach((item) => {
      const name = String(item.name || "").trim();
      if (!name) return;
      const current = map.get(name) || { name, qty: 0, amount: 0 };
      current.qty += Number(item.qty || 0);
      current.amount += Number(item.total || item.amount || 0);
      map.set(name, current);
    });
  });
  return Array.from(map.values())
    .sort((a, b) => b.qty - a.qty)
    .slice(0, limit);
};

const findRecentHotelBookings = (invoices = []) => {
  return (invoices || [])
    .filter((invoice) => invoice.hotelDetails || invoice.hotelInfo)
    .slice(0, 5)
    .map((invoice) => {
      const hotel = invoice.hotelDetails || invoice.hotelInfo || {};
      return {
        guest: hotel.guestName || "Guest",
        room: hotel.roomNumber || hotel.roomName || "",
        total: Number(invoice.grandTotal || invoice.total || 0),
        when: invoice.date || invoice.createdAt || "",
      };
    });
};

// ---------------------------------------------------------------------------
// Knowledge base — step-by-step guides the bot can serve verbatim.
// Each guide has a unique key + steps + optional actions.
// ---------------------------------------------------------------------------
const GUIDES = {
  invoice: {
    intent: "invoice_help",
    text: "Here's how to create an invoice in POS Helper:",
    steps: [
      "Open the POS page from the sidebar (Hotel Billing / POS Billing).",
      "Click a category on the right, then click a product to add it to the bill.",
      "Adjust quantity with + / − chips and apply any discount if needed.",
      "Choose a payment method (Cash / UPI / Card) and click Generate Invoice.",
      "Print or share the bill with the customer — it's also saved under Invoices.",
    ],
    actions: [
      { label: "Open POS", path: "/pos" },
      { label: "View Invoices", path: "/invoices" },
    ],
  },
  product: {
    intent: "product_help",
    text: "To add a product to your catalog:",
    steps: [
      "Open Products from the sidebar.",
      "Click the + Add Product button on the top-right.",
      "Fill in name, price, GST %, HSN code, and stock quantity.",
      "Save — the product is now available in your POS bill picker.",
    ],
    actions: [
      { label: "Open Products", path: "/products" },
      { label: "Bulk import", path: "/products" },
    ],
  },
  cashflow: {
    intent: "cashflow_help",
    text: "Use the Cash Flow manager to track every rupee:",
    steps: [
      "Open Cash Flow from the sidebar.",
      "Click Add Entry to log a new sale, expense or payout.",
      "Use the date filter to review any range — daily, weekly or monthly.",
      "Export to CSV anytime from the Export button.",
    ],
    actions: [{ label: "Open Cash Flow", path: "/cashflow" }],
  },
  settings: {
    intent: "settings_help",
    text: "Configure your workspace in Store Settings:",
    steps: [
      "Open Store Settings from the sidebar (admin only).",
      "Update store name, phone, address, GSTIN, UPI and invoice footer.",
      "Switch themes anytime using the moon/sun icon in the header.",
      "Add or remove categories under Hotel Operations for hotel stores.",
    ],
    actions: [{ label: "Open Settings", path: "/settings" }],
  },
  login: {
    intent: "login_help",
    text: "Manage your account from the header avatar:",
    steps: [
      "Click your avatar (top-right) to open the user menu.",
      "Choose My Profile to update your name, mobile and address.",
      "Choose Logout to sign out — you'll be redirected to the login page.",
    ],
    actions: [],
  },
  hotel: {
    intent: "hotel_bookings",
    text: "Hotel bookings live inside the Lodging tab:",
    steps: [
      "Open Hotel Billing from the sidebar and switch to the Lodging tab.",
      "Click an empty room card, then choose Quick Book or Edit Booking.",
      "Enter guest details, check-in/out dates and click Save & Sync.",
      "Use Edit Booking any time to update guest info or checkout time.",
    ],
    actions: [
      { label: "Open Hotel Billing", path: "/pos" },
      { label: "Housekeeping", path: "/hotel-housekeeping" },
    ],
  },
  table: {
    intent: "table_bookings",
    text: "Manage dining tables from the Dining tab:",
    steps: [
      "Open Hotel Billing → Dining tab to see the floor map.",
      "Click an empty table card to book it with guest details & party size.",
      "Use the Bulk Import button on the menu page to add many items at once.",
      "Switch the active table by clicking another booked card.",
    ],
    actions: [
      { label: "Open Dining", path: "/pos" },
      { label: "Manage Tables", path: "/hotel-tables" },
      { label: "Hotel Menu", path: "/hotel-dining" },
    ],
  },
  housekeeping: {
    intent: "housekeeping",
    text: "Track room status on the Housekeeping board:",
    steps: [
      "Open Housekeeping from the sidebar.",
      "Mark rooms as Clean, Dirty or Inspected as the team works.",
      "Filter by status to find rooms that need attention.",
    ],
    actions: [{ label: "Open Housekeeping", path: "/hotel-housekeeping" }],
  },
  menu_bulk: {
    intent: "menu_help",
    text: "Bulk-import many menu items in one step:",
    steps: [
      "Open Hotel Menu from the sidebar.",
      "Click Bulk Import on the top-right.",
      "Upload a CSV / XLSX file or download our sample template.",
      "Review the column mapping, then confirm — items are added instantly.",
    ],
    actions: [{ label: "Open Hotel Menu", path: "/hotel-dining" }],
  },
};

// ---------------------------------------------------------------------------
// Reply builder
// ---------------------------------------------------------------------------
const ok = (payload) => ({ ...payload });

const buildSummary = (text, cards) => ok({ text, type: "summary", cards, intent: "summary" });
const buildList = (text, items, intent = "list") => ok({ text, type: "list", items, intent });
const buildGuide = (key) => {
  const guide = GUIDES[key];
  if (!guide) return null;
  return ok({ ...guide, type: "guide" });
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
export const getAiAssistantReply = (message = "", context = {}) => {
  const intent = detectIntent(message);
  const { invoices = [], products = [] } = context;

  // ---- Data-driven replies ----
  if (intent === "today_sales") {
    const { count, totalSales, totalGst } = summarizeToday(invoices);
    return buildSummary(
      count === 0
        ? "No invoices recorded yet today."
        : `Here's today's sales summary for your store.`,
      [
        { label: "Invoices today", value: formatCount(count), tone: count > 0 ? "ok" : "muted" },
        { label: "Total sales", value: formatCurrency(totalSales), tone: "ok" },
        { label: "GST collected", value: formatCurrency(totalGst), tone: "info" },
      ]
    );
  }

  if (intent === "month_sales") {
    const { count, totalSales, totalGst } = summarizeThisMonth(invoices);
    return buildSummary(`Here's how this month is shaping up.`, [
      { label: "Invoices this month", value: formatCount(count), tone: "info" },
      { label: "Total sales", value: formatCurrency(totalSales), tone: "ok" },
      { label: "GST collected", value: formatCurrency(totalGst), tone: "info" },
    ]);
  }

  if (intent === "low_stock") {
    const low = findLowStockProducts(products);
    if (!low.length) {
      return ok({
        text: "Great news — no items are at or below their low-stock limit right now.",
        type: "text",
        intent: "low_stock",
        actions: [{ label: "Open Products", path: "/products" }],
      });
    }
    const items = low.map(({ product, stock, limit }) => ({
      label: product.name || "Item",
      value: `${stock} left (limit ${limit})`,
    }));
    return buildList(
      `Heads up — ${low.length} item(s) are running low. Restock soon:`,
      items,
      "low_stock"
    );
  }

  if (intent === "top_products") {
    const top = findTopSellingProducts(invoices);
    if (!top.length) {
      return ok({
        text: "No sales recorded yet — once invoices come in, I'll show your best-sellers here.",
        type: "text",
        intent: "top_products",
      });
    }
    const items = top.map((p) => ({
      label: p.name,
      value: `${formatCount(p.qty)} sold · ${formatCurrency(p.amount)}`,
    }));
    return buildList("Your top-selling products right now:", items, "top_products");
  }

  if (intent === "profit_gst") {
    const { totalSales, totalGst } = summarizeThisMonth(invoices);
    return ok({
      text:
        totalSales > 0
          ? `This month you've collected ${formatCurrency(totalGst)} in GST and billed ${formatCurrency(totalSales)}. Profit depends on your cost prices — open Cash Flow to log expenses and I'll be able to estimate net profit for you.`
          : "No sales recorded this month yet. Once invoices come in, I'll summarize your GST and profit.",
      type: "text",
      intent: "profit_gst",
      actions: [{ label: "Open Cash Flow", path: "/cashflow" }],
    });
  }

  if (intent === "hotel_bookings") {
    const recent = findRecentHotelBookings(invoices);
    if (!recent.length) {
      return ok({
        text: "I don't see any hotel booking invoices yet. Try booking a room via Hotel Billing → Lodging.",
        type: "text",
        intent: "hotel_bookings",
        actions: [{ label: "Open Hotel Billing", path: "/pos" }],
      });
    }
    const items = recent.map((b) => ({
      label: `${b.guest}${b.room ? ` — ${b.room}` : ""}`,
      value: `${formatCurrency(b.total)}`,
    }));
    return buildList(`Recent hotel bookings:`, items, "hotel_bookings");
  }

  // ---- How-to guides ----
  const guideMap = {
    invoice_help: "invoice",
    product_help: "product",
    cashflow_help: "cashflow",
    settings_help: "settings",
    login_help: "login",
    table_bookings: "table",
    housekeeping: "housekeeping",
    menu_help: "menu_bulk",
  };

  if (intent === "hotel_bookings") {
    return buildGuide("hotel");
  }

  if (guideMap[intent]) {
    return buildGuide(guideMap[intent]);
  }

  // ---- Conversational replies ----
  if (intent === "total_invoices") {
    const count = (invoices || []).length;
    return ok({
      text: `You have ${formatCount(count)} invoice(s) on file. Open the Invoices page to view, search or print any of them.`,
      type: "text",
      intent: "total_invoices",
      actions: [{ label: "Open Invoices", path: "/invoices" }],
    });
  }

  if (intent === "waiting_list") {
    return ok({
      text: "The dining waiting queue lives in the Dining Tables page — open it to add guests, see live wait-time estimates and seat them as tables free up.",
      type: "text",
      intent: "waiting_list",
      actions: [{ label: "Open Dining Tables", path: "/hotel-tables" }],
    });
  }

  if (intent === "greeting") {
    return ok({
      text: "Hi there! 👋 I'm your POS Helper. I can summarize your sales, flag low-stock items, walk you through invoices, products, cash flow, settings — and answer questions about hotel rooms, dining tables and housekeeping.",
      type: "text",
      intent: "greeting",
      actions: [
        { label: "Today's sales", path: "query:today_sales" },
        { label: "Low-stock items", path: "query:low_stock" },
        { label: "How to add a product", path: "query:product_help" },
      ],
    });
  }

  if (intent === "thanks") {
    return ok({
      text: "You're welcome! Let me know if you need anything else.",
      type: "text",
      intent: "thanks",
    });
  }

  if (intent === "help") {
    return ok({
      text: "Here's what I can do for you — just type a keyword or click a quick action below.",
      type: "text",
      intent: "help",
      actions: [
        { label: "Today's sales", path: "query:today_sales" },
        { label: "Top products", path: "query:top_products" },
        { label: "Low stock", path: "query:low_stock" },
        { label: "How to add invoice", path: "query:invoice_help" },
        { label: "How to add product", path: "query:product_help" },
        { label: "Cash flow help", path: "query:cashflow_help" },
        { label: "Store settings", path: "query:settings_help" },
      ],
    });
  }

  // ---- Default fallback ----
  return ok({
    text: "I'm not sure what you mean, but I can help with sales, invoices, products, low stock, top products, cash flow, settings, hotel bookings, tables and housekeeping. Try one of these:",
    type: "text",
    intent: "unknown",
    actions: [
      { label: "Today's sales", path: "query:today_sales" },
      { label: "Top products", path: "query:top_products" },
      { label: "Low stock", path: "query:low_stock" },
      { label: "Add product guide", path: "query:product_help" },
      { label: "Add invoice guide", path: "query:invoice_help" },
      { label: "Store settings", path: "query:settings_help" },
    ],
  });
};

export const __test__ = {
  detectIntent,
  summarizeToday,
  summarizeThisMonth,
  findLowStockProducts,
  findTopSellingProducts,
  GUIDES,
};
