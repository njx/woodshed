import { uid } from './util.js';
import { VARY, SHAPES, CHORDS } from './theory.js';
import { SOUNDS, SWING } from './sounds.js';
import { LEVELS, BUCKETS, RATINGS, CATEGORIES, KEY_MODES, TRANSPOSITIONS, LISTEN_SERVICES, DEFAULT_SETTINGS } from './constants.js';
import type { Chart, ChordType, DateStr, DiaryEntry, Id, Item, Key, LogEntry, Plan, PracticeSession, Progression, Settings, Shape, State, Vary } from './types.js';

// Makes saved or imported state safe to use: every field the app reads gets the type it expects.
// Ids and enum values end up in HTML attributes and class names, so anything unexpected is
// replaced (or the record dropped) rather than trusted. Runs on every load and import.

// Saved or imported data, before it's checked here: anything at all.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;

const ID = /^[\w-]{1,64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isId = (x: unknown): x is Id => typeof x === 'string' && ID.test(x);
const isDate = (x: unknown): x is DateStr => typeof x === 'string' && DATE.test(x);
const str = (x: unknown, max = 20000): string => (typeof x === 'string' ? x.slice(0, max) : x == null ? '' : String(x).slice(0, max));
const num = (x: unknown, min: number, max: number): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : null);
const int = (x: Raw, min: number, max: number): number | null => (Number.isInteger(x) && x >= min && x <= max ? x : null);
const oneOf = <T, F>(x: Raw, allowed: readonly T[], fallback: F): T | F => (allowed.includes(x) ? x : fallback);
const keyList = (a: unknown, max: number): Key[] => (Array.isArray(a) ? a.filter((k) => int(k, 0, max) != null) : []);

function item(t: Raw, ids: Set<Id>): Item | null {
  if (!t || typeof t !== 'object') return null;
  if (!isId(t.id) || ids.has(t.id)) t.id = uid();
  ids.add(t.id);
  t.type = oneOf(t.type, ['tune', 'exercise'], 'tune');
  t.name = str(t.name, 200);
  t.priority = int(t.priority, 1, 4) ?? 2;
  t.level = int(t.level, 0, LEVELS.length - 1) ?? 0; // unrated = don't know
  t.notes = str(t.notes);
  t.focus = !!t.focus;
  if (t.type === 'exercise' && t.solo) t.solo = true; // not for tunes: technical, on its own only
  else delete t.solo;
  if (t.off && !t.focus) t.off = true; // left out of the pool (see plan.js itemStatus)
  else delete t.off;
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
    if (t.harmony != null) t.harmony = str(t.harmony, 200) || undefined; // chords it goes with (see warmups.js)
    if (t.harmony === undefined) delete t.harmony;
    if (int(t.home, 1, 23) == null) delete t.home; // the key it's written in (see abc.js homeKey)
    if (t.asWritten) t.asWritten = true; // notation shown only in C (see ui/exercise.js)
    else delete t.asWritten;
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
function prog(p: Raw): Progression | null {
  const chords = (Array.isArray(p?.chords) ? p.chords : []).slice(0, 16)
    .filter((c: Raw) => int(c?.d, 0, 11) != null && CHORDS[c.family as ChordType]).map((c: Raw) => ({ d: c.d, family: c.family }));
  return chords.length ? { name: str(p.name, 60), chords } : null;
}

// A tune's own chord chart (see chords.js), or null.
const Q = /^[\w#()+/]{0,20}$/;
function chart(c: Raw): Chart | null {
  if (!c || typeof c !== 'object' || !Array.isArray(c.sections) || !c.sections.length) return null;
  const chord = (x: Raw) => (x && int(x.root, 0, 11) != null && typeof x.q === 'string' && Q.test(x.q)
    ? { root: x.root, q: x.q, ...(int(x.bass, 0, 11) != null ? { bass: x.bass } : {}) } : null);
  const bar = (b: Raw) => ({ chords: (Array.isArray(b?.chords) ? b.chords : []).map(chord).filter(Boolean), alts: (Array.isArray(b?.alts) ? b.alts : []).map(chord).filter(Boolean) });
  const bars = (a: unknown) => (Array.isArray(a) ? a.slice(0, 200).map(bar) : []);
  return {
    key: int(c.key, 0, 23),
    meter: /^\d{1,2}\/\d{1,2}$/.test(c.meter) ? c.meter : '4/4',
    sections: c.sections.slice(0, 40).map((s: Raw) => ({
      label: str(s?.label, 20), repeats: int(s?.repeats, 0, 9) ?? 0, bars: bars(s?.bars),
      endings: (Array.isArray(s?.endings) ? s.endings.slice(0, 4) : []).map(bars),
    })),
  };
}

// An exercise's scale or chord variation, or null.
// (Table lookups by keys from the data: an unknown key finds nothing.)
// TODO(ts): …except an Object.prototype name: kind 'constructor' passes the check and then
// VARY[kind].types is undefined, so known[id] throws (shape 'constructor' too: .kinds.includes).
function vary(v: Raw): Vary | null {
  if (!v || typeof v !== 'object' || !VARY[v.kind as Vary['kind']]) return null;
  const known: Record<string, object> = VARY[v.kind as Vary['kind']].types;
  const types = (Array.isArray(v.types) ? v.types : []).filter((id: Raw, i: number, a: Raw[]) => known[id] && a.indexOf(id) === i);
  const shape = SHAPES[v.shape as Shape]?.kinds.includes(v.kind) ? v.shape : 'updown';
  return { kind: v.kind, types: types.length ? types : [...VARY[v.kind as Vary['kind']].defaults], shape, pattern: str(v.pattern, 200) };
}
const typeList = (a: unknown): string[] => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && ID.test(x)) : []);

