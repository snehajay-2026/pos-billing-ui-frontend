import React, { useState, useRef, useEffect } from "react";
import { saveInvoice } from "../../services/invoiceService";
import { getProducts, addProduct } from "../../services/productService";
import { getOrders, updateOrder } from "../../services/orderService";
import { v4 as uuid } from "uuid";
import { useNavigate } from "react-router-dom";
import { FaRupeeSign } from "react-icons/fa";
import LaundryThermalReceipt from "./LaundryThermalReceipt";
import { printESC_POS } from "../../utils/bluetoothEscpos";
import { useUi } from "../../context/UiContext";
import "../pos/POSBilling.css";
import "./LaundryBilling.css";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { getStoreSettings } from "../../services/storeSettingsService";
import { getUser } from "../../utils/auth";
import { recordCashSaleForShift, currentStoreNeedsShift } from "../../services/shiftService";
import OpenShiftDialog from "../shift/OpenShiftDialog";
import ShiftStatusBanner from "../shift/ShiftStatusBanner";
import { useShiftGate } from "../../hooks/useShiftGate";
import {
  LAUNDRY_SERVICE_CATALOG,
  LAUNDRY_CATEGORIES,
  LAUNDRY_CATEGORY_ORDER,
  normalizeName,
  isLaundryService,
} from "./laundryServiceCatalog";
import {
  defaultExpectedReturn,
  nextLaundryToken,
  orderGrandTotal,
  resolveLaundryStatus,
} from "./laundryStatus";
import {
  consumptionForBillItems,
  formatQty,
  isLaundryConsumable,
  logStockMovement,
  resolveConsumableByName,
  stockStatus,
} from "./laundryConsumables";
import { calcSubTotal, calcGstTotal, calcGrandTotal } from "../../utils/billingMath";
import useUnsavedChangesGuard from "../../hooks/useUnsavedChangesGuard";

