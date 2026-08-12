import React, { useState, useEffect, useMemo } from "react";
import { getInvoices } from "../../services/invoiceService";
import { Link } from "react-router-dom";
import { isHotelDiningInvoice, isHotelLodgingInvoice } from "../../utils/invoiceType";
import {
  FaFileInvoice,
  FaSearch,
  FaCalendarAlt,
  FaTimes,
  FaEye,
  FaPrint,
  FaRupeeSign,
  FaShoppingBag,
  FaReceipt,
  FaFilter,
  FaSyncAlt,
  FaChevronLeft,
  FaChevronRight,
  FaBed,
  FaUtensils,
  FaStore,
  FaExclamationTriangle,
} from "react-icons/fa";
import { useUi } from "../../context/UiContext";
import "./InvoiceList.css";

const fmtINR = (num) =>
  `₹${Number(num || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const InvoiceList = ({ title = "Invoices", invoiceFilter = "all" }) => {
  const [invoices, setInvoices] = useState([]);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const itemsPerPage = 10;
  const { showToast } = useUi();

  const loadInvoices = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await getInvoices();
      setInvoices(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Failed to load invoices:", err);
      setInvoices([]);
      showToast("error", "Could not load invoices. Please try again.");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
    const onCustom = (e) => {
      if (e.detail === "invoices") loadInvoices(true);
    };
    window.addEventListener("dataUpdated", onCustom);
    return () => window.removeEventListener("dataUpdated", onCustom);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [search, fromDate, toDate, invoiceFilter, paymentFilter]);

  const matchesInvoiceFilter = (invoice) => {
    switch (invoiceFilter) {
      case "hotel-dining":
        return isHotelDiningInvoice(invoice);
      case "hotel-lodging":
        return isHotelLodgingInvoice(invoice);
      default:
        return true;
    }
  };

  /* ---------------- Derived stats ---------------- */
  const stats = useMemo(() => {
    const filtered = invoices.filter(matchesInvoiceFilter);
    const totalAmount = filtered.reduce((s, inv) => s + Number(inv.grandTotal || 0), 0);
    const totalGst = filtered.reduce((s, inv) => s + Number(inv.gstTotal || 0), 0);
    const today = new Date().toISOString().split("T")[0];
    const todayCount = filtered.filter((inv) => inv.date === today).length;
    const todayAmount = filtered
      .filter((inv) => inv.date === today)
      .reduce((s, inv) => s + Number(inv.grandTotal || 0), 0);
    return { count: filtered.length, totalAmount, totalGst, todayCount, todayAmount };
  }, [invoices, invoiceFilter]);

  /* ---------------- Filter logic ---------------- */
  const filteredInvoices = invoices.filter((inv) => {
    const invoiceNoStr = inv.invoiceNo ? String(inv.invoiceNo) : "";
    const dateStr = inv.date ? String(inv.date) : "";

    const term = search.trim().toLowerCase();
    const matchesSearch = term
      ? invoiceNoStr.toLowerCase().includes(term) ||
        dateStr.toLowerCase().includes(term) ||
        (inv.customerName || "").toLowerCase().includes(term) ||
        (inv.paymentMode || "").toLowerCase().includes(term)
      : true;

    const invoiceDate = new Date(inv.date);
    const matchesFrom = fromDate ? invoiceDate >= new Date(fromDate) : true;
    const matchesTo = toDate ? invoiceDate <= new Date(`${toDate}T23:59:59`) : true;
    const matchesPay =
      paymentFilter === "all" ? true : (inv.paymentMode || "").toLowerCase() === paymentFilter;

    return matchesInvoiceFilter(inv) && matchesSearch && matchesFrom && matchesTo && matchesPay;
  });

  /* ---------------- Pagination ---------------- */
  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / itemsPerPage));
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedInvoices = filteredInvoices.slice(startIndex, startIndex + itemsPerPage);

  /* ---------------- Helpers ---------------- */
  const heroCopy = useMemo(() => {
    if (invoiceFilter === "hotel-dining") {
      return {
        title: "Hotel Dining Invoices",
        subtitle: "Browse and print bills generated from hotel dining orders.",
        icon: <FaUtensils />,
        eyebrow: "Hotel · Dining",
      };
    }
    if (invoiceFilter === "hotel-lodging") {
      return {
        title: "Hotel Lodging Invoices",
        subtitle: "Browse and print bills generated from hotel lodging bookings.",
        icon: <FaBed />,
        eyebrow: "Hotel · Lodging",
      };
    }
    return {
      title: title || "Invoices",
      subtitle: "Browse, search and print every invoice across all sales channels.",
      icon: <FaStore />,
      eyebrow: "Retail · All invoices",
    };
  }, [invoiceFilter, title]);

  const paymentTone = (mode) => {
    const m = (mode || "").toLowerCase();
    if (m === "upi") return "upi";
    if (m === "card") return "card";
    return "cash";
  };

  const itemCount = (inv) =>
    Array.isArray(inv.items) ? inv.items.length : Number(inv.itemCount || 0);

  const clearFilters = () => {
    setSearch("");
    setFromDate("");
    setToDate("");
    setPaymentFilter("all");
  };

  const hasFilters = search || fromDate || toDate || paymentFilter !== "all";

  return (
    <div className="il-page">
      {/* Hero */}
      <header className="il-hero">
        <div className="il-hero-text">
          <span className="il-eyebrow">{heroCopy.eyebrow}</span>
          <h2 className="il-hero-title">
            {heroCopy.icon} {heroCopy.title}
          </h2>
          <p className="il-hero-sub">{heroCopy.subtitle}</p>
        </div>
        <button
          type="button"
          className="il-refresh-btn"
          onClick={() => loadInvoices()}
          title="Refresh"
        >
          <FaSyncAlt />
          <span>Refresh</span>
        </button>
      </header>

      {/* KPI tiles */}
      <section className="il-tile-grid">
        <article className="il-tile il-tile-blue">
          <div className="il-tile-icon">
            <FaFileInvoice />
          </div>
          <div className="il-tile-meta">
            <span>Total Invoices</span>
            <strong>{stats.count}</strong>
            <small>matching the active filter</small>
          </div>
        </article>
        <article className="il-tile il-tile-emerald">
          <div className="il-tile-icon">
            <FaRupeeSign />
          </div>
          <div className="il-tile-meta">
            <span>Total Revenue</span>
            <strong>{fmtINR(stats.totalAmount)}</strong>
            <small>incl. {fmtINR(stats.totalGst)} GST</small>
          </div>
        </article>
        <article className="il-tile il-tile-violet">
          <div className="il-tile-icon">
            <FaReceipt />
          </div>
          <div className="il-tile-meta">
            <span>Today</span>
            <strong>{stats.todayCount}</strong>
            <small>{fmtINR(stats.todayAmount)} billed</small>
          </div>
        </article>
        <article className="il-tile il-tile-amber">
          <div className="il-tile-icon">
            <FaShoppingBag />
          </div>
          <div className="il-tile-meta">
            <span>Avg. Bill</span>
            <strong>{fmtINR(stats.count ? stats.totalAmount / stats.count : 0)}</strong>
            <small>per invoice</small>
          </div>
        </article>
      </section>

      {/* Toolbar */}
      <section className="il-toolbar">
        <div className="il-search">
          <FaSearch />
          <input
            type="text"
            placeholder="Search by invoice no, date, customer or payment mode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="il-search-clear"
              onClick={() => setSearch("")}
              aria-label="Clear search"
            >
              <FaTimes />
            </button>
          )}
        </div>
        <div className="il-date-field">
          <FaCalendarAlt />
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            aria-label="From date"
          />
          <span className="il-date-sep">→</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            aria-label="To date"
          />
        </div>
        <div className="il-pay-chips">
          <FaFilter className="il-chip-ico" />
          {[
            { key: "all", label: "All" },
            { key: "cash", label: "Cash" },
            { key: "upi", label: "UPI" },
            { key: "card", label: "Card" },
          ].map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`il-chip ${paymentFilter === opt.key ? "is-active" : ""}`}
              onClick={() => setPaymentFilter(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {hasFilters && (
          <button type="button" className="il-btn-clear" onClick={clearFilters}>
            <FaTimes />
            <span>Clear</span>
          </button>
        )}
      </section>

      {/* Table */}
      <section className="il-list-card">
        <div className="il-list-head">
          <div>
            <h5>
              <FaFileInvoice className="il-card-ico" /> All Invoices
            </h5>
            <p>
              {filteredInvoices.length} invoice{filteredInvoices.length === 1 ? "" : "s"} shown
            </p>
          </div>
        </div>

        {loading ? (
          <div className="il-skeleton">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="il-skeleton-row" />
            ))}
          </div>
        ) : paginatedInvoices.length === 0 ? (
          <div className="il-empty">
            <div className="il-empty-illu">
              <FaFileInvoice />
            </div>
            <h6>No invoices found</h6>
            <p>
              {invoices.length === 0
                ? "Create your first bill from the POS page."
                : "Try adjusting your search or clearing filters."}
            </p>
            {hasFilters && (
              <button type="button" className="il-btn-primary" onClick={clearFilters}>
                <FaTimes />
                <span>Clear filters</span>
              </button>
            )}
          </div>
        ) : (
          <>
            <div className="il-table-wrap">
              <table className="il-table">
                <thead>
                  <tr>
                    <th className="il-ta-center">#</th>
                    <th>Invoice No</th>
                    <th>Date</th>
                    <th>Items</th>
                    <th>Customer</th>
                    <th>Payment</th>
                    <th className="il-ta-right">Total</th>
                    <th className="il-ta-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {[...paginatedInvoices].reverse().map((inv, index) => {
                    const hasInvoiceNo =
                      inv.invoiceNo !== undefined && inv.invoiceNo !== null && inv.invoiceNo !== "";
                    return (
                      <tr key={inv.invoiceNo || index}>
                        <td className="il-ta-center il-mono">{startIndex + index + 1}</td>
                        <td>
                          {hasInvoiceNo ? (
                            <span className="il-invoice-no">{inv.invoiceNo}</span>
                          ) : (
                            <span className="il-invalid">
                              <FaExclamationTriangle /> Invalid
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="il-cell-date">
                            <strong>{inv.date ?? "N/A"}</strong>
                          </div>
                        </td>
                        <td className="il-ta-center">
                          <span className="il-count-pill">
                            <FaShoppingBag /> {itemCount(inv)}
                          </span>
                        </td>
                        <td>
                          <div className="il-cell-customer">
                            <span className="il-avatar">
                              {(inv.customerName || inv.invoiceNo || "W")
                                .toString()[0]
                                .toUpperCase()}
                            </span>
                            <strong>{inv.customerName || "Walk-in"}</strong>
                          </div>
                        </td>
                        <td>
                          <span className={`il-pay-pill il-pay-${paymentTone(inv.paymentMode)}`}>
                            {inv.paymentMode || "Cash"}
                          </span>
                        </td>
                        <td className="il-ta-right">
                          <strong className="il-total">
                            {inv.grandTotal ? fmtINR(inv.grandTotal) : "—"}
                          </strong>
                        </td>
                        <td className="il-ta-right">
                          {hasInvoiceNo ? (
                            <Link
                              className="il-btn-view"
                              to={`/invoice/${String(inv.invoiceNo)}/preview`}
                            >
                              <FaEye />
                              <span>View</span>
                              <FaPrint className="il-print-ico" />
                            </Link>
                          ) : (
                            <span className="il-invalid small">
                              <FaExclamationTriangle /> Not available
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="il-pagination">
                <span className="il-page-info">
                  Showing <strong>{startIndex + 1}</strong>–
                  <strong>{Math.min(startIndex + itemsPerPage, filteredInvoices.length)}</strong> of{" "}
                  <strong>{filteredInvoices.length}</strong>
                </span>
                <div className="il-page-controls">
                  <button
                    type="button"
                    className="il-page-btn"
                    onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                    disabled={currentPage === 1}
                  >
                    <FaChevronLeft />
                    <span>Prev</span>
                  </button>
                  <div className="il-page-numbers">
                    {Array.from({ length: totalPages }).map((_, i) => {
                      const page = i + 1;
                      // Show a window of pages around current
                      if (page === 1 || page === totalPages || Math.abs(page - currentPage) <= 1) {
                        return (
                          <button
                            key={page}
                            type="button"
                            className={`il-page-num ${currentPage === page ? "is-active" : ""}`}
                            onClick={() => setCurrentPage(page)}
                          >
                            {page}
                          </button>
                        );
                      }
                      if (
                        (page === currentPage - 2 && currentPage > 3) ||
                        (page === currentPage + 2 && currentPage < totalPages - 2)
                      ) {
                        return (
                          <span key={page} className="il-page-ellipsis">
                            …
                          </span>
                        );
                      }
                      return null;
                    })}
                  </div>
                  <button
                    type="button"
                    className="il-page-btn"
                    onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                    disabled={currentPage === totalPages}
                  >
                    <span>Next</span>
                    <FaChevronRight />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};

export default InvoiceList;