function logEntry(e: Raw, ids: Set<Id>): LogEntry | null {
  if (!e || typeof e !== 'object' || !isDate(e.date) || !ids.has(e.itemId)) return null;
  if (!isId(e.id)) e.id = uid();
  e.at = num(e.at, 0, 8.64e15) ?? 0;
  e.key = int(e.key, 0, 23);
  if (e.keys != null) e.keys = keyList(e.keys, 11);
  if (e.types != null) e.types = typeList(e.types);
  if (e.progName != null) e.progName = str(e.progName, 60);
  if (e.pid != null && !isId(e.pid)) delete e.pid;
  if (e.warmup != null && !ids.has(e.warmup)) delete e.warmup;
  e.rating = oneOf(e.rating, RATINGS.map((r) => r.v), null);
  e.bpm = e.bpm == null ? null : int(Math.round(e.bpm), 10, 400);
  e.alt = !!e.alt;
  e.shift = int(e.shift, -11, 11);
  const prev = e.prev && typeof e.prev === 'object' ? e.prev : {};
  e.prev = { ivl: num(prev.ivl, 0, 3650), due: isDate(prev.due) ? prev.due : null };
  return e;
}

function diaryEntry(e: Raw, ids: Set<Id>): DiaryEntry | null {
  if (!e || typeof e !== 'object' || !isDate(e.date)) return null;
  if (!isId(e.id)) e.id = uid();
  e.at = num(e.at, 0, 8.64e15) ?? 0;
  e.text = str(e.text);
  e.flag = oneOf(e.flag, ['remember', 'teacher'], null);
  e.done = !!e.done;
  if (e.take) e.take = true; else delete e.take;
  e.itemId = ids.has(e.itemId) ? e.itemId : null;
  e.media = (Array.isArray(e.media) ? e.media : [])
    .filter((c: Raw) => c && isId(c.id))
    .map((c: Raw) => ({ id: c.id, kind: oneOf(c.kind, ['audio', 'video'], 'audio'), mime: str(c.mime, 100), ms: num(c.ms, 0, 1e9) ?? 0, size: num(c.size, 0, 1e12) ?? 0 }));
  return e;
}

// A stretch of practice time (see practicetime.js).
function session(x: Raw): PracticeSession | null {
  if (!x || typeof x !== 'object' || !isDate(x.date)) return null;
  const start = num(x.start, 0, 8.64e15);
  if (start == null) return null;
  const out: PracticeSession = { id: isId(x.id) ? x.id : uid(), date: x.date, start, end: num(x.end, start, start + 86400000) ?? start };
  if (x.away) out.away = true;
  return out;
}

