import { store, save } from '../store.js';
import { itemById, playTempo } from '../practice.js';
import { todayItem } from '../plan.js';
import { chartChords } from '../bass.js';
import { metronome, takeAwayStop } from '../metronome.js';
import { clampBpm, tapBpm, MIN_BPM, MAX_BPM } from '../tempo.js';
import { ICON, render, toast, perform } from './shell.js';
import * as cmd from '../commands/index.js';
import { customElement, property, state } from 'lit/decorators.js';
import { View, html, nothing, live, raw, openSheetView, segButtons } from './lit.js';
import type { Click } from '../metronome.js';
import type { Id, Item, PlanItem } from '../types.js';
import type { tempoSuggestion } from '../tempo.js';

// Metronome sheet. Opened for a tune or exercise (opts.itemId), its tempo is that item's working
// tempo: changing it here changes the item's. For a warm-up in today's set (opts.pid), the
// warm-up's own tempo.
export function openMetronome(opts: { itemId?: Id | null; pid?: Id; back?: () => void } = {}) {
  const ms = metronome.state;
  // Opened without an item (the Today circle) while it's running for one: that's the metronome
  // that's on, so it opens as that item's (and can be stopped).
  const running = opts.itemId == null && ms.running;
  const itemId = running ? ms.itemId : opts.itemId ?? null;
  const pid = running ? ms.pid : opts.pid;
  const el = document.createElement('ws-metronome') as MetronomeSheet;
  el.item = itemId ? itemById(itemId) ?? null : null;
  el.warmup = (pid && store.state.plan?.items.find((i) => i.pid === pid && i.itemId === itemId && i.warmup)) || null; // (one gone since: the item's own)
  openSheetView(el, () => { render(); opts.back?.(); });
}

@customElement('ws-metronome')
export class MetronomeSheet extends View {
  @property({ attribute: false }) item: Item | null = null;
  @property({ attribute: false }) warmup: PlanItem | null = null; // a warm-up in today's set (item is the exercise)
  @state() bpm = 100;
  @state() beats = 4;
  private taps: number[] = [];
  private raf: number | null = null;
  private unsubscribe: (() => void) | null = null;

  connectedCallback() {
    super.connectedCallback();
    const s = store.state.settings, ms = metronome.state;
    this.bpm = this.mine() ? ms.bpm : this.tempo() || (ms.running ? ms.bpm : s.metroBpm || 100);
    this.beats = s.metroBeats || 4;
    this.unsubscribe = metronome.subscribe(() => this.requestUpdate());
    // Light up the beat that's sounding.
    const pulse = () => {
      const c = this.mine() ? metronome.lastClick() : null;
      this.querySelectorAll('#m-dots i').forEach((d, i) => d.classList.toggle('on', !!c && i === c.beat && c.since < 0.15));
      this.raf = requestAnimationFrame(pulse);
    };
    this.raf = requestAnimationFrame(pulse);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    cancelAnimationFrame(this.raf ?? 0);
    this.unsubscribe?.();
  }
  // Running for this (its item, or none; and the same warm-up, or not one).
  mine() { const ms = metronome.state; return ms.running && ms.itemId === (this.item?.id ?? null) && ms.pid === this.warmup?.pid; }
  tempo() { return this.item ? playTempo(this.item, this.warmup) : null; }
  // Its tempo changed: the item's working tempo, or the warm-up's own.
  saveTempo(bpm: number) {
    if (this.warmup) perform(cmd.setWarmupTempo, { entry: this.warmup.pid, tempo: bpm });
    else perform(cmd.updateItem, { item: this.item!.id, tempo: bpm, tempo_today: true });
  }
  bassOn() { return this.mine() && !!metronome.state.bass; }
  // The bass, as it is while it's running for this; otherwise as set (for a tune with a chart).
  bassWanted() { return this.mine() ? this.bassOn() : !!store.state.settings.metroBass && !!this.chartBass(); }
  // A walking bass with the click (bass.js), for a tune with a chart: through its chart in the key
  // it's played in today.
  chartBass() {
    const item = this.item;
    return item?.type === 'tune' ? chartChords(item, todayItem(item)?.key ?? item.keys?.[0] ?? null) : null;
  }

