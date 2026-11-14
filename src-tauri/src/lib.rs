use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};

use chrono::Utc;
use lofty::{Accessor, AudioFile, Probe, TaggedFileExt};
use regex::Regex;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{command, AppHandle, Emitter, Manager};
use walkdir::WalkDir;

#[cfg(target_os = "windows")]
use windows::{
    core::HSTRING,
    Foundation::{TimeSpan, TypedEventHandler},
    Media::{Core::MediaSource, Playback::MediaPlayer},
    Storage::StorageFile,
};

#[cfg(target_os = "windows")]
struct NativeAudioPlayer {
    player: Mutex<MediaPlayer>,
}

#[cfg(target_os = "windows")]
impl NativeAudioPlayer {
    fn new(app_handle: AppHandle) -> Result<Self, String> {
        let player = MediaPlayer::new()
            .map_err(|error| format!("No se pudo iniciar el reproductor de Windows: {error}"))?;
        player
            .MediaEnded(&TypedEventHandler::new(move |_, _| {
                let _ = app_handle.emit("native-audio-ended", ());
                Ok(())
            }))
            .map_err(|error| {
                format!("No se pudo configurar el fin de la reproducción: {error}")
            })?;
        Ok(Self {
            player: Mutex::new(player),
        })
    }

    fn play(&self, file_path: &str) -> Result<(), String> {
        let storage_file = StorageFile::GetFileFromPathAsync(&HSTRING::from(file_path))
            .and_then(|operation| operation.get())
            .map_err(|error| format!("Windows no pudo abrir el archivo de audio: {error}"))?;
        let source = MediaSource::CreateFromStorageFile(&storage_file)
            .map_err(|error| format!("Windows no pudo crear la fuente de audio: {error}"))?;
        let player = self.player.lock().map_err(|_| "El reproductor está ocupado.".to_string())?;
        player
            .SetSource(&source)
            .and_then(|_| player.Play())
            .map_err(|error| format!("Windows no pudo reproducir el archivo: {error}"))
    }

    fn pause(&self) -> Result<(), String> {
        self.player
            .lock()
            .map_err(|_| "El reproductor está ocupado.".to_string())?
            .Pause()
            .map_err(|error| format!("No se pudo pausar la reproducción: {error}"))
    }

    fn resume(&self) -> Result<(), String> {
        self.player
            .lock()
            .map_err(|_| "El reproductor está ocupado.".to_string())?
            .Play()
            .map_err(|error| format!("No se pudo reanudar la reproducción: {error}"))
    }

    fn stop(&self) -> Result<(), String> {
        self.pause()
    }

    fn seek(&self, seconds: f64) -> Result<(), String> {
        let position = TimeSpan {
            Duration: (seconds.max(0.0) * 10_000_000.0) as i64,
        };
        self.player
            .lock()
            .map_err(|_| "El reproductor estÃ¡ ocupado.".to_string())?
            .PlaybackSession()
            .and_then(|session| session.SetPosition(position))
            .map_err(|error| format!("No se pudo cambiar la posiciÃ³n de reproducciÃ³n: {error}"))
    }

    fn set_volume(&self, volume: f64) -> Result<(), String> {
        self.player
            .lock()
            .map_err(|_| "El reproductor está ocupado.".to_string())?
            .SetVolume(volume.clamp(0.0, 1.0))
            .map_err(|error| format!("No se pudo cambiar el volumen: {error}"))
    }
}

#[cfg(target_os = "linux")]
use gstreamer as gst;
#[cfg(target_os = "linux")]
use gst::prelude::*;

#[cfg(target_os = "linux")]
struct NativeAudioPlayer {
    player: Mutex<gst::Element>,
}

#[cfg(target_os = "linux")]
impl NativeAudioPlayer {
    fn new(app_handle: AppHandle) -> Result<Self, String> {
        gst::init().map_err(|error| format!("No se pudo iniciar GStreamer: {error}"))?;
        let player = gst::ElementFactory::make("playbin")
            .build()
            .map_err(|error| format!("No se pudo crear el reproductor de GStreamer: {error}"))?;
        let bus = player
            .bus()
            .ok_or_else(|| "GStreamer no pudo crear el bus de mensajes.".to_string())?;

        std::thread::Builder::new()
            .name("gstreamer-audio-events".to_string())
            .spawn(move || {
                for message in bus.iter_timed(gst::ClockTime::NONE) {
                    match message.view() {
                        gst::MessageView::Eos(..) => {
                            let _ = app_handle.emit("native-audio-ended", ());
                        }
                        gst::MessageView::Error(error) => {
                            let details = error
                                .debug()
                                .map(|debug| format!(" ({debug})"))
                                .unwrap_or_default();
                            let _ = app_handle.emit(
                                "native-audio-error",
                                format!("Error de GStreamer: {}{details}", error.error()),
                            );
                        }
                        _ => {}
                    }
                }
            })
            .map_err(|error| format!("No se pudo iniciar la escucha de GStreamer: {error}"))?;

        Ok(Self {
            player: Mutex::new(player),
        })
    }

    fn play(&self, file_path: &str) -> Result<(), String> {
        let uri = gst::glib::filename_to_uri(file_path, None)
            .map_err(|error| format!("La ruta del archivo no es válida: {error}"))?;
        let player = self
            .player
            .lock()
            .map_err(|_| "El reproductor está ocupado.".to_string())?;
        player
            .set_state(gst::State::Null)
            .map_err(|error| format!("GStreamer no pudo detener la pista anterior: {error}"))?;
        player.set_property("uri", uri.as_str());
        player
            .set_state(gst::State::Playing)
            .map_err(|error| format!("GStreamer no pudo reproducir el archivo: {error}"))?;
        Ok(())
    }

    fn pause(&self) -> Result<(), String> {
        self.set_state(gst::State::Paused, "pausar")
    }

    fn resume(&self) -> Result<(), String> {
        self.set_state(gst::State::Playing, "reanudar")
    }

    fn stop(&self) -> Result<(), String> {
        self.set_state(gst::State::Null, "detener")
    }

    fn seek(&self, seconds: f64) -> Result<(), String> {
        let position = gst::ClockTime::from_nseconds((seconds.max(0.0) * 1_000_000_000.0) as u64);
        self.player
            .lock()
            .map_err(|_| "El reproductor está ocupado.".to_string())?
            .seek_simple(gst::SeekFlags::FLUSH | gst::SeekFlags::KEY_UNIT, position)
            .map_err(|error| format!("No se pudo cambiar la posición de reproducción: {error}"))
    }

    fn set_volume(&self, volume: f64) -> Result<(), String> {
        self.player
            .lock()
            .map_err(|_| "El reproductor está ocupado.".to_string())?
            .set_property("volume", volume.clamp(0.0, 1.0));
        Ok(())
    }

    fn set_state(&self, state: gst::State, action: &str) -> Result<(), String> {
        self.player
            .lock()
            .map_err(|_| "El reproductor está ocupado.".to_string())?
            .set_state(state)
            .map(|_| ())
            .map_err(|error| format!("GStreamer no pudo {action} la reproducción: {error}"))
    }
}

#[derive(Debug, Serialize)]
struct SongRecord {
    id: i64,
    collection_id: i64,
    collection_name: String,
    title: String,
    artist: String,
    album: String,
    genre: String,
    year: String,
    duration_seconds: Option<i64>,
    format: String,
    file_size: Option<i64>,
    file_path: String,
    consigna: String,
    custom_metadata: Vec<CustomMetadataRecord>,
}

#[derive(Debug, Serialize)]
struct PlaylistRecord {
    id: i64,
    name: String,
    description: Option<String>,
    group: Option<String>,
    description_extended: Option<String>,
    purpose: Option<String>,
    tags: Option<String>,
    comment: Option<String>,
    created_at: String,
    duration: String,
}

#[derive(Debug, Serialize)]
struct CustomMetadataRecord {
    key: String,
    value: String,
}

#[derive(Debug, Serialize)]
struct CollectionRecord {
    id: i64,
    name: String,
    folder_path: String,
    created_at: String,
}

static DATABASE_PATH: OnceLock<PathBuf> = OnceLock::new();

