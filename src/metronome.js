import { clampBpm } from './tempo.js';
import { holdAudio } from './audiosession.js';
import { keepAwake } from './keepawake.js';
import { walkingLine, pluck } from './bass.js';

// A metronome on the Web Audio clock. A timer wakes every 25 ms and schedules any clicks due in
// the next 120 ms at exact audio times, so the beat stays steady even if the page is busy.
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

const listeners = new Set();
// bass: a walking bass with the click (see bass.js): { chords, owner (who started it), label },
// played round and round; click: with the bass, 'all' beats, 'twofour' (2 and 4) or 'off'.
const state = { running: false, bpm: 100, beats: 4, beat: 0, itemId: null, bass: null, click: 'twofour' };
let line = [];
let lineAt = 0;
let ctx = null;
let timer = null;
let nextTime = 0;
let nextBeat = 0;
let queue = []; // scheduled beats [{ time, beat }] for the visuals
let releaseAwake = null;
let releaseAudio = null;

export const metronome = {
  get state() { return { ...state }; },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  // Must be called from a tap, so the phone allows audio.
  start({ bpm, beats, itemId, bass = null, click } = {}) {
    if (bpm) state.bpm = clampBpm(bpm);
    if (beats) state.beats = beats;
    if (itemId !== undefined) state.itemId = itemId; // null: not for an item
    if (click) state.click = click;
    state.bass = bass;
    line = bass ? walkingLine(bass.chords) : [];
    lineAt = 0;
    if (state.running) { nextBeat = 0; return emit(); } // (from the top of the bar, and the line)
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    ctx = new Ctx();
    ctx.resume?.();
    // iOS pauses ("interrupts") the audio when the mic starts (recorder, tuner) or a call comes
    // in; pick up again rather than go quiet while it still says it's running.
    const mine = ctx;
    ctx.onstatechange = () => {
      if (ctx === mine && state.running && mine.state !== 'running' && mine.state !== 'closed') mine.resume?.().catch(() => {});
    };
    // Play through the iPhone's silent switch, like a music app.
    releaseAudio = holdAudio('playback');
    state.running = true;
    nextBeat = 0;
    nextTime = ctx.currentTime + 0.06;
    queue = [];
    timer = setInterval(schedule, LOOKAHEAD_MS);
    schedule();
    releaseAwake = keepAwake();
    emit();
  },
  stop() {
    if (!state.running) return;
    state.running = false;
    state.bass = null;
    line = [];
    clearInterval(timer);
    ctx?.close?.().catch(() => {});
    ctx = null;
    queue = [];
    releaseAudio?.();
    releaseAudio = null;
    releaseAwake?.();
    releaseAwake = null;
    emit();
  },
  toggle(opts) {
    if (state.running) this.stop();
    else this.start(opts);
  },
  setBpm(bpm) {
    state.bpm = clampBpm(bpm);
    emit();
  },
  setBeats(beats) {
    state.beats = beats;
    nextBeat = 0;
    emit();
  },
  setItem(itemId) {
    state.itemId = itemId;
  },
  setClick(click) {
    state.click = click;
    emit();
  },
  // The latest click that has sounded, for the visuals: { beat, since (seconds ago) } or null.
  lastClick() {
    if (!ctx) return null;
    const now = ctx.currentTime;
    while (queue.length > 1 && queue[1].time <= now) queue.shift();
    return queue.length && queue[0].time <= now ? { beat: queue[0].beat, since: now - queue[0].time, at: queue[0].at } : null;
  },
  // With the bass: the beat of its line sounding now (counted from the top of its chords), or -1.
  bassBeat() {
    const c = state.bass ? this.lastClick() : null;
    return c?.at ?? -1;
  },
};

function emit() {
  for (const fn of listeners) fn(metronome.state);
}

function schedule() {
  if (!ctx) return;
  // After the timer was throttled (screen off, app in background), skip the missed clicks
  // rather than playing them all at once.
  if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;
  while (nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
    const accent = nextBeat === 0 && state.beats > 1;
    let at = null;
    if (line.length) {
      at = lineAt;
      pluck(ctx, line[at].midi, nextTime, 60 / state.bpm);
      lineAt = (lineAt + 1) % line.length;
      if (state.click === 'all') click(nextTime, accent);
      else if (state.click === 'twofour' && nextBeat % 2 === 1) click(nextTime, false);
    } else click(nextTime, accent);
    queue.push({ time: nextTime, beat: nextBeat, at });
    nextTime += 60 / state.bpm;
    nextBeat = (nextBeat + 1) % state.beats;
  }
}

// A short woodblock-ish click; higher and louder on the downbeat.
function click(time, accent) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.value = accent ? 1760 : 1100;
  gain.gain.setValueAtTime(0, time);
  gain.gain.linearRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.045);
  const tone = ctx.createBiquadFilter();
  tone.type = 'bandpass';
  tone.frequency.value = accent ? 1760 : 1100;
  tone.Q.value = 4;
  osc.connect(tone).connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.06);
}

// In the background the phone slows the timer down, so the clicks would drift: stop, and keep
// what it was doing so the app can offer to start it again (takeAwayStop).
let stoppedAway = null;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && state.running) {
    stoppedAway = { bpm: state.bpm, beats: state.beats, itemId: state.itemId, bass: state.bass, click: state.click };
    metronome.stop();
  }
});
// What was stopped when the app went into the background (once), or null.
export function takeAwayStop() {
  const s = stoppedAway;
  stoppedAway = null;
  return s;
}
