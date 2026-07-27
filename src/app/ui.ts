import { createInitialState, type AppState } from "./state.js";

export function renderApp(state: AppState, root: HTMLElement) {
  const searchQuery = state.searchQuery.trim().toLowerCase();
  const filteredSongs = state.songs.filter((song) => {
    if (!searchQuery) {
      return true;
    }
    const contains = (value: string) => value.toLowerCase().includes(searchQuery);
    if (!state.searchField) {
      return (
        contains(song.title) ||
        contains(song.artist) ||
        contains(song.album) ||
        contains(song.genre) ||
        contains(song.year) ||
        contains(song.collection_name)
      );
    }
    switch (state.searchField) {
      case "title":
        return contains(song.title);
      case "artist":
        return contains(song.artist);
      case "album":
        return contains(song.album);
      case "genre":
        return contains(song.genre);
      case "year":
        return contains(song.year);
      case "collection":
        return contains(song.collection_name);
      default:
        return true;
    }
  });

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
        <h2>Colecciones</h2>
        <ul class="collections-list">
          ${state.collections
            .map(
              (collection) => `
                <li>
                  <strong>${collection.name}</strong>
                  <span class="meta">${collection.folder_path}</span>
                  <button data-action="rename-collection" data-id="${collection.id}">Renombrar</button>
                  <button data-action="delete-collection" data-id="${collection.id}">Eliminar</button>
                </li>
              `,
            )
            .join("")}
        </ul>
      </section>

      <section class="panel">
        <h2>Canciones</h2>
        <div class="filter-row">
          <div class="search-input-row">
            <input id="song-search" type="search" value="${state.pendingSearchQuery}" placeholder="Buscar canciones" />
            <button id="search-submit" class="search-button" aria-label="Buscar">🔍</button>
          </div>
          <label for="search-field">Filtrar por campo</label>
          <select id="search-field">
            <option value="">Todos los campos</option>
            <option value="title" ${state.searchField === "title" ? "selected" : ""}>Título</option>
            <option value="artist" ${state.searchField === "artist" ? "selected" : ""}>Artista</option>
            <option value="album" ${state.searchField === "album" ? "selected" : ""}>Álbum</option>
            <option value="genre" ${state.searchField === "genre" ? "selected" : ""}>Género</option>
            <option value="year" ${state.searchField === "year" ? "selected" : ""}>Año</option>
            <option value="collection" ${state.searchField === "collection" ? "selected" : ""}>Colección</option>
          </select>
        </div>
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
              <th>Álbum</th>
              <th>Género</th>
              <th>Colección</th>
              <th>Formato</th>
            </tr>
          </thead>
          <tbody>
            ${filteredSongs
              .map(
                (song) => `
                  <tr>
                    <td>${song.title}</td>
                    <td>${song.artist}</td>
                    <td>${song.album}</td>
                    <td>${song.genre}</td>
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
