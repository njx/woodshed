import { kvGet, kvSet } from './db.js';
import { normTitle } from './util.js';
import { chartFromStandard } from './chords.js';

// Chord charts for tunes. A tune's own chart (typed or edited in the app, saved with the tune
// as `chart`) comes first; otherwise one from mikeoliphant/JazzStandards (from iReal Pro's
// playlists), downloaded the first time it's needed and kept on this device (not in backups).

export const CHARTS_URL = 'https://raw.githubusercontent.com/mikeoliphant/JazzStandards/main/JazzStandards.json';
const KV_KEY = 'charts';

// Titles that differ between the tune list and JazzStandards.
const ALIASES = {
  'ummg': 'Upper Manhattan Medical Group',
  'black orpheus': 'Manha De Carnaval (Black Orpheus)',
  'a day in the life of a fool': 'Manha De Carnaval (Black Orpheus)',
  'the night has 1000 eyes': 'Night Has A Thousand Eyes, The',
  'all gods chillun': "All God's Chillun Got Rhythm",
  'i got it bad and that aint good': 'I Got It Bad',
  'spring can really hang you up': 'Spring Can Really Hang You Up The Most',
  'youre a weaver of dreams': 'A Weaver Of Dreams',
};

// A looser form of a title: no parentheses or apostrophes, "X, The" → "X", no leading
// "the"/"a"/"on", no spaces.
function loose(title) {
  return normTitle(String(title).replace(/\(.*?\)/g, ' ').replace(/[’']/g, '').replace(/,\s*(the|a)\s*$/i, ''))
    .replace(/^(the|a|on) /, '').replace(/ /g, '');
}

let index = null; // Map: title key → JazzStandards entry
let status = 'idle'; // idle | loading | ready | failed
let loading = null;
const listeners = new Set();
const converted = new Map();

function build(list) {
  index = new Map();
  for (const x of list) {
    const exact = normTitle(x.Title);
    if (!index.has(exact)) index.set(exact, x);
    const l = `~${loose(x.Title)}`;
    if (!index.has(l)) index.set(l, x);
  }
  converted.clear();
}

export const chartsStatus = () => status;
export function onChartsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
const changed = () => listeners.forEach((fn) => fn(status));

// Loads charts saved on this device; downloads them if there are none yet (and `download`).
export function loadCharts({ download = true } = {}) {
  if (status === 'ready') return Promise.resolve(true);
  if (loading) return loading;
  loading = (async () => {
    try {
      const saved = await kvGet(KV_KEY).catch(() => null);
      if (saved?.list?.length) {
        build(saved.list);
        status = 'ready';
        return true;
      }
      if (!download) return false;
      status = 'loading';
      changed();
      const res = await fetch(CHARTS_URL);
      if (!res.ok) throw new Error(`charts: ${res.status}`);
      const list = await res.json();
      if (!Array.isArray(list) || !list.length) throw new Error('charts: empty');
      build(list);
      status = 'ready';
      await kvSet(KV_KEY, { fetchedAt: Date.now(), list }).catch(() => {});
      return true;
    } catch (err) {
      console.warn('Could not load chord charts', err);
      status = 'failed';
      return false;
    } finally {
      loading = null;
      changed();
    }
  })();
  return loading;
}

// The JazzStandards entry for a tune's title, if there is one.
export function standardFor(t) {
  if (!index) return null;
  for (const title of [t.seedName, t.name].filter(Boolean)) {
    const n = normTitle(title);
    const hit = index.get(n) || index.get(`~${loose(title)}`) || (ALIASES[n] && index.get(normTitle(ALIASES[n])));
    if (hit) return hit;
  }
  return null;
}

// A tune's chart: its own, or the downloaded one. null if there isn't one (or charts haven't
// loaded yet).
export function chartFor(t) {
  if (!t || t.type !== 'tune') return null;
  if (t.chart?.sections?.length) return t.chart;
  const x = standardFor(t);
  if (!x) return null;
  if (!converted.has(x)) converted.set(x, chartFromStandard(x));
  return converted.get(x);
}

export const chartSource = (t) => (t?.chart?.sections?.length ? 'mine' : standardFor(t) ? 'standards' : null);

// For tests.
export function _resetCharts(list = null) {
  index = null;
  status = 'idle';
  loading = null;
  if (list) { build(list); status = 'ready'; }
}
