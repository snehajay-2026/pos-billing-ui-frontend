import React, { useEffect, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import JsBarcode from "jsbarcode";
import { getStoreSettings } from "../../services/storeSettingsService";
import "../pos/ThermalPrint.css";

const LaundryThermalReceipt = ({ invoice, isDuplicate }) => {
  const barcodeRef = useRef();
  const settings = getStoreSettings();
  const fmt2 = (n) => (Number(n) || 0).toFixed(2);
  // Support both the current `qty` field and the legacy `qtyKg` on older saved invoices.
  const getQty = (item) => Number(item?.qty ?? item?.qtyKg ?? 0);

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
          <strong>LAUNDRY & DRY CLEANING</strong>
          <br />
          {settings.address}
          <br />
          {settings.phone}
        </center>

        <div className="divider"></div>

        {/* INVOICE INFO */}
        <div>
          Order No: {invoice.invoiceNo} <br />
          Date: {invoice.date} <br />
          Payment: {invoice.paymentMode}
        </div>

        {/* TOKEN + ORDER (laundry-specific) */}
        {(invoice.token ||
          invoice.expectedReturn ||
          invoice.orderId ||
          invoice.customer ||
          invoice.customerPhone) && (
          <>
            <div className="divider"></div>
            <div>
              {invoice.token && (
                <div style={{ fontSize: "14px" }}>
                  <strong>Token:</strong>{" "}
                  <span
                    style={{
                      background: "#000",
                      color: "#fff",
                      padding: "1px 6px",
                      borderRadius: 3,
                    }}
                  >
                    {invoice.token}
                  </span>
                </div>
              )}
              {invoice.orderId && <div style={{ fontSize: "11px" }}>Order: {invoice.orderId}</div>}
              {invoice.customer && (
                <div style={{ fontSize: "11px" }}>Customer: {invoice.customer}</div>
              )}
              {invoice.customerPhone && (
                <div style={{ fontSize: "11px" }}>Phone: +91{invoice.customerPhone}</div>
              )}
              {invoice.expectedReturn && (
                <div style={{ fontSize: "11px" }}>Expected Return: {invoice.expectedReturn}</div>
              )}
            </div>
          </>
        )}

        {/* CUSTOMER INFO (settings defaults — kept for backwards compatibility) */}
        {(settings.customerName || settings.customerMobile) &&
          (invoice.customer || invoice.customerPhone) && (
            <div style={{ display: "none" }}>
              {settings.customerName && <div>Customer: {settings.customerName}</div>}
              {settings.customerMobile && <div>Mobile: +91{settings.customerMobile}</div>}
            </div>
          )}

        {(settings.customerName || settings.customerMobile) &&
          !(invoice.customer || invoice.customerPhone) && (
            <div>
              {settings.customerName && <div>Customer: {settings.customerName}</div>}
              {settings.customerMobile && <div>Mobile: +91{settings.customerMobile}</div>}
            </div>
          )}

        {(settings.customerName || settings.customerMobile) &&
          !(invoice.customer || invoice.customerPhone) && <div className="divider"></div>}

        {/* SERVICE TABLE */}
        <table style={{ width: "100%", fontSize: "12px" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Service</th>
              <th style={{ textAlign: "center" }}>Qty</th>
              <th style={{ textAlign: "right" }}>Rate</th>
              <th style={{ textAlign: "right" }}>Total</th>
            </tr>
          </thead>

          <tbody>
            {invoice.items.map((item, i) => (
              <tr key={i}>
                <td style={{ width: "40%", textAlign: "left" }}>
                  {item.name}
                  <div style={{ fontSize: "10px", color: "#555" }}>
                    GST {Number(item.gst || 0).toFixed(0)}% = ₹
                    {fmt2((getQty(item) * item.price * Number(item.gst || 0)) / 100)}
                  </div>
                </td>
                <td style={{ width: "18%", textAlign: "center" }}>{getQty(item).toFixed(0)}</td>
                <td style={{ width: "18%", textAlign: "right" }}>₹{fmt2(item.price)}</td>
                <td style={{ width: "24%", textAlign: "right" }}>
                  ₹{fmt2(getQty(item) * item.price)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="divider"></div>

        {/* SERVICE DETAILS */}
        <div style={{ fontSize: "11px", margin: "8px 0" }}>
          <strong>Service Details:</strong>
          <br />
          • Collection: Same Day
          <br />
          • Processing: 24-48 Hours
          <br />
          • Delivery: As per schedule
          <br />• Quality guaranteed
        </div>

        <div className="divider"></div>

        {/* TOTALS */}
        <table style={{ width: "100%", fontSize: "12px" }}>
          <tbody>
            <tr>
              <td>Subtotal:</td>
              <td style={{ textAlign: "right" }}>₹{fmt2(invoice.subTotal)}</td>
            </tr>
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
              <div style={{ fontSize: "11px", marginTop: "2px" }}>Order QR</div>
            </center>
          )}
        </div>

        {/* DOTTED LINE BELOW QR */}
        <div className="divider" style={{ marginTop: "6px" }}></div>

        {/* LAUNDRY SPECIFIC MESSAGE */}
        <center style={{ marginTop: "4px" }}>
          <strong>We Wash, You Relax! 🧺</strong>
          <br />
          <small style={{ fontSize: "10px" }}>
            Terms: No cash refund. Quality complaints within 24hrs.
          </small>
        </center>
      </div>
    </div>
  );
};

export default LaundryThermalReceipt;
