import React from "react";
import {
  FaStore,
  FaMapMarkerAlt,
  FaPhone,
  FaQrcode,
  FaBuilding,
  FaUniversity,
  FaRegAddressCard,
  FaRupeeSign,
  FaIdCard,
  FaCity,
  FaMapPin,
  FaEnvelope,
  FaPercent,
  FaCalendarAlt,
  FaClock,
  FaFileSignature,
  FaKey,
  FaCodeBranch,
  FaCommentDots,
  FaCloudUploadAlt,
  FaTrashAlt,
  FaImage,
  FaCheck,
} from "react-icons/fa";

/* ---------------- Reusable input wrappers ---------------- */
const Field = ({ icon, label, error, hint, children }) => (
  <div className={`ss-field ${error ? "is-error" : ""}`}>
    {label ? <label className="ss-field-label">{label}</label> : null}
    <div className="ss-field-row">
      {icon ? <span className="ss-field-icon">{icon}</span> : null}
      <div className="ss-field-control">{children}</div>
    </div>
    {hint && !error ? <small className="ss-field-hint">{hint}</small> : null}
    {error ? <small className="ss-field-error">{error}</small> : null}
  </div>
);

const Input = (props) => <input {...props} className={`ss-input ${props.className || ""}`} />;

const Textarea = (props) => (
  <textarea {...props} className={`ss-input ss-textarea ${props.className || ""}`} />
);

const Select = (props) => (
  <select {...props} className={`ss-input ss-select ${props.className || ""}`} />
);

/* ---------------- Section title ---------------- */
export const SectionTitle = ({ icon, title, subtitle }) => (
  <div className="ss-section-title">
    <span className="ss-section-title-ico">{icon}</span>
    <div>
      <h6>{title}</h6>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  </div>
);

