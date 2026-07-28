// Shared laundry service catalog and helpers.
// Single source of truth used by LaundryBilling, LaundryServicePage and LaundryOrderPage
// so default services, categories and the "is this a laundry service?" test stay in sync.

export const LAUNDRY_CATEGORIES = [
  "Washing",
  "Dry Cleaning",
  "Ironing",
  "Household",
  "Special Care",
  "Add-on",
];

// "All" pseudo-category used by the billing category strip.
export const LAUNDRY_CATEGORY_ORDER = ["All", ...LAUNDRY_CATEGORIES];

export const LAUNDRY_SERVICE_CATALOG = [
  {
    name: "Wash and Fold - 5kg",
    price: 150,
    gst: 5,
    stock: 999,
    barcode: "LD-WF-5KG",
    category: "Washing",
  },
  {
    name: "Wash and Iron - 5kg",
    price: 220,
    gst: 5,
    stock: 999,
    barcode: "LD-WI-5KG",
    category: "Washing",
  },
  {
    name: "Dry Cleaning - Shirt",
    price: 100,
    gst: 12,
    stock: 999,
    barcode: "LD-DC-SHIRT",
    category: "Dry Cleaning",
  },
  {
    name: "Dry Cleaning - Suit",
    price: 350,
    gst: 12,
    stock: 999,
    barcode: "LD-DC-SUIT",
    category: "Dry Cleaning",
  },
  {
    name: "Steam Iron - Shirt",
    price: 25,
    gst: 5,
    stock: 999,
    barcode: "LD-SI-SHIRT",
    category: "Ironing",
  },
  {
    name: "Ironing - Shirt",
    price: 20,
    gst: 5,
    stock: 999,
    barcode: "LD-IR-SHIRT",
    category: "Ironing",
  },
  {
    name: "Ironing - Saree",
    price: 80,
    gst: 5,
    stock: 999,
    barcode: "LD-IR-SAREE",
    category: "Ironing",
  },
  {
    name: "Blanket Wash - Single",
    price: 180,
    gst: 5,
    stock: 999,
    barcode: "LD-BLANKET-S",
    category: "Household",
  },
  {
    name: "Blanket Wash - Double",
    price: 260,
    gst: 5,
    stock: 999,
    barcode: "LD-BLANKET-D",
    category: "Household",
  },
  {
    name: "Curtain Wash - Panel",
    price: 120,
    gst: 5,
    stock: 999,
    barcode: "LD-CURTAIN",
    category: "Household",
  },
  {
    name: "Shoe Cleaning",
    price: 150,
    gst: 5,
    stock: 999,
    barcode: "LD-SHOE",
    category: "Special Care",
  },
  { name: "Stain Removal", price: 60, gst: 5, stock: 999, barcode: "LD-STAIN", category: "Add-on" },
  {
    name: "Express Delivery",
    price: 80,
    gst: 5,
    stock: 999,
    barcode: "LD-EXPRESS",
    category: "Add-on",
  },
];

export const normalizeName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const LAUNDRY_NAME_KEYWORDS = [
  "wash",
  "dry cleaning",
  "iron",
  "blanket",
  "curtain",
  "shoe",
  "stain",
  "express",
  "fold",
];

export const isLaundryService = (product) => {
  const category = String(product?.category || "").trim();
  const name = normalizeName(product?.name);
  return (
    LAUNDRY_CATEGORIES.includes(category) ||
    LAUNDRY_NAME_KEYWORDS.some((keyword) => name.includes(keyword))
  );
};
