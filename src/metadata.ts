import {
  deleteSongCustomMetadata,
  listSongCustomMetadata,
  listSongs,
  setSongCustomMetadata,
  updateSongMetadata,
} from "./app/api.js";
import type { CustomMetadata, Song } from "./app/state.js";

const root = document.querySelector("#metadata-app") as HTMLElement | null;
const songId = Number(new URLSearchParams(window.location.search).get("songId"));
let song: Song | null = null;
let customMetadata: CustomMetadata[] = [];

function escapeHtml(value: string | null | undefined) {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return "—";
  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")} min`;
}

function formatFileSize(bytes: number | null) {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "—";
  return `${(bytes / (1024 * 1024)).toLocaleString("es-ES", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} MB`;
}

function render(message = "", isError = false) {
  if (!root) return;
  if (!song) {
    root.innerHTML = `<section class="card"><p class="message ${isError ? "error" : ""}">${escapeHtml(message || "Cargando metadatos…")}</p></section>`;
    return;
  }

  root.innerHTML = `
    <h1>Editar metadatos</h1>
    <p class="subtitle">${escapeHtml(song.title)} · ${escapeHtml(song.collection_name)}</p>
    <p class="message ${isError ? "error" : ""}">${escapeHtml(message)}</p>
    <form id="song-fields-form" class="card">
      <h2>Metadatos de la canción</h2>
      <div class="fields">
        <label>Título<input name="title" required value="${escapeHtml(song.title)}"></label>
        <label>Artista<input name="artist" value="${escapeHtml(song.artist)}"></label>
        <label>Álbum<input name="album" value="${escapeHtml(song.album)}"></label>
        <label>Género<input name="genre" value="${escapeHtml(song.genre)}"></label>
        <label>Año<input name="year" value="${escapeHtml(song.year)}"></label>
      </div>
      <div class="actions"><button type="submit">Guardar cambios</button></div>
    </form>
    <section class="card">
      <h2>Datos técnicos (solo lectura)</h2>
      <div class="technical">
        <span><strong>Formato:</strong> ${escapeHtml(song.format)}</span>
        <span><strong>Duración:</strong> ${formatDuration(song.duration_seconds)}</span>
        <span><strong>Tamaño:</strong> ${formatFileSize(song.file_size)}</span>
        <span><strong>Archivo:</strong> ${escapeHtml(song.file_path)}</span>
      </div>
    </section>
    <section class="card">
      <h2>Metadatos personalizados</h2>
      <form id="custom-metadata-form" class="custom-form">
        <input name="key" required placeholder="Nombre del metadato" aria-label="Nombre del metadato">
        <input name="value" placeholder="Valor" aria-label="Valor del metadato">
        <button type="submit">Añadir</button>
      </form>
      ${customMetadata.length ? `
        <ul class="metadata-list">
          ${customMetadata.map((item) => `
            <li data-key="${escapeHtml(item.key)}">
              <strong>${escapeHtml(item.key)}</strong>
              <input value="${escapeHtml(item.value)}" aria-label="Valor de ${escapeHtml(item.key)}">
              <button type="button" data-action="save-custom">Guardar</button>
              <button type="button" class="danger" data-action="delete-custom">Eliminar</button>
            </li>
          `).join("")}
        </ul>
      ` : "<p>No hay metadatos personalizados.</p>"}
    </section>
  `;
}

async function load() {
  const [songs, metadata] = await Promise.all([listSongs(), listSongCustomMetadata(songId)]);
  song = (songs as Song[]).find((entry) => entry.id === songId) ?? null;
  customMetadata = metadata as CustomMetadata[];
  if (!song) throw new Error("No se ha encontrado la canción seleccionada.");
  render();
}

root?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  try {
    const data = new FormData(form);
    if (form.id === "song-fields-form") {
      await updateSongMetadata(songId, {
        title: String(data.get("title") ?? ""),
        artist: String(data.get("artist") ?? ""),
        album: String(data.get("album") ?? ""),
        genre: String(data.get("genre") ?? ""),
        year: String(data.get("year") ?? ""),
      });
      await load();
      render("Los metadatos se han guardado en la base de datos.");
    } else if (form.id === "custom-metadata-form") {
      await setSongCustomMetadata(songId, String(data.get("key") ?? ""), String(data.get("value") ?? ""));
      await load();
      render("Metadato personalizado añadido.");
    }
  } catch (error) {
    render(error instanceof Error ? error.message : String(error), true);
  }
});

root?.addEventListener("click", async (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-action]");
  const row = button?.closest<HTMLLIElement>("li[data-key]");
  const key = row?.dataset.key;
  if (!button || !row || !key) return;
  try {
    if (button.dataset.action === "delete-custom") {
      await deleteSongCustomMetadata(songId, key);
    } else {
      await setSongCustomMetadata(songId, key, row.querySelector<HTMLInputElement>("input")?.value ?? "");
    }
    await load();
    render(button.dataset.action === "delete-custom" ? "Metadato eliminado." : "Metadato actualizado.");
  } catch (error) {
    render(error instanceof Error ? error.message : String(error), true);
  }
});

if (!Number.isInteger(songId) || songId <= 0) {
  render("No se ha indicado una canción válida.", true);
} else {
  void load().catch((error) => render(error instanceof Error ? error.message : String(error), true));
}
