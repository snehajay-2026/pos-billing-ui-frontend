// src/components/service/templates/resolveTemplate.test.js
//
// Pins the per-invoice template resolution the F9 integration relies on.
//
// Why this test exists:
//   - The Service Billing screen writes `industry` + `templateId` +
//     `fields` to top-level AND items[0].meta. The renderer chain
//     reads whichever side survives the public-share strip
//     (`lib/publicInvoice.js` hoists `industry`/`templateId`/`fields`
//     onto top-level before stripping meta).
//   - resolveTemplate(invoice) is the single dispatcher InvoiceView and
//     PublicInvoiceView call to pick the renderer family. Legacy
//     invoices (no industry, no templateId) MUST fall through to
//     `null` so InvoiceView/PublicInvoiceView fall back to the
//     ServiceInvoice/MSMEInvoice renderer — that fallback path is
//     what keeps pre-F9 invoices rendering correctly.
//   - New F9 invoices must resolve the exact same template the cashier
//     picked at billing time, no matter which side of the strip the
//     metadata lives on.

import {
  resolveTemplate,
  resolveInvoiceFields,
  templateById,
  industryById,
  fieldConfigFor,
  requiredFieldsFor,
} from "./index";

describe("resolveTemplate", () => {
  test("returns null when invoice is missing or empty", () => {
    expect(resolveTemplate(null)).toBeNull();
    expect(resolveTemplate(undefined)).toBeNull();
    expect(resolveTemplate({})).toBeNull();
  });

  test("legacy invoice with no industry/templateId returns null", () => {
    // Pre-F9 row: items exist but no metadata block.
    expect(
      resolveTemplate({
        invoiceNo: "SI2026-000001",
        items: [{ id: 1, name: "Consulting", price: 1000 }],
      })
    ).toBeNull();
  });

  test("resolves template by top-level templateId", () => {
    const tpl = templateById("consulting-modern");
    expect(tpl).not.toBeNull();
    expect(
      resolveTemplate({
        invoiceNo: "SI2026-000002",
        templateId: "consulting-modern",
        items: [],
      })
    ).toBe(tpl);
  });

  test("falls back to items[0].meta.templateId when top-level is missing", () => {
    const tpl = templateById("manufacturing-traditional");
    expect(tpl).not.toBeNull();
    expect(
      resolveTemplate({
        invoiceNo: "SI2026-000003",
        industry: "manufacturing",
        items: [{ id: 1, name: "Widget", meta: { templateId: "manufacturing-traditional" } }],
      })
    ).toBe(tpl);
  });

  test("falls back from templateId to industry (legacy rows with industry only)", () => {
    // Pre-template-id rows used just `industry`. resolveTemplate
    // should still find the canonical template for that industry.
    const tpl = templateById("consulting-modern");
    expect(
      resolveTemplate({
        invoiceNo: "SI2026-000004",
        industry: "consulting",
        items: [{ id: 1, name: "Strategy" }],
      })
    ).toBe(tpl);
  });

  test("falls back from items[0].meta.industry when no templateId", () => {
    const tpl = templateById("manufacturing-traditional");
    expect(
      resolveTemplate({
        invoiceNo: "SI2026-000005",
        items: [{ id: 1, name: "Widget", meta: { industry: "manufacturing" } }],
      })
    ).toBe(tpl);
  });

  test("returns null when templateId is bogus (no entry in the registry)", () => {
    // Stale id from a previous registry version — renderers must fall
    // back to the legacy ServiceInvoice / MSMEInvoice renderer rather
    // than crashing or returning a partial template.
    expect(
      resolveTemplate({
        invoiceNo: "SI2026-000006",
        templateId: "non-existent-industry-modern",
        items: [],
      })
    ).toBeNull();
  });

  test("top-level templateId wins over items[0].meta.templateId", () => {
    const top = templateById("consulting-modern");
    const meta = templateById("manufacturing-traditional");
    expect(
      resolveTemplate({
        templateId: top.id,
        items: [{ id: 1, name: "X", meta: { templateId: meta.id } }],
      })
    ).toBe(top);
  });

  test("top-level templateId wins over items[0].meta.industry", () => {
    const top = templateById("consulting-modern");
    expect(
      resolveTemplate({
        templateId: top.id,
        items: [{ id: 1, name: "X", meta: { industry: "manufacturing" } }],
      })
    ).toBe(top);
  });

  test("industryById and templateById agree on every registered industry", () => {
    // The renderer family per industry is the canonical mapping in
    // TEMPLATES_BY_INDUSTRY; resolveTemplate + this loop must stay in
    // lock-step so a future registry refactor can't accidentally split
    // them.
    const { INDUSTRIES, TEMPLATES } = require("./index");
    const industriesWithTemplates = new Set(TEMPLATES.map((t) => t.industry));
    for (const industry of INDUSTRIES) {
      expect(industriesWithTemplates.has(industry.id)).toBe(true);
      const meta = industryById(industry.id);
      expect(meta).not.toBeNull();
      expect(meta.id).toBe(industry.id);
    }
  });
});

