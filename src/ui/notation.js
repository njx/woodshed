import { buildAbc } from '../abc.js';

// abcjs is large, so it's only loaded when notation is first shown.
let abcjsPromise = null;
const loadAbcjs = () => (abcjsPromise ||= import('abcjs').then((m) => m.default || m));

// Draws notation (written in C) shifted up `shift` semitones. Returns the abcjs tune object.
export async function renderNotation(el, body, { shift = 0, meter = '4/4', tempo = 100 } = {}) {
  const ABCJS = await loadAbcjs();
  const [tune] = ABCJS.renderAbc(el, buildAbc(body, { meter, tempo }), {
    visualTranspose: shift,
    responsive: 'resize',
    add_classes: true,
    paddingtop: 0,
    paddingbottom: 0,
    paddingleft: 0,
    paddingright: 0,
    staffwidth: 520,
  });
  return tune;
}

// One thing plays at a time.
let current = null;
export function stopPlayback() {
  current?.stop();
  current = null;
}

// Plays a rendered tune `transpose` semitones from what's written (abcjs doesn't apply the
// visual shift to the sound). Notes are synthesized in the browser, so playback needs no
// downloads and works offline. Call from a tap, so the phone allows audio.
export async function playNotation(tune, { transpose = 0, tempo, onEnded } = {}) {
  stopPlayback();
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) throw new Error('no audio');
  const ctx = new Ctx();
  await ctx.resume?.();
  const audio = tune.setUpAudio({ midiTranspose: transpose });
  const secPerWhole = 240 / (tempo || audio.tempo || 100);
  const out = ctx.createGain();
  out.gain.value = 0.22;
  const tone = ctx.createBiquadFilter(); // soften the sawtooth into something reedy
  tone.type = 'lowpass';
  tone.frequency.value = 2400;
  tone.connect(out).connect(ctx.destination);

  const t0 = ctx.currentTime + 0.08;
  const oscs = [];
  for (const track of audio.tracks) {
    for (const ev of track) {
      if (ev.cmd !== 'note' || ev.pitch == null) continue;
      const start = t0 + ev.start * secPerWhole;
      const end = start + Math.max(0.05, ev.duration * secPerWhole - 0.02);
      const freq = 440 * Math.pow(2, (ev.pitch - 69) / 12);
      const env = ctx.createGain();
      const peak = (ev.volume || 85) / 127;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(peak, start + 0.015);
      env.gain.setTargetAtTime(peak * 0.75, start + 0.015, 0.12);
      env.gain.setTargetAtTime(0, end, 0.03);
      env.connect(tone);
      for (const [type, level] of [['sawtooth', 0.35], ['triangle', 0.65]]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type;
        o.frequency.value = freq;
        g.gain.value = level;
        o.connect(g).connect(env);
        o.start(start);
        o.stop(end + 0.2);
        oscs.push(o);
      }
    }
  }
  const totalSec = (audio.totalDuration || 0) * secPerWhole + 0.4;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const o of oscs) { try { o.stop(); } catch {} }
    ctx.close?.().catch(() => {});
    if (current?.stop === stop) current = null;
  };
  const timer = setTimeout(() => { stop(); onEnded?.(); }, totalSec * 1000);
  current = { stop };
  return stop;
}
