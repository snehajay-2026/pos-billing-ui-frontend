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

import { resolveTemplate, resolveInvoiceFields, templateById, industryById } from "./index";

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
