import { store, save, flush } from './store.js';
import { today } from './dates.js';
import { uid } from './util.js';

// Practice time: sessions of { id, date (the practice day it started on), start, end (ms) }, in
// state.sessions; state.timing is the id of the one running, or null.
//
// While the timer runs, its end is moved up to now every half minute the app is open, and when
// the app is hidden. So if the app is closed or the phone sleeps, the session ends when the app
// was last seen. Coming back soon (say, after playing along in another app) carries on the same
// session, counting the time away; after longer, the timer has stopped at that point (marked
// `away`), and the time away can still be counted (countTimeAway).

export const HEARTBEAT_MS = 30 * 1000;
export const AWAY_MS = 15 * 60 * 1000; // away longer than this: the timer stops when last seen
const MAX_AWAY_MS = 4 * 3600 * 1000; // the time away can be counted up to this long after

const sessions = () => (store.state.sessions ||= []);
export const running = () => (store.state.timing && sessions().find((s) => s.id === store.state.timing)) || null;

export function startPractice(now = Date.now()) {
  const r = running();
  if (r) return r;
  const s = { id: uid(), date: today(new Date(now)), start: now, end: now };
  sessions().push(s);
  store.state.timing = s.id;
  save();
  return s;
}

export function endPractice(now = Date.now()) {
  const s = running();
  if (!s) return null;
  s.end = Math.max(s.end, now);
  store.state.timing = null;
  save();
  return s;
}

// Called every HEARTBEAT_MS while the app is open, when it's hidden and when it comes back.
// Returns 'stopped' if the timer stopped because the app was away too long (or the practice day
// ended). Moving the end up isn't an edit, so it doesn't save(): an Undo on offer stays usable.
export function heartbeat(now = Date.now()) {
  const s = running();
  if (!s) return null;
  if (now - s.end > AWAY_MS || today(new Date(now)) !== s.date) {
    s.away = true;
    store.state.timing = null;
    save();
    return 'stopped';
  }
  s.end = Math.max(s.end, now);
  flush();
  return null;
}

// Today's last session, if the timer stopped while the app was away and that can still be undone.
export function awayStop(now = Date.now()) {
  if (running()) return null;
  const s = sessions().at(-1);
  return s?.away && s.date === today(new Date(now)) && now - s.end < MAX_AWAY_MS ? s : null;
}

// Count the time the app was away as practice too: the stopped session carries on until now.
export function countTimeAway(now = Date.now()) {
  const s = awayStop(now);
  if (!s) return null;
  delete s.away;
  s.end = now;
  store.state.timing = s.id;
  save();
  return s;
}

// Milliseconds practiced on a practice day (the running session up to now).
export function practicedMs(date = today(), now = Date.now()) {
  let ms = 0;
  for (const s of sessions()) {
    if (s.date !== date) continue;
    ms += (s.id === store.state.timing ? Math.max(s.end, now) : s.end) - s.start;
  }
  return ms;
}

// Milliseconds practiced per day: Map date → ms.
export function practicedByDay(now = Date.now()) {
  const m = new Map();
  for (const s of sessions()) {
    const end = s.id === store.state.timing ? Math.max(s.end, now) : s.end;
    m.set(s.date, (m.get(s.date) || 0) + end - s.start);
  }
  return m;
}

// "45 min", "1 h 5 min"; under a minute: "<1 min".
export function fmtDuration(ms) {
  const min = Math.round(ms / 60000);
  if (min < 1) return '<1 min';
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

// A running clock: "4:05", "1:02:09".
export function fmtClock(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Marking something played starts the timer, if it hasn't been started (or stopped) today.
export function autoStart(now = Date.now()) {
  if (running() || sessions().some((s) => s.date === today(new Date(now)))) return null;
  return startPractice(now);
}
