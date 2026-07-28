use std::{
    fs,
    path::PathBuf,
    sync::{Mutex, OnceLock},
};

use chrono::Utc;
use lofty::{Accessor, AudioFile, Probe, TaggedFileExt};
use rusqlite::{params, Connection, Result};
use serde::Serialize;
use tauri::{command, AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
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
}

#[derive(Debug, Serialize)]
struct SongRecord {
    id: i64,
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
    custom_metadata: Vec<CustomMetadataRecord>,
}

#[derive(Debug, Serialize)]
struct PlaylistRecord {
    id: i64,
    name: String,
    description: Option<String>,
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
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS playlist_songs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            song_id INTEGER NOT NULL,
            position INTEGER NOT NULL,
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

        CREATE TABLE IF NOT EXISTS playlist_custom_metadata (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL,
            FOREIGN KEY(playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
            UNIQUE(playlist_id, key)
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_songs_collection_id ON songs(collection_id);
        CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist_id ON playlist_songs(playlist_id, position);
        "#,
    )?;

    conn.execute(
        "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?1, ?2)",
        params!["default_playback_mode", "manual"],
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

    Ok(())
}

/// Makes the audio files of registered collections available to the Tauri
/// asset protocol. The frontend can then load them in an HTML audio element
/// without gaining access to unrelated folders on the machine.
fn allow_registered_collection_folders(app_handle: &AppHandle) -> Result<(), String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let mut statement = conn
        .prepare("SELECT folder_path FROM collections")
        .map_err(|e| e.to_string())?;
    let folders = statement
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

#[cfg(target_os = "windows")]
#[tauri::command]
fn seek_native_audio(
    player: tauri::State<'_, NativeAudioPlayer>,
    seconds: f64,
) -> Result<String, String> {
    player.seek(seconds)?;
    Ok("PosiciÃ³n de reproducciÃ³n actualizada".to_string())
}

#[command]
fn select_music_folder(app_handle: AppHandle) -> Result<Option<String>, String> {
    let dialog = app_handle
        .dialog()
        .file()
        .set_title("Selecciona una carpeta de música")
        .blocking_pick_folder();

    match dialog {
        Some(path) => match path.into_path() {
            Ok(path_buf) => Ok(Some(path_buf.to_string_lossy().to_string())),
            Err(_) => Err("No se pudo convertir la ruta de la carpeta seleccionada.".to_string()),
        },
        None => Ok(None),
    }
}

#[command]
fn import_collection(
    app_handle: AppHandle,
    folder_path: String,
    collection_name: String,
) -> Result<serde_json::Value, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;

    let created_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT OR IGNORE INTO collections (name, folder_path, created_at) VALUES (?1, ?2, ?3)",
        params![collection_name, folder_path, created_at],
    )
    .map_err(|e| e.to_string())?;

    let collection_id: i64 = conn
        .query_row(
            "SELECT id FROM collections WHERE name = ?1 AND folder_path = ?2",
            params![collection_name, folder_path],
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
            .map(|s| s.to_string())
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
        collection_name: row.get(1)?,
        title: row.get(2)?,
        artist: row.get(3)?,
        album: row.get(4)?,
        genre: row.get(5)?,
        year: row.get(6)?,
        duration_seconds: row.get(7)?,
        format: row.get(8)?,
        file_size: row.get(9)?,
        file_path: row.get(10)?,
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
        "SELECT s.id, c.name, s.title, s.artist, s.album, s.genre, s.year, s.duration_seconds, s.format, s.file_size, s.file_path FROM songs s JOIN collections c ON c.id = s.collection_id WHERE s.collection_id = ?1 ORDER BY s.title"
    } else {
        "SELECT s.id, c.name, s.title, s.artist, s.album, s.genre, s.year, s.duration_seconds, s.format, s.file_size, s.file_path FROM songs s JOIN collections c ON c.id = s.collection_id ORDER BY s.title"
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
fn create_playlist(name: String, description: Option<String>) -> Result<i64, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    let created_at = Utc::now().to_rfc3339();
    conn.execute(
        "INSERT INTO playlists (name, description, created_at) VALUES (?1, ?2, ?3)",
        params![name, description, created_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[command]
fn update_playlist(playlist_id: i64, name: String, description: Option<String>) -> Result<String, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE playlists SET name = ?1, description = ?2 WHERE id = ?3",
        params![name, description, playlist_id],
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
        "INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES (?1, ?2, ?3)",
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
        .prepare("SELECT id, name, description FROM playlists ORDER BY name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(PlaylistRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                description: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[command]
fn list_playlist_songs(playlist_id: i64) -> Result<Vec<SongRecord>, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT s.id, c.name, s.title, s.artist, s.album, s.genre, s.year, s.duration_seconds, s.format, s.file_size, s.file_path FROM playlist_songs ps JOIN songs s ON s.id = ps.song_id JOIN collections c ON c.id = s.collection_id WHERE ps.playlist_id = ?1 ORDER BY ps.position"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![playlist_id], |row| {
        Ok(SongRecord {
            id: row.get(0)?,
            collection_name: row.get(1)?,
            title: row.get(2)?,
            artist: row.get(3)?,
            album: row.get(4)?,
            genre: row.get(5)?,
            year: row.get(6)?,
            duration_seconds: row.get(7)?,
            format: row.get(8)?,
            file_size: row.get(9)?,
            file_path: row.get(10)?,
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

#[cfg(test)]
mod tests {
    use super::normalize_metadata_key;

    #[test]
    fn normalize_metadata_key_trims_and_lowercases() {
        assert_eq!(normalize_metadata_key("  Comment  "), "comment");
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
            select_music_folder,
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
            list_song_custom_metadata,
            update_song_metadata,
            set_song_custom_metadata,
            delete_song_custom_metadata,
            list_custom_metadata_definitions,
            create_custom_metadata_definition,
            rename_custom_metadata_definition,
            delete_custom_metadata_definition,
            list_playlists,
            list_playlist_songs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
