use rusqlite::Connection;
use std::path::PathBuf;

fn main() {
    let mut path = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    path.push("music_app.sqlite");
    let path = if path.exists() { path } else { PathBuf::from("music_app.sqlite") };
    println!("db path: {}", path.display());
    let conn = match Connection::open(&path) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("failed open db: {}", e);
            std::process::exit(1);
        }
    };
    for tbl in ["collections", "songs", "playlists", "playlist_songs"] {
        let cnt: i64 = conn
            .query_row(&format!("SELECT COUNT(*) FROM {}", tbl), [], |row| row.get(0))
            .unwrap_or(-1);
        println!("{} count: {}", tbl, cnt);
    }
    println!("collections:");
    let mut stmt = conn.prepare("SELECT id,name,folder_path,created_at FROM collections").unwrap();
    let mut rows = stmt.query([]).unwrap();
    while let Some(row) = rows.next().unwrap() {
        let id: i64 = row.get(0).unwrap();
        let name: String = row.get(1).unwrap();
        let folder_path: String = row.get(2).unwrap();
        let created_at: String = row.get(3).unwrap();
        println!("{} | {} | {} | {}", id, name, folder_path, created_at);
    }
    println!("songs sample:");
    let mut stmt = conn.prepare("SELECT id,collection_id,title,format,file_path FROM songs LIMIT 20").unwrap();
    let mut rows = stmt.query([]).unwrap();
    while let Some(row) = rows.next().unwrap() {
        let id: i64 = row.get(0).unwrap();
        let collection_id: i64 = row.get(1).unwrap();
        let title: String = row.get(2).unwrap();
        let format: String = row.get(3).unwrap();
        let file_path: String = row.get(4).unwrap();
        println!("{} | {} | {} | {} | {}", id, collection_id, title, format, file_path);
    }
}
