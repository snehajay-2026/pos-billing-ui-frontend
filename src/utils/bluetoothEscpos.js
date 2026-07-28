const formatQty = (item) => {
  const qty = item?.qty ?? item?.qtyKg ?? item?.hours ?? item?.units ?? 0;
  const unit = item?.unit || (item?.hours ? "hr" : "");

  if (!Number.isFinite(Number(qty))) return "0";
  if (unit === "kg") return `${Number(qty).toFixed(3)} kg`;
  if (unit) return `${Number(qty)} ${unit}`;
  return String(Number(qty));
};

const formatInvoiceText = (invoice) => {
  if (!invoice || typeof invoice !== "object") {
    return String(invoice ?? "");
  }

  const lines = [
    `Invoice: ${invoice.invoiceNo || "N/A"}`,
    `Date: ${invoice.date || "N/A"}`,
    `Payment: ${invoice.paymentMode || "N/A"}`,
    "--------------------------------",
  ];

  const items = Array.isArray(invoice.items) ? invoice.items : [];
  items.forEach((item) => {
    const qty =
      Number(item?.qty) || Number(item?.qtyKg) || Number(item?.hours) || Number(item?.units) || 0;
    const rate = Number(item?.price) || Number(item?.rate) || 0;
    const total = qty * rate;
    lines.push(`${item?.name || item?.serviceDescription || "Item"}`);
    lines.push(`${formatQty(item)} x ${rate.toFixed(2)} = ${total.toFixed(2)}`);
  });

  lines.push("--------------------------------");
  lines.push(`Subtotal: ${(Number(invoice.subTotal) || 0).toFixed(2)}`);
  lines.push(`GST: ${(Number(invoice.gstTotal) || 0).toFixed(2)}`);
  lines.push(`Total: ${(Number(invoice.grandTotal) || 0).toFixed(2)}`);

  return lines.join("\n");
};

export async function printESC_POS(rawText) {
  try {
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: [0xff00],
    });

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(0xff00);
    const char = await service.getCharacteristic(0xff02);

    const encoder = new TextEncoder();

    const printText = formatInvoiceText(rawText);

    // Feed + text
    await char.writeValue(encoder.encode(printText + "\n\n"));

    // Auto-cut command (ESC/POS)
    const CUT = new Uint8Array([0x1d, 0x56, 0x00]);
    await char.writeValue(CUT);

    alert("Printed Successfully!");
  } catch (err) {
    alert("Bluetooth Error: " + err);
  }
}
