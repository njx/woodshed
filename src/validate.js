import { uid } from './util.js';
import { VARY, SHAPES, CHORDS } from './theory.js';
import { SOUNDS, SWING } from './sounds.js';
import { LEVELS, BUCKETS, RATINGS, CATEGORIES, KEY_MODES, TRANSPOSITIONS, LISTEN_SERVICES, DEFAULT_SETTINGS } from './constants.js';

// Makes saved or imported state safe to use: every field the app reads gets the type it expects.
// Ids and enum values end up in HTML attributes and class names, so anything unexpected is
// replaced (or the record dropped) rather than trusted. Runs on every load and import.

const ID = /^[\w-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isId = (x) => typeof x === 'string' && ID.test(x);
const isDate = (x) => typeof x === 'string' && DATE.test(x);
const str = (x, max = 20000) => (typeof x === 'string' ? x.slice(0, max) : x == null ? '' : String(x).slice(0, max));
const num = (x, min, max) => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : null);
const int = (x, min, max) => (Number.isInteger(x) && x >= min && x <= max ? x : null);
const oneOf = (x, allowed, fallback) => (allowed.includes(x) ? x : fallback);
const keyList = (a, max) => (Array.isArray(a) ? a.filter((k) => int(k, 0, max) != null) : []);

function item(t, ids) {
  if (!t || typeof t !== 'object') return null;
  if (!isId(t.id) || ids.has(t.id)) t.id = uid();
  ids.add(t.id);
  t.type = oneOf(t.type, ['tune', 'exercise'], 'tune');
  t.name = str(t.name, 200);
  t.priority = int(t.priority, 1, 4) ?? 2;
  t.level = int(t.level, 0, LEVELS.length - 1);
  t.notes = str(t.notes);
  t.focus = !!t.focus;
  t.ivl = num(t.ivl, 0, 3650);
  t.due = isDate(t.due) ? t.due : null;
  t.tempo = int(Math.round(t.tempo), 10, 400);
  t.goalTempo = int(Math.round(t.goalTempo), 10, 400);
  if (t.type === 'exercise') {
    t.keys = keyList(t.keys, 11);
    t.keyMode = oneOf(t.keyMode, Object.keys(KEY_MODES), 'weak');
    t.keysPerSession = int(t.keysPerSession, 1, 12) ?? 1;
    t.abc = str(t.abc);
    t.meter = /^\d{1,2}\/\d{1,2}$/.test(t.meter) ? t.meter : '4/4';
    t.category = oneOf(t.category, Object.keys(CATEGORIES), 'other');
    t.vary = vary(t.vary);
    t.fromTune = !!t.fromTune;
  } else {
    t.keys = keyList(t.keys, 23);
    t.style = str(t.style || 'Standard', 60);
    t.chart = chart(t.chart);
    t.chartEdited = !!t.chartEdited && !!t.chart;
    t.mine = !!t.mine;
  }
  return t;
}

// A progression for a warm-up: { name, chords: [{ d, family }] }.
function prog(p) {
  const chords = (Array.isArray(p?.chords) ? p.chords : []).slice(0, 16)
    .filter((c) => int(c?.d, 0, 11) != null && CHORDS[c.family]).map((c) => ({ d: c.d, family: c.family }));
  return chords.length ? { name: str(p.name, 60), chords } : null;
}

