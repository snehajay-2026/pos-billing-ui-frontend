import React, { useEffect, useMemo, useState } from "react";
import {
  FaUserTie,
  FaPlus,
  FaEdit,
  FaTrash,
  FaPlay,
  FaCheck,
  FaSearch,
  FaUser,
  FaPhone,
  FaCalendarAlt,
  FaClock,
  FaStickyNote,
  FaListUl,
  FaSpinner,
  FaCheckCircle,
  FaHourglassHalf,
} from "react-icons/fa";
import { useUi } from "../context/UiContext";
import Layout from "../components/layout/Layout";
import { getOrders, createOrder, updateOrder, deleteOrder } from "../services/orderService";
import { loadServices } from "../services/serviceService";
import {
  STATUS_LABEL,
  STATUS_TONES,
  STATUS_FLOW,
  initialsFromName,
  formatDateTime,
  formatTime,
} from "../utils/serviceTones";
import "./ServiceOrderPage.css";

const STATUS_OPTIONS = STATUS_FLOW.map((v) => ({ value: v, label: STATUS_LABEL[v] }));

const emptyForm = {
  customer: "",
  phone: "",
  service: "",
  hours: 1,
  status: "pending",
  technician: "",
  scheduledDate: "",
  scheduledTime: "",
  notes: "",
};

