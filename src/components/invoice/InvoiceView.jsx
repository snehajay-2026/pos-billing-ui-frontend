import React, { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import { getInvoiceByNo, updateInvoice } from "../../services/invoiceService";
import { getStoreSettings } from "../../services/storeSettingsService";
import { getUser } from "../../utils/auth";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import LaundryThermalReceipt from "../laundry/LaundryThermalReceipt";
import LodgingInvoice from "../hotel/LodgingInvoice";
import DiningInvoice from "../hotel/DiningInvoice";
import MSMEInvoice from "./MSMEInvoice";
import RetailPrintInvoice from "./RetailPrintInvoice";
import ServiceInvoice from "./ServiceInvoice";
import { isHotelDiningInvoice } from "../../utils/invoiceType";
import { useUi } from "../../context/UiContext";
import { FaCheckCircle, FaHourglassHalf, FaBan, FaUndo } from "react-icons/fa";
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
  const receiptRef = useRef(null);
  const invoiceStoreType = invoice?.storeType || invoice?._storeType || settings.businessType;
  const isServiceInvoice = invoiceStoreType === "service" || invoiceStoreType === "msme-service";
  const invoiceLink =
    typeof window !== "undefined" ? `${window.location.origin}/invoice/${invoiceNo}` : "";
  const hotelGuestName = invoice?.hotelDetails?.guestName?.trim() || "";
  const customerNameForMessage =
    hotelGuestName ||
    invoice?.customerName?.trim() ||
    settings.customerName?.trim() ||
    "Walking Customer";
  const storeNameForMessage = settings.name?.trim() || "Your Store";

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

      // A4 portrait with 10mm side margins → 190mm printable width.
      // Total page height (297mm) minus 10mm top + 10mm bottom = 277mm of
      // printable height per page.
      const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
      const pageWidthMm = 210;
      const pageHeightMm = 297;
      const marginMm = 10;
      const printableWidthMm = pageWidthMm - marginMm * 2; // 190mm
      const printableHeightMm = pageHeightMm - marginMm * 2; // 277mm

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
      `Dear ${customerNameForMessage},\n\nInvoice ${invoiceNo}\nAmount: ₹${invoice?.grandTotal || "0.00"}\nView receipt: ${invoiceLink}`
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

    emailLines.push(`Amount: ₹${invoice?.grandTotal || "0.00"}`);
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

  const handlePrint = () => {
    // Retail: show ONLY the receipt in print preview/output (no surrounding frame)
    if (invoiceStoreType === "retail" || previewMode === "retail") {
      document.body.classList.add("print-retail-only");

      const cleanup = () => {
        document.body.classList.remove("print-retail-only");
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
        return isHotelDiningInvoice(invoice) ? (
          <DiningInvoice invoice={invoice} isDuplicate={isDuplicate} />
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

        <div className="receipt-preview" ref={receiptRef}>
          {renderThermalReceipt()}
        </div>
      </div>
    </div>
  );
};

export default InvoiceView;
