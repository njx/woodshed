import { store, save } from '../store.js';
import { DURATIONS, noteToken, restToken, soundingShift, homeName, rekey, lastNote, nearestOctave, moveLastNote } from '../abc.js';
import { parseChord } from '../chords.js';
import { SOUNDS } from '../sounds.js';
import { renderNotation, playNotation, stopPlayback, playbackOptions, playbackFor } from './notation.js';
import { ICON, toast, haptic, closeSheet } from './shell.js';
import { customElement, state } from 'lit/decorators.js';
import { View, html, raw, openSheetView } from './lit.js';
import type { TuneObject } from 'abcjs';
import type { Duration } from '../abc.js';
import type { Exercise } from '../types.js';

// Edit an exercise's notation (written in its own key: Written in) with a tap keypad or by typing ABC.

const METERS = ['4/4', '3/4', '5/4', '6/8', '2/4'];
// Chord types to tap: [as written in the notation, label].
const CHORD_QUALITIES = [['maj7', 'Δ7'], ['6', '6'], ['m7', 'm7'], ['m6', 'm6'], ['7', '7'], ['7b9', '7♭9'],
  ['7#9', '7♯9'], ['7alt', '7alt'], ['7sus', '7sus'], ['m7b5', 'ø7'], ['dim7', '°7'], ['m(maj7)', 'mΔ7']];
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
// A note (or bar line, or triplet mark) at a time, for moving the cursor; a chord symbol goes with its note.
const TOKEN = /\(3|(?:"[^"]*"\s*)?[_^=]*[A-Ga-gz][,']*\d*\/?\d*-?|\|/g;

// Small note icons for the length buttons.
function noteIcon(d: string) {
  const head = d === 'whole' || d === 'half'
    ? '<ellipse cx="9" cy="19" rx="4.6" ry="3.3" transform="rotate(-20 9 19)" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    : '<ellipse cx="9" cy="19" rx="4.6" ry="3.3" transform="rotate(-20 9 19)" fill="currentColor"/>';
  const stem = d === 'whole' ? '' : '<path d="M13.2 18V3.5" stroke="currentColor" stroke-width="1.8"/>';
  const flags = ({ eighth: 1, sixteenth: 2 } as Record<string, number>)[d] || 0;
  const flag = Array.from({ length: flags }, (_, i) => `<path d="M13.2 ${3.5 + i * 4.5}c0 3 5 4 4.5 8" fill="none" stroke="currentColor" stroke-width="1.8"/>`).join('');
  return `<svg viewBox="0 0 22 24" aria-hidden="true">${head}${stem}${flag}</svg>`;
}

export function openNotationEditor(t: Exercise, back?: () => void): void {
  const el = document.createElement('ws-notation-editor') as NotationEditor;
  el.setup(t);
  openSheetView(el, () => {
    el.stop();
    stopPlayback();
    back?.();
  });
}

@customElement('ws-notation-editor')
export class NotationEditor extends View {
  t!: Exercise;
  private body = ''; // the notation as it's being written (the text field holds it too)
  private original = { abc: '', meter: '4/4', home: undefined as number | undefined };
  @state() meter = '4/4';
  @state() duration: Duration = 'eighth';
  @state() dotted = false;
  @state() accidental = '';
  @state() chord = { open: false, root: '', acc: '' }; // a chord symbol being picked
  @state() typing = false; // with the keyboard, rather than the keypad
  @state() playing: 'no' | 'loading' | 'yes' = 'no';
  @state() prevNote = ''; // the note before the cursor (the next one goes nearest it; ↑8 ↓8 move it)
  @state() changed = false;
  private stopFn: (() => void) | null = null;
  private tune: TuneObject | null = null;
  private drawTimer: ReturnType<typeof setTimeout> | undefined;

  setup(t: Exercise) {
    this.t = t;
    this.body = t.abc || '';
    this.meter = t.meter || '4/4';
    this.original = { abc: t.abc || '', meter: t.meter || '4/4', home: t.home };
  }
  get area() { return this.querySelector<HTMLTextAreaElement>('#ne-abc')!; }

  firstUpdated() {
    this.area.value = this.body; // (from here on the field is edited directly, at the cursor)
    this.showBefore();
    this.draw();
  }
  // Every change is saved as it's made (Undo changes puts back what it was when opened); the
  // preview follows a moment later.
  draw() {
    const t = this.t;
    t.abc = this.body.trim();
    t.meter = this.meter;
    save();
    this.changed = !(t.abc === this.original.abc.trim() && t.meter === this.original.meter && t.home === this.original.home);
    clearTimeout(this.drawTimer);
    this.drawTimer = setTimeout(async () => {
      const preview = this.querySelector<HTMLElement>('#ne-preview');
      if (preview) this.tune = await renderNotation(preview, this.body, { meter: this.meter, tempo: t.tempo || 100, key: t.home ?? 0 }).catch(() => null);
    }, 120);
  }
  showBefore() {
    const n = lastNote(this.body.slice(0, this.area.selectionStart ?? this.body.length));
    this.prevNote = n ? `${n.letter}${n.octave}` : '';
  }
  // The text changed: from the field (typing), or set here (and the cursor put after it).
  setBody(body: string, cursor?: number) {
    this.body = body;
    const area = this.area;
    if (area.value !== body) area.value = body;
    if (cursor != null) area.setSelectionRange(cursor, cursor);
    this.draw();
    this.showBefore();
  }
  // Insert at the cursor, or at the end.
  insert(text: string) {
    const body = this.body, area = this.area;
    const start = area.selectionStart ?? body.length;
    const end = area.selectionEnd ?? body.length;
    this.setBody(body.slice(0, start) + text + body.slice(end), start + text.length);
  }
  // Move the note before the cursor up or down an octave.
  moveLast(d: number) {
    const pos = this.area.selectionStart ?? this.body.length;
    const r = moveLastNote(this.body.slice(0, pos), d);
    if (r) this.setBody(r.text + this.body.slice(pos), pos + r.delta);
  }
  // Remove the token before the cursor (a note with its accidental and length, a bar, a space…).
  backspace() {
    const pos = this.area.selectionStart ?? this.body.length;
    const before = this.body.slice(0, pos);
    const m = /("[^"]*"|\(3|[_^=]*[A-Ga-gz][,']*\d*\/?\d*-?|\s*\|\s*|\s+|.)$/.exec(before);
    if (m) this.setBody(before.slice(0, before.length - m[0].length) + this.body.slice(pos), before.length - m[0].length);
  }
  // Move the cursor a note (or bar line, or triplet mark) at a time, skipping spaces.
  step(dir: number) {
    const area = this.area, body = this.body;
    const pos = area.selectionStart ?? body.length;
    const stops = [0];
    for (const m of body.matchAll(TOKEN)) stops.push(m.index + m[0].length);
    stops.push(body.length);
    const to = dir > 0 ? stops.find((p) => p > pos) ?? body.length : [...stops].reverse().find((p) => p < pos) ?? 0;
    area.focus();
    area.setSelectionRange(to, to);
    this.showBefore();
  }
  // A note, in the octave nearest the note before it (move it after with ↑8 ↓8).
  note(letter: string) {
    const octave = nearestOctave(letter, lastNote(this.body.slice(0, this.area.selectionStart ?? this.body.length)));
    this.insert(noteToken({ letter, accidental: this.accidental, octave, duration: this.duration, dotted: this.dotted }));
    this.accidental = ''; // accidentals apply to one note
    haptic();
  }
  // Chord symbols (over the next note; as written, like the notes, and transposed with them): tap a
  // root (♭ ♯), then its type — or type one.
  chordType(q: string) {
    const c = this.chord;
    if (!c.root) return toast('Tap the chord’s root first');
    this.insert(`"${c.root}${c.acc}${q}"`);
    this.chord = { open: false, root: '', acc: '' };
  }
  typeChord() {
    const sym = (prompt('Chord symbol, as written (like Dm7, G7, Bø7, Cmaj7):') || '').replace(/["\s]/g, '');
    if (sym && !parseChord(sym)) return toast(`“${sym}” isn’t a chord symbol I can read`);
    if (sym) this.insert(`"${sym}"`);
    this.chord = { open: false, root: '', acc: '' };
  }
  // The key it's written in: the key signature changes, the notes keep their pitches.
  setHome(k: number) {
    const t = this.t;
    const body = rekey(this.body, t.home ?? 0, k);
    if (k) t.home = k;
    else delete t.home;
    this.setBody(body);
  }
  revert() {
    const t = this.t, o = this.original;
    this.meter = o.meter;
    if (o.home) t.home = o.home;
    else delete t.home;
    this.setBody(o.abc);
    this.requestUpdate();
    toast('Back to how it was');
  }

  stop() {
    this.stopFn?.();
    this.stopFn = null;
    this.playing = 'no';
  }
  async play() {
    if (this.stopFn) return this.stop();
    if (!this.tune) return;
    this.playing = 'loading';
    try {
      this.stopFn = await playNotation(this.tune, {
        transpose: soundingShift(store.state.settings.view),
        ...playbackFor(this.meter),
        onEnded: () => { this.stopFn = null; this.playing = 'no'; },
        onFallback: (id) => toast(`Couldn’t load the ${SOUNDS[id].label.toLowerCase()} sound — playing the synth`),
      });
      this.playing = 'yes';
    } catch {
      this.stopFn = null;
      this.playing = 'no';
      toast('Couldn’t play audio on this device');
    }
  }

  render() {
    const t = this.t, c = this.chord;
    return html`
      <p class="eyebrow">Notation · ${t.name}</p>
      <label class="ne-home">Written in <select id="ne-home" aria-label="Key it's written in" @change=${(e: Event) => this.setHome(Number((e.target as HTMLSelectElement).value))}>${[...Array(24).keys()].map((h) => html`<option value=${h} ?selected=${h === (t.home ?? 0)}>${homeName(h)}</option>`)}</select></label>
      <div class="notation editor-preview" id="ne-preview"></div>
      <div class="ne-text">
        <textarea id="ne-abc" rows="3" inputmode=${this.typing ? 'text' : 'none'} spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Notation (ABC)"
          @input=${() => this.setBody(this.area.value)} @click=${() => this.showBefore()}></textarea>
        <button class="icon-btn small ${this.typing ? 'on' : ''}" id="ne-type" aria-label="Type with the keyboard" title="Type with the keyboard"
          @click=${async () => { this.typing = !this.typing; await this.updateComplete; this.area.blur(); this.area.focus(); }}>⌨</button>
      </div>
      <div class="keypad ${c.open ? 'chording' : ''}" id="ne-pad" @pointerdown=${(e: Event) => e.preventDefault() /* (the keypad doesn't take the cursor) */}>
        <div class="kp-row durations">${Object.entries(DURATIONS).map(([d, x]) => html`<button data-dur=${d} class=${d === this.duration ? 'on' : ''} aria-label=${x.label} @click=${() => { this.duration = d as Duration; this.dotted = false; }}>${raw(noteIcon(d))}</button>`)}
          <button data-dot class=${this.dotted ? 'on' : ''} aria-label="Dotted" @click=${() => (this.dotted = !this.dotted)}>•</button>
          <button data-trip aria-label="Triplet" @click=${() => this.insert('(3')}>3</button>
        </div>
        <div class="kp-row mods">
          ${([['^', 'Sharp', '♯'], ['_', 'Flat', '♭'], ['=', 'Natural', '♮']] as const).map(([a, label, sign]) => html`
            <button data-acc=${a} class=${this.accidental === a ? 'on' : ''} aria-label=${label} @click=${() => (this.accidental = this.accidental === a ? '' : a)}>${sign}</button>`)}
          <button data-oct="-1" aria-label="Last note down an octave" @click=${() => this.moveLast(-1)}>↓8</button>
          <span class="oct" id="ne-oct">${this.prevNote}</span>
          <button data-oct="1" aria-label="Last note up an octave" @click=${() => this.moveLast(1)}>↑8</button>
          <button data-chord class=${c.open ? 'on' : ''} aria-label="Chord symbol" @click=${() => (this.chord = { open: !c.open, root: '', acc: '' })}>Chord</button>
        </div>
        <div class="kp-row notes">${LETTERS.map((n) => html`<button data-note=${n} @click=${() => this.note(n)}>${n}</button>`)}</div>
        <div class="kp-row tools">
          <button data-rest aria-label="Rest" @click=${() => this.insert(restToken(this.duration, this.dotted))}>Rest</button>
          <button data-tie aria-label="Tie" @click=${() => this.insert('-')}>Tie</button>
          <button data-ins=" " aria-label="Space (breaks beaming)" @click=${() => this.insert(' ')}>␣</button>
          <button data-ins=" | " aria-label="Bar line" @click=${() => this.insert(' | ')}>|</button>
          <button data-move="-1" aria-label="Previous note" @click=${() => this.step(-1)}>◀</button>
          <button data-move="1" aria-label="Next note" @click=${() => this.step(1)}>▶</button>
          <button data-back aria-label="Delete" @click=${() => this.backspace()}>⌫</button>
        </div>
        <div class="kp-chord" id="ne-chord" ?hidden=${!c.open}>
          <div class="kp-row notes">${LETTERS.map((n) => html`<button data-croot=${n} class=${c.root === n ? 'on' : ''} @click=${() => (this.chord = { ...c, root: n })}>${n}</button>`)}</div>
          <div class="kp-row chord-mods">
            ${([['b', 'Flat root', '♭'], ['#', 'Sharp root', '♯']] as const).map(([a, label, sign]) => html`<button data-cacc=${a} class=${c.acc === a ? 'on' : ''} aria-label=${label} @click=${() => (this.chord = { ...c, acc: c.acc === a ? '' : a })}>${sign}</button>`)}
            <span class="oct" id="ne-chord-root">${c.root ? `${c.root}${c.acc.replace('b', '♭').replace('#', '♯')}…` : 'Root?'}</span>
            <button data-cother @click=${() => this.typeChord()}>Type…</button><button data-cclose aria-label="Close chords" @click=${() => (this.chord = { open: false, root: '', acc: '' })}>✕</button>
          </div>
          <div class="kp-row qualities">${CHORD_QUALITIES.map(([q, label]) => html`<button data-cq=${q} @click=${() => this.chordType(q)}>${label}</button>`)}</div>
        </div>
      </div>
      <div class="ne-opts">
        <label>Time <select id="ne-meter" @change=${(e: Event) => { this.meter = (e.target as HTMLSelectElement).value; this.draw(); }}>${METERS.map((m) => html`<option ?selected=${m === this.meter}>${m}</option>`)}</select></label>
        <button class="pill-btn" id="ne-play" @click=${() => this.play()}>${raw(ICON.play)}<span>${{ no: 'Play', loading: '…', yes: 'Stop' }[this.playing]}</span></button>
        ${playbackOptions(() => this.stop())}
      </div>
      <details class="ne-help"><summary>How to write it</summary>
        <p class="fine">Write it in any key (<b>Written in</b>, above), as you read it on your instrument — it’s transposed from there into each key you practice. Lengths are in eighth notes: <code>C</code> eighth, <code>C2</code> quarter, <code>C/</code> sixteenth, <code>C3</code> dotted quarter. <code>^</code> sharp, <code>_</code> flat, each note goes in the octave nearest the one before it; <b>↑8</b> <b>↓8</b> move the note before the cursor (lowercase = octave up, <code>'</code> and <code>,</code> another octave). <b>Chord</b> adds a chord symbol over the next note: tap its root, then its type (<code>"Dm7"</code>; ø7 is <code>m7b5</code>).</p>
      </details>
      <button class="primary-btn" id="ne-save" @click=${() => closeSheet()}>Done</button>
      <button class="link-btn ne-revert" id="ne-revert" ?hidden=${!this.changed} @click=${() => this.revert()}>Undo changes</button>
    `;
  }
}
