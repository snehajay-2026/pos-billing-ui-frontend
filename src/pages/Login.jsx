import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { login, canRegister } from "../services/authService";
import { loadStoreSettings } from "../services/storeSettingsService";
import { getActiveStoreContext } from "../utils/auth";
import { useUi } from "../context/UiContext";
import {
  FaEye,
  FaEyeSlash,
  FaEnvelope,
  FaLock,
  FaArrowRight,
  FaShieldAlt,
  FaBolt,
  FaReceipt,
  FaUsers,
  FaGlobe,
  FaCheckCircle,
} from "react-icons/fa";
import "./Login.css";

const Login = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { locale, languageOptions, language, setLanguage, showWelcomeSplash } = useUi();

  const sessionExpired = searchParams.get("reason") === "expired";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [loginError, setLoginError] = useState("");
  const [canRegisterAvailable, setCanRegisterAvailable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [capsOn, setCapsOn] = useState(false);

  useEffect(() => {
    const loadAvailability = async () => {
      try {
        const status = await canRegister();
        setCanRegisterAvailable(!!status?.available);
      } catch {
        setCanRegisterAvailable(false);
      }
    };
    loadAvailability();
  }, []);

  const isValidGmail = (value) => /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(value);
  const isValidPassword = (value) =>
    /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?#&]).{8,}$/.test(value);

  const handleLogin = async () => {
    if (submitting) return;
    setLoginError("");
    setEmailError("");
    setPasswordError("");

    if (!email || !password) {
      setLoginError(locale.pleaseEnterBothEmailAndPassword);
      return;
    }
    if (!isValidGmail(email.trim().toLowerCase())) {
      setEmailError(locale.pleaseEnterValidGmail);
      return;
    }
    if (!isValidPassword(password)) {
      setPasswordError(locale.passwordValidationError);
      return;
    }

    setSubmitting(true);
    try {
      const user = await login(email.trim().toLowerCase(), password);
      if (!user) {
        setLoginError(locale.invalidEmailOrPassword);
        setSubmitting(false);
        return;
      }

      try {
        await loadStoreSettings();
        window.dispatchEvent(new Event("themeChanged"));
      } catch (err) {
        console.warn("Failed to load store settings", err);
      }

      showWelcomeSplash(user);
      setLoginError("");
      // Clear the session-expired flash flag so it doesn't reappear if the
      // user navigates back to /login later in this session.
      if (sessionExpired) {
        setSearchParams({}, { replace: true });
      }
      if (user.role === "SUPER_OWNER" && getActiveStoreContext()) {
        navigate("/pos");
      } else if (["SUPER_OWNER", "STORE_ADMIN", "ADMIN"].includes(user.role)) {
        navigate("/dashboard");
      } else {
        navigate("/pos");
      }
    } catch (err) {
      setLoginError(err.message || locale.loginFailedTryAgain);
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleLogin();
    }
    if (e.key === "CapsLock") setCapsOn(e.getModifierState("CapsLock"));
  };

  useEffect(() => {
    const onCaps = (e) => {
      if (typeof e.getModifierState === "function") {
        setCapsOn(e.getModifierState("CapsLock"));
      }
    };
    window.addEventListener("keydown", onCaps);
    return () => window.removeEventListener("keydown", onCaps);
  }, []);

  return (
    <div className="lg-page">
      {/* Brand panel — left side */}
      <aside className="lg-brand">
        <div className="lg-brand-bg" aria-hidden="true" />
        <div className="lg-brand-content">
          <div className="lg-brand-mark">
            <div className="lg-brand-logo">
              <FaReceipt />
            </div>
            <span className="lg-brand-name">
              POS <strong>Suite</strong>
            </span>
          </div>

          <h1 className="lg-brand-title">
            Welcome to your
            <br />
            <span className="lg-brand-gradient">modern retail command center.</span>
          </h1>

          <p className="lg-brand-sub">
            Sign in to manage products, track sales, run billing, and oversee every store across
            retail, laundry, hotel, service, and inventory verticals.
          </p>

          <ul className="lg-brand-features">
            <li>
              <span className="lg-feat-icon tone-emerald">
                <FaBolt />
              </span>
              <div>
                <strong>Lightning-fast billing</strong>
                <small>POS, thermal print, UPI QR — all in one place.</small>
              </div>
            </li>
            <li>
              <span className="lg-feat-icon tone-violet">
                <FaReceipt />
              </span>
              <div>
                <strong>Smart invoicing</strong>
                <small>GST, HSN, multi-bill tabs — ready out of the box.</small>
              </div>
            </li>
            <li>
              <span className="lg-feat-icon tone-sky">
                <FaUsers />
              </span>
              <div>
                <strong>Role-based access</strong>
                <small>Super Owner, Admin, Branch Admin, Cashier.</small>
              </div>
            </li>
            <li>
              <span className="lg-feat-icon tone-amber">
                <FaShieldAlt />
              </span>
              <div>
                <strong>Secure by design</strong>
                <small>Encrypted sessions, password policy enforced.</small>
              </div>
            </li>
          </ul>

          <footer className="lg-brand-foot">
            <span>© {new Date().getFullYear()} POS Suite</span>
            <span>·</span>
            <span>All rights reserved</span>
          </footer>
        </div>
      </aside>

      {/* Mobile-only trademark strip — sits below the auth card on
          phones. Hidden on desktop (the brand-foot inside the brand
          panel already covers that case). */}
      {/* Auth card — right side */}
      <main className="lg-auth">
        <div className="lg-auth-bg" aria-hidden="true" />

        <div className="lg-auth-card">
          {/* Language switcher */}
          <div className="lg-lang">
            <FaGlobe className="lg-lang-ico" />
            <select
              aria-label="Language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="lg-lang-select"
            >
              {languageOptions.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>

          {/* Header */}
          <header className="lg-head">
            <div className="lg-head-eyebrow">
              <FaShieldAlt /> Secure Login
            </div>
            <h2 className="lg-head-title">{locale.signIn}</h2>
            <p className="lg-head-sub">
              Enter your <strong>Gmail</strong> and password to access your dashboard.
            </p>
          </header>

          {/* Form */}
          <form className="lg-form" onKeyDown={handleKeyDown} onSubmit={(e) => e.preventDefault()}>
            {sessionExpired && (
              <div className="lg-error-box" role="alert" data-variant="warning">
                <span>⏱</span>
                <span>Your session has expired. Please log in again.</span>
              </div>
            )}
            {loginError && (
              <div className="lg-error-box" role="alert">
                <span>⚠</span>
                <span>{loginError}</span>
              </div>
            )}

            {/* Email */}
            <label className={`lg-field ${emailError ? "is-error" : ""}`}>
              <span className="lg-field-label">{locale.emailGmailOnly || "Email"}</span>
              <span className="lg-field-row">
                <FaEnvelope className="lg-field-ico" />
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  className="lg-input"
                  placeholder={locale.emailPlaceholder || "example@gmail.com"}
                  value={email}
                  onChange={(e) => {
                    const next = e.target.value;
                    setEmail(next);
                    setEmailError(next && !isValidGmail(next) ? locale.pleaseEnterValidGmail : "");
                  }}
                />
              </span>
              {emailError ? (
                <small className="lg-field-error">{emailError}</small>
              ) : (
                <small className="lg-field-hint">
                  <FaCheckCircle /> Must be a valid @gmail.com address
                </small>
              )}
            </label>

            {/* Password */}
            <label className={`lg-field ${passwordError ? "is-error" : ""}`}>
              <span className="lg-field-label">
                {locale.password || "Password"}
                <button
                  type="button"
                  className="lg-forgot-link"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate("/password-reset");
                  }}
                >
                  {locale.forgotPassword || "Forgot?"}
                </button>
              </span>
              <span className="lg-field-row">
                <FaLock className="lg-field-ico" />
                <input
                  type={showPass ? "text" : "password"}
                  autoComplete="current-password"
                  className="lg-input lg-input-pwd"
                  placeholder={locale.enterPassword || "Enter your password"}
                  value={password}
                  onChange={(e) => {
                    const next = e.target.value;
                    setPassword(next);
                    setPasswordError(
                      next && !isValidPassword(next) ? locale.passwordValidationError : ""
                    );
                  }}
                />
                <button
                  type="button"
                  className="lg-pwd-toggle"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? "Hide password" : "Show password"}
                  title={showPass ? "Hide password" : "Show password"}
                >
                  {showPass ? <FaEyeSlash /> : <FaEye />}
                </button>
              </span>
              {passwordError ? (
                <small className="lg-field-error">{passwordError}</small>
              ) : capsOn ? (
                <small className="lg-field-warn">⚠ Caps Lock is on</small>
              ) : (
                <small className="lg-field-hint">
                  8+ chars · uppercase, lowercase, number, special
                </small>
              )}
            </label>

            <button type="button" className="lg-submit" onClick={handleLogin} disabled={submitting}>
              {submitting ? (
                <>
                  <span className="lg-spinner" />
                  <span>{locale.login}…</span>
                </>
              ) : (
                <>
                  <span>{locale.login}</span>
                  <FaArrowRight />
                </>
              )}
            </button>
          </form>

          {/* Footer link */}
          <footer className="lg-foot">
            {canRegisterAvailable ? (
              <span>
                {locale.newUserText || "New user?"}{" "}
                <button type="button" className="lg-link" onClick={() => navigate("/register")}>
                  {locale.registerHere}
                </button>
              </span>
            ) : (
              <span className="lg-foot-muted">{locale.newUserRegistrationDisabled}</span>
            )}
          </footer>
        </div>
      </main>

      {/* Mobile-only trademark strip — sits below the auth card on
          phones. Hidden on desktop (the brand-foot inside the brand
          panel already covers that case). Must be the LAST child of
          .lg-page so the grid places it in row 3 (auto) instead of
          being assigned the 1fr stretch row. */}
      <div className="lg-trademark" aria-label="Legal">
        <p className="lg-trademark-line">
          © {new Date().getFullYear()} POS Suite · All rights reserved.
        </p>
        <p className="lg-trademark-line lg-trademark-line-sub">Built with ♥ in India · v2.0</p>
      </div>
    </div>
  );
};

export default Login;
