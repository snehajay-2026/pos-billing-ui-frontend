// Laundry consumables — single source of truth for the inventory module.
// Consumables live alongside laundry services in the products collection
// but are tagged with category "Consumables" so `isLaundryService()` from
// laundryServiceCatalog.js naturally hides them from the cashier's billing grid.

import hotelService from "../../services/hotelService";

export const LAUNDRY_CONSUMABLES_CATEGORY = "Consumables";

export const LAUNDRY_CONSUMABLES_UNITS = [
  { value: "ml", label: "ml (millilitres)" },
  { value: "l", label: "l (litres)" },
  { value: "g", label: "g (grams)" },
  { value: "kg", label: "kg (kilograms)" },
  { value: "piece", label: "piece" },
  { value: "roll", label: "roll" },
];

const DEFAULT_SUPPLIER = {
  name: "Local Wholesale",
  phone: "",
  gstin: "",
};

export const LAUNDRY_CONSUMABLES_CATALOG = [
  {
    name: "Detergent Liquid",
    unit: "ml",
    stockQty: 5000,
    lowStockThreshold: 2000,
    costPerUnit: 0.2,
    category: LAUNDRY_CONSUMABLES_CATEGORY,
    gst: 18,
    hsn: "3402",
    barcode: "LD-CONS-DETERGENT",
    supplier: { ...DEFAULT_SUPPLIER },
  },
  {
    name: "Fabric Softener",
    unit: "ml",
    stockQty: 2000,
    lowStockThreshold: 800,
    costPerUnit: 0.18,
    category: LAUNDRY_CONSUMABLES_CATEGORY,
    gst: 18,
    hsn: "3809",
    barcode: "LD-CONS-SOFTENER",
    supplier: { ...DEFAULT_SUPPLIER },
  },
  {
    name: "Bleach",
    unit: "ml",
    stockQty: 1500,
    lowStockThreshold: 600,
    costPerUnit: 0.12,
    category: LAUNDRY_CONSUMABLES_CATEGORY,
    gst: 18,
    hsn: "2815",
    barcode: "LD-CONS-BLEACH",
    supplier: { ...DEFAULT_SUPPLIER },
  },
  {
    name: "Dry-clean Solvent",
    unit: "ml",
    stockQty: 8000,
    lowStockThreshold: 3000,
    costPerUnit: 0.45,
    category: LAUNDRY_CONSUMABLES_CATEGORY,
    gst: 18,
    hsn: "3814",
    barcode: "LD-CONS-SOLVENT",
    supplier: { ...DEFAULT_SUPPLIER },
  },
  {
    name: "Stain Remover Spray",
    unit: "ml",
    stockQty: 1000,
    lowStockThreshold: 400,
    costPerUnit: 0.6,
    category: LAUNDRY_CONSUMABLES_CATEGORY,
    gst: 18,
    hsn: "3402",
    barcode: "LD-CONS-STAIN",
    supplier: { ...DEFAULT_SUPPLIER },
  },
  {
    name: "Poly Bags",
    unit: "piece",
    stockQty: 800,
    lowStockThreshold: 200,
    costPerUnit: 1.5,
    category: LAUNDRY_CONSUMABLES_CATEGORY,
    gst: 18,
    hsn: "3923",
    barcode: "LD-CONS-POLYBAG",
    supplier: { ...DEFAULT_SUPPLIER },
  },
  {
    name: "Hangers",
    unit: "piece",
    stockQty: 300,
    lowStockThreshold: 100,
    costPerUnit: 8,
    category: LAUNDRY_CONSUMABLES_CATEGORY,
    gst: 18,
    hsn: "7326",
    barcode: "LD-CONS-HANGER",
    supplier: { ...DEFAULT_SUPPLIER },
  },
  {
    name: "Tissue Paper",
    unit: "piece",
    stockQty: 600,
    lowStockThreshold: 150,
    costPerUnit: 1.2,
    category: LAUNDRY_CONSUMABLES_CATEGORY,
    gst: 12,
    hsn: "4818",
    barcode: "LD-CONS-TISSUE",
    supplier: { ...DEFAULT_SUPPLIER },
  },
  {
    name: "Invoice Rolls",
    unit: "roll",
    stockQty: 60,
    lowStockThreshold: 15,
    costPerUnit: 45,
    category: LAUNDRY_CONSUMABLES_CATEGORY,
    gst: 18,
    hsn: "4811",
    barcode: "LD-CONS-ROLL",
    supplier: { ...DEFAULT_SUPPLIER },
  },
  {
    name: "Carry Bags",
    unit: "piece",
    stockQty: 400,
    lowStockThreshold: 100,
    costPerUnit: 3,
    category: LAUNDRY_CONSUMABLES_CATEGORY,
    gst: 18,
    hsn: "3923",
    barcode: "LD-CONS-CARRY",
    supplier: { ...DEFAULT_SUPPLIER },
  },
];

