import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  FaFileInvoiceDollar,
  FaExternalLinkAlt,
  FaTimes,
  FaReceipt,
} from "react-icons/fa";
import { useUi } from "../context/UiContext";
import Layout from "../components/layout/Layout";
import {
  getOrders,
  createOrder,
  updateOrder,
  deleteOrder,
  createInvoiceFromOrder,
} from "../services/orderService";
import { loadServices } from "../services/serviceService";
import {
  STATUS_LABEL,
  STATUS_TONES,
  STATUS_FLOW,
  ACTIONABLE_STATUSES,
  initialsFromName,
  formatDateTime,
  formatTime,
  formatCurrency,
} from "../utils/serviceTones";
import "./ServiceOrderPage.css";

const STATUS_OPTIONS = STATUS_FLOW.map((v) => ({ value: v, label: STATUS_LABEL[v] }));

// F1: payment modes accepted by POST /api/orders/:id/invoice. Mirrors the
// backend allow-list so the cashier doesn't see options that will 400.
const PAYMENT_OPTIONS = [
  { value: "Cash", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "Card", label: "Card" },
  { value: "Bank Transfer", label: "Bank Transfer" },
];

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

// F1: dialog state for the "Create invoice" flow. The dialog captures
// payment mode + optional overrides; the backend derives totals from
// the order row + the catalog rate.
const emptyInvoiceForm = {
  paymentMode: "Cash",
  gstRate: "",
  remarks: "",
  customerEmail: "",
  customerAddress: "",
  customerGst: "",
  customerState: "",
};

