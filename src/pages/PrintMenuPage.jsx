import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "../components/layout/Layout";
import { getProducts } from "../services/productService";
import { getStoreSettings } from "../services/storeSettingsService";
import { resolveHotelMenuCategories } from "../components/hotel/hotelMenuCategories";
import "./PrintMenuPage.css";

const groupByCategory = (items, categories) => {
  const groups = categories.map((category) => ({
    category,
    items: items
      .filter((item) => item.category === category)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
  }));
  return groups.filter((group) => group.items.length > 0);
};

const PrintMenuPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const data = await getProducts();
        if (mounted) {
          setItems(Array.isArray(data) ? data.filter((p) => p.available !== false) : []);
        }
      } catch (err) {
        console.error("Failed to load menu for print", err);
      } finally {
        if (mounted) setLoading(false);
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const settings = getStoreSettings();
  const categories = useMemo(() => resolveHotelMenuCategories(), []);
  const groups = useMemo(() => groupByCategory(items, categories), [items, categories]);

  const storeName = settings?.name || "Hotel";
  const storePhone = settings?.phone || "";
  const storeAddress = settings?.address || "";
  const today = new Date().toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <Layout>
      <div className="print-menu-page">
        <div className="print-menu-toolbar no-print">
          <div>
            <h3>Menu Preview</h3>
            <p>
              Use the browser's Print menu (or the button) to print this as a guest-facing menu
              card.
            </p>
          </div>
          <div className="print-menu-toolbar-actions">
            <Link to="/hotel-dining" className="print-menu-btn-secondary">
              Back to Menu
            </Link>
            <button type="button" className="print-menu-btn-primary" onClick={() => window.print()}>
              Print Menu
            </button>
          </div>
        </div>

        <article className="print-menu-sheet">
          <header className="print-menu-sheet-head">
            {settings?.logo && (
              <img src={settings.logo} alt="Store logo" className="print-menu-logo" />
            )}
            <h1>{storeName}</h1>
            <h2>Menu</h2>
            {storeAddress && <p className="print-menu-address">{storeAddress}</p>}
            {storePhone && <p className="print-menu-phone">Phone: {storePhone}</p>}
            <p className="print-menu-meta">
              All prices are subject to applicable taxes. Menu valid from {today}.
            </p>
          </header>

          {loading ? (
            <p className="print-menu-empty">Loading menu…</p>
          ) : groups.length === 0 ? (
            <p className="print-menu-empty">
              No items available to print yet. Add items from the Hotel Menu page first.
            </p>
          ) : (
            <div className="print-menu-sections">
              {groups.map((group) => (
                <section key={group.category} className="print-menu-section">
                  <h3 className="print-menu-section-title">{group.category}</h3>
                  <ul className="print-menu-items">
                    {group.items.map((item) => (
                      <li key={item.id} className="print-menu-item">
                        <div className="print-menu-item-head">
                          <span className="print-menu-item-name">
                            {item.isVeg === false ? "● " : "○ "}
                            {item.name}
                            {item.isJain && <span className="print-menu-jain"> · Jain</span>}
                          </span>
                          <span className="print-menu-item-price">
                            {item.fullPrice ? (
                              <>
                                Rs {Number(item.fullPrice).toFixed(0)}
                                <small>
                                  {" "}
                                  (full) / Rs {Number(item.halfPrice || item.price || 0).toFixed(
                                    0
                                  )}{" "}
                                  (half)
                                </small>
                              </>
                            ) : (
                              <>Rs {Number(item.price || 0).toFixed(0)}</>
                            )}
                          </span>
                        </div>
                        {item.description && (
                          <div className="print-menu-item-desc">{item.description}</div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}

          <footer className="print-menu-foot">
            <p>
              Allergen notice: Please inform staff of any allergies. Prices include GST where
              applicable.
            </p>
            <p className="print-menu-thanks">Thank you for choosing {storeName}!</p>
          </footer>
        </article>
      </div>
    </Layout>
  );
};

export default PrintMenuPage;
