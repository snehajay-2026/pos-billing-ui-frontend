import React from "react";
import { getStoreSettings } from "../../services/storeSettingsService";
import { QRCodeCanvas } from "qrcode.react";
import { FaReceipt, FaUser, FaCalendarAlt, FaCreditCard, FaCheckCircle } from "react-icons/fa";
import "./RetailPrintInvoice.css";

// Pure helper that decides what the printed retail invoice shows for the
// customer name + mobile. Centralised so the rules can be unit-tested:
//
//   name:   hotelDetails.guestName  (trimmed)
//         -> customerName            (trimmed, falls back to "Walking Customer")
//         -> customer                (legacy string field)
//   mobile: hotelDetails.customerMobile
//         -> customerPhone
//         -> customerMobile          (legacy)
//
// The mobile is ALWAYS a non-empty string OR an empty string — never
// undefined / whitespace — so the renderer can compare against "" to
// decide whether to draw the "Mobile: …" line at all. Whitespace in the
// name is treated as "no name" so a stray space doesn't render as
// "Customer: ".
export const resolveRetailCustomer = (invoice) => {
  const safe = invoice && typeof invoice === "object" ? invoice : {};
  const hd = safe.hotelDetails && typeof safe.hotelDetails === "object" ? safe.hotelDetails : {};
  const trimmed = (v) => (typeof v === "string" ? v.trim() : "");
  const nameCandidate =
    trimmed(hd.guestName) || trimmed(safe.customerName) || trimmed(safe.customer) || "";
  const mobileCandidate =
    trimmed(hd.customerMobile) || trimmed(safe.customerPhone) || trimmed(safe.customerMobile) || "";
  return {
    name: nameCandidate || "Walking Customer",
    mobile: mobileCandidate,
  };
};

