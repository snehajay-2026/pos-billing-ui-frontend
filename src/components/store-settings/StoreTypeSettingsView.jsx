import React from "react";
import {
  BasicStoreSettingsSection,
  BusinessConfigSection,
  PaymentSettingsSection,
  ServiceBusinessDetailsSection,
  LaundryBusinessSettingsSection,
  HotelBusinessSettingsSection,
  CustomerBillingSection,
} from "./StoreSettingsSections";

const settingsViewMap = {
  hotel: {
    title: "Hotel Store Settings",
    description:
      "Manage hotel identity, guest billing defaults, payment details, and invoice branding for your hotel operations.",
    emoji: "🏨",
  },
  laundry: {
    title: "Laundry Store Settings",
    description:
      "Manage laundry store profile, receipt details, payment setup, and customer defaults for fast order billing.",
    emoji: "🧺",
  },
  inventory: {
    title: "Inventory Store Settings",
    description:
      "Manage inventory store profile, payment setup, and billing defaults used across stock and invoice workflows.",
    emoji: "📦",
  },
  service: {
    title: "Service Store Settings",
    description:
      "Manage professional service profile, invoice terms, bank details, and customer billing information.",
    emoji: "🛠️",
  },
  "msme-service": {
    title: "Service Store Settings",
    description:
      "Manage professional service profile, invoice terms, bank details, and customer billing information.",
    emoji: "🛠️",
  },
  retail: {
    title: "Retail Store Settings",
    description:
      "Manage retail store profile, payment QR setup, and customer billing defaults for everyday invoicing.",
    emoji: "🏪",
  },
};

const resolveStoreType = (settings, userStoreType) =>
  userStoreType || settings.businessType || "retail";

const SettingsHeader = ({ title, description, emoji }) => (
  <div className="ss-section-header">
    <div className="ss-section-icon">{emoji}</div>
    <div>
      <h5>{title}</h5>
      <p>{description}</p>
    </div>
  </div>
);

const Section = ({ title, description, emoji, children }) => (
  <div className="ss-section">
    <SettingsHeader title={title} description={description} emoji={emoji} />
    <div className="ss-section-body">{children}</div>
  </div>
);

const CommonSettingsSections = (props) => (
  <>
    <BasicStoreSettingsSection {...props} />
    <BusinessConfigSection settings={props.settings} userStoreType={props.userStoreType} />
    <PaymentSettingsSection settings={props.settings} handleChange={props.handleChange} />
  </>
);

const RetailStoreSettings = (props) => (
  <>
    <SettingsHeader {...settingsViewMap.retail} />
    <CommonSettingsSections {...props} />
    <CustomerBillingSection
      settings={props.settings}
      handleChange={props.handleChange}
      isServiceBusiness={false}
    />
  </>
);

const LaundryStoreSettings = (props) => (
  <>
    <SettingsHeader {...settingsViewMap.laundry} />
    <CommonSettingsSections {...props} />
    <LaundryBusinessSettingsSection settings={props.settings} handleChange={props.handleChange} />
    <CustomerBillingSection
      settings={props.settings}
      handleChange={props.handleChange}
      isServiceBusiness={false}
    />
  </>
);

const InventoryStoreSettings = (props) => (
  <>
    <SettingsHeader {...settingsViewMap.inventory} />
    <CommonSettingsSections {...props} />
    <CustomerBillingSection
      settings={props.settings}
      handleChange={props.handleChange}
      isServiceBusiness={false}
    />
  </>
);

const HotelStoreSettings = (props) => (
  <>
    <SettingsHeader {...settingsViewMap.hotel} />
    <CommonSettingsSections {...props} />
    <HotelBusinessSettingsSection settings={props.settings} handleChange={props.handleChange} />
    <CustomerBillingSection
      settings={props.settings}
      handleChange={props.handleChange}
      isServiceBusiness={false}
    />
  </>
);

const ServiceStoreSettings = (props) => (
  <>
    <SettingsHeader {...settingsViewMap.service} />
    <CommonSettingsSections {...props} />
    <ServiceBusinessDetailsSection settings={props.settings} handleChange={props.handleChange} />
    <CustomerBillingSection
      settings={props.settings}
      handleChange={props.handleChange}
      isServiceBusiness
    />
  </>
);

const StoreTypeSettingsView = ({
  settings,
  handleChange,
  uploadLogo,
  userStoreType,
  logoPreview,
  dragOver,
  setDragOver,
  handleDrop,
  removeLogo,
}) => {
  const storeType = resolveStoreType(settings, userStoreType);
  const viewProps = {
    settings,
    handleChange,
    uploadLogo,
    userStoreType,
    logoPreview,
    dragOver,
    setDragOver,
    handleDrop,
    removeLogo,
    phoneAlert: !settings.phone
      ? "Store phone number is empty. Please add your own store mobile number before saving."
      : "",
  };

  switch (storeType) {
    case "hotel":
      return <HotelStoreSettings {...viewProps} />;
    case "laundry":
      return <LaundryStoreSettings {...viewProps} />;
    case "inventory":
      return <InventoryStoreSettings {...viewProps} />;
    case "service":
    case "msme-service":
      return <ServiceStoreSettings {...viewProps} />;
    case "retail":
    default:
      return <RetailStoreSettings {...viewProps} />;
  }
};

export default StoreTypeSettingsView;
export { Section, SettingsHeader };