// A tune's own chord chart (see chords.js), or null.
const Q = /^[\w#()+/]{0,20}$/;
function chart(c) {
  if (!c || typeof c !== 'object' || !Array.isArray(c.sections) || !c.sections.length) return null;
  const chord = (x) => (x && int(x.root, 0, 11) != null && typeof x.q === 'string' && Q.test(x.q)
    ? { root: x.root, q: x.q, ...(int(x.bass, 0, 11) != null ? { bass: x.bass } : {}) } : null);
  const bar = (b) => ({ chords: (Array.isArray(b?.chords) ? b.chords : []).map(chord).filter(Boolean), alts: (Array.isArray(b?.alts) ? b.alts : []).map(chord).filter(Boolean) });
  const bars = (a) => (Array.isArray(a) ? a.slice(0, 200).map(bar) : []);
  return {
    key: int(c.key, 0, 23),
    meter: /^\d{1,2}\/\d{1,2}$/.test(c.meter) ? c.meter : '4/4',
    sections: c.sections.slice(0, 40).map((s) => ({
      label: str(s?.label, 20), repeats: int(s?.repeats, 0, 9) ?? 0, bars: bars(s?.bars),
      endings: (Array.isArray(s?.endings) ? s.endings.slice(0, 4) : []).map(bars),
    })),
  };
}

// An exercise's scale or chord variation, or null.
function vary(v) {
  if (!v || typeof v !== 'object' || !VARY[v.kind]) return null;
  const known = VARY[v.kind].types;
  const types = (Array.isArray(v.types) ? v.types : []).filter((id, i, a) => known[id] && a.indexOf(id) === i);
  const shape = SHAPES[v.shape]?.kinds.includes(v.kind) ? v.shape : 'updown';
  return { kind: v.kind, types: types.length ? types : [...VARY[v.kind].defaults], shape, pattern: str(v.pattern, 200) };
}
const typeList = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && ID.test(x)) : []);

function logEntry(e, ids) {
  if (!e || typeof e !== 'object' || !isDate(e.date) || !ids.has(e.itemId)) return null;
  if (!isId(e.id)) e.id = uid();
  e.at = num(e.at, 0, 8.64e15) ?? 0;
  e.key = int(e.key, 0, 23);
  if (e.keys != null) e.keys = keyList(e.keys, 11);
  if (e.types != null) e.types = typeList(e.types);
  if (e.progName != null) e.progName = str(e.progName, 60);
  if (e.pid != null && !isId(e.pid)) delete e.pid;
  e.rating = oneOf(e.rating, RATINGS.map((r) => r.v), null);
  e.bpm = e.bpm == null ? null : int(Math.round(e.bpm), 10, 400);
  e.alt = !!e.alt;
  e.shift = int(e.shift, -11, 11);
  const prev = e.prev && typeof e.prev === 'object' ? e.prev : {};
  e.prev = { ivl: num(prev.ivl, 0, 3650), due: isDate(prev.due) ? prev.due : null };
  return e;
}

function diaryEntry(e, ids) {
  if (!e || typeof e !== 'object' || !isDate(e.date)) return null;
  if (!isId(e.id)) e.id = uid();
  e.at = num(e.at, 0, 8.64e15) ?? 0;
  e.text = str(e.text);
  e.flag = oneOf(e.flag, ['remember', 'teacher'], null);
  e.done = !!e.done;
  if (e.take) e.take = true; else delete e.take;
  e.itemId = ids.has(e.itemId) ? e.itemId : null;
  e.media = (Array.isArray(e.media) ? e.media : [])
    .filter((c) => c && isId(c.id))
    .map((c) => ({ id: c.id, kind: oneOf(c.kind, ['audio', 'video'], 'audio'), mime: str(c.mime, 100), ms: num(c.ms, 0, 1e9) ?? 0, size: num(c.size, 0, 1e12) ?? 0 }));
  return e;
}

// A stretch of practice time (see practicetime.js).
function session(x) {
  if (!x || typeof x !== 'object' || !isDate(x.date)) return null;
  const start = num(x.start, 0, 8.64e15);
  if (start == null) return null;
  const out = { id: isId(x.id) ? x.id : uid(), date: x.date, start, end: num(x.end, start, start + 86400000) ?? start };
  if (x.away) out.away = true;
  return out;
}

