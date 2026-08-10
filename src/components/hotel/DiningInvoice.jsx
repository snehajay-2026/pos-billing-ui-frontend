import React from "react";
import { getStoreSettings } from "../../services/storeSettingsService";
import { QRCodeCanvas } from "qrcode.react";
import {
  FaUserAlt,
  FaChair,
  FaUsers,
  FaClock,
  FaReceipt,
  FaWallet,
  FaHotel,
  FaUtensils,
} from "react-icons/fa";
import "./HotelInvoice.css";

const DiningInvoice = ({ invoice, isDuplicate }) => {
  const settings = getStoreSettings();

  if (!invoice) return null;

  const fmt2 = (n) => (Number(n) || 0).toFixed(2);
  const items = Array.isArray(invoice.items) ? invoice.items : [];

  // ---- helpers ----
  const getQty = (item) => Number(item?.qty ?? item?.quantity ?? 1);
  const getRate = (item) => Number(item?.rate ?? item?.price ?? 0);
  const getAmount = (item) => {
    const explicit = Number(item?.total);
    if (!Number.isNaN(explicit) && explicit > 0) return explicit;
    return getQty(item) * getRate(item);
  };

  // ---- totals ----
  const subTotal = Number(
    invoice.subTotal ?? items.reduce((sum, item) => sum + getAmount(item), 0)
  );
  // GST is broken out by slab so mixed-menu invoices (5% packaged + 18%
  // alcoholic) still display each rate cleanly instead of a single blob.
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

  // ---- visit summary fields ----
  // Guest name resolution. `hotelDetails.guestName` / `customerName` are set
  // on the live preview, but the server only persists the JSON `items`
  // column — so a re-printed invoice loses those fields and must fall back
  // to the guest name captured on each line item's `meta.guest` (set at
  // booking time via the table booking flow / persistDiningBill).
  const guestName =
    invoice?.hotelDetails?.guestName?.trim() ||
    invoice?.customerName?.trim() ||
    items.find((item) => item?.meta?.guest)?.meta?.guest?.trim() ||
    settings.customerName?.trim() ||
    "Walking Guest";

  // Same persistence story as the name: `hotelDetails.customerMobile` /
  // `customerMobile` are set on the live preview but the server only keeps
  // the JSON `items` column, so re-prints fall back to the mobile captured
  // on each line item's `meta.customerMobile` (set at booking time via the
  // table booking flow / persistDiningBill).
  const guestMobile = String(
    invoice?.hotelDetails?.customerMobile?.trim() ||
      invoice?.customerMobile?.trim() ||
      items.find((item) => item?.meta?.customerMobile)?.meta?.customerMobile?.trim() ||
      ""
  );

  const tableName = invoice?.hotelDetails?.tableName || "—";
  const partySize = Number(invoice?.hotelDetails?.partySize) || 0;
  const seatedAt = invoice?.hotelDetails?.checkInTime || invoice?.hotelDetails?.seatedAt || "";
  const clearedAt = invoice?.hotelDetails?.checkOutTime || "";

  const hotelInitial = (settings.name || "H").trim().charAt(0).toUpperCase();

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
    <div id="dining-print-invoice" className="hinv" style={heroStyle}>
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
            <div className="hinv-brand-sub">Dining · Restaurant Receipt</div>
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
        {/* Visit summary */}
        <h2 className="hinv-section-title">Visit Summary</h2>
        <div className="hinv-summary">
          <div className="hinv-summary-cell">
            <div className="hinv-summary-icon">
              <FaUserAlt />
            </div>
            <div className="hinv-summary-meta">
              <span className="hinv-summary-label">Guest</span>
              <span className="hinv-summary-value">{guestName}</span>
              {guestMobile ? <span className="hinv-summary-sub">📞 {guestMobile}</span> : null}
            </div>
          </div>

          <div className="hinv-summary-cell">
            <div className="hinv-summary-icon">
              <FaChair />
            </div>
            <div className="hinv-summary-meta">
              <span className="hinv-summary-label">Table</span>
              <span className="hinv-summary-value">{tableName}</span>
              <span className="hinv-summary-sub">
                <FaUsers style={{ marginRight: 4 }} />
                {partySize > 0 ? `${partySize} guest${partySize > 1 ? "s" : ""}` : "Walk-in"}
              </span>
            </div>
          </div>

          <div className="hinv-summary-cell">
            <div className="hinv-summary-icon">
              <FaClock />
            </div>
            <div className="hinv-summary-meta">
              <span className="hinv-summary-label">Timing</span>
              <span className="hinv-summary-value">{seatedAt || clearedAt ? "Recorded" : "—"}</span>
              <span className="hinv-summary-sub">In · {seatedAt || "—"}</span>
              <span className="hinv-summary-sub">Out · {clearedAt || "—"}</span>
            </div>
          </div>
        </div>

        {/* Charges */}
        <h2 className="hinv-section-title">Order</h2>
        <div className="hinv-charges">
          {items.length === 0 ? (
            <div className="hinv-empty">No items ordered.</div>
          ) : (
            <table className="hinv-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th style={{ textAlign: "center" }}>Qty</th>
                  <th style={{ textAlign: "right" }}>Rate</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const qty = getQty(item);
                  const rate = getRate(item);
                  const total = getAmount(item);
                  const gstPercent = Number(item?.gst || 0);
                  const gstAmt = (total * gstPercent) / 100;
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
                      <td className="hinv-td-num">{qty.toFixed(0)}</td>
                      <td style={{ textAlign: "right" }}>₹{fmt2(rate)}</td>
                      <td>₹{fmt2(total)}</td>
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

        {/* QR codes */}
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
            <FaUtensils style={{ marginRight: 6, color: "var(--hinv-gold)" }} />
            Thank you for dining with us!
          </div>
          <small className="hinv-footer-thanks-sub">
            Your patronage means the world. See you next visit.
          </small>
        </div>
        <div className="hinv-footer-brand">
          Served by · {invoice.billedBy || "Service Team"}
          <small>Powered by POS System</small>
        </div>
      </footer>
    </div>
  );
};

export default DiningInvoice;
