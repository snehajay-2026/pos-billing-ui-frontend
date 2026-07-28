import React, { useEffect, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import JsBarcode from "jsbarcode";
import { getStoreSettings } from "../../services/storeSettingsService";
import "./ThermalPrint.css";

const ThermalReceipt = ({ invoice, isDuplicate }) => {
  const barcodeRef = useRef();
  const settings = getStoreSettings();
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

  useEffect(() => {
    if (invoice && barcodeRef.current) {
      JsBarcode(barcodeRef.current, invoice.invoiceNo, {
        displayValue: false,
        lineColor: "#000",
        width: 2,
        height: 40,
      });
    }
  }, [invoice]);

  if (!invoice) return null;

  if (!invoice) return null;

  return (
    <div id="thermal-receipt-print">
      <div
        className={`thermal-${settings.theme}`}
        style={{
          width: "80mm",
          padding: "8px",
          fontFamily: "monospace",
          fontSize: "12px",
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

        <div className="divider"></div>

        {/* INVOICE INFO */}
        <div>
          Invoice: {invoice.invoiceNo} <br />
          Date: {invoice.date} <br />
          {settings.businessType === "laundry" ? "Service: " : "Payment: "}
          {invoice.paymentMode}
        </div>

        <div className="divider"></div>

        {/* CUSTOMER / GUEST INFO — always shown; falls back to "Walking Customer" */}
        <div>
          {invoice?.hotelDetails?.guestName ? (
            <div>Guest: {invoice.hotelDetails.guestName}</div>
          ) : invoice?.customerName && String(invoice.customerName).trim() ? (
            <div>Customer: {invoice.customerName}</div>
          ) : (
            <div>Customer: Walking Customer</div>
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

        <div className="divider"></div>

        {/* ITEM TABLE */}
        <table style={{ width: "100%", fontSize: "12px" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>
                {settings.businessType === "laundry" ? "Service" : "Item"}
              </th>
              <th style={{ textAlign: "center" }}>Qty</th>
              <th style={{ textAlign: "right" }}>Rate</th>
              <th style={{ textAlign: "right" }}>Total</th>
            </tr>
          </thead>

          <tbody>
            {invoice.items.map((item, i) => (
              <tr key={i}>
                <td style={{ width: "40%", textAlign: "left" }}>{item.name}</td>
                <td style={{ width: "18%", textAlign: "center" }}>
                  {(() => {
                    const unit = getUnitForItem(item);
                    const qty = getQtyForItem(item);
                    return unit === "kg" ? qty.toFixed(3) : qty.toFixed(0);
                  })()}
                </td>
                <td style={{ width: "18%", textAlign: "right" }}>
                  {(() => {
                    const unit = getUnitForItem(item);
                    return `₹${fmt2(item.price)}/${unit}`;
                  })()}
                </td>
                <td style={{ width: "24%", textAlign: "right" }}>
                  ₹{fmt2(getQtyForItem(item) * (Number(item.price) || 0))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="divider"></div>

        {/* TOTALS */}
        <table style={{ width: "100%", fontSize: "12px" }}>
          <tbody>
            <tr>
              <td>Subtotal:</td>
              <td style={{ textAlign: "right" }}>₹{fmt2(invoice.subTotal)}</td>
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
                    <td style={{ textAlign: "right", fontSize: "11px", color: "#1f8a3b" }}>
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
                    <td style={{ textAlign: "right", fontSize: "11px", color: "#1f8a3b" }}>
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
                  <td style={{ textAlign: "right", fontSize: "11px", color: "#1f8a3b" }}>
                    ₹{fmt2(invoice.discountBreakdown.totalSavings)}
                  </td>
                </tr>
              </>
            )}
            <tr>
              <td>GST:</td>
              <td style={{ textAlign: "right" }}>₹{fmt2(invoice.gstTotal)}</td>
            </tr>
            <tr>
              <td>
                <strong>Grand Total:</strong>
              </td>
              <td style={{ textAlign: "right" }}>
                <strong>₹{fmt2(invoice.grandTotal)}</strong>
              </td>
            </tr>
          </tbody>
        </table>

        {/* SPLIT-PAYMENT BREAKDOWN — only when the bill was tendered across
            multiple modes. Single-mode receipts stay clean. */}
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

        {/* DOTTED LINE BELOW GRAND TOTAL */}
        <div className="divider" style={{ marginTop: "4px", marginBottom: "14px" }}></div>

        {/* QR CODE BLOCK */}
        <div style={{ marginTop: "14px", padding: 0 }}>
          {invoice.paymentMode === "UPI" &&
            (settings.qrType === "UPI" || settings.qrType === "BOTH") && (
              <center style={{ margin: "0", padding: "0" }}>
                <QRCodeCanvas
                  value={`upi://pay?pa=${settings.upiId}&pn=${settings.name}&am=${fmt2(
                    invoice.grandTotal
                  )}`}
                  size={120}
                />
                <div style={{ fontSize: "11px", marginTop: "2px" }}>UPI Payment</div>
              </center>
            )}

          {(settings.qrType === "INVOICE" || settings.qrType === "BOTH") && (
            <center style={{ margin: 0, padding: 0 }}>
              <QRCodeCanvas
                value={JSON.stringify({
                  invoiceNo: invoice.invoiceNo,
                  amount: fmt2(invoice.grandTotal),
                })}
                size={120}
              />
              <div style={{ fontSize: "11px", marginTop: "2px" }}>Invoice QR</div>
            </center>
          )}
        </div>

        {/* DOTTED LINE BELOW QR (KEEPING) */}
        <div className="divider" style={{ marginTop: "6px" }}></div>

        {/* ⭐ THANK YOU MOVED IMMEDIATELY BELOW THIS DOTTED LINE */}
        <center style={{ marginTop: "4px" }}>
          {settings.businessType === "laundry"
            ? "We Wash, You Relax! 🧺"
            : settings.businessType === "service"
              ? "Thank You for Your Business! 🙏"
              : "Thank You 🙏"}
        </center>
      </div>
    </div>
  );
};

window.ThermalReceipt = ThermalReceipt;
export default ThermalReceipt;
