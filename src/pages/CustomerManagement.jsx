import React, { useEffect, useState } from "react";
import { Modal, InputGroup } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import {
  FaPlus,
  FaTrash,
  FaEdit,
  FaSearch,
  FaUserTie,
  FaPhoneAlt,
  FaEnvelope,
  FaMapMarkerAlt,
  FaIdCard,
  FaStickyNote,
  FaArrowLeft,
  FaCheckCircle,
  FaCheck,
  FaTimes,
  FaBan,
  FaListUl,
  FaClock,
  FaTimesCircle,
  FaUsers,
  FaInbox,
  FaExclamationTriangle,
} from "react-icons/fa";
import {
  approveCustomer,
  createCustomer,
  deleteCustomer,
  getCustomers,
  searchCustomers,
  updateCustomer,
} from "../services/customerService";
import { getUserRole } from "../utils/auth";
import "./UserManagement.css";

const ADMIN_ROLES = new Set(["SUPER_OWNER", "STORE_ADMIN", "ADMIN"]);
const STATUS_FILTERS = ["all", "pending", "approved", "rejected"];

const STATUS_META = {
  all: { icon: FaListUl, label: "All" },
  pending: { icon: FaClock, label: "Pending", tone: "tone-amber" },
  approved: { icon: FaCheckCircle, label: "Approved", tone: "tone-emerald" },
  rejected: { icon: FaTimesCircle, label: "Rejected", tone: "tone-rose" },
};

const emptyForm = () => ({
  name: "",
  phone: "",
  email: "",
  address: "",
  gstin: "",
  notes: "",
});

const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
};

const StatusBadge = ({ status, reason }) => {
  if (!status) return null;
  const cls =
    status === "pending"
      ? "user-mgmt-status-pending"
      : status === "approved"
        ? "user-mgmt-status-approved"
        : "user-mgmt-status-rejected";
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  const title = status === "rejected" && reason ? `Rejected: ${reason}` : `Status: ${label}`;
  return (
    <span
      className={`user-mgmt-status-badge ${cls}`}
      title={title}
      data-testid={`customer-status-${status}`}
    >
      {label}
    </span>
  );
};