const ServiceOrderPage = () => {
  const [orders, setOrders] = useState([]);
  const [services, setServices] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const { activeStore } = useUi();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [data, svc] = await Promise.all([getOrders("service"), loadServices()]);
        if (!cancelled) {
          setOrders(Array.isArray(data) ? data : []);
          setServices(Array.isArray(svc) ? svc : []);
          if (Array.isArray(svc) && svc.length && !form.service) {
            setForm((f) => ({ ...f, service: svc[0].name }));
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load service orders:", err);
          setOrders([]);
        }
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeStore]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const saveOrder = async () => {
    setError("");
    if (!form.customer || !form.service || !form.hours) {
      setError("Customer name, service, and hours are required.");
      return;
    }
    try {
      const payload = {
        ...form,
        hours: Number(form.hours),
        type: "service",
      };
      let saved;
      if (editing !== null) {
        saved = await updateOrder({ ...payload, id: editing });
        setOrders((prev) => prev.map((o) => (o.id === editing ? saved : o)));
      } else {
        saved = await createOrder(payload);
        setOrders((prev) => [...prev, saved]);
      }
      window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "orders" }));
      setForm({
        ...emptyForm,
        service: services[0]?.name || "",
      });
      setEditing(null);
    } catch (err) {
      console.error("Failed to save service order:", err);
      setError(err.message || "Unable to save order. Please try again.");
    }
  };

  const editOrder = (orderId) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    setEditing(orderId);
    setForm({
      customer: order.customer || "",
      phone: order.phone || "",
      service: order.service || services[0]?.name || "",
      hours: order.hours || 1,
      status: order.status || "pending",
      technician: order.technician || "",
      scheduledDate: order.scheduledDate || "",
      scheduledTime: order.scheduledTime || "",
      notes: order.notes || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const deleteOrder = async (orderId) => {
    if (!window.confirm("Delete this service order?")) return;
    try {
      await deleteOrder(orderId);
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "orders" }));
    } catch (err) {
      console.error("Failed to delete service order:", err);
      setError("Unable to delete order. Please try again.");
    }
  };

  const setStatus = async (orderId, newStatus) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    try {
      const saved = await updateOrder({
        ...order,
        id: orderId,
        status: newStatus,
        type: "service",
      });
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? saved : { ...o, status: newStatus }))
      );
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const handleCancel = () => {
    setForm({
      ...emptyForm,
      service: services[0]?.name || "",
    });
    setEditing(null);
    setError("");
  };

  const stats = useMemo(() => {
    const pending = orders.filter((o) => (o.status || "pending") === "pending").length;
    const inProgress = orders.filter((o) => o.status === "in_progress").length;
    const completed = orders.filter((o) => o.status === "completed").length;
    const totalHours = orders.reduce((s, o) => s + (Number(o.hours) || 0), 0);
    return { pending, inProgress, completed, totalHours };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== "ALL" && (order.status || "pending") !== statusFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [order.customer, order.phone, order.service, order.technician, order.notes]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [orders, search, statusFilter]);

  const statusCounts = useMemo(
    () => ({
      ALL: orders.length,
      pending: stats.pending,
      in_progress: stats.inProgress,
      completed: stats.completed,
    }),
    [orders, stats]
  );

  return (
    <Layout>
      <div className="sv-page service-orders-page">
        {/* HERO */}
        <div className="sv-hero sv-hero-orders">
          <div className="sv-hero-bg" aria-hidden="true" />
          <div className="sv-hero-content">
            <div className="sv-hero-text">
              <div className="sv-hero-eyebrow">
                <FaUserTie />
                <span>Appointments & jobs</span>
              </div>
              <h1 className="sv-hero-title">Service Orders</h1>
              <p className="sv-hero-subtitle">
                Schedule jobs, assign technicians, and track each customer request from intake to
                completion — all in one place.
              </p>
            </div>
          </div>
        </div>

        {/* STATS */}
        <div className="sv-stats sv-stats-4">
          <div className="sv-stat-card tone-amber">
            <div className="sv-stat-icon">
              <FaHourglassHalf />
            </div>
            <div className="sv-stat-meta">
              <span>Pending</span>
              <strong>{stats.pending}</strong>
            </div>
          </div>
          <div className="sv-stat-card tone-sky">
            <div className="sv-stat-icon">
              <FaSpinner />
            </div>
            <div className="sv-stat-meta">
              <span>In progress</span>
              <strong>{stats.inProgress}</strong>
            </div>
          </div>
          <div className="sv-stat-card tone-emerald">
            <div className="sv-stat-icon">
              <FaCheckCircle />
            </div>
            <div className="sv-stat-meta">
              <span>Completed</span>
              <strong>{stats.completed}</strong>
            </div>
          </div>
          <div className="sv-stat-card tone-violet">
            <div className="sv-stat-icon">
              <FaClock />
            </div>
            <div className="sv-stat-meta">
              <span>Total hours</span>
              <strong>{stats.totalHours.toFixed(1)}h</strong>
            </div>
          </div>
        </div>

        {/* FORM */}
        <div className="sv-panel sv-form-panel">
          <div className="sv-panel-head">
            <div>
              <h2 className="sv-panel-title">
                {editing !== null ? "Edit order" : "Schedule a new order"}
              </h2>
              <p className="sv-panel-sub">
                Capture the customer, job, technician, and slot — fields marked with * are required.
              </p>
            </div>
            {editing !== null && <span className="sv-editing-badge">Editing order</span>}
          </div>

          {error && <div className="sv-alert sv-alert-danger">{error}</div>}

          <div className="sv-form">
            <div className="sv-field-row">
              <div className="sv-field">
                <label htmlFor="so-customer">
                  <FaUser /> Customer name *
                </label>
                <input
                  id="so-customer"
                  className="sv-input"
                  name="customer"
                  value={form.customer}
                  onChange={handleChange}
                  placeholder="e.g. Rahul Mehta"
                />
              </div>
              <div className="sv-field">
                <label htmlFor="so-phone">
                  <FaPhone /> Phone
                </label>
                <input
                  id="so-phone"
                  className="sv-input"
                  name="phone"
                  value={form.phone}
                  onChange={handleChange}
                  placeholder="+91 98765 43210"
                />
              </div>
              <div className="sv-field">
                <label htmlFor="so-service">Service *</label>
                <select
                  id="so-service"
                  className="sv-input sv-select"
                  name="service"
                  value={form.service}
                  onChange={handleChange}
                >
                  {services.length === 0 ? (
                    <option value="">No services — add some first</option>
                  ) : (
                    services.map((s) => (
                      <option key={s.id || s.name} value={s.name}>
                        {s.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
              <div className="sv-field">
                <label htmlFor="so-hours">Hours *</label>
                <input
                  id="so-hours"
                  className="sv-input"
                  name="hours"
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={form.hours}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className="sv-field-row">
              <div className="sv-field">
                <label htmlFor="so-tech">
                  <FaUserTie /> Technician
                </label>
                <input
                  id="so-tech"
                  className="sv-input"
                  name="technician"
                  value={form.technician}
                  onChange={handleChange}
                  placeholder="e.g. Suresh"
                />
              </div>
              <div className="sv-field">
                <label htmlFor="so-date">
                  <FaCalendarAlt /> Scheduled date
                </label>
                <input
                  id="so-date"
                  className="sv-input"
                  name="scheduledDate"
                  type="date"
                  value={form.scheduledDate}
                  onChange={handleChange}
                />
              </div>
              <div className="sv-field">
                <label htmlFor="so-time">
                  <FaClock /> Scheduled time
                </label>
                <input
                  id="so-time"
                  className="sv-input"
                  name="scheduledTime"
                  type="time"
                  value={form.scheduledTime}
                  onChange={handleChange}
                />
              </div>
              <div className="sv-field">
                <label htmlFor="so-status">Status</label>
                <select
                  id="so-status"
                  className="sv-input sv-select"
                  name="status"
                  value={form.status}
                  onChange={handleChange}
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sv-field">
              <label htmlFor="so-notes">
                <FaStickyNote /> Notes
              </label>
              <textarea
                id="so-notes"
                className="sv-input"
                name="notes"
                rows={2}
                value={form.notes}
                onChange={handleChange}
                placeholder="Anything the technician should know? (optional)"
              />
            </div>

            <div className="sv-form-actions">
              <button type="button" className="sv-btn sv-btn-primary" onClick={saveOrder}>
                <FaPlus /> {editing !== null ? "Update order" : "Create order"}
              </button>
              {editing !== null && (
                <button type="button" className="sv-btn sv-btn-ghost" onClick={handleCancel}>
                  Cancel
                </button>
              )}
            </div>
          </div>
        </div>

        {/* LIST */}
        <div className="sv-panel sv-list-panel">
          <div className="sv-panel-head">
            <div>
              <h2 className="sv-panel-title">All orders</h2>
              <p className="sv-panel-sub">
                {filteredOrders.length} {filteredOrders.length === 1 ? "order" : "orders"} matching
                your filters
              </p>
            </div>

            <div className="sv-search">
              <FaSearch />
              <input
                type="text"
                placeholder="Search customer, phone, technician…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search orders"
              />
            </div>
          </div>

          <div className="sv-chip-row sv-filter-chips">
            <button
              type="button"
              className={`sv-chip ${statusFilter === "ALL" ? "active" : ""}`}
              onClick={() => setStatusFilter("ALL")}
            >
              <FaListUl /> All ({statusCounts.ALL})
            </button>
            {STATUS_FLOW.map((s) => {
              const tone = STATUS_TONES[s];
              return (
                <button
                  type="button"
                  key={s}
                  className={`sv-chip ${statusFilter === s ? "active" : ""}`}
                  onClick={() => setStatusFilter(s)}
                >
                  <span className="sv-chip-dot" style={{ background: tone.dot }} />
                  {STATUS_LABEL[s]} ({statusCounts[s]})
                </button>
              );
            })}
          </div>

          {filteredOrders.length === 0 ? (
            <div className="sv-empty">
              <div className="sv-empty-icon">
                <FaListUl />
              </div>
              <strong>No orders yet</strong>
              <span>Schedule your first service order above to see it here.</span>
            </div>
          ) : (
            <div className="so-list">
              {filteredOrders.map((order) => {
                const status = order.status || "pending";
                const tone = STATUS_TONES[status] || STATUS_TONES.pending;
                return (
                  <div key={order.id} className="so-row" style={{ "--row-accent": tone.color }}>
                    <div className="so-row-main">
                      <div className="so-customer">
                        <div
                          className="so-avatar"
                          style={{
                            background: `linear-gradient(135deg, ${tone.bg}, rgba(255,255,255,0.6))`,
                            color: tone.color,
                          }}
                        >
                          {initialsFromName(order.customer)}
                        </div>
                        <div className="so-customer-meta">
                          <strong>{order.customer}</strong>
                          <span>
                            {order.phone || "—"}
                            {order.service ? (
                              <>
                                <i> · </i>
                                {order.service}
                              </>
                            ) : null}
                          </span>
                        </div>
                      </div>

                      <div className="so-meta-grid">
                        <div className="so-meta-cell">
                          <span>
                            <FaClock /> Duration
                          </span>
                          <strong>{Number(order.hours) || 0}h</strong>
                        </div>
                        <div className="so-meta-cell">
                          <span>
                            <FaUserTie /> Technician
                          </span>
                          <strong>{order.technician || "Unassigned"}</strong>
                        </div>
                        <div className="so-meta-cell">
                          <span>
                            <FaCalendarAlt /> Slot
                          </span>
                          <strong>
                            {formatDateTime(order.scheduledDate, order.scheduledTime)}
                          </strong>
                        </div>
                      </div>

                      {order.notes && (
                        <div className="so-notes">
                          <FaStickyNote /> {order.notes}
                        </div>
                      )}
                    </div>

                    <div className="so-row-side">
                      <span
                        className="so-status-pill"
                        style={{ background: tone.bg, color: tone.color }}
                      >
                        <span
                          className="so-status-dot"
                          style={{
                            background: tone.dot,
                            boxShadow: `0 0 0 4px ${tone.halo}`,
                          }}
                        />
                        {STATUS_LABEL[status]}
                      </span>

                      <div className="so-quick-actions">
                        {status === "pending" && (
                          <button
                            type="button"
                            className="so-qa-btn start"
                            onClick={() => setStatus(order.id, "in_progress")}
                            title="Mark in progress"
                          >
                            <FaPlay /> Start
                          </button>
                        )}
                        {status !== "completed" && (
                          <button
                            type="button"
                            className="so-qa-btn complete"
                            onClick={() => setStatus(order.id, "completed")}
                            title="Mark completed"
                          >
                            <FaCheck /> Complete
                          </button>
                        )}
                        <button
                          type="button"
                          className="so-qa-btn edit"
                          onClick={() => editOrder(order.id)}
                          title="Edit"
                          aria-label="Edit"
                        >
                          <FaEdit />
                        </button>
                        <button
                          type="button"
                          className="so-qa-btn delete"
                          onClick={() => deleteOrder(order.id)}
                          title="Delete"
                          aria-label="Delete"
                        >
                          <FaTrash />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default ServiceOrderPage;
