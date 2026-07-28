import React from "react";
import { getStoreSettings } from "../../services/storeSettingsService";
import { QRCodeCanvas } from "qrcode.react";
import "./MSMEInvoice.css";

const STATUS_TONES = {
  pending: { bg: "#fff4d6", color: "#92400e", dot: "#f59e0b", label: "PENDING" },
  paid: { bg: "#d1fae5", color: "#047857", dot: "#10b981", label: "PAID" },
  cleared: { bg: "#d1fae5", color: "#047857", dot: "#10b981", label: "CLEARED" },
  cancelled: { bg: "#fee2e2", color: "#b91c1c", dot: "#ef4444", label: "CANCELLED" },
};

const StatusBadge = ({ status }) => {
  const tone = STATUS_TONES[status] || STATUS_TONES.pending;
  return (
    <span
      className="msme-status-badge"
      style={{ background: tone.bg, color: tone.color }}
      aria-label={`Status: ${tone.label}`}
    >
      <span className="msme-status-dot" style={{ background: tone.dot }} />
      {tone.label}
    </span>
  );
};

const MSMEInvoice = ({ invoice, isDuplicate, isPreview = false }) => {
  const settings = getStoreSettings();

  if (!invoice) return null;

  const fmt2 = (n) => (Number(n) || 0).toFixed(2);

  const paymentMode = invoice.paymentMode || invoice.paymentMethod || invoice.payment || "Cash";
  const invoiceStatus = invoice.status || "pending";

  // Calculate GST components
  const subTotal = invoice.subTotal || 0;
  const gstTotal = invoice.gstTotal || 0;
  const grandTotal = invoice.grandTotal || 0;

  // For Indian GST, split into CGST and SGST (assuming intra-state)
  const cgstAmount = gstTotal / 2;
  const sgstAmount = gstTotal / 2;

  // If preview mode, show compact thermal-style layout
  if (isPreview) {
    return (
      <div id="msme-invoice-print" className="msme-invoice-preview">
        <div
          className="thermal-classic"
          style={{
            width: "80mm",
            padding: "8px",
            fontFamily: "monospace",
            fontSize: "11px",
            background: "white",
            border: "1px solid #ccc",
          }}
        >
          {/* COPY TYPE */}
          <center>
            <strong style={{ color: isDuplicate ? "red" : "green" }}>
              {isDuplicate ? "DUPLICATE COPY" : "ORIGINAL COPY"}
            </strong>
          </center>

          {/* LOGO */}
          {settings.logo && (
            <center>
              <img
                src={settings.logo}
                alt="Store Logo"
                style={{ maxHeight: "40px", maxWidth: "60px", margin: "5px 0" }}
              />
            </center>
          )}

          {/* HEADER */}
          <center>
            <strong>{settings.name}</strong>
            <br />
            {settings.address}
            <br />
            Phone: {settings.phone}
            <br />
            GST: {settings.gstNo || "22AAAAA0000A1Z5"}
            <br />
            <strong>TAX INVOICE</strong>
          </center>

          <hr style={{ border: "1px solid #000", margin: "8px 0" }} />

          {/* STATUS BADGE (pending / paid / cleared) */}
          <center style={{ marginBottom: "8px" }}>
            <StatusBadge status={invoiceStatus} />
          </center>

          <hr style={{ border: "1px solid #000", margin: "8px 0" }} />

          {/* INVOICE DETAILS */}
          <div style={{ marginBottom: "8px" }}>
            Invoice No: {invoice.invoiceNo}
            <br />
            Date: {invoice.date}
            <br />
            Payment: {paymentMode}
            <br />
            <span style={{ fontSize: "10px", color: "#555" }}>
              Billed By: {invoice.billedBy || "Unknown"}
            </span>
          </div>

          {/* UPI QR (if enabled in settings) */}
          {(settings.qrType === "UPI" || settings.qrType === "BOTH") && settings.upiId && (
            <>
              <hr style={{ border: "1px solid #000", margin: "8px 0" }} />
              <center>
                <QRCodeCanvas
                  value={`upi://pay?pa=${settings.upiId}&pn=${settings.name}&am=${fmt2(grandTotal)}`}
                  size={100}
                />
                <div style={{ fontSize: "11px", marginTop: "2px" }}>UPI Payment</div>
              </center>
            </>
          )}

          {/* CUSTOMER DETAILS */}
          <div style={{ marginBottom: "8px" }}>
            <strong>Bill To:</strong>
            <br />
            {settings.customerName || "Walk-in Customer"}
            <br />
            {settings.customerMobile && `Mobile: +91${settings.customerMobile}`}
            <br />
            {settings.customerAddress && `${settings.customerAddress}`}
          </div>

          <hr style={{ border: "1px solid #000", margin: "8px 0" }} />

          {/* ITEMS TABLE */}
          <div style={{ marginBottom: "8px" }}>
            {invoice.items.map((item, index) => (
              <div key={index} style={{ marginBottom: "4px", fontSize: "10px" }}>
                <div>
                  <strong>{item.name}</strong>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span>
                    Qty: {item.qtyKg.toFixed(0)} × ₹{fmt2(item.price)}
                  </span>
                  <span>₹{fmt2(item.qtyKg * item.price)}</span>
                </div>
                <div style={{ fontSize: "9px", color: "#666" }}>
                  HSN: {item.hsn || "9983"} | GST: {item.gst}%
                </div>
              </div>
            ))}
          </div>

          <hr style={{ border: "1px solid #000", margin: "8px 0" }} />

          {/* TOTALS */}
          <div style={{ marginBottom: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Subtotal:</span>
              <span>₹{fmt2(subTotal)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>CGST @ 9%:</span>
              <span>₹{fmt2(cgstAmount)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>SGST @ 9%:</span>
              <span>₹{fmt2(sgstAmount)}</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontWeight: "bold",
                borderTop: "1px solid #000",
                paddingTop: "4px",
              }}
            >
              <span>GRAND TOTAL:</span>
              <span>₹{fmt2(grandTotal)}</span>
            </div>
          </div>

          {/* AMOUNT IN WORDS */}
          <div style={{ marginBottom: "8px", fontSize: "10px" }}>
            <strong>Amount:</strong> {numberToWords(grandTotal)} Only
          </div>

          <hr style={{ border: "1px solid #000", margin: "8px 0" }} />

          {/* FOOTER */}
          <center style={{ fontSize: "9px" }}>
            Thank you for your business!
            <br />
            {settings.name}
          </center>
        </div>
      </div>
    );
  }

  // Full A4 layout for printing
  return (
    <div id="msme-invoice-print" className="msme-invoice msme-invoice-container">
      <div className="invoice-container">
        {/* HEADER */}
        <div className="invoice-header">
          <div className="company-info">
            {/* LOGO */}
            {settings.logo && <img src={settings.logo} alt="Store Logo" className="invoice-logo" />}
            <h1 className="company-name">{settings.name}</h1>
            <div className="company-details">
              <p>{settings.address}</p>
              <p>Phone: {settings.phone}</p>
              <p>Email: {settings.email || "info@company.com"}</p>
              <p>
                <strong>GST No: {settings.gstNo || "22AAAAA0000A1Z5"}</strong>
              </p>
              <p>
                <strong>PAN: {settings.panNo || "AAAAA0000A"}</strong>
              </p>
            </div>
          </div>

          <div className="invoice-title">
            <h2>TAX INVOICE</h2>
            {isDuplicate && <div className="duplicate-stamp">DUPLICATE COPY</div>}
            <div style={{ marginTop: 8, display: "inline-block" }}>
              <StatusBadge status={invoiceStatus} />
            </div>
          </div>
        </div>

        {/* INVOICE DETAILS */}
        <div className="invoice-details">
          <div className="detail-row">
            <div className="detail-group">
              <strong>Invoice No:</strong> {invoice.invoiceNo}
            </div>
            <div className="detail-group">
              <strong>Invoice Date:</strong> {invoice.date}
            </div>
          </div>

          <div className="detail-row">
            <div className="detail-group">
              <strong>Payment Mode:</strong> {paymentMode}
            </div>
            <div className="detail-group">
              <strong>Due Date:</strong> {invoice.date}
            </div>
          </div>
          <div className="detail-row">
            <div className="detail-group" style={{ fontSize: "12px", color: "#555" }}>
              <strong>Billed By:</strong> {invoice.billedBy || "Unknown"}
            </div>
          </div>
        </div>

        {/* BILL TO / SHIP TO */}
        <div className="party-details">
          <div className="bill-to">
            <h3>Bill To:</h3>
            <div className="party-info">
              <p>
                <strong>{settings.customerName || "Walk-in Customer"}</strong>
              </p>
              {settings.customerMobile && <p>Mobile: +91{settings.customerMobile}</p>}
              {settings.customerAddress && <p>{settings.customerAddress}</p>}
              {settings.customerGst && <p>GST No: {settings.customerGst}</p>}
            </div>
          </div>

          <div className="ship-to">
            <h3>Ship To:</h3>
            <div className="party-info">
              <p>
                <strong>{settings.customerName || "Walk-in Customer"}</strong>
              </p>
              {settings.customerMobile && <p>Mobile: +91{settings.customerMobile}</p>}
              {settings.customerAddress && <p>{settings.customerAddress}</p>}
            </div>
          </div>
        </div>

        {/* ITEMS TABLE */}
        <div className="items-section">
          <table className="items-table">
            <thead>
              <tr>
                <th className="sno">S.No</th>
                <th className="service-desc">Service Description</th>
                <th className="hours">Hours</th>
                <th className="rate">Rate</th>
                <th className="amount">Amount</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((item, index) => (
                <tr key={index}>
                  <td className="sno">{index + 1}</td>
                  <td className="service-desc">{item.name}</td>
                  <td className="hours">{item.hours || item.qtyKg || 1}</td>
                  <td className="rate">₹{fmt2(item.price)}</td>
                  <td className="amount">₹{fmt2((item.hours || item.qtyKg || 1) * item.price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* TAX SUMMARY */}
        <div className="tax-summary">
          <div className="tax-breakup">
            <h4>Tax Summary</h4>
            <table className="tax-table">
              <tbody>
                <tr>
                  <td>Subtotal:</td>
                  <td>₹{fmt2(subTotal)}</td>
                </tr>
                <tr>
                  <td>CGST @ 9%:</td>
                  <td>₹{fmt2(cgstAmount)}</td>
                </tr>
                <tr>
                  <td>SGST @ 9%:</td>
                  <td>₹{fmt2(sgstAmount)}</td>
                </tr>
                <tr className="total-row">
                  <td>
                    <strong>Grand Total:</strong>
                  </td>
                  <td>
                    <strong>₹{fmt2(grandTotal)}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="amount-words">
            <strong>Amount in Words:</strong>
            <br />
            {numberToWords(grandTotal)} Only
          </div>
        </div>

        {/* FOOTER */}
        <div className="invoice-footer">
          <div className="declaration">
            <h4>Declaration:</h4>
            <p>
              We declare that this invoice shows the actual price of the goods/services described
              and that all particulars are true and correct. This is a computer generated invoice
              and does not require signature.
            </p>
          </div>

          <div className="bank-details">
            <h4>Bank Details:</h4>
            <p>Bank Name: {settings.bankName || "State Bank of India"}</p>
            <p>Account No: {settings.accountNo || "1234567890"}</p>
            <p>IFSC Code: {settings.ifscCode || "SBIN0001234"}</p>
            <p>Branch: {settings.branch || "Main Branch"}</p>
          </div>

          <div className="signature-section">
            <div className="signature-box">
              <p>Authorized Signatory</p>
              <br />
              <br />
              <p>____________________</p>
              <p>{settings.name}</p>
            </div>
          </div>
        </div>

        {/* TERMS AND CONDITIONS */}
        <div className="terms-conditions">
          <h4>Terms & Conditions:</h4>
          <ul>
            <li>Goods once sold will not be taken back.</li>
            <li>Interest @ 24% p.a. will be charged on overdue amounts.</li>
            <li>Subject to {settings.city || "City"} jurisdiction only.</li>
            <li>E. & O.E. (Errors and Omissions Excepted)</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

// Function to convert number to words
function numberToWords(num) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
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
  const teens = [
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

  function convertLessThanThousand(n) {
    if (n === 0) return "";
    let result = "";

    if (n >= 100) {
      result += ones[Math.floor(n / 100)] + " Hundred ";
      n %= 100;
    }

    if (n >= 20) {
      result += tens[Math.floor(n / 10)] + " ";
      n %= 10;
    } else if (n >= 10) {
      result += teens[n - 10] + " ";
      return result.trim();
    }

    if (n > 0) {
      result += ones[n] + " ";
    }

    return result.trim();
  }

  if (num === 0) return "Zero";

  let result = "";
  let crore = Math.floor(num / 10000000);
  let lakh = Math.floor((num % 10000000) / 100000);
  let thousand = Math.floor((num % 100000) / 1000);
  let remainder = Math.floor(num % 1000);

  if (crore > 0) {
    result += convertLessThanThousand(crore) + " Crore ";
  }
  if (lakh > 0) {
    result += convertLessThanThousand(lakh) + " Lakh ";
  }
  if (thousand > 0) {
    result += convertLessThanThousand(thousand) + " Thousand ";
  }
  if (remainder > 0) {
    result += convertLessThanThousand(remainder);
  }

  return result.trim();
}

export default MSMEInvoice;
