import { store } from './store.js';
import { constraints } from './media.js';
import { detectPitch, noteOf } from './pitch.js';
import { holdAudio } from './audiosession.js';
import { keepAwake } from './keepawake.js';

// The tuner's listening, apart from how it's shown: the full tuner (ui/tuner.js) and the mini one
// that stays on screen while you go through today's set both read from here. It listens until
// stopped; the screen stays on meanwhile.

export const TRACE_SECONDS = 10;
const DETECT_MS = 30;

const listeners = new Set();
const st = { running: false, error: false, mini: false };
let ctx = null;
let stream = null;
let analyser = null;
let buf = null;
let timer = null;
let releaseAudio = null;
let releaseAwake = null;
let last = null; // { midi, cents, hz, at } (at: performance.now())
const trace = []; // { t, cents, midi } (cents null = no note)

export const tuner = {
  get state() { return { ...st }; },
  // The latest reading (or null), and the last few seconds of them.
  get last() { return last; },
  trace,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  // Call from a tap, so the phone lets the audio start.
  async start() {
    if (st.running) return;
    st.running = true;
    st.error = false;
    emit();
    try {
      ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
      // A session that allows the mic alongside playback (the metronome keeps clicking).
      releaseAudio = holdAudio('record');
      releaseAwake = keepAwake();
      const s = await navigator.mediaDevices.getUserMedia({ audio: constraints('audio').audio });
      if (!st.running) return s.getTracks().forEach((tr) => tr.stop()); // stopped meanwhile
      stream = s;
      await ctx.resume().catch(() => {});
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      buf = new Float32Array(analyser.fftSize);
      ctx.createMediaStreamSource(stream).connect(analyser);
      timer = setInterval(detect, DETECT_MS);
    } catch (err) {
      console.warn('Tuner could not use the mic', err);
      teardown();
      st.running = false;
      st.error = true;
      emit();
    }
  },
  stop() {
    if (!st.running && !st.mini) return;
    teardown();
    st.running = false;
    st.mini = false;
    emit();
  },
  // Shown small on every screen (true), or only in its sheet.
  setMini(mini) {
    if (st.mini === mini) return;
    st.mini = mini;
    emit();
  },
};

function emit() {
  for (const fn of listeners) fn(tuner.state);
}

function teardown() {
  clearInterval(timer);
  timer = null;
  stream?.getTracks().forEach((tr) => tr.stop());
  stream = null;
  ctx?.close().catch(() => {});
  ctx = null;
  analyser = null;
  releaseAudio?.();
  releaseAudio = null;
  releaseAwake?.();
  releaseAwake = null;
  last = null;
  trace.length = 0;
}

function detect() {
  if (!analyser) return;
  const now = performance.now();
  analyser.getFloatTimeDomainData(buf);
  const p = detectPitch(buf, ctx.sampleRate);
  if (p && p.clarity > 0.8) {
    const n = noteOf(p.hz, store.state.settings.a4 || 440);
    // Smooth out jitter: average with the previous reading of the same note.
    const cents = last && last.midi === n.midi && now - last.at < 200 ? last.cents * 0.6 + n.cents * 0.4 : n.cents;
    last = { midi: n.midi, cents, hz: p.hz, at: now };
    trace.push({ t: now, cents, midi: n.midi });
  } else {
    trace.push({ t: now, cents: null, midi: null });
  }
  while (trace.length && now - trace[0].t > TRACE_SECONDS * 1000) trace.shift();
}
