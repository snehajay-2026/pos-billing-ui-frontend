import React from "react";
import { useUi } from "../../context/UiContext";
import { FaShieldAlt, FaCheck } from "react-icons/fa";
import "./WelcomeSplash.css";

// Deterministic gradient — same approach as the header avatar circle so
// the splash's avatar matches the one shown in the navbar.
const avatarGradient = (value) => {
  const text = String(value || "user");
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) % 360;
  }
  const h2 = (h + 36) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 56%), hsl(${h2} 72% 46%))`;
};

const initials = (value) => {
  const text = String(value || "").trim();
  if (!text) return "U";
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return text.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

const ROLE_LABEL = {
  SUPER_OWNER: "Super Owner",
  ADMIN: "Admin",
  STORE_ADMIN: "Branch Admin",
  CASHIER: "Cashier",
};

const WelcomeSplash = () => {
  const { welcomeSplash, dismissWelcomeSplash } = useUi();
  if (!welcomeSplash) return null;

  const { name, role, email } = welcomeSplash;
  const roleLabel = ROLE_LABEL[role] || role.replace(/_/g, " ") || "Member";

  return (
    <div className="welcome-splash" role="status" aria-live="polite" onClick={dismissWelcomeSplash}>
      <div className="welcome-splash-bg" aria-hidden="true" />
      <div className="welcome-splash-card">
        <div
          className="welcome-splash-avatar"
          style={{ background: avatarGradient(name) }}
          aria-hidden="true"
        >
          <span className="welcome-splash-initials">{initials(name)}</span>
          <span className="welcome-splash-check" aria-hidden="true">
            <FaCheck />
          </span>
        </div>

        <p className="welcome-splash-eyebrow">
          <FaShieldAlt aria-hidden="true" /> Signed in
        </p>
        <h2 className="welcome-splash-title">
          Welcome back,
          <br />
          <strong>{name}</strong>
        </h2>
        <p className="welcome-splash-role">
          <span className="welcome-splash-role-pill">{roleLabel}</span>
          {email ? <span className="welcome-splash-email">{email}</span> : null}
        </p>

        <div className="welcome-splash-progress" aria-hidden="true">
          <span className="welcome-splash-progress-bar" />
        </div>
        <p className="welcome-splash-hint">Tap anywhere to continue</p>
      </div>
    </div>
  );
};

export default WelcomeSplash;
