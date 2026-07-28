import React, { useEffect, useMemo, useState } from "react";
import { Modal, InputGroup } from "react-bootstrap";
import { useNavigate } from "react-router-dom";
import {
  FaPlus,
  FaTrash,
  FaEdit,
  FaEye,
  FaEyeSlash,
  FaSearch,
  FaUserShield,
  FaUsers,
  FaUserCheck,
  FaUserClock,
  FaStore,
  FaEnvelope,
  FaKey,
  FaCopy,
  FaExclamationTriangle,
  FaArrowLeft,
} from "react-icons/fa";
import { createUser, deleteUser, getUsers, updateUser } from "../services/userService";
import { useUi } from "../context/UiContext";
import { getUser, getUserRole, getUserStoreId, getUserStoreType } from "../utils/auth";
import useInAppHistory from "../components/layout/useInAppHistory";
import "./UserManagement.css";

const ADMIN_ROLES = new Set(["SUPER_OWNER", "STORE_ADMIN", "ADMIN"]);

const resolveFallbackPath = () => {
  // Direct-URL entry: route admins to the dashboard, cashiers to the POS.
  // Returning to a role-appropriate landing page is less jarring than always /pos.
  const role = getUserRole();
  return ADMIN_ROLES.has(role) ? "/dashboard" : "/pos";
};

const getRoleLabel = (role) => {
  if (!role) return "";
  if (role === "STORE_ADMIN") return "BRANCH ADMIN";
  if (role === "SUPER_OWNER") return "SUPER OWNER";
  return role.replace(/_/g, " ");
};

const ROLE_TONES = {
  SUPER_OWNER: { bg: "rgba(124, 58, 237, 0.12)", color: "#6d28d9", dot: "#8b5cf6" },
  ADMIN: { bg: "rgba(59, 130, 246, 0.12)", color: "#1d4ed8", dot: "#3b82f6" },
  STORE_ADMIN: { bg: "rgba(14, 165, 233, 0.12)", color: "#0369a1", dot: "#0ea5e9" },
  CASHIER: { bg: "rgba(16, 185, 129, 0.12)", color: "#047857", dot: "#10b981" },
};

const STORE_TYPES = [
  { value: "retail", label: "Retail" },
  { value: "laundry", label: "Laundry" },
  { value: "service", label: "Service" },
  { value: "msme-service", label: "MSME Service" },
  { value: "inventory", label: "Inventory" },
  { value: "hotel", label: "Hotel" },
];

// SUPER_OWNER can only invite into these core verticals.
// MSME Service and Inventory are excluded from the Invite dialog.
const SUPER_OWNER_STORE_TYPES = [
  { value: "retail", label: "Retail" },
  { value: "laundry", label: "Laundry" },
  { value: "service", label: "Service" },
  { value: "hotel", label: "Hotel" },
];

const initialsFromEmail = (email = "") => {
  const handle = String(email).split("@")[0] || "?";
  const cleaned = handle.replace(/[^a-zA-Z0-9]/g, "");
  const letters = (cleaned.match(/[A-Za-z]/g) || []).join("");
  const two = (letters || cleaned || "?").slice(0, 2);
  return two.toUpperCase();
};

const initialForm = {
  email: "",
  password: "",
  role: "CASHIER",
  storeType: "retail",
  storeId: "",
  approved: false,
};

