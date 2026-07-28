import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/layout/Layout";
import {
  FaBoxes,
  FaPlus,
  FaTrash,
  FaEdit,
  FaSearch,
  FaSave,
  FaTimes,
  FaArrowDown,
  FaArrowUp,
  FaRupeeSign,
  FaExclamationTriangle,
  FaCheckCircle,
  FaHistory,
  FaUserTie,
} from "react-icons/fa";
import { addProduct, deleteProduct, getProducts, updateProduct } from "../services/productService";
import { useUi } from "../context/UiContext";
import {
  LAUNDRY_CONSUMABLES_CATALOG,
  LAUNDRY_CONSUMABLES_CATEGORY,
  LAUNDRY_CONSUMABLES_UNITS,
  formatQty,
  getStockLedger,
  isLaundryConsumable,
  logStockMovement,
  stockStatus,
} from "../components/laundry/laundryConsumables";
import "./LaundryInventoryPage.css";

const emptyForm = {
  name: "",
  unit: "ml",
  stockQty: "",
  lowStockThreshold: "",
  costPerUnit: "",
  gst: "18",
  hsn: "",
  barcode: "",
  supplierName: "",
  supplierPhone: "",
};

const generateBarcode = (name) => {
  const slug = String(name || "ITEM")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 18);
  return `LD-CONS-${slug || Date.now()}`;
};

const dispatchRefresh = () => {
  window.dispatchEvent(new CustomEvent("productsUpdated"));
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "products" }));
  window.dispatchEvent(new CustomEvent("laundry_stock_updated"));
};

const filterLabels = {
  ALL: { key: "ALL", label: "All" },
  LOW: { key: "LOW", label: "Low stock" },
  OUT: { key: "OUT", label: "Out of stock" },
};

