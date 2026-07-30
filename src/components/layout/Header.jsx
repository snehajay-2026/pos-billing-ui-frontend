import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getActiveStoreContext,
  getUser,
  setActiveStoreContext,
  updateUser,
} from "../../utils/auth";
import { logout as logoutService } from "../../services/authService";
import {
  getActiveShift,
  canCloseShiftClient,
  currentStoreNeedsShift,
} from "../../services/shiftService";
import CloseShiftDialog from "../shift/CloseShiftDialog";
import {
  getStoreSettings,
  loadStoreSettings,
  resetStoreSettingsCache,
  saveStoreSettings,
  seedStoreSettingsForScope,
} from "../../services/storeSettingsService";
import { getUsers } from "../../services/userService";
import { useUi } from "../../context/UiContext";
import {
  FaStoreAlt,
  FaCashRegister,
  FaUserCircle,
  FaPalette,
  FaMoon,
  FaSun,
  FaBars,
  FaSearch,
  FaBell,
  FaSignOutAlt,
  FaTimes,
  FaCheck,
  FaGlobe,
  FaChevronDown,
  FaBolt,
  FaShieldAlt,
  FaUser,
  FaPhoneAlt,
  FaMapMarkerAlt,
  FaEnvelope,
  FaIdBadge,
  FaLayerGroup,
} from "react-icons/fa";
import { useGlobalSearch } from "./useGlobalSearch";
import GlobalSearchPalette from "./GlobalSearchPalette";
import { useNotifications } from "./useNotifications";
import NotificationPanel from "./NotificationPanel";
import "./Header.css";
import "./GlobalSearchPalette.css";
import "./NotificationPanel.css";

const SEARCH_INPUT_ID = "header-global-search";

const getRoleLabel = (role) => {
  if (role === "STORE_ADMIN") return "BRANCH ADMIN";
  if (!role) return "";
  return role.replace(/_/g, " ");
};

