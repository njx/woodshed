import { buildAbc, barPerLine } from '../abc.js';
import { SOUNDS, SWING, sampleNotes, nearestSample, swingTime } from '../sounds.js';
import { store, save } from '../store.js';
import { esc } from '../util.js';
import { holdAudio } from '../audiosession.js';

// abcjs is large, so it's only loaded when notation is first shown.
let abcjsPromise = null;
const loadAbcjs = () => (abcjsPromise ||= import('abcjs').then((m) => m.default || m));

// Draws notation (written in C) shifted up `shift` semitones, one bar per line. Returns the abcjs
// tune object. The narrow staff width makes notes bigger once scaled to the screen.
// wide: more bars to a line (full screen, sideways).
export async function renderNotation(el, body, { shift = 0, meter = '4/4', tempo = 100, wide = false } = {}) {
  const ABCJS = await loadAbcjs();
  const [tune] = ABCJS.renderAbc(el, buildAbc(barPerLine(body, wide ? 2 : 1), { meter, tempo }), {
    visualTranspose: shift,
    responsive: 'resize',
    add_classes: true,
    paddingtop: 0,
    paddingbottom: 0,
    paddingleft: 0,
    paddingright: 0,
    staffwidth: wide ? 520 : 330, // scaled up to the width: bigger notes sideways
    jazzchords: true, // chord symbols set as in a lead sheet
  });
  return tune;
}

// Notation full screen, sideways: on a phone held upright the page is turned for you (turn the
// phone to read it); held sideways it just fills the screen. draw(el) renders into the page
// (wide); play() starts playback and returns a stop function, or null.
export function openFullNotation({ title, draw, play }) {
  const el = document.createElement('div');
  el.className = 'notation-full';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', title);
  el.innerHTML = `
    <div class="nf-page">
      <div class="nf-head"><b>${esc(title)}</b>
        <span class="nf-btns">${play ? '<button class="nf-play" aria-label="Play">▶</button>' : ''}<button class="nf-close" aria-label="Close">✕</button></span></div>
      <div class="notation nf-notation"></div>
    </div>`;
  document.body.appendChild(el);
  const page = el.querySelector('.nf-page');
  const box = el.querySelector('.nf-notation');
  let stop = null;
  const layout = () => {
    const w = window.innerWidth, h = window.innerHeight;
    const upright = h > w;
    el.classList.toggle('turned', upright);
    page.style.width = `${upright ? h : w}px`;
    page.style.height = `${upright ? w : h}px`;
    draw(box);
  };
  const close = () => {
    stop?.();
    window.removeEventListener('resize', layout);
    document.removeEventListener('keydown', onKey);
    el.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  window.addEventListener('resize', layout);
  document.addEventListener('keydown', onKey);
  el.querySelector('.nf-close').onclick = close;
  const playBtn = el.querySelector('.nf-play');
  if (playBtn) playBtn.onclick = async () => {
    if (stop) { stop(); stop = null; playBtn.textContent = '▶'; return; }
    playBtn.textContent = '■';
    stop = await play(() => { stop = null; playBtn.textContent = '▶'; });
    if (!stop) playBtn.textContent = '▶';
  };
  layout();
  return close;
}

// One thing plays at a time.
let current = null;
export function stopPlayback() {
  current?.stop();
  current = null;
}

// Decoded samples, per sound: { midi: AudioBuffer }. Loaded the first time a sound is used; the
// service worker keeps the files for offline use.
const loaded = new Map();
function loadSamples(ctx, id) {
  if (!loaded.has(id)) {
    const p = Promise.all(sampleNotes(id).map(async (m) => {
      const res = await fetch(`samples/${id}/${m}.mp3`);
      if (!res.ok) throw new Error(`sample ${id}/${m}: ${res.status}`);
      const data = await res.arrayBuffer();
      return [m, await new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject))];
    })).then(Object.fromEntries);
    p.catch(() => loaded.delete(id)); // try again next time
    loaded.set(id, p);
  }
  return loaded.get(id);
}

