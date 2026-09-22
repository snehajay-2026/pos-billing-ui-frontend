// Industry-specific invoice template registry for the Service Store.
//
// Every invoice in the Service Store (or MSME-Service vertical) can opt into
// one of these templates. The pick is per-invoice, not per-store, so a
// multi-business consultant can switch industries mid-session without
// changing store-wide defaults.
//
// Architecture:
//   - INDUSTRIES   — the list of 16 industry verticals the cashier can pick
//                    from in the Service Billing screen. Each entry has an
//                    icon, accent colour, group, and the field set that the
//                    template renderer is allowed to surface.
//   - FAMILIES     — three visual renderer families. Adding a new visual
//                    layout is one new family + one new renderer component;
//                    industries reuse the nearest existing family.
//   - TEMPLATES    — one entry per industry + family combination. A template
//                    points at a family, an accent, a section list, and an
//                    optional compliance note that appears between totals
//                    and terms on the printed invoice.
//   - resolveTemplate(invoice) — pulls the templateId from the invoice
//                    (saved at billing time on items[0].meta) and returns
//                    the matching template, or the legacy default.
//   - fieldConfigFor(industry) — returns the field set the cashier's
//                    industry-fields drawer should expose.
//
// The registry is pure data + a couple of small helpers; it does not import
// React, the renderer components, or store settings. That keeps the
// registry safe to import from any caller (including server-shaped tooling
// and tests) without dragging a component graph along for the ride.

export const INDUSTRY_GROUPS = [
  { id: "services", label: "Professional Services" },
  { id: "goods", label: "Goods & Trade" },
  { id: "health", label: "Health & Hospitality" },
  { id: "compliance", label: "Compliance-Heavy" },
];

// Visual renderer families. Each renderer component owns one family and
// picks a section ordering from the template's `sections` array.
export const FAMILIES = {
  modern: {
    id: "modern",
    label: "Modern A4",
    renderer: "ModernA4",
    description: "Wide A4 with hero block, two-column meta band, and totals card.",
  },
  traditional: {
    id: "traditional",
    label: "Traditional A4",
    renderer: "TraditionalA4",
    description: "Denser A4 with full GST column table, suited for goods & compliance.",
  },
  condensed: {
    id: "condensed",
    label: "Condensed Receipt",
    renderer: "CondensedReceipt",
    description: "Single-column receipt for thermal printers and short-form bills.",
  },
};

