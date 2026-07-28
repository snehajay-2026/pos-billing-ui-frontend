import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import "./InventoryDashboard.css";
import { getProducts, addProduct } from "../../services/productService";
import { getOrders } from "../../services/orderService";
import hotelService from "../../services/hotelService";
import { getUser } from "../../utils/auth";
import { useUi } from "../../context/UiContext";
import {
  FaBoxOpen,
  FaSearch,
  FaCheckCircle,
  FaExclamationTriangle,
  FaTimesCircle,
  FaBed,
  FaUtensils,
  FaTshirt,
  FaConciergeBell,
  FaStore,
  FaWarehouse,
  FaHeartbeat,
  FaMoneyBillWave,
  FaRupeeSign,
  FaChartPie,
  FaSyncAlt,
  FaArrowUp,
  FaArrowDown,
  FaFilter,
} from "react-icons/fa";

const diningCategories = ["Veg Menu", "Non Veg Menu", "Starter", "Chinese"];
const defaultLodgingRooms = [
  { id: "R101", name: "Room 101", beds: 2, status: "vacant", rate: 1200 },
  { id: "R102", name: "Room 102", beds: 2, status: "vacant", rate: 1200 },
  { id: "R201", name: "Room 201", beds: 3, status: "vacant", rate: 1800 },
  { id: "R301", name: "Room 301", beds: 4, status: "vacant", rate: 2400 },
];

