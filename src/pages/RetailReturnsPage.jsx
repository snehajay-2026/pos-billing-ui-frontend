import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FaUndo,
  FaSearch,
  FaPlus,
  FaTimes,
  FaTrash,
  FaCheck,
  FaBoxOpen,
  FaMoneyBillWave,
  FaExchangeAlt,
  FaHistory,
  FaSync,
  FaExclamationTriangle,
  FaArrowLeft,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import { useUi } from "../context/UiContext";
import { getUser, getUserStoreType } from "../utils/auth";
import { getInvoiceByNo } from "../services/invoiceService";
import { getReturns, getReturn, createReturn } from "../services/returnsService";
import { getProducts } from "../services/productService";
import { onRealtimeSyncEvent } from "../services/realtimeSync";
import "./RetailReturnsPage.css";

const RETAIL_STORE_TYPE = "retail";
const RETAIL_OR_INVENTORY = ["retail", "inventory"];
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

const currency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const errorText = (error, fallback) => error?.message || fallback;

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
const Modal = ({ open, title, onClose, children, footer, size = "md" }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="rp-modal-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`rp-modal rp-modal-${size}`}>
        <header className="rp-modal-header">
          <h2>{title}</h2>
          <button type="button" className="rp-modal-close" onClick={onClose} aria-label="Close">
            <FaTimes />
          </button>
        </header>
        <div className="rp-modal-body">{children}</div>
        {footer && <footer className="rp-modal-footer">{footer}</footer>}
      </div>
    </div>
  );
};

// ============================================================================
// NewReturnModal — invoice search → line-item selection → refund method
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
      setStep("lines");
    } catch (err) {
      setInvoiceError(errorText(err, "Failed to load invoice"));
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

    const isExchange = refundMethod === "exchange";
    if (isExchange && exchangeItems.length === 0) {
      setSubmitError("Pick at least one replacement product for an exchange");
      return;
    }

    const priceDifference = isExchange ? +(exchangeTotal - totals.grandTotal).toFixed(2) : 0;
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
      setSubmitError(errorText(err, "Failed to submit return"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      title="New Return / Refund / Exchange"
      onClose={onClose}
      size="lg"
      footer={
        <>
          <button
            type="button"
            className="rp-btn rp-btn-secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          {step === "lines" && (
            <button
              type="button"
              className="rp-btn rp-btn-primary"
              onClick={submit}
              disabled={submitting || items.length === 0}
            >
              {submitting ? "Submitting…" : "Submit Return"}
            </button>
          )}
        </>
      }
    >
      {step === "search" && (
        <div className="rp-stack">
          <label className="rp-label">
            <span>Invoice number</span>
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
          </label>
          {invoiceError && <div className="rp-error">{invoiceError}</div>}
          <button
            type="button"
            className="rp-btn rp-btn-primary"
            onClick={lookupInvoice}
            disabled={loadingInvoice}
          >
            {loadingInvoice ? "Looking up…" : "Look up invoice"}
          </button>
        </div>
      )}

      {step === "lines" && invoice && (
        <div className="rp-stack">
          <div className="rp-invoice-summary">
            <div>
              <div className="rp-invoice-summary-label">Invoice</div>
              <div className="rp-invoice-summary-value">{invoice.invoiceNo}</div>
            </div>
            <div>
              <div className="rp-invoice-summary-label">Date</div>
              <div className="rp-invoice-summary-value">{invoice.date || todayIso()}</div>
            </div>
            <div>
              <div className="rp-invoice-summary-label">Original total</div>
              <div className="rp-invoice-summary-value">{currency(invoice.grandTotal)}</div>
            </div>
            <div>
              <div className="rp-invoice-summary-label">Customer</div>
              <div className="rp-invoice-summary-value">{invoice.customerName || "—"}</div>
            </div>
          </div>

          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty to return</th>
                  <th>Condition</th>
                  <th>Unit price</th>
                  <th>Line GST</th>
                  <th>Line discount</th>
                  <th>Line total</th>
                  <th aria-label="remove"></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan="8" className="rp-empty">
                      All line items removed. Cancel and re-pick the invoice.
                    </td>
                  </tr>
                )}
                {items.map((line, idx) => {
                  const qty = line.unit === "kg" ? Number(line.qtyKg || 0) : Number(line.qty || 0);
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
                          aria-label="Remove line"
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

          <div className="rp-totals">
            <span>
              Subtotal: <strong>{currency(totals.subTotal)}</strong>
            </span>
            <span>
              GST: <strong>{currency(totals.gstTotal)}</strong>
            </span>
            <span className="rp-grand">
              Grand total: <strong>{currency(totals.grandTotal)}</strong>
            </span>
          </div>

          <label className="rp-label">
            <span>Reason (optional, required for damaged items)</span>
            <textarea
              className="rp-input rp-textarea"
              rows={2}
              placeholder="e.g. defective on arrival"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>

          <label className="rp-label">
            <span>Refund method</span>
            <select
              className="rp-select"
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

          {refundMethod === "exchange" && (
            <div className="rp-exchange">
              <h3>Replacement items</h3>
              <div className="rp-exchange-add">
                <select
                  className="rp-select"
                  value={exchangeProductId}
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
                      <th>Qty</th>
                      <th>Unit price</th>
                      <th>Line total</th>
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
                              aria-label="Remove replacement"
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
              <div className="rp-exchange-summary">
                <span>
                  Exchange total: <strong>{currency(exchangeTotal)}</strong>
                </span>
                <span>
                  Difference:{" "}
                  <strong className={exchangeTotal - totals.grandTotal >= 0 ? "rp-pos" : "rp-neg"}>
                    {currency(exchangeTotal - totals.grandTotal)}
                  </strong>
                </span>
              </div>
            </div>
          )}

          {submitError && <div className="rp-error">{submitError}</div>}
        </div>
      )}
    </Modal>
  );
};

