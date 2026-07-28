import type { Song } from "./state.js";

const SPANISH_ARTICLES = new Set(["el", "la", "los", "las", "un", "una", "unos", "unas"]);

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function getSearchTerms(query: string) {
  return normalize(query)
    .split(/[^\p{Letter}\p{Number}]+/u)
    .filter((term) => term && !SPANISH_ARTICLES.has(term));
}

function getSearchableValues(song: Song, searchField: string) {
  switch (searchField) {
    case "title":
      return [song.title];
    case "artist":
      return [song.artist];
    case "album":
      return [song.album];
    case "genre":
      return [song.genre];
    case "year":
      return [song.year];
    case "collection":
      return [song.collection_name];
    default:
      return [
        song.title,
        song.artist,
        song.album,
        song.genre,
        song.year,
        song.collection_name,
      ];
  }
}

export function filterSongs(songs: Song[], query: string, searchField: string) {
  const terms = getSearchTerms(query);
  if (terms.length === 0) {
    return songs;
  }

  return songs.filter((song) => {
    const values = getSearchableValues(song, searchField).map(normalize);
    return terms.every((term) => values.some((value) => value.includes(term)));
  });
}
