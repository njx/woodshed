import { clampBpm } from './tempo.js';

// A metronome on the Web Audio clock. A timer wakes every 25 ms and schedules any clicks due in
// the next 120 ms at exact audio times, so the beat stays steady even if the page is busy.
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

const listeners = new Set();
const state = { running: false, bpm: 100, beats: 4, beat: 0, itemId: null };
let ctx = null;
let timer = null;
let nextTime = 0;
let nextBeat = 0;
let queue = []; // scheduled beats [{ time, beat }] for the visuals
let wakeLock = null;

export const metronome = {
  get state() { return { ...state }; },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  // Must be called from a tap, so the phone allows audio.
  start({ bpm, beats, itemId } = {}) {
    if (bpm) state.bpm = clampBpm(bpm);
    if (beats) state.beats = beats;
    state.itemId = itemId ?? state.itemId;
    if (state.running) return emit();
    const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
    ctx = new Ctx();
    ctx.resume?.();
    // Play through the iPhone's silent switch, like a music app (Safari 17+).
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
    state.running = true;
    nextBeat = 0;
    nextTime = ctx.currentTime + 0.06;
    queue = [];
    timer = setInterval(schedule, LOOKAHEAD_MS);
    schedule();
    navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
    emit();
  },
  stop() {
    if (!state.running) return;
    state.running = false;
    clearInterval(timer);
    ctx?.close?.().catch(() => {});
    ctx = null;
    queue = [];
    try { if (navigator.audioSession) navigator.audioSession.type = 'auto'; } catch {}
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
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
  // The latest click that has sounded, for the visuals: { beat, since (seconds ago) } or null.
  lastClick() {
    if (!ctx) return null;
    const now = ctx.currentTime;
    while (queue.length > 1 && queue[1].time <= now) queue.shift();
    return queue.length && queue[0].time <= now ? { beat: queue[0].beat, since: now - queue[0].time } : null;
  },
};

function emit() {
  for (const fn of listeners) fn(metronome.state);
}

function schedule() {
  if (!ctx) return;
  while (nextTime < ctx.currentTime + SCHEDULE_AHEAD_S) {
    click(nextTime, nextBeat === 0 && state.beats > 1);
    queue.push({ time: nextTime, beat: nextBeat });
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