// Per-industry field configuration. Each field is opt-in: leaving it blank
// does not block invoice save. `key` is the camelCase key the renderer
// reads off `invoice.fields` (which itself rides on `items[0].meta`).
//
// `required` (F10): marks fields that the Service Catalog form must have
// a non-empty value before the backend will accept a save. The brief's
// section 10 requires backend validation, so the same set of keys is
// mirrored at db/queries/services.js:REQUIRED_FIELDS_BY_INDUSTRY. Today
// only the most obviously-must-have keys carry the marker; the form
// shows a red `*` next to the label and the backend returns a 400 with
// the missing list if any are blank.
const FIELDS = {
  // ---- Services family ----
  consulting: [
    {
      key: "engagementRef",
      label: "Engagement Ref",
      placeholder: "MSA-2026-014",
      type: "text",
      required: true,
    },
    { key: "consultantName", label: "Consultant", placeholder: "Jane Doe", type: "text" },
    { key: "engagementPeriod", label: "Engagement Period", placeholder: "May 2026", type: "text" },
  ],
  technology: [
    { key: "projectCode", label: "Project Code", placeholder: "PRJ-1042", type: "text" },
    { key: "milestone", label: "Milestone", placeholder: "Phase 2 — Beta release", type: "text" },
    {
      key: "subscriptionPeriod",
      label: "Subscription Period",
      placeholder: "01 May — 30 Apr",
      type: "text",
    },
    { key: "supportTier", label: "Support Tier", placeholder: "Platinum", type: "text" },
  ],
  startup: [
    { key: "founderName", label: "Founder / Signatory", placeholder: "Founder name", type: "text" },
    {
      key: "incorporationNo",
      label: "Incorporation No",
      placeholder: "U74999MH2024PTC123456",
      type: "text",
    },
  ],
  realestate: [
    { key: "agreementRef", label: "Agreement Ref", placeholder: "AGR-2026-009", type: "text" },
    {
      key: "propertyAddress",
      label: "Property Address",
      placeholder: "Flat 3B, Sea Breeze Towers",
      type: "textarea",
    },
    {
      key: "servicePeriod",
      label: "Service Period",
      placeholder: "01 May — 31 May 2026",
      type: "text",
    },
    {
      key: "stampDutyNote",
      label: "Stamp Duty Note",
      placeholder: "Stamp duty payable by buyer",
      type: "text",
    },
  ],
  education: [
    { key: "studentName", label: "Student Name", placeholder: "Student name", type: "text" },
    {
      key: "courseName",
      label: "Course / Program",
      placeholder: "B.Sc. Computer Science",
      type: "text",
      required: true,
    },
    { key: "batch", label: "Batch / Term", placeholder: "2026-29", type: "text" },
    { key: "rollNo", label: "Roll No", placeholder: "CS-2026-014", type: "text" },
  ],
  nonprofit: [
    {
      key: "donorName",
      label: "Donor Name",
      placeholder: "Donor name",
      type: "text",
      required: true,
    },
    { key: "donorPan", label: "Donor PAN", placeholder: "AAACR1234R", type: "text" },
    { key: "panOfDonee", label: "PAN of Donee", placeholder: "AAACD1234E", type: "text" },
    {
      key: "eightyGReference",
      label: "80G Reference",
      placeholder: "AAACD1234EF20231",
      type: "text",
    },
    { key: "donationType", label: "Donation Type", placeholder: "General Fund", type: "text" },
  ],

  // ---- Goods & Trade family ----
  manufacturing: [
    {
      key: "poNumber",
      label: "PO Number",
      placeholder: "PO-2026-041",
      type: "text",
      required: true,
    },
    {
      key: "packing",
      label: "Packing & Forwarding",
      placeholder: "Optional ₹ amount",
      type: "text",
    },
    {
      key: "eWayBillNote",
      label: "e-Way Bill Note",
      placeholder: "Required for invoices ≥ ₹50,000",
      type: "text",
    },
  ],
  wholesale: [
    {
      key: "poNumber",
      label: "PO Number",
      placeholder: "PO-2026-041",
      type: "text",
      required: true,
    },
    { key: "creditNoteRef", label: "Credit Note Ref", placeholder: "CN-2026-007", type: "text" },
    { key: "placeOfSupply", label: "Place of Supply", placeholder: "27-Maharashtra", type: "text" },
  ],
  distributors: [
    { key: "distributorCode", label: "Distributor Code", placeholder: "DST-04", type: "text" },
    { key: "route", label: "Route", placeholder: "Mumbai-Pune-Nashik", type: "text" },
    { key: "vehicleNo", label: "Vehicle No", placeholder: "MH-12-AB-1234", type: "text" },
    {
      key: "reverseChargeNote",
      label: "Reverse Charge Note",
      placeholder: "Yes / No",
      type: "text",
    },
  ],
  hardware: [
    {
      key: "poNumber",
      label: "PO Number",
      placeholder: "PO-2026-041",
      type: "text",
      required: true,
    },
    { key: "modelNo", label: "Model No", placeholder: "MX-204", type: "text" },
    { key: "serialNo", label: "Serial No", placeholder: "SN-12345678", type: "text" },
    { key: "warrantyMonths", label: "Warranty (months)", placeholder: "12", type: "text" },
    {
      key: "warrantyNote",
      label: "Warranty Note",
      placeholder: "Warranty void if seal broken",
      type: "text",
    },
  ],
  trading: [
    {
      key: "poNumber",
      label: "PO Number",
      placeholder: "PO-2026-041",
      type: "text",
      required: true,
    },
    { key: "placeOfSupply", label: "Place of Supply", placeholder: "27-Maharashtra", type: "text" },
    { key: "tcsSection", label: "TCS Section", placeholder: "206C(1H)", type: "text" },
    {
      key: "tcsNote",
      label: "TCS Note",
      placeholder: "TCS applicable over ₹50 lakh",
      type: "text",
    },
  ],
  construction: [
    { key: "workOrderRef", label: "Work Order Ref", placeholder: "WO-2026-014", type: "text" },
    { key: "milestone", label: "Milestone", placeholder: "Foundation complete", type: "text" },
    { key: "retentionPct", label: "Retention %", placeholder: "5", type: "text" },
    { key: "tdsNote", label: "TDS Note", placeholder: "TDS u/s 194C deductible", type: "text" },
  ],
  agriculture: [
    { key: "commodity", label: "Commodity", placeholder: "Soybean", type: "text" },
    { key: "grade", label: "Grade", placeholder: "FAQ", type: "text" },
    { key: "quantityKg", label: "Quantity (kg)", placeholder: "1200", type: "text" },
    { key: "mandiName", label: "Mandi / Market", placeholder: "Latur APMC", type: "text" },
    { key: "marketFeeNote", label: "Market Fee", placeholder: "₹120", type: "text" },
  ],

  // ---- Health & Hospitality family ----
  healthcare: [
    {
      key: "patientId",
      label: "Patient ID",
      placeholder: "P-2026-014",
      type: "text",
      required: true,
    },
    { key: "doctor", label: "Doctor", placeholder: "Dr. Jane Doe", type: "text" },
    {
      key: "consultationDate",
      label: "Consultation Date",
      placeholder: "2026-05-14",
      type: "date",
    },
    { key: "department", label: "Department", placeholder: "General Medicine", type: "text" },
  ],
  foodbeverage: [
    { key: "tableNo", label: "Table No", placeholder: "T-04", type: "text" },
    { key: "covers", label: "Covers", placeholder: "2", type: "text" },
    {
      key: "orderType",
      label: "Order Type",
      placeholder: "Dine-in / Takeaway / Delivery",
      type: "text",
    },
    {
      key: "fssaiNote",
      label: "FSSAI Note",
      placeholder: "Licence No 12345678901234",
      type: "text",
    },
  ],
  logistics: [
    { key: "lrNo", label: "LR / GR No", placeholder: "LR-2026-014", type: "text", required: true },
    { key: "vehicleNo", label: "Vehicle No", placeholder: "MH-12-AB-1234", type: "text" },
    { key: "fromCity", label: "From", placeholder: "Mumbai", type: "text" },
    { key: "toCity", label: "To", placeholder: "Pune", type: "text" },
    { key: "ewayBillNo", label: "e-Way Bill No", placeholder: "EWB-123456789012", type: "text" },
    { key: "consignor", label: "Consignor", placeholder: "Consignor name", type: "text" },
    { key: "consignee", label: "Consignee", placeholder: "Consignee name", type: "text" },
  ],

  // ---- Compliance-heavy family ----
  agricultureCompliance: [], // placeholder; covered above by `agriculture`
};