function plan(p, ids) {
  if (!p || typeof p !== 'object' || !isDate(p.date) || !Array.isArray(p.items)) return null;
  const pids = new Set();
  p.items = p.items.filter((it) => it && ids.has(it.itemId)).map(({ warmup, ...it }) => ({
    ...(ids.has(warmup) ? { warmup } : {}), // a warm-up for this tune
    ...it,
    pid: isId(it.pid) && !pids.has(it.pid) ? (pids.add(it.pid), it.pid) : (() => { const x = uid(); pids.add(x); return x; })(),
    bucket: oneOf(it.bucket, Object.keys(BUCKETS), 'learn'),
    key: int(it.key, 0, 23),
    keys: it.keys == null ? it.keys : keyList(it.keys, 11),
    ...(it.types != null ? { types: typeList(it.types) } : {}),
    ...(it.prog != null ? { prog: prog(it.prog) } : {}),
    shift: int(it.shift, -11, 11),
    alt: !!it.alt,
    ...(num(it.mix, 0, 1) != null ? { mix: it.mix } : {}),
  }));
  p.skipped = (Array.isArray(p.skipped) ? p.skipped : []).filter(isId);
  if (p.dayKeys != null) p.dayKeys = keyList(p.dayKeys, 11);
  delete p.warmupFor; // from an earlier version
  p.prepped = (Array.isArray(p.prepped) ? p.prepped : []).filter((id) => ids.has(id)); // tunes given warm-ups
  p.mode = oneOf(p.mode, ['own', 'day', 'tunes'], null);
  p.focusSkipped = (Array.isArray(p.focusSkipped) ? p.focusSkipped : []).filter(isId);
  return p;
}

function settings(s) {
  s = { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
  for (const k of ['exercises', 'hone', 'learn', 'fresh']) s[k] = int(s[k], 0, 8) ?? DEFAULT_SETTINGS[k];
  s.instruments = (Array.isArray(s.instruments) ? s.instruments : []).filter((x) => x in TRANSPOSITIONS);
  if (!s.instruments.length) s.instruments = ['c'];
  if (!s.instruments.includes(s.view)) s.view = s.instruments[0];
  s.listen = oneOf(s.listen, Object.keys(LISTEN_SERVICES), DEFAULT_SETTINGS.listen);
  s.priority = str(s.priority, 20);
  s.newKeys = oneOf(s.newKeys, ['mastered', 'proficient', 'never'], DEFAULT_SETTINGS.newKeys);
  s.a4 = int(s.a4, 430, 450) ?? 440;
  s.tuneOrder = oneOf(s.tuneOrder, ['mixed', 'group'], DEFAULT_SETTINGS.tuneOrder);
  s.exerciseFocus = oneOf(s.exerciseFocus, ['own', 'day', 'tunes'], DEFAULT_SETTINGS.exerciseFocus);
  s.sound = oneOf(s.sound, Object.keys(SOUNDS), DEFAULT_SETTINGS.sound);
  s.swing = oneOf(s.swing, Object.keys(SWING), DEFAULT_SETTINGS.swing);
  s.recordKind = oneOf(s.recordKind, ['audio', 'video'], 'audio');
  s.recordMic = typeof s.recordMic === 'string' && s.recordMic.length < 300 ? s.recordMic : null;
  if (s.metroBpm != null) s.metroBpm = int(Math.round(s.metroBpm), 10, 400) ?? 100;
  if (s.metroBeats != null) s.metroBeats = int(s.metroBeats, 1, 12) ?? 4;
  return s;
}

export function sanitizeState(s) {
  const ids = new Set();
  s.items = (Array.isArray(s.items) ? s.items : []).map((t) => item(t, ids)).filter(Boolean);
  s.log = (Array.isArray(s.log) ? s.log : []).map((e) => logEntry(e, ids)).filter(Boolean);
  s.diary = (Array.isArray(s.diary) ? s.diary : []).map((e) => diaryEntry(e, ids)).filter(Boolean);
  s.plan = plan(s.plan, ids);
  s.settings = settings(s.settings);
  s.sessions = (Array.isArray(s.sessions) ? s.sessions : []).map(session).filter(Boolean);
  s.greetedOn = isDate(s.greetedOn) ? s.greetedOn : null;
  s.timing = s.sessions.some((x) => x.id === s.timing) ? s.timing : null;
  s.assistantWishes = (Array.isArray(s.assistantWishes) ? s.assistantWishes : [])
    .filter((w) => w && typeof w === 'object')
    .map((w) => ({ date: isDate(w.date) ? w.date : '', request: str(w.request, 1000) }));
  return s;
}
