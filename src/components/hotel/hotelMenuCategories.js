// Single source of truth for the hotel-dining menu categories.
// Both HotelDiningPage (admin) and HotelBilling POS (cashier) read from here.
// The actual category list lives in storeSettings.hotelMenuCategories (per
// store), seeded from HOTEL_MENU_DEFAULT_CATEGORIES on first load.

import { getStoreSettings } from "../../services/storeSettingsService";
import { HOTEL_MENU_DEFAULT_CATEGORIES } from "./hotelMenuDefaults";

export const resolveHotelMenuCategories = () => {
  const settings = getStoreSettings();
  const stored =
    settings && Array.isArray(settings.hotelMenuCategories)
      ? settings.hotelMenuCategories.map((c) => String(c || "").trim()).filter(Boolean)
      : [];
  if (stored.length > 0) return stored;
  return HOTEL_MENU_DEFAULT_CATEGORIES.slice();
};

export const DEFAULT_HOTEL_MENU_CATEGORIES = HOTEL_MENU_DEFAULT_CATEGORIES.slice();
