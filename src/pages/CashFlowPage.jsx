import React, { useEffect, useMemo, useState } from "react";
import Layout from "../components/layout/Layout";
import { getInvoices } from "../services/invoiceService";
import { getExpenses, saveExpense, deleteExpense } from "../services/expenseService";
import {
  getCreditCustomers,
  saveCreditCustomer,
  deleteCreditCustomer,
} from "../services/customerService";
import {
  FaRupeeSign,
  FaMoneyBillWave,
  FaFileInvoice,
  FaUserFriends,
  FaWallet,
  FaPlus,
  FaTrashAlt,
  FaTag,
  FaCalendarAlt,
  FaStickyNote,
  FaUserPlus,
  FaPhoneAlt,
  FaChartLine,
  FaSyncAlt,
  FaArrowUp,
  FaArrowDown,
  FaReceipt,
  FaHandHoldingUsd,
  FaPercent,
  FaSearch,
  FaCheckCircle,
  FaTimesCircle,
} from "react-icons/fa";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useUi } from "../context/UiContext";
import "./CashFlowPage.css";

const todayDate = () => new Date().toISOString().split("T")[0];

const filterByRange = (items, filter, dateKey = "date") => {
  const now = new Date();
  if (filter === "DAILY") {
    const today = todayDate();
    return items.filter((item) => item[dateKey] === today);
  }
  if (filter === "WEEKLY") {
    const last7 = new Date();
    last7.setDate(now.getDate() - 7);
    return items.filter((item) => new Date(item[dateKey]) >= last7);
  }
  if (filter === "MONTHLY") {
    return items.filter((item) => {
      const d = new Date(item[dateKey]);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  }
  return items;
};

const formatCurrency = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const EXPENSE_CATEGORIES = [
  { value: "Misc", icon: "🧾", color: "#64748b" },
  { value: "Inventory", icon: "📦", color: "#10b981" },
  { value: "Rent", icon: "🏠", color: "#6366f1" },
  { value: "Utilities", icon: "💡", color: "#f59e0b" },
  { value: "Salary", icon: "👥", color: "#ec4899" },
];

const CATEGORY_META = (cat) =>
  EXPENSE_CATEGORIES.find((c) => c.value === cat) || { value: cat, icon: "🧾", color: "#64748b" };

const useCountUp = (value, duration = 900) => {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const end = Number(value || 0);
    const start = 0;
    const t0 = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      const cur = start + (end - start) * p;
      setDisplay(cur);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
};

const Tile = ({ icon, label, value, tone = "blue", sub, trend }) => {
  const animated = useCountUp(Number(value || 0));
  const formatted = Math.round(animated).toLocaleString("en-IN");
  return (
    <article className={`cf-tile cf-tile-${tone}`}>
      <div className="cf-tile-icon">{icon}</div>
      <div className="cf-tile-meta">
        <span>{label}</span>
        <strong>{formatted}</strong>
        {sub ? <small>{sub}</small> : null}
      </div>
      {trend ? (
        <div className={`cf-trend cf-trend-${trend.kind}`}>
          {trend.kind === "down" ? <FaArrowDown /> : <FaArrowUp />}
          <span>{trend.text}</span>
        </div>
      ) : null}
    </article>
  );
};

const CashFlowPage = () => {
  const [filter, setFilter] = useState("DAILY");
  const [expenses, setExpenses] = useState([]);
  const [credits, setCredits] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expenseSearch, setExpenseSearch] = useState("");
  const [creditSearch, setCreditSearch] = useState("");
  const [savingExpense, setSavingExpense] = useState(false);
  const [savingCredit, setSavingCredit] = useState(false);
  const [expenseForm, setExpenseForm] = useState({
    description: "",
    category: "Misc",
    amount: "",
    date: todayDate(),
    notes: "",
  });
  const [creditForm, setCreditForm] = useState({
    name: "",
    phone: "",
    amount: "",
    note: "",
  });

  const { activeStore, showToast } = useUi();

  const reloadData = async () => {
    try {
      const [loadedExpenses, loadedCredits, loadedInvoices] = await Promise.all([
        getExpenses(),
        getCreditCustomers(),
        getInvoices(),
      ]);
      setExpenses(Array.isArray(loadedExpenses) ? loadedExpenses : []);
      setCredits(Array.isArray(loadedCredits) ? loadedCredits : []);
      setInvoices(Array.isArray(loadedInvoices) ? loadedInvoices : []);
    } catch (err) {
      console.error("Failed to reload cash flow data:", err);
      setExpenses([]);
      setCredits([]);
      setInvoices([]);
    }
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await reloadData();
      setLoading(false);
    };
    load();
    const updateHandler = (e) => {
      if (e.detail === "expenses" || e.detail === "customerCredits" || e.detail === "invoices") {
        reloadData();
      }
    };
    window.addEventListener("dataUpdated", updateHandler);
    return () => window.removeEventListener("dataUpdated", updateHandler);
  }, [activeStore]);

  const periodInvoices = filterByRange(invoices, filter);
  const periodExpenses = filterByRange(expenses, filter);
  const todayInvoices = filterByRange(invoices, "DAILY");
  const todayExpenses = filterByRange(expenses, "DAILY");

  const totalSales = periodInvoices.reduce((sum, inv) => sum + Number(inv.grandTotal || 0), 0);
  const gstCollected = periodInvoices.reduce((sum, inv) => sum + Number(inv.gstTotal || 0), 0);
  const totalExpenseAmount = periodExpenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);
  const profit = totalSales - totalExpenseAmount;
  const needPay = credits.reduce((sum, customer) => sum + Number(customer.amount || 0), 0);
  const todayProfit =
    todayInvoices.reduce((sum, inv) => sum + Number(inv.grandTotal || 0), 0) -
    todayExpenses.reduce((sum, exp) => sum + Number(exp.amount || 0), 0);

  const profitMargin = totalSales > 0 ? Math.round((profit / totalSales) * 100) : 0;

  const salesTrend = useMemo(() => {
    const map = {};
    periodInvoices.forEach((inv) => {
      const key = inv.date || todayDate();
      map[key] = (map[key] || 0) + Number(inv.grandTotal || 0);
    });
    return Object.entries(map)
      .sort(([a], [b]) => new Date(a) - new Date(b))
      .map(([date, amount]) => ({ date, amount }));
  }, [periodInvoices]);

  const trendMax = salesTrend.reduce((m, x) => Math.max(m, x.amount), 0) || 1;

  const filteredExpenses = useMemo(() => {
    const term = expenseSearch.trim().toLowerCase();
    const sorted = [...expenses].sort((a, b) =>
      String(b.date || "").localeCompare(String(a.date || ""))
    );
    if (!term) return sorted;
    return sorted.filter(
      (e) =>
        (e.description || "").toLowerCase().includes(term) ||
        (e.category || "").toLowerCase().includes(term) ||
        String(e.amount || "").includes(term)
    );
  }, [expenses, expenseSearch]);

  const filteredCredits = useMemo(() => {
    const term = creditSearch.trim().toLowerCase();
    const sorted = [...credits].sort((a, b) =>
      String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))
    );
    if (!term) return sorted;
    return sorted.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(term) ||
        (c.phone || "").includes(term) ||
        (c.note || "").toLowerCase().includes(term)
    );
  }, [credits, creditSearch]);

  const handleExpenseSave = async () => {
    if (!expenseForm.description || !expenseForm.amount) {
      showToast("error", "Please enter expense description and amount.");
      return;
    }
    if (Number(expenseForm.amount) <= 0) {
      showToast("error", "Amount must be greater than zero.");
      return;
    }
    setSavingExpense(true);
    try {
      await saveExpense({
        description: expenseForm.description,
        category: expenseForm.category,
        amount: Number(expenseForm.amount),
        date: expenseForm.date,
        notes: expenseForm.notes,
      });
      setExpenseForm({
        description: "",
        category: "Misc",
        amount: "",
        date: todayDate(),
        notes: "",
      });
      await reloadData();
      showToast("success", "Expense saved successfully");
      window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "expenses" }));
    } catch (err) {
      console.error("Failed to save expense:", err);
      showToast("error", "Unable to save expense. Please try again.");
    } finally {
      setSavingExpense(false);
    }
  };

  const handleCreditSave = () => {
    if (!creditForm.name || !creditForm.amount) {
      showToast("error", "Please enter customer name and due amount.");
      return;
    }
    if (creditForm.phone && !/^\d{10}$/.test(creditForm.phone)) {
      showToast("error", "Enter valid 10-digit mobile number.");
      return;
    }
    if (Number(creditForm.amount) <= 0) {
      showToast("error", "Amount must be greater than zero.");
      return;
    }
    setSavingCredit(true);
    try {
      saveCreditCustomer({
        name: creditForm.name,
        phone: creditForm.phone,
        amount: Number(creditForm.amount),
        note: creditForm.note,
      });
      setCreditForm({ name: "", phone: "", amount: "", note: "" });
      reloadData();
      showToast("success", "Credit customer saved");
      window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "customerCredits" }));
    } catch (err) {
      console.error("Failed to save credit customer:", err);
      showToast("error", "Unable to save customer. Please try again.");
    } finally {
      setSavingCredit(false);
    }
  };

  const handleDeleteExpense = async (id) => {
    if (!window.confirm("Delete this expense?")) return;
    try {
      await deleteExpense(id);
      await reloadData();
      showToast("success", "Expense deleted");
    } catch (err) {
      console.error("Failed to delete expense:", err);
      showToast("error", "Unable to delete expense. Please try again.");
    }
  };

  const handleDeleteCustomer = (id) => {
    if (!window.confirm("Delete this customer record?")) return;
    try {
      deleteCreditCustomer(id);
      reloadData();
      showToast("success", "Customer removed");
    } catch (err) {
      console.error("Failed to delete customer:", err);
      showToast("error", "Unable to delete customer. Please try again.");
    }
  };

  const refreshAll = async () => {
    setLoading(true);
    await reloadData();
    setLoading(false);
    showToast("info", "Cash flow refreshed");
  };

  return (
    <Layout>
      <div className="cf-page">
        {/* Hero */}
        <header className="cf-hero">
          <div className="cf-hero-text">
            <span className="cf-eyebrow">
              <FaChartLine /> Cash · Operations
            </span>
            <h2 className="cf-hero-title">Cash Flow Manager</h2>
            <p className="cf-hero-sub">
              Track sales, expenses, credit customers and daily profit — all in one place.
            </p>
          </div>
          <div className="cf-hero-actions">
            <div className="cf-filter-row">
              {[
                { key: "DAILY", label: "Daily" },
                { key: "WEEKLY", label: "Weekly" },
                { key: "MONTHLY", label: "Monthly" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`cf-pill ${filter === opt.key ? "is-active" : ""}`}
                  onClick={() => setFilter(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button type="button" className="cf-refresh-btn" onClick={refreshAll}>
              <FaSyncAlt />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        {/* KPI tiles */}
        <section className="cf-tile-grid">
          <Tile
            icon={<FaFileInvoice />}
            tone="emerald"
            label="Sales"
            value={totalSales}
            sub={`${periodInvoices.length} invoice${periodInvoices.length === 1 ? "" : "s"}`}
            trend={
              profitMargin > 0
                ? { kind: "up", text: `${profitMargin}% margin` }
                : profitMargin < 0
                  ? { kind: "down", text: `${profitMargin}% margin` }
                  : null
            }
          />
          <Tile
            icon={<FaMoneyBillWave />}
            tone="red"
            label="Expenses"
            value={totalExpenseAmount}
            sub={`${periodExpenses.length} record${periodExpenses.length === 1 ? "" : "s"}`}
          />
          <Tile
            icon={<FaWallet />}
            tone={profit >= 0 ? "violet" : "amber"}
            label="Profit"
            value={profit}
            sub={profit >= 0 ? "Net positive" : "Net negative"}
            trend={
              profit > 0
                ? { kind: "up", text: "growing" }
                : profit < 0
                  ? { kind: "down", text: "loss" }
                  : null
            }
          />
          <Tile
            icon={<FaUserFriends />}
            tone="amber"
            label="Credit Due"
            value={needPay}
            sub={`${credits.length} customer${credits.length === 1 ? "" : "s"}`}
          />
          <Tile
            icon={<FaPercent />}
            tone="blue"
            label="GST Collected"
            value={gstCollected}
            sub={`of ${formatCurrency(totalSales)} sales`}
          />
        </section>

        {/* Two-col: forms */}
        <section className="cf-two-col">
          <div className="cf-form-card">
            <div className="cf-form-head">
              <div className="cf-form-icon cf-form-icon-red">
                <FaMoneyBillWave />
              </div>
              <div>
                <h5>Add Expense</h5>
                <p>Record a new business expense.</p>
              </div>
            </div>
            <div className="cf-field">
              <label>Description</label>
              <div className="cf-input-wrap">
                <FaReceipt className="cf-input-icon" />
                <input
                  value={expenseForm.description}
                  onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                  placeholder="e.g. Electricity bill"
                />
              </div>
            </div>
            <div className="cf-field-row">
              <div className="cf-field">
                <label>Category</label>
                <div className="cf-input-wrap">
                  <FaTag className="cf-input-icon" />
                  <select
                    value={expenseForm.category}
                    onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })}
                  >
                    {EXPENSE_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.icon} {c.value}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="cf-field">
                <label>Date</label>
                <div className="cf-input-wrap">
                  <FaCalendarAlt className="cf-input-icon" />
                  <input
                    type="date"
                    value={expenseForm.date}
                    onChange={(e) => setExpenseForm({ ...expenseForm, date: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="cf-field">
              <label>Amount</label>
              <div className="cf-input-wrap">
                <FaRupeeSign className="cf-input-icon" />
                <input
                  type="number"
                  min="0"
                  value={expenseForm.amount}
                  onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })}
                  placeholder="1000"
                />
              </div>
            </div>
            <div className="cf-field">
              <label>Notes</label>
              <div className="cf-input-wrap cf-input-wrap-textarea">
                <FaStickyNote className="cf-input-icon" />
                <textarea
                  value={expenseForm.notes}
                  onChange={(e) => setExpenseForm({ ...expenseForm, notes: e.target.value })}
                  placeholder="Optional details"
                  rows={2}
                />
              </div>
            </div>
            <button
              type="button"
              className="cf-btn cf-btn-primary"
              onClick={handleExpenseSave}
              disabled={savingExpense}
            >
              {savingExpense ? <span className="cf-spinner" /> : <FaPlus />}
              <span>{savingExpense ? "Saving…" : "Save Expense"}</span>
            </button>
          </div>

          <div className="cf-form-card">
            <div className="cf-form-head">
              <div className="cf-form-icon cf-form-icon-amber">
                <FaUserPlus />
              </div>
              <div>
                <h5>Add Credit Customer</h5>
                <p>Track customers who owe money.</p>
              </div>
            </div>
            <div className="cf-field">
              <label>Customer Name</label>
              <div className="cf-input-wrap">
                <FaUserFriends className="cf-input-icon" />
                <input
                  value={creditForm.name}
                  onChange={(e) => setCreditForm({ ...creditForm, name: e.target.value })}
                  placeholder="Customer name"
                />
              </div>
            </div>
            <div className="cf-field">
              <label>Mobile</label>
              <div className="cf-input-wrap">
                <FaPhoneAlt className="cf-input-icon" />
                <input
                  type="tel"
                  value={creditForm.phone}
                  onChange={(e) =>
                    setCreditForm({
                      ...creditForm,
                      phone: e.target.value.replace(/\D/g, "").slice(0, 10),
                    })
                  }
                  placeholder="10-digit mobile"
                />
              </div>
            </div>
            <div className="cf-field">
              <label>Amount Due</label>
              <div className="cf-input-wrap">
                <FaRupeeSign className="cf-input-icon" />
                <input
                  type="number"
                  min="0"
                  value={creditForm.amount}
                  onChange={(e) => setCreditForm({ ...creditForm, amount: e.target.value })}
                  placeholder="500"
                />
              </div>
            </div>
            <div className="cf-field">
              <label>Note</label>
              <div className="cf-input-wrap cf-input-wrap-textarea">
                <FaStickyNote className="cf-input-icon" />
                <textarea
                  value={creditForm.note}
                  onChange={(e) => setCreditForm({ ...creditForm, note: e.target.value })}
                  placeholder="Optional note"
                  rows={2}
                />
              </div>
            </div>
            <button
              type="button"
              className="cf-btn cf-btn-amber"
              onClick={handleCreditSave}
              disabled={savingCredit}
            >
              {savingCredit ? <span className="cf-spinner" /> : <FaPlus />}
              <span>{savingCredit ? "Saving…" : "Save Credit Customer"}</span>
            </button>
          </div>
        </section>

        {/* Two-col: tables */}
        <section className="cf-two-col">
          <div className="cf-list-card">
            <div className="cf-list-head">
              <div>
                <h5>
                  <FaMoneyBillWave className="cf-card-ico" /> Recent Expenses
                </h5>
                <p>Latest expense entries across all dates.</p>
              </div>
              <div className="cf-search">
                <FaSearch />
                <input
                  type="text"
                  placeholder="Search…"
                  value={expenseSearch}
                  onChange={(e) => setExpenseSearch(e.target.value)}
                />
              </div>
            </div>
            {loading ? (
              <div className="cf-skeleton">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="cf-skeleton-row" />
                ))}
              </div>
            ) : filteredExpenses.length === 0 ? (
              <div className="cf-empty">
                <div className="cf-empty-illu">
                  <FaMoneyBillWave />
                </div>
                <h6>No expenses recorded</h6>
                <p>Use the form above to add your first expense.</p>
              </div>
            ) : (
              <div className="cf-table-wrap">
                <table className="cf-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Category</th>
                      <th>Date</th>
                      <th className="cf-ta-right">Amount</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredExpenses.slice(0, 25).map((expense) => {
                      const meta = CATEGORY_META(expense.category);
                      return (
                        <tr key={expense.id}>
                          <td>
                            <div className="cf-cell-name">
                              <span
                                className="cf-cat-ico"
                                style={{ background: `${meta.color}22`, color: meta.color }}
                              >
                                {meta.icon}
                              </span>
                              <strong>{expense.description}</strong>
                            </div>
                          </td>
                          <td>
                            <span
                              className="cf-cat-pill"
                              style={{ background: `${meta.color}1a`, color: meta.color }}
                            >
                              {meta.value}
                            </span>
                          </td>
                          <td className="cf-mono">{expense.date}</td>
                          <td className="cf-ta-right">
                            <strong className="cf-amount cf-amount-red">
                              −{formatCurrency(expense.amount)}
                            </strong>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="cf-icon-btn cf-icon-btn-red"
                              onClick={() => handleDeleteExpense(expense.id)}
                              title="Delete expense"
                            >
                              <FaTrashAlt />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="cf-list-card">
            <div className="cf-list-head">
              <div>
                <h5>
                  <FaUserFriends className="cf-card-ico" /> Credit Customers
                </h5>
                <p>Outstanding dues — total: {formatCurrency(needPay)}</p>
              </div>
              <div className="cf-search">
                <FaSearch />
                <input
                  type="text"
                  placeholder="Search…"
                  value={creditSearch}
                  onChange={(e) => setCreditSearch(e.target.value)}
                />
              </div>
            </div>
            {loading ? (
              <div className="cf-skeleton">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="cf-skeleton-row" />
                ))}
              </div>
            ) : filteredCredits.length === 0 ? (
              <div className="cf-empty">
                <div className="cf-empty-illu">
                  <FaUserFriends />
                </div>
                <h6>No credit customers yet</h6>
                <p>Add a credit entry to track who owes what.</p>
              </div>
            ) : (
              <div className="cf-table-wrap">
                <table className="cf-table">
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Phone</th>
                      <th>Last Updated</th>
                      <th className="cf-ta-right">Due</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCredits.slice(0, 25).map((customer) => (
                      <tr key={customer.id}>
                        <td>
                          <div className="cf-cell-name">
                            <span className="cf-avatar">
                              {customer.name?.[0]?.toUpperCase() || "U"}
                            </span>
                            <strong>{customer.name}</strong>
                          </div>
                        </td>
                        <td className="cf-mono">{customer.phone || "—"}</td>
                        <td className="cf-mono">
                          {customer.updatedAt
                            ? new Date(customer.updatedAt).toLocaleDateString()
                            : "—"}
                        </td>
                        <td className="cf-ta-right">
                          <strong className="cf-amount cf-amount-amber">
                            {formatCurrency(customer.amount)}
                          </strong>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="cf-icon-btn cf-icon-btn-red"
                            onClick={() => handleDeleteCustomer(customer.id)}
                            title="Delete customer"
                          >
                            <FaTrashAlt />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>

        {/* Sales Trend + Today Summary */}
        <section className="cf-two-col">
          <div className="cf-chart-card">
            <div className="cf-list-head">
              <div>
                <h5>
                  <FaChartLine className="cf-card-ico" /> Sales Trend
                </h5>
                <p>Revenue by date for the selected period.</p>
              </div>
              <span className="cf-count-pill cf-pill-blue">
                {salesTrend.length} day{salesTrend.length === 1 ? "" : "s"}
              </span>
            </div>
            {salesTrend.length === 0 ? (
              <div className="cf-empty">
                <div className="cf-empty-illu">
                  <FaChartLine />
                </div>
                <h6>No sales data for this period</h6>
                <p>Try switching to a wider date range.</p>
              </div>
            ) : (
              <>
                <div className="cf-chart-body">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={salesTrend} margin={{ top: 10, right: 4, left: 4, bottom: 0 }}>
                      <defs>
                        <linearGradient id="cf-bar-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
                          <stop offset="100%" stopColor="#a855f7" stopOpacity={0.7} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(15,23,42,0.06)" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "#64748b" }}
                        axisLine={false}
                        tickLine={false}
                        width={50}
                      />
                      <Tooltip
                        cursor={{ fill: "rgba(99,102,241,0.08)" }}
                        contentStyle={{
                          borderRadius: 12,
                          border: "1px solid rgba(15,23,42,0.08)",
                          boxShadow: "0 14px 32px rgba(15,23,42,0.12)",
                          fontWeight: 600,
                        }}
                        formatter={(v) => formatCurrency(v)}
                      />
                      <Bar dataKey="amount" radius={[8, 8, 0, 0]} fill="url(#cf-bar-grad)" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="cf-trend-list">
                  {[...salesTrend]
                    .reverse()
                    .slice(0, 5)
                    .map((item) => (
                      <div key={item.date} className="cf-trend-item">
                        <div className="cf-trend-date">{item.date}</div>
                        <div className="cf-trend-track">
                          <div
                            className="cf-trend-fill"
                            style={{ width: `${Math.round((item.amount / trendMax) * 100)}%` }}
                          />
                        </div>
                        <strong className="cf-trend-amt">{formatCurrency(item.amount)}</strong>
                      </div>
                    ))}
                </div>
              </>
            )}
          </div>

          <div className="cf-summary-card">
            <div className="cf-list-head">
              <div>
                <h5>
                  <FaHandHoldingUsd className="cf-card-ico" /> Today's Snapshot
                </h5>
                <p>Quick read on where you stand today.</p>
              </div>
            </div>
            <div className="cf-snapshot-grid">
              <div className="cf-snap cf-snap-emerald">
                <span>Today Sales</span>
                <strong>
                  {formatCurrency(todayInvoices.reduce((s, i) => s + Number(i.grandTotal || 0), 0))}
                </strong>
                <small>
                  <FaCheckCircle /> {todayInvoices.length} invoice
                  {todayInvoices.length === 1 ? "" : "s"}
                </small>
              </div>
              <div className="cf-snap cf-snap-red">
                <span>Today Expenses</span>
                <strong>
                  {formatCurrency(todayExpenses.reduce((s, e) => s + Number(e.amount || 0), 0))}
                </strong>
                <small>
                  <FaTimesCircle /> {todayExpenses.length} record
                  {todayExpenses.length === 1 ? "" : "s"}
                </small>
              </div>
              <div className={`cf-snap cf-snap-${todayProfit >= 0 ? "violet" : "amber"}`}>
                <span>Today Profit</span>
                <strong>
                  {todayProfit >= 0 ? <FaArrowUp /> : <FaArrowDown />} {formatCurrency(todayProfit)}
                </strong>
                <small>{todayProfit >= 0 ? "Net positive" : "Net negative"}</small>
              </div>
              <div className="cf-snap cf-snap-blue">
                <span>GST Today</span>
                <strong>
                  {formatCurrency(todayInvoices.reduce((s, i) => s + Number(i.gstTotal || 0), 0))}
                </strong>
                <small>
                  <FaPercent /> tax collected
                </small>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Layout>
  );
};

export default CashFlowPage;
