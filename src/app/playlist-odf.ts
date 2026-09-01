import { strToU8, zipSync } from "fflate";
import type { Playlist, Song } from "./state.js";

const ODT_MIME = "application/vnd.oasis.opendocument.text";

function xml(value: string | null | undefined) {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function value(value: string | null | undefined, fallback = "No indicado") {
  return value?.trim() || fallback;
}

function formatDate(raw: string) {
  const date = new Date(raw);
  return Number.isNaN(date.getTime())
    ? raw
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

function paragraph(label: string, content: string) {
  return `<text:p text:style-name="Field"><text:span text:style-name="Label">${xml(label)}: </text:span>${xml(content)}</text:p>`;
}

export function playlistOdfBytes(playlist: Playlist, songs: Song[]) {
  const playlistFields = [
    playlist.created_at.trim() ? paragraph("Creada", formatDate(playlist.created_at)) : "",
    playlist.purpose?.trim() ? paragraph("Finalidad", playlist.purpose.trim()) : "",
    playlist.tags?.trim() ? paragraph("Etiquetas", playlist.tags.trim()) : "",
    playlist.description_extended?.trim() ? paragraph("Descripción ampliada", playlist.description_extended.trim()) : "",
    playlist.comment?.trim() ? paragraph("Comentario", playlist.comment.trim()) : "",
  ].join("");

  const songContent = songs.length === 0
    ? `<text:p>Esta lista no contiene canciones.</text:p>`
    : songs.map((song) => {
      const details = [song.artist.trim(), song.album.trim(), song.genre.trim(), song.year.trim()].filter(Boolean);
      const technical = [
        song.format.trim() ? song.format.trim().toUpperCase() : null,
        formatDuration(song.duration_seconds),
        formatSize(song.file_size),
      ].filter((item): item is string => Boolean(item));
      const custom = song.custom_metadata
        .filter((item) => item.value.trim())
        .map((item) => paragraph(item.key, item.value));
      return `<text:list-item>
        <text:p text:style-name="SongTitle">${xml(value(song.title, "Sin título"))}</text:p>
        ${details.length ? `<text:p text:style-name="SongDetail">${xml(details.join(" · "))}</text:p>` : ""}
        ${technical.length ? `<text:p text:style-name="Technical">${xml(technical.join(" | "))}</text:p>` : ""}
        ${custom.join("")}
        ${song.consigna.trim() ? paragraph("Consigna", song.consigna.trim()) : ""}
      </text:list-item>`;
    }).join("");

  const generatedAt = new Date().toISOString();
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3">
  <office:automatic-styles>
    <style:style style:name="Title" style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.15in"/><style:text-properties fo:font-size="18pt" fo:font-weight="bold" fo:color="#1f3349"/></style:style>
    <style:style style:name="Subtitle" style:family="paragraph"><style:text-properties fo:font-size="11pt" fo:color="#5c6773"/></style:style>
    <style:style style:name="Section" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.2in" fo:margin-bottom="0.08in" fo:background-color="#e8eef6" fo:padding="0.06in"/><style:text-properties fo:font-size="11pt" fo:font-weight="bold" fo:color="#1f3349"/></style:style>
    <style:style style:name="Field" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.03in" fo:margin-bottom="0.03in"/></style:style>
    <style:style style:name="SongTitle" style:family="paragraph"><style:paragraph-properties fo:margin-top="0.1in"/><style:text-properties fo:font-size="11pt" fo:font-weight="bold"/></style:style>
    <style:style style:name="SongDetail" style:family="paragraph"><style:text-properties fo:color="#4e5c6c"/></style:style>
    <style:style style:name="Technical" style:family="paragraph"><style:text-properties fo:font-size="9pt" fo:color="#606c7a"/></style:style>
    <style:style style:name="Label" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
    <text:list-style style:name="SongList"><text:list-level-style-number text:level="1" style:num-format="1"><style:list-level-properties text:space-before="0.25in" text:min-label-width="0.25in"/></text:list-level-style-number></text:list-style>
  </office:automatic-styles>
  <office:body><office:text>
    <text:h text:style-name="Title" text:outline-level="1">${xml(playlist.name)}</text:h>
    ${playlist.description?.trim() ? `<text:p text:style-name="Subtitle">${xml(playlist.description.trim())}</text:p>` : ""}
    ${paragraph("Duración de la música", playlist.duration || "00:00:00")}
    <text:h text:style-name="Section" text:outline-level="2">Información</text:h>
    ${playlistFields}
    <text:h text:style-name="Section" text:outline-level="2">Orden de reproducción · ${songs.length} ${songs.length === 1 ? "canción" : "canciones"}</text:h>
    ${songs.length === 0 ? songContent : `<text:list text:style-name="SongList">${songContent}</text:list>`}
  </office:text></office:body>
</office:document-content>`;

  const styles = `<?xml version="1.0" encoding="UTF-8"?><office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.3"><office:styles><style:default-style style:family="paragraph"><style:paragraph-properties fo:line-height="120%"/><style:text-properties fo:font-family="Liberation Sans" fo:font-size="10pt"/></style:default-style></office:styles></office:document-styles>`;
  const meta = `<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><dc:title>${xml(playlist.name)}</dc:title><meta:creation-date>${generatedAt}</meta:creation-date><meta:generator>Tauri Music App</meta:generator></office:meta></office:document-meta>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${ODT_MIME}"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>`;

  return zipSync({
    mimetype: [strToU8(ODT_MIME), { level: 0 }],
    "content.xml": strToU8(content),
    "styles.xml": strToU8(styles),
    "meta.xml": strToU8(meta),
    "META-INF/manifest.xml": strToU8(manifest),
  }, { level: 6 });
}

export function playlistOdfFilename(name: string) {
  const safeName = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return `${safeName || "lista"}.odt`;
}
