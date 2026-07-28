// HotelModuleLockScreen — full-page "module is locked" placeholder.
// Used by every hotel page (and the HotelBilling tabs) when the
// Super Owner has disabled the Lodging or Dining module for the
// current customer. Renders a friendly "contact the Super Owner"
// message for regular users; for the Super Owner it shows a banner
// "you're inspecting a locked module — unlock from /super/hotel-modules"
// so they can still act on the customer.

import React from "react";
import { FaLock, FaKey, FaUserShield, FaArrowLeft } from "react-icons/fa";
import { Link } from "react-router-dom";
import "./HotelBilling.css"; // reuse existing styles for visual consistency

const MODULE_LABELS = {
  lodging: "Lodging",
  dining: "Dining",
  liveBill: "Live Bill",
};

const HotelModuleLockScreen = ({ module, customerEmail = null, bypassForSuperOwner = false }) => {
  const label = MODULE_LABELS[module] || module;
  return (
    <div
      className="hotel-billing-card hotel-module-lock-screen"
      data-locked-module={module}
      style={{ padding: 32, textAlign: "center" }}
    >
      <div
        className="hotel-empty-state hotel-empty-state-rich"
        style={{ border: "none", padding: 24 }}
      >
        <div
          className="hotel-empty-state-icon"
          style={{
            background: "rgba(239, 68, 68, 0.12)",
            color: "#dc2626",
          }}
          aria-hidden="true"
        >
          <FaLock />
        </div>
        <strong style={{ fontSize: 18, color: "#dc2626", marginTop: 12, display: "block" }}>
          {label} module is currently locked
        </strong>
        <span
          style={{
            display: "block",
            marginTop: 6,
            color: "#475569",
            maxWidth: 480,
            marginLeft: "auto",
            marginRight: "auto",
            lineHeight: 1.5,
          }}
        >
          {bypassForSuperOwner ? (
            <>
              You are signed in as a Super Owner and this customer's
              {` ${label.toLowerCase()} `}
              module is locked. You can still inspect the data here, but no edits will be saved.
              Unlock it from the
              <strong> Hotel Module Access</strong> page.
            </>
          ) : (
            <>
              The {label.toLowerCase()} module has been disabled by the Super Owner for this
              customer. Please contact them to enable it.
              {customerEmail ? (
                <>
                  <br />
                  <small style={{ color: "#94a3b8" }}>Customer: {customerEmail}</small>
                </>
              ) : null}
            </>
          )}
        </span>
        {bypassForSuperOwner ? (
          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 10,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <Link
              to="/super/hotel-modules"
              className="hotel-quickbook-btn hotel-quickbook-btn-confirm"
              style={{ textDecoration: "none" }}
            >
              <FaKey className="hotel-quickbook-btn-icon" aria-hidden="true" />
              <span>Open Hotel Module Access</span>
            </Link>
            <Link
              to="/pos"
              className="hotel-quickbook-btn hotel-quickbook-btn-cancel"
              style={{ textDecoration: "none" }}
            >
              <FaArrowLeft className="hotel-quickbook-btn-icon" aria-hidden="true" />
              <span>Back to Hotel POS</span>
            </Link>
          </div>
        ) : (
          <div
            style={{
              marginTop: 18,
              display: "flex",
              gap: 10,
              justifyContent: "center",
            }}
          >
            <Link
              to="/pos"
              className="hotel-quickbook-btn hotel-quickbook-btn-cancel"
              style={{ textDecoration: "none" }}
            >
              <FaArrowLeft className="hotel-quickbook-btn-icon" aria-hidden="true" />
              <span>Back to Hotel POS</span>
            </Link>
            {customerEmail ? (
              <a
                href={`mailto:${customerEmail}?subject=${encodeURIComponent(
                  `${label} module access request`
                )}`}
                className="hotel-quickbook-btn hotel-quickbook-btn-soft"
                style={{ textDecoration: "none" }}
              >
                <FaUserShield className="hotel-quickbook-btn-icon" aria-hidden="true" />
                <span>Contact Super Owner</span>
              </a>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
};

export default HotelModuleLockScreen;
