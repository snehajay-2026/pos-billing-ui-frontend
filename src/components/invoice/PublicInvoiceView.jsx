// src/components/invoice/PublicInvoiceView.jsx
//
// Minimal, action-bar-less invoice viewer for the WhatsApp/Email share
// link at `/invoice/:invoiceNo`. A customer opening the link from a
// phone should see only the invoice — no Print, no WhatsApp/Email
// re-share, no status-edit, no Login redirect.
//
// The renderers below (RetailPrintInvoice, LaundryThermalReceipt,
// HotelThermalReceipt, MSMEInvoice, ServiceInvoice) are the same
// presentational components the cashier preview uses, so the visual
// output matches. The Hotel Public Invoice (Dining + Lodging) is
// intentionally narrower than the cashier's preview — it always
// renders the 80mm Thermal receipt regardless of the cashier's
// A4/80mm toggle, so the customer-facing share link looks like a
// digital version of the actual thermal print rather than a
// full-page web invoice. The difference is that this page seeds the
// in-memory store-settings cache from the public API response
// (`response.store`) via `seedStoreSettingsForScope()` so the
// renderers read the real store name/address/GSTIN/logo instead of
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
import HotelThermalReceipt from "../hotel/HotelThermalReceipt";
import MSMEInvoice from "./MSMEInvoice";
import RetailPrintInvoice from "./RetailPrintInvoice";
import ServiceInvoice from "./ServiceInvoice";
import "./PublicInvoiceView.css";

const PublicInvoiceView = () => {
  const { invoiceNo } = useParams();
  // Hotel Public Invoice always renders the 80mm Thermal receipt (see
  // the `case "hotel"` branch below) — for both Dining and Lodging,
  // regardless of the cashier's chosen A4/80mm preview layout. The
  // cashier's InvoiceView continues to honor its A4/80mm toggle via
  // the `?layout=80mm` URL hint, but the public share link is
  // intentionally narrower than the cashier's preview so the
  // customer-facing path is consistent and thermal-only.
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
      // The Hotel Public Invoice always shows the 80mm Thermal receipt
      // — for both Dining and Lodging, regardless of the cashier's
      // chosen A4/80mm preview layout. The user explicitly wants the
      // public share link to look like a digital version of the actual
      // 80mm thermal print, not a full-page web invoice. The cashier's
      // Invoice Preview continues to honor its A4/80mm toggle; this
      // public branch is intentionally narrower than the cashier's
      // preview so the customer-facing share link is consistent.
      //
      // We use the same `.public-invoice-thermal` wrapper as the
      // Laundry branch: a calm neutral surface, no 720px white card
      // chrome, no dashboard / sidebar / navigation — only the thermal
      // canvas, centered, responsive on mobile / tablet / desktop, with
      // print rules that strip the wrapper so the printed page matches
      // a real thermal printer output.
      body = <HotelThermalReceipt invoice={invoice} isDuplicate />;
      return (
        <div className="public-invoice-thermal">
          <div className="public-invoice-thermal-frame">{body}</div>
        </div>
      );
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
