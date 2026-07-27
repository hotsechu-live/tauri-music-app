import { invoke } from "@tauri-apps/api/core";

export async function initDatabase() {
  return invoke("init_database");
}

export async function selectMusicFolder(): Promise<string | null> {
  return invoke<string | null>("select_music_folder");
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

export async function createPlaylist(name: string, description: string | null = null) {
  return invoke<number>("create_playlist", { name, description });
}

export async function updatePlaylist(playlistId: number, name: string, description: string | null = null) {
  return invoke<string>("update_playlist", { playlistId, name, description });
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

export async function listPlaylists() {
  return invoke<any[]>("list_playlists");
}

export async function listPlaylistSongs(playlistId: number) {
  return invoke<any[]>("list_playlist_songs", { playlistId });
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
