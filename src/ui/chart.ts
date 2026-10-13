import { store, save } from '../store.js';
import { TRANSPOSITIONS } from '../constants.js';
import { dateStr } from '../dates.js';
import { isMinor } from '../keys.js';
import { chartFor, chartSource, seedChart, loadSeedCharts } from '../charts.js';
import { chordName, chartShift, usesSharps, chartToText, chartFromText, progressions, noteName } from '../chords.js';
import { chartChords, chartBars } from '../bass.js';
import { metronome } from '../metronome.js';
import { pickWarmup } from './pickers.js';
import { ICON, toast, closeSheet, kn, hintHtml, hintDone } from './shell.js';
import { customElement, property, state } from 'lit/decorators.js';
import { View, html, nothing, raw, openSheetView } from './lit.js';
import type { BarSection } from '../bass.js';
import type { BassLoop } from '../metronome.js';
import type { Bar, Chart, Key, Tune } from '../types.js';

// How a chart's chords are written: shifted from its key, with sharps or flats.
type ChordOpts = { shift: number; sharps: boolean };

// The chord chart in a tune's details (<ws-chart>): shown in the key it's played in today (or its
// usual key), written for the instrument; another key can be picked. Editable.

const view = () => store.state.settings.view;

// The concert key a tune is played in today, or its usual key.
function todaysKey(t: Tune): Key | null {
  const plan = store.state.plan;
  const it = plan?.date === dateStr() ? plan.items.find((i) => i.itemId === t.id) : undefined;
  return it?.key ?? t.keys?.[0] ?? null;
}

// The chart's main progressions, named by Roman numeral, in the key shown.
function progs(chart: Chart, { shift, sharps }: ChordOpts) {
  const ps = progressions(chart).filter((p) => p.chords.length >= 3).slice(0, 4);
  if (!ps.length) return nothing;
  return html`<p class="progs"><span>Progressions</span> ${ps.map((p, i) => html`${i ? ' · ' : ''}<b>${p.name}</b> in ${noteName(p.target + shift, sharps)}${p.minor ? 'm' : ''}${p.count > 1 ? ` ×${p.count}` : ''}`)}</p>`;
}

// The chart for a tune: tune (in its details), back (reopens them after the editor or a picker),
// key (the concert key to show first; else today's, or its usual), compact (just the chart, its
// key and the bass: shown with an exercise taken through the tune).
@customElement('ws-chart')
export class ChartView extends View {
  @property({ attribute: false }) tune!: Tune;
  @property({ attribute: false }) back: (() => void) | undefined;
  @property({ attribute: false }) startKey: Key | null = null;
  @property({ attribute: false }) compact = false;
  @state() key: Key | null = null; // the concert key picked to show (null: startKey, today's, usual)
  // A loop of part of the chart (a section, or bars tapped: first then last), in bar numbers
  // (data-b), or null for the whole tune; pick: the first bar tapped.
  @state() loop: BassLoop | null = null;
  @state() pick: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private following = false;