// Required-field keys per industry, derived from `required: true` flags
// in FIELDS. Kept as a single source of truth so the catalog form, the
// billing seed, and the backend validator all read the same shape. The
// backend has its own mirror at db/queries/services.js:
// REQUIRED_FIELDS_BY_INDUSTRY — both lists must stay in lock-step. Any
// time a registry field gains `required: true` here, the mirror in the
// backend has to grow too (the runtime-migrations test suite has a
// regression to pin this).
export const requiredFieldsFor = (industryId) => {
  const list = FIELDS[industryId] || [];
  return list.filter((f) => f && f.required).map((f) => f.key);
};

// All 16 industries. Order matters — the picker groups them by `group` and
// renders inside that group.
export const INDUSTRIES = [
  // Services
  { id: "consulting", label: "Consulting", group: "services", icon: "💼", accent: "#4338ca" },
  { id: "technology", label: "Technology", group: "services", icon: "💻", accent: "#0ea5e9" },
  { id: "startup", label: "Startups", group: "services", icon: "🚀", accent: "#7c3aed" },
  { id: "realestate", label: "Real Estate", group: "services", icon: "🏠", accent: "#0f766e" },
  { id: "education", label: "Education", group: "services", icon: "🎓", accent: "#b45309" },
  { id: "nonprofit", label: "Non-Profit", group: "services", icon: "🤝", accent: "#15803d" },

  // Goods & Trade
  { id: "manufacturing", label: "Manufacturing", group: "goods", icon: "🏭", accent: "#1d4ed8" },
  { id: "wholesale", label: "Wholesale & Retail", group: "goods", icon: "🛒", accent: "#0369a1" },
  { id: "distributors", label: "Distributors", group: "goods", icon: "🚚", accent: "#0e7490" },
  { id: "hardware", label: "Hardware", group: "goods", icon: "🖥️", accent: "#4338ca" },
  { id: "trading", label: "Trading", group: "goods", icon: "📈", accent: "#be123c" },
  { id: "construction", label: "Construction", group: "goods", icon: "🏗️", accent: "#b45309" },
  { id: "agriculture", label: "Agriculture", group: "goods", icon: "🌾", accent: "#15803d" },

  // Health & Hospitality
  { id: "healthcare", label: "Healthcare", group: "health", icon: "🏥", accent: "#be123c" },
  { id: "foodbeverage", label: "Food & Beverage", group: "health", icon: "🍽️", accent: "#92400e" },
  {
    id: "logistics",
    label: "Logistics & Transport",
    group: "health",
    icon: "📦",
    accent: "#1e3a8a",
  },
];