fn configure_database_path(app_handle: &AppHandle) -> Result<(), String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("No se pudo obtener el directorio de datos: {error}"))?;
    fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("No se pudo crear el directorio de datos: {error}"))?;

    let database_path = app_data_dir.join("music_app.sqlite");

    // Preserve databases created by versions that stored the file in the
    // process working directory. The old file is intentionally left intact.
    if !database_path.exists() {
        if let Ok(legacy_path) = std::env::current_dir().map(|path| path.join("music_app.sqlite")) {
            if legacy_path.is_file() && legacy_path != database_path {
                fs::copy(&legacy_path, &database_path).map_err(|error| {
                    format!(
                        "No se pudo migrar la base de datos desde {}: {error}",
                        legacy_path.display()
                    )
                })?;
            }
        }
    }

    DATABASE_PATH
        .set(database_path)
        .map_err(|_| "La ruta de la base de datos ya estaba configurada".to_string())
}

fn db_path() -> Result<&'static PathBuf> {
    DATABASE_PATH
        .get()
        .ok_or_else(|| rusqlite::Error::InvalidPath(PathBuf::from("database path not configured")))
}

fn normalize_metadata_key(key: &str) -> String {
    key.trim().to_lowercase()
}

fn open_connection() -> Result<Connection> {
    let path = db_path()?;
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        DROP TABLE IF EXISTS collection_analysis;
        DROP TABLE IF EXISTS playlist_custom_metadata;
        DROP TABLE IF EXISTS app_settings;

        CREATE TABLE IF NOT EXISTS collections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            folder_path TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            collection_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            artist TEXT NOT NULL DEFAULT '',
            album TEXT NOT NULL DEFAULT '',
            genre TEXT NOT NULL DEFAULT '',
            year TEXT NOT NULL DEFAULT '',
            duration_seconds INTEGER,
            format TEXT NOT NULL,
            file_size INTEGER,
            file_path TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL,
            FOREIGN KEY(collection_id) REFERENCES collections(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT,
            "group" TEXT,
            description_extended TEXT,
            purpose TEXT,
            tags TEXT,
            comment TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS playlist_songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            song_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
            consigna TEXT NOT NULL DEFAULT '',
            UNIQUE(playlist_id, song_id),
            FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS song_custom_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            song_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE,
            UNIQUE(song_id, key)
        );

        CREATE TABLE IF NOT EXISTS custom_metadata_definitions (
            key TEXT PRIMARY KEY
        );

        CREATE INDEX IF NOT EXISTS idx_songs_collection_id ON songs(collection_id);
        CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist_id ON playlist_songs(playlist_id, position);
        "#,
    )?;

    conn.execute(
        "INSERT OR IGNORE INTO custom_metadata_definitions (key)
         SELECT DISTINCT key FROM song_custom_metadata",
        [],
    )?;
    conn.execute(
        "INSERT OR IGNORE INTO song_custom_metadata (song_id, key, value)
         SELECT s.id, d.key, '' FROM songs s CROSS JOIN custom_metadata_definitions d",
        [],
    )?;

    ensure_playlist_columns(&conn)?;
    ensure_playlist_song_columns(&conn)?;
    Ok(())
}

fn ensure_playlist_song_columns(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info('playlist_songs')")?;
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get(1))?
        .collect::<Result<_, _>>()?;

    if !columns.contains(&"consigna".to_string()) {
        conn.execute(
            "ALTER TABLE playlist_songs ADD COLUMN consigna TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    Ok(())
}

fn ensure_playlist_columns(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare("PRAGMA table_info('playlists')")?;
    let columns: Vec<String> = stmt
        .query_map([], |row| row.get(1))?
        .collect::<Result<_, _>>()?;

    if !columns.contains(&"description_extended".to_string()) {
        conn.execute("ALTER TABLE playlists ADD COLUMN description_extended TEXT", [])?;
    }
    if !columns.contains(&"group".to_string()) {
        conn.execute("ALTER TABLE playlists ADD COLUMN \"group\" TEXT", [])?;
    }
    if !columns.contains(&"purpose".to_string()) {
        conn.execute("ALTER TABLE playlists ADD COLUMN purpose TEXT", [])?;
    }
    if !columns.contains(&"tags".to_string()) {
        conn.execute("ALTER TABLE playlists ADD COLUMN tags TEXT", [])?;
    }
    if !columns.contains(&"comment".to_string()) {
        conn.execute("ALTER TABLE playlists ADD COLUMN comment TEXT", [])?;
    }

    Ok(())
}

fn allow_registered_collection_folders(app_handle: &AppHandle) -> Result<(), String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT folder_path FROM collections")
        .map_err(|e| e.to_string())?;
    let folders = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for folder in folders {
        app_handle
            .asset_protocol_scope()
            .allow_directory(folder, true)
            .map_err(|e| format!("No se pudo autorizar la carpeta de música: {e}"))?;
    }

    Ok(())
}

#[command]
fn init_database() -> Result<String, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

#[command]
fn play_native_audio(
    player: tauri::State<'_, NativeAudioPlayer>,
    file_path: String,
) -> Result<String, String> {
    player.play(&file_path)?;
    Ok("ok".to_string())
}

#[command]
fn pause_native_audio(player: tauri::State<'_, NativeAudioPlayer>) -> Result<String, String> {
    player.pause()?;
    Ok("ok".to_string())
}

#[command]
fn resume_native_audio(player: tauri::State<'_, NativeAudioPlayer>) -> Result<String, String> {
    player.resume()?;
    Ok("ok".to_string())
}

