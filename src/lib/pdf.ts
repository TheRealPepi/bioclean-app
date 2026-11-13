import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { formatLongDate, formatTime, isoDate } from "./dates";
import { downloadBlob, fileSafe } from "./download";
import { blobToDataUrl, compressImage } from "./image";
import { googleMapsUrl } from "./maps";
import { PAYMENT_META } from "./payment";
import { STATUS_META } from "./status";

export type DeliveryDetails = NonNullable<FunctionReturnType<typeof api.deliveries.get>>;

const GREEN: [number, number, number] = [14, 90, 74];
const TEXT: [number, number, number] = [28, 36, 33];
const MUTED: [number, number, number] = [107, 116, 114];
const BORDER: [number, number, number] = [222, 227, 225];

type LoadedImage = { data: string; width: number; height: number };

async function loadPhoto(url: string | null): Promise<LoadedImage | null> {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const { blob, width, height } = await compressImage(await response.blob(), 1200, 0.8);
    return { data: await blobToDataUrl(blob), width, height };
  } catch {
    return null;
  }
}

export function pdfFileName(d: DeliveryDetails): string {
  return `Entrega_${fileSafe(d.invoiceNumber)}_${fileSafe(d.clientName)}_${isoDate(d.deliveredAt)}.pdf`;
}

/** Builds the delivery receipt ("comprobante de entrega") and downloads it. */
export async function downloadDeliveryPdf(d: DeliveryDetails): Promise<void> {
  const sources = [
    ...d.invoices.map((i) => ({ caption: `Factura ${i.number}`, url: i.url })),
    { caption: "Quien recibe", url: d.photos.receiver },
    { caption: "Mercancía", url: d.photos.goods },
  ];
  const [{ jsPDF }, ...photos] = await Promise.all([
    import("jspdf"),
    ...sources.map((p) => loadPhoto(p.url)),
  ]);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 16;
  const contentW = pageW - margin * 2;

  // Header band
  doc.setFillColor(...GREEN);
  doc.rect(0, 0, pageW, 30, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(17);
  doc.text("Bioclean Green Cozumel", margin, 14);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text("Comprobante de entrega", margin, 22);
  doc.setFontSize(10);
  const header = `${d.invoices.length > 1 ? "Facturas" : "Factura"} ${d.invoiceNumber}`;
  doc.text(doc.splitTextToSize(header, 90)[0], pageW - margin, 14, { align: "right" });
  doc.text(isoDate(d.deliveredAt), pageW - margin, 22, { align: "right" });

  let y = 42;

  // Client + status
  doc.setTextColor(...MUTED);
  doc.setFontSize(9);
  doc.text("CLIENTE", margin, y);
  y += 6;
  doc.setTextColor(...TEXT);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  const clientLines = doc.splitTextToSize(d.clientName, contentW - 60);
  doc.text(clientLines, margin, y);

  const status = STATUS_META[d.status];
  doc.setFontSize(9.5);
  const pillW = doc.getTextWidth(status.label) + 10;
  const pillX = pageW - margin - pillW;
  doc.setFillColor(...status.rgb);
  doc.roundedRect(pillX, y - 5.5, pillW, 8, 4, 4, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(status.label, pillX + 5, y);

  y += clientLines.length * 6 + 6;

  // Detail grid
  const fields: [string, string][] = [
    ["Fecha", formatLongDate(d.deliveredAt)],
    ["Hora", formatTime(d.deliveredAt)],
    [d.invoices.length > 1 ? "Facturas" : "Factura", d.invoiceNumber],
    ["Chofer", d.driverName],
  ];
  if (d.vehicleName) fields.push(["Vehículo", d.vehicleName]);
  if (d.payment) fields.push(["Pago", PAYMENT_META[d.payment].label]);
  const colW = contentW / 2;
  fields.forEach(([label, value], i) => {
    const x = margin + (i % 2) * colW;
    const rowY = y + Math.floor(i / 2) * 14;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, rowY);
    doc.setFontSize(11);
    doc.setTextColor(...TEXT);
    doc.text(doc.splitTextToSize(value, colW - 6)[0], x, rowY + 5.5);
  });
  y += Math.ceil(fields.length / 2) * 14;

  // Location
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("UBICACIÓN DE ENTREGA", margin, y);
  doc.setFontSize(11);
  doc.setTextColor(...TEXT);
  const coords = `${d.location.lat.toFixed(6)}, ${d.location.lng.toFixed(6)}`;
  doc.text(coords, margin, y + 5.5);
  doc.setTextColor(...GREEN);
  doc.textWithLink("Ver en Google Maps", margin + doc.getTextWidth(coords) + 6, y + 5.5, {
    url: googleMapsUrl(d.location),
  });
  if (d.locationSource === "modificada") {
    y += 5.5;
    doc.setFontSize(9.5);
    doc.setTextColor(146, 64, 14);
    doc.text("Ubicación modificada en esta entrega (distinta a la guardada del cliente).", margin, y + 5);
  }
  y += 14;

  // Notes
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("ANOTACIONES", margin, y);
  y += 3;
  doc.setFontSize(10.5);
  const noteLines = doc.splitTextToSize(d.notes || "Sin anotaciones.", contentW - 8);
  const noteH = noteLines.length * 5 + 6;
  doc.setDrawColor(...BORDER);
  doc.setFillColor(247, 249, 248);
  doc.roundedRect(margin, y, contentW, noteH, 2, 2, "FD");
  doc.setTextColor(...TEXT);
  doc.text(noteLines, margin + 4, y + 6.5);
  y += noteH + 10;

  // Photos: three per row, each fit into a box keeping its aspect ratio.
  const gap = 5;
  const boxW = (contentW - gap * 2) / 3;
  const boxH = boxW * 1.33;
  const rowH = boxH + 10;
  if (y + 4 + rowH > pageH - 14) {
    doc.addPage();
    y = 20;
  }
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("EVIDENCIA FOTOGRÁFICA", margin, y);
  y += 4;

  photos.forEach((photo, i) => {
    const col = i % 3;
    if (col === 0 && i > 0) {
      y += rowH;
      if (y + rowH > pageH - 14) {
        doc.addPage();
        y = 20;
      }
    }
    const x = margin + col * (boxW + gap);
    doc.setDrawColor(...BORDER);
    doc.setFillColor(247, 249, 248);
    doc.roundedRect(x, y, boxW, boxH, 2, 2, "FD");
    doc.setFontSize(9);
    if (photo) {
      const scale = Math.min(boxW / photo.width, boxH / photo.height);
      const w = photo.width * scale;
      const h = photo.height * scale;
      doc.addImage(photo.data, "JPEG", x + (boxW - w) / 2, y + (boxH - h) / 2, w, h);
    } else {
      doc.setTextColor(...MUTED);
      doc.text("Foto no disponible", x + boxW / 2, y + boxH / 2, { align: "center" });
    }
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT);
    doc.text(doc.splitTextToSize(sources[i].caption, boxW)[0], x + boxW / 2, y + boxH + 5, {
      align: "center",
    });
  });

  // Footer
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `Generado el ${formatLongDate(Date.now())} · Bioclean Green Cozumel`,
    pageW / 2,
    pageH - 8,
    { align: "center" },
  );

  downloadBlob(doc.output("blob"), pdfFileName(d));
}
