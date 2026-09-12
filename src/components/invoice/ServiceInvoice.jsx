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
} from "react-icons/fa";
import { getStoreSettings } from "../../services/storeSettingsService";
import { computeStatus } from "../../utils/invoiceStatus";
import {
  numberToWordsIndian,
  resolvePersistedServiceTotals,
  resolveTaxSplit,
} from "../../utils/serviceInvoiceMath";
import "./ServiceInvoice.css";

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

const ServiceInvoice = ({ invoice, isDuplicate }) => {
  const settings = getStoreSettings();
  if (!invoice) return null;

  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const itemMeta = items.find((item) => item?.meta)?.meta || {};
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
  const invoiceTitle = "TAX INVOICE";
  const amountWords = numberToWordsIndian(totalAmount);
  const placeOfSupply = display(settings.state, "—");
  const statusLabel = status?.label || display(invoice.status, "PENDING").toUpperCase();
  const statusTone = status?.tone || "pending";

  return (
    <div id="service-invoice" className="service-invoice">
      <div
        className={`si-page${items.length > 6 ? " si-page-dense" : ""}${items.length > 9 ? " si-page-ultra-dense" : ""}`}
      >
        <header className="si-hero">
          <div className="si-brand-block">
            <div className="si-logo-box">
              {settings.logo ? (
                <img
                  className="si-logo"
                  src={settings.logo}
                  alt={`${settings.name || "Company"} logo`}
                />
              ) : (
                <div className="si-logo-placeholder">
                  <FaBuilding />
                  <span>LOGO</span>
                </div>
              )}
            </div>
            <div className="si-company-block">
              <div className="si-company-name">{display(settings.name, "Your Company Name")}</div>
              <div className="si-company-desc">{businessDescription}</div>
              <div className="si-company-ids">
                {settings.gstNo && <span>GSTIN: {settings.gstNo}</span>}
                {settings.panNo && <span>PAN: {settings.panNo}</span>}
              </div>
            </div>
          </div>
          <div className="si-title-block">
            <div className="si-title">{invoiceTitle}</div>
            <div className="si-title-rule" />
            <div className="si-title-caption">
              SERVICE <span>|</span> QUALITY <span>|</span> TRUST
            </div>
          </div>
        </header>

        {isDuplicate && <div className="si-duplicate">DUPLICATE COPY</div>}

        <section className="si-meta-band">
          <div className="si-meta-cell">
            <FaFileInvoice />
            <span>
              <small>Invoice No.</small>
              <b>{display(invoice.invoiceNo, "—")}</b>
            </span>
          </div>
          <div className="si-meta-cell">
            <FaCalendarAlt />
            <span>
              <small>Invoice Date</small>
              <b>{display(invoice.date, "—")}</b>
            </span>
          </div>
          <div className="si-meta-cell">
            <FaCalendarAlt />
            <span>
              <small>Due Date</small>
              <b>{dueDate || "—"}</b>
            </span>
          </div>
          <div className="si-meta-cell">
            <FaMapMarkerAlt />
            <span>
              <small>Place of Supply</small>
              <b>{placeOfSupply}</b>
            </span>
          </div>
          <div className={`si-status-badge ${statusTone}`}>
            <FaCheckCircle />
            {statusLabel}
          </div>
        </section>

        <section className="si-party-grid">
          <div className="si-party-card">
            <div className="si-section-bar">
              <FaBuilding /> FROM / SERVICE PROVIDER
            </div>
            <div className="si-party-body">
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
          <div className="si-party-card">
            <div className="si-section-bar">
              <FaUser /> BILL TO / CUSTOMER
            </div>
            <div className="si-party-body">
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
        </section>

        <section className="si-info-strip">
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
        </section>

        <div className="si-section-heading">
          <FaFileInvoice /> SERVICE DETAILS
        </div>
        <table className="si-table">
          <thead>
            <tr>
              <th className="si-col-no">#</th>
              <th>SERVICE / ITEM DESCRIPTION</th>
              <th className="si-col-sac">HSN/SAC</th>
              <th className="si-col-qty">QTY / HRS</th>
              <th className="si-col-rate">RATE / UNIT (₹)</th>
              <th className="si-col-gst">GST</th>
              <th className="si-col-amount">AMOUNT (₹)</th>
            </tr>
          </thead>
          <tbody>
            {totals.lines.length === 0 ? (
              <tr>
                <td colSpan={7} className="si-empty">
                  No service items
                </td>
              </tr>
            ) : (
              totals.lines.map((row, index) => (
                <tr key={row.key}>
                  <td className="si-center">{index + 1}</td>
                  <td className="si-description">{row.description}</td>
                  <td className="si-center">{row.hsn || "—"}</td>
                  <td className="si-center">{row.units}</td>
                  <td className="si-right">{fmt2(row.rate)}</td>
                  <td className="si-center">{fmt2(totals.gstRate)}%</td>
                  <td className="si-right">{fmt2(row.taxableAmount)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <section className="si-middle-grid">
          <div className="si-notes-stack">
            <div className="si-note-card">
              <div className="si-light-heading">
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
            <div className="si-note-card si-words-card">
              <div className="si-light-heading">
                <FaFileSignature /> AMOUNT IN WORDS
              </div>
              <strong>{amountWords}</strong>
            </div>
          </div>
          <div className="si-totals-card">
            <div className="si-totals-row">
              <span>Subtotal</span>
              <b>₹ {fmt2(totals.subTotal)}</b>
            </div>
            {taxSplit.map((tax) => (
              <div className="si-totals-row" key={tax.label}>
                <span>
                  {tax.label} ({fmt2(tax.rate)}%)
                </span>
                <b>₹ {fmt2(tax.amount)}</b>
              </div>
            ))}
            {totals.discountAmt > 0 && (
              <div className="si-totals-row si-discount-row">
                <span>Discount</span>
                <b>− ₹ {fmt2(totals.discountAmt)}</b>
              </div>
            )}
            {invoice.roundOff != null && Number(invoice.roundOff) !== 0 && (
              <div className="si-totals-row">
                <span>Round Off</span>
                <b>₹ {fmt2(invoice.roundOff)}</b>
              </div>
            )}
            <div className="si-total-highlight">
              <span>TOTAL AMOUNT</span>
              <b>₹ {fmt2(totalAmount)}</b>
            </div>
            {paidAmount > 0 && (
              <div className="si-balance-row">
                <span>Paid {paymentMode}</span>
                <b>
                  ₹ {fmt2(paidAmount)} · Balance ₹ {fmt2(balanceDue)}
                </b>
              </div>
            )}
          </div>
        </section>

        <section className="si-bottom-grid">
          <div className="si-bottom-card">
            <div className="si-light-heading">
              <FaBuilding /> BILLING INFORMATION
            </div>
            <div className="si-info-list">
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
          <div className="si-bottom-card">
            <div className="si-light-heading">
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
        </section>

        <section className="si-signature-row">
          <div className="si-signature-line">
            <span>AUTHORIZED SIGNATORY</span>
          </div>
          <div className="si-signature-meta">
            <span>Date: {display(invoice.date, "—")}</span>
            <strong>For {display(settings.name, "Your Company Name")}</strong>
            {signatureName && <small>{signatureName}</small>}
          </div>
        </section>

        <footer className="si-footer">
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
      </div>
    </div>
  );
};

export default ServiceInvoice;
