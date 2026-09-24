import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaUndo,
  FaSearch,
  FaPlus,
  FaTimes,
  FaTrash,
  FaBoxOpen,
  FaMoneyBillWave,
  FaExchangeAlt,
  FaHistory,
  FaSync,
  FaExclamationTriangle,
  FaArrowLeft,
  FaCheck,
  FaChevronLeft,
  FaChevronRight,
  FaReceipt,
  FaBox,
  FaUser,
  FaCalendarAlt,
  FaFilter,
  FaCreditCard,
  FaStore,
  FaMinus,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useUi } from "../context/UiContext";
import { getUser, getUserStoreType } from "../utils/auth";
import { getInvoiceByNo } from "../services/invoiceService";
import { getReturns, getReturn, createReturn } from "../services/returnsService";
import { getProducts } from "../services/productService";
import { onRealtimeSyncEvent } from "../services/realtimeSync";
import { toErrorMessage } from "../utils/errorMessage";
import "./RetailReturnsPage.css";

const RETAIL_STORE_TYPE = "retail";
const RETAIL_OR_INVENTORY = ["retail", "inventory"];
const PAGE_SIZE = 25;

const CONDITION_OPTIONS = [
  { value: "resalable", label: "Resalable (restock)" },
  { value: "damaged", label: "Damaged (write off)" },
];
const REFUND_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "upi", label: "UPI" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "store_credit", label: "Store Credit" },
  { value: "exchange", label: "Exchange (no refund)" },
];

const STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "completed", label: "Completed" },
  { value: "rejected", label: "Rejected" },
];

const TYPE_OPTIONS = [
  { value: "return", label: "Return" },
  { value: "refund", label: "Refund" },
  { value: "exchange", label: "Exchange" },
  { value: "cancel", label: "Cancel" },
];

