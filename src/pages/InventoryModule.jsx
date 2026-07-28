import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaPlus,
  FaTrash,
  FaEdit,
  FaCheck,
  FaTimes,
  FaTruck,
  FaShoppingCart,
  FaBoxes,
  FaExclamationTriangle,
  FaArrowLeft,
  FaSync,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  getPurchaseOrders,
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  receivePurchaseOrder,
  getStockMovements,
  createStockMovement,
  getLowStockAlerts,
} from "../services/inventoryService";
import "./InventoryModule.css";

const currency = (v) =>
  `₹${Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STORAGE_KEYS = {
  active: "inventory.module.active",
};

const SUPPLIER_INITIAL = { name: "", phone: "", email: "", gstin: "", address: "", notes: "" };
const PO_LINE_INITIAL = { productId: "", name: "", qty: 1, unitCost: 0 };

const TABS = [
  { key: "alerts", label: "Low Stock", icon: <FaExclamationTriangle /> },
  { key: "suppliers", label: "Suppliers", icon: <FaTruck /> },
  { key: "pos", label: "Purchase Orders", icon: <FaShoppingCart /> },
  { key: "movements", label: "Stock Movements", icon: <FaBoxes /> },
];

const Modal = ({ open, title, onClose, children, footer }) => {
  if (!open) return null;
  return (
    <div className="im-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="im-modal">
        <header className="im-modal-header">
          <h2>{title}</h2>
          <button type="button" className="im-modal-close" onClick={onClose}>
            <FaTimes />
          </button>
        </header>
        <div className="im-modal-body">{children}</div>
        {footer && <footer className="im-modal-footer">{footer}</footer>}
      </div>
    </div>
  );
};

// =====================================================================
// Suppliers tab
// =====================================================================
const SuppliersTab = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getSuppliers());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSave = async (record) => {
    if (record.id) {
      await updateSupplier(record.id, record);
    } else {
      await createSupplier(record);
    }
    setEditing(null);
    refresh();
  };

  return (
    <div className="im-tab-body">
      <div className="im-tab-actions">
        <button
          type="button"
          className="im-btn im-btn-primary"
          onClick={() => setEditing({ ...SUPPLIER_INITIAL })}
        >
          <FaPlus /> Add supplier
        </button>
        <button
          type="button"
          className="im-btn im-btn-secondary"
          onClick={refresh}
          disabled={loading}
        >
          <FaSync className={loading ? "im-spin" : ""} /> Refresh
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="im-empty">No suppliers yet. Add one to start raising purchase orders.</div>
      ) : (
        <table className="im-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Phone</th>
              <th>GSTIN</th>
              <th>Active</th>
              <th className="im-num">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="im-mono">{s.phone || "—"}</td>
                <td className="im-mono">{s.gstin || "—"}</td>
                <td>{s.active === 0 ? "No" : "Yes"}</td>
                <td className="im-num">
                  <button
                    type="button"
                    className="im-row-btn"
                    onClick={() => setEditing(s)}
                    title="Edit"
                  >
                    <FaEdit />
                  </button>
                  <button
                    type="button"
                    className="im-row-btn im-row-btn-danger"
                    onClick={async () => {
                      if (window.confirm(`Delete supplier "${s.name}"? This cannot be undone.`)) {
                        await deleteSupplier(s.id);
                        refresh();
                      }
                    }}
                    title="Delete"
                  >
                    <FaTrash />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <SupplierModal
        open={Boolean(editing)}
        record={editing}
        onSave={handleSave}
        onClose={() => setEditing(null)}
      />
    </div>
  );
};

const SupplierModal = ({ open, record, onSave, onClose }) => {
  const [form, setForm] = useState(() => ({ ...(record || SUPPLIER_INITIAL) }));
  useEffect(() => {
    setForm({ ...(record || SUPPLIER_INITIAL) });
  }, [record]);

  if (!open) return null;
  return (
    <Modal
      open={open}
      title={record?.id ? `Edit supplier` : "Add supplier"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="im-btn im-btn-secondary" onClick={onClose}>
            <FaTimes /> Cancel
          </button>
          <button type="button" className="im-btn im-btn-primary" onClick={() => onSave(form)}>
            <FaCheck /> Save
          </button>
        </>
      }
    >
      <div className="im-form">
        <div className="im-form-row">
          <label>Name *</label>
          <input
            type="text"
            value={form.name || ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </div>
        <div className="im-form-row">
          <label>Phone</label>
          <input
            type="text"
            value={form.phone || ""}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
          />
        </div>
        <div className="im-form-row">
          <label>Email</label>
          <input
            type="email"
            value={form.email || ""}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div className="im-form-row">
          <label>GSTIN</label>
          <input
            type="text"
            value={form.gstin || ""}
            onChange={(e) => setForm({ ...form, gstin: e.target.value })}
          />
        </div>
        <div className="im-form-row">
          <label>Address</label>
          <textarea
            value={form.address || ""}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            rows={2}
          />
        </div>
        <div className="im-form-row">
          <label>Notes</label>
          <textarea
            value={form.notes || ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
          />
        </div>
      </div>
    </Modal>
  );
};

// =====================================================================
// Purchase Orders tab
// =====================================================================
const PurchaseOrdersTab = () => {
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [pos, sups] = await Promise.all([getPurchaseOrders(), getSuppliers()]);
      setRows(pos);
      setSuppliers(sups);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSave = async (po) => {
    if (po.id) {
      await updatePurchaseOrder(po.id, po);
    } else {
      await createPurchaseOrder(po);
    }
    setEditing(null);
    refresh();
  };

  const handleReceive = async (id) => {
    if (
      !window.confirm(
        "Mark this PO as received? Stock will be incremented and cost prices updated for each line."
      )
    )
      return;
    try {
      const result = await receivePurchaseOrder(id);
      // Server tells us how many stock_movements were written.
      alert(`PO received. ${(result.movements || []).length} stock movements recorded.`);
      refresh();
    } catch (err) {
      alert(`Receive failed: ${err.message}`);
    }
  };

  return (
    <div className="im-tab-body">
      <div className="im-tab-actions">
        <button
          type="button"
          className="im-btn im-btn-primary"
          onClick={() =>
            setEditing({
              poNumber: "",
              date: new Date().toISOString().slice(0, 10),
              items: [{ ...PO_LINE_INITIAL, productId: "" }],
            })
          }
        >
          <FaPlus /> New PO
        </button>
        <button
          type="button"
          className="im-btn im-btn-secondary"
          onClick={refresh}
          disabled={loading}
        >
          <FaSync className={loading ? "im-spin" : ""} /> Refresh
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="im-empty">No purchase orders yet.</div>
      ) : (
        <table className="im-table">
          <thead>
            <tr>
              <th>PO #</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Items</th>
              <th className="im-num">Total</th>
              <th>Status</th>
              <th className="im-num">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td className="im-mono">{p.poNumber || p.id}</td>
                <td>{p.date || "—"}</td>
                <td>{p.supplierName || "—"}</td>
                <td>
                  {(p.items || []).length} line{(p.items || []).length === 1 ? "" : "s"}
                </td>
                <td className="im-num">{currency(p.totalAmount)}</td>
                <td>
                  <span className={`im-pill im-pill-${p.status}`}>{p.status}</span>
                </td>
                <td className="im-num">
                  {p.status !== "received" && (
                    <button
                      type="button"
                      className="im-row-btn"
                      onClick={() => setEditing(p)}
                      title="Edit"
                    >
                      <FaEdit />
                    </button>
                  )}
                  {p.status !== "received" && (
                    <button
                      type="button"
                      className="im-row-btn"
                      onClick={() => handleReceive(p.id)}
                      title="Mark received"
                    >
                      <FaCheck />
                    </button>
                  )}
                  {p.status !== "received" && (
                    <button
                      type="button"
                      className="im-row-btn im-row-btn-danger"
                      onClick={async () => {
                        if (window.confirm("Delete this PO? (received POs can't be deleted)")) {
                          await deletePurchaseOrder(p.id);
                          refresh();
                        }
                      }}
                      title="Delete"
                    >
                      <FaTrash />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PurchaseOrderModal
        open={Boolean(editing)}
        record={editing}
        suppliers={suppliers}
        onSave={handleSave}
        onClose={() => setEditing(null)}
      />
    </div>
  );
};

const PurchaseOrderModal = ({ open, record, suppliers, onSave, onClose }) => {
  const [lines, setLines] = useState([]);
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [date, setDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!record) return;
    setLines(
      Array.isArray(record.items) && record.items.length > 0
        ? record.items
        : [{ ...PO_LINE_INITIAL }]
    );
    setSupplierId(record.supplierId || "");
    setSupplierName(record.supplierName || "");
    setPoNumber(record.poNumber || "");
    setDate(record.date || new Date().toISOString().slice(0, 10));
    setNotes(record.notes || "");
  }, [record]);

  if (!open) return null;

  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unitCost) || 0), 0);

  return (
    <Modal
      open={open}
      title={record?.id ? `Edit PO ${record.poNumber || record.id}` : "New purchase order"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="im-btn im-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="im-btn im-btn-primary"
            onClick={() =>
              onSave({
                id: record?.id,
                poNumber,
                date,
                supplierId,
                supplierName:
                  supplierName || (suppliers.find((s) => s.id === supplierId) || {}).name || "",
                notes,
                status: record?.status || "draft",
                items: lines,
              })
            }
          >
            Save PO
          </button>
        </>
      }
    >
      <div className="im-form">
        <div className="im-form-grid">
          <div className="im-form-row">
            <label>PO number</label>
            <input
              type="text"
              value={poNumber}
              onChange={(e) => setPoNumber(e.target.value)}
              placeholder="auto-generated if blank"
            />
          </div>
          <div className="im-form-row">
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div className="im-form-row">
          <label>Supplier</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <select
              value={supplierId}
              onChange={(e) => {
                const id = e.target.value;
                setSupplierId(id);
                const sup = suppliers.find((s) => s.id === id);
                if (sup) setSupplierName(sup.name);
              }}
              style={{ flex: 1 }}
            >
              <option value="">Select supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="or type name…"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              style={{ flex: 1 }}
            />
          </div>
        </div>
        <div className="im-form-row">
          <label>Line items</label>
          <table className="im-table im-line-table">
            <thead>
              <tr>
                <th>Product ID</th>
                <th>Description</th>
                <th className="im-num">Qty</th>
                <th className="im-num">Unit cost</th>
                <th className="im-num">Line total</th>
                <th className="im-num"></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="text"
                      placeholder="product id"
                      value={line.productId || ""}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = { ...next[i], productId: e.target.value };
                        setLines(next);
                      }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      placeholder="name"
                      value={line.name || ""}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = { ...next[i], name: e.target.value };
                        setLines(next);
                      }}
                    />
                  </td>
                  <td className="im-num">
                    <input
                      type="number"
                      min="1"
                      value={line.qty || 0}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = { ...next[i], qty: Number(e.target.value) };
                        setLines(next);
                      }}
                    />
                  </td>
                  <td className="im-num">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.unitCost || 0}
                      onChange={(e) => {
                        const next = [...lines];
                        next[i] = { ...next[i], unitCost: Number(e.target.value) };
                        setLines(next);
                      }}
                    />
                  </td>
                  <td className="im-num">
                    {currency((Number(line.qty) || 0) * (Number(line.unitCost) || 0))}
                  </td>
                  <td className="im-num">
                    <button
                      type="button"
                      className="im-row-btn im-row-btn-danger"
                      onClick={() => setLines(lines.filter((_, j) => j !== i))}
                    >
                      <FaTrash />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            className="im-btn im-btn-secondary"
            onClick={() => setLines([...lines, { ...PO_LINE_INITIAL }])}
            style={{ marginTop: "0.5rem" }}
          >
            <FaPlus /> Add line
          </button>
          <div style={{ marginTop: "0.75rem", textAlign: "right", fontWeight: 600 }}>
            Total: {currency(total)}
          </div>
        </div>
        <div className="im-form-row">
          <label>Notes</label>
          <textarea value={notes || ""} rows={2} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
};

// =====================================================================
// Stock Movements tab
// =====================================================================
const MovementsTab = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getStockMovements());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCreate = async (movement) => {
    const result = await createStockMovement(movement);
    setCreating(null);
    alert(`Adjustment recorded. New stock: ${result.newStock}.`);
    refresh();
  };

  return (
    <div className="im-tab-body">
      <div className="im-tab-actions">
        <button
          type="button"
          className="im-btn im-btn-primary"
          onClick={() => setCreating({ delta: 0, reason: "manual_adjustment", notes: "" })}
        >
          <FaPlus /> Manual adjustment
        </button>
        <button
          type="button"
          className="im-btn im-btn-secondary"
          onClick={refresh}
          disabled={loading}
        >
          <FaSync className={loading ? "im-spin" : ""} /> Refresh
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="im-empty">No stock movements recorded yet.</div>
      ) : (
        <table className="im-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Product</th>
              <th className="im-num">Δ</th>
              <th>Reason</th>
              <th>Reference</th>
              <th>By</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="im-mono">
                  {String(m.at || "")
                    .slice(0, 19)
                    .replace("T", " ")}
                </td>
                <td>{m.productName || m.productId}</td>
                <td className={`im-num ${m.delta >= 0 ? "im-positive" : "im-negative"}`}>
                  {m.delta >= 0 ? "+" : ""}
                  {m.delta}
                </td>
                <td>{m.reason}</td>
                <td className="im-mono">
                  {m.refType === "purchase_order"
                    ? "PO"
                    : m.refType === "manual"
                      ? "manual"
                      : m.refType || "—"}
                  {m.refId ? `·${m.refId.slice(-6)}` : ""}
                </td>
                <td className="im-mono">{m.userEmail}</td>
                <td>{m.notes || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AdjustmentModal
        open={Boolean(creating)}
        record={creating}
        onSave={handleCreate}
        onClose={() => setCreating(null)}
      />
    </div>
  );
};

const AdjustmentModal = ({ open, record, onSave, onClose }) => {
  const [form, setForm] = useState({
    productId: "",
    delta: 0,
    reason: "manual_adjustment",
    notes: "",
  });
  useEffect(() => {
    if (record) setForm({ ...form, ...record });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record]);

  if (!open) return null;
  return (
    <Modal
      open={open}
      title="Record stock movement"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="im-btn im-btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="im-btn im-btn-primary" onClick={() => onSave(form)}>
            Record
          </button>
        </>
      }
    >
      <div className="im-form">
        <div className="im-form-row">
          <label>Product ID *</label>
          <input
            type="text"
            value={form.productId}
            onChange={(e) => setForm({ ...form, productId: e.target.value })}
          />
        </div>
        <div className="im-form-grid">
          <div className="im-form-row">
            <label>Delta (+ in / - out)</label>
            <input
              type="number"
              value={form.delta}
              onChange={(e) => setForm({ ...form, delta: Number(e.target.value) })}
            />
          </div>
          <div className="im-form-row">
            <label>Reason</label>
            <select
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            >
              <option value="manual_adjustment">Manual adjustment</option>
              <option value="damage">Damage</option>
              <option value="expiry">Expiry</option>
              <option value="return">Customer return</option>
              <option value="correction">Count correction</option>
            </select>
          </div>
        </div>
        <div className="im-form-row">
          <label>Notes</label>
          <textarea
            rows={2}
            value={form.notes || ""}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
};

// =====================================================================
// Low-Stock tab
// =====================================================================
const LowStockTab = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await getLowStockAlerts());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="im-tab-body">
      <div className="im-tab-actions">
        <button
          type="button"
          className="im-btn im-btn-secondary"
          onClick={refresh}
          disabled={loading}
        >
          <FaSync className={loading ? "im-spin" : ""} /> Refresh
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="im-empty im-empty-ok">
          All products are above their re-order thresholds.{" "}
        </div>
      ) : (
        <table className="im-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Product</th>
              <th>Barcode</th>
              <th>Category</th>
              <th className="im-num">Stock</th>
              <th className="im-num">Re-order at</th>
              <th className="im-num">Short by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <span className={`im-pill im-pill-${r.severity}`}>{r.severity}</span>
                </td>
                <td>{r.name}</td>
                <td className="im-mono">{r.barcode || "—"}</td>
                <td>{r.category || "—"}</td>
                <td className="im-num">{r.stock}</td>
                <td className="im-num">{r.lowStockLimit}</td>
                <td className="im-num im-negative">{Math.max(0, r.lowStockLimit - r.stock)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

// =====================================================================
// Page
// =====================================================================
const InventoryModule = () => {
  const navigate = useNavigate();
  const [active, setActive] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEYS.active) || "alerts";
    } catch {
      return "alerts";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.active, active);
    } catch {}
  }, [active]);

  // Keep a fresh supplier list cached for the PO modal's picker.
  useEffect(() => {
    (async () => {
      try {
        setSuppliers(await getSuppliers());
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const tabs = useMemo(() => TABS, []);

  return (
    <div className="im-page">
      <header className="im-header">
        <button type="button" className="im-back-btn" onClick={() => navigate(-1)}>
          <FaArrowLeft /> Back
        </button>
        <div>
          <h1>Inventory</h1>
          <p className="im-subtitle">
            Suppliers · purchase orders · stock movements · low-stock alerts
          </p>
        </div>
      </header>

      <nav className="im-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            className={`im-tab ${active === t.key ? "im-tab-active" : ""}`}
            aria-selected={active === t.key}
            onClick={() => setActive(t.key)}
          >
            {t.icon} <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <section className="im-panel">
        {active === "alerts" && <LowStockTab />}
        {active === "suppliers" && <SuppliersTab />}
        {active === "pos" && <PurchaseOrdersTab />}
        {active === "movements" && <MovementsTab />}
      </section>
    </div>
  );
};

export default InventoryModule;
