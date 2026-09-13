export const PO_LINE_INITIAL = {
  productId: "",
  productName: "",
  quantity: 1,
  unitPrice: 0,
};

export const normalizePoLine = (line = {}) => ({
  productId: line.productId === "" || line.productId == null ? "" : Number(line.productId),
  productName: String(line.productName || line.name || "").trim(),
  quantity: Number(line.quantity ?? line.qty) || 0,
  unitPrice: Number(line.unitPrice ?? line.unitCost) || 0,
});

export const calculatePurchaseOrderTotal = (lines = []) =>
  lines.reduce(
    (sum, line) => sum + (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0),
    0
  );

export const validatePurchaseOrder = ({ poNumber, date, supplierId, supplierName, lines = [] }) => {
  const errors = {};
  if (!String(poNumber || "").trim()) errors.poNumber = "PO number is required";
  if (!date) errors.date = "Date is required";
  if (!supplierId && !String(supplierName || "").trim())
    errors.supplier = "Select or enter a supplier";
  if (!lines.length) errors.items = "Add at least one line item";
  const itemErrors = lines.map((line) => {
    const normalized = normalizePoLine(line);
    const error = {};
    if (!normalized.productName && !normalized.productId) error.product = "Select a product";
    if (!Number.isFinite(normalized.quantity) || normalized.quantity <= 0)
      error.quantity = "Enter a quantity above zero";
    if (!Number.isFinite(normalized.unitPrice) || normalized.unitPrice < 0)
      error.unitPrice = "Enter a non-negative cost";
    return error;
  });
  if (itemErrors.some((error) => Object.keys(error).length)) errors.items = itemErrors;
  return errors;
};

export const normalizePurchaseOrderPayload = (record = {}) => ({
  id: record.id,
  poNumber: String(record.poNumber || "").trim(),
  date: record.date || null,
  supplierId: record.supplierId || null,
  supplierName: String(record.supplierName || "").trim(),
  expectedAt: record.expectedAt || null,
  notes: record.notes || "",
  status: record.status || "draft",
  items: (record.items || record.lines || []).map(normalizePoLine),
});

export const movementLabel = (movement = {}) => {
  const type = movement.type || "adjustment";
  return type === "in" ? "Stock in" : type === "out" ? "Stock out" : "Adjustment";
};

export const lowStockSeverity = ({ stock = 0, lowStock = 0 } = {}) => {
  const current = Number(stock) || 0;
  const limit = Number(lowStock) || 0;
  if (current <= 0) return "out";
  if (limit > 0 && current <= limit * 0.5) return "critical";
  return "low";
};