const DATE_RANGES = [
  { value: "all", label: "All time" },
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

// Icon per refund method so the method is scannable at a glance in the table.
const METHOD_ICON = {
  cash: FaMoneyBillWave,
  upi: FaCreditCard,
  card: FaCreditCard,
  bank_transfer: FaStore,
  store_credit: FaBox,
  exchange: FaExchangeAlt,
  none: FaMinus,
};

const currency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Human label for a raw enum value (e.g. "bank_transfer" -> "Bank Transfer").
const humanize = (value, fallback = "—") => {
  if (!value) return fallback;
  const match =
    REFUND_METHODS.find((m) => m.value === value) ||
    TYPE_OPTIONS.find((t) => t.value === value) ||
    STATUS_OPTIONS.find((s) => s.value === value);
  return match ? match.label : String(value).replace(/_/g, " ");
};

const formatDateTime = (value) => {
  if (!value) return "—";
  const raw = String(value);
  // Tolerate both the ISO string the API returns and a Date instance.
  const d = new Date(raw.includes("T") ? raw : raw.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16).replace("T", " ");
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

const formatDate = (value) => {
  if (!value) return "—";
  const d = new Date(String(value).includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const todayIso = () => new Date().toISOString().slice(0, 10);

const emptyLine = (product = null) => ({
  productId: product ? Number(product.id) : null,
  productName: product ? product.name || "" : "",
  qty: 1,
  qtyKg: null,
  unit: product ? product.unit || "unit" : "unit",
  condition: "resalable",
  unitPrice: product ? Number(product.price || 0) : 0,
  lineDiscount: 0,
  lineGst: product ? Number(product.gst || 0) : 0,
});

// ============================================================================
// Modal scaffold — matches the rest of the app's modal styling without
// pulling in a heavyweight portal lib. Esc closes; backdrop click closes.
// ============================================================================
const Modal = ({ open, title, onClose, children, footer, size = "md", subtitle, badge }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="rp-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`rp-modal rp-modal-${size}`}>
        <header className="rp-modal-header">
          <div className="rp-modal-heading">
            <h2>{title}</h2>
            {subtitle && <span className="rp-modal-subtitle">{subtitle}</span>}
          </div>
          <div className="rp-modal-header-actions">
            {badge}
            <button
              type="button"
              className="rp-modal-close"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              <FaTimes />
            </button>
          </div>
        </header>
        <div className="rp-modal-body">{children}</div>
        {footer && <footer className="rp-modal-footer">{footer}</footer>}
      </div>
    </div>
  );
};

// ============================================================================
// Status / method pills
// ============================================================================
const StatusPill = ({ status }) => {
  const value = status || "completed";
  return <span className={`rp-pill rp-pill-${value}`}>{humanize(value)}</span>;
};

const MethodTag = ({ method }) => {
  const Icon = METHOD_ICON[method] || FaMoneyBillWave;
  return (
    <span className={`rp-method-tag rp-method-${method || "none"}`}>
      <Icon aria-hidden="true" />
      <span>{humanize(method, "Not set")}</span>
    </span>
  );
};

// ============================================================================
// Step indicator for the New Return modal
// ============================================================================
const STEPS = [
  { key: "search", label: "Find invoice" },
  { key: "items", label: "Select items" },
  { key: "refund", label: "Refund" },
];

const StepIndicator = ({ current }) => {
  const currentIndex = Math.max(
    0,
    STEPS.findIndex((s) => s.key === current)
  );
  return (
    <ol className="rp-steps" aria-label="Return progress">
      {STEPS.map((s, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "active" : "todo";
        return (
          <li
            key={s.key}
            className={`rp-step rp-step-${state}`}
            aria-current={state === "active" ? "step" : undefined}
          >
            <span className="rp-step-dot">
              {state === "done" ? <FaCheck aria-hidden="true" /> : i + 1}
            </span>
            <span className="rp-step-label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
};

// ============================================================================
// NewReturnModal — invoice search → line-item selection → refund details
// → submit. Mirrors the manual flow a cashier would otherwise do with
// pen + paper: look up the original invoice, decide what's coming back,
// and how to settle the money.
// ============================================================================
const NewReturnModal = ({ open, onClose, onSubmitted }) => {
  const [step, setStep] = useState("search");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoice, setInvoice] = useState(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);
  const [invoiceError, setInvoiceError] = useState(null);

  const [items, setItems] = useState([]);
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState("cash");
  const [exchangeItems, setExchangeItems] = useState([]);
  const [products, setProducts] = useState([]);
  const [exchangeProductId, setExchangeProductId] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!open) {
      // Reset on close so the next open starts fresh.
      setStep("search");
      setInvoiceNo("");
      setInvoice(null);
      setInvoiceError(null);
      setItems([]);
      setReason("");
      setRefundMethod("cash");
      setExchangeItems([]);
      setExchangeProductId("");
      setSubmitting(false);
      setSubmitError(null);
      return;
    }
    // Pre-load the catalog so the exchange picker has items.
    let cancelled = false;
    getProducts()
      .then((rows) => {
        if (cancelled) return;
        setProducts(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const lookupInvoice = useCallback(async () => {
    const trimmed = String(invoiceNo || "").trim();
    if (!trimmed) {
      setInvoiceError("Enter an invoice number");
      return;
    }
    setLoadingInvoice(true);
    setInvoiceError(null);
    try {
      const inv = await getInvoiceByNo(trimmed);
      if (!inv) {
        setInvoice(null);
        setInvoiceError(`Invoice ${trimmed} not found in your store`);
        return;
      }
      setInvoice(inv);
      // Pre-populate one line per invoice item so the cashier just ticks
      // the qty to return — they don't have to re-pick the product.
      const initialItems = (inv.items || []).map((line) =>
        emptyLine({
          id: line.id,
          name: line.name,
          price: line.price || line.unitPrice || 0,
          gst:
            line.lineGst != null
              ? Math.round(
                  (Number(line.lineGst) / Math.max(1, Number(line.qty || line.qtyKg || 1))) * 100
                ) / 100
              : 0,
          unit: line.unit || "unit",
        })
      );
      setItems(initialItems);
      setStep("items");
    } catch (err) {
      setInvoiceError(toErrorMessage(err, "Failed to load invoice"));
      setInvoice(null);
    } finally {
      setLoadingInvoice(false);
    }
  }, [invoiceNo]);

  const updateLine = (idx, patch) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeLine = (idx) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const totals = useMemo(() => {
    let sub = 0;
    let gst = 0;
    let grand = 0;
    for (const line of items) {
      const qty = line.unit === "kg" ? Number(line.qtyKg || 0) : Number(line.qty || 0);
      const lineSub = Number(line.unitPrice || 0) * qty;
      const lineDiscount = Number(line.lineDiscount || 0);
      const lineGst = Number(line.lineGst || 0);
      sub += lineSub;
      gst += lineGst;
      grand += lineSub - lineDiscount + lineGst;
    }
    return {
      subTotal: +sub.toFixed(2),
      gstTotal: +gst.toFixed(2),
      grandTotal: +grand.toFixed(2),
    };
  }, [items]);

  // Total discount across the selected lines — displayed in the summary only.
  // The refund total itself is still `totals.grandTotal` (server recomputes it).
  const totalDiscount = useMemo(
    () => +items.reduce((sum, line) => sum + Number(line.lineDiscount || 0), 0).toFixed(2),
    [items]
  );

  const addExchangeItem = () => {
    const product = products.find((p) => Number(p.id) === Number(exchangeProductId));
    if (!product) return;
    setExchangeItems((prev) => [
      ...prev,
      emptyLine({
        id: product.id,
        name: product.name,
        price: product.price || 0,
        gst: product.gst || 0,
        unit: product.unit || "unit",
      }),
    ]);
    setExchangeProductId("");
  };

  const updateExchangeItem = (idx, patch) => {
    setExchangeItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };

  const removeExchangeItem = (idx) => {
    setExchangeItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const exchangeTotal = useMemo(() => {
    let total = 0;
    for (const line of exchangeItems) {
      const qty = line.unit === "kg" ? Number(line.qtyKg || 0) : Number(line.qty || 0);
      total += Number(line.unitPrice || 0) * qty;
    }
    return +total.toFixed(2);
  }, [exchangeItems]);

  const isExchange = refundMethod === "exchange";
  const priceDifference = isExchange ? +(exchangeTotal - totals.grandTotal).toFixed(2) : 0;

  const submit = async () => {
    if (!invoice) {
      setSubmitError("Search for an invoice first");
      return;
    }
    const sanitizedItems = items
      .map((it) => {
        const qty = it.unit === "kg" ? Number(it.qtyKg || 0) : Number(it.qty || 0);
        if (!it.productId || qty <= 0) return null;
        return {
          productId: Number(it.productId),
          productName: it.productName || "",
          qty: it.unit === "kg" ? undefined : qty,
          qtyKg: it.unit === "kg" ? qty : undefined,
          condition: it.condition || "resalable",
          unitPrice: Number(it.unitPrice || 0),
          lineDiscount: Number(it.lineDiscount || 0),
          lineGst: Number(it.lineGst || 0),
        };
      })
      .filter(Boolean);
    if (sanitizedItems.length === 0) {
      setSubmitError("Pick at least one item with a positive quantity");
      return;
    }

    if (isExchange && exchangeItems.length === 0) {
      setSubmitError("Pick at least one replacement product for an exchange");
      return;
    }

    const type = isExchange ? "exchange" : "return";

    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createReturn({
        invoiceNo: invoice.invoiceNo,
        type,
        scope: sanitizedItems.length === (invoice.items || []).length ? "full" : "partial",
        refundMethod,
        reason: reason || null,
        replacementInvoiceNo: null,
        priceDifference,
        items: sanitizedItems,
      });
      onSubmitted(result);
    } catch (err) {
      setSubmitError(toErrorMessage(err, "Failed to submit return"));
    } finally {
      setSubmitting(false);
    }
  };

  const footer =
    step === "search" ? null : (
      <>
        <button
          type="button"
          className="rp-btn rp-btn-secondary"
          onClick={() => {
            if (step === "refund") setStep("items");
            else onClose();
          }}
          disabled={submitting}
        >
          {step === "refund" ? "Back" : "Cancel"}
        </button>
        {step === "items" && (
          <button
            type="button"
            className="rp-btn rp-btn-primary"
            onClick={() => setStep("refund")}
            disabled={items.length === 0}
          >
            Continue to refund
          </button>
        )}
        {step === "refund" && (
          <button
            type="button"
            className="rp-btn rp-btn-primary"
            onClick={submit}
            disabled={submitting || items.length === 0}
          >
            {submitting ? (
              <>
                <span className="rp-spinner-inline" aria-hidden="true" /> Submitting…
              </>
            ) : (
              <>
                <FaCheck /> {isExchange ? "Submit Exchange" : "Submit Return"}
              </>
            )}
          </button>
        )}
      </>
    );

  return (
    <Modal
      open={open}
      title="New Return / Refund / Exchange"
      subtitle={invoice ? `Invoice ${invoice.invoiceNo}` : null}
      onClose={onClose}
      size="lg"
      footer={footer}
    >
      <div className="rp-stack">
        <StepIndicator current={step} />

        {step === "search" && (
          <div className="rp-step-panel">
            <div className="rp-section-intro">
              <h3>Find the original invoice</h3>
              <p>
                Search by invoice number to load the billed items. You'll pick what is coming back
                on the next step.
              </p>
            </div>
            <label className="rp-label">
              <span>Invoice number</span>
              <div className="rp-search-inline">
                <FaSearch aria-hidden="true" />
                <input
                  type="text"
                  className="rp-input"
                  placeholder="e.g. SI2026-12345"
                  value={invoiceNo}
                  onChange={(e) => setInvoiceNo(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      lookupInvoice();
                    }
                  }}
                  autoFocus
                />
              </div>
            </label>
            {invoiceError && (
              <div className="rp-alert rp-alert-error" role="alert">
                <FaExclamationTriangle aria-hidden="true" />
                <span>{invoiceError}</span>
              </div>
            )}
            <div>
              <button
                type="button"
                className="rp-btn rp-btn-primary"
                onClick={lookupInvoice}
                disabled={loadingInvoice}
              >
                {loadingInvoice ? (
                  <>
                    <span className="rp-spinner-inline" aria-hidden="true" /> Looking up…
                  </>
                ) : (
                  <>
                    <FaSearch /> Look up invoice
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {step === "items" && invoice && (
          <div className="rp-step-panel">
            <div className="rp-invoice-summary">
              <div>
                <div className="rp-invoice-summary-label">
                  <FaReceipt aria-hidden="true" /> Invoice
                </div>
                <div className="rp-invoice-summary-value">{invoice.invoiceNo}</div>
              </div>
              <div>
                <div className="rp-invoice-summary-label">
                  <FaCalendarAlt aria-hidden="true" /> Date
                </div>
                <div className="rp-invoice-summary-value">
                  {formatDate(invoice.date) || todayIso()}
                </div>
              </div>
              <div>
                <div className="rp-invoice-summary-label">
                  <FaMoneyBillWave aria-hidden="true" /> Original total
                </div>
                <div className="rp-invoice-summary-value">{currency(invoice.grandTotal)}</div>
              </div>
              <div>
                <div className="rp-invoice-summary-label">
                  <FaUser aria-hidden="true" /> Customer
                </div>
                <div className="rp-invoice-summary-value">{invoice.customerName || "—"}</div>
              </div>
            </div>

            <div className="rp-section-intro">
              <h3>Select the items being returned</h3>
              <p>Set the quantity for each line. Mark anything unsellable as damaged.</p>
            </div>

            <div className="rp-table-wrap">
              <table className="rp-table rp-table-lines">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="rp-th-num">Qty to return</th>
                    <th>Condition</th>
                    <th className="rp-th-num">Unit price</th>
                    <th className="rp-th-num">Line GST</th>
                    <th className="rp-th-num">Line discount</th>
                    <th className="rp-th-num">Line total</th>
                    <th aria-label="remove"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 && (
                    <tr>
                      <td colSpan="8" className="rp-empty">
                        All line items removed. Go back and re-pick the invoice.
                      </td>
                    </tr>
                  )}
                  {items.map((line, idx) => {
                    const qty =
                      line.unit === "kg" ? Number(line.qtyKg || 0) : Number(line.qty || 0);
                    const lineSub = Number(line.unitPrice || 0) * qty;
                    const lineTotal =
                      lineSub - Number(line.lineDiscount || 0) + Number(line.lineGst || 0);
                    return (
                      <tr key={`${line.productId}-${idx}`}>
                        <td>
                          <div className="rp-cell-strong">{line.productName}</div>
                        </td>
                        <td>
                          <input
                            type="number"
                            className="rp-input rp-input-num"
                            min="0"
                            step={line.unit === "kg" ? "0.01" : "1"}
                            aria-label={`Quantity to return for ${line.productName}`}
                            value={line.unit === "kg" ? (line.qtyKg ?? 0) : (line.qty ?? 0)}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (line.unit === "kg") updateLine(idx, { qtyKg: v });
                              else updateLine(idx, { qty: v });
                            }}
                          />
                        </td>
                        <td>
                          <select
                            className="rp-select"
                            aria-label={`Condition for ${line.productName}`}
                            value={line.condition}
                            onChange={(e) => updateLine(idx, { condition: e.target.value })}
                          >
                            {CONDITION_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            className="rp-input rp-input-num"
                            min="0"
                            step="0.01"
                            aria-label={`Unit price for ${line.productName}`}
                            value={line.unitPrice}
                            onChange={(e) => updateLine(idx, { unitPrice: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="rp-input rp-input-num"
                            min="0"
                            step="0.01"
                            aria-label={`Line GST for ${line.productName}`}
                            value={line.lineGst}
                            onChange={(e) => updateLine(idx, { lineGst: e.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            className="rp-input rp-input-num"
                            min="0"
                            step="0.01"
                            aria-label={`Line discount for ${line.productName}`}
                            value={line.lineDiscount}
                            onChange={(e) => updateLine(idx, { lineDiscount: e.target.value })}
                          />
                        </td>
                        <td className="rp-cell-num">{currency(lineTotal)}</td>
                        <td>
                          <button
                            type="button"
                            className="rp-icon-btn"
                            onClick={() => removeLine(idx)}
                            aria-label={`Remove ${line.productName}`}
                            title="Remove line"
                          >
                            <FaTrash />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === "refund" && invoice && (
          <div className="rp-step-panel">
            <div className="rp-refund-grid">
              <div className="rp-refund-form">
                <div className="rp-section-intro">
                  <h3>How is the refund settled?</h3>
                  <p>
                    Cash refunds are recorded against the open shift so the drawer balance
                    reconciles at close.
                  </p>
                </div>

                <label className="rp-label">
                  <span>Refund method</span>
                  <select
                    className="rp-select rp-select-lg"
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value)}
                  >
                    {REFUND_METHODS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="rp-label">
                  <span>Reason (optional, required for damaged items)</span>
                  <textarea
                    className="rp-input rp-textarea"
                    rows={3}
                    placeholder="e.g. defective on arrival"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>

                {isExchange && (
                  <div className="rp-exchange">
                    <h3>
                      <FaExchangeAlt aria-hidden="true" /> Replacement items
                    </h3>
                    <div className="rp-exchange-add">
                      <select
                        className="rp-select"
                        value={exchangeProductId}
                        aria-label="Pick a replacement product"
                        onChange={(e) => setExchangeProductId(e.target.value)}
                      >
                        <option value="">Pick a product…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} · {currency(p.price || 0)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="rp-btn rp-btn-secondary"
                        onClick={addExchangeItem}
                        disabled={!exchangeProductId}
                      >
                        <FaPlus /> Add
                      </button>
                    </div>
                    <div className="rp-table-wrap">
                      <table className="rp-table">
                        <thead>
                          <tr>
                            <th>Replacement</th>
                            <th className="rp-th-num">Qty</th>
                            <th className="rp-th-num">Unit price</th>
                            <th className="rp-th-num">Line total</th>
                            <th aria-label="remove"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {exchangeItems.length === 0 && (
                            <tr>
                              <td colSpan="5" className="rp-empty">
                                No replacement items yet.
                              </td>
                            </tr>
                          )}
                          {exchangeItems.map((line, idx) => {
                            const qty =
                              line.unit === "kg" ? Number(line.qtyKg || 0) : Number(line.qty || 0);
                            const lineTotal = Number(line.unitPrice || 0) * qty;
                            return (
                              <tr key={`exchange-${line.productId}-${idx}`}>
                                <td className="rp-cell-strong">{line.productName}</td>
                                <td>
                                  <input
                                    type="number"
                                    className="rp-input rp-input-num"
                                    min="0"
                                    step={line.unit === "kg" ? "0.01" : "1"}
                                    aria-label={`Replacement quantity for ${line.productName}`}
                                    value={line.unit === "kg" ? (line.qtyKg ?? 0) : (line.qty ?? 0)}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      if (line.unit === "kg") updateExchangeItem(idx, { qtyKg: v });
                                      else updateExchangeItem(idx, { qty: v });
                                    }}
                                  />
                                </td>
                                <td>
                                  <input
                                    type="number"
                                    className="rp-input rp-input-num"
                                    min="0"
                                    step="0.01"
                                    aria-label={`Replacement unit price for ${line.productName}`}
                                    value={line.unitPrice}
                                    onChange={(e) =>
                                      updateExchangeItem(idx, { unitPrice: e.target.value })
                                    }
                                  />
                                </td>
                                <td className="rp-cell-num">{currency(lineTotal)}</td>
                                <td>
                                  <button
                                    type="button"
                                    className="rp-icon-btn"
                                    onClick={() => removeExchangeItem(idx)}
                                    aria-label={`Remove replacement ${line.productName}`}
                                    title="Remove replacement"
                                  >
                                    <FaTrash />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {submitError && (
                  <div className="rp-alert rp-alert-error" role="alert">
                    <FaExclamationTriangle aria-hidden="true" />
                    <span>{submitError}</span>
                  </div>
                )}
              </div>

              {/* Summary — renders the already-computed totals; the server
                  recomputes everything on submit, this is a preview only. */}
              <aside className="rp-summary" aria-label="Return summary">
                <h3 className="rp-summary-title">Return Summary</h3>

                <div className="rp-summary-line">
                  <span>Subtotal</span>
                  <strong>{currency(totals.subTotal)}</strong>
                </div>
                <div className="rp-summary-line">
                  <span>GST</span>
                  <strong>{currency(totals.gstTotal)}</strong>
                </div>
                <div className="rp-summary-line">
                  <span>Discount</span>
                  <strong>{currency(totalDiscount)}</strong>
                </div>

                {isExchange ? (
                  <>
                    <div className="rp-summary-divider" />
                    <div className="rp-summary-line">
                      <span>Original return</span>
                      <strong>{currency(totals.grandTotal)}</strong>
                    </div>
                    <div className="rp-summary-line">
                      <span>Replacement</span>
                      <strong>{currency(exchangeTotal)}</strong>
                    </div>
                    <div className="rp-summary-divider" />
                    <div className="rp-summary-total">
                      <span>
                        {exchangeTotal - totals.grandTotal >= 0
                          ? "Customer pays"
                          : "Refund difference"}
                      </span>
                      <strong
                        className={exchangeTotal - totals.grandTotal >= 0 ? "rp-pos" : "rp-neg"}
                      >
                        {currency(Math.abs(exchangeTotal - totals.grandTotal))}
                      </strong>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rp-summary-divider" />
                    <div className="rp-summary-total">
                      <span>Refund Total</span>
                      <strong>{currency(totals.grandTotal)}</strong>
                    </div>
                  </>
                )}

                <div className="rp-summary-note">
                  <FaUser aria-hidden="true" />
                  <span>
                    Submitting records this return against <strong>{invoice.invoiceNo}</strong> and
                    adjusts stock for the {items.length} selected{" "}
                    {items.length === 1 ? "item" : "items"}.
                  </span>
                </div>
              </aside>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

// ============================================================================
// DetailModal — read-only view of a single return (header + items).
// ============================================================================
const DetailModal = ({ open, ret, onClose }) => {
  const [full, setFull] = useState(ret);
  const [detailError, setDetailError] = useState(null);

  useEffect(() => {
    setFull(ret);
    setDetailError(null);
    if (open && ret?.id && !ret.items) {
      let cancelled = false;
      getReturn(ret.id)
        .then((r) => {
          if (!cancelled && r) setFull(r);
        })
        .catch((err) => {
          if (!cancelled) setDetailError(toErrorMessage(err, "Couldn't load return details"));
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [open, ret]);

  if (!open || !full) return null;

  const isExchange = full.type === "exchange";

  return (
    <Modal
      open={open}
      title={`Return #${full.id}`}
      subtitle={full.invoiceNo ? `Invoice ${full.invoiceNo}` : null}
      onClose={onClose}
      size="lg"
      badge={<StatusPill status={full.status} />}
      footer={
        <button type="button" className="rp-btn rp-btn-secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="rp-stack">
        {detailError && (
          <div className="rp-alert rp-alert-error" role="alert">
            <FaExclamationTriangle aria-hidden="true" />
            <span>{detailError}</span>
          </div>
        )}

        <div className="rp-detail-summary">
          <div>
            <div className="rp-invoice-summary-label">
              <FaCalendarAlt aria-hidden="true" /> Return date
            </div>
            <div className="rp-invoice-summary-value">{formatDateTime(full.createdAt)}</div>
          </div>
          <div>
            <div className="rp-invoice-summary-label">
              <FaUser aria-hidden="true" /> Processed by
            </div>
            <div className="rp-invoice-summary-value">{full._userEmail || "—"}</div>
          </div>
          <div>
            <div className="rp-invoice-summary-label">
              <FaMoneyBillWave aria-hidden="true" /> Refund method
            </div>
            <div className="rp-invoice-summary-value">
              <MethodTag method={full.refundMethod} />
            </div>
          </div>
          <div>
            <div className="rp-invoice-summary-label">
              <FaUndo aria-hidden="true" /> {isExchange ? "Return value" : "Refund amount"}
            </div>
            <div className="rp-invoice-summary-value rp-detail-amount">
              {currency(full.grandTotal)}
            </div>
          </div>
        </div>

        {full.reason && (
          <div className="rp-detail-reason">
            <div className="rp-invoice-summary-label">Reason</div>
            <p>{full.reason}</p>
          </div>
        )}

        <div className="rp-detail-section">
          <h3 className="rp-detail-heading">Returned items</h3>
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="rp-th-num">Returned qty</th>
                  <th>Condition</th>
                  <th className="rp-th-num">Unit price</th>
                  <th className="rp-th-num">GST</th>
                  <th className="rp-th-num">Discount</th>
                  <th className="rp-th-num">Line total</th>
                </tr>
              </thead>
              <tbody>
                {(full.items || []).length === 0 && (
                  <tr>
                    <td colSpan="7" className="rp-empty">
                      No line items on this return.
                    </td>
                  </tr>
                )}
                {(full.items || []).map((it, i) => (
                  <tr key={it.id != null ? it.id : i}>
                    <td className="rp-cell-strong">{it.productName}</td>
                    <td className="rp-cell-num">{it.returnedQuantity}</td>
                    <td>
                      <span className={`rp-condition rp-condition-${it.condition || "resalable"}`}>
                        {humanize(it.condition, "Resalable")}
                      </span>
                    </td>
                    <td className="rp-cell-num">{currency(it.unitPrice)}</td>
                    <td className="rp-cell-num">{currency(it.lineGst)}</td>
                    <td className="rp-cell-num">{currency(it.lineDiscount)}</td>
                    <td className="rp-cell-num rp-cell-strong">{currency(it.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {isExchange && (
          <div className="rp-detail-section">
            <h3 className="rp-detail-heading">
              <FaExchangeAlt aria-hidden="true" /> Exchange
            </h3>
            <div className="rp-exchange-summary-grid">
              <div>
                <span>Original return</span>
                <strong>{currency(full.grandTotal)}</strong>
              </div>
              {full.replacementInvoiceNo && (
                <div>
                  <span>Replacement invoice</span>
                  <strong>{full.replacementInvoiceNo}</strong>
                </div>
              )}
              <div>
                <span>Price difference</span>
                <strong className={Number(full.priceDifference || 0) >= 0 ? "rp-pos" : "rp-neg"}>
                  {Number(full.priceDifference || 0) >= 0 ? "Customer pays " : "Refund "}
                  {currency(Math.abs(Number(full.priceDifference || 0)))}
                </strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

// ============================================================================
// Skeletons — shown on the first load only, so a refresh never blanks
// out a table the cashier is already reading.
// ============================================================================
const StatSkeletons = () => (
  <div className="rp-stats" aria-hidden="true">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="rp-stat-card">
        <div className="rp-skeleton-icon" />
        <div className="rp-skeleton-lines">
          <div className="rp-skeleton-line rp-skeleton-line-sm" />
          <div className="rp-skeleton-line rp-skeleton-line-lg" />
        </div>
      </div>
    ))}
  </div>
);

const TableSkeleton = ({ rows = 6 }) => (
  <div className="rp-skeleton-table" aria-hidden="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="rp-skeleton-row">
        <div className="rp-skeleton-line" style={{ width: "60px" }} />
        <div className="rp-skeleton-line" style={{ width: "140px" }} />
        <div className="rp-skeleton-line" style={{ width: "120px" }} />
        <div className="rp-skeleton-line" style={{ width: "60px" }} />
        <div className="rp-skeleton-line" style={{ width: "100px" }} />
        <div className="rp-skeleton-pill" />
        <div className="rp-skeleton-line" style={{ width: "36px" }} />
      </div>
    ))}
  </div>
);

// ============================================================================
// RetailReturnsPage — top-level page. Four sections:
//   1. Hero header with "New return" + refresh.
//   2. Stats summary derived from the loaded rows.
//   3. Filter toolbar (client-side — the API returns the full 500-row set).
//   4. Paginated history table.
// ============================================================================
const RetailReturnsPage = () => {
  const { locale } = useUi();
  const navigate = useNavigate();
  const user = getUser();
  const storeType = getUserStoreType();

  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [detailReturn, setDetailReturn] = useState(null);

  const [filters, setFilters] = useState({ q: "", method: "", status: "", dateRange: "all" });
  const [page, setPage] = useState(1);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getReturns();
      setReturns(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(toErrorMessage(err, "Couldn't load returns"));
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Realtime subscription: when the SSE stream emits a `return` event from
  // another tab (or this tab after a POST round-trip), prepend the new
  // row so the cashier / admin sees it without a manual refresh.
  useEffect(() => {
    const off = onRealtimeSyncEvent(({ kind }) => {
      if (kind !== "return") return;
      // Reload from server so the canonical row (with id, created_at,
      // audit fields) populates the table — the SSE payload is a hint
      // to refresh, not the source of truth.
      reload();
    });
    return () => off();
  }, [reload]);

  const stats = useMemo(() => {
    let value = 0;
    let count = returns.length;
    let cashRefunds = 0;
    let exchangeValue = 0;
    let exchangeCount = 0;
    for (const r of returns) {
      value += Number(r.grandTotal || 0);
      if (r.refundMethod === "cash") cashRefunds += Number(r.grandTotal || 0);
      if (r.type === "exchange" || r.refundMethod === "exchange") {
        exchangeCount += 1;
        exchangeValue += Number(r.grandTotal || 0);
      }
    }
    return { count, value, cashRefunds, exchangeCount, exchangeValue };
  }, [returns]);

  // Client-side filtering. The API only exposes invoiceNo / type / status as
  // server-side filters and caps the list at 500 rows, so the toolbar works on
  // the already-loaded set rather than issuing a request per keystroke.
  const filteredReturns = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    let rows = returns;

    if (q) {
      rows = rows.filter((r) => {
        if (r.invoiceNo && String(r.invoiceNo).toLowerCase().includes(q)) return true;
        if (r._userEmail && String(r._userEmail).toLowerCase().includes(q)) return true;
        if (r.id != null && String(r.id) === q) return true;
        return (r.items || []).some(
          (it) => it.productName && String(it.productName).toLowerCase().includes(q)
        );
      });
    }
    if (filters.method) rows = rows.filter((r) => r.refundMethod === filters.method);
    if (filters.status) rows = rows.filter((r) => r.status === filters.status);

    if (filters.dateRange && filters.dateRange !== "all") {
      const now = Date.now();
      const windows = { today: 1, "7d": 7, "30d": 30, "90d": 90 };
      const days = windows[filters.dateRange];
      if (days) {
        const cutoff = now - days * 24 * 60 * 60 * 1000;
        rows = rows.filter((r) => {
          if (!r.createdAt) return false;
          const t = new Date(String(r.createdAt).replace(" ", "T")).getTime();
          if (Number.isNaN(t)) return false;
          if (filters.dateRange === "today") {
            const d = new Date(t);
            const n = new Date(now);
            return (
              d.getFullYear() === n.getFullYear() &&
              d.getMonth() === n.getMonth() &&
              d.getDate() === n.getDate()
            );
          }
          return t >= cutoff;
        });
      }
    }
    return rows;
  }, [returns, filters]);

  const totalPages = Math.max(1, Math.ceil(filteredReturns.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedReturns = useMemo(
    () => filteredReturns.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filteredReturns, currentPage]
  );

  // A new filter (or a reload) that shrinks the result set must not leave the
  // user stranded on a page that no longer exists.
  useEffect(() => {
    setPage(1);
  }, [filters, returns.length]);

  const filtersActive =
    Boolean(filters.q || filters.method || filters.status) || filters.dateRange !== "all";

  const clearFilters = () => setFilters({ q: "", method: "", status: "", dateRange: "all" });

  // The page is retail-only. We still allow Cashiers (they're the ones
  // submitting most returns) and admins. The backend re-checks scope
  // on every API call — this is just a UX guard so the cashier sees a
  // clean message instead of a 403 toast if they wander in from a
  // non-retail account.
  if (
    user &&
    storeType &&
    storeType !== RETAIL_STORE_TYPE &&
    !RETAIL_OR_INVENTORY.includes(storeType)
  ) {
    return (
      <div className="rp-page">
        <div className="rp-card-centered">
          <div className="rp-empty-icon rp-empty-icon-warn" aria-hidden="true">
            <FaExclamationTriangle />
          </div>
          <strong>Returns are only available for the Retail store</strong>
          <span>
            You're signed in as {user.email} with a {storeType} account.
          </span>
          <button type="button" className="rp-btn rp-btn-primary" onClick={() => navigate(-1)}>
            <FaArrowLeft /> Go back
          </button>
        </div>
      </div>
    );
  }

  const showInitialLoading = loading && !loadedOnce;

  return (
    <div className="rp-page">
      {/* HERO */}
      <header className="rp-hero">
        <div className="rp-hero-bg" aria-hidden="true" />
        <div className="rp-hero-content">
          <div className="rp-hero-text">
            <span className="rp-hero-eyebrow">
              <FaUndo aria-hidden="true" /> Retail store
            </span>
            <h1 className="rp-hero-title">{locale.returns || "Returns & Refunds"}</h1>
            <p className="rp-hero-subtitle">
              Manage retail returns, refunds and product exchanges.
            </p>
          </div>
          <div className="rp-hero-actions">
            <button
              type="button"
              className="rp-back-btn"
              onClick={() => navigate(-1)}
              aria-label="Back"
              title="Back"
            >
              <FaArrowLeft />
            </button>
            <button
              type="button"
              className="rp-btn-hero rp-btn-hero-ghost"
              onClick={reload}
              disabled={loading}
            >
              <FaSync className={loading ? "rp-spin" : undefined} aria-hidden="true" /> Refresh
            </button>
            <button
              type="button"
              className="rp-btn-hero rp-btn-hero-primary"
              onClick={() => setNewOpen(true)}
            >
              <FaPlus aria-hidden="true" /> New Return
            </button>
          </div>
        </div>
      </header>

      {/* STATS */}
      {showInitialLoading ? (
        <StatSkeletons />
      ) : (
        <section className="rp-stats" aria-label="Return statistics">
          <div className="rp-stat-card">
            <div className="rp-stat-icon rp-stat-icon-indigo" aria-hidden="true">
              <FaUndo />
            </div>
            <div className="rp-stat-body">
              <div className="rp-stat-label">Total Returns</div>
              <div className="rp-stat-value">{stats.count.toLocaleString("en-IN")}</div>
              <div className="rp-stat-hint">All time, this store</div>
            </div>
          </div>
          <div className="rp-stat-card">
            <div className="rp-stat-icon rp-stat-icon-green" aria-hidden="true">
              <FaMoneyBillWave />
            </div>
            <div className="rp-stat-body">
              <div className="rp-stat-label">Total Refunded</div>
              <div className="rp-stat-value">{currency(stats.value)}</div>
              <div className="rp-stat-hint">Across every method</div>
            </div>
          </div>
          <div className="rp-stat-card">
            <div className="rp-stat-icon rp-stat-icon-amber" aria-hidden="true">
              <FaStore />
            </div>
            <div className="rp-stat-body">
              <div className="rp-stat-label">Cash Refunds</div>
              <div className="rp-stat-value">{currency(stats.cashRefunds)}</div>
              <div className="rp-stat-hint">Paid from the drawer</div>
            </div>
          </div>
          <div className="rp-stat-card">
            <div className="rp-stat-icon rp-stat-icon-violet" aria-hidden="true">
              <FaExchangeAlt />
            </div>
            <div className="rp-stat-body">
              <div className="rp-stat-label">Exchanges</div>
              <div className="rp-stat-value">{stats.exchangeCount.toLocaleString("en-IN")}</div>
              <div className="rp-stat-hint">{currency(stats.exchangeValue)} returned</div>
            </div>
          </div>
        </section>
      )}

      {/* FILTERS */}
      <section className="rp-filters" aria-label="Filter returns">
        <div className="rp-filter-row">
          <div className="rp-search">
            <FaSearch aria-hidden="true" />
            <input
              type="text"
              placeholder="Search invoice, product or user…"
              value={filters.q}
              onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              aria-label="Search returns"
            />
          </div>

          <div className="rp-filter-field">
            <label htmlFor="rp-filter-method">
              <FaMoneyBillWave aria-hidden="true" /> Refund Method
            </label>
            <select
              id="rp-filter-method"
              value={filters.method}
              onChange={(e) => setFilters({ ...filters, method: e.target.value })}
            >
              <option value="">All methods</option>
              {REFUND_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rp-filter-field">
            <label htmlFor="rp-filter-status">Status</label>
            <select
              id="rp-filter-status"
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div className="rp-filter-field">
            <label htmlFor="rp-filter-date">Date</label>
            <select
              id="rp-filter-date"
              value={filters.dateRange}
              onChange={(e) => setFilters({ ...filters, dateRange: e.target.value })}
            >
              {DATE_RANGES.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>

          {filtersActive && (
            <div className="rp-filter-actions">
              <button type="button" className="rp-btn-ghost" onClick={clearFilters}>
                <FaTimes aria-hidden="true" /> Clear
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ERROR */}
      {error && (
        <section className="rp-card-centered rp-card-error" role="alert">
          <div className="rp-empty-icon rp-empty-icon-error" aria-hidden="true">
            <FaExclamationTriangle />
          </div>
          <strong>Couldn't load returns</strong>
          <span>{error}</span>
          <button type="button" className="rp-btn rp-btn-primary" onClick={reload}>
            <FaSync /> Retry
          </button>
        </section>
      )}

      {/* HISTORY */}
      {!error && (
        <section className="rp-table-card">
          <div className="rp-table-card-head">
            <h2 className="rp-card-title">
              <FaHistory aria-hidden="true" /> Returns History
            </h2>
            <span className="rp-card-count">
              {filteredReturns.length.toLocaleString("en-IN")} of{" "}
              {returns.length.toLocaleString("en-IN")}
            </span>
          </div>

          {showInitialLoading ? (
            <TableSkeleton />
          ) : filteredReturns.length === 0 ? (
            <div className="rp-card-centered rp-empty-panel">
              <div className="rp-empty-icon" aria-hidden="true">
                {filtersActive ? <FaFilter /> : <FaBoxOpen />}
              </div>
              <strong>{filtersActive ? "No returns match these filters" : "No returns yet"}</strong>
              <span>
                {filtersActive
                  ? "Try widening the date range or clearing the filters to see older entries."
                  : "Completed retail returns and refunds will appear here."}
              </span>
              {filtersActive ? (
                <button type="button" className="rp-btn rp-btn-primary" onClick={clearFilters}>
                  <FaTimes /> Clear filters
                </button>
              ) : (
                <button
                  type="button"
                  className="rp-btn rp-btn-primary"
                  onClick={() => setNewOpen(true)}
                >
                  <FaPlus /> New Return
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="rp-table-wrap">
                <table className="rp-table rp-history-table">
                  <thead>
                    <tr>
                      <th>Return ID</th>
                      <th>Invoice</th>
                      <th>Date</th>
                      <th className="rp-th-num">Items</th>
                      <th className="rp-th-num">Return Amount</th>
                      <th>Refund Method</th>
                      <th>Status</th>
                      <th>User</th>
                      <th aria-label="actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedReturns.map((r) => (
                      <tr key={r.id}>
                        <td className="rp-cell-mono" data-label="Return ID">
                          #{r.id}
                        </td>
                        <td className="rp-cell-mono rp-cell-strong" data-label="Invoice">
                          {r.invoiceNo || "—"}
                        </td>
                        <td className="rp-cell-muted" data-label="Date">
                          {formatDateTime(r.createdAt)}
                        </td>
                        <td className="rp-cell-num" data-label="Items">
                          <span className="rp-item-count">
                            {(r.items || []).length}
                            <span className="rp-item-count-label">
                              {(r.items || []).length === 1 ? "item" : "items"}
                            </span>
                          </span>
                        </td>
                        <td className="rp-cell-num rp-cell-strong" data-label="Return Amount">
                          {currency(r.grandTotal)}
                        </td>
                        <td data-label="Refund Method">
                          <MethodTag method={r.refundMethod} />
                        </td>
                        <td data-label="Status">
                          <StatusPill status={r.status} />
                        </td>
                        <td className="rp-cell-muted rp-cell-user" data-label="User">
                          {r._userEmail || "—"}
                        </td>
                        <td className="rp-cell-action">
                          <button
                            type="button"
                            className="rp-icon-btn"
                            onClick={() => setDetailReturn(r)}
                            aria-label={`View details for return ${r.id}`}
                            title="View detail"
                          >
                            <FaSearch />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <footer className="rp-footer">
                <span>
                  Showing <strong>{(currentPage - 1) * PAGE_SIZE + 1}</strong>–
                  <strong>{Math.min(currentPage * PAGE_SIZE, filteredReturns.length)}</strong> of{" "}
                  <strong>{filteredReturns.length.toLocaleString("en-IN")}</strong> returns
                </span>
                <div className="rp-pager">
                  <button
                    type="button"
                    className="rp-icon-btn"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    aria-label="Previous page"
                    title="Previous page"
                  >
                    <FaChevronLeft />
                  </button>
                  <span className="rp-pager-label">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    className="rp-icon-btn"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                    aria-label="Next page"
                    title="Next page"
                  >
                    <FaChevronRight />
                  </button>
                </div>
              </footer>
            </>
          )}
        </section>
      )}

      <NewReturnModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onSubmitted={() => {
          setNewOpen(false);
          reload();
        }}
      />
      <DetailModal
        open={Boolean(detailReturn)}
        ret={detailReturn}
        onClose={() => setDetailReturn(null)}
      />
    </div>
  );
};

export default RetailReturnsPage;
