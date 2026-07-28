import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, Button, Form, Alert, InputGroup } from "react-bootstrap";
import { requestPasswordReset, confirmPasswordReset } from "../services/authService";
import { useUi } from "../context/UiContext";
import { FaEnvelope, FaKey, FaLock, FaEye, FaEyeSlash } from "react-icons/fa";
import "./Login.css";

const PasswordReset = () => {
  const navigate = useNavigate();
  const { locale, languageOptions, language, setLanguage } = useUi();
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [validation, setValidation] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const validateEmail = (value) => /^[a-zA-Z0-9._%+-]+@gmail\.com$/.test(value);
  const validatePassword = (value) =>
    /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?#&]).{8,}$/.test(value);

  const handleRequestReset = async () => {
    if (!validateEmail(email.trim().toLowerCase())) {
      setValidation(locale.pleaseEnterValidGmail);
      return;
    }

    try {
      const response = await requestPasswordReset(email.trim().toLowerCase());
      setMessage(
        response.message || locale.passwordResetInstructions || "Password reset instructions sent."
      );
      setError("");
      setValidation("");
      if (response.resetToken) {
        setToken(response.resetToken);
      }
      setStep(2);
    } catch (err) {
      setError(err.message || locale.passwordResetFailed || "Failed to request password reset.");
    }
  };

  const handleConfirmReset = async () => {
    if (!validateEmail(email.trim().toLowerCase())) {
      setValidation(locale.pleaseEnterValidGmail);
      return;
    }
    if (!token.trim()) {
      setValidation(locale.enterResetTokenValidation || "Enter the reset token.");
      return;
    }
    if (!validatePassword(password)) {
      setValidation(locale.passwordValidationError);
      return;
    }

    try {
      const response = await confirmPasswordReset(
        email.trim().toLowerCase(),
        token.trim(),
        password
      );
      setMessage(
        response.message ||
          locale.passwordResetSuccess ||
          "Password reset successful. Please login."
      );
      setError("");
      setValidation("");
      setTimeout(() => navigate("/login"), 1200);
    } catch (err) {
      setError(err.message || locale.passwordResetFailed || "Failed to reset password.");
    }
  };

  return (
    <div className="d-flex justify-content-center align-items-center vh-100 login-bg">
      <Card className="p-4 shadow login-card fade-in" style={{ width: 420 }}>
        <div className="d-flex flex-column align-items-center mb-3">
          <FaKey size={36} className="mb-2 text-primary" />
          <h3 className="fw-bold mb-2">{locale.passwordReset}</h3>
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
          <p className="text-muted text-center small mb-0">
            {step === 1 ? locale.enterResetInstructions : locale.enterResetToken}
          </p>
        </div>

        {error && <Alert variant="danger">{error}</Alert>}
        {message && <Alert variant="success">{message}</Alert>}
        {validation && <Alert variant="warning">{validation}</Alert>}
        {step === 2 && token && (
          <Alert variant="info">
            {locale.enterResetTokenLabel}: <strong>{token}</strong>
            <div className="mt-2">{locale.resetTokenWarning}</div>
          </Alert>
        )}

        <Form>
          <Form.Group className="mb-3">
            <Form.Label>
              <FaEnvelope className="me-2 text-secondary" />
              {locale.emailLabel}
            </Form.Label>
            <Form.Control
              type="email"
              value={email}
              placeholder={locale.emailPlaceholder}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Form.Group>

          {step === 2 && (
            <>
              <Form.Group className="mb-3">
                <Form.Label>
                  <FaKey className="me-2 text-secondary" />
                  {locale.enterResetTokenLabel}
                </Form.Label>
                <Form.Control
                  type="text"
                  value={token}
                  placeholder={locale.enterResetTokenLabel}
                  onChange={(e) => setToken(e.target.value)}
                />
              </Form.Group>
              <Form.Group className="mb-3">
                <Form.Label>
                  <FaLock className="me-2 text-secondary" />
                  {locale.newPassword}
                </Form.Label>
                <InputGroup>
                  <Form.Control
                    type={showPass ? "text" : "password"}
                    value={password}
                    placeholder={locale.newPassword}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Button variant="outline-secondary" onClick={() => setShowPass(!showPass)}>
                    {showPass ? <FaEyeSlash /> : <FaEye />}
                  </Button>
                </InputGroup>
                <Form.Text className="text-muted">{locale.passwordStrengthInfo}</Form.Text>
              </Form.Group>
            </>
          )}

          {step === 1 ? (
            <Button className="w-100 btn-register" size="lg" onClick={handleRequestReset}>
              {locale.sendResetInstructions}
            </Button>
          ) : (
            <Button className="w-100 btn-register" size="lg" onClick={handleConfirmReset}>
              {locale.resetPassword}
            </Button>
          )}

          <div className="text-center mt-3 small">
            <span className="text-link" onClick={() => navigate("/login")}>
              {locale.backToLogin || "Back to Login"}
            </span>
          </div>
        </Form>
      </Card>
    </div>
  );
};

export default PasswordReset;
