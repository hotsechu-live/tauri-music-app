import { emit } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { addSongToPlaylist, createPlaylist, listPlaylists, listSongs } from "./app/api.js";
import type { Playlist, Song } from "./app/state.js";

const root = document.querySelector<HTMLElement>("#playlist-dialog");
const params = new URLSearchParams(window.location.search);
const songId = Number(params.get("songId"));
let selectedPlaylistId = Number(params.get("playlistId")) || null;
let song: Song | null = null;
let playlists: Playlist[] = [];

function escapeHtml(value: string | null | undefined) {
  return (value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function render(message = "", isError = false) {
  if (!root) return;
  root.innerHTML = `
    <h1>Añadir a una lista</h1>
    <p class="subtitle">${song ? escapeHtml(song.title) : "Cargando canción…"}</p>
    ${message ? `<p class="message ${isError ? "error" : ""}">${escapeHtml(message)}</p>` : ""}
    <form id="add-form" class="card">
      <label>Lista seleccionada
        <select name="playlistId" ${playlists.length === 0 ? "disabled" : ""}>
          <option value="">Selecciona una lista</option>
          ${playlists.map((playlist) => `<option value="${playlist.id}" ${playlist.id === selectedPlaylistId ? "selected" : ""}>${escapeHtml(playlist.name)}</option>`).join("")}
        </select>
      </label>
      <button type="submit" ${playlists.length === 0 ? "disabled" : ""}>Añadir canción</button>
    </form>
    <form id="create-form" class="card">
      <strong>Crear una lista nueva</strong>
      <label>Nombre<input name="name" required autofocus></label>
      <label>Descripción<input name="description"></label>
      <button type="submit">Crear y añadir</button>
    </form>`;
}

async function notifyAndClose(playlistId: number) {
  await emit("playlist-changed", { playlistId });
  await getCurrentWebviewWindow().close();
}

async function load() {
  const [songs, loadedPlaylists] = await Promise.all([listSongs(), listPlaylists()]);
  song = (songs as Song[]).find((entry) => entry.id === songId) ?? null;
  playlists = loadedPlaylists as Playlist[];
  if (!song) throw new Error("No se ha encontrado la canción.");
  if (!playlists.some((playlist) => playlist.id === selectedPlaylistId)) selectedPlaylistId = null;
  render();
}

root?.addEventListener("change", (event) => {
  const select = (event.target as HTMLElement).closest<HTMLSelectElement>("select[name=playlistId]");
  if (select) selectedPlaylistId = Number(select.value) || null;
});

root?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target as HTMLFormElement;
  const data = new FormData(form);
  try {
    if (form.id === "create-form") {
      const name = String(data.get("name") ?? "").trim();
      const description = String(data.get("description") ?? "").trim() || null;
      if (!name) return;
      selectedPlaylistId = await createPlaylist(name, description);
    } else {
      selectedPlaylistId = Number(data.get("playlistId")) || null;
    }
    if (!selectedPlaylistId) throw new Error("Selecciona o crea una lista.");
    await addSongToPlaylist(selectedPlaylistId, songId);
    await notifyAndClose(selectedPlaylistId);
  } catch (error) {
    render(error instanceof Error ? error.message : String(error), true);
  }
});

if (!Number.isInteger(songId) || songId <= 0) render("No se ha indicado una canción válida.", true);
else void load().catch((error) => render(error instanceof Error ? error.message : String(error), true));
