import React, { useEffect, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import JsBarcode from "jsbarcode";
import { getStoreSettings } from "../../services/storeSettingsService";
import "./HotelThermalReceipt.css";
import { isHotelDiningInvoice } from "../../utils/invoiceType";

// 80 mm thermal hotel receipt — narrow pillar layout that mirrors the
// existing thermal-print design language (LaundryThermalReceipt /
// ThermalReceipt). It uses the SAME guest-name resolution as
// LodgingInvoice / DiningInvoice (booking card → hotelDetails.guestName
// → meta.guest → Walking Guest fallback) so it stays in sync with the
// A4 layout and re-prints alike.
const HotelThermalReceipt = ({ invoice, isDuplicate }) => {
  const settings = getStoreSettings();
  const barcodeRef = useRef();

  // Hooks must be called in the same order every render — keep this
  // BEFORE any early return so the conditional render path below still
  // satisfies Rules of Hooks.
  useEffect(() => {
    if (invoice?.invoiceNo && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, invoice.invoiceNo, {
          displayValue: false,
          lineColor: "#000",
          width: 1.6,
          height: 36,
          margin: 0,
        });
      } catch (e) {
        // barcodes can fail on weird characters — receipt still works without one
      }
    }
  }, [invoice]);

  if (!invoice) return null;

  const fmt2 = (n) => (Number(n) || 0).toFixed(2);

  // ---- time formatting (12-hour AM/PM) ----
  // Mirrors the formatter in DiningInvoice.jsx so the cashier's preview
  // and the thermal receipt show the same time format. ISO date strings
  // go through `new Date()`; HH:mm strings (from <input type="time">)
  // are reformatted directly. `toLocaleString()` defaults to 24h, so
  // explicit options are required for 12-hour AM/PM output.
  const fmtTime12 = (value) => {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    });
  };
  // The cashier-side `generateAndPreview()` now stamps the live
  // moment into `invoice.invoiceDateTime`. We prefer it and fall
  // back to `createdAt` (server NOW(3) UTC) and finally `invoice.date`
  // (MySQL DATE — date-only string) for legacy / pre-fix rows. Both
  // date and time labels are formatted with `timeZone: Asia/Kolkata`
  // so a viewer in any other timezone sees the same IST-shifted time
  // as the cashier did.
  const generatedAtRaw = invoice?.invoiceDateTime || invoice?.createdAt || invoice?.date || "";
  const generatedAtDate = generatedAtRaw ? new Date(generatedAtRaw) : null;
  const isValidGen = generatedAtDate && !Number.isNaN(generatedAtDate.getTime());
  const thermalDateLabel = isValidGen
    ? generatedAtDate.toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Asia/Kolkata",
      })
    : "";
  const thermalTimeLabel = isValidGen
    ? generatedAtDate.toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
      })
    : "";
  const fmtClock12 = (value) => {
    if (!value) return "";
    const s = String(value).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
    if (!m) return s;
    let h = Number(m[1]);
    const min = m[2];
    const explicit = m[3] ? m[3].toUpperCase() : null;
    if (!explicit) {
      const period = h >= 12 ? "PM" : "AM";
      h = h % 12 || 12;
      return `${String(h).padStart(2, "0")}:${min} ${period}`;
    }
    return `${String(h).padStart(2, "0")}:${min} ${explicit}`;
  };

  // ---- shared helpers ----
  const items = Array.isArray(invoice.items) ? invoice.items : [];

  const resolveGuest = () => {
    const fromMeta = items.find((item) => item?.meta?.guest)?.meta?.guest;
    const trimmedMeta = typeof fromMeta === "string" ? fromMeta.trim() : "";
    return (
      invoice?.hotelDetails?.guestName?.trim() ||
      invoice?.customerName?.trim() ||
      trimmedMeta ||
      settings.customerName?.trim() ||
      "Walking Guest"
    );
  };

  const resolveMobile = () => {
    const fromMeta = items.find((item) => item?.meta?.customerMobile)?.meta?.customerMobile;
    return String(
      invoice?.hotelDetails?.customerMobile?.trim() ||
        invoice?.customerMobile?.trim() ||
        (typeof fromMeta === "string" ? fromMeta.trim() : "") ||
        ""
    );
  };

  const getRate = (item) => Number(item?.rate ?? item?.price ?? 0);
  const getQty = (item) => Number(item?.qty ?? item?.quantity ?? 1);
  const getAmount = (item) => {
    const explicit = Number(item?.total);
    if (!Number.isNaN(explicit) && explicit > 0) return explicit;
    return getQty(item) * getRate(item);
  };

  const subTotal = Number(
    invoice.subTotal ?? items.reduce((sum, item) => sum + getAmount(item), 0)
  );

  const gstBreakdownMap = new Map();
  items.forEach((item) => {
    const pct = Number(item?.gst || 0);
    if (!pct) return;
    const amt = (getAmount(item) * pct) / 100;
    const prev = gstBreakdownMap.get(String(pct)) || { percent: pct, amount: 0 };
    gstBreakdownMap.set(String(pct), { percent: pct, amount: prev.amount + amt });
  });
  const gstBreakdown = Array.from(gstBreakdownMap.values());
  const gstTotal = Number(invoice.gstTotal ?? gstBreakdown.reduce((sum, g) => sum + g.amount, 0));
  const grandTotal = Number(invoice.grandTotal ?? subTotal + gstTotal);

  const guestName = resolveGuest();
  const guestMobile = resolveMobile();
  const isDining = isHotelDiningInvoice(invoice);
  const hotelInitial = (settings.name || "H").trim().charAt(0).toUpperCase();

  // ---- header copy varies by branch ----
  const branchLabel = isDining ? "Dining · Restaurant" : "Lodging · Room Stay";
  const branchShort = isDining ? "DINING" : "LODGING";

  return (
    <div id="hotel-thermal-receipt-print">
      <div className="htr-doc">
        <div className={`htr-copy ${isDuplicate ? "is-duplicate" : "is-original"}`}>
          {isDuplicate ? "DUPLICATE COPY" : "ORIGINAL COPY"}
        </div>

        <div className="htr-brand">
          {settings.logo ? (
            <img src={settings.logo} alt={settings.name || "Hotel"} className="htr-logo" />
          ) : (
            <div className="htr-logo-fallback">{hotelInitial}</div>
          )}
          <div className="htr-name">{settings.name || "Hotel"}</div>
          <div className="htr-branch">{branchLabel} · Thermal Receipt</div>
          {settings.address ? <div className="htr-contact">{settings.address}</div> : null}
          {settings.phone ? <div className="htr-contact">☎ {settings.phone}</div> : null}
        </div>

        <div className="htr-divider" />

        <div className="htr-meta">
          <div>
            <strong>Invoice:</strong> {invoice.invoiceNo || "—"}
          </div>
          <div>
            <strong>Date:</strong> {thermalDateLabel || "—"}
          </div>
          <div>
            <strong>Time:</strong> {thermalTimeLabel || "—"}
          </div>
          <div>
            <strong>Type:</strong> {branchShort}
          </div>
          {isDuplicate ? <div className="htr-meta-reprint">— Reprint —</div> : null}
        </div>

        <div className="htr-divider" />

        <div className="htr-guest">
          <div>
            <strong>Guest:</strong> {guestName}
          </div>
          {guestMobile ? (
            <div>
              <strong>Mobile:</strong> {guestMobile}
            </div>
          ) : null}
          {isDining ? (
            <DiningMeta invoice={invoice} items={items} />
          ) : (
            <LodgingMeta invoice={invoice} items={items} />
          )}
        </div>

        <div className="htr-divider" />

        <div className="htr-items-title">{isDining ? "Order" : "Charges"}</div>

        <table className="htr-items">
          <thead>
            <tr>
              <th className="htr-items-name">{isDining ? "Item" : "Room"}</th>
              {isDining ? null : <th className="htr-items-room">Rm</th>}
              <th className="htr-items-qty">{isDining ? "Qty" : "Nts"}</th>
              <th className="htr-items-rate">Rate</th>
              <th className="htr-items-amt">Amt</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={isDining ? 4 : 5} className="htr-empty">
                  No items on this receipt.
                </td>
              </tr>
            ) : (
              items.map((item, index) => {
                const qty = isDining
                  ? getQty(item)
                  : Math.max(
                      1,
                      Number(item?.meta?.nights ?? item?.meta?.stayNights ?? item?.nights ?? 1) || 1
                    );
                const rate = getRate(item);
                const amount = getAmount(item);
                const roomLabel =
                  item?.meta?.roomName ||
                  item?.meta?.roomId ||
                  invoice?.hotelDetails?.roomNumber ||
                  "";
                return (
                  <tr key={index}>
                    <td className="htr-items-name">{item.name || "—"}</td>
                    {isDining ? null : <td className="htr-items-room">{roomLabel || "—"}</td>}
                    <td className="htr-items-qty">{qty.toFixed(0)}</td>
                    <td className="htr-items-rate">₹{fmt2(rate)}</td>
                    <td className="htr-items-amt">₹{fmt2(amount)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>

        <div className="htr-divider" />

        <table className="htr-totals">
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td className="htr-totals-val">₹{fmt2(subTotal)}</td>
            </tr>
            {gstBreakdown.length === 0 ? (
              <tr>
                <td>GST</td>
                <td className="htr-totals-val">₹{fmt2(0)}</td>
              </tr>
            ) : (
              gstBreakdown.map((g) => (
                <tr key={g.percent}>
                  <td>GST @ {g.percent}%</td>
                  <td className="htr-totals-val">₹{fmt2(g.amount)}</td>
                </tr>
              ))
            )}
            <tr className="htr-grand">
              <td>GRAND TOTAL</td>
              <td>₹{fmt2(grandTotal)}</td>
            </tr>
          </tbody>
        </table>

        <div className="htr-payment">
          <strong>Payment:</strong> {invoice.paymentMode || "—"}
        </div>

        <div className="htr-divider htr-divider-qr" />

        <div className="htr-qr-row">
          {invoice.paymentMode === "UPI" &&
          (settings.qrType === "UPI" || settings.qrType === "BOTH") ? (
            <div className="htr-qr-tile">
              <QRCodeCanvas
                value={`upi://pay?pa=${settings.upiId}&pn=${settings.name}&am=${fmt2(grandTotal)}`}
                size={96}
              />
              <div className="htr-qr-label">UPI Pay</div>
            </div>
          ) : null}
          {settings.qrType === "INVOICE" || settings.qrType === "BOTH" ? (
            <div className="htr-qr-tile">
              <QRCodeCanvas
                value={JSON.stringify({
                  invoiceNo: invoice.invoiceNo,
                  amount: fmt2(grandTotal),
                })}
                size={96}
              />
              <div className="htr-qr-label">Invoice QR</div>
            </div>
          ) : null}
        </div>

        {invoice?.invoiceNo ? (
          <div className="htr-barcode">
            <svg ref={barcodeRef} />
          </div>
        ) : null}

        <div className="htr-divider" />

        <div className="htr-thanks">
          {isDining ? "Thank you for dining with us! 🍽️" : "Thank you for your stay! 🏨"}
        </div>
        <div className="htr-thanks-sub">
          {isDining ? "We hope to see you next visit." : "We hope to see you again. Safe travels."}
        </div>
        <div className="htr-servedby">
          Billed by · {invoice.billedBy || (isDining ? "Service Team" : "Front Desk")}
        </div>
      </div>
    </div>
  );
};

function DiningMeta({ invoice, items }) {
  // Table name resolution mirrors DiningInvoice.jsx — fall back to the
  // line-item `meta.tableName` / `meta.tableId` when the server didn't
  // persist the top-level hotelDetails (re-print path).
  const tableMeta = items.find((item) => item?.meta?.tableName || item?.meta?.tableId)?.meta;
  const tableName =
    invoice?.hotelDetails?.tableName?.trim() ||
    tableMeta?.tableName?.trim() ||
    tableMeta?.tableId ||
    "—";
  const partySize = Number(invoice?.hotelDetails?.partySize) || 0;
  const seatedAt = invoice?.hotelDetails?.checkInTime || invoice?.hotelDetails?.seatedAt || "";
  const clearedAt = invoice?.hotelDetails?.checkOutTime || "";
  // `checkInTime` / `seatedAt` arrive as HH:mm strings (from <input
  // type="time">); route them through the 12h formatter so the printed
  // receipt matches the A4 preview's "12:30 PM" style.
  const fmtClock12 = (value) => {
    if (!value) return "";
    const s = String(value).trim();
    const m = s.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
    if (!m) return s;
    let h = Number(m[1]);
    const min = m[2];
    const explicit = m[3] ? m[3].toUpperCase() : null;
    if (!explicit) {
      const period = h >= 12 ? "PM" : "AM";
      h = h % 12 || 12;
      return `${String(h).padStart(2, "0")}:${min} ${period}`;
    }
    return `${String(h).padStart(2, "0")}:${min} ${explicit}`;
  };
  return (
    <>
      <div>
        <strong>Table:</strong> {tableName}
      </div>
      {partySize > 0 ? (
        <div>
          <strong>Party:</strong> {partySize} guest{partySize > 1 ? "s" : ""}
        </div>
      ) : null}
      {seatedAt ? (
        <div>
          <strong>Seated:</strong> {fmtClock12(seatedAt)}
        </div>
      ) : null}
      {clearedAt ? (
        <div>
          <strong>Cleared:</strong> {fmtClock12(clearedAt)}
        </div>
      ) : null}
      {/* Render an items-line hint for multi-item bills so the cashier
          sees the order summary on the thermal narrow column too. */}
      {items.length > 0 ? (
        <div className="htr-mini">
          {items.length} item{items.length > 1 ? "s" : ""}
        </div>
      ) : null}
    </>
  );
}

function LodgingMeta({ invoice, items }) {
  const roomNumber =
    items[0]?.meta?.roomName || items[0]?.meta?.roomId || invoice?.hotelDetails?.roomNumber || "—";
  const checkInDate = items[0]?.meta?.checkInDate || invoice?.hotelDetails?.checkInDate || "";
  const checkInTime = items[0]?.meta?.checkInTime || "";
  const checkOutDate = items[0]?.meta?.checkOutDate || invoice?.hotelDetails?.checkOutDate || "";
  const checkOutTime = items[0]?.meta?.checkOutTime || "";
  const totalNights = items.reduce((sum, item) => {
    const n = item?.meta?.nights ?? item?.meta?.stayNights ?? item?.nights ?? item?.qty ?? 1;
    return sum + Math.max(1, Math.floor(Number(n) || 1));
  }, 0);
  const idProof = invoice?.hotelDetails?.idProof;
  return (
    <>
      <div>
        <strong>Room:</strong> {roomNumber}
      </div>
      {totalNights > 0 ? (
        <div>
          <strong>Nights:</strong> {totalNights}
        </div>
      ) : null}
      {checkInDate || checkInTime ? (
        <div>
          <strong>Check-in:</strong> {[checkInDate, checkInTime].filter(Boolean).join(" · ")}
        </div>
      ) : null}
      {checkOutDate || checkOutTime ? (
        <div>
          <strong>Check-out:</strong> {[checkOutDate, checkOutTime].filter(Boolean).join(" · ")}
        </div>
      ) : null}
      {idProof && (idProof.type || idProof.number) ? (
        <div>
          <strong>ID:</strong> {[idProof.type, idProof.number].filter(Boolean).join(" · ")}
        </div>
      ) : null}
    </>
  );
}

window.HotelThermalReceipt = HotelThermalReceipt;
export default HotelThermalReceipt;
