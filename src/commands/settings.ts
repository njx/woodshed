import { store } from '../store.js';
import { TRANSPOSITIONS, LISTEN_SERVICES } from '../constants.js';
import { SOUNDS, SWING } from '../sounds.js';
import { dateStr, parseDate, niceDate } from '../dates.js';
import { orderPlan, refreshExercises } from '../plan.js';
import { startPractice as start, endPractice as end, running, practicedMs, fmtDuration, addSession } from '../practicetime.js';
import { pastDay } from './diary.js';
import { command, f, CommandError, type Field } from './core.js';
import type { PracticeSession, Settings, Transposition } from '../types.js';

// Settings, and the practice timer.

const ids = <T extends object>(table: T) => Object.keys(table) as (keyof T & string)[];

// The settings that can be changed (snake_case for the assistant; Settings has them in camelCase).
interface SettingsInput {
  exercises?: number; tunes?: number;
  tune_order?: Settings['tuneOrder'];
  exercise_focus?: Settings['exerciseFocus'];
  priority?: 'off' | 'some' | 'strong';
  new_keys?: Settings['newKeys'];
  instruments?: Transposition[];
  view?: Transposition;
  listen?: Settings['listen'];
  sound?: Settings['sound'];
  swing?: Settings['swing'];
  walking_bass?: boolean;
  bass_click?: NonNullable<Settings['bassClick']>;
  count_in?: number;
  a4?: number;
}
const KEYS: Record<keyof SettingsInput, keyof Settings> = {
  exercises: 'exercises', tunes: 'tunes',
  tune_order: 'tuneOrder', exercise_focus: 'exerciseFocus', priority: 'priority', new_keys: 'newKeys', instruments: 'instruments',
  view: 'view', listen: 'listen', sound: 'sound', swing: 'swing', walking_bass: 'metroBass', bass_click: 'bassClick', count_in: 'bassCountIn', a4: 'a4',
};
const count = (what: string): Field<number> => f.opt(f.int(`${what} a day (0–8)`));

export const changeSettings = command<SettingsInput>({
  name: 'change_settings',
  description: "Change the app's settings. Every field is optional: null leaves it unchanged. The daily mix (how many exercises and tunes a day) applies from tomorrow's set unless today's is picked again (new_set).",
  fields: {
    exercises: count('Exercises: focus ones first (up to half of them, taking turns), the rest picked by priority and how overdue, mixing the kinds (scales, arpeggios, patterns, licks…);'),
    tunes: count('Tunes: focus ones first (up to half of them, taking turns), the rest picked by priority and how overdue, mixing hone, learn and new;'),
    tune_order: f.opt(f.oneOf(['mixed', 'group'] as const, "Today's tunes mixed up, or by group (hone, learn, new)")),
    exercise_focus: f.opt(f.oneOf(['own', 'day'] as const, 'own: each exercise picks its own keys; day: a key or two of the day for every exercise that picks by weak keys or at random')),
    priority: f.opt(f.oneOf(['off', 'some', 'strong'] as const, 'How much priority matters when picking tunes that are due')),
    new_keys: f.opt(f.oneOf(['mastered', 'proficient', 'never'] as const, 'Which tunes get suggested in keys other than their usual ones')),
    instruments: f.opt(f.list(f.oneOf(ids(TRANSPOSITIONS)), `The instruments they play, for the keys shown: ${Object.entries(TRANSPOSITIONS).map(([k, x]) => `${k} (${x.label}, ${k === 'c' ? 'concert pitch' : `in ${x.key}`})`).join('; ')}`)),
    view: f.opt(f.oneOf(ids(TRANSPOSITIONS), 'Which of their instruments keys are shown for')),
    listen: f.opt(f.oneOf(ids(LISTEN_SERVICES), 'Where recording links open')),
    sound: f.opt(f.oneOf(ids(SOUNDS), 'The sound notation plays with')),
    swing: f.opt(f.oneOf(ids(SWING), 'The feel notation plays with')),
    walking_bass: f.opt(f.bool('The metronome for a tune with a chart plays a walking bass through it')),
    bass_click: f.opt(f.oneOf(['all', 'twofour', 'off'] as const, 'With the walking bass, the click on every beat, on 2 and 4, or off')),
    count_in: f.opt(f.int('Bars of clicks before the walking bass comes in (0–2)')),
    a4: f.opt(f.int('The tuner’s A, in Hz (430–450)')),
  },
  run(a, { note }) {
    const s = store.state.settings;
    if (a.instruments && !a.instruments.length) throw new CommandError('Pick at least one');
    if (a.view && !(a.instruments ?? s.instruments).includes(a.view)) throw new CommandError('Keys can only be shown for an instrument they play.');
    const before = { ...s };
    for (const [k, v] of Object.entries(a) as [keyof SettingsInput, unknown][]) {
      if (v == null) continue;
      const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));
      const [lo, hi] = k === 'a4' ? [430, 450] : k === 'count_in' ? [0, 2] : [0, 8];
      (s as unknown as Record<string, unknown>)[KEYS[k]] = typeof v === 'number' ? clamp(v, lo, hi) : v;
    }
    if (a.instruments && !s.instruments.includes(s.view)) s.view = s.instruments[0];
    // What applies to today's set straight away.
    const today = store.state.plan?.date === dateStr();
    if (a.tune_order && a.tune_order !== before.tuneOrder && today) orderPlan(store.state.plan!);
    if (a.exercise_focus && a.exercise_focus !== before.exerciseFocus) refreshExercises();
    const changed = (Object.keys(a) as (keyof SettingsInput)[]).filter((k) => a[k] != null);
    note(`Settings: ${changed.map((k) => k.replace(/_/g, ' ')).join(', ')}`);
    return { changed };
  },
});

