import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/layout/Layout";
import KpiCard from "../components/dashboard/KpiCard";
import {
  FaRupeeSign,
  FaReceipt,
  FaHourglassHalf,
  FaCalculator,
  FaConciergeBell,
  FaChartLine,
  FaUserTie,
  FaCalendarAlt,
  FaSearch,
  FaSync,
  FaArrowRight,
  FaUserCircle,
  FaPercentage,
} from "react-icons/fa";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import "chart.js/auto";
import { getInvoices } from "../services/invoiceService";
import { getServices } from "../services/serviceService";
import { useUi } from "../context/UiContext";
import { STATUS_LABELS, computeStatus } from "../components/invoice/ServiceInvoice";
import "./ServiceAdminDashboard.css";

/* ---------- formatters ---------- */
const inr = (n) =>
  `₹${(Number(n) || 0).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
const num = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

const today = () => new Date().toISOString().split("T")[0];
const ymd = (d) => new Date(d).toISOString().split("T")[0];

const RANGE_PILLS = [
  { key: "TODAY", label: "Today" },
  { key: "WEEK", label: "This Week" },
  { key: "MONTH", label: "This Month" },
  { key: "YEAR", label: "This Year" },
  { key: "CUSTOM", label: "Custom" },
];

const CHART_PALETTE = [
  "#4f46e5",
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#ec4899",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
];

/* ---------- date-range helpers ---------- */
const buildRange = (range, customFrom, customTo) => {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);

  if (range === "TODAY") {
    start.setHours(0, 0, 0, 0);
  } else if (range === "WEEK") {
    start.setDate(now.getDate() - 6);
    start.setHours(0, 0, 0, 0);
  } else if (range === "MONTH") {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  } else if (range === "YEAR") {
    start.setMonth(0, 1);
    start.setHours(0, 0, 0, 0);
  } else if (range === "CUSTOM") {
    if (customFrom) start.setTime(new Date(customFrom).getTime());
    else start.setHours(0, 0, 0, 0);
    if (customTo) end.setTime(new Date(customTo).getTime() + 24 * 3600 * 1000 - 1);
  }

  return { start, end };
};

const filterInvoices = (invoices, range, customFrom, customTo) => {
  const { start, end } = buildRange(range, customFrom, customTo);
  return (invoices || []).filter((inv) => {
    const t = new Date(inv.date || inv.createdAt || 0).getTime();
    return Number.isFinite(t) && t >= start.getTime() && t <= end.getTime();
  });
};

const initialsFromName = (name = "") => {
  const parts = String(name).trim().split(/\s+/);
  const first = (parts[0] || "").charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last || "?").toUpperCase();
};

/* ---------- aggregations ---------- */
const aggregateDaily = (invoices, days = 30) => {
  const map = {};
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    map[ymd(d)] = 0;
  }
  invoices.forEach((inv) => {
    const k = ymd(inv.date || new Date());
    if (k in map) map[k] += Number(inv.grandTotal) || 0;
  });
  return map;
};

const aggregateMonthly = (invoices) => {
  const buckets = new Array(12).fill(0);
  const labels = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const now = new Date();
  invoices.forEach((inv) => {
    const d = new Date(inv.date || inv.createdAt || 0);
    if (Number.isNaN(d.getTime())) return;
    if (d.getFullYear() === now.getFullYear()) buckets[d.getMonth()] += Number(inv.grandTotal) || 0;
  });
  return { labels, buckets };
};

const aggregateByService = (invoices) => {
  const map = {};
  invoices.forEach((inv) => {
    (inv.items || []).forEach((item) => {
      const key = item.serviceDescription || item.name || "Unnamed service";
      const units = Number(item.hours ?? item.qty ?? item.qtyKg ?? item.units ?? 1) || 1;
      const rate = Number(item.rate ?? item.price ?? 0) || 0;
      map[key] = (map[key] || 0) + units * rate;
    });
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
};

const aggregateByTechnician = (invoices) => {
  const map = {};
  invoices.forEach((inv) => {
    const tech =
      inv.technician ||
      inv.assignedTo ||
      (inv.items || []).map((i) => i.technician).find(Boolean) ||
      "Unassigned";
    map[tech] = (map[tech] || 0) + (Number(inv.grandTotal) || 0);
  });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
};

const aggregateByPaymentMode = (invoices) => {
  const map = {};
  invoices.forEach((inv) => {
    const mode = inv.paymentMode || inv.paymentMethod || inv.payment || "Cash";
    map[mode] = (map[mode] || 0) + (Number(inv.grandTotal) || 0);
  });
  return Object.entries(map);
};

const computePending = (invoices) => {
  return invoices.filter((inv) => {
    const totalDue = Number(inv.grandTotal) || 0;
    const status = computeStatus(inv, totalDue);
    return status?.label !== "PAID";
  });
};

const todayTotal = (invoices) => {
  const t = today();
  return invoices
    .filter((inv) => inv.date === t)
    .reduce((s, inv) => s + (Number(inv.grandTotal) || 0), 0);
};

const mtdTotal = (invoices) => {
  const now = new Date();
  return invoices
    .filter((inv) => {
      const d = new Date(inv.date || 0);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, inv) => s + (Number(inv.grandTotal) || 0), 0);
};

const avgBillValue = (invoices) =>
  invoices.length === 0
    ? 0
    : invoices.reduce((s, inv) => s + (Number(inv.grandTotal) || 0), 0) / invoices.length;

const formatDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

/* ---------- component ---------- */
const ServiceAdminDashboard = () => {
  const [invoices, setInvoices] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [range, setRange] = useState("MONTH");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [search, setSearch] = useState("");
  const { activeStore } = useUi();

  const load = async () => {
    setLoading(true);
    try {
      const [invs, srvs] = await Promise.all([getInvoices(), getServices()]);
      setInvoices(Array.isArray(invs) ? invs : []);
      setServices(Array.isArray(srvs) ? srvs : []);
    } catch (err) {
      console.error("Failed to load service dashboard data", err);
      setInvoices([]);
      setServices([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (cancelled) return;
      await load();
    };
    run();
    const onDataUpdated = (e) => {
      if (e?.detail === "invoices" || e?.detail === "services") load();
    };
    window.addEventListener("dataUpdated", onDataUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener("dataUpdated", onDataUpdated);
    };
  }, [activeStore]);

  const invoicesForRange = useMemo(
    () => filterInvoices(invoices, range, customFrom, customTo),
    [invoices, range, customFrom, customTo]
  );

  const todaysRevenue = useMemo(() => todayTotal(invoices), [invoices]);
  const monthRevenue = useMemo(() => mtdTotal(invoices), [invoices]);
  const pendingInvoices = useMemo(() => computePending(invoicesForRange), [invoicesForRange]);
  const avg = useMemo(() => avgBillValue(invoicesForRange), [invoicesForRange]);

  const dailySeries = useMemo(() => aggregateDaily(invoicesForRange, 30), [invoicesForRange]);
  const dailyLabels = Object.keys(dailySeries);
  const dailyValues = Object.values(dailySeries);

  const monthlySeries = useMemo(() => aggregateMonthly(invoices), [invoices]);

  const topServices = useMemo(() => aggregateByService(invoicesForRange), [invoicesForRange]);
  const topTechnicians = useMemo(() => aggregateByTechnician(invoicesForRange), [invoicesForRange]);
  const paymentModes = useMemo(() => aggregateByPaymentMode(invoicesForRange), [invoicesForRange]);

  const recentInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...invoices].sort((a, b) => {
      const ta = new Date(a.date || a.createdAt || 0).getTime();
      const tb = new Date(b.date || b.createdAt || 0).getTime();
      return tb - ta;
    });
    if (!q) return sorted.slice(0, 10);
    return sorted
      .filter((inv) => {
        const hay = [
          inv.invoiceNo,
          inv.customerName,
          inv.customer,
          inv.customerPhone,
          inv.technician,
          inv.paymentMode,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 10);
  }, [invoices, search]);

  /* chart data */
  const dailyChartData = {
    labels: dailyLabels.map((d) => {
      const dt = new Date(d);
      return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }),
    datasets: [
      {
        label: "Revenue",
        data: dailyValues,
        borderColor: CHART_PALETTE[0],
        backgroundColor: CHART_PALETTE[0] + "33",
        tension: 0.35,
        fill: true,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      },
    ],
  };

  const dailyChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => inr(ctx.parsed.y) } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
      y: { grid: { color: "rgba(15, 23, 42, 0.06)" }, ticks: { callback: (v) => `₹${num(v)}` } },
    },
  };

  const topServicesChartData = {
    labels: topServices.map(([name]) => name),
    datasets: [
      {
        data: topServices.map(([, v]) => v),
        backgroundColor: CHART_PALETTE,
        borderColor: "#ffffff",
        borderWidth: 2,
      },
    ],
  };

  const topServicesChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "62%",
    plugins: {
      legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${inr(ctx.parsed)}` } },
    },
  };

  const techniciansChartData = {
    labels: topTechnicians.map(([name]) => name),
    datasets: [
      {
        label: "Revenue",
        data: topTechnicians.map(([, v]) => v),
        backgroundColor: CHART_PALETTE.slice(1, 6),
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 28,
      },
    ],
  };

  const techniciansChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: "y",
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => inr(ctx.parsed.x) } },
    },
    scales: {
      x: { grid: { color: "rgba(15, 23, 42, 0.06)" }, ticks: { callback: (v) => `₹${num(v)}` } },
      y: { grid: { display: false } },
    },
  };

  const paymentChartData = {
    labels: paymentModes.map(([m]) => m),
    datasets: [
      {
        data: paymentModes.map(([, v]) => v),
        backgroundColor: CHART_PALETTE,
        borderColor: "#ffffff",
        borderWidth: 2,
      },
    ],
  };

  const paymentChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "62%",
    plugins: {
      legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 11 } } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${inr(ctx.parsed)}` } },
    },
  };

  const monthlyChartData = {
    labels: monthlySeries.labels,
    datasets: [
      {
        label: "Revenue",
        data: monthlySeries.buckets,
        backgroundColor: CHART_PALETTE[0] + "cc",
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 32,
      },
    ],
  };

  const monthlyChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (ctx) => inr(ctx.parsed.y) } },
    },
    scales: {
      x: { grid: { display: false } },
      y: { grid: { color: "rgba(15, 23, 42, 0.06)" }, ticks: { callback: (v) => `₹${num(v)}` } },
    },
  };

  const rangeLabel = RANGE_PILLS.find((r) => r.key === range)?.label || "This Month";
  const rangeStart = formatDate(buildRange(range, customFrom, customTo).start);
  const rangeEnd = formatDate(buildRange(range, customFrom, customTo).end);

  return (
    <Layout>
      <div className="dashboard-page sd-page">
        {/* HERO */}
        <div className="sd-hero">
          <div className="sd-hero-bg" aria-hidden="true" />
          <div className="sd-hero-content">
            <div className="sd-hero-text">
              <div className="sd-hero-eyebrow">
                <FaConciergeBell /> <span>Service Operations</span>
              </div>
              <h1 className="sd-hero-title">Service Admin Dashboard</h1>
              <p className="sd-hero-subtitle">
                Track revenue, top services, technician performance, and outstanding bills —
                everything that keeps a service business humming.
              </p>
              <div className="sd-hero-meta">
                <span className="sd-hero-pill tone-emerald">
                  <FaReceipt /> {services.length} services in catalogue
                </span>
                <span className="sd-hero-pill tone-amber">
                  <FaHourglassHalf /> {pendingInvoices.length} pending bills
                </span>
                <span className="sd-hero-pill tone-sky">
                  <FaCalendarAlt /> {rangeLabel} · {rangeStart} → {rangeEnd}
                </span>
              </div>
            </div>

            <div className="sd-hero-actions">
              <button
                type="button"
                className="sd-icon-btn"
                onClick={load}
                title="Refresh data"
                aria-label="Refresh"
              >
                <FaSync />
              </button>
            </div>
          </div>

          <div className="sd-range-row">
            {RANGE_PILLS.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`sd-range-pill ${range === p.key ? "active" : ""}`}
                onClick={() => setRange(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>

          {range === "CUSTOM" && (
            <div className="sd-custom-range">
              <label className="sd-date-field">
                <span>From</span>
                <input
                  type="date"
                  className="sd-date-input"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                />
              </label>
              <label className="sd-date-field">
                <span>To</span>
                <input
                  type="date"
                  className="sd-date-input"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                />
              </label>
              <button
                type="button"
                className="sd-range-pill active"
                onClick={() => {
                  /* reactively drives via state — this button is just for tactile feedback */
                }}
                disabled={!customFrom && !customTo}
              >
                Apply
              </button>
            </div>
          )}
        </div>

        {/* KPI ROW */}
        <div className="kpi-grid sd-kpis">
          <KpiCard title="Today's Revenue" value={todaysRevenue} icon={<FaRupeeSign />} animate />
          <KpiCard title="MTD Revenue" value={monthRevenue} icon={<FaChartLine />} animate />
          <KpiCard
            title="Pending Invoices"
            value={pendingInvoices.length}
            icon={<FaHourglassHalf />}
            animate
          />
          <KpiCard title="Avg. Bill Value" value={avg} icon={<FaCalculator />} animate />
        </div>

        {/* PRIMARY CHARTS */}
        <div className="chart-grid sd-chart-grid">
          <section className="chart-card tone-sky">
            <header className="chart-card-header">
              <span className="chart-card-icon">
                <FaChartLine />
              </span>
              <div>
                <h3>Daily revenue</h3>
                <p>
                  Last {dailyLabels.length} days · {rangeLabel}
                </p>
              </div>
            </header>
            <div className="chart-card-body">
              {dailyValues.every((v) => v === 0) ? (
                <EmptyChart label="No invoices in this range yet." />
              ) : (
                <Line data={dailyChartData} options={dailyChartOptions} />
              )}
            </div>
          </section>

          <section className="chart-card tone-violet">
            <header className="chart-card-header">
              <span className="chart-card-icon">
                <FaConciergeBell />
              </span>
              <div>
                <h3>Top services</h3>
                <p>Best sellers · {rangeLabel}</p>
              </div>
            </header>
            <div className="chart-card-body">
              {topServices.length === 0 ? (
                <EmptyChart label="No service sales in this range yet." />
              ) : (
                <Doughnut data={topServicesChartData} options={topServicesChartOptions} />
              )}
            </div>
          </section>

          <section className="chart-card tone-amber">
            <header className="chart-card-header">
              <span className="chart-card-icon">
                <FaUserTie />
              </span>
              <div>
                <h3>Technician leaderboard</h3>
                <p>Revenue by service provider · {rangeLabel}</p>
              </div>
            </header>
            <div className="chart-card-body">
              {topTechnicians.length === 0 ? (
                <EmptyChart label="No technician data in this range." />
              ) : (
                <Bar data={techniciansChartData} options={techniciansChartOptions} />
              )}
            </div>
          </section>
        </div>

        {/* SECONDARY CHARTS */}
        <div className="chart-grid sd-chart-grid">
          <section className="chart-card tone-emerald">
            <header className="chart-card-header">
              <span className="chart-card-icon">
                <FaPercentage />
              </span>
              <div>
                <h3>Payment mode split</h3>
                <p>Where the money is coming from · {rangeLabel}</p>
              </div>
            </header>
            <div className="chart-card-body">
              {paymentModes.length === 0 ? (
                <EmptyChart label="No payments recorded in this range." />
              ) : (
                <Doughnut data={paymentChartData} options={paymentChartOptions} />
              )}
            </div>
          </section>

          <section className="chart-card tone-rose">
            <header className="chart-card-header">
              <span className="chart-card-icon">
                <FaChartLine />
              </span>
              <div>
                <h3>Monthly revenue ({new Date().getFullYear()})</h3>
                <p>Year-to-date trend</p>
              </div>
            </header>
            <div className="chart-card-body">
              {monthlySeries.buckets.every((v) => v === 0) ? (
                <EmptyChart label="No revenue recorded this year." />
              ) : (
                <Bar data={monthlyChartData} options={monthlyChartOptions} />
              )}
            </div>
          </section>
        </div>

        {/* RECENT INVOICES TABLE */}
        <section className="table-card sd-table-card">
          <header className="chart-card-header">
            <span className="chart-card-icon">
              <FaReceipt />
            </span>
            <div className="sd-table-card-meta">
              <h3>Recent invoices</h3>
              <p>Latest 10 across all dates</p>
            </div>
            <div className="sd-table-card-actions">
              <div className="sd-search">
                <FaSearch />
                <input
                  type="text"
                  placeholder="Search invoice, customer, technician…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label="Search invoices"
                />
              </div>
              <Link to="/invoices" className="sd-view-all">
                View all <FaArrowRight />
              </Link>
            </div>
          </header>

          {loading && recentInvoices.length === 0 ? (
            <div className="sd-empty">
              <div className="sd-spinner" aria-hidden="true" />
              <p>Loading recent invoices…</p>
            </div>
          ) : recentInvoices.length === 0 ? (
            <div className="sd-empty">
              <div className="sd-empty-icon">
                <FaReceipt />
              </div>
              <strong>No invoices found</strong>
              <span>Try clearing the search or generate an invoice from the Service POS.</span>
            </div>
          ) : (
            <div className="sd-table-wrap">
              <table className="sd-table">
                <thead>
                  <tr>
                    <th>Invoice</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Technician</th>
                    <th>Services</th>
                    <th>Payment</th>
                    <th className="sd-amount-col">Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recentInvoices.map((inv) => {
                    const status = computeStatus(inv, Number(inv.grandTotal) || 0);
                    const customerName = inv.customerName || inv.customer || "Walk-in";
                    return (
                      <tr key={inv.invoiceNo}>
                        <td>
                          <Link
                            to={`/invoice/${inv.invoiceNo}/preview`}
                            className="sd-invoice-link"
                          >
                            {inv.invoiceNo}
                          </Link>
                        </td>
                        <td className="sd-muted">{formatDate(inv.date)}</td>
                        <td>
                          <div className="sd-customer">
                            <div className="sd-avatar">{initialsFromName(customerName)}</div>
                            <div className="sd-customer-meta">
                              <strong>{customerName}</strong>
                              <span>{inv.customerPhone || inv.customerEmail || "—"}</span>
                            </div>
                          </div>
                        </td>
                        <td className="sd-muted">{inv.technician || inv.assignedTo || "—"}</td>
                        <td className="sd-muted">{(inv.items || []).length}</td>
                        <td className="sd-muted">
                          {inv.paymentMode || inv.paymentMethod || "Cash"}
                        </td>
                        <td className="sd-amount-col sd-strong">{inr(inv.grandTotal)}</td>
                        <td>
                          {status ? (
                            <span className={`sd-status-pill ${status.tone}`}>
                              <span className={`sd-status-dot ${status.tone}`} />
                              {status.label}
                            </span>
                          ) : (
                            <span className="sd-status-pill pending">
                              <span className="sd-status-dot pending" />
                              PENDING
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* FOOTNOTE */}
        <p className="sd-footnote">
          <FaUserCircle /> Data is scoped to the active service store. Switch stores in the header
          to view another store's revenue and invoices.
        </p>
      </div>
    </Layout>
  );
};

const EmptyChart = ({ label }) => (
  <div className="sd-chart-empty">
    <span>{label}</span>
  </div>
);

export default ServiceAdminDashboard;
