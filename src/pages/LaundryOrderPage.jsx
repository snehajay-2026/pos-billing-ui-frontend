import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/layout/Layout";
import {
  getOrders,
  createOrder,
  updateOrder,
  deleteOrder as deleteOrderApi,
} from "../services/orderService";
import { getStoreSettings } from "../services/storeSettingsService";
import { useUi } from "../context/UiContext";
import {
  LAUNDRY_ORDER_STATUSES,
  resolveLaundryStatus,
  getLaundryStatusLabel,
  orderGrandTotal,
  nextLaundryToken,
  defaultExpectedReturn,
} from "../components/laundry/laundryStatus";
import { LAUNDRY_CATEGORIES } from "../components/laundry/laundryServiceCatalog";
import "./LaundryOrderPage.css";

const STATUS_FILTERS = [{ value: "all", label: "All" }, ...LAUNDRY_ORDER_STATUSES];

const emptyForm = () => ({
  customer: "",
  phone: "",
  service: "Washing",
  items: [{ name: "Washing", qty: 1, price: 0, gst: 5 }],
  qty: 1,
  status: "received",
  expectedReturn: defaultExpectedReturn(),
  notes: "",
  express: false,
  token: "",
  invoiceNo: "",
});

const LaundryOrderPage = () => {
  const navigate = useNavigate();
  const { activeStore, showToast } = useUi();
  const [orders, setOrders] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [loading, setLoading] = useState(true);

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [serviceFilter, setServiceFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [drawerOrder, setDrawerOrder] = useState(null);

  const expressFee = Number(getStoreSettings()?.laundryExpressFee ?? 80) || 0;
  const tokenCounter = useRef(0);

  useEffect(() => {
    const loadOrders = async () => {
      setLoading(true);
      try {
        const data = await getOrders("laundry");
        setOrders(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error("Failed to load laundry orders:", err);
        showToast("error", "Failed to load orders. Please try again.");
        setOrders([]);
      } finally {
        setLoading(false);
      }
    };

    loadOrders();
  }, [activeStore, showToast]);

  const knownServices = useMemo(() => {
    const set = new Set(LAUNDRY_CATEGORIES);
    orders.forEach((order) => {
      (Array.isArray(order.items) ? order.items : []).forEach((item) => {
        if (item?.name) set.add(String(item.name));
      });
      if (order.service) set.add(String(order.service));
    });
    return Array.from(set).sort();
  }, [orders]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return orders
      .filter((order) => {
        if (statusFilter !== "all") {
          const normalized = String(order.status || "").toLowerCase();
          if (normalized === "pending") return statusFilter === "received";
          if (normalized === "washed") return statusFilter === "in_process";
          if (normalized === "not_picked_up") return statusFilter === "ready";
          if (normalized === "completed") return statusFilter === "delivered";
          if (normalized !== statusFilter) return false;
        }
        if (serviceFilter !== "All") {
          const names = (Array.isArray(order.items) ? order.items : []).map((i) =>
            String(i.name || "")
          );
          if (!names.includes(serviceFilter) && order.service !== serviceFilter) return false;
        }
        if (dateFilter) {
          const created = String(order.createdAt || "").split("T")[0];
          if (created !== dateFilter) return false;
        }
        if (q) {
          const haystack = [
            order.customer,
            order.phone,
            order.token,
            order.invoiceNo,
            order.notes,
            ...(Array.isArray(order.items) ? order.items.map((i) => i.name) : []),
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  }, [orders, statusFilter, serviceFilter, dateFilter, searchTerm]);

  const stats = useMemo(() => {
    const counts = LAUNDRY_ORDER_STATUSES.reduce((acc, s) => {
      acc[s.value] = 0;
      return acc;
    }, {});
    let expressCount = 0;
    let openValue = 0;
    orders.forEach((order) => {
      const status = resolveLaundryStatus(order.status);
      if (counts[status.value] !== undefined) counts[status.value] += 1;
      if (order.express) expressCount += 1;
      if (status.value !== "delivered" && status.value !== "cancelled") {
        openValue += orderGrandTotal(order);
      }
    });
    return { counts, expressCount, openValue, total: orders.length };
  }, [orders]);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? checked : value }));
  };

  const handleItemChange = (index, field, value) => {
    setForm((prev) => {
      const items = [...(prev.items || [])];
      const item = { ...(items[index] || {}), [field]: value };
      if (field === "qty") item.qty = Math.max(0, Number(value) || 0);
      if (field === "price") item.price = Math.max(0, Number(value) || 0);
      if (field === "gst") item.gst = Math.max(0, Number(value) || 0);
      items[index] = item;
      const totalQty = items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
      return { ...prev, items, qty: totalQty };
    });
  };

  const addItem = () => {
    setForm((prev) => ({
      ...prev,
      items: [...(prev.items || []), { name: "Washing", qty: 1, price: 0, gst: 5 }],
    }));
  };

  const removeItem = (index) => {
    setForm((prev) => {
      const items = (prev.items || []).filter((_, i) => i !== index);
      const totalQty = items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0);
      return { ...prev, items, qty: totalQty };
    });
  };

  const buildItemsFromForm = () => {
    const items = (form.items || [])
      .map((item) => ({
        name: String(item.name || "").trim() || form.service || "Service",
        qty: Math.max(0, Number(item.qty) || 0),
        price: Math.max(0, Number(item.price) || 0),
        gst: Math.max(0, Number(item.gst) || 0),
      }))
      .filter((item) => item.qty > 0);
    return items;
  };

  const calcSubtotal = (items) =>
    items.reduce((sum, it) => sum + (Number(it.qty) || 0) * (Number(it.price) || 0), 0);

  const calcGst = (items) =>
    items.reduce(
      (sum, it) =>
        sum + ((Number(it.qty) || 0) * (Number(it.price) || 0) * (Number(it.gst) || 0)) / 100,
      0
    );

  const saveOrder = async () => {
    if (!form.customer.trim()) {
      showToast("error", "Customer name is required.");
      return;
    }
    if (form.phone && !/^\d{10}$/.test(String(form.phone).trim())) {
      showToast("error", "Customer phone must be a 10-digit mobile number.");
      return;
    }
    const items = buildItemsFromForm();
    if (items.length === 0) {
      showToast("error", "Add at least one service line item with a quantity.");
      return;
    }

    const subtotal = calcSubtotal(items);
    const gst = calcGst(items);
    const expressSurcharge = form.express ? expressFee : 0;
    const total = subtotal + gst + expressSurcharge;

    const payload = {
      ...form,
      customer: form.customer.trim(),
      phone: String(form.phone || "").trim(),
      notes: String(form.notes || "").trim(),
      service: items[0]?.name || form.service || "Washing",
      items,
      qty: items.reduce((sum, it) => sum + it.qty, 0),
      subtotal,
      gstTotal: gst,
      expressSurcharge,
      total,
      type: "laundry",
    };

    try {
      let nextOrder;
      if (editing !== null) {
        const oldOrder = orders.find((o) => String(o.id) === String(editing));
        if (!oldOrder) {
          showToast("error", "Original order not found. Reload and try again.");
          return;
        }
        nextOrder = await updateOrder({ ...payload, id: editing });
        setOrders((prev) => prev.map((o) => (String(o.id) === String(editing) ? nextOrder : o)));
        showToast("success", `Order ${payload.token || oldOrder.token || ""} updated.`);
      } else {
        const existingTokens = orders.map((o) => o.token).filter(Boolean);
        const token = nextLaundryToken(existingTokens);
        nextOrder = await createOrder({ ...payload, token });
        payload.token = token;
        setOrders((prev) => [...prev, nextOrder]);
        showToast("success", `Order ${token} created.`);
        tokenCounter.current += 1;
      }
      window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "orders" }));
      resetForm();
    } catch (err) {
      console.error("Failed to save laundry order:", err);
      showToast("error", "Unable to save order. Please try again.");
    }
  };

  const resetForm = () => {
    setForm(emptyForm());
    setEditing(null);
  };

  const editOrder = (order) => {
    setEditing(order.id);
    const items =
      Array.isArray(order.items) && order.items.length
        ? order.items.map((it) => ({
            name: it.name || order.service || "Washing",
            qty: Number(it.qty ?? order.qty ?? 1) || 1,
            price: Number(it.price || 0) || 0,
            gst: Number(it.gst || 0) || 0,
          }))
        : [
            {
              name: order.service || "Washing",
              qty: Number(order.qty || 1) || 1,
              price: 0,
              gst: 5,
            },
          ];
    setForm({
      customer: order.customer || "",
      phone: order.phone || "",
      service: order.service || "Washing",
      items,
      qty: order.qty || items.reduce((sum, it) => sum + (Number(it.qty) || 0), 0),
      status: resolveLaundryStatus(order.status).value,
      expectedReturn: order.expectedReturn || defaultExpectedReturn(),
      notes: order.notes || "",
      express: Boolean(order.express),
      token: order.token || "",
      invoiceNo: order.invoiceNo || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteOrder = async (order) => {
    if (!window.confirm(`Delete order ${order.token || order.customer}?`)) return;
    try {
      await deleteOrderApi(order.id);
      setOrders((prev) => prev.filter((o) => String(o.id) !== String(order.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
      if (drawerOrder && String(drawerOrder.id) === String(order.id)) setDrawerOrder(null);
      if (String(editing) === String(order.id)) resetForm();
      window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "orders" }));
      showToast("success", "Order deleted.");
    } catch (err) {
      console.error("Failed to delete laundry order:", err);
      showToast("error", "Unable to delete order. Please try again.");
    }
  };

  const setOrderStatus = async (order, nextStatus) => {
    try {
      const updated = await updateOrder({ ...order, status: nextStatus });
      setOrders((prev) => prev.map((o) => (String(o.id) === String(order.id) ? updated : o)));
      if (drawerOrder && String(drawerOrder.id) === String(order.id)) {
        setDrawerOrder(updated);
      }
      window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "orders" }));
      showToast("success", `Order marked ${getLaundryStatusLabel(nextStatus).toLowerCase()}.`);
    } catch (err) {
      console.error("Failed to update order status:", err);
      showToast("error", "Unable to update status. Please try again.");
    }
  };

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      if (filtered.every((o) => prev.has(o.id))) return new Set();
      return new Set(filtered.map((o) => o.id));
    });
  };

  const bulkSetStatus = async (nextStatus) => {
    if (selectedIds.size === 0) return;
    try {
      const targets = orders.filter((o) => selectedIds.has(o.id));
      const updated = await Promise.all(
        targets.map((o) => updateOrder({ ...o, status: nextStatus }))
      );
      const updatedMap = new Map(updated.map((o) => [String(o.id), o]));
      setOrders((prev) => prev.map((o) => updatedMap.get(String(o.id)) || o));
      window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "orders" }));
      showToast(
        "success",
        `${updated.length} order(s) marked ${getLaundryStatusLabel(nextStatus).toLowerCase()}.`
      );
    } catch (err) {
      console.error("Failed to bulk-update orders:", err);
      showToast("error", "Bulk update failed. Please try again.");
    }
  };

  const regenerateTokens = () => {
    if (
      !window.confirm("Regenerate missing tokens for older orders? Existing tokens will be kept.")
    )
      return;
    const existingTokens = new Set();
    const patched = orders.map((order) => {
      if (order.token) {
        existingTokens.add(order.token);
        return order;
      }
      const token = nextLaundryToken(Array.from(existingTokens));
      existingTokens.add(token);
      return { ...order, token };
    });
    setOrders(patched);
    showToast("success", "Tokens regenerated for orders without one.");
  };

  const subtotal = calcSubtotal(form.items || []);
  const gst = calcGst(form.items || []);
  const expressSurcharge = form.express ? expressFee : 0;
  const total = subtotal + gst + expressSurcharge;
  const allSelected = filtered.length > 0 && filtered.every((o) => selectedIds.has(o.id));

  return (
    <Layout>
      <div className="laundry-order-page-pro">
        <header className="laundry-order-header">
          <div>
            <h3 className="laundry-order-title">Laundry Order Management</h3>
            <p className="laundry-order-subtitle">
              Track garments from drop-off to delivery, with tokens and customer notifications.
            </p>
          </div>
          <div className="laundry-order-stats">
            <div className="laundry-order-stat">
              <span>Open</span>
              <strong>
                {stats.counts.received + stats.counts.in_process + stats.counts.ready}
              </strong>
            </div>
            <div className="laundry-order-stat ready">
              <span>Ready</span>
              <strong>{stats.counts.ready}</strong>
            </div>
            <div className="laundry-order-stat">
              <span>Delivered</span>
              <strong>{stats.counts.delivered}</strong>
            </div>
            <div className="laundry-order-stat value">
              <span>Open value</span>
              <strong>Rs {Math.round(stats.openValue).toLocaleString("en-IN")}</strong>
            </div>
          </div>
        </header>

        <div className="laundry-order-card">
          <h5>{editing !== null ? "Edit Order" : "Add Order"}</h5>
          <div className="row">
            <div className="col-md-3 mb-3">
              <label>Customer Name</label>
              <input
                className="form-control"
                name="customer"
                value={form.customer}
                onChange={handleChange}
                placeholder="Customer Name"
              />
            </div>
            <div className="col-md-2 mb-3">
              <label>Phone</label>
              <input
                className="form-control"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                placeholder="10-digit mobile"
                inputMode="numeric"
                maxLength={10}
              />
            </div>
            <div className="col-md-2 mb-3">
              <label>Status</label>
              <select
                className="form-control"
                name="status"
                value={form.status}
                onChange={handleChange}
              >
                {LAUNDRY_ORDER_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-2 mb-3">
              <label>Expected Return</label>
              <input
                className="form-control"
                type="date"
                name="expectedReturn"
                value={form.expectedReturn}
                onChange={handleChange}
              />
            </div>
            <div className="col-md-3 mb-3">
              <label>Notes</label>
              <input
                className="form-control"
                name="notes"
                value={form.notes}
                onChange={handleChange}
                placeholder="Optional (stain type, special care)"
              />
            </div>
          </div>

          <div className="laundry-order-items">
            <div className="laundry-order-items-head">
              <h6>Services</h6>
              <button type="button" className="laundry-order-link" onClick={addItem}>
                + Add item
              </button>
            </div>
            <table className="laundry-order-items-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th style={{ width: 90 }}>Qty</th>
                  <th style={{ width: 120 }}>Price</th>
                  <th style={{ width: 90 }}>GST %</th>
                  <th style={{ width: 110 }}>Line Total</th>
                  <th style={{ width: 60 }}></th>
                </tr>
              </thead>
              <tbody>
                {(form.items || []).map((item, i) => (
                  <tr key={i}>
                    <td>
                      <input
                        className="form-control"
                        list="laundry-services-list"
                        value={item.name || ""}
                        onChange={(e) => handleItemChange(i, "name", e.target.value)}
                        placeholder="Service name"
                      />
                    </td>
                    <td>
                      <input
                        className="form-control"
                        type="number"
                        min="0"
                        value={item.qty ?? 0}
                        onChange={(e) => handleItemChange(i, "qty", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="form-control"
                        type="number"
                        min="0"
                        value={item.price ?? 0}
                        onChange={(e) => handleItemChange(i, "price", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className="form-control"
                        type="number"
                        min="0"
                        value={item.gst ?? 0}
                        onChange={(e) => handleItemChange(i, "gst", e.target.value)}
                      />
                    </td>
                    <td>
                      Rs {((Number(item.qty) || 0) * (Number(item.price) || 0) || 0).toFixed(2)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="laundry-order-row-remove"
                        onClick={() => removeItem(i)}
                        disabled={(form.items || []).length <= 1}
                        aria-label="Remove item"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="laundry-services-list">
              {knownServices.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>

          <div className="row align-items-center">
            <div className="col-md-4 mb-2">
              <label className="laundry-order-checkbox">
                <input
                  type="checkbox"
                  name="express"
                  checked={form.express}
                  onChange={handleChange}
                />
                <span>Express / Same-day (+ Rs {expressFee})</span>
              </label>
            </div>
            <div className="col-md-4 offset-md-4 mb-2">
              <div className="laundry-order-totals">
                <div>
                  <span>Subtotal</span>
                  <strong>Rs {subtotal.toFixed(2)}</strong>
                </div>
                <div>
                  <span>GST</span>
                  <strong>Rs {gst.toFixed(2)}</strong>
                </div>
                {form.express && (
                  <div>
                    <span>Express</span>
                    <strong>Rs {expressSurcharge.toFixed(2)}</strong>
                  </div>
                )}
                <div className="laundry-order-grand">
                  <span>Total</span>
                  <strong>Rs {total.toFixed(2)}</strong>
                </div>
              </div>
            </div>
          </div>

          <div className="laundry-order-actions">
            <button
              type="button"
              className="btn laundry-order-btn laundry-order-btn-primary"
              onClick={saveOrder}
            >
              {editing !== null ? "Update Order" : "Add Order"}
            </button>
            {editing !== null && (
              <button
                type="button"
                className="btn laundry-order-btn laundry-order-btn-secondary"
                onClick={resetForm}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div className="laundry-order-card" style={{ marginBottom: 0 }}>
          <div className="laundry-order-list-head">
            <h5>Order List</h5>
            <div className="laundry-order-list-tools">
              <button type="button" className="laundry-order-link" onClick={regenerateTokens}>
                Regenerate tokens
              </button>
            </div>
          </div>

          <div className="laundry-order-toolbar">
            <input
              className="form-control"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, phone, token, invoice, note"
            />
            <select
              className="form-control"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              {STATUS_FILTERS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              className="form-control"
              value={serviceFilter}
              onChange={(e) => setServiceFilter(e.target.value)}
            >
              <option value="All">All services</option>
              {knownServices.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input
              className="form-control"
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              title="Filter by drop-off date"
            />
            {(statusFilter !== "all" || serviceFilter !== "All" || dateFilter || searchTerm) && (
              <button
                type="button"
                className="laundry-order-link"
                onClick={() => {
                  setStatusFilter("all");
                  setServiceFilter("All");
                  setDateFilter("");
                  setSearchTerm("");
                }}
              >
                Clear
              </button>
            )}
          </div>

          {selectedIds.size > 0 && (
            <div className="laundry-order-bulk">
              <span>{selectedIds.size} selected</span>
              <div>
                <button
                  type="button"
                  className="btn btn-sm laundry-order-btn-primary"
                  onClick={() => bulkSetStatus("ready")}
                >
                  Mark Ready
                </button>
                <button
                  type="button"
                  className="btn btn-sm laundry-order-btn-primary"
                  onClick={() => bulkSetStatus("delivered")}
                >
                  Mark Delivered
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-outline-secondary"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Clear selection
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <p className="text-center text-muted">Loading orders…</p>
          ) : orders.length === 0 ? (
            <p className="text-center text-muted">No orders available</p>
          ) : filtered.length === 0 ? (
            <p className="text-center text-muted">No orders match the current filters.</p>
          ) : (
            <div className="laundry-order-table-wrap">
              <table className="laundry-order-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAllVisible}
                        aria-label="Select all visible orders"
                      />
                    </th>
                    <th>Token</th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Service</th>
                    <th style={{ width: 80 }}>Qty</th>
                    <th style={{ width: 160 }}>Status</th>
                    <th style={{ width: 110 }}>Return</th>
                    <th style={{ width: 110 }}>Total</th>
                    <th style={{ width: 220 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => {
                    const status = resolveLaundryStatus(o.status);
                    return (
                      <tr key={o.id || `${o.customer}-${o.service}`}>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(o.id)}
                            onChange={() => toggleSelect(o.id)}
                            aria-label={`Select order ${o.token || o.id}`}
                          />
                        </td>
                        <td>
                          {o.token ? (
                            <span className="laundry-order-token">{o.token}</span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="laundry-order-link"
                            onClick={() => setDrawerOrder(o)}
                          >
                            {o.customer}
                          </button>
                          {o.invoiceNo && (
                            <small className="d-block text-muted">Inv: {o.invoiceNo}</small>
                          )}
                        </td>
                        <td>{o.phone || <span className="text-muted">—</span>}</td>
                        <td>
                          {o.service ||
                            (Array.isArray(o.items) ? o.items.map((i) => i.name).join(", ") : "—")}
                        </td>
                        <td>{Number(o.qty || 0)}</td>
                        <td>
                          <select
                            className="laundry-order-status-pill"
                            style={{
                              backgroundColor: status.color,
                              color: "#fff",
                              borderColor: status.color,
                            }}
                            value={status.value}
                            onChange={(e) => setOrderStatus(o, e.target.value)}
                            aria-label={`Status of order ${o.token || o.id}`}
                          >
                            {LAUNDRY_ORDER_STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>{o.expectedReturn || <span className="text-muted">—</span>}</td>
                        <td>Rs {orderGrandTotal(o).toFixed(2)}</td>
                        <td>
                          <div className="laundry-order-row-actions">
                            {o.invoiceNo ? (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary"
                                onClick={() =>
                                  navigate(`/invoice/${encodeURIComponent(o.invoiceNo)}`)
                                }
                              >
                                View Invoice
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-primary"
                                onClick={() => navigate("/pos")}
                              >
                                Bill Now
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn btn-sm laundry-order-btn-primary"
                              onClick={() => editOrder(o)}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              onClick={() => handleDeleteOrder(o)}
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
        </div>

        {drawerOrder && (
          <OrderDetailsDrawer
            order={drawerOrder}
            onClose={() => setDrawerOrder(null)}
            onStatus={setOrderStatus}
            onDelete={handleDeleteOrder}
            onEdit={(order) => {
              setDrawerOrder(null);
              editOrder(order);
            }}
            onViewInvoice={(invoiceNo) => navigate(`/invoice/${encodeURIComponent(invoiceNo)}`)}
          />
        )}
      </div>
    </Layout>
  );
};

const OrderDetailsDrawer = ({ order, onClose, onStatus, onDelete, onEdit, onViewInvoice }) => {
  const status = resolveLaundryStatus(order.status);
  const items = Array.isArray(order.items) ? order.items : [];
  return (
    <div className="laundry-order-drawer-backdrop" onClick={onClose} role="presentation">
      <aside
        className="laundry-order-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`Order ${order.token || order.id} details`}
      >
        <header className="laundry-order-drawer-head">
          <div>
            <h4>Order {order.token || order.id}</h4>
            <p className="text-muted">
              Placed {order.createdAt ? new Date(order.createdAt).toLocaleString() : "—"}
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
              <span>Customer</span>
              <strong>{order.customer || "—"}</strong>
            </div>
            <div>
              <span>Phone</span>
              <strong>{order.phone || "—"}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong style={{ color: status.color }}>{status.label}</strong>
            </div>
            <div>
              <span>Expected Return</span>
              <strong>{order.expectedReturn || "—"}</strong>
            </div>
            <div>
              <span>Token</span>
              <strong>{order.token || "—"}</strong>
            </div>
            <div>
              <span>Invoice</span>
              <strong>{order.invoiceNo || "Not billed yet"}</strong>
            </div>
            {order.express && (
              <div>
                <span>Express</span>
                <strong style={{ color: "#fd7e14" }}>Yes</strong>
              </div>
            )}
          </div>
          {order.notes && (
            <p className="laundry-order-drawer-notes">
              <strong>Notes:</strong> {order.notes}
            </p>
          )}
        </section>

        <section className="laundry-order-drawer-section">
          <h6>Items</h6>
          {items.length === 0 ? (
            <p className="text-muted">No itemized services.</p>
          ) : (
            <table className="laundry-order-drawer-items">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Qty</th>
                  <th>Price</th>
                  <th>GST</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => {
                  const qty = Number(item.qty ?? item.qtyKg ?? 0) || 0;
                  const price = Number(item.price || 0) || 0;
                  const gst = Number(item.gst || 0) || 0;
                  const lineTotal = qty * price * (1 + gst / 100);
                  return (
                    <tr key={i}>
                      <td>{item.name || "Service"}</td>
                      <td>{qty}</td>
                      <td>Rs {price.toFixed(2)}</td>
                      <td>{gst}%</td>
                      <td>Rs {lineTotal.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan="4">
                    <strong>Grand total</strong>
                  </td>
                  <td>
                    <strong>Rs {orderGrandTotal(order).toFixed(2)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          )}
        </section>

        <section className="laundry-order-drawer-section">
          <h6>Quick status</h6>
          <div className="laundry-order-drawer-actions">
            {LAUNDRY_ORDER_STATUSES.map((s) => (
              <button
                key={s.value}
                type="button"
                className="btn btn-sm"
                style={{
                  backgroundColor: s.value === status.value ? s.color : "#fff",
                  color: s.value === status.value ? "#fff" : s.color,
                  border: `1px solid ${s.color}`,
                  marginRight: 6,
                  marginBottom: 6,
                }}
                onClick={() => onStatus(order, s.value)}
                disabled={s.value === status.value}
              >
                {s.label}
              </button>
            ))}
          </div>
        </section>

        <footer className="laundry-order-drawer-foot">
          {order.invoiceNo && (
            <button
              type="button"
              className="btn btn-outline-primary"
              onClick={() => onViewInvoice(order.invoiceNo)}
            >
              View Invoice
            </button>
          )}
          <button
            type="button"
            className="btn laundry-order-btn-primary"
            onClick={() => onEdit(order)}
          >
            Edit Order
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              onClose();
              onDelete(order);
            }}
          >
            Delete
          </button>
        </footer>
      </aside>
    </div>
  );
};

export default LaundryOrderPage;