const LaundryBilling = () => {
  const navigate = useNavigate();
  const receiptRef = useRef();
  const [hydrated, setHydrated] = useState(false);
  const settings = getStoreSettings();
  const user = getUser();

  // Mandatory shift gate: Branch Admin / Cashier must open a shift before
  // they can take cash sales in a cash-vertical store. SUPER_OWNER / ADMIN
  // bypass the gate. Hook also handles polling + auth events so the chip
  // stays in sync across tabs / sessions.
  const { openShiftDialog, refreshActiveShift, useMandatoryShiftDialogProps } = useShiftGate();

  // Compute the dialog props once per render and BEFORE any early return,
  // so React's rules-of-hooks are not violated by the `if (!hydrated)` short-
  // circuit below.
  const mandatoryShiftDialogProps = useMandatoryShiftDialogProps();

  const [billCounter, setBillCounter] = useState(101);
  // Holds the save payload when the OpenShiftDialog interrupted us.
  // Same pattern as POSBilling — we re-run the save after the shift opens.
  const pendingInvoiceRef = useRef(null);
  const emptyBill = () => ({
    items: [],
    paymentMode: "Cash",
    customer: "",
    phone: "",
    token: "",
    expectedReturn: defaultExpectedReturn(),
    orderId: "",
  });
  const [bills, setBills] = useState({
    "Bill-101": emptyBill(),
  });
  const [activeBillId, setActiveBillId] = useState("Bill-101");
  const activeBill = bills[activeBillId] || emptyBill();

  const [products, setProducts] = useState([]);
  const [selectedQty, setSelectedQty] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [lastInvoice, setLastInvoice] = useState(null);
  const [openOrders, setOpenOrders] = useState([]);

  const { showToast } = useUi();

  // Deduct consumable stock for a bill (best-effort).
  // Loads the freshest product list, walks the consumption rules, applies each
  // decrement via updateProduct, logs to the ledger, and emits low-stock toasts.
  const deductConsumablesForBill = async (billItems, invoiceNo) => {
    const needed = consumptionForBillItems(billItems);
    if (!needed.length) return;

    let allProducts = [];
    try {
      allProducts = await getProducts();
    } catch (err) {
      console.warn("Could not load products for stock deduction:", err);
      return;
    }
    const consumables = (Array.isArray(allProducts) ? allProducts : []).filter(isLaundryConsumable);

    for (const entry of needed) {
      const match = resolveConsumableByName(consumables, entry.name);
      if (!match) continue; // not stocked yet — skip silently
      const curQty = Number(match.stockQty) || 0;
      const nextQty = Math.max(0, curQty - entry.qtyUsed);
      try {
        await updateProduct({ id: match.id, stockQty: nextQty });
        logStockMovement(match.name, -entry.qtyUsed, `Bill ${invoiceNo}`);
        const after = stockStatus({ ...match, stockQty: nextQty });
        if (after.key === "low" || after.key === "out") {
          showToast(
            "warning",
            `${match.name} ${after.label.toLowerCase()}: ${formatQty(nextQty, match.unit)} remaining.`
          );
        }
      } catch (err) {
        console.warn(`Failed to deduct ${match.name}:`, err);
      }
    }

    window.dispatchEvent(new CustomEvent("laundry_stock_updated"));
  };

  const [undoProduct, setUndoProduct] = useState(null);
  const undoTimerRef = useRef(null);

  // Guard the cashier's draft bill: warn before closing/refreshing the tab
  // while the active bill has items in it.
  useUnsavedChangesGuard(activeBill.items.length > 0);

  const loadProducts = async () => {
    let storedProducts = [];
    try {
      const data = await getProducts();
      storedProducts = Array.isArray(data) ? data : [];
    } catch (err) {
      console.error("Error loading laundry products from API:", err);
      storedProducts = [];
    }

    const existingNames = new Set(storedProducts.map((product) => normalizeName(product.name)));
    const missingDefaultProducts = LAUNDRY_SERVICE_CATALOG.filter(
      (product) => !existingNames.has(normalizeName(product.name))
    );
    if (missingDefaultProducts.length > 0) {
      try {
        const createdProducts = await Promise.all(
          missingDefaultProducts.map((product) =>
            addProduct(product).catch((err) => {
              console.error("Failed to create default laundry product:", err);
              return null;
            })
          )
        );
        storedProducts = [...storedProducts, ...createdProducts.filter(Boolean)];
      } catch (err) {
        console.error("Failed to seed default laundry products:", err);
        storedProducts = [
          ...storedProducts,
          ...missingDefaultProducts.map((product) => ({
            ...product,
            id: `local-${product.barcode}`,
          })),
        ];
      }
    }

    setProducts(storedProducts);
    setHydrated(true);
  };

  useEffect(() => {
    const handleProductRefresh = () => loadProducts();

    loadProducts();
    window.addEventListener("productsUpdated", handleProductRefresh);
    window.addEventListener("dataUpdated", handleProductRefresh);

    return () => {
      window.removeEventListener("productsUpdated", handleProductRefresh);
      window.removeEventListener("dataUpdated", handleProductRefresh);
    };
  }, []);

  // Load open laundry orders so the cashier can attach a bill to a specific drop-off.
  const refreshOpenOrders = async () => {
    try {
      const data = await getOrders("laundry");
      const open = (Array.isArray(data) ? data : []).filter((order) => {
        const status = resolveLaundryStatus(order.status);
        return status.value !== "delivered" && status.value !== "cancelled" && !order.invoiceNo;
      });
      setOpenOrders(open);
    } catch (err) {
      console.error("Failed to load open laundry orders:", err);
      setOpenOrders([]);
    }
  };

  useEffect(() => {
    refreshOpenOrders();
    const handler = () => refreshOpenOrders();
    window.addEventListener("dataUpdated", handler);
    window.addEventListener("activeStoreChanged", handler);
    return () => {
      window.removeEventListener("dataUpdated", handler);
      window.removeEventListener("activeStoreChanged", handler);
    };
  }, []);

  const updateActiveBill = (patch) => {
    setBills((prev) => ({
      ...prev,
      [activeBillId]: { ...prev[activeBillId], ...patch },
    }));
  };

  const attachOpenOrder = (orderId) => {
    if (!orderId) {
      updateActiveBill({
        orderId: "",
        token: "",
        customer: "",
        phone: "",
        expectedReturn: defaultExpectedReturn(),
      });
      return;
    }
    const order = openOrders.find((o) => String(o.id) === String(orderId));
    if (!order) return;
    const itemRows = (
      Array.isArray(order.items) && order.items.length
        ? order.items
        : [{ name: order.service || "Washing", qty: order.qty || 1, price: 0, gst: 5 }]
    ).map((it) => ({
      id: it.id || `seed-${Math.random()}`,
      name: it.name || order.service || "Washing",
      qty: Number(it.qty ?? it.qtyKg ?? order.qty ?? 1) || 1,
      price: Number(it.price || 0) || 0,
      gst: Number(it.gst || 0) || 0,
    }));
    updateActiveBill({
      orderId: order.id,
      token: order.token || "",
      customer: order.customer || "",
      phone: order.phone || "",
      expectedReturn: order.expectedReturn || defaultExpectedReturn(),
      items: itemRows,
    });
  };

  // Drafts and bill state remain in-memory only; not persisted to browser storage.
  // Laundry services are catalog items, not consumable inventory, so billing does
  // not mutate product stock — the LaundryServicePage owns the catalog, and the
  // LaundryOrderPage owns operational (garment) status. See laundryServiceCatalog.js.

  const laundryProducts = products.filter(isLaundryService);
  const availableCategories = LAUNDRY_CATEGORY_ORDER.filter(
    (category) =>
      category === "All" || laundryProducts.some((product) => product.category === category)
  );
  const filteredProducts = laundryProducts.filter((product) => {
    const matchesSearch = product.name.toLowerCase().includes(searchText.toLowerCase());
    const matchesCategory = categoryFilter === "All" || product.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const addServiceItem = (product, count) => {
    if (count <= 0) return;

    const enrichedProduct = {
      ...product,
      qty: count,
      price: Number(product.price || 0),
      gst: Number(product.gst || 0),
    };

    setBills((prev) => ({
      ...prev,
      [activeBillId]: {
        ...prev[activeBillId],
        items: prev[activeBillId].items.some((i) => i.id === product.id)
          ? prev[activeBillId].items.map((i) =>
              i.id === product.id
                ? {
                    ...i,
                    qty: (Number(i.qty) || 0) + count,
                    gst: Number(product.gst || 0),
                    price: i.manualPrice ? i.price : Number(product.price || 0),
                  }
                : i
            )
          : [...prev[activeBillId].items, enrichedProduct],
      },
    }));
  };

  const updateBillItemPrice = (itemId, value) => {
    const nextPrice = Math.max(0, Number(value || 0));
    setBills((prev) => ({
      ...prev,
      [activeBillId]: {
        ...prev[activeBillId],
        items: prev[activeBillId].items.map((i) =>
          i.id === itemId ? { ...i, price: nextPrice, manualPrice: true } : i
        ),
      },
    }));
  };

  const decreaseQty = (item) => {
    const step = 1; // For services, decrease by 1
    if ((Number(item.qty) || 0) <= step) return;

    setBills((prev) => ({
      ...prev,
      [activeBillId]: {
        ...prev[activeBillId],
        items: prev[activeBillId].items.map((i) =>
          i.id === item.id ? { ...i, qty: (Number(i.qty) || 0) - step } : i
        ),
      },
    }));
  };

  const handleDeleteItem = (item) => {
    setBills((prev) => ({
      ...prev,
      [activeBillId]: {
        ...prev[activeBillId],
        items: prev[activeBillId].items.filter((i) => i.id !== item.id),
      },
    }));

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoProduct(item);
    undoTimerRef.current = setTimeout(() => setUndoProduct(null), 5000);
  };

  const handleUndoProduct = () => {
    if (!undoProduct) return;

    setBills((prev) => ({
      ...prev,
      [activeBillId]: {
        ...prev[activeBillId],
        items: [...prev[activeBillId].items, undoProduct],
      },
    }));

    setUndoProduct(null);
  };

  const subTotal = calcSubTotal(activeBill.items);
  const gstTotal = calcGstTotal(activeBill.items);
  const grandTotal = calcGrandTotal(activeBill.items);

  const closeBill = (billId) => {
    if (Object.keys(bills).length === 1) {
      alert("At least one bill must remain");
      return;
    }

    setBills((prev) => {
      const copy = { ...prev };
      delete copy[billId];
      return copy;
    });

    if (billId === activeBillId) {
      const remaining = Object.keys(bills).filter((b) => b !== billId);
      setActiveBillId(remaining[0]);
    }
  };

  const buildInvoice = (overrides = {}) => ({
    invoiceNo: "INV-" + uuid().slice(0, 6),
    date: new Date().toISOString().split("T")[0],
    storeType: "laundry",
    items: activeBill.items,
    subTotal,
    gstTotal,
    grandTotal,
    paymentMode: activeBill.paymentMode,
    customer: activeBill.customer || "",
    customerPhone: activeBill.phone || "",
    token: activeBill.token || "",
    expectedReturn: activeBill.expectedReturn || "",
    orderId: activeBill.orderId || "",
    ...overrides,
  });

  const generateInvoice = async () => {
    if (activeBill.items.length === 0) {
      showToast("error", "Add services first!");
      return;
    }
    if (activeBill.phone && !/^\d{10}$/.test(String(activeBill.phone).trim())) {
      showToast("error", "Customer phone must be a valid 10-digit mobile number.");
      return;
    }

    // Mandatory-shift gate: for cash sales in a cash-vertical store, the
    // cashier must have an open shift. If the user lands here without one,
    // show the OpenShiftDialog first; once they open a shift, the success
    // handler re-runs the save. Same flow as Retail POSBilling.
    if (activeBill.paymentMode === "Cash" && currentStoreNeedsShift()) {
      const shift = await refreshActiveShift();
      if (!shift) {
        pendingInvoiceRef.current = { kind: "laundry" };
        openShiftDialog();
        return;
      }
    }

    let invoice = buildInvoice();
    if (!invoice.token) {
      const token = nextLaundryToken(openOrders.map((o) => o.token).filter(Boolean));
      invoice = { ...invoice, token };
      updateActiveBill({ token });
    }

    try {
      const saved = await saveInvoice(invoice);
      const finalInvoice = { ...invoice, ...(saved || {}) };
      setLastInvoice(finalInvoice);

      if (activeBill.orderId) {
        try {
          await updateOrder({
            id: activeBill.orderId,
            invoiceNo: finalInvoice.invoiceNo,
            status: resolveLaundryStatus("in_process").value,
          });
          window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "orders" }));
        } catch (orderErr) {
          console.warn("Invoice saved but failed to link order:", orderErr);
        }
      }

      // Deduct consumable stock for the bill (best-effort — failures are logged
      // but do not block invoice generation or navigation).
      try {
        await deductConsumablesForBill(activeBill.items, finalInvoice.invoiceNo);
      } catch (stockErr) {
        console.warn("Invoice saved but consumables could not be deducted:", stockErr);
      }

      // For cash sales in a cash-vertical store, record the sale against
      // the cashier's currently-open shift so the variance at end-of-shift
      // is accurate. Fire-and-forget — the invoice is already saved.
      if (invoice.paymentMode === "Cash" && currentStoreNeedsShift()) {
        recordCashSaleForShift({
          invoiceNo: finalInvoice.invoiceNo,
          amount: finalInvoice.grandTotal,
        });
      }

      showToast("success", `Invoice ${finalInvoice.invoiceNo} saved.`);
      navigate(`/invoice/${encodeURIComponent(finalInvoice.invoiceNo)}/preview`);
    } catch (err) {
      console.error("Failed to save invoice:", err);
      showToast("error", "Unable to save invoice. Please try again.");
    }
  };

  const handleBluetoothPrint = async () => {
    if (activeBill.items.length === 0) {
      showToast("error", "Add services first!");
      return;
    }
    const invoiceToPrint =
      lastInvoice && lastInvoice.items === activeBill.items ? lastInvoice : buildInvoice();
    try {
      printESC_POS(invoiceToPrint);
    } catch (err) {
      console.error("Bluetooth print failed:", err);
      showToast("error", "Bluetooth print failed. Check the printer connection.");
    }
  };

  const handlePrintSlip = () => {
    if (activeBill.items.length === 0) {
      showToast("error", "Add services first!");
      return;
    }
    setLastInvoice(buildInvoice({ paymentMode: "Slip" }));
    showToast("info", "Slip ready. Use the print icon below to print.");
  };

  // Analytics for laundry services.
  const serviceCount = laundryProducts.length;
  // "Service Health" = how complete the service menu is across the standard categories.
  const coveredCategories = availableCategories.filter((category) => category !== "All").length;
  const inventoryHealth = LAUNDRY_CATEGORIES.length
    ? Math.round((coveredCategories / LAUNDRY_CATEGORIES.length) * 100)
    : 0;
  const isAdminView = user?.role === "ADMIN" || user?.role === "STORE_ADMIN";

  const pieData = [{ name: "Services", value: serviceCount }];
  const PIE_COLORS = ["#28a745"];

  if (!hydrated) {
    return <div className="pos-container">Restoring bill…</div>;
  }

  return (
    <div className="pos-container laundry-billing-pro">
      <ShiftStatusBanner onOpen={() => openShiftDialog()} />

      <h3 className="pos-title">Laundry Billing</h3>

      {/* Simplified Analytics */}
      <div className="inventory-panel mb-4">
        <div className="inventory-cards">
          <div className="inventory-card healthy">
            <div className="inv-count">{serviceCount}</div>
            <div className="inv-label">Services</div>
          </div>
        </div>

        {!isAdminView && (
          <>
            <div className="inventory-health mt-3">
              <div className="inventory-health-text">
                Service Health: <b>{inventoryHealth}%</b>
              </div>
              <div className="inventory-health-bar">
                <div className="inventory-health-fill" style={{ width: `${inventoryHealth}%` }} />
              </div>
            </div>

            <div className="inventory-chart mt-4">
              <h6>📊 Service Overview</h6>
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={60} label>
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={PIE_COLORS[index]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      {/* Bill Tabs */}
      <div className="bill-tabs">
        {Object.keys(bills).map((billId) => {
          const total = bills[billId].items.reduce((s, i) => s + i.price * (Number(i.qty) || 0), 0);
          const isActive = billId === activeBillId;

          return (
            <div
              key={billId}
              className={`bill-tab ${isActive ? "active" : ""}`}
              onClick={() => setActiveBillId(billId)}
            >
              <span className="bill-tab-title">{billId}</span>
              <span className="bill-total">₹{total.toFixed(2)}</span>
              <span
                className="bill-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeBill(billId);
                }}
              >
                ✕
              </span>
            </div>
          );
        })}

        <div
          className="bill-tab add"
          onClick={() => {
            const newId = `Bill-${billCounter + 1}`;
            setBills((prev) => ({ ...prev, [newId]: { items: [], paymentMode: "Cash" } }));
            setBillCounter((c) => c + 1);
            setActiveBillId(newId);
          }}
        >
          + New Bill
        </div>
      </div>

      {/* Undo Toast */}
      {undoProduct && (
        <div className="undo-toast">
          <div className="undo-toast-body">
            <b>{undoProduct.name}</b> removed
            <button className="undo-toast-btn" onClick={handleUndoProduct}>
              UNDO
            </button>
          </div>
          <div className="undo-toast-timer">
            <div className="undo-toast-timer-bar" />
          </div>
        </div>
      )}

      {/* Search */}
      <div className="input-group mb-3">
        <input
          className="form-control pos-input"
          placeholder="Search services..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
      </div>

      <div className="laundry-category-strip">
        {availableCategories.map((category) => (
          <button
            key={category}
            type="button"
            className={`laundry-category-chip ${categoryFilter === category ? "active" : ""}`}
            onClick={() => setCategoryFilter(category)}
          >
            {category}
          </button>
        ))}
      </div>

      {/* Quantity Selector for Services */}
      <div className="mb-3">
        <div className="d-flex flex-wrap gap-2 mb-2">
          {[1, 2, 3, 5].map((q) => (
            <button
              key={q}
              type="button"
              className={`btn btn-sm ${selectedQty === q ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setSelectedQty(q)}
            >
              {q} {q === 1 ? "item" : "items"}
            </button>
          ))}
        </div>
      </div>

      {/* Services + Bill */}
      <div className="row">
        <div className="col-md-6">
          <h5>Services</h5>
          <div className="list-group">
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                className="product-item"
                onClick={() => addServiceItem(p, selectedQty)}
              >
                {p.name} — ₹{p.price}
              </button>
            ))}
          </div>
        </div>

        <div className="col-md-6">
          <div className="bill-summary-card">
            <h5>Bill Summary ({activeBillId})</h5>
            <table className="table table-hover align-middle">
              <thead className="table-light">
                <tr>
                  <th>Service</th>
                  <th className="text-center">Qty</th>
                  <th className="text-end">Amount</th>
                  <th className="text-center">✕</th>
                </tr>
              </thead>
              <tbody>
                {activeBill.items.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="text-center text-muted">
                      No services added
                    </td>
                  </tr>
                ) : (
                  activeBill.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <b>{i.name}</b>
                      </td>
                      <td className="text-center">
                        <div className="d-flex justify-content-center align-items-center gap-2">
                          <button
                            className="btn btn-sm btn-outline-danger"
                            onClick={() => decreaseQty(i)}
                          >
                            −
                          </button>
                          <span>{i.qty}</span>
                          <button
                            className="btn btn-sm btn-outline-primary"
                            onClick={() => addServiceItem(i, 1)}
                          >
                            +
                          </button>
                        </div>
                      </td>
                      <td className="text-end">
                        <div className="input-group input-group-sm justify-content-end mb-1">
                          <span className="input-group-text">Rs</span>
                          <input
                            className="form-control text-end"
                            style={{ maxWidth: 96 }}
                            type="number"
                            min="0"
                            value={i.price}
                            onChange={(e) => updateBillItemPrice(i.id, e.target.value)}
                          />
                        </div>
                        <FaRupeeSign className="me-1 text-success" />
                        {((Number(i.qty) || 0) * i.price).toFixed(2)}
                        <div className="text-muted small">
                          GST {Number(i.gst || 0).toFixed(0)}% = ₹
                          {(((Number(i.qty) || 0) * i.price * Number(i.gst || 0)) / 100).toFixed(2)}
                        </div>
                      </td>
                      <td className="text-center">
                        <button
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => handleDeleteItem(i)}
                        >
                          🗑
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>

            <div className="laundry-bill-meta">
              <div className="row">
                <div className="col-6 mb-2">
                  <label className="laundry-bill-meta-label">Customer</label>
                  <input
                    className="form-control"
                    value={activeBill.customer || ""}
                    onChange={(e) => updateActiveBill({ customer: e.target.value })}
                    placeholder="Customer name"
                  />
                </div>
                <div className="col-6 mb-2">
                  <label className="laundry-bill-meta-label">Phone</label>
                  <input
                    className="form-control"
                    value={activeBill.phone || ""}
                    onChange={(e) =>
                      updateActiveBill({ phone: e.target.value.replace(/\D/g, "").slice(0, 10) })
                    }
                    placeholder="10-digit mobile"
                    inputMode="numeric"
                    maxLength={10}
                  />
                </div>
                <div className="col-6 mb-2">
                  <label className="laundry-bill-meta-label">Token</label>
                  <input
                    className="form-control"
                    value={activeBill.token || ""}
                    onChange={(e) => updateActiveBill({ token: e.target.value })}
                    placeholder="Auto / manual"
                  />
                </div>
                <div className="col-6 mb-2">
                  <label className="laundry-bill-meta-label">Expected Return</label>
                  <input
                    className="form-control"
                    type="date"
                    value={activeBill.expectedReturn || ""}
                    onChange={(e) => updateActiveBill({ expectedReturn: e.target.value })}
                  />
                </div>
                <div className="col-12 mb-3">
                  <label className="laundry-bill-meta-label">Attach to existing order</label>
                  <select
                    className="form-select"
                    value={activeBill.orderId || ""}
                    onChange={(e) => attachOpenOrder(e.target.value)}
                  >
                    <option value="">— Walk-in (no order) —</option>
                    {openOrders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.token || `#${o.id}`} · {o.customer}
                        {o.phone ? ` · ${o.phone}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div>
              <b>Subtotal:</b> ₹{subTotal.toFixed(2)}
            </div>
            <div>
              <b>GST:</b> ₹{gstTotal.toFixed(2)}
            </div>
            <div className="mb-3">
              <b>Grand Total:</b> ₹{grandTotal.toFixed(2)}
            </div>

            <select
              className="form-select mb-3"
              value={activeBill.paymentMode}
              onChange={(e) =>
                setBills((prev) => ({
                  ...prev,
                  [activeBillId]: { ...prev[activeBillId], paymentMode: e.target.value },
                }))
              }
            >
              <option>Cash</option>
              <option>UPI</option>
              <option>Card</option>
            </select>

            <button className="btn btn-success w-100" onClick={generateInvoice}>
              Generate Invoice & View
            </button>
            <button className="btn btn-dark w-100 mt-2" onClick={handleBluetoothPrint}>
              Bluetooth Print (ESC/POS)
            </button>
            <button className="btn btn-outline-primary w-100 mt-2" onClick={handlePrintSlip}>
              Print Slip (no invoice)
            </button>
          </div>
        </div>
      </div>

      <div style={{ display: "none" }}>
        <div ref={receiptRef}>
          <LaundryThermalReceipt invoice={lastInvoice} />
        </div>
      </div>

      <OpenShiftDialog
        {...mandatoryShiftDialogProps}
        title="Open a shift before recording a laundry sale"
        // When the cashier opens a shift, refresh the active shift so the
        // banner + chip update, then re-run the pending save if there was
        // one. Without this, the "Generate Invoice" click would be lost.
        onOpened={() => {
          refreshActiveShift();
          const pending = pendingInvoiceRef.current;
          pendingInvoiceRef.current = null;
          if (pending && pending.kind === "laundry") {
            // Resume the original save flow now that a shift is open.
            generateInvoice();
          }
        }}
      />
    </div>
  );
};

export default LaundryBilling;
