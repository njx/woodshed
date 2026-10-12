import { normTitle } from './util.js';

// Matching tune titles to mikeoliphant/JazzStandards (iReal Pro's playlists), whose titles are
// sometimes written differently ("Girl From Ipanema, The"). Used at build time to seed charts.

// An entry in JazzStandards.json (the parts used; see chords.js chartFromStandard).
export interface Standard {
  Title: string;
  Key?: string;
  TimeSignature?: string;
  Sections?: { Label?: string; Repeats?: number | null; MainSegment?: { Chords?: string }; Endings?: { Chords?: string }[] }[];
}

// Titles that differ between the tune list and JazzStandards.
const ALIAS_TITLES = {
  'UMMG': 'Upper Manhattan Medical Group',
  'Black Orpheus': 'Manha De Carnaval (Black Orpheus)',
  'A Day in the Life of a Fool': 'Manha De Carnaval (Black Orpheus)',
  'The Night Has 1000 Eyes': 'Night Has A Thousand Eyes, The',
  'All God’s Chillun': "All God's Chillun Got Rhythm",
  'I Got it Bad and that ain’t Good': 'I Got It Bad',
  'Spring Can Really Hang You Up': 'Spring Can Really Hang You Up The Most',
  'You’re a Weaver of Dreams': 'A Weaver Of Dreams',
};
export const ALIASES = Object.fromEntries(Object.entries(ALIAS_TITLES).map(([a, b]) => [normTitle(a), b]));

// A looser form of a title: no parentheses or apostrophes, "X, The" → "X", no leading
// "the"/"a"/"on", no spaces.
export function looseTitle(title: string): string {
  return normTitle(String(title).replace(/\(.*?\)/g, ' ').replace(/[’']/g, '').replace(/,\s*(the|a)\s*$/i, '').trim()
    .replace(/^(the|a|on)\s+/i, ''));
}

// An index of JazzStandards entries by title, and a lookup into it.
export function indexStandards(list: Standard[]): Map<string, Standard> {
  const index = new Map<string, Standard>();
  for (const x of list) {
    const exact = normTitle(x.Title);
    if (!index.has(exact)) index.set(exact, x);
    const loose = `~${looseTitle(x.Title)}`;
    if (!index.has(loose)) index.set(loose, x);
  }
  return index;
}
export function findStandard(index: Map<string, Standard>, title: string): Standard | null {
  const n = normTitle(title);
  return index.get(n) || index.get(`~${looseTitle(title)}`) || (ALIASES[n] && index.get(normTitle(ALIASES[n]))) || null;
}