const fmtINR = (num) =>
  `₹${Number(num || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const InventoryDashboard = () => {
  const [products, setProducts] = useState([]);
  const [lodgingRooms, setLodgingRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const navigate = useNavigate();
  const { showToast } = useUi();

  useEffect(() => {
    const user = getUser();
    if (!user || !user.storeType) {
      navigate("/login");
      return;
    }

    window.history.pushState({ inventory: true }, "", window.location.href);
    const handlePopState = (e) => {
      e.preventDefault && e.preventDefault();
      navigate("/pos", { replace: true });
    };
    window.addEventListener("popstate", handlePopState);

    const loadProducts = async () => {
      try {
        const data = await getProducts();
        setProducts(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error("Error loading products:", e);
        setProducts([]);
      }
    };

    const loadHotelLodgingRooms = async () => {
      // Seed synchronously from localStorage so the first paint is instant.
      try {
        const savedRooms = window.localStorage.getItem("hotel_lodging_rooms");
        if (savedRooms) {
          const parsed = JSON.parse(savedRooms);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setLodgingRooms(parsed);
          }
        } else {
          setLodgingRooms(defaultLodgingRooms);
        }
      } catch (e) {
        console.error("Error loading lodging rooms:", e);
        setLodgingRooms(defaultLodgingRooms);
      }
      // Then overwrite with the canonical server view so the room counts
      // reflect what other devices in the same store have saved.
      try {
        const resp = await hotelService.getRooms();
        if (Array.isArray(resp) && resp.length > 0) {
          setLodgingRooms(resp);
          try {
            window.localStorage.setItem("hotel_lodging_rooms", JSON.stringify(resp));
          } catch (e) {
            /* quota / private mode */
          }
        }
      } catch (err) {
        // Keep the local cache; the cashier still sees rooms in offline mode.
      }
    };

    const loadServiceOrders = async () => {
      try {
        const data = await getOrders("service");
        setProducts(Array.isArray(data) ? data : []);
      } catch (e) {
        console.error("Error loading service orders:", e);
        setProducts([]);
      }
    };

    const loadLaundryProducts = async () => {
      try {
        let data = await getProducts();
        let storedProducts = Array.isArray(data) ? data : [];
        if (storedProducts.length === 0) {
          const defaultProducts = [
            {
              name: "Wash and Fold - 5kg",
              price: 150,
              gst: 5,
              stock: 999,
              barcode: "LD-WF-5KG",
              category: "Washing",
            },
            {
              name: "Wash and Iron - 5kg",
              price: 220,
              gst: 5,
              stock: 999,
              barcode: "LD-WI-5KG",
              category: "Washing",
            },
            {
              name: "Dry Cleaning - Shirt",
              price: 100,
              gst: 12,
              stock: 999,
              barcode: "LD-DC-SHIRT",
              category: "Dry Cleaning",
            },
            {
              name: "Dry Cleaning - Suit",
              price: 350,
              gst: 12,
              stock: 999,
              barcode: "LD-DC-SUIT",
              category: "Dry Cleaning",
            },
            {
              name: "Steam Iron - Shirt",
              price: 25,
              gst: 5,
              stock: 999,
              barcode: "LD-SI-SHIRT",
              category: "Ironing",
            },
            {
              name: "Ironing - Shirt",
              price: 20,
              gst: 5,
              stock: 999,
              barcode: "LD-IR-SHIRT",
              category: "Ironing",
            },
            {
              name: "Ironing - Saree",
              price: 80,
              gst: 5,
              stock: 999,
              barcode: "LD-IR-SAREE",
              category: "Ironing",
            },
            {
              name: "Blanket Wash - Single",
              price: 180,
              gst: 5,
              stock: 999,
              barcode: "LD-BLANKET-S",
              category: "Household",
            },
            {
              name: "Blanket Wash - Double",
              price: 260,
              gst: 5,
              stock: 999,
              barcode: "LD-BLANKET-D",
              category: "Household",
            },
            {
              name: "Curtain Wash - Panel",
              price: 120,
              gst: 5,
              stock: 999,
              barcode: "LD-CURTAIN",
              category: "Household",
            },
            {
              name: "Shoe Cleaning",
              price: 150,
              gst: 5,
              stock: 999,
              barcode: "LD-SHOE",
              category: "Special Care",
            },
            {
              name: "Stain Removal",
              price: 60,
              gst: 5,
              stock: 999,
              barcode: "LD-STAIN",
              category: "Add-on",
            },
            {
              name: "Express Delivery",
              price: 80,
              gst: 5,
              stock: 999,
              barcode: "LD-EXPRESS",
              category: "Add-on",
            },
          ];
          const created = await Promise.all(
            defaultProducts.map((product) =>
              addProduct(product).catch((err) => {
                console.error("Failed to create default laundry product:", err);
                return null;
              })
            )
          );
          storedProducts = created.filter(Boolean);
        }
        setProducts(storedProducts);
      } catch (e) {
        console.error("Error loading laundry products:", e);
        setProducts([]);
      }
    };

    const refresh = async () => {
      setLoading(true);
      try {
        if (user.storeType === "laundry") {
          await loadLaundryProducts();
        } else if (user.storeType === "service" || user.storeType === "msme-service") {
          await loadServiceOrders();
        } else {
          await loadProducts();
          if (user.storeType === "hotel") {
            loadHotelLodgingRooms();
          }
        }
      } finally {
        setLoading(false);
      }
    };

    const onDataUpdated = async (e) => {
      if (e.detail === "orders" || e.detail === "products") {
        await refresh();
      }
    };

    const onLodgingRoomsUpdated = (e) => {
      if (Array.isArray(e?.detail)) {
        setLodgingRooms(e.detail);
        return;
      }
      loadHotelLodgingRooms();
    };

    const setup = async () => {
      await refresh();
      window.addEventListener("dataUpdated", onDataUpdated);
      window.addEventListener("hotel_lodging_rooms_updated", onLodgingRoomsUpdated);
    };
    setup();

    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("dataUpdated", onDataUpdated);
      window.removeEventListener("hotel_lodging_rooms_updated", onLodgingRoomsUpdated);
    };
  }, [navigate]);

  /* ================= LOW STOCK RULE ================= */
  const authUser = getUser();
  const getLowStockLimit = (productOrName) => {
    const product =
      typeof productOrName === "string" ? { name: productOrName } : productOrName || {};
    const name = (product.name || "").toLowerCase();

    if (typeof product.lowStockLimit === "number" && product.lowStockLimit > 0) {
      return product.lowStockLimit;
    }

    if (authUser && authUser.storeType === "laundry") {
      if (name.includes("washing")) return 10;
      if (name.includes("dry")) return 8;
      if (name.includes("iron")) return 12;
      return 10;
    }

    if (authUser && authUser.storeType === "hotel") {
      if (name.includes("veg")) return 30;
      if (name.includes("non")) return 30;
      if (name.includes("starter")) return 20;
      if (name.includes("chinese")) return 20;
      return 25;
    }

    if (["rice", "oil", "sugar", "atta", "wheat", "peanut"].some((n) => name.includes(n)))
      return 40;
    if (["tea", "coffee", "masala", "spice", "salt"].some((n) => name.includes(n))) return 10;
    return 20;
  };

  /* ================= DERIVED METRICS ================= */
  const user = authUser;
  const isLaundry = user && user.storeType === "laundry";
  const isHotel = user && user.storeType === "hotel";
  const isService = user && (user.storeType === "service" || user.storeType === "msme-service");
  const isRetail = user && user.storeType === "retail";

  const diningProducts = isHotel
    ? products.filter((product) => diningCategories.includes(product.category))
    : products;
  const occupiedRooms = lodgingRooms.filter((room) => room.status === "occupied");
  const vacantRooms = lodgingRooms.filter((room) => room.status !== "occupied");
  const lodgingRevenue = occupiedRooms.reduce((sum, room) => {
    const rate = Number(room.rate || 0);
    const nights = Number(room.nights || 1);
    return sum + rate * nights;
  }, 0);
  const lodgingOccupancy =
    lodgingRooms.length === 0 ? 0 : Math.round((occupiedRooms.length / lodgingRooms.length) * 100);

  const derived = useMemo(() => {
    let lowStockItems = [];
    let criticalStockItems = [];
    let healthyCount = 0;
    let inventoryHealth = 100;
    let pieData = [];
    let PIE_COLORS = ["#10b981", "#f59e0b", "#ef4444"];

    if (isLaundry) {
      criticalStockItems = products.filter(
        (p) => p.stock > 0 && p.stock < getLowStockLimit(p.name) * 0.5
      );
      lowStockItems = products.filter((p) => {
        const limit = getLowStockLimit(p.name);
        return p.stock > 0 && p.stock >= limit * 0.5 && p.stock < limit;
      });
      healthyCount = products.length - lowStockItems.length - criticalStockItems.length;
      inventoryHealth =
        products.length === 0 ? 100 : Math.round((healthyCount / products.length) * 100);
      pieData = [
        { name: "Healthy", value: healthyCount, key: "healthy" },
        { name: "Low", value: lowStockItems.length, key: "low" },
        { name: "Critical", value: criticalStockItems.length, key: "critical" },
      ];
    } else if (isService) {
      const pending = products.filter((p) => p.status === "pending").length;
      const inProgress = products.filter((p) => p.status === "in_progress").length;
      const completed = products.filter((p) => p.status === "completed").length;
      pieData = [
        { name: "Pending", value: pending, key: "pending" },
        { name: "In Progress", value: inProgress, key: "progress" },
        { name: "Completed", value: completed, key: "done" },
      ];
      PIE_COLORS = ["#f59e0b", "#3b82f6", "#10b981"];
      inventoryHealth =
        products.length === 0 ? 100 : Math.round((completed / products.length) * 100);
      lowStockItems = [];
      criticalStockItems = [];
      healthyCount = completed;
    } else {
      const stockItems = isHotel ? diningProducts : products;
      criticalStockItems = stockItems.filter(
        (p) => p.stock > 0 && p.stock < getLowStockLimit(p) * 0.5
      );
      lowStockItems = stockItems.filter((p) => {
        const limit = getLowStockLimit(p);
        return p.stock > 0 && p.stock >= limit * 0.5 && p.stock < limit;
      });
      healthyCount = stockItems.length - lowStockItems.length - criticalStockItems.length;
      inventoryHealth =
        stockItems.length === 0 ? 100 : Math.round((healthyCount / stockItems.length) * 100);
      pieData = [
        { name: "Healthy", value: healthyCount, key: "healthy" },
        { name: "Low", value: lowStockItems.length, key: "low" },
        { name: "Critical", value: criticalStockItems.length, key: "critical" },
      ];
    }

    return {
      lowStockItems,
      criticalStockItems,
      healthyCount,
      inventoryHealth,
      pieData,
      PIE_COLORS,
    };
  }, [products, isHotel, isLaundry, isService, diningProducts]);

  /* ================= ENRICHED ROW DATA ================= */
  const enrichedRows = useMemo(() => {
    const base = isHotel ? diningProducts : products;
    if (isService) {
      return base.map((o) => {
        let tone = "pending";
        if (o.status === "completed") tone = "healthy";
        else if (o.status === "in_progress") tone = "progress";
        return { ...o, _tone: tone, _label: o.status || "pending" };
      });
    }
    return base
      .map((p) => {
        const limit = getLowStockLimit(p);
        const stock = Number(p.stock || 0);
        let tone = "healthy";
        let label = "Healthy";
        if (stock <= 0) {
          tone = "out";
          label = "Out of stock";
        } else if (stock < limit * 0.5) {
          tone = "critical";
          label = "Critical";
        } else if (stock < limit) {
          tone = "low";
          label = "Low";
        }
        const pct = Math.min(100, Math.round((stock / Math.max(limit, 1)) * 100));
        return { ...p, _tone: tone, _label: label, _limit: limit, _pct: pct };
      })
      .filter((p) => (statusFilter === "all" ? true : p._tone === statusFilter))
      .filter((p) =>
        search.trim()
          ? (p.name || "").toLowerCase().includes(search.trim().toLowerCase()) ||
            (p.category || "").toLowerCase().includes(search.trim().toLowerCase()) ||
            (p.barcode || "").toLowerCase().includes(search.trim().toLowerCase())
          : true
      );
  }, [products, diningProducts, isHotel, isService, search, statusFilter]);

  /* ================= COPY PER STORE TYPE ================= */
  const heroCopy = useMemo(() => {
    if (isLaundry)
      return {
        title: "Laundry Inventory",
        subtitle:
          "Track service stock, low-stock thresholds and overall laundry health at a glance.",
        icon: <FaTshirt />,
      };
    if (isService)
      return {
        title: "Service Dashboard",
        subtitle: "Live status of every service order — pending, in-progress and completed.",
        icon: <FaConciergeBell />,
      };
    if (isHotel)
      return {
        title: "Hotel Inventory",
        subtitle: "Monitor menu item stock and room availability across lodging and dining.",
        icon: <FaStore />,
      };
    return {
      title: "Inventory Dashboard",
      subtitle: "A complete view of retail inventory health — stock, value, alerts and trends.",
      icon: <FaWarehouse />,
    };
  }, [isLaundry, isService, isHotel, isRetail]);

  /* ================= ACTIONS ================= */
  const handleRefresh = () => {
    window.dispatchEvent(new CustomEvent("dataUpdated", { detail: "products" }));
    showToast("info", "Refreshing inventory…");
  };

  /* ================= RENDER ================= */
  const { lowStockItems, criticalStockItems, healthyCount, inventoryHealth, pieData, PIE_COLORS } =
    derived;
  const totalInventoryValue = (isHotel ? diningProducts : products).reduce(
    (s, p) => s + Number(p.price || 0) * Number(p.stock || 0),
    0
  );
  const outOfStockCount = (isHotel ? diningProducts : products).filter(
    (p) => Number(p.stock || 0) <= 0
  ).length;

  return (
    <div className="inv-page">
      {/* Hero */}
      <header className="inv-hero">
        <div className="inv-hero-text">
          <span className="inv-eyebrow">
            <FaChartPie /> {user?.storeType?.toUpperCase() || "STORE"} · Live overview
          </span>
          <h2 className="inv-hero-title">
            {heroCopy.icon} {heroCopy.title}
          </h2>
          <p className="inv-hero-sub">{heroCopy.subtitle}</p>
        </div>
        <button type="button" className="inv-refresh-btn" onClick={handleRefresh}>
          <FaSyncAlt />
          <span>Refresh</span>
        </button>
      </header>

      {/* KPI tiles */}
      <section className="inv-tile-grid">
        {isService ? (
          <>
            <article className="inv-tile inv-tile-amber">
              <div className="inv-tile-icon">
                <FaExclamationTriangle />
              </div>
              <div className="inv-tile-meta">
                <span>Pending</span>
                <strong>{products.filter((p) => p.status === "pending").length}</strong>
              </div>
            </article>
            <article className="inv-tile inv-tile-blue">
              <div className="inv-tile-icon">
                <FaSyncAlt />
              </div>
              <div className="inv-tile-meta">
                <span>In Progress</span>
                <strong>{products.filter((p) => p.status === "in_progress").length}</strong>
              </div>
            </article>
            <article className="inv-tile inv-tile-emerald">
              <div className="inv-tile-icon">
                <FaCheckCircle />
              </div>
              <div className="inv-tile-meta">
                <span>Completed</span>
                <strong>{products.filter((p) => p.status === "completed").length}</strong>
              </div>
            </article>
            <article className="inv-tile inv-tile-violet">
              <div className="inv-tile-icon">
                <FaHeartbeat />
              </div>
              <div className="inv-tile-meta">
                <span>Service Health</span>
                <strong>{inventoryHealth}%</strong>
              </div>
            </article>
          </>
        ) : (
          <>
            <article className="inv-tile inv-tile-emerald">
              <div className="inv-tile-icon">
                <FaCheckCircle />
              </div>
              <div className="inv-tile-meta">
                <span>{isHotel ? "Healthy Dining Items" : "Healthy Items"}</span>
                <strong>{healthyCount}</strong>
              </div>
            </article>
            <article className="inv-tile inv-tile-amber">
              <div className="inv-tile-icon">
                <FaExclamationTriangle />
              </div>
              <div className="inv-tile-meta">
                <span>{isHotel ? "Low Stock Items" : "Low Stock"}</span>
                <strong>{lowStockItems.length}</strong>
              </div>
            </article>
            <article className="inv-tile inv-tile-red">
              <div className="inv-tile-icon">
                <FaTimesCircle />
              </div>
              <div className="inv-tile-meta">
                <span>{isHotel ? "Critical Dining Items" : "Critical"}</span>
                <strong>{criticalStockItems.length}</strong>
              </div>
            </article>
            <article className="inv-tile inv-tile-violet">
              <div className="inv-tile-icon">
                <FaHeartbeat />
              </div>
              <div className="inv-tile-meta">
                <span>{isHotel ? "Dining Health" : "Inventory Health"}</span>
                <strong>{inventoryHealth}%</strong>
                <small>
                  {outOfStockCount > 0 ? `${outOfStockCount} out of stock` : "All in stock"}
                </small>
              </div>
            </article>
            {isHotel && (
              <>
                <article className="inv-tile inv-tile-teal">
                  <div className="inv-tile-icon">
                    <FaBed />
                  </div>
                  <div className="inv-tile-meta">
                    <span>Vacant Rooms</span>
                    <strong>{vacantRooms.length}</strong>
                    <small>{occupiedRooms.length} occupied</small>
                  </div>
                </article>
                <article className="inv-tile inv-tile-indigo">
                  <div className="inv-tile-icon">
                    <FaBed />
                  </div>
                  <div className="inv-tile-meta">
                    <span>Lodging Occupancy</span>
                    <strong>{lodgingOccupancy}%</strong>
                    <small>{lodgingRooms.length} rooms total</small>
                  </div>
                </article>
              </>
            )}
            {!isHotel && !isLaundry && (
              <article className="inv-tile inv-tile-blue">
                <div className="inv-tile-icon">
                  <FaMoneyBillWave />
                </div>
                <div className="inv-tile-meta">
                  <span>Inventory Value</span>
                  <strong>{fmtINR(totalInventoryValue)}</strong>
                  <small>{products.length} SKUs</small>
                </div>
              </article>
            )}
          </>
        )}
      </section>

      {/* Hotel dual summary */}
      {isHotel && (
        <section className="inv-dual-grid">
          <div className="inv-summary-card inv-summary-blue">
            <div className="inv-summary-head">
              <div className="inv-summary-ico">
                <FaUtensils />
              </div>
              <div>
                <span className="inv-kicker">Dining</span>
                <h5>Menu Stock Control</h5>
                <p>Monitor menu item stock and low-stock limits used by hotel billing.</p>
              </div>
            </div>
            <div className="inv-summary-stats">
              <div>
                <strong>{diningProducts.length}</strong>
                <span>Menu Items</span>
              </div>
              <div>
                <strong>{lowStockItems.length + criticalStockItems.length}</strong>
                <span>Needs Attention</span>
              </div>
              <div>
                <strong>{inventoryHealth}%</strong>
                <span>Stock Health</span>
              </div>
            </div>
          </div>
          <div className="inv-summary-card inv-summary-green">
            <div className="inv-summary-head">
              <div className="inv-summary-ico">
                <FaBed />
              </div>
              <div>
                <span className="inv-kicker">Lodging</span>
                <h5>Room Availability</h5>
                <p>Track room occupancy and active lodging revenue from booked rooms.</p>
              </div>
            </div>
            <div className="inv-summary-stats">
              <div>
                <strong>{lodgingRooms.length}</strong>
                <span>Total Rooms</span>
              </div>
              <div>
                <strong>{occupiedRooms.length}</strong>
                <span>Occupied</span>
              </div>
              <div>
                <strong>{fmtINR(lodgingRevenue)}</strong>
                <span>Active Value</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Distribution + Health */}
      <section className="inv-two-col">
        <div className="inv-card">
          <div className="inv-card-head">
            <div>
              <h5>
                <FaChartPie className="inv-card-ico" /> Stock Distribution
              </h5>
              <p>How your inventory is split across status buckets.</p>
            </div>
          </div>
          {pieData.every((d) => d.value === 0) ? (
            <div className="inv-empty">
              <div className="inv-empty-illu">
                <FaChartPie />
              </div>
              <h6>No data yet</h6>
              <p>Inventory data will appear here once items are added.</p>
            </div>
          ) : (
            <div className="inv-chart">
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={62}
                    outerRadius={92}
                    paddingAngle={3}
                    stroke="#fff"
                    strokeWidth={3}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={PIE_COLORS[index]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: 12,
                      border: "1px solid rgba(15,23,42,0.08)",
                      boxShadow: "0 14px 32px rgba(15,23,42,0.12)",
                      fontWeight: 600,
                    }}
                  />
                  <Legend
                    iconType="circle"
                    verticalAlign="bottom"
                    wrapperStyle={{ paddingTop: 8, fontSize: "0.85rem", fontWeight: 600 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="inv-card">
          <div className="inv-card-head">
            <div>
              <h5>
                <FaHeartbeat className="inv-card-ico" /> Inventory Health
              </h5>
              <p>Live health score based on stock thresholds.</p>
            </div>
            <span
              className={`inv-count-pill ${
                inventoryHealth >= 75
                  ? "inv-pill-emerald"
                  : inventoryHealth >= 50
                    ? "inv-pill-amber"
                    : "inv-pill-red"
              }`}
            >
              {inventoryHealth >= 75 ? <FaArrowUp /> : <FaArrowDown />} {inventoryHealth}%
            </span>
          </div>
          <div className="inv-health-meter">
            <div className="inv-health-track">
              <div
                className={`inv-health-fill ${
                  inventoryHealth >= 75
                    ? "inv-fill-good"
                    : inventoryHealth >= 50
                      ? "inv-fill-warn"
                      : "inv-fill-bad"
                }`}
                style={{ width: `${Math.max(2, inventoryHealth)}%` }}
              />
            </div>
            <div className="inv-health-grid">
              <div className="inv-health-block inv-hb-good">
                <FaCheckCircle />
                <div>
                  <strong>{healthyCount}</strong>
                  <span>Healthy</span>
                </div>
              </div>
              <div className="inv-health-block inv-hb-warn">
                <FaExclamationTriangle />
                <div>
                  <strong>{lowStockItems.length}</strong>
                  <span>Low</span>
                </div>
              </div>
              <div className="inv-health-block inv-hb-bad">
                <FaTimesCircle />
                <div>
                  <strong>{criticalStockItems.length}</strong>
                  <span>Critical</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Toolbar + Table */}
      {!isService && (
        <section className="inv-toolbar">
          <div className="inv-search">
            <FaSearch />
            <input
              type="text"
              placeholder="Search by name, category or barcode…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="inv-filter-chips">
            <button
              type="button"
              className={`inv-chip ${statusFilter === "all" ? "is-active" : ""}`}
              onClick={() => setStatusFilter("all")}
            >
              <FaFilter /> All
            </button>
            <button
              type="button"
              className={`inv-chip ${statusFilter === "healthy" ? "is-active" : ""}`}
              onClick={() => setStatusFilter("healthy")}
            >
              Healthy
            </button>
            <button
              type="button"
              className={`inv-chip ${statusFilter === "low" ? "is-active" : ""}`}
              onClick={() => setStatusFilter("low")}
            >
              Low
            </button>
            <button
              type="button"
              className={`inv-chip ${statusFilter === "critical" ? "is-active" : ""}`}
              onClick={() => setStatusFilter("critical")}
            >
              Critical
            </button>
            <button
              type="button"
              className={`inv-chip ${statusFilter === "out" ? "is-active" : ""}`}
              onClick={() => setStatusFilter("out")}
            >
              Out
            </button>
          </div>
        </section>
      )}

      {/* Inventory table */}
      <section className="inv-card">
        <div className="inv-card-head">
          <div>
            <h5>
              <FaBoxOpen className="inv-card-ico" />{" "}
              {isLaundry
                ? "Laundry Service Inventory"
                : isHotel
                  ? "Hotel Dining Inventory"
                  : "Store Inventory"}
            </h5>
            <p>
              {enrichedRows.length} item{enrichedRows.length === 1 ? "" : "s"} shown
            </p>
          </div>
        </div>

        {loading ? (
          <div className="inv-skeleton-list">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="inv-skeleton-row" />
            ))}
          </div>
        ) : enrichedRows.length === 0 ? (
          <div className="inv-empty">
            <div className="inv-empty-illu">
              <FaBoxOpen />
            </div>
            <h6>No items to show</h6>
            <p>
              {products.length === 0
                ? "Add products from the Products page to see them here."
                : "Try a different search or clear filters."}
            </p>
          </div>
        ) : isService ? (
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Service</th>
                  <th className="inv-ta-center">Hours</th>
                  <th className="inv-ta-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {enrichedRows.map((o, idx) => (
                  <tr key={idx}>
                    <td>
                      <div className="inv-cell-name">
                        <span className="inv-avatar">{o.customer?.[0]?.toUpperCase() || "U"}</span>
                        <strong>{o.customer || "—"}</strong>
                      </div>
                    </td>
                    <td>{o.service}</td>
                    <td className="inv-ta-center inv-mono">{o.hours ?? "—"}</td>
                    <td className="inv-ta-center">
                      <span className={`inv-tone inv-tone-${o._tone}`}>{o._label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>{isHotel ? "Menu Item" : "Product"}</th>
                  <th className="inv-ta-center">Available</th>
                  <th className="inv-ta-center">Limit</th>
                  <th>Stock Level</th>
                  <th className="inv-ta-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {enrichedRows.map((p) => (
                  <tr key={p.id || p.name}>
                    <td>
                      <div className="inv-cell-name">
                        <span
                          className={`inv-cat-dot inv-cat-${(p.category || "default")
                            .toLowerCase()
                            .replace(/\s+/g, "-")}`}
                        />
                        <strong>{p.name}</strong>
                      </div>
                    </td>
                    <td className="inv-ta-center">
                      <strong className="inv-stock-num">
                        {Number(p.stock || 0).toLocaleString("en-IN")}
                      </strong>
                    </td>
                    <td className="inv-ta-center inv-mono">{p._limit}</td>
                    <td>
                      <div className="inv-progress">
                        <div
                          className={`inv-progress-fill inv-progress-${p._tone}`}
                          style={{ width: `${p._pct}%` }}
                        />
                      </div>
                    </td>
                    <td className="inv-ta-center">
                      <span className={`inv-tone inv-tone-${p._tone}`}>{p._label}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Hotel lodging rooms */}
      {isHotel && (
        <section className="inv-card">
          <div className="inv-card-head">
            <div>
              <h5>
                <FaBed className="inv-card-ico" /> Hotel Lodging Inventory
              </h5>
              <p>Real-time room availability and guest details.</p>
            </div>
            <span className="inv-count-pill inv-pill-blue">
              {lodgingRooms.length} room{lodgingRooms.length === 1 ? "" : "s"}
            </span>
          </div>
          {lodgingRooms.length === 0 ? (
            <div className="inv-empty">
              <div className="inv-empty-illu">
                <FaBed />
              </div>
              <h6>No lodging rooms available</h6>
              <p>Add rooms from the Lodging page to see them here.</p>
            </div>
          ) : (
            <div className="inv-room-grid">
              {lodgingRooms.map((room) => {
                const occupied = room.status === "occupied";
                return (
                  <article
                    key={room.id || room.name}
                    className={`inv-room ${occupied ? "is-occupied" : "is-vacant"}`}
                  >
                    <div className="inv-room-head">
                      <div>
                        <strong>{room.name || room.id}</strong>
                        <small>{room.beds ? `${room.beds} beds` : "—"}</small>
                      </div>
                      <span className={`inv-tone inv-tone-${occupied ? "critical" : "healthy"}`}>
                        {occupied ? "Occupied" : "Vacant"}
                      </span>
                    </div>
                    <div className="inv-room-body">
                      <div>
                        <span>Rate</span>
                        <strong>
                          <FaRupeeSign style={{ fontSize: "0.85em" }} />
                          {Number(room.rate || 0).toLocaleString("en-IN")}
                        </strong>
                      </div>
                      <div>
                        <span>Guest</span>
                        <strong>{occupied ? room.guest || "Guest" : "—"}</strong>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default InventoryDashboard;
