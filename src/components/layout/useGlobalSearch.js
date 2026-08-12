import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDataContext } from "../../context/DataContext";
import { getInvoices } from "../../services/invoiceService";

const DEBOUNCE_MS = 220;
const INVOICE_CACHE_TTL_MS = 30_000;
const PER_CATEGORY_LIMIT = 6;

const scoreField = (text, query) => {
  if (!text) return 0;
  const t = String(text).toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 50;
  return 0;
};

const bestScore = (entity, query, fields) => {
  let best = 0;
  for (const field of fields) {
    const value = field.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), entity);
    const s = scoreField(value, query);
    if (s > best) best = s;
  }
  return best;
};

const recencyScore = (entity, fallbackField = "id") => {
  const dateValue = entity.updatedAt || entity.date || entity.createdAt;
  const ts = dateValue ? Date.parse(dateValue) : NaN;
  if (!Number.isNaN(ts)) return ts;
  // Fallback: use high-bit of the id so newer ids generally win.
  const idString = String(entity[fallbackField] || "");
  const numeric = parseInt(idString.replace(/\D/g, ""), 10);
  return Number.isNaN(numeric) ? 0 : numeric;
};

const buildProducts = (products, query) => {
  if (!Array.isArray(products)) return [];
  return products
    .map((product) => ({
      score: bestScore(product, query, ["name", "barcode", "category"]),
      ref: product,
    }))
    .filter((row) => row.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return String(left.ref.name || "").localeCompare(String(right.ref.name || ""));
    })
    .slice(0, PER_CATEGORY_LIMIT)
    .map((row) => ({
      kind: "product",
      id: row.ref.id,
      title: row.ref.name || "Unnamed product",
      meta: [row.ref.category, row.ref.barcode].filter(Boolean).join(" · "),
      href: `/products?q=${encodeURIComponent(query)}`,
      score: row.score,
    }));
};

const buildInvoices = (invoices, query) => {
  if (!Array.isArray(invoices)) return [];
  return invoices
    .map((invoice) => ({
      score: bestScore(invoice, query, [
        "invoiceNo",
        "customer",
        "customerPhone",
        "token",
        "orderId",
      ]),
      ref: invoice,
      recency: recencyScore(invoice),
    }))
    .filter((row) => row.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.recency - left.recency;
    })
    .slice(0, PER_CATEGORY_LIMIT)
    .map((row) => ({
      kind: "invoice",
      id: row.ref.invoiceNo || row.ref.id,
      title: row.ref.invoiceNo || row.ref.id || "Invoice",
      meta:
        [row.ref.customer, row.ref.customerPhone, row.ref.token ? `Token ${row.ref.token}` : ""]
          .filter(Boolean)
          .join(" · ") || `₹${Number(row.ref.grandTotal || 0).toFixed(2)}`,
      href: `/invoice/${encodeURIComponent(row.ref.invoiceNo || row.ref.id)}/preview`,
      score: row.score,
    }));
};

const buildOrders = (orders, query) => {
  if (!Array.isArray(orders)) return [];
  return orders
    .map((order) => ({
      score: bestScore(order, query, [
        "id",
        "token",
        "customer",
        "phone",
        "service",
        "expectedReturn",
      ]),
      ref: order,
      recency: recencyScore(order),
    }))
    .filter((row) => row.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return right.recency - left.recency;
    })
    .slice(0, PER_CATEGORY_LIMIT)
    .map((row) => {
      return {
        kind: "order",
        id: row.ref.id,
        title: row.ref.token || (row.ref.id ? `Order #${row.ref.id}` : "Order"),
        meta: [row.ref.customer, row.ref.phone, row.ref.status].filter(Boolean).join(" · "),
        // Order storeType isn't reliably embedded on each order; the parent router
        // substitutes the active store's order list page at click time.
        href: null,
        score: row.score,
      };
    });
};

const fetchInvoices = async () => {
  // Invoices are fetched here directly (no shared cache yet — only one
  // consumer uses them). Cached in-memory for 30s.
  try {
    const data = await getInvoices();
    return { invoices: Array.isArray(data) ? data : [], failed: [] };
  } catch (err) {
    console.warn("Invoices fetch failed:", err);
    return { invoices: [], failed: ["invoices"] };
  }
};

export const useGlobalSearch = () => {
  const { products, orders } = useDataContext();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState({
    products: [],
    invoices: [],
    orders: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const invoiceCacheRef = useRef({ data: null, fetchedAt: 0, promise: null });
  const debounceRef = useRef(null);
  const requestIdRef = useRef(0);

  const trimQuery = useMemo(() => query.trim(), [query]);

  const runSearch = useCallback(async () => {
    if (!trimQuery) {
      setResults({ products: [], invoices: [], orders: [] });
      setLoading(false);
      setError(null);
      return;
    }

    const myRequestId = ++requestIdRef.current;

    try {
      // Products + orders come straight from the shared DataContext — no
      // fetch, no local cache. Only invoices need a one-off fetch (cached).
      let invoicePayload;
      const now = Date.now();
      const cached = invoiceCacheRef.current;
      if (cached.data && now - cached.fetchedAt < INVOICE_CACHE_TTL_MS) {
        invoicePayload = cached.data;
      } else if (cached.promise) {
        invoicePayload = await cached.promise;
      } else {
        const promise = fetchInvoices().then((data) => {
          invoiceCacheRef.current = {
            data,
            fetchedAt: Date.now(),
            promise: null,
          };
          return data;
        });
        invoiceCacheRef.current.promise = promise;
        invoicePayload = await promise;
      }

      // Bail if the user has typed something else before this round resolved.
      if (myRequestId !== requestIdRef.current) return;

      const failed = invoicePayload.failed || [];
      setResults({
        products: buildProducts(products, trimQuery),
        invoices: buildInvoices(invoicePayload.invoices, trimQuery),
        orders: buildOrders(orders, trimQuery),
      });
      setError(failed.length ? `Couldn't load: ${failed.join(", ")}` : null);
      setLoading(false);
    } catch (err) {
      if (myRequestId !== requestIdRef.current) return;
      console.error("Global search failed:", err);
      setError("Search failed. Check your connection.");
      setLoading(false);
    }
  }, [trimQuery, products, orders]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!trimQuery) {
      setResults({ products: [], invoices: [], orders: [] });
      setLoading(false);
      setError(null);
      return undefined;
    }

    setLoading(true);
    debounceRef.current = setTimeout(() => {
      runSearch();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [trimQuery, runSearch]);

  // Invalidate the invoice cache when the active store changes.
  useEffect(() => {
    const invalidate = () => {
      invoiceCacheRef.current = { data: null, fetchedAt: 0, promise: null };
    };
    window.addEventListener("activeStoreChanged", invalidate);
    window.addEventListener("authChanged", invalidate);
    return () => {
      window.removeEventListener("activeStoreChanged", invalidate);
      window.removeEventListener("authChanged", invalidate);
    };
  }, []);

  const clear = useCallback(() => {
    setQuery("");
    setResults({ products: [], invoices: [], orders: [] });
    setError(null);
    setLoading(false);
  }, []);

  const hasAny = results.products.length + results.invoices.length + results.orders.length > 0;

  return {
    query,
    setQuery,
    results,
    loading,
    error,
    hasAny,
    clear,
  };
};
