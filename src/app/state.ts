export type Song = {
  id: number;
  collection_id: number;
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
  custom_metadata: CustomMetadata[];
};

export type Playlist = {
  id: number;
  name: string;
  description: string | null;
  description_extended: string | null;
  purpose: string | null;
  tags: string | null;
  comment: string | null;
  created_at: string;
  duration: string;
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
export type AppView = "collections" | "songs" | "playlists" | "metadata";

export type AppState = {
  activeView: AppView;
  songs: Song[];
  playlists: Playlist[];
  collections: Collection[];
  customMetadataDefinitions: string[];
  selectedCollectionIds: number[];
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
  playlistEditorOpen: boolean;
  playlistEditorId: number | null;
  playlistEditorName: string;
  playlistEditorDescription: string | null;
  playlistEditorDescriptionExtended: string | null;
  playlistEditorPurpose: string | null;
  playlistEditorTags: string | null;
  playlistEditorComment: string | null;
  playlistEditorCreatedAt: string | null;
  playlistEditorDuration: string | null;
  playlistEditorMaximized: boolean;
  currentPlaybackTime: number;
  currentPlaybackDuration: number;
  playbackVolume: number;
  selectedSongMetadata: CustomMetadata[];
  metadataDraftKey: string;
  metadataDraftValue: string;
};

export const createInitialState = (): AppState => ({
  activeView: "songs",
  songs: [],
  playlists: [],
  collections: [],
  customMetadataDefinitions: [],
  selectedCollectionIds: [],
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
  playlistEditorOpen: false,
  playlistEditorId: null,
  playlistEditorName: "",
  playlistEditorDescription: null,
  playlistEditorDescriptionExtended: null,
  playlistEditorPurpose: null,
  playlistEditorTags: null,
  playlistEditorComment: null,
  playlistEditorCreatedAt: null,
  playlistEditorDuration: null,
  playlistEditorMaximized: false,
  playbackMode: "manual",
  playbackStatus: "stopped",
  currentPlaybackSongId: null,
  currentPlaybackTime: 0,
  currentPlaybackDuration: 0,
  playbackVolume: 1,
  selectedSongMetadata: [],
  metadataDraftKey: "",
  metadataDraftValue: "",
});
