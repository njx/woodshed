import { store } from '../store.js';
import { LEVELS, PRIORITIES, CATEGORIES, KEY_MODES } from '../constants.js';
import { writtenToConcert } from '../keys.js';
import { chordsFromText } from '../chords.js';
import { SHAPES, PATTERN_PAD, typesOf, typeInfo, parsePattern, patternText } from '../theory.js';
import { rootName } from './exercise.js';
import { customElement, property, state } from 'lit/decorators.js';
import { View, html, nothing, raw, segButtons, stepperButtons, settingRows, subPanel, helpParts } from './lit.js';
import type { ExerciseSheet } from './exercise.js';
import type { Category, KeyMode, Priority, Shape, Vary } from '../types.js';

// An exercise's settings, in its sheet (<ws-exercise-settings>): a row for each, opening a panel
// with its controls over the sheet; a new exercise shows the controls themselves, all at once.
// Changes go through the sheet (its edit, keysChanged and varyChanged), which shows what follows.

type PanelKey = 'harmony' | 'kind' | 'vary' | 'keys' | 'level' | 'priority';
const PANEL_LABELS: Record<PanelKey, string> = {
  harmony: 'Chords it goes with', kind: 'Kind', vary: 'Each session', keys: 'Keys', level: 'How well you know it', priority: 'Priority',
};
const TUNES_HELP = 'As a warm-up before a tune, or through a tune’s form. Off for technical work like long tones or interval drills.';

const patternHint = (kind: Vary['kind']) => (kind === 'chord'
  ? 'Numbers are chord tones: 1 3 5 7, and 8 10 12 14 an octave up. Tap numbers to change the pattern.'
  : 'Numbers are notes of the scale: 1 is the root, and on a 7-note scale 8 is the octave. Tap numbers to change the pattern; the presets fit themselves to scales with more or fewer notes.');

const view = () => store.state.settings.view;

@customElement('ws-exercise-settings')
export class ExerciseSettings extends View {
  @property({ attribute: false }) sheet!: ExerciseSheet;
  @state() panel: PanelKey | null = null; // the setting open over the sheet
  @state() harmonyText: string | null = null; // the chords it goes with, as typed (null: not yet, so its own)
  get t() { return this.sheet.t; }

