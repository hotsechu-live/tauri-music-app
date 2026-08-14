import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listPlaylistSongs, updatePlaylistSongConsigna } from "./app/api.js";
import type { Song } from "./app/state.js";

const root = document.querySelector<HTMLElement>("#playlist-dialog");
const params = new URLSearchParams(window.location.search);
const playlistId = Number(params.get("playlistId"));
const songId = Number(params.get("songId"));
let song: Song | null = null;

function escapeHtml(value: string | null | undefined) {
  return (value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function render(message = "", isError = false) {
  if (!root) return;
  if (!song) {
    root.innerHTML = `<p class="message ${isError ? "error" : ""}">${escapeHtml(message || "Cargando canción…")}</p>`;
    return;
  }
  root.innerHTML = `
    <h1>Modificar consigna</h1>
    <p class="subtitle">${escapeHtml(song.title)} · ${escapeHtml(song.artist)}</p>
    ${message ? `<p class="message ${isError ? "error" : ""}">${escapeHtml(message)}</p>` : ""}
    <form id="consigna-form" class="card">
      <label for="consigna">Consigna</label>
      <textarea id="consigna" name="consigna" rows="8" autofocus>${escapeHtml(song.consigna)}</textarea>
      <div class="dialog-actions">
        <button type="button" class="secondary" data-action="cancel">Cancelar</button>
        <button type="submit">Guardar</button>
      </div>
    </form>`;
}

async function load() {
  const songs = await listPlaylistSongs(playlistId) as Song[];
  song = songs.find((entry) => entry.id === songId) ?? null;
  if (!song) throw new Error("La canción no pertenece a la lista seleccionada.");
  render();
}

root?.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.dataset.action === "cancel") void getCurrentWebviewWindow().close();
});

root?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(event.target as HTMLFormElement);
  try {
    await updatePlaylistSongConsigna(playlistId, songId, String(data.get("consigna") ?? ""));
    await emit("playlist-changed", { playlistId });
    await getCurrentWebviewWindow().close();
  } catch (error) {
    render(error instanceof Error ? error.message : String(error), true);
  }
});

if (!Number.isInteger(playlistId) || playlistId <= 0 || !Number.isInteger(songId) || songId <= 0) {
  render("No se ha indicado una canción y una lista válidas.", true);
} else {
  void load().catch((error) => render(error instanceof Error ? error.message : String(error), true));
}
