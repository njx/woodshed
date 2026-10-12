import { RECORDINGS, SEARCH_NAMES } from './data/recordings.js';
import { normTitle } from './util.js';

const byTitle = new Map(Object.entries(RECORDINGS).map(([k, v]) => [normTitle(k), v]));
const searchByTitle = new Map(Object.entries(SEARCH_NAMES).map(([k, v]) => [normTitle(k), v]));

// Match on the name the tune had in the original list first, so renaming a tune keeps its links.
function lookup(map, item) {
  return (item.seedName && map.get(normTitle(item.seedName))) || map.get(normTitle(item.name));
}

// Your own recordings first, then the curated ones.
export function recordingsFor(item) {
  const mine = (item.recordings || []).map((r) => ({ ...r, mine: true }));
  const curated = (lookup(byTitle, item) || []).map(([artist, album, year]) => ({ artist, album, year }));
  return [...mine, ...curated];
}

export function searchName(item) {
  return lookup(searchByTitle, item) || item.name;
}

export function searchUrl(service, query) {
  const q = encodeURIComponent(query);
  if (service === 'spotify') return `https://open.spotify.com/search/${q}`;
  if (service === 'youtube') return `https://www.youtube.com/results?search_query=${q}`;
  return `https://music.apple.com/search?term=${q}`;
}

export function recordingUrl(service, item, rec) {
  return searchUrl(service, [searchName(item), rec?.artist].filter(Boolean).join(' '));
}