const CustomerManagement = () => {
  const navigate = useNavigate();
  const role = getUserRole();
  const canApprove = ADMIN_ROLES.has(role);
  // Cashiers see only approved rows by default; admins start on "all" so
  // they can spot pending work without an extra click.
  const [statusFilter, setStatusFilter] = useState(canApprove ? "all" : "approved");

  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null); // null = creating
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);

  // Reject modal state.
  const [rejectTarget, setRejectTarget] = useState(null); // customer object
  const [rejectReason, setRejectReason] = useState("");

  // Confirm modal — replaces the inline "click delete twice" pattern.
  // Behaves identically (two-step confirm) but works on touch / mobile.
  const [confirmDeleteTarget, setConfirmDeleteTarget] = useState(null);

  // Debounce search input → server query.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadCustomers = async () => {
    setLoading(true);
    setError("");
    try {
      const list = debouncedSearch
        ? await searchCustomers({ name: debouncedSearch })
        : await getCustomers();
      setCustomers(Array.isArray(list) ? list : []);
    } catch (err) {
      setError(err.message || "Failed to load customers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let inFlight = false;
    let pending = false;
    const loadCoalesced = async () => {
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      try {
        await loadCustomers();
      } finally {
        inFlight = false;
        if (pending) {
          pending = false;
          loadCoalesced();
        }
      }
    };
    loadCoalesced();
    const onDataUpdated = (event) => {
      if (event.detail === "customers") loadCoalesced();
    };
    window.addEventListener("dataUpdated", onDataUpdated);
    return () => window.removeEventListener("dataUpdated", onDataUpdated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setShowModal(true);
  };

  const openEdit = (customer) => {
    setEditing(customer);
    setForm({
      name: customer.name || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: customer.address || "",
      gstin: customer.gstin || "",
      notes: customer.notes || "",
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditing(null);
    setForm(emptyForm());
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) {
        await updateCustomer(editing.id, form);
      } else {
        await createCustomer(form);
      }
      closeModal();
      await loadCustomers();
    } catch (err) {
      setError(err.message || "Failed to save customer");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDeleteTarget) return;
    setSaving(true);
    setError("");
    try {
      await deleteCustomer(confirmDeleteTarget.id);
      setConfirmDeleteTarget(null);
      await loadCustomers();
    } catch (err) {
      setError(err.message || "Failed to delete customer");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (customer) => {
    setError("");
    try {
      await approveCustomer(customer.id, { status: "approved" });
      await loadCustomers();
    } catch (err) {
      setError(err.message || "Failed to approve customer");
    }
  };

  const openReject = (customer) => {
    setRejectTarget(customer);
    setRejectReason("");
  };

  const closeReject = () => {
    setRejectTarget(null);
    setRejectReason("");
  };

  const handleReject = async (e) => {
    e.preventDefault();
    const reason = rejectReason.trim();
    if (!reason) {
      setError("Rejection reason is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await approveCustomer(rejectTarget.id, { status: "rejected", reason });
      closeReject();
      await loadCustomers();
    } catch (err) {
      setError(err.message || "Failed to reject customer");
    } finally {
      setSaving(false);
    }
  };

  const filteredCustomers =
    statusFilter === "all"
      ? customers
      : customers.filter((c) => (c.approvalStatus || "approved") === statusFilter);

  const counts = STATUS_FILTERS.reduce((acc, k) => {
    acc[k] =
      k === "all"
        ? customers.length
        : customers.filter((c) => (c.approvalStatus || "approved") === k).length;
    return acc;
  }, {});

  const totalCount = customers.length;

  return (
    <div className="user-mgmt-page">
      <div className="user-mgmt-shell">
        <button
          type="button"
          className="user-mgmt-back"
          onClick={() => navigate(canApprove ? "/dashboard" : "/pos")}
          aria-label="Back"
        >
          <FaArrowLeft /> Back
        </button>

        <header className="user-mgmt-hero">
          <div className="user-mgmt-hero-meta">
            <span className="user-mgmt-hero-eyebrow">SERVICE STORE · CUSTOMERS</span>
            <h1 className="user-mgmt-hero-title">
              <FaUsers className="user-mgmt-hero-title-icon" /> Customers
            </h1>
            <p className="user-mgmt-hero-subtitle">
              Manage customer records for repeat visits, udhaar ledger, and refunds.
              {!canApprove &&
                " New customers you submit are reviewed by an Admin before they can be billed."}
            </p>
          </div>
          <div className="user-mgmt-hero-actions">
            <button type="button" className="user-mgmt-cta" onClick={openCreate}>
              <FaPlus /> {canApprove ? "New Customer" : "Submit Customer"}
            </button>
          </div>
        </header>

        <section className="user-mgmt-stats" aria-label="Customer overview">
          <article className="user-mgmt-stat tone-indigo">
            <div className="user-mgmt-stat-body">
              <span className="user-mgmt-stat-label">Total customers</span>
              <span className="user-mgmt-stat-value">{totalCount}</span>
            </div>
            <div className="user-mgmt-stat-icon" aria-hidden="true">
              <FaUsers />
            </div>
          </article>
          {canApprove && (
            <>
              <article className="user-mgmt-stat tone-amber">
                <div className="user-mgmt-stat-body">
                  <span className="user-mgmt-stat-label">Pending review</span>
                  <span className="user-mgmt-stat-value">{counts.pending}</span>
                </div>
                <div className="user-mgmt-stat-icon" aria-hidden="true">
                  <FaClock />
                </div>
              </article>
              <article className="user-mgmt-stat tone-emerald">
                <div className="user-mgmt-stat-body">
                  <span className="user-mgmt-stat-label">Approved</span>
                  <span className="user-mgmt-stat-value">{counts.approved}</span>
                </div>
                <div className="user-mgmt-stat-icon" aria-hidden="true">
                  <FaCheckCircle />
                </div>
              </article>
              <article className="user-mgmt-stat tone-rose">
                <div className="user-mgmt-stat-body">
                  <span className="user-mgmt-stat-label">Rejected</span>
                  <span className="user-mgmt-stat-value">{counts.rejected}</span>
                </div>
                <div className="user-mgmt-stat-icon" aria-hidden="true">
                  <FaTimesCircle />
                </div>
              </article>
            </>
          )}
        </section>

        <div className="user-mgmt-toolbar">
          <InputGroup className="user-mgmt-search">
            <InputGroup.Text className="user-mgmt-search-prepend">
              <FaSearch />
            </InputGroup.Text>
            <input
              type="search"
              className="form-control user-mgmt-search-input"
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search customers"
            />
            {search && (
              <button
                type="button"
                className="user-mgmt-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                Clear
              </button>
            )}
          </InputGroup>
          <div className="user-mgmt-toolbar-meta">
            <span className="user-mgmt-toolbar-meta-pill">
              {filteredCustomers.length} of {totalCount}
            </span>
          </div>
        </div>

        {canApprove && (
          <div className="user-mgmt-tabs" role="tablist" aria-label="Filter customers by status">
            {STATUS_FILTERS.map((key) => {
              const meta = STATUS_META[key] || STATUS_META.all;
              const Icon = meta.icon;
              const tone = meta.tone ? `tone-${meta.tone}` : "";
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={statusFilter === key}
                  className={`user-mgmt-tab${statusFilter === key ? " is-active" : ""} ${tone}`.trim()}
                  onClick={() => setStatusFilter(key)}
                >
                  <Icon className="user-mgmt-tab-icon" aria-hidden="true" />
                  <span>{meta.label}</span>
                  <span className="user-mgmt-tab-count">{counts[key]}</span>
                </button>
              );
            })}
          </div>
        )}

        {error && (
          <div className="user-mgmt-error" role="alert">
            <FaExclamationTriangle /> {error}
          </div>
        )}

        <div className="user-mgmt-card">
          <div className="user-mgmt-card-head">
            <div className="user-mgmt-card-title">
              <FaUserTie className="user-mgmt-card-title-icon" aria-hidden="true" />
              <div>
                <h2>Customer directory</h2>
                <p>
                  {canApprove
                    ? "Same-store visibility across cashiers and admins. Pending rows can be approved or rejected from the actions menu."
                    : "Approved customers are visible here. Submissions stay pending until an admin approves them."}
                </p>
              </div>
            </div>
          </div>

          <div className="user-mgmt-table-wrap">
            <table className="user-mgmt-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Phone</th>
                  <th scope="col">Email</th>
                  <th scope="col">GSTIN</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created by</th>
                  {canApprove && <th scope="col">Approved by</th>}
                  <th scope="col">Added</th>
                  <th scope="col" className="user-mgmt-actions-col" aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={canApprove ? 9 : 8} className="user-mgmt-empty">
                      <span className="user-mgmt-spinner" aria-hidden="true" />
                      <span>Loading customers…</span>
                    </td>
                  </tr>
                ) : filteredCustomers.length === 0 ? (
                  <tr>
                    <td colSpan={canApprove ? 9 : 8} className="user-mgmt-empty">
                      <FaInbox className="user-mgmt-empty-icon" aria-hidden="true" />
                      <p>
                        {search
                          ? `No customers match “${search}”.`
                          : statusFilter === "pending"
                            ? "No pending customers to review."
                            : "No customers yet. Click Submit Customer to add one."}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredCustomers.map((c) => {
                    const status = c.approvalStatus || "approved";
                    const isPending = status === "pending";
                    return (
                      <tr key={c.id} className="user-mgmt-row">
                        <td>
                          <div className="user-mgmt-customer-name">{c.name}</div>
                        </td>
                        <td>
                          {c.phone ? (
                            <span className="user-mgmt-cell-stack">
                              <FaPhoneAlt className="user-mgmt-cell-icon" aria-hidden="true" />
                              <span>{c.phone}</span>
                            </span>
                          ) : (
                            <span className="user-mgmt-muted">—</span>
                          )}
                        </td>
                        <td>
                          {c.email ? (
                            <span className="user-mgmt-cell-stack">
                              <FaEnvelope className="user-mgmt-cell-icon" aria-hidden="true" />
                              <span>{c.email}</span>
                            </span>
                          ) : (
                            <span className="user-mgmt-muted">—</span>
                          )}
                        </td>
                        <td className="user-mgmt-gstin">
                          {c.gstin || <span className="user-mgmt-muted">—</span>}
                        </td>
                        <td>
                          <StatusBadge status={status} reason={c.rejectionReason} />
                        </td>
                        <td>
                          <div className="user-mgmt-cell-stack">
                            <span title={c.createdByEmail || ""}>
                              {c.createdByEmail || <span className="user-mgmt-muted">—</span>}
                            </span>
                            <span className="user-mgmt-muted">{formatDate(c.createdAt)}</span>
                          </div>
                        </td>
                        {canApprove && (
                          <td>
                            {status === "approved" && c.approvedByEmail ? (
                              <div className="user-mgmt-cell-stack">
                                <span title={c.approvedByEmail}>{c.approvedByEmail}</span>
                                <span className="user-mgmt-muted">{formatDate(c.approvedAt)}</span>
                              </div>
                            ) : status === "rejected" && c.rejectedByEmail ? (
                              <div className="user-mgmt-cell-stack">
                                <span title={c.rejectedByEmail}>{c.rejectedByEmail}</span>
                                <span className="user-mgmt-muted">{formatDate(c.rejectedAt)}</span>
                              </div>
                            ) : (
                              <span className="user-mgmt-muted">—</span>
                            )}
                          </td>
                        )}
                        <td>{formatDate(c.createdAt)}</td>
                        <td className="user-mgmt-actions-col">
                          <div className="user-mgmt-actions">
                            {canApprove && isPending && (
                              <>
                                <button
                                  type="button"
                                  className="user-mgmt-action-btn user-mgmt-approve"
                                  onClick={() => handleApprove(c)}
                                  aria-label={`Approve ${c.name}`}
                                  title="Approve"
                                >
                                  <FaCheck />
                                </button>
                                <button
                                  type="button"
                                  className="user-mgmt-action-btn user-mgmt-reject"
                                  onClick={() => openReject(c)}
                                  aria-label={`Reject ${c.name}`}
                                  title="Reject"
                                >
                                  <FaTimes />
                                </button>
                              </>
                            )}
                            {canApprove && (
                              <>
                                <button
                                  type="button"
                                  className="user-mgmt-action-btn"
                                  onClick={() => openEdit(c)}
                                  aria-label={`Edit ${c.name}`}
                                  title="Edit"
                                >
                                  <FaEdit />
                                </button>
                                <button
                                  type="button"
                                  className="user-mgmt-action-btn user-mgmt-danger"
                                  onClick={() => setConfirmDeleteTarget(c)}
                                  aria-label={`Delete ${c.name}`}
                                  title="Delete"
                                >
                                  <FaTrash />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <Modal show={showModal} onHide={closeModal} centered className="user-mgmt-modal">
        <Modal.Header closeButton className="user-mgmt-modal-header">
          <Modal.Title>
            <FaUserTie />{" "}
            {editing ? `Edit ${editing.name}` : canApprove ? "New Customer" : "Submit Customer"}
          </Modal.Title>
        </Modal.Header>
        <form onSubmit={handleSubmit}>
          <Modal.Body className="user-mgmt-modal-body">
            <div className="user-mgmt-form-row">
              <label className="user-mgmt-form-label">
                <FaUserTie /> Name <span className="user-mgmt-required">*</span>
              </label>
              <input
                type="text"
                className="form-control user-mgmt-input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                maxLength={120}
                required
              />
            </div>
            <div className="user-mgmt-form-row">
              <label className="user-mgmt-form-label">
                <FaPhoneAlt /> Phone
              </label>
              <input
                type="tel"
                className="form-control user-mgmt-input"
                value={form.phone}
                onChange={(e) =>
                  setForm((f) => ({ ...f, phone: e.target.value.replace(/[^\d+\-\s()]/g, "") }))
                }
                maxLength={20}
                placeholder="+91 …"
              />
            </div>
            <div className="user-mgmt-form-row">
              <label className="user-mgmt-form-label">
                <FaEnvelope /> Email
              </label>
              <input
                type="email"
                className="form-control user-mgmt-input"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                maxLength={120}
              />
            </div>
            <div className="user-mgmt-form-row">
              <label className="user-mgmt-form-label">
                <FaMapMarkerAlt /> Address
              </label>
              <textarea
                className="form-control user-mgmt-input"
                rows={2}
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                maxLength={300}
              />
            </div>
            <div className="user-mgmt-form-row">
              <label className="user-mgmt-form-label">
                <FaIdCard /> GSTIN
              </label>
              <input
                type="text"
                className="form-control user-mgmt-input user-mgmt-input-mono"
                value={form.gstin}
                onChange={(e) => setForm((f) => ({ ...f, gstin: e.target.value.toUpperCase() }))}
                maxLength={15}
                placeholder="27ABCDE1234F1Z5"
              />
            </div>
            <div className="user-mgmt-form-row">
              <label className="user-mgmt-form-label">
                <FaStickyNote /> Notes
              </label>
              <textarea
                className="form-control user-mgmt-input"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                maxLength={500}
              />
            </div>
          </Modal.Body>
          <Modal.Footer className="user-mgmt-modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary user-mgmt-btn-ghost"
              onClick={closeModal}
            >
              Cancel
            </button>
            <button type="submit" className="user-mgmt-cta user-mgmt-cta-md" disabled={saving}>
              {saving
                ? "Saving…"
                : editing
                  ? "Save changes"
                  : canApprove
                    ? "Create customer"
                    : "Submit for approval"}
            </button>
          </Modal.Footer>
        </form>
      </Modal>

      <Modal show={Boolean(rejectTarget)} onHide={closeReject} centered className="user-mgmt-modal">
        <Modal.Header closeButton className="user-mgmt-modal-header">
          <Modal.Title>
            <FaBan /> Reject {rejectTarget ? rejectTarget.name : ""}
          </Modal.Title>
        </Modal.Header>
        <form onSubmit={handleReject}>
          <Modal.Body className="user-mgmt-modal-body">
            <p className="user-mgmt-modal-note">
              Tell the submitter why this customer can&apos;t be approved. The reason is visible to
              admins and persisted in the audit log.
            </p>
            <div className="user-mgmt-form-row">
              <label className="user-mgmt-form-label">
                Rejection reason <span className="user-mgmt-required">*</span>
              </label>
              <textarea
                className="form-control user-mgmt-input"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                maxLength={500}
                required
              />
            </div>
          </Modal.Body>
          <Modal.Footer className="user-mgmt-modal-footer">
            <button
              type="button"
              className="btn btn-outline-secondary user-mgmt-btn-ghost"
              onClick={closeReject}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="user-mgmt-cta user-mgmt-cta-md user-mgmt-cta-danger"
              disabled={saving || !rejectReason.trim()}
            >
              {saving ? "Rejecting…" : "Reject customer"}
            </button>
          </Modal.Footer>
        </form>
      </Modal>

      <Modal
        show={Boolean(confirmDeleteTarget)}
        onHide={() => setConfirmDeleteTarget(null)}
        centered
        className="user-mgmt-modal user-mgmt-confirm-modal"
      >
        <Modal.Header closeButton className="user-mgmt-modal-header">
          <Modal.Title>
            <FaTrash /> Delete customer
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="user-mgmt-modal-body">
          <div className="user-mgmt-confirm-summary">
            <p>
              You are about to permanently delete{" "}
              <strong>{confirmDeleteTarget ? confirmDeleteTarget.name : ""}</strong>. This removes
              the customer record and any local links to it.
            </p>
          </div>
        </Modal.Body>
        <Modal.Footer className="user-mgmt-modal-footer">
          <button
            type="button"
            className="btn btn-outline-secondary user-mgmt-btn-ghost"
            onClick={() => setConfirmDeleteTarget(null)}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="user-mgmt-cta user-mgmt-cta-md user-mgmt-cta-danger"
            onClick={handleDelete}
            disabled={saving}
          >
            {saving ? "Deleting…" : "Delete customer"}
          </button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default CustomerManagement;