  // A setting's panel, opened from elsewhere in the sheet (scrolled to `at`, a part of it).
  async openPanel(k: PanelKey, at?: string) {
    this.panel = k;
    await this.updateComplete;
    if (at) this.querySelector(`.sub-panel ${at}`)?.scrollIntoView({ block: 'start' });
  }
  shown(k: PanelKey) {
    const t = this.t;
    if (k === 'harmony') return !this.sheet.isNew && !t.vary && !t.fromTune;
    if (k === 'vary') return !t.fromTune;
    if (k === 'keys') return !t.fromTune && t.keyMode !== 'none'; // (No key is a choice in Each session)
    return true;
  }
  panelValue(k: PanelKey) {
    const t = this.t;
    switch (k) {
      case 'harmony': return (t.harmony ?? this.sheet.guessed()) || 'None yet';
      case 'kind': return CATEGORIES[t.category] || 'Other';
      case 'vary': return t.keyMode === 'none' ? 'No key' : !t.vary ? 'Key only' : `${t.vary.types.map((id) => typeInfo(t.vary!.kind, id)?.short || id).join(' ')} · ${(SHAPES[t.vary.shape]?.label || '').toLowerCase()}`;
      case 'keys': return `${t.keysPerSession} · ${KEY_MODES[t.keyMode].label.toLowerCase()}${t.keyMode === 'fixed' && t.keys.length ? `: ${t.keys.map((k) => rootName(k)).join(' ')}` : ''}`;
      case 'level': return LEVELS[t.level ?? 0].label;
      case 'priority': return PRIORITIES[(t.priority || 3) - 1].label;
    }
  }
  render() {
    const t = this.t;
    const keys = (Object.keys(PANEL_LABELS) as PanelKey[]).filter((k) => this.shown(k));
    if (this.sheet.isNew) return keys.map((k) => html`<label class="field-label">${PANEL_LABELS[k]}</label>${this.panelBody(k)}`);
    const row = (key: PanelKey) => ({ key, label: PANEL_LABELS[key], value: this.panelValue(key) });
    const help = helpParts('x-tunes-help', TUNES_HELP);
    return html`${settingRows([
      ...keys.slice(0, 2).map(row),
      !t.fromTune && { content: html`<label class="as-written use-tunes"><span>Use with tunes${help.btn}</span><input type="checkbox" id="x-tunes" .checked=${!t.solo}
        @change=${(e: Event) => this.sheet.edit({ use_with_tunes: (e.target as HTMLInputElement).checked })}></label>` },
      ...keys.slice(2).map(row),
    ], (k) => (this.panel = k as PanelKey))}${t.fromTune ? nothing : help.text}
    ${this.panel ? subPanel(PANEL_LABELS[this.panel], this.panelBody(this.panel), () => (this.panel = null)) : nothing}`;
  }
  panelBody(k: PanelKey) {
    const t = this.t;
    switch (k) {
      case 'harmony': return this.harmonyBody();
      case 'kind': return html`<div class="chips wrap" id="x-cat">${(Object.entries(CATEGORIES) as [Category, string][]).map(([c, l]) => html`<button class="chip ${t.category === c ? 'on' : ''}" data-cat=${c} @click=${() => this.sheet.edit({ category: c })}>${l}</button>`)}</div>`;
      case 'vary': return this.varyBody();
      case 'keys': return this.keysBody();
      case 'level': return html`<div class="seg four" data-field="level">${segButtons(LEVELS.map((l) => [l.v, l.label] as const), t.level, (v) => this.sheet.edit({ level: v }))}</div>`;
      case 'priority': return html`<div class="seg four" data-field="priority">${segButtons(PRIORITIES.map((p) => [p.v, p.label] as const), t.priority, (v) => this.sheet.edit({ priority: v as Priority }))}</div>`;
    }
  }
  // The chords a written exercise goes with (so it can be a warm-up over them in tunes): typed
  // here, or else read from the chord symbols in its notation. As written, like the notes.
  harmonyBody() {
    const t = this.t;
    const typed = this.harmonyText ?? t.harmony ?? this.sheet.guessed();
    const text = typed.trim();
    const bad = !!text && !chordsFromText(text);
    const msg = bad ? 'Couldn’t read those chords — like Dm7 G7 Cmaj7.'
      : t.harmony ? 'As typed here (clear it to go back to the notation’s chord symbols).'
      : this.sheet.guessed() ? 'From the chord symbols in its notation.' : '';
    return html`
      <div class="field"><input id="x-harmony" .value=${typed} placeholder="e.g. Dm7 G7 Cmaj7" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Chords it goes with"
        @input=${(e: Event) => this.setHarmony((e.target as HTMLInputElement).value)}></div>
      <p class="fine ${bad ? 'error' : ''}" id="x-harmony-msg">${msg}</p>
      <p class="fine">The chords it goes over, as written, like the notes — so it comes up as a warm-up for tunes with those chords. Read from the chord symbols in its notation, or typed here.</p>`;
  }
  setHarmony(value: string) {
    const t = this.t;
    this.harmonyText = value;
    const text = value.trim();
    if (text && !chordsFromText(text)) return this.requestUpdate(); // (said so, under it)
    if (!text || text === this.sheet.guessed()) { if (t.harmony != null) this.sheet.edit({ harmony: '' }); } // the notation's own, then
    else this.sheet.edit({ harmony: text });
    this.requestUpdate();
  }
  varyBody() {
    const t = this.t, vary = t.vary;
    const noKey = t.keyMode === 'none';
    const current = noKey ? 'none' : vary?.kind || '';
    // No key (as written, like long tones); or a key each time, with a scale or chord type too.
    const setKind = (kind: Vary['kind'] | '' | 'none') => {
      if (current === kind) return;
      const vary = kind && kind !== 'none' ? kind : 'none';
      // (keys again after No key: weak keys first, as a new exercise does)
      const keyMode = kind === 'none' ? 'none' : noKey ? 'weak' : undefined;
      if (keyMode) this.sheet.keysChanged({ vary, key_mode: keyMode });
      else this.sheet.varyChanged({ vary });
    };
    return html`
      <div class="seg four" id="x-vary">${([['none', 'No key'], ['', 'Key only'], ['scale', 'Scale type'], ['chord', 'Chord type']] as const).map(([v, l]) => html`
        <button class=${current === v ? 'on' : ''} data-vary=${v} @click=${() => setKind(v)}>${l}</button>`)}
      </div>
      <p class="fine">${noKey ? `${KEY_MODES.none.hint}: played as written, with no key to pick.`
        : vary ? `Each key comes with one of the ${vary.kind === 'scale' ? 'scales' : 'chords'} turned on here, favouring the ones you’ve played least. The notation is written out for each.`
        : 'Practice it in a different key each time — or with a different scale or chord type in each key, too.'}</p>
      ${vary ? html`
        <div class="chips wrap" id="x-types">${Object.entries(typesOf(vary.kind)).map(([id, x]) => html`
          <button class="chip ${vary.types.includes(id) ? 'on' : ''}" data-vtype=${id} aria-pressed=${String(vary.types.includes(id))} @click=${() => this.toggleType(id)}>${x.label}</button>`)}</div>
        <label class="field-label">Pattern</label>
        <div class="chips wrap" id="x-shape">${(Object.entries(SHAPES) as [Shape, (typeof SHAPES)[Shape]][]).filter(([, x]) => (x.kinds as readonly string[]).includes(vary.kind)).map(([id, x]) => html`
          <button class="chip ${vary.shape === id ? 'on' : ''}" data-shape=${id} @click=${() => this.setShape(id)}>${x.label}</button>`)}</div>
        ${this.patternCard()}` : nothing}`;
  }
  toggleType(id: string) {
    const vary = this.t.vary!; // (its buttons are there only when it varies)
    const on = vary.types.includes(id);
    this.sheet.varyChanged({ types: on ? vary.types.filter((x) => x !== id) : [...vary.types, id] });
  }
  setShape(shape: Shape) {
    const vary = this.t.vary!;
    // Custom starts from the preset that was chosen (its numbers to change).
    const pattern = shape === 'custom' && vary.shape !== 'custom' ? patternText(vary.kind, vary.shape, vary.pattern) : undefined;
    this.sheet.edit({ shape, ...(pattern != null ? { pattern } : {}), pattern_unfinished: true });
  }
  // The pattern's numbers; for Custom, a number pad to change them (changing a preset makes it
  // your own). The notation follows once it's a pattern that can be played.
  patternCard() {
    const vary = this.t.vary!;
    const nums = patternText(vary.kind, vary.shape, vary.pattern);
    const { error } = parsePattern(vary.pattern, vary.kind);
    const custom = vary.shape === 'custom';
    const pad = (v: string) => {
      const list = patternText(vary.kind, vary.shape, vary.pattern).split(' ').filter(Boolean);
      if (v === 'back') list.pop();
      else if (v === 'clear') list.length = 0;
      else if (list.length < 64) list.push(v);
      this.sheet.stopPlaying();
      this.sheet.edit({ shape: 'custom', pattern: list.join(' '), pattern_unfinished: true });
    };
    return html`
      <div class="pattern-card">
        <div class="pattern-line" id="x-pattern" aria-live="polite">${nums || raw('&nbsp;')}</div>
        ${custom ? html`<div class="keypad pattern-pad" id="x-pad">${PATTERN_PAD[vary.kind].map((n) => html`<button data-pn=${n} @click=${() => pad(String(n))}>${n}</button>`)}
          <button data-pn="back" aria-label="Delete the last number" @click=${() => pad('back')}>⌫</button><button data-pn="clear" @click=${() => pad('clear')}>Clear</button></div>
        <p class="fine ${error ? 'error' : ''}" id="x-pattern-msg">${error ? (vary.pattern.trim() ? error : 'Tap some numbers.') : patternHint(vary.kind)}</p>` : nothing}
      </div>`;
  }
  keysBody() {
    const t = this.t;
    return html`
      <div class="chips wrap" id="x-mode">${(Object.entries(KEY_MODES) as [KeyMode, (typeof KEY_MODES)[KeyMode]][]).filter(([k]) => k !== 'none').map(([k, m]) => html`<button class="chip ${t.keyMode === k ? 'on' : ''}" data-mode=${k} @click=${() => this.sheet.keysChanged({ key_mode: k })}>${m.label}</button>`)}</div>
      <p class="fine">${KEY_MODES[t.keyMode].hint}</p>
      ${t.keyMode === 'fixed' ? html`<div class="keygrid" id="x-fixed">${[...Array(12).keys()].map((w) => {
        const r = writtenToConcert(w, view());
        return html`<button class=${t.keys.includes(r) ? 'on' : ''} data-fixed=${r} @click=${() => this.sheet.keysChanged({ keys: t.keys.includes(r) ? t.keys.filter((x) => x !== r) : [...t.keys, r] })}>${rootName(r)}</button>`;
      })}</div>` : nothing}
      <div class="setting">
        <div><b>Keys per session</b><span>How many keys to play it in each time</span></div>
        <div class="stepper" id="x-kps">${stepperButtons(t.keysPerSession, (v) => this.sheet.keysChanged({ keys_per_session: v }), 1, 12)}</div>
      </div>`;
  }
}
