import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/layout/Layout";
import {
  FaConciergeBell,
  FaPlus,
  FaEdit,
  FaTrash,
  FaRupeeSign,
  FaClock,
  FaSearch,
  FaPercent,
  FaTags,
  FaChartLine,
  FaHistory,
  FaTimes,
  FaArrowUp,
  FaArrowDown,
  FaEquals,
  FaUserCircle,
  FaSpinner,
} from "react-icons/fa";
import {
  loadServices,
  createService,
  updateService,
  deleteService,
  getServiceRateHistory,
} from "../services/serviceService";
import { useUi } from "../context/UiContext";
import { CATEGORY_TONES, SERVICE_CATEGORIES, formatCurrency } from "../utils/serviceTones";
import "./ServiceManagementPage.css";

const emptyForm = {
  id: null,
  name: "",
  description: "",
  rate: "",
  hours: "",
  gst: "",
  category: "Consulting",
};

const ServiceManagementPage = () => {
  const [services, setServices] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  // F6: rate-history drawer state.
  const [historyFor, setHistoryFor] = useState(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [historyError, setHistoryError] = useState("");

  const { activeStore } = useUi();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const data = await loadServices();
      if (!cancelled) setServices(Array.isArray(data) ? data : []);
    };
    load();
    const onServicesUpdated = () => load();
    window.addEventListener("servicesUpdated", onServicesUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("servicesUpdated", onServicesUpdated);
    };
  }, [activeStore]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name || !form.rate || !form.hours) {
      setError("Service name, rate, and hours are required.");
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description?.trim() || "",
      rate: Number(form.rate),
      hours: Number(form.hours),
      gst: form.gst === "" ? 18 : Number(form.gst),
      category: form.category || "Other",
    };

    try {
      if (editing && form.id) {
        const updated = await updateService({ id: form.id, ...payload });
        setServices((prev) => prev.map((s) => (s.id === form.id ? { ...s, ...updated } : s)));
      } else {
        const created = await createService(payload);
        setServices((prev) => [...prev, created]);
      }
      // Tell other tabs/pages (e.g. ServiceBilling POS) to refetch
      window.dispatchEvent(new CustomEvent("servicesUpdated"));
      setForm(emptyForm);
      setEditing(false);
    } catch (err) {
      console.error("Failed to save service:", err);
      setError(err.message || "Unable to save service. Please try again.");
    }
  };

  const handleEdit = (svc) => {
    setForm({
      id: svc.id,
      name: svc.name || "",
      description: svc.description || "",
      rate: svc.rate ?? "",
      hours: svc.hours ?? "",
      gst: svc.gst ?? "",
      category: svc.category || "Other",
    });
    setEditing(true);
    // Scroll to form
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDelete = async (svc) => {
    if (!window.confirm(`Delete "${svc.name}"?`)) return;
    try {
      await deleteService(svc.id);
      setServices((prev) => prev.filter((s) => s.id !== svc.id));
      window.dispatchEvent(new CustomEvent("servicesUpdated"));
    } catch (err) {
      console.error("Failed to delete service:", err);
      setError(err.message || "Unable to delete service. Please try again.");
    }
  };

  const handleCancel = () => {
    setForm(emptyForm);
    setEditing(false);
    setError("");
  };

  // F6: open the rate-history drawer for a service. Fetches the first
  // page of entries (default 50) from GET /api/services/:id/rate-history
  // and renders them in chronological order, newest first. The drawer
  // is local-state only — closing it discards the entries.
  const openRateHistory = async (svc) => {
    setHistoryFor(svc);
    setHistoryEntries([]);
    setHistoryError("");
    setHistoryLoading(true);
    try {
      const data = await getServiceRateHistory(svc.id, { limit: 50 });
      setHistoryEntries(Array.isArray(data?.entries) ? data.entries : []);
    } catch (err) {
      console.error("Failed to load rate history:", err);
      setHistoryError(err.message || "Failed to load history. Please try again.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeRateHistory = () => {
    setHistoryFor(null);
    setHistoryEntries([]);
    setHistoryError("");
    setHistoryLoading(false);
  };

  const stats = useMemo(() => {
    if (services.length === 0) {
      return { count: 0, avgRate: 0, avgHours: 0 };
    }
    const totalRate = services.reduce((s, x) => s + Number(x.rate || 0), 0);
    const totalHours = services.reduce((s, x) => s + Number(x.hours || 0), 0);
    return {
      count: services.length,
      avgRate: Math.round(totalRate / services.length),
      avgHours: (totalHours / services.length).toFixed(1),
    };
  }, [services]);

  const filteredServices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return services.filter((svc) => {
      if (categoryFilter !== "ALL" && (svc.category || "Other") !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [svc.name, svc.description, svc.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [services, search, categoryFilter]);

  return (
    <Layout>
      <div className="sv-page service-mgmt-page">
        {/* HERO */}
        <div className="sv-hero">
          <div className="sv-hero-bg" aria-hidden="true" />
          <div className="sv-hero-content">
            <div className="sv-hero-text">
              <div className="sv-hero-eyebrow">
                <FaConciergeBell />
                <span>Service industry</span>
              </div>
              <h1 className="sv-hero-title">Service Catalog</h1>
              <p className="sv-hero-subtitle">
                Curate the services you offer, set your hourly rate, and keep GST consistent across
                every bill. Items added here appear instantly on the Service POS screen.
              </p>
            </div>
          </div>
        </div>

        {/* STATS */}
        <div className="sv-stats">
          <div className="sv-stat-card tone-violet">
            <div className="sv-stat-icon">
              <FaConciergeBell />
            </div>
            <div className="sv-stat-meta">
              <span>Services</span>
              <strong>{stats.count}</strong>
            </div>
          </div>
          <div className="sv-stat-card tone-emerald">
            <div className="sv-stat-icon">
              <FaRupeeSign />
            </div>
            <div className="sv-stat-meta">
              <span>Avg. rate</span>
              <strong>{formatCurrency(stats.avgRate)}</strong>
            </div>
          </div>
          <div className="sv-stat-card tone-amber">
            <div className="sv-stat-icon">
              <FaClock />
            </div>
            <div className="sv-stat-meta">
              <span>Avg. duration</span>
              <strong>{stats.avgHours}h</strong>
            </div>
          </div>
        </div>

        {/* FORM PANEL */}
        <div className="sv-panel sv-form-panel">
          <div className="sv-panel-head">
            <div>
              <h2 className="sv-panel-title">{editing ? "Edit service" : "Add a new service"}</h2>
              <p className="sv-panel-sub">
                Fill in the basics — fields marked with * are required.
              </p>
            </div>
            {editing && <span className="sv-editing-badge">Editing #{form.id}</span>}
          </div>

          {error && <div className="sv-alert sv-alert-danger">{error}</div>}

          <form className="sv-form" onSubmit={handleSubmit}>
            <div className="sv-field">
              <label htmlFor="sv-name">Service name *</label>
              <input
                id="sv-name"
                name="name"
                value={form.name}
                onChange={handleChange}
                placeholder="e.g. AC Repair"
                className="sv-input"
              />
            </div>

            <div className="sv-field">
              <label htmlFor="sv-desc">Short description</label>
              <input
                id="sv-desc"
                name="description"
                value={form.description}
                onChange={handleChange}
                placeholder="What does this service cover?"
                className="sv-input"
              />
            </div>

            <div className="sv-field-row">
              <div className="sv-field">
                <label htmlFor="sv-rate">Rate (₹) *</label>
                <input
                  id="sv-rate"
                  name="rate"
                  type="number"
                  min="0"
                  value={form.rate}
                  onChange={handleChange}
                  placeholder="500"
                  className="sv-input"
                />
              </div>
              <div className="sv-field">
                <label htmlFor="sv-hours">Hours / units *</label>
                <input
                  id="sv-hours"
                  name="hours"
                  type="number"
                  min="0"
                  step="0.5"
                  value={form.hours}
                  onChange={handleChange}
                  placeholder="2"
                  className="sv-input"
                />
              </div>
              <div className="sv-field">
                <label htmlFor="sv-gst">GST %</label>
                <input
                  id="sv-gst"
                  name="gst"
                  type="number"
                  min="0"
                  max="100"
                  value={form.gst}
                  onChange={handleChange}
                  placeholder="18"
                  className="sv-input"
                />
              </div>
              <div className="sv-field">
                <label htmlFor="sv-cat">Category</label>
                <select
                  id="sv-cat"
                  name="category"
                  value={form.category}
                  onChange={handleChange}
                  className="sv-input sv-select"
                >
                  {SERVICE_CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="sv-form-actions">
              <button type="submit" className="sv-btn sv-btn-primary">
                <FaPlus /> {editing ? "Update service" : "Add service"}
              </button>
              {editing && (
                <button type="button" className="sv-btn sv-btn-ghost" onClick={handleCancel}>
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        {/* LIST PANEL */}
        <div className="sv-panel sv-list-panel">
          <div className="sv-panel-head">
            <div>
              <h2 className="sv-panel-title">Your services</h2>
              <p className="sv-panel-sub">
                {filteredServices.length} {filteredServices.length === 1 ? "service" : "services"}{" "}
                in your catalog
              </p>
            </div>

            <div className="sv-search">
              <FaSearch />
              <input
                type="text"
                placeholder="Search services…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search services"
              />
            </div>
          </div>

          <div className="sv-chip-row sv-filter-chips">
            <button
              type="button"
              className={`sv-chip ${categoryFilter === "ALL" ? "active" : ""}`}
              onClick={() => setCategoryFilter("ALL")}
            >
              <FaTags /> All
            </button>
            {SERVICE_CATEGORIES.map((c) => (
              <button
                type="button"
                key={c.value}
                className={`sv-chip ${categoryFilter === c.value ? "active" : ""}`}
                onClick={() => setCategoryFilter(c.value)}
              >
                {c.label}
              </button>
            ))}
          </div>

          {filteredServices.length === 0 ? (
            <div className="sv-empty">
              <div className="sv-empty-icon">
                <FaConciergeBell />
              </div>
              <strong>No services yet</strong>
              <span>Add your first service using the form above.</span>
            </div>
          ) : (
            <div className="sv-grid">
              {filteredServices.map((svc) => {
                const tone = CATEGORY_TONES[svc.category || "Other"] || CATEGORY_TONES.Other;
                const amount = (Number(svc.rate) || 0) * (Number(svc.hours) || 0);
                return (
                  <div key={svc.id} className="sv-card" style={{ "--card-accent": tone.color }}>
                    <div className="sv-card-head">
                      <span
                        className="sv-cat-pill"
                        style={{ background: tone.bg, color: tone.color }}
                      >
                        {svc.category || "Other"}
                      </span>
                      <div className="sv-card-actions">
                        <button
                          type="button"
                          className="sv-icon-btn"
                          onClick={() => openRateHistory(svc)}
                          aria-label="View rate history"
                          title="View rate history"
                        >
                          <FaHistory />
                        </button>
                        <button
                          type="button"
                          className="sv-icon-btn"
                          onClick={() => handleEdit(svc)}
                          aria-label="Edit"
                          title="Edit"
                        >
                          <FaEdit />
                        </button>
                        <button
                          type="button"
                          className="sv-icon-btn danger"
                          onClick={() => handleDelete(svc)}
                          aria-label="Delete"
                          title="Delete"
                        >
                          <FaTrash />
                        </button>
                      </div>
                    </div>

                    <h3 className="sv-card-title">{svc.name}</h3>
                    {svc.description && <p className="sv-card-desc">{svc.description}</p>}

                    <div className="sv-card-meta">
                      <div className="sv-meta-item">
                        <span>Rate</span>
                        <strong>{formatCurrency(svc.rate)}</strong>
                      </div>
                      <div className="sv-meta-item">
                        <span>
                          <FaClock /> Hours
                        </span>
                        <strong>{svc.hours}</strong>
                      </div>
                      <div className="sv-meta-item">
                        <span>
                          <FaPercent /> GST
                        </span>
                        <strong>{Number(svc.gst || 0)}%</strong>
                      </div>
                    </div>

                    <div className="sv-card-foot">
                      <span className="sv-amount-label">
                        <FaChartLine /> Estimated total
                      </span>
                      <span className="sv-amount">{formatCurrency(amount)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* F6: Rate-history drawer. Renders one entry per PUT that changed
          rate / hours / gst on the selected service. Entries are pulled
          on open (default 50) and discarded on close — the drawer is
          local-state only, no caching, no SSE subscription. */}
      {historyFor && (
        <div
          className="sv-history-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeRateHistory();
          }}
        >
          <div className="sv-history-drawer" role="dialog" aria-modal="true">
            <div className="sv-history-head">
              <div>
                <h3>
                  <FaHistory /> Rate history — {historyFor.name}
                </h3>
                <p>
                  Every change to this service's rate, hours, or GST is logged here. The audit trail
                  stays even if the service is later deleted.
                </p>
              </div>
              <button
                type="button"
                className="sv-history-close"
                onClick={closeRateHistory}
                aria-label="Close"
              >
                <FaTimes />
              </button>
            </div>

            <div className="sv-history-body">
              {historyLoading && (
                <div className="sv-history-loading">
                  <FaSpinner /> Loading history…
                </div>
              )}
              {historyError && <div className="sv-alert sv-alert-danger">{historyError}</div>}
              {!historyLoading && !historyError && historyEntries.length === 0 && (
                <div className="sv-history-empty">
                  <FaHistory />
                  <strong>No rate changes yet</strong>
                  <span>Edits to rate, hours, or GST will appear here automatically.</span>
                </div>
              )}
              {!historyLoading && historyEntries.length > 0 && (
                <ol className="sv-history-list">
                  {historyEntries.map((entry) => (
                    <li key={entry.id} className="sv-history-row">
                      <div className="sv-history-when">
                        <strong>{formatHistoryTimestamp(entry.changedAt)}</strong>
                        <span>
                          <FaUserCircle /> {entry.changedByEmail || "Unknown user"}
                        </span>
                      </div>
                      <div className="sv-history-fields">
                        {entry.oldRate !== entry.newRate &&
                          renderFieldDiff(
                            "Rate",
                            formatCurrency(entry.oldRate),
                            formatCurrency(entry.newRate)
                          )}
                        {entry.oldGst !== entry.newGst &&
                          renderFieldDiff("GST", `${entry.oldGst ?? 0}%`, `${entry.newGst ?? 0}%`)}
                        {entry.oldHours !== entry.newHours &&
                          renderFieldDiff("Hours", entry.oldHours ?? 0, entry.newHours ?? 0)}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

// F6 helpers: tiny pure formatters used by the drawer. Defined outside
// the component so they aren't re-created on every render.

function formatHistoryTimestamp(value) {
  if (!value) return "—";
  // mysql2 returns DATETIME(3) as a JS Date string in the pool's local TZ;
  // Date.parse handles both ISO and "YYYY-MM-DD HH:mm:ss.SSS" shapes.
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderFieldDiff(label, oldValue, newValue) {
  const oldN = Number(oldValue);
  const newN = Number(newValue);
  let icon = <FaEquals />;
  let tone = "flat";
  if (Number.isFinite(oldN) && Number.isFinite(newN)) {
    if (newN > oldN) {
      icon = <FaArrowUp />;
      tone = "up";
    } else if (newN < oldN) {
      icon = <FaArrowDown />;
      tone = "down";
    }
  }
  return (
    <div className={`sv-history-field tone-${tone}`}>
      <span className="sv-history-field-label">{label}</span>
      <span className="sv-history-field-old">{oldValue}</span>
      <span className="sv-history-field-arrow">{icon}</span>
      <span className="sv-history-field-new">{newValue}</span>
    </div>
  );
}

export default ServiceManagementPage;
