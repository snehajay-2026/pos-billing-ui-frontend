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
import { printESC_POS } from "../../utils/bluetoothEscpos";
import { getStoreSettings } from "../../services/storeSettingsService";
import { getUser } from "../../utils/auth";
import { loadServices } from "../../services/serviceService";
import { CATEGORY_TONES, formatCurrency, initialsFromName } from "../../utils/serviceTones";
import { recordCashSaleForShift, currentStoreNeedsShift } from "../../services/shiftService";
import OpenShiftDialog from "../shift/OpenShiftDialog";
import ShiftStatusBanner from "../shift/ShiftStatusBanner";
import { useShiftGate } from "../../hooks/useShiftGate";
import "../pos/POSBilling.css";
import "./ServiceBilling.css";

const ServiceBilling = () => {
  const navigate = useNavigate();
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
  };
  const [bills, setBills] = useState({
    "Bill-101": { ...newBillShape },
  });
  const [activeBillId, setActiveBillId] = useState("Bill-101");
  const activeBill = bills[activeBillId] || { items: [], paymentMode: "Cash" };

  const [products, setProducts] = useState([]);
  const [searchText, setSearchText] = useState("");
  const [lastInvoice, setLastInvoice] = useState(null);

  const [undoItem, setUndoItem] = useState(null);
  const [showCustomerDetails, setShowCustomerDetails] = useState(false);
  const undoTimerRef = useRef(null);

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
      return { ...prev, [activeBillId]: { ...cur, items } };
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
    setBills((prev) => ({
      ...prev,
      [newId]: { ...newBillShape },
    }));
    setBillCounter((c) => c + 1);
    setActiveBillId(newId);
  };

  const subTotal = useMemo(
    () => activeBill.items.reduce((s, i) => s + (Number(i.price) || 0), 0),
    [activeBill.items]
  );

  // Single source of truth for the bill-level GST%. The cashier enters this
  // once and it applies to every line on the bill. Empty / non-numeric /
  // negative input is treated as 0% so the math is always well-defined
  // (cashier can generate an exempt / non-tax bill without typing anything).
  const billGstRate = (() => {
    const raw = String(activeBill.gstRate ?? "").trim();
    if (raw === "") return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  })();

  const gstTotal = useMemo(() => (subTotal * billGstRate) / 100, [subTotal, billGstRate]);

  // Indian GST default: split the combined rate into two equal halves for
  // intra-state invoices (CGST + SGST). When the customer's billing state
  // differs from the store's state, the total still flows through the same
  // grand total — ServiceInvoice re-renders the split as IGST in that case.
  const cgstAmount = gstTotal / 2;
  const sgstAmount = gstTotal / 2;

  const discountPct = Number(activeBill.discountPct) || 0;
  const discountAmt = ((subTotal + gstTotal) * discountPct) / 100;
  const grandTotal = Math.max(0, subTotal + gstTotal - discountAmt);

  const cartCount = activeBill.items.length;
  const openBillCount = Object.keys(bills).length;

  const generateInvoice = async () => {
    if (activeBill.items.length === 0) return alert("Add services first!");
    if (!activeBill.customer || !activeBill.customer.trim()) {
      return alert("Please enter the customer name before generating the invoice.");
    }

    // Mandatory-shift gate: for cash sales in a cash-vertical store, the
    // cashier must have an open shift. If the user lands here without one,
    // show the OpenShiftDialog first; once they open a shift, the success
    // handler re-runs the save. Same flow as Retail POSBilling.
    //
    // Service-Store exception: the Service Store does not operate a cash
    // drawer — it bills professional services (consulting, repairs,
    // AMC, etc.) and the cashier is not expected to reconcile cash at
    // end-of-shift. Enforcing the shift gate here means a single Cash
    // click on a service bill silently opens the OpenShiftDialog and
    // skips the save, so Online-mode users see invoices generated while
    // Cash-mode users see nothing. The user explicitly requires Cash to
    // work the same as Online for the Service Store, so we skip the
    // gate whenever the active store is `service` or `msme-service`.
    // Retail / Hotel / Laundry / Inventory keep the existing behaviour.
    const shiftGateApplies =
      activeBill.paymentMode === "Cash" &&
      currentStoreNeedsShift() &&
      !["service", "msme-service"].includes(String(getUser()?.storeType || "").toLowerCase());
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
    };
    const itemsWithCustomerMeta = activeBill.items.map((item, idx) =>
      idx === 0 ? { ...item, meta: { ...(item.meta || {}), ...customerMeta } } : item
    );

    // Stamp the bill-level rate onto every line item so saved / reprinted /
    // public-share invoices all read the same GST. ServiceInvoice.jsx
    // prefers the top-level `invoice.gstRate` first and falls back to the
    // stamped per-line `gst`, so reprints stay consistent even if a future
    // change ever re-introduces per-line input.
    const itemsWithGst = itemsWithCustomerMeta.map((item) => ({
      ...item,
      gst: billGstRate,
    }));

    const invoice = {
      invoiceNo,
      date: new Date().toISOString().split("T")[0],
      items: itemsWithGst,
      subTotal,
      gstTotal,
      // Bill-level GST rate is the single source of truth for service
      // invoices. ServiceInvoice reads this first; if absent (legacy row),
      // it derives the rate from gstTotal / subTotal so reprints stay
      // numerically consistent.
      gstRate: billGstRate,
      discountPct,
      discountAmt,
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
    };

    saveInvoice(invoice);
    setLastInvoice(invoice);

    // For cash sales in a cash-vertical store, record the sale against
    // the cashier's currently-open shift so the variance at end-of-shift
    // is accurate. Fire-and-forget — the invoice is already saved.
    // Service Store is excluded for the same reason the pre-save gate is
    // skipped above: no cash drawer, no shift to record against.
    if (
      invoice.paymentMode === "Cash" &&
      currentStoreNeedsShift() &&
      !["service", "msme-service"].includes(String(getUser()?.storeType || "").toLowerCase())
    ) {
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
      <ShiftStatusBanner onOpen={() => openShiftDialog()} />

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
          const billSub = (bill.items || []).reduce((s, i) => s + (Number(i.price) || 0), 0);
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
              {activeBill.items.map((i) => {
                const lineTotal = Number(i.price) || 0;
                const lineGst = (lineTotal * billGstRate) / 100;
                return (
                  <div className="sv-line-item" key={i.id}>
                    <div className="sv-line-item-main">
                      <strong>{i.name}</strong>
                      <span>{formatCurrency(lineTotal)}</span>
                    </div>
                    <div className="sv-line-item-amount">
                      <strong>{formatCurrency(lineTotal + lineGst)}</strong>
                      <span>
                        + GST {formatCurrency(lineGst)} @ {billGstRate}%
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
            <div className="sv-total-row">
              <span>CGST</span>
              <strong>{formatCurrency(cgstAmount)}</strong>
            </div>
            <div className="sv-total-row">
              <span>SGST</span>
              <strong>{formatCurrency(sgstAmount)}</strong>
            </div>
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
    </div>
  );
};

export default ServiceBilling;
