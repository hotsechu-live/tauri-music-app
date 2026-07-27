import { createInitialState, type AppState } from "./state.js";

export function renderApp(state: AppState, root: HTMLElement) {
  root.innerHTML = `
    <section class="app-shell">
      <header class="panel">
        <h1>Tauri Music App</h1>
        <p>Gestión local de colecciones, listas y reproducción básica.</p>
      </header>

      <section class="panel">
        <h2>Configuración inicial</h2>
        <button id="import-btn">Seleccionar carpeta de música</button>
        <div id="collection-form" class="${state.selectedFolder ? "" : "hidden"}">
          <p><strong>Carpeta seleccionada:</strong> ${state.selectedFolder || "Ninguna"}</p>
          <label for="collection-name">Nombre de la colección</label>
          <input id="collection-name" type="text" placeholder="Nombre de la colección" />
          <button id="confirm-import-btn">Importar colección</button>
        </div>
        <div id="status">${state.status}</div>
        ${state.error ? `<div class="error">${state.error}</div>` : ""}
      </section>

      <section class="panel">
        <h2>Canciones</h2>
        <div class="filter-row">
          <label for="collection-filter">Filtrar por colección</label>
          <select id="collection-filter">
            <option value="">Todas las colecciones</option>
            ${state.collections
              .map(
                (collection) => `
                  <option value="${collection.id}" ${state.currentCollectionId === collection.id ? "selected" : ""}>
                    ${collection.name}
                  </option>
                `,
              )
              .join("")}
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th>Título</th>
              <th>Artista</th>
              <th>Colección</th>
              <th>Formato</th>
            </tr>
          </thead>
          <tbody>
            ${state.songs
              .map(
                (song) => `
                  <tr>
                    <td>${song.title}</td>
                    <td>${song.artist}</td>
                    <td>${song.collection_name}</td>
                    <td>${song.format}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>
      </section>

      <section class="panel">
        <h2>Listas</h2>
        <button id="create-playlist-btn">Crear lista</button>
        <ul>
          ${state.playlists.map((playlist) => `<li>${playlist.name}</li>`).join("")}
        </ul>
      </section>
    </section>
  `;
}

export function getInitialState(): AppState {
  return createInitialState();
}
