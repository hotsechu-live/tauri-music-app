export type Song = {
  id: number;
  collection_name: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: string;
  duration_seconds: number | null;
  format: string;
  file_size: number | null;
  file_path: string;
};

export type Playlist = {
  id: number;
  name: string;
  description: string | null;
};

export type Collection = {
  id: number;
  name: string;
  folder_path: string;
  created_at: string;
};

export type CustomMetadata = {
  key: string;
  value: string;
};

export type PlaybackMode = "manual" | "sequential" | "shuffle";
export type PlaybackStatus = "stopped" | "playing" | "paused";
export type AppView = "collections" | "songs" | "playlists";

export type AppState = {
  activeView: AppView;
  songs: Song[];
  playlists: Playlist[];
  collections: Collection[];
  currentCollectionId: number | null;
  searchQuery: string;
  pendingSearchQuery: string;
  searchField: string;
  selectedFolder: string | null;
  status: string;
  error: string | null;
  selectedPlaylistId: number | null;
  playlistSongs: Song[];
  selectedSongId: number | null;
  playbackQueue: Song[];
  playbackIndex: number;
  playbackPlaylistId: number | null;
  playbackMode: PlaybackMode;
  playbackStatus: PlaybackStatus;
  currentPlaybackSongId: number | null;
  currentPlaybackTime: number;
  currentPlaybackDuration: number;
  selectedSongMetadata: CustomMetadata[];
  metadataDraftKey: string;
  metadataDraftValue: string;
};

export const createInitialState = (): AppState => ({
  activeView: "songs",
  songs: [],
  playlists: [],
  collections: [],
  currentCollectionId: null,
  searchQuery: "",
  pendingSearchQuery: "",
  searchField: "",
  selectedFolder: null,
  status: "idle",
  error: null,
  selectedPlaylistId: null,
  playlistSongs: [],
  selectedSongId: null,
  playbackQueue: [],
  playbackIndex: 0,
  playbackPlaylistId: null,
  playbackMode: "manual",
  playbackStatus: "stopped",
  currentPlaybackSongId: null,
  currentPlaybackTime: 0,
  currentPlaybackDuration: 0,
  selectedSongMetadata: [],
  metadataDraftKey: "",
  metadataDraftValue: "",
});
