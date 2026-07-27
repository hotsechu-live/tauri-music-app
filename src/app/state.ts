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

export type AppState = {
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
};

export const createInitialState = (): AppState => ({
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
});
