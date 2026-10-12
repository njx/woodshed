import { store, save } from '../store.js';
import { TRANSPOSITIONS } from '../constants.js';
import { concertName, writtenName } from '../pitch.js';
import { tuner, TRACE_SECONDS } from '../tuning.js';
import { $, ICON, openSheet, closeSheet } from './shell.js';

// Tuner: a dial for the note you're playing now, and a trace of the last few seconds underneath
// (handy for long tones: you can see the pitch sag at the end of a breath).
// Notes are named as written for the transposition being viewed.

const IN_TUNE = 5; // cents either side that count as in tune
const HOLD_MS = 600; // keep showing the last note this long after the sound stops

export function openTuner(opts = {}) {
  const settings = store.state.settings;
  const view = settings.view;
  let a4 = settings.a4 || 440;
  let mini = false; // closing to the mini tuner keeps it listening

  const sheet = openSheet(`
    <div class="row-label tuner-head"><p class="eyebrow">Tuner${view !== 'c' ? ` · ${TRANSPOSITIONS[view].label} instrument` : ''}</p>
      <button class="link-btn" id="t-mini">${ICON.tuner}Mini tuner</button></div>
    <div class="tuner-dial" id="t-dial">
      <svg viewBox="-100 -100 200 200" aria-hidden="true">
        <circle class="t-ring" r="88"/>
        ${ticks()}
        <g id="t-needle" class="t-needle"><line x1="0" y1="-60" x2="0" y2="-96"/><circle cy="-88" r="7"/></g>
      </svg>
      <div class="t-readout">
        <b id="t-note">–</b>
        <span id="t-cents">Play a note</span>
      </div>
    </div>
    <canvas class="tuner-trace" id="t-trace" aria-label="Pitch over the last ${TRACE_SECONDS} seconds"></canvas>
    <div class="tuner-foot">
      <span id="t-hz" class="fine"></span>
      <div class="t-a4">
        <button class="pill-btn" data-a4="-1" aria-label="Lower reference">−</button>
        <span>A = <b id="t-a4">${a4}</b> Hz</span>
        <button class="pill-btn" data-a4="1" aria-label="Raise reference">+</button>
      </div>
    </div>
    <p class="fine" id="t-msg">${view !== 'c' ? `Notes are shown as written for ${TRANSPOSITIONS[view].label}, with concert pitch underneath.` : ''}</p>
  `, () => {
    closed = true;
    cancelAnimationFrame(raf);
    unsub();
    if (!mini) tuner.stop();
    opts.back?.();
  });

  const needle = $('#t-needle', sheet);
  const dial = $('#t-dial', sheet);
  const noteEl = $('#t-note', sheet);
  const centsEl = $('#t-cents', sheet);
  const hzEl = $('#t-hz', sheet);
  const canvas = $('#t-trace', sheet);
  const g = canvas.getContext('2d');

  let closed = false;
  let raf = null;
  let shown = 0; // needle angle, eased
  let lastText = 0;

  sheet.querySelectorAll('[data-a4]').forEach((b) => (b.onclick = () => {
    a4 = Math.max(430, Math.min(450, a4 + Number(b.dataset.a4)));
    settings.a4 = a4;
    save();
    $('#t-a4', sheet).textContent = a4;
  }));
  // Keep listening in a small tuner on top of everything, and go back to the set.
  $('#t-mini', sheet).onclick = () => {
    if (!tuner.state.running) return;
    mini = true;
    tuner.setMini(true);
    closeSheet();
  };

  const unsub = tuner.subscribe((st) => {
    if (st.error) {
      $('#t-msg', sheet).textContent = 'The tuner needs the microphone. Allow it in your browser’s settings and try again.';
      centsEl.textContent = 'No microphone';
    }
  });
  tuner.setMini(false); // the full tuner instead, while it's open
  tuner.start();
  loop();

  function loop(now = performance.now()) {
    if (closed) return;
    raf = requestAnimationFrame(loop);
    if (now - lastText >= 30) {
      lastText = now;
      if (!tuner.state.error) showReading(now);
    }
    drawNeedle();
    drawTrace(now);
  }

  function showReading(now) {
    const last = tuner.last;
    const live = last && now - last.at < HOLD_MS;
    dial.classList.toggle('live', !!live);
    if (!live) {
      dial.classList.remove('good', 'near');
      centsEl.textContent = last ? '' : 'Play a note';
      hzEl.textContent = '';
      return;
    }
    const c = Math.round(last.cents);
    noteEl.innerHTML = view === 'c'
      ? `${writtenName(last.midi)}<sub>${Math.floor(last.midi / 12) - 1}</sub>`
      : `${writtenName(last.midi, view)}<small>concert ${concertName(last.midi)}</small>`;
    centsEl.textContent = Math.abs(c) <= IN_TUNE ? 'In tune' : `${c > 0 ? '+' : '−'}${Math.abs(c)} cents ${c > 0 ? 'sharp' : 'flat'}`;
    dial.classList.toggle('good', Math.abs(last.cents) <= IN_TUNE);
    dial.classList.toggle('near', Math.abs(last.cents) > IN_TUNE && Math.abs(last.cents) <= 15);
    hzEl.textContent = `${last.hz.toFixed(1)} Hz`;
  }

  function drawNeedle() {
    const last = tuner.last;
    const live = last && performance.now() - last.at < HOLD_MS;
    const target = live ? Math.max(-50, Math.min(50, last.cents)) * 1.2 : 0; // ±50 cents = ±60°
    shown += (target - shown) * 0.25;
    needle.setAttribute('transform', `rotate(${shown.toFixed(2)})`);
  }

  // The trace: newest on the right, in tune along the middle, ±50 cents top to bottom.
  function drawTrace(now) {
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(canvas);
    const y = (c) => h / 2 - (Math.max(-50, Math.min(50, c)) / 50) * (h / 2 - 6);
    const x = (t) => w - ((now - t) / (TRACE_SECONDS * 1000)) * w;
    // In-tune band and centre line.
    g.fillStyle = css.getPropertyValue('--t-band');
    g.fillRect(0, y(IN_TUNE), w, y(-IN_TUNE) - y(IN_TUNE));
    g.strokeStyle = css.getPropertyValue('--t-grid');
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    // The pitch line, broken at silences and note changes, with each note's name where it starts.
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    g.font = '600 12px system-ui, sans-serif';
    let prev = null;
    for (const p of tuner.trace) {
      if (p.cents == null) { prev = null; continue; }
      if (!prev || prev.midi !== p.midi) {
        g.fillStyle = css.getPropertyValue('--t-label');
        g.fillText(view === 'c' ? concertName(p.midi) : writtenName(p.midi, view), Math.max(2, x(p.t) + 3), 14);
        prev = null;
      }
      if (prev) {
        const good = Math.abs(p.cents) <= IN_TUNE;
        g.strokeStyle = css.getPropertyValue(good ? '--t-good' : '--t-line');
        g.beginPath(); g.moveTo(x(prev.t), y(prev.cents)); g.lineTo(x(p.t), y(p.cents)); g.stroke();
      }
      prev = p;
    }
  }
}