export const startPractice = command<Record<string, never>>({
  name: 'start_practice',
  description: 'Start the practice timer.',
  fields: {},
  run(_, { note }) {
    if (running()) throw new CommandError('The practice timer is already running.');
    start();
    note('Practice timer started');
    return {};
  },
});
export const endPractice = command<Record<string, never>>({
  name: 'end_practice',
  description: 'Stop the practice timer.',
  fields: {},
  undoToast: true,
  run(_, { note }) {
    if (!end()) throw new CommandError('The practice timer isn’t running.');
    note(`Practice ended · ${fmtDuration(practicedMs())} today`);
    return { minutes_today: Math.round(practicedMs() / 60000) };
  },
});

// Editing the timer's sessions: how long one was, taking one out, or time it missed.
const MAX_MIN = 12 * 60;
const sessionOf = (id: string): PracticeSession => {
  const s = (store.state.sessions || []).find((x) => x.id === id);
  if (!s) throw new CommandError('That practice session isn’t there any more.');
  if (s.id === store.state.timing) throw new CommandError('That session is still running: end it first.');
  return s;
};
const minutesOf = (m: number) => {
  if (!(m >= 1 && m <= MAX_MIN)) throw new CommandError(`A session is 1 to ${MAX_MIN} minutes.`);
  return Math.round(m) * 60000;
};
const dayName = (d: string) => (d === dateStr() ? 'today' : niceDate(d, { weekday: 'short', month: 'short', day: 'numeric' }));

export const setSessionMinutes = command<{ session: string; minutes: number }>({
  name: 'set_session_minutes',
  description: 'Change how long one of the practice timer\'s sessions was, in minutes (ids from get_practice_sessions). Not one that\'s running.',
  fields: { session: f.str('The session id'), minutes: f.int('1–720') },
  undoToast: true,
  run({ session, minutes }, { note }) {
    const s = sessionOf(session);
    s.end = s.start + minutesOf(minutes);
    delete s.away;
    note(`Practice session: ${fmtDuration(s.end - s.start)} (${dayName(s.date)})`);
    return { minutes: Math.round((s.end - s.start) / 60000) };
  },
});
export const removeSession = command<{ session: string }>({
  name: 'remove_session',
  description: 'Take one of the practice timer\'s sessions out (one started by mistake). Not one that\'s running.',
  fields: { session: f.str('The session id') },
  undoToast: true,
  run({ session }, { note }) {
    const s = sessionOf(session);
    store.state.sessions = store.state.sessions.filter((x) => x !== s);
    note(`Took out ${fmtDuration(s.end - s.start)} of practice (${dayName(s.date)})`);
    return { removed: true };
  },
});
export const addPracticeTime = command<{ minutes: number; date?: string }>({
  name: 'add_practice_time',
  description: 'Add practice time the timer missed, as a session of so many minutes on a day (today, the default, or earlier).',
  fields: { minutes: f.int('1–720'), date: f.opt(f.str('The day, like 2026-10-24: today (the default) or earlier')) },
  undoToast: true,
  run({ minutes, date }, { note }) {
    const day = date ? pastDay(date) : dateStr();
    const ms = minutesOf(minutes);
    // Today: just before now (or before the running session); an earlier day: from noon.
    const r = running();
    const end = day === dateStr() ? Math.min(Date.now(), r?.date === day ? r.start : Infinity) : parseDate(day).getTime() + 12 * 3600000 + ms;
    addSession(day, end - ms, end);
    note(`Added ${fmtDuration(ms)} of practice (${dayName(day)})`);
    return { added_minutes: Math.round(ms / 60000) };
  },
});
