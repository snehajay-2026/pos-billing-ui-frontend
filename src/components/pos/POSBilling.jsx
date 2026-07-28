import React, { useState, useRef, useEffect, useCallback } from "react";
import { checkoutInvoice } from "../../services/invoiceService";
import { getProducts, addProduct } from "../../services/productService";
import { searchCustomers } from "../../services/customerService";
import PaymentDialog from "../payment/PaymentDialog";
import OpenShiftDialog from "../shift/OpenShiftDialog";
import CloseShiftDialog from "../shift/CloseShiftDialog";
import ShiftStatusBanner from "../shift/ShiftStatusBanner";
import {
  getActiveShift,
  recordCashSaleForShift,
  currentStoreNeedsShift,
} from "../../services/shiftService";
import { v4 as uuid } from "uuid";
import { useNavigate } from "react-router-dom";
import ThermalReceipt from "./ThermalReceipt";
import { printESC_POS } from "../../utils/bluetoothEscpos";
import useUnsavedChangesGuard from "../../hooks/useUnsavedChangesGuard";
import "./POSBilling.css";
import "./POSBillingPro.css";
import * as XLSX from "xlsx";
import { getStoreSettings } from "../../services/storeSettingsService";
import { getUser } from "../../utils/auth";
import {
  FaCashRegister,
  FaCheckCircle,
  FaBoxOpen,
  FaSearch,
  FaMicrophone,
  FaPlus,
  FaMinus,
  FaUndo,
  FaTrash,
  FaWhatsapp,
  FaPrint,
  FaFileExcel,
  FaRupeeSign,
  FaBarcode,
  FaLayerGroup,
  FaUser,
  FaPhoneAlt,
  FaPercent,
  FaBookmark,
  FaPause,
  FaPlay,
  FaTimes,
  FaUserTie,
} from "react-icons/fa";

