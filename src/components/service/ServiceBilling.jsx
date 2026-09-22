import React, { useState, useRef, useEffect, useMemo } from "react";
import { saveInvoice } from "../../services/invoiceService";
import {
  FaRupeeSign,
  FaUser,
  FaPhone,
  FaEnvelope,
  FaMapMarkerAlt,
  FaIdBadge,
  FaFlag,
  FaUserTie,
  FaHashtag,
  FaRegCalendarAlt,
  FaStickyNote,
  FaPlus,
  FaTrash,
  FaUndo,
  FaFileInvoice,
  FaBluetooth,
  FaShoppingCart,
  FaCalculator,
  FaSearch,
  FaPercent,
  FaTimes,
  FaConciergeBell,
  FaLayerGroup,
  FaChevronDown,
  FaChevronUp,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useUi } from "../../context/UiContext";
import { printESC_POS } from "../../utils/bluetoothEscpos";
import { getStoreSettings } from "../../services/storeSettingsService";
import { loadServices } from "../../services/serviceService";
import { CATEGORY_TONES, formatCurrency, initialsFromName } from "../../utils/serviceTones";
import {
  calculateServiceTotals,
  getServiceLine,
  clampPercent,
} from "../../utils/serviceInvoiceMath";
import { recordCashSaleForShift, currentStoreNeedsShift } from "../../services/shiftService";
import OpenShiftDialog from "../shift/OpenShiftDialog";
import ShiftStatusBanner from "../shift/ShiftStatusBanner";
import CloseShiftDialog from "../shift/CloseShiftDialog";
import { useShiftGate } from "../../hooks/useShiftGate";
import {
  INDUSTRIES,
  DEFAULT_INDUSTRY_ID,
  DEFAULT_TEMPLATE_ID,
  emptyFieldsFor,
  fieldConfigFor,
  industryById,
  templateById,
} from "./templates";
import IndustryTemplateModal from "./IndustryTemplateModal";
import "../pos/POSBilling.css";
import "./ServiceBilling.css";

