import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import Layout from "../components/layout/Layout";
import POSBilling from "../components/pos/POSBilling";
import LaundryBilling from "../components/laundry/LaundryBilling";
import ServiceBilling from "../components/service/ServiceBilling";
import HotelBilling from "../components/hotel/HotelBilling";
import { getStoreSettings, loadStoreSettings } from "../services/storeSettingsService";
import { getUserStoreType } from "../utils/auth";

const POSPage = () => {
  const location = useLocation();
  const [settings, setSettings] = useState(() => getStoreSettings());

  useEffect(() => {
    let disposed = false;

    const syncSettings = async () => {
      try {
        const nextSettings = await loadStoreSettings();
        if (!disposed) {
          setSettings(nextSettings);
        }
      } catch (err) {
        console.warn("Unable to sync store settings", err);
      }
    };

    const handleActiveStoreChange = () => {
      syncSettings();
    };

    syncSettings();
    window.addEventListener("activeStoreChanged", handleActiveStoreChange);
    window.addEventListener("authChanged", handleActiveStoreChange);
    window.addEventListener("storeSettingsChanged", handleActiveStoreChange);

    return () => {
      disposed = true;
      window.removeEventListener("activeStoreChanged", handleActiveStoreChange);
      window.removeEventListener("authChanged", handleActiveStoreChange);
      window.removeEventListener("storeSettingsChanged", handleActiveStoreChange);
    };
  }, [location.search]);

  const renderBillingComponent = () => {
    const userStoreType = getUserStoreType();
    // Prefer the current user's active store type (if set) over saved store settings.
    const businessType = userStoreType || settings.businessType || "retail";

    if (businessType === "hotel") {
      return <HotelBilling />;
    }

    switch (businessType) {
      case "laundry":
        return <LaundryBilling />;
      case "service":
        return <ServiceBilling />;
      default:
        return <POSBilling />;
    }
  };

  return <Layout>{renderBillingComponent()}</Layout>;
};

export default POSPage;
