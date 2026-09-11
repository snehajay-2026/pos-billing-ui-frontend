// src/utils/invoiceStatus.js
//
// Pure helpers shared by every page or component that needs to render the
// "Paid / Partial / Pending / Cleared / Cancelled / Overdue" pill on a
// service-store invoice. Extracted from components/invoice/ServiceInvoice.jsx
// so dashboards and tables don't have to import a render component for
// business logic — a layering violation we used to live with.
//
// Pure functions only. No React, no DOM, no store access. Safe to import
// from anywhere; safe to unit-test without a test runner.

export const STATUS_LABELS = {
  PAID: { label: "PAID", tone: "paid" },
  PARTIAL: { label: "PARTIAL", tone: "partial" },
  PENDING: { label: "PENDING", tone: "pending" },
  CLEARED: { label: "CLEARED", tone: "paid" },
  CANCELLED: { label: "CANCELLED", tone: "cancelled" },
  OVERDUE: { label: "OVERDUE", tone: "overdue" },
};

// computeStatus returns one of STATUS_LABELS. It deliberately does NOT
// consult server state beyond the invoice row itself; the row carries
// everything needed (status, paidAmount, dueDate).
export const computeStatus = (invoice, totalDue) => {
  const explicit = String(invoice?.status || "").toLowerCase();
  if (explicit === "cleared" || explicit === "paid") {
    return STATUS_LABELS.CLEARED;
  }
  if (explicit === "cancelled") {
    return STATUS_LABELS.CANCELLED;
  }

  const paid = Number(invoice.paidAmount || 0);
  if (paid <= 0) {
    const due = invoice.dueDate ? new Date(invoice.dueDate) : null;
    if (due && !Number.isNaN(due.getTime()) && due.getTime() < Date.now()) {
      return STATUS_LABELS.OVERDUE;
    }
    return STATUS_LABELS.PENDING;
  }
  if (paid + 0.01 < (Number(totalDue) || 0)) {
    return STATUS_LABELS.PARTIAL;
  }
  return STATUS_LABELS.PAID;
};
