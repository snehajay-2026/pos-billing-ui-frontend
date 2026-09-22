// Traditional A4 — denser layout for goods-and-trade industries. The
// per-industry info blocks (PO, work order, commodity, warranty, TCS,
// logistics) sit in a slim strip below the parties; the items table is
// the visual anchor of the page.

import React from "react";
import {
  FaBuilding,
  FaCalendarAlt,
  FaCheckCircle,
  FaEnvelope,
  FaFileInvoice,
  FaFileSignature,
  FaIdCard,
  FaInfoCircle,
  FaMapMarkerAlt,
  FaPhone,
  FaUser,
  FaTruck,
} from "react-icons/fa";
import { getStoreSettings } from "../../../services/storeSettingsService";
import { computeStatus } from "../../../utils/invoiceStatus";
import {
  numberToWordsIndian,
  resolvePersistedServiceTotals,
  resolveTaxSplit,
} from "../../../utils/serviceInvoiceMath";
import { resolveInvoiceFields, resolveTemplate, fieldConfigFor } from "./index";
import "./TraditionalA4.css";

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

function splitTerms(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-•\d.)\s]+/, "").trim())
    .filter(Boolean);
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
    <div className="tkv-row">
      <small>{label}</small>
      <b>{v}</b>
    </div>
  );
};

// Set of registry field keys that already have a dedicated visual block
// somewhere in this renderer. The generic extras fallback below uses
// this set so it doesn't double-print anything the named branches
// (po / warranty / workOrder / commodity / logistics / tcs) already
// rendered. See ModernA4's DEDICATED_KEYS_MODERN for the parallel
// definition and the test in renderers.test.jsx that pins drift.
const DEDICATED_KEYS_TRADITIONAL = new Set([
  // po (manufacturing + wholesale + distributors + trading + generic)
  "poNumber",
  "placeOfSupply",
  "creditNoteRef",
  "packing",
  "eWayBillNote",
  // warranty (hardware)
  "modelNo",
  "serialNo",
  "warrantyMonths",
  "warrantyNote",
  // workOrder (construction)
  "workOrderRef",
  "milestone",
  "retentionPct",
  "tdsNote",
  // commodity (agriculture)
  "commodity",
  "grade",
  "quantityKg",
  "mandiName",
  "marketFeeNote",
  // logistics (distributors + logistics — but logistics renders on
  // CondensedReceipt's family, so the keys listed here are only the
  // ones the TraditionalA4 logistics block actually reads)
  "lrNo",
  "vehicleNo",
  "distributorCode",
  "route",
  "reverseChargeNote",
  "ewayBillNo",
  // tcs (trading)
  "tcsSection",
  "tcsNote",
  // complianceNote is renderer-owned, not a registry key.
]);

