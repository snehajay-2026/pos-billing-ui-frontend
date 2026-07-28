import React from "react";
import { getStoreSettings } from "../../services/storeSettingsService";
import { QRCodeCanvas } from "qrcode.react";

const LodgingInvoice = ({ invoice, isDuplicate }) => {
  const settings = getStoreSettings();

  if (!invoice) return null;

  const fmt2 = (n) => (Number(n) || 0).toFixed(2);
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const getRate = (item) => Number(item?.rate ?? item?.price ?? 0);
  const getQty = (item) => Number(item?.qty ?? item?.quantity ?? 1);
  const getRoomTypeLabel = (item) => {
    const acRaw = String(item?.meta?.roomAc || "")
      .trim()
      .toLowerCase();
    const isAc = acRaw.includes("ac") && !acRaw.includes("non");
    const isNonAc = acRaw.includes("non") || acRaw.includes("without ac");
    const isModern = Boolean(item?.meta?.roomModern);

    if (isAc && isModern) return "AC with Modern";
    if (isNonAc) return "Non-AC";
    if (isAc) return "AC";
    return isModern ? "Modern" : "-";
  };
  const getNights = (item) => {
    const rawNights =
      item?.meta?.nights ??
      item?.meta?.stayNights ??
      item?.nights ??
      item?.qty ??
      item?.quantity ??
      1;
    const fromNumber = Math.floor(Number(rawNights));
    if (Number.isFinite(fromNumber) && fromNumber > 0) return fromNumber;
    const matchedDigits = String(rawNights).match(/\d+/);
    if (matchedDigits) {
      const fromDigits = Math.floor(Number(matchedDigits[0]));
      if (Number.isFinite(fromDigits) && fromDigits > 0) return fromDigits;
    }
    return 1;
  };
  const getAmount = (item) => {
    const explicitTotal = Number(item?.total);
    if (!Number.isNaN(explicitTotal) && explicitTotal > 0) return explicitTotal;
    return getQty(item) * getRate(item);
  };

  // Calculate totals
  const subTotal = Number(
    invoice.subTotal ?? items.reduce((sum, item) => sum + getAmount(item), 0)
  );
  const gstTotal = Number(
    invoice.gstTotal ??
      items.reduce((sum, item) => sum + (getAmount(item) * Number(item?.gst || 0)) / 100, 0)
  );
  const grandTotal = Number(invoice.grandTotal ?? subTotal + gstTotal);
  const guestMobile = String(
    invoice?.hotelDetails?.customerMobile ||
      items.find((item) => item?.meta?.customerMobile)?.meta?.customerMobile ||
      invoice?.customerMobile ||
      ""
  ).trim();

  return (
    <div
      id="lodging-print-invoice"
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
      {(invoice?.hotelDetails?.guestName ||
        invoice?.customerName ||
        settings.customerName ||
        guestMobile) && (
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
          ) : invoice?.customerName ? (
            <div>{invoice.customerName}</div>
          ) : (
            settings.customerName && <div>{settings.customerName}</div>
          )}
          {guestMobile && <div>Mobile: {guestMobile}</div>}
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
          {(items[0]?.meta?.checkInDate || items[0]?.meta?.checkInTime) && (
            <div>
              {items[0]?.meta?.checkInDate && <span>Check-in: {items[0].meta.checkInDate}</span>}
              {items[0]?.meta?.checkInTime && (
                <span>
                  {items[0].meta.checkInDate ? " " : "Check-in: "}
                  {items[0].meta.checkInTime}
                </span>
              )}
            </div>
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
          <col style={{ width: "40%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "18%" }} />
        </colgroup>
        <thead>
          <tr style={{ borderBottom: "1px solid #000" }}>
            <th style={{ textAlign: "left", padding: "2px 0", fontWeight: "bold" }}>Service</th>
            <th style={{ textAlign: "left", padding: "2px 0", fontWeight: "bold" }}>Room</th>
            <th style={{ textAlign: "left", padding: "2px 0", fontWeight: "bold" }}>Room Type</th>
            <th style={{ textAlign: "center", padding: "2px 0", fontWeight: "bold" }}>Nights</th>
            <th style={{ textAlign: "right", padding: "2px 0", fontWeight: "bold" }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index}>
              <td style={{ textAlign: "left", padding: "2px 0", wordBreak: "break-word" }}>
                {item.name}
                {(() => {
                  const gstPercent = Number(item.gst || 0);
                  const gstAmt = (getAmount(item) * gstPercent) / 100;
                  if (!gstPercent || !gstAmt) return null;
                  return (
                    <div style={{ fontSize: "10px", color: "#555" }}>
                      GST {gstPercent.toFixed(0)}% | ₹{gstAmt.toFixed(2)}
                    </div>
                  );
                })()}
              </td>
              <td style={{ textAlign: "left", padding: "2px 0" }}>
                {item?.meta?.roomName ||
                  item?.meta?.roomId ||
                  invoice?.hotelDetails?.roomNumber ||
                  "-"}
              </td>
              <td style={{ textAlign: "left", padding: "2px 0" }}>{getRoomTypeLabel(item)}</td>
              <td style={{ textAlign: "center", padding: "2px 0" }}>{getNights(item)}</td>
              <td style={{ textAlign: "right", padding: "2px 0" }}>₹{fmt2(getAmount(item))}</td>
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
        <div>Thank you for your stay!</div>
        <div style={{ marginTop: "5px", fontSize: "9px" }}>Powered by POS System</div>
      </center>
    </div>
  );
};

export default LodgingInvoice;
