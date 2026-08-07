import { jsPDF } from "jspdf";
import type { Playlist, Song } from "./state.js";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 16;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function text(value: string | null | undefined, fallback = "No indicado") {
  return value?.trim() || fallback;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeStyle: "short" }).format(date);
}

function formatDuration(seconds: number | null) {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

function formatSize(bytes: number | null) {
  if (bytes == null || !Number.isFinite(bytes)) return null;
  const units = ["B", "KB", "MB", "GB"];
  let size = Math.max(0, bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function playlistPdfBytes(playlist: Playlist, songs: Song[]) {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  const generatedAt = new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  let y = 0;

  const addPageHeader = (continuation = false) => {
    doc.setFillColor(24, 35, 52);
    doc.rect(0, 0, PAGE_WIDTH, 25, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(continuation ? `${playlist.name} - continuación` : "INFORME DE LISTA", MARGIN, 15.5);
    y = 34;
  };

  const ensureSpace = (height: number) => {
    if (y + height <= PAGE_HEIGHT - 17) return;
    doc.addPage();
    addPageHeader(true);
  };

  const sectionTitle = (title: string) => {
    ensureSpace(13);
    doc.setFillColor(232, 238, 246);
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 9, 2, 2, "F");
    doc.setTextColor(31, 51, 73);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(title.toUpperCase(), MARGIN + 4, y + 6);
    y += 13;
  };

  const paragraph = (label: string, value: string) => {
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    const labelWidth = doc.getTextWidth(`${label}: `);
    const lines = doc.splitTextToSize(value, CONTENT_WIDTH - labelWidth - 1) as string[];
    const height = Math.max(6, lines.length * 4.4 + 1);
    ensureSpace(height);
    doc.setTextColor(77, 92, 110);
    doc.text(`${label}: `, MARGIN, y + 3.5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(31, 41, 55);
    doc.text(lines, MARGIN + labelWidth, y + 3.5);
    y += height;
  };

  addPageHeader();
  doc.setTextColor(17, 24, 39);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  const titleLines = doc.splitTextToSize(playlist.name, CONTENT_WIDTH - 42) as string[];
  doc.text(titleLines, MARGIN, y + 7);
  const titleHeight = Math.max(15, titleLines.length * 9);
  doc.setFillColor(245, 180, 45);
  doc.roundedRect(PAGE_WIDTH - MARGIN - 36, y, 36, 13, 3, 3, "F");
  doc.setFontSize(10);
  doc.setTextColor(48, 36, 8);
  doc.text(playlist.duration || "00:00:00", PAGE_WIDTH - MARGIN - 18, y + 8.3, { align: "center" });
  y += titleHeight;
  if (playlist.description?.trim()) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(92, 103, 115);
    const description = doc.splitTextToSize(playlist.description.trim(), CONTENT_WIDTH) as string[];
    doc.text(description, MARGIN, y + 2);
    y += description.length * 5 + 7;
  } else {
    y += 4;
  }

  sectionTitle("Información de la lista");
  if (playlist.created_at.trim()) paragraph("Creada", formatDate(playlist.created_at));
  if (playlist.purpose?.trim()) paragraph("Finalidad", playlist.purpose.trim());
  if (playlist.tags?.trim()) paragraph("Etiquetas", playlist.tags.trim());
  if (playlist.description_extended?.trim()) {
    paragraph("Descripción ampliada", playlist.description_extended.trim());
  }
  if (playlist.comment?.trim()) paragraph("Comentario", playlist.comment.trim());

  sectionTitle(`Orden de reproducción · ${songs.length} ${songs.length === 1 ? "canción" : "canciones"}`);
  if (songs.length === 0) {
    paragraph("Contenido", "Esta lista no contiene canciones.");
  }

  songs.forEach((song, index) => {
    const metadata = song.custom_metadata.filter((item) => item.value.trim());
    const detailParts = [song.artist.trim(), song.album.trim(), song.genre.trim(), song.year.trim()].filter(Boolean);
    const technicalParts = [
      song.format.trim() ? song.format.trim().toUpperCase() : null,
      formatDuration(song.duration_seconds),
      formatSize(song.file_size),
    ].filter((value): value is string => Boolean(value));
    const metadataLines = metadata.map((item) => `${item.key}: ${item.value}`);
    doc.setFontSize(8.5);
    const titleRows = doc.splitTextToSize(text(song.title, "Sin título"), CONTENT_WIDTH - 28) as string[];
    const detailRows = detailParts.length
      ? doc.splitTextToSize(detailParts.join(" · "), CONTENT_WIDTH - 28) as string[]
      : [];
    const metadataRows = metadataLines.flatMap((line) => doc.splitTextToSize(line, CONTENT_WIDTH - 28) as string[]);
    const cardHeight = Math.max(20, 9 + titleRows.length * 4 + detailRows.length * 3.8 + (metadataRows.length ? metadataRows.length * 3.5 + 2 : 0));
    ensureSpace(cardHeight + 3);

    doc.setFillColor(index % 2 === 0 ? 248 : 243, index % 2 === 0 ? 250 : 247, index % 2 === 0 ? 252 : 250);
    doc.setDrawColor(219, 226, 234);
    doc.roundedRect(MARGIN, y, CONTENT_WIDTH, cardHeight, 2.5, 2.5, "FD");
    doc.setFillColor(37, 99, 235);
    doc.circle(MARGIN + 9, y + 9, 5.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(index + 1 > 99 ? 6.5 : 8);
    doc.setTextColor(255, 255, 255);
    doc.text(String(index + 1), MARGIN + 9, y + 10.2, { align: "center" });

    const contentX = MARGIN + 19;
    doc.setTextColor(17, 24, 39);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(titleRows, contentX, y + 6.2);
    let cardY = y + 6.2 + titleRows.length * 4.2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(78, 92, 108);
    if (detailRows.length) {
      doc.text(detailRows, contentX, cardY);
      cardY += detailRows.length * 3.9 + 1;
    }
    if (technicalParts.length) {
      doc.setFontSize(7.5);
      doc.setTextColor(96, 108, 122);
      doc.text(technicalParts.join("  |  "), contentX, cardY);
      cardY += 4;
    }
    if (metadataRows.length) {
      doc.setTextColor(67, 56, 202);
      doc.text(metadataRows, contentX, cardY);
    }
    y += cardHeight + 3;
  });

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(222, 226, 232);
    doc.line(MARGIN, PAGE_HEIGHT - 12, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(120, 130, 142);
    doc.text(`Generado el ${generatedAt}`, MARGIN, PAGE_HEIGHT - 7);
    doc.text(`Página ${page} de ${pages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 7, { align: "right" });
  }

  return new Uint8Array(doc.output("arraybuffer"));
}

export function playlistPdfFilename(name: string) {
  const safeName = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${safeName || "lista"}.pdf`;
}
