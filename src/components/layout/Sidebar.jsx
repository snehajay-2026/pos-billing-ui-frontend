import React, { useRef, useEffect, useMemo } from "react";
import {
  FaCashRegister,
  FaFileInvoice,
  FaChartBar,
  FaChartLine,
  FaBox,
  FaBoxes,
  FaWarehouse,
  FaCog,
  FaWallet,
  FaUserShield,
  FaUserTie,
  FaBed,
  FaUtensils,
  FaChair,
  FaBroom,
  FaTimes,
  FaBolt,
  FaChevronRight,
  FaShieldAlt,
  FaStore,
  FaShoppingBag,
  FaHistory,
  FaChartPie,
  FaKey,
} from "react-icons/fa";
import { NavLink, useNavigate } from "react-router-dom";
import { getUser, getUserStoreType } from "../../utils/auth";
import { useUi } from "../../context/UiContext";
import { useHotelModuleLock } from "../../hooks/useHotelModuleLock";
import "./Sidebar.css";

const ADMIN_ROLES = ["SUPER_OWNER", "STORE_ADMIN", "ADMIN"];

const getRoleLabel = (role) => {
  if (role === "SUPER_OWNER") return "Super Owner";
  if (role === "STORE_ADMIN") return "Branch Admin";
  if (role === "ADMIN") return "Administrator";
  if (role === "CASHIER") return "Cashier";
  return role?.replace(/_/g, " ") || "Member";
};

const getStoreTypeLabel = (type) => {
  if (type === "hotel") return "Hotel";
  if (type === "laundry") return "Laundry";
  if (type === "service") return "Service";
  if (type === "msme-service") return "MSME Service";
  if (type === "inventory") return "Inventory";
  if (type === "retail") return "Retail";
  return type || "Store";
};

const getStoreTypeTone = (type) => {
  if (type === "hotel") return { from: "#f97316", to: "#ec4899", glow: "rgba(236, 72, 153, 0.45)" };
  if (type === "laundry")
    return { from: "#0ea5e9", to: "#3b82f6", glow: "rgba(59, 130, 246, 0.45)" };
  if (type === "service" || type === "msme-service")
    return { from: "#10b981", to: "#0ea5e9", glow: "rgba(16, 185, 129, 0.45)" };
  if (type === "inventory")
    return { from: "#6366f1", to: "#8b5cf6", glow: "rgba(139, 92, 246, 0.45)" };
  return { from: "#f59e0b", to: "#ef4444", glow: "rgba(239, 68, 68, 0.45)" };
};