#[command]
fn stop_native_audio(player: tauri::State<'_, NativeAudioPlayer>) -> Result<String, String> {
    player.stop()?;
    Ok("ok".to_string())
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
#[tauri::command]
fn seek_native_audio(
    player: tauri::State<'_, NativeAudioPlayer>,
    seconds: f64,
) -> Result<String, String> {
    player.seek(seconds)?;
    Ok("PosiciÃ³n de reproducciÃ³n actualizada".to_string())
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
#[tauri::command]
fn set_native_audio_volume(
    player: tauri::State<'_, NativeAudioPlayer>,
    volume: f64,
) -> Result<String, String> {
    player.set_volume(volume)?;
    Ok("Volumen actualizado".to_string())
}

// Estructuras para importación/exportación de playlists
#[derive(Debug, Serialize, Deserialize)]
struct ExportedPlaylist {
    version: u32,
    exported_at: Option<String>,
    playlist: ExportedPlaylistData,
    songs: Vec<ExportedSong>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ExportedPlaylistData {
    name: String,
    description: Option<String>,
    group: Option<String>,
    description_extended: Option<String>,
    purpose: Option<String>,
    tags: Option<String>,
    comment: Option<String>,
    created_at: String,
    duration: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct ExportedSong {
    title: String,
    artist: String,
    album: Option<String>,
    genre: Option<String>,
    year: Option<String>,
    duration_seconds: Option<i64>,
    format: Option<String>,
    file_size: Option<i64>,
    collection_name: String,
    consigna: Option<String>,
    file_hash_sha256: Option<String>,
    custom_metadata: Option<HashMap<String, String>>,
}

#[derive(Debug, Serialize)]
struct PlaylistImportResult {
    #[serde(rename = "playlistId")]
    playlist_id: Option<i64>,
    #[serde(rename = "totalSongs")]
    total_songs: usize,
    #[serde(rename = "matchedSongs")]
    matched_songs: usize,
    #[serde(rename = "unmatchedSongs")]
    unmatched_songs: usize,
    errors: Vec<String>,
    warnings: Vec<String>,
}

/// Calcula el hash SHA-256 de un archivo
fn calculate_file_hash(file_path: &str) -> Result<String, String> {
    let path = PathBuf::from(file_path);
    if !path.exists() {
        return Err(format!("El archivo no existe: {}", file_path));
    }

    let mut file = std::fs::File::open(&path)
        .map_err(|e| format!("No se pudo abrir el archivo para calcular hash: {}", e))?;

    let mut hasher = Sha256::new();
    let mut buffer = [0; 8192];
    loop {
        let bytes_read = file.read(&mut buffer)
            .map_err(|e| format!("Error al leer el archivo para hash: {}", e))?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// Encuentra una canción en la base de datos que coincida con la canción exportada
/// Devuelve el ID de la canción o None si no se encuentra coincidencia
fn find_matching_song_id(conn: &Connection, exported_song: &ExportedSong) -> Result<Option<i64>, String> {
    // Buscar canciones por nombre de colección, título, artista y duración
    let query = 
        "SELECT s.id FROM songs s JOIN collections c ON c.id = s.collection_id WHERE c.name = ?1 AND s.title = ?2";

    let mut stmt = conn
        .prepare(query)
        .map_err(|e| format!("Error al preparar consulta de matching: {}", e))?;

    let rows = stmt
        .query_map(
            params![
                exported_song.collection_name.clone(),
                exported_song.title.clone()
            ],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|e| format!("Error al ejecutar consulta de matching: {}", e))?;

    let mut candidate_ids: Vec<i64> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("Error al recolectar resultados: {}", e))?;

    // Si hay exactamente una coincidencia, devolverla
    if candidate_ids.len() == 1 {
        return Ok(Some(candidate_ids[0]));
    }

    // Si hay múltiples coincidencias, intentar filtrar por artista y duración
    if candidate_ids.len() > 1 {
        let mut filtered_ids: Vec<i64> = Vec::new();
        for &id in &candidate_ids {
            let song_artist: String = conn
                .query_row(
                    "SELECT artist FROM songs WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Error al obtener artista: {}", e))?;

            let song_duration: Option<i64> = conn
                .query_row(
                    "SELECT duration_seconds FROM songs WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .map_err(|e| format!("Error al obtener duración: {}", e))?;

            let artist_match = exported_song.artist == song_artist;
            let duration_match = match (exported_song.duration_seconds, song_duration) {
                (Some(exp_dur), Some(song_dur)) => {
                    (exp_dur - song_dur).abs() <= 1 // Tolerancia de 1 segundo
                }
                _ => true, // Si no hay duración, considerarlo match
            };

            if artist_match && duration_match {
                filtered_ids.push(id);
            }
        }

        if filtered_ids.len() == 1 {
            return Ok(Some(filtered_ids[0]));
        }

        // Si aún hay múltiples, devolver la primera
        if !filtered_ids.is_empty() {
            return Ok(Some(filtered_ids[0]));
        }
    }

    // Si no hay coincidencias por nombre de colección y título, intentar solo por título
    if candidate_ids.is_empty() {
        let query = "SELECT s.id FROM songs s WHERE s.title = ?1";
        let mut stmt = conn
            .prepare(query)
            .map_err(|e| format!("Error al preparar consulta por título: {}", e))?;

        let rows = stmt
            .query_map(params![exported_song.title.clone()], |row| row.get::<_, i64>(0))
            .map_err(|e| format!("Error al ejecutar consulta por título: {}", e))?;

        candidate_ids = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("Error al recolectar resultados por título: {}", e))?;

        if candidate_ids.len() == 1 {
            return Ok(Some(candidate_ids[0]));
        }
    }

    Ok(None)
}

/// Genera un nombre único para una playlist verificando que no exista en la base de datos
fn generate_unique_playlist_name(conn: &Connection, original_name: &str) -> Result<String, String> {
    let mut candidate_name = original_name.to_string();
    let mut counter = 1;

    loop {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM playlists WHERE name = ?1",
                params![candidate_name.clone()],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;

        if count == 0 {
            return Ok(candidate_name);
        }

        // Si el nombre ya existe, añadir sufijo
        counter += 1;
        candidate_name = format!("{} ({})", original_name, counter);
    }
}

/// Importa una playlist desde datos JSON exportados
#[command]
fn import_playlist(
    app_handle: AppHandle,
    export_data: String,
    target_group: Option<String>,
) -> Result<PlaylistImportResult, String> {
    let exported: ExportedPlaylist = serde_json::from_str(&export_data)
        .map_err(|e| format!("Error al parsear JSON de exportación: {}", e))?;

    // Validar versión
    if exported.version != 1 {
        return Err(format!("Versión de exportación no soportada: {}", exported.version));
    }

    let conn = open_connection().map_err(|e| e.to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;

    let playlist_data = exported.playlist;
    let songs = exported.songs;
    let total_songs = songs.len();

    let mut matched_songs = 0;
    let mut warnings = Vec::new();

    // Crear la nueva playlist
    let created_at = Utc::now().to_rfc3339();
    let group = target_group.or(playlist_data.group);

    // Generar un nombre único para la playlist (evitar conflictos con nombres existentes)
    let playlist_name = generate_unique_playlist_name(&conn, &playlist_data.name)?;

    conn.execute(
        "INSERT INTO playlists (name, description, \"group\", description_extended, purpose, tags, comment, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            playlist_name,
            playlist_data.description,
            group,
            playlist_data.description_extended,
            playlist_data.purpose,
            playlist_data.tags,
            playlist_data.comment,
            created_at
        ],
    )
    .map_err(|e| e.to_string())?;

    let playlist_id = conn.last_insert_rowid();

    // Agregar advertencia si el nombre original ya existía
    if playlist_name != playlist_data.name {
        warnings.push(format!(
            "El nombre de la sesión '{}' ya existía. Se importó como '{}'",
            playlist_data.name, playlist_name
        ));
    }

    // Procesar cada canción
    let mut song_mapping: Vec<(usize, i64, String)> = Vec::new(); // (índice, song_id, consigna)

    for (index, exported_song) in songs.iter().enumerate() {
        match find_matching_song_id(&conn, exported_song)? {
            Some(song_id) => {
                // Añadir la canción a la playlist
                let position = (index as i64) + 1;
                let consigna = exported_song.consigna.clone().unwrap_or_default();

                conn.execute(
                    "INSERT INTO playlist_songs (playlist_id, song_id, position, consigna) VALUES (?1, ?2, ?3, ?4)",
                    params![playlist_id, song_id, position, consigna],
                )
                .map_err(|e| {
                    warnings.push(format!(
                        "Error al añadir canción '{}' a la playlist: {}",
                        exported_song.title, e
                    ));
                    format!("Error al añadir canción: {}", e)
                })?;

                song_mapping.push((index, song_id, consigna));
                matched_songs += 1;
            }
            None => {
                warnings.push(format!(
                    "No se encontró coincidencia para la canción '{}' (Colección: {})",
                    exported_song.title, exported_song.collection_name
                ));
            }
        }
    }

    // Autorizar acceso a los archivos de audio de la nueva playlist
    allow_registered_collection_folders(&app_handle)
        .map_err(|e| format!("No se pudo autorizar carpetas: {}", e))?;

    Ok(PlaylistImportResult {
        playlist_id: Some(playlist_id),
        total_songs,
        matched_songs,
        unmatched_songs: total_songs - matched_songs,
        errors: Vec::new(),
        warnings,
    })
}

/// Exporta una playlist como archivo JSON
/// Esta función se usa para guardar el archivo de exportación en disco
#[command]
fn export_playlist_file(file_path: String, contents: String) -> Result<String, String> {
    let path = PathBuf::from(&file_path);

    // Validar extensión
    if path.extension().and_then(|ext| ext.to_str()) != Some("json") {
        return Err("El archivo de destino debe tener extensión .json".to_string());
    }

    fs::write(&path, contents)
        .map_err(|error| format!("No se pudo guardar el archivo de exportación: {}", error))?;

    Ok(path.to_string_lossy().into_owned())
}

/// Verifica si existe una playlist con el mismo nombre
#[command]
fn playlist_exists(name: String) -> Result<bool, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;

    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM playlists WHERE name = ?1",
            params![name],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(count > 0)
}

/// Lee el contenido de un archivo de texto
#[command]
fn read_text_file(file_path: String) -> Result<String, String> {
    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(format!("El archivo no existe: {}", file_path));
    }

    let contents = fs::read_to_string(&path)
        .map_err(|error| format!("No se pudo leer el archivo: {}", error))?;

    Ok(contents)
}

fn normalize_collection_folder_path(folder_path: &str) -> String {
    let trimmed = folder_path.trim();
    let without_extended_prefix = trimmed.strip_prefix(r"\\?\").unwrap_or(trimmed);
    let mut normalized = without_extended_prefix.replace('\\', "/");

    if normalized.len() > 3 && normalized.ends_with('/') {
        normalized.pop();
    }

    #[cfg(windows)]
    {
        normalized = normalized.to_lowercase();
    }

    normalized
}

fn find_collection_id_by_folder_path(
    conn: &Connection,
    folder_path: &str,
) -> Result<Option<i64>, rusqlite::Error> {
    let normalized_folder_path = normalize_collection_folder_path(folder_path);
    let mut stmt = conn.prepare("SELECT id, folder_path FROM collections")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
    })?;

    for row in rows {
        let (collection_id, stored_folder_path) = row?;
        if normalize_collection_folder_path(&stored_folder_path) == normalized_folder_path {
            return Ok(Some(collection_id));
        }
    }

    Ok(None)
}

fn normalize_imported_genre(genre: &str) -> String {
    static UNWANTED_GENRE_TEXT: OnceLock<Regex> = OnceLock::new();
    static UNWANTED_HD_PREFIX: OnceLock<Regex> = OnceLock::new();
    static UNWANTED_HD_SUFFIX: OnceLock<Regex> = OnceLock::new();
    static STANDALONE_YA_PREFIX: OnceLock<Regex> = OnceLock::new();
    static STANDALONE_YA_SUFFIX: OnceLock<Regex> = OnceLock::new();

    let cleaned = UNWANTED_GENRE_TEXT
        .get_or_init(|| {
            Regex::new(concat!(
                r"(?:-[ \t]*|[ \t]+)?(?:",
                r"Elenco[ \t]+Ya![ \t]+5\.0[ \t]+CIMEB[ \t]+2012",
                r"|Ya![ \t]+5\.0[ \t]+CIMEB[ \t]+2012",
                r"|Ya![ \t]+5\.0[ \t]+CIMEB[ \t]+AE[ \t]+2018",
                r"|Ya![ \t]+5\.0[ \t]+R[ \t]+Toro[ \t]+2009",
                r")",
            ))
            .expect("La expresión de limpieza del género debe ser válida")
        })
        .replace_all(genre, "");
    let cleaned = UNWANTED_HD_PREFIX
        .get_or_init(|| {
            Regex::new(concat!(
                r"^[ \t]*(?:",
                r"Ya![ \t]+5\.0[ \t]+R[ \t]+Compartida[ \t]+HD",
                r"|Ya![ \t]+5\.0[ \t]+Compartida[ \t]+HD",
                r"|Ya![ \t]+5\.0[ \t]+Experimental[ \t]+HD",
                r"|Ya![ \t]+4\.5[ \t]+Experimental[ \t]+HD",
                r"|Ya![ \t]+3\.9[ \t]+Experimental[ \t]+\(nueva\)",
                r"|5[ \t]+\.0[ \t]+Experimental[ \t]+HD",
                r"|Ya![ \t]+Compartida[ \t]+HD",
                r"|Ya![ \t]+5\.0[ \t]+Compartida",
                r"|Ya!",
                r")",
            ))
            .expect("La expresión de limpieza del prefijo HD debe ser válida")
        })
        .replace(&cleaned, "");
    let cleaned = UNWANTED_HD_SUFFIX
        .get_or_init(|| {
            Regex::new(concat!(
                r"(?:-[ \t]*|[ \t]+)?(?:",
                r"Ya![ \t]+5\.0[ \t]+R[ \t]+Compartida[ \t]+HD",
                r"|Ya![ \t]+5\.0[ \t]+Compartida[ \t]+HD",
                r"|Ya![ \t]+5\.0[ \t]+Experimental[ \t]+HD",
                r"|Ya![ \t]+4\.5[ \t]+Experimental[ \t]+HD",
                r"|Ya![ \t]+3\.9[ \t]+Experimental[ \t]+\(nueva\)",
                r"|5[ \t]+\.0[ \t]+Experimental[ \t]+HD",
                r"|Ya![ \t]+Compartida[ \t]+HD",
                r"|Ya![ \t]+5\.0[ \t]+Compartida",
                r"|Ya!",
                r")[ \t]*$",
            ))
            .expect("La expresión de limpieza del sufijo HD debe ser válida")
        })
        .replace(&cleaned, "");
    let cleaned = STANDALONE_YA_PREFIX
        .get_or_init(|| {
            Regex::new(r"^\s*Ya!\s*")
                .expect("La expresión de limpieza del prefijo Ya! debe ser válida")
        })
        .replace(&cleaned, "");
    let cleaned = STANDALONE_YA_SUFFIX
        .get_or_init(|| {
            Regex::new(r"\s*Ya!\s*$")
                .expect("La expresión de limpieza del sufijo Ya! debe ser válida")
        })
        .replace(&cleaned, "");
    let cleaned = cleaned.trim();

    cleaned
        .strip_suffix(" -")
        .unwrap_or(cleaned)
        .trim_end()
        .to_string()
}

#[command]
fn import_collection(
    app_handle: AppHandle,
    folder_path: String,
    collection_name: String,
) -> Result<serde_json::Value, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;

    let normalized_folder_path = normalize_collection_folder_path(
        &fs::canonicalize(&folder_path)
            .unwrap_or_else(|_| PathBuf::from(&folder_path))
            .to_string_lossy()
            .to_string(),
    );

    if find_collection_id_by_folder_path(&conn, &normalized_folder_path)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("No se puede importar dos veces la misma carpeta de música.".to_string());
    }

    let created_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO collections (name, folder_path, created_at) VALUES (?1, ?2, ?3)",
        params![collection_name, normalized_folder_path, created_at],
    )
    .map_err(|e| e.to_string())?;

    let collection_id: i64 = conn
        .query_row(
            "SELECT id FROM collections WHERE name = ?1 AND folder_path = ?2",
            params![collection_name, normalized_folder_path],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut imported = 0usize;
    for entry in WalkDir::new(&folder_path).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_lowercase();
        if !matches!(ext.as_str(), "mp3" | "flac" | "ogg" | "wav" | "m4a" | "aac" | "opus") {
            continue;
        }

        let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
        let track = Probe::open(path)
            .and_then(|probe| probe.read())
            .ok();

        let title = track
            .as_ref()
            .and_then(|file| file.primary_tag().or_else(|| file.first_tag()))
            .and_then(|tag| tag.title())
            .map(|s| s.to_string())
            .unwrap_or_else(|| path.file_stem().unwrap_or_default().to_string_lossy().to_string());

        let artist = track
            .as_ref()
            .and_then(|file| file.primary_tag().or_else(|| file.first_tag()))
            .and_then(|tag| tag.artist())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let album = track
            .as_ref()
            .and_then(|file| file.primary_tag().or_else(|| file.first_tag()))
            .and_then(|tag| tag.album())
            .map(|s| s.to_string())
            .unwrap_or_default();

        let genre = track
            .as_ref()
            .and_then(|file| file.primary_tag().or_else(|| file.first_tag()))
            .and_then(|tag| tag.genre())
            .map(|genre| normalize_imported_genre(&genre))
            .unwrap_or_default();

        let year = track
            .as_ref()
            .and_then(|file| file.primary_tag().or_else(|| file.first_tag()))
            .and_then(|tag| tag.year())
            .map(|year| year.to_string())
            .unwrap_or_default();

        let duration_seconds: Option<i64> = track
            .as_ref()
            .map(|file| file.properties().duration().as_secs())
            .filter(|secs| *secs > 0)
            .map(|secs| secs as i64);

        let format = ext.to_uppercase();
        let file_size: Option<i64> = Some(metadata.len().try_into().unwrap_or_default());
        let file_path = path.to_string_lossy().to_string();

        conn.execute(
            "INSERT OR IGNORE INTO songs (collection_id, title, artist, album, genre, year, duration_seconds, format, file_size, file_path, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![collection_id, title, artist, album, genre, year, duration_seconds, format, file_size, file_path, created_at],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT OR IGNORE INTO song_custom_metadata (song_id, key, value)
             SELECT s.id, d.key, '' FROM songs s
             CROSS JOIN custom_metadata_definitions d
             WHERE s.file_path = ?1",
            params![file_path],
        )
        .map_err(|e| e.to_string())?;

        imported += 1;
    }

    app_handle
        .asset_protocol_scope()
        .allow_directory(&folder_path, true)
        .map_err(|e| format!("No se pudo autorizar la carpeta de música: {e}"))?;

    Ok(serde_json::json!({ "imported": imported, "collection_id": collection_id }))
}