// The mini tuner: while it's on, a small pill on every screen with the note and how far off it is.
// Tap it for the full tuner; × stops listening.
export function mountTunerPill() {
  const pill = document.createElement('div');
  pill.className = 'tuner-pill';
  pill.hidden = true;
  pill.innerHTML = `
    <button class="tp-open" aria-label="Open the tuner"><b class="tp-note">–</b>
      <span class="tp-meter" aria-hidden="true"><i class="tp-zero"></i><i class="tp-dot"></i></span></button>
    <button class="tp-stop" aria-label="Stop the tuner">${ICON.skip}</button>`;
  document.body.appendChild(pill);
  const note = $('.tp-note', pill);
  const dot = $('.tp-dot', pill);
  let raf = null;
  let shown = 0;
  $('.tp-open', pill).onclick = () => openTuner();
  $('.tp-stop', pill).onclick = () => tuner.stop();
  const tick = () => {
    const last = tuner.last;
    const now = performance.now();
    const live = last && now - last.at < HOLD_MS;
    const view = store.state.settings.view;
    note.textContent = live ? writtenName(last.midi, view) : '–';
    const target = live ? Math.max(-50, Math.min(50, last.cents)) : 0;
    shown += (target - shown) * 0.3;
    dot.style.left = `${50 + shown}%`;
    pill.classList.toggle('live', !!live);
    pill.classList.toggle('good', !!live && Math.abs(last.cents) <= IN_TUNE);
    pill.classList.toggle('near', !!live && Math.abs(last.cents) > IN_TUNE && Math.abs(last.cents) <= 15);
    raf = requestAnimationFrame(tick);
  };
  tuner.subscribe((st) => {
    const on = st.running && st.mini;
    pill.hidden = !on;
    document.body.classList.toggle('has-tuner-pill', on);
    cancelAnimationFrame(raf);
    if (on) raf = requestAnimationFrame(tick);
  });
}

function ticks() {
  let s = '';
  for (let c = -50; c <= 50; c += 10) {
    const big = c % 50 === 0 || c === 0;
    s += `<line class="t-tick ${c === 0 ? 'zero' : ''}" x1="0" y1="${big ? -74 : -78}" x2="0" y2="-84" transform="rotate(${c * 1.2})"/>`;
  }
  return `${s}<text class="t-lbl" x="-58" y="-22">♭</text><text class="t-lbl" x="50" y="-22">♯</text>`;
}
