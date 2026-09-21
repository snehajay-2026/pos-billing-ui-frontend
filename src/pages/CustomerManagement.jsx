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
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // Reject modal state.
  const [rejectTarget, setRejectTarget] = useState(null); // customer object
  const [rejectReason, setRejectReason] = useState("");

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

  const handleDelete = async (id) => {
    setSaving(true);
    setError("");
    try {
      await deleteCustomer(id);
      setConfirmDeleteId(null);
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
  // Placeholder for the follow-on credit/udhaar ledger slice. The count
  // itself is wired today (counts every customer), but the math isn't.
  const outstandingCount = 0;

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

        <header className="user-mgmt-header">
          <div className="user-mgmt-title">
            <FaUserTie />
            <div>
              <h1>Customers</h1>
              <p>
                Manage customer records for repeat visits, udhaar ledger, and refunds.
                {!canApprove &&
                  " New customers you submit are reviewed by an Admin before they can be billed."}
              </p>
            </div>
          </div>
          <div className="user-mgmt-stats">
            <div className="user-mgmt-stat">
              <span className="user-mgmt-stat-label">Total</span>
              <span className="user-mgmt-stat-value">{totalCount}</span>
            </div>
            <div
              className="user-mgmt-stat"
              title="Outstanding balance — wired in the follow-on ledger slice"
            >
              <span className="user-mgmt-stat-label">Outstanding</span>
              <span className="user-mgmt-stat-value">{outstandingCount}</span>
            </div>
            <button type="button" className="btn btn-primary" onClick={openCreate}>
              <FaPlus /> {canApprove ? "New Customer" : "Submit Customer"}
            </button>
          </div>
        </header>

        <div className="user-mgmt-toolbar">
          <InputGroup className="user-mgmt-search">
            <InputGroup.Text>
              <FaSearch />
            </InputGroup.Text>
            <input
              type="search"
              className="form-control"
              placeholder="Search by name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
        </div>

        {canApprove && (
          <div className="user-mgmt-tabs" role="tablist" aria-label="Filter customers by status">
            {STATUS_FILTERS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={statusFilter === key}
                className={`user-mgmt-tab${statusFilter === key ? " is-active" : ""}`}
                onClick={() => setStatusFilter(key)}
              >
                {key.charAt(0).toUpperCase() + key.slice(1)}
                <span className="user-mgmt-tab-count">{counts[key]}</span>
              </button>
            ))}
          </div>
        )}

        {error && <div className="user-mgmt-error">{error}</div>}

        <div className="user-mgmt-card">
          <table className="user-mgmt-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>GSTIN</th>
                <th>Status</th>
                <th>Created by</th>
                {canApprove && <th>Approved by</th>}
                <th>Added</th>
                <th aria-label="Actions"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canApprove ? 9 : 8} className="user-mgmt-empty">
                    Loading…
                  </td>
                </tr>
              ) : filteredCustomers.length === 0 ? (
                <tr>
                  <td colSpan={canApprove ? 9 : 8} className="user-mgmt-empty">
                    {search
                      ? `No customers match “${search}”.`
                      : statusFilter === "pending"
                        ? "No pending customers to review."
                        : "No customers yet. Click Submit Customer to add one."}
                  </td>
                </tr>
              ) : (
                filteredCustomers.map((c) => {
                  const status = c.approvalStatus || "approved";
                  const isPending = status === "pending";
                  return (
                    <tr key={c.id}>
                      <td>
                        <strong>{c.name}</strong>
                      </td>
                      <td>
                        {c.phone ? (
                          <span>
                            <FaPhoneAlt /> {c.phone}
                          </span>
                        ) : (
                          <span className="user-mgmt-muted">—</span>
                        )}
                      </td>
                      <td>
                        {c.email ? (
                          <span>
                            <FaEnvelope /> {c.email}
                          </span>
                        ) : (
                          <span className="user-mgmt-muted">—</span>
                        )}
                      </td>
                      <td>{c.gstin || <span className="user-mgmt-muted">—</span>}</td>
                      <td>
                        <StatusBadge status={status} reason={c.rejectionReason} />
                      </td>
                      <td>
                        <span title={c.createdByEmail || ""}>
                          {c.createdByEmail || <span className="user-mgmt-muted">—</span>}
                        </span>
                        <div className="user-mgmt-muted">{formatDate(c.createdAt)}</div>
                      </td>
                      {canApprove && (
                        <td>
                          {status === "approved" && c.approvedByEmail ? (
                            <>
                              <span title={c.approvedByEmail}>{c.approvedByEmail}</span>
                              <div className="user-mgmt-muted">{formatDate(c.approvedAt)}</div>
                            </>
                          ) : status === "rejected" && c.rejectedByEmail ? (
                            <>
                              <span title={c.rejectedByEmail}>{c.rejectedByEmail}</span>
                              <div className="user-mgmt-muted">{formatDate(c.rejectedAt)}</div>
                            </>
                          ) : (
                            <span className="user-mgmt-muted">—</span>
                          )}
                        </td>
                      )}
                      <td>{formatDate(c.createdAt)}</td>
                      <td className="user-mgmt-actions">
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
                              className={`user-mgmt-action-btn user-mgmt-danger${
                                confirmDeleteId === c.id ? " is-confirming" : ""
                              }`}
                              onClick={() => {
                                if (confirmDeleteId === c.id) {
                                  handleDelete(c.id);
                                } else {
                                  setConfirmDeleteId(c.id);
                                  setTimeout(() => {
                                    setConfirmDeleteId((cur) => (cur === c.id ? null : cur));
                                  }, 4000);
                                }
                              }}
                              aria-label={
                                confirmDeleteId === c.id
                                  ? `Click again to confirm deleting ${c.name}`
                                  : `Delete ${c.name}`
                              }
                              title={confirmDeleteId === c.id ? "Click again to confirm" : "Delete"}
                            >
                              {confirmDeleteId === c.id ? <FaCheckCircle /> : <FaTrash />}
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal show={showModal} onHide={closeModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <FaUserTie />{" "}
            {editing ? `Edit ${editing.name}` : canApprove ? "New Customer" : "Submit Customer"}
          </Modal.Title>
        </Modal.Header>
        <form onSubmit={handleSubmit}>
          <Modal.Body>
            <div className="user-mgmt-form-row">
              <label className="user-mgmt-form-label">
                <FaUserTie /> Name <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                className="form-control"
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
                className="form-control"
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
                className="form-control"
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
                className="form-control"
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
                className="form-control"
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
                className="form-control"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                maxLength={500}
              />
            </div>
          </Modal.Body>
          <Modal.Footer>
            <button type="button" className="btn btn-outline-secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
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

      <Modal show={Boolean(rejectTarget)} onHide={closeReject} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <FaBan /> Reject {rejectTarget ? rejectTarget.name : ""}
          </Modal.Title>
        </Modal.Header>
        <form onSubmit={handleReject}>
          <Modal.Body>
            <p className="user-mgmt-muted">
              Tell the submitter why this customer can&apos;t be approved. The reason is visible to
              admins and persisted in the audit log.
            </p>
            <div className="user-mgmt-form-row">
              <label className="user-mgmt-form-label">
                Rejection reason <span className="text-danger">*</span>
              </label>
              <textarea
                className="form-control"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                maxLength={500}
                required
              />
            </div>
          </Modal.Body>
          <Modal.Footer>
            <button type="button" className="btn btn-outline-secondary" onClick={closeReject}>
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-danger"
              disabled={saving || !rejectReason.trim()}
            >
              {saving ? "Rejecting…" : "Reject customer"}
            </button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
};

export default CustomerManagement;
