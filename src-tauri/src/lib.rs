use std::{fs, path::PathBuf};

use chrono::Utc;
use rusqlite::{params, Connection, Result};
use serde::Serialize;
use tauri::{command, AppHandle};
use tauri_plugin_dialog::DialogExt;
use walkdir::WalkDir;

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
}

#[derive(Debug, Serialize)]
struct PlaylistRecord {
    id: i64,
    name: String,
    description: Option<String>,
}

#[derive(Debug, Serialize)]
struct CollectionRecord {
    id: i64,
    name: String,
    folder_path: String,
    created_at: String,
}

fn db_path() -> PathBuf {
    let mut path = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    path.push("music_app.sqlite");
    path
}

fn open_connection() -> Result<Connection> {
    let path = db_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    Connection::open(path)
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
        "#,
    )?;

    Ok(())
}

#[command]
fn init_database() -> Result<String, String> {
    let conn = open_connection().map_err(|e| e.to_string())?;
    init_schema(&conn).map_err(|e| e.to_string())?;
    Ok("ok".to_string())
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
fn import_collection(folder_path: String, collection_name: String) -> Result<serde_json::Value, String> {
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
        let title = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let artist = "".to_string();
        let album = "".to_string();
        let genre = "".to_string();
        let year = "".to_string();
        let duration_seconds: Option<i64> = None;
        let format = ext.to_uppercase();
        let file_size: Option<i64> = Some(metadata.len().try_into().unwrap_or_default());
        let file_path = path.to_string_lossy().to_string();

        conn.execute(
            "INSERT OR IGNORE INTO songs (collection_id, title, artist, album, genre, year, duration_seconds, format, file_size, file_path, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![collection_id, title, artist, album, genre, year, duration_seconds, format, file_size, file_path, created_at],
        )
        .map_err(|e| e.to_string())?;

        imported += 1;
    }

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
    })
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

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
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
        })
    }).map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            init_database,
            select_music_folder,
            import_collection,
            list_songs,
            list_collections,
            create_playlist,
            add_song_to_playlist,
            list_playlists,
            list_playlist_songs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
