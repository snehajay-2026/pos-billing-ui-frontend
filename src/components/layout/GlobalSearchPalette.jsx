import React, { useEffect, useMemo, useState } from "react";
import { FaBoxOpen, FaFileInvoiceDollar, FaListAlt, FaSearch, FaArrowRight } from "react-icons/fa";
import "./GlobalSearchPalette.css";

const KIND_META = {
  product: {
    label: "Product",
    icon: FaBoxOpen,
    accent: "product",
  },
  invoice: {
    label: "Invoice",
    icon: FaFileInvoiceDollar,
    accent: "invoice",
  },
  order: {
    label: "Order",
    icon: FaListAlt,
    accent: "order",
  },
};

const flatten = (grouped) => [
  ...grouped.products.map((item) => ({ ...item, _group: "products" })),
  ...grouped.invoices.map((item) => ({ ...item, _group: "invoices" })),
  ...grouped.orders.map((item) => ({ ...item, _group: "orders" })),
];

const emptyStateCopy = {
  hint: "Start typing to search products, invoices, and orders…",
  empty: "No matches. Try a different keyword or invoice number.",
};

const ResultRow = ({ item, isActive, onMouseEnter, onClick }) => {
  const meta = KIND_META[item.kind] || KIND_META.product;
  const Icon = meta.icon;
  return (
    <button
      type="button"
      className={`header-search-palette-item is-${meta.accent} ${isActive ? "is-active" : ""}`}
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      role="option"
      aria-selected={isActive}
    >
      <span className="header-search-palette-item-mark" aria-hidden="true">
        <Icon />
      </span>
      <span className="header-search-palette-item-text">
        <strong>{item.title}</strong>
        {item.meta ? <small>{item.meta}</small> : null}
      </span>
      <span className="header-search-palette-item-tag">{meta.label}</span>
      <span className="header-search-palette-item-go" aria-hidden="true">
        <FaArrowRight />
      </span>
    </button>
  );
};

const Section = ({ title, kind, items, activeId, onHover, onPick }) => {
  if (!items.length) return null;
  return (
    <div className="header-search-palette-section">
      <div className="header-search-palette-section-head">{title}</div>
      <div className="header-search-palette-section-list">
        {items.map((item) => (
          <ResultRow
            key={`${kind}-${item.id}`}
            item={item}
            isActive={activeId === `${kind}-${item.id}`}
            onMouseEnter={onHover(`${kind}-${item.id}`)}
            onClick={() => onPick(item)}
          />
        ))}
      </div>
    </div>
  );
};

const GlobalSearchPalette = ({ query, results, loading, error, hasAny, onPick, inputId }) => {
  const flat = useMemo(() => flatten(results), [results]);
  const [activeId, setActiveId] = useState(null);

  // Reset the keyboard cursor when the result set changes.
  useEffect(() => {
    setActiveId(flat[0] ? `${flat[0]._group}-${flat[0].id}` : null);
  }, [flat]);

  const activeItem = flat.find((item) => `${item._group}-${item.id}` === activeId) || null;

  // Expose the keyboard API to the parent input via a custom DOM event so the
  // input can stay controlled. The parent dispatches `palette-nav` on the input.
  useEffect(() => {
    const node = document.getElementById(inputId);
    if (!node) return undefined;

    const handler = (event) => {
      const direction = event.detail;
      if (direction === "down" || direction === "up") {
        const currentIdx = activeId
          ? flat.findIndex((item) => `${item._group}-${item.id}` === activeId)
          : -1;
        if (!flat.length) return;
        const step = direction === "down" ? 1 : -1;
        const nextIdx = (currentIdx + step + flat.length) % flat.length;
        const next = flat[nextIdx];
        if (next) setActiveId(`${next._group}-${next.id}`);
        event.preventDefault();
      } else if (direction === "enter") {
        if (activeItem) {
          onPick(activeItem);
          event.preventDefault();
        }
      }
    };

    node.addEventListener("palette-nav", handler);
    return () => node.removeEventListener("palette-nav", handler);
  }, [inputId, activeId, activeItem, flat, onPick]);

  const handleHover = (id) => () => setActiveId(id);
  const showResults = query.trim().length > 0;

  return (
    <div className="header-search-palette" role="listbox" aria-label="Search results">
      {error ? (
        <div className="header-search-palette-error" role="status">
          <FaSearch />
          <span>{error}</span>
        </div>
      ) : null}

      {!showResults ? (
        <div className="header-search-palette-empty">
          <FaSearch />
          <span>{emptyStateCopy.hint}</span>
        </div>
      ) : null}

      {showResults && !error && !loading && !hasAny ? (
        <div className="header-search-palette-empty">
          <FaSearch />
          <span>{emptyStateCopy.empty}</span>
        </div>
      ) : null}

      {showResults && !error ? (
        <>
          <Section
            title="Products"
            kind="products"
            items={results.products}
            activeId={activeId}
            onHover={handleHover}
            onPick={onPick}
          />
          <Section
            title="Invoices"
            kind="invoices"
            items={results.invoices}
            activeId={activeId}
            onHover={handleHover}
            onPick={onPick}
          />
          <Section
            title="Orders"
            kind="orders"
            items={results.orders}
            activeId={activeId}
            onHover={handleHover}
            onPick={onPick}
          />
        </>
      ) : null}

      <div className="header-search-palette-foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd>
          navigate
        </span>
        <span>
          <kbd>↵</kbd>
          open
        </span>
        <span>
          <kbd>Esc</kbd>
          close
        </span>
      </div>
    </div>
  );
};

export default GlobalSearchPalette;