const TEMPLATES_BY_INDUSTRY = {
  consulting: {
    family: "modern",
    sections: [
      "hero",
      "meta",
      "billTo",
      "servicePeriod",
      "engagement",
      "lineItems",
      "compliance",
      "totals",
      "terms",
      "signature",
      "footer",
    ],
  },
  technology: {
    family: "modern",
    sections: [
      "hero",
      "meta",
      "billTo",
      "servicePeriod",
      "project",
      "lineItems",
      "compliance",
      "totals",
      "terms",
      "signature",
      "footer",
    ],
  },
  startup: {
    family: "modern",
    sections: [
      "hero",
      "meta",
      "billTo",
      "servicePeriod",
      "lineItems",
      "totals",
      "terms",
      "signature",
      "footer",
    ],
  },
  realestate: {
    family: "modern",
    sections: [
      "hero",
      "meta",
      "billTo",
      "servicePeriod",
      "property",
      "lineItems",
      "compliance",
      "totals",
      "terms",
      "signature",
      "footer",
    ],
  },
  education: {
    family: "modern",
    sections: [
      "hero",
      "meta",
      "billTo",
      "servicePeriod",
      "student",
      "lineItems",
      "totals",
      "terms",
      "signature",
      "footer",
    ],
  },
  nonprofit: {
    family: "modern",
    sections: [
      "hero",
      "meta",
      "billTo",
      "servicePeriod",
      "donation",
      "lineItems",
      "compliance",
      "totals",
      "terms",
      "signature",
      "footer",
    ],
  },

  manufacturing: {
    family: "traditional",
    sections: [
      "header",
      "invoiceMeta",
      "parties",
      "po",
      "lineItems",
      "totals",
      "compliance",
      "banking",
      "terms",
      "signature",
      "footer",
    ],
  },
  wholesale: {
    family: "traditional",
    sections: [
      "header",
      "invoiceMeta",
      "parties",
      "po",
      "lineItems",
      "totals",
      "compliance",
      "banking",
      "terms",
      "signature",
      "footer",
    ],
  },
  distributors: {
    family: "traditional",
    sections: [
      "header",
      "invoiceMeta",
      "parties",
      "logistics",
      "lineItems",
      "totals",
      "compliance",
      "banking",
      "terms",
      "signature",
      "footer",
    ],
  },
  hardware: {
    family: "traditional",
    sections: [
      "header",
      "invoiceMeta",
      "parties",
      "warranty",
      "lineItems",
      "totals",
      "compliance",
      "banking",
      "terms",
      "signature",
      "footer",
    ],
  },
  trading: {
    family: "traditional",
    sections: [
      "header",
      "invoiceMeta",
      "parties",
      "po",
      "tcs",
      "lineItems",
      "totals",
      "compliance",
      "banking",
      "terms",
      "signature",
      "footer",
    ],
  },
  construction: {
    family: "traditional",
    sections: [
      "header",
      "invoiceMeta",
      "parties",
      "workOrder",
      "lineItems",
      "totals",
      "compliance",
      "banking",
      "terms",
      "signature",
      "footer",
    ],
  },
  agriculture: {
    family: "traditional",
    sections: [
      "header",
      "invoiceMeta",
      "parties",
      "commodity",
      "lineItems",
      "totals",
      "compliance",
      "banking",
      "terms",
      "signature",
      "footer",
    ],
  },

  healthcare: {
    family: "condensed",
    sections: ["header", "invoiceMeta", "patient", "lineItems", "totals", "compliance", "footer"],
  },
  foodbeverage: {
    family: "condensed",
    sections: ["header", "invoiceMeta", "order", "lineItems", "totals", "compliance", "footer"],
  },
  logistics: {
    family: "condensed",
    sections: ["header", "invoiceMeta", "shipment", "lineItems", "totals", "compliance", "footer"],
  },
};

