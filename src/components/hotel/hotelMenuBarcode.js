// Shared helper for creating a unique barcode for hotel menu items.
// Extracted into its own module so it can be used by both manual entry
// (HotelDiningPage) and bulk import (MenuBulkImportModal).

export const createMenuBarcode = () => `HM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