// ============================================================================
// DetailModal — read-only view of a single return (header + items).
// ============================================================================
const DetailModal = ({ open, ret, onClose }) => {
  const [full, setFull] = useState(ret);
  useEffect(() => {
    setFull(ret);
    if (open && ret?.id && !ret.items) {
      let cancelled = false;
      getReturn(ret.id).then((r) => {
        if (!cancelled && r) setFull(r);
      });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [open, ret]);
  if (!open || !full) return null;
  return (
    <Modal open={open} title={`Return #${full.id}`} onClose={onClose} size="md">
      <div className="rp-stack">
        <div className="rp-invoice-summary">
          <div>
            <div className="rp-invoice-summary-label">Invoice</div>
            <div className="rp-invoice-summary-value">{full.invoiceNo || "—"}</div>
          </div>
          <div>
            <div className="rp-invoice-summary-label">Type</div>
            <div className="rp-invoice-summary-value">{full.type}</div>
          </div>
          <div>
            <div className="rp-invoice-summary-label">Refund method</div>
            <div className="rp-invoice-summary-value">{full.refundMethod}</div>
          </div>
          <div>
            <div className="rp-invoice-summary-label">Grand total</div>
            <div className="rp-invoice-summary-value">{currency(full.grandTotal)}</div>
          </div>
        </div>
        {full.reason && (
          <div>
            <div className="rp-invoice-summary-label">Reason</div>
            <div>{full.reason}</div>
          </div>
        )}
        <div className="rp-table-wrap">
          <table className="rp-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Returned qty</th>
                <th>Condition</th>
                <th>Unit price</th>
                <th>Line total</th>
              </tr>
            </thead>
            <tbody>
              {(full.items || []).map((it, i) => (
                <tr key={i}>
                  <td className="rp-cell-strong">{it.productName}</td>
                  <td className="rp-cell-num">{it.returnedQuantity}</td>
                  <td>{it.condition}</td>
                  <td className="rp-cell-num">{currency(it.unitPrice)}</td>
                  <td className="rp-cell-num">{currency(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
};

// ============================================================================
// RetailReturnsPage — top-level page. Three sections:
//   1. Header with "New return" + search box.
//   2. Stats summary (count + value of returns this period).
//   3. History table with the most recent returns.
// ============================================================================
const RetailReturnsPage = () => {
  const { locale } = useUi();
  const navigate = useNavigate();
  const user = getUser();
  const storeType = getUserStoreType();

  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [detailReturn, setDetailReturn] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getReturns();
      setReturns(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(errorText(err, "Failed to load returns"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Realtime subscription: when the SSE stream emits a `return` event from
  // another tab (or this tab after a POST round-trip), prepend the new
  // row so the cashier / admin sees it without a manual refresh.
  useEffect(() => {
    const off = onRealtimeSyncEvent(({ kind, event }) => {
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
    for (const r of returns) {
      value += Number(r.grandTotal || 0);
      if (r.refundMethod === "cash") cashRefunds += Number(r.grandTotal || 0);
    }
    return { count, value, cashRefunds };
  }, [returns]);

  // The page is retail-only. We still allow Cashiers (they're the ones
  // submitting most returns) and admins. The backend re-checks scope
  // on every API call — this is just a UX guard so the cashier sees a
  // clean message instead of a 403 toast if they wander in from a
  // non-retail account.
  if (user && storeType && storeType !== RETAIL_STORE_TYPE && storeType !== "inventory") {
    return (
      <div className="rp-page">
        <div className="rp-card rp-empty-state">
          <FaExclamationTriangle />
          <h2>Returns are only available for the Retail store</h2>
          <p>
            You're signed in as {user.email} with a {storeType} account.
          </p>
          <button type="button" className="rp-btn rp-btn-primary" onClick={() => navigate(-1)}>
            <FaArrowLeft /> Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rp-page">
      <header className="rp-header">
        <div className="rp-header-left">
          <button
            type="button"
            className="rp-back-btn"
            onClick={() => navigate(-1)}
            aria-label="Back"
            title="Back"
          >
            <FaArrowLeft />
          </button>
          <div>
            <h1>
              <FaUndo /> {locale.returns || "Returns & Refunds"}
            </h1>
            <div className="rp-subtitle">Retail store returns, refunds, and exchanges.</div>
          </div>
        </div>
        <div className="rp-header-actions">
          <button
            type="button"
            className="rp-btn rp-btn-secondary"
            onClick={reload}
            disabled={loading}
          >
            <FaSync /> Refresh
          </button>
          <button type="button" className="rp-btn rp-btn-primary" onClick={() => setNewOpen(true)}>
            <FaPlus /> New return
          </button>
        </div>
      </header>

      <section className="rp-stats">
        <div className="rp-stat-card">
          <FaHistory className="rp-stat-icon" />
          <div>
            <div className="rp-stat-label">Returns (lifetime)</div>
            <div className="rp-stat-value">{stats.count}</div>
          </div>
        </div>
        <div className="rp-stat-card">
          <FaMoneyBillWave className="rp-stat-icon" />
          <div>
            <div className="rp-stat-label">Total refunded</div>
            <div className="rp-stat-value">{currency(stats.value)}</div>
          </div>
        </div>
        <div className="rp-stat-card">
          <FaMoneyBillWave className="rp-stat-icon" />
          <div>
            <div className="rp-stat-label">Cash refunds</div>
            <div className="rp-stat-value">{currency(stats.cashRefunds)}</div>
          </div>
        </div>
      </section>

      {error && <div className="rp-error">{error}</div>}

      <section className="rp-card">
        <h2 className="rp-card-title">
          <FaHistory /> History
        </h2>
        {loading && returns.length === 0 ? (
          <div className="rp-empty">Loading…</div>
        ) : returns.length === 0 ? (
          <div className="rp-empty">
            <FaBoxOpen />
            <p>No returns yet. Submit your first one with the button above.</p>
          </div>
        ) : (
          <div className="rp-table-wrap">
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Invoice</th>
                  <th>Type</th>
                  <th>Refund method</th>
                  <th>Items</th>
                  <th>Grand total</th>
                  <th>Status</th>
                  <th aria-label="open"></th>
                </tr>
              </thead>
              <tbody>
                {returns.map((r) => (
                  <tr key={r.id}>
                    <td className="rp-cell-num">
                      {(r.createdAt || "").toString().slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="rp-cell-strong">{r.invoiceNo || "—"}</td>
                    <td>
                      <span className={`rp-pill rp-pill-${r.type || "return"}`}>
                        {r.type || "return"}
                      </span>
                    </td>
                    <td>{r.refundMethod}</td>
                    <td className="rp-cell-num">{(r.items || []).length}</td>
                    <td className="rp-cell-num">{currency(r.grandTotal)}</td>
                    <td>
                      <span className={`rp-pill rp-pill-${r.status || "completed"}`}>
                        {r.status || "completed"}
                      </span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="rp-icon-btn"
                        onClick={() => setDetailReturn(r)}
                        aria-label="View detail"
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
        )}
      </section>

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
