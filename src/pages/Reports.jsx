import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaSearch,
  FaDownload,
  FaChartLine,
  FaBalanceScale,
  FaPercent,
  FaArrowLeft,
  FaCalendarAlt,
  FaExclamationTriangle,
  FaCheckCircle,
} from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import {
  getSalesReport,
  getGstReport,
  getPnlReport,
  exportReportUrl,
} from "../services/reportService";
import "./Reports.css";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const currency = (v, { fractionDigits } = {}) => {
  const n = Number(v || 0);
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: fractionDigits ?? 2,
    maximumFractionDigits: fractionDigits ?? 2,
  })}`;
};

const number = (v) => Number(v || 0).toLocaleString("en-IN");

const today = () => new Date().toISOString().slice(0, 10);

const defaultRange = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 29); // last 30 days inclusive
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10),
  };
};

const TABS = [
  { key: "sales", label: "Sales", icon: <FaChartLine /> },
  { key: "gst", label: "GST (GSTR-1)", icon: <FaPercent /> },
  { key: "pnl", label: "Profit & Loss", icon: <FaBalanceScale /> },
];

// ---------------------------------------------------------------------------
// Tab: Sales
// ---------------------------------------------------------------------------
const SalesTab = ({ filters, reloadKey }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSalesReport(filters)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloadKey]);

  if (loading) return <div className="rp-loading">Crunching invoices…</div>;
  if (error)
    return (
      <div className="rp-error">
        <FaExclamationTriangle /> {error}
      </div>
    );
  if (!data) return null;

  const t = data.totals || {};

  return (
    <div className="rp-tab-body">
      <div className="rp-kpis">
        <div className="rp-kpi">
          <span className="rp-kpi-label">Invoices</span>
          <span className="rp-kpi-value">{number(t.invoiceCount)}</span>
        </div>
        <div className="rp-kpi rp-kpi-primary">
          <span className="rp-kpi-label">Revenue</span>
          <span className="rp-kpi-value">{currency(t.revenue)}</span>
        </div>
        <div className="rp-kpi">
          <span className="rp-kpi-label">GST collected</span>
          <span className="rp-kpi-value">{currency(t.gst)}</span>
        </div>
        <div className="rp-kpi">
          <span className="rp-kpi-label">Expenses</span>
          <span className="rp-kpi-value">{currency(t.expenses)}</span>
        </div>
        <div className="rp-kpi rp-kpi-accent">
          <span className="rp-kpi-label">Net</span>
          <span className="rp-kpi-value">{currency(t.net)}</span>
        </div>
      </div>

      <section className="rp-section">
        <h3>By day</h3>
        {data.buckets.length === 0 ? (
          <div className="rp-empty">No invoices in this window.</div>
        ) : (
          <table className="rp-table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="rp-num">Invoices</th>
                <th className="rp-num">Revenue</th>
                <th className="rp-num">GST</th>
              </tr>
            </thead>
            <tbody>
              {data.buckets.map((b) => (
                <tr key={b.period}>
                  <td>{b.period}</td>
                  <td className="rp-num">{number(b.count)}</td>
                  <td className="rp-num">{currency(b.revenue)}</td>
                  <td className="rp-num">{currency(b.gst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="rp-two-col">
        <section className="rp-section">
          <h3>By invoice type</h3>
          <table className="rp-table">
            <thead>
              <tr>
                <th>Type</th>
                <th className="rp-num">Invoices</th>
                <th className="rp-num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.byType.map((r) => (
                <tr key={r.type}>
                  <td>{r.type}</td>
                  <td className="rp-num">{number(r.count)}</td>
                  <td className="rp-num">{currency(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rp-section">
          <h3>By payment mode</h3>
          <table className="rp-table">
            <thead>
              <tr>
                <th>Mode</th>
                <th className="rp-num">Invoices</th>
                <th className="rp-num">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {data.byPayment.map((r) => (
                <tr key={r.mode}>
                  <td>{r.mode}</td>
                  <td className="rp-num">{number(r.count)}</td>
                  <td className="rp-num">{currency(r.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab: GST (GSTR-1)
// ---------------------------------------------------------------------------
const GstTab = ({ filters, reloadKey }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getGstReport(filters)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloadKey]);

  if (loading) return <div className="rp-loading">Crunching GST…</div>;
  if (error)
    return (
      <div className="rp-error">
        <FaExclamationTriangle /> {error}
      </div>
    );
  if (!data) return null;

  const t = data.totals || {};

  return (
    <div className="rp-tab-body">
      <div className="rp-kpis">
        <div className="rp-kpi">
          <span className="rp-kpi-label">Invoices</span>
          <span className="rp-kpi-value">{number(t.invoiceCount)}</span>
        </div>
        <div className="rp-kpi rp-kpi-primary">
          <span className="rp-kpi-label">Taxable value</span>
          <span className="rp-kpi-value">{currency(t.taxableValue)}</span>
        </div>
        <div className="rp-kpi rp-kpi-accent">
          <span className="rp-kpi-label">Total GST</span>
          <span className="rp-kpi-value">{currency(t.totalGst)}</span>
        </div>
      </div>

      <section className="rp-section">
        <h3>B2CS — B2C (small) consumer summary</h3>
        {data.b2cs.length === 0 ? (
          <div className="rp-empty">No B2CS rows for this window.</div>
        ) : (
          <table className="rp-table">
            <thead>
              <tr>
                <th>State</th>
                <th className="rp-num">GST rate</th>
                <th className="rp-num">Invoices</th>
                <th className="rp-num">Taxable value</th>
                <th className="rp-num">GST amount</th>
              </tr>
            </thead>
            <tbody>
              {data.b2cs.map((r, i) => (
                <tr key={`${r.state}-${r.rate}-${i}`}>
                  <td>{r.state}</td>
                  <td className="rp-num">{Number(r.rate).toFixed(0)}%</td>
                  <td className="rp-num">{number(r.invoices)}</td>
                  <td className="rp-num">{currency(r.taxableValue)}</td>
                  <td className="rp-num">{currency(r.totalGst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rp-section">
        <h3>HSN-wise summary</h3>
        {data.hsn.length === 0 ? (
          <div className="rp-empty">No HSN rows for this window.</div>
        ) : (
          <table className="rp-table">
            <thead>
              <tr>
                <th>HSN code</th>
                <th className="rp-num">Quantity</th>
                <th className="rp-num">Taxable value</th>
                <th className="rp-num">GST amount</th>
              </tr>
            </thead>
            <tbody>
              {data.hsn.map((h, i) => (
                <tr key={`${h.hsn}-${i}`}>
                  <td>{h.hsn}</td>
                  <td className="rp-num">{number(h.qty)}</td>
                  <td className="rp-num">{currency(h.taxableValue)}</td>
                  <td className="rp-num">{currency(h.totalGst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {data.notes && data.notes.length > 0 && (
        <section className="rp-section rp-notes">
          <h3>Notes</h3>
          <ul>
            {data.notes.map((n, i) => (
              <li key={i}>
                <FaCheckCircle /> {n}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Tab: P&L
// ---------------------------------------------------------------------------
const PnlTab = ({ filters, reloadKey }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPnlReport(filters)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, reloadKey]);

  if (loading) return <div className="rp-loading">Crunching P&L…</div>;
  if (error)
    return (
      <div className="rp-error">
        <FaExclamationTriangle /> {error}
      </div>
    );
  if (!data) return null;

  const t = data.totals || {};

  return (
    <div className="rp-tab-body">
      <div className="rp-kpis">
        <div className="rp-kpi rp-kpi-primary">
          <span className="rp-kpi-label">Revenue</span>
          <span className="rp-kpi-value">{currency(t.revenue)}</span>
        </div>
        <div className="rp-kpi">
          <span className="rp-kpi-label">Expenses</span>
          <span className="rp-kpi-value">{currency(t.expenses)}</span>
        </div>
        <div className="rp-kpi">
          <span className="rp-kpi-label">COGS</span>
          <span className="rp-kpi-value">{data.cogsAvailable ? currency(t.cogs) : "—"}</span>
        </div>
        <div className="rp-kpi rp-kpi-accent">
          <span className="rp-kpi-label">Net</span>
          <span className="rp-kpi-value">{currency(t.net)}</span>
        </div>
      </div>

      {data.note && (
        <div className="rp-banner">
          <FaExclamationTriangle /> {data.note}
        </div>
      )}

      <section className="rp-section">
        <h3>Monthly</h3>
        {data.monthly.length === 0 ? (
          <div className="rp-empty">No activity in this window.</div>
        ) : (
          <table className="rp-table">
            <thead>
              <tr>
                <th>Month</th>
                <th className="rp-num">Revenue</th>
                <th className="rp-num">Expenses</th>
                <th className="rp-num">Net</th>
              </tr>
            </thead>
            <tbody>
              {data.monthly.map((m) => (
                <tr key={m.month}>
                  <td>{m.month}</td>
                  <td className="rp-num">{currency(m.revenue)}</td>
                  <td className="rp-num">{currency(m.expenses)}</td>
                  <td className="rp-num rp-num-emph">{currency(m.net)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rp-section">
        <h3>Expenses by category</h3>
        {data.expensesByCategory.length === 0 ? (
          <div className="rp-empty">No expenses recorded.</div>
        ) : (
          <table className="rp-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="rp-num">Entries</th>
                <th className="rp-num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {data.expensesByCategory.map((c) => (
                <tr key={c.category}>
                  <td>{c.category}</td>
                  <td className="rp-num">{number(c.count)}</td>
                  <td className="rp-num">{currency(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {data.cogsByCategory && (
        <section className="rp-section">
          <h3>COGS by category</h3>
          <table className="rp-table">
            <thead>
              <tr>
                <th>Category</th>
                <th className="rp-num">COGS</th>
              </tr>
            </thead>
            <tbody>
              {data.cogsByCategory.map((c) => (
                <tr key={c.category}>
                  <td>{c.category}</td>
                  <td className="rp-num">{currency(c.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
const Reports = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("sales");
  const [reloadKey, setReloadKey] = useState(0);
  const [range, setRange] = useState(defaultRange());
  const [storeScope, setStoreScope] = useState({ storeType: "", storeId: "" });

  const filters = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      ...(storeScope.storeType ? { storeType: storeScope.storeType } : {}),
      ...(storeScope.storeId ? { storeId: storeScope.storeId } : {}),
    }),
    [range, storeScope]
  );

  const exportHref = useMemo(() => exportReportUrl(activeTab, filters), [activeTab, filters]);

  const tabs = useMemo(() => TABS, []);
  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);
  const quickRange = (days) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - (days - 1));
    setRange({ from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
  };

  return (
    <div className="rp-page">
      <header className="rp-header">
        <button type="button" className="rp-back-btn" onClick={() => navigate(-1)}>
          <FaArrowLeft /> Back
        </button>
        <div>
          <h1>Reports</h1>
          <p className="rp-subtitle">
            Sales summary, GST GSTR-1 view, and Profit & Loss — admin only.
          </p>
        </div>
      </header>

      <section className="rp-filters">
        <div className="rp-filters-left">
          <span className="rp-filter-icon">
            <FaCalendarAlt />
          </span>
          <div className="rp-filter-field">
            <label>From</label>
            <input
              type="date"
              max={range.to}
              value={range.from}
              onChange={(e) => setRange({ ...range, from: e.target.value })}
            />
          </div>
          <span className="rp-filter-dash">→</span>
          <div className="rp-filter-field">
            <label>To</label>
            <input
              type="date"
              min={range.from}
              max={today()}
              value={range.to}
              onChange={(e) => setRange({ ...range, to: e.target.value })}
            />
          </div>
          <div className="rp-quick-range">
            <button type="button" onClick={() => quickRange(7)}>
              7d
            </button>
            <button type="button" onClick={() => quickRange(30)}>
              30d
            </button>
            <button type="button" onClick={() => quickRange(90)}>
              90d
            </button>
          </div>
        </div>
        <div className="rp-filters-right">
          <div className="rp-filter-field">
            <label>Store</label>
            <input
              type="text"
              placeholder="storeType (e.g. hotel)"
              value={storeScope.storeType}
              onChange={(e) => setStoreScope({ ...storeScope, storeType: e.target.value })}
            />
          </div>
          <div className="rp-filter-field">
            <label>Store ID</label>
            <input
              type="text"
              placeholder="storeId (optional)"
              value={storeScope.storeId}
              onChange={(e) => setStoreScope({ ...storeScope, storeId: e.target.value })}
            />
          </div>
          <button type="button" className="rp-btn-primary" onClick={refresh}>
            <FaSearch /> Refresh
          </button>
          <a
            className="rp-btn-secondary"
            href={exportHref}
            download
            // The cookies go on the request automatically when the page is on the
            // same origin; for cross-origin dev, fetch the body and create a Blob
            // so the file is downloaded properly even if cookies need to ride
            // along. This keeps the working flow simple.
          >
            <FaDownload /> Export CSV
          </a>
        </div>
      </section>

      <nav className="rp-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            type="button"
            key={t.key}
            role="tab"
            aria-selected={activeTab === t.key}
            className={`rp-tab ${activeTab === t.key ? "rp-tab-active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      <section className="rp-panel">
        {activeTab === "sales" && <SalesTab filters={filters} reloadKey={reloadKey} />}
        {activeTab === "gst" && <GstTab filters={filters} reloadKey={reloadKey} />}
        {activeTab === "pnl" && <PnlTab filters={filters} reloadKey={reloadKey} />}
      </section>
    </div>
  );
};

export default Reports;
