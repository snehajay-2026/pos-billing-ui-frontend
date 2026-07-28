import React, { useState, useEffect, useMemo } from "react";
import { getOrders } from "../services/orderService";
import hotelService from "../services/hotelService";
import { resolveLaundryStatus, orderGrandTotal } from "../components/laundry/laundryStatus";
import { bucketRoomsByHousekeeping, isRoomSellable } from "../components/hotel/housekeeping";
import { expectedCheckOut } from "../components/hotel/folio";
import Layout from "../components/layout/Layout";
import "chart.js/auto";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import {
  FaRupeeSign,
  FaFileInvoice,
  FaMoneyBillWave,
  FaMobileAlt,
  FaUserShield,
  FaCheck,
  FaBed,
  FaUtensils,
  FaTshirt,
  FaBroom,
  FaCalendarDay,
  FaArrowUp,
  FaArrowDown,
  FaChartLine,
  FaBoxOpen,
  FaWallet,
  FaReceipt,
  FaClock,
  FaSyncAlt,
  FaStore,
} from "react-icons/fa";
import { BsBoxSeam, BsLightningChargeFill } from "react-icons/bs";
import { getUser, getUserStoreType } from "../utils/auth";
import "./DashboardUI.css";

import ServiceList from "../components/service/ServiceList";
import { getInvoices } from "../services/invoiceService";
import { getServices } from "../services/serviceService";
import { getUsers, updateUser } from "../services/userService";
import { useUi } from "../context/UiContext";

const getRoleLabel = (role) => {
  if (role === "STORE_ADMIN") return "BRANCH ADMIN";
  if (!role) return "";
  return role.replace(/_/g, " ");
};

