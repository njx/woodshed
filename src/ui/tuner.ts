import { store, save } from '../store.js';
import { TRANSPOSITIONS } from '../constants.js';
import { concertName, writtenName } from '../pitch.js';
import { tuner, TRACE_SECONDS } from '../tuning.js';
import { ICON, closeSheet } from './shell.js';
import { customElement, state } from 'lit/decorators.js';
import { View, html, svg, raw, openSheetView, type TemplateResult } from './lit.js';
import type { TracePoint } from '../tuning.js';

// Tuner: a dial for the note you're playing now, and a trace of the last few seconds underneath
// (handy for long tones: you can see the pitch sag at the end of a breath).
// Notes are named as written for the transposition being viewed.

const IN_TUNE = 5; // cents either side that count as in tune
const HOLD_MS = 600; // keep showing the last note this long after the sound stops

export function openTuner(opts: { back?: () => void } = {}) {
  const el = document.createElement('ws-tuner') as TunerSheet;
  openSheetView(el, () => {
    if (!el.mini) tuner.stop(); // (closing to the mini tuner keeps it listening)
    opts.back?.();
  });
}

interface Reading { note: TemplateResult; cents: string; hz: string; good: boolean; near: boolean }

@customElement('ws-tuner')
export class TunerSheet extends View {
  @state() a4 = 440;
  @state() reading: Reading | null = null; // the note being played (held a moment after it stops)
  @state() heard = false; // anything yet
  @state() error = false; // no microphone
  mini = false;
  private raf: number | null = null;
  private unsub: (() => void) | null = null;
  private shown = 0; // needle angle, eased
  private lastText = 0;

  connectedCallback() {
    super.connectedCallback();
    this.a4 = store.state.settings.a4 || 440;
    this.unsub = tuner.subscribe((st) => { this.error = !!st.error; });
    tuner.setMini(false); // the full tuner instead, while it's open
    tuner.start();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (now - this.lastText >= 30) {
        this.lastText = now;
        if (!this.error) this.read(now);
      }
      this.drawNeedle();
      this.drawTrace(now);
    };
    this.raf = requestAnimationFrame(loop);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    cancelAnimationFrame(this.raf ?? 0);
    this.unsub?.();
  }
  setA4(d: number) {
    this.a4 = Math.max(430, Math.min(450, this.a4 + d));
    store.state.settings.a4 = this.a4;
    save();
  }
  // Keep listening in a small tuner on top of everything, and go back to the set.
  toMini() {
    if (!tuner.state.running) return;
    this.mini = true;
    tuner.setMini(true);
    closeSheet();
  }

  render() {
    const view = store.state.settings.view;
    const r = this.reading;
    return html`
      <div class="row-label tuner-head"><p class="eyebrow">Tuner${view !== 'c' ? ` · ${TRANSPOSITIONS[view].label} instrument` : ''}</p>
        <button class="link-btn" id="t-mini" @click=${() => this.toMini()}>${raw(ICON.tuner)}Mini tuner</button></div>
      <div class="tuner-dial ${r ? 'live' : ''} ${r?.good ? 'good' : ''} ${r?.near ? 'near' : ''}" id="t-dial">
        <svg viewBox="-100 -100 200 200" aria-hidden="true">
          <circle class="t-ring" r="88"/>
          ${ticks()}
          <g id="t-needle" class="t-needle"><line x1="0" y1="-60" x2="0" y2="-96"/><circle cy="-88" r="7"/></g>
        </svg>
        <div class="t-readout">
          <b id="t-note">${r ? r.note : '–'}</b>
          <span id="t-cents">${this.error ? 'No microphone' : r ? r.cents : this.heard ? '' : 'Play a note'}</span>
        </div>
      </div>
      <canvas class="tuner-trace" id="t-trace" aria-label="Pitch over the last ${TRACE_SECONDS} seconds"></canvas>
      <div class="tuner-foot">
        <span id="t-hz" class="fine">${r ? r.hz : ''}</span>
        <div class="t-a4">
          <button class="pill-btn" data-a4="-1" aria-label="Lower reference" @click=${() => this.setA4(-1)}>−</button>
          <span>A = <b id="t-a4">${this.a4}</b> Hz</span>
          <button class="pill-btn" data-a4="1" aria-label="Raise reference" @click=${() => this.setA4(1)}>+</button>
        </div>
      </div>
      <p class="fine" id="t-msg">${this.error ? 'The tuner needs the microphone. Allow it in your browser’s settings and try again.'
        : view !== 'c' ? `Notes are shown as written for ${TRANSPOSITIONS[view].label}, with concert pitch underneath.` : ''}</p>
    `;
  }

  read(now: number) {
    const last = tuner.last;
    if (last) this.heard = true;
    if (!last || now - last.at >= HOLD_MS) { this.reading = null; return; }
    const view = store.state.settings.view;
    const c = Math.round(last.cents);
    this.reading = {
      note: view === 'c'
        ? html`${writtenName(last.midi)}<sub>${Math.floor(last.midi / 12) - 1}</sub>`
        : html`${writtenName(last.midi, view)}<small>concert ${concertName(last.midi)}</small>`,
      cents: Math.abs(c) <= IN_TUNE ? 'In tune' : `${c > 0 ? '+' : '−'}${Math.abs(c)} cents ${c > 0 ? 'sharp' : 'flat'}`,
      hz: `${last.hz.toFixed(1)} Hz`,
      good: Math.abs(last.cents) <= IN_TUNE,
      near: Math.abs(last.cents) > IN_TUNE && Math.abs(last.cents) <= 15,
    };
  }

  drawNeedle() {
    const needle = this.querySelector('#t-needle');
    if (!needle) return;
    const last = tuner.last;
    const live = last && performance.now() - last.at < HOLD_MS;
    const target = live ? Math.max(-50, Math.min(50, last.cents)) * 1.2 : 0; // ±50 cents = ±60°
    this.shown += (target - this.shown) * 0.25;
    needle.setAttribute('transform', `rotate(${this.shown.toFixed(2)})`);
  }

  // The trace: newest on the right, in tune along the middle, ±50 cents top to bottom.
  drawTrace(now: number) {
    const canvas = this.querySelector<HTMLCanvasElement>('#t-trace');
    if (!canvas) return;
    const g = canvas.getContext('2d')!; // (a 2d context is always there for a canvas)
    const view = store.state.settings.view;
    const dpr = devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(canvas);
    const y = (c: number) => h / 2 - (Math.max(-50, Math.min(50, c)) / 50) * (h / 2 - 6);
    const x = (t: number) => w - ((now - t) / (TRACE_SECONDS * 1000)) * w;
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
    let prev: TracePoint | null = null; // (only ever a point with a note: cents and midi set)
    for (const p of tuner.trace) {
      if (p.cents == null) { prev = null; continue; } // (midi is null just when cents is)
      if (!prev || prev.midi !== p.midi) {
        g.fillStyle = css.getPropertyValue('--t-label');
        g.fillText(view === 'c' ? concertName(p.midi!) : writtenName(p.midi!, view), Math.max(2, x(p.t) + 3), 14);
        prev = null;
      }
      if (prev) {
        const good = Math.abs(p.cents) <= IN_TUNE;
        g.strokeStyle = css.getPropertyValue(good ? '--t-good' : '--t-line');
        g.beginPath(); g.moveTo(x(prev.t), y(prev.cents!)); g.lineTo(x(p.t), y(p.cents)); g.stroke();
      }
      prev = p;
    }
  }
}