/* ---------- Helpers ---------- */

export const isLaundryConsumable = (product) => product?.category === LAUNDRY_CONSUMABLES_CATEGORY;

const normalizeName = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

export const resolveConsumableByName = (consumables, name) => {
  if (!Array.isArray(consumables)) return null;
  const target = normalizeName(name);
  return consumables.find((item) => normalizeName(item.name) === target) || null;
};

/* ---------- Consumption rules ----------
 * Three rule shapes:
 *   1. Per-kg   (Wash and Fold - 5kg, etc.) — consumes detergent + softener,
 *      bleach if the service mentions "white".
 *   2. Per-piece (Dry Cleaning, Ironing, individual garments) — consumes
 *      a poly bag + a hanger per piece.
 *   3. Per-order (Stain Removal, Express Delivery) — consumes a fixed amount
 *      of a service-specific consumable per qty.
 */

// Helper: extract a kilogram figure from a service name like "5kg" or "10 Kg".
const extractKg = (name = "") => {
  const m = String(name).match(/(\d+(?:\.\d+)?)\s*kg/i);
  return m ? parseFloat(m[1]) : 0;
};

const isKgService = (name = "") => extractKg(name) > 0;
const isWhiteService = (name = "") => /white/i.test(String(name));
const isDryClean = (name = "") => /dry\s*clean/i.test(String(name));
const isIroning = (name = "") => /iron|steam/i.test(String(name));
const isStainRemoval = (name = "") => /stain/i.test(String(name));

// Compute the consumables a single bill line will draw down.
const consumptionForLine = (item) => {
  const name = String(item?.name || "").trim();
  const qty = Number(item?.qty ?? 1) || 1;
  const kg = isKgService(name) ? extractKg(name) * qty : 0;
  const out = [];

  if (kg > 0) {
    out.push({ name: "Detergent Liquid", qtyUsed: kg * 100, unit: "ml" });
    out.push({ name: "Fabric Softener", qtyUsed: kg * 50, unit: "ml" });
    if (isWhiteService(name)) {
      out.push({ name: "Bleach", qtyUsed: kg * 50, unit: "ml" });
    }
    return out;
  }

  if (isDryClean(name)) {
    out.push({ name: "Dry-clean Solvent", qtyUsed: qty * 200, unit: "ml" });
    out.push({ name: "Poly Bags", qtyUsed: qty, unit: "piece" });
    return out;
  }

  if (isIroning(name)) {
    out.push({ name: "Poly Bags", qtyUsed: qty, unit: "piece" });
    out.push({ name: "Hangers", qtyUsed: qty, unit: "piece" });
    return out;
  }

  if (isStainRemoval(name)) {
    out.push({ name: "Stain Remover Spray", qtyUsed: qty * 30, unit: "ml" });
    return out;
  }

  // Generic blanket / curtain / shoe: treat as per-piece packing.
  if (qty > 0) {
    out.push({ name: "Poly Bags", qtyUsed: qty, unit: "piece" });
  }

  return out;
};