function plan(p: Raw, ids: Set<Id>): Plan | null {
  if (!p || typeof p !== 'object' || !isDate(p.date) || !Array.isArray(p.items)) return null;
  const pids = new Set<Id>();
  p.items = p.items.filter((it: Raw) => it && ids.has(it.itemId)).map(({ warmup, ...it }: Raw) => ({
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
    ...(typeof it.over === 'string' ? { over: str(it.over, 60) } : {}),
    ...(int(it.overKey, 0, 23) != null ? { overKey: it.overKey } : {}),
    ...(it.form ? { form: true } : {}), // an exercise through a tune's form (see warmups.js)
    ...(Array.isArray(it.parts) ? { parts: it.parts.slice(0, 12).map((n: Raw) => int(n, 1, 16)) } : {}),
    ...(['setup', 'changes'].includes(it.slot) ? { slot: it.slot } : {}),
  }));
  p.skipped = (Array.isArray(p.skipped) ? p.skipped : []).filter(isId);
  if (p.dayKeys != null) p.dayKeys = keyList(p.dayKeys, 11);
  delete p.warmupFor; // from an earlier version
  delete p.prepped; // (from when warm-ups were added automatically)
  p.mode = oneOf(p.mode, ['own', 'day', 'tunes'], null); // ('tunes': an earlier version's, made again)
  p.focusSkipped = (Array.isArray(p.focusSkipped) ? p.focusSkipped : []).filter(isId);
  return p;
}

function settings(s: Raw): Settings {
  s = { ...DEFAULT_SETTINGS, ...(s && typeof s === 'object' ? s : {}) };
  for (const k of ['exercises', 'hone', 'learn', 'fresh', 'focusTunes', 'focusExercises'] as const) s[k] = int(s[k], 0, 8) ?? DEFAULT_SETTINGS[k];
  s.instruments = (Array.isArray(s.instruments) ? s.instruments : []).filter((x: Raw) => x in TRANSPOSITIONS);
  if (!s.instruments.length) s.instruments = ['c'];
  if (!s.instruments.includes(s.view)) s.view = s.instruments[0];
  s.listen = oneOf(s.listen, Object.keys(LISTEN_SERVICES), DEFAULT_SETTINGS.listen);
  s.priority = str(s.priority, 20);
  s.newKeys = oneOf(s.newKeys, ['mastered', 'proficient', 'never'], DEFAULT_SETTINGS.newKeys);
  s.a4 = int(s.a4, 430, 450) ?? 440;
  s.tuneOrder = oneOf(s.tuneOrder, ['mixed', 'group'], DEFAULT_SETTINGS.tuneOrder);
  s.exerciseFocus = oneOf(s.exerciseFocus, ['own', 'day'], DEFAULT_SETTINGS.exerciseFocus); // ('tunes' is gone: own)
  s.sound = oneOf(s.sound, Object.keys(SOUNDS), DEFAULT_SETTINGS.sound);
  s.swing = oneOf(s.swing, Object.keys(SWING), DEFAULT_SETTINGS.swing);
  s.recordKind = oneOf(s.recordKind, ['audio', 'video'], 'audio');
  s.recordMic = typeof s.recordMic === 'string' && s.recordMic.length < 300 ? s.recordMic : null;
  s.recordMicLabel = typeof s.recordMicLabel === 'string' && s.recordMicLabel.length < 200 ? s.recordMicLabel : null;
  if (s.metroBpm != null) s.metroBpm = int(Math.round(s.metroBpm), 10, 400) ?? 100;
  if (s.metroBeats != null) s.metroBeats = int(s.metroBeats, 1, 12) ?? 4;
  if (s.bassClick != null) s.bassClick = oneOf(s.bassClick, ['all', 'twofour', 'off'], 'twofour');
  return s;
}

export function sanitizeState(s: Raw): State {
  const ids = new Set<Id>();
  s.items = (Array.isArray(s.items) ? s.items : []).map((t: Raw) => item(t, ids)).filter(Boolean);
  s.log = (Array.isArray(s.log) ? s.log : []).map((e: Raw) => logEntry(e, ids)).filter(Boolean);
  s.diary = (Array.isArray(s.diary) ? s.diary : []).map((e: Raw) => diaryEntry(e, ids)).filter(Boolean);
  s.plan = plan(s.plan, ids);
  s.settings = settings(s.settings);
  s.sessions = (Array.isArray(s.sessions) ? s.sessions : []).map(session).filter(Boolean);
  s.greetedOn = isDate(s.greetedOn) ? s.greetedOn : null;
  // Hints dismissed (or done): shown no more (see ui/shell.js hintHtml).
  s.hintsSeen = (Array.isArray(s.hintsSeen) ? s.hintsSeen : []).filter((h: unknown) => typeof h === 'string' && /^[a-z-]{1,30}$/.test(h));
  s.timing = s.sessions.some((x: PracticeSession) => x.id === s.timing) ? s.timing : null;
  s.assistantWishes = (Array.isArray(s.assistantWishes) ? s.assistantWishes : [])
    .filter((w: Raw) => w && typeof w === 'object')
    .map((w: Raw) => ({ date: isDate(w.date) ? w.date : '', request: str(w.request, 1000) }));
  return s;
}
