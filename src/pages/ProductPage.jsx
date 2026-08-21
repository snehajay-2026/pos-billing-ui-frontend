import React, { useEffect, useMemo, useRef, useState } from "react";
import Layout from "../components/layout/Layout";
import { getStoreSettings } from "../services/storeSettingsService";
import {
  getProducts,
  addProduct,
  updateProduct,
  deleteProduct,
  uploadProductImage,
  deleteProductImage,
} from "../services/productService";
import { useUi } from "../context/UiContext";
import {
  FaBoxOpen,
  FaPlus,
  FaSearch,
  FaTimes,
  FaPen,
  FaTrashAlt,
  FaBarcode,
  FaTags,
  FaRupeeSign,
  FaPercent,
  FaBoxes,
  FaExclamationTriangle,
  FaCheckCircle,
  FaDollarSign,
  FaLayerGroup,
  FaThLarge,
  FaListUl,
  FaBoxes as FaBoxesSolid,
  FaCamera,
  FaImage,
} from "react-icons/fa";
import "./ProductPage.css";

const LOW_STOCK_THRESHOLD = 10;

// Mirror of server-side validation in server/lib/product-images.js so
// the UI rejects bad files before the round-trip. Keep in sync.
const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

const EMPTY_FORM = {
  name: "",
  price: "",
  gst: "",
  barcode: "",
  stock: "",
  category: "",
  hsn: "",
};

