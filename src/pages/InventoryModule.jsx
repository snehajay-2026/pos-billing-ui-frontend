import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useUi } from "../context/UiContext";
import { getUser } from "../utils/auth";
import { getPurchaseOrderCatalog } from "../services/inventoryService";
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
import {
  PO_LINE_INITIAL,
  calculatePurchaseOrderTotal,
  lowStockSeverity,
  movementLabel,
  getVisibleInventoryTabKeys,
  isServiceStoreType,
  normalizePoLine,
  normalizePurchaseOrderPayload,
  sanitizeInventoryTab,
  validatePurchaseOrder,
} from "../utils/inventoryPo";
import "./InventoryModule.css";

const currency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const errorText = (error, fallback) => error?.message || fallback;

const SUPPLIER_INITIAL = { name: "", phone: "", email: "", gstin: "", address: "", notes: "" };
const TABS = [
  { key: "alerts", label: "Low Stock", icon: <FaExclamationTriangle /> },
  { key: "suppliers", label: "Suppliers", icon: <FaTruck /> },
  { key: "pos", label: "Purchase Orders", icon: <FaShoppingCart /> },
  { key: "movements", label: "Stock Movements", icon: <FaBoxes /> },
];

const Modal = ({ open, title, onClose, children, footer }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="im-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="im-modal">
        <header className="im-modal-header">
          <h2>{title}</h2>
          <button type="button" className="im-modal-close" onClick={onClose} aria-label="Close">
            <FaTimes />
          </button>
        </header>
        <div className="im-modal-body">{children}</div>
        {footer && <footer className="im-modal-footer">{footer}</footer>}
      </div>
    </div>
  );
};

const LoadState = ({ loading, error, onRetry }) => {
  if (loading) return <div className="im-empty">Loading inventory…</div>;
  if (error)
    return (
      <div className="im-empty im-empty-error">
        <p>{error}</p>
        <button type="button" className="im-btn im-btn-secondary" onClick={onRetry}>
          <FaSync /> Try again
        </button>
      </div>
    );
  return null;
};

