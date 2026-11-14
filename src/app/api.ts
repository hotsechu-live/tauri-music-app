import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { playlistExportBytes, playlistExportFilename, parsePlaylistExport, type ImportResult } from "./playlist-export.js";
import type { RestoreResult } from "./state.js";

export async function initDatabase() {
  return invoke("init_database");
}

export async function playNativeAudio(filePath: string) {
  return invoke<string>("play_native_audio", { filePath });
}

export async function pauseNativeAudio() {
  return invoke<string>("pause_native_audio");
}

export async function resumeNativeAudio() {
  return invoke<string>("resume_native_audio");
}

export async function stopNativeAudio() {
  return invoke<string>("stop_native_audio");
}

export async function seekNativeAudio(seconds: number) {
  return invoke<string>("seek_native_audio", { seconds });
}

export async function setNativeAudioVolume(volume: number) {
  return invoke<string>("set_native_audio_volume", { volume });
}

export async function importCollection(folderPath: string, collectionName: string) {
  return invoke<{ imported: number; collection_id: number }>("import_collection", {
    folderPath,
    collectionName,
  });
}

export async function listSongs(collectionId?: number) {
  return invoke<any[]>("list_songs", { collectionId });
}

export async function listCollections() {
  return invoke<any[]>("list_collections");
}

export async function renameCollection(collectionId: number, newName: string) {
  return invoke<string>("rename_collection", { collectionId, newName });
}

export async function deleteCollection(collectionId: number) {
  return invoke<string>("delete_collection", { collectionId });
}

export async function createPlaylist(name: string, description: string | null = null, group: string | null = null) {
  return invoke<number>("create_playlist", { name, description, group });
}

export async function updatePlaylist(
  playlistId: number,
  name: string,
  description: string | null = null,
  group: string | null = null,
  descriptionExtended: string | null = null,
  purpose: string | null = null,
  tags: string | null = null,
  comment: string | null = null,
) {
  return invoke<string>("update_playlist", {
    playlistId,
    name,
    description,
    group,
    descriptionExtended,
    purpose,
    tags,
    comment,
  });
}

export async function deletePlaylist(playlistId: number) {
  return invoke<string>("delete_playlist", { playlistId });
}

export async function addSongToPlaylist(playlistId: number, songId: number) {
  return invoke<string>("add_song_to_playlist", { playlistId, songId });
}

export async function removeSongFromPlaylist(playlistId: number, songId: number) {
  return invoke<string>("remove_song_from_playlist", { playlistId, songId });
}

export async function reorderPlaylistSongs(playlistId: number, songOrder: number[]) {
  return invoke<string>("reorder_playlist_songs", { playlistId, songOrder });
}

export async function updatePlaylistSongConsigna(playlistId: number, songId: number, consigna: string) {
  return invoke<string>("update_playlist_song_consigna", { playlistId, songId, consigna });
}

export async function listPlaylists() {
  return invoke<any[]>("list_playlists");
}

export async function listPlaylistSongs(playlistId: number) {
  return invoke<any[]>("list_playlist_songs", { playlistId });
}

export async function writePdfFile(filePath: string, contents: Uint8Array) {
  return invoke<string>("write_pdf_file", { filePath, contents: Array.from(contents) });
}

export async function writeOdfFile(filePath: string, contents: Uint8Array) {
  return invoke<string>("write_odf_file", { filePath, contents: Array.from(contents) });
}

export async function listSongCustomMetadata(songId: number) {
  return invoke<any[]>("list_song_custom_metadata", { songId });
}

export async function setSongCustomMetadata(songId: number, key: string, value: string) {
  return invoke<string>("set_song_custom_metadata", { songId, key, value });
}

export async function deleteSongCustomMetadata(songId: number, key: string) {
  return invoke<string>("delete_song_custom_metadata", { songId, key });
}

export async function listCustomMetadataDefinitions() {
  return invoke<string[]>("list_custom_metadata_definitions");
}

export async function createCustomMetadataDefinition(key: string) {
  return invoke<string>("create_custom_metadata_definition", { key });
}

export async function renameCustomMetadataDefinition(oldKey: string, newKey: string) {
  return invoke<string>("rename_custom_metadata_definition", { oldKey, newKey });
}

export async function deleteCustomMetadataDefinition(key: string) {
  return invoke<string>("delete_custom_metadata_definition", { key });
}

export async function updateSongMetadata(
  songId: number,
  metadata: { title: string; artist: string; album: string; genre: string; year: string },
) {
  return invoke<string>("update_song_metadata", { songId, ...metadata });
}

/**
 * Exporta una playlist a formato JSON portable
 */