  setBpm(b: number) {
    this.bpm = clampBpm(b);
    store.state.settings.metroBpm = this.bpm;
    if (this.mine()) metronome.setBpm(this.bpm); // (not one running for something else)
    if (this.item) this.saveTempo(this.bpm);
    else save(); // (the metronome's own tempo, above)
  }
  setBeats(n: number) {
    this.beats = n;
    store.state.settings.metroBeats = n;
    save();
    // Running for this, as a plain click: in time with it now. (Not another tune's bass, nor one
    // running for something else.)
    if (this.mine() && !metronome.state.bass) metronome.setBeats(n);
  }
  tap() {
    const now = performance.now();
    this.taps = [...this.taps.filter((t) => now - t < 8000), now].slice(-6);
    const b = tapBpm(this.taps);
    if (b) this.setBpm(b);
  }
  startWith(bass: boolean) {
    const item = this.item, settings = store.state.settings;
    if (item && !this.tempo()) this.saveTempo(this.bpm);
    const cb = bass ? this.chartBass() : null;
    metronome.start({
      bpm: this.bpm, itemId: item?.id ?? null, pid: this.warmup?.pid, click: settings.bassClick, countIn: settings.bassCountIn,
      beats: cb ? cb.beats : this.beats,
      bass: cb ? { chords: cb.chords, owner: `chart:${item!.id}`, label: item!.name } : null, // (a chart's bass: item is a tune)
    });
  }
  go() {
    if (this.mine()) return metronome.stop();
    metronome.stop();
    this.startWith(this.bassWanted());
  }

  render() {
    const item = this.item;
    const running = this.mine();
    return html`
      <p class="eyebrow">Metronome${item ? ` · ${item.name}` : ''}${this.warmup ? ` · warm-up for ${itemById(this.warmup.warmup!)?.name ?? 'a tune'}` : ''}</p>
      <div class="metro-dots" id="m-dots">${Array.from({ length: this.beats }, (_, i) => html`<i class=${i === 0 && this.beats > 1 ? 'accent' : ''}></i>`)}</div>
      <div class="metro-bpm">
        ${[-5, -1].map((d) => html`<button data-step=${d} aria-label="${-d} slower" @click=${() => this.setBpm(this.bpm + d)}>−${-d}</button>`)}
        <div class="bpm-readout"><output id="m-bpm">${this.bpm}</output><small>BPM</small></div>
        ${[1, 5].map((d) => html`<button data-step=${d} aria-label="${d} faster" @click=${() => this.setBpm(this.bpm + d)}>+${d}</button>`)}
      </div>
      <input type="range" id="m-slider" min=${MIN_BPM} max=${MAX_BPM} .value=${live(String(this.bpm))} aria-label="Tempo" @input=${(e: Event) => this.setBpm(Number((e.target as HTMLInputElement).value))}>
      <div id="m-bass">${this.bass()}</div>
      <div class="metro-beats" id="m-beats" ?hidden=${this.bassWanted()}>
        <span class="field-label">Beats per bar</span>
        <div class="chips wrap">${[1, 2, 3, 4, 5, 6, 7].map((n) => html`<button class="chip ${n === this.beats ? 'on' : ''}" data-beats=${n} aria-label=${n === 1 ? '1, no accent' : nothing} @click=${() => this.setBeats(n)}>${n}</button>`)}</div>
      </div>
      <div class="metro-actions">
        <button class="ghost-btn" id="m-tap" @click=${() => this.tap()}>Tap tempo</button>
        <button class="primary-btn metro-go ${running ? 'on' : ''}" id="m-go" @click=${() => this.go()}>${raw(running ? ICON.skip : ICON.play)}<span>${running ? 'Stop' : 'Start'}</span></button>
      </div>
      ${item && this.warmup ? html`<p class="fine">The warm-up’s own tempo: it started at its tune’s, and changing one doesn’t change the other.</p>`
      : item ? html`
        <div class="setting">
          <div><b>Goal tempo</b><span>Optional. Suggestions to speed up stop here.</span></div>
          <input class="goal-input" id="m-goal" type="number" inputmode="numeric" min=${MIN_BPM} max=${MAX_BPM} placeholder="—" .value=${live(String(item.goalTempo || ''))}
            @change=${(e: Event) => { perform(cmd.updateItem, { item: item.id, goal_tempo: Number((e.target as HTMLInputElement).value) || 0 }); this.requestUpdate(); }}>
        </div>
        <p class="fine">${item.name}’s working tempo, saved with the session when you log it.</p>`
        : html`<ws-hint hint="metro-tip" cls="fine" text="Opened from a tune or exercise (the tempo button on its card), its tempo is saved with your practice."></ws-hint>`}
    `;
  }
  // The walking bass, for a tune with a chart (or while it's playing): on or off — set for Start
  // (after the count-in), or while it's running, there and then — and with it, the click on every
  // beat, on 2 and 4, or off, and how many bars to count in (for the next start).
  bass() {
    const on = this.bassWanted();
    if (!this.chartBass() && !this.bassOn()) return nothing;
    const settings = store.state.settings;
    const click = metronome.state.bass ? metronome.state.click : settings.bassClick || 'twofour';
    const countIn = settings.bassCountIn ?? 1;
    return html`
      <div class="setting"><div><b>Walking bass</b><span>${this.bassOn() ? `Through ${metronome.state.bass!.label}, round and round` : `Through its chart${countIn ? `, after ${countIn === 1 ? 'a bar' : `${countIn} bars`} to count in` : ''}`}</span></div>
        <div class="seg" id="m-bass-seg">${segButtons([['off', 'Off'], ['on', 'On']] as const, on ? 'on' : 'off', (v) => {
          perform(cmd.changeSettings, { walking_bass: v === 'on' });
          if (this.mine() && (v === 'on') !== this.bassOn()) this.startWith(v === 'on'); // (running: the click carries on)
          this.requestUpdate();
        })}</div></div>
      ${on ? html`<div class="setting"><div><b>Click</b><span>With the bass</span></div>
        <div class="seg" id="m-click">${segButtons([['all', 'Every beat'], ['twofour', '2 & 4'], ['off', 'Off']] as const, click, (v: Click) => {
          perform(cmd.changeSettings, { bass_click: v });
          metronome.setClick(v);
          this.requestUpdate();
        })}</div></div>
      <div class="setting"><div><b>Count-in</b><span>Clicks before the bass comes in</span></div>
        <div class="seg" id="m-count-in">${segButtons([[0, 'None'], [1, '1 bar'], [2, '2 bars']] as const, countIn, (v: number) => {
          perform(cmd.changeSettings, { count_in: v });
          this.requestUpdate();
        })}</div></div>` : nothing}`;
  }
}