const RetailPrintInvoice = ({ invoice, isDuplicate }) => {
  const settings = getStoreSettings();

  if (!invoice) return null;

  // Single source of truth for the customer info shown on the printed
  // retail invoice. The resolver applies the documented fallback chain
  // (hotelDetails.guestName -> customerName -> customer -> "Walking
  // Customer") and never returns an undefined / whitespace-only mobile,
  // so the JSX below can safely gate the "Mobile: …" line on
  // `customer.mobile` being a non-empty string.
  const customer = resolveRetailCustomer(invoice);

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

  // Calculate totals — all read straight off the persisted invoice. No value
  // is recomputed from the line items here; the POS already resolved them at
  // checkout and the server re-validates them.
  const subTotal = invoice.subTotal || 0;
  const gstTotal = invoice.gstTotal || 0;
  const grandTotal = invoice.grandTotal || 0;
  const totalItems = (invoice.items || []).length;
  const totalQty = (invoice.items || []).reduce((sum, it) => sum + getQtyForItem(it), 0);

  // `subTotal` is already net of both line and bill discounts, so it is the
  // TAXABLE subtotal (GST is charged on it, never on the gross). The discount
  // rows above it are explanatory context, not deductions to apply again.
  const bd = invoice.discountBreakdown || null;
  const totalSavings = Number(bd?.totalSavings || 0);
  const lineDiscountAmount = (bd?.line || []).reduce((s, l) => s + Number(l.saved || 0), 0);
  // Bill discount: prefer the amount captured at checkout. Older rows may
  // carry a `discount` but no breakdown, in which case it is re-derived from
  // the percentage exactly as the existing discount row below already does.
  const billDiscountAmount = (() => {
    if (lineDiscountAmount > 0 || totalSavings > 0) {
      return Math.max(0, +(totalSavings - lineDiscountAmount).toFixed(2));
    }
    const info = invoice.discount;
    if (!info || typeof info.value !== "number" || info.value <= 0) return 0;
    const base = Number(invoice.subTotal || 0);
    if (!base) return 0;
    return info.type === "percent"
      ? +Math.min(base, (base * info.value) / 100).toFixed(2)
      : +Math.min(base, info.value).toFixed(2);
  })();
  const hasDiscount = lineDiscountAmount > 0 || billDiscountAmount > 0;
  // Gross is the identity `subTotal + totalSavings`, which holds because the
  // POS computed subTotal as (gross − lineDiscount − billDiscount). Only
  // shown when a discount actually exists, so a no-discount bill keeps its
  // original compact layout and gains no receipt height.
  const grossAmount = hasDiscount ? +(subTotal + totalSavings).toFixed(2) : null;

  return (
    <div id="retail-print-invoice" className="rpi-root">
      {/* COPY TYPE */}
      <div className={`rpi-copy ${isDuplicate ? "is-duplicate" : "is-original"}`}>
        {isDuplicate ? "DUPLICATE COPY" : "ORIGINAL COPY"}
      </div>

      {/* HEADER */}
      <div className="rpi-header">
        {settings.logo ? (
          <img src={settings.logo} alt="Store Logo" className="rpi-logo" />
        ) : (
          <div className="rpi-logo-fallback">
            <FaReceipt />
          </div>
        )}
        <h2 className="rpi-store-name">{settings.name}</h2>
        {settings.address && <p className="rpi-store-line">{settings.address}</p>}
        {settings.phone && <p className="rpi-store-line">{settings.phone}</p>}
      </div>

      {/* INVOICE META */}
      <div className="rpi-meta">
        <div className="rpi-meta-row">
          <span className="rpi-meta-key">
            <FaReceipt className="rpi-meta-ico" /> Invoice
          </span>
          <strong className="rpi-meta-val">{invoice.invoiceNo}</strong>
        </div>
        <div className="rpi-meta-row">
          <span className="rpi-meta-key">
            <FaCalendarAlt className="rpi-meta-ico" /> Date
          </span>
          <span className="rpi-meta-val">{invoice.date}</span>
        </div>
        <div className="rpi-meta-row">
          <span className="rpi-meta-key">
            <FaCreditCard className="rpi-meta-ico" /> Payment
          </span>
          <span className="rpi-meta-val">{invoice.paymentMode}</span>
        </div>
        <div className="rpi-meta-row">
          <span className="rpi-meta-key">
            <FaUser className="rpi-meta-ico" /> Billed By
          </span>
          <span className="rpi-meta-val">{invoice.billedBy || "Unknown"}</span>
        </div>
      </div>

      {/* CUSTOMER */}
      <div className="rpi-customer">
        <div className="rpi-customer-label">Customer</div>
        <div className="rpi-customer-name">{customer.name}</div>
        {invoice?.hotelDetails?.roomNumber && (
          <div className="rpi-customer-sub">Room: {invoice.hotelDetails.roomNumber}</div>
        )}
        {invoice?.hotelDetails?.idProof &&
          (invoice.hotelDetails.idProof.type || invoice.hotelDetails.idProof.number) && (
            <div className="rpi-customer-sub">
              ID: {invoice.hotelDetails.idProof.type || ""}
              {invoice.hotelDetails.idProof.type && invoice.hotelDetails.idProof.number
                ? " - "
                : ""}
              {invoice.hotelDetails.idProof.number || ""}
            </div>
          )}
        {customer.mobile && <div className="rpi-customer-sub">Mobile: {customer.mobile}</div>}
      </div>

      {/* ITEMS TABLE — column widths tuned for the 80mm print + mobile */}
      <div className="rpi-items-wrap">
        <div className="rpi-items-head">
          <span className="rpi-item-name">Item</span>
          <span className="rpi-item-qty">Qty</span>
          <span className="rpi-item-rate">Rate</span>
          <span className="rpi-item-total">Total</span>
        </div>
        {(invoice.items || []).map((item, index) => {
          const unit = getUnitForItem(item);
          const qty = getQtyForItem(item);
          const gstPercent = Number(item.gst || 0);
          const lineTotal = qty * (Number(item.price) || 0);
          const gstAmt = (lineTotal * gstPercent) / 100;
          return (
            <div key={index} className="rpi-item-row">
              <span className="rpi-item-name">
                {item.name}
                {gstPercent > 0 && gstAmt > 0 && (
                  <span className="rpi-item-meta">
                    GST {gstPercent.toFixed(0)}% · ₹{gstAmt.toFixed(2)}
                  </span>
                )}
              </span>
              <span className="rpi-item-qty">
                {unit === "kg" ? qty.toFixed(3) : qty.toFixed(0)}
              </span>
              <span className="rpi-item-rate">₹{fmt2(item.price)}</span>
              <span className="rpi-item-total">₹{fmt2(lineTotal)}</span>
            </div>
          );
        })}

        <div className="rpi-items-foot">
          <span>
            {totalItems} item{totalItems === 1 ? "" : "s"}
            {totalQty > 0 ? ` · ${totalQty.toFixed(0)} unit${totalQty === 1 ? "" : "s"}` : ""}
          </span>
        </div>
      </div>

      {/* DARK DIVIDER before totals */}
      <div className="rpi-divider" />

      {/* TOTALS
          Order is: Gross → discounts → Taxable Subtotal → GST → Grand Total.
          `subTotal` is the post-discount, GST-bearing amount, so it is
          labelled "Taxable Subtotal". The discount rows ABOVE it are context
          for how that figure was reached — the amount is never subtracted
          from the subtotal a second time.

          When no discount exists the gross / discount rows are omitted
          entirely, so an undiscounted receipt keeps its original height. */}
      <div className="rpi-totals">
        {grossAmount != null && (
          <div className="rpi-total-row">
            <span>Gross Amount</span>
            <strong>₹{fmt2(grossAmount)}</strong>
          </div>
        )}

        {lineDiscountAmount > 0 && (
          <div className="rpi-total-row rpi-total-row-saved">
            <span>Line Discount</span>
            <span>−₹{fmt2(lineDiscountAmount)}</span>
          </div>
        )}

        {billDiscountAmount > 0 && (
          <div className="rpi-total-row rpi-total-row-saved">
            <span>
              Bill Discount
              {invoice.discountBreakdown?.bill?.type === "percent"
                ? ` (${invoice.discountBreakdown.bill.value}%)`
                : ""}
            </span>
            <span>−₹{fmt2(billDiscountAmount)}</span>
          </div>
        )}

        <div className="rpi-total-row rpi-total-row-taxable">
          <span>Taxable Subtotal</span>
          <strong>₹{fmt2(subTotal)}</strong>
        </div>

        <div className="rpi-total-row">
          <span>GST</span>
          <strong>₹{fmt2(gstTotal)}</strong>
        </div>

        <div className="rpi-total-row rpi-total-row-grand">
          <span>Grand Total</span>
          <strong>₹{fmt2(grandTotal)}</strong>
        </div>

        {/* Secondary, and placed BELOW the Grand Total so it can never be
            read as part of the amount payable. Existing stored value. */}
        {totalSavings > 0 && (
          <div className="rpi-total-row rpi-total-row-saved">
            <span>You Saved</span>
            <span>₹{fmt2(totalSavings)}</span>
          </div>
        )}
      </div>

      {/* SPLIT-PAYMENT BREAKDOWN */}
      {invoice.paymentMode === "Split" &&
        Array.isArray(invoice.payments) &&
        invoice.payments.length > 0 && (
          <div className="rpi-split">
            <div className="rpi-split-head">Paid via</div>
            {invoice.payments.map((p, i) => (
              <div key={i} className="rpi-split-row">
                <span>{p.mode}</span>
                <span>₹{fmt2(p.amount)}</span>
              </div>
            ))}
            <div className="rpi-split-row rpi-split-row-strong">
              <span>Tendered</span>
              <span>₹{fmt2(invoice.tendered || 0)}</span>
            </div>
            {Number(invoice.changeDue || 0) > 0 && (
              <div className="rpi-split-row rpi-split-row-saved">
                <span>Change Due</span>
                <span>₹{fmt2(invoice.changeDue)}</span>
              </div>
            )}
          </div>
        )}

      {/* QR CODE BLOCK */}
      <div className="rpi-qr">
        {invoice.paymentMode === "UPI" &&
          (settings.qrType === "UPI" || settings.qrType === "BOTH") && (
            <div className="rpi-qr-block">
              <QRCodeCanvas
                value={`upi://pay?pa=${settings.upiId}&pn=${settings.name}&am=${fmt2(grandTotal)}`}
                size={92}
              />
              <div className="rpi-qr-label">UPI Payment</div>
            </div>
          )}
        {(settings.qrType === "INVOICE" || settings.qrType === "BOTH") && (
          <div className="rpi-qr-block">
            <QRCodeCanvas
              value={JSON.stringify({ invoiceNo: invoice.invoiceNo, amount: fmt2(grandTotal) })}
              size={92}
            />
            <div className="rpi-qr-label">Order QR</div>
          </div>
        )}
      </div>

      {/* FOOTER */}
      <div className="rpi-foot">
        <div className="rpi-foot-thanks">
          <FaCheckCircle /> Thank you for your business!
        </div>
        <div className="rpi-foot-meta">Powered by POS Suite</div>
        {/* Build fingerprint — short commit hash of the deployed frontend
            bundle. Visible on every printed receipt so we can confirm at a
            glance that the live build matches the expected commit. If the
            fingerprint on the printed receipt does NOT match the latest
            commit on GitHub, the deployed bundle is stale and the customer
            info fix from commits 026a64a / 7718b2d is not live. */}
        <div className="rpi-foot-build" title="Deployed frontend commit">
          build: {process.env.REACT_APP_GIT_SHA || "dev"}
        </div>
      </div>
    </div>
  );
};

export default RetailPrintInvoice;
