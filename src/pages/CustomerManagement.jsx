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
} from "react-icons/fa";
import {
  createCustomer,
  deleteCustomer,
  getCustomers,
  searchCustomers,
  updateCustomer,
} from "../services/customerService";
import { getUserRole } from "../utils/auth";
import "./UserManagement.css";

const ADMIN_ROLES = new Set(["SUPER_OWNER", "STORE_ADMIN", "ADMIN"]);

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

const CustomerManagement = () => {
  const navigate = useNavigate();
  const role = getUserRole();
  const canManage = ADMIN_ROLES.has(role);

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
    loadCustomers();
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
          onClick={() => navigate(canManage ? "/dashboard" : "/pos")}
          aria-label="Back"
        >
          <FaArrowLeft /> Back
        </button>

        <header className="user-mgmt-header">
          <div className="user-mgmt-title">
            <FaUserTie />
            <div>
              <h1>Customers</h1>
              <p>Manage customer records for repeat visits, udhaar ledger, and refunds.</p>
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
            {canManage && (
              <button type="button" className="btn btn-primary" onClick={openCreate}>
                <FaPlus /> New Customer
              </button>
            )}
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

        {error && <div className="user-mgmt-error">{error}</div>}

        <div className="user-mgmt-card">
          <table className="user-mgmt-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>GSTIN</th>
                <th>Added</th>
                {canManage && <th aria-label="Actions"></th>}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="user-mgmt-empty">
                    Loading…
                  </td>
                </tr>
              ) : customers.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 6 : 5} className="user-mgmt-empty">
                    {search
                      ? `No customers match “${search}”.`
                      : "No customers yet. Click New Customer to add one."}
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
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
                    <td>{formatDate(c.createdAt)}</td>
                    {canManage && (
                      <td className="user-mgmt-actions">
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
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal show={showModal} onHide={closeModal} centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <FaUserTie /> {editing ? `Edit ${editing.name}` : "New Customer"}
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
              {saving ? "Saving…" : editing ? "Save changes" : "Create customer"}
            </button>
          </Modal.Footer>
        </form>
      </Modal>
    </div>
  );
};

export default CustomerManagement;