const getInitials = (value) => {
  const text = String(value || "").trim();
  if (!text) return "U";
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return text.slice(0, 1).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

// Deterministic gradient for the avatar circle based on the user's name.
const avatarGradient = (value) => {
  const text = String(value || "user");
  let h = 0;
  for (let i = 0; i < text.length; i += 1) {
    h = (h * 31 + text.charCodeAt(i)) % 360;
  }
  const h2 = (h + 36) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 56%), hsl(${h2} 72% 46%))`;
};

const Header = ({ toggleSidebar }) => {
  const [user, setUser] = useState(() => getUser());
  const [theme, setTheme] = useState(() => getStoreSettings().theme || "classic");
  const [showLogout, setShowLogout] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  // Mobile tray (slides down below the top bar on <=768px) holds the
  // action buttons that don't fit alongside the brand. Separate from
  // the per-button dropdowns above the tray (notifications, user, store).
  const [trayOpen, setTrayOpen] = useState(false);
  // Mobile search overlay — opens a full-width search input on phones,
  // since the inline search input is hidden at <=900px to free space.
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: "",
    phone: "",
    address: "",
  });
  const [profileError, setProfileError] = useState("");
  const [profileSaved, setProfileSaved] = useState(false);
  const [showProfileToast, setShowProfileToast] = useState(false);
  const [availableStores, setAvailableStores] = useState([]);
  const [openMenu, setOpenMenu] = useState(null);
  const { language, setLanguage, locale, languageOptions } = useUi();
  const toastTimeoutRef = useRef(null);

  const themeOptions = ["classic", "dark", "minimal"];
  const themeIcons = {
    classic: <FaPalette />,
    dark: <FaMoon />,
    minimal: <FaSun />,
  };

  const saveTheme = (newTheme) => {
    setTheme(newTheme);
    const settings = getStoreSettings();
    saveStoreSettings({ ...settings, theme: newTheme });
    window.dispatchEvent(new Event("themeChanged"));
  };

  const cycleTheme = () => {
    const currentIndex = themeOptions.indexOf(theme);
    const nextTheme = themeOptions[(currentIndex + 1) % themeOptions.length];
    saveTheme(nextTheme);
  };

  const navigate = useNavigate();

  const isSuperOwner = user?.role === "SUPER_OWNER";

  // Shift status — polled periodically (and on user changes) so the chip
  // + user-menu link stay in sync. We also refresh when the page
  // regains focus so closing a shift in another tab updates quickly.
  const [activeShift, setActiveShift] = useState(null);
  const [closingShift, setClosingShift] = useState(null);
  const refreshActiveShift = useCallback(async () => {
    if (!user) {
      setActiveShift(null);
      return;
    }
    try {
      const s = await getActiveShift();
      setActiveShift(s);
    } catch {
      setActiveShift(null);
    }
  }, [user]);
  useEffect(() => {
    refreshActiveShift();
  }, [refreshActiveShift]);
  useEffect(() => {
    const onAuthChange = () => refreshActiveShift();
    const onFocus = () => refreshActiveShift();
    window.addEventListener("authChanged", onAuthChange);
    window.addEventListener("activeStoreChanged", onAuthChange);
    window.addEventListener("focus", onFocus);
    const interval = setInterval(refreshActiveShift, 30000);
    return () => {
      window.removeEventListener("authChanged", onAuthChange);
      window.removeEventListener("activeStoreChanged", onAuthChange);
      window.removeEventListener("focus", onFocus);
      clearInterval(interval);
    };
  }, [refreshActiveShift]);
  const canCloseActiveShift = canCloseShiftClient(activeShift, user);

  const getStoreOptionKey = (store) => `${store.storeType}:${store.storeId || store.storeType}`;

  const getStoreOptionLabel = (store) => {
    const storeIdLabel = store.storeId || store.storeType || "Store";
    const storeTypeLabel = store.storeType || "store";
    return `${storeIdLabel} (${storeTypeLabel})`;
  };

  const activeStore = getActiveStoreContext();
  const activeStoreLabel = activeStore ? getStoreOptionLabel(activeStore) : "Choose Store";

  const applySuperOwnerStore = async (store, options = {}) => {
    if (!store) return;
    if (activeStore && getStoreOptionKey(activeStore) === getStoreOptionKey(store)) {
      return;
    }
    // 1) Flip the active store + emit events synchronously so every page picks it up immediately.
    setActiveStoreContext(store);
    resetStoreSettingsCache();
    // 2) Seed the cache synchronously for the new store so getStoreSettings() / theme read
    //    correctly on the very next render — no "Restoring store" / blank-theme gap.
    seedStoreSettingsForScope(store);
    // 3) Kick off the network reload in the background — don't block the UI on it.
    loadStoreSettings().catch(() => {});
    // 4) Theme + user must be applied before navigate so the new store's theme paints first.
    window.dispatchEvent(new Event("themeChanged"));
    setUser(getUser());
    if (options.navigate !== false) {
      navigate(`/pos?store=${encodeURIComponent(store.storeId || store.storeType || "active")}`, {
        replace: true,
      });
    }
  };

  useEffect(() => {
    const syncTheme = () => setTheme(getStoreSettings().theme || "classic");
    window.addEventListener("storage", syncTheme);
    window.addEventListener("themeChanged", syncTheme);
    return () => {
      window.removeEventListener("storage", syncTheme);
      window.removeEventListener("themeChanged", syncTheme);
    };
  }, []);

  // Header label policy:
  //   - Super Owner: keep the existing "X POS" suffix (so it's clear
  //     that the super-owner is bouncing between verticals).
  //   - Admin / Branch Admin / Cashier / other customer users: show
  //     just the business module name (Retail, Hotel, Laundry, …).
  //     They work inside ONE vertical, so the suffix is noise.
  let storeLabel;
  if (isSuperOwner) {
    if (user?.storeType === "laundry") storeLabel = locale.laundryPOS || "Laundry POS";
    else if (user?.storeType === "service" || user?.storeType === "msme-service")
      storeLabel = locale.servicePOS || "Service POS";
    else if (user?.storeType === "inventory") storeLabel = locale.inventoryPOS || "Inventory POS";
    else if (user?.storeType === "hotel") storeLabel = locale.hotelPOS || "Hotel POS";
    else storeLabel = locale.retailPOS || "Retail POS";
  } else {
    const clean = {
      retail: locale.retail || "Retail",
      hotel: locale.hotel || "Hotel",
      laundry: locale.laundry || "Laundry",
      service: locale.service || "Service",
      "msme-service": locale.service || "Service",
      inventory: locale.inventory || "Inventory",
    };
    storeLabel = clean[user?.storeType] || locale.retail || "Retail";
  }

  const displayName =
    user?.name?.trim() ||
    user?.username ||
    (user?.email ? user.email.split("@")[0] : locale.unknownUser || "User");
  const loginId = displayName;

  useEffect(() => {
    const syncUser = () => setUser(getUser());
    window.addEventListener("authChanged", syncUser);
    window.addEventListener("userUpdated", syncUser);
    window.addEventListener("storage", syncUser);
    window.addEventListener("activeStoreChanged", syncUser);
    return () => {
      window.removeEventListener("authChanged", syncUser);
      window.removeEventListener("userUpdated", syncUser);
      window.removeEventListener("storage", syncUser);
      window.removeEventListener("activeStoreChanged", syncUser);
    };
  }, []);

  useEffect(() => {
    if (!isSuperOwner) {
      setAvailableStores([]);
      return;
    }

    let disposed = false;

    const loadAvailableStores = async () => {
      try {
        const users = await getUsers();
        if (disposed) return;
        const nextStores = Array.from(
          new Map(
            (Array.isArray(users) ? users : [])
              .filter((member) => member?.storeType && member.storeType !== "system")
              .map((member) => {
                const store = {
                  storeType: member.storeType,
                  storeId: member.storeId || member.storeType,
                };
                return [getStoreOptionKey(store), store];
              })
          ).values()
        ).sort((left, right) =>
          getStoreOptionLabel(left).localeCompare(getStoreOptionLabel(right))
        );

        setAvailableStores(nextStores);
      } catch (error) {
        if (!disposed) {
          setAvailableStores([]);
        }
      }
    };

    loadAvailableStores();

    return () => {
      disposed = true;
    };
  }, [isSuperOwner]);

  const openProfile = () => {
    setProfileForm({
      name: user?.name || user?.username || "",
      phone: user?.phone || "",
      address: user?.address || "",
    });
    setProfileError("");
    setProfileSaved(false);
    setShowProfileToast(false);
    setShowProfile(true);
  };

  const handleProfileChange = (field, value) => {
    if (field === "phone") {
      value = value.replace(/\D/g, "").slice(0, 10);
    }
    setProfileForm((prev) => ({ ...prev, [field]: value }));
    setProfileError("");
    setProfileSaved(false);
    setShowProfileToast(false);
  };

  const handleProfileSave = () => {
    const trimmedName = profileForm.name.trim();
    const trimmedPhone = profileForm.phone.trim();
    const trimmedAddress = profileForm.address.trim();

    if (!trimmedName) {
      setProfileError(locale.nameRequired);
      return;
    }

    if (trimmedPhone && !/^\d{10}$/.test(trimmedPhone)) {
      setProfileError(locale.invalidMobileNumber);
      return;
    }

    const nextUser = updateUser({
      name: trimmedName,
      username: trimmedName,
      phone: trimmedPhone,
      address: trimmedAddress,
    });

    if (!nextUser) {
      setProfileError(locale.updateProfileFailed || "Unable to update profile");
      return;
    }

    setUser(nextUser);
    setProfileError("");
    setProfileSaved(true);
    setShowProfileToast(true);

    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    toastTimeoutRef.current = window.setTimeout(() => {
      setShowProfileToast(false);
      toastTimeoutRef.current = null;
    }, 2200);
  };

  // close dropdowns when clicking anywhere outside
  useEffect(() => {
    if (!openMenu) return undefined;
    const onDocClick = (e) => {
      if (!e.target.closest || !e.target.closest(".header-dropdown")) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [openMenu]);

  const userInitials = useMemo(() => getInitials(displayName), [displayName]);
  const userAvatarBg = useMemo(() => avatarGradient(displayName), [displayName]);

  const searchInputRef = useRef(null);
  const {
    query,
    setQuery,
    results,
    loading,
    error,
    hasAny,
    clear: clearSearch,
  } = useGlobalSearch();

  // ⌘K / Ctrl+K from anywhere on the page focuses the search input.
  useEffect(() => {
    const onKeyDown = (event) => {
      const isMac =
        typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
      const trigger = (isMac ? event.metaKey : event.ctrlKey) && event.key?.toLowerCase() === "k";
      if (trigger) {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Refs for each tray dropdown trigger button. Used on mobile to anchor
  // the dropdown below the trigger via position:fixed + getBoundingClientRect.
  const triggerRefs = {
    store: useRef(null),
    language: useRef(null),
    notifications: useRef(null),
    user: useRef(null),
  };
  // Anchored position for the currently-open mobile dropdown menu.
  // null on desktop, {top, left, width} on mobile when a tray dropdown
  // is open. The dropdown is rendered with position:fixed using these.
  const [dropdownAnchor, setDropdownAnchor] = useState(null);

  const toggleMenu = (key) => {
    setOpenMenu((current) => {
      if (current === key) {
        setDropdownAnchor(null);
        return null;
      }
      // On mobile (<=768px), compute the trigger's screen rect so the
      // dropdown menu can render below it via position:fixed (avoids
      // the tray's rounded-corner clipping).
      const triggerEl = triggerRefs[key] && triggerRefs[key].current;
      if (triggerEl && typeof window !== "undefined" && window.innerWidth <= 768) {
        const rect = triggerEl.getBoundingClientRect();
        setDropdownAnchor({
          top: rect.bottom + 8,
          left: rect.left,
          width: rect.width,
        });
      } else {
        setDropdownAnchor(null);
      }
      return key;
    });
  };

  // Recompute the anchor on scroll/resize so the dropdown stays glued
  // to its trigger if the page moves.
  useEffect(() => {
    if (!openMenu || !dropdownAnchor) return undefined;
    const refresh = () => {
      const triggerEl = triggerRefs[openMenu] && triggerRefs[openMenu].current;
      if (!triggerEl) return;
      const rect = triggerEl.getBoundingClientRect();
      setDropdownAnchor({
        top: rect.bottom + 8,
        left: rect.left,
        width: rect.width,
      });
    };
    window.addEventListener("scroll", refresh, true);
    window.addEventListener("resize", refresh);
    return () => {
      window.removeEventListener("scroll", refresh, true);
      window.removeEventListener("resize", refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openMenu]);

  const {
    notifications,
    loading: notificationsLoading,
    error: notificationsError,
    refresh: refreshNotifications,
    lastFetchedAt,
  } = useNotifications();

  const handlePickNotification = (notification) => {
    if (!notification?.href) return;
    setOpenMenu(null);
    navigate(notification.href);
  };

  const handlePickResult = (result) => {
    if (!result) return;
    let target = result.href;
    if (!target && result.kind === "order") {
      // Order objects don't carry their storeType reliably, so resolve a list path
      // from the cashier's active store at click time.
      const storeType = activeStore?.storeType || user?.storeType || "service";
      target =
        storeType === "laundry"
          ? `/laundry-orders?q=${encodeURIComponent(String(result.id || ""))}`
          : storeType === "hotel"
            ? `/hotel-tables?q=${encodeURIComponent(String(result.id || ""))}`
            : `/service-orders?q=${encodeURIComponent(String(result.id || ""))}`;
    }
    if (!target) return;
    setOpenMenu(null);
    navigate(target);
    clearSearch();
  };

  const handleSearchKeyDown = (event) => {
    if (event.key === "Escape") {
      if (query) {
        clearSearch();
      }
      setOpenMenu(null);
      event.target.blur();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter") {
      // Translate into the palette's own keyboard handler.
      const direction =
        event.key === "ArrowDown" ? "down" : event.key === "ArrowUp" ? "up" : "enter";
      const node = searchInputRef.current;
      if (node) {
        node.dispatchEvent(new CustomEvent("palette-nav", { detail: direction, cancelable: true }));
      }
      if (event.key === "Enter") {
        // The palette may have handled it; don't let Enter fall through and submit a form.
        event.preventDefault();
      }
    }
  };

  return (
    <>
      <header className="header-navbar">
        <div className="header-navbar-decor" aria-hidden="true">
          <span className="header-navbar-orb header-navbar-orb-1" />
          <span className="header-navbar-orb header-navbar-orb-2" />
          <span className="header-navbar-orb header-navbar-orb-3" />
        </div>

        <div className="header-navbar-inner">
          <button
            type="button"
            className="header-burger"
            onClick={toggleSidebar}
            aria-label={locale.openMobileMenu || "Open mobile menu"}
          >
            <FaBars />
          </button>

          <div className="header-brand">
            <span className="header-brand-mark" aria-hidden="true">
              <FaBolt />
            </span>
            <span className="header-brand-text">
              <strong>{storeLabel}</strong>
              <span className="header-brand-sub">POS Console · v2</span>
            </span>
          </div>

          {/* Mobile-only search-icon — opens a full-width overlay search
              below the top bar so phones get search back without
              crowding the row. The desktop search input below is hidden
              below 900px via CSS. */}
          <button
            type="button"
            className="header-iconbtn header-mobile-search-btn"
            onClick={() => setMobileSearchOpen(true)}
            aria-label="Open search"
            title="Search products, customers, orders…"
          >
            <FaSearch />
          </button>

          {/* Mobile-only tray toggle — opens the slide-down tray that
              holds the store/language/theme/bell/user actions. Hidden
              on desktop where the actions sit in a single row. */}
          <button
            type="button"
            className={`header-iconbtn header-mobile-tray-btn ${trayOpen ? "is-open" : ""}`}
            onClick={() => {
              setTrayOpen((v) => {
                const next = !v;
                if (!next) {
                  // Closing the tray also closes any open dropdown so the
                  // next tray-open starts fresh.
                  setOpenMenu(null);
                  setDropdownAnchor(null);
                }
                return next;
              });
            }}
            aria-label={trayOpen ? "Close menu" : "Open menu"}
            aria-expanded={trayOpen}
            aria-controls="header-tray"
          >
            {trayOpen ? <FaTimes /> : <FaBars />}
          </button>

          <div
            className={`header-dropdown header-search-wrap ${
              openMenu === "search" ? "is-open" : ""
            }`}
          >
            <div className="header-search">
              <FaSearch className="header-search-icon" aria-hidden="true" />
              <input
                id={SEARCH_INPUT_ID}
                ref={searchInputRef}
                type="search"
                placeholder="Search products, customers, orders…"
                aria-label="Global search"
                aria-expanded={openMenu === "search"}
                aria-controls="header-search-palette"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  if (event.target.value.trim().length > 0) {
                    setOpenMenu("search");
                  } else if (openMenu === "search") {
                    setOpenMenu(null);
                  }
                }}
                onFocus={() => {
                  if (query.trim().length > 0) {
                    setOpenMenu("search");
                  }
                }}
                onKeyDown={handleSearchKeyDown}
                autoComplete="off"
                spellCheck={false}
              />
              <kbd className="header-search-kbd">⌘K</kbd>
              {query && (
                <button
                  type="button"
                  className="header-search-clear"
                  onClick={() => {
                    clearSearch();
                    setOpenMenu(null);
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                >
                  <FaTimes />
                </button>
              )}
            </div>
            {openMenu === "search" ? (
              <div id="header-search-palette" className="header-search-palette-anchor">
                <GlobalSearchPalette
                  query={query}
                  results={results}
                  loading={loading}
                  error={error}
                  hasAny={hasAny}
                  onPick={handlePickResult}
                  inputId={SEARCH_INPUT_ID}
                />
              </div>
            ) : null}
          </div>

          <div id="header-tray" className={`header-tray ${trayOpen ? "is-open" : ""}`}>
            <div className="header-actions">
              {activeShift && currentStoreNeedsShift() && (
                <div className="header-shift-chip" title="You have an open shift">
                  <FaCashRegister className="header-shift-icon" />
                  <span className="header-shift-text">
                    <span className="header-shift-label">Shift open</span>
                    <span className="header-shift-float">
                      ₹{Number(activeShift.openingFloat || 0).toFixed(0)}
                      {activeShift.branchName ? ` · ${activeShift.branchName}` : ""}
                    </span>
                  </span>
                  {canCloseActiveShift && (
                    <button
                      type="button"
                      className="header-shift-close"
                      onClick={() => setClosingShift(activeShift)}
                      title="Close my shift"
                    >
                      Close
                    </button>
                  )}
                </div>
              )}
              {isSuperOwner && (
                <div
                  className={`header-dropdown header-store-switcher ${
                    openMenu === "store" ? "is-open" : ""
                  }`}
                >
                  <button
                    type="button"
                    ref={triggerRefs.store}
                    className="header-chip"
                    onClick={() => toggleMenu("store")}
                    disabled={availableStores.length === 0}
                    aria-haspopup="menu"
                    aria-expanded={openMenu === "store"}
                  >
                    <FaStoreAlt className="header-chip-icon" />
                    <span className="header-chip-text">
                      <span className="header-chip-eyebrow">Active store</span>
                      <span className="header-chip-value">{activeStoreLabel}</span>
                    </span>
                    <FaChevronDown className="header-chip-chevron" />
                  </button>
                  {openMenu === "store" && (
                    <div
                      className={`header-menu ${dropdownAnchor ? "header-menu-in-tray" : ""}`}
                      role="menu"
                      style={
                        dropdownAnchor
                          ? {
                              top: dropdownAnchor.top,
                              left: dropdownAnchor.left,
                              width: Math.max(dropdownAnchor.width, 220),
                            }
                          : undefined
                      }
                    >
                      <div className="header-menu-head">
                        <FaLayerGroup aria-hidden="true" />
                        <span>Switch store</span>
                      </div>
                      <div className="header-menu-list">
                        {availableStores.length === 0 ? (
                          <div className="header-menu-empty">No stores available</div>
                        ) : (
                          availableStores.map((store) => {
                            const isActive =
                              Boolean(activeStore) &&
                              getStoreOptionKey(activeStore) === getStoreOptionKey(store);
                            return (
                              <button
                                type="button"
                                key={getStoreOptionKey(store)}
                                className={`header-menu-item ${isActive ? "is-active" : ""}`}
                                onClick={() => {
                                  applySuperOwnerStore(store);
                                  setOpenMenu(null);
                                }}
                                role="menuitem"
                              >
                                <span className="header-menu-item-mark" aria-hidden="true">
                                  {isActive ? <FaCheck /> : <FaStoreAlt />}
                                </span>
                                <span className="header-menu-item-text">
                                  {getStoreOptionLabel(store)}
                                </span>
                                {isActive && <span className="header-menu-item-tag">current</span>}
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div
                className={`header-dropdown header-language ${
                  openMenu === "language" ? "is-open" : ""
                }`}
              >
                <button
                  type="button"
                  ref={triggerRefs.language}
                  className="header-iconbtn header-iconbtn-pill"
                  onClick={() => toggleMenu("language")}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === "language"}
                  title={locale.languageLabel || "Language"}
                >
                  <FaGlobe />
                  <span className="header-iconbtn-label">
                    {languageOptions.find((item) => item.code === language)?.code?.toUpperCase() ||
                      "EN"}
                  </span>
                </button>
                {openMenu === "language" && (
                  <div
                    className={`header-menu ${dropdownAnchor ? "header-menu-in-tray" : ""}`}
                    role="menu"
                    style={
                      dropdownAnchor
                        ? {
                            top: dropdownAnchor.top,
                            left: dropdownAnchor.left,
                            width: Math.max(dropdownAnchor.width, 220),
                          }
                        : undefined
                    }
                  >
                    <div className="header-menu-head">
                      <FaGlobe aria-hidden="true" />
                      <span>{locale.languageLabel || "Language"}</span>
                    </div>
                    <div className="header-menu-list">
                      {languageOptions.map((lang) => {
                        const isActive = language === lang.code;
                        return (
                          <button
                            type="button"
                            key={lang.code}
                            className={`header-menu-item ${isActive ? "is-active" : ""}`}
                            onClick={() => {
                              setLanguage(lang.code);
                              setOpenMenu(null);
                            }}
                            role="menuitem"
                          >
                            <span className="header-menu-item-mark" aria-hidden="true">
                              {isActive ? <FaCheck /> : <FaGlobe />}
                            </span>
                            <span className="header-menu-item-text">{lang.label}</span>
                            <span className="header-menu-item-tag language">
                              {lang.code.toUpperCase()}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                className="header-iconbtn"
                onClick={cycleTheme}
                title={locale.switchTheme || "Switch theme"}
                aria-label={locale.switchTheme || "Switch theme"}
              >
                {themeIcons[theme]}
                <span className="header-iconbtn-pulse" aria-hidden="true" />
              </button>

              <div
                className={`header-dropdown header-bell ${openMenu === "notifications" ? "is-open" : ""}`}
              >
                <button
                  type="button"
                  ref={triggerRefs.notifications}
                  className="header-iconbtn header-iconbtn-bell"
                  title={
                    notifications.length
                      ? `${notifications.length} active notification${notifications.length === 1 ? "" : "s"}`
                      : "Notifications"
                  }
                  aria-label={
                    notifications.length
                      ? `Notifications, ${notifications.length} active`
                      : "Notifications"
                  }
                  aria-haspopup="menu"
                  aria-expanded={openMenu === "notifications"}
                  onClick={() => toggleMenu("notifications")}
                >
                  <FaBell />
                  {notifications.length > 0 ? (
                    <span className="header-iconbtn-badge" aria-hidden="true">
                      {notifications.length > 9 ? "9+" : notifications.length}
                    </span>
                  ) : null}
                </button>
                {openMenu === "notifications" ? (
                  <div
                    className={dropdownAnchor ? "header-menu-in-tray" : undefined}
                    style={
                      dropdownAnchor
                        ? {
                            top: dropdownAnchor.top,
                            left: Math.max(8, dropdownAnchor.left + dropdownAnchor.width - 320),
                            width: Math.max(dropdownAnchor.width, 320),
                          }
                        : undefined
                    }
                  >
                    <NotificationPanel
                      notifications={notifications}
                      loading={notificationsLoading}
                      error={notificationsError}
                      lastFetchedAt={lastFetchedAt}
                      onPick={handlePickNotification}
                      onRefresh={refreshNotifications}
                    />
                  </div>
                ) : null}
              </div>

              <div
                className={`header-dropdown header-user ${openMenu === "user" ? "is-open" : ""}`}
              >
                <button
                  type="button"
                  ref={triggerRefs.user}
                  className="header-user-trigger"
                  onClick={() => toggleMenu("user")}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === "user"}
                >
                  <span
                    className="header-user-avatar"
                    style={{ background: userAvatarBg }}
                    aria-hidden="true"
                  >
                    {userInitials}
                  </span>
                  <span className="header-user-meta">
                    <strong>{loginId || locale.unknownUser}</strong>
                    <span className="header-user-role">
                      {getRoleLabel(user?.role) || locale.unknownRole}
                    </span>
                  </span>
                  <FaChevronDown className="header-user-chevron" />
                </button>
                {openMenu === "user" && (
                  <div
                    className={`header-menu header-menu-user ${dropdownAnchor ? "header-menu-in-tray" : ""}`}
                    role="menu"
                    style={
                      dropdownAnchor
                        ? {
                            top: dropdownAnchor.top,
                            left: Math.max(8, dropdownAnchor.left + dropdownAnchor.width - 280),
                            width: Math.max(dropdownAnchor.width, 280),
                          }
                        : undefined
                    }
                  >
                    <div className="header-menu-user-hero">
                      <span
                        className="header-user-avatar header-user-avatar-lg"
                        style={{ background: userAvatarBg }}
                        aria-hidden="true"
                      >
                        {userInitials}
                      </span>
                      <div className="header-menu-user-meta">
                        <strong>{loginId || locale.unknownUser}</strong>
                        <span>{getRoleLabel(user?.role) || locale.unknownRole}</span>
                        <span className="header-menu-user-email">{user?.email || ""}</span>
                      </div>
                    </div>
                    <div className="header-menu-list">
                      <button
                        type="button"
                        className="header-menu-item"
                        onClick={() => {
                          openProfile();
                          setOpenMenu(null);
                        }}
                        role="menuitem"
                      >
                        <span className="header-menu-item-mark" aria-hidden="true">
                          <FaUserCircle />
                        </span>
                        <span className="header-menu-item-text">{locale.myProfile}</span>
                      </button>
                      <button
                        type="button"
                        className="header-menu-item"
                        onClick={() => {
                          cycleTheme();
                        }}
                        role="menuitem"
                      >
                        <span className="header-menu-item-mark" aria-hidden="true">
                          <FaPalette />
                        </span>
                        <span className="header-menu-item-text">
                          {locale.switchTheme || "Switch theme"}
                        </span>
                        <span className="header-menu-item-tag">{theme}</span>
                      </button>
                      {activeShift && canCloseActiveShift && (
                        <button
                          type="button"
                          className="header-menu-item"
                          onClick={() => {
                            setClosingShift(activeShift);
                            setOpenMenu(null);
                          }}
                          role="menuitem"
                        >
                          <span className="header-menu-item-mark" aria-hidden="true">
                            <FaCashRegister />
                          </span>
                          <span className="header-menu-item-text">
                            Close my shift
                            <span className="header-menu-item-tag header-menu-item-tag-warn">
                              ₹{Number(activeShift.openingFloat || 0).toFixed(0)} open
                            </span>
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="header-menu-item is-danger"
                        onClick={() => {
                          setShowLogout(true);
                          setOpenMenu(null);
                        }}
                        role="menuitem"
                      >
                        <span className="header-menu-item-mark" aria-hidden="true">
                          <FaSignOutAlt />
                        </span>
                        <span className="header-menu-item-text">{locale.logout}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile search overlay — full-width bar that slides down from the
          top of the page when the search icon is tapped. Reuses the same
          input + palette as the desktop search by binding to the same
          query state. CSS hides this overlay above 768px. */}
      {mobileSearchOpen && (
        <div className="header-mobile-search-overlay" role="search">
          <div className="header-mobile-search-bar">
            <FaSearch className="header-search-icon" aria-hidden="true" />
            <input
              ref={searchInputRef}
              type="search"
              placeholder="Search products, customers, orders…"
              aria-label="Global search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (event.target.value.trim().length > 0) {
                  setOpenMenu("search");
                }
              }}
              onFocus={() => {
                if (query.trim().length > 0) setOpenMenu("search");
              }}
              onKeyDown={handleSearchKeyDown}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            <button
              type="button"
              className="header-mobile-search-close"
              onClick={() => {
                setMobileSearchOpen(false);
                clearSearch();
                setOpenMenu(null);
              }}
              aria-label="Close search"
            >
              <FaTimes />
            </button>
          </div>
          {openMenu === "search" && (
            <div className="header-mobile-search-palette">
              <GlobalSearchPalette
                query={query}
                results={results}
                loading={loading}
                error={error}
                hasAny={hasAny}
                onPick={(result) => {
                  handlePickResult(result);
                  setMobileSearchOpen(false);
                }}
                inputId={SEARCH_INPUT_ID}
              />
            </div>
          )}
        </div>
      )}

      {showProfile && (
        <div
          className="header-modal-backdrop"
          onClick={() => setShowProfile(false)}
          role="presentation"
        >
          <div
            className="header-modal profile-modal-dialog profile-modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="header-modal-close"
              onClick={() => setShowProfile(false)}
              aria-label={locale.close || "Close"}
            >
              <FaTimes />
            </button>

            <div className="header-modal-split">
              <aside className="profile-modal-hero">
                <div className="profile-modal-hero-orb" aria-hidden="true" />
                <div
                  className="header-user-avatar header-user-avatar-xl"
                  style={{ background: userAvatarBg }}
                  aria-hidden="true"
                >
                  {userInitials}
                </div>
                <h3 id="profile-modal-title">{locale.myProfile}</h3>
                <p>{user?.email || ""}</p>
                <div className="profile-modal-hero-tags">
                  <span className="profile-modal-tag">
                    <FaShieldAlt aria-hidden="true" />
                    {getRoleLabel(user?.role) || locale.unknownRole}
                  </span>
                  <span className="profile-modal-tag">
                    <FaStoreAlt aria-hidden="true" />
                    {user?.storeType || "—"}
                  </span>
                </div>
              </aside>

              <div className="profile-modal-body">
                <div className="profile-form-grid">
                  <label className="profile-form-row profile-form-row-wide">
                    <span className="profile-form-label">
                      <FaUser aria-hidden="true" /> {locale.userFullName}
                    </span>
                    <input
                      className="profile-form-input"
                      value={profileForm.name}
                      onChange={(e) => handleProfileChange("name", e.target.value)}
                      placeholder={locale.fullNamePlaceholder}
                    />
                  </label>

                  <label className="profile-form-row">
                    <span className="profile-form-label">
                      <FaPhoneAlt aria-hidden="true" /> {locale.mobileNumber}
                    </span>
                    <div className="profile-form-phone">
                      <span className="profile-form-phone-prefix">+91</span>
                      <input
                        type="tel"
                        className="profile-form-input"
                        value={profileForm.phone}
                        onChange={(e) => handleProfileChange("phone", e.target.value)}
                        placeholder={locale.mobileNumber}
                      />
                    </div>
                    <small className="profile-form-help">{locale.profilePhoneHelp}</small>
                  </label>

                  <label className="profile-form-row">
                    <span className="profile-form-label">
                      <FaMapMarkerAlt aria-hidden="true" /> {locale.address}
                    </span>
                    <textarea
                      className="profile-form-input"
                      rows="3"
                      value={profileForm.address}
                      onChange={(e) => handleProfileChange("address", e.target.value)}
                      placeholder={locale.address}
                    />
                  </label>

                  <div className="profile-form-row">
                    <span className="profile-form-label">
                      <FaEnvelope aria-hidden="true" /> {locale.userEmail}
                    </span>
                    <input
                      className="profile-form-input profile-form-input-readonly"
                      value={user?.email || ""}
                      readOnly
                    />
                  </div>

                  <div className="profile-form-row">
                    <span className="profile-form-label">
                      <FaIdBadge aria-hidden="true" /> {locale.userRole}
                    </span>
                    <input
                      className="profile-form-input profile-form-input-readonly"
                      value={getRoleLabel(user?.role)}
                      readOnly
                    />
                  </div>

                  <div className="profile-form-row">
                    <span className="profile-form-label">
                      <FaStoreAlt aria-hidden="true" /> {locale.userStoreType}
                    </span>
                    <input
                      className="profile-form-input profile-form-input-readonly"
                      value={user?.storeType || ""}
                      readOnly
                    />
                  </div>
                </div>

                {profileError && (
                  <div className="profile-form-message error">
                    <FaTimes aria-hidden="true" />
                    <span>{profileError}</span>
                  </div>
                )}
                {profileSaved && (
                  <div className="profile-form-message success">
                    <FaCheck aria-hidden="true" />
                    <span>{locale.profileSaved}</span>
                  </div>
                )}

                <div className="profile-modal-foot">
                  <button
                    type="button"
                    className="profile-modal-btn profile-modal-btn-secondary"
                    onClick={() => setShowProfile(false)}
                  >
                    {locale.close || "Close"}
                  </button>
                  <button
                    type="button"
                    className="profile-modal-btn profile-modal-btn-primary"
                    onClick={handleProfileSave}
                  >
                    <FaCheck aria-hidden="true" />
                    <span>{locale.saveChanges}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showProfileToast && (
        <div className="profile-save-toast">
          <FaCheck aria-hidden="true" />
          <span>{locale.profileSaveToast}</span>
        </div>
      )}

      {showLogout && (
        <div
          className="header-modal-backdrop"
          onClick={() => setShowLogout(false)}
          role="presentation"
        >
          <div
            className="header-modal header-modal-logout"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="header-modal-close"
              onClick={() => setShowLogout(false)}
              aria-label={locale.close || "Close"}
            >
              <FaTimes />
            </button>
            <div className="header-modal-logout-icon" aria-hidden="true">
              <FaSignOutAlt />
            </div>
            <h3>{locale.confirmLogout}</h3>
            <p>{locale.logoutConfirmText}</p>
            <div className="profile-modal-foot">
              <button
                type="button"
                className="profile-modal-btn profile-modal-btn-secondary"
                onClick={() => setShowLogout(false)}
              >
                {locale.cancel}
              </button>
              <button
                type="button"
                className="profile-modal-btn profile-modal-btn-danger"
                onClick={async () => {
                  await logoutService();
                  setShowLogout(false);
                  navigate("/login");
                }}
              >
                <FaSignOutAlt aria-hidden="true" />
                <span>{locale.logout}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global "Close my shift" modal — fired by the chip or the user-menu link. */}
      <CloseShiftDialog
        open={Boolean(closingShift)}
        shift={closingShift}
        onClose={() => setClosingShift(null)}
        onClosed={() => {
          setClosingShift(null);
          refreshActiveShift();
        }}
        title="Close my shift"
      />
    </>
  );
};

export default Header;