const POSBilling = () => {
  const navigate = useNavigate();
  const receiptRef = useRef();
  const [hydrated, setHydrated] = useState(false);
  const [exportToast, setExportToast] = useState(null);
  const settings = getStoreSettings();

  // Always get the current user/store for draft key
  const user = getUser();
  const DRAFT_KEY = `pos_draft_bills_${user?.email || "nouser"}_${user?.storeType || "nostore"}`;

  const [products, setProducts] = useState([]);

  // Optimistic local-only product update. Stock is no longer mutated on the
  // server during cart build — that would race with concurrent cashiers. The
  // authoritative decrement happens server-side at checkout via
  // POST /api/invoices/checkout. We only refresh the UI here so cashiers see
  // their in-progress cart reflected in stock numbers; the server will
  // reconcile and return the canonical `updatedStock` on checkout success.
  const persistProducts = (updatedProducts) => {
    setProducts(updatedProducts);
    window.dispatchEvent(new CustomEvent("productsUpdated"));
  };

  /* ================= Export Low Stock To Excel Logic ================= */

  const exportLowStockToExcel = () => {
    const lowStockProducts = products
      .filter((p) => p.stock > 0 && p.stock < getLowStockLimit(p.name))
      .map((p) => ({
        "Product Name": p.name,
        "Current Stock": p.stock,
        "Low Stock Limit": getLowStockLimit(p.name),
        Unit: getProductUnit(p),
        Rate: p.price,
        Status: "LOW",
      }));

    if (lowStockProducts.length === 0) {
      setExportToast({
        type: "warning",
        message: "No low-stock products found",
      });
      setTimeout(() => setExportToast(null), 3000);
      return;
    }

    try {
      const worksheet = XLSX.utils.json_to_sheet(lowStockProducts);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Low Stock");

      XLSX.writeFile(workbook, "Low_Stock_Report.xlsx");

      setExportToast({
        type: "success",
        message: `Low stock exported (${lowStockProducts.length} items)`,
      });
    } catch (err) {
      setExportToast({
        type: "error",
        message: "Failed to export Excel file",
      });
    }

    setTimeout(() => setExportToast(null), 4000);
  };

  /* ================= MULTI BILL STATE ================= */

  const [billCounter, setBillCounter] = useState(101);

  const newEmptyBill = () => ({
    items: [],
    paymentMode: "Cash",
    customerName: "",
    customerPhone: "",
    customerId: null, // null = walking customer; populated by attach-existing
    discount: null, // { type: "percent" | "flat", value: number } | null
    payments: [], // used only when paymentMode === "Split"
  });

  const [bills, setBills] = useState({
    "Bill-101": newEmptyBill(),
  });

  const [activeBillId, setActiveBillId] = useState("Bill-101");
  const activeBill = bills[activeBillId] || newEmptyBill();

  /* ================= PRODUCT / UI ================= */

  const [barcode, setBarcode] = useState("");
  const [qtyKg, setQtyKg] = useState(1);
  const [qtyUnit, setQtyUnit] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [listening, setListening] = useState(false);
  const [lastInvoice, setLastInvoice] = useState(null);

  // PaymentDialog state. We collect the built invoice into a single
  // ref so the dialog can be invoked below and the post-payment save
  // reuses the same payload. For non-cash methods (UPI / card) we open
  // the dialog FIRST and only call the atomic checkout after the
  // payment has been confirmed (or marked paid by the cashier).
  const pendingInvoiceRef = useRef(null);
  const [paymentDialog, setPaymentDialog] = useState(null); // { open, invoice, amount, method, invoiceNo } | null

  // Shift dialog state. When the cashier hits Save on a cash sale and
  // has no open shift, we open this dialog first; once they open a
  // shift, we resume the original save with the same invoice.
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [closeShiftDialogOpen, setCloseShiftDialogOpen] = useState(false);
  const [activeShift, setActiveShift] = useState(null);

  // Refresh the active shift every 30s + on auth/focus + when a
  // shift is opened/closed anywhere in the app. Drives the inline
  // ShiftStatusBanner in the POS and the chip in the header.
  const refreshActiveShift = useCallback(async () => {
    if (!currentStoreNeedsShift()) {
      setActiveShift(null);
      return;
    }
    try {
      const s = await getActiveShift();
      setActiveShift(s);
    } catch {
      setActiveShift(null);
    }
  }, []);
  useEffect(() => {
    refreshActiveShift();
    const onAuth = () => refreshActiveShift();
    const onFocus = () => refreshActiveShift();
    window.addEventListener("authChanged", onAuth);
    window.addEventListener("activeStoreChanged", onAuth);
    window.addEventListener("focus", onFocus);
    const interval = setInterval(refreshActiveShift, 30000);
    return () => {
      window.removeEventListener("authChanged", onAuth);
      window.removeEventListener("activeStoreChanged", onAuth);
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [refreshActiveShift]);

  // Mandatory-shift gate: for Branch Admin / Cashier users in a
  // cash-vertical store, we auto-open the OpenShiftDialog the moment
  // we discover there's no active shift. SUPER_OWNER and ADMIN bypass
  // the gate entirely.
  useEffect(() => {
    if (!user) return;
    const role = String(user.role || "").toUpperCase();
    if (role === "SUPER_OWNER" || role === "ADMIN") return;
    if (!currentStoreNeedsShift()) return;
    if (activeShift) return;
    if (shiftDialogOpen) return;
    // Small delay so the page can settle before popping the dialog.
    const t = setTimeout(() => {
      if (!activeShift) setShiftDialogOpen(true);
    }, 200);
    return () => clearTimeout(t);
  }, [user, activeShift, shiftDialogOpen]);

  // Item-removal UX: filter long bills + click-the-row-to-confirm (10s window)
  const [billSearch, setBillSearch] = useState("");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const confirmTimerRef = useRef(null);

  // Per-line discount: which line has its discount panel expanded. Only one
  // at a time keeps the UI simple and avoids stacking rows.
  const [expandedLineId, setExpandedLineId] = useState(null);

  // Customer attach: search-by-name input + dropdown of matches. Walking
  // customers (no attached record) still work via the existing free-text
  // name/phone fields below — the search box is opt-in convenience.
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerMatches, setCustomerMatches] = useState([]);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const customerSearchTimerRef = useRef(null);

  // Debounced search against /api/customers. The server's filterByQuery does
  // exact-equality, so we pass the trimmed query as-is — matches will be
  // exact substrings the cashier typed (e.g. last name only).
  useEffect(() => {
    if (customerSearchTimerRef.current) clearTimeout(customerSearchTimerRef.current);
    const q = customerSearch.trim();
    if (q.length < 2) {
      setCustomerMatches([]);
      return;
    }
    customerSearchTimerRef.current = setTimeout(async () => {
      try {
        const results = await searchCustomers({ name: q });
        setCustomerMatches(Array.isArray(results) ? results.slice(0, 8) : []);
      } catch (err) {
        // Soft-fail: a transient search error shouldn't break the checkout.
        setCustomerMatches([]);
      }
    }, 300);
    return () => {
      if (customerSearchTimerRef.current) clearTimeout(customerSearchTimerRef.current);
    };
  }, [customerSearch]);

  const attachCustomer = (customer) => {
    setBills((prev) => {
      const bill = prev[activeBillId];
      if (!bill) return prev;
      return {
        ...prev,
        [activeBillId]: {
          ...bill,
          customerId: customer.id,
          customerName: customer.name || "",
          customerPhone: customer.phone || "",
        },
      };
    });
    setCustomerSearch("");
    setCustomerMatches([]);
    setCustomerSearchOpen(false);
  };

  const detachCustomer = () => {
    setBills((prev) => {
      const bill = prev[activeBillId];
      if (!bill) return prev;
      return {
        ...prev,
        [activeBillId]: {
          ...bill,
          customerId: null,
          // Keep the typed name/phone so the cashier doesn't lose what they
          // already entered — they just become a "walking customer" again.
        },
      };
    });
  };

  /* ================= HELD BILLS =================
   * Two pieces of state, both persisted to localStorage:
   *   - bills (active tabs) — restored on refresh so drafts don't vanish
   *   - heldBills (parked) — explicit "I want this back later" with a TTL
   * The active tab is captured here on every change so a refresh keeps the
   * cashier exactly where they were. Held bills ride their own key.
   *
   * user/store are already captured at line 46 for the existing DRAFT_KEY —
   * reuse those rather than declaring again (no shadowing).
   */
  const STORAGE_PREFIX = `pos_active_bills_${user?.email || "nouser"}_${user?.storeType || "nostore"}`;
  const ACTIVE_BILLS_KEY = `${STORAGE_PREFIX}_active`;
  const HELD_BILLS_KEY = `${STORAGE_PREFIX}_held`;
  const HELD_BILL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

  const [heldBills, setHeldBills] = useState([]);
  const [heldDrawerOpen, setHeldDrawerOpen] = useState(false);
  const billsPersistTimerRef = useRef(null);
  const billsHydratedRef = useRef(false);

  // Hydrate from localStorage on mount (run once).
  useEffect(() => {
    try {
      const rawActive = window.localStorage.getItem(ACTIVE_BILLS_KEY);
      const rawHeld = window.localStorage.getItem(HELD_BILLS_KEY);
      if (rawActive) {
        const parsed = JSON.parse(rawActive);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const ids = Object.keys(parsed);
          if (ids.length > 0) {
            // Backfill any new bill fields on stored bills (defensive — older
            // bills saved before the discount/payments fields existed).
            const migrated = {};
            for (const id of ids) {
              migrated[id] = { ...newEmptyBill(), ...(parsed[id] || {}) };
            }
            setBills(migrated);
            setActiveBillId(ids[0]);
            // Keep billCounter ahead of any persisted numeric suffix.
            const maxN = ids.reduce((max, id) => {
              const m = /Bill-(\d+)/.exec(id);
              return m ? Math.max(max, Number(m[1])) : max;
            }, 100);
            setBillCounter(maxN);
          }
        }
      }
      if (rawHeld) {
        const parsedHeld = JSON.parse(rawHeld);
        if (Array.isArray(parsedHeld)) {
          // Prune expired entries on load.
          const cutoff = Date.now() - HELD_BILL_TTL_MS;
          setHeldBills(parsedHeld.filter((h) => h && h.heldAt && h.heldAt >= cutoff));
        }
      }
    } catch (err) {
      console.warn("Failed to hydrate POS bills from localStorage:", err);
    } finally {
      billsHydratedRef.current = true;
    }
    // Run once on mount; the key depends on user/store which is stable per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist active bills whenever they change (debounced 200ms). Skip writes
  // until hydration finishes — otherwise the empty initial state would clobber
  // any restored bills before we've read them back.
  useEffect(() => {
    if (!billsHydratedRef.current) return;
    if (billsPersistTimerRef.current) clearTimeout(billsPersistTimerRef.current);
    billsPersistTimerRef.current = setTimeout(() => {
      try {
        const hasContent = Object.values(bills).some(
          (b) =>
            b &&
            ((b.items || []).length > 0 ||
              (b.customerName || "").trim() ||
              (b.customerPhone || "").trim())
        );
        if (hasContent) {
          window.localStorage.setItem(ACTIVE_BILLS_KEY, JSON.stringify(bills));
        } else {
          window.localStorage.removeItem(ACTIVE_BILLS_KEY);
        }
      } catch (err) {
        console.warn("Failed to persist POS bills:", err);
      }
    }, 200);
    return () => {
      if (billsPersistTimerRef.current) clearTimeout(billsPersistTimerRef.current);
    };
  }, [bills, ACTIVE_BILLS_KEY]);

  // Persist held bills whenever they change (synchronous — small list, no need to debounce).
  useEffect(() => {
    if (!billsHydratedRef.current) return;
    try {
      if (heldBills.length > 0) {
        window.localStorage.setItem(HELD_BILLS_KEY, JSON.stringify(heldBills));
      } else {
        window.localStorage.removeItem(HELD_BILLS_KEY);
      }
    } catch (err) {
      console.warn("Failed to persist held bills:", err);
    }
  }, [heldBills, HELD_BILLS_KEY]);

  const holdBill = (billId) => {
    const bill = bills[billId];
    if (!bill) return;
    if ((bill.items || []).length === 0) {
      alert("Cannot hold an empty bill.");
      return;
    }
    const snapshot = {
      id: billId,
      customerName: bill.customerName || "",
      customerPhone: bill.customerPhone || "",
      items: bill.items || [],
      paymentMode: bill.paymentMode || "Cash",
      payments: bill.payments || [],
      discount: bill.discount || null,
      heldAt: Date.now(),
    };
    setHeldBills((prev) => [snapshot, ...prev]);
    setBills((prev) => {
      const copy = { ...prev };
      delete copy[billId];
      return copy;
    });
    if (billId === activeBillId) {
      const remaining = Object.keys(bills).filter((b) => b !== billId);
      setActiveBillId(remaining[0] || null);
    }
  };

  const recallBill = (heldId) => {
    setHeldBills((prev) => {
      const idx = prev.findIndex((h) => h.id === heldId);
      if (idx === -1) return prev;
      const held = prev[idx];
      // Find a free Bill-NNN id (counter advances if there's a collision).
      let newId = `Bill-${billCounter + 1}`;
      while (bills[newId]) {
        newId = `Bill-${Number(newId.split("-")[1]) + 1}`;
      }
      const newBill = {
        items: held.items || [],
        paymentMode: held.paymentMode || "Cash",
        customerName: held.customerName || "",
        customerPhone: held.customerPhone || "",
        discount: held.discount || null,
        payments: held.payments || [],
      };
      setBills((prevBills) => ({ ...prevBills, [newId]: newBill }));
      const nextCounter = Math.max(billCounter, Number(newId.split("-")[1]));
      setBillCounter(nextCounter);
      setActiveBillId(newId);
      setHeldDrawerOpen(false);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const discardHeldBill = (heldId) => {
    setHeldBills((prev) => prev.filter((h) => h.id !== heldId));
  };

  const setLineDiscount = (productId, discount) => {
    setBills((prev) => {
      const bill = prev[activeBillId];
      if (!bill) return prev;
      return {
        ...prev,
        [activeBillId]: {
          ...bill,
          items: bill.items.map((it) =>
            it.id === productId ? { ...it, lineDiscount: discount } : it
          ),
        },
      };
    });
  };

  // "Just now" / "5m ago" / "2h ago" / "3d ago" — friendly relative time
  // for held-bill timestamps in the drawer.
  const humanizeAgo = (ms) => {
    if (ms < 60_000) return "just now";
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const setBillDiscount = (discount) => {
    setBills((prev) => {
      const bill = prev[activeBillId];
      if (!bill) return prev;
      return {
        ...prev,
        [activeBillId]: { ...bill, discount },
      };
    });
  };

  const requestDelete = (item) => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmingDeleteId(item.id);
    confirmTimerRef.current = setTimeout(() => {
      setConfirmingDeleteId(null);
      confirmTimerRef.current = null;
    }, 10000);
  };

  const cancelDelete = () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = null;
    setConfirmingDeleteId(null);
  };

  const confirmDelete = (item) => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    confirmTimerRef.current = null;
    setConfirmingDeleteId(null);
    handleDeleteItem(item);
  };

  const filteredBillItems = billSearch.trim()
    ? activeBill.items.filter((it) =>
        String(it.name || "")
          .toLowerCase()
          .includes(billSearch.trim().toLowerCase())
      )
    : activeBill.items;

  const businessType = settings.businessType || "retail";
  const isRetail = businessType === "retail";

  const getProductUnit = (product) => {
    if (!product) return "kg";
    if (product.unit) return product.unit;
    if (!isRetail) return "kg";
    return product.category === "Groceries" ? "kg" : "unit";
  };

  const getItemUnit = (item) => getProductUnit(item);
  const getItemQty = (item) => {
    const unit = getItemUnit(item);
    if (unit === "kg") return Number(item.qtyKg) || 0;
    return Number(item.qty) || 0;
  };

  const formatQty = (qty, unit) => {
    if (unit === "kg") return (Number(qty) || 0).toFixed(3);
    return String(Math.max(0, Math.round(Number(qty) || 0)));
  };

  /* ================= UNDO PRODUCT DELETE ================= */

  const [undoProduct, setUndoProduct] = useState(null);
  const undoTimerRef = useRef(null);

  // Guard against accidental data loss: warn before closing/refreshing
  // the tab while the cashier has unsaved items in the active bill.
  useUnsavedChangesGuard(activeBill.items.length > 0);

  const loadData = useCallback(async () => {
    let storedProducts = [];
    try {
      const data = await getProducts();
      storedProducts = Array.isArray(data) ? data : [];
    } catch (e) {
      console.error("Error loading products from API:", e);
      storedProducts = [];
    }

    if (storedProducts.length === 0) {
      storedProducts = [
        {
          name: "Rice",
          price: 50,
          gst: 5,
          stock: 50,
          barcode: "1234567890123",
          category: "Groceries",
          unit: "kg",
        },
        {
          name: "Oil",
          price: 120,
          gst: 12,
          stock: 30,
          barcode: "1234567890124",
          category: "Groceries",
          unit: "kg",
        },
        {
          name: "Sugar",
          price: 40,
          gst: 5,
          stock: 25,
          barcode: "1234567890125",
          category: "Groceries",
          unit: "kg",
        },
        {
          name: "Atta",
          price: 35,
          gst: 5,
          stock: 45,
          barcode: "1234567890126",
          category: "Groceries",
          unit: "kg",
        },
        {
          name: "Tea",
          price: 200,
          gst: 12,
          stock: 15,
          barcode: "1234567890127",
          category: "Beverages",
          unit: "unit",
        },
      ];

      try {
        const seeded = await Promise.all(
          storedProducts.map((product) =>
            addProduct(product).catch((err) => {
              console.error("Failed to seed default product:", err);
              return null;
            })
          )
        );
        storedProducts = seeded.filter(Boolean);
      } catch (err) {
        console.error("Failed to seed default products:", err);
      }
    }

    setProducts(
      storedProducts.map((product) => ({
        ...product,
        name: String(product?.name || "").trim(),
        category: String(product?.category || "").trim(),
        barcode: String(product?.barcode || "").trim(),
        unit: product?.unit || "",
        price: Number(product?.price || 0),
        gst: Number(product?.gst || 0),
        stock: Number(product?.stock || 0),
      }))
    );
    setHydrated(true);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Draft state remains in-memory only; do not persist to browser storage.

  /* ================= LOW STOCK ================= */

  const getLowStockLimit = (name) => {
    name = String(name || "").toLowerCase();
    if (["rice", "oil", "sugar", "atta", "wheat", "peanut"].some((n) => name.includes(n)))
      return 40;
    if (["tea", "coffee", "masala", "spice", "salt"].some((n) => name.includes(n))) return 10;
    return 20;
  };

  const filteredProducts = products.filter(
    (p) =>
      String(p?.name || "")
        .toLowerCase()
        .includes(searchText.toLowerCase()) &&
      (selectedCategory === "" || p.category === selectedCategory)
  );

  /* ================= VOICE SEARCH ================= */

  const startVoiceSearch = () => {
    if (!SpeechRecognition) return alert("Voice not supported");

    const r = new SpeechRecognition();
    r.lang = "en-IN";
    r.interimResults = false;
    setListening(true);
    r.start();

    r.onresult = (e) => setSearchText(e.results[0][0].transcript);
    r.onend = () => setListening(false);
  };

  // Fix: define SpeechRecognition inside the component
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  /* ================= ADD ITEM ================= */

  const addWeightedItem = (product, weightKg) => {
    if (weightKg <= 0) return;
    const unit = getProductUnit(product);
    if (unit !== "kg") {
      addUnitItem(product, weightKg);
      return;
    }
    if (product.stock < weightKg) {
      alert(`Only ${product.stock} KG available`);
      return;
    }

    const enrichedProduct = {
      ...product,
      unit,
      qtyKg: weightKg,
      gst: Number(product.gst || 0),
      price: Number(product.price || 0),
    };

    const updatedBills = {
      ...bills,
      [activeBillId]: {
        ...bills[activeBillId],
        items: bills[activeBillId].items.some((i) => i.id === product.id)
          ? bills[activeBillId].items.map((i) =>
              i.id === product.id
                ? { ...i, qtyKg: i.qtyKg + weightKg, gst: Number(product.gst || 0) }
                : i
            )
          : [...bills[activeBillId].items, enrichedProduct],
      },
    };

    setBills(updatedBills);

    // ✅ update products ONCE
    const updatedProducts = products.map((p) =>
      p.id === product.id ? { ...p, stock: +(p.stock - weightKg).toFixed(3) } : p
    );
    // persist product stock change
    persistProducts(updatedProducts);

    if (product.stock - weightKg < getLowStockLimit(product.name)) {
      alert(`⚠ LOW STOCK\n${product.name}`);
    }
  };

  const addUnitItem = (product, units) => {
    const unit = getProductUnit(product);
    if (unit === "kg") {
      const weight = Number(units) || 0;
      addWeightedItem(product, weight);
      return;
    }

    const addQty = Math.max(1, Math.round(Number(units) || 0));

    if (product.stock < addQty) {
      alert(`Only ${product.stock} unit available`);
      return;
    }

    const updatedBills = {
      ...bills,
      [activeBillId]: {
        ...bills[activeBillId],
        items: bills[activeBillId].items.some((i) => i.id === product.id)
          ? bills[activeBillId].items.map((i) =>
              i.id === product.id
                ? {
                    ...i,
                    unit,
                    qty: (Number(i.qty) || 0) + addQty,
                    qtyKg: (Number(i.qtyKg) || 0) + addQty,
                    gst: Number(product.gst || 0),
                  }
                : i
            )
          : [
              ...bills[activeBillId].items,
              {
                ...product,
                unit,
                qty: addQty,
                qtyKg: addQty,
                gst: Number(product.gst || 0),
                price: Number(product.price || 0),
              },
            ],
      },
    };

    setBills(updatedBills);

    const updatedProducts = products.map((p) =>
      p.id === product.id ? { ...p, stock: (Number(p.stock) || 0) - addQty } : p
    );
    persistProducts(updatedProducts);

    if (product.stock - addQty < getLowStockLimit(product.name)) {
      alert(`⚠ LOW STOCK\n${product.name}`);
    }
  };

  /* ================= QTY CONTROLS ================= */

  const decreaseQty = (item) => {
    const step = 0.25;
    const unit = getItemUnit(item);
    if (unit !== "kg") {
      decreaseUnitQty(item);
      return;
    }
    // Prevent negative quantity
    if (item.qtyKg <= step) return;

    // persistProducts is not needed here, handled by setProducts below

    setBills((prev) => ({
      ...prev,
      [activeBillId]: {
        ...prev[activeBillId],
        items: prev[activeBillId].items.map((i) =>
          i.id === item.id ? { ...i, qtyKg: i.qtyKg - step } : i
        ),
      },
    }));

    const updatedProducts = products.map((p) =>
      p.id === item.id ? { ...p, stock: +(p.stock + step).toFixed(3) } : p
    );
    persistProducts(updatedProducts);
  };

  const decreaseUnitQty = (item) => {
    const unit = getItemUnit(item);
    if (unit === "kg") return;
    const step = 1;
    const current = Number(item.qty) || 0;
    if (current <= step) return;

    setBills((prev) => ({
      ...prev,
      [activeBillId]: {
        ...prev[activeBillId],
        items: prev[activeBillId].items.map((i) =>
          i.id === item.id
            ? {
                ...i,
                qty: (Number(i.qty) || 0) - step,
                qtyKg: (Number(i.qtyKg) || 0) - step,
              }
            : i
        ),
      },
    }));

    const updatedProducts = products.map((p) =>
      p.id === item.id ? { ...p, stock: (Number(p.stock) || 0) + step } : p
    );
    persistProducts(updatedProducts);
  };

  /* ================= DELETE + UNDO ================= */

  const handleDeleteItem = (item) => {
    const unit = getItemUnit(item);
    const restoreQty = unit === "kg" ? Number(item.qtyKg) || 0 : Number(item.qty) || 0;
    setBills((prev) => ({
      ...prev,
      [activeBillId]: {
        ...prev[activeBillId],
        items: prev[activeBillId].items.filter((i) => i.id !== item.id),
      },
    }));

    const updatedProducts = products.map((p) =>
      p.id === item.id
        ? unit === "kg"
          ? { ...p, stock: +(p.stock + restoreQty).toFixed(3) }
          : { ...p, stock: (Number(p.stock) || 0) + restoreQty }
        : p
    );
    persistProducts(updatedProducts);

    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoProduct(item);
    undoTimerRef.current = setTimeout(() => setUndoProduct(null), 5000);
  };

  const handleUndoProduct = () => {
    const unit = getItemUnit(undoProduct);
    const undoQty = unit === "kg" ? Number(undoProduct.qtyKg) || 0 : Number(undoProduct.qty) || 0;
    const updatedProducts = products.map((p) =>
      p.id === undoProduct.id
        ? unit === "kg"
          ? { ...p, stock: +(p.stock - undoQty).toFixed(3) }
          : { ...p, stock: (Number(p.stock) || 0) - undoQty }
        : p
    );

    persistProducts(updatedProducts);

    setBills((prev) => ({
      ...prev,
      [activeBillId]: {
        ...prev[activeBillId],
        items: [...prev[activeBillId].items, undoProduct],
      },
    }));

    setUndoProduct(null);
  };

  /* ================= BARCODE ================= */

  const handleBarcodeScan = (code) => {
    const p = products.find((p) => String(p.barcode) === String(code.trim()));
    if (!p) return alert("Product not found");
    const unit = getProductUnit(p);
    if (unit === "kg") addWeightedItem(p, qtyKg);
    else addUnitItem(p, qtyUnit);
  };

  /* ================= TOTALS ================= */

  // Apply a discount to a base amount. type "percent" → percentage of base;
  // type "flat" → flat rupee amount. Caps the result at the base itself
  // (you can't discount more than the line is worth).
  const applyDiscount = (base, discount) => {
    if (!discount || !discount.value || Number(discount.value) <= 0) return 0;
    const v = Number(discount.value);
    if (discount.type === "percent") {
      return Math.min(base, (base * v) / 100);
    }
    return Math.min(base, v);
  };

  // Per-line effective subtotal (gross minus line discount) is what GST is
  // computed on — Indian GST practice is to tax the actual transaction value,
  // not the marked price.
  const lineEffective = (i) => {
    const gross = i.price * getItemQty(i);
    return gross - applyDiscount(gross, i.lineDiscount);
  };

  const subTotalBeforeBillDiscount = activeBill.items.reduce((s, i) => s + lineEffective(i), 0);
  const lineDiscountTotal = activeBill.items.reduce(
    (s, i) => s + applyDiscount(i.price * getItemQty(i), i.lineDiscount),
    0
  );
  const billDiscountAmount = applyDiscount(subTotalBeforeBillDiscount, activeBill.discount);
  const subTotal = subTotalBeforeBillDiscount - billDiscountAmount;
  // Bill-level discount reduces the GST base proportionally — GST is charged
  // on the actual transaction value, not the marked price. Without this, a
  // 100% bill discount would still carry full GST, which is incorrect.
  const billDiscountRatio =
    subTotalBeforeBillDiscount > 0 ? subTotal / subTotalBeforeBillDiscount : 0;
  const gstTotal =
    activeBill.items.reduce((s, i) => s + (lineEffective(i) * Number(i.gst || 0)) / 100, 0) *
    billDiscountRatio;
  const grandTotal = subTotal + gstTotal;
  const totalSavings = lineDiscountTotal + billDiscountAmount;

  // Split-payment aggregation (used for validation + receipt + auto-fill).
  const tendered = (activeBill.payments || []).reduce((s, p) => s + Number(p.amount || 0), 0);
  const changeDue = Math.max(0, tendered - grandTotal);

  /* ================= CLOSE BILL (❌) ================= */

  const closeBill = (billId) => {
    if (Object.keys(bills).length === 1) {
      alert("At least one bill must remain");
      return;
    }

    const billItems = bills[billId].items;

    // ✅ compute stock restore ONCE
    const updatedProducts = products.map((p) => {
      const item = billItems.find((i) => i.id === p.id);
      if (!item) return p;

      const unit = getItemUnit(item);
      const restoreQty = unit === "kg" ? Number(item.qtyKg) || 0 : Number(item.qty) || 0;
      return item
        ? unit === "kg"
          ? { ...p, stock: +(p.stock + restoreQty).toFixed(3) }
          : { ...p, stock: (Number(p.stock) || 0) + restoreQty }
        : p;
    });

    // ✅ persist ONCE
    persistProducts(updatedProducts);

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

  /* ================= GENERATE INVOICE ================= */

  const generateInvoice = async () => {
    if (activeBill.items.length === 0) return alert("Add items first!");
    // Block split-tender checkouts where the customer hasn't paid enough.
    if (activeBill.paymentMode === "Split" && tendered < grandTotal) {
      alert(
        `Tendered (₹${tendered.toFixed(2)}) is less than the grand total (₹${grandTotal.toFixed(2)}).`
      );
      return;
    }
    // Customer details now come from per-bill fields (shifted from store settings)
    const billCustomerName = (activeBill.customerName || "").trim();
    const billCustomerPhone = (activeBill.customerPhone || "").trim();
    // Send WhatsApp if phone is present and valid
    if (billCustomerPhone && billCustomerPhone.match(/^\d{10,15}$/)) {
      const tempInvoice = {
        invoiceNo: "INV-" + uuid().slice(0, 6),
        date: new Date().toISOString().split("T")[0],
        items: activeBill.items,
        subTotal,
        gstTotal,
        grandTotal,
        paymentMode: activeBill.paymentMode,
        customerId: activeBill.customerId || undefined,
        customerName: billCustomerName,
        customerPhone: billCustomerPhone,
      };
      const customerNameForMessage = billCustomerName || "Walking Customer";
      const msg = encodeURIComponent(
        `Dear ${customerNameForMessage},\n\nThank you for your purchase!\nInvoice No: ${tempInvoice.invoiceNo}\nDate: ${tempInvoice.date}\nTotal: ₹${tempInvoice.grandTotal.toFixed(2)}`
      );
      window.open(`https://wa.me/${billCustomerPhone}?text=${msg}`, "_blank");
    }
    // Get billing user info
    const billingUser = getUser();
    const isSplit = activeBill.paymentMode === "Split";
    const filteredPayments = isSplit
      ? (activeBill.payments || []).filter((p) => Number(p.amount) > 0)
      : [];
    const invoice = {
      invoiceNo: "INV-" + uuid().slice(0, 6),
      date: new Date().toISOString().split("T")[0],
      items: activeBill.items,
      subTotal,
      gstTotal,
      grandTotal,
      paymentMode: activeBill.paymentMode,
      payments: isSplit ? filteredPayments : undefined,
      tendered: isSplit ? tendered : undefined,
      changeDue: isSplit ? changeDue : undefined,
      discount: activeBill.discount || undefined,
      discountBreakdown: {
        line: activeBill.items
          .filter((i) => i.lineDiscount && Number(i.lineDiscount.value) > 0)
          .map((i) => ({
            productId: i.id,
            productName: i.name,
            discount: i.lineDiscount,
            saved: applyDiscount(i.price * getItemQty(i), i.lineDiscount),
          })),
        bill: activeBill.discount || null,
        totalSavings,
      },
      customerId: activeBill.customerId || undefined,
      customerName: billCustomerName,
      customerPhone: billCustomerPhone,
      billedBy: billingUser ? billingUser.email || billingUser.name || "Unknown" : "Unknown",
    };

    // For non-cash payment modes, open the PaymentDialog first. The dialog
    // creates the intent server-side, shows a UPI QR / checkout URL,
    // polls for status, and only fires `onComplete` once the payment has
    // been confirmed. Then we run the atomic stock-decrement + invoice
    // save below. Cash and Split skip the dialog (cash is collected in
    // hand; split payments are mixed tenders handled inside this POS).
    const needsGateway = activeBill.paymentMode === "UPI" || activeBill.paymentMode === "Card";

    if (needsGateway) {
      // Stash the built invoice; run the actual save after the dialog
      // signals completion (paid via poll, simulated, or manually marked).
      pendingInvoiceRef.current = invoice;
      setPaymentDialog({
        open: true,
        invoice,
        amount: invoice.grandTotal,
        method: activeBill.paymentMode.toLowerCase(),
        invoiceNo: invoice.invoiceNo,
        note: `POS payment for ${invoice.invoiceNo}`,
      });
      return;
    }

    // Cash sales: gate on an open shift. The cashier's currently-open
    // shift (if any) becomes the recipient of a 'sale' cash_movement
    // after we save the invoice. If the storeType doesn't use shifts
    // (e.g. system admin), skip the gate entirely.
    if (activeBill.paymentMode === "Cash" && currentStoreNeedsShift()) {
      let active = await getActiveShift();
      if (!active) {
        // No shift open. Stash the invoice + open the OpenShiftDialog.
        // When the cashier opens a shift, we'll re-run the save flow.
        pendingInvoiceRef.current = invoice;
        setShiftDialogOpen(true);
        return;
      }
    }

    // Cash / Split: same atomic checkout as before.
    await persistInvoiceAfterCheckout(invoice);
  };

  // Atomic checkout + invoice save + post-save reconciliation. Pulled
  // out of generateInvoice so the PaymentDialog can call into the same
  // path after a payment completes.
  const persistInvoiceAfterCheckout = async (invoice) => {
    let result;
    try {
      // Server-authoritative checkout: validates stock + decrements + saves
      // invoice in one atomic operation. Replaces the previous approach of
      // firing N PUT /api/products/:id calls per cart mutation.
      result = await checkoutInvoice(invoice);
    } catch (err) {
      if (err && err.status === 409) {
        const { productName, available, requested } = err.body || {};
        alert(
          `Insufficient stock for ${productName || "an item"}.\n` +
            `Requested: ${requested}, Available: ${available}.`
        );
        try {
          const fresh = await getProducts();
          persistProducts(fresh || []);
        } catch {
          /* ignore — user will see stale numbers until next refresh */
        }
        return;
      }
      alert(`Checkout failed: ${err.message}`);
      return;
    }

    if (result && Array.isArray(result.updatedStock) && result.updatedStock.length > 0) {
      const stockById = new Map(result.updatedStock.map((s) => [String(s.id), s.stock]));
      const reconciled = products.map((p) =>
        stockById.has(String(p.id)) ? { ...p, stock: stockById.get(String(p.id)) } : p
      );
      persistProducts(reconciled);
    }

    setLastInvoice(result.invoice || invoice);

    // For cash sales in a cash-vertical store, record the sale against
    // the cashier's currently-open shift. Fire-and-forget — the invoice
    // is already saved; this just adds the cash_movement ledger row
    // so the variance at end-of-shift is accurate.
    if (invoice.paymentMode === "Cash" && currentStoreNeedsShift()) {
      recordCashSaleForShift({ invoiceNo: invoice.invoiceNo, amount: invoice.grandTotal });
    }

    navigate(`/invoice/${invoice.invoiceNo}`);
  };

  // 1️⃣ Low stock items

  const lowStockItems = products.filter((p) => {
    const limit = getLowStockLimit(p.name);
    return p.stock > 0 && p.stock >= limit * 0.5 && p.stock < limit;
  });

  // 2️⃣ Critical stock items

  const criticalStockItems = products.filter(
    (p) => p.stock > 0 && p.stock < getLowStockLimit(p.name) * 0.5
  );

  /* ================= RENDER ================= */

  return (
    <div className="pos-container retail-pos-pro">
      <div className="pos-page">
        <ShiftStatusBanner
          onOpen={() => setShiftDialogOpen(true)}
          onClose={() => {
            // Open the inline close-shift dialog (mounted below) so the
            // cashier can count + close without leaving the POS.
            if (activeShift) setCloseShiftDialogOpen(true);
          }}
        />
        {/* ================= HERO ================= */}
        <div className="pos-hero">
          <div className="pos-hero-bg" aria-hidden="true" />
          <div className="pos-hero-content">
            <div className="pos-hero-text">
              <div className="pos-hero-eyebrow">
                <FaCashRegister /> <span>Retail Operations</span>
              </div>
              <h1 className="pos-hero-title">Retail POS Billing</h1>
              <p className="pos-hero-subtitle">
                Fast checkout, smarter inventory, and cleaner bills.
              </p>
              <div className="pos-hero-meta">
                <span className="pos-hero-pill tone-sky">
                  <FaLayerGroup /> Open Bills: {Object.keys(bills).length}
                </span>
                <span className="pos-hero-pill tone-emerald">
                  <FaBoxOpen /> Products: {products.length}
                </span>
                <span className="pos-hero-pill tone-amber">
                  <FaBoxOpen /> Low Stock: {lowStockItems.length}
                </span>
              </div>
            </div>
            <div className="pos-hero-actions">
              {currentStoreNeedsShift() && !activeShift && (
                <button
                  type="button"
                  className="pos-hero-action-btn pos-hero-action-btn-shift"
                  onClick={() => setShiftDialogOpen(true)}
                  title="Open your shift to start taking cash sales"
                >
                  <FaCashRegister /> <span>Start my shift</span>
                </button>
              )}
              {currentStoreNeedsShift() && activeShift && (
                <button
                  type="button"
                  className="pos-hero-action-btn pos-hero-action-btn-shift-open"
                  onClick={() => setCloseShiftDialogOpen(true)}
                  title={`Shift is open — float ₹${Number(activeShift.openingFloat || 0).toFixed(2)}`}
                >
                  <FaCheckCircle /> <span>Shift open · Close…</span>
                </button>
              )}
              <button
                type="button"
                className="pos-hero-action-btn"
                onClick={exportLowStockToExcel}
                title="Export low-stock items as Excel"
              >
                <FaFileExcel /> <span>Export Low Stock</span>
              </button>
              <button
                type="button"
                className="pos-hero-icon-btn"
                onClick={loadData}
                title="Reload products"
                aria-label="Reload products"
              >
                <FaCashRegister />
              </button>
            </div>
          </div>
        </div>
        {/* ================= BILL TABS ================= */}

        {/* ================= BILL TABS ================= */}
        <div className="pos-tabs">
          {Object.keys(bills).map((billId) => {
            const total = bills[billId].items.reduce((s, i) => s + i.price * getItemQty(i), 0);
            const itemCount = bills[billId].items.length;
            const isActive = billId === activeBillId;
            const avatarText = billId.replace(/[^0-9]/g, "").slice(-2) || "•";

            return (
              <div
                key={billId}
                className={`pos-tab ${isActive ? "active" : ""}`}
                onClick={() => setActiveBillId(billId)}
                role="tab"
                aria-selected={isActive}
              >
                <div className="pos-tab-avatar">{avatarText}</div>
                <div className="pos-tab-info">
                  <span className="pos-tab-title">{billId}</span>
                  <div className="pos-tab-meta">
                    <span className="pos-tab-count">{itemCount}</span>
                    <span className="pos-tab-total">₹{total.toFixed(2)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className="pos-tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeBill(billId);
                  }}
                  aria-label={`Close ${billId}`}
                  title="Close bill"
                />
              </div>
            );
          })}

          {/* ADD NEW BILL */}
          <div
            className="pos-tab add"
            onClick={() => {
              const newId = `Bill-${billCounter + 1}`;
              setBills((prev) => ({
                ...prev,
                [newId]: newEmptyBill(),
              }));
              setBillCounter((c) => c + 1);
              setActiveBillId(newId);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.currentTarget.click();
              }
            }}
          >
            <FaPlus />
            <span>New Bill</span>
          </div>
        </div>

        {/* ================= UNDO TOAST ================= */}
        {undoProduct && (
          <div className="pos-undo-toast">
            <div className="pos-undo-toast-body">
              <FaUndo className="pos-undo-icon" />
              <div className="pos-undo-toast-meta">
                <b>{undoProduct.name}</b>
                <span>Removed — tap UNDO to restore</span>
              </div>
              <button className="pos-undo-btn" onClick={handleUndoProduct}>
                UNDO
              </button>
            </div>
            <div className="pos-undo-toast-timer">
              <div className="pos-undo-toast-timer-bar" />
            </div>
          </div>
        )}
        {/* ================= EXPORT TOAST ================= */}
        {exportToast && (
          <div className={`pos-export-toast ${exportToast.type}`}>
            {exportToast.type === "success" ? <FaFileExcel /> : <FaBoxOpen />}
            <span>{exportToast.message}</span>
          </div>
        )}

        {/* ================= TOOLBAR (barcode / search / voice / category / qty) ================= */}
        <div className="pos-toolbar">
          <div className="pos-toolbar-field">
            <label className="pos-toolbar-label">
              <FaBarcode /> Barcode
            </label>
            <input
              autoFocus
              className="pos-input"
              placeholder="Scan barcode here"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleBarcodeScan(barcode);
                  setBarcode("");
                }
              }}
            />
          </div>

          <div className="pos-toolbar-field pos-toolbar-search">
            <label className="pos-toolbar-label">
              <FaSearch /> Search
            </label>
            <div className="pos-search-row">
              <input
                className="pos-input"
                placeholder="Search product..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
              <button
                type="button"
                className={`pos-voice-btn ${listening ? "listening" : ""}`}
                onClick={startVoiceSearch}
                title={listening ? "Listening…" : "Voice Search"}
                aria-label="Voice Search"
              >
                <FaMicrophone />
              </button>
            </div>
          </div>

          <div className="pos-toolbar-field">
            <label className="pos-toolbar-label">
              <FaLayerGroup /> Category
            </label>
            <select
              className="pos-input"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="">All Categories</option>
              {[...new Set(products.map((p) => p.category).filter(Boolean))].map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="pos-toolbar-field">
            <label className="pos-toolbar-label">
              <FaBoxOpen /> Quantity
            </label>
            <div className="pos-qty-row">
              {[0.25, 0.5, 1, 2].map((w) => (
                <button
                  key={w}
                  type="button"
                  className={`pos-qty-chip ${qtyKg === w ? "active" : ""}`}
                  onClick={() => setQtyKg(w)}
                >
                  {w === 0.25 ? "250g" : w === 0.5 ? "500g" : `${w}kg`}
                </button>
              ))}
            </div>
            <input
              type="number"
              step="0.001"
              min="0"
              className="pos-input"
              value={qtyKg}
              onChange={(e) => setQtyKg(parseFloat(e.target.value) || 0)}
              placeholder="Custom kg e.g. 0.367"
            />
            <input
              type="number"
              step="1"
              min="1"
              className="pos-input"
              value={qtyUnit}
              onChange={(e) => setQtyUnit(parseInt(e.target.value, 10) || 1)}
              placeholder="Units (e.g. 2)"
            />
          </div>
        </div>

        {/* ================= PRODUCTS + BILL ================= */}
        <div className="pos-body">
          {/* PRODUCTS */}
          <section className="pos-products">
            <header className="pos-products-header">
              <div className="pos-products-header-text">
                <h3 className="pos-products-title">
                  <FaBoxOpen /> Products
                </h3>
                <p className="pos-products-subtitle">
                  Search, filter and tap to add items to the active bill.
                </p>
              </div>
              <div className="pos-products-metrics">
                <span className="pos-products-metric tone-sky">
                  {filteredProducts.length} items
                </span>
                <span className="pos-products-metric tone-amber">
                  {lowStockItems.length} low stock
                </span>
              </div>
            </header>

            <div className="pos-products-grid">
              {filteredProducts.length === 0 ? (
                <div className="pos-products-empty">
                  <FaSearch />
                  <strong>No products match your filters</strong>
                  <span>Try clearing the search or picking a different category.</span>
                </div>
              ) : (
                filteredProducts.map((p) => {
                  const limit = getLowStockLimit(p.name);
                  const lowStock = p.stock > 0 && p.stock < limit;
                  const outOfStock = p.stock <= 0;
                  const unit = getProductUnit(p);
                  const priceLabel = unit === "kg" ? `${p.price}/kg` : `${p.price}/unit`;
                  const stockLabel =
                    unit === "kg"
                      ? `${Number(p.stock || 0).toFixed(2)} kg`
                      : `${Math.round(Number(p.stock || 0))} unit`;
                  const stockTone = outOfStock ? "out" : lowStock ? "low" : "healthy";
                  const stockPct = Math.min(
                    100,
                    Math.round((Number(p.stock || 0) / (limit * 2)) * 100)
                  );
                  const cartLine = activeBill.items.find((it) => it.id === p.id);
                  const inCartQty = cartLine ? getItemQty(cartLine) : 0;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`pos-product-card tone-${stockTone}${cartLine ? " is-in-cart" : ""}`}
                      onClick={() => {
                        if (outOfStock) return;
                        if (unit === "kg") addWeightedItem(p, qtyKg);
                        else addUnitItem(p, qtyUnit);
                      }}
                      disabled={outOfStock}
                      aria-label={`Add ${p.name}`}
                    >
                      {cartLine && (
                        <span className="pos-in-cart-badge">× {formatQty(inCartQty, unit)}</span>
                      )}
                      <div className="pos-product-card-top">
                        <div className={`pos-product-icon tone-${stockTone}`}>
                          <FaBoxOpen />
                        </div>
                        <div className="pos-product-info">
                          <div className="pos-product-name">{p.name}</div>
                          <div className="pos-product-category">{p.category || "General"}</div>
                        </div>
                      </div>

                      <div className="pos-product-stock">
                        <div className="pos-stock-bar">
                          <div
                            className={`pos-stock-fill tone-${stockTone}`}
                            style={{ width: `${outOfStock ? 0 : stockPct}%` }}
                          />
                        </div>
                        <span className={`pos-stock-badge tone-${stockTone}`}>
                          {outOfStock ? "Out of stock" : stockLabel}
                        </span>
                      </div>

                      <div className="pos-product-card-bottom">
                        <span className="pos-product-price">
                          <FaRupeeSign /> {priceLabel}
                        </span>
                        <span className="pos-product-tap-hint">
                          {outOfStock ? "—" : cartLine ? "+1 more" : "Tap to add"}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>
          {/* BILL — horizontal dashboard, sits directly below Category → Quantity */}
          <div className="bill-summary-card pos-panel">
            {/* --- Header strip --- */}
            <div className="bill-summary-strip">
              <div className="bill-summary-titleline">
                <div className="bill-summary-icon">
                  <FaCashRegister />
                </div>
                <div>
                  <h5 className="bill-summary-title">
                    Billing Summary
                    <span className="bill-summary-bill-id">{activeBillId}</span>
                  </h5>
                  <p className="bill-summary-subtitle">
                    Review items, update quantities, and complete checkout.
                  </p>
                </div>
              </div>
              <div className="bill-summary-status">
                <span className="bill-summary-badge bill-summary-total">
                  <FaRupeeSign />
                  {grandTotal.toFixed(2)}
                </span>
                <span className="bill-summary-badge bill-summary-items">
                  {activeBill.items.length} {activeBill.items.length === 1 ? "item" : "items"}
                </span>
              </div>
            </div>

            {/* --- Two-pane body --- */}
            <div className="bill-summary-main">
              {/* Items pane */}
              <div className="bill-items-pane" onClick={cancelDelete}>
                {/* Quick filter to find items in long bills */}
                {activeBill.items.length > 0 && (
                  <div className="bill-items-search">
                    <FaSearch className="bill-items-search-icon" />
                    <input
                      type="search"
                      className="bill-items-search-input"
                      placeholder="Find item in this bill…"
                      value={billSearch}
                      onChange={(e) => setBillSearch(e.target.value)}
                      onFocus={cancelDelete}
                      aria-label="Filter bill items"
                    />
                    {billSearch && (
                      <button
                        type="button"
                        className="bill-items-search-clear"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBillSearch("");
                        }}
                        aria-label="Clear filter"
                        title="Clear filter"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}

                <div className="bill-items-table-wrap">
                  <table className="bill-items-table">
                    <colgroup>
                      <col style={{ width: "auto" }} />
                      <col style={{ width: "120px" }} />
                      <col style={{ width: "110px" }} />
                      <col style={{ width: "62px" }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th style={{ textAlign: "center" }}>Qty</th>
                        <th style={{ textAlign: "right" }}>Amount</th>
                        <th style={{ textAlign: "center" }}>Remove</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeBill.items.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="bill-empty-cell">
                            <div className="bill-empty-state">
                              <div className="bill-empty-icon">
                                <FaCashRegister />
                              </div>
                              <h6>No items in this bill</h6>
                              <p>
                                Tap any product on the left to add it here. The total updates live
                                as you go.
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : filteredBillItems.length === 0 ? (
                        <tr>
                          <td colSpan="4" className="bill-empty-cell">
                            <div className="bill-empty-state">
                              <div className="bill-empty-icon">
                                <FaSearch />
                              </div>
                              <h6>No items match “{billSearch}”</h6>
                              <p>Try a different name or clear the filter.</p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredBillItems.map((i) => {
                          const unit = getItemUnit(i);
                          const qty = getItemQty(i);
                          const lineSubtotal = qty * i.price;
                          const lineGst = (lineSubtotal * Number(i.gst || 0)) / 100;
                          const isConfirming = confirmingDeleteId === i.id;
                          return (
                            <React.Fragment key={i.id}>
                              <tr
                                key={i.id}
                                className={`bill-item-row${isConfirming ? " is-confirming" : ""}`}
                                onClick={(e) => {
                                  // The row itself becomes the confirmation target.
                                  // Inner controls call stopPropagation() so they don't trigger this.
                                  if (isConfirming && e.target === e.currentTarget) {
                                    confirmDelete(i);
                                  }
                                }}
                                title={
                                  isConfirming
                                    ? `Click anywhere on this row to remove ${i.name}`
                                    : undefined
                                }
                              >
                                <td className="bill-item-info">
                                  <b>{i.name}</b>
                                  <div className="bill-item-meta">
                                    <FaRupeeSign className="text-success" />
                                    {i.price}/{unit} · GST {Number(i.gst || 0).toFixed(0)}%
                                  </div>
                                </td>
                                <td className="bill-item-qty">
                                  <div className="pos-qty-row">
                                    <button
                                      className="qty-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        cancelDelete();
                                        decreaseQty(i);
                                      }}
                                      aria-label="Decrease quantity"
                                    >
                                      <FaMinus />
                                    </button>
                                    <span className="qty-display">{formatQty(qty, unit)}</span>
                                    <button
                                      className="qty-btn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        cancelDelete();
                                        if (unit === "kg") addWeightedItem(i, 0.25);
                                        else addUnitItem(i, 1);
                                      }}
                                      aria-label="Increase quantity"
                                    >
                                      <FaPlus />
                                    </button>
                                  </div>
                                  <div className="bill-item-unit">{unit}</div>
                                </td>
                                <td className="bill-item-amount">
                                  <span className="bill-item-amount-main">
                                    <FaRupeeSign />
                                    {lineSubtotal.toFixed(2)}
                                  </span>
                                  <div className="bill-item-meta">+GST ₹{lineGst.toFixed(2)}</div>
                                </td>
                                <td className="bill-item-actions">
                                  <button
                                    type="button"
                                    className={`bill-item-discount${
                                      i.lineDiscount && Number(i.lineDiscount.value) > 0
                                        ? " is-active"
                                        : ""
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      cancelDelete();
                                      setExpandedLineId(expandedLineId === i.id ? null : i.id);
                                    }}
                                    aria-label={
                                      i.lineDiscount && Number(i.lineDiscount.value) > 0
                                        ? `Line discount ${i.lineDiscount.value}${i.lineDiscount.type === "percent" ? "%" : " ₹"} on ${i.name} — click to change`
                                        : `Add discount on ${i.name}`
                                    }
                                    title={
                                      i.lineDiscount && Number(i.lineDiscount.value) > 0
                                        ? `Discount: ${i.lineDiscount.type === "percent" ? i.lineDiscount.value + "%" : "₹" + i.lineDiscount.value}`
                                        : "Add discount"
                                    }
                                  >
                                    <FaPercent />
                                  </button>
                                  <button
                                    type="button"
                                    className={`bill-item-delete${isConfirming ? " is-active" : ""}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (isConfirming) {
                                        confirmDelete(i);
                                      } else {
                                        requestDelete(i);
                                      }
                                    }}
                                    aria-label={
                                      isConfirming
                                        ? `Click the row, or this button again, to remove ${i.name}`
                                        : `Remove ${i.name}`
                                    }
                                    aria-pressed={isConfirming}
                                    title={
                                      isConfirming
                                        ? `Click again or click anywhere on the row to remove ${i.name}`
                                        : `Remove ${i.name}`
                                    }
                                  >
                                    <FaTrash />
                                  </button>
                                </td>
                              </tr>
                              {expandedLineId === i.id && (
                                <tr
                                  key={`${i.id}-discount`}
                                  className="bill-item-discount-row"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <td colSpan={4}>
                                    <div className="bill-item-discount-panel">
                                      <span className="bill-item-discount-label">
                                        Line discount:
                                      </span>
                                      {[
                                        { type: "percent", value: 5 },
                                        { type: "percent", value: 10 },
                                        { type: "percent", value: 20 },
                                      ].map((d) => (
                                        <button
                                          key={`p${d.value}`}
                                          type="button"
                                          className={`bill-item-discount-chip${
                                            i.lineDiscount &&
                                            i.lineDiscount.type === d.type &&
                                            Number(i.lineDiscount.value) === d.value
                                              ? " is-active"
                                              : ""
                                          }`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setLineDiscount(i.id, d);
                                          }}
                                        >
                                          {d.value}%
                                        </button>
                                      ))}
                                      <button
                                        type="button"
                                        className={`bill-item-discount-chip${
                                          i.lineDiscount && i.lineDiscount.type === "flat"
                                            ? " is-active"
                                            : ""
                                        }`}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setLineDiscount(i.id, {
                                            type: "flat",
                                            value: Math.round(i.price * getItemQty(i) * 0.1),
                                          });
                                        }}
                                        title="Apply a flat 10% discount on this line"
                                      >
                                        Flat 10%
                                      </button>
                                      <input
                                        type="number"
                                        min="0"
                                        step="1"
                                        placeholder="Flat ₹"
                                        className="bill-item-discount-flat-input"
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => {
                                          const v = Number(e.target.value);
                                          if (!v || v <= 0) {
                                            setLineDiscount(i.id, null);
                                            return;
                                          }
                                          setLineDiscount(i.id, { type: "flat", value: v });
                                        }}
                                        value={
                                          i.lineDiscount && i.lineDiscount.type === "flat"
                                            ? i.lineDiscount.value
                                            : ""
                                        }
                                      />
                                      <button
                                        type="button"
                                        className="bill-item-discount-clear"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setLineDiscount(i.id, null);
                                          setExpandedLineId(null);
                                        }}
                                      >
                                        <FaTimes /> Clear
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Side rail: customer + totals + payment + actions */}
              <aside className="bill-summary-side">
                {/* Customer Details — shifted from store settings */}
                <div className="bill-customer-card">
                  <div className="bill-customer-head">
                    <span className="bill-customer-icon">
                      <FaUser />
                    </span>
                    <div>
                      <h6>Customer Details</h6>
                      <p>For this bill & invoice</p>
                    </div>
                  </div>

                  {/* Customer attach — search existing customer record. Shows
                      a dropdown of name matches; clicking one populates
                      name+phone and stores customerId on the bill. Walking
                      customers still work via the free-text fields below. */}
                  <div className="bill-customer-field">
                    <FaUserTie className="bill-customer-field-ico" />
                    <input
                      type="search"
                      className="bill-customer-input"
                      placeholder="Search existing customer…"
                      value={customerSearch}
                      onChange={(e) => {
                        setCustomerSearch(e.target.value);
                        setCustomerSearchOpen(true);
                      }}
                      onFocus={() => setCustomerSearchOpen(true)}
                      onBlur={() => setTimeout(() => setCustomerSearchOpen(false), 200)}
                      aria-label="Search existing customer"
                      autoComplete="off"
                    />
                  </div>
                  {customerSearchOpen && customerMatches.length > 0 && (
                    <ul className="bill-customer-matches" role="listbox">
                      {customerMatches.map((c) => (
                        <li
                          key={c.id}
                          role="option"
                          aria-selected="false"
                          tabIndex={0}
                          onMouseDown={(e) => {
                            // onMouseDown (not onClick) so it fires before
                            // the input's onBlur closes the dropdown.
                            e.preventDefault();
                            attachCustomer(c);
                          }}
                        >
                          <strong>{c.name}</strong>
                          {c.phone && <span className="bill-customer-match-meta">{c.phone}</span>}
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Attached-customer chip — clears the attachment without
                      wiping the typed name/phone below. */}
                  {activeBill.customerId && (
                    <div className="bill-customer-chip" role="status">
                      <FaUserTie />
                      <span>
                        Attached: <strong>{activeBill.customerName}</strong>
                      </span>
                      <button
                        type="button"
                        className="bill-customer-chip-clear"
                        onClick={detachCustomer}
                        aria-label="Clear attached customer"
                        title="Detach customer record (keep typed name/phone)"
                      >
                        <FaTimes />
                      </button>
                    </div>
                  )}

                  <div className="bill-customer-field">
                    <FaUser className="bill-customer-field-ico" />
                    <input
                      type="text"
                      className="bill-customer-input"
                      placeholder="Customer name"
                      value={activeBill.customerName || ""}
                      onChange={(e) =>
                        setBills((prev) => ({
                          ...prev,
                          [activeBillId]: {
                            ...prev[activeBillId],
                            customerName: e.target.value,
                          },
                        }))
                      }
                      maxLength={50}
                      aria-label="Customer name"
                    />
                  </div>
                  <div className="bill-customer-field">
                    <FaPhoneAlt className="bill-customer-field-ico" />
                    <input
                      type="tel"
                      className="bill-customer-input"
                      placeholder="WhatsApp / mobile number"
                      value={activeBill.customerPhone || ""}
                      onChange={(e) =>
                        setBills((prev) => ({
                          ...prev,
                          [activeBillId]: {
                            ...prev[activeBillId],
                            customerPhone: e.target.value.replace(/\D/g, "").slice(0, 15),
                          },
                        }))
                      }
                      maxLength={15}
                      aria-label="Customer WhatsApp number"
                    />
                  </div>
                </div>

                <div className="bill-totals">
                  <div className="bill-total-row">
                    <span className="bill-total-label">Subtotal</span>
                    <span className="bill-total-value">
                      <FaRupeeSign className="text-success" />
                      {subTotal.toFixed(2)}
                    </span>
                  </div>

                  {/* Bill-level discount */}
                  <div className="bill-total-row bill-discount-row">
                    <span className="bill-total-label">
                      <FaPercent /> Bill discount
                    </span>
                    <span className="bill-total-value bill-discount-controls">
                      <button
                        type="button"
                        className={`bill-discount-chip${
                          activeBill.discount &&
                          activeBill.discount.type === "percent" &&
                          Number(activeBill.discount.value) === 5
                            ? " is-active"
                            : ""
                        }`}
                        onClick={() =>
                          setBillDiscount(
                            activeBill.discount &&
                              activeBill.discount.type === "percent" &&
                              Number(activeBill.discount.value) === 5
                              ? null
                              : { type: "percent", value: 5 }
                          )
                        }
                      >
                        5%
                      </button>
                      <button
                        type="button"
                        className={`bill-discount-chip${
                          activeBill.discount &&
                          activeBill.discount.type === "percent" &&
                          Number(activeBill.discount.value) === 10
                            ? " is-active"
                            : ""
                        }`}
                        onClick={() =>
                          setBillDiscount(
                            activeBill.discount &&
                              activeBill.discount.type === "percent" &&
                              Number(activeBill.discount.value) === 10
                              ? null
                              : { type: "percent", value: 10 }
                          )
                        }
                      >
                        10%
                      </button>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="Flat ₹"
                        className="bill-discount-flat-input"
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!v || v <= 0) {
                            setBillDiscount(null);
                            return;
                          }
                          setBillDiscount({ type: "flat", value: v });
                        }}
                        value={
                          activeBill.discount && activeBill.discount.type === "flat"
                            ? activeBill.discount.value
                            : ""
                        }
                      />
                      {totalSavings > 0 && (
                        <span className="bill-discount-saved" title="Total saved by discounts">
                          −₹{totalSavings.toFixed(2)}
                        </span>
                      )}
                    </span>
                  </div>

                  <div className="bill-total-row">
                    <span className="bill-total-label">GST</span>
                    <span className="bill-total-value">
                      <FaRupeeSign className="text-success" />
                      {gstTotal.toFixed(2)}
                    </span>
                  </div>
                  <div className="bill-total-row bill-grand-total">
                    <span className="bill-total-label">Grand Total</span>
                    <span className="bill-total-value">
                      <FaRupeeSign />
                      {grandTotal.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="pos-payment-pills" role="radiogroup" aria-label="Payment method">
                  {["Cash", "UPI", "Card", "Split"].map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      role="radio"
                      aria-checked={activeBill.paymentMode === mode}
                      className={`pos-payment-pill${
                        activeBill.paymentMode === mode ? " active" : ""
                      }`}
                      onClick={() =>
                        setBills((prev) => {
                          const bill = prev[activeBillId] || newEmptyBill();
                          // Switching into Split seeds payments with empty rows so the
                          // editor appears immediately. Switching away clears them.
                          let payments = bill.payments;
                          if (mode === "Split" && (!payments || payments.length === 0)) {
                            payments = [
                              { mode: "Cash", amount: 0 },
                              { mode: "UPI", amount: 0 },
                              { mode: "Card", amount: 0 },
                            ];
                          } else if (mode !== "Split") {
                            payments = [];
                          }
                          return {
                            ...prev,
                            [activeBillId]: { ...bill, paymentMode: mode, payments },
                          };
                        })
                      }
                    >
                      {mode}
                    </button>
                  ))}
                </div>

                {activeBill.paymentMode === "Split" && (
                  <div className="pos-split-editor" role="group" aria-label="Split payment amounts">
                    {(activeBill.payments || []).map((p, idx) => (
                      <div key={p.mode} className="pos-split-row">
                        <span className="pos-split-label">{p.mode}</span>
                        <span className="pos-split-currency">
                          <FaRupeeSign />
                        </span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          inputMode="decimal"
                          placeholder="0.00"
                          className="pos-split-input"
                          aria-label={`${p.mode} amount`}
                          value={p.amount || ""}
                          onChange={(e) => {
                            const v = Number(e.target.value) || 0;
                            setBills((prev) => {
                              const bill = prev[activeBillId];
                              if (!bill) return prev;
                              const nextPayments = (bill.payments || []).map((pp, i) =>
                                i === idx ? { ...pp, amount: v } : pp
                              );
                              return {
                                ...prev,
                                [activeBillId]: { ...bill, payments: nextPayments },
                              };
                            });
                          }}
                        />
                      </div>
                    ))}
                    <div className="pos-split-summary">
                      <div className="pos-split-summary-row">
                        <span>Tendered</span>
                        <span>
                          <FaRupeeSign />
                          {tendered.toFixed(2)}
                        </span>
                      </div>
                      <div className="pos-split-summary-row">
                        <span>Grand Total</span>
                        <span>
                          <FaRupeeSign />
                          {grandTotal.toFixed(2)}
                        </span>
                      </div>
                      <div className="pos-split-summary-row pos-split-change">
                        <span>Change Due</span>
                        <span>
                          <FaRupeeSign />
                          {changeDue.toFixed(2)}
                        </span>
                      </div>
                      {tendered < grandTotal && grandTotal > 0 && (
                        <div className="pos-split-warning" role="alert">
                          Tendered is short by ₹{(grandTotal - tendered).toFixed(2)}.
                        </div>
                      )}
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary pos-split-autofill"
                        onClick={() => {
                          // Fill the remaining gap into Cash (most common overpay scenario).
                          const remaining = Math.max(0, grandTotal - tendered);
                          setBills((prev) => {
                            const bill = prev[activeBillId];
                            if (!bill) return prev;
                            const nextPayments = (bill.payments || []).map((pp, i) =>
                              i === 0 ? { ...pp, amount: Number(pp.amount || 0) + remaining } : pp
                            );
                            return {
                              ...prev,
                              [activeBillId]: { ...bill, payments: nextPayments },
                            };
                          });
                        }}
                      >
                        Auto-fill Cash with ₹{Math.max(0, grandTotal - tendered).toFixed(2)}
                      </button>
                    </div>
                  </div>
                )}

                <div className="pos-footer-btns">
                  <button type="button" className="btn btn-success" onClick={generateInvoice}>
                    <FaWhatsapp /> Generate Invoice & WhatsApp
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => holdBill(activeBillId)}
                    disabled={(activeBill.items || []).length === 0}
                    title="Park this bill so you can recall it later (refresh-safe)"
                  >
                    <FaPause /> Hold Bill
                  </button>
                  <button
                    type="button"
                    className="btn btn-dark"
                    onClick={() => setHeldDrawerOpen(true)}
                  >
                    <FaBookmark /> Held Bills ({heldBills.length})
                  </button>
                  <button
                    type="button"
                    className="btn btn-dark"
                    onClick={() => printESC_POS(lastInvoice)}
                  >
                    <FaPrint /> Bluetooth Print (ESC/POS)
                  </button>
                </div>
              </aside>
            </div>
          </div>
        </div>

        <div style={{ display: "none" }}>
          <div ref={receiptRef}>
            <ThermalReceipt invoice={lastInvoice} />
          </div>
        </div>

        {paymentDialog && (
          <PaymentDialog
            open={paymentDialog.open}
            amount={paymentDialog.amount}
            method={paymentDialog.method}
            invoiceNo={paymentDialog.invoiceNo}
            note={paymentDialog.note}
            onComplete={async () => {
              // Payment confirmed (via QR scan, simulate, or manual mark).
              // Run the atomic checkout now. The dialog already wrote the
              // intent to /api/payment_intents for audit; close it first
              // so the modal goes away while we save the invoice.
              setPaymentDialog(null);
              const pending = pendingInvoiceRef.current;
              pendingInvoiceRef.current = null;
              if (!pending) return;
              await persistInvoiceAfterCheckout(pending);
            }}
            onClose={() => {
              // Cashier closed/cancelled — drop the pending invoice and
              // don't run the atomic save, leaving stock untouched.
              setPaymentDialog(null);
              pendingInvoiceRef.current = null;
            }}
          />
        )}

        {shiftDialogOpen && (
          <OpenShiftDialog
            open={shiftDialogOpen}
            title="Open a shift before recording a cash sale"
            message={
              <>
                A shift must be open before this POS can record a <em>sale</em> cash movement. Count
                the bills currently in the drawer and enter the total — that becomes your opening
                float. You can close the drawer at end-of-day on the <em>Shifts &amp; Cash</em>{" "}
                page.
              </>
            }
            onOpened={() => {
              // The cashier just opened a shift. Resume the saved
              // invoice and run the atomic checkout.
              setShiftDialogOpen(false);
              refreshActiveShift();
              const pending = pendingInvoiceRef.current;
              pendingInvoiceRef.current = null;
              if (!pending) return;
              persistInvoiceAfterCheckout(pending);
            }}
            onClose={() => {
              // Cashier cancelled — drop the pending invoice, no
              // atomic save, no stock decrement.
              setShiftDialogOpen(false);
              pendingInvoiceRef.current = null;
            }}
          />
        )}

        {closeShiftDialogOpen && activeShift && (
          <CloseShiftDialog
            open={closeShiftDialogOpen}
            shift={activeShift}
            onClose={() => setCloseShiftDialogOpen(false)}
            onClosed={() => {
              setCloseShiftDialogOpen(false);
              refreshActiveShift();
            }}
            title="Close my shift"
          />
        )}

        {heldDrawerOpen && (
          <>
            <div
              className="pos-drawer-backdrop"
              onClick={() => setHeldDrawerOpen(false)}
              aria-hidden="true"
            />
            <aside className="pos-drawer" role="dialog" aria-label="Held bills" aria-modal="true">
              <header className="pos-drawer-header">
                <h5>
                  <FaBookmark /> Held Bills
                </h5>
                <button
                  type="button"
                  className="pos-drawer-close"
                  onClick={() => setHeldDrawerOpen(false)}
                  aria-label="Close held bills drawer"
                >
                  <FaTimes />
                </button>
              </header>
              <div className="pos-drawer-body">
                {heldBills.length === 0 ? (
                  <p className="pos-drawer-empty">
                    No held bills. Click <strong>Hold Bill</strong> on the active tab to park it for
                    later.
                  </p>
                ) : (
                  <ul className="pos-drawer-list">
                    {heldBills.map((h) => {
                      const itemCount = (h.items || []).length;
                      const heldAgo = humanizeAgo(Date.now() - (h.heldAt || 0));
                      const lineDiscountCount = (h.items || []).filter(
                        (it) => it.lineDiscount && Number(it.lineDiscount.value) > 0
                      ).length;
                      return (
                        <li key={h.id} className="pos-drawer-item">
                          <div className="pos-drawer-item-head">
                            <strong>{h.id}</strong>
                            <span className="pos-drawer-item-meta">
                              {heldAgo} · {itemCount} item{itemCount === 1 ? "" : "s"}
                            </span>
                          </div>
                          <div className="pos-drawer-item-meta">
                            {h.customerName ? `Customer: ${h.customerName}` : "Walking customer"}
                            {lineDiscountCount > 0 &&
                              ` · ${lineDiscountCount} discount${lineDiscountCount === 1 ? "" : "s"}`}
                            {h.paymentMode === "Split" && " · Split payment"}
                          </div>
                          <div className="pos-drawer-item-actions">
                            <button
                              type="button"
                              className="btn btn-sm btn-success"
                              onClick={() => recallBill(h.id)}
                            >
                              <FaPlay /> Recall
                            </button>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => discardHeldBill(h.id)}
                            >
                              <FaTrash /> Discard
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </aside>
          </>
        )}
      </div>
    </div>
  );
};

export default POSBilling;
