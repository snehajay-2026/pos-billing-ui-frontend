import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/layout/Layout";
import { getProducts, addProduct, updateProduct, deleteProduct } from "../services/productService";
import { useUi } from "../context/UiContext";
import {
  HOTEL_MENU_DEFAULT_CATALOG,
  normalizeMenuName,
} from "../components/hotel/hotelMenuDefaults";
import {
  resolveHotelMenuCategories,
  DEFAULT_HOTEL_MENU_CATEGORIES,
} from "../components/hotel/hotelMenuCategories";
import { createMenuBarcode } from "../components/hotel/hotelMenuBarcode";
import MenuBulkImportModal from "../components/hotel/MenuBulkImportModal";
import { FaCloudUploadAlt } from "react-icons/fa";
import "./HotelDiningPage.css";

const isLowStockItem = (item) => {
  const stock = Number(item?.stock || 0);
  const limit = Number(item?.lowStockLimit || item?.limit || 0);
  return limit > 0 && stock <= limit;
};

const SPICE_LEVELS = [
  { value: "mild", label: "Mild", color: "#94a3b8" },
  { value: "medium", label: "Medium", color: "#f97316" },
  { value: "hot", label: "Hot", color: "#dc2626" },
];

const SPICE_BY_VALUE = SPICE_LEVELS.reduce((acc, level) => {
  acc[level.value] = level;
  return acc;
}, {});

const emptyForm = () => ({
  name: "",
  price: "",
  gst: "5",
  stock: "999",
  lowStockLimit: "",
  category: "",
  description: "",
  available: true,
  halfPrice: "",
  fullPrice: "",
  hsn: "",
  isVeg: true,
  isJain: false,
  spiceLevel: "mild",
});

