// Modern A4 — service-store family. Mirrors the visual identity of the
// existing ServiceInvoice (gold-on-navy, hero block, two-column meta band)
// but renders sections from a template-driven section list so the
// per-industry content (engagement, project, donation, etc.) shows up in
// the right place without forking the renderer.
//
// Sections supported:
//   hero, meta, billTo, servicePeriod, lineItems, totals, terms,
//   signature, footer, compliance,
//   engagement, project, property, student, donation
//
// Anything not present in the template's section list is silently skipped.

import React from "react";
import {
  FaBuilding,
  FaCalendarAlt,
  FaCheckCircle,
  FaEnvelope,
  FaFileInvoice,
  FaFileSignature,
  FaIdCard,
  FaMapMarkerAlt,
  FaPhone,
  FaUser,
  FaInfoCircle,
} from "react-icons/fa";
import { getStoreSettings } from "../../../services/storeSettingsService";
import { computeStatus } from "../../../utils/invoiceStatus";
import {
  numberToWordsIndian,
  resolvePersistedServiceTotals,
  resolveTaxSplit,
} from "../../../utils/serviceInvoiceMath";
import { resolveInvoiceFields, resolveTemplate } from "./index";
import "./ModernA4.css";

const fmt2 = (value) => (Number(value) || 0).toFixed(2);
const display = (value, fallback = "") => {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
};

function addDays(yyyyMmDd, days) {
  if (!yyyyMmDd) return "";
  const d = new Date(yyyyMmDd);
  if (Number.isNaN(d.getTime())) return yyyyMmDd;
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().split("T")[0];
}

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

// Single-line "key: value" renderer used by the per-industry blocks
// (engagement, project, property, student, donation). Hides a line if its
// value is blank so the block collapses cleanly when the cashier left
// fields empty.
const KV = ({ label, value }) => {
  const v = display(value);
  if (!v) return null;
  return (
    <div className="mkv-row">
      <small>{label}</small>
      <b>{v}</b>
    </div>
  );
};

const Section = ({ id, children }) => (
  <section className={`mA4-section mA4-section-${id}`}>{children}</section>
);