const UserManagement = () => {
  const navigate = useNavigate();
  const { previousInAppPath } = useInAppHistory();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [editingUser, setEditingUser] = useState(null);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [storeFilter, setStoreFilter] = useState("ALL");
  const [copiedEmail, setCopiedEmail] = useState(null);
  const [userToDelete, setUserToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await getUsers();
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  };

  const { activeStore } = useUi();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!cancelled) await loadUsers();
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [activeStore]);

  const currentRole = getUserRole();
  const currentStoreType = getUserStoreType();
  const currentStoreId = getUserStoreId();
  const isSuperOwner = currentRole === "SUPER_OWNER";
  const isStoreIdEditable = isSuperOwner || currentRole === "ADMIN";

  const openAdd = () => {
    setEditingUser(null);
    setForm({
      ...initialForm,
      storeType: isSuperOwner ? "retail" : currentStoreType || "retail",
      storeId: isSuperOwner ? "" : currentStoreId || currentStoreType || "",
      role: "CASHIER",
    });
    setError("");
    setFieldErrors({});
    setShowModal(true);
  };

  const openEdit = (user) => {
    setEditingUser(user);
    const allowedStoreTypes = (isSuperOwner ? SUPER_OWNER_STORE_TYPES : STORE_TYPES).map(
      (t) => t.value
    );
    const fallbackStoreType = isSuperOwner ? "retail" : user.storeType;
    setForm({
      email: user.email,
      password: "",
      role: user.role,
      storeType: allowedStoreTypes.includes(user.storeType) ? user.storeType : fallbackStoreType,
      storeId: user.storeId || user.storeType || "",
      approved: user.approved,
    });
    setError("");
    setFieldErrors({});
    setShowModal(true);
  };

  const validateEmail = (email) => /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(email);

  const validatePassword = (pwd) =>
    /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?#&])[A-Za-z\d@$!%*?#&]{8,}$/.test(pwd);

  const getPasswordCriteria = (pwd) => ({
    length: pwd.length >= 8,
    upper: /[A-Z]/.test(pwd),
    lower: /[a-z]/.test(pwd),
    digit: /\d/.test(pwd),
    special: /[@$!%*?#&]/.test(pwd),
  });

  const passwordCriteria = getPasswordCriteria(form.password);
  const passwordInvalid = form.password !== "" && !validatePassword(form.password);

  const handleSave = async () => {
    setError("");
    const errors = {};

    if (!form.email) {
      errors.email = "Email is required.";
    } else if (!validateEmail(form.email)) {
      errors.email = "Email must be a valid Gmail address.";
    }
    if (!form.role) errors.role = "Role is required.";
    if (!form.storeType) errors.storeType = "Store type is required.";
    if (form.role !== "SUPER_OWNER" && !form.storeId) {
      errors.storeId = "Store ID is required when creating or editing a member.";
    }
    if (!editingUser && !form.password) {
      errors.password = "Password is required when creating a user.";
    }
    if (form.password && !validatePassword(form.password)) {
      errors.password =
        "Password must be at least 8 characters and include uppercase, lowercase, number, and special character.";
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Please fix the highlighted fields.");
      return;
    }

    setFieldErrors({});

    const payload = {
      email: form.email,
      role: form.role,
      storeType: form.storeType,
      approved: form.approved,
      ...(form.password ? { password: form.password } : {}),
      ...(form.storeId ? { storeId: form.storeId } : {}),
    };

    try {
      if (editingUser) {
        await updateUser(editingUser.id, payload);
      } else {
        await createUser({
          ...payload,
          password: form.password,
        });
      }
      setShowModal(false);
      loadUsers();
    } catch (err) {
      setError(err.message || "Failed to save user");
    }
  };

  const availableRoles = isSuperOwner
    ? ["ADMIN", "STORE_ADMIN", "CASHIER"]
    : currentRole === "ADMIN"
      ? ["STORE_ADMIN", "CASHIER"]
      : currentRole === "STORE_ADMIN"
        ? ["CASHIER"]
        : ["CASHIER"];

  const storeOptions = useMemo(() => {
    const map = new Map();
    users.forEach((u) => {
      const key = `${u.storeType}:${u.storeId || u.storeType}`;
      if (!map.has(key)) {
        map.set(key, { storeType: u.storeType, storeId: u.storeId || u.storeType });
      }
    });
    return Array.from(map.values());
  }, [users]);

  const distinctStoreIds = useMemo(
    () => Array.from(new Set(storeOptions.map((s) => s.storeId).filter(Boolean))),
    [storeOptions]
  );

  const stats = useMemo(() => {
    const approved = users.filter((u) => u.approved).length;
    const pending = users.length - approved;
    return {
      total: users.length,
      approved,
      pending,
      stores: storeOptions.length,
    };
  }, [users, storeOptions]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((user) => {
      if (roleFilter !== "ALL" && user.role !== roleFilter) return false;
      if (statusFilter === "APPROVED" && !user.approved) return false;
      if (statusFilter === "PENDING" && user.approved) return false;
      if (storeFilter !== "ALL" && (user.storeId || user.storeType) !== storeFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        user.email,
        user.role,
        user.storeType,
        user.storeId,
        user.rootOwnerEmail,
        user.ownerEmail,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [users, search, roleFilter, statusFilter, storeFilter]);

  const requestDelete = (user) => {
    setError("");
    setUserToDelete(user);
  };

  const cancelDelete = () => {
    if (deleting) return;
    setUserToDelete(null);
  };

  const confirmDelete = async () => {
    if (!userToDelete) return;
    const target = userToDelete;
    setDeleting(true);
    try {
      await deleteUser(target.id);
      setUserToDelete(null);
      loadUsers();
    } catch (err) {
      setError(err.message || "Failed to delete user");
      setUserToDelete(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleCopyEmail = async (email) => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(email);
      setTimeout(() => setCopiedEmail(null), 1400);
    } catch {
      /* ignore */
    }
  };

  // Smart back: prefer an in-app route the user actually visited; otherwise
  // route to a role-appropriate landing page (admins → /dashboard,
  // cashiers → /pos). We can't rely on window.history.state.idx alone because
  // most sidebar clicks use navigate(..., { replace: true }), which doesn't
  // push a new entry — leaving /login as the only thing left to "go back" to.
  const goBack = () => {
    const previous = previousInAppPath();
    if (previous) {
      navigate(previous);
    } else {
      navigate(resolveFallbackPath(), { replace: true });
    }
  };

  // Esc on this page = back. Skip if any modal is open so users can still
  // close modals with Esc.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      if (showModal || userToDelete) return;
      event.preventDefault();
      goBack();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showModal, userToDelete]);

  return (
    <div className="user-management-page">
      {/* BACK BAR — sidebar is hidden on this page, so we surface an in-page
          back affordance. Smart destination: browser history first, /pos fallback. */}
      <div className="um-backbar" role="navigation" aria-label="Back to workspace">
        <button type="button" className="um-backbar-btn" onClick={goBack}>
          <FaArrowLeft />
          <span>Back to workspace</span>
          <kbd className="um-backbar-kbd">Esc</kbd>
        </button>
        <div className="um-backbar-context">
          <span className="um-backbar-eyebrow">Settings</span>
          <strong>User management</strong>
        </div>
      </div>

      {/* HERO HEADER */}
      <div className="um-hero">
        <div className="um-hero-bg" aria-hidden="true" />
        <div className="um-hero-content">
          <div className="um-hero-text">
            <div className="um-hero-eyebrow">
              <FaUserShield />
              <span>Team workspace</span>
            </div>
            <h1 className="um-hero-title">User Management</h1>
            <p className="um-hero-subtitle">
              Invite teammates, assign store access and decide who can approve orders. Roles adapt
              automatically to your permission level.
            </p>
            <div className="um-hero-legend">
              <span>Super Owner</span>
              <i>·</i>
              <span>Admin</span>
              <i>·</i>
              <span>Branch Admin</span>
              <i>·</i>
              <span>Cashier</span>
            </div>
          </div>
          <div className="um-hero-actions">
            <button className="um-btn um-btn-primary" type="button" onClick={openAdd}>
              <FaPlus /> <span>Invite member</span>
            </button>
          </div>
        </div>
      </div>

      {/* STAT CARDS */}
      <div className="um-stats">
        <div className="um-stat-card tone-violet">
          <div className="um-stat-icon">
            <FaUsers />
          </div>
          <div className="um-stat-meta">
            <span>Total members</span>
            <strong>{loading ? "…" : stats.total}</strong>
          </div>
        </div>
        <div className="um-stat-card tone-emerald">
          <div className="um-stat-icon">
            <FaUserCheck />
          </div>
          <div className="um-stat-meta">
            <span>Active</span>
            <strong>{loading ? "…" : stats.approved}</strong>
          </div>
        </div>
        <div className="um-stat-card tone-amber">
          <div className="um-stat-icon">
            <FaUserClock />
          </div>
          <div className="um-stat-meta">
            <span>Pending</span>
            <strong>{loading ? "…" : stats.pending}</strong>
          </div>
        </div>
        <div className="um-stat-card tone-sky">
          <div className="um-stat-icon">
            <FaStore />
          </div>
          <div className="um-stat-meta">
            <span>Stores</span>
            <strong>{loading ? "…" : stats.stores}</strong>
          </div>
        </div>
      </div>

      {/* PANEL — filters + table */}
      <div className="um-panel">
        <div className="um-panel-head">
          <div>
            <h2 className="um-panel-title">Team members</h2>
            <p className="um-panel-sub">
              {filteredUsers.length} {filteredUsers.length === 1 ? "member" : "members"} matching
              your filters
            </p>
          </div>

          <div className="um-search">
            <FaSearch />
            <input
              type="text"
              placeholder="Search email, role, store…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search members"
            />
          </div>
        </div>

        <div className="um-filters">
          <div className="um-filter-group">
            <span className="um-filter-label">Role</span>
            <div className="um-chip-row">
              <button
                type="button"
                className={`um-chip ${roleFilter === "ALL" ? "active" : ""}`}
                onClick={() => setRoleFilter("ALL")}
              >
                All
              </button>
              {(isSuperOwner
                ? ["ADMIN", "STORE_ADMIN", "CASHIER"]
                : currentRole === "ADMIN"
                  ? ["STORE_ADMIN", "CASHIER"]
                  : currentRole === "STORE_ADMIN"
                    ? ["CASHIER"]
                    : ["CASHIER"]
              ).map((role) => (
                <button
                  type="button"
                  key={role}
                  className={`um-chip ${roleFilter === role ? "active" : ""}`}
                  onClick={() => setRoleFilter(role)}
                >
                  {getRoleLabel(role)}
                </button>
              ))}
            </div>
          </div>

          <div className="um-filter-group">
            <span className="um-filter-label">Status</span>
            <div className="um-chip-row">
              {[
                { key: "ALL", label: "All" },
                { key: "APPROVED", label: "Active" },
                { key: "PENDING", label: "Pending" },
              ].map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={`um-chip ${statusFilter === s.key ? "active" : ""}`}
                  onClick={() => setStatusFilter(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {(isSuperOwner || currentRole === "ADMIN") && storeOptions.length > 0 && (
            <div className="um-filter-group">
              <span className="um-filter-label">Store</span>
              <select
                className="um-select"
                value={storeFilter}
                onChange={(e) => setStoreFilter(e.target.value)}
                aria-label="Filter by store"
              >
                <option value="ALL">All stores</option>
                {distinctStoreIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {error && <div className="um-alert um-alert-danger">{error}</div>}

        {loading ? (
          <div className="um-empty">
            <div className="um-spinner" aria-hidden="true" />
            <p>Loading members…</p>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="um-empty">
            <div className="um-empty-icon">
              <FaUsers />
            </div>
            <strong>No members found</strong>
            <span>Try adjusting filters or invite a new teammate.</span>
            <button type="button" className="um-btn um-btn-primary um-btn-sm" onClick={openAdd}>
              <FaPlus /> Invite member
            </button>
          </div>
        ) : (
          <div className="um-table-wrap">
            <table className="um-table">
              <thead>
                <tr>
                  <th className="um-col-member">Member</th>
                  <th className="um-col-role">Role</th>
                  <th className="um-col-store">Store</th>
                  <th className="um-col-storeid">Store ID</th>
                  <th className="um-col-owner">Root owner</th>
                  <th className="um-col-status">Status</th>
                  <th className="um-col-joined">Joined</th>
                  <th className="um-actions-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.map((user) => {
                  const tone = ROLE_TONES[user.role] || ROLE_TONES.CASHIER;
                  const isApproved = !!user.approved;
                  return (
                    <tr key={user.id}>
                      <td className="um-col-member">
                        <div className="um-cell-member">
                          <div
                            className="um-avatar"
                            style={{
                              background: `linear-gradient(135deg, ${tone.bg}, rgba(255,255,255,0.6))`,
                              color: tone.color,
                            }}
                          >
                            {initialsFromEmail(user.email)}
                          </div>
                          <div className="um-cell-member-meta">
                            <button
                              type="button"
                              className="um-email"
                              onClick={() => handleCopyEmail(user.email)}
                              title="Copy email"
                            >
                              {user.email}
                              {copiedEmail === user.email ? (
                                <span className="um-copy-flash">copied</span>
                              ) : (
                                <FaCopy className="um-copy-icon" />
                              )}
                            </button>
                            <span className="um-cell-sub">
                              {user.id ? `#${String(user.id).slice(-6)}` : "—"}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="um-col-role">
                        <span
                          className="um-role-pill"
                          style={{ background: tone.bg, color: tone.color }}
                        >
                          <span className="um-role-dot" style={{ background: tone.dot }} />
                          {getRoleLabel(user.role)}
                        </span>
                      </td>
                      <td className="um-col-store">
                        <span className="um-store-pill">{user.storeType}</span>
                      </td>
                      <td className="um-col-storeid">
                        <code className="um-storeid">{user.storeId || "—"}</code>
                      </td>
                      <td className="um-muted um-col-owner">
                        {user.rootOwnerEmail || user.ownerEmail || "—"}
                      </td>
                      <td className="um-col-status">
                        <span className={`um-status-pill ${isApproved ? "active" : "pending"}`}>
                          <span className={`um-status-dot ${isApproved ? "active" : "pending"}`} />
                          {isApproved ? "Active" : "Pending"}
                        </span>
                      </td>
                      <td className="um-muted um-col-joined">
                        {user.createdAt
                          ? new Date(user.createdAt).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </td>
                      <td className="um-actions-col">
                        <div className="um-row-actions">
                          <button
                            type="button"
                            className="um-action-btn edit"
                            onClick={() => openEdit(user)}
                            aria-label={`Edit ${user.email}`}
                            title="Edit member"
                          >
                            <FaEdit />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            className="um-action-btn delete"
                            onClick={() => requestDelete(user)}
                            aria-label={`Remove ${user.email}`}
                            title="Remove member"
                          >
                            <FaTrash />
                            <span>Delete</span>
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

      {/* MODAL */}
      <Modal show={showModal} onHide={() => setShowModal(false)} centered className="um-modal">
        <Modal.Header closeButton>
          <Modal.Title>
            <span className="um-modal-eyebrow">{editingUser ? "Editing" : "New teammate"}</span>
            <span className="um-modal-title">
              {editingUser ? "Edit member" : "Invite a member"}
            </span>
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {error && <div className="um-alert um-alert-danger">{error}</div>}
          <div className="um-form">
            <div className="um-field">
              <label htmlFor="um-email">
                <FaEnvelope /> Email
              </label>
              <input
                id="um-email"
                type="email"
                value={form.email}
                className={`um-input ${fieldErrors.email ? "has-error" : ""}`}
                onChange={(e) => {
                  const nextEmail = e.target.value.toLowerCase();
                  setForm({ ...form, email: nextEmail });
                  setFieldErrors((prev) => ({
                    ...prev,
                    email:
                      nextEmail && !validateEmail(nextEmail)
                        ? "Email must be a valid Gmail address."
                        : undefined,
                  }));
                }}
                placeholder="member@gmail.com"
              />
              {fieldErrors.email && <span className="um-field-error">{fieldErrors.email}</span>}
            </div>

            <div className="um-field-row">
              <div className="um-field">
                <label htmlFor="um-role">Role</label>
                <select
                  id="um-role"
                  className={`um-input um-select ${fieldErrors.role ? "has-error" : ""}`}
                  value={form.role}
                  onChange={(e) => {
                    setForm({ ...form, role: e.target.value });
                    setFieldErrors({ ...fieldErrors, role: undefined });
                  }}
                >
                  {availableRoles.map((option) => (
                    <option key={option} value={option}>
                      {getRoleLabel(option)}
                    </option>
                  ))}
                </select>
                {fieldErrors.role && <span className="um-field-error">{fieldErrors.role}</span>}
              </div>

              <div className="um-field">
                <label htmlFor="um-storetype">Store type</label>
                <select
                  id="um-storetype"
                  className={`um-input um-select ${fieldErrors.storeType ? "has-error" : ""}`}
                  value={form.storeType}
                  onChange={(e) => {
                    setForm({ ...form, storeType: e.target.value });
                    setFieldErrors({ ...fieldErrors, storeType: undefined });
                  }}
                  disabled={!isSuperOwner}
                >
                  {(isSuperOwner ? SUPER_OWNER_STORE_TYPES : STORE_TYPES).map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                {fieldErrors.storeType && (
                  <span className="um-field-error">{fieldErrors.storeType}</span>
                )}
              </div>
            </div>

            <div className="um-field">
              <label htmlFor="um-storeid">Store ID</label>
              <input
                id="um-storeid"
                list="storeIdOptions"
                type="text"
                className={`um-input ${fieldErrors.storeId ? "has-error" : ""}`}
                value={form.storeId}
                onChange={(e) => {
                  setForm({ ...form, storeId: e.target.value });
                  setFieldErrors({ ...fieldErrors, storeId: undefined });
                }}
                placeholder="Enter store identifier"
                disabled={!isStoreIdEditable}
              />
              <datalist id="storeIdOptions">
                {distinctStoreIds.map((id) => (
                  <option key={id} value={id} />
                ))}
              </datalist>
              {fieldErrors.storeId && <span className="um-field-error">{fieldErrors.storeId}</span>}
              {!isSuperOwner && (
                <span className="um-field-hint">
                  {currentRole === "ADMIN"
                    ? "Admins can create Branch Admins and Cashiers for their store."
                    : "Branch Admins can only create cashiers for their store."}
                </span>
              )}
            </div>

            <div className="um-field">
              <label htmlFor="um-password">
                <FaKey /> Password
              </label>
              <InputGroup>
                <input
                  id="um-password"
                  type={showPassword ? "text" : "password"}
                  className={`um-input ${
                    fieldErrors.password || passwordInvalid ? "has-error" : ""
                  }`}
                  value={form.password}
                  onChange={(e) => {
                    setForm({ ...form, password: e.target.value });
                    setFieldErrors({ ...fieldErrors, password: undefined });
                  }}
                  placeholder={
                    editingUser
                      ? "Leave blank to keep current password"
                      : "Choose a strong password"
                  }
                />
                <button
                  type="button"
                  className="um-input-suffix"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </InputGroup>
              {fieldErrors.password && (
                <span className="um-field-error">{fieldErrors.password}</span>
              )}
              <div className="um-password-rules">
                <span className={`um-rule ${passwordCriteria.length ? "met" : ""}`}>
                  <span className="um-rule-bullet" /> 8+ characters
                </span>
                <span className={`um-rule ${passwordCriteria.upper ? "met" : ""}`}>
                  <span className="um-rule-bullet" /> Uppercase
                </span>
                <span className={`um-rule ${passwordCriteria.lower ? "met" : ""}`}>
                  <span className="um-rule-bullet" /> Lowercase
                </span>
                <span className={`um-rule ${passwordCriteria.digit ? "met" : ""}`}>
                  <span className="um-rule-bullet" /> Number
                </span>
                <span className={`um-rule ${passwordCriteria.special ? "met" : ""}`}>
                  <span className="um-rule-bullet" /> Special
                </span>
              </div>
            </div>

            <label className="um-toggle">
              <input
                type="checkbox"
                checked={form.approved}
                onChange={(e) => setForm({ ...form, approved: e.target.checked })}
              />
              <span className="um-toggle-slider" />
              <span className="um-toggle-text">
                <strong>Mark as approved</strong>
                <small>Approved members can log in immediately.</small>
              </span>
            </label>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <button type="button" className="um-btn um-btn-ghost" onClick={() => setShowModal(false)}>
            Cancel
          </button>
          <button type="button" className="um-btn um-btn-primary" onClick={handleSave}>
            {editingUser ? "Save changes" : "Send invite"}
          </button>
        </Modal.Footer>
      </Modal>

      {/* DELETE CONFIRMATION MODAL */}
      <Modal
        show={Boolean(userToDelete)}
        onHide={cancelDelete}
        centered
        className="um-modal um-confirm-modal"
        backdrop="static"
        keyboard={!deleting}
      >
        <div className="um-confirm-icon" aria-hidden="true">
          <FaExclamationTriangle />
        </div>
        <Modal.Body>
          <div className="um-confirm-head">
            <h3 className="um-confirm-title">Remove this member?</h3>
            <p className="um-confirm-text">
              You're about to permanently remove <strong>{userToDelete?.email}</strong> from your
              team. This action cannot be undone.
            </p>
          </div>
          {userToDelete ? (
            <div className="um-confirm-summary">
              <div className="um-confirm-summary-row">
                <span>Role</span>
                <strong>{getRoleLabel(userToDelete.role)}</strong>
              </div>
              <div className="um-confirm-summary-row">
                <span>Store</span>
                <strong>{userToDelete.storeType || "—"}</strong>
              </div>
              <div className="um-confirm-summary-row">
                <span>Status</span>
                <strong>{userToDelete.approved ? "Active" : "Pending"}</strong>
              </div>
            </div>
          ) : null}
          {error && <div className="um-alert um-alert-danger">{error}</div>}
        </Modal.Body>
        <Modal.Footer>
          <button
            type="button"
            className="um-btn um-btn-ghost"
            onClick={cancelDelete}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="um-btn um-btn-danger"
            onClick={confirmDelete}
            disabled={deleting}
          >
            {deleting ? (
              <>
                <span className="um-spinner um-spinner-inline" aria-hidden="true" />
                Removing…
              </>
            ) : (
              <>
                <FaTrash />
                Remove member
              </>
            )}
          </button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export default UserManagement;
