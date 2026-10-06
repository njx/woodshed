import { describe, it, expect } from 'vitest';
import { RECORDINGS, SEARCH_NAMES } from '../src/data/recordings.js';
import { SEED_TUNES } from '../src/data/tunes.js';
import { recordingsFor, recordingUrl, searchUrl } from '../src/listen.js';
import { normTitle } from '../src/util.js';

describe('recordings data', () => {
  const titles = new Set(SEED_TUNES.map((t) => normTitle(t.name)));

  it('only lists recordings for tunes that are in the list', () => {
    const unknown = [...Object.keys(RECORDINGS), ...Object.keys(SEARCH_NAMES)].filter((k) => !titles.has(normTitle(k)));
    expect(unknown).toEqual([]);
  });

  it('has well-formed entries', () => {
    for (const [tuneName, recs] of Object.entries(RECORDINGS)) {
      for (const r of recs) {
        expect(r, tuneName).toHaveLength(3);
        expect(typeof r[0], tuneName).toBe('string');
      }
    }
  });
});

describe('links', () => {
  it('keeps a renamed tune’s recordings, with your own first', () => {
    const t = { name: 'Autumn Leaves (Les Feuilles Mortes)', seedName: 'Autumn Leaves', recordings: [{ artist: 'Chet Baker', album: null }] };
    const recs = recordingsFor(t);
    expect(recs[0]).toMatchObject({ artist: 'Chet Baker', mine: true });
    expect(recs[1]).toMatchObject({ artist: 'Cannonball Adderley', album: "Somethin' Else", year: 1958 });
  });

  it('builds search links for each service', () => {
    expect(searchUrl('spotify', 'So What')).toBe('https://open.spotify.com/search/So%20What');
    expect(searchUrl('youtube', 'So What')).toBe('https://www.youtube.com/results?search_query=So%20What');
    expect(searchUrl('apple', 'So What')).toBe('https://music.apple.com/search?term=So%20What');
  });

  it('searches by the better-known title where the list uses a nickname', () => {
    const url = recordingUrl('apple', { name: 'UMMG', seedName: 'UMMG' }, { artist: 'Billy Strayhorn' });
    expect(decodeURIComponent(url)).toContain('Upper Manhattan Medical Group Billy Strayhorn');
  });
});
