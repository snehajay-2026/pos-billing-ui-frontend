import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Form, Button } from "react-bootstrap";
import { canRegister, register } from "../services/authService";
import { useUi } from "../context/UiContext";
import { FaUserPlus, FaEnvelope, FaLock, FaEye, FaEyeSlash } from "react-icons/fa";
import "./Register.css";

const Register = () => {
  const navigate = useNavigate();
  const { locale, languageOptions, language, setLanguage } = useUi();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [available, setAvailable] = useState(false);
  const [isFirstUser, setIsFirstUser] = useState(false);

  const validateEmail = (email) => {
    return /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(email);
  };

  useEffect(() => {
    const loadAvailability = async () => {
      const status = await canRegister();
      setAvailable(status.available);
      setIsFirstUser(status.isFirstUser);
    };
    loadAvailability();
  }, []);

  const validatePassword = (pwd) => {
    return /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?#&])[A-Za-z\d@$!%*?#&]{8,}$/.test(pwd);
  };

  const handleRegister = async () => {
    const normEmail = email.trim().toLowerCase();
    if (!validateEmail(normEmail)) {
      alert(locale.pleaseEnterValidGmail || "Enter a valid Gmail address (example@gmail.com)");
      return;
    }

    if (!validatePassword(password)) {
      alert(
        locale.passwordValidationError ||
          "Password must be at least 8 characters,\ninclude uppercase, lowercase, number and special character."
      );
      return;
    }
    if (password !== confirmPassword) {
      alert(locale.passwordsDoNotMatch || "Passwords do not match!");
      return;
    }

    try {
      await register({ email: normEmail, password, role: "CASHIER", storeType: "retail" });
      alert(locale.registrationSuccess || "Registration successful! Please wait for approval.");
      navigate("/login");
    } catch (err) {
      alert(err.message || locale.registrationFailed || "Registration failed");
    }
  };

  return (
    <div className="register-bg">
      <Card className="register-card fade-in">
        <div className="d-flex flex-column align-items-center mb-3">
          <FaUserPlus size={38} className="mb-2 text-primary" />
          <h3 className="register-title">{locale.registerTitle}</h3>
          <Form.Select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            size="sm"
            className="w-50 mt-3"
          >
            {languageOptions.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </Form.Select>
        </div>
        <Form>
          {/* Email */}
          <Form.Group className="mb-3">
            <Form.Label>
              <FaEnvelope className="me-2 text-secondary" />
              {locale.emailGmailOnly}
            </Form.Label>
            <Form.Control
              type="email"
              placeholder={locale.emailPlaceholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              isInvalid={email && !validateEmail(email)}
            />
            <Form.Control.Feedback type="invalid">
              {locale.pleaseEnterValidGmail}
            </Form.Control.Feedback>
          </Form.Group>

          {/* Password */}
          <Form.Group className="mb-3">
            <Form.Label>
              <FaLock className="me-2 text-secondary" />
              {locale.password}
            </Form.Label>
            <div className="input-group">
              <Form.Control
                type={showPassword ? "text" : "password"}
                placeholder={locale.password}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                isInvalid={password && !validatePassword(password)}
              />
              <Button
                variant="outline-secondary"
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
              >
                {showPassword ? <FaEyeSlash /> : <FaEye />}
              </Button>
            </div>
            <Form.Text className="text-muted">{locale.passwordValidationError}</Form.Text>
            <Form.Control.Feedback type="invalid">{locale.weakPassword}</Form.Control.Feedback>
          </Form.Group>

          {/* Confirm Password */}
          <Form.Group className="mb-3">
            <Form.Label>
              <FaLock className="me-2 text-secondary" />
              {locale.confirmPassword}
            </Form.Label>
            <div className="input-group">
              <Form.Control
                type={showConfirmPassword ? "text" : "password"}
                placeholder={locale.confirmPasswordPlaceholder}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                isInvalid={confirmPassword && password !== confirmPassword}
              />
              <Button
                variant="outline-secondary"
                type="button"
                onClick={() => setShowConfirmPassword((v) => !v)}
                tabIndex={-1}
              >
                {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
              </Button>
            </div>
            <Form.Control.Feedback type="invalid">
              {locale.passwordsDoNotMatch}
            </Form.Control.Feedback>
          </Form.Group>

          <p className="text-center text-danger">
            {available
              ? isFirstUser
                ? locale.firstAdminRegister || "Register the first administrator account."
                : locale.registrationOpen ||
                  "Registration is open. Your account will require approval."
              : locale.registrationDisabled ||
                "Registration is currently disabled. Contact your administrator."}
          </p>

          <Button
            onClick={handleRegister}
            className="w-100 btn-register mt-2"
            size="lg"
            disabled={!available}
          >
            <FaUserPlus className="me-2 mb-1" />
            {available ? locale.register : locale.registrationClosed}
          </Button>
        </Form>
        <p className="text-center mt-3">
          {locale.alreadyHaveAccount || "Already have an account?"}{" "}
          <span className="text-link" onClick={() => navigate("/login")}>
            {locale.loginHere}
          </span>
        </p>
      </Card>
    </div>
  );
};

export default Register;
