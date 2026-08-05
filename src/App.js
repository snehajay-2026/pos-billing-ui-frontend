import React, { Suspense, lazy, useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import { loadCurrentUser } from "./services/authService";
import { API_BASE } from "./services/api";
import {
  connectRealtimeSync,
  disconnectRealtimeSync,
} from "./services/realtimeSync";
import Login from "./pages/Login";
import PasswordReset from "./pages/PasswordReset";
import RequireAuth from "./components/common/RequireAuth";
import RoleRedirect from "./components/common/RoleRedirect";
import ProtectedRoute from "./components/common/ProtectedRoute";
import Register from "./pages/Register";
import InvoiceView from "./components/invoice/InvoiceView";
import Layout from "./components/layout/Layout";
import Toasts from "./components/common/Toasts";
import WelcomeSplash from "./components/common/WelcomeSplash";
import AppErrorBoundary from "./components/common/AppErrorBoundary";
import RouteFallback from "./components/common/RouteFallback";
import { getStoreSettings, loadStoreSettings } from "./services/storeSettingsService";

// Routes below are eagerly loaded because they're small, on the critical
// first-paint path, or are deep-link landing pages the user lands on directly
// from a URL (no time to lazy-load on first hit).
//
// Everything else is React.lazy() — the chunk downloads only when the user
// actually navigates there. Cuts first-load JS for users who, say, only use
// the POS — they never download the dashboard, hotel, laundry, or service
// admin code.

// --- Lazy-loaded route components ---
const POSPage = lazy(() => import("./pages/POSPage"));
const InvoicePage = lazy(() => import("./pages/InvoicePage"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const ServiceOrderPage = lazy(() => import("./pages/ServiceOrderPage"));
const ProductPage = lazy(() => import("./pages/ProductPage"));
const HotelDiningPage = lazy(() => import("./pages/HotelDiningPage"));
const HotelLodgingPage = lazy(() => import("./pages/HotelLodgingPage"));
const HotelTableBookingPage = lazy(() => import("./pages/HotelTableBookingPage"));
const InventoryDashboard = lazy(() => import("./components/inventory/InventoryDashboard"));
const StoreSettings = lazy(() => import("./pages/StoreSettings"));
const LaundryOrderPage = lazy(() => import("./pages/LaundryOrderPage"));
const LaundryServicePage = lazy(() => import("./pages/LaundryServicePage"));
const LaundryInventoryPage = lazy(() => import("./pages/LaundryInventoryPage"));
const ServiceManagementPage = lazy(() => import("./pages/ServiceManagementPage"));
const HotelHousekeepingPage = lazy(() => import("./pages/HotelHousekeepingPage"));
const PrintMenuPage = lazy(() => import("./pages/PrintMenuPage"));
const CashFlowPage = lazy(() => import("./pages/CashFlowPage"));
const UserManagement = lazy(() => import("./pages/UserManagement"));
const CustomerManagement = lazy(() => import("./pages/CustomerManagement"));
const ServiceAdminDashboard = lazy(() => import("./pages/ServiceAdminDashboard"));
const RecentActivity = lazy(() => import("./pages/RecentActivity"));
const Reports = lazy(() => import("./pages/Reports"));
const InventoryModule = lazy(() => import("./pages/InventoryModule"));
const ShiftsPage = lazy(() => import("./pages/ShiftsPage"));
const HotelModuleAccessPage = lazy(() => import("./pages/HotelModuleAccessPage"));
const HotelModuleLockScreen = lazy(() => import("./components/hotel/HotelModuleLockScreen"));
import { useHotelModuleLock } from "./hooks/useHotelModuleLock";

const ThemeListener = () => {
  const location = useLocation();

  useEffect(() => {
    const applyTheme = () => {
      const settings = getStoreSettings();
      const themeClass = `theme-${settings.theme || "classic"}`;
      document.body.classList.remove("theme-classic", "theme-dark", "theme-minimal");
      document.body.classList.add(themeClass);
    };

    applyTheme();
    window.addEventListener("storage", applyTheme);
    window.addEventListener("themeChanged", applyTheme);

    return () => {
      window.removeEventListener("storage", applyTheme);
      window.removeEventListener("themeChanged", applyTheme);
    };
  }, [location.pathname]);

  return null;
};

// Error boundary needs the current pathname so it can clear its error state
// when the user navigates away from a broken page. Lives as a tiny wrapper
// rather than pulling useLocation() inside the class component.
//
// Note: the boundary MUST wrap <Routes>, not <Toasts />. Otherwise a render
// error inside any page component white-screens the app.
const AppErrorBoundaryWithLocation = ({ children }) => {
  const location = useLocation();
  return <AppErrorBoundary locationPathname={location.pathname}>{children}</AppErrorBoundary>;
};

// Global listener for the "sessionExpired" event fired by services/api.js when
// any session-protected request returns 401. Redirects to /login with a
// ?reason=expired flag the Login page surfaces as a flash alert.
//
// Safari (and other privacy-strict browsers) can briefly drop the
// third-party session cookie on cross-origin deploys (Vercel -> Render).
// A single momentary 401 is no longer enough to kick the user out: we
// require TWO 401s within a 6-second window, then redirect. This stops
// page reloads, fresh tabs, and other transient cookie misses from
// forcing a re-login while still catching a truly dead session.
const PUBLIC_PATH_PREFIXES = ["/login", "/register", "/password-reset"];
const SESSION_EXPIRY_DEBOUNCE_MS = 6000;
const SESSION_EXPIRY_THRESHOLD = 2;

const SessionExpiredListener = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const expiryCountRef = useRef(0);
  const firstExpiryAtRef = useRef(0);
  const redirectTimerRef = useRef(null);

  useEffect(() => {
    const handler = () => {
      const path = location.pathname || "";
      if (
        path === "/" ||
        PUBLIC_PATH_PREFIXES.some((p) => path === p || path.startsWith(p + "/"))
      ) {
        // Already on a public page — no-op.
        expiryCountRef.current = 0;
        firstExpiryAtRef.current = 0;
        return;
      }

      const now = Date.now();
      // Reset the counter if the gap from the previous 401 is too long.
      if (now - firstExpiryAtRef.current > SESSION_EXPIRY_DEBOUNCE_MS) {
        expiryCountRef.current = 1;
        firstExpiryAtRef.current = now;
      } else {
        expiryCountRef.current += 1;
      }

      if (expiryCountRef.current >= SESSION_EXPIRY_THRESHOLD) {
        // Two or more 401s within 6s -> session is genuinely dead.
        if (redirectTimerRef.current) {
          window.clearTimeout(redirectTimerRef.current);
          redirectTimerRef.current = null;
        }
        expiryCountRef.current = 0;
        firstExpiryAtRef.current = 0;
        navigate("/login?reason=expired", { replace: true });
        return;
      }

      // Below the threshold: schedule a redirect after the debounce
      // window in case no further 401 arrives (e.g. last 401 of a dead
      // session). If another 401 arrives within the window, the
      // threshold branch above fires instead.
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
      }
      redirectTimerRef.current = window.setTimeout(() => {
        if (expiryCountRef.current > 0) {
          expiryCountRef.current = 0;
          firstExpiryAtRef.current = 0;
          navigate("/login?reason=expired", { replace: true });
        }
        redirectTimerRef.current = null;
      }, SESSION_EXPIRY_DEBOUNCE_MS);
    };
    window.addEventListener("sessionExpired", handler);
    return () => {
      window.removeEventListener("sessionExpired", handler);
      if (redirectTimerRef.current) {
        window.clearTimeout(redirectTimerRef.current);
        redirectTimerRef.current = null;
      }
    };
  }, [navigate, location.pathname]);

  return null;
};

// RequireHotelModule — wraps a hotel page and shows the lock screen
// when the matching module is disabled by the Super Owner. The
// Super Owner still sees the underlying page (bypassForSuperOwner is
// passed through so the lock screen can show an "unlock" CTA
// instead of a hard block).
const RequireHotelModule = ({ module, children }) => {
  const lock = useHotelModuleLock();
  // While loading or for non-hotel users, just render children.
  if (lock.isLoading) return null;
  const locked =
    module === "lodging"
      ? lock.lodgingLocked
      : module === "dining"
        ? lock.diningLocked
        : lock.liveBillLocked;
  if (!locked) return children;
  return (
    <Layout>
      <HotelModuleLockScreen
        module={module}
        customerEmail={lock.customerEmail}
        bypassForSuperOwner={lock.bypassForSuperOwner}
      />
    </Layout>
  );
};

function App() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const bootstrapApp = async () => {
      // Both calls are best-effort. On a cold start the user is unauthenticated
      // so each returns 401 — that's normal pre-login behavior and we simply
      // proceed without user/settings until login. The browser still logs the
      // 401 in DevTools (unavoidable from JS), but the app no longer errors.
      await loadCurrentUser().catch(() => null);
      await loadStoreSettings().catch(() => null);
      setLoaded(true);
      window.dispatchEvent(new Event("themeChanged"));
    };

    bootstrapApp();
  }, []);

  // SSE bootstrap: open a real-time channel as soon as the user signs in
  // and the active store is known. Re-open when the store changes; close
  // on logout. Cross-device sync: hotel bookings, room bookings, live
  // bills, and occupancy changes broadcast to every connected tab.
  useEffect(() => {
    let scopeStoreType = null;
    let scopeStoreId = null;

    const readScope = () => {
      try {
        const stored = window.localStorage.getItem("active_store_context");
        if (stored) {
          const parsed = JSON.parse(stored);
          scopeStoreType = parsed?.storeType || null;
          scopeStoreId = parsed?.storeId || null;
          return;
        }
      } catch {
        /* ignore */
      }
      try {
        const auth = JSON.parse(window.localStorage.getItem("pos_billing_user") || "null");
        scopeStoreType = auth?.storeType || null;
        scopeStoreId = auth?.storeId || auth?.storeType || null;
      } catch {
        /* ignore */
      }
    };

    const connect = () => {
      if (!API_BASE) return;
      const user = JSON.parse(window.localStorage.getItem("pos_billing_user") || "null");
      if (!user || !user.email || user.email === "nouser") return;
      readScope();
      connectRealtimeSync({
        apiBase: API_BASE,
        storeType: scopeStoreType,
        storeId: scopeStoreId,
      });
    };

    const onAuthChanged = () => {
      const user = JSON.parse(window.localStorage.getItem("pos_billing_user") || "null");
      if (!user || !user.email || user.email === "nouser") {
        disconnectRealtimeSync();
      } else {
        connect();
      }
    };

    const onStoreChanged = () => connect();

    window.addEventListener("authChanged", onAuthChanged);
    window.addEventListener("activeStoreChanged", onStoreChanged);
    window.addEventListener("storage", onAuthChanged);

    // Initial connect if the user is already logged in (e.g. hard refresh
    // with a valid session — loadCurrentUser already happened above).
    connect();

    return () => {
      window.removeEventListener("authChanged", onAuthChanged);
      window.removeEventListener("activeStoreChanged", onStoreChanged);
      window.removeEventListener("storage", onAuthChanged);
    };
  }, [loaded]);

    bootstrapApp();
  }, []);

  if (!loaded) {
    return <div className="loading-screen">Loading…</div>;
  }

  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <ThemeListener />
      <SessionExpiredListener />
      <Toasts />
      <WelcomeSplash />
      <AppErrorBoundaryWithLocation>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* DEFAULT ROUTE → ALWAYS GO TO LOGIN */}
            <Route path="/" element={<Navigate to="/login" replace />} />

            {/* LOGIN PAGE */}
            <Route path="/login" element={<Login />} />

            {/* AFTER LOGIN → AUTO REDIRECT BASED ON ROLE */}
            <Route
              path="/home"
              element={
                <RequireAuth>
                  <RoleRedirect />
                </RequireAuth>
              }
            />

            {/* POS BILLING PAGE */}
            <Route
              path="/pos"
              element={
                <RequireAuth>
                  <POSPage />
                </RequireAuth>
              }
            />

            {/* INVOICE LIST PAGE */}
            <Route
              path="/invoices"
              element={
                <RequireAuth>
                  <InvoicePage />
                </RequireAuth>
              }
            />

            <Route
              path="/hotel-dining-invoices"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["hotel"]}>
                    <RequireHotelModule module="dining">
                      <InvoicePage title="Dining Invoices" invoiceFilter="hotel-dining" />
                    </RequireHotelModule>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            <Route
              path="/hotel-lodging-invoices"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["hotel"]}>
                    <RequireHotelModule module="lodging">
                      <InvoicePage title="Lodging Invoices" invoiceFilter="hotel-lodging" />
                    </RequireHotelModule>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* 
          🔥 NEW ROUTE FOR PRINTING / VIEWING A SINGLE INVOICE
          Example URL: /invoice/INV-12345
        */}
            <Route
              path="/invoice/:invoiceNo"
              element={
                <RequireAuth>
                  <InvoiceView />
                </RequireAuth>
              }
            />

            {/* DASHBOARD */}
            <Route
              path="/dashboard"
              element={
                <RequireAuth>
                  <ProtectedRoute roles={["SUPER_OWNER", "STORE_ADMIN", "ADMIN"]}>
                    <Dashboard />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* SERVICE ADMIN DASHBOARD — dedicated analytics for service verticals */}
            <Route
              path="/service-dashboard"
              element={
                <RequireAuth>
                  <ProtectedRoute
                    roles={["SUPER_OWNER", "STORE_ADMIN", "ADMIN"]}
                    storeType={["service", "msme-service"]}
                  >
                    <ServiceAdminDashboard />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* PRODUCTS - allowed for retail + inventory (not service/laundry) */}
            <Route
              path="/products"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["retail", "inventory"]}>
                    <ProductPage />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* HOTEL DINING MENU MANAGEMENT */}
            <Route
              path="/hotel-dining"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["hotel"]}>
                    <RequireHotelModule module="dining">
                      <HotelDiningPage />
                    </RequireHotelModule>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            <Route
              path="/hotel-lodging"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["hotel"]}>
                    <RequireHotelModule module="lodging">
                      <HotelLodgingPage />
                    </RequireHotelModule>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            <Route
              path="/hotel-tables"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["hotel"]}>
                    <RequireHotelModule module="dining">
                      <HotelTableBookingPage />
                    </RequireHotelModule>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* HOTEL HOUSEKEEPING BOARD */}
            <Route
              path="/hotel-housekeeping"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["hotel"]}>
                    <RequireHotelModule module="lodging">
                      <HotelHousekeepingPage />
                    </RequireHotelModule>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* HOTEL MENU PRINT PREVIEW */}
            <Route
              path="/hotel-menu/print"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["hotel"]}>
                    <PrintMenuPage />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* INVENTORY DASHBOARD - allow admins and cashiers to see their store inventory */}
            <Route
              path="/inventory"
              element={
                <RequireAuth>
                  <ProtectedRoute roles={["SUPER_OWNER", "STORE_ADMIN", "ADMIN", "CASHIER"]}>
                    <Layout>
                      <InventoryDashboard />
                    </Layout>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* INVENTORY MODULE - PO + suppliers + stock movements + low-stock */}
            <Route
              path="/inventory-module"
              element={
                <RequireAuth>
                  <ProtectedRoute roles={["SUPER_OWNER", "STORE_ADMIN", "ADMIN", "CASHIER"]}>
                    <Layout>
                      <InventoryModule />
                    </Layout>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* STORE SETTINGS */}
            <Route
              path="/settings"
              element={
                <RequireAuth>
                  <ProtectedRoute roles={["SUPER_OWNER", "STORE_ADMIN", "ADMIN"]}>
                    <Layout>
                      <StoreSettings />
                    </Layout>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* REGISTER */}
            <Route path="/register" element={<Register />} />

            {/* PASSWORD RESET */}
            <Route path="/password-reset" element={<PasswordReset />} />

            {/* USER MANAGEMENT - admins only */}
            <Route
              path="/users"
              element={
                <RequireAuth>
                  <ProtectedRoute roles={["SUPER_OWNER", "STORE_ADMIN", "ADMIN"]}>
                    <Layout>
                      <UserManagement />
                    </Layout>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* HOTEL MODULE ACCESS - Super Owner only. Lets the Super Owner
            lock/unlock Lodging and Dining per hotel customer. */}
            <Route
              path="/super/hotel-modules"
              element={
                <RequireAuth>
                  <ProtectedRoute roles={["SUPER_OWNER"]}>
                    <Layout>
                      <HotelModuleAccessPage />
                    </Layout>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* CUSTOMER MANAGEMENT - all roles can view; cashiers see read-only */}
            <Route
              path="/customers"
              element={
                <RequireAuth>
                  <ProtectedRoute roles={["SUPER_OWNER", "STORE_ADMIN", "ADMIN", "CASHIER"]}>
                    <Layout>
                      <CustomerManagement />
                    </Layout>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* RECENT ACTIVITY - admin-visible audit log viewer */}
            <Route
              path="/activity"
              element={
                <RequireAuth>
                  <ProtectedRoute roles={["SUPER_OWNER", "STORE_ADMIN", "ADMIN"]}>
                    <Layout>
                      <RecentActivity />
                    </Layout>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* REPORTS - admin-visible Sales / GST / P&L */}
            <Route
              path="/reports"
              element={
                <RequireAuth>
                  <ProtectedRoute roles={["SUPER_OWNER", "STORE_ADMIN", "ADMIN"]}>
                    <Layout>
                      <Reports />
                    </Layout>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* SHIFTS - admin + cashier (server filters by role; cashiers see their own shifts) */}
            <Route
              path="/shifts"
              element={
                <RequireAuth>
                  <ProtectedRoute roles={["SUPER_OWNER", "STORE_ADMIN", "ADMIN", "CASHIER"]}>
                    <Layout>
                      <ShiftsPage />
                    </Layout>
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* LAUNDRY ORDER MANAGEMENT - for laundry store type only */}
            <Route
              path="/laundry-orders"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["laundry"]}>
                    <LaundryOrderPage />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* LAUNDRY SERVICE MANAGEMENT - for laundry store type only */}
            <Route
              path="/laundry-services"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["laundry"]}>
                    <LaundryServicePage />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* LAUNDRY INVENTORY - consumables management for laundry stores */}
            <Route
              path="/laundry-inventory"
              element={
                <RequireAuth>
                  <ProtectedRoute
                    roles={["SUPER_OWNER", "STORE_ADMIN", "ADMIN", "CASHIER"]}
                    storeType={["laundry"]}
                  >
                    <LaundryInventoryPage />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* SERVICE ORDER MANAGEMENT - for service stores only */}
            <Route
              path="/service-orders"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["service", "msme-service"]}>
                    <ServiceOrderPage />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* SERVICE MANAGEMENT PAGE - for service stores only */}
            <Route
              path="/services"
              element={
                <RequireAuth>
                  <ProtectedRoute storeType={["service", "msme-service"]}>
                    <ServiceManagementPage />
                  </ProtectedRoute>
                </RequireAuth>
              }
            />

            {/* CASH FLOW PAGE */}
            <Route
              path="/cashflow"
              element={
                <RequireAuth>
                  <CashFlowPage />
                </RequireAuth>
              }
            />
          </Routes>
        </Suspense>
      </AppErrorBoundaryWithLocation>
    </BrowserRouter>
  );
}

export default App;