export const consumptionForBillItems = (items) => {
  if (!Array.isArray(items)) return [];
  const map = new Map();
  items.forEach((item) => {
    consumptionForLine(item).forEach((entry) => {
      const key = normalizeName(entry.name);
      const prev = map.get(key) || {
        name: entry.name,
        qtyUsed: 0,
        unit: entry.unit,
      };
      prev.qtyUsed += Number(entry.qtyUsed) || 0;
      map.set(key, prev);
    });
  });
  return Array.from(map.values()).filter((entry) => entry.qtyUsed > 0);
};

/* ---------- LEDGER (in-memory audit trail) ---------- */

const LEDGER_KEY = "laundry_inventory_ledger_v2";
const MAX_LEDGER_ENTRIES = 50;

const readLedger = () => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEDGER_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
};

const writeLedger = (entries) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(entries));
  } catch (_) {
    /* ignore */
  }
};

export const logStockMovement = (productName, delta, source = "manual") => {
  const entries = readLedger();
  const entry = {
    id: `STK-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: productName,
    delta: Number(delta) || 0,
    source,
    at: new Date().toISOString(),
  };
  entries.unshift(entry);
  writeLedger(entries.slice(0, MAX_LEDGER_ENTRIES));
  try {
    window.dispatchEvent(new CustomEvent("laundry_stock_updated"));
    window.dispatchEvent(new CustomEvent("laundry_inventory_ledger_updated"));
  } catch (_) {
    /* ignore */
  }
  // Mirror the movement to the server so other devices in the same store
  // see it without waiting for the next sync. Fire-and-forget — a transient
  // network error must not block the cashier's next action.
  if (hotelService && typeof hotelService.postLaundryLedger === "function") {
    hotelService
      .postLaundryLedger({
        id: entry.id,
        productName: entry.name,
        delta: entry.delta,
        reason: entry.source,
        at: entry.at,
      })
      .catch((err) => {
        console.warn("Failed to sync stock movement to server", err);
      });
  }
  return entries;
};

// Seed the localStorage cache with the server's authoritative ledger for
// this store. Call on page mount so two devices don't see divergent stock
// audit trails.
export const seedStockLedgerFromServer = async () => {
  try {
    const list = await hotelService.getLaundryLedger();
    if (Array.isArray(list) && list.length) {
      // Persist a normalized local copy; the server's `capped-at-200`
      // means we can mirror it whole into localStorage.
      writeLedger(
        list.map((entry) => ({
          id: entry.id,
          name: entry.productName || entry.name || "",
          delta: Number(entry.delta) || 0,
          source: entry.reason || entry.source || "manual",
          at: entry.at,
        }))
      );
    }
  } catch (err) {
    console.warn("Failed to seed laundry ledger from server", err);
  }
};

export const getStockLedger = () => readLedger();

/* ---------- Display helpers ---------- */

export const stockStatus = (item) => {
  const qty = Number(item?.stockQty) || 0;
  const threshold = Number(item?.lowStockThreshold) || 0;
  if (qty <= 0) return { key: "out", label: "Out of stock" };
  if (threshold > 0 && qty <= threshold) return { key: "low", label: "Low stock" };
  return { key: "healthy", label: "Healthy" };
};

export const formatQty = (qty, unit) => {
  const n = Number(qty) || 0;
  if (n === 0) return `0 ${unit || ""}`.trim();
  if (unit === "ml" && n >= 1000) {
    return `${(n / 1000).toFixed(2)} l`;
  }
  if (unit === "g" && n >= 1000) {
    return `${(n / 1000).toFixed(2)} kg`;
  }
  return `${Number.isInteger(n) ? n : n.toFixed(1)} ${unit || ""}`.trim();
};