fn map_song_row(row: &rusqlite::Row) -> rusqlite::Result<SongRecord> {
    Ok(SongRecord {
        id: row.get(0)?,
        collection_id: row.get(1)?,
        collection_name: row.get(2)?,
        title: row.get(3)?,
        artist: row.get(4)?,
        album: row.get(5)?,
        genre: row.get(6)?,
        year: row.get(7)?,
        duration_seconds: row.get(8)?,
        format: row.get(9)?,
        file_size: row.get(10)?,
        file_path: row.get(11)?,
        consigna: String::new(),
        custom_metadata: Vec::new(),
    })
}

fn attach_custom_metadata(conn: &Connection, songs: &mut [SongRecord]) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT key, value FROM song_custom_metadata WHERE song_id = ?1 ORDER BY key")
        .map_err(|e| e.to_string())?;

    for song in songs {
        let rows = stmt
            .query_map(params![song.id], |row| {
                Ok(CustomMetadataRecord {
                    key: row.get(0)?,
                    value: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        song.custom_metadata = rows
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[command]
fn list_songs(collection_id: Option<i64>) -> Result<Vec<SongRecord>, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let query = if collection_id.is_some() {
        "SELECT s.id, s.collection_id, c.name, s.title, s.artist, s.album, s.genre, s.year, s.duration_seconds, s.format, s.file_size, s.file_path FROM songs s JOIN collections c ON c.id = s.collection_id WHERE s.collection_id = ?1 ORDER BY s.title"
    } else {
        "SELECT s.id, s.collection_id, c.name, s.title, s.artist, s.album, s.genre, s.year, s.duration_seconds, s.format, s.file_size, s.file_path FROM songs s JOIN collections c ON c.id = s.collection_id ORDER BY s.title"
    };
    let mut stmt = conn.prepare(query).map_err(|e| e.to_string())?;
    let rows = if let Some(collection_id) = collection_id {
        stmt.query_map(params![collection_id], map_song_row)
    } else {
        stmt.query_map([], map_song_row)
    }
    .map_err(|e| e.to_string())?;

    let mut songs = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    attach_custom_metadata(&conn, &mut songs)?;
    Ok(songs)
}

#[command]
fn list_collections() -> Result<Vec<CollectionRecord>, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, folder_path, created_at FROM collections ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(CollectionRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                folder_path: row.get(2)?,
                created_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[command]
fn rename_collection(collection_id: i64, new_name: String) -> Result<String, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE collections SET name = ?1 WHERE id = ?2",
        params![new_name, collection_id],
    )
    .map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

#[command]
fn delete_collection(collection_id: i64) -> Result<String, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM collections WHERE id = ?1",
        params![collection_id],
    )
    .map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

#[command]
fn create_playlist(name: String, description: Option<String>, group: Option<String>) -> Result<i64, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    let created_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO playlists (name, description, \"group\", created_at) VALUES (?1, ?2, ?3, ?4)",
        params![name, description, group, created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[command]
fn update_playlist(
    playlist_id: i64,
    name: String,
    description: Option<String>,
    group: Option<String>,
    description_extended: Option<String>,
    purpose: Option<String>,
    tags: Option<String>,
    comment: Option<String>,
) -> Result<String, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE playlists SET name = ?1, description = ?2, \"group\" = ?3, description_extended = ?4, purpose = ?5, tags = ?6, comment = ?7 WHERE id = ?8",
        params![name, description, group, description_extended, purpose, tags, comment, playlist_id],
    )
    .map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

#[command]
fn delete_playlist(playlist_id: i64) -> Result<String, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM playlists WHERE id = ?1", params![playlist_id])
        .map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

#[command]
fn add_song_to_playlist(playlist_id: i64, song_id: i64) -> Result<String, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT COUNT(*) FROM playlist_songs WHERE playlist_id = ?1 AND song_id = ?2")
        .map_err(|e| e.to_string())?;
    let count: i64 = stmt
        .query_row(params![playlist_id, song_id], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if count > 0 {
        return Ok("already_exists".to_string());
    }

    let position: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_songs WHERE playlist_id = ?1",
            params![playlist_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO playlist_songs (playlist_id, song_id, position, consigna) VALUES (?1, ?2, ?3, '')",
        params![playlist_id, song_id, position],
    )
    .map_err(|e| e.to_string())?;

    Ok("ok".to_string())
}

#[command]
fn remove_song_from_playlist(playlist_id: i64, song_id: i64) -> Result<String, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM playlist_songs WHERE playlist_id = ?1 AND song_id = ?2",
        params![playlist_id, song_id],
    )
    .map_err(|e| e.to_string())?;

    let rows: Vec<(i64, i64)> = conn
        .prepare("SELECT id, song_id FROM playlist_songs WHERE playlist_id = ?1 ORDER BY position, id")
        .map_err(|e| e.to_string())?
        .query_map(params![playlist_id], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for (index, (_, song_id)) in rows.into_iter().enumerate() {
        conn.execute(
            "UPDATE playlist_songs SET position = ?1 WHERE playlist_id = ?2 AND song_id = ?3",
            params![(index as i64) + 1, playlist_id, song_id],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok("ok".to_string())
}

#[command]
fn reorder_playlist_songs(playlist_id: i64, song_order: Vec<i64>) -> Result<String, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    for (index, song_id) in song_order.iter().enumerate() {
        conn.execute(
            "UPDATE playlist_songs SET position = ?1 WHERE playlist_id = ?2 AND song_id = ?3",
            params![(index as i64) + 1, playlist_id, song_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok("ok".to_string())
}

#[command]
fn update_playlist_song_consigna(
    playlist_id: i64,
    song_id: i64,
    consigna: String,
) -> Result<String, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let updated = conn
        .execute(
            "UPDATE playlist_songs SET consigna = ?1 WHERE playlist_id = ?2 AND song_id = ?3",
            params![consigna, playlist_id, song_id],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("La canción ya no pertenece a esta lista.".to_string());
    }
    Ok("ok".to_string())
}

#[command]
fn list_song_custom_metadata(song_id: i64) -> Result<Vec<CustomMetadataRecord>, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key, value FROM song_custom_metadata WHERE song_id = ?1 ORDER BY key")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![song_id], |row| {
            Ok(CustomMetadataRecord {
                key: row.get(0)?,
                value: row.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[command]
fn update_song_metadata(
    song_id: i64,
    title: String,
    artist: String,
    album: String,
    genre: String,
    year: String,
) -> Result<String, String> {
    if title.trim().is_empty() {
        return Err("El título no puede estar vacío".to_string());
    }

    let conn = open_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE songs SET title = ?1, artist = ?2, album = ?3, genre = ?4, year = ?5 WHERE id = ?6",
        params![title.trim(), artist.trim(), album.trim(), genre.trim(), year.trim(), song_id],
    )
    .map_err(|e| e.to_string())?;

    Ok("ok".to_string())
}

#[command]
fn set_song_custom_metadata(song_id: i64, key: String, value: String) -> Result<String, String> {
    let normalized_key = normalize_metadata_key(&key);
    if normalized_key.is_empty() {
        return Err("La clave del metadato no puede estar vacía".to_string());
    }

    let mut conn = open_connection().map_err(|e| e.to_string())?;
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    transaction.execute(
        "INSERT OR IGNORE INTO custom_metadata_definitions (key) VALUES (?1)",
        params![normalized_key],
    )
    .map_err(|e| e.to_string())?;
    transaction.execute(
        "INSERT OR IGNORE INTO song_custom_metadata (song_id, key, value)
         SELECT id, ?1, '' FROM songs",
        params![normalized_key],
    )
    .map_err(|e| e.to_string())?;
    transaction.execute(
        "INSERT INTO song_custom_metadata (song_id, key, value) VALUES (?1, ?2, ?3) ON CONFLICT(song_id, key) DO UPDATE SET value = excluded.value",
        params![song_id, normalized_key, value],
    )
    .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;

    Ok("ok".to_string())
}

#[command]
fn delete_song_custom_metadata(song_id: i64, key: String) -> Result<String, String> {
    let normalized_key = normalize_metadata_key(&key);
    let conn = open_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE song_custom_metadata SET value = '' WHERE song_id = ?1 AND key = ?2",
        params![song_id, normalized_key],
    )
    .map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

#[command]
fn list_playlists() -> Result<Vec<PlaylistRecord>, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT p.id,
                    p.name,
                    p.description,
                    p.\"group\",
                    p.description_extended,
                    p.purpose,
                    p.tags,
                    p.comment,
                    p.created_at,
                    printf('%02d:%02d:%02d',
                        COALESCE(SUM(COALESCE(s.duration_seconds, 0)), 0) / 3600,
                        (COALESCE(SUM(COALESCE(s.duration_seconds, 0)), 0) / 60) % 60,
                        COALESCE(SUM(COALESCE(s.duration_seconds, 0)), 0) % 60
                    ) as duration
             FROM playlists p
             LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
             LEFT JOIN songs s ON ps.song_id = s.id
             GROUP BY p.id
             ORDER BY p.name",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PlaylistRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
                group: row.get(3)?,
                description_extended: row.get(4)?,
                purpose: row.get(5)?,
                tags: row.get(6)?,
                comment: row.get(7)?,
                created_at: row.get(8)?,
                duration: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[command]
fn list_playlist_songs(playlist_id: i64) -> Result<Vec<SongRecord>, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT s.id, s.collection_id, c.name, s.title, s.artist, s.album, s.genre, s.year, s.duration_seconds, s.format, s.file_size, s.file_path, ps.consigna FROM playlist_songs ps JOIN songs s ON s.id = ps.song_id JOIN collections c ON c.id = s.collection_id WHERE ps.playlist_id = ?1 ORDER BY ps.position"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![playlist_id], |row| {
        Ok(SongRecord {
            id: row.get(0)?,
            collection_id: row.get(1)?,
            collection_name: row.get(2)?,
            title: row.get(3)?,
            artist: row.get(4)?,
            album: row.get(5)?,
            genre: row.get(6)?,
            year: row.get(7)?,
            duration_seconds: row.get(8)?,
            format: row.get(9)?,
            file_size: row.get(10)?,
            file_path: row.get(11)?,
            consigna: row.get(12)?,
            custom_metadata: Vec::new(),
        })
    }).map_err(|e| e.to_string())?;

    let mut songs = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    attach_custom_metadata(&conn, &mut songs)?;
    Ok(songs)
}

#[command]
fn write_pdf_file(file_path: String, contents: Vec<u8>) -> Result<String, String> {
    let path = PathBuf::from(&file_path);
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("pdf"))
        != Some(true)
    {
        return Err("El archivo de destino debe tener extensión .pdf.".to_string());
    }
    fs::write(&path, contents).map_err(|error| format!("No se pudo guardar el PDF: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[command]
fn write_odf_file(file_path: String, contents: Vec<u8>) -> Result<String, String> {
    let path = PathBuf::from(&file_path);
    if path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("odt"))
        != Some(true)
    {
        return Err("El archivo de destino debe tener extensión .odt.".to_string());
    }
    fs::write(&path, contents)
        .map_err(|error| format!("No se pudo guardar el documento ODF: {error}"))?;
    Ok(path.to_string_lossy().into_owned())
}

#[command]
fn list_custom_metadata_definitions() -> Result<Vec<String>, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT key FROM custom_metadata_definitions ORDER BY key")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[command]
fn create_custom_metadata_definition(key: String) -> Result<String, String> {
    let normalized_key = normalize_metadata_key(&key);
    if normalized_key.is_empty() {
        return Err("El nombre del metadato no puede estar vacío".to_string());
    }
    let mut conn = open_connection().map_err(|e| e.to_string())?;
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    let inserted = transaction
        .execute(
            "INSERT OR IGNORE INTO custom_metadata_definitions (key) VALUES (?1)",
            params![normalized_key],
        )
        .map_err(|e| e.to_string())?;
    if inserted == 0 {
        return Err("Ya existe un metadato con ese nombre".to_string());
    }
    transaction
        .execute(
            "INSERT INTO song_custom_metadata (song_id, key, value)
             SELECT id, ?1, '' FROM songs",
            params![normalized_key],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

#[command]
fn rename_custom_metadata_definition(old_key: String, new_key: String) -> Result<String, String> {
    let old_key = normalize_metadata_key(&old_key);
    let new_key = normalize_metadata_key(&new_key);
    if new_key.is_empty() {
        return Err("El nombre del metadato no puede estar vacío".to_string());
    }
    if old_key == new_key {
        return Ok("ok".to_string());
    }
    let mut conn = open_connection().map_err(|e| e.to_string())?;
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    let exists: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM custom_metadata_definitions WHERE key = ?1",
            params![new_key],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if exists > 0 {
        return Err("Ya existe un metadato con ese nombre".to_string());
    }
    let updated = transaction
        .execute(
            "UPDATE custom_metadata_definitions SET key = ?1 WHERE key = ?2",
            params![new_key, old_key],
        )
        .map_err(|e| e.to_string())?;
    if updated == 0 {
        return Err("No se ha encontrado el metadato".to_string());
    }
    transaction
        .execute(
            "UPDATE song_custom_metadata SET key = ?1 WHERE key = ?2",
            params![new_key, old_key],
        )
        .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

#[command]
fn delete_custom_metadata_definition(key: String) -> Result<String, String> {
    let normalized_key = normalize_metadata_key(&key);
    let mut conn = open_connection().map_err(|e| e.to_string())?;
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    transaction.execute(
        "DELETE FROM song_custom_metadata WHERE key = ?1",
        params![normalized_key],
    )
    .map_err(|e| e.to_string())?;
    transaction.execute(
        "DELETE FROM custom_metadata_definitions WHERE key = ?1",
        params![normalized_key],
    )
    .map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok("ok".to_string())
}

// ==================== BACKUP/RESTORE FUNCTIONS ====================

use zip::write::FileOptions;
use zip::ZipWriter;

/// Estructura para backup (solo metadatos, sin archivos de musica)
#[derive(Debug, Serialize, Deserialize, Clone)]
struct BackupManifest {
    version: u32,
    created_at: String,
    app_version: String,
    database_hash: String,
}

/// Estructura para resultado de restore
#[derive(Debug, Serialize)]
struct RestoreResult {
    database_restored: bool,
    errors: Vec<String>,
    warnings: Vec<String>,
}

/// Crea un backup de la base de datos en formato ZIP
/// Solo guarda la base de datos, NO los archivos de musica
#[command]
fn create_backup(backup_path: String) -> Result<String, String> {
    // 1. Crear directorio temporal
    let temp_dir = tempfile::tempdir().map_err(|e| format!("No se pudo crear directorio temporal: {}", e))?;
    let temp_path = temp_dir.path();

    // 2. Crear directorio para la base de datos
    let db_temp_dir = temp_path.join("database");
    fs::create_dir_all(&db_temp_dir).map_err(|e| format!("No se pudo crear directorio database: {}", e))?;

    // 3. Copiar base de datos
    let db_src_path = db_path().map_err(|e| format!("Error al obtener ruta de BD: {}", e))?;
    let db_dest_path = db_temp_dir.join("music_app.sqlite");
    fs::copy(db_src_path, &db_dest_path).map_err(|e| format!("No se pudo copiar la base de datos: {}", e))?;

    // 4. Calcular hash de la BD
    let db_hash = calculate_file_hash(db_dest_path.to_str().unwrap())?;

    // 5. Crear manifest.json
    let manifest = BackupManifest {
        version: 1,
        created_at: Utc::now().to_rfc3339(),
        app_version: "1.0".to_string(),
        database_hash: db_hash,
    };

    let manifest_content = serde_json::to_string_pretty(&manifest)
        .map_err(|e| format!("Error al serializar manifest: {}", e))?;
    let manifest_path = temp_path.join("manifest.json");
    fs::write(&manifest_path, manifest_content)
        .map_err(|e| format!("No se pudo escribir manifest.json: {}", e))?;

    // 6. Crear archivo ZIP
    let zip_dest_path = PathBuf::from(&backup_path);
    create_zip_file(&temp_path, &zip_dest_path)?;

    // El directorio temporal se borra automaticamente al salir de scope

    Ok(zip_dest_path.to_string_lossy().into_owned())
}

/// Crea un archivo ZIP a partir de un directorio
fn create_zip_file(src_dir: &Path, dst_path: &Path) -> Result<(), String> {
    let zip_file = fs::File::create(dst_path)
        .map_err(|e| format!("No se pudo crear archivo ZIP: {}", e))?;

    let mut zip = ZipWriter::new(zip_file);
    let options = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let walker = WalkDir::new(src_dir).into_iter();
    for entry in walker {
        let entry = entry.map_err(|e| format!("Error al leer entrada: {}", e))?;
        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let relative_path = path
            .strip_prefix(src_dir)
            .map_err(|e| format!("No se pudo obtener ruta relativa: {}", e))?;

        let mut file = fs::File::open(path)
            .map_err(|e| format!("No se pudo abrir {}: {}", relative_path.display(), e))?;

        zip.start_file(
            relative_path.to_str().ok_or_else(|| "Invalid UTF-8 path".to_string())?,
            options,
        )
        .map_err(|e| format!("No se pudo anadir {} al ZIP: {}", relative_path.display(), e))?;

        let _ = std::io::copy(&mut file, &mut zip)
            .map_err(|e| format!("Error al copiar {}: {}", relative_path.display(), e))?;
    }

    zip.finish()
        .map_err(|e| format!("Error al finalizar ZIP: {}", e))?;

    Ok(())
}

/// Restaura un backup desde archivo ZIP
/// Solo restaura la base de datos, NO copia archivos de musica
/// Si se proporciona music_folder_path, actualiza las rutas de colecciones y canciones a esa ubicacion
#[command]
fn restore_backup(backup_path: String, music_folder_path: Option<String>) -> Result<RestoreResult, String> {
    let mut result = RestoreResult {
        database_restored: false,
        errors: Vec::new(),
        warnings: Vec::new(),
    };

    // 1. Crear directorio temporal para extraer
    let temp_dir = tempfile::tempdir().map_err(|e| format!("No se pudo crear directorio temporal: {}", e))?;
    let temp_path = temp_dir.path();

    // 2. Extraer archivo ZIP
    extract_zip_file(&backup_path, temp_path)?;

    // 3. Leer y validar manifest.json
    let manifest_path = temp_path.join("manifest.json");
    if !manifest_path.exists() {
        return Err("Archivo de backup invalido: falta manifest.json".to_string());
    }

    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("No se pudo leer manifest.json: {}", e))?;

    let _manifest: BackupManifest = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("Error al parsear manifest.json: {}", e))?;

    // 4. Validar version
    if _manifest.version != 1 {
        return Err(format!("Version de backup no soportada: {}", _manifest.version));
    }

    // 5. Restaurar base de datos
    let backup_db_path = temp_path.join("database/music_app.sqlite");
    if backup_db_path.exists() {
        let db_dest = db_path().map_err(|e| format!("Error al obtener ruta de BD: {}", e))?;

        // Hacer backup de la BD actual por seguridad
        if db_dest.exists() {
            let backup_current = db_dest.with_extension("backup");
            if let Err(e) = fs::copy(db_dest, &backup_current) {
                result.warnings.push(format!(
                    "No se pudo hacer backup de la BD actual: {}",
                    e
                ));
            } else {
                result.warnings.push(format!(
                    "Backup de la BD actual guardado en: {}",
                    backup_current.display()
                ));
            }
        }

        // Copiar BD del backup
        fs::copy(&backup_db_path, db_dest)
            .map_err(|e| format!("No se pudo restaurar la base de datos: {}", e))?;
        result.database_restored = true;

        // 6. Si se proporciona una carpeta de musica, actualizar rutas en la BD
        if let Some(music_folder) = music_folder_path {
            update_database_paths(&music_folder).map_err(|e| {
                result.warnings.push(format!("Advertencia al actualizar rutas: {}", e));
                e
            })?;
        }
    } else {
        result.errors.push("No se encontro base de datos en el backup".to_string());
    }

    Ok(result)
}

/// Actualiza las rutas de colecciones y canciones en la base de datos a una nueva ubicacion base
fn update_database_paths(music_folder: &str) -> Result<(), String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let music_folder_normalized = normalize_collection_folder_path(music_folder);

    // Obtener todas las colecciones actuales con sus rutas originales
    let mut stmt = conn
        .prepare("SELECT id, name, folder_path FROM collections")
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    }).map_err(|e| e.to_string())?;

    for row in rows {
        let (collection_id, collection_name, old_folder_path) = row.map_err(|e| e.to_string())?;
        let old_folder_norm_for_cmp = normalize_path_for_comparison(&old_folder_path);

        // Calcular la ruta relativa de la coleccion respecto a la carpeta original
        // Si la coleccion ya estaba en una subcarpeta, mantenerla
        let relative_path = if old_folder_norm_for_cmp.len() > music_folder_normalized.len() {
            // Intenta obtener la parte relativa
            let stripped = old_folder_norm_for_cmp.strip_prefix(&music_folder_normalized)
                .map(|s| s.trim_start_matches('/').to_string())
                .unwrap_or_else(|| collection_name.clone());
            if stripped.is_empty() {
                collection_name.clone()
            } else {
                stripped
            }
        } else {
            // Si la carpeta original no contiene la nueva carpeta, usar el nombre de la coleccion
            collection_name.clone()
        };

        // Nueva ruta: music_folder + relative_path
        let new_folder_path = PathBuf::from(&music_folder_normalized).join(&relative_path);
        let new_folder_normalized = normalize_collection_folder_path(&new_folder_path.to_string_lossy());

        // Actualizar la coleccion
        conn.execute(
            "UPDATE collections SET folder_path = ?1 WHERE id = ?2",
            params![new_folder_normalized, collection_id],
        ).map_err(|e| e.to_string())?;

        // Actualizar las canciones de esta coleccion
        let mut song_stmt = conn.prepare("SELECT id, file_path FROM songs WHERE collection_id = ?1")
            .map_err(|e| e.to_string())?;
        
        let song_rows = song_stmt.query_map([collection_id], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        }).map_err(|e| e.to_string())?;

        for song_row in song_rows {
            let (song_id, old_file_path) = song_row.map_err(|e| e.to_string())?;
            let old_file_normalized = normalize_path_for_comparison(&old_file_path);

            // Obtener la ruta relativa del archivo dentro de la coleccion
            let file_relative = if old_file_normalized.starts_with(&old_folder_norm_for_cmp) {
                old_file_normalized.strip_prefix(&old_folder_norm_for_cmp)
                    .unwrap_or("")
                    .trim_start_matches('/')
                    .to_string()
            } else {
                // Si el archivo no esta en la carpeta de la coleccion, mantener la ruta
                // Pero debemos clonar porque old_file_path se mueve
                old_file_path.clone()
            };

            // Nueva ruta del archivo
            let new_file_path = if !file_relative.is_empty() && file_relative != old_file_path {
                PathBuf::from(&new_folder_normalized).join(&file_relative)
            } else {
                PathBuf::from(&old_file_path)
            };

            let new_file_normalized = normalize_path_for_comparison(&new_file_path.to_string_lossy());

            conn.execute(
                "UPDATE songs SET file_path = ?1 WHERE id = ?2",
                params![new_file_normalized, song_id],
            ).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

/// Normaliza una ruta para comparaciones multiplataforma
fn normalize_path_for_comparison(path: &str) -> String {
    let trimmed = path.trim();
    let without_extended_prefix = trimmed.strip_prefix(r"\\?\").unwrap_or(trimmed);
    let mut normalized = without_extended_prefix.replace('\\', "/");

    // En Windows, convertir a minusculas para comparacion
    #[cfg(windows)]
    {
        normalized = normalized.to_lowercase();
    }

    // Eliminar trailing slash
    while normalized.ends_with('/') && normalized.len() > 1 {
        normalized.pop();
    }

    normalized
}

/// Extrae un archivo ZIP
fn extract_zip_file(zip_path: &str, target_dir: &Path) -> Result<(), String> {
    use zip::ZipArchive;

    let zip_file = fs::File::open(zip_path)
        .map_err(|e| format!("No se pudo abrir archivo ZIP: {}", e))?;

    let mut archive = ZipArchive::new(zip_file)
        .map_err(|e| format!("Error al leer archivo ZIP: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Error al leer entrada {} en ZIP: {}", i, e))?;
        let outpath = target_dir.join(file.name());

        // Evitar directorios ..
        if file.name().starts_with('/') || file.name().contains("../") {
            continue;
        }

        if file.name().ends_with('/') {
            // Entrada de directorio
            if !outpath.exists() {
                fs::create_dir_all(&outpath)
                    .map_err(|e| format!("No se pudo crear directorio {}: {}", outpath.display(), e))?;
            }
            continue;
        }

        // Crear directorios padre
        if let Some(parent) = outpath.parent() {
            if !parent.exists() {
                fs::create_dir_all(parent)
                    .map_err(|e| format!("No se pudo crear directorio {}: {}", parent.display(), e))?;
            }
        }

        // Extraer archivo
        let mut outfile = fs::File::create(&outpath)
            .map_err(|e| format!("No se pudo crear {}: {}", outpath.display(), e))?;

        let _ = std::io::copy(&mut file, &mut outfile)
            .map_err(|e| format!("Error al extraer {}: {}", outpath.display(), e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        find_collection_id_by_folder_path, normalize_imported_genre, normalize_metadata_key,
    };
    #[cfg(windows)]
    use super::normalize_collection_folder_path;
    use rusqlite::{params, Connection};

    #[test]
    fn normalize_metadata_key_trims_and_lowercases() {
        assert_eq!(normalize_metadata_key("  Comment  "), "comment");
    }

    #[cfg(windows)]
    #[test]
    fn normalize_collection_folder_path_strips_windows_extended_prefix() {
        assert_eq!(
            normalize_collection_folder_path(r"\\?\C:\Users\hotse\Music"),
            "c:/users/hotse/music"
        );
    }

    #[test]
    fn normalize_imported_genre_removes_unwanted_texts_and_trims_result() {
        let cases = [
            ("Rock- Elenco Ya! 5.0 CIMEB 2012", "Rock"),
            ("Rock Elenco Ya! 5.0 CIMEB 2012", "Rock"),
            ("Rock Ya! 5.0 CIMEB AE 2018", "Rock"),
            ("Rock- Ya! 5.0 R Toro 2009", "Rock"),
            ("Rock Ya! 5.0 R Toro 2009", "Rock"),
        ];

        for (genre, expected) in cases {
            assert_eq!(normalize_imported_genre(genre), expected);
        }
    }

    #[test]
    fn normalize_imported_genre_removes_repeated_texts() {
        assert_eq!(
            normalize_imported_genre(
                "  Jazz Ya! 5.0 CIMEB AE 2018 Elenco Ya! 5.0 CIMEB 2012  "
            ),
            "Jazz"
        );
    }

    #[test]
    fn normalize_imported_genre_accepts_extra_blanks_in_elenco_text() {
        assert_eq!(
            normalize_imported_genre("Rock-   Elenco  Ya!\t5.0    CIMEB  2012"),
            "Rock"
        );
        assert_eq!(
            normalize_imported_genre("Rock    Elenco   Ya!  5.0 CIMEB     2012"),
            "Rock"
        );
    }

    #[test]
    fn normalize_imported_genre_removes_r_toro_text_at_the_start() {
        assert_eq!(
            normalize_imported_genre("Ya! 5.0 R Toro 2009 Rock"),
            "Rock"
        );
        assert_eq!(
            normalize_imported_genre("  Ya!  5.0   R Toro  2009 Jazz"),
            "Jazz"
        );
    }

    #[test]
    fn normalize_imported_genre_removes_cimeb_2012_without_elenco() {
        let cases = [
            ("Ya! 5.0 CIMEB 2012 Rock", "Rock"),
            ("Rock Ya!  5.0  CIMEB   2012", "Rock"),
            ("Rock-   Ya! 5.0 CIMEB 2012", "Rock"),
        ];

        for (genre, expected) in cases {
            assert_eq!(normalize_imported_genre(genre), expected);
        }
    }

    #[test]
    fn normalize_imported_genre_removes_hd_texts_at_the_edges() {
        let cases = [
            ("Ya! 5.0 Compartida HD Rock", "Rock"),
            ("Rock Ya! 5.0 Compartida HD", "Rock"),
            ("  Ya!  5.0 Experimental   HD  Jazz", "Jazz"),
            ("Jazz Ya!  5.0  Experimental HD  ", "Jazz"),
            ("Ya! 5.0 Compartida HD", ""),
        ];

        for (genre, expected) in cases {
            assert_eq!(normalize_imported_genre(genre), expected);
        }

        assert_eq!(
            normalize_imported_genre("Rock Ya! 5.0 Compartida HD Jazz"),
            "Rock Ya! 5.0 Compartida HD Jazz"
        );
    }

    #[test]
    fn normalize_imported_genre_removes_cimeb_ae_at_the_edges() {
        let cases = [
            ("Ya! 5.0 CIMEB AE 2018 Rock", "Rock"),
            ("Rock Ya! 5.0 CIMEB AE 2018", "Rock"),
            ("  Ya!  5.0 CIMEB   AE  2018  Jazz", "Jazz"),
            ("Jazz Ya! 5.0  CIMEB AE   2018  ", "Jazz"),
            ("Ya! 5.0 CIMEB AE 2018", ""),
        ];

        for (genre, expected) in cases {
            assert_eq!(normalize_imported_genre(genre), expected);
        }
    }

    #[test]
    fn normalize_imported_genre_removes_unwanted_text_when_attached() {
        let cases = [
            ("RockYa! 5.0 CIMEB 2012", "Rock"),
            ("Ya! 5.0 CIMEB AE 2018Rock", "Rock"),
            ("JazzYa! 5.0 R Toro 2009Fusion", "JazzFusion"),
            ("Ya! 5.0 Compartida HDRock", "Rock"),
            ("RockYa! 5.0 Experimental HD", "Rock"),
            ("Rock-Elenco Ya! 5.0 CIMEB 2012", "Rock"),
        ];

        for (genre, expected) in cases {
            assert_eq!(normalize_imported_genre(genre), expected);
        }
    }

    #[test]
    fn normalize_imported_genre_removes_additional_edge_texts() {
        let cases = [
            ("Ya! 4.5 Experimental HDRock", "Rock"),
            ("RockYa! 4.5 Experimental HD", "Rock"),
            ("5  .0 Experimental HDJazz", "Jazz"),
            ("Jazz5 .0 Experimental HD", "Jazz"),
            ("Ya! 5.0 CompartidaRock", "Rock"),
            ("RockYa! 5.0 Compartida", "Rock"),
            ("Ya! Compartida HDRock", "Rock"),
            ("RockYa! Compartida HD", "Rock"),
            ("Ya! 5.0 R Compartida HDRock", "Rock"),
            ("RockYa! 5.0 R Compartida HD", "Rock"),
        ];

        for (genre, expected) in cases {
            assert_eq!(normalize_imported_genre(genre), expected);
        }
    }

    #[test]
    fn normalize_imported_genre_removes_nueva_and_ya_at_the_edges() {
        let cases = [
            ("Ya! 3.9 Experimental (nueva)Rock", "Rock"),
            ("RockYa!  3.9  Experimental   (nueva)", "Rock"),
            ("Ya!Rock", "Rock"),
            ("RockYa!", "Rock"),
            ("Lullaby Ya!", "Lullaby"),
            ("Lullaby\u{00a0}Ya!\u{00a0}", "Lullaby"),
            ("Ya!", ""),
        ];

        for (genre, expected) in cases {
            assert_eq!(normalize_imported_genre(genre), expected);
        }
    }

    #[test]
    fn normalize_imported_genre_removes_dash_only_at_the_end() {
        assert_eq!(normalize_imported_genre("  Rock -  "), "Rock");
        assert_eq!(normalize_imported_genre("Rock - Alternativo"), "Rock - Alternativo");
    }

    #[test]
    fn find_collection_id_by_folder_path_detects_existing_folder() {
        let conn = Connection::open_in_memory().unwrap();
        super::init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO collections (name, folder_path, created_at) VALUES (?1, ?2, ?3)",
            params!["Mi colección", "C:/Music", "2026-01-01T00:00:00Z"],
        )
        .unwrap();

        let existing_id = find_collection_id_by_folder_path(&conn, "C:/Music").unwrap();
        assert_eq!(existing_id, Some(1));
    }

    #[cfg(windows)]
    #[test]
    fn find_collection_id_by_folder_path_matches_backslashes_and_case_variations() {
        let conn = Connection::open_in_memory().unwrap();
        super::init_schema(&conn).unwrap();
        conn.execute(
            "INSERT INTO collections (name, folder_path, created_at) VALUES (?1, ?2, ?3)",
            params!["Mi colección", r"C:\Users\Hotse\Music", "2026-01-01T00:00:00Z"],
        )
        .unwrap();

        let existing_id = find_collection_id_by_folder_path(&conn, "c:/users/hotse/music/").unwrap();
        assert_eq!(existing_id, Some(1));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            configure_database_path(app.handle())
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            let connection =
                open_connection().map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            init_schema(&connection)
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            allow_registered_collection_folders(app.handle())
                .map_err(|error| Box::<dyn std::error::Error>::from(error))?;
            app.manage(
                NativeAudioPlayer::new(app.handle().clone())
                    .map_err(Box::<dyn std::error::Error>::from)?,
            );
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init_database,
            play_native_audio,
            pause_native_audio,
            resume_native_audio,
            stop_native_audio,
            seek_native_audio,
            set_native_audio_volume,
            import_collection,
            list_songs,
            list_collections,
            rename_collection,
            delete_collection,
            create_playlist,
            update_playlist,
            delete_playlist,
            add_song_to_playlist,
            remove_song_from_playlist,
            reorder_playlist_songs,
            update_playlist_song_consigna,
            list_song_custom_metadata,
            update_song_metadata,
            set_song_custom_metadata,
            delete_song_custom_metadata,
            list_custom_metadata_definitions,
            create_custom_metadata_definition,
            rename_custom_metadata_definition,
            delete_custom_metadata_definition,
            list_playlists,
            list_playlist_songs,
            write_pdf_file,
            write_odf_file,
            import_playlist,
            export_playlist_file,
            playlist_exists,
            read_text_file,
            create_backup,
            restore_backup
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
