import React from "react";
import { getStoreSettings } from "../../services/storeSettingsService";
import { QRCodeCanvas } from "qrcode.react";

const DiningInvoice = ({ invoice, isDuplicate }) => {
  const settings = getStoreSettings();

  if (!invoice) return null;

  const fmt2 = (n) => (Number(n) || 0).toFixed(2);
  const items = Array.isArray(invoice.items) ? invoice.items : [];

  // Calculate totals
  const subTotal = Number(
    invoice.subTotal ?? items.reduce((sum, item) => sum + (Number(item.total) || 0), 0)
  );
  const gstTotal = Number(
    invoice.gstTotal ?? items.reduce((sum, item) => sum + (Number(item.gst) || 0), 0)
  );
  const grandTotal = Number(invoice.grandTotal ?? subTotal + gstTotal);

  return (
    <div
      id="dining-print-invoice"
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

      {/* CUSTOMER / GUEST INFO */}
      {(invoice?.hotelDetails?.guestName || invoice?.customerName || settings.customerName) && (
        <div
          style={{
            fontSize: "11px",
            borderBottom: "1px dashed #ccc",
            paddingBottom: "5px",
            marginBottom: "8px",
          }}
        >
          <div>
            <strong>Dining Details:</strong>
          </div>
          {invoice?.hotelDetails?.guestName ? (
            <div>Guest: {invoice.hotelDetails.guestName}</div>
          ) : invoice?.customerName ? (
            <div>Guest: {invoice.customerName}</div>
          ) : (
            settings.customerName && <div>Guest: {settings.customerName}</div>
          )}
          {invoice?.hotelDetails?.tableName && <div>Table: {invoice.hotelDetails.tableName}</div>}
          {invoice?.hotelDetails?.partySize && (
            <div>Party Size: {invoice.hotelDetails.partySize}</div>
          )}
          {invoice?.hotelDetails?.checkInTime && (
            <div>Check-in: {invoice.hotelDetails.checkInTime}</div>
          )}
          {invoice?.hotelDetails?.checkOutTime && (
            <div>Check-out: {invoice.hotelDetails.checkOutTime}</div>
          )}
        </div>
      )}

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
          <col style={{ width: "41%" }} />
          <col style={{ width: "13%" }} />
          <col style={{ width: "20%" }} />
          <col style={{ width: "26%" }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: "1px solid #000" }}>
            <th style={{ textAlign: "left", padding: "2px 6px 2px 0", fontWeight: "bold" }}>
              Item
            </th>
            <th
              style={{
                textAlign: "center",
                padding: "2px 4px",
                fontWeight: "bold",
                whiteSpace: "nowrap",
              }}
            >
              Qty
            </th>
            <th
              style={{
                textAlign: "right",
                padding: "2px 4px",
                fontWeight: "bold",
                whiteSpace: "nowrap",
              }}
            >
              Rate
            </th>
            <th
              style={{
                textAlign: "right",
                padding: "2px 0 2px 4px",
                fontWeight: "bold",
                whiteSpace: "nowrap",
              }}
            >
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const qty = Number(item?.qty ?? item?.quantity ?? 1);
            const rate = Number(item?.rate ?? item?.price ?? 0);
            const total = Number(item?.total ?? qty * rate);
            const gstPercent = Number(item.gst || 0);
            const gstAmt = (total * gstPercent) / 100;

            return (
              <tr key={index}>
                <td
                  style={{
                    textAlign: "left",
                    padding: "2px 6px 2px 0",
                    wordBreak: "break-word",
                    overflowWrap: "anywhere",
                    verticalAlign: "top",
                  }}
                >
                  <div style={{ paddingRight: 4 }}>{String(item.name || "").trim()}</div>
                  {gstPercent > 0 && gstAmt > 0 && (
                    <div style={{ fontSize: "10px", color: "#555" }}>
                      GST {gstPercent.toFixed(0)}% | ₹{gstAmt.toFixed(2)}
                    </div>
                  )}
                </td>
                <td
                  style={{
                    textAlign: "center",
                    padding: "2px 4px",
                    verticalAlign: "top",
                    whiteSpace: "nowrap",
                  }}
                >
                  {qty.toFixed(0)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "2px 4px",
                    verticalAlign: "top",
                    whiteSpace: "nowrap",
                  }}
                >
                  ₹{fmt2(rate)}
                </td>
                <td
                  style={{
                    textAlign: "right",
                    padding: "2px 0 2px 4px",
                    verticalAlign: "top",
                    whiteSpace: "nowrap",
                  }}
                >
                  ₹{fmt2(total)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* TOTALS */}
      <table style={{ width: "100%", fontSize: "12px", marginBottom: "8px" }}>
        <tbody>
          <tr>
            <td>Subtotal:</td>
            <td style={{ textAlign: "right" }}>₹{fmt2(subTotal)}</td>
          </tr>
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
        <div>Thank you for dining with us!</div>
        <div style={{ marginTop: "5px", fontSize: "9px" }}>Powered by POS System</div>
      </center>
    </div>
  );
};

export default DiningInvoice;
