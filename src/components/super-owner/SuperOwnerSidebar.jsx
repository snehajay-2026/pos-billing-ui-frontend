// SuperOwnerSidebar.jsx
//
// Platform-scope navigation for SUPER_OWNER. Renders a single "Platform"
// section with links to the four new Super Owner pages plus the existing
// Hotel Module Access and the audit log. The tenant-admin Sidebar (which
// hides its own items when role === SUPER_OWNER — see Sidebar.jsx) hands
// over to this one inside the /super/* layout.

import React, { useRef, useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  FaTachometerAlt,
  FaUsersCog,
  FaCreditCard,
  FaMoneyBillWave,
  FaKey,
  FaHistory,
  FaTimes,
  FaShieldAlt,
} from "react-icons/fa";
import { getUser } from "../../utils/auth";
import "./SuperOwnerSidebar.css";

const PLATFORM_LINKS = [
  { to: "/super", icon: <FaTachometerAlt />, label: "Dashboard", end: true },
  { to: "/super/tenants", icon: <FaUsersCog />, label: "Tenants" },
  {
    to: "/super/subscriptions",
    icon: <FaCreditCard />,
    label: "Subscriptions",
  },
  { to: "/super/payments", icon: <FaMoneyBillWave />, label: "Payments" },
  { to: "/super/hotel-modules", icon: <FaKey />, label: "Hotel Module Access" },
  { to: "/activity", icon: <FaHistory />, label: "Platform Audit Log" },
];

const SuperOwnerSidebar = ({ collapsed, onMenuClick, isMobile }) => {
  const sidebarRef = useRef(null);
  const navigate = useNavigate();
  const user = getUser();
  const displayName = user?.name?.trim() || user?.username || user?.email || "Super Owner";

  useEffect(() => {
    if (isMobile && !collapsed && sidebarRef.current) {
      const focusable = sidebarRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length) focusable[0].focus();
    }
  }, [collapsed, isMobile]);

  const handleClose = () => {
    if (onMenuClick) onMenuClick();
  };

  const handleOverlayClick = () => {
    if (onMenuClick) onMenuClick();
  };

  const handleLinkClick = (e, to) => {
    e.preventDefault();
    if (isMobile && onMenuClick) {
      onMenuClick();
      setTimeout(() => navigate(to), 250);
    } else {
      if (onMenuClick) onMenuClick();
      navigate(to);
    }
  };

  const sidebarClass = isMobile
    ? `super-sidebar is-mobile${!collapsed ? " open" : ""}`
    : "super-sidebar";

  return (
    <>
      {isMobile && !collapsed && (
        <div
          className="super-sidebar-overlay"
          onClick={handleOverlayClick}
          aria-label="Close sidebar"
        />
      )}
      <nav
        ref={sidebarRef}
        className={sidebarClass}
        style={{
          left: collapsed ? "-300px" : "0",
          position: isMobile ? "fixed" : "relative",
        }}
        aria-label="Super Owner menu"
        role="navigation"
      >
        <div className="super-sidebar-decor" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="super-sidebar-shell">
          {isMobile && !collapsed && (
            <button
              type="button"
              className="super-sidebar-close-btn"
              onClick={handleClose}
              aria-label="Close sidebar"
            >
              <FaTimes />
            </button>
          )}
          <div className="super-sidebar-brand">
            <div className="brand-logo" aria-hidden="true">
              <FaShieldAlt />
            </div>
            <div>
              <div className="brand-name">Super Owner</div>
              <div className="brand-sub">Platform console</div>
            </div>
          </div>
          <div className="super-sidebar-section">
            <div className="super-sidebar-section-title">
              <span className="super-sidebar-section-eyebrow">01</span>
              <span className="super-sidebar-section-label">Platform</span>
              <span className="super-sidebar-section-rule" aria-hidden="true" />
            </div>
            <ul className="super-sidebar-menu">
              {PLATFORM_LINKS.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={(e) => handleLinkClick(e, item.to)}
                    className={({ isActive }) => `super-sidebar-link${isActive ? " active" : ""}`}
                  >
                    <span className="super-sidebar-link-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <span className="super-sidebar-link-label">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
          <div className="super-sidebar-footer">
            <div>
              <strong>{displayName}</strong>
              <span>Super Owner</span>
            </div>
          </div>
        </div>
      </nav>
    </>
  );
};

export default SuperOwnerSidebar;