const LaundryInventoryPage = () => {
  const { activeStore, showToast } = useUi();
  const [consumables, setConsumables] = useState([]);
  const [movements, setMovements] = useState(() => getStockLedger());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedAttempted, setSeedAttempted] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [adjustItem, setAdjustItem] = useState(null);
  const [adjustDelta, setAdjustDelta] = useState("");

  const loadConsumables = async () => {
    setLoading(true);
    try {
      const data = await getProducts();
      const list = Array.isArray(data) ? data.filter(isLaundryConsumable) : [];
      setConsumables(list);
    } catch (err) {
      console.error("Failed to load laundry consumables:", err);
      setConsumables([]);
    } finally {
      setLoading(false);
    }
  };

  // Seed the default consumables on first load.
  useEffect(() => {
    if (loading || seeding || seedAttempted) return;
    if (consumables.length > 0) return;
    setSeeding(true);
    setSeedAttempted(true);
    (async () => {
      try {
        const existing = await getProducts();
        const existingNames = new Set(
          (Array.isArray(existing) ? existing : []).map((p) =>
            String(p.name || "")
              .trim()
              .toLowerCase()
          )
        );
        const missing = LAUNDRY_CONSUMABLES_CATALOG.filter(
          (item) => !existingNames.has(String(item.name).trim().toLowerCase())
        );
        for (const item of missing) {
          try {
            await addProduct(item);
          } catch (err) {
            console.warn("Failed to seed consumable", item.name, err);
          }
        }
        await loadConsumables();
        dispatchRefresh();
      } finally {
        setSeeding(false);
      }
    })();
  }, [loading, consumables.length, seedAttempted]);

  useEffect(() => {
    loadConsumables();
    const onStock = () => {
      loadConsumables();
      setMovements(getStockLedger());
    };
    const onLedger = () => setMovements(getStockLedger());
    const onProducts = () => loadConsumables();

    window.addEventListener("laundry_stock_updated", onStock);
    window.addEventListener("laundry_inventory_ledger_updated", onLedger);
    window.addEventListener("productsUpdated", onProducts);
    window.addEventListener("dataUpdated", onProducts);

    return () => {
      window.removeEventListener("laundry_stock_updated", onStock);
      window.removeEventListener("laundry_inventory_ledger_updated", onLedger);
      window.removeEventListener("productsUpdated", onProducts);
      window.removeEventListener("dataUpdated", onProducts);
    };
  }, [activeStore]);

  const stats = useMemo(() => {
    const total = consumables.length;
    let totalValue = 0;
    let low = 0;
    let out = 0;
    consumables.forEach((item) => {
      const qty = Number(item.stockQty) || 0;
      const cost = Number(item.costPerUnit) || 0;
      totalValue += qty * cost;
      const s = stockStatus(item);
      if (s.key === "low") low += 1;
      if (s.key === "out") out += 1;
    });
    return { total, totalValue, low, out };
  }, [consumables]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return consumables.filter((item) => {
      const status = stockStatus(item);
      if (filter === "LOW" && status.key !== "low") return false;
      if (filter === "OUT" && status.key !== "out") return false;
      if (!q) return true;
      const haystack = [item.name, item.barcode, item.hsn, item?.supplier?.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [consumables, search, filter]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setForm({
      name: item.name || "",
      unit: item.unit || "ml",
      stockQty: item.stockQty ?? "",
      lowStockThreshold: item.lowStockThreshold ?? "",
      costPerUnit: item.costPerUnit ?? "",
      gst: item.gst ?? "18",
      hsn: item.hsn || "",
      barcode: item.barcode || "",
      supplierName: item?.supplier?.name || "",
      supplierPhone: item?.supplier?.phone || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (saving) return;
    if (!form.name.trim()) {
      showToast("error", "Name is required.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      unit: form.unit,
      stockQty: Number(form.stockQty) || 0,
      lowStockThreshold: Number(form.lowStockThreshold) || 0,
      costPerUnit: Number(form.costPerUnit) || 0,
      gst: Number(form.gst) || 0,
      hsn: form.hsn || "",
      barcode: form.barcode || generateBarcode(form.name),
      category: LAUNDRY_CONSUMABLES_CATEGORY,
      supplier: {
        name: form.supplierName || "Local Wholesale",
        phone: form.supplierPhone || "",
      },
    };
    setSaving(true);
    try {
      if (editingId) {
        await updateProduct({ id: editingId, ...payload });
        showToast("success", `${payload.name} updated.`);
      } else {
        await addProduct(payload);
        showToast("success", `${payload.name} added to inventory.`);
      }
      resetForm();
      dispatchRefresh();
      await loadConsumables();
    } catch (err) {
      console.error("Failed to save consumable:", err);
      const reason =
        err && err.message ? err.message : "Unable to save consumable. Please try again.";
      showToast("error", `Unable to save consumable: ${reason}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.name}" from inventory?`)) return;
    try {
      await deleteProduct(item.id);
      showToast("success", `${item.name} removed.`);
      dispatchRefresh();
      await loadConsumables();
    } catch (err) {
      console.error("Failed to delete consumable:", err);
      showToast("error", "Unable to delete consumable. Please try again.");
    }
  };

  const applyDelta = async (item, delta) => {
    const num = Number(delta);
    if (!Number.isFinite(num) || num === 0) {
      showToast("error", "Enter a non-zero number.");
      return;
    }
    const newQty = Math.max(0, (Number(item.stockQty) || 0) + num);
    try {
      await updateProduct({ id: item.id, stockQty: newQty });
      logStockMovement(item.name, num, num > 0 ? "Manual restock" : "Manual adjustment");
      const status = stockStatus({ ...item, stockQty: newQty });
      if (status.key === "low" || status.key === "out") {
        showToast(
          "warning",
          `${item.name} ${status.label.toLowerCase()}: ${formatQty(newQty, item.unit)} remaining.`
        );
      } else {
        showToast("success", `${item.name} updated to ${formatQty(newQty, item.unit)}.`);
      }
      dispatchRefresh();
      await loadConsumables();
      setAdjustItem(null);
      setAdjustDelta("");
    } catch (err) {
      console.error("Failed to adjust stock:", err);
      showToast("error", "Unable to adjust stock. Please try again.");
    }
  };

  const formatDateTime = (iso) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (_) {
      return iso;
    }
  };

  return (
    <Layout>
      <div className="laundry-inventory-page">
        {/* HERO */}
        <section className="laundry-inventory-hero">
          <div className="laundry-inventory-hero-bg" aria-hidden="true" />
          <div className="laundry-inventory-hero-content">
            <div>
              <span className="laundry-inventory-eyebrow">Laundry inventory</span>
              <h3>Consumables &amp; Stock</h3>
              <p>
                Track detergent, packaging, and other supplies. Stock is auto-deducted at billing
                time based on the services in each bill.
              </p>
            </div>
            <div className="laundry-inventory-hero-actions">
              <span className="laundry-inventory-hero-stat">
                <strong>{stats.total}</strong>
                <span>items tracked</span>
              </span>
            </div>
          </div>
        </section>

        {/* STAT TILES (reuse InventoryDashboard vocabulary) */}
        <section className="inventory-cards laundry-inventory-stats">
          <div className="inv-card info">
            <div className="inv-number">{stats.total}</div>
            <div className="inv-label">Total items</div>
          </div>
          <div className="inv-card success">
            <div className="inv-number">
              <FaRupeeSign style={{ fontSize: 22, verticalAlign: "middle" }} />
              {Math.round(stats.totalValue).toLocaleString("en-IN")}
            </div>
            <div className="inv-label">Stock value</div>
          </div>
          <div className="inv-card warning">
            <div className="inv-number">{stats.low}</div>
            <div className="inv-label">Low stock</div>
          </div>
          <div className="inv-card danger">
            <div className="inv-number">{stats.out}</div>
            <div className="inv-label">Out of stock</div>
          </div>
        </section>

        {/* FORM CARD */}
        <form className="laundry-inventory-form" onSubmit={handleSave}>
          <div className="laundry-inventory-form-head">
            <h4>{editingId ? "Edit consumable" : "Add consumable"}</h4>
            {editingId && (
              <button type="button" className="laundry-inventory-light" onClick={resetForm}>
                <FaTimes /> Cancel edit
              </button>
            )}
          </div>
          <div className="laundry-inventory-grid">
            <label>
              Item Name
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="e.g. Detergent Liquid"
              />
            </label>
            <label>
              Unit
              <select name="unit" value={form.unit} onChange={handleChange}>
                {LAUNDRY_CONSUMABLES_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              On-hand Quantity
              <input
                name="stockQty"
                type="number"
                min="0"
                value={form.stockQty}
                onChange={handleChange}
                placeholder="5000"
              />
            </label>
            <label>
              Low-stock Alert at
              <input
                name="lowStockThreshold"
                type="number"
                min="0"
                value={form.lowStockThreshold}
                onChange={handleChange}
                placeholder="2000"
              />
            </label>
            <label>
              Cost per Unit (₹)
              <input
                name="costPerUnit"
                type="number"
                min="0"
                step="0.01"
                value={form.costPerUnit}
                onChange={handleChange}
                placeholder="0.20"
              />
            </label>
            <label>
              GST %
              <input
                name="gst"
                type="number"
                min="0"
                value={form.gst}
                onChange={handleChange}
                placeholder="18"
              />
            </label>
            <label>
              HSN / SAC
              <input name="hsn" value={form.hsn} onChange={handleChange} placeholder="Optional" />
            </label>
            <label>
              Barcode
              <input
                name="barcode"
                value={form.barcode}
                onChange={handleChange}
                placeholder="Auto-generated if empty"
              />
            </label>
            <label>
              Supplier Name
              <input
                name="supplierName"
                value={form.supplierName}
                onChange={handleChange}
                placeholder="Local Wholesale"
              />
            </label>
            <label>
              Supplier Phone
              <input
                name="supplierPhone"
                value={form.supplierPhone}
                onChange={handleChange}
                placeholder="Optional"
              />
            </label>
          </div>
          <button type="submit" className="laundry-inventory-primary" disabled={saving}>
            {saving ? (
              <>Saving…</>
            ) : editingId ? (
              <>
                <FaSave /> Update consumable
              </>
            ) : (
              <>
                <FaPlus /> Add consumable
              </>
            )}
          </button>
        </form>

        {/* TOOLBAR */}
        <section className="laundry-inventory-list">
          <div className="laundry-inventory-toolbar">
            <div className="laundry-inventory-search">
              <FaSearch />
              <input
                type="text"
                placeholder="Search by name, barcode, or supplier…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="laundry-inventory-chips">
              {Object.values(filterLabels).map((f) => (
                <button
                  key={f.key}
                  type="button"
                  className={`laundry-inventory-chip ${filter === f.key ? "active" : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* TABLE */}
          <div className="laundry-inventory-table-wrap">
            <table className="laundry-inventory-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>On hand</th>
                  <th>Threshold</th>
                  <th>Status</th>
                  <th>Cost / unit</th>
                  <th>Value</th>
                  <th>Supplier</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="8" className="laundry-inventory-empty">
                      Loading inventory…
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan="8" className="laundry-inventory-empty">
                      {consumables.length === 0
                        ? "No consumables yet — adding defaults…"
                        : "No consumables match your filters."}
                    </td>
                  </tr>
                ) : (
                  filtered.map((item) => {
                    const status = stockStatus(item);
                    const value = (Number(item.stockQty) || 0) * (Number(item.costPerUnit) || 0);
                    return (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                          <small>
                            {item.unit}
                            {item.barcode ? ` · ${item.barcode}` : ""}
                          </small>
                        </td>
                        <td>{formatQty(item.stockQty, item.unit)}</td>
                        <td>{formatQty(item.lowStockThreshold, item.unit)}</td>
                        <td>
                          <span
                            className={`status-badge ${status.key === "out" ? "critical" : status.key}`}
                          >
                            {status.key === "out" ? <FaExclamationTriangle /> : <FaCheckCircle />}
                            {status.label}
                          </span>
                        </td>
                        <td>₹{Number(item.costPerUnit || 0).toFixed(2)}</td>
                        <td>₹{value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</td>
                        <td className="laundry-inventory-supplier">
                          <FaUserTie />
                          <div>
                            <strong>{item?.supplier?.name || "—"}</strong>
                            {item?.supplier?.phone && <small>{item.supplier.phone}</small>}
                          </div>
                        </td>
                        <td>
                          <div className="laundry-inventory-actions">
                            <button
                              type="button"
                              className="laundry-inventory-icon-btn"
                              onClick={() => handleEdit(item)}
                              aria-label="Edit"
                              title="Edit"
                            >
                              <FaEdit />
                            </button>
                            <button
                              type="button"
                              className="laundry-inventory-icon-btn"
                              onClick={() => {
                                setAdjustItem(item);
                                setAdjustDelta("");
                              }}
                              aria-label="Adjust stock"
                              title="Adjust stock"
                            >
                              <FaArrowUp />
                            </button>
                            <button
                              type="button"
                              className="laundry-inventory-icon-btn danger"
                              onClick={() => handleDelete(item)}
                              aria-label="Delete"
                              title="Delete"
                            >
                              <FaTrash />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* MOVEMENTS LOG */}
        <section className="laundry-inventory-movements">
          <header className="laundry-inventory-movements-head">
            <FaHistory />
            <div>
              <h4>Recent stock movements</h4>
              <p>Last {Math.min(movements.length, 20)} changes (in-memory log)</p>
            </div>
          </header>
          {movements.length === 0 ? (
            <p className="laundry-inventory-movements-empty">
              No movements yet — stock will be logged here automatically when bills are generated or
              when you adjust quantities manually.
            </p>
          ) : (
            <ul className="laundry-inventory-movements-list">
              {movements.slice(0, 20).map((m) => (
                <li key={m.id}>
                  <span className={`movement-delta ${m.delta > 0 ? "pos" : "neg"}`}>
                    {m.delta > 0 ? <FaArrowUp /> : <FaArrowDown />}
                    {m.delta > 0 ? "+" : ""}
                    {formatQty(Math.abs(m.delta), "")}
                  </span>
                  <div className="movement-meta">
                    <strong>{m.name}</strong>
                    <small>
                      {m.source} · {formatDateTime(m.at)}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ADJUST MODAL */}
        {adjustItem && (
          <div className="laundry-inventory-adjust-overlay" onClick={() => setAdjustItem(null)}>
            <div className="laundry-inventory-adjust-modal" onClick={(e) => e.stopPropagation()}>
              <h4>Adjust {adjustItem.name}</h4>
              <p>
                Current stock: <strong>{formatQty(adjustItem.stockQty, adjustItem.unit)}</strong>
              </p>
              <p className="laundry-inventory-adjust-hint">
                Enter a positive number to add stock (e.g. restock from supplier) or a negative
                number to remove (e.g. damaged / written off).
              </p>
              <input
                type="number"
                className="laundry-inventory-adjust-input"
                placeholder="e.g. +500 or -50"
                value={adjustDelta}
                onChange={(e) => setAdjustDelta(e.target.value)}
                autoFocus
              />
              <div className="laundry-inventory-adjust-actions">
                <button
                  type="button"
                  className="laundry-inventory-light"
                  onClick={() => setAdjustItem(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="laundry-inventory-primary"
                  onClick={() => applyDelta(adjustItem, adjustDelta)}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default LaundryInventoryPage;