// The mini tuner: while it's on, a small pill on every screen with the note and how far off it is.
// Tap it for the full tuner; × stops listening.
export function mountTunerPill() {
  document.body.appendChild(document.createElement('ws-tuner-pill'));
}

@customElement('ws-tuner-pill')
export class TunerPill extends View {
  @state() on = false;
  private raf: number | null = null;
  private shown = 0;
  connectedCallback() {
    super.connectedCallback();
    tuner.subscribe((st) => {
      this.on = st.running && st.mini;
      document.body.classList.toggle('has-tuner-pill', this.on);
      cancelAnimationFrame(this.raf ?? 0);
      if (this.on) this.raf = requestAnimationFrame(() => this.tick());
    });
  }
  // The note and the dot that shows how far off it is (from an animation frame).
  tick() {
    const pill = this.querySelector<HTMLElement>('.tuner-pill');
    if (!pill) return;
    const last = tuner.last;
    const live = last && performance.now() - last.at < HOLD_MS;
    pill.querySelector('.tp-note')!.textContent = live ? writtenName(last.midi, store.state.settings.view) : '–';
    const target = live ? Math.max(-50, Math.min(50, last.cents)) : 0;
    this.shown += (target - this.shown) * 0.3;
    pill.querySelector<HTMLElement>('.tp-dot')!.style.left = `${50 + this.shown}%`;
    pill.classList.toggle('live', !!live);
    pill.classList.toggle('good', !!live && Math.abs(last.cents) <= IN_TUNE);
    pill.classList.toggle('near', !!live && Math.abs(last.cents) > IN_TUNE && Math.abs(last.cents) <= 15);
    this.raf = requestAnimationFrame(() => this.tick());
  }
  render() {
    return html`<div class="tuner-pill" ?hidden=${!this.on}>
      <button class="tp-open" aria-label="Open the tuner" @click=${() => openTuner()}><b class="tp-note">–</b>
        <span class="tp-meter" aria-hidden="true"><i class="tp-zero"></i><i class="tp-dot"></i></span></button>
      <button class="tp-stop" aria-label="Stop the tuner" @click=${() => tuner.stop()}>${raw(ICON.skip)}</button></div>`;
  }
}

function ticks() {
  const lines = [];
  for (let c = -50; c <= 50; c += 10) {
    const big = c % 50 === 0 || c === 0;
    lines.push(svg`<line class="t-tick ${c === 0 ? 'zero' : ''}" x1="0" y1=${big ? -74 : -78} x2="0" y2="-84" transform="rotate(${c * 1.2})"/>`);
  }
  return svg`${lines}<text class="t-lbl" x="-58" y="-22">♭</text><text class="t-lbl" x="50" y="-22">♯</text>`;
}