const ModernA4 = ({ invoice, isDuplicate }) => {
  const settings = getStoreSettings();
  if (!invoice) return null;

  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const itemMeta = items.find((item) => item?.meta)?.meta || {};
  const template = resolveTemplate(invoice);
  const fields = resolveInvoiceFields(invoice);
  const totals = resolvePersistedServiceTotals(invoice);
  const sectionSet = new Set(template?.sections || []);
  const show = (id) => sectionSet.has(id);

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
  const dueDays = Number(settings.serviceDueDays) || 0;
  const dueDate = formatDate(
    display(invoice.dueDate, addDays(invoice.date, dueDays) || invoice.date)
  );
  const serviceFrom = formatDate(
    display(invoice.serviceFrom, itemMeta.serviceFrom || invoice.date)
  );
  const serviceTo = formatDate(display(invoice.serviceTo, itemMeta.serviceTo || invoice.date));
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
  const businessDescription = display(
    settings.businessDescription || settings.tagline,
    "Professional Services & Solutions"
  );
  const invoiceTitle = display(
    settings.serviceInvoiceTitle,
    template ? `${template.label.toUpperCase()} INVOICE` : "TAX INVOICE"
  );
  const amountWords = numberToWordsIndian(totalAmount);
  const placeOfSupply = display(settings.state, "—");
  const statusTone = status?.tone || "pending";
  const statusLabel = status?.label || display(invoice.status, "PENDING").toUpperCase();

  // Per-industry compliance note: prefers the cashier's typed
  // complianceNote field, falls back to the template default.
  const complianceNote = display(fields.complianceNote, template?.complianceNote || "");
  const industryLabel = template ? template.label : "";

  return (
    <div id="service-invoice-modern" className="service-invoice-modern">
      <div
        className={`mA4-page${items.length > 6 ? " mA4-page-dense" : ""}${items.length > 9 ? " mA4-page-ultra-dense" : ""}`}
        style={template?.accent ? { "--mA4-accent": template.accent } : undefined}
      >
        {show("hero") && (
          <Section id="hero">
            <div className="mA4-brand-block">
              <div className="mA4-logo-box">
                {settings.logo ? (
                  <img
                    className="mA4-logo"
                    src={settings.logo}
                    alt={`${settings.name || "Company"} logo`}
                  />
                ) : (
                  <div className="mA4-logo-placeholder">
                    <FaBuilding />
                    <span>LOGO</span>
                  </div>
                )}
              </div>
              <div className="mA4-company-block">
                <div className="mA4-company-name">
                  {display(settings.name, "Your Company Name")}
                </div>
                <div className="mA4-company-desc">{businessDescription}</div>
                <div className="mA4-company-ids">
                  {settings.gstNo && <span>GSTIN: {settings.gstNo}</span>}
                  {settings.panNo && <span>PAN: {settings.panNo}</span>}
                  {industryLabel && <span className="mA4-industry-pill">{industryLabel}</span>}
                </div>
              </div>
            </div>
            <div className="mA4-title-block">
              <div className="mA4-title">{invoiceTitle}</div>
              <div className="mA4-title-rule" />
              <div className="mA4-title-caption">
                INDUSTRY <span>|</span> QUALITY <span>|</span> TRUST
              </div>
            </div>
          </Section>
        )}

        {isDuplicate && <div className="mA4-duplicate">DUPLICATE COPY</div>}

        {show("meta") && (
          <Section id="meta">
            <div className="mA4-meta-cell">
              <FaFileInvoice />
              <span>
                <small>Invoice No.</small>
                <b>{display(invoice.invoiceNo, "—")}</b>
              </span>
            </div>
            <div className="mA4-meta-cell">
              <FaCalendarAlt />
              <span>
                <small>Invoice Date</small>
                <b>{display(invoice.date, "—")}</b>
              </span>
            </div>
            <div className="mA4-meta-cell">
              <FaCalendarAlt />
              <span>
                <small>Due Date</small>
                <b>{dueDate || "—"}</b>
              </span>
            </div>
            <div className="mA4-meta-cell">
              <FaMapMarkerAlt />
              <span>
                <small>Place of Supply</small>
                <b>{placeOfSupply}</b>
              </span>
            </div>
            <div className={`mA4-status-badge ${statusTone}`}>
              <FaCheckCircle />
              {statusLabel}
            </div>
          </Section>
        )}

        {(show("billTo") || show("parties")) && (
          <Section id="parties">
            <div className="mA4-party-card">
              <div className="mA4-section-bar">
                <FaBuilding /> FROM / SERVICE PROVIDER
              </div>
              <div className="mA4-party-body">
                <strong>{display(settings.name, "Your Company Name")}</strong>
                {settings.address && <span>{settings.address}</span>}
                {(settings.city || settings.state || settings.pincode) && (
                  <span>
                    {[settings.city, settings.state, settings.pincode].filter(Boolean).join(", ")}
                  </span>
                )}
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
                {settings.gstNo && (
                  <span>
                    <FaIdCard /> GSTIN: {settings.gstNo}
                  </span>
                )}
              </div>
            </div>
            <div className="mA4-party-card">
              <div className="mA4-section-bar">
                <FaUser /> BILL TO / CUSTOMER
              </div>
              <div className="mA4-party-body">
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
          </Section>
        )}

        {show("servicePeriod") && (
          <Section id="service-period">
            <div>
              <small>SERVICE PERIOD</small>
              <b>
                {serviceFrom}
                {serviceTo && serviceTo !== serviceFrom ? ` to ${serviceTo}` : ""}
              </b>
              {(technician || jobRef) && (
                <em>
                  {[technician && `Provider: ${technician}`, jobRef && `Ref: ${jobRef}`]
                    .filter(Boolean)
                    .join(" · ")}
                </em>
              )}
            </div>
            <div>
              <small>PAYMENT METHOD</small>
              <b>{paymentMode}</b>
            </div>
            <div>
              <small>PAYMENT STATUS</small>
              <b>{statusLabel}</b>
            </div>
          </Section>
        )}

        {show("engagement") && (
          <Section id="engagement">
            <div className="mA4-info-block">
              <div className="mA4-info-block-head">
                <FaFileSignature /> ENGAGEMENT DETAILS
              </div>
              <div className="mA4-info-block-body">
                <KV label="Engagement Ref" value={fields.engagementRef} />
                <KV label="Consultant" value={fields.consultantName} />
                <KV label="Engagement Period" value={fields.engagementPeriod} />
              </div>
            </div>
          </Section>
        )}

        {show("project") && (
          <Section id="project">
            <div className="mA4-info-block">
              <div className="mA4-info-block-head">
                <FaFileSignature /> PROJECT DETAILS
              </div>
              <div className="mA4-info-block-body">
                <KV label="Project Code" value={fields.projectCode} />
                <KV label="Milestone" value={fields.milestone} />
                <KV label="Subscription Period" value={fields.subscriptionPeriod} />
                <KV label="Support Tier" value={fields.supportTier} />
              </div>
            </div>
          </Section>
        )}

        {show("property") && (
          <Section id="property">
            <div className="mA4-info-block">
              <div className="mA4-info-block-head">
                <FaFileSignature /> PROPERTY DETAILS
              </div>
              <div className="mA4-info-block-body">
                <KV label="Agreement Ref" value={fields.agreementRef} />
                <KV label="Property Address" value={fields.propertyAddress} />
                <KV label="Stamp Duty" value={fields.stampDutyNote} />
              </div>
            </div>
          </Section>
        )}

        {show("student") && (
          <Section id="student">
            <div className="mA4-info-block">
              <div className="mA4-info-block-head">
                <FaFileSignature /> STUDENT DETAILS
              </div>
              <div className="mA4-info-block-body">
                <KV label="Student Name" value={fields.studentName} />
                <KV label="Course" value={fields.courseName} />
                <KV label="Batch / Term" value={fields.batch} />
                <KV label="Roll No" value={fields.rollNo} />
              </div>
            </div>
          </Section>
        )}

        {show("donation") && (
          <Section id="donation">
            <div className="mA4-info-block mA4-info-block-donation">
              <div className="mA4-info-block-head">
                <FaFileSignature /> DONATION DETAILS
              </div>
              <div className="mA4-info-block-body">
                <KV label="Donor Name" value={fields.donorName} />
                <KV label="Donor PAN" value={fields.donorPan} />
                <KV label="PAN of Donee" value={fields.panOfDonee} />
                <KV label="80G Reference" value={fields.eightyGReference} />
                <KV label="Donation Type" value={fields.donationType} />
              </div>
            </div>
          </Section>
        )}

        {show("lineItems") && (
          <>
            <div className="mA4-section-heading">
              <FaFileInvoice />{" "}
              {template?.industry === "nonprofit" ? "DONATION DETAILS" : "SERVICE DETAILS"}
            </div>
            <table className="mA4-table">
              <thead>
                <tr>
                  <th className="mA4-col-no">#</th>
                  <th>SERVICE / ITEM DESCRIPTION</th>
                  <th className="mA4-col-sac">HSN/SAC</th>
                  <th className="mA4-col-qty">QTY / HRS</th>
                  <th className="mA4-col-rate">RATE / UNIT (₹)</th>
                  <th className="mA4-col-gst">GST</th>
                  <th className="mA4-col-amount">AMOUNT (₹)</th>
                </tr>
              </thead>
              <tbody>
                {totals.lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="mA4-empty">
                      No service items
                    </td>
                  </tr>
                ) : (
                  totals.lines.map((row, index) => (
                    <tr key={row.key}>
                      <td className="mA4-center">{index + 1}</td>
                      <td className="mA4-description">{row.description}</td>
                      <td className="mA4-center">{row.hsn || "—"}</td>
                      <td className="mA4-center">{row.units}</td>
                      <td className="mA4-right">{fmt2(row.rate)}</td>
                      <td className="mA4-center">{fmt2(totals.gstRate)}%</td>
                      <td className="mA4-right">{fmt2(row.taxableAmount)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </>
        )}

        {(show("totals") || show("notes")) && (
          <Section id="totals">
            <div className="mA4-notes-stack">
              <div className="mA4-note-card">
                <div className="mA4-light-heading">
                  <FaFileSignature /> NOTES
                </div>
                <ul>
                  {(remarks
                    ? [remarks]
                    : [
                        "Thank you for choosing our services.",
                        "Please retain this invoice for your records.",
                      ]
                  ).map((note, index) => (
                    <li key={index}>{note}</li>
                  ))}
                </ul>
              </div>
              <div className="mA4-note-card mA4-words-card">
                <div className="mA4-light-heading">
                  <FaFileSignature /> AMOUNT IN WORDS
                </div>
                <strong>{amountWords}</strong>
              </div>
            </div>
            <div className="mA4-totals-card">
              <div className="mA4-totals-row">
                <span>Subtotal</span>
                <b>₹ {fmt2(totals.subTotal)}</b>
              </div>
              {taxSplit.map((tax) => (
                <div className="mA4-totals-row" key={tax.label}>
                  <span>
                    {tax.label} ({fmt2(tax.rate)}%)
                  </span>
                  <b>₹ {fmt2(tax.amount)}</b>
                </div>
              ))}
              {totals.discountAmt > 0 && (
                <div className="mA4-totals-row mA4-discount-row">
                  <span>Discount</span>
                  <b>− ₹ {fmt2(totals.discountAmt)}</b>
                </div>
              )}
              {invoice.roundOff != null && Number(invoice.roundOff) !== 0 && (
                <div className="mA4-totals-row">
                  <span>Round Off</span>
                  <b>₹ {fmt2(invoice.roundOff)}</b>
                </div>
              )}
              <div className="mA4-total-highlight">
                <span>TOTAL AMOUNT</span>
                <b>₹ {fmt2(totalAmount)}</b>
              </div>
              {paidAmount > 0 && (
                <div className="mA4-balance-row">
                  <span>Paid {paymentMode}</span>
                  <b>
                    ₹ {fmt2(paidAmount)} · Balance ₹ {fmt2(balanceDue)}
                  </b>
                </div>
              )}
            </div>
          </Section>
        )}

        {(show("banking") || show("compliance") || show("terms")) && (
          <Section id="bottom">
            <div className="mA4-bottom-card">
              <div className="mA4-light-heading">
                <FaBuilding /> BILLING INFORMATION
              </div>
              <div className="mA4-info-list">
                <span>
                  <b>Payment Method</b>
                  {paymentMode}
                </span>
                {bankAccount && (
                  <span>
                    <b>Bank A/c</b>
                    {bankAccount}
                  </span>
                )}
                {settings.bankName && (
                  <span>
                    <b>Bank Name</b>
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
                    <b>UPI ID</b>
                    {settings.upiId}
                  </span>
                )}
              </div>
            </div>
            {show("compliance") && complianceNote ? (
              <div className="mA4-bottom-card mA4-compliance-card">
                <div className="mA4-light-heading">
                  <FaInfoCircle /> COMPLIANCE NOTES
                </div>
                <ul>
                  <li>{complianceNote}</li>
                </ul>
              </div>
            ) : null}
            {show("terms") && (
              <div className="mA4-bottom-card">
                <div className="mA4-light-heading">
                  <FaFileSignature /> TERMS & CONDITIONS
                </div>
                <ol>
                  {(terms.length
                    ? terms
                    : [
                        "Payment is due upon receipt of this invoice.",
                        "Late payments may incur additional charges.",
                        "Please make payments to the account mentioned above.",
                        "This invoice is computer generated.",
                      ]
                  ).map((term, index) => (
                    <li key={index}>{term}</li>
                  ))}
                </ol>
              </div>
            )}
          </Section>
        )}

        {show("signature") && (
          <Section id="signature">
            <div className="mA4-signature-line">AUTHORIZED SIGNATORY</div>
            <div className="mA4-signature-meta">
              <span>Date: {display(invoice.date, "—")}</span>
              <strong>For {display(settings.name, "Your Company Name")}</strong>
              {signatureName && <small>{signatureName}</small>}
            </div>
          </Section>
        )}

        {show("footer") && (
          <footer className="mA4-footer">
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
            <strong>
              THANK YOU!<small>FOR YOUR BUSINESS</small>
            </strong>
          </footer>
        )}
      </div>
    </div>
  );
};

export default ModernA4;
