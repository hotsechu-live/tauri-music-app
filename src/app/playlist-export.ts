import type { Playlist, Song } from "./state.js";

// Tipos para el formato de exportación
interface ExportedPlaylist {
  version: number;
  exported_at: string;
  playlist: {
    name: string;
    description: string | null;
    group: string | null;
    description_extended: string | null;
    purpose: string | null;
    tags: string | null;
    comment: string | null;
    created_at: string;
    duration: string;
  };
  songs: ExportedSong[];
}

interface ExportedSong {
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  duration_seconds: number | null;
  format: string;
  file_size: number | null;
  collection_name: string;
  consigna: string;
  // Campos opcionales para matching mejorado
  file_hash_sha256?: string;
  custom_metadata?: Record<string, string>;
}

/**
 * Formatea la duración en segundos a string HH:MM:SS
 */
function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "00:00:00";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${minutes}:${String(remaining).padStart(2, "0")}`;
}

/**
 * Genera el contenido JSON para exportar una playlist
 * Incluye información suficiente para recrear la sesión en otro equipo
 */
export function playlistExportBytes(playlist: Playlist, songs: Song[]): string {
  const exportedSongs: ExportedSong[] = songs.map((song) => {
    // Convertir custom_metadata array a objeto
    const customMetadata: Record<string, string> = {};
    for (const item of song.custom_metadata) {
      customMetadata[item.key] = item.value;
    }

    return {
      title: song.title,
      artist: song.artist,
      album: song.album,
      genre: song.genre,
      year: song.year,
      duration_seconds: song.duration_seconds,
      format: song.format,
      file_size: song.file_size,
      collection_name: song.collection_name,
      consigna: song.consigna,
      custom_metadata: Object.keys(customMetadata).length > 0 ? customMetadata : undefined,
      // Nota: file_hash_sha256 se calculará en el frontend usando Tauri
      // y se añadirá dinámicamente al exportar
    };
  });

  const exportedPlaylist: ExportedPlaylist = {
    version: 1,
    exported_at: new Date().toISOString(),
    playlist: {
      name: playlist.name,
      description: playlist.description,
      group: playlist.group,
      description_extended: playlist.description_extended,
      purpose: playlist.purpose,
      tags: playlist.tags,
      comment: playlist.comment,
      created_at: playlist.created_at,
      duration: formatDuration(
        songs.reduce((total, song) => total + (song.duration_seconds ?? 0), 0)
      ),
    },
    songs: exportedSongs,
  };

  return JSON.stringify(exportedPlaylist, null, 2);
}

/**
 * Genera el nombre de archivo para la exportación
 */
export function playlistExportFilename(name: string): string {
  const safeName = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  const date = new Date().toISOString().split("T")[0].replace(/:/g, "-");
  return `${safeName || "sesion"}-${date}.json`;
}

/**
 * Parse el contenido de un archivo de exportación
 */
export function parsePlaylistExport(content: string): ExportedPlaylist | null {
  try {
    const data = JSON.parse(content) as ExportedPlaylist;
    
    // Validar versión
    if (data.version !== 1) {
      console.warn(`Versión de exportación no soportada: ${data.version}`);
      return null;
    }
    
    // Validar estructura básica
    if (!data.playlist || !data.songs) {
      console.error("Estructura de exportación inválida");
      return null;
    }
    
    return data;
  } catch (error) {
    console.error("Error al parsear el archivo de exportación:", error);
    return null;
  }
}

/**
 * Filtra canciones para el matching por metadatos
 * Prioriza matching por:
 * 1. collection_name + title + artist + duration_seconds (exacto)
 * 2. collection_name + title + duration_seconds
 * 3. title + artist + duration_seconds
 */
export function findMatchingSong(
  exportedSong: ExportedSong,
  availableSongs: Song[]
): Song | null {
  const durationMatchThreshold = 1; // Tolerancia de 1 segundo

  // Intentar matching exacto primero
  for (const song of availableSongs) {
    const durationMatch = 
      exportedSong.duration_seconds != null &&
      song.duration_seconds != null &&
      Math.abs(exportedSong.duration_seconds - song.duration_seconds) <= durationMatchThreshold;

    const collectionMatch = 
      exportedSong.collection_name.toLowerCase() === song.collection_name.toLowerCase();

    const titleMatch = 
      exportedSong.title.toLowerCase() === song.title.toLowerCase();

    const artistMatch = 
      exportedSong.artist.toLowerCase() === song.artist.toLowerCase();

    // Matching perfecto
    if (collectionMatch && titleMatch && artistMatch && durationMatch) {
      return song;
    }
  }

  // Intentar matching sin artista (el artista puede variar)
  for (const song of availableSongs) {
    const durationMatch = 
      exportedSong.duration_seconds != null &&
      song.duration_seconds != null &&
      Math.abs(exportedSong.duration_seconds - song.duration_seconds) <= durationMatchThreshold;

    const collectionMatch = 
      exportedSong.collection_name.toLowerCase() === song.collection_name.toLowerCase();

    const titleMatch = 
      exportedSong.title.toLowerCase() === song.title.toLowerCase();

    if (collectionMatch && titleMatch && durationMatch) {
      return song;
    }
  }

  // Intentar matching solo por título y colección
  for (const song of availableSongs) {
    const collectionMatch = 
      exportedSong.collection_name.toLowerCase() === song.collection_name.toLowerCase();

    const titleMatch = 
      exportedSong.title.toLowerCase() === song.title.toLowerCase();

    if (collectionMatch && titleMatch) {
      return song;
    }
  }

  // Intentar matching por título y duración
  for (const song of availableSongs) {
    const durationMatch = 
      exportedSong.duration_seconds != null &&
      song.duration_seconds != null &&
      Math.abs(exportedSong.duration_seconds - song.duration_seconds) <= durationMatchThreshold;

    const titleMatch = 
      exportedSong.title.toLowerCase() === song.title.toLowerCase();

    if (titleMatch && durationMatch) {
      return song;
    }
  }

  // Intentar matching por título solo (último recurso)
  for (const song of availableSongs) {
    const titleMatch = 
      exportedSong.title.toLowerCase() === song.title.toLowerCase();

    if (titleMatch) {
      return song;
    }
  }

  return null;
}

/**
 * Tipo para representar el resultado de la importación
 */
export interface ImportResult {
  playlistId: number | null;
  totalSongs: number;
  matchedSongs: number;
  unmatchedSongs: number;
  errors: string[];
  warnings: string[];
}
