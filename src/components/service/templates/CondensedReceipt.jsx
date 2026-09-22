// Condensed Receipt — single-column thermal-printer layout. 80mm friendly
// for restaurants, pharmacies, and logistics waybills. Sections collapse to
// dashed dividers; per-industry blocks (patient, order, shipment) ride
// directly below the bill-to.

import React from "react";
import {
  FaAmbulance,
  FaBoxOpen,
  FaBuilding,
  FaCheckCircle,
  FaEnvelope,
  FaFileSignature,
  FaPhone,
  FaUser,
} from "react-icons/fa";
import { getStoreSettings } from "../../../services/storeSettingsService";
import { computeStatus } from "../../../utils/invoiceStatus";
import {
  numberToWordsIndian,
  resolvePersistedServiceTotals,
  resolveTaxSplit,
} from "../../../utils/serviceInvoiceMath";
import { resolveInvoiceFields, resolveTemplate, fieldConfigFor } from "./index";
import "./CondensedReceipt.css";

const fmt2 = (value) => (Number(value) || 0).toFixed(2);
const display = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

function formatDate(value) {
  const text = display(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return `${String(date.getDate()).padStart(2, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${date.getFullYear()}`;
}

const STATUS_TONES = {
  pending: { label: "PENDING", className: "is-pending" },
  paid: { label: "PAID", className: "is-paid" },
  cleared: { label: "CLEARED", className: "is-cleared" },
  cancelled: { label: "CANCELLED", className: "is-cancelled" },
};

const KV = ({ label, value }) => {
  const v = display(value);
  if (!v) return null;
  return (
    <div className="crkv-row">
      <span className="crkv-label">{label}</span>
      <span className="crkv-value">{v}</span>
    </div>
  );
};

// Set of registry field keys that already have a dedicated visual
// block somewhere in this renderer. The generic extras fallback below
// uses this set so it doesn't double-print anything the named branches
// (patient / order / shipment) already rendered. See ModernA4's
// DEDICATED_KEYS_MODERN for the parallel definition and the test in
// renderers.test.jsx that pins drift.
const DEDICATED_KEYS_CONDENSED = new Set([
  // patient (healthcare)
  "patientId",
  "doctor",
  "consultationDate",
  "department",
  // order (foodbeverage)
  "tableNo",
  "covers",
  "orderType",
  "fssaiNote",
  // shipment (logistics)
  "lrNo",
  "vehicleNo",
  "fromCity",
  "toCity",
  "ewayBillNo",
  "consignor",
  "consignee",
  // complianceNote is renderer-owned, not a registry key.
]);

const CondensedReceipt = ({ invoice, isDuplicate }) => {
  const settings = getStoreSettings();
  if (!invoice) return null;

  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const itemMeta = items.find((item) => item?.meta)?.meta || {};
  const template = resolveTemplate(invoice);
  const fields = resolveInvoiceFields(invoice);
  const sectionSet = new Set(template?.sections || []);
  const show = (id) => sectionSet.has(id);

  const totals = resolvePersistedServiceTotals(invoice);
  const invoiceCustomerState = display(invoice.customerState, itemMeta.customerState);
  const taxSplit = resolveTaxSplit(
    totals.gstTotal,
    totals.gstRate,
    invoiceCustomerState,
    settings.state
  );
  const totalAmount = totals.grandTotal;
  const paidAmount = Number(invoice.paidAmount || 0);
  const balanceDue = Math.max(0, totalAmount - paidAmount);
  const status = computeStatus(invoice, totalAmount);
  const paymentMode = display(
    invoice.paymentMode || invoice.paymentMethod || invoice.payment,
    "Cash"
  );
  const remarks = display(invoice.remarks, itemMeta.remarks);
  const signatureName = display(settings.serviceSignatureName, settings.name);
  const footerPhone = display(settings.serviceFooterPhone || settings.phone);
  const footerEmail = display(settings.serviceFooterEmail || settings.email);
  const billToName = display(
    invoice.customerName || invoice.customer,
    itemMeta.guest || "Walk-in Customer"
  );
  const billToPhone = display(
    invoice.customerPhone || invoice.phone || invoice.customerMobile || invoice.mobile,
    itemMeta.customerPhone || itemMeta.customerMobile
  );
  const amountWords = numberToWordsIndian(totalAmount);
  const complianceNote = display(fields.complianceNote, template?.complianceNote || "");
  const statusTone = status?.tone || "pending";
  const statusLabel = status?.label || display(invoice.status, "PENDING").toUpperCase();

  return (
    <div id="service-invoice-condensed" className="service-invoice-condensed">
      <div
        className="cr-receipt"
        style={template?.accent ? { "--cr-accent": template.accent } : undefined}
      >
        {show("header") && (
          <header className="cr-header">
            {settings.logo && <img className="cr-logo" src={settings.logo} alt="logo" />}
            <h1>{display(settings.name, "Your Company Name")}</h1>
            {settings.address && <p>{settings.address}</p>}
            {settings.phone && (
              <p>
                <FaPhone /> {settings.phone}
              </p>
            )}
            {settings.email && (
              <p>
                <FaEnvelope /> {settings.email}
              </p>
            )}
            {settings.gstNo && <p>GSTIN: {settings.gstNo}</p>}
            <div className="cr-doc-title">
              {template ? `${template.label.toUpperCase()}` : "INVOICE"}
            </div>
            <div className={`cr-status-badge ${statusTone}`}>
              <FaCheckCircle /> {statusLabel}
            </div>
          </header>
        )}

        {isDuplicate && <div className="cr-duplicate">DUPLICATE COPY</div>}

        {show("invoiceMeta") && (
          <div className="cr-meta">
            <KV label="Invoice No." value={invoice.invoiceNo} />
            <KV label="Date" value={formatDate(invoice.date)} />
            <KV label="Payment" value={paymentMode} />
          </div>
        )}

        {show("billTo") && (
          <div className="cr-section">
            <div className="cr-section-head">
              <FaUser /> BILL TO
            </div>
            <div className="cr-bill">
              <strong>{billToName}</strong>
              {billToPhone && (
                <span>
                  <FaPhone /> {billToPhone}
                </span>
              )}
            </div>
          </div>
        )}

        {show("patient") && (
          <div className="cr-section">
            <div className="cr-section-head">
              <FaAmbulance /> PATIENT
            </div>
            <div className="cr-grid">
              <KV label="Patient ID" value={fields.patientId} />
              <KV label="Doctor" value={fields.doctor} />
              <KV label="Consultation Date" value={formatDate(fields.consultationDate)} />
              <KV label="Department" value={fields.department} />
            </div>
          </div>
        )}

        {show("order") && (
          <div className="cr-section">
            <div className="cr-section-head">🍽️ ORDER</div>
            <div className="cr-grid">
              <KV label="Table No" value={fields.tableNo} />
              <KV label="Covers" value={fields.covers} />
              <KV label="Order Type" value={fields.orderType} />
              <KV label="FSSAI" value={fields.fssaiNote} />
            </div>
          </div>
        )}

        {show("shipment") && (
          <div className="cr-section">
            <div className="cr-section-head">
              <FaBoxOpen /> SHIPMENT
            </div>
            <div className="cr-grid">
              <KV label="LR / GR No" value={fields.lrNo} />
              <KV label="Vehicle No" value={fields.vehicleNo} />
              <KV label="From" value={fields.fromCity} />
              <KV label="To" value={fields.toCity} />
              <KV label="e-Way Bill" value={fields.ewayBillNo} />
              <KV label="Consignor" value={fields.consignor} />
              <KV label="Consignee" value={fields.consignee} />
            </div>
          </div>
        )}

        {/*
          F11: configuration-driven fallback. Iterates every field the
          registry defines for the active industry and emits a KV line
          for any key the cashier typed a value into that the named
          blocks above did NOT already render. DEDICATED_KEYS_CONDENSED
          mirrors the keys the named branches consume so a duplicate
          render is impossible. Empty values are hidden by KV itself.
          Renders below the named block and above the line-items table
          so the visual order is consistent with the other two
          families.
        */}
        {template?.industry && (
          <div className="cr-section">
            <div className="cr-section-head">EXTRA</div>
            <div className="cr-grid">
              {fieldConfigFor(template.industry).map((f) => {
                if (!f || !f.key) return null;
                if (DEDICATED_KEYS_CONDENSED.has(f.key)) return null;
                return <KV key={f.key} label={f.label} value={fields[f.key]} />;
              })}
            </div>
          </div>
        )}

        {show("lineItems") && (
          <div className="cr-section">
            <div className="cr-section-head">ITEMS</div>
            {totals.lines.length === 0 ? (
              <div className="cr-empty">No items</div>
            ) : (
              totals.lines.map((row, index) => {
                const taxForRow = totals.gstRate
                  ? Math.round(((row.taxableAmount * totals.gstRate) / 100) * 100) / 100
                  : 0;
                return (
                  <div className="cr-item" key={row.key}>
                    <div className="cr-item-head">
                      <span className="cr-item-no">{index + 1}.</span>
                      <span className="cr-item-desc">{row.description}</span>
                    </div>
                    <div className="cr-item-meta">
                      <span>
                        {row.units} × ₹{fmt2(row.rate)}
                      </span>
                      <span>₹ {fmt2(row.taxableAmount + taxForRow)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {show("totals") && (
          <div className="cr-section cr-totals">
            <div className="cr-totals-row">
              <span>Subtotal</span>
              <b>₹ {fmt2(totals.subTotal)}</b>
            </div>
            {taxSplit.map((tax) => (
              <div className="cr-totals-row" key={tax.label}>
                <span>
                  {tax.label} ({fmt2(tax.rate)}%)
                </span>
                <b>₹ {fmt2(tax.amount)}</b>
              </div>
            ))}
            {totals.discountAmt > 0 && (
              <div className="cr-totals-row cr-discount-row">
                <span>Discount</span>
                <b>− ₹ {fmt2(totals.discountAmt)}</b>
              </div>
            )}
            <div className="cr-total-highlight">
              <span>TOTAL</span>
              <b>₹ {fmt2(totalAmount)}</b>
            </div>
            {paidAmount > 0 && (
              <div className="cr-totals-row cr-balance-row">
                <span>Paid ({paymentMode})</span>
                <b>₹ {fmt2(paidAmount)}</b>
              </div>
            )}
            {balanceDue > 0 && (
              <div className="cr-totals-row cr-balance-row">
                <span>Balance Due</span>
                <b>₹ {fmt2(balanceDue)}</b>
              </div>
            )}
            <div className="cr-amount-words">
              <small>IN WORDS</small>
              <strong>{amountWords}</strong>
            </div>
          </div>
        )}

        {show("compliance") && complianceNote ? (
          <div className="cr-compliance">
            <small>NOTE</small>
            <p>{complianceNote}</p>
          </div>
        ) : null}

        {show("footer") && (
          <footer className="cr-footer">
            {remarks && <p className="cr-remarks">{remarks}</p>}
            {signatureName && (
              <p className="cr-signoff">For {display(settings.name, "Your Company Name")}</p>
            )}
            <p className="cr-thanks">— Thank You —</p>
            <div className="cr-contact">
              {footerPhone && (
                <span>
                  <FaPhone /> {footerPhone}
                </span>
              )}
              {footerEmail && (
                <span>
                  <FaEnvelope /> {footerEmail}
                </span>
              )}
            </div>
          </footer>
        )}
      </div>
    </div>
  );
};

export default CondensedReceipt;