const HotelDiningPage = () => {
  const { activeStore, showToast } = useUi();
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(null); // null | { id, ... } for editing; "new" for fresh add
  const [form, setForm] = useState(emptyForm());
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const [dietFilter, setDietFilter] = useState("all"); // all | veg | nonveg | jain
  const [spiceFilter, setSpiceFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name-asc");
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const filterBarRef = useRef(null);

  // Read categories live from storeSettings so adding/removing a category
  // reflects in both this page and HotelBilling POS.
  const diningCategories = useMemo(() => resolveHotelMenuCategories(), [activeStore]);

  useEffect(() => {
    const loadProducts = async () => {
      setLoading(true);
      try {
        const items = await getProducts();
        setProducts(Array.isArray(items) ? items : []);
      } catch (err) {
        console.error("Failed to load dining products:", err);
        showToast("error", "Failed to load menu. Please try again.");
        setProducts([]);
      } finally {
        setLoading(false);
      }
    };
    loadProducts();
  }, [activeStore, showToast]);

  const diningProducts = useMemo(
    () => products.filter((p) => diningCategories.includes(p.category)),
    [products, diningCategories]
  );

  const filteredProducts = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    let list = diningProducts.filter((item) => {
      const matchesSearch =
        !q ||
        String(item.name || "")
          .toLowerCase()
          .includes(q) ||
        String(item.description || "")
          .toLowerCase()
          .includes(q) ||
        String(item.hsn || "")
          .toLowerCase()
          .includes(q);
      const matchesCategory = !categoryFilter || item.category === categoryFilter;
      const matchesAvailability =
        availabilityFilter === "all" ||
        (availabilityFilter === "available" && item.available !== false) ||
        (availabilityFilter === "unavailable" && item.available === false);
      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "low" && isLowStockItem(item)) ||
        (stockFilter === "out" && Number(item.stock || 0) <= 0);
      const matchesDiet =
        dietFilter === "all" ||
        (dietFilter === "veg" && (item.isVeg === true || item.isVeg === undefined)) ||
        (dietFilter === "nonveg" && item.isVeg === false) ||
        (dietFilter === "jain" && item.isJain === true);
      const matchesSpice = spiceFilter === "all" || item.spiceLevel === spiceFilter;
      return (
        matchesSearch &&
        matchesCategory &&
        matchesAvailability &&
        matchesStock &&
        matchesDiet &&
        matchesSpice
      );
    });

    list = list.slice().sort((a, b) => {
      switch (sortBy) {
        case "name-desc":
          return String(b.name || "").localeCompare(String(a.name || ""));
        case "price-asc":
          return Number(a.price || 0) - Number(b.price || 0);
        case "price-desc":
          return Number(b.price || 0) - Number(a.price || 0);
        case "stock-asc":
          return Number(a.stock || 0) - Number(b.stock || 0);
        case "category":
          return (
            String(a.category || "").localeCompare(String(b.category || "")) ||
            String(a.name || "").localeCompare(String(b.name || ""))
          );
        case "name-asc":
        default:
          return String(a.name || "").localeCompare(String(b.name || ""));
      }
    });
    return list;
  }, [
    diningProducts,
    searchTerm,
    categoryFilter,
    stockFilter,
    availabilityFilter,
    dietFilter,
    spiceFilter,
    sortBy,
  ]);

  const stats = useMemo(() => {
    const total = diningProducts.length;
    const lowStock = diningProducts.filter((item) => isLowStockItem(item)).length;
    const outOfStock = diningProducts.filter((item) => Number(item.stock || 0) <= 0).length;
    const unavailable = diningProducts.filter((item) => item.available === false).length;
    const vegCount = diningProducts.filter((item) => item.isVeg !== false).length;
    return { total, lowStock, outOfStock, unavailable, vegCount };
  }, [diningProducts]);

  const openAddItemModal = () => {
    setForm({ ...emptyForm(), category: diningCategories[0] || "" });
    setEditing("new");
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditing(null);
    setForm(emptyForm());
  };

  const editProduct = (product) => {
    setEditing({ id: product.id });
    setForm({
      name: product.name || "",
      price: product.price ?? "",
      gst: product.gst ?? "5",
      stock: product.stock ?? "999",
      lowStockLimit: product.lowStockLimit ?? product.limit ?? "",
      category: product.category || diningCategories[0] || "",
      description: product.description || "",
      available: product.available !== false,
      halfPrice: product.halfPrice ?? "",
      fullPrice: product.fullPrice ?? "",
      hsn: product.hsn || "",
      isVeg: product.isVeg !== false,
      isJain: product.isJain === true,
      spiceLevel: product.spiceLevel || "mild",
    });
    setModalOpen(true);
  };

  const cloneProduct = (product) => {
    setEditing("new");
    setForm({
      ...emptyForm(),
      name: `${product.name} (copy)`,
      price: product.price ?? "",
      gst: product.gst ?? "5",
      stock: "999",
      lowStockLimit: product.lowStockLimit ?? product.limit ?? "",
      category: product.category || diningCategories[0] || "",
      description: product.description || "",
      available: product.available !== false,
      halfPrice: product.halfPrice ?? "",
      fullPrice: product.fullPrice ?? "",
      hsn: product.hsn || "",
      isVeg: product.isVeg !== false,
      isJain: product.isJain === true,
      spiceLevel: product.spiceLevel || "mild",
    });
    setModalOpen(true);
    showToast("info", "Cloning — edit the name and save.");
  };

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    if (
      ["price", "gst", "stock", "lowStockLimit", "halfPrice", "fullPrice"].includes(name) &&
      type === "number" &&
      Number(value) < 0
    ) {
      return;
    }
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const saveProduct = async ({ asNew = false } = {}) => {
    if (!form.name.trim() || form.price === "" || form.gst === "" || !form.category) {
      showToast("error", "Please fill all required fields.");
      return;
    }
    const payload = {
      name: form.name.trim(),
      price: Number(form.price) || 0,
      gst: Number(form.gst) || 0,
      stock: Number(form.stock) || 0,
      lowStockLimit: Number(form.lowStockLimit) || 0,
      category: form.category,
      unit: "unit",
      barcode: createMenuBarcode(),
      description: String(form.description || "").trim(),
      available: Boolean(form.available),
      halfPrice: form.halfPrice === "" ? null : Number(form.halfPrice),
      fullPrice: form.fullPrice === "" ? null : Number(form.fullPrice),
      hsn: String(form.hsn || "").trim(),
      isVeg: Boolean(form.isVeg),
      isJain: Boolean(form.isJain),
      spiceLevel: form.spiceLevel || "mild",
    };

    try {
      const editingExisting =
        editing && editing !== "new" && !asNew ? products.find((p) => p.id === editing.id) : null;
      if (editingExisting) {
        payload.barcode = editingExisting.barcode || payload.barcode;
        const updated = await updateProduct({ ...payload, id: editingExisting.id });
        setProducts((prev) => prev.map((p) => (p.id === editingExisting.id ? updated : p)));
        showToast("success", `Updated "${payload.name}".`);
      } else {
        const created = await addProduct(payload);
        setProducts((prev) => [...prev, created]);
        showToast("success", `Added "${payload.name}".`);
      }
      closeModal();
    } catch (err) {
      console.error("Unable to save dining product:", err);
      showToast("error", "Failed to save dining item. Please try again.");
    }
  };

  const removeProduct = async (id) => {
    if (!window.confirm("Delete this dining item?")) return;
    try {
      await deleteProduct(id);
      setProducts((prev) => prev.filter((p) => p.id !== id));
      showToast("success", "Dining item deleted.");
    } catch (err) {
      console.error("Failed to delete dining item:", err);
      showToast("error", "Unable to delete dining item. Please try again.");
    }
  };

  const seedDefaultItems = async () => {
    const existingNames = new Set(products.map((p) => normalizeMenuName(p.name)));
    const missing = HOTEL_MENU_DEFAULT_CATALOG.filter(
      (item) => !existingNames.has(normalizeMenuName(item.name))
    );

    if (missing.length === 0) {
      showToast("info", "Suggested items are already on your menu.");
      return;
    }

    try {
      const created = await Promise.all(
        missing.map((item) =>
          addProduct({
            ...item,
            // Suggested items inherit a healthy default stock + limit so they
            // appear in the table booking menu picker (which hides out-of-stock
            // items) without forcing every new item to manually set stock.
            stock: Number(item.stock ?? 999),
            lowStockLimit: Number(item.lowStockLimit ?? 0),
            available: item.available !== false,
            unit: item.unit || "unit",
            barcode: createMenuBarcode(),
          })
        )
      );
      setProducts((prev) => [...prev, ...created]);
      showToast("success", `Added ${created.length} suggested item(s).`);
    } catch (err) {
      console.error("Failed to seed default hotel menu", err);
      showToast("error", "Unable to seed default menu. Please try again.");
    }
  };

  return (
    <Layout>
      <div className="hotel-menu-page">
        <header className="hotel-menu-header">
          <div>
            <div className="hotel-menu-eyebrow">Hotel Menu</div>
            <h2>Hotel Dining Menu</h2>
            <p>
              Manage menu items shown in Hotel Billing. Items can have half/full variants, dietary
              tags, and stock limits.
            </p>
          </div>
          <div className="hotel-menu-header-actions">
            <button type="button" className="hotel-menu-btn-secondary" onClick={seedDefaultItems}>
              + Add Suggested Items
            </button>
            <button
              type="button"
              className="hotel-menu-btn-bulk-import"
              onClick={() => setBulkImportOpen(true)}
            >
              <FaCloudUploadAlt aria-hidden="true" /> Bulk Import
            </button>
            <Link to="/hotel-menu/print" className="hotel-menu-btn-primary">
              Print Menu
            </Link>
            <button type="button" className="hotel-menu-btn-primary" onClick={openAddItemModal}>
              + Add Dining Item
            </button>
          </div>
        </header>

        <section className="hotel-menu-stat-tiles">
          <div className="hotel-menu-stat">
            <span>Total Items</span>
            <strong>{stats.total}</strong>
          </div>
          <div className="hotel-menu-stat tone-warm">
            <span>Low Stock</span>
            <strong>{stats.lowStock}</strong>
          </div>
          <div className="hotel-menu-stat tone-danger">
            <span>Out of Stock</span>
            <strong>{stats.outOfStock}</strong>
          </div>
          <div className="hotel-menu-stat tone-muted">
            <span>Unavailable</span>
            <strong>{stats.unavailable}</strong>
          </div>
          <div className="hotel-menu-stat tone-veg">
            <span>Veg</span>
            <strong>{stats.vegCount}</strong>
          </div>
        </section>

        {modalOpen && (
          <div className="hotel-menu-modal-overlay" onClick={closeModal} role="presentation">
            <div
              className="hotel-menu-modal"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="hotel-menu-modal-title"
            >
              <header className="hotel-menu-modal-head">
                <div>
                  <h4 id="hotel-menu-modal-title">
                    {editing && editing !== "new" ? "Edit Dining Item" : "Add Dining Item"}
                  </h4>
                  <p>
                    Set price, stock, and dietary flags. Items appear in Hotel Billing POS as soon
                    as they're saved.
                  </p>
                </div>
                <button
                  type="button"
                  className="hotel-menu-modal-close"
                  onClick={closeModal}
                  aria-label="Close"
                >
                  ×
                </button>
              </header>

              <div className="hotel-menu-modal-body">
                <div className="hotel-menu-grid">
                  <label className="hotel-menu-field full">
                    <span>
                      Item Name <em>*</em>
                    </span>
                    <input
                      name="name"
                      value={form.name}
                      onChange={handleChange}
                      placeholder="Paneer Butter Masala"
                      autoFocus
                    />
                  </label>

                  <label className="hotel-menu-field">
                    <span>
                      Category <em>*</em>
                    </span>
                    <select name="category" value={form.category} onChange={handleChange}>
                      <option value="">Select category</option>
                      {diningCategories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="hotel-menu-field">
                    <span>
                      Price (₹/unit) <em>*</em>
                    </span>
                    <input
                      name="price"
                      type="number"
                      min="0"
                      value={form.price}
                      onChange={handleChange}
                      placeholder="120"
                    />
                  </label>

                  <label className="hotel-menu-field">
                    <span>GST %</span>
                    <input
                      name="gst"
                      type="number"
                      min="0"
                      value={form.gst}
                      onChange={handleChange}
                      placeholder="5"
                    />
                  </label>

                  <label className="hotel-menu-field">
                    <span>Stock</span>
                    <input
                      name="stock"
                      type="number"
                      min="0"
                      value={form.stock}
                      onChange={handleChange}
                      placeholder="100"
                    />
                  </label>

                  <label className="hotel-menu-field">
                    <span>Low Stock Limit</span>
                    <input
                      name="lowStockLimit"
                      type="number"
                      min="0"
                      value={form.lowStockLimit}
                      onChange={handleChange}
                      placeholder="30"
                    />
                  </label>

                  <label className="hotel-menu-field">
                    <span>HSN / SAC</span>
                    <input name="hsn" value={form.hsn} onChange={handleChange} placeholder="9963" />
                  </label>

                  <label className="hotel-menu-field">
                    <span>Spice Level</span>
                    <select name="spiceLevel" value={form.spiceLevel} onChange={handleChange}>
                      {SPICE_LEVELS.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="hotel-menu-field full">
                    <span>Description</span>
                    <textarea
                      name="description"
                      value={form.description}
                      onChange={handleChange}
                      placeholder="Short description visible to guests when this item appears on a printed menu."
                      rows={2}
                    />
                  </label>

                  <div className="hotel-menu-field full hotel-menu-field-toggles">
                    <label className="hotel-menu-toggle">
                      <input
                        type="checkbox"
                        name="isVeg"
                        checked={form.isVeg}
                        onChange={handleChange}
                      />
                      <span>Veg</span>
                    </label>
                    <label className="hotel-menu-toggle">
                      <input
                        type="checkbox"
                        name="isJain"
                        checked={form.isJain}
                        onChange={handleChange}
                      />
                      <span>Jain option available</span>
                    </label>
                    <label className="hotel-menu-toggle">
                      <input
                        type="checkbox"
                        name="available"
                        checked={form.available}
                        onChange={handleChange}
                      />
                      <span>Available in Hotel Billing</span>
                    </label>
                  </div>

                  <label className="hotel-menu-field">
                    <span>Half Price (optional)</span>
                    <input
                      name="halfPrice"
                      type="number"
                      min="0"
                      value={form.halfPrice}
                      onChange={handleChange}
                      placeholder="80"
                    />
                  </label>
                  <label className="hotel-menu-field">
                    <span>Full Price (optional)</span>
                    <input
                      name="fullPrice"
                      type="number"
                      min="0"
                      value={form.fullPrice}
                      onChange={handleChange}
                      placeholder="150"
                    />
                  </label>
                </div>
              </div>

              <footer className="hotel-menu-modal-foot">
                <button type="button" className="hotel-menu-btn-secondary" onClick={closeModal}>
                  Cancel
                </button>
                {editing && editing !== "new" && (
                  <button
                    type="button"
                    className="hotel-menu-btn-secondary"
                    onClick={() => saveProduct({ asNew: true })}
                  >
                    Save as New
                  </button>
                )}
                <button
                  type="button"
                  className="hotel-menu-btn-primary"
                  onClick={() => saveProduct()}
                >
                  {editing && editing !== "new" ? "Update Item" : "Add Item"}
                </button>
              </footer>
            </div>
          </div>
        )}

        <MenuBulkImportModal
          open={bulkImportOpen}
          onClose={() => setBulkImportOpen(false)}
          existingProducts={products}
          diningCategories={diningCategories}
          onImportComplete={(createdItems) => {
            if (Array.isArray(createdItems) && createdItems.length) {
              setProducts((prev) => [...prev, ...createdItems]);
            }
          }}
        />

        <section className="hotel-menu-list-card">
          <div className="hotel-menu-filter-bar" ref={filterBarRef}>
            <input
              className="form-control"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, description, HSN"
            />
            <select
              className="form-control"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              <option value="">All Categories</option>
              {diningCategories.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
            <select
              className="form-control"
              value={dietFilter}
              onChange={(e) => setDietFilter(e.target.value)}
            >
              <option value="all">All diets</option>
              <option value="veg">Veg only</option>
              <option value="nonveg">Non-veg only</option>
              <option value="jain">Jain available</option>
            </select>
            <select
              className="form-control"
              value={spiceFilter}
              onChange={(e) => setSpiceFilter(e.target.value)}
            >
              <option value="all">All spice levels</option>
              {SPICE_LEVELS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              className="form-control"
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
            >
              <option value="all">All stock</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
            </select>
            <select
              className="form-control"
              value={availabilityFilter}
              onChange={(e) => setAvailabilityFilter(e.target.value)}
            >
              <option value="all">All availability</option>
              <option value="available">Available</option>
              <option value="unavailable">Unavailable</option>
            </select>
            <select
              className="form-control"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="name-asc">Sort: Name (A→Z)</option>
              <option value="name-desc">Sort: Name (Z→A)</option>
              <option value="price-asc">Sort: Price (low→high)</option>
              <option value="price-desc">Sort: Price (high→low)</option>
              <option value="stock-asc">Sort: Stock (low→high)</option>
              <option value="category">Sort: Category</option>
            </select>
          </div>

          {loading ? (
            <p className="text-center text-muted" style={{ padding: "32px 0" }}>
              Loading menu…
            </p>
          ) : diningProducts.length === 0 ? (
            <div className="hotel-menu-empty">
              <strong>No menu items yet.</strong>
              <span>
                Click <em>Add Suggested Items</em> to seed a starter catalog, or add items one by
                one.
              </span>
            </div>
          ) : filteredProducts.length === 0 ? (
            <p className="text-center text-muted" style={{ padding: "32px 0" }}>
              No items match the current filters.
            </p>
          ) : (
            <div className="hotel-menu-table-wrap">
              <table className="hotel-menu-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th>Diet</th>
                    <th>Spice</th>
                    <th>Status</th>
                    <th>Variants</th>
                    <th>Price</th>
                    <th>GST</th>
                    <th>HSN</th>
                    <th>Stock</th>
                    <th style={{ width: 220 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((item) => {
                    const stockState =
                      Number(item.stock || 0) <= 0 ? "out" : isLowStockItem(item) ? "low" : "ok";
                    return (
                      <tr key={item.id}>
                        <td>
                          <strong>{item.name}</strong>
                          {item.description && (
                            <div className="hotel-menu-desc">{item.description}</div>
                          )}
                        </td>
                        <td>
                          <span className="hotel-menu-pill">{item.category}</span>
                        </td>
                        <td>
                          <span
                            className={`hotel-menu-diet ${item.isVeg === false ? "nonveg" : item.isJain ? "jain" : "veg"}`}
                          >
                            {item.isVeg === false ? "Non-Veg" : item.isJain ? "Veg · Jain" : "Veg"}
                          </span>
                        </td>
                        <td>
                          {SPICE_BY_VALUE[item.spiceLevel] && (
                            <span
                              className="hotel-menu-spice"
                              style={{ backgroundColor: SPICE_BY_VALUE[item.spiceLevel].color }}
                              title={SPICE_BY_VALUE[item.spiceLevel].label}
                            >
                              {SPICE_BY_VALUE[item.spiceLevel].label}
                            </span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`hotel-menu-status ${item.available === false ? "unavailable" : "available"}`}
                          >
                            {item.available === false ? "Unavailable" : "Available"}
                          </span>
                        </td>
                        <td className="hotel-menu-variants">
                          {item.halfPrice || item.fullPrice ? (
                            <>
                              Half: <strong>Rs {Number(item.halfPrice || 0)}</strong> · Full:{" "}
                              <strong>Rs {Number(item.fullPrice || item.price || 0)}</strong>
                            </>
                          ) : (
                            <span className="text-muted">Regular</span>
                          )}
                        </td>
                        <td>Rs {Number(item.price || 0).toFixed(2)}</td>
                        <td>{Number(item.gst || 0)}%</td>
                        <td>{item.hsn || <span className="text-muted">—</span>}</td>
                        <td>
                          <span className={`hotel-menu-stock ${stockState}`}>
                            {Number(item.stock || 0)}
                          </span>
                          {item.lowStockLimit > 0 && (
                            <div className="hotel-menu-stock-limit">≤ {item.lowStockLimit}</div>
                          )}
                        </td>
                        <td>
                          <div className="hotel-menu-actions">
                            <button
                              type="button"
                              className="hotel-menu-action-primary"
                              onClick={() => editProduct(item)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="hotel-menu-action-secondary"
                              onClick={() => cloneProduct(item)}
                              title="Clone as a new item"
                            >
                              Clone
                            </button>
                            <button
                              type="button"
                              className="hotel-menu-action-danger"
                              onClick={() => removeProduct(item.id)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {diningCategories.length === 0 && (
          <p className="text-muted" style={{ marginTop: 12 }}>
            Tip: configure menu categories in{" "}
            <Link to="/settings">Settings → Hotel Operations</Link>. Defaults:{" "}
            {DEFAULT_HOTEL_MENU_CATEGORIES.join(", ")}.
          </p>
        )}
      </div>
    </Layout>
  );
};

export default HotelDiningPage;
