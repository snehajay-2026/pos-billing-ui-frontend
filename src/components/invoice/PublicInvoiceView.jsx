// src/components/invoice/PublicInvoiceView.jsx
//
// Minimal, action-bar-less invoice viewer for the WhatsApp/Email share
// link at `/invoice/:invoiceNo`. A customer opening the link from a
// phone should see only the invoice — no Print, no WhatsApp/Email
// re-share, no status-edit, no Login redirect.
//
// The renderers below (RetailPrintInvoice, LaundryThermalReceipt,
// LodgingInvoice, DiningInvoice, HotelThermalReceipt, MSMEInvoice,
// ServiceInvoice) are the same presentational components the cashier
// preview uses, so the visual output matches. The difference is that
// this page seeds the in-memory store-settings cache from the public
// API response (`response.store`) via `seedStoreSettingsForScope()` so
// the renderers read the real store name/address/GSTIN/logo instead of
// the "Ajay Merchant" fallback.
//
// IMPORTANT: This component is rendered WITHOUT <RequireAuth>. It must
// never call any auth-required service (apiGet on /api/invoices/:no,
// apiGet on /api/store-settings, etc.). All data comes from the public
// `/api/public/invoices/:invoiceNo` endpoint.

import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getPublicInvoiceByNo } from "../../services/invoiceService";
import { seedStoreSettingsForScope } from "../../services/storeSettingsService";
import LaundryThermalReceipt from "../laundry/LaundryThermalReceipt";
import LodgingInvoice from "../hotel/LodgingInvoice";
import DiningInvoice from "../hotel/DiningInvoice";
import HotelThermalReceipt from "../hotel/HotelThermalReceipt";
import MSMEInvoice from "./MSMEInvoice";
import RetailPrintInvoice from "./RetailPrintInvoice";
import ServiceInvoice from "./ServiceInvoice";
import { isHotelDiningInvoice } from "../../utils/invoiceType";
import "./PublicInvoiceView.css";

const PublicInvoiceView = () => {
  const { invoiceNo } = useParams();
  const [state, setState] = useState({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await getPublicInvoiceByNo(invoiceNo);
        if (cancelled) return;

        // Seed the store-settings cache BEFORE we paint so the thermal
        // renderers read the real store chrome (name, address, logo,
        // GSTIN, etc.). Without this, they fall back to the default
        // "Ajay Merchant" placeholder identity.
        if (response && response.store && typeof response.store === "object") {
          const inv = response.invoice || {};
          // Use the same scope key the authed `/api/store-settings`
          // endpoint seeds (`store-settings:<storeType>:<storeId>`) so
          // the renderer reads the same store the cashier's preview
          // shows. Mirror storeType onto storeId only when the backend
          // hasn't told us a separate id (single-tenant stores).
          const storeType = inv.storeType || "";
          const storeId =
            inv.storeId ||
            (response.store && (response.store.storeId || response.store.store_id)) ||
            storeType;
          seedStoreSettingsForScope({
            storeType,
            storeId,
            ...response.store,
          });
        }

        setState({ status: "ok", invoice: (response && response.invoice) || null });
      } catch (err) {
        if (cancelled) return;
        // The api.js helper attaches err.status for non-2xx responses
        // so we can branch on 404 cleanly without parsing messages.
        if (err && err.status === 404) {
          setState({ status: "not_found" });
        } else {
          setState({ status: "error", message: (err && err.message) || "Network error" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceNo]);

  if (state.status === "loading") {
    return (
      <div className="public-invoice-page public-invoice-page--centered">
        <div className="public-invoice-loading">Loading invoice…</div>
      </div>
    );
  }

  if (state.status === "not_found") {
    return (
      <div className="public-invoice-page public-invoice-page--centered">
        <div className="public-invoice-error">
          <h2>Invoice not found</h2>
          <p>This invoice doesn't exist or has been removed.</p>
          <a className="public-invoice-error-link" href="/login">
            Go to login
          </a>
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="public-invoice-page public-invoice-page--centered">
        <div className="public-invoice-error">
          <h2>Couldn't load invoice</h2>
          <p>Please try again later.</p>
          <button
            type="button"
            className="public-invoice-retry"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { invoice } = state;
  const invoiceStoreType = invoice && invoice.storeType;

  // Render switch mirrors `InvoiceView.jsx:renderThermalReceipt()` so
  // the visual output matches the cashier preview exactly. Each branch
  // picks one of the existing pure renderers; nothing here adds buttons
  // or interactions — the customer just sees the receipt.
  let body;
  switch (invoiceStoreType) {
    case "laundry":
      // Laundry ships the same thermal component the cashier prints, so
      // there is no desktop "page" frame to render — the customer should
      // see only the 80mm thermal content, centered, with no card chrome
      // or extra padding. The `.public-invoice-thermal` selector below
      // provides just enough surface to center the thermal canvas and
      // give it a subtle page background.
      body = <LaundryThermalReceipt invoice={invoice} isDuplicate />;
      return (
        <div className="public-invoice-thermal">
          <div className="public-invoice-thermal-frame">{body}</div>
        </div>
      );
    case "service":
      body = <ServiceInvoice invoice={invoice} isDuplicate />;
      break;
    case "msme-service":
      body = <MSMEInvoice invoice={invoice} isDuplicate />;
      break;
    case "hotel":
      body = isHotelDiningInvoice(invoice) ? (
        <DiningInvoice invoice={invoice} isDuplicate />
      ) : (
        <LodgingInvoice invoice={invoice} isDuplicate />
      );
      break;
    case "retail":
    default:
      body = (
        <div id="retail-print-area">
          <RetailPrintInvoice invoice={invoice} isDuplicate />
        </div>
      );
  }

  return (
    <div className="public-invoice-page">
      <div className="public-invoice-card">{body}</div>
    </div>
  );
};

export default PublicInvoiceView;
