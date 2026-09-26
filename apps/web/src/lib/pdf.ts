/**
 * Branded PDFs in English (step 8): the quote and the price list. Made in the browser so a
 * phone on 3G doesn't wait on a server; the PDF library is only downloaded when a PDF is made.
 * Arabic PDFs (step 11) need an embedded Arabic font and right-to-left shaping: planned there.
 */
import type { Currency } from "@qirsh/money";
import { formatMinor } from "@qirsh/money";

export interface Brand {
  name: string;
  color: string;
  initials: string;
  paymentTerms: string;
}
export interface QuoteDoc {
  number: string;
  kind: "quote" | "order";
  date: string;
  validUntil?: string | null;
  customer: { name: string; city: string; code: string };
  adviser: string;
  rate: number;
  lines: { name: string; sku: string; qty: number; unit: number; discount: number; total: number }[];
  totalUsd: number;
  totalSdg: number;
  discountUsd: number;
}

const m = (minor: number, c: Currency) => formatMinor(minor, c, "en-GB", { decimals: c === "SDG" ? "auto" : "always" });
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

async function doc() {
  const [{ jsPDF }, auto] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  return { pdf: new jsPDF({ unit: "pt", format: "a4" }), autoTable: auto.default };
}

function header(pdf: import("jspdf").jsPDF, brand: Brand, title: string, sub: string) {
  const [r, g, b] = rgb(brand.color);
  pdf.setFillColor(r, g, b);
  pdf.roundedRect(40, 36, 36, 36, 6, 6, "F");
  pdf.setTextColor(255, 255, 255).setFont("helvetica", "bold").setFontSize(13);
  pdf.text(brand.initials, 58, 59, { align: "center" });
  pdf.setTextColor(21, 32, 27).setFontSize(15).text(brand.name, 86, 52);
  pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(102, 117, 110).text(sub, 86, 66);
  pdf.setFont("helvetica", "bold").setFontSize(20).setTextColor(21, 32, 27).text(title, 555, 58, { align: "right" });
}

export async function quotePdf(q: QuoteDoc, brand: Brand) {
  const { pdf, autoTable } = await doc();
  const [r, g, b] = rgb(brand.color);
  header(pdf, brand, q.kind === "quote" ? "Quotation" : "Order", "Solar equipment · Sudan");
  pdf.setFont("helvetica", "normal").setFontSize(10).setTextColor(59, 74, 67);
  const meta: [string, string][] = [
    [q.kind === "quote" ? "Quote" : "Order", q.number],
    ["Date", q.date],
    ...(q.validUntil ? ([["Valid until", q.validUntil]] as [string, string][]) : []),
    ["Adviser", q.adviser],
  ];
  meta.forEach(([k, v], i) => {
    pdf.setTextColor(102, 117, 110).text(k, 400, 100 + i * 15);
    pdf.setTextColor(21, 32, 27).text(v, 555, 100 + i * 15, { align: "right" });
  });
  pdf.setFont("helvetica", "bold").setFontSize(10).setTextColor(102, 117, 110).text("For", 40, 100);
  pdf.setFontSize(13).setTextColor(21, 32, 27).text(q.customer.name, 40, 117);
  pdf.setFont("helvetica", "normal").setFontSize(10).setTextColor(59, 74, 67).text(`${q.customer.city} · ${q.customer.code}`, 40, 132);

  autoTable(pdf, {
    startY: 170,
    head: [["Product", "Qty", "Unit price", "Discount", "Line total"]],
    body: q.lines.map((l) => [`${l.name}\n${l.sku}`, String(l.qty), m(l.unit, "USD"), l.discount ? `− ${m(l.discount, "USD")}` : "", m(l.total, "USD")]),
    styles: { font: "helvetica", fontSize: 9.5, cellPadding: 6, textColor: [21, 32, 27], lineColor: [226, 232, 228], lineWidth: 0.5 },
    headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 1: { halign: "right", cellWidth: 40 }, 2: { halign: "right", cellWidth: 80 }, 3: { halign: "right", cellWidth: 80 }, 4: { halign: "right", cellWidth: 90 } },
    margin: { left: 40, right: 40 },
  });
  // @ts-expect-error lastAutoTable is added by the plugin
  let y: number = pdf.lastAutoTable.finalY + 22;
  const row = (k: string, v: string, bold = false, size = 10) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal").setFontSize(size).setTextColor(bold ? 21 : 59, bold ? 32 : 74, bold ? 27 : 67);
    pdf.text(k, 380, y);
    pdf.text(v, 555, y, { align: "right" });
    y += size + 8;
  };
  if (q.discountUsd) row("Discounts", `− ${m(q.discountUsd, "USD")}`);
  row("Total in US dollars", m(q.totalUsd, "USD"), true, 12);
  row(`At ${q.rate.toLocaleString("en-US")} SDG per dollar`, m(q.totalSdg, "SDG"), true, 12);

  y += 10;
  pdf.setDrawColor(226, 232, 228).line(40, y, 555, y);
  y += 20;
  pdf.setFont("helvetica", "bold").setFontSize(10).setTextColor(21, 32, 27).text("Payment terms", 40, y);
  pdf.setFont("helvetica", "normal").setTextColor(59, 74, 67);
  const terms = pdf.splitTextToSize(`${brand.paymentTerms} The amount in pounds is fixed at the rate above${q.validUntil ? ` until ${q.validUntil}` : ""}. Send a screenshot of every transfer with its transaction code.`, 515);
  pdf.text(terms, 40, y + 15);
  pdf.setFontSize(8).setTextColor(140, 150, 145).text("Prices in US dollars are fixed. Goods are released only against a fully paid order.", 40, 800);
  return pdf.output("blob");
}

export async function priceListPdf(items: { sku: string; name: string; category: string; spec: string | null; price_usd_minor: number }[], brand: Brand, categories: Record<string, string>, date: string) {
  const { pdf, autoTable } = await doc();
  const [r, g, b] = rgb(brand.color);
  header(pdf, brand, "Price list", `Prices in US dollars · ${date}`);
  const cats = [...new Set(items.map((i) => i.category))];
  let y = 100;
  for (const c of cats) {
    autoTable(pdf, {
      startY: y,
      head: [[categories[c] ?? c, "", "Price"]],
      body: items.filter((i) => i.category === c).map((i) => [i.name, i.spec ?? "", m(i.price_usd_minor, "USD")]),
      styles: { font: "helvetica", fontSize: 9.5, cellPadding: 5, textColor: [21, 32, 27], lineColor: [226, 232, 228], lineWidth: 0.5 },
      headStyles: { fillColor: [r, g, b], textColor: [255, 255, 255], fontStyle: "bold" },
      columnStyles: { 0: { cellWidth: 190 }, 2: { halign: "right", cellWidth: 80 } },
      margin: { left: 40, right: 40 },
    });
    // @ts-expect-error lastAutoTable is added by the plugin
    y = pdf.lastAutoTable.finalY + 16;
  }
  pdf.setFontSize(8).setTextColor(140, 150, 145).text("Discounts per line are agreed with your adviser. Payment in Sudanese pounds at the day's rate.", 40, 800);
  return pdf.output("blob");
}

/** Share a file to WhatsApp on phones that can (Web Share), otherwise download it. */
export async function shareOrDownload(blob: Blob, filename: string, text: string) {
  const file = new File([blob], filename, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], text });
      return "shared";
    } catch {
      /* cancelled: fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}