/* ---------------- Basic Information ---------------- */
export const BasicStoreSettingsSection = ({
  settings,
  handleChange,
  uploadLogo,
  phoneAlert,
  logoPreview,
  dragOver,
  setDragOver,
  handleDrop,
  removeLogo,
}) => (
  <div className="ss-section">
    <SectionTitle
      icon={<FaRegAddressCard />}
      title="Basic Information"
      subtitle="Store name, contact and branding."
    />

    <div className="ss-grid-2">
      <Field icon={<FaStore />} label="Store Name">
        <Input
          name="name"
          value={settings.name}
          onChange={handleChange}
          placeholder="My Retail Store"
        />
      </Field>

      <Field
        icon={<FaPhone />}
        label="Store Phone"
        error={phoneAlert && !settings.phone ? phoneAlert : null}
        hint="10-digit Indian mobile number."
      >
        <div className="ss-prefixed-input">
          <span className="ss-prefix">+91</span>
          <Input
            name="phone"
            type="tel"
            inputMode="numeric"
            pattern="[0-9]*"
            value={settings.phone}
            onChange={handleChange}
            placeholder="9876543210"
            maxLength={10}
          />
        </div>
      </Field>
    </div>

    <Field icon={<FaMapMarkerAlt />} label="Address">
      <Textarea
        name="address"
        rows={3}
        value={settings.address}
        onChange={handleChange}
        placeholder="Shop 12, Main Road, Bengaluru, KA 560001"
      />
    </Field>

    {/* Logo upload — drag & drop + preview */}
    <div className="ss-logo-section">
      <Field
        icon={<FaImage />}
        label="Logo"
        hint="PNG or JPEG · max 5MB · automatically resized to 600px."
      >
        <div className="ss-logo-empty" />
      </Field>
      <div
        className={`ss-dropzone ${dragOver ? "is-drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver && setDragOver(true);
        }}
        onDragLeave={() => setDragOver && setDragOver(false)}
        onDrop={handleDrop}
      >
        {logoPreview ? (
          <div className="ss-logo-preview">
            <img src={logoPreview} alt="Logo preview" />
            <div className="ss-logo-actions">
              <label className="ss-btn ss-btn-soft ss-btn-sm">
                <FaCloudUploadAlt />
                <span>Replace</span>
                <input
                  type="file"
                  accept="image/png, image/jpeg"
                  style={{ display: "none" }}
                  onChange={uploadLogo}
                />
              </label>
              <button
                type="button"
                className="ss-btn ss-btn-danger-soft ss-btn-sm"
                onClick={removeLogo}
              >
                <FaTrashAlt />
                <span>Remove</span>
              </button>
            </div>
          </div>
        ) : (
          <label className="ss-dropzone-empty">
            <FaCloudUploadAlt className="ss-dropzone-ico" />
            <strong>Drop your logo here</strong>
            <span>or click to browse files</span>
            <input
              type="file"
              accept="image/png, image/jpeg"
              style={{ display: "none" }}
              onChange={uploadLogo}
            />
          </label>
        )}
      </div>
    </div>
  </div>
);

/* ---------------- Business Configuration ---------------- */
export const BusinessConfigSection = ({ settings, userStoreType }) => {
  const lockType = !!userStoreType;
  return (
    <div className="ss-section">
      <SectionTitle
        icon={<FaBuilding />}
        title="Business Configuration"
        subtitle="Type of business and registration."
      />

      <div className="ss-grid-2">
        <Field icon={<FaBuilding />} label="Business Type" hint="Locked to your registration.">
          <Select
            name="businessType"
            value={settings.businessType || userStoreType || "retail"}
            disabled={lockType}
          >
            {userStoreType === "retail" && <option value="retail">Retail Store</option>}
            {userStoreType === "laundry" && <option value="laundry">Laundry Service</option>}
            {userStoreType === "service" && (
              <option value="service">Professional Services (MSME)</option>
            )}
            {userStoreType === "msme-service" && (
              <option value="msme-service">Professional Services (MSME)</option>
            )}
            {userStoreType === "inventory" && <option value="inventory">Inventory</option>}
            {userStoreType === "hotel" && <option value="hotel">Hotel</option>}
            {!userStoreType && (
              <>
                <option value="retail">Retail Store</option>
                <option value="laundry">Laundry Service</option>
                <option value="service">Professional Services (MSME)</option>
                <option value="msme-service">Professional Services (MSME)</option>
                <option value="inventory">Inventory</option>
                <option value="hotel">Hotel</option>
              </>
            )}
          </Select>
        </Field>

        {lockType ? (
          <div className="ss-info-box">
            <FaCheck />
            <div>
              <strong>
                Store type is locked to{" "}
                {userStoreType.charAt(0).toUpperCase() + userStoreType.slice(1)}
              </strong>
              <p>To change store type, please register a new store.</p>
            </div>
          </div>
        ) : (
          <div className="ss-info-box">
            <FaCheck />
            <div>
              <strong>Store type can be changed anytime</strong>
              <p>Pick the option that best matches your business operations.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ---------------- Payment Settings ---------------- */
export const PaymentSettingsSection = ({ settings, handleChange }) => (
  <div className="ss-section">
    <SectionTitle
      icon={<FaQrcode />}
      title="Payment Settings"
      subtitle="UPI QR and invoice QR configuration."
    />

    <div className="ss-grid-2">
      <Field icon={<FaQrcode />} label="UPI ID" hint="Shown on receipts for UPI payments.">
        <Input
          name="upiId"
          value={settings.upiId}
          onChange={handleChange}
          placeholder="store@upi"
        />
      </Field>

      <Field icon={<FaQrcode />} label="QR Type">
        <Select name="qrType" value={settings.qrType} onChange={handleChange}>
          <option value="UPI">UPI QR</option>
          <option value="INVOICE">Invoice QR</option>
          <option value="BOTH">Both</option>
        </Select>
      </Field>
    </div>
  </div>
);

/* ---------------- Hotel Operations ---------------- */
export const HotelBusinessSettingsSection = ({ settings, handleChange }) => (
  <div className="ss-section">
    <SectionTitle
      icon={<FaRegAddressCard />}
      title="Hotel Operations"
      subtitle="Check-in / out times and menu configuration."
    />

    <div className="ss-grid-2">
      <Field icon={<FaClock />} label="Standard check-in time">
        <Input
          name="hotelCheckinTime"
          type="time"
          value={settings.hotelCheckinTime ?? "12:00"}
          onChange={handleChange}
        />
      </Field>
      <Field icon={<FaClock />} label="Standard check-out time">
        <Input
          name="hotelCheckoutTime"
          type="time"
          value={settings.hotelCheckoutTime ?? "11:00"}
          onChange={handleChange}
        />
      </Field>
    </div>

    <div className="ss-grid-2">
      <Field icon={<FaRupeeSign />} label="Early check-in fee" hint="0 = no fee.">
        <Input
          name="hotelEarlyCheckinFee"
          type="number"
          min="0"
          value={settings.hotelEarlyCheckinFee ?? "0"}
          onChange={handleChange}
          placeholder="0"
        />
      </Field>
      <Field
        icon={<FaRupeeSign />}
        label="Late check-out fee per hour"
        hint="Auto-added when guest overstays check-out."
      >
        <Input
          name="hotelLateCheckoutFeePerHour"
          type="number"
          min="0"
          value={settings.hotelLateCheckoutFeePerHour ?? "200"}
          onChange={handleChange}
          placeholder="200"
        />
      </Field>
    </div>

    <Field
      icon={<FaCalendarAlt />}
      label="No-show grace (hours)"
      hint="Hours after check-in (or 18:00) before a booking is a no-show."
    >
      <Input
        name="hotelNoShowGraceHours"
        type="number"
        min="0"
        value={settings.hotelNoShowGraceHours ?? "6"}
        onChange={handleChange}
        placeholder="6"
      />
    </Field>

    <Field
      icon={<FaRegAddressCard />}
      label="Menu categories"
      hint="Comma-separated — leave blank for defaults."
    >
      <Input
        name="hotelMenuCategories"
        value={
          Array.isArray(settings.hotelMenuCategories) ? settings.hotelMenuCategories.join(", ") : ""
        }
        onChange={(e) => {
          const list = String(e.target.value || "")
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean);
          handleChange({ target: { name: "hotelMenuCategories", value: list } });
        }}
        placeholder="Veg Menu, Non Veg Menu, Starter, Chinese, Desserts, Beverages"
      />
    </Field>
  </div>
);

/* ---------------- Laundry Operations ---------------- */
export const LaundryBusinessSettingsSection = ({ settings, handleChange }) => (
  <div className="ss-section">
    <SectionTitle
      icon={<FaRegAddressCard />}
      title="Laundry Operations"
      subtitle="Express fee, turnaround and token prefix."
    />

    <div className="ss-grid-2">
      <Field
        icon={<FaRupeeSign />}
        label="Express / Same-day surcharge"
        hint="Added on top of the bill when Express is chosen."
      >
        <Input
          name="laundryExpressFee"
          type="number"
          min="0"
          value={settings.laundryExpressFee ?? "80"}
          onChange={handleChange}
          placeholder="80"
        />
      </Field>

      <Field
        icon={<FaCalendarAlt />}
        label="Default turnaround (days)"
        hint="Pre-fills the expected return date on new orders."
      >
        <Input
          name="laundryDefaultTurnaroundDays"
          type="number"
          min="1"
          value={settings.laundryDefaultTurnaroundDays ?? "2"}
          onChange={handleChange}
          placeholder="2"
        />
      </Field>
    </div>

    <Field icon={<FaKey />} label="Token prefix" hint="Prefix printed on receipts (e.g. LD-0042).">
      <Input
        name="laundryTokenPrefix"
        value={settings.laundryTokenPrefix ?? "LD"}
        onChange={handleChange}
        placeholder="LD"
        maxLength={4}
      />
    </Field>
  </div>
);

/* ---------------- MSME Business Details ---------------- */
export const ServiceBusinessDetailsSection = ({ settings, handleChange }) => (
  <>
    <div className="ss-section">
      <SectionTitle
        icon={<FaRegAddressCard />}
        title="MSME Business Details"
        subtitle="GST, PAN and contact details for invoicing."
      />

      <div className="ss-grid-2">
        <Field icon={<FaIdCard />} label="GST Number">
          <Input
            name="gstNo"
            value={settings.gstNo || ""}
            onChange={handleChange}
            placeholder="22AAAAA0000A1Z5"
          />
        </Field>
        <Field icon={<FaIdCard />} label="PAN Number">
          <Input
            name="panNo"
            value={settings.panNo || ""}
            onChange={handleChange}
            placeholder="AAAAA0000A"
          />
        </Field>
      </div>

      <Field icon={<FaEnvelope />} label="Email">
        <Input
          name="email"
          type="email"
          value={settings.email || ""}
          onChange={handleChange}
          placeholder="info@company.com"
        />
      </Field>

      <div className="ss-grid-3">
        <Field icon={<FaCity />} label="City">
          <Input
            name="city"
            value={settings.city || ""}
            onChange={handleChange}
            placeholder="Mumbai"
          />
        </Field>
        <Field icon={<FaMapPin />} label="State">
          <Input
            name="state"
            value={settings.state || ""}
            onChange={handleChange}
            placeholder="Maharashtra"
          />
        </Field>
        <Field icon={<FaMapPin />} label="Pincode">
          <Input
            name="pincode"
            value={settings.pincode || ""}
            onChange={handleChange}
            placeholder="400001"
          />
        </Field>
      </div>
    </div>

    <div className="ss-section">
      <SectionTitle
        icon={<FaUniversity />}
        title="Bank Details"
        subtitle="Shown on invoices for direct bank transfer."
      />
      <div className="ss-grid-2">
        <Field icon={<FaUniversity />} label="Bank Name">
          <Input
            name="bankName"
            value={settings.bankName || ""}
            onChange={handleChange}
            placeholder="State Bank of India"
          />
        </Field>
        <Field icon={<FaKey />} label="Account Number">
          <Input
            name="accountNo"
            value={settings.accountNo || ""}
            onChange={handleChange}
            placeholder="1234567890"
          />
        </Field>
      </div>
      <div className="ss-grid-2">
        <Field icon={<FaCodeBranch />} label="IFSC Code">
          <Input
            name="ifscCode"
            value={settings.ifscCode || ""}
            onChange={handleChange}
            placeholder="SBIN0001234"
          />
        </Field>
        <Field icon={<FaMapPin />} label="Branch">
          <Input
            name="branch"
            value={settings.branch || ""}
            onChange={handleChange}
            placeholder="Main Branch"
          />
        </Field>
      </div>
    </div>

    <div className="ss-section">
      <SectionTitle
        icon={<FaRegAddressCard />}
        title="Service Invoice Settings"
        subtitle="Invoice terms and footer details."
      />
      <div className="ss-grid-2">
        <Field icon={<FaRegAddressCard />} label="Invoice Title">
          <Input
            name="serviceInvoiceTitle"
            value={settings.serviceInvoiceTitle || ""}
            onChange={handleChange}
            placeholder="Invoice Service"
          />
        </Field>
        <Field icon={<FaKey />} label="Invoice Prefix">
          <Input
            name="serviceInvoicePrefix"
            value={settings.serviceInvoicePrefix || ""}
            onChange={handleChange}
            placeholder="SI"
          />
        </Field>
      </div>

      <div className="ss-grid-2">
        <Field
          icon={<FaCalendarAlt />}
          label="Due Days"
          hint="Days after invoice date before payment is due."
        >
          <Input
            name="serviceDueDays"
            type="number"
            value={settings.serviceDueDays ?? ""}
            onChange={handleChange}
            placeholder="0"
          />
        </Field>
      </div>

      <div className="ss-info-box" role="note">
        <FaPercent />
        <span>
          GST % is now entered per bill in Service Billing → Bill Summary. Store-level defaults are
          intentionally not used — every invoice carries the rate the cashier typed at billing time.
        </span>
      </div>

      <Field icon={<FaKey />} label="Bank Account (display)">
        <Input
          name="serviceBankAccount"
          value={settings.serviceBankAccount || ""}
          onChange={handleChange}
          placeholder="1234-5678-9012-3456"
        />
      </Field>

      <Field icon={<FaCommentDots />} label="Terms & Conditions (one per line)">
        <Textarea
          name="serviceTerms"
          rows={4}
          value={settings.serviceTerms || ""}
          onChange={handleChange}
          placeholder={
            "Payment is due upon receipt of this invoice.\nLate payments may incur additional charges."
          }
        />
      </Field>

      <div className="ss-grid-2">
        <Field icon={<FaPhone />} label="Footer Phone">
          <Input
            name="serviceFooterPhone"
            value={settings.serviceFooterPhone || ""}
            onChange={handleChange}
            placeholder={settings.phone || ""}
          />
        </Field>
        <Field icon={<FaEnvelope />} label="Footer Email">
          <Input
            name="serviceFooterEmail"
            value={settings.serviceFooterEmail || ""}
            onChange={handleChange}
            placeholder={settings.email || ""}
          />
        </Field>
      </div>

      <Field icon={<FaFileSignature />} label="Signature Name">
        <Input
          name="serviceSignatureName"
          value={settings.serviceSignatureName || ""}
          onChange={handleChange}
          placeholder={settings.name || ""}
        />
      </Field>
    </div>
  </>
);
