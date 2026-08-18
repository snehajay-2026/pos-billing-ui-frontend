import React, { useEffect, useState } from "react";
import { FaTag, FaPlus, FaTrashAlt, FaCheck, FaTimes } from "react-icons/fa";
import { SectionTitle } from "../store-settings/StoreSettingsSections";
import { isAdminRole } from "../../utils/auth";
import { listCoupons, createCoupon, updateCoupon } from "../../services/hotelService";

const Field = ({ icon, label, hint, children }) => (
  <div className="ss-field">
    {label ? <label className="ss-field-label">{label}</label> : null}
    <div className="ss-field-row">
      {icon ? <span className="ss-field-icon">{icon}</span> : null}
      <div className="ss-field-control">{children}</div>
    </div>
    {hint ? <small className="ss-field-hint">{hint}</small> : null}
  </div>
);

const Input = (props) => <input {...props} className={`ss-input ${props.className || ""}`} />;

/* Hotel Discount Coupons — owner-only CRUD panel.

   Lives inside Store Settings → Hotel. Backend route
   `GET/POST/PUT /api/hotel/coupons` enforces the role check
   (SUPER_OWNER / ADMIN / STORE_ADMIN); the local guard here is
   cosmetic and just hides the panel from cashiers.

   Fields:
     code           — text, uppercased on submit
     value          — percent (0–100, decimal allowed)
     minSubtotal    — optional floor on cart subtotal
     validFrom      — optional start date
     validUntil     — optional end date
     active         — soft-delete flag

   Notes:
     - type is locked to "percent" for v1.
     - `apiPut` is what the backend uses for updates (no PATCH
       route exists). The server returns the updated row.
     - "Remove" is a soft-delete (sets `active: false`) so
       historical invoices still resolve their coupon if the
       DB ever needs to re-render them. */
