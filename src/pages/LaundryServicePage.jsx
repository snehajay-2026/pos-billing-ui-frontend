import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/layout/Layout";
import { addProduct, deleteProduct, getProducts, updateProduct } from "../services/productService";
import { useUi } from "../context/UiContext";
import {
  LAUNDRY_CATEGORIES,
  LAUNDRY_SERVICE_CATALOG as DEFAULT_LAUNDRY_SERVICES,
  normalizeName,
  isLaundryService,
} from "../components/laundry/laundryServiceCatalog";
import "./LaundryServicePage.css";

const emptyForm = {
  name: "",
  category: "Washing",
  price: "",
  gst: "5",
  stock: "999",
  barcode: "",
  hsn: "",
};

const generateBarcode = (name) => {
  const slug = String(name || "SERVICE")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 18);
  return `LD-${slug || Date.now()}`;
};

const dispatchProductRefresh = () => {
  window.dispatchEvent(new CustomEvent("productsUpdated"));
  window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "products" }));
};

const LaundryServicePage = () => {
  const { activeStore, showToast } = useUi();
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  const loadServices = async () => {
    setLoading(true);
    try {
      const data = await getProducts();
      setProducts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load laundry services:", err);
      showToast("error", "Failed to load services. Please try again.");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadServices();
  }, [activeStore]);

  const laundryServices = useMemo(() => products.filter(isLaundryService), [products]);

  const filteredServices = useMemo(() => {
    const search = searchTerm.trim().toLowerCase();
    return laundryServices.filter((service) => {
      const matchesSearch =
        !search ||
        String(service.name || "")
          .toLowerCase()
          .includes(search) ||
        String(service.barcode || "")
          .toLowerCase()
          .includes(search);
      const matchesCategory = categoryFilter === "All" || service.category === categoryFilter;
      return matchesSearch && matchesCategory;
    });
  }, [categoryFilter, laundryServices, searchTerm]);

  const totalValue = laundryServices.reduce(
    (sum, service) => sum + (Number(service.price) || 0) * (Number(service.stock) || 0),
    0
  );
  const lowStockCount = laundryServices.filter((service) => Number(service.stock) <= 10).length;

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (["price", "gst", "stock"].includes(name) && Number(value) < 0) return;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
  };

  const seedDefaultServices = async () => {
    const existingNames = new Set(products.map((product) => normalizeName(product.name)));
    const missingServices = DEFAULT_LAUNDRY_SERVICES.filter(
      (service) => !existingNames.has(normalizeName(service.name))
    );

    if (missingServices.length === 0) {
      showToast("info", "Laundry billing services are already available.");
      return;
    }

    try {
      const created = await Promise.all(
        missingServices.map((service) => addProduct({ ...service, unit: "service" }))
      );
      setProducts((prev) => [...prev, ...created]);
      dispatchProductRefresh();
      showToast("success", `Added ${created.length} suggested service(s).`);
    } catch (err) {
      console.error("Failed to add default laundry services:", err);
      showToast("error", "Unable to add default laundry services. Please try again.");
    }
  };

  const saveService = async (e) => {
    e.preventDefault();

    const name = form.name.trim();
    if (!name || !form.category || form.price === "" || form.gst === "" || form.stock === "") {
      showToast(
        "error",
        "Service name, category, price, GST, and available quantity are required."
      );
      return;
    }

    const barcode = form.barcode.trim() || generateBarcode(name);
    const duplicate = products.find(
      (product) =>
        String(product.barcode || "")
          .trim()
          .toLowerCase() === barcode.toLowerCase() && String(product.id) !== String(editingId)
    );

    if (duplicate) {
      showToast("error", "Barcode already exists. Please use a unique code.");
      return;
    }

    const payload = {
      ...form,
      name,
      barcode,
      price: Number(form.price),
      gst: Number(form.gst),
      stock: Number(form.stock),
      unit: "service",
    };

    try {
      if (editingId) {
        const updated = await updateProduct({ ...payload, id: editingId });
        setProducts((prev) =>
          prev.map((product) => (String(product.id) === String(editingId) ? updated : product))
        );
        showToast("success", `Service "${name}" updated.`);
      } else {
        const created = await addProduct(payload);
        setProducts((prev) => [...prev, created]);
        showToast("success", `Service "${name}" added.`);
      }

      resetForm();
      dispatchProductRefresh();
    } catch (err) {
      console.error("Failed to save laundry service:", err);
      showToast("error", "Unable to save laundry service. Please try again.");
    }
  };

  const editService = (service) => {
    setEditingId(service.id);
    setForm({
      name: service.name || "",
      category: service.category || "Washing",
      price: service.price ?? "",
      gst: service.gst ?? "5",
      stock: service.stock ?? "999",
      barcode: service.barcode || "",
      hsn: service.hsn || "",
    });
  };

  const removeService = async (service) => {
    if (!window.confirm(`Delete ${service.name}?`)) return;

    try {
      await deleteProduct(service.id);
      setProducts((prev) => prev.filter((product) => String(product.id) !== String(service.id)));
      if (String(editingId) === String(service.id)) resetForm();
      dispatchProductRefresh();
      showToast("success", `Service "${service.name}" deleted.`);
    } catch (err) {
      console.error("Failed to delete laundry service:", err);
      showToast("error", "Unable to delete laundry service. Please try again.");
    }
  };

  return (
    <Layout>
      <div className="laundry-service-page">
        <section className="laundry-service-hero">
          <div>
            <span className="laundry-service-eyebrow">Laundry POS catalog</span>
            <h3>Laundry Billing Items</h3>
            <p>
              Manage washing, dry cleaning, ironing, household, and add-on services. Saved items
              appear in Laundry POS billing automatically.
            </p>
          </div>
          <button type="button" className="laundry-service-primary" onClick={seedDefaultServices}>
            Add Suggested Items
          </button>
        </section>

        <section className="laundry-service-stats">
          <div>
            <span>Total Services</span>
            <strong>{laundryServices.length}</strong>
          </div>
          <div>
            <span>Categories</span>
            <strong>{new Set(laundryServices.map((service) => service.category)).size}</strong>
          </div>
          <div>
            <span>Low Quantity</span>
            <strong>{lowStockCount}</strong>
          </div>
          <div>
            <span>Stock Value</span>
            <strong>Rs {totalValue.toLocaleString("en-IN")}</strong>
          </div>
        </section>

        <form className="laundry-service-form" onSubmit={saveService}>
          <div className="laundry-service-form-head">
            <h4>{editingId ? "Edit Service" : "Add Service"}</h4>
            {editingId && (
              <button type="button" className="laundry-service-light" onClick={resetForm}>
                Cancel Edit
              </button>
            )}
          </div>
          <div className="laundry-service-grid">
            <label>
              Service Name
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="Example: Premium Saree Dry Clean"
              />
            </label>
            <label>
              Category
              <select name="category" value={form.category} onChange={handleChange}>
                {LAUNDRY_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Price
              <input
                name="price"
                type="number"
                min="0"
                value={form.price}
                onChange={handleChange}
                placeholder="0"
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
                placeholder="5"
              />
            </label>
            <label>
              Available Qty
              <input
                name="stock"
                type="number"
                min="0"
                value={form.stock}
                onChange={handleChange}
                placeholder="999"
              />
            </label>
            <label>
              Barcode / Code
              <input
                name="barcode"
                value={form.barcode}
                onChange={handleChange}
                placeholder="Auto generated if empty"
              />
            </label>
            <label>
              HSN / SAC
              <input name="hsn" value={form.hsn} onChange={handleChange} placeholder="Optional" />
            </label>
          </div>
          <button type="submit" className="laundry-service-primary">
            {editingId ? "Update Service" : "Save Service"}
          </button>
        </form>

        <section className="laundry-service-list">
          <div className="laundry-service-toolbar">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by service or code"
            />
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="All">All Categories</option>
              {LAUNDRY_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>

          <div className="laundry-service-table-wrap">
            <table className="laundry-service-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Category</th>
                  <th>Price</th>
                  <th>GST</th>
                  <th>Available</th>
                  <th>Code</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan="7" className="laundry-service-empty">
                      Loading services...
                    </td>
                  </tr>
                ) : filteredServices.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="laundry-service-empty">
                      No laundry services found.
                    </td>
                  </tr>
                ) : (
                  filteredServices.map((service) => (
                    <tr key={service.id}>
                      <td>
                        <strong>{service.name}</strong>
                        {service.hsn && <small>HSN/SAC: {service.hsn}</small>}
                      </td>
                      <td>
                        <span className="laundry-service-pill">{service.category}</span>
                      </td>
                      <td>Rs {Number(service.price || 0).toFixed(2)}</td>
                      <td>{Number(service.gst || 0)}%</td>
                      <td>{Number(service.stock || 0)}</td>
                      <td>{service.barcode || "-"}</td>
                      <td>
                        <div className="laundry-service-actions">
                          <button type="button" onClick={() => editService(service)}>
                            Edit
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={() => removeService(service)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Layout>
  );
};

export default LaundryServicePage;