const ServiceOrderPage = () => {
  const [orders, setOrders] = useState([]);
  const [services, setServices] = useState([]);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  // F1: invoice dialog state.
  const [invoiceFor, setInvoiceFor] = useState(null);
  const [invoiceForm, setInvoiceForm] = useState(emptyInvoiceForm);
  const [invoiceSubmitting, setInvoiceSubmitting] = useState(false);
  const [invoiceError, setInvoiceError] = useState("");

  const { activeStore } = useUi();
  const navigate = useNavigate();

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

  // F1: open the "Create invoice" dialog for a row. Pre-fills customer
  // email / address / GST if the order already carries them (the order
  // row only stores customer + phone today; anything else is blank).
  const openInvoiceDialog = (order) => {
    if (!order || order.invoiceNo) return;
    setInvoiceError("");
    setInvoiceForm({
      ...emptyInvoiceForm,
      // If the order is already `completed`, default payment to Cash
      // because completed jobs are typically billed in person. For an
      // `in_progress` job that the cashier wants to bill now, Cash is
      // still the safest default — the cashier can flip it.
      paymentMode: "Cash",
    });
    setInvoiceFor(order);
  };

  const closeInvoiceDialog = () => {
    if (invoiceSubmitting) return;
    setInvoiceFor(null);
    setInvoiceForm(emptyInvoiceForm);
    setInvoiceError("");
  };

  const handleInvoiceFieldChange = (e) => {
    const { name, value } = e.target;
    setInvoiceForm((prev) => ({ ...prev, [name]: value }));
  };

  const submitInvoiceDialog = async () => {
    if (!invoiceFor || invoiceSubmitting) return;
    setInvoiceSubmitting(true);
    setInvoiceError("");
    try {
      const result = await createInvoiceFromOrder(invoiceFor.id, invoiceForm);
      // Backend returns { invoice, order }; update local state to the
      // post-write rows so the list reflects status=invoiced and the
      // back-link without a manual refetch.
      if (result && result.order) {
        setOrders((prev) => prev.map((o) => (o.id === result.order.id ? result.order : o)));
      } else if (result && result.invoice) {
        // Fallback: if the backend omitted the order, optimistically flip
        // the local row with the known invoiceNo.
        setOrders((prev) =>
          prev.map((o) =>
            o.id === invoiceFor.id
              ? { ...o, status: "invoiced", invoiceNo: result.invoice.invoiceNo }
              : o
          )
        );
      }
      window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "orders" }));
      window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "invoices" }));
      const invoiceNo =
        (result && result.invoice && result.invoice.invoiceNo) || invoiceFor.invoiceNo;
      closeInvoiceDialog();
      if (invoiceNo) {
        navigate(`/invoice/${invoiceNo}/preview`);
      }
    } catch (err) {
      console.error("Failed to create invoice from order:", err);
      // Backend signals ORDER_ALREADY_INVOICED with body.invoiceNo so
      // the cashier can jump to the existing bill instead of seeing a
      // dead-end error.
      if (err && err.status === 409 && err.body && err.body.code === "ORDER_ALREADY_INVOICED") {
        const existing = err.body.invoiceNo;
        setOrders((prev) =>
          prev.map((o) =>
            o.id === invoiceFor.id ? { ...o, status: "invoiced", invoiceNo: existing } : o
          )
        );
        setInvoiceError(
          `This order was already billed as ${existing}. Opening the existing invoice.`
        );
        setTimeout(() => {
          closeInvoiceDialog();
          if (existing) navigate(`/invoice/${existing}/preview`);
        }, 1200);
        return;
      }
      setInvoiceError(err.message || "Failed to create invoice. Please try again.");
    } finally {
      setInvoiceSubmitting(false);
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
    const invoiced = orders.filter((o) => o.status === "invoiced").length;
    const totalHours = orders.reduce((s, o) => s + (Number(o.hours) || 0), 0);
    return { pending, inProgress, completed, invoiced, totalHours };
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
      invoiced: stats.invoiced,
    }),
    [orders, stats]
  );

  // F1: derive the catalog rate/GST for the dialog preview so the
  // cashier can sanity-check totals before they commit. Falls back to
  // the order's hours if the catalog has been deleted (mirrors the
  // backend's fall-back).
  const dialogCatalogPreview = useMemo(() => {
    if (!invoiceFor) return null;
    const svc = services.find(
      (s) => s.name === invoiceFor.service || String(s.id) === String(invoiceFor.service)
    );
    const rate = Number(svc?.rate) || 0;
    const hours = Number(invoiceFor.hours) || 0;
    const lineTotal = +(rate * hours).toFixed(2);
    const gstPct =
      invoiceForm.gstRate !== "" && invoiceForm.gstRate != null
        ? Number(invoiceForm.gstRate)
        : svc?.gst != null
          ? Number(svc.gst)
          : 0;
    const gstTotal = +((lineTotal * gstPct) / 100).toFixed(2);
    const grandTotal = +(lineTotal + gstTotal).toFixed(2);
    return { svc, rate, hours, lineTotal, gstPct, gstTotal, grandTotal };
  }, [invoiceFor, services, invoiceForm.gstRate]);

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
            {/* F1: chip row spans actionable statuses (the existing
                forward pipeline) plus invoiced so a cashier can quickly
                pull up jobs that are awaiting a bill OR have already
                been billed. */}
            {[...STATUS_FLOW, "invoiced"].map((s) => {
              const tone = STATUS_TONES[s];
              if (!tone) return null;
              return (
                <button
                  type="button"
                  key={s}
                  className={`sv-chip ${statusFilter === s ? "active" : ""}`}
                  onClick={() => setStatusFilter(s)}
                >
                  <span className="sv-chip-dot" style={{ background: tone.dot }} />
                  {STATUS_LABEL[s]} ({statusCounts[s] || 0})
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
                // F1: invoiced rows are terminal — the bill owns the
                // state from here on, so Start/Complete are suppressed
                // and Edit is replaced by a direct "View invoice" link.
                const isInvoiced = status === "invoiced" || Boolean(order.invoiceNo);
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
                            {isInvoiced && order.invoiceNo ? (
                              <>
                                <i> · </i>
                                <span className="so-invoice-ref">
                                  <FaReceipt /> {order.invoiceNo}
                                </span>
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
                        {STATUS_LABEL[status] || status}
                      </span>

                      <div className="so-quick-actions">
                        {/* F1: actionable rows get a primary "Create invoice"
                            button. Once invoiced, this slot flips to a
                            muted "View invoice" link that jumps straight
                            to the bill preview — the cashier should not
                            be generating a second bill from the same row. */}
                        {isInvoiced ? (
                          <button
                            type="button"
                            className="so-qa-btn invoiced"
                            onClick={() => navigate(`/invoice/${order.invoiceNo}/preview`)}
                            title={`Open bill ${order.invoiceNo}`}
                          >
                            <FaExternalLinkAlt /> View invoice
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="so-qa-btn bill"
                            onClick={() => openInvoiceDialog(order)}
                            title="Generate a bill from this order"
                            disabled={!ACTIONABLE_STATUSES.includes(status)}
                          >
                            <FaFileInvoiceDollar /> Create invoice
                          </button>
                        )}
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
                        {!isInvoiced && status !== "completed" && (
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

      {/* F1: "Create invoice" dialog. The bill is generated server-side
          via POST /api/orders/:id/invoice which atomically inserts the
          invoice row, flips the order status to 'invoiced', and stamps
          the invoice_no back-link in a single MySQL transaction. */}
      {invoiceFor && (
        <div
          className="so-invoice-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeInvoiceDialog();
          }}
        >
          <div className="so-invoice-dialog" role="dialog" aria-modal="true">
            <div className="so-invoice-head">
              <div>
                <h3>
                  <FaFileInvoiceDollar /> Create invoice from order
                </h3>
                <p>
                  A new bill will be generated for <strong>{invoiceFor.customer}</strong>
                  {invoiceFor.service ? (
                    <>
                      {" "}
                      · <span>{invoiceFor.service}</span>
                    </>
                  ) : null}{" "}
                  ({Number(invoiceFor.hours) || 0}h). Totals are derived from the service catalog
                  and the order hours.
                </p>
              </div>
              <button
                type="button"
                className="so-invoice-close"
                onClick={closeInvoiceDialog}
                aria-label="Close"
                disabled={invoiceSubmitting}
              >
                <FaTimes />
              </button>
            </div>

            <div className="so-invoice-body">
              {invoiceError && (
                <div
                  className={`sv-alert ${
                    invoiceError.includes("already billed") ? "sv-alert-info" : "sv-alert-danger"
                  }`}
                >
                  {invoiceError}
                </div>
              )}

              <div className="sv-field-row">
                <div className="sv-field">
                  <label htmlFor="inv-pm">Payment mode *</label>
                  <select
                    id="inv-pm"
                    className="sv-input sv-select"
                    name="paymentMode"
                    value={invoiceForm.paymentMode}
                    onChange={handleInvoiceFieldChange}
                  >
                    {PAYMENT_OPTIONS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sv-field">
                  <label htmlFor="inv-gst">GST rate (%)</label>
                  <input
                    id="inv-gst"
                    className="sv-input"
                    name="gstRate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={invoiceForm.gstRate}
                    onChange={handleInvoiceFieldChange}
                    placeholder="(use catalog rate)"
                  />
                </div>
              </div>

              <div className="sv-field-row">
                <div className="sv-field">
                  <label htmlFor="inv-email">Customer email</label>
                  <input
                    id="inv-email"
                    className="sv-input"
                    name="customerEmail"
                    type="email"
                    value={invoiceForm.customerEmail}
                    onChange={handleInvoiceFieldChange}
                    placeholder="(optional)"
                  />
                </div>
                <div className="sv-field">
                  <label htmlFor="inv-gstin">Customer GSTIN</label>
                  <input
                    id="inv-gstin"
                    className="sv-input"
                    name="customerGst"
                    value={invoiceForm.customerGst}
                    onChange={handleInvoiceFieldChange}
                    placeholder="(optional)"
                  />
                </div>
              </div>

              <div className="sv-field-row">
                <div className="sv-field">
                  <label htmlFor="inv-state">Customer state</label>
                  <input
                    id="inv-state"
                    className="sv-input"
                    name="customerState"
                    value={invoiceForm.customerState}
                    onChange={handleInvoiceFieldChange}
                    placeholder="(optional)"
                  />
                </div>
                <div className="sv-field">
                  <label htmlFor="inv-addr">Customer address</label>
                  <input
                    id="inv-addr"
                    className="sv-input"
                    name="customerAddress"
                    value={invoiceForm.customerAddress}
                    onChange={handleInvoiceFieldChange}
                    placeholder="(optional)"
                  />
                </div>
              </div>

              <div className="sv-field">
                <label htmlFor="inv-remarks">Remarks</label>
                <textarea
                  id="inv-remarks"
                  className="sv-input"
                  name="remarks"
                  rows={2}
                  value={invoiceForm.remarks}
                  onChange={handleInvoiceFieldChange}
                  placeholder="Note for the bill (optional)"
                />
              </div>

              {dialogCatalogPreview && (
                <div className="so-invoice-preview">
                  <div>
                    <span>Rate</span>
                    <strong>{formatCurrency(dialogCatalogPreview.rate)} / hr</strong>
                  </div>
                  <div>
                    <span>Hours</span>
                    <strong>{dialogCatalogPreview.hours}</strong>
                  </div>
                  <div>
                    <span>Subtotal</span>
                    <strong>{formatCurrency(dialogCatalogPreview.lineTotal)}</strong>
                  </div>
                  <div>
                    <span>GST ({dialogCatalogPreview.gstPct}%)</span>
                    <strong>{formatCurrency(dialogCatalogPreview.gstTotal)}</strong>
                  </div>
                  <div className="so-invoice-preview-total">
                    <span>Grand total</span>
                    <strong>{formatCurrency(dialogCatalogPreview.grandTotal)}</strong>
                  </div>
                </div>
              )}
            </div>

            <div className="so-invoice-foot">
              <button
                type="button"
                className="sv-btn sv-btn-ghost"
                onClick={closeInvoiceDialog}
                disabled={invoiceSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sv-btn sv-btn-primary"
                onClick={submitInvoiceDialog}
                disabled={invoiceSubmitting}
              >
                {invoiceSubmitting ? "Generating…" : "Generate invoice"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default ServiceOrderPage;