const SuppliersTab = () => {
  const { showToast } = useUi();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getSuppliers();
      setRows(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(errorText(err, "Unable to load suppliers."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSave = async (record) => {
    if (!record.name.trim()) return showToast("error", "Supplier name is required.");
    if (record.email && !/^\S+@\S+\.\S+$/.test(record.email))
      return showToast("error", "Enter a valid supplier email.");
    setSaving(true);
    try {
      if (record.id) await updateSupplier(record.id, record);
      else await createSupplier(record);
      setEditing(null);
      showToast("success", record.id ? "Supplier updated." : "Supplier added.");
      await refresh();
    } catch (err) {
      showToast("error", errorText(err, "Unable to save supplier."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (supplier) => {
    if (!window.confirm(`Delete supplier “${supplier.name}”? This cannot be undone.`)) return;
    setDeleting(supplier.id);
    try {
      await deleteSupplier(supplier.id);
      showToast("success", "Supplier deleted.");
      await refresh();
    } catch (err) {
      showToast("error", errorText(err, "Unable to delete supplier."));
    } finally {
      setDeleting(null);
    }
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
      <LoadState loading={loading} error={error} onRetry={refresh} />
      {!loading &&
        !error &&
        (rows.length === 0 ? (
          <div className="im-empty">
            No suppliers yet. Add one to start raising purchase orders.
          </div>
        ) : (
          <div className="im-table-scroll">
            <table className="im-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>GSTIN</th>
                  <th className="im-num">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>{supplier.name}</td>
                    <td className="im-mono">{supplier.phone || "—"}</td>
                    <td>{supplier.email || "—"}</td>
                    <td className="im-mono">{supplier.gstin || "—"}</td>
                    <td className="im-num">
                      <button
                        type="button"
                        className="im-row-btn"
                        onClick={() => setEditing(supplier)}
                        disabled={Boolean(deleting)}
                        title="Edit supplier"
                      >
                        <FaEdit />
                      </button>
                      <button
                        type="button"
                        className="im-row-btn im-row-btn-danger"
                        onClick={() => handleDelete(supplier)}
                        disabled={Boolean(deleting)}
                        title="Delete supplier"
                      >
                        <FaTrash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      <SupplierModal
        open={Boolean(editing)}
        record={editing}
        onSave={handleSave}
        saving={saving}
        onClose={() => setEditing(null)}
      />
    </div>
  );
};

const SupplierModal = ({ open, record, onSave, saving, onClose }) => {
  const [form, setForm] = useState(SUPPLIER_INITIAL);
  useEffect(() => setForm({ ...SUPPLIER_INITIAL, ...(record || {}) }), [record]);
  if (!open) return null;
  return (
    <Modal
      open={open}
      title={record?.id ? "Edit supplier" : "Add supplier"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="im-btn im-btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="im-btn im-btn-primary"
            onClick={() => onSave(form)}
            disabled={saving}
          >
            {saving ? (
              "Saving…"
            ) : (
              <>
                <FaCheck /> Save supplier
              </>
            )}
          </button>
        </>
      }
    >
      <div className="im-form">
        {["name", "phone", "email", "gstin"].map((field) => (
          <div className="im-form-row" key={field}>
            <label htmlFor={`supplier-${field}`}>
              {field === "name" ? "Name *" : field.toUpperCase()}
            </label>
            <input
              id={`supplier-${field}`}
              type={field === "email" ? "email" : "text"}
              value={form[field] || ""}
              onChange={(event) => setForm({ ...form, [field]: event.target.value })}
              required={field === "name"}
            />
          </div>
        ))}
        <div className="im-form-row">
          <label htmlFor="supplier-address">Address</label>
          <textarea
            id="supplier-address"
            rows={2}
            value={form.address || ""}
            onChange={(event) => setForm({ ...form, address: event.target.value })}
          />
        </div>
        <div className="im-form-row">
          <label htmlFor="supplier-notes">Notes</label>
          <textarea
            id="supplier-notes"
            rows={2}
            value={form.notes || ""}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
};

const PurchaseOrdersTab = () => {
  const { showToast } = useUi();
  const [rows, setRows] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [catalogType, setCatalogType] = useState("product");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const catalogRequestRef = useRef(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    const requestId = ++catalogRequestRef.current;

    // Keep the catalog request independent from purchase orders/suppliers.
    // A missing inventory table or a scoped PO request must not hide products
    // that are already available through the canonical Store catalog.
    const [poResult, supplierResult, catalogResult] = await Promise.allSettled([
      getPurchaseOrders(),
      getSuppliers(),
      getPurchaseOrderCatalog(),
    ]);

    if (requestId !== catalogRequestRef.current) return;
    if (poResult.status === "fulfilled") {
      setRows(Array.isArray(poResult.value) ? poResult.value : []);
    }
    if (supplierResult.status === "fulfilled") {
      setSuppliers(Array.isArray(supplierResult.value) ? supplierResult.value : []);
    }
    if (catalogResult.status === "fulfilled") {
      setCatalogType(catalogResult.value?.catalogType || "product");
      setProducts(Array.isArray(catalogResult.value?.items) ? catalogResult.value.items : []);
    }

    const failed = [poResult, supplierResult, catalogResult].filter(
      (result) => result.status === "rejected"
    );
    if (failed.length && catalogResult.status === "rejected") {
      setError(errorText(catalogResult.reason, "Unable to load the product catalog."));
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSave = async (po) => {
    const errors = validatePurchaseOrder(po);
    if (Object.keys(errors).length)
      return showToast(
        "error",
        typeof errors.items === "string"
          ? errors.items
          : errors.poNumber || errors.supplier || "Please fix the PO form."
      );
    setSaving(true);
    try {
      if (po.id) await updatePurchaseOrder(po.id, po);
      else await createPurchaseOrder(po);
      setEditing(null);
      showToast("success", po.id ? "Purchase order updated." : "Purchase order created.");
      await refresh();
    } catch (err) {
      showToast("error", errorText(err, "Unable to save purchase order."));
    } finally {
      setSaving(false);
    }
  };

  const receive = async (po) => {
    const hasServiceLines = (po.items || []).some((item) => item.catalogType === "service");
    const hasProductLines = (po.items || []).some((item) => item.catalogType !== "service");
    const prompt =
      hasServiceLines && !hasProductLines
        ? "Mark this service PO as received? Service lines do not create stock movements."
        : "Mark this PO as received? Stock will be increased for each linked product.";
    if (!window.confirm(prompt)) return;
    setBusyId(po.id);
    try {
      const result = await receivePurchaseOrder(po.id);
      const movementCount = (result.movements || []).length;
      showToast(
        "success",
        movementCount
          ? `PO received. ${movementCount} stock movement(s) recorded.`
          : hasServiceLines && !hasProductLines
            ? "PO received. Service lines do not create stock movements."
            : "PO received."
      );
      await refresh();
    } catch (err) {
      showToast("error", errorText(err, "Unable to receive purchase order."));
    } finally {
      setBusyId(null);
    }
  };
  const remove = async (po) => {
    if (!window.confirm("Delete this purchase order?")) return;
    setBusyId(po.id);
    try {
      await deletePurchaseOrder(po.id);
      showToast("success", "Purchase order deleted.");
      await refresh();
    } catch (err) {
      showToast("error", errorText(err, "Unable to delete purchase order."));
    } finally {
      setBusyId(null);
    }
  };

  const newPo = () =>
    setEditing({
      poNumber: `PO-${Date.now()}`,
      date: today(),
      expectedAt: "",
      supplierId: "",
      supplierName: "",
      notes: "",
      status: "draft",
      items: [{ ...PO_LINE_INITIAL }],
    });
  return (
    <div className="im-tab-body">
      <div className="im-tab-actions">
        <button type="button" className="im-btn im-btn-primary" onClick={newPo}>
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
      <LoadState loading={loading} error={error} onRetry={refresh} />
      {!loading &&
        !error &&
        (rows.length === 0 ? (
          <div className="im-empty">
            No purchase orders yet. Create one to start receiving stock.
          </div>
        ) : (
          <div className="im-table-scroll">
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
                {rows.map((po) => (
                  <tr key={po.id}>
                    <td className="im-mono">{po.poNumber || po.id}</td>
                    <td>{po.date || po.createdAt?.slice(0, 10) || "—"}</td>
                    <td>{po.supplierName || "—"}</td>
                    <td>{(po.items || []).length}</td>
                    <td className="im-num">{currency(po.totalAmount)}</td>
                    <td>
                      <span className={`im-pill im-pill-${po.status}`}>{po.status}</span>
                    </td>
                    <td className="im-num">
                      {po.status !== "received" && (
                        <>
                          <button
                            type="button"
                            className="im-row-btn"
                            onClick={() => setEditing(po)}
                            disabled={busyId === po.id}
                            title="Edit PO"
                          >
                            <FaEdit />
                          </button>
                          <button
                            type="button"
                            className="im-row-btn"
                            onClick={() => receive(po)}
                            disabled={busyId === po.id}
                            title="Receive PO"
                          >
                            <FaCheck />
                          </button>
                          <button
                            type="button"
                            className="im-row-btn im-row-btn-danger"
                            onClick={() => remove(po)}
                            disabled={busyId === po.id}
                            title="Delete PO"
                          >
                            <FaTrash />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      <PurchaseOrderModal
        open={Boolean(editing)}
        record={editing}
        suppliers={suppliers}
        products={products}
        catalogType={catalogType}
        saving={saving}
        onSave={handleSave}
        onClose={() => setEditing(null)}
      />
    </div>
  );
};

const PurchaseOrderModal = ({
  open,
  record,
  suppliers,
  products,
  catalogType,
  saving,
  onSave,
  onClose,
}) => {
  const [form, setForm] = useState({
    poNumber: "",
    date: today(),
    expectedAt: "",
    supplierId: "",
    supplierName: "",
    notes: "",
    status: "draft",
    items: [{ ...PO_LINE_INITIAL }],
  });
  useEffect(() => {
    if (record)
      setForm({
        ...record,
        date: record.date || record.createdAt?.slice(0, 10) || today(),
        expectedAt: record.expectedAt || "",
        items: (record.items || [{ ...PO_LINE_INITIAL }]).map(normalizePoLine),
      });
  }, [record]);
  if (!open) return null;
  const total = calculatePurchaseOrderTotal(form.items);
  const setLine = (index, patch) =>
    setForm((current) => ({
      ...current,
      items: current.items.map((line, i) =>
        i === index ? normalizePoLine({ ...line, ...patch }) : line
      ),
    }));
  const chooseProduct = (index, value) => {
    const product = products.find((item) => String(item.id) === String(value));
    setLine(index, {
      productId: value,
      productName: product?.name || "",
      unitPrice: product?.price ?? product?.rate ?? 0,
      catalogType: product?.catalogType || catalogType,
    });
  };
  return (
    <Modal
      open={open}
      title={form.id ? `Edit PO ${form.poNumber}` : "New purchase order"}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="im-btn im-btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="im-btn im-btn-primary"
            onClick={() => onSave(normalizePurchaseOrderPayload(form))}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save PO"}
          </button>
        </>
      }
    >
      <div className="im-form">
        <div className="im-form-grid">
          <div className="im-form-row">
            <label htmlFor="po-number">PO number *</label>
            <input
              id="po-number"
              value={form.poNumber}
              onChange={(event) => setForm({ ...form, poNumber: event.target.value })}
            />
          </div>
          <div className="im-form-row">
            <label htmlFor="po-date">Order date *</label>
            <input
              id="po-date"
              type="date"
              value={form.date}
              onChange={(event) => setForm({ ...form, date: event.target.value })}
            />
          </div>
          <div className="im-form-row">
            <label htmlFor="po-expected">Expected date</label>
            <input
              id="po-expected"
              type="date"
              value={form.expectedAt}
              onChange={(event) => setForm({ ...form, expectedAt: event.target.value })}
            />
          </div>
          <div className="im-form-row">
            <label htmlFor="po-status">Status</label>
            <select
              id="po-status"
              value={form.status}
              onChange={(event) => setForm({ ...form, status: event.target.value })}
            >
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
            </select>
          </div>
        </div>
        <div className="im-form-row">
          <label htmlFor="po-supplier">Supplier</label>
          <select
            id="po-supplier"
            value={form.supplierId}
            onChange={(event) => {
              const supplier = suppliers.find((item) => String(item.id) === event.target.value);
              setForm({
                ...form,
                supplierId: event.target.value,
                supplierName: supplier?.name || form.supplierName,
              });
            }}
          >
            <option value="">Select supplier…</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
          <input
            aria-label="Supplier name"
            placeholder="Or type supplier name"
            value={form.supplierName}
            onChange={(event) => setForm({ ...form, supplierName: event.target.value })}
          />
        </div>
        <div className="im-form-row">
          <label>Line items *</label>
          <div className="im-table-scroll">
            <table className="im-table im-line-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Description</th>
                  <th className="im-num">Qty</th>
                  <th className="im-num">Unit cost</th>
                  <th className="im-num">Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {form.items.map((line, index) => (
                  <tr key={index}>
                    <td>
                      <select
                        aria-label={`Product ${index + 1}`}
                        value={line.productId}
                        onChange={(event) => chooseProduct(index, event.target.value)}
                      >
                        <option value="">
                          {products.length
                            ? `Select ${catalogType === "service" ? "service" : "product"}`
                            : `No ${catalogType === "service" ? "services" : "products"} found for this store`}
                        </option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                            {product.price != null || product.rate != null
                              ? ` · ${currency(product.price ?? product.rate)}`
                              : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label={`Description ${index + 1}`}
                        value={line.productName}
                        onChange={(event) => setLine(index, { productName: event.target.value })}
                        placeholder="Description"
                      />
                    </td>
                    <td className="im-num">
                      <input
                        aria-label={`Quantity ${index + 1}`}
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={line.quantity}
                        onChange={(event) => setLine(index, { quantity: event.target.value })}
                      />
                    </td>
                    <td className="im-num">
                      <input
                        aria-label={`Unit cost ${index + 1}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(event) => setLine(index, { unitPrice: event.target.value })}
                      />
                    </td>
                    <td className="im-num">{currency(line.quantity * line.unitPrice)}</td>
                    <td className="im-num">
                      <button
                        type="button"
                        className="im-row-btn im-row-btn-danger"
                        onClick={() =>
                          setForm({ ...form, items: form.items.filter((_, i) => i !== index) })
                        }
                        disabled={form.items.length === 1}
                      >
                        <FaTrash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="im-btn im-btn-secondary"
            onClick={() => setForm({ ...form, items: [...form.items, { ...PO_LINE_INITIAL }] })}
          >
            <FaPlus /> Add line
          </button>
          <div className="im-total">Total: {currency(total)}</div>
        </div>
        <div className="im-form-row">
          <label htmlFor="po-notes">Notes</label>
          <textarea
            id="po-notes"
            rows={2}
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
          />
        </div>
      </div>
    </Modal>
  );
};

const MovementsTab = () => {
  const { showToast } = useUi();
  const [rows, setRows] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [moves, catalog] = await Promise.all([getStockMovements(), getProducts()]);
      setRows(Array.isArray(moves) ? moves : []);
      setProducts(Array.isArray(catalog) ? catalog : []);
    } catch (err) {
      setError(errorText(err, "Unable to load stock movements."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const handleCreate = async (form) => {
    if (!form.productId || !form.type || Number(form.quantity) <= 0)
      return showToast("error", "Choose a product, movement type, and positive quantity.");
    setSaving(true);
    try {
      const result = await createStockMovement(form);
      showToast("success", `${movementLabel(form)} recorded. Stock is now updated.`);
      setCreating(false);
      await refresh();
      if (result?.crossedLowStock)
        showToast("warning", "This product is now at or below its low-stock threshold.");
    } catch (err) {
      showToast("error", errorText(err, "Unable to record stock movement."));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="im-tab-body">
      <div className="im-tab-actions">
        <button type="button" className="im-btn im-btn-primary" onClick={() => setCreating(true)}>
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
      <LoadState loading={loading} error={error} onRetry={refresh} />
      {!loading &&
        !error &&
        (rows.length === 0 ? (
          <div className="im-empty">No stock movements recorded yet.</div>
        ) : (
          <div className="im-table-scroll">
            <table className="im-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Product</th>
                  <th>Type</th>
                  <th className="im-num">Qty</th>
                  <th>Reason</th>
                  <th>PO ref</th>
                  <th>By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((movement) => (
                  <tr key={movement.id}>
                    <td className="im-mono">
                      {String(movement.createdAt || "")
                        .slice(0, 19)
                        .replace("T", " ") || "—"}
                    </td>
                    <td>{movement.productName || movement.productId || "—"}</td>
                    <td>
                      <span className={`im-pill im-pill-${movement.type}`}>
                        {movementLabel(movement)}
                      </span>
                    </td>
                    <td className="im-num">{movement.quantity}</td>
                    <td>{movement.reason || "—"}</td>
                    <td className="im-mono">
                      {movement.purchaseOrderId ? `PO ·${movement.purchaseOrderId}` : "—"}
                    </td>
                    <td className="im-mono">{movement.createdBy || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      <AdjustmentModal
        open={creating}
        products={products}
        saving={saving}
        onSave={handleCreate}
        onClose={() => setCreating(false)}
      />
    </div>
  );
};

const AdjustmentModal = ({ open, products, saving, onSave, onClose }) => {
  const [form, setForm] = useState({
    productId: "",
    productName: "",
    type: "adjustment",
    quantity: 1,
    adjustmentDirection: "increase",
    reason: "manual_adjustment",
  });
  useEffect(() => {
    if (open)
      setForm({
        productId: "",
        productName: "",
        type: "adjustment",
        quantity: 1,
        adjustmentDirection: "increase",
        reason: "manual_adjustment",
      });
  }, [open]);
  if (!open) return null;
  return (
    <Modal
      open={open}
      title="Record stock movement"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="im-btn im-btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="im-btn im-btn-primary"
            onClick={() => onSave(form)}
            disabled={saving}
          >
            {saving ? "Recording…" : "Record movement"}
          </button>
        </>
      }
    >
      <div className="im-form">
        <div className="im-form-row">
          <label htmlFor="movement-product">Product *</label>
          <select
            id="movement-product"
            value={form.productId}
            onChange={(event) => {
              const product = products.find((item) => String(item.id) === event.target.value);
              setForm({ ...form, productId: event.target.value, productName: product?.name || "" });
            }}
          >
            <option value="">Select product…</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} (stock {product.stock ?? 0})
              </option>
            ))}
          </select>
        </div>
        <div className="im-form-grid">
          <div className="im-form-row">
            <label htmlFor="movement-type">Type</label>
            <select
              id="movement-type"
              value={form.type}
              onChange={(event) => setForm({ ...form, type: event.target.value })}
            >
              <option value="adjustment">Adjustment</option>
              <option value="in">Stock in</option>
              <option value="out">Stock out</option>
            </select>
          </div>
          <div className="im-form-row">
            <label htmlFor="movement-quantity">Quantity *</label>
            <input
              id="movement-quantity"
              type="number"
              min="0.001"
              step="0.001"
              value={form.quantity}
              onChange={(event) => setForm({ ...form, quantity: event.target.value })}
            />
          </div>
        </div>
        {form.type === "adjustment" && (
          <div className="im-form-row">
            <label htmlFor="movement-direction">Adjustment direction</label>
            <select
              id="movement-direction"
              value={form.adjustmentDirection}
              onChange={(event) => setForm({ ...form, adjustmentDirection: event.target.value })}
            >
              <option value="increase">Increase</option>
              <option value="decrease">Decrease</option>
            </select>
          </div>
        )}
        <div className="im-form-row">
          <label htmlFor="movement-reason">Reason</label>
          <select
            id="movement-reason"
            value={form.reason}
            onChange={(event) => setForm({ ...form, reason: event.target.value })}
          >
            <option value="manual_adjustment">Manual adjustment</option>
            <option value="damage">Damage</option>
            <option value="expiry">Expiry</option>
            <option value="return">Customer return</option>
            <option value="correction">Count correction</option>
          </select>
        </div>
      </div>
    </Modal>
  );
};

const LowStockTab = () => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await getLowStockAlerts();
      setRows(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(errorText(err, "Unable to load low-stock alerts."));
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
      <LoadState loading={loading} error={error} onRetry={refresh} />
      {!loading &&
        !error &&
        (rows.length === 0 ? (
          <div className="im-empty im-empty-ok">
            All products are above their reorder thresholds.
          </div>
        ) : (
          <div className="im-table-scroll">
            <table className="im-table">
              <thead>
                <tr>
                  <th>Severity</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th className="im-num">Stock</th>
                  <th className="im-num">Reorder at</th>
                  <th className="im-num">Short by</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const severity = row.severity || lowStockSeverity(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <span className={`im-pill im-pill-${severity}`}>{severity}</span>
                      </td>
                      <td>{row.name}</td>
                      <td>{row.category || "—"}</td>
                      <td className="im-num">{row.stock}</td>
                      <td className="im-num">{row.lowStock ?? row.lowStockLimit}</td>
                      <td className="im-num im-negative">{row.deficit}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
    </div>
  );
};

const InventoryModule = () => {
  const navigate = useNavigate();
  const { activeStore } = useUi();
  const storeType = activeStore?.storeType || getUser()?.storeType || "";
  const visibleTabKeys = getVisibleInventoryTabKeys(storeType);
  const isServiceStore = isServiceStoreType(storeType);
  const [storedActive, setStoredActive] = useState(() => {
    try {
      return localStorage.getItem("inventory.module.active") || "alerts";
    } catch {
      return "alerts";
    }
  });
  const active = sanitizeInventoryTab(storedActive, storeType);

  useEffect(() => {
    if (active !== storedActive) setStoredActive(active);
    try {
      localStorage.setItem("inventory.module.active", active);
    } catch {
      /* private mode */
    }
  }, [active, storedActive, storeType]);

  return (
    <div className="im-page">
      <header className="im-header">
        <button type="button" className="im-back-btn" onClick={() => navigate(-1)}>
          <FaArrowLeft /> Back
        </button>
        <div>
          <h1>Inventory &amp; Purchase Orders</h1>
          <p className="im-subtitle">
            {isServiceStore
              ? "Suppliers · service purchase orders"
              : "Suppliers · purchase orders · stock movements · low-stock alerts"}
          </p>
        </div>
      </header>
      <nav className="im-tabs" role="tablist" aria-label="Inventory sections">
        {TABS.filter((tab) => visibleTabKeys.includes(tab.key)).map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={active === tab.key}
            className={`im-tab ${active === tab.key ? "im-tab-active" : ""}`}
            onClick={() => setStoredActive(sanitizeInventoryTab(tab.key, storeType))}
          >
            {tab.icon} <span>{tab.label}</span>
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
