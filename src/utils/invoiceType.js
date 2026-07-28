export const isHotelDiningInvoice = (invoice) => {
  if (!invoice) return false;

  if (invoice?.storeType !== "hotel" && invoice?._storeType !== "hotel") {
    return false;
  }

  if (invoice?.hotelDetails?.tableId || invoice?.hotelDetails?.tableName) {
    return true;
  }

  return (
    Array.isArray(invoice?.items) &&
    invoice.items.some(
      (item) => item?.type === "dining" || item?.meta?.tableName || item?.meta?.tableId
    )
  );
};

export const isHotelLodgingInvoice = (invoice) => {
  if (!invoice) return false;

  if (invoice?.storeType !== "hotel" && invoice?._storeType !== "hotel") {
    return false;
  }

  return !isHotelDiningInvoice(invoice);
};