const Sidebar = ({ collapsed, onMenuClick, isMobile }) => {
  const user = getUser();
  const role = user?.role;
  const storeType = getUserStoreType();
  const isAdmin = ADMIN_ROLES.includes(role);
  const { locale } = useUi();
  const sidebarRef = useRef(null);

  const sidebarClass = isMobile
    ? `sidebar-container${!collapsed ? " open" : ""}`
    : "sidebar-container";

  useEffect(() => {
    if (isMobile && !collapsed && sidebarRef.current) {
      const focusableEls = sidebarRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableEls.length) {
        focusableEls[0].focus();
      }
      const handleTab = (e) => {
        const first = focusableEls[0];
        const last = focusableEls[focusableEls.length - 1];
        if (e.key === "Tab") {
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      sidebarRef.current.addEventListener("keydown", handleTab);
      return () => {
        if (sidebarRef.current) {
          sidebarRef.current.removeEventListener("keydown", handleTab);
        }
      };
    }
  }, [collapsed, isMobile]);

  const handleOverlayClick = () => {
    if (onMenuClick) onMenuClick();
  };

  const handleClose = () => {
    if (onMenuClick) onMenuClick();
  };

  const displayName =
    user?.name?.trim() ||
    user?.username ||
    (user?.email ? user.email.split("@")[0] : locale.unknownUser || "User");

  const initials = useMemo(() => {
    const text = String(displayName || "User").trim();
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "U";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }, [displayName]);

  const tone = useMemo(() => getStoreTypeTone(storeType), [storeType]);
  const storeTypeLabel = useMemo(() => getStoreTypeLabel(storeType), [storeType]);

  // Operations section — always visible to all signed-in users. For
  // hotel stores we honour the Lodging / Dining module locks from the
  // Super Owner: a locked module's items are hidden from the sidebar
  // (the route is still protected by RequireHotelModule in App.js).
  const hotelModuleLock = useHotelModuleLock();
  const operations = [
    {
      to: "/pos",
      icon: storeType === "hotel" ? <FaBed /> : <FaCashRegister />,
      label: storeType === "hotel" ? locale.hotelBilling || "Hotel Billing" : locale.posBilling,
      primary: true,
    },
  ];
  if (storeType === "hotel") {
    if (!hotelModuleLock.lodgingLocked) {
      operations.push(
        { to: "/hotel-lodging", icon: <FaBed />, label: locale.hotelLodging || "Hotel Lodging" },
        { to: "/hotel-housekeeping", icon: <FaBroom />, label: "Housekeeping" },
        {
          to: "/hotel-lodging-invoices",
          icon: <FaFileInvoice />,
          label: locale.hotelLodgingInvoices || "Lodging Invoices",
        }
      );
    }
    if (!hotelModuleLock.diningLocked) {
      operations.push(
        { to: "/hotel-dining", icon: <FaUtensils />, label: locale.hotelDining || "Hotel Dining" },
        { to: "/hotel-tables", icon: <FaChair />, label: locale.hotelTables || "Dining Tables" },
        {
          to: "/hotel-dining-invoices",
          icon: <FaFileInvoice />,
          label: locale.hotelDiningInvoices || "Dining Invoices",
        }
      );
    }
  }
  if (storeType === "laundry") {
    operations.push(
      { to: "/laundry-orders", icon: <FaShoppingBag />, label: locale.laundryOrders },
      {
        to: "/laundry-services",
        icon: <FaBox />,
        label: locale.laundryServices || "Laundry Services",
      }
    );
  }
  // For retail and inventory stores, give the cashier a Products page
  // (the /products list) and the Inventory (PO) page. The pages
  // themselves filter the list to the requester's own scope.
  if (storeType === "retail" || storeType === "inventory") {
    operations.push({ to: "/products", icon: <FaBox />, label: locale.products || "Products" });
    operations.push({
      to: "/inventory",
      icon: <FaWarehouse />,
      label: locale.inventory || "Inventory",
    });
  }
  // Shifts & Cash is visible to every signed-in user in a cash-vertical
  // store (not just admins) — the cashier's POS banner + this link
  // give them two entry points to the same OpenShiftDialog /
  // CloseShiftDialog. The page itself already filters by role.
  operations.push({
    to: "/shifts",
    icon: <FaCashRegister />,
    label: "Shifts & Cash",
  });

  // Invoices, Inventory (PO), Customers — visible to every signed-in
  // user. The pages themselves filter by role (cashiers see their
  // own data; admins see their business). The laundry inventory
  // module also belongs here so laundry cashiers can manage
  // consumables (detergent, packaging) without escalating to admin.
  operations.push({
    to: "/invoices",
    icon: <FaFileInvoice />,
    label: locale.invoices || "Invoices",
  });
  operations.push({ to: "/inventory-module", icon: <FaChartPie />, label: "Inventory (PO)" });
  operations.push({
    to: "/customers",
    icon: <FaUserTie />,
    label: locale.customerManagement || "Customers",
  });
  if (storeType === "laundry") {
    operations.push({ to: "/laundry-inventory", icon: <FaBoxes />, label: "Laundry Inventory" });
  }

  // Insights section — admin only
  const insights = isAdmin
    ? [
        ...(storeType === "hotel" && !hotelModuleLock.diningLocked
          ? [
              {
                to: "/hotel-dining-invoices",
                icon: <FaFileInvoice />,
                label: locale.hotelDiningInvoices || "Dining Invoices",
              },
            ]
          : []),
        ...(storeType === "hotel" && !hotelModuleLock.lodgingLocked
          ? [
              {
                to: "/hotel-lodging-invoices",
                icon: <FaFileInvoice />,
                label: locale.hotelLodgingInvoices || "Lodging Invoices",
              },
            ]
          : []),
        ...(storeType !== "service" && storeType !== "msme-service"
          ? [{ to: "/dashboard", icon: <FaChartBar />, label: locale.dashboard }]
          : []),
        ...(storeType === "service" || storeType === "msme-service"
          ? [
              {
                to: "/service-dashboard",
                icon: <FaChartLine />,
                label: locale.serviceDashboard || "Service Dashboard",
              },
            ]
          : []),
      ]
    : [];

  // Manage section — admin only (catalog, stock, money, users, settings)
  const manage = isAdmin
    ? [
        ...(storeType === "service" || storeType === "msme-service"
          ? [
              { to: "/service-orders", icon: <FaBox />, label: locale.serviceOrders },
              { to: "/services", icon: <FaBox />, label: locale.serviceManagement },
            ]
          : []),
        ...(storeType !== "service" &&
        storeType !== "msme-service" &&
        storeType !== "hotel" &&
        storeType !== "laundry"
          ? [{ to: "/products", icon: <FaBox />, label: locale.products }]
          : []),
        ...(storeType !== "laundry"
          ? [{ to: "/inventory", icon: <FaWarehouse />, label: locale.inventory }]
          : []),
        { to: "/cashflow", icon: <FaWallet />, label: locale.cashFlow },
        { to: "/users", icon: <FaUserShield />, label: locale.userManagement },
        { to: "/reports", icon: <FaChartPie />, label: "Reports" },
        ...(String(role || "").toUpperCase() === "SUPER_OWNER"
          ? [
              {
                to: "/super/hotel-modules",
                icon: <FaKey />,
                label: "Hotel Module Access",
              },
            ]
          : []),
        { to: "/activity", icon: <FaHistory />, label: "Recent Activity" },
        { to: "/settings", icon: <FaCog />, label: locale.storeSettings },
      ]
    : [];

  const renderSection = (title, eyebrow, items) => {
    if (!items || items.length === 0) return null;
    return (
      <div className="sidebar-section" key={title}>
        <div className="sidebar-section-title">
          <span className="sidebar-section-eyebrow">{eyebrow}</span>
          <span className="sidebar-section-label">{title}</span>
          <span className="sidebar-section-rule" aria-hidden="true" />
        </div>
        <ul className="sidebar-menu">
          {items.map((item) => (
            <MenuItem
              key={item.to}
              to={item.to}
              icon={item.icon}
              label={item.label}
              isMobile={isMobile}
              onMenuClick={onMenuClick}
              primary={item.primary}
            />
          ))}
        </ul>
      </div>
    );
  };

  return (
    <>
      {isMobile && !collapsed && (
        <div
          className="sidebar-overlay"
          onClick={handleOverlayClick}
          aria-label={locale.closeSidebar || "Close sidebar"}
          tabIndex={0}
        />
      )}
      <nav
        className={sidebarClass}
        style={{
          left: collapsed ? "-300px" : "0",
          position: isMobile ? "fixed" : "relative",
          overflow: "hidden",
        }}
        aria-label="Main menu"
        aria-modal={isMobile && !collapsed ? "true" : undefined}
        role="navigation"
        ref={sidebarRef}
      >
        <div className="sidebar-decor" aria-hidden="true">
          <span className="sidebar-orb sidebar-orb-1" />
          <span className="sidebar-orb sidebar-orb-2" />
          <span className="sidebar-orb sidebar-orb-3" />
        </div>

        <div className="sidebar-shell">
          {isMobile && !collapsed && (
            <button
              className="sidebar-close-btn"
              onClick={handleClose}
              aria-label={locale.closeSidebar || "Close sidebar"}
              tabIndex={0}
            >
              <FaTimes />
            </button>
          )}

          <div
            className="sidebar-brand"
            style={{
              "--tone-from": tone.from,
              "--tone-to": tone.to,
              "--tone-glow": tone.glow,
            }}
          >
            <div className="brand-logo" aria-hidden="true">
              <FaBolt />
            </div>
            <div className="sidebar-brand-text">
              <div className="brand-name">{locale.brandName || "POS Billing"}</div>
              <div className="brand-subtitle">
                <FaStore aria-hidden="true" />
                <span>{storeTypeLabel} workspace</span>
              </div>
            </div>
          </div>

          <div className="sidebar-scroll">
            {renderSection("Operations", "01", operations)}
            {renderSection("Insights & Reports", "02", insights)}
            {renderSection("Manage", "03", manage)}
          </div>

          <div className="sidebar-footer">
            <div className="sidebar-user-card">
              <div className="sidebar-user-avatar" aria-hidden="true">
                {initials}
              </div>
              <div className="sidebar-user-meta">
                <strong>{displayName}</strong>
                <span>
                  <FaShieldAlt aria-hidden="true" />
                  {getRoleLabel(role)}
                </span>
              </div>
              <span className="sidebar-user-chevron" aria-hidden="true">
                <FaChevronRight />
              </span>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
};

const MenuItem = ({ to, icon, label, onMenuClick, isMobile, primary }) => {
  const navigate = useNavigate();
  const handleClick = (e) => {
    e.preventDefault();
    if (isMobile && onMenuClick) {
      onMenuClick();
      setTimeout(() => navigate(to, { replace: true }), 250);
    } else {
      if (onMenuClick) onMenuClick();
      navigate(to, { replace: true });
    }
  };
  return (
    <li className={primary ? "is-primary" : ""}>
      <NavLink
        to={to}
        end
        onClick={handleClick}
        className={({ isActive }) =>
          `sidebar-link${isActive ? " active" : ""}${primary ? " is-primary" : ""}`
        }
      >
        <span className="sidebar-link-icon" aria-hidden="true">
          {icon}
        </span>
        <span className="sidebar-link-label">{label}</span>
        <span className="sidebar-link-chevron" aria-hidden="true">
          <FaChevronRight />
        </span>
      </NavLink>
    </li>
  );
};

export default Sidebar;
