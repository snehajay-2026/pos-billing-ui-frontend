// Hotel inventory helpers — stock-movement ledger + top-sellers + restock math.
// Persisted to localStorage so the housekeeping manager has a running history.

const LEDGER_KEY = "hotel_inventory_ledger_v1";
const MAX_LEDGER_ENTRIES = 30;

const readLedger = () => {
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
  try {
    window.localStorage.setItem(LEDGER_KEY, JSON.stringify(entries));
  } catch (_) {
    // best-effort
  }
};

// Log a stock change (positive = restock, negative = depletion).
export const logStockMovement = (productName, delta, source = "manual") => {
  const entries = readLedger();
  const entry = {
    id: `STK-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: productName,
    delta,
    source,
    at: new Date().toISOString(),
  };
  // Newest first.
  entries.unshift(entry);
  // Cap to MAX_LEDGER_ENTRIES.
  writeLedger(entries.slice(0, MAX_LEDGER_ENTRIES));
  try {
    window.dispatchEvent(new CustomEvent("hotel_inventory_ledger_updated"));
  } catch (_) {
    // ignore
  }
  return entries;
};

export const getStockLedger = () => readLedger();