const fmtINR = (num) =>
  `₹${Number(num || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const ProductPage = () => {
  const settings = getStoreSettings();
  const [products, setProducts] = useState([]);
  const [editing, setEditing] = useState(null);

  const { activeStore, showToast } = useUi();
  const businessType = activeStore?.storeType || settings.businessType || "retail";
  const isRetail = businessType === "retail";

  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState({});
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [view, setView] = useState("grid"); // "grid" | "list"

  // Upload Picture state — separate from `form` because the file is a
  // binary blob and a server-issued URL we don't want to resubmit on
  // every keystroke. We track:
  //   imageFile        — user-selected File (yet to upload)
  //   imagePreviewUrl  — objectURL of the local file, for preview
  //   imageUrl         — server-side URL (existing image on Edit)
  //   imageMarkedClear — true when the user clicked "Remove" and we
  //                      need to send `removeImage: true` on save
  const [imageFile, setImageFile] = useState(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [imageMarkedClear, setImageMarkedClear] = useState(false);
  const [imageError, setImageError] = useState("");
  const fileInputRef = useRef(null);

  const getCategories = () => {
    switch (businessType) {
      case "laundry":
        return ["Washing", "Dry Cleaning", "Ironing"];
      case "service":
        return ["Consulting", "Repair", "Installation", "Maintenance"];
      default: // retail
        return ["Groceries", "Beverages", "Household", "Personal Care"];
    }
  };

  const getUnitForCategory = (category) => {
    if (!isRetail) return "kg";
    if (!category) return "";
    return category === "Groceries" ? "kg" : "unit";
  };

  const currentUnit = getUnitForCategory(form.category);

  /* Load products */
  useEffect(() => {
    let cancelled = false;
    const loadProducts = async () => {
      setLoading(true);
      try {
        const items = await getProducts();
        if (!cancelled) setProducts(Array.isArray(items) ? items : []);
      } catch (err) {
        console.error("Failed to load products:", err);
        if (!cancelled) {
          setProducts([]);
          showToast("error", "Could not load products. Please try again.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    loadProducts();
    return () => {
      cancelled = true;
    };
  }, [activeStore, showToast]);

  /* Derived KPIs + filtered list */
  const stats = useMemo(() => {
    const totalProducts = products.length;
    const totalStockUnits = products.reduce((acc, p) => acc + Number(p.stock || 0), 0);
    const totalStockValue = products.reduce(
      (acc, p) => acc + Number(p.price || 0) * Number(p.stock || 0),
      0
    );
    const lowStock = products.filter(
      (p) => Number(p.stock || 0) > 0 && Number(p.stock || 0) <= LOW_STOCK_THRESHOLD
    ).length;
    const outOfStock = products.filter((p) => Number(p.stock || 0) <= 0).length;
    return { totalProducts, totalStockUnits, totalStockValue, lowStock, outOfStock };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return products.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (!term) return true;
      return (
        (p.name || "").toLowerCase().includes(term) ||
        (p.barcode || "").toLowerCase().includes(term) ||
        (p.category || "").toLowerCase().includes(term) ||
        (p.hsn || "").toLowerCase().includes(term)
      );
    });
  }, [products, search, categoryFilter]);

  const handleChange = (e) => {
    const { name, value, type } = e.target;
    if (["price", "gst", "stock"].includes(name) && type === "number" && Number(value) < 0) {
      setForm((f) => ({ ...f, [name]: "" }));
      return;
    }
    setForm((f) => ({ ...f, [name]: value }));
    setErrors((prev) => (prev[name] ? { ...prev, [name]: null } : prev));
  };

  const validate = () => {
    const next = {};
    if (!form.name.trim()) next.name = "Required";
    if (!form.price || Number(form.price) < 0) next.price = "Required";
    if (!form.gst || Number(form.gst) < 0) next.gst = "Required";
    if (!form.stock || Number(form.stock) < 0) next.stock = "Required";
    if (!form.barcode.trim()) next.barcode = "Required";
    if (!form.category) next.category = "Select category";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  // Revoke the previous objectURL to avoid leaking memory. objectURLs
  // are pinned until document.unload or manual revoke.
  const resetImageState = () => {
    if (imagePreviewUrl) {
      try {
        URL.revokeObjectURL(imagePreviewUrl);
      } catch {
        /* ignore */
      }
    }
    setImageFile(null);
    setImagePreviewUrl(null);
    setImageUrl(null);
    setImageMarkedClear(false);
    setImageError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const cancelEdit = () => {
    setForm(EMPTY_FORM);
    setEditing(null);
    setErrors({});
    setShowForm(false);
    resetImageState();
  };

  // Image picker handler. Validates MIME + size before accepting.
  const onPickImage = (e) => {
    const file = e.target.files && e.target.files[0];
    setImageError("");
    if (!file) return;
    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED_IMAGE_MIME.includes(mime)) {
      setImageError("Please choose a JPG, PNG, WebP, or GIF image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(`Image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`);
      return;
    }
    // Replacing an existing local preview: revoke the old objectURL.
    if (imagePreviewUrl) {
      try {
        URL.revokeObjectURL(imagePreviewUrl);
      } catch {
        /* ignore */
      }
    }
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    // If the user was about to clear the image, this means they want
    // to replace it instead — undo the clear.
    setImageMarkedClear(false);
  };

  const onClearImage = () => {
    // If a new file was selected, just drop it. If an existing image
    // was shown, mark it for removal on save.
    if (imageFile) {
      if (imagePreviewUrl) {
        try {
          URL.revokeObjectURL(imagePreviewUrl);
        } catch {
          /* ignore */
        }
      }
      setImageFile(null);
      setImagePreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    if (imageUrl) {
      setImageMarkedClear(true);
    }
  };

  const saveProduct = async () => {
    if (!validate()) {
      showToast("error", "Please fix the highlighted fields.");
      return;
    }
    const exists = products.find((p) => p.barcode === form.barcode && p.id !== editing);
    if (exists) {
      setErrors((e) => ({ ...e, barcode: "Barcode already exists" }));
      showToast("error", "Barcode already exists!");
      return;
    }

    setSaving(true);
    try {
      let saved;
      if (editing) {
        const updated = await updateProduct({
          ...form,
          id: editing,
          price: Number(form.price),
          gst: Number(form.gst),
          stock: Number(form.stock),
          unit: getUnitForCategory(form.category) || "unit",
          // Send the flag only when the user explicitly marked the
          // existing image for removal. Never include new image
          // metadata here — the image is uploaded via a separate
          // multipart endpoint.
          removeImage: imageMarkedClear || undefined,
        });
        saved = updated;
        setProducts((list) => list.map((p) => (p.id === editing ? updated : p)));
        showToast("success", `Updated "${form.name}"`);
      } else {
        const created = await addProduct({
          name: form.name,
          price: Number(form.price),
          gst: Number(form.gst),
          stock: Number(form.stock),
          barcode: form.barcode,
          category: form.category,
          hsn: form.hsn,
          unit: getUnitForCategory(form.category),
        });
        saved = created;
        setProducts((list) => [...list, created]);
        showToast("success", `Added "${form.name}" to catalog`);
      }

      // Image handling — separate from the JSON create/update so the
      // file upload can be retried / fail independently of the row.
      if (imageFile && saved && saved.id) {
        try {
          const withImage = await uploadProductImage(saved.id, imageFile);
          // Replace the row in state with the server's response (which
          // now includes imageUrl).
          setProducts((list) => list.map((p) => (p.id === withImage.id ? withImage : p)));
        } catch (err) {
          console.error("Image upload failed:", err);
          showToast(
            "error",
            err?.message || "Product saved but image upload failed. Try again from Edit."
          );
        }
      }

      cancelEdit();
    } catch (err) {
      console.error("Failed to save product:", err);
      showToast("error", "Unable to save product. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const editProduct = (p) => {
    setEditing(p.id);
    setForm({ ...p, unit: p.unit || getUnitForCategory(p.category) });
    setErrors({});
    setShowForm(true);
    // Reset any previous image state, then load the existing image so
    // the preview box shows the current picture and the user can choose
    // to replace or remove it.
    resetImageState();
    if (p.imageUrl) {
      setImageUrl(p.imageUrl);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const onDelete = async (id) => {
    const product = products.find((p) => p.id === id);
    if (!window.confirm(`Delete "${product?.name || "this product"}"?`)) return;
    try {
      await deleteProduct(id);
      setProducts((list) => list.filter((p) => p.id !== id));
      showToast("success", `Deleted "${product?.name}"`);
    } catch (err) {
      console.error("Failed to delete product:", err);
      showToast("error", "Unable to delete product. Please try again.");
    }
  };

  const stockTone = (stock) => {
    const n = Number(stock || 0);
    if (n <= 0) return { key: "out", label: "Out of stock" };
    if (n <= LOW_STOCK_THRESHOLD) return { key: "low", label: "Low stock" };
    return { key: "ok", label: "In stock" };
  };

  const categoryColor = (cat) => {
    const map = {
      Groceries: "groc",
      Beverages: "bev",
      Household: "house",
      "Personal Care": "pc",
      Washing: "wash",
      "Dry Cleaning": "dry",
      Ironing: "iron",
      Consulting: "cons",
      Repair: "rep",
      Installation: "inst",
      Maintenance: "mnt",
    };
    return map[cat] || "default";
  };

  return (
    <Layout>
      <div className="pr-page">
        {/* Hero */}
        <header className="pr-hero">
          <div className="pr-hero-text">
            <span className="pr-eyebrow">Retail · Products</span>
            <h2 className="pr-hero-title">Product Catalogue</h2>
            <p className="pr-hero-sub">
              Manage stock, prices & GST for your{" "}
              <strong>{isRetail ? "retail store" : businessType}</strong>. Search, filter and update
              your entire inventory in one place.
            </p>
          </div>
          <button
            type="button"
            className="pr-add-btn"
            onClick={() => {
              if (showForm && !editing) {
                cancelEdit();
              } else {
                cancelEdit();
                setShowForm(true);
              }
            }}
          >
            <FaPlus />
            <span>{showForm && !editing ? "Close form" : "Add Product"}</span>
          </button>
        </header>

        {/* KPI Strip */}
        <section className="pr-kpi-grid">
          <article className="pr-kpi pr-kpi-blue">
            <div className="pr-kpi-icon">
              <FaBoxOpen />
            </div>
            <div className="pr-kpi-meta">
              <span>Total Products</span>
              <strong>{stats.totalProducts}</strong>
            </div>
          </article>
          <article className="pr-kpi pr-kpi-violet">
            <div className="pr-kpi-icon">
              <FaBoxesSolid />
            </div>
            <div className="pr-kpi-meta">
              <span>Stock Units</span>
              <strong>{stats.totalStockUnits.toLocaleString("en-IN")}</strong>
            </div>
          </article>
          <article className="pr-kpi pr-kpi-emerald">
            <div className="pr-kpi-icon">
              <FaDollarSign />
            </div>
            <div className="pr-kpi-meta">
              <span>Inventory Value</span>
              <strong>{fmtINR(stats.totalStockValue)}</strong>
            </div>
          </article>
          <article className="pr-kpi pr-kpi-amber">
            <div className="pr-kpi-icon">
              <FaExclamationTriangle />
            </div>
            <div className="pr-kpi-meta">
              <span>Low Stock</span>
              <strong>{stats.lowStock + stats.outOfStock}</strong>
              <small>
                {stats.lowStock} low · {stats.outOfStock} out
              </small>
            </div>
          </article>
        </section>

        {/* Form */}
        {showForm && (
          <section className="pr-form-card">
            <div className="pr-form-head">
              <div>
                <h5>{editing ? "Edit Product" : "Add a new product"}</h5>
                <p>
                  {editing
                    ? "Update the details and save changes."
                    : "Fill in the details to add a product to your catalogue."}
                </p>
              </div>
              <button
                type="button"
                className="pr-icon-btn"
                onClick={cancelEdit}
                aria-label="Close form"
              >
                <FaTimes />
              </button>
            </div>

            <div className="pr-form-grid">
              <div className="pr-field pr-field-image">
                <label>Upload Picture</label>
                <div className="pr-image-uploader">
                  <div className="pr-image-preview">
                    {imagePreviewUrl ? (
                      <img src={imagePreviewUrl} alt="Selected product preview" />
                    ) : imageMarkedClear ? (
                      <span className="pr-image-empty">Will be removed on save</span>
                    ) : imageUrl ? (
                      <img src={imageUrl} alt="Current product image" />
                    ) : (
                      <span className="pr-image-empty">
                        <FaImage />
                        <span>No image yet</span>
                      </span>
                    )}
                  </div>
                  <div className="pr-image-actions">
                    <button
                      type="button"
                      className="pr-btn pr-btn-soft"
                      onClick={() => fileInputRef.current && fileInputRef.current.click()}
                    >
                      <FaCamera />
                      <span>{imageUrl || imagePreviewUrl ? "Replace image" : "Choose image"}</span>
                    </button>
                    {(imageFile || imageUrl) && !imageMarkedClear && (
                      <button type="button" className="pr-btn pr-btn-ghost" onClick={onClearImage}>
                        <FaTimes />
                        <span>{imageFile ? "Cancel selection" : "Remove image"}</span>
                      </button>
                    )}
                    {imageMarkedClear && (
                      <button
                        type="button"
                        className="pr-btn pr-btn-soft"
                        onClick={() => setImageMarkedClear(false)}
                      >
                        <FaCamera />
                        <span>Keep existing image</span>
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                      onChange={onPickImage}
                      style={{ display: "none" }}
                    />
                  </div>
                  {imageError ? (
                    <small className="pr-error-text">{imageError}</small>
                  ) : (
                    <small className="pr-image-hint">JPG, PNG, WebP, or GIF · up to 2 MB</small>
                  )}
                </div>
              </div>

              <div className={`pr-field ${errors.name ? "is-error" : ""}`}>
                <label>Product Name</label>
                <div className="pr-input-wrap">
                  <FaTags className="pr-input-icon" />
                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="e.g. Basmati Rice"
                  />
                </div>
                {errors.name && <small className="pr-error-text">{errors.name}</small>}
              </div>

              <div className={`pr-field ${errors.price ? "is-error" : ""}`}>
                <label>
                  {isRetail
                    ? form.category
                      ? `Rate (₹/${currentUnit})`
                      : "Rate (₹)"
                    : "Price per KG (₹)"}
                </label>
                <div className="pr-input-wrap">
                  <FaRupeeSign className="pr-input-icon" />
                  <input
                    name="price"
                    type="number"
                    min="0"
                    value={form.price}
                    onChange={handleChange}
                    placeholder="50.00"
                  />
                </div>
                {errors.price && <small className="pr-error-text">{errors.price}</small>}
              </div>

              <div className={`pr-field ${errors.gst ? "is-error" : ""}`}>
                <label>GST %</label>
                <div className="pr-input-wrap">
                  <FaPercent className="pr-input-icon" />
                  <input
                    name="gst"
                    type="number"
                    min="0"
                    value={form.gst}
                    onChange={handleChange}
                    placeholder="5"
                  />
                </div>
                {errors.gst && <small className="pr-error-text">{errors.gst}</small>}
              </div>

              <div className={`pr-field ${errors.stock ? "is-error" : ""}`}>
                <label>
                  {isRetail ? (form.category ? `Stock (${currentUnit})` : "Stock") : "Stock (KG)"}
                </label>
                <div className="pr-input-wrap">
                  <FaBoxes className="pr-input-icon" />
                  <input
                    name="stock"
                    type="number"
                    min="0"
                    value={form.stock}
                    onChange={handleChange}
                    placeholder={isRetail ? (form.category ? "100" : "100") : "100 (kg)"}
                  />
                </div>
                {errors.stock && <small className="pr-error-text">{errors.stock}</small>}
              </div>

              <div className={`pr-field ${errors.barcode ? "is-error" : ""}`}>
                <label>Barcode</label>
                <div className="pr-input-wrap">
                  <FaBarcode className="pr-input-icon" />
                  <input
                    name="barcode"
                    value={form.barcode}
                    onChange={handleChange}
                    placeholder="123456789"
                  />
                </div>
                {errors.barcode && <small className="pr-error-text">{errors.barcode}</small>}
              </div>

              <div className={`pr-field ${errors.category ? "is-error" : ""}`}>
                <label>Category</label>
                <div className="pr-input-wrap">
                  <FaLayerGroup className="pr-input-icon" />
                  <select name="category" value={form.category} onChange={handleChange}>
                    <option value="">Select Category</option>
                    {getCategories().map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                {errors.category && <small className="pr-error-text">{errors.category}</small>}
              </div>

              <div className="pr-field">
                <label>HSN/SAC</label>
                <div className="pr-input-wrap">
                  <FaBarcode className="pr-input-icon" />
                  <input
                    name="hsn"
                    value={form.hsn || ""}
                    onChange={handleChange}
                    placeholder="998311"
                  />
                </div>
              </div>
            </div>

            <div className="pr-form-actions">
              <button
                type="button"
                className="pr-btn pr-btn-primary"
                onClick={saveProduct}
                disabled={saving}
              >
                {saving ? <span className="pr-spinner" /> : null}
                {editing ? "Update Product" : "Add Product"}
              </button>
              <button type="button" className="pr-btn pr-btn-ghost" onClick={cancelEdit}>
                Cancel
              </button>
            </div>
          </section>
        )}

        {/* Toolbar */}
        <section className="pr-toolbar">
          <div className="pr-search">
            <FaSearch />
            <input
              type="text"
              placeholder="Search by name, barcode, category or HSN…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="pr-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                <FaTimes />
              </button>
            )}
          </div>

          <div className="pr-filter-chips">
            <button
              type="button"
              className={`pr-chip ${categoryFilter === "all" ? "is-active" : ""}`}
              onClick={() => setCategoryFilter("all")}
            >
              All
            </button>
            {getCategories().map((cat) => (
              <button
                key={cat}
                type="button"
                className={`pr-chip ${categoryFilter === cat ? "is-active" : ""}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="pr-view-toggle" role="tablist" aria-label="View mode">
            <button
              type="button"
              role="tab"
              aria-selected={view === "grid"}
              className={`pr-view-btn ${view === "grid" ? "is-active" : ""}`}
              onClick={() => setView("grid")}
              title="Grid view"
            >
              <FaThLarge />
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "list"}
              className={`pr-view-btn ${view === "list" ? "is-active" : ""}`}
              onClick={() => setView("list")}
              title="List view"
            >
              <FaListUl />
            </button>
          </div>
        </section>

        {/* Product view */}
        <section className="pr-list-wrap">
          {loading ? (
            <div className="pr-skeleton-grid">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="pr-skeleton-card" />
              ))}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="pr-empty">
              <div className="pr-empty-illu">
                <FaBoxOpen />
              </div>
              <h4>{products.length === 0 ? "Your catalogue is empty" : "No matching products"}</h4>
              <p>
                {products.length === 0
                  ? "Add your first product to start tracking inventory & billing."
                  : "Try a different search term or clear filters."}
              </p>
              {products.length === 0 && !showForm && (
                <button
                  type="button"
                  className="pr-btn pr-btn-primary"
                  onClick={() => setShowForm(true)}
                >
                  <FaPlus />
                  <span>Add First Product</span>
                </button>
              )}
            </div>
          ) : view === "grid" ? (
            <div className="pr-grid">
              {filteredProducts.map((p) => {
                const unit = p.unit || getUnitForCategory(p.category) || "";
                const tone = stockTone(p.stock);
                const cat = categoryColor(p.category);
                const stockPct = Math.min(
                  100,
                  Math.max(
                    0,
                    (Number(p.stock || 0) /
                      Math.max(LOW_STOCK_THRESHOLD * 4, Number(p.stock || 0), 1)) *
                      100
                  )
                );
                return (
                  <article key={p.id} className={`pr-card pr-card-${tone.key} pr-cat-${cat}`}>
                    <header className="pr-card-head">
                      <div className="pr-card-title">
                        {p.imageUrl ? (
                          <span className="pr-card-thumb">
                            <img src={p.imageUrl} alt={p.name} loading="lazy" />
                          </span>
                        ) : (
                          <span className={`pr-card-thumb pr-card-thumb-fallback pr-cat-${cat}`}>
                            <FaBoxOpen />
                          </span>
                        )}
                        <span className="pr-card-namewrap">
                          <span className="pr-card-name">{p.name}</span>
                          <span className="pr-card-cat">{p.category || "Uncategorised"}</span>
                        </span>
                      </div>
                      <span className={`pr-stock-pill pr-stock-${tone.key}`}>
                        {tone.key === "out" ? <FaExclamationTriangle /> : <FaCheckCircle />}
                        {tone.label}
                      </span>
                    </header>

                    <div className="pr-card-price">
                      <FaRupeeSign />
                      <strong>{Number(p.price).toLocaleString("en-IN")}</strong>
                      <span>/{unit || "unit"}</span>
                    </div>

                    <ul className="pr-card-meta">
                      <li>
                        <span>GST</span>
                        <strong>{p.gst}%</strong>
                      </li>
                      <li>
                        <span>Stock</span>
                        <strong>
                          {Number(p.stock || 0).toLocaleString("en-IN")} {unit}
                        </strong>
                      </li>
                      <li>
                        <span>Barcode</span>
                        <strong className="pr-mono">{p.barcode || "-"}</strong>
                      </li>
                      <li>
                        <span>HSN/SAC</span>
                        <strong>{p.hsn || "N/A"}</strong>
                      </li>
                    </ul>

                    {tone.key !== "out" && (
                      <div className="pr-progress">
                        <div
                          className={`pr-progress-fill pr-progress-${tone.key}`}
                          style={{ width: `${stockPct}%` }}
                        />
                      </div>
                    )}

                    <footer className="pr-card-actions">
                      <button
                        type="button"
                        className="pr-btn pr-btn-soft"
                        onClick={() => editProduct(p)}
                      >
                        <FaPen />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        className="pr-btn pr-btn-danger-soft"
                        onClick={() => onDelete(p.id)}
                      >
                        <FaTrashAlt />
                        <span>Delete</span>
                      </button>
                    </footer>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="pr-table-wrap">
              <table className="pr-table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Unit</th>
                    <th>Rate</th>
                    <th>GST</th>
                    <th>Stock</th>
                    <th>Status</th>
                    <th>Barcode</th>
                    <th>HSN/SAC</th>
                    <th className="pr-ta-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredProducts.map((p) => {
                    const unit = p.unit || getUnitForCategory(p.category) || "";
                    const tone = stockTone(p.stock);
                    const cat = categoryColor(p.category);
                    return (
                      <tr key={p.id}>
                        <td>
                          <div className="pr-cell-name">
                            {p.imageUrl ? (
                              <span className="pr-cell-thumb">
                                <img src={p.imageUrl} alt={p.name} loading="lazy" />
                              </span>
                            ) : (
                              <span className={`pr-cat-dot pr-cat-dot-${cat}`} />
                            )}
                            <strong>{p.name}</strong>
                          </div>
                        </td>
                        <td>{p.category || "—"}</td>
                        <td>
                          <span className="pr-unit-badge">{unit || "-"}</span>
                        </td>
                        <td>{unit ? `${fmtINR(p.price)}/${unit}` : fmtINR(p.price)}</td>
                        <td>{p.gst}%</td>
                        <td>
                          <strong>
                            {Number(p.stock || 0).toLocaleString("en-IN")} {unit}
                          </strong>
                        </td>
                        <td>
                          <span className={`pr-stock-pill pr-stock-${tone.key}`}>{tone.label}</span>
                        </td>
                        <td className="pr-mono">{p.barcode || "—"}</td>
                        <td>{p.hsn || "—"}</td>
                        <td className="pr-ta-right">
                          <div className="pr-row-actions">
                            <button
                              type="button"
                              className="pr-icon-btn pr-icon-btn-blue"
                              onClick={() => editProduct(p)}
                              title="Edit"
                            >
                              <FaPen />
                            </button>
                            <button
                              type="button"
                              className="pr-icon-btn pr-icon-btn-red"
                              onClick={() => onDelete(p.id)}
                              title="Delete"
                            >
                              <FaTrashAlt />
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
      </div>
    </Layout>
  );
};

export default ProductPage;