const TraditionalA4 = ({ invoice, isDuplicate }) => {
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
  const technician = display(invoice.technician, itemMeta.technician);
  const jobRef = display(invoice.jobRef, itemMeta.jobRef);
  const remarks = display(invoice.remarks, itemMeta.remarks);
  const terms = splitTerms(settings.serviceTerms);
  const signatureName = display(settings.serviceSignatureName, settings.name);
  const bankAccount = display(settings.serviceBankAccount || settings.accountNo);
  const footerPhone = display(settings.serviceFooterPhone || settings.phone);
  const footerEmail = display(settings.serviceFooterEmail || settings.email);
  const billToName = display(
    invoice.customerName || invoice.customer,
    itemMeta.guest || "Walk-in Customer"
  );
  const billToAddress = display(
    invoice.customerAddress || invoice.address,
    itemMeta.customerAddress
  );
  const rawPhone = display(
    invoice.customerPhone || invoice.phone || invoice.customerMobile || invoice.mobile,
    itemMeta.customerPhone || itemMeta.customerMobile
  );
  const phoneDigits = rawPhone.replace(/\D/g, "");
  const billToPhone = rawPhone
    ? rawPhone.startsWith("+")
      ? rawPhone
      : phoneDigits.length === 10
        ? `+91${phoneDigits}`
        : rawPhone
    : "";
  const billToEmail = display(invoice.customerEmail || invoice.email, itemMeta.customerEmail);
  const billToGst = display(invoice.customerGst || invoice.gst, itemMeta.customerGst);
  const billToState = invoiceCustomerState;
  const amountWords = numberToWordsIndian(totalAmount);
  const complianceNote = display(fields.complianceNote, template?.complianceNote || "");
  const statusTone = status?.tone || "pending";
  const statusLabel = status?.label || display(invoice.status, "PENDING").toUpperCase();

  return (
    <div id="service-invoice-traditional" className="service-invoice-traditional">
      <div
        className={`tA4-page${items.length > 8 ? " tA4-page-dense" : ""}`}
        style={template?.accent ? { "--tA4-accent": template.accent } : undefined}
      >
        {show("header") && (
          <header className="tA4-header">
            <div className="tA4-header-l">
              {settings.logo ? (
                <img className="tA4-logo" src={settings.logo} alt="logo" />
              ) : (
                <div className="tA4-logo-fallback">
                  <FaBuilding />
                </div>
              )}
              <div className="tA4-header-meta">
                <h1>{display(settings.name, "Your Company Name")}</h1>
                {settings.address && <p>{settings.address}</p>}
                {(settings.city || settings.state || settings.pincode) && (
                  <p>
                    {[settings.city, settings.state, settings.pincode].filter(Boolean).join(", ")}
                  </p>
                )}
                <p>
                  {settings.phone && (
                    <span>
                      <FaPhone /> {settings.phone}
                    </span>
                  )}
                  {settings.email && (
                    <span>
                      <FaEnvelope /> {settings.email}
                    </span>
                  )}
                </p>
                <p className="tA4-header-ids">
                  {settings.gstNo && <span>GSTIN: {settings.gstNo}</span>}
                  {settings.panNo && <span>PAN: {settings.panNo}</span>}
                </p>
              </div>
            </div>
            <div className="tA4-header-r">
              <div className="tA4-doc-title">TAX INVOICE</div>
              <div className="tA4-doc-sub">{template ? `${template.label}` : ""}</div>
              <div className={`tA4-status-badge ${statusTone}`}>
                <FaCheckCircle /> {statusLabel}
              </div>
            </div>
          </header>
        )}

        {isDuplicate && <div className="tA4-duplicate">DUPLICATE COPY</div>}

        {show("invoiceMeta") && (
          <div className="tA4-meta-strip">
            <div>
              <small>Invoice No.</small>
              <b>{display(invoice.invoiceNo, "—")}</b>
            </div>
            <div>
              <small>Invoice Date</small>
              <b>{formatDate(invoice.date) || "—"}</b>
            </div>
            <div>
              <small>Payment Mode</small>
              <b>{paymentMode}</b>
            </div>
            <div>
              <small>Status</small>
              <b>{statusLabel}</b>
            </div>
          </div>
        )}

        {(show("parties") ||
          show("po") ||
          show("warranty") ||
          show("workOrder") ||
          show("commodity") ||
          show("logistics") ||
          show("tcs")) && (
          <div className="tA4-parties">
            <div className="tA4-party">
              <div className="tA4-party-head">
                <FaBuilding /> SELLER
              </div>
              <div className="tA4-party-body">
                <strong>{display(settings.name, "Your Company Name")}</strong>
                {settings.address && <span>{settings.address}</span>}
                {(settings.city || settings.state || settings.pincode) && (
                  <span>
                    {[settings.city, settings.state, settings.pincode].filter(Boolean).join(", ")}
                  </span>
                )}
                {settings.gstNo && (
                  <span>
                    <FaIdCard /> GSTIN: {settings.gstNo}
                  </span>
                )}
              </div>
            </div>
            <div className="tA4-party">
              <div className="tA4-party-head">
                <FaUser /> BUYER / BILL TO
              </div>
              <div className="tA4-party-body">
                <strong>{billToName}</strong>
                {billToAddress && <span>{billToAddress}</span>}
                {billToState && <span>{billToState}</span>}
                {billToPhone && (
                  <span>
                    <FaPhone /> {billToPhone}
                  </span>
                )}
                {billToEmail && (
                  <span>
                    <FaEnvelope /> {billToEmail}
                  </span>
                )}
                {billToGst && (
                  <span>
                    <FaIdCard /> GSTIN: {billToGst}
                  </span>
                )}
              </div>
            </div>
            <div className="tA4-party tA4-party-extra">
              <div className="tA4-party-head">
                <FaInfoCircle /> EXTRA DETAILS
              </div>
              <div className="tA4-party-body tA4-party-body-grid">
                {show("po") && (
                  <>
                    <KV label="PO Number" value={fields.poNumber} />
                    <KV label="Packing & Forwarding" value={fields.packing} />
                    <KV label="e-Way Bill Note" value={fields.eWayBillNote} />
                    <KV label="Place of Supply" value={fields.placeOfSupply} />
                    <KV label="Credit Note Ref" value={fields.creditNoteRef} />
                  </>
                )}
                {show("warranty") && (
                  <>
                    <KV label="Model No" value={fields.modelNo} />
                    <KV label="Serial No" value={fields.serialNo} />
                    <KV label="Warranty (months)" value={fields.warrantyMonths} />
                    <KV label="Warranty Note" value={fields.warrantyNote} />
                  </>
                )}
                {show("workOrder") && (
                  <>
                    <KV label="Work Order Ref" value={fields.workOrderRef} />
                    <KV label="Milestone" value={fields.milestone} />
                    <KV label="Retention %" value={fields.retentionPct} />
                    <KV label="TDS Note" value={fields.tdsNote} />
                  </>
                )}
                {show("commodity") && (
                  <>
                    <KV label="Commodity" value={fields.commodity} />
                    <KV label="Grade" value={fields.grade} />
                    <KV label="Quantity (kg)" value={fields.quantityKg} />
                    <KV label="Mandi / Market" value={fields.mandiName} />
                    <KV label="Market Fee" value={fields.marketFeeNote} />
                  </>
                )}
                {show("logistics") && (
                  <>
                    <KV label="LR / GR No" value={fields.lrNo} />
                    <KV label="Vehicle No" value={fields.vehicleNo} />
                    <KV label="Distributor Code" value={fields.distributorCode} />
                    <KV label="Route" value={fields.route} />
                    <KV label="Reverse Charge" value={fields.reverseChargeNote} />
                    <KV label="e-Way Bill" value={fields.ewayBillNo} />
                  </>
                )}
                {show("tcs") && (
                  <>
                    <KV label="Place of Supply" value={fields.placeOfSupply} />
                    <KV label="TCS Section" value={fields.tcsSection} />
                    <KV label="TCS Note" value={fields.tcsNote} />
                  </>
                )}
                {/*
                  F11: configuration-driven fallback. Iterates every
                  field the registry defines for the active industry and
                  emits a KV line for any key the cashier typed a value
                  into that the named branches above did NOT already
                  render. DEDICATED_KEYS_TRADITIONAL mirrors the keys
                  the named branches consume, so any key a named
                  branch (po / warranty / workOrder / commodity /
                  logistics / tcs) already renders is skipped here —
                  without the dedup set, a key like poNumber would
                  render twice. Empty values are hidden by KV itself.

                  The legacy `<KV label="PO Number" .../>` line that
                  used to sit here as a "generic goods family"
                  fallback was removed: the named `po` branch above
                  (gated by `show("po")`) covers manufacturing /
                  wholesale / distributors / trading, and the
                  generic-extras loop below catches it for any future
                  industry that adds poNumber without listing `po` in
                  its sections array.
                */}
                {template?.industry &&
                  fieldConfigFor(template.industry).map((f) => {
                    if (!f || !f.key) return null;
                    if (DEDICATED_KEYS_TRADITIONAL.has(f.key)) return null;
                    return <KV key={f.key} label={f.label} value={fields[f.key]} />;
                  })}
                {(technician || jobRef) && (
                  <div className="tkv-row tkv-row-wide">
                    <small>Reference</small>
                    <b>
                      {[technician && `Provider: ${technician}`, jobRef && `Ref: ${jobRef}`]
                        .filter(Boolean)
                        .join(" · ")}
                    </b>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {show("lineItems") && (
          <table className="tA4-items">
            <thead>
              <tr>
                <th className="tA4-col-no">#</th>
                <th>DESCRIPTION</th>
                <th className="tA4-col-sac">HSN/SAC</th>
                <th className="tA4-col-qty">QTY</th>
                <th className="tA4-col-unit">UNIT</th>
                <th className="tA4-col-rate">RATE (₹)</th>
                <th className="tA4-col-taxable">TAXABLE (₹)</th>
                {taxSplit.map((tax) => (
                  <th className="tA4-col-cgst" key={tax.label}>
                    {tax.label.replace("GST", "")} ({fmt2(tax.rate)}%)
                  </th>
                ))}
                <th className="tA4-col-amount">AMOUNT (₹)</th>
              </tr>
            </thead>
            <tbody>
              {totals.lines.length === 0 ? (
                <tr>
                  <td colSpan={9 + taxSplit.length} className="tA4-empty">
                    No items
                  </td>
                </tr>
              ) : (
                totals.lines.map((row, index) => {
                  const taxForRow = totals.gstRate
                    ? round2((row.taxableAmount * totals.gstRate) / 100)
                    : 0;
                  const halfTax = round2(taxForRow / 2);
                  return (
                    <tr key={row.key}>
                      <td className="tA4-center">{index + 1}</td>
                      <td className="tA4-desc">{row.description}</td>
                      <td className="tA4-center">{row.hsn || "—"}</td>
                      <td className="tA4-center">{row.units}</td>
                      <td className="tA4-center">NOS</td>
                      <td className="tA4-right">{fmt2(row.rate)}</td>
                      <td className="tA4-right">{fmt2(row.taxableAmount)}</td>
                      {taxSplit.length === 1 ? (
                        <td className="tA4-right">{fmt2(halfTax * 2)}</td>
                      ) : (
                        <>
                          <td className="tA4-right">{fmt2(halfTax)}</td>
                          <td className="tA4-right">{fmt2(taxForRow - halfTax)}</td>
                        </>
                      )}
                      <td className="tA4-right">{fmt2(row.taxableAmount + taxForRow)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}

        {show("totals") && (
          <div className="tA4-totals">
            <div className="tA4-totals-notes">
              <div className="tA4-note-card">
                <div className="tA4-light-heading">
                  <FaFileSignature /> NOTES
                </div>
                <ul>
                  {(remarks
                    ? [remarks]
                    : ["Goods once sold will not be taken back.", "Subject to local jurisdiction."]
                  ).map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
              <div className="tA4-note-card tA4-words-card">
                <div className="tA4-light-heading">
                  <FaFileSignature /> AMOUNT IN WORDS
                </div>
                <strong>{amountWords}</strong>
              </div>
            </div>
            <div className="tA4-totals-card">
              <div className="tA4-totals-row">
                <span>Subtotal</span>
                <b>₹ {fmt2(totals.subTotal)}</b>
              </div>
              {taxSplit.map((tax) => (
                <div className="tA4-totals-row" key={tax.label}>
                  <span>
                    {tax.label} ({fmt2(tax.rate)}%)
                  </span>
                  <b>₹ {fmt2(tax.amount)}</b>
                </div>
              ))}
              {totals.discountAmt > 0 && (
                <div className="tA4-totals-row tA4-discount-row">
                  <span>Discount</span>
                  <b>− ₹ {fmt2(totals.discountAmt)}</b>
                </div>
              )}
              <div className="tA4-total-highlight">
                <span>TOTAL AMOUNT</span>
                <b>₹ {fmt2(totalAmount)}</b>
              </div>
              {paidAmount > 0 && (
                <div className="tA4-balance-row">
                  <span>Paid {paymentMode}</span>
                  <b>
                    ₹ {fmt2(paidAmount)} · Balance ₹ {fmt2(balanceDue)}
                  </b>
                </div>
              )}
            </div>
          </div>
        )}

        {show("compliance") && complianceNote ? (
          <div className="tA4-compliance">
            <div className="tA4-light-heading">
              <FaInfoCircle /> COMPLIANCE NOTES
            </div>
            <p>{complianceNote}</p>
          </div>
        ) : null}

        {show("banking") && (
          <div className="tA4-banking">
            <div className="tA4-banking-head">
              <FaBuilding /> BANK DETAILS
            </div>
            <div className="tA4-banking-grid">
              {bankAccount && (
                <span>
                  <b>A/c</b>
                  {bankAccount}
                </span>
              )}
              {settings.bankName && (
                <span>
                  <b>Bank</b>
                  {settings.bankName}
                </span>
              )}
              {settings.ifscCode && (
                <span>
                  <b>IFSC</b>
                  {settings.ifscCode}
                </span>
              )}
              {settings.upiId && (
                <span>
                  <b>UPI</b>
                  {settings.upiId}
                </span>
              )}
              {settings.branch && (
                <span>
                  <b>Branch</b>
                  {settings.branch}
                </span>
              )}
            </div>
          </div>
        )}

        {show("terms") && (
          <div className="tA4-terms">
            <div className="tA4-light-heading">
              <FaFileSignature /> TERMS & CONDITIONS
            </div>
            <ol>
              {(terms.length
                ? terms
                : [
                    "Payment is due upon receipt of this invoice.",
                    "Interest @ 24% p.a. will be charged on overdue amounts.",
                    "E. & O.E. (Errors and Omissions Excepted).",
                  ]
              ).map((term, index) => (
                <li key={index}>{term}</li>
              ))}
            </ol>
          </div>
        )}

        {show("signature") && (
          <div className="tA4-signature">
            <div className="tA4-signature-stamp">
              <small>For {display(settings.name, "Your Company Name")}</small>
              <div className="tA4-signature-line">AUTHORIZED SIGNATORY</div>
              {signatureName && <small>{signatureName}</small>}
            </div>
          </div>
        )}

        {show("footer") && (
          <footer className="tA4-footer">
            <div>
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
              {settings.address && (
                <span>
                  <FaMapMarkerAlt /> {settings.address}
                </span>
              )}
            </div>
            <strong>THANK YOU FOR YOUR BUSINESS</strong>
          </footer>
        )}
      </div>
    </div>
  );
};

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export default TraditionalA4;
