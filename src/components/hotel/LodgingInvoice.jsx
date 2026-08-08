import React from "react";
import { getStoreSettings } from "../../services/storeSettingsService";
import { QRCodeCanvas } from "qrcode.react";
import {
  FaBed,
  FaUserAlt,
  FaCalendarAlt,
  FaReceipt,
  FaWallet,
  FaHotel,
  FaSnowflake,
  FaCouch,
} from "react-icons/fa";
import "./HotelInvoice.css";

const LodgingInvoice = ({ invoice, isDuplicate }) => {
  const settings = getStoreSettings();

  if (!invoice) return null;

  const fmt2 = (n) => (Number(n) || 0).toFixed(2);

  const items = Array.isArray(invoice.items) ? invoice.items : [];

  // ---- helpers ----
  const getRate = (item) => Number(item?.rate ?? item?.price ?? 0);
  const getQty = (item) => Number(item?.qty ?? item?.quantity ?? 1);
  const getRoomTypeLabel = (item) => {
    const acRaw = String(item?.meta?.roomAc || "")
      .trim()
      .toLowerCase();
    const isAc = acRaw.includes("ac") && !acRaw.includes("non");
    const isNonAc = acRaw.includes("non") || acRaw.includes("without ac");
    const isModern = Boolean(item?.meta?.roomModern);
    if (isAc && isModern) return "AC · Modern";
    if (isNonAc) return "Non-AC";
    if (isAc) return "AC";
    return isModern ? "Modern" : "—";
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

  // ---- totals ----
  const subTotal = Number(
    invoice.subTotal ?? items.reduce((sum, item) => sum + getAmount(item), 0)
  );
  // Compute GST as a list of {percent, amount} so the totals panel can
  // show each slab cleanly when a hotel mixes 12% rooms + 18% F&B.
  const gstBreakdownMap = new Map();
  items.forEach((item) => {
    const pct = Number(item?.gst || 0);
    if (!pct) return;
    const amt = (getAmount(item) * pct) / 100;
    const key = String(pct);
    const prev = gstBreakdownMap.get(key) || { percent: pct, amount: 0 };
    gstBreakdownMap.set(key, { percent: pct, amount: prev.amount + amt });
  });
  const gstBreakdown = Array.from(gstBreakdownMap.values());
  const gstTotal = Number(invoice.gstTotal ?? gstBreakdown.reduce((sum, g) => sum + g.amount, 0));
  const grandTotal = Number(invoice.grandTotal ?? subTotal + gstTotal);

  // ---- stay summary fields ----
  const guestMobile = String(
    invoice?.hotelDetails?.customerMobile ||
      items.find((item) => item?.meta?.customerMobile)?.meta?.customerMobile ||
      invoice?.customerMobile ||
      ""
  ).trim();

  const guestName =
    invoice?.hotelDetails?.guestName?.trim() ||
    invoice?.customerName?.trim() ||
    settings.customerName?.trim() ||
    "Walking Guest";

  const roomNumber =
    items[0]?.meta?.roomName || items[0]?.meta?.roomId || invoice?.hotelDetails?.roomNumber || "—";

  const roomType = items[0] ? getRoomTypeLabel(items[0]) : "—";

  const checkInDate = items[0]?.meta?.checkInDate || invoice?.hotelDetails?.checkInDate || "";
  const checkInTime = items[0]?.meta?.checkInTime || "";
  const checkOutDate = items[0]?.meta?.checkOutDate || invoice?.hotelDetails?.checkOutDate || "";
  const checkOutTime = items[0]?.meta?.checkOutTime || "";

  const totalNights = items.reduce((sum, item) => sum + getNights(item), 0);

  const checkInLabel = [checkInDate, checkInTime].filter(Boolean).join(" · ") || "—";
  const checkOutLabel = [checkOutDate, checkOutTime].filter(Boolean).join(" · ") || "—";

  // Hero initial — falls back to first letter of the hotel name when no
  // logo is set, so the brand block never renders empty.
  const hotelInitial = (settings.name || "H").trim().charAt(0).toUpperCase();

  // Status pill — falls back to pending. `paid` / `cleared` share a label.
  const rawStatus = String(invoice?.status || "pending").toLowerCase();
  const statusKey =
    rawStatus === "paid" || rawStatus === "cleared"
      ? "paid"
      : rawStatus === "cancelled"
        ? "cancelled"
        : "pending";
  const STATUS_LABEL = {
    paid: "Settled",
    pending: "Pending",
    cancelled: "Cancelled",
  };

  // Inline watermark for the hero — uses the logo if present.
  const heroStyle = settings.logo ? { "--hinv-watermark": `url('${settings.logo}')` } : {};

  return (
    <div id="lodging-print-invoice" className="hinv" style={heroStyle}>
      {/* HERO */}
      <header className="hinv-hero">
        <div className="hinv-brand">
          <div className="hinv-brand-logo">
            {settings.logo ? (
              <img src={settings.logo} alt={settings.name || "Hotel logo"} />
            ) : (
              <span className="hinv-brand-logo-fallback">{hotelInitial}</span>
            )}
          </div>
          <div className="hinv-brand-meta">
            <h1 className="hinv-brand-name">{settings.name || "Hotel"}</h1>
            <div className="hinv-brand-sub">Lodging · Room Stay Receipt</div>
            {settings.address ? <div className="hinv-brand-contact">{settings.address}</div> : null}
            {settings.phone ? <div className="hinv-brand-contact">☎ {settings.phone}</div> : null}
          </div>
        </div>
        <div className="hinv-hero-side">
          <span className="hinv-hero-label">Invoice</span>
          <div className="hinv-hero-no">#{invoice.invoiceNo || "—"}</div>
          <div className="hinv-hero-date">
            {invoice.date ? new Date(invoice.date).toLocaleString() : ""}
          </div>
          <div className={`hinv-hero-status is-${statusKey}`}>
            {STATUS_LABEL[statusKey]}
            {isDuplicate ? " · Duplicate" : ""}
          </div>
        </div>
      </header>

      {/* BODY */}
      <div className="hinv-body">
        {/* Stay summary */}
        <h2 className="hinv-section-title">Stay Summary</h2>
        <div className="hinv-summary">
          <div className="hinv-summary-cell">
            <div className="hinv-summary-icon">
              <FaUserAlt />
            </div>
            <div className="hinv-summary-meta">
              <span className="hinv-summary-label">Guest</span>
              <span className="hinv-summary-value">{guestName}</span>
              {guestMobile ? <span className="hinv-summary-sub">📞 {guestMobile}</span> : null}
              {invoice?.hotelDetails?.idProof?.number ? (
                <span className="hinv-summary-sub">
                  ID · {invoice.hotelDetails.idProof.type || "Proof"} ·{" "}
                  {invoice.hotelDetails.idProof.number}
                </span>
              ) : null}
            </div>
          </div>

          <div className="hinv-summary-cell">
            <div className="hinv-summary-icon">
              <FaBed />
            </div>
            <div className="hinv-summary-meta">
              <span className="hinv-summary-label">Room</span>
              <span className="hinv-summary-value">{roomNumber}</span>
              <span className="hinv-summary-sub">{roomType}</span>
            </div>
          </div>

          <div className="hinv-summary-cell">
            <div className="hinv-summary-icon">
              <FaCalendarAlt />
            </div>
            <div className="hinv-summary-meta">
              <span className="hinv-summary-label">Stay</span>
              <span className="hinv-summary-value">
                {totalNights > 0 ? `${totalNights} night${totalNights > 1 ? "s" : ""}` : "—"}
              </span>
              <span className="hinv-summary-sub">In · {checkInLabel}</span>
              <span className="hinv-summary-sub">Out · {checkOutLabel}</span>
            </div>
          </div>
        </div>

        {/* Charges */}
        <h2 className="hinv-section-title">Charges</h2>
        <div className="hinv-charges">
          {items.length === 0 ? (
            <div className="hinv-empty">No line items on this invoice.</div>
          ) : (
            <table className="hinv-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Room</th>
                  <th>Type</th>
                  <th style={{ textAlign: "center" }}>Nights</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const gstPercent = Number(item?.gst || 0);
                  const gstAmt = (getAmount(item) * gstPercent) / 100;
                  const iconForType = getRoomTypeLabel(item).includes("AC") ? FaSnowflake : FaCouch;
                  const TypeIcon = iconForType;
                  return (
                    <tr key={index}>
                      <td>
                        <span className="hinv-td-name">{item.name || "—"}</span>
                        {gstPercent > 0 && gstAmt > 0 ? (
                          <span className="hinv-td-sub">
                            GST {gstPercent.toFixed(0)}% · ₹{fmt2(gstAmt)}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {item?.meta?.roomName ||
                          item?.meta?.roomId ||
                          invoice?.hotelDetails?.roomNumber ||
                          "—"}
                      </td>
                      <td>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            color: "var(--hinv-ink-soft)",
                            fontWeight: 500,
                          }}
                        >
                          <TypeIcon size={11} />
                          {getRoomTypeLabel(item)}
                        </span>
                      </td>
                      <td className="hinv-td-num">{getNights(item)}</td>
                      <td>₹{fmt2(getAmount(item))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Totals */}
        <div className="hinv-totals-wrap">
          <div className="hinv-pay-pill">
            <FaWallet />
            Payment via <span className="hinv-pay-mode">{invoice.paymentMode || "—"}</span>
          </div>
          <div className="hinv-totals">
            <div className="hinv-totals-row">
              <span>Subtotal</span>
              <span className="hinv-totals-value">₹{fmt2(subTotal)}</span>
            </div>
            {gstBreakdown.length === 0 ? (
              <div className="hinv-totals-row">
                <span>GST</span>
                <span className="hinv-totals-value">₹{fmt2(0)}</span>
              </div>
            ) : (
              gstBreakdown.map((g) => (
                <div className="hinv-totals-row" key={g.percent}>
                  <span>GST @ {g.percent}%</span>
                  <span className="hinv-totals-value">₹{fmt2(g.amount)}</span>
                </div>
              ))
            )}
            <div className="hinv-totals-divider" />
            <div className="hinv-totals-grand">
              <span className="hinv-totals-grand-label">Grand Total</span>
              <span className="hinv-totals-grand-value">
                <span className="hinv-currency">₹</span>
                {fmt2(grandTotal)}
              </span>
            </div>
          </div>
        </div>

        {/* QR codes — settings.qrType drives which renders */}
        {(invoice.paymentMode === "UPI" &&
          (settings.qrType === "UPI" || settings.qrType === "BOTH")) ||
        settings.qrType === "INVOICE" ||
        settings.qrType === "BOTH" ? (
          <div className="hinv-qr-row">
            {invoice.paymentMode === "UPI" &&
              (settings.qrType === "UPI" || settings.qrType === "BOTH") && (
                <div className="hinv-qr-tile">
                  <QRCodeCanvas
                    value={`upi://pay?pa=${settings.upiId}&pn=${settings.name}&am=${fmt2(
                      grandTotal
                    )}`}
                    size={92}
                  />
                  <div className="hinv-qr-tile-label">Scan · UPI Pay</div>
                </div>
              )}
            {(settings.qrType === "INVOICE" || settings.qrType === "BOTH") && (
              <div className="hinv-qr-tile">
                <QRCodeCanvas
                  value={JSON.stringify({
                    invoiceNo: invoice.invoiceNo,
                    amount: fmt2(grandTotal),
                  })}
                  size={92}
                />
                <div className="hinv-qr-tile-label">View · Invoice QR</div>
              </div>
            )}
          </div>
        ) : null}
      </div>

      {/* FOOTER */}
      <footer className="hinv-footer">
        <div>
          <div className="hinv-footer-thanks">
            <FaHotel style={{ marginRight: 6, color: "var(--hinv-gold)" }} />
            Thank you for your stay!
          </div>
          <small className="hinv-footer-thanks-sub">We hope to see you again. Safe travels.</small>
        </div>
        <div className="hinv-footer-brand">
          Billed by · {invoice.billedBy || "Front Desk"}
          <small>Powered by POS System</small>
        </div>
      </footer>
    </div>
  );
};

export default LodgingInvoice;