// While the metronome runs, a small pill shows on every screen: tap to open, ■ to stop.
// (Also: back in the app after it was stopped in the background, an offer to start it again.)
export function mountMetronomePill() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const was = takeAwayStop();
    if (was) toast(`${was.bass ? 'Bass' : 'Metronome'} stopped while the app was in the background`, { label: 'Start again', fn: () => metronome.start(was) });
  });
  document.body.appendChild(document.createElement('ws-metro-pill'));
}

@customElement('ws-metro-pill')
export class MetroPill extends View {
  private raf: number | null = null;
  private unsubscribe: (() => void) | null = null;
  connectedCallback() {
    super.connectedCallback();
    this.unsubscribe = metronome.subscribe(() => this.requestUpdate());
    // The dot flashes on the beat.
    const tick = () => {
      const s = metronome.state, c = s.running ? metronome.lastClick() : null;
      const dot = this.querySelector('.mp-dot');
      dot?.classList.toggle('on', !!c && c.since < 0.1);
      dot?.classList.toggle('accent', !!c && c.beat === 0 && s.beats > 1);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    cancelAnimationFrame(this.raf ?? 0);
    this.unsubscribe?.();
  }
  render() {
    const s = metronome.state;
    const item = s.itemId ? itemById(s.itemId) : null;
    const what = s.bass ? `Bass · ${s.bass.label}` : item ? item.name : 'bpm';
    return html`<div class="metro-pill" ?hidden=${!s.running}>${s.running ? html`
      <button class="mp-open" aria-label="Open metronome" @click=${() => openMetronome({ itemId: s.itemId, pid: s.pid })}><i class="mp-dot"></i><b>${s.bpm}</b><span>${what}</span></button>
      <button class="mp-stop" aria-label="Stop metronome" @click=${() => metronome.stop()}>${raw(ICON.skip)}</button>` : nothing}</div>`;
  }
}

// ---------- Shared pieces for cards and detail sheets ----------

// A tempo suggestion (after it's been played at a tempo a few times), to take up next time.
export function tempoSuggestionPart(t: Item, sug: ReturnType<typeof tempoSuggestion>, onChange?: () => void) {
  if (!sug) return nothing;
  return html`<div class="suggest tempo ${sug.up ? 'up' : 'down'}"><span>${sug.text}</span>
    ${sug.to ? html`<button class="pill-btn" data-tempo-to=${sug.to} @click=${(e: Event) => {
      e.stopPropagation();
      perform(cmd.updateItem, { item: t.id, tempo: sug.to! }); // (for next time: today's session keeps its tempo)
      onChange?.();
    }}>${raw(ICON.quarter)}${sug.to}</button>` : nothing}</div>`;
}

// Its working tempo (and goal), opening the metronome.
export function tempoRow(t: Pick<Item, 'id' | 'tempo' | 'goalTempo'>, open: () => void, what = 'working tempo') {
  return html`
    <div class="field-label row-label"><span>Tempo</span></div>
    <button class="tempo-row" data-metro=${t.id} @click=${(e: Event) => { e.stopPropagation(); open(); }}>
      <span class="tr-main">${t.tempo ? html`<b>${t.tempo} bpm</b> ${what}` : 'No tempo yet'}${t.goalTempo ? ` · goal ${t.goalTempo}` : ''}</span>
      <span class="tr-open">${raw(ICON.metro)}Metronome</span>
    </button>`;
}
