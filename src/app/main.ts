import { convertFileSrc } from "@tauri-apps/api/core";
import { initDatabase, selectMusicFolder, importCollection, listSongs, listCollections, renameCollection, deleteCollection, createPlaylist, updatePlaylist, deletePlaylist, addSongToPlaylist, removeSongFromPlaylist, reorderPlaylistSongs, listPlaylists, listPlaylistSongs, listSongCustomMetadata, setSongCustomMetadata, deleteSongCustomMetadata } from "./api.js";
import { getInitialState, renderApp } from "./ui.js";

async function bootstrap() {
  const root = document.querySelector("#app") as HTMLElement | null;
  if (!root) {
    return;
  }

  const state = getInitialState();
  let audioElement: HTMLAudioElement | null = null;

  const refreshData = async () => {
    try {
      const songs = await listSongs(state.currentCollectionId ?? undefined);
      const collections = await listCollections();
      const playlists = await listPlaylists();
      state.songs = songs;
      state.collections = collections;
      state.playlists = playlists;
      state.error = null;
      if (state.selectedPlaylistId) {
        const playlistSongs = await listPlaylistSongs(state.selectedPlaylistId);
        state.playlistSongs = playlistSongs;
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
    render();
  };

  const render = () => {
    renderApp(state, root);
  };

  const loadSongMetadata = async (songId: number) => {
    try {
      const metadata = await listSongCustomMetadata(songId);
      state.selectedSongId = songId;
      state.selectedSongMetadata = metadata;
      state.metadataDraftKey = "";
      state.metadataDraftValue = "";
      render();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      render();
    }
  };

  const stopAudioPlayback = () => {
    if (audioElement) {
      audioElement.pause();
      audioElement.currentTime = 0;
    }
    audioElement = null;
  };

  const buildAudioSource = (filePath: string) => {
    // `convertFileSrc` accepts the path returned by the Rust backend in its
    // native form. Keeping Windows separators intact avoids changing the
    // canonical path that the Tauri asset protocol checks against its scope.
    return convertFileSrc(filePath);
  };

  const playSongByIndex = async (index: number) => {
    const song = state.playbackQueue[index];
    if (!song) {
      return;
    }

    state.playbackIndex = index;
    state.currentPlaybackSongId = song.id;
    state.currentPlaybackTime = 0;
    state.currentPlaybackDuration = song.duration_seconds ?? 0;
    state.playbackStatus = "playing";
    state.status = `Reproduciendo ${song.title}`;
    render();

    stopAudioPlayback();
    const audio = new Audio(buildAudioSource(song.file_path));
    audio.preload = "auto";
    audioElement = audio;

    audio.addEventListener("loadedmetadata", () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        state.currentPlaybackDuration = Math.round(audio.duration);
        render();
      }
    });

    audio.addEventListener("timeupdate", () => {
      state.currentPlaybackTime = Math.floor(audio.currentTime);
      render();
    });

    audio.addEventListener("play", () => {
      state.playbackStatus = "playing";
      state.status = `Reproduciendo ${song.title}`;
      render();
    });

    audio.addEventListener("pause", () => {
      if (audio.paused && !audio.ended) {
        state.playbackStatus = "paused";
        state.status = `Pausado: ${song.title}`;
        render();
      }
    });

    audio.addEventListener("ended", () => {
      if (state.playbackMode === "sequential") {
        const nextIndex = state.playbackIndex + 1;
        if (nextIndex < state.playbackQueue.length) {
          void playSongByIndex(nextIndex);
        } else {
          state.playbackStatus = "stopped";
          state.status = "Reproducción finalizada";
          render();
        }
      } else {
        state.playbackStatus = "stopped";
        state.status = "Reproducción finalizada";
        render();
      }
    });

    audio.addEventListener("error", () => {
      if (audioElement !== audio) {
        return;
      }
      const reason = (() => {
        switch (audio.error?.code) {
          case MediaError.MEDIA_ERR_ABORTED:
            return "la carga fue cancelada";
          case MediaError.MEDIA_ERR_NETWORK:
            return "no se pudo leer el archivo";
          case MediaError.MEDIA_ERR_DECODE:
            return "el códec de audio no es compatible";
          case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
            return "el formato o la ruta no son compatibles";
          default:
            return "se produjo un error desconocido al cargar el audio";
        }
      })();
      state.error = `No se pudo reproducir “${song.title}”: ${reason}. Archivo: ${song.file_path}`;
      state.playbackStatus = "stopped";
      state.status = "Error de reproducción";
      render();
    });

    try {
      await audio.play();
    } catch (error) {
      state.error = `No se pudo iniciar “${song.title}”: ${error instanceof Error ? error.message : String(error)}`;
      state.playbackStatus = "stopped";
      state.status = "Error de reproducción";
      render();
    }
  };

  const playCurrentSong = async () => {
    const currentSong = state.playbackQueue[state.playbackIndex];
    if (!currentSong) {
      return;
    }
    await playSongByIndex(state.playbackIndex);
  };

  render();

  try {
    await initDatabase();
    state.status = "Base de datos inicializada";
    await refreshData();
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
    render();
    return;
  }

  root.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target.id === "import-btn") {
      const folderPath = await selectMusicFolder();
      if (!folderPath) {
        return;
      }
      state.selectedFolder = folderPath;
      state.status = `Carpeta seleccionada: ${folderPath}`;
      state.error = null;
      render();
      setTimeout(() => {
        const input = document.querySelector("#collection-name") as HTMLInputElement | null;
        input?.focus();
      }, 0);
      return;
    }

    if (target.id === "confirm-import-btn") {
      const folderPath = state.selectedFolder;
      const collectionName = (document.querySelector("#collection-name") as HTMLInputElement | null)?.value?.trim() || "Nueva colección";

      if (!folderPath) {
        state.error = "No hay carpeta seleccionada";
        render();
        return;
      }

      try {
        const result = await importCollection(folderPath, collectionName);
        if (result.imported === 0) {
          state.error = "No se importaron archivos de audio desde la carpeta seleccionada.";
          state.status = "No se importaron canciones.";
          render();
          return;
        }
        state.status = `Importadas ${result.imported} canciones`;
        state.error = null;
        state.selectedFolder = null;
        await refreshData();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        render();
      }
      return;
    }

    if (target.id === "create-playlist-btn") {
      const name = window.prompt("Nombre de la lista")?.trim();
      if (!name) {
        return;
      }
      try {
        await createPlaylist(name);
        await refreshData();
        state.error = null;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        render();
      }
      return;
    }

    if (target.dataset.action === "rename-collection") {
      const collectionId = Number(target.dataset.id);
      const collection = state.collections.find((c) => c.id === collectionId);
      const currentName = collection?.name || "";
      const newName = window.prompt("Nuevo nombre de la colección", currentName)?.trim();
      if (!newName || newName === currentName) {
        return;
      }
      try {
        await renameCollection(collectionId, newName);
        await refreshData();
        state.error = null;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      }
      render();
      return;
    }

    if (target.dataset.action === "delete-collection") {
      const collectionId = Number(target.dataset.id);
      const confirmed = window.confirm("¿Eliminar esta colección? Solo se borran los datos de la app, no los archivos.");
      if (!confirmed) {
        return;
      }
      try {
        await deleteCollection(collectionId);
        state.currentCollectionId = state.currentCollectionId === collectionId ? null : state.currentCollectionId;
        await refreshData();
        state.error = null;
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
      }
      render();
      return;
    }

    if (target.dataset.action === "select-playlist") {
      state.selectedPlaylistId = Number(target.dataset.id);
      state.playlistSongs = [];
      await refreshData();
      return;
    }

    if (target.dataset.action === "edit-playlist") {
      const playlistId = Number(target.dataset.id);
      const playlist = state.playlists.find((entry) => entry.id === playlistId);
      if (!playlist) {
        return;
      }
      const newName = window.prompt("Nuevo nombre de la lista", playlist.name)?.trim();
      if (!newName || newName === playlist.name) {
        return;
      }
      const newDescription = window.prompt("Nueva descripción de la lista", playlist.description || "")?.trim() || null;
      try {
        await updatePlaylist(playlistId, newName, newDescription);
        await refreshData();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        render();
      }
      return;
    }

    if (target.dataset.action === "delete-playlist") {
      const playlistId = Number(target.dataset.id);
      const confirmed = window.confirm("¿Eliminar esta lista?");
      if (!confirmed) {
        return;
      }
      try {
        await deletePlaylist(playlistId);
        if (state.selectedPlaylistId === playlistId) {
          state.selectedPlaylistId = null;
          state.playlistSongs = [];
        }
        await refreshData();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        render();
      }
      return;
    }

    if (target.dataset.action === "edit-song-metadata") {
      const songId = Number(target.dataset.songId);
      await loadSongMetadata(songId);
      return;
    }

    if (target.dataset.action === "play-song") {
      const songId = Number(target.dataset.songId);
      const song = state.songs.find((entry) => entry.id === songId);
      if (song) {
        state.playbackQueue = [song];
        state.playbackIndex = 0;
        await playSongByIndex(0);
      }
      return;
    }

    if (target.dataset.action === "add-song-to-playlist") {
      const songId = Number(target.dataset.songId);
      const playlistId = state.selectedPlaylistId;
      if (!playlistId) {
        state.error = "Selecciona una lista primero";
        render();
        return;
      }
      try {
        await addSongToPlaylist(playlistId, songId);
        await refreshData();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        render();
      }
      return;
    }

    if (target.dataset.action === "remove-song-from-playlist") {
      const songId = Number(target.dataset.songId);
      const playlistId = state.selectedPlaylistId;
      if (!playlistId) {
        return;
      }
      try {
        await removeSongFromPlaylist(playlistId, songId);
        await refreshData();
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        render();
      }
      return;
    }

    if (target.dataset.action === "delete-song-metadata") {
      const key = target.dataset.key;
      if (!state.selectedSongId || !key) {
        return;
      }
      try {
        await deleteSongCustomMetadata(state.selectedSongId, key);
        await loadSongMetadata(state.selectedSongId);
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        render();
      }
      return;
    }

    if (target.id === "save-song-metadata-btn") {
      if (!state.selectedSongId) {
        return;
      }
      const key = state.metadataDraftKey.trim();
      const value = state.metadataDraftValue.trim();
      if (!key) {
        state.error = "La clave del metadato no puede estar vacía";
        render();
        return;
      }
      try {
        await setSongCustomMetadata(state.selectedSongId, key, value);
        await loadSongMetadata(state.selectedSongId);
      } catch (error) {
        state.error = error instanceof Error ? error.message : String(error);
        render();
      }
      return;
    }

    if (target.dataset.action === "play-playlist") {
      if (!state.selectedPlaylistId) {
        return;
      }
      state.playbackQueue = [...state.playlistSongs];
      state.playbackIndex = 0;
      state.currentPlaybackSongId = state.playbackQueue[0]?.id ?? null;
      await playSongByIndex(0);
      return;
    }

    if (target.dataset.action === "playlist-move-up") {
      const index = Number(target.dataset.index);
      if (index <= 0) {
        return;
      }
      const reordered = [...state.playlistSongs];
      [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]];
      state.playlistSongs = reordered;
      const songOrder = reordered.map((song) => song.id);
      await reorderPlaylistSongs(state.selectedPlaylistId ?? 0, songOrder);
      render();
      return;
    }

    if (target.dataset.action === "playlist-move-down") {
      const index = Number(target.dataset.index);
      if (index < 0 || index >= state.playlistSongs.length - 1) {
        return;
      }
      const reordered = [...state.playlistSongs];
      [reordered[index], reordered[index + 1]] = [reordered[index + 1], reordered[index]];
      state.playlistSongs = reordered;
      const songOrder = reordered.map((song) => song.id);
      await reorderPlaylistSongs(state.selectedPlaylistId ?? 0, songOrder);
      render();
      return;
    }

    if (target.dataset.action === "playback-toggle") {
      if (!audioElement) {
        await playCurrentSong();
        return;
      }

      if (state.playbackStatus === "playing") {
        audioElement.pause();
        state.playbackStatus = "paused";
        state.status = `Pausado`;
      } else {
        await audioElement.play();
        state.playbackStatus = "playing";
        state.status = `Reproduciendo`;
      }
      render();
      return;
    }

    if (target.dataset.action === "playback-stop") {
      stopAudioPlayback();
      state.playbackStatus = "stopped";
      state.status = "Detenido";
      render();
      return;
    }

    if (target.dataset.action === "playback-next") {
      if (!state.playbackQueue.length) {
        return;
      }
      const nextIndex = (state.playbackIndex + 1) % state.playbackQueue.length;
      await playSongByIndex(nextIndex);
      return;
    }

    if (target.dataset.action === "playback-prev") {
      if (!state.playbackQueue.length) {
        return;
      }
      const prevIndex = (state.playbackIndex - 1 + state.playbackQueue.length) % state.playbackQueue.length;
      await playSongByIndex(prevIndex);
      return;
    }
  });

  root.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target) {
      return;
    }

    if (target.id === "song-search") {
      state.pendingSearchQuery = target.value;
    }

    if (target.id === "song-metadata-key") {
      state.metadataDraftKey = target.value;
    }

    if (target.id === "song-metadata-value") {
      state.metadataDraftValue = target.value;
    }
  });

  root.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target.id === "search-submit") {
      state.searchQuery = state.pendingSearchQuery;
      render();
    }

    if (target.id === "play-filtered-btn") {
      state.playbackQueue = [...state.songs.filter((song) => {
        const searchQuery = state.searchQuery.trim().toLowerCase();
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
      })];
      state.playbackIndex = 0;
      state.currentPlaybackSongId = state.playbackQueue[0]?.id ?? null;
      await playSongByIndex(0);
    }
  });

  root.addEventListener("change", async (event) => {
    const target = event.target as HTMLSelectElement | HTMLInputElement | null;
    if (!target) {
      return;
    }

    if (target.id === "collection-filter") {
      state.currentCollectionId = target.value ? Number(target.value) : null;
      await refreshData();
    }

    if (target.id === "search-field") {
      state.searchField = target.value;
      render();
    }

    if (target.id === "playback-mode") {
      state.playbackMode = target.value as "manual" | "sequential" | "shuffle";
      state.status = `Modo de reproducción: ${state.playbackMode}`;
      render();
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  void bootstrap();
});
