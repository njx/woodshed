import { RECORDINGS, SEARCH_NAMES } from './data/recordings.js';
import { normTitle } from './util.js';
import type { ListenService, Recording, Tune } from './types.js';

// data/recordings.ts's entries: [artist, album or null, year or null] (its inferred type is looser).
type Curated = [artist: string, album: string | null, year: number | null];
const byTitle = new Map((Object.entries(RECORDINGS) as [string, Curated[]][]).map(([k, v]) => [normTitle(k), v]));
const searchByTitle = new Map(Object.entries(SEARCH_NAMES).map(([k, v]) => [normTitle(k), v]));

// Match on the name the tune had in the original list first, so renaming a tune keeps its links.
function lookup<T>(map: Map<string, T>, item: Tune): T | undefined {
  return (item.seedName && map.get(normTitle(item.seedName))) || map.get(normTitle(item.name));
}

// Your own recordings first, then the curated ones.
export function recordingsFor(item: Tune): (Recording & { mine?: boolean })[] {
  const mine = (item.recordings || []).map((r) => ({ ...r, mine: true }));
  const curated = (lookup(byTitle, item) || []).map(([artist, album, year]) => ({ artist, album, year }));
  return [...mine, ...curated];
}

export function searchName(item: Tune): string {
  return lookup(searchByTitle, item) || item.name;
}

export function searchUrl(service: ListenService, query: string): string {
  const q = encodeURIComponent(query);
  if (service === 'spotify') return `https://open.spotify.com/search/${q}`;
  if (service === 'youtube') return `https://www.youtube.com/results?search_query=${q}`;
  return `https://music.apple.com/search?term=${q}`;
}

export function recordingUrl(service: ListenService, item: Tune, rec?: Recording | null): string {
  return searchUrl(service, [searchName(item), rec?.artist].filter(Boolean).join(' '));
}