const fmt = (num) => (Number(num) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const fmtINR = (num) => `₹${fmt(num)}`;

const filterInvoices = (invoices, filter) => {
  const now = new Date();
  if (filter === "DAILY") {
    const today = now.toISOString().split("T")[0];
    return invoices.filter((inv) => inv.date === today);
  }
  if (filter === "WEEKLY") {
    const last7 = new Date();
    last7.setDate(now.getDate() - 7);
    return invoices.filter((inv) => new Date(inv.date) >= last7);
  }
  if (filter === "MONTHLY") {
    return invoices.filter((inv) => {
      const d = new Date(inv.date);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
  }
  return invoices;
};

const detectCategory = (name) => {
  const n = (name || "").toLowerCase();
  if (n.includes("rice") || n.includes("wheat") || n.includes("atta")) return "Grains";
  if (n.includes("oil") || n.includes("ghee")) return "Oils";
  if (n.includes("sugar") || n.includes("jaggery")) return "Sweeteners";
  if (n.includes("masala") || n.includes("spice")) return "Masala";
  return "Other";
};

const greetingFor = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

const formatDate = () => {
  const d = new Date();
  return d.toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

/* =====================================================================
   Top-Products / Top-Services — modern ranked list with progress bars
   ===================================================================== */
function TopProducts({ invoices }) {
  const productMap = {};
  invoices.forEach((inv) => {
    (inv.items || []).forEach((item) => {
      if (!item.name) return;
      const qty = Number(item.qty ?? item.qtyKg ?? 1) || 1;
      productMap[item.name] = (productMap[item.name] || 0) + (item.price || 0) * qty;
    });
  });
  const sorted = Object.entries(productMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (sorted.length === 0)
    return (
      <div className="db-empty-mini">
        <BsBoxSeam />
        <span>No product data yet</span>
      </div>
    );
  const max = sorted[0][1] || 1;
  return (
    <ul className="db-rank">
      {sorted.map(([name, amt], i) => {
        const pct = Math.max(8, Math.round((amt / max) * 100));
        return (
          <li key={name}>
            <span className={`db-rank-num db-rank-${i + 1}`}>{i + 1}</span>
            <div className="db-rank-body">
              <div className="db-rank-head">
                <strong>{name}</strong>
                <span>{fmtINR(amt)}</span>
              </div>
              <div className="db-rank-track">
                <div className="db-rank-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function TopServices({ invoices }) {
  const serviceMap = {};
  invoices.forEach((inv) => {
    (inv.items || []).forEach((item) => {
      if (!item.serviceDescription) return;
      serviceMap[item.serviceDescription] =
        (serviceMap[item.serviceDescription] || 0) + (item.amount || 0);
    });
  });
  const sorted = Object.entries(serviceMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (sorted.length === 0)
    return (
      <div className="db-empty-mini">
        <BsLightningChargeFill />
        <span>No service data yet</span>
      </div>
    );
  const max = sorted[0][1] || 1;
  return (
    <ul className="db-rank">
      {sorted.map(([name, amt], i) => {
        const pct = Math.max(8, Math.round((amt / max) * 100));
        return (
          <li key={name}>
            <span className={`db-rank-num db-rank-${i + 1}`}>{i + 1}</span>
            <div className="db-rank-body">
              <div className="db-rank-head">
                <strong>{name}</strong>
                <span>{fmtINR(amt)}</span>
              </div>
              <div className="db-rank-track">
                <div className="db-rank-fill" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* =====================================================================
   Animated counter (used inside modern tile)
   ===================================================================== */
const useCountUp = (value, duration = 900) => {
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    const end =
      typeof value === "number" ? value : Number(String(value).replace(/[^\d.-]/g, "")) || 0;
    const start = 0;
    const t0 = performance.now();
    let raf;
    const tick = (now) => {
      const p = Math.min((now - t0) / duration, 1);
      const cur = start + (end - start) * p;
      setDisplay(
        typeof value === "number"
          ? cur
          : String(value).replace(
              /[\d,.]+/,
              cur.toLocaleString("en-IN", { maximumFractionDigits: 2 })
            )
      );
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return display;
};

const Tile = ({ icon, label, value, tone = "blue", trend, sub }) => {
  const animated = useCountUp(typeof value === "number" ? value : 0);
  const display = typeof value === "number" ? animated.toLocaleString("en-IN") : value;
  return (
    <article className={`db-tile db-tile-${tone}`}>
      <div className="db-tile-icon">{icon}</div>
      <div className="db-tile-meta">
        <span>{label}</span>
        <strong>{display}</strong>
        {sub ? <small>{sub}</small> : null}
      </div>
      {trend ? (
        <div className={`db-trend db-trend-${trend.kind || "up"}`}>
          {trend.kind === "down" ? <FaArrowDown /> : <FaArrowUp />}
          <span>{trend.text}</span>
        </div>
      ) : null}
    </article>
  );
};

const Dashboard = ({ storeType }) => {
  const [filter, setFilter] = useState("DAILY");
  const [invoiceData, setInvoiceData] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [approvalError, setApprovalError] = useState("");
  const [now, setNow] = useState(new Date());

  const loadInvoices = async () => {
    try {
      const invoices = await getInvoices();
      setInvoiceData(Array.isArray(invoices) ? invoices : []);
    } catch (err) {
      console.error("Failed to load invoices:", err);
      setInvoiceData([]);
    }
  };

  const loadPendingUsers = async () => {
    try {
      const currentUser = getUser();
      const adminRoles = ["SUPER_OWNER", "STORE_ADMIN", "ADMIN"];
      const admin = adminRoles.includes(currentUser?.role);
      setIsAdmin(admin);
      if (!admin) {
        setPendingUsers([]);
        return;
      }
      const users = await getUsers();
      setPendingUsers(Array.isArray(users) ? users.filter((user) => !user.approved) : []);
      setApprovalError("");
    } catch (err) {
      setPendingUsers([]);
      setApprovalError(err.message || "Unable to load pending users");
    }
  };

  const { activeStore, showToast } = useUi();
  const currentStoreType = activeStore?.storeType || storeType || getUserStoreType();
  const showHotelSummaries = currentStoreType === "hotel";
  const showLaundrySummaries = currentStoreType === "laundry";
  const adminName = (getUser()?.name || getUser()?.email || "Admin").split("@")[0];

  /* ------------------ live clock ------------------ */
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  /* ------------------ Laundry stats ------------------ */
  const [laundryStats, setLaundryStats] = useState({
    ready: 0,
    inProcess: 0,
    received: 0,
    overdue: 0,
    todayRevenue: 0,
    todayCount: 0,
  });

  const loadLaundryStats = async () => {
    if (!showLaundrySummaries) {
      setLaundryStats({
        ready: 0,
        inProcess: 0,
        received: 0,
        overdue: 0,
        todayRevenue: 0,
        todayCount: 0,
      });
      return;
    }
    try {
      const orders = await getOrders("laundry");
      const list = Array.isArray(orders) ? orders : [];
      const todayKey = new Date().toISOString().split("T")[0];
      const counts = { ready: 0, inProcess: 0, received: 0 };
      let overdue = 0;
      let todayRevenue = 0;
      let todayCount = 0;
      list.forEach((order) => {
        const status = resolveLaundryStatus(order.status);
        if (status.value === "ready") counts.ready += 1;
        else if (status.value === "in_process") counts.inProcess += 1;
        else if (status.value === "received") counts.received += 1;
        if (
          order.expectedReturn &&
          status.value !== "delivered" &&
          status.value !== "cancelled" &&
          String(order.expectedReturn) < todayKey
        ) {
          overdue += 1;
        }
        if (
          order.invoiceNo &&
          order.updatedAt &&
          String(order.updatedAt).split("T")[0] === todayKey
        ) {
          todayRevenue += orderGrandTotal(order);
          todayCount += 1;
        }
      });
      setLaundryStats({ ...counts, overdue, todayRevenue, todayCount });
    } catch (err) {
      console.error("Failed to load laundry stats:", err);
      setLaundryStats({
        ready: 0,
        inProcess: 0,
        received: 0,
        overdue: 0,
        todayRevenue: 0,
        todayCount: 0,
      });
    }
  };

  useEffect(() => {
    const refresh = () => loadLaundryStats();
    refresh();
    const handler = (e) => {
      if (!e || !e.detail || e.detail === "orders" || e.detail === "invoices") refresh();
    };
    window.addEventListener("dataUpdated", handler);
    window.addEventListener("activeStoreChanged", handler);
    return () => {
      window.removeEventListener("dataUpdated", handler);
      window.removeEventListener("activeStoreChanged", handler);
    };
  }, [showLaundrySummaries]);

  /* ------------------ Hotel HK stats ------------------ */
  const [hotelHkStats, setHotelHkStats] = useState({
    sellable: 0,
    occupied: 0,
    dirty: 0,
    dueOutToday: 0,
    total: 0,
  });

  const loadHotelHkStats = (roomsOverride) => {
    if (!showHotelSummaries) {
      setHotelHkStats({ sellable: 0, occupied: 0, dirty: 0, dueOutToday: 0, total: 0 });
      return;
    }
    try {
      // Caller can pass an explicit rooms list (e.g. from the server fetch
      // below); otherwise fall back to the localStorage cache for the
      // synchronous event-driven refresh path.
      const rooms = Array.isArray(roomsOverride)
        ? roomsOverride
        : (() => {
            const raw = window.localStorage.getItem("hotel_lodging_rooms");
            return raw ? JSON.parse(raw) : [];
          })();
      if (!Array.isArray(rooms)) {
        setHotelHkStats({ sellable: 0, occupied: 0, dirty: 0, dueOutToday: 0, total: 0 });
        return;
      }
      const buckets = bucketRoomsByHousekeeping(rooms);
      const todayKey = new Date().toISOString().split("T")[0];
      let dueOutToday = 0;
      rooms.forEach((room) => {
        if (room.status !== "occupied") return;
        const ts = expectedCheckOut(room);
        if (!Number.isNaN(ts.getTime()) && ts.toISOString().split("T")[0] === todayKey)
          dueOutToday += 1;
      });
      setHotelHkStats({
        sellable: rooms.filter((r) => isRoomSellable(r)).length,
        occupied: rooms.filter((r) => r.status === "occupied").length,
        dirty: buckets.dirty.length,
        dueOutToday,
        total: rooms.length,
      });
    } catch (err) {
      setHotelHkStats({ sellable: 0, occupied: 0, dirty: 0, dueOutToday: 0, total: 0 });
    }
  };

  useEffect(() => {
    loadHotelHkStats();
    // Server-first fetch — pick up rooms that other devices in the same
    // store just edited. Without this, the Dashboard's hotel KPIs only
    // reflect rooms the cashier has touched on this browser.
    let mounted = true;
    (async () => {
      try {
        const resp = await hotelService.getRooms();
        if (!mounted) return;
        if (Array.isArray(resp) && resp.length > 0) {
          // Re-cache to localStorage so other tabs see the same view.
          try {
            window.localStorage.setItem("hotel_lodging_rooms", JSON.stringify(resp));
          } catch (e) {
            /* quota / private mode */
          }
          loadHotelHkStats(resp);
        }
      } catch (err) {
        // keep localStorage values
      }
    })();
    const handler = () => loadHotelHkStats();
    window.addEventListener("hotel_lodging_rooms_updated", handler);
    window.addEventListener("activeStoreChanged", handler);
    window.addEventListener("storage", handler);
    return () => {
      mounted = false;
      window.removeEventListener("hotel_lodging_rooms_updated", handler);
      window.removeEventListener("activeStoreChanged", handler);
      window.removeEventListener("storage", handler);
    };
  }, [showHotelSummaries]);

  /* ------------------ Invoices + users ------------------ */
  useEffect(() => {
    loadInvoices();
    loadPendingUsers();
    const onCustom = (e) => {
      if (e.detail === "invoices") loadInvoices();
      if (e.detail === "users") loadPendingUsers();
    };
    window.addEventListener("dataUpdated", onCustom);
    return () => window.removeEventListener("dataUpdated", onCustom);
  }, [activeStore]);

  const invoices = filterInvoices(invoiceData, filter);

  /* ------------------ Derived metrics ------------------ */
  const today = new Date().toISOString().split("T")[0];

  const metrics = useMemo(() => {
    const todaySales = invoices
      .filter((inv) => inv.date === today)
      .reduce((sum, inv) => sum + inv.grandTotal, 0);
    const totalInvoices = invoices.length;
    const cashSales = invoices
      .filter((inv) => inv.paymentMode === "Cash")
      .reduce((sum, inv) => sum + inv.grandTotal, 0);
    const upiSales = invoices
      .filter((inv) => inv.paymentMode === "UPI")
      .reduce((sum, inv) => sum + inv.grandTotal, 0);
    const avgBill = totalInvoices
      ? invoices.reduce((s, i) => s + i.grandTotal, 0) / totalInvoices
      : 0;
    return { todaySales, totalInvoices, cashSales, upiSales, avgBill };
  }, [invoices, today]);

  /* ------------------ Hotel-derived ------------------ */
  const hotelItems = invoices.flatMap((inv) => (Array.isArray(inv.items) ? inv.items : []));
  const isLodgingItem = (item) => {
    if (!item) return false;
    const category = String(item.category || "").toLowerCase();
    return (
      item.type === "lodging" ||
      category.includes("lodging") ||
      Boolean(item.meta?.roomId) ||
      Boolean(item.meta?.roomNumber)
    );
  };
  const isDiningItem = (item) => {
    if (!item) return false;
    const category = String(item.category || "").toLowerCase();
    return (
      item.type === "dining" ||
      category.includes("dining") ||
      Boolean(item.meta?.tableId) ||
      Boolean(item.meta?.tableName)
    );
  };
  const lodgingItems = hotelItems.filter(isLodgingItem);
  const diningItems = hotelItems.filter(isDiningItem);
  const lodgingInvoices = invoices.filter(
    (inv) => Array.isArray(inv.items) && inv.items.some(isLodgingItem)
  ).length;
  const diningInvoices = invoices.filter(
    (inv) => Array.isArray(inv.items) && inv.items.some(isDiningItem)
  ).length;
  const lodgingSales = lodgingItems.reduce(
    (sum, item) => sum + Number(item.total ?? item.amount ?? (item.price || 0) * (item.qty || 1)),
    0
  );
  const diningSales = diningItems.reduce(
    (sum, item) => sum + Number(item.total ?? item.amount ?? (item.price || 0) * (item.qty || 1)),
    0
  );
  const lodgingGuests = lodgingItems.reduce(
    (sum, item) => sum + Number(item.meta?.members || item.meta?.partySize || 0),
    0
  );
  const diningCovers = diningItems.reduce(
    (sum, item) => sum + Number(item.meta?.partySize || 0),
    0
  );

  const approveUser = async (userId) => {
    try {
      await updateUser(userId, { approved: true });
      loadPendingUsers();
      window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "users" }));
      showToast("success", "Member approved");
    } catch (err) {
      setApprovalError(err.message || "Unable to approve user");
      showToast("error", "Unable to approve user");
    }
  };

  /* ------------------ Chart data ------------------ */
  const dailySalesMap = {};
  invoices.forEach((inv) => {
    dailySalesMap[inv.date] = (dailySalesMap[inv.date] || 0) + inv.grandTotal;
  });
  const sortedDays = Object.keys(dailySalesMap).sort();

  const lineData = {
    labels: sortedDays,
    datasets: [
      {
        label: "Daily Sales (₹)",
        data: sortedDays.map((d) => dailySalesMap[d]),
        borderColor: "#6366f1",
        backgroundColor: (ctx) => {
          const { chart } = ctx;
          const { ctx: c, chartArea } = chart;
          if (!chartArea) return "rgba(99,102,241,0.18)";
          const g = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          g.addColorStop(0, "rgba(99,102,241,0.32)");
          g.addColorStop(1, "rgba(99,102,241,0)");
          return g;
        },
        tension: 0.4,
        borderWidth: 2.5,
        pointRadius: 4,
        pointBackgroundColor: "#fff",
        pointBorderColor: "#6366f1",
        pointBorderWidth: 2,
        fill: true,
      },
    ],
  };

  const categoryTotals = {};
  invoices.forEach((inv) => {
    (inv.items || []).forEach((item) => {
      const cat = detectCategory(item.name);
      const amt = (item.price || 0) * (item.qtyKg || item.qty || 1);
      categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
    });
  });
  const palette = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];
  const pieData = {
    labels: Object.keys(categoryTotals),
    datasets: [
      {
        data: Object.values(categoryTotals),
        backgroundColor: Object.keys(categoryTotals).map((_, i) => palette[i % palette.length]),
        borderColor: "#fff",
        borderWidth: 3,
        hoverOffset: 8,
      },
    ],
  };

  const monthly = new Array(12).fill(0);
  invoices.forEach((inv) => {
    const d = new Date(inv.date);
    if (!Number.isNaN(d.getTime())) monthly[d.getMonth()] += inv.grandTotal || 0;
  });
  const monthGrad = (ctx) => {
    const { chart } = ctx;
    const { ctx: c, chartArea } = chart;
    if (!chartArea) return "rgba(99,102,241,0.7)";
    const g = c.createLinearGradient(0, chartArea.bottom, 0, chartArea.top);
    g.addColorStop(0, "rgba(99,102,241,0.35)");
    g.addColorStop(1, "rgba(99,102,241,0.95)");
    return g;
  };
  const barData = {
    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    datasets: [
      {
        label: "Monthly Sales (₹)",
        data: monthly,
        backgroundColor: monthGrad,
        borderRadius: 10,
        maxBarThickness: 28,
      },
    ],
  };

  const lineOpts = {
    plugins: { legend: { display: false }, tooltip: { intersect: false, mode: "index" } },
    maintainAspectRatio: false,
    scales: {
      x: { grid: { display: false }, ticks: { color: "#64748b" } },
      y: { grid: { color: "rgba(15,23,42,0.06)" }, ticks: { color: "#64748b" } },
    },
  };
  const barOpts = {
    plugins: { legend: { display: false } },
    maintainAspectRatio: false,
    scales: {
      x: { grid: { display: false }, ticks: { color: "#64748b" } },
      y: { grid: { color: "rgba(15,23,42,0.06)" }, ticks: { color: "#64748b" } },
    },
  };
  const pieOpts = {
    plugins: {
      legend: {
        position: "bottom",
        labels: { color: "#475569", padding: 14, usePointStyle: true, font: { weight: 600 } },
      },
    },
    cutout: "65%",
    maintainAspectRatio: false,
  };

  /* ------------------ Top-by-amount decorations ------------------ */
  const paymentTotal = metrics.cashSales + metrics.upiSales || 1;
  const cashPct = Math.round((metrics.cashSales / paymentTotal) * 100);
  const upiPct = 100 - cashPct;

  return (
    <Layout>
      <div className="db-page">
        {/* Hero */}
        <header className="db-hero">
          <div className="db-hero-text">
            <span className="db-eyebrow">
              <FaStore /> {currentStoreType ? currentStoreType.toUpperCase() : "RETAIL"} · Admin
            </span>
            <h2 className="db-hero-title">
              {greetingFor()}, {adminName} <span className="db-wave">👋</span>
            </h2>
            <p className="db-hero-sub">
              {formatDate()} · Live overview of sales, operations & approvals.
            </p>
            <div className="db-hero-clock">
              <FaClock />{" "}
              <span>{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
          <div className="db-filter-row">
            {[
              { key: "DAILY", label: "Daily" },
              { key: "WEEKLY", label: "Weekly" },
              { key: "MONTHLY", label: "Monthly" },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                className={`db-pill ${filter === opt.key ? "is-active" : ""}`}
                onClick={() => setFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
            <button
              type="button"
              className="db-pill db-pill-ghost"
              onClick={() => {
                loadInvoices();
                loadLaundryStats();
                loadHotelHkStats();
                loadPendingUsers();
                showToast("info", "Dashboard refreshed");
              }}
              title="Refresh"
            >
              <FaSyncAlt />
              <span>Refresh</span>
            </button>
          </div>
        </header>

        {/* Service-section override for MSME */}
        {storeType === "msme-service" && (
          <section className="db-section-card">
            <ServiceList services={getServices()} />
          </section>
        )}

        {/* Main KPI tiles */}
        <section className="db-tile-grid">
          <Tile
            icon={<FaRupeeSign />}
            tone="blue"
            label="Today Sales"
            value={metrics.todaySales}
            sub={`Avg bill ${fmtINR(metrics.avgBill)}`}
          />
          <Tile
            icon={<FaFileInvoice />}
            tone="violet"
            label="Total Invoices"
            value={metrics.totalInvoices}
            sub="this period"
          />
          <Tile
            icon={<FaMoneyBillWave />}
            tone="emerald"
            label="Cash Sales"
            value={metrics.cashSales}
            sub={`${cashPct}% of mixed`}
          />
          <Tile
            icon={<FaMobileAlt />}
            tone="amber"
            label="UPI Sales"
            value={metrics.upiSales}
            sub={`${upiPct}% of mixed`}
          />
        </section>

        {/* Laundry Operational */}
        {showLaundrySummaries && (
          <section className="db-tile-grid">
            <Tile
              icon={<FaTshirt />}
              tone="violet"
              label="Ready for Pickup"
              value={laundryStats.ready}
              sub="awaiting customer"
            />
            <Tile
              icon={<FaTshirt />}
              tone="blue"
              label="In Process"
              value={laundryStats.inProcess + laundryStats.received}
              sub={`${laundryStats.inProcess} processing · ${laundryStats.received} received`}
            />
            <Tile
              icon={<FaBroom />}
              tone="red"
              label="Overdue"
              value={laundryStats.overdue}
              sub="past expected return"
            />
            <Tile
              icon={<FaRupeeSign />}
              tone="emerald"
              label="Today's Laundry Revenue"
              value={`₹${fmt(laundryStats.todayRevenue)}`}
              sub={`${laundryStats.todayCount} orders today`}
            />
          </section>
        )}

        {/* Hotel Summary cards */}
        {showHotelSummaries && (
          <>
            <section className="db-section-grid">
              <div className="db-section-card db-section-green">
                <div className="db-section-head">
                  <div className="db-section-ico">
                    <FaBed />
                  </div>
                  <div>
                    <h5>Lodging Summary</h5>
                    <p>Rooms, bookings and revenue from hotel lodging.</p>
                  </div>
                </div>
                <div className="db-section-stats">
                  <div>
                    <span>Bookings</span>
                    <strong>{lodgingInvoices}</strong>
                  </div>
                  <div>
                    <span>Room items</span>
                    <strong>{lodgingItems.length}</strong>
                  </div>
                  <div>
                    <span>Guest count</span>
                    <strong>{lodgingGuests}</strong>
                  </div>
                  <div>
                    <span>Revenue</span>
                    <strong>₹{fmt(lodgingSales)}</strong>
                  </div>
                </div>
              </div>
              <div className="db-section-card db-section-rose">
                <div className="db-section-head">
                  <div className="db-section-ico">
                    <FaUtensils />
                  </div>
                  <div>
                    <h5>Dining Summary</h5>
                    <p>Order volumes and revenue from hotel dining operations.</p>
                  </div>
                </div>
                <div className="db-section-stats">
                  <div>
                    <span>Dining bills</span>
                    <strong>{diningInvoices}</strong>
                  </div>
                  <div>
                    <span>Menu items</span>
                    <strong>{diningItems.length}</strong>
                  </div>
                  <div>
                    <span>Covers</span>
                    <strong>{diningCovers}</strong>
                  </div>
                  <div>
                    <span>Revenue</span>
                    <strong>₹{fmt(diningSales)}</strong>
                  </div>
                </div>
              </div>
            </section>

            <section className="db-tile-grid">
              <Tile
                icon={<FaCheck />}
                tone="emerald"
                label="Sellable Rooms"
                value={hotelHkStats.sellable}
                sub={`of ${hotelHkStats.total} total`}
              />
              <Tile
                icon={<FaBed />}
                tone="violet"
                label="In-House Guests"
                value={hotelHkStats.occupied}
                sub="currently checked-in"
              />
              <Tile
                icon={<FaBroom />}
                tone="amber"
                label="Dirty Rooms"
                value={hotelHkStats.dirty}
                sub="needs housekeeping"
              />
              <Tile
                icon={<FaCalendarDay />}
                tone="red"
                label="Due Out Today"
                value={hotelHkStats.dueOutToday}
                sub="expected check-outs"
              />
            </section>
          </>
        )}

        {/* Charts grid */}
        <section className="db-charts">
          <div className="db-chart-card">
            <div className="db-chart-head">
              <div>
                <h5>Daily Sales</h5>
                <p>Revenue trend over the selected period.</p>
              </div>
              <span className="db-chart-badge">
                <FaChartLine /> trend
              </span>
            </div>
            <div className="db-chart-body">
              <Line data={lineData} options={lineOpts} />
            </div>
          </div>
          <div className="db-chart-card">
            <div className="db-chart-head">
              <div>
                <h5>Category Sales</h5>
                <p>Mix of revenue by inferred category.</p>
              </div>
              <span className="db-chart-badge db-chart-badge-violet">
                <FaBoxOpen /> mix
              </span>
            </div>
            <div className="db-chart-body">
              <Doughnut data={pieData} options={pieOpts} />
            </div>
          </div>
          <div className="db-chart-card">
            <div className="db-chart-head">
              <div>
                <h5>Monthly Sales</h5>
                <p>Year-to-date performance by month.</p>
              </div>
              <span className="db-chart-badge db-chart-badge-emerald">
                <FaWallet /> YTD
              </span>
            </div>
            <div className="db-chart-body">
              <Bar data={barData} options={barOpts} />
            </div>
          </div>
        </section>

        {/* Two-col: top list + pending approvals */}
        <section className="db-two-col">
          <div className="db-list-card">
            <div className="db-card-head">
              <div>
                <h5>
                  <BsBoxSeam className="db-card-ico" />{" "}
                  {storeType === "msme-service" ? "Top Services" : "Top Products"}
                </h5>
                <p>Best performers in the selected period.</p>
              </div>
            </div>
            {storeType === "msme-service" ? (
              <TopServices invoices={invoices} />
            ) : (
              <TopProducts invoices={invoices} />
            )}
          </div>

          {isAdmin ? (
            <div className="db-list-card db-approval-card">
              <div className="db-card-head">
                <div>
                  <h5>
                    <FaUserShield className="db-card-ico" /> Pending Member Approvals
                  </h5>
                  <p>Approve new members before they can log in.</p>
                </div>
                {pendingUsers.length > 0 && (
                  <span className="db-count-pill">{pendingUsers.length} pending</span>
                )}
              </div>
              {approvalError && <div className="db-error-box">{approvalError}</div>}
              {pendingUsers.length === 0 ? (
                <div className="db-empty-mini">
                  <FaCheck />
                  <span>No pending members at this time.</span>
                </div>
              ) : (
                <ul className="db-approval-list">
                  {pendingUsers.map((user) => (
                    <li key={user.id}>
                      <div className="db-approval-info">
                        <span className="db-avatar">{user.email?.[0]?.toUpperCase() || "U"}</span>
                        <div>
                          <strong>{user.email}</strong>
                          <div className="db-approval-meta">
                            <span>{getRoleLabel(user.role)}</span>
                            <span>·</span>
                            <span>{user.storeType}</span>
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="db-btn-approve"
                        onClick={() => approveUser(user.id)}
                      >
                        <FaCheck />
                        <span>Approve</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="db-list-card db-payment-card">
              <div className="db-card-head">
                <div>
                  <h5>
                    <FaReceipt className="db-card-ico" /> Payment Mix
                  </h5>
                  <p>How revenue is split across methods.</p>
                </div>
              </div>
              <div className="db-payment-bars">
                <div>
                  <div className="db-payment-head">
                    <span>
                      <FaMoneyBillWave /> Cash
                    </span>
                    <strong>{cashPct}%</strong>
                  </div>
                  <div className="db-payment-track">
                    <div
                      className="db-payment-fill db-fill-cash"
                      style={{ width: `${cashPct}%` }}
                    />
                  </div>
                  <small>{fmtINR(metrics.cashSales)}</small>
                </div>
                <div>
                  <div className="db-payment-head">
                    <span>
                      <FaMobileAlt /> UPI
                    </span>
                    <strong>{upiPct}%</strong>
                  </div>
                  <div className="db-payment-track">
                    <div className="db-payment-fill db-fill-upi" style={{ width: `${upiPct}%` }} />
                  </div>
                  <small>{fmtINR(metrics.upiSales)}</small>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Invoice Table */}
        <section className="db-table-card">
          <div className="db-card-head">
            <div>
              <h5>
                <FaFileInvoice className="db-card-ico" /> Invoices
              </h5>
              <p>Recent activity in the selected period.</p>
            </div>
            <span className="db-count-pill db-count-pill-blue">
              {invoices.length} invoice{invoices.length === 1 ? "" : "s"}
            </span>
          </div>
          {invoices.length === 0 ? (
            <div className="db-empty">
              <div className="db-empty-illu">
                <FaFileInvoice />
              </div>
              <h6>No invoices found</h6>
              <p>Invoices you generate will appear here.</p>
            </div>
          ) : (
            <div className="db-table-wrap">
              <table className="db-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Invoice No</th>
                    <th>Date</th>
                    <th>Payment</th>
                    <th className="db-ta-right">Total (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {[...invoices]
                    .reverse()
                    .slice(0, 50)
                    .map((inv, i) => (
                      <tr key={inv.invoiceNo}>
                        <td className="db-mono">{i + 1}</td>
                        <td className="db-mono">{inv.invoiceNo}</td>
                        <td>{inv.date}</td>
                        <td>
                          <span
                            className={`db-mode-pill db-mode-${
                              (inv.paymentMode || "").toLowerCase() || "cash"
                            }`}
                          >
                            {inv.paymentMode || "Cash"}
                          </span>
                        </td>
                        <td className="db-ta-right">
                          <strong>{fmt(inv.grandTotal)}</strong>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Layout>
  );
};

export default Dashboard;
