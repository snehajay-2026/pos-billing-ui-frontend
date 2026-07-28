import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getStoreSettings,
  loadStoreSettings,
  saveStoreSettings,
} from "../services/storeSettingsService";
import { getUser, getUserStoreType, getActiveStoreContext } from "../utils/auth";
import { useUi } from "../context/UiContext";
import {
  FaRegSave,
  FaStore,
  FaArrowLeft,
  FaCheckCircle,
  FaExclamationTriangle,
  FaInfoCircle,
  FaCog,
  FaImage,
} from "react-icons/fa";
import StoreTypeSettingsView from "../components/store-settings/StoreTypeSettingsView";
import "./StoreSettings.css";

const StoreSettings = () => {
  const navigate = useNavigate();
  const user = getUser();
  const userStoreType = getUserStoreType();
  const { showToast } = useUi();
  const normalizeMobile = (value = "") => value.replace(/\D/g, "").slice(0, 10);
  const [settings, setSettings] = useState(() => {
    const initial = getStoreSettings();
    return {
      ...initial,
      phone: normalizeMobile(initial.phone),
      customerMobile: normalizeMobile(initial.customerMobile),
    };
  });
  const [formError, setFormError] = useState("");
  const [logoMessage, setLogoMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [logoPreview, setLogoPreview] = useState(() => getStoreSettings().logo || "");
  const [dragOver, setDragOver] = useState(false);

  const MAX_LOGO_FILE_SIZE = 5 * 1024 * 1024;

  const resizeLogoFile = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const maxDimension = 600;
          const scale = Math.min(1, maxDimension / Math.max(image.width || 1, image.height || 1));
          const width = Math.max(1, Math.round(image.width * scale));
          const height = Math.max(1, Math.round(image.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (!context) {
            reject(new Error("Canvas is not supported in this browser."));
            return;
          }
          context.drawImage(image, 0, 0, width, height);
          const resized = canvas.toDataURL("image/jpeg", 0.82);
          resolve(resized);
        };
        image.onerror = () => reject(new Error("Unable to read image."));
        image.src = String(reader.result || "");
      };
      reader.onerror = () => reject(new Error("Unable to read file."));
      reader.readAsDataURL(file);
    });

  const isValidIndianMobile = (value = "") => {
    const digits = normalizeMobile(value);
    return /^[6-9]\d{9}$/.test(digits);
  };

  React.useEffect(() => {
    window.history.pushState({ storesettings: true }, "", window.location.href);
    const handlePopState = (e) => {
      e.preventDefault && e.preventDefault();
      navigate("/pos", { replace: true });
    };
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [navigate]);

  useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      try {
        const next = await loadStoreSettings();
        if (!active) return;
        setSettings({
          ...next,
          phone: normalizeMobile(next.phone),
          customerMobile: normalizeMobile(next.customerMobile),
        });
        setLogoPreview(next.logo || "");
      } catch (err) {
        console.warn("Unable to load store settings", err);
      }
    };

    loadSettings();

    const handleStoreChange = () => {
      loadSettings();
    };

    window.addEventListener("activeStoreChanged", handleStoreChange);
    window.addEventListener("authChanged", handleStoreChange);

    return () => {
      active = false;
      window.removeEventListener("activeStoreChanged", handleStoreChange);
      window.removeEventListener("authChanged", handleStoreChange);
    };
  }, []);

  const handleChange = (e) => {
    if (e.target.name === "phone" || e.target.name === "customerMobile") {
      const value = normalizeMobile(e.target.value);
      setSettings({ ...settings, [e.target.name]: value });
    } else {
      setSettings({ ...settings, [e.target.name]: e.target.value });
    }
  };

  const handleLogoFile = async (file) => {
    if (!file) return;
    try {
      setFormError("");
      setLogoMessage("");
      if (file.size > MAX_LOGO_FILE_SIZE) {
        setLogoMessage("Large logo detected — it will be compressed before saving.");
      }
      const resizedLogo = await resizeLogoFile(file);
      setSettings({ ...settings, logo: resizedLogo });
      setLogoPreview(resizedLogo);
      setLogoMessage((previous) => previous || "Logo optimized successfully for faster saving.");
    } catch (error) {
      setFormError(error?.message || "Unable to process the selected logo.");
      setLogoMessage("");
    }
  };

  const uploadLogo = async (e) => {
    await handleLogoFile(e.target.files?.[0]);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setDragOver(false);
    await handleLogoFile(e.dataTransfer.files?.[0]);
  };

  const removeLogo = () => {
    setSettings({ ...settings, logo: "" });
    setLogoPreview("");
    setLogoMessage("Logo removed. Save to apply.");
  };

  const save = async () => {
    if (!settings.phone) {
      setFormError("Store phone is required.");
      showToast("error", "Store phone is required");
      return;
    }

    if (!isValidIndianMobile(settings.phone)) {
      setFormError("Store phone must be a valid 10-digit Indian mobile number.");
      showToast("error", "Enter a valid 10-digit store phone");
      return;
    }

    if (settings.customerMobile && !isValidIndianMobile(settings.customerMobile)) {
      setFormError("Customer mobile must be a valid 10-digit Indian mobile number.");
      showToast("error", "Customer mobile is invalid");
      return;
    }

    setSaving(true);
    try {
      setFormError("");
      await saveStoreSettings(settings);
      window.dispatchEvent(new Event("storeSettingsChanged"));
      window.dispatchEvent(new Event("themeChanged"));
      showToast("success", "Store settings saved");
      navigate("/pos");
    } catch (error) {
      setFormError(error?.message || "Failed to save store settings.");
      showToast("error", "Failed to save store settings");
    } finally {
      setSaving(false);
    }
  };

  const activeStore = getActiveStoreContext();
  const activeStoreLabel = activeStore
    ? `${(activeStore.storeType || "Store").toUpperCase()}${activeStore.storeId ? ` · ${activeStore.storeId}` : ""}`
    : userStoreType
      ? `${userStoreType.toUpperCase()} store`
      : "Selected store";

  const noSelectedStore = !activeStore && user?.role === "SUPER_OWNER";

  const completion = (() => {
    let filled = 0;
    const total = 5;
    if (settings.name) filled += 1;
    if (settings.phone && isValidIndianMobile(settings.phone)) filled += 1;
    if (settings.address) filled += 1;
    if (settings.upiId) filled += 1;
    if (settings.logo) filled += 1;
    return Math.round((filled / total) * 100);
  })();

  const completionTone = completion >= 80 ? "ss-good" : completion >= 50 ? "ss-mid" : "ss-low";

  return (
    <div className="ss-page">
      {/* Hero */}
      <header className="ss-hero">
        <div className="ss-hero-text">
          <span className="ss-eyebrow">
            <FaCog /> Configuration
          </span>
          <h2 className="ss-hero-title">Store Settings</h2>
          <p className="ss-hero-sub">
            Configure your <strong>{activeStoreLabel}</strong> — these settings are saved per store
            and do not affect other stores.
          </p>
        </div>
        <div className="ss-hero-actions">
          <button
            type="button"
            className="ss-back-btn"
            onClick={() => navigate("/pos")}
            title="Back to POS"
          >
            <FaArrowLeft />
            <span>Back</span>
          </button>
        </div>
      </header>

      {/* Quick status strip */}
      <section className="ss-status-strip">
        <div className={`ss-status ${completionTone}`}>
          <div className="ss-status-icon">
            <FaCheckCircle />
          </div>
          <div className="ss-status-meta">
            <span>Profile completeness</span>
            <strong>{completion}%</strong>
          </div>
          <div className="ss-status-track">
            <div className="ss-status-fill" style={{ width: `${completion}%` }} />
          </div>
        </div>

        <div className="ss-status ss-status-info">
          <div className="ss-status-icon">
            <FaStore />
          </div>
          <div className="ss-status-meta">
            <span>Active store</span>
            <strong>{activeStoreLabel}</strong>
          </div>
        </div>

        <div className="ss-status ss-status-photo">
          <div className="ss-status-icon">{logoPreview ? <FaCheckCircle /> : <FaImage />}</div>
          <div className="ss-status-meta">
            <span>Logo</span>
            <strong>{logoPreview ? "Uploaded" : "Not set"}</strong>
          </div>
        </div>
      </section>

      {noSelectedStore && (
        <div className="ss-warn-box">
          <FaExclamationTriangle />
          <span>
            Select the store first from the header store selector before editing Store Settings.
          </span>
        </div>
      )}

      {/* Sections card */}
      <section className="ss-card">
        <StoreTypeSettingsView
          settings={settings}
          handleChange={handleChange}
          uploadLogo={uploadLogo}
          userStoreType={userStoreType}
          logoPreview={logoPreview}
          dragOver={dragOver}
          setDragOver={setDragOver}
          handleDrop={handleDrop}
          removeLogo={removeLogo}
        />

        {formError && (
          <div className="ss-error-box">
            <FaExclamationTriangle />
            <span>{formError}</span>
          </div>
        )}

        {logoMessage && !formError && (
          <div className="ss-info-box">
            <FaInfoCircle />
            <span>{logoMessage}</span>
          </div>
        )}
      </section>

      {/* Sticky footer with save */}
      <div className="ss-footer">
        <div className="ss-footer-meta">
          <span className="ss-footer-eyebrow">Ready to apply?</span>
          <strong>Save these settings to update receipts, QR codes and invoices.</strong>
        </div>
        <button
          type="button"
          className="ss-save-btn"
          onClick={save}
          disabled={noSelectedStore || saving}
        >
          {saving ? <span className="ss-spinner" /> : <FaRegSave />}
          <span>{saving ? "Saving…" : "Save Settings"}</span>
        </button>
      </div>
    </div>
  );
};

export default StoreSettings;