// Plays a rendered tune `transpose` semitones from what's written (abcjs doesn't apply the
// visual shift to the sound), with a recorded instrument or the synth, straight or swung.
// Call from a tap, so the phone allows audio. onFallback(sound) is called if a recorded sound
// couldn't be loaded (offline before it was ever used) and the synth plays instead.
export async function playNotation(tune, { transpose = 0, tempo, sound = 'piano', swing = 'straight', onEnded, onFallback } = {}) {
  stopPlayback();
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) throw new Error('no audio');
  const ctx = new Ctx();
  // Play through the iPhone's silent switch, like the metronome (otherwise it's silent with the
  // ringer off).
  const releaseAudio = holdAudio('playback');
  try { await ctx.resume?.(); } catch { /* resumes on its own, or not at all */ }
  let voice = SOUNDS[sound] ? sound : 'synth';
  let samples = null;
  if (voice !== 'synth') {
    try {
      samples = await loadSamples(ctx, voice);
    } catch (err) {
      console.warn('Could not load sound', voice, err);
      onFallback?.(voice);
      voice = 'synth';
    }
  }
  let audio;
  try {
    audio = tune.setUpAudio({ midiTranspose: transpose, chordsOff: true }); // the line itself, not comping
  } catch (err) {
    releaseAudio();
    ctx.close?.().catch(() => {});
    throw err;
  }
  const secPerBeat = 60 / (tempo || audio.tempo || 100);
  const ratio = SWING[swing]?.ratio ?? 0.5;
  // abcjs times are in whole notes; a beat is a quarter note.
  const at = (whole) => swingTime(whole * 4, ratio) * secPerBeat;

  const out = ctx.createGain();
  out.connect(ctx.destination);
  let synthIn = null;
  if (voice === 'synth') {
    out.gain.value = 0.22;
    synthIn = ctx.createBiquadFilter(); // soften the sawtooth into something reedy
    synthIn.type = 'lowpass';
    synthIn.frequency.value = 2400;
    synthIn.connect(out);
  } else out.gain.value = 0.9;

  const t0 = ctx.currentTime + 0.08;
  const sources = [];
  const release = SOUNDS[voice].release;
  for (const track of audio.tracks) {
    for (const ev of track) {
      if (ev.cmd !== 'note' || ev.pitch == null) continue;
      const start = t0 + at(ev.start);
      const end = Math.max(start + 0.05, t0 + at(ev.start + ev.duration) - 0.02);
      const peak = (ev.volume || 85) / 127;
      const env = ctx.createGain();
      if (voice === 'synth') {
        env.gain.setValueAtTime(0, start);
        env.gain.linearRampToValueAtTime(peak, start + 0.015);
        env.gain.setTargetAtTime(peak * 0.75, start + 0.015, 0.12);
        env.gain.setTargetAtTime(0, end, release);
        env.connect(synthIn);
        const freq = 440 * Math.pow(2, (ev.pitch - 69) / 12);
        for (const [type, level] of [['sawtooth', 0.35], ['triangle', 0.65]]) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = type;
          o.frequency.value = freq;
          g.gain.value = level;
          o.connect(g).connect(env);
          o.start(start);
          o.stop(end + 0.2);
          sources.push(o);
        }
      } else {
        const m = nearestSample(voice, ev.pitch);
        const src = ctx.createBufferSource();
        src.buffer = samples[m];
        src.playbackRate.value = Math.pow(2, (ev.pitch - m) / 12);
        env.gain.setValueAtTime(peak, start);
        env.gain.setTargetAtTime(0, end, release);
        src.connect(env).connect(out);
        src.start(start);
        src.stop(end + release * 6);
        sources.push(src);
      }
    }
  }
  const totalSec = at(audio.totalDuration || 0) + 0.5;
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const o of sources) { try { o.stop(); } catch {} }
    ctx.close?.().catch(() => {});
    releaseAudio();
    if (current?.stop === stop) current = null;
  };
  const timer = setTimeout(() => { stop(); onEnded?.(); }, totalSec * 1000);
  current = { stop };
  return stop;
}

// ---------- Sound and feel, chosen next to a Play button ----------

export function playbackOptionsHtml() {
  const s = store.state.settings;
  const opt = (map, cur) => Object.entries(map).map(([id, x]) => `<option value="${id}" ${id === cur ? 'selected' : ''}>${esc(x.label)}</option>`).join('');
  return `<select class="pb-select" data-pb="sound" aria-label="Sound">${opt(SOUNDS, s.sound)}</select>
    <select class="pb-select" data-pb="swing" aria-label="Feel">${opt(SWING, s.swing)}</select>`;
}

// onChange runs after a choice is made (e.g. to stop what's playing).
export function bindPlaybackOptions(root, onChange) {
  root.querySelectorAll('[data-pb]').forEach((sel) => (sel.onchange = () => {
    store.state.settings[sel.dataset.pb] = sel.value;
    save();
    onChange?.();
  }));
}

// The sound and feel to play notation in this meter with (6/8 and other x/8 meters aren't swung).
export function playbackFor(meter = '4/4') {
  const s = store.state.settings;
  return { sound: s.sound, swing: /\/8$/.test(meter) ? 'straight' : s.swing };
}
