import { initDatabase, selectMusicFolder, importCollection, listSongs, listCollections, renameCollection, deleteCollection, createPlaylist, listPlaylists } from "./api.js";
import { getInitialState, renderApp } from "./ui.js";

async function bootstrap() {
  const root = document.querySelector("#app") as HTMLElement | null;
  if (!root) {
    return;
  }

  const state = getInitialState();

  const refreshData = async () => {
    try {
      const songs = await listSongs(state.currentCollectionId ?? undefined);
      const collections = await listCollections();
      const playlists = await listPlaylists();
      state.songs = songs;
      state.collections = collections;
      state.playlists = playlists;
      state.error = null;
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error);
    }
    render();
  };

  const render = () => {
    renderApp(state, root);
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
        const playlists = await listPlaylists();
        state.playlists = playlists;
        state.error = null;
        render();
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
  });

  root.addEventListener("input", (event) => {
    const target = event.target as HTMLInputElement | null;
    if (!target) {
      return;
    }

    if (target.id === "song-search") {
      state.pendingSearchQuery = target.value;
    }
  });

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }

    if (target.id === "search-submit") {
      state.searchQuery = state.pendingSearchQuery;
      render();
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
  });
}

window.addEventListener("DOMContentLoaded", () => {
  void bootstrap();
});
