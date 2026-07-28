import React from "react";
import { getStoreSettings } from "../../services/storeSettingsService";
import { QRCodeCanvas } from "qrcode.react";

const RetailPrintInvoice = ({ invoice, isDuplicate }) => {
  const settings = getStoreSettings();

  if (!invoice) return null;

  const fmt2 = (n) => (Number(n) || 0).toFixed(2);

  const getUnitForItem = (item) => {
    if (item?.unit) return item.unit;
    if ((settings.businessType || "retail") !== "retail") return "kg";
    return item?.category === "Groceries" ? "kg" : "unit";
  };

  const getQtyForItem = (item) => {
    const unit = getUnitForItem(item);
    if (unit === "kg") return Number(item.qtyKg ?? item.qty) || 0;
    return Number(item.qty ?? item.qtyKg) || 0;
  };

  // Calculate totals
  const subTotal = invoice.subTotal || 0;
  const gstTotal = invoice.gstTotal || 0;
  const grandTotal = invoice.grandTotal || 0;

  return (
    <div
      id="retail-print-invoice"
      style={{
        fontFamily: "monospace",
        fontSize: "12px",
        maxWidth: "80mm",
        margin: "0 auto",
        background: "white",
        color: "#111",
        padding: "8px",
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
            style={{ width: "60px", height: "60px", margin: "5px 0" }}
          />
        </center>
      )}

      {/* STORE DETAILS */}
      <center>
        <strong style={{ fontSize: "15px" }}>{settings.name}</strong>
        <br />
        {settings.address}
        <br />
        {settings.phone}
      </center>

      <div style={{ borderTop: "1px dashed #ccc", margin: "8px 0" }}></div>

      {/* INVOICE INFO */}
      <div style={{ fontSize: "11px", marginBottom: "6px" }}>
        Invoice No: {invoice.invoiceNo} <br />
        Date: {invoice.date} <br />
        Payment: {invoice.paymentMode}
        <br />
        <span style={{ fontSize: "10px", color: "#555" }}>
          Billed By: {invoice.billedBy || "Unknown"}
        </span>
      </div>

      {/* CUSTOMER / GUEST INFO — always shown; falls back to "Walking Customer" */}
      <div
        style={{
          fontSize: "11px",
          borderBottom: "1px dashed #ccc",
          paddingBottom: "5px",
          marginBottom: "8px",
        }}
      >
        <div>
          <strong>Customer:</strong>
        </div>
        {invoice?.hotelDetails?.guestName ? (
          <div>{invoice.hotelDetails.guestName}</div>
        ) : invoice?.customerName && String(invoice.customerName).trim() ? (
          <div>{invoice.customerName}</div>
        ) : (
          <div>Walking Customer</div>
        )}
        {invoice?.hotelDetails?.roomNumber && <div>Room: {invoice.hotelDetails.roomNumber}</div>}
        {invoice?.hotelDetails?.idProof &&
          (invoice.hotelDetails.idProof.type || invoice.hotelDetails.idProof.number) && (
            <div>
              ID: {invoice.hotelDetails.idProof.type || ""}
              {invoice.hotelDetails.idProof.type && invoice.hotelDetails.idProof.number
                ? " - "
                : ""}
              {invoice.hotelDetails.idProof.number || ""}
            </div>
          )}
        {invoice?.customerPhone && String(invoice.customerPhone).trim() && (
          <div>Mobile: {invoice.customerPhone}</div>
        )}
      </div>

      {/* ITEMS TABLE */}
      <table
        style={{
          width: "100%",
          fontSize: "11px",
          borderCollapse: "collapse",
          marginBottom: "8px",
          tableLayout: "fixed",
        }}
      >
        <colgroup>
          <col style={{ width: "40%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "18%" }} />
          <col style={{ width: "24%" }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: "1px solid #000" }}>
            <th style={{ textAlign: "left", padding: "2px 0", fontWeight: "bold" }}>Item</th>
            <th style={{ textAlign: "center", padding: "2px 0", fontWeight: "bold" }}>Qty</th>
            <th style={{ textAlign: "right", padding: "2px 0", fontWeight: "bold" }}>Rate</th>
            <th style={{ textAlign: "right", padding: "2px 0", fontWeight: "bold" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((item, index) => (
            <tr key={index}>
              <td style={{ textAlign: "left", padding: "2px 0", wordBreak: "break-word" }}>
                {item.name}
                {(() => {
                  const gstPercent = Number(item.gst || 0);
                  const gstAmt = (getQtyForItem(item) * Number(item.price || 0) * gstPercent) / 100;
                  if (!gstPercent || !gstAmt) return null;
                  return (
                    <div style={{ fontSize: "10px", color: "#555" }}>
                      GST {gstPercent.toFixed(0)}% | ₹{gstAmt.toFixed(2)}
                    </div>
                  );
                })()}
              </td>
              <td style={{ textAlign: "center", padding: "2px 0" }}>
                {(() => {
                  const unit = getUnitForItem(item);
                  const qty = getQtyForItem(item);
                  return unit === "kg" ? qty.toFixed(3) : qty.toFixed(0);
                })()}
              </td>
              <td style={{ textAlign: "right", padding: "2px 0" }}>
                {(() => {
                  const unit = getUnitForItem(item);
                  return `₹${fmt2(item.price)}/${unit}`;
                })()}
              </td>
              <td style={{ textAlign: "right", padding: "2px 0" }}>
                ₹{fmt2(getQtyForItem(item) * (Number(item.price) || 0))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* TOTALS */}
      <table style={{ width: "100%", fontSize: "12px", marginBottom: "8px" }}>
        <tbody>
          <tr>
            <td>Subtotal:</td>
            <td style={{ textAlign: "right" }}>₹{fmt2(subTotal)}</td>
          </tr>
          {invoice.discountBreakdown && invoice.discountBreakdown.totalSavings > 0 && (
            <>
              {invoice.discountBreakdown.line && invoice.discountBreakdown.line.length > 0 && (
                <tr>
                  <td style={{ fontSize: "11px", color: "#1f8a3b" }}>
                    Line discount
                    {invoice.discountBreakdown.line.length > 1
                      ? ` (${invoice.discountBreakdown.line.length} items)`
                      : `: ${invoice.discountBreakdown.line[0].productName}`}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontSize: "11px",
                      color: "#1f8a3b",
                    }}
                  >
                    −₹
                    {fmt2(
                      invoice.discountBreakdown.line.reduce((s, l) => s + Number(l.saved || 0), 0)
                    )}
                  </td>
                </tr>
              )}
              {invoice.discountBreakdown.bill && (
                <tr>
                  <td style={{ fontSize: "11px", color: "#1f8a3b" }}>
                    Bill{" "}
                    {invoice.discountBreakdown.bill.type === "percent"
                      ? `${invoice.discountBreakdown.bill.value}%`
                      : `₹${invoice.discountBreakdown.bill.value}`}{" "}
                    off
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      fontSize: "11px",
                      color: "#1f8a3b",
                    }}
                  >
                    −₹
                    {fmt2(
                      Math.min(
                        Number(invoice.subTotal || 0),
                        invoice.discountBreakdown.bill.type === "percent"
                          ? (Number(invoice.subTotal || 0) *
                              Number(invoice.discountBreakdown.bill.value)) /
                              100
                          : Number(invoice.discountBreakdown.bill.value)
                      )
                    )}
                  </td>
                </tr>
              )}
              <tr>
                <td style={{ fontSize: "11px", color: "#1f8a3b" }}>You saved</td>
                <td
                  style={{
                    textAlign: "right",
                    fontSize: "11px",
                    color: "#1f8a3b",
                  }}
                >
                  ₹{fmt2(invoice.discountBreakdown.totalSavings)}
                </td>
              </tr>
            </>
          )}
          <tr>
            <td>GST:</td>
            <td style={{ textAlign: "right" }}>₹{fmt2(gstTotal)}</td>
          </tr>
          <tr>
            <td>
              <strong>Grand Total:</strong>
            </td>
            <td style={{ textAlign: "right" }}>
              <strong>₹{fmt2(grandTotal)}</strong>
            </td>
          </tr>
        </tbody>
      </table>

      {/* SPLIT-PAYMENT BREAKDOWN */}
      {invoice.paymentMode === "Split" &&
        Array.isArray(invoice.payments) &&
        invoice.payments.length > 0 && (
          <div
            style={{
              fontSize: "11px",
              marginTop: "6px",
              padding: "4px 0",
              borderTop: "1px dashed #999",
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: "2px" }}>Paid via:</div>
            {invoice.payments.map((p, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{p.mode}</span>
                <span>₹{fmt2(p.amount)}</span>
              </div>
            ))}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: "2px",
                fontWeight: 600,
              }}
            >
              <span>Tendered:</span>
              <span>₹{fmt2(invoice.tendered || 0)}</span>
            </div>
            {Number(invoice.changeDue || 0) > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  color: "#1f8a3b",
                }}
              >
                <span>Change Due:</span>
                <span>₹{fmt2(invoice.changeDue)}</span>
              </div>
            )}
          </div>
        )}

      {/* QR CODE BLOCK */}
      <div style={{ marginTop: "10px", marginBottom: "10px" }}>
        {/* Show UPI QR only if paymentMode is UPI */}
        {invoice.paymentMode === "UPI" &&
          (settings.qrType === "UPI" || settings.qrType === "BOTH") && (
            <center>
              <QRCodeCanvas
                value={`upi://pay?pa=${settings.upiId}&pn=${settings.name}&am=${fmt2(grandTotal)}`}
                size={100}
              />
              <div style={{ fontSize: "11px", marginTop: "2px" }}>UPI Payment</div>
            </center>
          )}
        {/* Always show Order QR if enabled */}
        {(settings.qrType === "INVOICE" || settings.qrType === "BOTH") && (
          <center>
            <QRCodeCanvas
              value={JSON.stringify({ invoiceNo: invoice.invoiceNo, amount: fmt2(grandTotal) })}
              size={100}
            />
            <div style={{ fontSize: "11px", marginTop: "2px" }}>Order QR</div>
          </center>
        )}
      </div>

      {/* FOOTER */}
      <center style={{ fontSize: "10px", marginTop: "8px" }}>
        <div>Thank you for your business!</div>
        <div style={{ marginTop: "5px", fontSize: "9px" }}>Powered by POS System</div>
      </center>
    </div>
  );
};

export default RetailPrintInvoice;