const HotelCouponsPanel = () => {
  const allowed = isAdminRole();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    code: "",
    value: "",
    minSubtotal: "",
    validFrom: "",
    validUntil: "",
  });
  const [busyId, setBusyId] = useState(null);

  const refresh = async () => {
    if (!allowed) return;
    setLoading(true);
    setError("");
    try {
      const rows = await listCoupons();
      setItems(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(e?.message || "Could not load coupons");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setEditingId(null);
    setForm({ code: "", value: "", minSubtotal: "", validFrom: "", validUntil: "" });
  };

  const handleEdit = (row) => {
    setEditingId(row.id);
    setForm({
      code: row.code || "",
      value: row.value != null ? String(row.value) : "",
      minSubtotal: row.minSubtotal != null ? String(row.minSubtotal) : "",
      validFrom: row.validFrom || "",
      validUntil: row.validUntil || "",
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    const code = String(form.code || "")
      .trim()
      .toUpperCase();
    const value = Number(form.value);
    if (!code) {
      setError("Code is required");
      return;
    }
    if (!Number.isFinite(value) || value <= 0 || value > 100) {
      setError("Percent value must be between 0 and 100");
      return;
    }
    const payload = {
      code,
      type: "percent",
      value,
      minSubtotal: form.minSubtotal === "" ? null : Math.max(0, Number(form.minSubtotal) || 0),
      validFrom: form.validFrom || null,
      validUntil: form.validUntil || null,
      active: true,
    };
    try {
      if (editingId) {
        await updateCoupon(editingId, payload);
      } else {
        await createCoupon(payload);
      }
      reset();
      await refresh();
    } catch (err) {
      setError(err?.body?.message || err?.message || "Save failed");
    }
  };

  const handleToggleActive = async (row) => {
    setBusyId(row.id);
    setError("");
    try {
      await updateCoupon(row.id, { active: !row.active });
      await refresh();
    } catch (err) {
      setError(err?.body?.message || err?.message || "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  if (!allowed) return null;

  return (
    <div className="ss-section">
      <SectionTitle
        icon={<FaTag />}
        title="Discount Coupons"
        subtitle="Create coupon codes cashiers can redeem on the Live Bill. Manual % discounts work without a coupon."
      />

      <form onSubmit={handleSubmit} className="ss-grid-2">
        <Field icon={<FaTag />} label="Coupon code">
          <Input
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            placeholder="HOTEL10"
            style={{ textTransform: "uppercase" }}
          />
        </Field>
        <Field icon={<FaTag />} label="Percent off (0–100)">
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={form.value}
            onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
            placeholder="10"
          />
        </Field>
        <Field icon={<FaTag />} label="Min subtotal (optional)" hint="0 = no minimum">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.minSubtotal}
            onChange={(e) => setForm((f) => ({ ...f, minSubtotal: e.target.value }))}
            placeholder="0"
          />
        </Field>
        <Field icon={<FaTag />} label="Valid from (optional)">
          <Input
            type="date"
            value={form.validFrom}
            onChange={(e) => setForm((f) => ({ ...f, validFrom: e.target.value }))}
          />
        </Field>
        <Field icon={<FaTag />} label="Valid until (optional)">
          <Input
            type="date"
            value={form.validUntil}
            onChange={(e) => setForm((f) => ({ ...f, validUntil: e.target.value }))}
          />
        </Field>
        <div className="ss-field" style={{ alignSelf: "end" }}>
          <div className="ss-field-row" style={{ gap: 8 }}>
            <button type="submit" className="ss-btn ss-btn-sm" disabled={loading}>
              <FaPlus style={{ marginRight: 4 }} />
              {editingId ? "Update" : "Add"} coupon
            </button>
            {editingId ? (
              <button
                type="button"
                className="ss-btn ss-btn-sm ss-btn-soft"
                onClick={reset}
                disabled={loading}
              >
                <FaTimes style={{ marginRight: 4 }} />
                Cancel
              </button>
            ) : null}
          </div>
        </div>
      </form>

      {error ? (
        <div className="ss-field-error" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}

      <div style={{ marginTop: 12 }}>
        {loading ? (
          <div className="ss-field-hint">Loading coupons…</div>
        ) : items.length === 0 ? (
          <div className="ss-field-hint">No coupons yet. Create one above to get started.</div>
        ) : (
          <table className="ss-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 6 }}>Code</th>
                <th style={{ textAlign: "right", padding: 6 }}>%</th>
                <th style={{ textAlign: "right", padding: 6 }}>Min subtotal</th>
                <th style={{ textAlign: "left", padding: 6 }}>Window</th>
                <th style={{ textAlign: "left", padding: 6 }}>Status</th>
                <th style={{ textAlign: "right", padding: 6 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td style={{ padding: 6, fontFamily: "monospace" }}>{row.code}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{Number(row.value).toFixed(2)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>
                    {row.minSubtotal != null ? `₹${Number(row.minSubtotal).toFixed(2)}` : "—"}
                  </td>
                  <td style={{ padding: 6 }}>
                    {row.validFrom || row.validUntil
                      ? `${row.validFrom || "…"} → ${row.validUntil || "…"}`
                      : "Always"}
                  </td>
                  <td style={{ padding: 6 }}>
                    {row.active ? (
                      <span className="ss-badge ss-badge-on">
                        <FaCheck style={{ marginRight: 4 }} /> Active
                      </span>
                    ) : (
                      <span className="ss-badge ss-badge-off">
                        <FaTimes style={{ marginRight: 4 }} /> Disabled
                      </span>
                    )}
                  </td>
                  <td style={{ padding: 6, textAlign: "right" }}>
                    <button
                      type="button"
                      className="ss-btn ss-btn-sm ss-btn-soft"
                      onClick={() => handleEdit(row)}
                      disabled={busyId === row.id}
                      style={{ marginRight: 6 }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ss-btn ss-btn-sm ss-btn-danger-soft"
                      onClick={() => handleToggleActive(row)}
                      disabled={busyId === row.id}
                    >
                      <FaTrashAlt style={{ marginRight: 4 }} />
                      {row.active ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default HotelCouponsPanel;
