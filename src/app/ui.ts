import { createInitialState, type AppState } from "./state.js";

function escapeHtml(value: string | null | undefined) {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

  const currentSong = state.playbackQueue[state.playbackIndex] ?? null;
  const currentPlaylist = state.playlists.find((playlist) => playlist.id === state.selectedPlaylistId) ?? null;
  const playbackPlaylist = state.playlists.find((playlist) => playlist.id === state.playbackPlaylistId) ?? null;

  root.innerHTML = `
    <section class="app-shell">
      <nav class="panel app-menu" aria-label="Navegación principal">
        <button class="menu-item ${state.activeView === "songs" ? "active" : ""}" data-action="navigate" data-view="songs">Canciones</button>
        <button class="menu-item ${state.activeView === "collections" ? "active" : ""}" data-action="navigate" data-view="collections">Colecciones</button>
        <button class="menu-item ${state.activeView === "playlists" ? "active" : ""}" data-action="navigate" data-view="playlists">Listas</button>
        <button class="menu-item ${state.activeView === "metadata" ? "active" : ""}" data-action="navigate" data-view="metadata">Metadatos</button>
        <button class="menu-item menu-item-secondary" data-action="open-about">Acerca de</button>
      </nav>

      <section class="panel ${state.activeView === "collections" ? "" : "hidden"}">
        <div class="collection-import">
          <h3>Importar colección</h3>
          <button id="import-btn">Seleccionar carpeta de música</button>
          <div id="collection-form" class="${state.selectedFolder ? "" : "hidden"}">
            <p><strong>Carpeta seleccionada:</strong> ${escapeHtml(state.selectedFolder || "Ninguna")}</p>
            <label for="collection-name">Nombre de la colección</label>
            <input id="collection-name" type="text" placeholder="Nombre de la colección" />
            <button id="confirm-import-btn">Importar colección</button>
          </div>
          <div id="status">${escapeHtml(state.status)}</div>
          ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
        </div>
        <h3>Colecciones guardadas</h3>
        ${state.collections.length === 0 ? "<p>No hay colecciones todavía. Importa una carpeta para empezar.</p>" : `<ul class="collections-list">
          ${state.collections
            .map(
              (collection) => `
                <li>
                  <strong>${escapeHtml(collection.name)}</strong>
                  <span class="meta">${escapeHtml(collection.folder_path)}</span>
                  <button data-action="rename-collection" data-id="${collection.id}">Renombrar</button>
                  <button data-action="delete-collection" data-id="${collection.id}">Eliminar</button>
                </li>
              `,
            )
            .join("")}
        </ul>`}
      </section>

      <section class="panel player-bar ${state.activeView === "songs" ? "" : "hidden"}" aria-label="Reproductor">
        <div class="player-song" title="${currentSong ? escapeHtml(currentSong.title) : "Sin canción seleccionada"}">
          ${currentSong ? escapeHtml(currentSong.title) : "Sin canción"}
        </div>
        <div class="player-playlist" title="${playbackPlaylist ? escapeHtml(playbackPlaylist.name) : "Sin lista"}">
          ${playbackPlaylist ? escapeHtml(playbackPlaylist.name) : "Sin lista"}
        </div>
        <div class="player-controls">
          <button class="player-button" data-action="playback-prev" aria-label="Canción anterior" title="Canción anterior">&#10072;&#9664;</button>
          <button class="player-button" data-action="playback-toggle" aria-label="${state.playbackStatus === "playing" ? "Pausar" : "Reproducir"}" title="${state.playbackStatus === "playing" ? "Pausar" : "Reproducir"}">${state.playbackStatus === "playing" ? "&#10074;&#10074;" : "&#9654;"}</button>
          <button class="player-button" data-action="playback-next" aria-label="Canción siguiente" title="Canción siguiente">&#9654;&#10072;</button>
        </div>
        <select id="playback-mode" aria-label="Modo de reproducción" title="Modo de reproducción">
          <option value="manual" ${state.playbackMode === "manual" ? "selected" : ""}>Reproducción individual</option>
          <option value="sequential" ${state.playbackMode === "sequential" ? "selected" : ""}>Reproducción secuencial</option>
          <option value="shuffle" ${state.playbackMode === "shuffle" ? "selected" : ""}>Reproducción aleatoria</option>
        </select>
      </section>

      <section class="panel songs-panel ${state.activeView === "songs" ? "" : "hidden"}">
        <div class="filter-row songs-filter-row">
          <div class="search-input-row">
            <input id="song-search" type="search" value="${escapeHtml(state.pendingSearchQuery)}" placeholder="Buscar canciones" />
            <button id="search-submit" class="search-button" aria-label="Buscar">🔍</button>
          </div>
          <select id="search-field" aria-label="Filtrar por campo">
            <option value="">Buscar en todos los campos</option>
            <option value="title" ${state.searchField === "title" ? "selected" : ""}>Título</option>
            <option value="artist" ${state.searchField === "artist" ? "selected" : ""}>Artista</option>
            <option value="album" ${state.searchField === "album" ? "selected" : ""}>Álbum</option>
            <option value="genre" ${state.searchField === "genre" ? "selected" : ""}>Género</option>
            <option value="year" ${state.searchField === "year" ? "selected" : ""}>Año</option>
            <option value="collection" ${state.searchField === "collection" ? "selected" : ""}>Colección</option>
          </select>
          <select id="collection-filter" aria-label="Filtrar por colección">
            <option value="">Mostrar todas las colecciones</option>
            ${state.collections
              .map(
                (collection) => `
                  <option value="${collection.id}" ${state.currentCollectionId === collection.id ? "selected" : ""}>
                    ${escapeHtml(collection.name)}
                  </option>
                `,
              )
              .join("")}
          </select>
        </div>
        <div class="action-row">
          <button id="play-filtered-btn">Reproducir filtradas</button>
          <span>${filteredSongs.length} canciones visibles</span>
        </div>
        ${filteredSongs.length === 0 ? "<p>No hay canciones visibles con los filtros actuales.</p>" : `<table>
          <thead>
            <tr>
              <th>Título</th>
              <th>Artista</th>
              <th>Álbum</th>
              <th>Género</th>
              <th>Colección</th>
              <th>Formato</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${filteredSongs
              .map(
                (song) => `
                  <tr class="${song.id === state.currentPlaybackSongId ? "current-song-row" : ""}" ${song.id === state.currentPlaybackSongId ? 'aria-current="true"' : ""}>
                    <td>${escapeHtml(song.title)}</td>
                    <td>${escapeHtml(song.artist)}</td>
                    <td>${escapeHtml(song.album)}</td>
                    <td>${escapeHtml(song.genre)}</td>
                    <td>${escapeHtml(song.collection_name)}</td>
                    <td>${escapeHtml(song.format)}</td>
                    <td class="song-actions">
                      <button class="icon-button" data-action="play-song" data-song-id="${song.id}" aria-label="Reproducir" title="Reproducir">&#9654;</button>
                      <button class="icon-button" data-action="edit-song-metadata" data-song-id="${song.id}" aria-label="Editar metadatos" title="Editar metadatos">&#9998;</button>
                      <button class="icon-button" data-action="add-song-to-playlist" data-song-id="${song.id}" aria-label="Añadir a una lista" title="Añadir a una lista">+</button>
                    </td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>`}
      </section>

      <section class="panel ${state.activeView === "metadata" ? "" : "hidden"}">
        <h2>Metadatos personalizados</h2>
        ${state.selectedSongId !== null && state.selectedSongId !== undefined ? `
          ${(() => {
            const selectedSong = state.songs.find((song) => song.id === state.selectedSongId) ?? null;
            return selectedSong ? `
              <p><strong>${escapeHtml(selectedSong.title)}</strong> · ${escapeHtml(selectedSong.artist)}</p>
              <div class="metadata-editor">
                <input id="song-metadata-key" type="text" placeholder="Clave" value="${escapeHtml(state.metadataDraftKey)}" />
                <input id="song-metadata-value" type="text" placeholder="Valor" value="${escapeHtml(state.metadataDraftValue)}" />
                <button id="save-song-metadata-btn">Guardar</button>
              </div>
              <ul class="collections-list">
                ${state.selectedSongMetadata.map((metadata) => `
                  <li>
                    <span><strong>${escapeHtml(metadata.key)}</strong>: ${escapeHtml(metadata.value)}</span>
                    <button data-action="delete-song-metadata" data-key="${escapeHtml(metadata.key)}">Eliminar</button>
                  </li>
                `).join("")}
              </ul>
            ` : "<p>Selecciona una canción para editar sus metadatos.</p>";
          })()}
        ` : "<p>Selecciona una canción para editar sus metadatos.</p>"}
      </section>

      <section class="panel ${state.activeView === "playlists" ? "" : "hidden"}">
        <h2>Listas</h2>
        <button id="create-playlist-btn">Crear lista</button>
        ${state.playlists.length === 0 ? "<p>No hay listas todavía. Crea una lista para empezar.</p>" : `<ul class="collections-list">
          ${state.playlists
            .map(
              (playlist) => `
                <li>
                  <strong>${escapeHtml(playlist.name)}</strong>
                  <span class="meta">${escapeHtml(playlist.description || "Sin descripción")}</span>
                  <button data-action="select-playlist" data-id="${playlist.id}">Seleccionar</button>
                  <button data-action="edit-playlist" data-id="${playlist.id}">Editar</button>
                  <button data-action="delete-playlist" data-id="${playlist.id}">Eliminar</button>
                </li>
              `,
            )
            .join("")}
        </ul>`}
        ${currentPlaylist ? `
          <div class="playlist-detail">
            <h3>${escapeHtml(currentPlaylist.name)}</h3>
            <p>${escapeHtml(currentPlaylist.description || "Sin descripción")}</p>
            <div class="action-row">
              <button data-action="play-playlist">Reproducir lista</button>
            </div>
            <ul class="playlist-songs">
              ${state.playlistSongs
                .map(
                  (song, index) => `
                    <li>
                      <span>${escapeHtml(song.title)} · ${escapeHtml(song.artist)}</span>
                      <div class="inline-actions">
                        <button data-action="playlist-move-up" data-index="${index}">↑</button>
                        <button data-action="playlist-move-down" data-index="${index}">↓</button>
                        <button data-action="remove-song-from-playlist" data-song-id="${song.id}">Quitar</button>
                      </div>
                    </li>
                  `,
                )
                .join("")}
            </ul>
          </div>
        ` : ""}
      </section>

    </section>
  `;
}

export function getInitialState(): AppState {
  return createInitialState();
}
