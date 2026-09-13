const toTimestamp = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const invoiceNumberTimestamp = (invoice) => {
  const match = String(invoice?.invoiceNo || "").match(/(\d{6})$/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
};

const invoiceSortKey = (invoice) => {
  const createdAt = toTimestamp(invoice?.createdAt);
  if (createdAt !== null)
    return { timestamp: createdAt, invoiceNumber: invoiceNumberTimestamp(invoice) };

  const generatedAt = toTimestamp(invoice?.generatedAt);
  if (generatedAt !== null)
    return {
      timestamp: generatedAt,
      invoiceNumber: invoiceNumberTimestamp(invoice),
    };

  const date = toTimestamp(invoice?.date);
  return {
    timestamp: date,
    invoiceNumber: invoiceNumberTimestamp(invoice),
  };
};

/**
 * Return Service invoices newest-first without mutating the API response.
 * Historical rows do not all expose createdAt, so fall back to generatedAt,
 * invoice date, and finally the timestamp suffix in Service invoice numbers.
 */
export const sortServiceInvoices = (invoices) => {
  if (!Array.isArray(invoices)) return [];

  return invoices
    .map((invoice, index) => ({ invoice, index, key: invoiceSortKey(invoice) }))
    .sort((a, b) => {
      const aTimestamp = a.key.timestamp;
      const bTimestamp = b.key.timestamp;
      if (aTimestamp !== null || bTimestamp !== null) {
        if (aTimestamp === null) return 1;
        if (bTimestamp === null) return -1;
        if (aTimestamp !== bTimestamp) return bTimestamp - aTimestamp;
      }

      const aInvoiceNumber = a.key.invoiceNumber;
      const bInvoiceNumber = b.key.invoiceNumber;
      if (aInvoiceNumber !== null || bInvoiceNumber !== null) {
        if (aInvoiceNumber === null) return 1;
        if (bInvoiceNumber === null) return -1;
        if (aInvoiceNumber !== bInvoiceNumber) return bInvoiceNumber - aInvoiceNumber;
      }

      return a.index - b.index;
    })
    .map(({ invoice }) => invoice);
};
