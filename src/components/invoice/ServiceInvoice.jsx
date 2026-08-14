import React from "react";
import { getStoreSettings } from "../../services/storeSettingsService";
import "./ServiceInvoice.css";

const fmt2 = (n) => (Number(n) || 0).toFixed(2);

function addDays(yyyyMmDd, days) {
  if (!yyyyMmDd) return "";
  const d = new Date(yyyyMmDd);
  if (Number.isNaN(d.getTime())) return yyyyMmDd;
  d.setDate(d.getDate() + (Number(days) || 0));
  return d.toISOString().split("T")[0];
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

export const STATUS_LABELS = {
  PAID: { label: "PAID", tone: "paid" },
  PARTIAL: { label: "PARTIAL", tone: "partial" },
  PENDING: { label: "PENDING", tone: "pending" },
  CLEARED: { label: "CLEARED", tone: "paid" },
  CANCELLED: { label: "CANCELLED", tone: "cancelled" },
  OVERDUE: { label: "OVERDUE", tone: "overdue" },
};

export const computeStatus = (invoice, totalDue) => {
  const explicit = String(invoice?.status || "").toLowerCase();
  if (explicit === "cleared" || explicit === "paid") {
    return STATUS_LABELS.CLEARED;
  }
  if (explicit === "cancelled") {
    return STATUS_LABELS.CANCELLED;
  }

  const paid = Number(invoice.paidAmount || 0);
  if (paid <= 0) {
    const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
    if (due && !Number.isNaN(due.getTime()) && due.getTime() < Date.now()) {
      return STATUS_LABELS.OVERDUE;
    }
    return STATUS_LABELS.PENDING;
  }
  if (paid + 0.01 < (Number(totalDue) || 0)) {
    return STATUS_LABELS.PARTIAL;
  }
  return STATUS_LABELS.PAID;
};

// Indian numbering: 12,34,567.89 → "Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Eighty Nine Paise Only"
const numberToWordsIndian = (n) => {
  const num = Math.floor(Math.abs(Number(n) || 0));
  const paise = Math.round((Math.abs(Number(n) || 0) - num) * 100);
  if (num === 0 && paise === 0) return "Zero";

  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  const two = (x) => {
    if (x < 20) return ones[x];
    return `${tens[Math.floor(x / 10)]}${x % 10 ? " " + ones[x % 10] : ""}`;
  };
  const three = (x) => {
    const h = Math.floor(x / 100);
    const r = x % 100;
    return `${h ? ones[h] + " Hundred" : ""}${r ? (h ? " " : "") + two(r) : ""}`;
  };

  const parts = [];
  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const rest = num % 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${three(lakh)} Lakh`);
  if (thousand) parts.push(`${three(thousand)} Thousand`);
  if (rest) parts.push(three(rest));

  let words = parts.join(" ").trim();
  if (!words) words = "Zero";
  let out = `Rupees ${words}`;
  if (paise > 0) out += ` and ${two(paise)} Paise`;
  return `${out} Only`;
};

const normalizeState = (s) =>
  String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

const ServiceInvoice = ({ invoice, isDuplicate }) => {
  const settings = getStoreSettings();
  if (!invoice) return null;

  const items = Array.isArray(invoice.items) ? invoice.items : [];

  // PRIMARY: bill-level rate the cashier entered at billing time. ServiceBilling
  // always stamps this onto every saved invoice.
  // FALLBACK (legacy rows saved before this field existed): derive the rate
  // from the saved gstTotal/subTotal ratio. We deliberately do NOT read
  // settings.serviceTaxRate — that field is no longer a source for the
  // Service Store, and reading it would silently leak a configured store
  // default onto legacy rows that were originally generated without it.
  const explicitRate = Number(invoice.gstRate);
  const hasExplicitRate = Number.isFinite(explicitRate) && explicitRate >= 0;
  const subTotalForRate = Number(invoice.subTotal) || 0;
  const legacyRate =
    !hasExplicitRate && subTotalForRate > 0 && Number(invoice.gstTotal) > 0
      ? Math.round((Number(invoice.gstTotal) / subTotalForRate) * 10000) / 100
      : 0;
  const billGstRate = hasExplicitRate ? explicitRate : legacyRate;

  const mappedItems = items.map((item, idx) => {
    const units = item.hours ?? item.qty ?? item.qtyKg ?? item.units ?? 1;
    const rate = item.rate ?? item.price ?? 0;
    const lineTotal = (Number(units) || 0) * (Number(rate) || 0);

    return {
      key: item.id ?? `${idx}`,
      description: item.serviceDescription || item.name || "Service",
      hsn: item.hsn || item.hsnSac || item.sac || "",
      units: Number(units) || 0,
      rate: Number(rate) || 0,
      // Every line carries the same bill-level rate so the table column
      // reads identically across rows. legacy rows fall through to
      // Number(item.gst || 0) when neither path produced a usable rate.
      gst: billGstRate > 0 ? billGstRate : Number(item.gst || 0),
      total: lineTotal,
      tax: (lineTotal * (billGstRate > 0 ? billGstRate : Number(item.gst || 0))) / 100,
    };
  });

  const subTotal = Number(invoice.subTotal) || mappedItems.reduce((sum, row) => sum + row.total, 0);

  // Tax amount uses the bill-level rate directly. The cashier's input
  // (invoice.gstRate) is the only source; the saved gstTotal is accepted
  // as a fallback only when the legacy recovery above produced a usable
  // rate. settings.serviceTaxRate is never consulted.
  const lineTaxTotal = (subTotal * billGstRate) / 100;
  const taxAmountFromInvoice = Number(invoice.gstTotal);
  const taxAmount =
    billGstRate > 0
      ? lineTaxTotal
      : Number.isFinite(taxAmountFromInvoice) && taxAmountFromInvoice > 0
        ? taxAmountFromInvoice
        : 0;

  // The effective rate is always the bill-level rate (or its legacy
  // recovery). It is no longer an average — there is no per-line input
  // to average from.
  const effectiveRate = billGstRate;

  // CGST / SGST / IGST split. Intra-state (customer state === settings state)
  // splits the rate into two equal halves; inter-state shows IGST at the full rate.
  const taxState = normalizeState(invoice.customerState);
  const settingsState = normalizeState(settings.state);
  const isInterState = taxState && settingsState && taxState !== settingsState;
  const halfAmount = taxAmount / 2;
  const taxSplit = isInterState
    ? [{ label: "IGST", rate: effectiveRate, amount: taxAmount }]
    : [
        { label: "CGST", rate: effectiveRate / 2, amount: halfAmount },
        { label: "SGST", rate: effectiveRate / 2, amount: halfAmount },
      ];

  const totalDue = Number(invoice.grandTotal) || subTotal + taxAmount;

  const paymentMode = invoice.paymentMode || invoice.paymentMethod || invoice.payment || "Cash";

  const hasTax = taxAmount > 0;
  const invoiceTitle = hasTax ? "TAX INVOICE" : settings.serviceInvoiceTitle || "INVOICE";
  const invoiceSubtitle =
    settings.serviceInvoiceTitle && !hasTax ? settings.serviceInvoiceTitle : "Service Bill";

  const dueDays = Number(settings.serviceDueDays) || 0;
  const dueDate = invoice.dueDate || addDays(invoice.date, dueDays) || invoice.date;
  const servicePeriodFrom = invoice.serviceFrom || invoice.date;
  const servicePeriodTo = invoice.serviceTo || invoice.date;

  const bankAccount = settings.serviceBankAccount || settings.accountNo || "";

  const footerPhone = settings.serviceFooterPhone || settings.phone || "";
  const footerEmail = settings.serviceFooterEmail || settings.email || "";

  // Bill-to values MUST come from the cashier's input in the Service Billing
  // "Bill summary → Customer details" section, never from store settings.
  // Store settings hold *business* info (store name, store address, GSTIN,
  // bank account, footer phone/email) — leaking store-level customerName /
  // customerAddress / customerMobile / customerEmail / customerGst onto the
  // printed invoice replaces the customer's actual contact with the store's
  // own, which is the bug this commit fixes.
  //
  // Two source layers, both populated by ServiceBilling at save time:
  //   1. Top-level invoice camelCase keys (customerName, customerPhone,
  //      customerEmail, customerAddress, customerGst, customerState).
  //   2. items[0].meta — the JSON `items` column on the `invoices` table
  //      round-trips every customer field through this even for legacy
  //      rows where the dedicated DB columns are not yet populated.
  //
  // Precedence: top-level first, then items[0].meta, then the legacy flat
  // aliases (older payloads saved before the camelCase pass).
  const itemMeta = (items[0] && items[0].meta) || {};
  const pick = (...candidates) => {
    for (const c of candidates) {
      if (c == null) continue;
      const trimmed = String(c).trim();
      if (trimmed) return trimmed;
    }
    return "";
  };
  const billToName = pick(invoice.customerName, invoice.customer, itemMeta.guest);
  const billToAddress = pick(invoice.customerAddress, invoice.address, itemMeta.customerAddress);
  // Prefix "+91" only when the cashier typed a bare 10-digit Indian mobile.
  // If they explicitly typed a "+" prefix we keep what they entered verbatim.
  const rawPhone = pick(
    invoice.customerPhone,
    invoice.phone,
    invoice.customerMobile,
    invoice.mobile,
    itemMeta.customerPhone,
    itemMeta.customerMobile
  );
  const billToPhone = rawPhone ? (rawPhone.startsWith("+") ? rawPhone : `+91${rawPhone}`) : "";
  const billToEmail = pick(invoice.customerEmail, invoice.email, itemMeta.customerEmail);
  const billToGst = pick(invoice.customerGst, invoice.gst, itemMeta.customerGst);
  const billToState = pick(invoice.customerState, invoice.state, itemMeta.customerState);

  const terms = splitTerms(settings.serviceTerms);
  const signatureName = settings.serviceSignatureName || settings.name || "";
  const technician = invoice.technician || invoice.assignedTo || "";
  const jobRef = invoice.jobRef || invoice.poNumber || invoice.reference || "";
  const remarks = invoice.remarks || invoice.notes || "";

  const status = computeStatus(invoice, totalDue);
  const paidAmount = Number(invoice.paidAmount || 0);
  const balanceDue = Math.max((Number(totalDue) || 0) - paidAmount, 0);
  const amountInWords = numberToWordsIndian(totalDue);

  return (
    <div id="service-invoice" className="service-invoice">
      <div className="si-page">
        {/* Top Header */}
        <div className="si-top">
          <div className="si-title-block">
            <div className="si-title">{invoiceTitle}</div>
            <div className="si-subtitle">{invoiceSubtitle}</div>
          </div>
          {status && <span className={`si-status-pill ${status.tone}`}>{status.label}</span>}
        </div>

        <div className="si-topbar">
          <div className="si-inv-meta">
            <div className="si-meta-row">
              <span className="si-meta-label">Invoice Number:</span>
              <span className="si-meta-value">{invoice.invoiceNo}</span>
            </div>
            <div className="si-meta-row">
              <span className="si-meta-label">Invoice Date:</span>
              <span className="si-meta-value">{invoice.date}</span>
            </div>
            <div className="si-meta-row">
              <span className="si-meta-label">Due Date:</span>
              <span className="si-meta-value">{dueDate}</span>
            </div>
            {jobRef && (
              <div className="si-meta-row">
                <span className="si-meta-label">Job / Ref:</span>
                <span className="si-meta-value">{jobRef}</span>
              </div>
            )}
          </div>

          <div className="si-brand">
            {settings.logo && <img className="si-logo" src={settings.logo} alt="Company Logo" />}
            <div className="si-company-name">{settings.name || "Company"}</div>
            {settings.gstNo && <div className="si-company-gst">GSTIN: {settings.gstNo}</div>}
          </div>
        </div>

        {isDuplicate && <div className="si-duplicate">DUPLICATE COPY</div>}

        {/* Main Columns */}
        <div className="si-grid">
          <div className="si-box">
            <div className="si-box-title">From:</div>
            <div className="si-kv">
              <b>{settings.name || "Company"}</b>
            </div>
            <div className="si-kv">{settings.address || ""}</div>
            <div className="si-kv">
              {[settings.city, settings.state, settings.pincode].filter(Boolean).join(", ")}
            </div>
            <div className="si-kv">{settings.phone ? `Phone: ${settings.phone}` : ""}</div>
            <div className="si-kv">{settings.email ? `Email: ${settings.email}` : ""}</div>
            {settings.panNo && <div className="si-kv">PAN: {settings.panNo}</div>}
          </div>

          <div className="si-box">
            <div className="si-box-title">Bill To:</div>
            <div className="si-kv">
              <b>{billToName || "Walk-in Customer"}</b>
            </div>
            {billToAddress && <div className="si-kv">{billToAddress}</div>}
            {billToPhone && <div className="si-kv">Phone: {billToPhone}</div>}
            {billToEmail && <div className="si-kv">Email: {billToEmail}</div>}
            {billToState && <div className="si-kv">State: {billToState}</div>}
            {billToGst && <div className="si-kv">GSTIN: {billToGst}</div>}
          </div>
        </div>

        {/* Service period + technician strip */}
        <div className="si-period-strip">
          <div className="si-period-item">
            <span className="si-period-label">Service Period</span>
            <span className="si-period-value">
              {servicePeriodFrom}
              {servicePeriodTo && servicePeriodTo !== servicePeriodFrom
                ? ` → ${servicePeriodTo}`
                : ""}
            </span>
          </div>
          {technician && (
            <div className="si-period-item">
              <span className="si-period-label">Service Provider</span>
              <span className="si-period-value">{technician}</span>
            </div>
          )}
          <div className="si-period-item">
            <span className="si-period-label">Place of Supply</span>
            <span className="si-period-value">{settings.state || "—"}</span>
          </div>
        </div>

        {/* Table */}
        <div className="si-section-title">Service Details:</div>
        <table className="si-table">
          <thead>
            <tr>
              <th className="si-col-no">No</th>
              <th>Item Description</th>
              <th className="si-col-small">HSN/SAC</th>
              <th className="si-col-small">Hours/Units</th>
              <th className="si-col-small">Rate/Unit (₹)</th>
              <th className="si-col-small">GST %</th>
              <th className="si-col-small">Total (₹)</th>
            </tr>
          </thead>
          <tbody>
            {mappedItems.length === 0 ? (
              <tr>
                <td colSpan={7} className="si-empty">
                  No items
                </td>
              </tr>
            ) : (
              mappedItems.map((row, idx) => (
                <tr key={row.key} className={idx % 2 === 1 ? "is-alt" : ""}>
                  <td className="si-center">{idx + 1}</td>
                  <td>{row.description}</td>
                  <td className="si-center">{row.hsn || "—"}</td>
                  <td className="si-center">{row.units}</td>
                  <td className="si-right">{fmt2(row.rate)}</td>
                  <td className="si-center">{fmt2(row.gst)}%</td>
                  <td className="si-right">{fmt2(row.total)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Totals Bar */}
        <div className="si-totals">
          <div className="si-totals-row">
            <span>Subtotal</span>
            <span>₹{fmt2(subTotal)}</span>
          </div>
          {taxSplit.map((t) => (
            <div className="si-totals-row" key={t.label}>
              <span>
                {t.label} ({fmt2(t.rate)}%)
              </span>
              <span>₹{fmt2(t.amount)}</span>
            </div>
          ))}
          <div className="si-totals-row strong">
            <span>Total Amount Due</span>
            <span>₹{fmt2(totalDue)}</span>
          </div>
          {paidAmount > 0 && (
            <>
              <div className="si-totals-row paid">
                <span>Paid ({paymentMode})</span>
                <span>− ₹{fmt2(paidAmount)}</span>
              </div>
              <div className="si-totals-row strong balance">
                <span>Balance Due</span>
                <span>₹{fmt2(balanceDue)}</span>
              </div>
            </>
          )}
          <div className="si-totals-words">
            <b>Amount in words:</b> {amountInWords}
          </div>
        </div>

        {/* Bottom Columns */}
        <div className="si-bottom-grid">
          <div className="si-box">
            <div className="si-box-title">Billing Information:</div>
            <div className="si-kv">
              <b>Payment Method:</b> {paymentMode}
            </div>
            <div className="si-kv">
              <b>Due Date:</b> {dueDate}
            </div>
            {bankAccount && (
              <div className="si-kv">
                <b>Bank A/c:</b> {bankAccount}
              </div>
            )}
            {settings.ifscCode && (
              <div className="si-kv">
                <b>IFSC:</b> {settings.ifscCode}
              </div>
            )}
            {settings.bankName && (
              <div className="si-kv">
                <b>Bank:</b> {settings.bankName}
              </div>
            )}
          </div>

          <div className="si-box">
            <div className="si-box-title">Terms and Conditions:</div>
            {terms.length === 0 ? (
              <ul className="si-terms">
                <li>Payment is due upon receipt of this invoice.</li>
                <li>Late payments may incur additional charges.</li>
                <li>Please make checks payable to {settings.name || "Your Company Name"}.</li>
              </ul>
            ) : (
              <ul className="si-terms">
                {terms.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            )}

            {remarks && (
              <div className="si-remarks">
                <div className="si-box-title">Remarks:</div>
                <p>{remarks}</p>
              </div>
            )}

            <div className="si-sign">
              <div className="si-sign-date">Date : {invoice.date}</div>
              <div className="si-sign-line" />
              <div className="si-sign-name">{signatureName}</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="si-footer">
          <div className="si-footer-item">{footerPhone}</div>
          <div className="si-footer-item">{footerEmail}</div>
          <div className="si-footer-item">Thank you for your business</div>
        </div>
      </div>
    </div>
  );
};

export default ServiceInvoice;