  // A walking bass through the chart (a mode of the metronome), round and round, at the tune's
  // tempo, in the key shown; the bar it's on lights up while the chart is showing.
  get owner() { return `chart:${this.tune.id}`; }
  bassMine() { return metronome.state.running && metronome.state.bass?.owner === this.owner; }
  connectedCallback() {
    super.connectedCallback();
    if (this.bassMine()) this.loop = metronome.state.bass!.loop || null; // (bassMine: there's a bass)
    this.unsubscribe = metronome.subscribe(() => this.requestUpdate()); // (stopped elsewhere: the pill, the metronome)
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
  }
  shown(chart: Chart) { return this.key ?? this.startKey ?? todaysKey(this.tune) ?? chart.key ?? 0; }
  startBass() {
    const t = this.tune;
    const chart = chartFor(t)!; // (only from a chart that's showing)
    const { chords, beats } = chartChords(t, this.shown(chart), this.loop || {})!;
    if (!chords.length) return;
    const loop = this.loop;
    const label = loop ? `${t.name} · ${loop.name}` : t.name;
    metronome.start({ bpm: t.tempo || store.state.settings.metroBpm || 120, beats, itemId: t.id, bass: { chords, owner: this.owner, label, loop }, click: store.state.settings.bassClick });
  }
  setLoop(l: BassLoop | null) {
    this.loop = l;
    this.pick = null;
    if (this.bassMine()) this.startBass();
  }
  tapBar(n: number) {
    if (this.pick == null) { this.pick = n; return; }
    const [from, to] = [Math.min(this.pick, n), Math.max(this.pick, n)];
    hintDone('loop-bars');
    this.setLoop({ from, to, name: from === to ? `bar ${from + 1}` : `bars ${from + 1}–${to + 1}` });
  }
  // The bar the bass is on, lit up (from an animation frame, while it plays).
  follow() {
    if (this.following) return;
    this.following = true;
    let lit: Element | null = null;
    const step = () => {
      if (!this.isConnected || !this.bassMine()) {
        lit?.classList.remove('now');
        this.following = false;
        return;
      }
      const i = metronome.bassBeat();
      const from = metronome.state.bass!.loop?.from ?? 0; // (bassMine, above)
      const bar = i < 0 ? null : this.querySelector(`[data-b="${from + Math.floor(i / metronome.state.beats)}"]`);
      if (bar !== lit) { lit?.classList.remove('now'); bar?.classList.add('now'); lit = bar; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  updated() {
    if (this.bassMine()) this.follow();
  }

  render() {
    const t = this.tune, compact = this.compact;
    const chart = chartFor(t);
    if (!chart) {
      return html`
        <div class="field-label row-label"><span>Chords</span><button class="link-btn" id="chart-add" @click=${() => openChartEditor(t, { key: todaysKey(t) ?? 0, back: this.back })}>Add a chart</button></div>
        <p class="fine">No chord chart for this tune yet.</p>`;
    }
    const shown = this.shown(chart);
    const minor = isMinor(shown);
    const shift = chartShift(chart, shown, view());
    const written = (((shown % 12) + TRANSPOSITIONS[view()].offset) % 12) + (minor ? 12 : 0);
    const opts = { shift, sharps: usesSharps(written) };
    const keys = [...Array(12).keys()].map((r) => r + (minor ? 12 : 0));
    const bass = this.bassMine(), loop = this.loop;
    return html`
      <div class="field-label row-label"><span>${compact ? `${t.name}’s chords` : 'Chords'}</span><span class="row-links">
        <select class="chart-key" id="chart-key" aria-label="Key" @change=${(e: Event) => {
          this.key = Number((e.target as HTMLSelectElement).value);
          if (this.bassMine()) this.startBass(); // on in the new key
        }}>${keys.map((k) => html`<option value=${k} ?selected=${k === shown}>in ${kn(k)}</option>`)}</select>
        <button class="pill-btn bass-btn ${bass ? 'on' : ''}" id="chart-bass" aria-label="Walking bass" @click=${() => { if (this.bassMine()) metronome.stop(); else this.startBass(); }}>${raw(bass ? ICON.stop : ICON.play)}Bass</button>
        ${compact ? nothing : html`<button class="link-btn" id="chart-edit" @click=${() => openChartEditor(t, { key: shown, back: this.back })}>Edit</button>`}</span></div>
      ${bass || loop || this.pick != null ? this.loopRow(chart) : nothing}
      <div class="chart ${loop ? 'looping' : ''}">${this.sections(chart, opts)}</div>
      ${progs(chart, opts)}
      <div class="chart-foot">
        ${compact ? nothing : html`<button class="pill-btn" id="chart-warmup" @click=${() => pickWarmup(t, { back: this.back })}>${raw(ICON.plus)}Add a warm-up</button>`}
        ${compact ? nothing : html`<span class="fine">${chartSource(t) === 'mine' ? 'Your chart' : 'From iReal Pro’s playlists (via JazzStandards)'}</span>`}
      </div>`;
  }
  // Bars are numbered (data-b) in playing order, as chordTimeline goes, for the bass to follow.
  sections(chart: Chart, opts: ChordOpts) {
    let n = 0;
    const loop = this.loop;
    const bar = (b: Bar) => {
      const i = n++;
      const cls = `${!!loop && i >= loop.from && i <= loop.to ? 'in-loop' : ''} ${i === this.pick ? 'pick' : ''}`;
      if (!b.chords.length) return html`<div class="bar same ${cls}" data-b=${i} @click=${() => this.tapBar(i)}>%</div>`;
      return html`<div class="bar n${b.chords.length} ${cls}" data-b=${i} @click=${() => this.tapBar(i)}>${b.chords.map((c) => html`<span>${chordName(c, opts)}</span>`)}${b.alts.length ? html`<small>(${b.alts.map((c) => chordName(c, opts)).join(' ')})</small>` : nothing}</div>`;
    };
    return chart.sections.map((s) => html`
      <div class="chart-section">
        <span class="chart-label">${s.label || ''}</span>
        <div class="bars">${s.bars.map(bar)}</div>
        ${s.endings.map((e, i) => html`
          <span class="chart-label ending">${i + 1}.</span>
          <div class="bars">${e.map(bar)}</div>`)}
      </div>`);
  }
  // Looping: a section's chip, or tap a bar then another; the bass goes round just those.
  loopRow(chart: Chart) {
    const { sections } = chartBars(chart);
    const loop = this.loop;
    const isSection = (s: BarSection) => !!loop && loop.from === s.from && loop.to === s.to;
    const chip = (label: string, on: boolean, l: BassLoop | null, v: string) => html`<button class="chip ${on ? 'on' : ''}" data-loop=${v} @click=${() => this.setLoop(l)}>${label}</button>`;
    return html`<div class="loop-row"><span class="field-label">Loop</span><div class="chips">
      ${chip('Whole tune', !loop, null, 'all')}${sections.length > 1 ? sections.map((s, i) => chip(s.name, isSection(s), { from: s.from, to: s.to, name: s.name }, String(i))) : nothing}
      ${loop && !sections.some(isSection) ? chip(`${loop.name} ×`, true, null, 'all') : nothing}</div></div>
      ${this.pick != null ? html`<p class="fine loop-hint">From bar ${this.pick + 1}: now tap the last bar to loop.</p>` : raw(hintHtml('loop-bars', 'Or tap a bar, then another, to loop just those.', 'fine loop-hint'))}`;
  }
}

// Edit (or add) a tune's chart as text, in the key and transposition it's shown in.
export async function openChartEditor(t: Tune, { key = 0, back }: { key?: Key; back?: () => void } = {}): Promise<void> {
  if (t.chartEdited) await loadSeedCharts(); // to offer going back to the original
  const el = document.createElement('ws-chart-editor') as ChartEditor;
  el.setup(t, key);
  openSheetView(el, () => {
    if (el.pending) toast(`Your last change to the chart wasn’t kept: ${el.pending}`);
    back?.();
  });
}

@customElement('ws-chart-editor')
export class ChartEditor extends View {
  tune!: Tune;
  key: Key = 0;
  private base: Key = 0; // the chart's own key
  private shift = 0;
  private meter = '4/4';
  private text = '';
  private original: { chart: Chart | null; edited: boolean } = { chart: null, edited: false };
  @state() pending: string | null = null; // the last edit, if it didn't read as a chart
  @state() changed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  setup(t: Tune, key: Key) {
    const existing = chartFor(t);
    const minor = isMinor(key);
    this.tune = t;
    this.key = key;
    this.base = existing?.key ?? key;
    this.meter = existing?.meter || '4/4';
    this.shift = existing ? chartShift(existing, key, view()) : TRANSPOSITIONS[view()].offset;
    const written = (((key % 12) + TRANSPOSITIONS[view()].offset) % 12) + (minor ? 12 : 0);
    this.text = existing ? chartToText(existing, { shift: this.shift, sharps: usesSharps(written) }) : 'A: ';
    this.original = { chart: t.chart ? structuredClone(t.chart) : null, edited: !!t.chartEdited };
  }
  // Each edit is saved once the text reads as a chart; until then the last good one stays.
  keep() {
    clearTimeout(this.timer);
    const r = chartFromText(this.querySelector<HTMLTextAreaElement>('#ce-text')!.value, { key: this.base, meter: this.meter, shift: this.shift });
    this.pending = r.error || null;
    if (r.error) return;
    this.tune.chart = r.chart;
    this.tune.chartEdited = true;
    save();
  }
  // Back to a chart (as it was, or the original), leaving the editor.
  restore(chart: Chart | null, edited: boolean, msg: string) {
    clearTimeout(this.timer);
    this.tune.chart = chart;
    this.tune.chartEdited = edited;
    this.pending = null;
    save();
    closeSheet();
    toast(msg);
  }
  render() {
    const t = this.tune;
    return html`
      <p class="eyebrow">Chords · ${t.name} · in ${kn(this.key)}</p>
      <label class="field">
        <textarea id="ce-text" rows="10" spellcheck="false" autocapitalize="off" autocomplete="off" class="mono" .value=${this.text}
          @input=${() => { this.changed = true; clearTimeout(this.timer); this.timer = setTimeout(() => this.keep(), 400); }}></textarea>
      </label>
      <p class="fine ${this.pending ? 'error' : ''}" id="ce-msg">${this.pending ?? html`One section per line, like <code>A: Cm7 | F7 | Bbmaj7 Ebmaj7 | %</code>. Bars are separated by <code>|</code>, chords in a bar by spaces; <code>%</code> means the chord carries on. Endings: <code>A 1.:</code> and <code>A 2.:</code>.`}</p>
      <button class="primary-btn" id="ce-save" @click=${() => { this.keep(); if (!this.pending) closeSheet(); }}>Done</button>
      <button class="link-btn" id="ce-revert" ?hidden=${!this.changed} @click=${() => this.restore(this.original.chart ? structuredClone(this.original.chart) : null, this.original.edited, 'Chart back to how it was')}>Undo changes</button>
      ${t.chartEdited && seedChart(t) ? html`<button class="ghost-btn" id="ce-reset" @click=${() => this.restore(seedChart(t), false, 'Back to the original chart')}>Go back to the original chart</button>` : nothing}
    `;
  }
}
