import { createInitialState, type AppState } from "./state.js";
import { filterSongs } from "./search.js";

function escapeHtml(value: string | null | undefined) {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatPlaylistCreatedAt(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  let hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12;
  if (hours === 0) {
    hours = 12;
  }
  return `${year}-${month}-${day} ${String(hours).padStart(2, "0")} : ${minutes} ${period}`.replace(" : ", ":");
}

function formatPlaybackTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`
    : `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function updatePlaybackProgress(state: AppState, root: HTMLElement) {
  const playbackDuration = Math.max(0, state.currentPlaybackDuration);
  const playbackTime = Math.min(
    Math.max(0, state.currentPlaybackTime),
    playbackDuration || Infinity,
  );
  const playbackProgress = playbackDuration > 0
    ? (playbackTime / playbackDuration) * 100
    : 0;
  const times = root.querySelectorAll<HTMLTimeElement>(".playback-time");
  const progress = root.querySelector<HTMLProgressElement>(
    '[data-action="playback-seek"]',
  );

  if (times[0]) {
    times[0].dateTime = `PT${Math.floor(playbackTime)}S`;
    times[0].textContent = formatPlaybackTime(playbackTime);
  }
  if (times[1]) {
    times[1].dateTime = `PT${Math.floor(playbackDuration)}S`;
    times[1].textContent = formatPlaybackTime(playbackDuration);
  }
  if (progress) {
    progress.value = playbackProgress;
    progress.textContent = `${Math.round(playbackProgress)}%`;
    progress.setAttribute(
      "aria-valuetext",
      `${formatPlaybackTime(playbackTime)} de ${formatPlaybackTime(playbackDuration)}`,
    );
  }
}

export function renderApp(state: AppState, root: HTMLElement) {
  const collectionSongs = state.selectedCollectionIds.length === 0
    ? state.songs
    : state.songs.filter((song) => state.selectedCollectionIds.includes(song.collection_id));
  const filteredSongs = filterSongs(collectionSongs, state.searchQuery, state.searchField);
  const customMetadataKeys = [...new Set(
    state.songs.flatMap((song) => song.custom_metadata.map((item) => item.key)),
  )].sort((left, right) => left.localeCompare(right, "es"));

  const currentSong = state.playbackQueue[state.playbackIndex] ?? null;
  const currentSongText = currentSong
    ? [currentSong.title.trim(), currentSong.artist.trim()].filter(Boolean).join(" - ")
    : "";
  const currentPlaylist = state.playlists.find((playlist) => playlist.id === state.selectedPlaylistId) ?? null;
  const playbackDuration = Math.max(0, state.currentPlaybackDuration);
  const playbackTime = Math.min(Math.max(0, state.currentPlaybackTime), playbackDuration || Infinity);
  const playbackProgress = playbackDuration > 0 ? (playbackTime / playbackDuration) * 100 : 0;
  const playbackVolumePercent = Math.round(state.playbackVolume * 100);
  const collectionStatus = /^(Reproduciendo|Pausado(?::|$)|Reproducción finalizada|Detenido$)/.test(state.status)
    ? ""
    : state.status;

  root.innerHTML = `
    <section class="app-shell">
      <nav class="panel app-menu" aria-label="Navegación principal">
        <button class="menu-item ${state.activeView === "songs" ? "active" : ""}" data-action="navigate" data-view="songs">Canciones</button>
        <button class="menu-item ${state.activeView === "collections" ? "active" : ""}" data-action="navigate" data-view="collections">Colecciones</button>
        <button class="menu-item ${state.activeView === "playlists" ? "active" : ""}" data-action="navigate" data-view="playlists">Listas</button>
        <button class="menu-item ${state.activeView === "metadata" ? "active" : ""}" data-action="navigate" data-view="metadata">Metadatos</button>
        <button class="menu-item menu-item-secondary" data-action="open-about">Acerca de</button>
      </nav>

      <section class="panel player-bar" aria-label="Reproductor">
        <div class="player-song" title="${currentSong ? escapeHtml(currentSongText) : "Sin canción seleccionada"}">
          ${currentSong ? escapeHtml(currentSongText) : "Sin canción"}
        </div>
        <div class="player-playlist" title="${currentSong ? escapeHtml(currentSong.collection_name) : "Sin colección"}">
          ${currentSong ? escapeHtml(currentSong.collection_name) : "Sin colección"}
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
        <div class="playback-progress" aria-label="Progreso de la reproducción">
          <time class="playback-time" datetime="PT${Math.floor(playbackTime)}S">${formatPlaybackTime(playbackTime)}</time>
          <progress value="${playbackProgress}" max="100" data-action="playback-seek" tabindex="0" aria-label="Progreso de la pista. Pulsa para cambiar la posición" aria-valuetext="${formatPlaybackTime(playbackTime)} de ${formatPlaybackTime(playbackDuration)}">${Math.round(playbackProgress)}%</progress>
          <time class="playback-time playback-duration" datetime="PT${Math.floor(playbackDuration)}S">${formatPlaybackTime(playbackDuration)}</time>
          <div class="volume-control">
            <button type="button" class="volume-button" data-action="playback-mute" aria-label="${state.playbackVolume === 0 ? "Restaurar sonido" : "Silenciar"}" title="${state.playbackVolume === 0 ? "Restaurar sonido" : "Silenciar"}">${state.playbackVolume === 0 ? "&#128263;" : "&#128266;"}</button>
            <input id="playback-volume" type="range" min="0" max="100" step="1" value="${playbackVolumePercent}" aria-label="Volumen" aria-valuetext="${playbackVolumePercent}%" title="Volumen: ${playbackVolumePercent}%" />
          </div>
        </div>
      </section>

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
          <div id="status" class="info-message">${escapeHtml(collectionStatus)}</div>
          ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
        </div>
        <h3>Colecciones guardadas</h3>
        ${state.collections.length === 0 ? "<p>No hay colecciones todavía. Importa una carpeta para empezar.</p>" : `<ul class="collections-list">
          ${state.collections
            .map(
              (collection) => `
                <li>
                  <div class="collection-item-actions">
                    <button type="button" class="icon-button" data-action="rename-collection" data-id="${collection.id}" aria-label="Renombrar colección" title="Renombrar colección">&#9998;</button>
                    <button type="button" class="icon-button danger" data-action="delete-collection" data-id="${collection.id}" aria-label="Eliminar colección" title="Eliminar colección">&#128465;</button>
                  </div>
                  <div class="collection-item-text">
                    <strong>${escapeHtml(collection.name)}</strong>
                    <span class="meta">${escapeHtml(collection.folder_path)}</span>
                  </div>
                </li>
              `,
            )
            .join("")}
        </ul>`}
      </section>

      <section class="panel metadata-panel ${state.activeView === "metadata" ? "" : "hidden"}">
        ${state.status.startsWith("Metadato ") ? `<p class="info-message">${escapeHtml(state.status)}</p>` : ""}
        ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        <section class="metadata-card">
          <p class="metadata-create-help">Los metadatos personalizados que se creen podrán gestionarse en la ventana de canciones, cuando se acceda a la ventana de modificación de la canción.</p>
          <form id="create-metadata-definition-form" class="metadata-create-form">
            <button type="submit" class="icon-button metadata-create-button">Crear nuevo metadato</button>
            <input name="key" required placeholder="Nombre del metadato" aria-label="Nombre del metadato" />
          </form>
        </section>
        <section class="metadata-card">
          <h2>Metadatos personalizados</h2>
          ${state.customMetadataDefinitions.length ? `<ul class="metadata-definitions-list">
            ${state.customMetadataDefinitions.map((key) => `
              <li data-metadata-key="${escapeHtml(key)}">
                <div class="metadata-definition-actions">
                  <button type="button" class="icon-button" data-action="rename-metadata-definition" data-key="${escapeHtml(key)}" aria-label="Modificar metadato ${escapeHtml(key)}" title="Modificar metadato">&#9998;</button>
                  <button type="button" class="icon-button danger" data-action="delete-metadata-definition" data-key="${escapeHtml(key)}" aria-label="Eliminar metadato ${escapeHtml(key)}" title="Eliminar metadato">&#128465;</button>
                </div>
                <input value="${escapeHtml(key)}" aria-label="Nombre de ${escapeHtml(key)}" />
              </li>
            `).join("")}
          </ul>` : "<p class=\"info-message\">No hay metadatos personalizados.</p>"}
        </section>
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
            ${customMetadataKeys
              .map((key) => {
                const value = `custom:${key}`;
                return `<option value="${escapeHtml(value)}" ${state.searchField === value ? "selected" : ""}>${escapeHtml(key)}</option>`;
              })
              .join("")}
          </select>
          <details class="collection-filter" ${state.collectionFilterOpen ? "open" : ""}>
            <summary aria-label="Filtrar por colecciones">
              ${state.selectedCollectionIds.length === 0
                ? "Todas las colecciones"
                : `${state.selectedCollectionIds.length} ${state.selectedCollectionIds.length === 1 ? "colección" : "colecciones"}`}
            </summary>
            <div class="collection-filter-options">
              <label>
                <input id="all-collections-filter" type="checkbox" ${state.selectedCollectionIds.length === 0 ? "checked" : ""} />
                Todas las colecciones
              </label>
              ${state.collections
                .map(
                  (collection) => `
                    <label>
                      <input type="checkbox" data-action="filter-collection" value="${collection.id}" ${state.selectedCollectionIds.includes(collection.id) ? "checked" : ""} />
                      ${escapeHtml(collection.name)}
                    </label>
                  `,
                )
                .join("")}
            </div>
          </details>
        </div>
        <div class="action-row">
          <button id="play-filtered-btn">Reproducir filtradas</button>
          <span class="info-message">${filteredSongs.length} canciones visibles</span>
        </div>
        ${filteredSongs.length === 0 ? "<p>No hay canciones visibles con los filtros actuales.</p>" : `<table>
          <thead>
            <tr>
              <th></th>
              <th class="song-title-column">Título</th>
              <th class="song-spaced-column">Artista</th>
              <th class="song-spaced-column">Álbum</th>
              <th class="song-spaced-column">Género</th>
              <th class="song-spaced-column">Colección</th>
              <th class="song-duration" aria-label="Duración"></th>
            </tr>
          </thead>
          <tbody>
            ${filteredSongs
              .map(
                (song) => `
                  <tr class="${song.id === state.currentPlaybackSongId ? "current-song-row" : ""}" ${song.id === state.currentPlaybackSongId ? 'aria-current="true"' : ""}>
                    <td class="song-actions">
                      <button class="icon-button" data-action="play-song" data-song-id="${song.id}" aria-label="${song.id === state.currentPlaybackSongId && state.playbackStatus === "playing" ? "Pausar" : "Reproducir"}" title="${song.id === state.currentPlaybackSongId && state.playbackStatus === "playing" ? "Pausar" : "Reproducir"}">${song.id === state.currentPlaybackSongId && state.playbackStatus === "playing" ? "&#10074;&#10074;" : "&#9654;"}</button>
                      <button class="icon-button" data-action="edit-song-metadata" data-song-id="${song.id}" aria-label="Editar metadatos" title="Editar metadatos">&#9998;</button>
                      <button class="icon-button" data-action="add-song-to-playlist" data-song-id="${song.id}" aria-label="Añadir a una lista" title="Añadir a una lista">+</button>
                    </td>
                    <td class="song-title-column">${escapeHtml(song.title)}</td>
                    <td class="song-spaced-column">${escapeHtml(song.artist)}</td>
                    <td class="song-spaced-column">${escapeHtml(song.album)}</td>
                    <td class="song-spaced-column">${escapeHtml(song.genre)}</td>
                    <td class="song-spaced-column">${escapeHtml(song.collection_name)}</td>
                    <td class="song-duration">${song.duration_seconds == null ? "" : formatPlaybackTime(song.duration_seconds)}</td>
                  </tr>
                `,
              )
              .join("")}
          </tbody>
        </table>`}
      </section>

      <section class="panel ${state.activeView === "playlists" ? "" : "hidden"}">
        <section class="playlist-create-card">
          <form id="create-playlist-form" class="playlist-create-form">
            <button type="submit" class="icon-button playlist-create-button">Crear nueva lista</button>
            <input id="playlist-name" name="name" required placeholder="Nombre de la lista" aria-label="Nombre de la lista" />
            <input name="description" placeholder="Descripción" aria-label="Descripción de la lista" />
          </form>
        </section>
        <div class="playlist-toolbar">
          <div class="playlist-selector">
            <select id="playlist-selector" aria-label="Lista seleccionada" ${state.playlists.length === 0 ? "disabled" : ""}>
              <option value="">Selecciona una lista</option>
              ${state.playlists.map((playlist) => `
                <option value="${playlist.id}" ${playlist.id === state.selectedPlaylistId ? "selected" : ""}>${escapeHtml(playlist.name)}${playlist.duration ? ` (${escapeHtml(playlist.duration)})` : ""}</option>
              `).join("")}
            </select>
          </div>
        </div>
        ${state.playlists.length === 0 ? "<p>No hay listas todavía. Crea una lista para empezar.</p>" : ""}
        ${currentPlaylist ? `
          <div class="playlist-detail">
            <div class="playlist-header">
              <div class="playlist-header-actions">
                <button type="button" class="icon-button" data-action="edit-playlist" data-id="${currentPlaylist.id}" aria-label="Editar lista" title="Editar lista">&#9998;</button>
                <button type="button" class="icon-button danger" data-action="delete-playlist" data-id="${currentPlaylist.id}" aria-label="Eliminar lista" title="Eliminar lista">&#128465;</button>
              </div>
              <div class="playlist-header-text">
                <div class="playlist-header-title-row">
                  <div class="playlist-title-with-export">
                    <h3>${escapeHtml(currentPlaylist.name)}</h3>
                    <button type="button" class="icon-button pdf-export-button" data-action="export-playlist-pdf" aria-label="Exportar lista a PDF" title="Exportar lista a PDF">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h8l4 4v16H6V2Zm7 1.8V7h3.2L13 3.8ZM8.3 18h1.4v-2h.8c1.4 0 2.3-.8 2.3-2.1 0-1.3-.9-2.1-2.3-2.1H8.3V18Zm1.4-3.2V13h.7c.6 0 1 .3 1 .9s-.4.9-1 .9h-.7Zm3.8 3.2h2c1.7 0 2.8-1.2 2.8-3.1 0-1.9-1.1-3.1-2.8-3.1h-2V18Zm1.4-1.2V13h.5c.9 0 1.5.7 1.5 1.9 0 1.2-.6 1.9-1.5 1.9h-.5Z"/></svg>
                    </button>
                    <button type="button" class="icon-button odf-export-button" data-action="export-playlist-odf" aria-label="Exportar lista a LibreOffice (ODF)" title="Exportar lista a LibreOffice (ODF)">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2h9.2L19 6.8V12h-2V7.7h-3.7V4H7v16h5v2H5V2Zm10.3 2.6V6h1.4l-1.4-1.4Z"/><path d="M18.2 12.2a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z"/><path d="M18.2 15.4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z"/></svg>
                    </button>
                  </div>
                  <span class="playlist-duration">${escapeHtml(currentPlaylist.duration || "00:00:00")}</span>
                </div>
                <p class="playlist-description">${escapeHtml(currentPlaylist.description || "Sin descripción")}</p>
              </div>
            </div>
            ${state.playlistSongs.length === 0 ? "<p class=\"info-message\">Esta lista todavía no contiene canciones.</p>" : ""}
            <ul class="playlist-songs">
              ${state.playlistSongs
                .map(
                  (song, index) => `
                    <li class="${song.id === state.currentPlaybackSongId ? "current-song-row" : ""}">
                      <div class="playlist-song-main">
                        <button type="button" class="icon-button" data-action="play-playlist-song" data-song-id="${song.id}" aria-label="${song.id === state.currentPlaybackSongId && state.playbackStatus === "playing" ? "Pausar" : "Reproducir"}" title="${song.id === state.currentPlaybackSongId && state.playbackStatus === "playing" ? "Pausar" : "Reproducir"}">${song.id === state.currentPlaybackSongId && state.playbackStatus === "playing" ? "&#10074;&#10074;" : "&#9654;"}</button>
                        <span class="playlist-song-order">${index + 1}</span>
                      </div>
                      <div class="playlist-song-meta">
                        <span class="song-title">${escapeHtml(song.title)}</span>
                        <span class="song-details">${escapeHtml(song.artist)} · ${escapeHtml(song.album)} · <span class="playlist-song-duration" aria-label="Duración">${song.duration_seconds == null ? "—" : formatPlaybackTime(song.duration_seconds)}</span></span>
                      </div>
                      <div class="inline-actions">
                        <button type="button" class="icon-button" data-action="playlist-move-up" data-index="${index}" aria-label="Mover arriba" title="Mover arriba">↑</button>
                        <button type="button" class="icon-button" data-action="playlist-move-down" data-index="${index}" aria-label="Mover abajo" title="Mover abajo">↓</button>
                        <button type="button" class="icon-button" data-action="edit-song-consigna" data-song-id="${song.id}" aria-label="Modificar consigna" title="Modificar consigna">&#9998;</button>
                        <button type="button" class="icon-button danger" data-action="remove-song-from-playlist" data-song-id="${song.id}" aria-label="Quitar canción" title="Quitar canción">&#128465;</button>
                      </div>
                      <div class="playlist-song-consigna">${escapeHtml(song.consigna || "—")}</div>
                    </li>
                  `,
                )
                .join("")}
            </ul>
          </div>
        ` : ""}
      </section>

      <div class="modal-backdrop ${state.playlistEditorOpen ? "" : "hidden"}" data-action="close-playlist-editor">
        <div class="modal${state.playlistEditorMaximized ? " maximized" : ""}" role="dialog" aria-modal="true" aria-labelledby="edit-playlist-title" onclick="event.stopPropagation()">
          <form id="edit-playlist-form" class="modal-form">
            <div class="modal-title-bar">
              <h2 id="edit-playlist-title">Editar lista</h2>
              <button type="button" class="icon-button" data-action="toggle-playlist-editor-maximize" aria-label="Alternar pantalla completa" title="Alternar pantalla completa">⛶</button>
            </div>
            <label>
              Nombre
              <input name="name" value="${escapeHtml(state.playlistEditorName)}" required />
            </label>
            <label>
              Descripción corta
              <input name="description" value="${escapeHtml(state.playlistEditorDescription)}" />
            </label>
            <label>
              Descripción extendida
              <textarea name="descriptionExtended">${escapeHtml(state.playlistEditorDescriptionExtended ?? "")}</textarea>
            </label>
            <label>
              Finalidad
              <input name="purpose" value="${escapeHtml(state.playlistEditorPurpose)}" />
            </label>
            <label>
              Etiquetas
              <input name="tags" placeholder="palabra1;palabra2" value="${escapeHtml(state.playlistEditorTags)}" />
              <span class="field-hint">Introduce palabras clave separadas por <code>;</code>.</span>
            </label>
            <label>
              Comentario
              <textarea name="comment">${escapeHtml(state.playlistEditorComment ?? "")}</textarea>
            </label>
            <div class="modal-readonly-row">
              <label>
                Fecha de creación
                <input value="${escapeHtml(formatPlaylistCreatedAt(state.playlistEditorCreatedAt))}" disabled />
              </label>
              <label>
                Duración
                <input value="${escapeHtml(state.playlistEditorDuration ?? "00:00:00")}" disabled />
              </label>
            </div>
            <div class="modal-actions">
              <button type="button" class="secondary" data-action="close-playlist-editor">Cancelar</button>
              <button type="submit">Guardar</button>
            </div>
          </form>
        </div>
      </div>
    </section>
  `;
}

export function getInitialState(): AppState {
  return createInitialState();
}
