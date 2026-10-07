import { store } from './store.js';
import { todaysEntry, latestPerDay } from './practice.js';

// Working tempo per tune or exercise (t.tempo, in quarter-note BPM) and an optional goal
// (t.goalTempo). Each logged session records the tempo it was played at (entry.bpm).
export const MIN_BPM = 30;
export const MAX_BPM = 300;
export const clampBpm = (b) => Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(b)));

// Up about 5% (at least 2); down to the next multiple of 5 below (120 → 115, 123 → 120).
export const stepUp = (b, goal) => {
  const next = clampBpm(b + Math.max(2, Math.round(b * 0.05)));
  return goal && b < goal ? Math.min(next, goal) : next;
};
export const stepDown = (b) => clampBpm(Math.ceil(b / 5) * 5 - 5);

// Solid twice in a row at the working tempo: speed up. Rough once: slow down.
export const SOLID_TO_SPEED_UP = 2;

// Change the working tempo. Sessions before this no longer count toward suggestions.
// Adjusting it while practicing (e.g. on the metronome) also updates today's session;
// accepting a suggestion (nextTime) is for next time, so today's session keeps its tempo.
export function setTempo(t, bpm, { nextTime = false } = {}) {
  t.tempo = bpm == null ? null : clampBpm(bpm);
  const e = todaysEntry(t.id);
  if (e && t.tempo && !nextTime) {
    e.bpm = t.tempo;
    t.tempoSetAt = Math.min(Date.now(), e.at || Date.now()); // today's session still counts
  } else {
    t.tempoSetAt = Date.now();
  }
}

export function tempoSuggestion(t, log = store.state.log) {
  if (!t.tempo) return null;
  const recent = latestPerDay(log
    .filter((e) => e.itemId === t.id && e.bpm === t.tempo && (e.at || 0) >= (t.tempoSetAt || 0))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0)));
  if (!recent.length) return null;
  if (recent[0].rating === 'rough') {
    const to = stepDown(t.tempo);
    return to < t.tempo ? { to, up: false, text: `Rough at ${t.tempo} bpm — slow down to ${to}?` } : null;
  }
  const solids = recent.slice(0, SOLID_TO_SPEED_UP);
  if (solids.length === SOLID_TO_SPEED_UP && solids.every((e) => e.rating === 'solid')) {
    if (t.goalTempo && t.tempo >= t.goalTempo) {
      return { to: null, up: true, done: true, text: `Solid at your goal of ${t.goalTempo} bpm 🎉` };
    }
    const to = stepUp(t.tempo, t.goalTempo);
    return { to, up: true, text: `Solid twice at ${t.tempo} bpm — try ${to}?` };
  }
  return null;
}

// Tap tempo: BPM from recent tap times (ms). Taps more than 2 seconds apart start over.
export function tapBpm(taps) {
  const recent = [];
  for (let i = taps.length - 1; i > 0 && recent.length < 4; i--) {
    const gap = taps[i] - taps[i - 1];
    if (gap > 2000) break;
    recent.push(gap);
  }
  if (!recent.length) return null;
  return clampBpm(60000 / (recent.reduce((a, b) => a + b, 0) / recent.length));
}
