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

  const downloadReceiptPdf = async () => {
    if (!receiptRef.current) return;
    try {
      setDownloadStatus("Downloading...");
      const canvas = await html2canvas(receiptRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ unit: "mm", format: "a4" });
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = 190;
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      pdf.addImage(imgData, "PNG", 10, 10, pdfWidth, pdfHeight);
      pdf.save(`${invoiceNo || "receipt"}.pdf`);
      setDownloadStatus("Download complete");
    } catch (error) {
      console.error(error);
      setDownloadStatus("Download failed. Please try again.");
    } finally {
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
