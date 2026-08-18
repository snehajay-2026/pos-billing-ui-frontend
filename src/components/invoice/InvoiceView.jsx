import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { getInvoiceByNo, updateInvoice } from "../../services/invoiceService";
import { getStoreSettings } from "../../services/storeSettingsService";
import { getUser } from "../../utils/auth";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import LaundryThermalReceipt from "../laundry/LaundryThermalReceipt";
import LodgingInvoice from "../hotel/LodgingInvoice";
import DiningInvoice from "../hotel/DiningInvoice";
import HotelThermalReceipt from "../hotel/HotelThermalReceipt";
import MSMEInvoice from "./MSMEInvoice";
import RetailPrintInvoice from "./RetailPrintInvoice";
import ServiceInvoice from "./ServiceInvoice";
import { isHotelDiningInvoice } from "../../utils/invoiceType";
import { useUi } from "../../context/UiContext";
import {
  FaCheckCircle,
  FaHourglassHalf,
  FaBan,
  FaUndo,
  FaSearchPlus,
  FaSearchMinus,
} from "react-icons/fa";
import "./InvoiceView.css"; // ⬅️ import new CSS

const InvoiceView = () => {
  const { invoiceNo } = useParams();
  const location = useLocation();

  const isForceReprint = new URLSearchParams(location.search).get("reprint") === "true";

  const previewMode = new URLSearchParams(location.search).get("preview");

  const { showToast } = useUi();

  const [invoice, setInvoice] = useState(null);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [downloadStatus, setDownloadStatus] = useState("");
  const [settings, setSettings] = useState(() => getStoreSettings());
  const [statusBusy, setStatusBusy] = useState(false);
  // "fit" (default) — scale the receipt to whatever vertical space the
  // preview viewport has so the entire invoice is visible without scrolling
  // the page. "actual" — render at natural size (1:1) letting the user
  // scroll inside the receipt card. The toggle is the small zoom button in
  // the header.
  const [zoomMode, setZoomMode] = useState("fit");
  const [fitScale, setFitScale] = useState(1);
  // Hotel store layout: "a4" (modern A4 invoice) or "thermal" (80mm Thermal
  // pillar). The A4 layout is the default — cashiers who want a narrower
  // receipt for a thermal printer can flip this from the header. The toggle
  // is only rendered for hotel invoices; other store types ignore it.
  // The choice is persisted per-store in localStorage so the same cashier
  // gets the same receipt size on every re-open. The query strings
  // `?preview=thermal` (added by HotelBilling when forcing a thermal open)
  // and `?layout=80mm` (added by the share link round-trip) take priority
  // over the stored value, so the cashier's selection survives a deep
  // link / page reload / share-link click-through.
  const HOTEL_LAYOUT_STORAGE_KEY = "hotel_invoice_layout";
  const readInitialHotelLayout = () => {
    if (typeof window === "undefined") return "a4";
    const params = new URLSearchParams(window.location.search);
    const previewFlag = params.get("preview");
    const layoutFlag = params.get("layout");
    if (
      previewFlag === "thermal" ||
      layoutFlag === "80mm" ||
      layoutFlag === "thermal" ||
      layoutFlag === "80mm-thermal"
    ) {
      return "thermal";
    }
    try {
      const stored = window.localStorage.getItem(HOTEL_LAYOUT_STORAGE_KEY);
      if (stored === "thermal" || stored === "a4") return stored;
    } catch (e) {
      /* ignore */
    }
    return "a4";
  };
  const [hotelLayout, setHotelLayout] = useState(readInitialHotelLayout);

  useEffect(() => {
    try {
      window.localStorage.setItem(HOTEL_LAYOUT_STORAGE_KEY, hotelLayout);
    } catch (e) {
      /* ignore */
    }
  }, [hotelLayout]);
  const receiptRef = useRef(null);
  const fitShellRef = useRef(null);
  const invoiceStoreType = invoice?.storeType || invoice?._storeType || settings.businessType;
  const isServiceInvoice = invoiceStoreType === "service" || invoiceStoreType === "msme-service";
  // The selected invoice format is the single source of truth for both
  // this preview session and every downstream touchpoint (PDF download,
  // WhatsApp share, email share, public link). For Hotel invoices the
  // user picks between A4 (full-page modern invoice) and 80mm Thermal
  // (narrow thermal printer column). For non-Hotel invoices the format
  // is implicitly A4 — other store types have exactly one renderer.
  //
  // We propagate the choice to the share link as `?layout=thermal|80mm`
  // (the `80mm` spelling is what the cashier sees on screen and what the
  // PublicInvoiceView accepts) so a customer opening the WhatsApp link
  // from a phone that has no session sees the exact same rendering the
  // cashier did. A4 is the default — we omit the query string in that
  // case so the public URL stays clean for the common path.
  const hotelLayoutParam =
    invoiceStoreType === "hotel" && hotelLayout === "thermal" ? "?layout=80mm" : "";
  const invoiceLink =
    typeof window !== "undefined"
      ? `${window.location.origin}/invoice/${invoiceNo}${hotelLayoutParam}`
      : "";
  const hotelGuestName = invoice?.hotelDetails?.guestName?.trim() || "";
  const customerNameForMessage =
    hotelGuestName ||
    invoice?.customerName?.trim() ||
    settings.customerName?.trim() ||
    "Walking Customer";
  const storeNameForMessage = settings.name?.trim() || "Your Store";

  // === Discount breakdown for share messages =================================
  // Mirrors the renderer chain (HotelThermalReceipt / LodgingInvoice /
  // DiningInvoice). `invoice.subTotal` is POST-discount — when
  // `invoice.discountBreakdown` is present we trust it; otherwise we
  // derive. Only fired when discount metadata is on the invoice so
  // non-Hotel / legacy rows keep their original one-line summary.
  const fmt2 = (n) => (Number(n) || 0).toFixed(2);
  const messageDiscountInfo = invoice?.discount || null;
  const messageDiscountBreakdown = invoice?.discountBreakdown || null;
  let messageDiscountAmount = 0;
  let messageTaxableAmount = Number(invoice?.subTotal || 0);
  if (
    messageDiscountInfo &&
    typeof messageDiscountInfo.value === "number" &&
    messageDiscountInfo.value >= 0
  ) {
    const preDiscountSubtotal =
      Number(invoice?.subTotal || 0) + (messageDiscountBreakdown?.bill ?? 0);
    if (messageDiscountBreakdown && typeof messageDiscountBreakdown.bill === "number") {
      messageDiscountAmount = messageDiscountBreakdown.bill;
    } else if (messageDiscountInfo.type === "percent" && messageDiscountInfo.value <= 100) {
      messageDiscountAmount = Math.min(
        preDiscountSubtotal,
        Math.round(preDiscountSubtotal * messageDiscountInfo.value * 100) / 10000
      );
    }
    messageTaxableAmount =
      messageDiscountBreakdown?.taxableAmount ??
      Math.max(0, preDiscountSubtotal - messageDiscountAmount);
  }
  const messageGstTotal = Number(invoice?.gstTotal || 0);
  const breakdownLine =
    messageDiscountAmount > 0
      ? `Subtotal ₹${fmt2(
          Number(invoice?.subTotal || 0) + messageDiscountAmount
        )} · Discount -₹${fmt2(messageDiscountAmount)} · GST ₹${fmt2(
          messageGstTotal
        )} · Total ₹${fmt2(invoice?.grandTotal || 0)}`
      : `Amount: ₹${invoice?.grandTotal || "0.00"}`;

  // Render the entire receipt (everything you'd see if you scrolled to the
  // bottom) into a single tall image, then split it across as many A4 pages
  // as it needs. Without this, the modernized hotel invoice (and any other
  // receipt taller than the viewport) gets clipped — html2canvas captures
  // whatever's in the layout's visible box by default, and the single-page
  // jsPDF scaled addImage would push the bottom past the page bounds.
  const downloadReceiptPdf = async () => {
    if (!receiptRef.current) return;
    let captureRoot = null;
    try {
      setDownloadStatus("Downloading...");

      const source = receiptRef.current;
      // The source already lives in the DOM, but it might be `overflow: auto`
      // (service invoices) or wrapped in a flex container that constrains the
      // rendered box. Clone it into an off-screen container with no size cap
      // so html2canvas gets the full scrollHeight, and strip any preview
      // `transform: scale(...)` so the captured image is 1:1 with the printed
      // output.
      const clone = source.cloneNode(true);
      clone.style.position = "fixed";
      clone.style.left = "-10000px";
      clone.style.top = "0";
      clone.style.zIndex = "-1";
      clone.style.transform = "none";
      clone.style.transformOrigin = "top left";
      clone.style.maxWidth = "none";
      clone.style.width = `${source.scrollWidth}px`;
      clone.style.height = `${source.scrollHeight}px`;
      clone.style.overflow = "visible";
      // Walk children and clear any transform / scale the preview chrome
      // applied, so the captured image isn't visually shrunk.
      const all = clone.querySelectorAll("*");
      all.forEach((el) => {
        el.style.transform = "none";
        el.style.transformOrigin = "top left";
      });
      document.body.appendChild(clone);
      captureRoot = clone;

      // Wait one frame so the layout settles before html2canvas reads from it.
      await new Promise((resolve) => window.requestAnimationFrame(resolve));

      const canvas = await html2canvas(clone, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        // Width/height + windowWidth/Height force html2canvas to walk the
        // full node, not just the visible viewport.
        width: clone.scrollWidth,
        height: clone.scrollHeight,
        windowWidth: clone.scrollWidth,
        windowHeight: clone.scrollHeight,
      });

      const imgData = canvas.toDataURL("image/png");
      const imgProps = {
        width: canvas.width,
        height: canvas.height,
      };

      // Page size is driven by the cashier's selected layout (the single
      // source of truth). For Hotel invoices the user can toggle between
      // A4 (default modern full-page invoice) and 80mm Thermal (narrow
      // thermal printer column). Every other store type is implicitly A4
      // — there is no other renderer to pick, so the toggle isn't shown.
      //
      // A4 portrait: 210mm x 297mm, 10mm side margins → 190mm printable.
      // 80mm Thermal: 80mm wide pillar, dynamic length (we use a generous
      // 5000mm so the captured image fits on a single page; jsPDF scales
      // the addImage call to the printable area so the output is a real
      // 80mm-wide receipt, not a stretched A4 sheet).
      const useThermalPage = invoiceStoreType === "hotel" && hotelLayout === "thermal";
      const pdf = useThermalPage
        ? new jsPDF({ unit: "mm", format: [80, 5000], orientation: "portrait" })
        : new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageWidthMm = useThermalPage ? 80 : 210;
      const pageHeightMm = useThermalPage ? 5000 : 297;
      const marginMm = useThermalPage ? 4 : 10;
      const printableWidthMm = pageWidthMm - marginMm * 2;
      const printableHeightMm = pageHeightMm - marginMm * 2;

      // Scale the captured image so it spans the full printable width. The
      // image's height in PDF mm becomes (imgHeight / imgWidth) * printableWidth.
      const imgHeightMm = (imgProps.height * printableWidthMm) / imgProps.width;

      // If it fits on one page, render normally. Otherwise slice the image
      // into page-height bands and addImage each band as its own page.
      if (imgHeightMm <= printableHeightMm) {
        pdf.addImage(imgData, "PNG", marginMm, marginMm, printableWidthMm, imgHeightMm);
      } else {
        // Render the full image once into a temporary canvas at print width,
        // then cut page-height slices out of it for each PDF page. This
        // keeps the printed content at native resolution rather than
        // letting jsPDF re-compress the same PNG once per page.
        const sliceCanvas = document.createElement("canvas");
        const sliceHeightPx = Math.floor((printableHeightMm / imgHeightMm) * imgProps.height);
        sliceCanvas.width = imgProps.width;
        sliceCanvas.height = sliceHeightPx;
        const sliceCtx = sliceCanvas.getContext("2d");
        sliceCtx.fillStyle = "#ffffff";
        sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);

        let yOffset = 0;
        let pageIndex = 0;
        while (yOffset < imgProps.height) {
          const remaining = imgProps.height - yOffset;
          const drawHeight = Math.min(sliceHeightPx, remaining);
          sliceCtx.clearRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          sliceCtx.fillStyle = "#ffffff";
          sliceCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
          sliceCtx.drawImage(
            canvas,
            0,
            yOffset,
            imgProps.width,
            drawHeight,
            0,
            0,
            imgProps.width,
            drawHeight
          );
          const sliceData = sliceCanvas.toDataURL("image/png");
          const sliceHeightMm = (drawHeight * printableWidthMm) / imgProps.width;
          if (pageIndex > 0) pdf.addPage();
          pdf.addImage(sliceData, "PNG", marginMm, marginMm, printableWidthMm, sliceHeightMm);
          yOffset += drawHeight;
          pageIndex += 1;
        }
      }

      pdf.save(`${invoiceNo || "receipt"}.pdf`);
      setDownloadStatus("Download complete");
    } catch (error) {
      console.error(error);
      setDownloadStatus("Download failed. Please try again.");
    } finally {
      if (captureRoot && captureRoot.parentNode) {
        captureRoot.parentNode.removeChild(captureRoot);
      }
      window.setTimeout(() => setDownloadStatus(""), 2400);
    }
  };

  const shareViaWhatsApp = () => {
    const text = encodeURIComponent(
      `Dear ${customerNameForMessage},\n\nInvoice ${invoiceNo}\n${breakdownLine}\nView receipt: ${invoiceLink}`
    );
    window.open(`https://wa.me/?text=${text}`, "_blank");
  };

  const shareViaEmail = () => {
    const subject = encodeURIComponent(`Digital Receipt - ${invoiceNo}`);
    const emailLines = [
      `Dear ${customerNameForMessage},`,
      "",
      `Please find the digital receipt for invoice ${invoiceNo}.`,
    ];

    if (invoiceStoreType === "hotel" && hotelGuestName) {
      emailLines.push(`Guest Name: ${hotelGuestName}`);
    }

    emailLines.push(breakdownLine);
    emailLines.push(`View receipt: ${invoiceLink}`);
    emailLines.push("");
    emailLines.push("Thank you.");
    emailLines.push(storeNameForMessage);

    const body = encodeURIComponent(emailLines.join("\n"));
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`;

    try {
      window.open(gmailUrl, "_blank", "noopener");
      setDownloadStatus("Opening Gmail compose...");
    } catch (error) {
      console.error(error);
      const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
      window.open(mailtoLink, "_blank");
      setDownloadStatus("Opening default mail client...");
    }

    window.setTimeout(() => setDownloadStatus(""), 2400);
  };

  useEffect(() => {
    const syncSettings = () => {
      setSettings(getStoreSettings());
    };

    const loadInvoice = async () => {
      try {
        const data = await getInvoiceByNo(invoiceNo);
        setInvoice(data);
      } catch (err) {
        console.error("Failed to load invoice:", err);
        setInvoice(null);
      }
    };

    loadInvoice();
    syncSettings();
    window.addEventListener("activeStoreChanged", syncSettings);
    window.addEventListener("authChanged", syncSettings);
    window.addEventListener("storeSettingsChanged", syncSettings);

    return () => {
      window.removeEventListener("activeStoreChanged", syncSettings);
      window.removeEventListener("authChanged", syncSettings);
      window.removeEventListener("storeSettingsChanged", syncSettings);
    };
  }, [invoiceNo]);

  const currentStatus = (invoice?.status || "pending").toLowerCase();

  const STATUS_META = {
    pending: {
      label: "Pending",
      tone: "is-pending",
      icon: <FaHourglassHalf />,
      blurb: "This invoice is awaiting payment / clearance.",
    },
    paid: {
      label: "Cleared",
      tone: "is-cleared",
      icon: <FaCheckCircle />,
      blurb: "Marked as paid. You can revert to Pending if needed.",
    },
    cleared: {
      label: "Cleared",
      tone: "is-cleared",
      icon: <FaCheckCircle />,
      blurb: "Marked as cleared. You can revert to Pending if needed.",
    },
    cancelled: {
      label: "Cancelled",
      tone: "is-cancelled",
      icon: <FaBan />,
      blurb: "This invoice has been cancelled.",
    },
  };

  const statusMeta = STATUS_META[currentStatus] || STATUS_META.pending;

  const setInvoiceStatus = async (nextStatus) => {
    if (!invoice || statusBusy) return;
    setStatusBusy(true);
    try {
      const updated = await updateInvoice(invoice.invoiceNo, { status: nextStatus });
      setInvoice(updated);
      showToast("success", `Invoice marked as ${STATUS_META[nextStatus]?.label || nextStatus}`);
    } catch (err) {
      console.error("Failed to update invoice status:", err);
      showToast("error", err.message || "Failed to update status");
    } finally {
      setStatusBusy(false);
    }
  };

  useEffect(() => {
    if (isForceReprint) {
      setIsDuplicate(true);
      return;
    }
    setIsDuplicate(false);
  }, [invoiceNo, isForceReprint]);

  // Fit-to-window scaling for the preview. The receipt is rendered at its
  // natural size (A4 for hotel/service, 80mm for retail, etc.) so the PDF
  // capture pipeline keeps working unchanged. The shell wrapper uses a CSS
  // transform (`scale(s)`) to shrink the receipt so it fits the available
  // vertical space below the sticky header. The receipt's actual DOM size
  // is *not* changed — only the visual presentation, so the capture path
  // and the print path both still walk the unmagnified tree.
  useLayoutEffect(() => {
    if (zoomMode !== "fit") return undefined;
    const recompute = () => {
      const shell = fitShellRef.current;
      const receipt = receiptRef.current;
      if (!shell || !receipt) return;
      const available = shell.clientHeight;
      if (!available) return;
      // Read the receipt's natural height BEFORE any transform — the
      // previous transform is on a different property, so this is the
      // un-scaled content size.
      const natural = receipt.scrollHeight;
      if (!natural) return;
      // 8px breathing room so the card's bottom shadow doesn't get clipped.
      const margin = 8;
      const raw = (available - margin) / natural;
      const scale = Math.min(1, Math.max(0.2, raw));
      setFitScale(scale);
    };
    recompute();
    const shell = fitShellRef.current;
    if (!shell || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(recompute);
    ro.observe(shell);
    window.addEventListener("resize", recompute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [zoomMode, invoice]);

  const handlePrint = () => {
    // Retail: show ONLY the receipt in print preview/output (no surrounding frame)
    if (invoiceStoreType === "retail" || previewMode === "retail") {
      document.body.classList.add("print-retail-only");

      const cleanup = () => {
        document.body.classList.remove("print-retail-only");
        window.removeEventListener("afterprint", cleanup);
      };

      window.addEventListener("afterprint", cleanup);
    } else if (
      invoiceStoreType === "hotel" &&
      hotelLayout === "thermal" &&
      previewMode !== "retail"
    ) {
      // Hotel thermal layout: hide the surrounding preview chrome so the
      // 80 mm printout doesn't pull in the InvoiceView action bar / status
      // controls. The thermal CSS already hides everything but its own
      // container; toggling this class also hides the action group as a
      // belt-and-braces guard.
      document.body.classList.add("print-hotel-thermal-only");

      const cleanup = () => {
        document.body.classList.remove("print-hotel-thermal-only");
        window.removeEventListener("afterprint", cleanup);
      };

      window.addEventListener("afterprint", cleanup);
    }

    setTimeout(() => window.print(), 150);
  };

  const renderThermalReceipt = () => {
    if (!invoice) {
      return <div className="text-center text-muted">Loading invoice...</div>;
    }

    switch (invoiceStoreType) {
      case "laundry":
        return <LaundryThermalReceipt invoice={invoice} isDuplicate={isDuplicate} />;
      case "service":
        return <ServiceInvoice invoice={invoice} isDuplicate={isDuplicate} />;
      case "msme-service":
        return <MSMEInvoice invoice={invoice} isDuplicate={isDuplicate} />;
      case "hotel":
        if (previewMode === "retail") {
          return (
            <div id="retail-print-area">
              <RetailPrintInvoice invoice={invoice} isDuplicate={isDuplicate} />
            </div>
          );
        }
        if (hotelLayout === "thermal") {
          // Cashier's Invoice Preview — show the live current time so the
          // Time block reflects "now" each time the preview is opened,
          // per the user's request. The Public Invoice (rendered via
          // PublicInvoiceView, which does NOT pass showLiveTime) keeps
          // the captured generation moment so the customer-facing share
          // link still shows the exact moment the cashier clicked
          // Generate Invoice.
          return <HotelThermalReceipt invoice={invoice} isDuplicate={isDuplicate} showLiveTime />;
        }
        return isHotelDiningInvoice(invoice) ? (
          <DiningInvoice invoice={invoice} isDuplicate={isDuplicate} showLiveTime />
        ) : (
          <LodgingInvoice invoice={invoice} isDuplicate={isDuplicate} />
        );
      case "retail":
        return (
          <div id="retail-print-area">
            <RetailPrintInvoice invoice={invoice} isDuplicate={isDuplicate} />
          </div>
        );
      default:
        return <RetailPrintInvoice invoice={invoice} isDuplicate={isDuplicate} />;
    }
  };

  if (invoice === null) {
    return (
      <div className="invoice-container">
        <div className="error-box">Loading invoice…</div>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="invoice-container">
        <div className="error-box">Invoice not found ❌</div>
      </div>
    );
  }

  return (
    <div className={`invoice-container${isServiceInvoice ? " invoice-container-service" : ""}`}>
      {/* HEADER BAR */}
      <div className="invoice-header d-print-none">
        <div>
          <h3>Invoice Preview</h3>
          <p className="invoice-subtitle">
            Digital receipt, QR link, and share options are available here.
          </p>
        </div>
        <div className="invoice-action-group">
          {invoiceStoreType === "hotel" && previewMode !== "retail" ? (
            <div className="invoice-layout-toggle" role="group" aria-label="Hotel invoice layout">
              <button
                type="button"
                className={`invoice-action-btn invoice-layout-toggle-btn ${
                  hotelLayout === "a4" ? "is-active" : ""
                }`}
                onClick={() => setHotelLayout("a4")}
                title="A4 / full-page invoice layout"
              >
                A4 Size
              </button>
              <button
                type="button"
                className={`invoice-action-btn invoice-layout-toggle-btn ${
                  hotelLayout === "thermal" ? "is-active" : ""
                }`}
                onClick={() => setHotelLayout("thermal")}
                title="80 mm thermal-pillar layout"
              >
                80mm Thermal
              </button>
            </div>
          ) : null}
          <button
            type="button"
            className={`invoice-action-btn ${zoomMode === "fit" ? "is-active" : ""}`}
            onClick={() => setZoomMode(zoomMode === "fit" ? "actual" : "fit")}
            title={
              zoomMode === "fit"
                ? "Switch to 100% (actual size)"
                : "Switch to fit-to-window (auto-shrink to show whole invoice)"
            }
          >
            {zoomMode === "fit" ? (
              <>
                <FaSearchPlus /> Fit
              </>
            ) : (
              <>
                <FaSearchMinus /> 100%
              </>
            )}
          </button>
          <button
            className="invoice-action-btn"
            onClick={downloadReceiptPdf}
            disabled={downloadStatus === "Downloading..."}
          >
            {downloadStatus === "Downloading..." ? "Downloading..." : "Download Receipt"}
          </button>
          <button className="invoice-action-btn" onClick={shareViaWhatsApp}>
            Share WhatsApp
          </button>
          <button className="invoice-action-btn" onClick={shareViaEmail}>
            Send Email
          </button>
          <button className="print-btn" onClick={handlePrint}>
            {isDuplicate ? "Reprint Invoice" : "Print Invoice"}
          </button>
        </div>
        {downloadStatus && <div className="download-status-message">{downloadStatus}</div>}
      </div>

      {/* STATUS CONTROL BAR — only for service invoices */}
      {isServiceInvoice && (
        <div className={`invoice-status-bar ${statusMeta.tone} d-print-none`}>
          <div className="invoice-status-info">
            <span className="invoice-status-ico">{statusMeta.icon}</span>
            <div className="invoice-status-meta">
              <strong>Status: {statusMeta.label}</strong>
              <small>{statusMeta.blurb}</small>
            </div>
          </div>
          <div className="invoice-status-actions">
            {currentStatus !== "cleared" && currentStatus !== "paid" && (
              <button
                type="button"
                className="invoice-action-btn invoice-action-btn-success"
                onClick={() => setInvoiceStatus("cleared")}
                disabled={statusBusy}
              >
                {statusBusy ? <span className="inv-spinner" /> : <FaCheckCircle />}
                <span>Mark as Cleared</span>
              </button>
            )}
            {(currentStatus === "cleared" || currentStatus === "paid") && (
              <button
                type="button"
                className="invoice-action-btn invoice-action-btn-ghost"
                onClick={() => setInvoiceStatus("pending")}
                disabled={statusBusy}
              >
                <FaUndo />
                <span>Revert to Pending</span>
              </button>
            )}
            {currentStatus !== "cancelled" && (
              <button
                type="button"
                className="invoice-action-btn invoice-action-btn-danger-soft"
                onClick={() => setInvoiceStatus("cancelled")}
                disabled={statusBusy}
              >
                <FaBan />
                <span>Cancel invoice</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* MAIN CARD */}
      <div
        className={`invoice-card ${isServiceInvoice ? "service-invoice-card" : invoiceStoreType === "retail" ? "retail-invoice-card" : ""}`}
      >
        {/* DUPLICATE LABEL ABOVE RECEIPT */}
        {isDuplicate && <div className="duplicate-badge">DUPLICATE COPY</div>}

        {/*
          Fit shell:
            - Outer div is the "viewport" — fills the remaining vertical
              space below the sticky header/toolbar, capped to a sensible
              max so the receipt never feels tiny on a 4K monitor.
            - The inner receipt is rendered at its natural size and scaled
              via CSS `transform: scale(s)` so the whole invoice is visible
              without scrolling. Scaling does NOT change the DOM/layout,
              so the PDF capture path and the print path still see the
              full un-magnified tree.
            - When the user toggles to "100%", the scale is set to 1 and
              the shell becomes a normal scrollable container.
        */}
        <div
          ref={fitShellRef}
          className={`invoice-fit-shell ${zoomMode === "fit" ? "is-fit" : "is-actual"}`}
        >
          <div
            className="receipt-preview"
            ref={receiptRef}
            style={zoomMode === "fit" ? { transform: `scale(${fitScale})` } : undefined}
          >
            {renderThermalReceipt()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InvoiceView;
