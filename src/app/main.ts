import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { initDatabase, playNativeAudio, pauseNativeAudio, resumeNativeAudio, stopNativeAudio, seekNativeAudio, selectMusicFolder, importCollection, listSongs, listCollections, renameCollection, deleteCollection, createPlaylist, updatePlaylist, deletePlaylist, removeSongFromPlaylist, reorderPlaylistSongs, listPlaylists, listPlaylistSongs } from "./api.js";
import { getInitialState, renderApp, updatePlaybackProgress } from "./ui.js";
import { filterSongs } from "./search.js";

async function bootstrap() {
  const root = document.querySelector("#app") as HTMLElement | null;
  if (!root) {
    return;
  }

  const state = getInitialState();
  let audioElement: HTMLAudioElement | null = null;
  let playbackStartedAt = 0;
  let playbackStartOffset = 0;

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

  const syncPlaybackTime = () => {
    if (state.playbackStatus !== "playing" || playbackStartedAt === 0) {
      return;
    }

    const elapsedSeconds = (performance.now() - playbackStartedAt) / 1000;
    const duration = state.currentPlaybackDuration;
    state.currentPlaybackTime = Math.min(
      playbackStartOffset + elapsedSeconds,
      duration > 0 ? duration : Number.POSITIVE_INFINITY,
    );
  };

  const seekPlayback = async (seconds: number) => {
    if (!state.currentPlaybackSongId || state.currentPlaybackDuration <= 0) {
      return;
    }

    const nextTime = Math.min(Math.max(0, seconds), state.currentPlaybackDuration);
    await seekNativeAudio(nextTime);
    state.currentPlaybackTime = nextTime;
    playbackStartOffset = nextTime;
    playbackStartedAt = state.playbackStatus === "playing" ? performance.now() : 0;
    render();
  };

  window.setInterval(() => {
    if (state.playbackStatus === "playing") {
      syncPlaybackTime();
      updatePlaybackProgress(state, root);
    }
  }, 500);

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

  const getVisibleSongs = () => {
    return filterSongs(state.songs, state.searchQuery, state.searchField);
  };

  const shuffled = <T>(entries: T[]) => {
    const result = [...entries];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
    }
    return result;
  };

  const reorderPendingPlayback = (mode: "sequential" | "shuffle") => {
    const currentSong = state.playbackQueue[state.playbackIndex];
    if (!currentSong) {
      return;
    }

    const pendingSongIds = new Set(
      state.playbackQueue
        .slice(state.playbackIndex + 1)
        .map((song) => song.id),
    );
    const sourceSongs = state.playbackPlaylistId === null
      ? getVisibleSongs()
      : state.playlistSongs;
    const pendingSongs = sourceSongs.filter((song) => pendingSongIds.has(song.id));

    state.playbackQueue = [
      currentSong,
      ...(mode === "shuffle" ? shuffled(pendingSongs) : pendingSongs),
    ];
    state.playbackIndex = 0;
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
    playbackStartOffset = 0;
    playbackStartedAt = performance.now();
    state.status = `Reproduciendo ${song.title}`;
    render();

    // Windows MediaPlayer decodifica ALAC/M4A, a diferencia del elemento
    // HTMLAudioElement usado anteriormente por el WebView.
    try {
      await playNativeAudio(song.file_path);
    } catch (error) {
      state.error = `No se pudo iniciar la reproducción: ${String(error)}`;
      state.playbackStatus = "stopped";
      state.status = "Error de reproducción";
      render();
    }
    return;

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
      state.error = `No se pudo iniciar la reproducción: ${String(error)}`;
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

  const finishPlayback = () => {
    state.playbackStatus = "stopped";
    state.currentPlaybackTime = state.currentPlaybackDuration;
    playbackStartOffset = state.currentPlaybackTime;
    playbackStartedAt = 0;
    state.status = "Reproducción finalizada";
    render();
  };

  const handlePlaybackEnded = async () => {
    if (state.playbackMode === "manual") {
      finishPlayback();
      return;
    }

    const nextIndex = state.playbackIndex + 1;
    if (nextIndex < state.playbackQueue.length) {
      await playSongByIndex(nextIndex);
    } else {
      finishPlayback();
    }
  };

  await listen("native-audio-ended", () => {
    void handlePlaybackEnded();
  });

  await listen<{ playlistId: number }>("playlist-changed", (event) => {
    state.selectedPlaylistId = event.payload.playlistId;
    void refreshData();
  });

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

    if (target.dataset.action === "navigate") {
      state.activeView = target.dataset.view as typeof state.activeView;
      render();
      return;
    }

    if (target.dataset.action === "open-about") {
      try {
        const existingWindow = await WebviewWindow.getByLabel("about");
        if (existingWindow) {
          await existingWindow.show();
          await existingWindow.setFocus();
        } else {
          const aboutWindow = new WebviewWindow("about", {
            url: "about.html",
            title: "Acerca de Tauri Music App",
            width: 440,
            height: 300,
            resizable: false,
            center: true,
          });
          await aboutWindow.once("tauri://error", (error) => {
            state.error = `No se pudo abrir la ventana «Acerca de»: ${String(error.payload)}`;
            render();
          });
        }
      } catch (error) {
        state.error = `No se pudo abrir la ventana «Acerca de»: ${String(error)}`;
        render();
      }
      return;
    }

    if (target.id === "import-btn") {
      const folderPath = await selectMusicFolder();
      if (!folderPath) {
        return;
      }
      state.selectedFolder = folderPath;
      state.status = "Carpeta lista para importar";
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
      const collectionName = (document.querySelector("#collection-name") as HTMLInputElement | null)?.value?.trim() ?? "";

      if (!folderPath) {
        state.error = "No hay carpeta seleccionada";
        render();
        return;
      }

      if (!collectionName) {
        state.error = "Es necesario dar nombre a la colección";
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
      const song = state.songs.find((entry) => entry.id === songId);
      if (!song) {
        return;
      }
      try {
        const label = `metadata-${songId}`;
        const existingWindow = await WebviewWindow.getByLabel(label);
        if (existingWindow) {
          await existingWindow.show();
          await existingWindow.setFocus();
        } else {
          const metadataWindow = new WebviewWindow(label, {
            url: `metadata.html?songId=${songId}`,
            title: `Metadatos · ${song.title}`,
            width: 720,
            height: 680,
            minWidth: 560,
            minHeight: 520,
            center: true,
          });
          await metadataWindow.once("tauri://error", (error) => {
            state.error = `No se pudo abrir el editor de metadatos: ${String(error.payload)}`;
            render();
          });
          await metadataWindow.once("tauri://destroyed", () => {
            void refreshData();
          });
        }
      } catch (error) {
        state.error = `No se pudo abrir el editor de metadatos: ${String(error)}`;
        render();
      }
      return;
    }

    if (target.dataset.action === "open-metadata-manager") {
      try {
        const existingWindow = await WebviewWindow.getByLabel("metadata-manager");
        if (existingWindow) {
          await existingWindow.show();
          await existingWindow.setFocus();
        } else {
          const metadataManagerWindow = new WebviewWindow("metadata-manager", {
            url: "metadata-manager.html",
            title: "Metadatos",
            width: 620,
            height: 560,
            minWidth: 480,
            minHeight: 420,
            center: true,
          });
          await metadataManagerWindow.once("tauri://error", (error) => {
            state.error = `No se pudo abrir la gestión de metadatos: ${String(error.payload)}`;
            render();
          });
          await metadataManagerWindow.once("tauri://destroyed", () => {
            void refreshData();
          });
        }
      } catch (error) {
        state.error = `No se pudo abrir la gestión de metadatos: ${String(error)}`;
        render();
      }
      return;
    }

    if (target.dataset.action === "play-song") {
      const songId = Number(target.dataset.songId);
      const song = state.songs.find((entry) => entry.id === songId);
      if (song) {
        state.playbackQueue = getVisibleSongs();
        state.playbackIndex = state.playbackQueue.findIndex((entry) => entry.id === song.id);
        state.playbackPlaylistId = null;
        await playSongByIndex(state.playbackIndex);
      }
      return;
    }

    if (target.dataset.action === "add-song-to-playlist") {
      const songId = Number(target.dataset.songId);
      try {
        const label = `add-to-playlist-${songId}`;
        const existingWindow = await WebviewWindow.getByLabel(label);
        if (existingWindow) {
          await existingWindow.show();
          await existingWindow.setFocus();
        } else {
          const playlistId = state.selectedPlaylistId
            ? `&playlistId=${state.selectedPlaylistId}`
            : "";
          const playlistWindow = new WebviewWindow(label, {
            url: `add-to-playlist.html?songId=${songId}${playlistId}`,
            title: "Añadir a una lista",
            width: 480,
            height: 580,
            resizable: false,
            center: true,
          });
          await playlistWindow.once("tauri://error", (error) => {
            state.error = `No se pudo abrir la ventana de listas: ${String(error.payload)}`;
            render();
          });
        }
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

    if (target.dataset.action === "play-playlist") {
      if (!state.selectedPlaylistId) {
        return;
      }
      state.playbackQueue = state.playbackMode === "shuffle"
        ? shuffled(state.playlistSongs)
        : [...state.playlistSongs];
      state.playbackIndex = 0;
      state.playbackPlaylistId = state.selectedPlaylistId;
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
      if (state.playbackStatus === "playing") {
        syncPlaybackTime();
        await pauseNativeAudio();
        state.playbackStatus = "paused";
        playbackStartOffset = state.currentPlaybackTime;
        playbackStartedAt = 0;
        state.status = `Pausado`;
      } else if (state.playbackStatus === "paused") {
        await resumeNativeAudio();
        state.playbackStatus = "playing";
        playbackStartOffset = state.currentPlaybackTime;
        playbackStartedAt = performance.now();
        state.status = `Reproduciendo`;
      } else {
        await playCurrentSong();
        return;
      }
      render();
      return;
    }

    if (target.dataset.action === "playback-stop") {
      stopAudioPlayback();
      await stopNativeAudio();
      state.playbackStatus = "stopped";
      state.currentPlaybackTime = 0;
      playbackStartOffset = 0;
      playbackStartedAt = 0;
      state.status = "Detenido";
      render();
      return;
    }

    if (target.dataset.action === "playback-next") {
      if (!state.playbackQueue.length) {
        return;
      }
      let nextIndex = (state.playbackIndex + 1) % state.playbackQueue.length;
      if (state.playbackMode === "shuffle" && state.playbackQueue.length > 1) {
        do {
          nextIndex = Math.floor(Math.random() * state.playbackQueue.length);
        } while (nextIndex === state.playbackIndex);
      }
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

    if (target.dataset.action === "playback-seek") {
      const progress = target as HTMLProgressElement;
      const bounds = progress.getBoundingClientRect();
      if (bounds.width > 0) {
        const ratio = (event.clientX - bounds.left) / bounds.width;
        await seekPlayback(ratio * state.currentPlaybackDuration);
      }
      return;
    }
  });

  root.addEventListener("keydown", async (event) => {
    const target = event.target as HTMLElement | null;
    if (target?.dataset.action !== "playback-seek") {
      return;
    }

    const step = event.shiftKey ? 30 : 5;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      await seekPlayback(state.currentPlaybackTime + (event.key === "ArrowRight" ? step : -step));
    }
  });

  root.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target) {
      return;
    }

    if (target.id === "song-search") {
      state.pendingSearchQuery = target.value;
      if (!target.value) {
        state.searchQuery = "";
        render();
      }
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
      const visibleSongs = getVisibleSongs();
      state.playbackQueue = state.playbackMode === "shuffle" ? shuffled(visibleSongs) : visibleSongs;
      state.playbackIndex = 0;
      state.playbackPlaylistId = null;
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
      const nextMode = target.value as "manual" | "sequential" | "shuffle";
      if (
        nextMode !== "manual"
        && nextMode !== state.playbackMode
      ) {
        reorderPendingPlayback(nextMode);
      }
      state.playbackMode = nextMode;
      state.status = `Modo de reproducción: ${state.playbackMode}`;
      render();
    }

    if (target.id === "playlist-selector") {
      state.selectedPlaylistId = target.value ? Number(target.value) : null;
      state.playlistSongs = state.selectedPlaylistId
        ? await listPlaylistSongs(state.selectedPlaylistId)
        : [];
      state.error = null;
      render();
    }
  });

  root.addEventListener("submit", async (event) => {
    const form = event.target as HTMLFormElement | null;
    if (form?.id !== "create-playlist-form") return;
    event.preventDefault();
    const data = new FormData(form);
    const name = String(data.get("name") ?? "").trim();
    const description = String(data.get("description") ?? "").trim() || null;
    if (!name) return;
    try {
      state.selectedPlaylistId = await createPlaylist(name, description);
      state.playlistSongs = [];
      state.status = `Lista creada: ${name}`;
      state.error = null;
      await refreshData();
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
      render();
    }
  });
}

window.addEventListener("DOMContentLoaded", () => {
  void bootstrap();
});