export async function exportPlaylist(
  playlist: any,
  songs: any[],
) {
  const contents = playlistExportBytes(playlist, songs);
  const filePath = await save({
    title: "Guardar sesión como JSON",
    defaultPath: playlistExportFilename(playlist.name),
    filters: [{ name: "Archivo JSON", extensions: ["json"] }],
  });
  
  if (!filePath) {
    return null;
  }
  
  const finalPath = filePath.toLowerCase().endsWith(".json") 
    ? filePath 
    : `${filePath}.json`;
  
  await invoke<string>("export_playlist_file", { filePath: finalPath, contents });
  return finalPath;
}

/**
 * Importa una playlist desde archivo JSON
 */
export async function importPlaylistFile(targetGroup?: string): Promise<ImportResult> {
  const filePath = await open({
    title: "Seleccionar archivo de sesión",
    filters: [{ name: "Archivo JSON", extensions: ["json"] }],
    multiple: false,
  });
  
  if (!filePath || Array.isArray(filePath)) {
    return {
      playlistId: null,
      totalSongs: 0,
      matchedSongs: 0,
      unmatchedSongs: 0,
      errors: ["No se seleccionó ningún archivo"],
      warnings: [],
    };
  }
  
  try {
    // Leer el contenido del archivo usando Tauri
    const contents = await invoke<string>("read_text_file", { filePath });
    const exported = parsePlaylistExport(contents);
    
    if (!exported) {
      return {
        playlistId: null,
        totalSongs: 0,
        matchedSongs: 0,
        unmatchedSongs: 0,
        errors: ["Formato de archivo inválido o versión no soportada"],
        warnings: [],
      };
    }
    
    // Llamar al backend para importar
    const result = await invoke<ImportResult>("import_playlist", {
      exportData: JSON.stringify(exported),
      targetGroup,
    });
    
    return result;
  } catch (error) {
    return {
      playlistId: null,
      totalSongs: 0,
      matchedSongs: 0,
      unmatchedSongs: 0,
      errors: [`Error al importar: ${String(error)}`],
      warnings: [],
    };
  }
}

/**
 * Verifica si ya existe una playlist con un nombre dado
 */
export async function playlistExists(name: string): Promise<boolean> {
  return invoke<boolean>("playlist_exists", { name });
}

/**
 * Crea un backup completo de la aplicacion en formato ZIP
 * Incluye la base de datos y todos los archivos de musica
 */
export async function createBackup(): Promise<string | null> {
  const filePath = await save({
    title: "Guardar backup como ZIP",
    defaultPath: `music-app-backup-${new Date().toISOString().split('T')[0]}.zip`,
    filters: [{ name: "Archivo ZIP", extensions: ["zip"] }],
  });

  if (!filePath) {
    return null;
  }

  try {
    const result = await invoke<string>("create_backup", { backupPath: filePath });
    return result;
  } catch (error) {
    throw new Error(`Error al crear backup: ${String(error)}`);
  }
}

/**
 * Selecciona un archivo de backup para restaurar
 */
export async function selectRestoreBackup(): Promise<string | null> {
  const filePath = await open({
    title: "Seleccionar archivo de backup",
    filters: [{ name: "Archivo ZIP", extensions: ["zip"] }],
    multiple: false,
  });

  if (!filePath || Array.isArray(filePath)) {
    return null;
  }

  return filePath as string;
}

/**
 * Selecciona la carpeta que contiene las colecciones de musica
 */
export async function selectMusicFolder(): Promise<string | null> {
  const folderPath = await open({
    title: "Seleccionar carpeta que contiene las colecciones de música",
    directory: true,
    multiple: false,
  });

  if (!folderPath || Array.isArray(folderPath)) {
    return null;
  }

  return folderPath as string;
}

/**
 * Restaura un backup completo
 * @param backupPath - Ruta al archivo ZIP de backup
 * @param musicFolderPath - Ruta opcional a la carpeta que contiene las colecciones de musica
 * @returns Resultado de la restauracion
 */
export async function restoreBackup(
  backupPath: string,
  musicFolderPath?: string
): Promise<RestoreResult> {
  try {
    const result = await invoke<RestoreResult>("restore_backup", {
      backupPath,
      musicFolderPath: musicFolderPath || null,
    });
    return result;
  } catch (error) {
    return {
      databaseRestored: false,
      errors: [`Error al restaurar: ${String(error)}`],
      warnings: [],
    };
  }
}

/**
 * Actualiza las rutas de música en la base de datos actual
 * @param musicFolderPath - Ruta a la nueva carpeta que contiene las colecciones de música
 * @returns Resultado con advertencias o errores
 */
export async function updateMusicPaths(
  musicFolderPath: string
): Promise<RestoreResult> {
  try {
    const result = await invoke<RestoreResult>("update_music_paths", {
      musicFolderPath,
    });
    return result;
  } catch (error) {
    return {
      databaseRestored: false,
      errors: [`Error al actualizar rutas: ${String(error)}`],
      warnings: [],
    };
  }
}