describe("resolveInvoiceFields", () => {
  test("merges items[0].meta.fields under top-level fields", () => {
    // Top-level wins (cashier-typed override) but meta fills the gap.
    expect(
      resolveInvoiceFields({
        fields: { engagementRef: "MSA-2026-014" },
        items: [{ id: 1, meta: { fields: { engagementRef: "OLD", consultantName: "Jane" } } }],
      })
    ).toEqual({ engagementRef: "MSA-2026-014", consultantName: "Jane" });
  });

  test("returns empty object for a legacy row with no fields at all", () => {
    expect(resolveInvoiceFields({ items: [] })).toEqual({});
    expect(resolveInvoiceFields(null)).toEqual({});
  });
});

// F10: per-industry dynamic field config coverage. Every one of the 16
// industries must return a non-null array from fieldConfigFor(), and
// every field entry must carry the { key, label } shape the catalog
// form reads. requiredFieldsFor() is a derived view over the same
// registry; the assertions here pin which industries opt into the
// required-field gate so the catalog form's `*` markers and the
// backend's validator agree on the same keys (the brief's section
// 10: "Validate submitted industry and field data on the backend").
describe("fieldConfigFor", () => {
  test("every industry in INDUSTRIES returns a non-null array", () => {
    // Mirrors industryById lock-step — a future registry refactor that
    // adds an industry but forgets to extend FIELDS would otherwise
    // silently render an empty inputs block on the catalog form.
    const { INDUSTRIES } = require("./index");
    for (const industry of INDUSTRIES) {
      const cfg = fieldConfigFor(industry.id);
      expect(Array.isArray(cfg)).toBe(true);
      expect(cfg.length).toBeGreaterThan(0);
    }
  });

  test("every field carries { key, label } and unique keys per industry", () => {
    const { INDUSTRIES } = require("./index");
    for (const industry of INDUSTRIES) {
      const seen = new Set();
      for (const field of fieldConfigFor(industry.id)) {
        expect(typeof field.key).toBe("string");
        expect(field.key.length).toBeGreaterThan(0);
        expect(typeof field.label).toBe("string");
        expect(field.label.length).toBeGreaterThan(0);
        // Duplicate keys in one industry would silently shadow each
        // other in the saved JSON. Catch that at the registry level.
        expect(seen.has(field.key)).toBe(false);
        seen.add(field.key);
      }
    }
  });
});

describe("requiredFieldsFor", () => {
  const { INDUSTRIES, requiredFieldsFor } = require("./index");

  test("returns an empty array for an unknown / blank industry", () => {
    expect(requiredFieldsFor("")).toEqual([]);
    expect(requiredFieldsFor("not-a-real-industry")).toEqual([]);
    expect(requiredFieldsFor(null)).toEqual([]);
  });

  test("returns an array of registered field keys per opted-in industry", () => {
    // The opt-in industries and their required keys must stay in sync
    // with the backend's REQUIRED_FIELDS_BY_INDUSTRY mirror at
    // db/queries/services.js. Each assertion below is a contract.
    expect(requiredFieldsFor("consulting")).toEqual(["engagementRef"]);
    expect(requiredFieldsFor("manufacturing")).toEqual(["poNumber"]);
    expect(requiredFieldsFor("wholesale")).toEqual(["poNumber"]);
    expect(requiredFieldsFor("hardware")).toEqual(["poNumber"]);
    expect(requiredFieldsFor("trading")).toEqual(["poNumber"]);
    expect(requiredFieldsFor("healthcare")).toEqual(["patientId"]);
    expect(requiredFieldsFor("logistics")).toEqual(["lrNo"]);
    expect(requiredFieldsFor("education")).toEqual(["courseName"]);
    expect(requiredFieldsFor("nonprofit")).toEqual(["donorName"]);
  });

  test("every required key actually exists in fieldConfigFor for that industry", () => {
    // Catch a typo: requiredFieldsFor returns a key that doesn't
    // appear in the field set, which would render the `*` on an
    // input that doesn't exist.
    for (const industry of INDUSTRIES) {
      const keys = new Set(fieldConfigFor(industry.id).map((f) => f.key));
      for (const k of requiredFieldsFor(industry.id)) {
        expect(keys.has(k)).toBe(true);
      }
    }
  });
});