const ServiceBilling = () => {
  const navigate = useNavigate();
  const { showToast } = useUi();
  const [hydrated, setHydrated] = useState(false);
  const settings = getStoreSettings();

  // Mandatory shift gate: Branch Admin / Cashier must open a shift before
  // they can take cash sales in a cash-vertical store. SUPER_OWNER / ADMIN
  // bypass the gate. Hook also handles polling + auth events so the chip
  // stays in sync across tabs / sessions.
  const { activeShift, openShiftDialog, refreshActiveShift, useMandatoryShiftDialogProps } =
    useShiftGate();
  // Close-shift dialog state. The cashier (or any other user who owns
  // an active shift in this store) can close it directly from the
  // billing page — see ShiftStatusBanner's onClose handler below.
  const [closeShiftDialogOpen, setCloseShiftDialogOpen] = useState(false);

  // Compute the dialog props once per render and BEFORE any early return,
  // so React's rules-of-hooks are not violated by the `if (!hydrated)` short-
  // circuit below.
  const mandatoryShiftDialogProps = useMandatoryShiftDialogProps();

  // Holds the save payload when the OpenShiftDialog interrupted us.
  // Same pattern as POSBilling — we re-run the save after the shift opens.
  const pendingInvoiceRef = useRef(null);

  const [billCounter, setBillCounter] = useState(101);
  const newBillShape = {
    items: [],
    paymentMode: "Cash",
    customer: "",
    phone: "",
    email: "",
    address: "",
    gst: "",
    state: "",
    technician: "",
    jobRef: "",
    serviceFrom: "",
    serviceTo: "",
    remarks: "",
    discountPct: "",
    // Bill-level manual GST percentage. The cashier types this in once
    // and it drives every line on the bill. There is intentionally no
    // default here — leaving it blank means 0% (cashier may generate
    // exempt / non-tax bills without typing anything).
    gstRate: "",
    // Industry template picker — picked per-bill so the cashier can switch
    // industries mid-session (multi-business consultant). The renderer
    // looks up `templateId` to pick ModernA4 / TraditionalA4 /
    // CondensedReceipt; `fields` rides on `items[0].meta` along with the
    // customer block so legacy public-share renderers stay compatible.
    industry: "",
    templateId: "",
    fields: {},
  };
  const [bills, setBills] = useState(() => {
    const seedIndustry = settings.serviceDefaultIndustry || DEFAULT_INDUSTRY_ID;
    // Whether the admin has locked the template choice, every new bill
    // starts on the default industry. The map returns undefined for a
    // bogus store-level setting, in which case we fall back to the
    // system default rather than rendering an unknown template.
    const seedTemplateId = templateById(`${seedIndustry}-modern`)?.id || DEFAULT_TEMPLATE_ID;
    return {
      "Bill-101": {
        ...newBillShape,
        industry: seedIndustry,
        templateId: seedTemplateId,
        fields: emptyFieldsFor(seedIndustry),
      },
    };
  });
  const [activeBillId, setActiveBillId] = useState("Bill-101");
  const activeBill = bills[activeBillId] || { items: [], paymentMode: "Cash" };

  const [products, setProducts] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [lastInvoice, setLastInvoice] = useState(null);

  const [undoItem, setUndoItem] = useState(null);
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);
  // Industry picker modal — opens on chip click. Industry selection
  // persists per-bill so a multi-business cashier can flip between
  // templates mid-session. `industrySearch` is the local search
  // input (resets to "" on close). `triggerRef` captures the element
  // that opened the modal so we can return focus to it on close —
  // standard accessible dialog pattern.
  const [industryDrawerOpen, setIndustryDrawerOpen] = useState(false);
  const [industrySearch, setIndustrySearch] = useState("");
  const triggerRef = useRef(null);
  const searchInputRef = useRef(null);
  const undoTimerRef = useRef(null);

  const activeIndustryId = activeBill.industry || DEFAULT_INDUSTRY_ID;
  const activeIndustry = INDUSTRIES.find((i) => i.id === activeIndustryId) || INDUSTRIES[0];
  const activeFieldConfig = fieldConfigFor(activeIndustryId);
  const industryFieldCount = activeFieldConfig.length;
  const filledFieldCount = Object.values(activeBill.fields || {}).filter(Boolean).length;

  const selectIndustry = (industryId) => {
    // F9: Store-template-lock enforcement. When the admin has turned
    // on `serviceLockTemplateId` in Store Settings, every bill sticks
    // to the store's default industry + the matching renderer family.
    // This is the runtime enforcement leg — without it, the lock is a
    // UI label only and a cashier can bypass it via the industry
    // picker. We still let `updateIndustryField` run so a locked store
    // can still type into the per-industry fields.
    if (settings.serviceLockTemplateId) {
      const lockedIndustry = settings.serviceDefaultIndustry || activeBill.industry;
      if (lockedIndustry && lockedIndustry !== DEFAULT_INDUSTRY_ID) {
        showToast("info", "Template lock is on — only the fields can be edited.");
      } else {
        showToast("info", "Template lock is on in Store Settings.");
      }
      return;
    }
    const tplId = `${industryId}-modern`;
    const tpl = templateById(tplId) ? tplId : DEFAULT_TEMPLATE_ID;
    updateActiveBill({
      industry: industryId,
      templateId: tpl,
      fields: emptyFieldsFor(industryId),
    });
  };

  // F9: a bill is "fresh" when the cashier hasn't typed anything yet —
  // no items, no customer, no service dates, no remarks, no
  // industry-specific fields. When fresh, the first product tapped
  // auto-seeds the bill's industry + default template + GST%. Once
  // any user input is present, the spec says explicitly "do not
  // silently overwrite user-entered invoice data when another product
  // is selected", so subsequent taps leave the bill alone and the
  // cashier uses the industry picker to change template.
  const isFreshBill = (bill) => {
    if (!bill) return true;
    if (Array.isArray(bill.items) && bill.items.length > 0) return false;
    if (bill.customer || bill.phone || bill.email || bill.address || bill.gst || bill.state)
      return false;
    if (bill.technician || bill.jobRef || bill.serviceFrom || bill.serviceTo || bill.remarks)
      return false;
    if (bill.gstRate !== "" && bill.gstRate !== undefined && bill.gstRate !== null) return false;
    if (bill.discountPct !== "" && bill.discountPct !== undefined && bill.discountPct !== null)
      return false;
    const fields = bill.fields && typeof bill.fields === "object" ? bill.fields : {};
    for (const v of Object.values(fields)) {
      if (v) return false;
    }
    return true;
  };

  const updateIndustryField = (key, value) => {
    const next = { ...(activeBill.fields || {}), [key]: value };
    updateActiveBill({ fields: next });
  };

  useEffect(() => {
    let cancelled = false;
    const loadStoredProducts = async () => {
      const services = await loadServices();
      if (cancelled) return;
      const storedProducts = Array.isArray(services)
        ? services.map((product) => ({
            ...product,
            price: product.price ?? product.rate ?? 0,
            gst: Number(product.gst || 0),
            category: product.category || "Other",
          }))
        : [];
      setProducts(storedProducts);
      setHydrated(true);
    };
    loadStoredProducts();
    const onServicesUpdated = () => loadStoredProducts();
    window.addEventListener("servicesUpdated", onServicesUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("servicesUpdated", onServicesUpdated);
    };
  }, []);

  const filteredProducts = useMemo(
    () => products.filter((p) => (p.name || "").toLowerCase().includes(searchText.toLowerCase())),
    [products, searchText]
  );

  const toggleItem = (product) => {
    setBills((prev) => {
      const cur = prev[activeBillId] || { items: [], paymentMode: "Cash" };
      const exists = cur.items.some((i) => i.id === product.id);
      const items = exists
        ? cur.items.filter((i) => i.id !== product.id)
        : [
            ...cur.items,
            {
              ...product,
              price: Number(product.price || product.rate || 0),
              // gst intentionally omitted — the bill-level gstRate is the
              // single source of truth for the Service Store. The product
              // catalog's default GST must never seed the bill.
            },
          ];
      // F9: auto-seed the bill from the product's industry template
      // mapping ONLY on the first tap of a truly fresh bill. The
      // existing `serviceLockTemplateId` setting is honored — a
      // locked store always uses its default industry and ignores
      // the product's own defaultTemplateId. The same "fresh bill"
      // guard applies to the GST% suggestion so we don't override a
      // cashier who has already typed a rate.
      let next = { ...cur, items };
      const fresh = !exists && isFreshBill(cur);
      const productIndustry = product.industry;
      const productTemplate = product.defaultTemplateId
        ? templateById(product.defaultTemplateId)
        : null;
      const productIndustryMeta = productIndustry ? industryById(productIndustry) : null;
      const lockOn = !!settings.serviceLockTemplateId;
      if (fresh && !lockOn && productIndustry && productIndustryMeta) {
        // Resolve the renderer family. Prefer the product's
        // defaultTemplateId when it still matches an existing template
        // in the registry; otherwise fall back to the canonical
        // `<industry>-modern` family so the bill always has a valid
        // templateId, no stale registry id ever leaks through.
        const fallbackTplId = `${productIndustry}-modern`;
        const tplId =
          productTemplate && productTemplate.industry === productIndustry
            ? productTemplate.id
            : templateById(fallbackTplId)
              ? fallbackTplId
              : DEFAULT_TEMPLATE_ID;
        // F10: pre-fill the per-industry fields drawer with the service's
        // saved defaults (the cashier typed these once on the catalog
        // form). Merge order — registry defaults < saved service
        // defaults < cashier-typed bill values — so the cashier's
        // in-bill edits still win. The product's `fieldValues` shape
        // is `{ [key]: string }` so spread is safe; undefined is
        // treated as empty (legacy services from before F10).
        const savedFields =
          product.fieldValues && typeof product.fieldValues === "object" ? product.fieldValues : {};
        const allowedKeys = new Set(fieldConfigFor(productIndustry).map((f) => f.key));
        const cleanedSaved = {};
        for (const [k, v] of Object.entries(savedFields)) {
          if (allowedKeys.has(k) && v != null && String(v).trim() !== "") {
            cleanedSaved[k] = v;
          }
        }
        const mergedFields = {
          ...emptyFieldsFor(productIndustry),
          ...cleanedSaved,
          ...(cur.fields && typeof cur.fields === "object" ? cur.fields : {}),
        };
        next = {
          ...next,
          industry: productIndustry,
          templateId: tplId,
          fields: mergedFields,
        };
      }
      if (fresh && product.gst !== undefined && product.gst !== null && product.gst !== "") {
        next = { ...next, gstRate: product.gst };
      }
      return { ...prev, [activeBillId]: next };
    });
  };

  const removeItem = (item) => {
    setBills((prev) => {
      const cur = prev[activeBillId];
      return {
        ...prev,
        [activeBillId]: {
          ...cur,
          items: cur.items.filter((i) => i.id !== item.id),
        },
      };
    });
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndoItem(item);
    undoTimerRef.current = setTimeout(() => setUndoItem(null), 5000);
  };

  const handleUndo = () => {
    if (!undoItem) return;
    setBills((prev) => {
      const cur = prev[activeBillId];
      return {
        ...prev,
        [activeBillId]: {
          ...cur,
          items: [...cur.items, undoItem],
        },
      };
    });
    setUndoItem(null);
  };

  const updateActiveBill = (patch) => {
    setBills((prev) => ({
      ...prev,
      [activeBillId]: { ...(prev[activeBillId] || {}), ...patch },
    }));
  };

  const clearBill = () => {
    if (!window.confirm("Clear all items from this bill?")) return;
    updateActiveBill({
      items: [],
      discountPct: "",
    });
    setUndoItem(null);
  };

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

  const newBill = () => {
    const newId = `Bill-${billCounter + 1}`;
    const defaultIndustry = settings.serviceDefaultIndustry || DEFAULT_INDUSTRY_ID;
    const defaultTemplateId = `${defaultIndustry}-modern`;
    setBills((prev) => ({
      ...prev,
      [newId]: {
        ...newBillShape,
        industry: defaultIndustry,
        templateId: templateById(defaultTemplateId) ? defaultTemplateId : DEFAULT_TEMPLATE_ID,
        fields: emptyFieldsFor(defaultIndustry),
      },
    }));
    setBillCounter((c) => c + 1);
    setActiveBillId(newId);
  };

  // One calculation contract drives the live bill, generated payload, and
  // printed/public invoice. This prevents service hours from disappearing
  // in the billing subtotal while appearing in the printed line table.
  const billGstRate = clampPercent(activeBill.gstRate);
  const discountPct = clampPercent(activeBill.discountPct);
  const serviceTotals = useMemo(
    () => calculateServiceTotals(activeBill.items, billGstRate, discountPct),
    [activeBill.items, billGstRate, discountPct]
  );
  const isInterState = Boolean(
    activeBill.state &&
    settings.state &&
    activeBill.state.trim().toLowerCase() !== settings.state.trim().toLowerCase()
  );
  const { subTotal, gstTotal, discountAmt, grandTotal } = serviceTotals;
  const cgstAmount = Math.round((gstTotal / 2 + Number.EPSILON) * 100) / 100;
  const sgstAmount = Math.round((gstTotal - cgstAmount + Number.EPSILON) * 100) / 100; // keeps split sum exact
  const serviceLines = serviceTotals.lines;

  const cartCount = activeBill.items.length;
  const openBillCount = Object.keys(bills).length;

  const generateInvoice = async () => {
    if (activeBill.items.length === 0) return alert("Add services first!");
    if (!activeBill.customer || !activeBill.customer.trim()) {
      return alert("Please enter the customer name before generating the invoice.");
    }

    // Mandatory-shift gate: for cash sales in a cash-vertical store, the
    // cashier must have an open shift. The hook (useShiftGate) drives
    // the auto-pop on first load; this guard short-circuits the save if
    // the store type doesn't run a drawer at all. Every cash vertical in
    // CASH_STORE_TYPES (retail | hotel | laundry | service | msme-service
    // | inventory) flows through the same gate — there is intentionally
    // no per-store bypass here.
    const shiftGateApplies = activeBill.paymentMode === "Cash" && currentStoreNeedsShift();
    if (shiftGateApplies) {
      const shift = await refreshActiveShift();
      if (!shift) {
        pendingInvoiceRef.current = { kind: "service" };
        openShiftDialog();
        return;
      }
    }

    const prefix = (settings.serviceInvoicePrefix || "SI").trim() || "SI";
    const year = new Date().getFullYear();
    const invoiceNo = `${prefix}${year}-${String(Date.now()).slice(-6)}`;

    // Customer identity captured at billing time. The `items[0].meta`
    // mirror is intentional: the DB's `invoices` table only persists
    // customer_name + customer_mobile as top-level columns today, so every
    // other customer field (email, address, GSTIN, state) is round-tripped
    // through the JSON `items` column on the first line's meta block. The
    // ServiceInvoice renderer reads the top-level camelCase keys first and
    // falls back to items[0].meta so a row saved before the schema gains
    // extra columns still renders correctly when reprinted / shared via the
    // public link.
    const customerMeta = {
      guest: activeBill.customer || "",
      customerPhone: activeBill.phone || "",
      customerMobile: activeBill.phone || "",
      customerEmail: activeBill.email || "",
      customerAddress: activeBill.address || "",
      customerGst: activeBill.gst || "",
      customerState: activeBill.state || "",
      technician: activeBill.technician || "",
      jobRef: activeBill.jobRef || "",
      serviceFrom: activeBill.serviceFrom || "",
      serviceTo: activeBill.serviceTo || "",
      remarks: activeBill.remarks || "",
      gstRate: billGstRate,
      discountPct,
      discountAmt,
      // Industry template picker — persisted both on items[0].meta (legacy
      // path used by PublicInvoiceView) and top-level (renderer path used
      // by InvoiceView). The two reads in the renderer templates treat
      // top-level as the source of truth but fall back to meta so old rows
      // continue to render correctly when they are reopened / reshared.
      industry: activeBill.industry || DEFAULT_INDUSTRY_ID,
      templateId: activeBill.templateId || DEFAULT_TEMPLATE_ID,
      fields: activeBill.fields || {},
    };
    const itemsWithCustomerMeta = activeBill.items.map((item, idx) => {
      const normalized = serviceLines[idx] || getServiceLine(item, idx, billGstRate);
      return {
        ...item,
        // Persist normalized service fields in the existing JSON snapshot so
        // public/legacy renderers can recover the exact billed quantities.
        hours: normalized.units,
        rate: normalized.rate,
        price: normalized.rate,
        lineTotal: normalized.taxableAmount,
        gst: billGstRate,
        meta: idx === 0 ? { ...(item.meta || {}), ...customerMeta } : item.meta,
      };
    });

    const invoice = {
      invoiceNo,
      date: new Date().toISOString().split("T")[0],
      items: itemsWithCustomerMeta,
      subTotal,
      gstTotal,
      // Bill-level GST rate is the single source of truth for service
      // invoices. ServiceInvoice reads this first; if absent (legacy row),
      // it derives the rate from gstTotal / subTotal so reprints stay
      // numerically consistent.
      gstRate: billGstRate,
      discountPct,
      discountAmt,
      discount: { type: "percent", value: discountPct },
      discountBreakdown: {
        bill: discountAmt,
        taxableAmount: Math.max(0, subTotal - discountAmt),
      },
      grandTotal,
      paymentMode: activeBill.paymentMode,
      // Lifecycle: new service invoices start as PENDING; cleared from the Invoice view.
      status: "pending",
      // Customer + service meta — captured at billing time, not from store settings
      customer: activeBill.customer,
      customerName: activeBill.customer,
      customerPhone: activeBill.phone,
      customerMobile: activeBill.phone,
      customerEmail: activeBill.email,
      customerAddress: activeBill.address,
      customerGst: activeBill.gst,
      customerState: activeBill.state,
      technician: activeBill.technician,
      jobRef: activeBill.jobRef,
      serviceFrom: activeBill.serviceFrom || new Date().toISOString().split("T")[0],
      serviceTo: activeBill.serviceTo,
      remarks: activeBill.remarks,
      // Industry template — top-level mirror of items[0].meta so the
      // InvoiceView dispatch can pick ModernA4 / TraditionalA4 /
      // CondensedReceipt without a meta round-trip on first paint.
      industry: activeBill.industry || DEFAULT_INDUSTRY_ID,
      templateId: activeBill.templateId || DEFAULT_TEMPLATE_ID,
      fields: activeBill.fields || {},
    };

    try {
      await saveInvoice(invoice);
    } catch (err) {
      // Backend signals a missing shift with code:"NO_ACTIVE_SHIFT"
      // (see backend attachShiftContext + POST /api/invoices). Block
      // navigation — without this handler the cashier would land on
      // the invoice preview of a bill that was never persisted.
      if (err && err.status === 409 && err.body && err.body.code === "NO_ACTIVE_SHIFT") {
        showToast(
          "error",
          "Your shift is closed or was never opened. Open a shift to record this sale."
        );
        openShiftDialog();
        return;
      }
      showToast("error", `Failed to save invoice: ${err.message || "unknown error"}`);
      return;
    }
    setLastInvoice(invoice);

    // For cash sales in a cash-vertical store, record the sale against
    // the cashier's currently-open shift so the variance at end-of-shift
    // is accurate. Fire-and-forget — the invoice is already saved.
    // Applies to every store in CASH_STORE_TYPES (retail | hotel |
    // laundry | service | msme-service | inventory); no per-store
    // exclusion.
    if (invoice.paymentMode === "Cash" && currentStoreNeedsShift()) {
      recordCashSaleForShift({
        invoiceNo: invoice.invoiceNo,
        amount: invoice.grandTotal,
      });
    }

    navigate(`/invoice/${invoice.invoiceNo}/preview`);
  };

  if (!hydrated) {
    return <div className="pos-container">Restoring bill…</div>;
  }

  return (
    <div className="pos-container service-billing-pro">
      <ShiftStatusBanner
        onOpen={() => openShiftDialog()}
        onClose={() => {
          if (activeShift) setCloseShiftDialogOpen(true);
        }}
      />

      <h3 className="pos-title">Service Billing</h3>

      {/* STATS */}
      <div className="sv-stats sv-stats-3 sv-bill-stats">
        <div className="sv-stat-card tone-sky">
          <div className="sv-stat-icon">
            <FaLayerGroup />
          </div>
          <div className="sv-stat-meta">
            <span>Open bills</span>
            <strong>{openBillCount}</strong>
          </div>
        </div>
        <div className="sv-stat-card tone-violet">
          <div className="sv-stat-icon">
            <FaShoppingCart />
          </div>
          <div className="sv-stat-meta">
            <span>Items in cart</span>
            <strong>{cartCount}</strong>
          </div>
        </div>
        <div className="sv-stat-card tone-emerald">
          <div className="sv-stat-icon">
            <FaCalculator />
          </div>
          <div className="sv-stat-meta">
            <span>Grand total</span>
            <strong>{formatCurrency(grandTotal)}</strong>
          </div>
        </div>
      </div>

      {/* BILL TABS */}
      <div className="bill-tabs">
        {Object.keys(bills).map((billId) => {
          const bill = bills[billId];
          const billSub = calculateServiceTotals(
            bill.items || [],
            clampPercent(bill.gstRate),
            clampPercent(bill.discountPct)
          ).subTotal;
          const isActive = billId === activeBillId;
          return (
            <div
              key={billId}
              className={`bill-tab ${isActive ? "active" : ""}`}
              onClick={() => setActiveBillId(billId)}
            >
              <span className="bill-tab-title">{billId}</span>
              <span className="bill-total">{formatCurrency(billSub)}</span>
              <span
                className="bill-close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeBill(billId);
                }}
              >
                <FaTimes />
              </span>
            </div>
          );
        })}

        <div className="bill-tab add" onClick={newBill}>
          <FaPlus /> New Bill
        </div>
      </div>

      {/* UNDO TOAST */}
      {undoItem && (
        <div className="undo-toast">
          <div className="undo-toast-body">
            <b>{undoItem.name}</b> removed
            <button className="undo-toast-btn" onClick={handleUndo}>
              <FaUndo /> UNDO
            </button>
          </div>
          <div className="undo-toast-timer">
            <div className="undo-toast-timer-bar" />
          </div>
        </div>
      )}

      <div className="sv-bill-layout">
        {/* LEFT — services */}
        <div className="sv-services-panel">
          <div className="sv-panel-head">
            <div>
              <h2 className="sv-panel-title">
                <FaConciergeBell /> Available services
              </h2>
              <p className="sv-panel-sub">Tap a tile to add it to the active bill.</p>
            </div>
          </div>

          <div className="sv-search sv-bill-search">
            <FaSearch />
            <input
              className="sv-input"
              type="text"
              placeholder="Search services…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>

          {filteredProducts.length === 0 ? (
            <div className="sv-empty sv-empty-sm">
              <div className="sv-empty-icon">
                <FaConciergeBell />
              </div>
              <strong>No services found</strong>
              <span>Adjust the search or add services in the catalog.</span>
            </div>
          ) : (
            <div className="sv-tile-grid">
              {filteredProducts.map((p) => {
                const tone = CATEGORY_TONES[p.category || "Other"] || CATEGORY_TONES.Other;
                const inCart = activeBill.items.some((i) => i.id === p.id);
                // F9: industry + template chip. Both lookups are
                // pure reads against the shared registry — never
                // mutate it. When the product has no industry we
                // simply omit the chip so legacy rows look unchanged.
                const pIndustryMeta = p.industry ? industryById(p.industry) : null;
                const pTemplateMeta = p.defaultTemplateId
                  ? templateById(p.defaultTemplateId)
                  : null;
                return (
                  <button
                    type="button"
                    key={p.id}
                    className={`sv-tile ${inCart ? "selected" : ""}`}
                    style={{ "--tile-accent": tone.color }}
                    onClick={() => toggleItem(p)}
                    aria-pressed={inCart}
                  >
                    <div className="sv-tile-head">
                      <span
                        className="sv-cat-pill"
                        style={{ background: tone.bg, color: tone.color }}
                      >
                        {p.category || "Other"}
                      </span>
                      {inCart ? (
                        <span className="sv-tile-check" aria-label="Added">
                          ✓
                        </span>
                      ) : (
                        <FaPlus className="sv-tile-add" />
                      )}
                    </div>
                    <div className="sv-tile-name">{p.name}</div>
                    {p.description && <div className="sv-tile-desc">{p.description}</div>}
                    {(pIndustryMeta || pTemplateMeta) && (
                      <div className="sv-tile-extra">
                        {pIndustryMeta && (
                          <span
                            className="sv-tile-extra-chip"
                            style={{
                              background: `${pIndustryMeta.accent}1A`,
                              color: pIndustryMeta.accent,
                            }}
                            title={
                              pTemplateMeta
                                ? `${pIndustryMeta.label} · ${pTemplateMeta.label}`
                                : pIndustryMeta.label
                            }
                          >
                            <span aria-hidden="true">{pIndustryMeta.icon}</span>
                            {pIndustryMeta.label}
                            {pTemplateMeta && (
                              <>
                                <span className="sv-tile-extra-sep">·</span>
                                <span className="sv-tile-extra-tpl">{pTemplateMeta.family}</span>
                              </>
                            )}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="sv-tile-foot">
                      <span className="sv-tile-rate">
                        <FaRupeeSign /> {Number(p.price || p.rate || 0).toFixed(0)}
                      </span>
                      {p.hours ? <span className="sv-tile-hours">⏱ {p.hours}h</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT — bill summary */}
        <div className="sv-bill-summary">
          <div className="sv-panel-head">
            <div>
              <h2 className="sv-panel-title">
                <FaFileInvoice /> Bill summary
              </h2>
              <p className="sv-panel-sub">{activeBillId}</p>
            </div>
            <button
              type="button"
              className="sv-btn sv-btn-ghost sv-btn-sm"
              onClick={clearBill}
              disabled={activeBill.items.length === 0}
            >
              <FaTrash /> Clear
            </button>
          </div>

          {/* INDUSTRY TEMPLATE PICKER */}
          <button
            type="button"
            ref={triggerRef}
            className={`sv-industry-picker${
              settings.serviceLockTemplateId ? " sv-industry-picker-locked" : ""
            }`}
            onClick={() => {
              // F9: enforce serviceLockTemplateId at the click level so
              // the lock is observable in the real selection logic,
              // not just a label. selectIndustry() also short-circuits
              // — this guard is the belt to its braces (UX feedback
              // happens before the toast).
              if (settings.serviceLockTemplateId) {
                showToast("info", "Template lock is on — change it from Store Settings.");
                return;
              }
              setIndustrySearch("");
              setIndustryDrawerOpen(true);
            }}
            disabled={!!settings.serviceLockTemplateId}
            style={{ "--picker-accent": activeIndustry.accent }}
            title={
              settings.serviceLockTemplateId
                ? "Template lock is on — change it in Store Settings"
                : "Choose invoice template"
            }
          >
            <span className="sv-industry-picker-icon" aria-hidden="true">
              {activeIndustry.icon}
            </span>
            <span className="sv-industry-picker-meta">
              <small>
                INVOICE TEMPLATE
                {settings.serviceLockTemplateId && " · LOCKED"}
              </small>
              <strong>{activeIndustry.label}</strong>
              {filledFieldCount > 0 && (
                <span className="sv-industry-picker-count">
                  {filledFieldCount} field{filledFieldCount === 1 ? "" : "s"} filled
                </span>
              )}
            </span>
            <span className="sv-industry-picker-arrow">›</span>
          </button>

          {/* CUSTOMER DETAILS */}
          <div className="sv-customer-card">
            {activeBill.customer ? (
              <div className="sv-customer-display">
                <div
                  className="so-avatar"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(99,102,241,0.18), rgba(255,255,255,0.6))",
                    color: "#4338ca",
                  }}
                >
                  {initialsFromName(activeBill.customer)}
                </div>
                <div className="sv-customer-meta">
                  <strong>{activeBill.customer}</strong>
                  <span>
                    {[activeBill.phone, activeBill.email].filter(Boolean).join(" · ") ||
                      "Add phone or email"}
                  </span>
                </div>
              </div>
            ) : null}

            <div className="sv-customer-fields">
              <div className="sv-field sv-field-inline">
                <FaUser />
                <input
                  className="sv-input"
                  type="text"
                  placeholder="Customer name *"
                  value={activeBill.customer || ""}
                  onChange={(e) => updateActiveBill({ customer: e.target.value })}
                />
              </div>
              <div className="sv-field sv-field-inline">
                <FaPhone />
                <input
                  className="sv-input"
                  type="tel"
                  placeholder="Phone"
                  value={activeBill.phone || ""}
                  onChange={(e) => updateActiveBill({ phone: e.target.value })}
                />
              </div>
              <div className="sv-field sv-field-inline">
                <FaEnvelope />
                <input
                  className="sv-input"
                  type="email"
                  placeholder="Email"
                  value={activeBill.email || ""}
                  onChange={(e) => updateActiveBill({ email: e.target.value })}
                />
              </div>

              <button
                type="button"
                className="sv-customer-toggle"
                onClick={() => setShowCustomerDetails((v) => !v)}
                aria-expanded={showCustomerDetails}
              >
                {showCustomerDetails ? <FaChevronUp /> : <FaChevronDown />}
                <span>
                  {showCustomerDetails ? "Hide billing details" : "Add billing, tax & job details"}
                </span>
                {(() => {
                  const filled =
                    (activeBill.address ? 1 : 0) +
                    (activeBill.gst ? 1 : 0) +
                    (activeBill.state ? 1 : 0) +
                    (activeBill.technician ? 1 : 0) +
                    (activeBill.jobRef ? 1 : 0) +
                    (activeBill.serviceFrom ? 1 : 0) +
                    (activeBill.serviceTo ? 1 : 0) +
                    (activeBill.remarks ? 1 : 0);
                  return filled > 0 ? (
                    <span className="sv-customer-count">{filled} added</span>
                  ) : null;
                })()}
              </button>

              {showCustomerDetails && (
                <div className="sv-customer-extra">
                  <div className="sv-field sv-field-full">
                    <FaMapMarkerAlt />
                    <input
                      className="sv-input"
                      type="text"
                      placeholder="Billing address"
                      value={activeBill.address || ""}
                      onChange={(e) => updateActiveBill({ address: e.target.value })}
                    />
                  </div>

                  <div className="sv-field">
                    <FaIdBadge />
                    <input
                      className="sv-input"
                      type="text"
                      placeholder="Customer GSTIN"
                      value={activeBill.gst || ""}
                      onChange={(e) => updateActiveBill({ gst: e.target.value })}
                    />
                  </div>
                  <div className="sv-field">
                    <FaFlag />
                    <input
                      className="sv-input"
                      type="text"
                      placeholder="Customer state (e.g. Maharashtra)"
                      value={activeBill.state || ""}
                      onChange={(e) => updateActiveBill({ state: e.target.value })}
                    />
                  </div>

                  <div className="sv-field">
                    <FaUserTie />
                    <input
                      className="sv-input"
                      type="text"
                      placeholder="Technician / Service provider"
                      value={activeBill.technician || ""}
                      onChange={(e) => updateActiveBill({ technician: e.target.value })}
                    />
                  </div>
                  <div className="sv-field">
                    <FaHashtag />
                    <input
                      className="sv-input"
                      type="text"
                      placeholder="Job / PO / Ref number"
                      value={activeBill.jobRef || ""}
                      onChange={(e) => updateActiveBill({ jobRef: e.target.value })}
                    />
                  </div>

                  <div className="sv-field">
                    <FaRegCalendarAlt />
                    <input
                      className="sv-input"
                      type="date"
                      title="Service from"
                      aria-label="Service from"
                      value={activeBill.serviceFrom || ""}
                      onChange={(e) => updateActiveBill({ serviceFrom: e.target.value })}
                    />
                  </div>
                  <div className="sv-field">
                    <FaRegCalendarAlt />
                    <input
                      className="sv-input"
                      type="date"
                      title="Service to"
                      aria-label="Service to"
                      value={activeBill.serviceTo || ""}
                      onChange={(e) => updateActiveBill({ serviceTo: e.target.value })}
                    />
                  </div>

                  <div className="sv-field sv-field-full">
                    <FaStickyNote />
                    <textarea
                      className="sv-input sv-textarea"
                      rows={2}
                      placeholder="Remarks / notes for this bill"
                      value={activeBill.remarks || ""}
                      onChange={(e) => updateActiveBill({ remarks: e.target.value })}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* LINE ITEMS */}
          {activeBill.items.length === 0 ? (
            <div className="sv-empty sv-empty-sm">
              <div className="sv-empty-icon">
                <FaShoppingCart />
              </div>
              <strong>No services added</strong>
              <span>Tap a service from the left to begin the bill.</span>
            </div>
          ) : (
            <div className="sv-line-items">
              {activeBill.items.map((i, index) => {
                const line = serviceLines[index] || getServiceLine(i, index, billGstRate);
                return (
                  <div className="sv-line-item" key={i.id}>
                    <div className="sv-line-item-main">
                      <strong>{i.name}</strong>
                      <span>
                        {line.units} × {formatCurrency(line.rate)} ={" "}
                        {formatCurrency(line.taxableAmount)}
                      </span>
                    </div>
                    <div className="sv-line-item-amount">
                      <strong>{formatCurrency(line.taxableAmount + line.taxAmount)}</strong>
                      <span>
                        + GST {formatCurrency(line.taxAmount)} @ {billGstRate}%
                      </span>
                    </div>
                    <button
                      type="button"
                      className="sv-line-item-remove"
                      onClick={() => removeItem(i)}
                      aria-label="Remove"
                      title="Remove"
                    >
                      <FaTrash />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* TOTALS */}
          <div className="sv-totals">
            <div className="sv-total-row sv-total-gst-input">
              <label htmlFor="sb-bill-gst" className="sv-total-gst-input-label">
                <span className="sv-total-gst-input-title">
                  <FaPercent /> GST %
                </span>
                <span className="sv-total-gst-input-hint">
                  Enter manually — applies to the whole bill
                </span>
              </label>
              <div className="sv-discount-input">
                <input
                  id="sb-bill-gst"
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  inputMode="decimal"
                  className="sv-input"
                  value={activeBill.gstRate ?? ""}
                  placeholder="0"
                  onChange={(e) => updateActiveBill({ gstRate: e.target.value })}
                  aria-label="Bill-level GST percentage"
                />
                <span>%</span>
              </div>
            </div>
            <div className="sv-total-row">
              <span>Subtotal</span>
              <strong>{formatCurrency(subTotal)}</strong>
            </div>
            {!isInterState ? (
              <>
                <div className="sv-total-row">
                  <span>CGST</span>
                  <strong>{formatCurrency(cgstAmount)}</strong>
                </div>
                <div className="sv-total-row">
                  <span>SGST</span>
                  <strong>{formatCurrency(sgstAmount)}</strong>
                </div>
              </>
            ) : (
              <div className="sv-total-row">
                <span>IGST</span>
                <strong>{formatCurrency(gstTotal)}</strong>
              </div>
            )}
            <div className="sv-total-row sv-total-gst-combined">
              <span>Total GST</span>
              <strong>{formatCurrency(gstTotal)}</strong>
            </div>
            <div className="sv-total-row sv-total-discount">
              <span>
                <FaPercent /> Discount
              </span>
              <div className="sv-discount-input">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  className="sv-input"
                  value={activeBill.discountPct ?? ""}
                  placeholder="0"
                  onChange={(e) => updateActiveBill({ discountPct: e.target.value })}
                />
                <span>%</span>
              </div>
              <strong className="sv-discount-amt">− {formatCurrency(discountAmt)}</strong>
            </div>
            <div className="sv-total-row sv-total-grand">
              <span>Grand total</span>
              <strong>{formatCurrency(grandTotal)}</strong>
            </div>
          </div>

          <div className="sv-field sv-bill-payment">
            <label htmlFor="sb-paymode">Payment mode</label>
            <select
              id="sb-paymode"
              className="sv-input sv-select"
              value={activeBill.paymentMode}
              onChange={(e) => updateActiveBill({ paymentMode: e.target.value })}
            >
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
              <option value="Card">Card</option>
              <option value="Bank Transfer">Bank Transfer</option>
            </select>
          </div>

          <div className="sv-bill-actions">
            <button
              type="button"
              className="sv-btn sv-btn-primary sv-btn-block"
              onClick={generateInvoice}
              disabled={activeBill.items.length === 0}
            >
              <FaFileInvoice /> Generate Invoice
            </button>
            <button
              type="button"
              className="sv-btn sv-btn-ghost sv-btn-block"
              onClick={() => printESC_POS(lastInvoice)}
              disabled={!lastInvoice}
            >
              <FaBluetooth /> Bluetooth Print
            </button>
          </div>
        </div>
      </div>

      {/* INDUSTRY TEMPLATE MODAL — modern, responsive picker. Reuses the
          existing industryDrawerOpen state + selectIndustry() handler +
          INDUSTRY_GROUPS / INDUSTRIES data + activeFieldConfig for the
          preserved Extra Fields section. Adds a local industrySearch for
          the live filter, a focusRestoreRef for accessibility (returning
          focus to the trigger chip on close), and an Escape-to-close
          effect when the modal is open. */}
      {industryDrawerOpen && (
        <IndustryTemplateModal
          activeIndustry={activeIndustry}
          activeIndustryId={activeIndustryId}
          activeFieldConfig={activeFieldConfig}
          filledFieldCount={filledFieldCount}
          industryFieldCount={industryFieldCount}
          activeBill={activeBill}
          isLocked={!!settings.serviceLockTemplateId}
          lockedSubtitle="Template lock is on — change the layout from Store Settings to switch."
          industrySearch={industrySearch}
          setIndustrySearch={setIndustrySearch}
          searchInputRef={searchInputRef}
          onSelect={(industryId) => {
            selectIndustry(industryId);
          }}
          onClose={() => {
            setIndustryDrawerOpen(false);
            // Return focus to the chip so keyboard users land somewhere
            // predictable after dismissing the modal.
            if (triggerRef.current) triggerRef.current.focus();
          }}
          updateIndustryField={updateIndustryField}
        />
      )}

      <OpenShiftDialog
        {...mandatoryShiftDialogProps}
        title="Open a shift before recording a service sale"
        // When the cashier opens a shift, refresh the active shift so the
        // banner + chip update, then re-run the pending save if there was
        // one. Without this, the "Generate Invoice" click would be lost.
        onOpened={() => {
          refreshActiveShift();
          const pending = pendingInvoiceRef.current;
          pendingInvoiceRef.current = null;
          if (pending && pending.kind === "service") {
            // Resume the original save flow now that a shift is open.
            generateInvoice();
          }
        }}
      />
      <CloseShiftDialog
        open={closeShiftDialogOpen}
        shift={activeShift}
        onClose={() => setCloseShiftDialogOpen(false)}
        onClosed={async () => {
          setCloseShiftDialogOpen(false);
          await refreshActiveShift();
        }}
      />
    </div>
  );
};

export default ServiceBilling;
