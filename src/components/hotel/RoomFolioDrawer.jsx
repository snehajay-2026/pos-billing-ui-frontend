import React, { useEffect, useMemo, useState } from "react";
import { useUi } from "../../context/UiContext";
import {
  buildFolioLineItems,
  clearFolio,
  clearFolioOnServer,
  expectedCheckOutLabel,
  fetchFolioFromServer,
  folioSubtotal,
  getRoomFolio,
  lateCheckOutMinutes,
  postCharge,
  postChargeToServer,
  removeCharge,
  removeChargeFromServer,
} from "./folio";

const formatMinutes = (mins) => {
  if (!mins || mins <= 0) return "0m";
  const total = Math.round(mins);
  if (total < 60) return `${total}m`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
};

const RoomFolioDrawer = ({ room, settings, onClose, onSettleCheckout, onPrintFolio }) => {
  const { showToast } = useUi();
  const [charges, setCharges] = useState(() => getRoomFolio(room));
  const [draft, setDraft] = useState({ name: "", qty: 1, rate: "", gst: "", note: "" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!room) return undefined;
    // Seed from localStorage for instant render; fetch the canonical
    // server view and overwrite when it arrives. Without the server fetch
    // a cashier opening the drawer on device B would only see charges that
    // device A flushed through the localStorage event bus.
    const handler = () => setCharges(getRoomFolio(room));
    window.addEventListener("hotel_room_folios_updated", handler);
    setCharges(getRoomFolio(room));
    fetchFolioFromServer(room).then((list) => {
      if (Array.isArray(list) && list.length) setCharges(list);
    });
    return () => window.removeEventListener("hotel_room_folios_updated", handler);
  }, [room]);

  // Re-evaluate late-checkout minutes every 60s so the drawer reflects "now".
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const lineItems = useMemo(
    () => buildFolioLineItems(room, settings),
    [room, settings, charges, tick]
  );
  const subtotal = useMemo(() => folioSubtotal(room, settings), [room, settings, charges, tick]);
  const gst = useMemo(
    () =>
      lineItems.reduce(
        (sum, it) => sum + ((Number(it.total) || 0) * (Number(it.gst) || 0)) / 100,
        0
      ),
    [lineItems]
  );
  const grandTotal = subtotal + gst;
  const lateMinutes = useMemo(
    () => lateCheckOutMinutes(room, new Date(), settings),
    [room, settings, tick]
  );

  if (!room) return null;

  const handleAddCharge = () => {
    const name = String(draft.name || "").trim();
    if (!name) {
      showToast("error", "Enter a charge name to post.");
      return;
    }
    if (Number(draft.rate) <= 0) {
      showToast("error", "Charge rate must be greater than 0.");
      return;
    }
    const next = postCharge(room, { ...draft, postedBy: "" });
    // Use the server-assigned id (if any) so the local cache and the
    // server stay in sync — this prevents duplicates if addCharge on the
    // server later retried with a different local id.
    const latest = Array.isArray(next) ? next[next.length - 1] : null;
    postChargeToServer(room, { ...draft, id: latest?.id, postedBy: "" });
    setDraft({ name: "", qty: 1, rate: "", gst: "", note: "" });
    showToast("success", `Posted "${name}" to ${room.name || "room"}.`);
  };

  const handleRemove = (chargeId) => {
    removeCharge(room, chargeId);
    removeChargeFromServer(room, chargeId);
    showToast("info", "Charge removed from folio.");
  };

  const handleClear = () => {
    if (!window.confirm("Clear all posted charges for this room?")) return;
    clearFolio(room);
    clearFolioOnServer(room);
    showToast("success", "Folio cleared.");
  };

  return (
    <div className="laundry-order-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="laundry-order-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Folio for ${room.name || room.id}`}
      >
        <header className="laundry-order-drawer-head">
          <div>
            <h4>{room.name || room.id} — Folio</h4>
            <p className="text-muted">
              {room.reservationCode && (
                <span style={{ marginRight: 8 }}>
                  <strong
                    style={{
                      background: "#0d6efd",
                      color: "#fff",
                      padding: "1px 6px",
                      borderRadius: 4,
                    }}
                  >
                    {room.reservationCode}
                  </strong>
                </span>
              )}
              {room.guest || "No guest name"} · {room.members || 1} guest(s) · {room.nights || 1}{" "}
              night(s)
            </p>
          </div>
          <button
            type="button"
            className="laundry-order-drawer-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <section className="laundry-order-drawer-section">
          <div className="laundry-order-drawer-grid">
            <div>
              <span>Status</span>
              <strong style={{ color: room.status === "occupied" ? "#dc3545" : "#198754" }}>
                {room.status === "occupied" ? "Occupied" : "Vacant"}
              </strong>
            </div>
            <div>
              <span>Expected check-out</span>
              <strong>{expectedCheckOutLabel(room, settings)}</strong>
            </div>
            <div>
              <span>Late by</span>
              <strong style={{ color: lateMinutes > 0 ? "#fd7e14" : "#198754" }}>
                {formatMinutes(lateMinutes)}
              </strong>
            </div>
            <div>
              <span>Posted charges</span>
              <strong>{charges.length}</strong>
            </div>
          </div>
        </section>

        <section className="laundry-order-drawer-section">
          <h6>Folio line items</h6>
          {lineItems.length === 0 ? (
            <p className="text-muted">
              No charges yet. Add an incidental below to start the folio.
            </p>
          ) : (
            <table className="laundry-order-drawer-items">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Rate</th>
                  <th>GST</th>
                  <th>Total</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((it, i) => (
                  <tr key={i}>
                    <td>
                      {it.name}
                      {it.meta?.kind === "late_checkout" && (
                        <small className="d-block text-muted">Auto-added on settle</small>
                      )}
                    </td>
                    <td>{it.qty}</td>
                    <td>Rs {Number(it.rate || 0).toFixed(2)}</td>
                    <td>{Number(it.gst || 0)}%</td>
                    <td>Rs {Number(it.total || 0).toFixed(2)}</td>
                    <td>
                      {it.meta?.kind === "posted_charge" && (
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => handleRemove(it.meta.chargeId)}
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="4">
                    <strong>Subtotal</strong>
                  </td>
                  <td colSpan="2">
                    <strong>Rs {subtotal.toFixed(2)}</strong>
                  </td>
                </tr>
                <tr>
                  <td colSpan="4">
                    <strong>GST</strong>
                  </td>
                  <td colSpan="2">
                    <strong>Rs {gst.toFixed(2)}</strong>
                  </td>
                </tr>
                <tr>
                  <td colSpan="4">
                    <strong>Grand total</strong>
                  </td>
                  <td colSpan="2">
                    <strong style={{ color: "#0d6efd" }}>Rs {grandTotal.toFixed(2)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <section className="laundry-order-drawer-section">
          <h6>Post a charge</h6>
          <div className="row">
            <div className="col-12 mb-2">
              <input
                className="form-control"
                placeholder="Description (e.g. Minibar, Room Service, Damage)"
                value={draft.name}
                onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div className="col-4 mb-2">
              <input
                className="form-control"
                type="number"
                min="1"
                placeholder="Qty"
                value={draft.qty}
                onChange={(e) => setDraft((p) => ({ ...p, qty: e.target.value }))}
              />
            </div>
            <div className="col-4 mb-2">
              <input
                className="form-control"
                type="number"
                min="0"
                placeholder="Rate (Rs)"
                value={draft.rate}
                onChange={(e) => setDraft((p) => ({ ...p, rate: e.target.value }))}
              />
            </div>
            <div className="col-4 mb-2">
              <input
                className="form-control"
                type="number"
                min="0"
                placeholder="GST %"
                value={draft.gst}
                onChange={(e) => setDraft((p) => ({ ...p, gst: e.target.value }))}
              />
            </div>
            <div className="col-12 mb-2">
              <input
                className="form-control"
                placeholder="Note (optional)"
                value={draft.note}
                onChange={(e) => setDraft((p) => ({ ...p, note: e.target.value }))}
              />
            </div>
          </div>
          <div className="d-flex gap-2 flex-wrap">
            <button type="button" className="btn btn-primary" onClick={handleAddCharge}>
              Post Charge
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={handleClear}
              disabled={charges.length === 0}
            >
              Clear All
            </button>
          </div>
        </section>

        <footer className="laundry-order-drawer-foot">
          <button
            type="button"
            className="btn btn-outline-primary"
            onClick={() => onPrintFolio && onPrintFolio(room, lineItems)}
          >
            Print Folio
          </button>
          <button
            type="button"
            className="btn btn-success"
            onClick={() => onSettleCheckout && onSettleCheckout(room, lineItems)}
            disabled={lineItems.length === 0}
          >
            Settle & Check Out
          </button>
        </footer>
      </aside>
    </div>
  );
};

export default RoomFolioDrawer;