const COMPLIANCE_BY_INDUSTRY = {
  consulting: "Engagement governed by Master Service Agreement.",
  technology: "Software-as-a-Service classification as per applicable service-tax notification.",
  startup: "Subject to the jurisdiction of the registered office.",
  realestate: "Stamp duty and registration charges are payable by the buyer.",
  education: "Receipt only — not a tax invoice for amounts below the prescribed threshold.",
  nonprofit:
    "Donation eligible for 50% deduction under Section 80G, if supported by a valid receipt.",
  manufacturing:
    "Goods once sold will not be taken back. e-Way Bill required for invoices ≥ ₹50,000.",
  wholesale:
    "Goods once sold will not be taken back. Subject to credit / debit note cross-reference.",
  distributors:
    "Subject to destination jurisdiction. Reverse charge mechanism applicable if marked.",
  hardware: "Warranty void if seal is broken. Carry-in service only.",
  trading: "TCS under Section 206C(1H) applicable where thresholds are met.",
  construction:
    "TDS under Section 194C deductible at applicable rate. Retention held until defect-liability period ends.",
  agriculture: "Market fee, if any, charged separately.",
  healthcare: "Pay at counter. Insurance / TPA processing is the patient's responsibility.",
  foodbeverage: "FSSAI licence displayed at premises. Prices inclusive of applicable taxes.",
  logistics:
    "Subject to destination jurisdiction. Carrier liability limited per Carriage of Goods Act.",
};

// Build the full TEMPLATES array. Each industry + family combination is one
// template. Today that's one entry per industry (single family per industry).
// If we ever split an industry into multiple visual variants, add a second
// template entry and an industry-specific picker chip — the rest of the
// registry doesn't have to change.
export const TEMPLATES = INDUSTRIES.map((industry) => {
  const meta = TEMPLATES_BY_INDUSTRY[industry.id] || {};
  return {
    id: `${industry.id}-${meta.family || "modern"}`,
    industry: industry.id,
    family: meta.family || "modern",
    label: `${industry.label} — ${FAMILIES[meta.family || "modern"].label}`,
    accent: industry.accent,
    sections: meta.sections || [
      "hero",
      "meta",
      "billTo",
      "servicePeriod",
      "lineItems",
      "totals",
      "terms",
      "signature",
      "footer",
    ],
    complianceNote: COMPLIANCE_BY_INDUSTRY[industry.id] || "",
    icon: industry.icon,
  };
});

// `fields` lookup — used by the right-side drawer in ServiceBilling.
export const fieldConfigFor = (industryId) => FIELDS[industryId] || [];

// `industryById` / `templateById` lookup maps for fast access.
const _industryMap = Object.fromEntries(INDUSTRIES.map((i) => [i.id, i]));
const _templateMap = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

export const industryById = (id) => _industryMap[id] || null;
export const templateById = (id) => _templateMap[id] || null;

// Resolve the template for an invoice. Reads `invoice.templateId` first;
// falls back to the invoice's `industry` field (older saves) so legacy
// rows don't render blank. If neither is set, returns null — caller falls
// back to the existing ServiceInvoice / MSMEInvoice renderer.
export const resolveTemplate = (invoice) => {
  if (!invoice) return null;
  // templateId may live top-level or on items[0].meta (the place we save
  // it during billing). Top-level wins because the renderer hydrates it
  // there from meta on first paint.
  const tplId =
    invoice.templateId ||
    (invoice.items &&
      invoice.items[0] &&
      invoice.items[0].meta &&
      invoice.items[0].meta.templateId) ||
    null;
  if (tplId && _templateMap[tplId]) return _templateMap[tplId];
  const industryId =
    invoice.industry ||
    (invoice.items &&
      invoice.items[0] &&
      invoice.items[0].meta &&
      invoice.items[0].meta.industry) ||
    null;
  if (industryId) {
    const tpl = TEMPLATES.find((t) => t.industry === industryId);
    if (tpl) return tpl;
  }
  return null;
};

// Resolve the fields map for an invoice — merges the per-template defaults
// with anything the cashier typed at billing time. Returns a flat object
// keyed by field key so the renderer can do `fields.poNumber` and get a
// string (or undefined).
export const resolveInvoiceFields = (invoice) => {
  if (!invoice) return {};
  const top = (invoice.fields && typeof invoice.fields === "object" && invoice.fields) || {};
  const meta =
    (invoice.items &&
    invoice.items[0] &&
    invoice.items[0].meta &&
    invoice.items[0].meta.fields &&
    typeof invoice.items[0].meta.fields === "object"
      ? invoice.items[0].meta.fields
      : {}) || {};
  return { ...meta, ...top };
};

// Helper: build a fresh, blank `fields` object for a given industry. Used
// by ServiceBilling when the cashier switches industry on an existing bill.
export const emptyFieldsFor = (industryId) => {
  const list = fieldConfigFor(industryId);
  return Object.fromEntries(list.map((f) => [f.key, ""]));
};

// Default template when a brand-new bill is opened. Cashier can pick a
// different one from the chip row.
export const DEFAULT_TEMPLATE_ID = "consulting-modern";
export const DEFAULT_INDUSTRY_ID = "consulting";
