import { store, save } from '../store.js';
import { autoStart } from '../practicetime.js';
import { LEVELS, PRIORITIES, RATINGS, CATEGORIES, KEY_MODES } from '../constants.js';
import { dateStr, niceDate, ago } from '../dates.js';
import { keyName, writtenToConcert } from '../keys.js';
import { esc, uid } from '../util.js';
import { itemStats, itemById, isPlayedToday, isPlanItemPlayed, markPlayed, unmarkPlayed, setLevel, levelSuggestion, deleteItem } from '../practice.js';
import { setItemStatus, itemStatus, refreshTypes, addToToday, inToday, setTodayKeys, typeCounts, todayItem } from '../plan.js';
import { chartFor } from '../charts.js';
import './chart.js'; // (<ws-chart>)
import { swapInToday, removeFromToday } from './today.js';
import { pickTune } from './pickers.js';
import { harmonyOf } from '../warmups.js';
import { entryKeys } from '../keystats.js';
import { entriesFor } from '../diary.js';
import { DURATIONS, noteToken, restToken, soundingShift, homeKey, homeShift, homeName, rekey, lastNote, nearestOctave, moveLastNote, chordTimes } from '../abc.js';
import { chordsInAbc, chordsFromText, chordName, chordChanges, abcFirstChords, parseChord } from '../chords.js';
import { VARY, SHAPES, PATTERN_PAD, typesOf, typeInfo, variantName, generateAbc, parsePattern, patternText, progressionAbc, chooseTypes } from '../theory.js';
import { canRecord } from '../media.js';
import { renderNotation, playNotation, stopPlayback, playbackOptionsHtml, playbackOptions, bindPlaybackOptions, playbackFor, openFullNotation } from './notation.js';
import { noteRows, openNote } from './diary.js';
import { openRecorder } from './recorder.js';
import { tempoRow, tempoSuggestionPart, openMetronome } from './metronome.js';
import { tempoSuggestion } from '../tempo.js';
import { SOUNDS } from '../sounds.js';
import { metronome } from '../metronome.js';
import { customElement, state } from 'lit/decorators.js';
import {
  View, html, nothing, live, raw, openSheetView, segButtons, stepperButtons, settingRows, subPanel, statusControl, levelSuggestionPart, helpParts,
  type TemplateResult,
} from './lit.js';
import type { TuneObject } from 'abcjs';
import type { Duration } from '../abc.js';
import type { Category, Exercise, Id, Item, ItemStats, Key, KeyMode, PlanItem, Priority, Progression, Shape, Tune, Vary } from '../types.js';
import {
  $, $$, ICON, render, toast, withUndo, haptic, openSheet, closeSheet, kn, priBadge, openMenu, hintHtml,
} from './shell.js';

const view = () => store.state.settings.view;
// Exercise keys are roots (0–11), named as major keys for the instrument shown.
export const rootName = (r: Key): string => keyName(r % 12, view());
// A key for an exercise: "Dm" for a lick written in a minor key.
export const keyLabel = (r: Key, t: Exercise | null): string => `${rootName(r)}${homeKey(t) >= 12 ? 'm' : ''}`;

// A progression's chords in a key: "Am7 · D7 · Gm7 · C7".
export function progressionChords(prog: Progression, key: Key): string {
  return prog.chords.map((c) => variantName(rootName((key + c.d) % 12), 'chord', c.family)).join(' · ');
}

// What to play: "C · F · B♭", or with scale or chord types "C dor · F harm min", "Cm7 · F7",
// or a progression "iii–VI7–ii–V7 in F".
export function exerciseKeysText(keys: Key[] = [], t: Exercise | null = null, types: string[] | null = null, prog: Progression | null = null): string {
  if (prog?.name) return `${prog.name}${keys.length ? ` in ${rootName(keys[0])}` : ''}`;
  const kind = t?.vary?.kind;
  if (!kind || !types?.length) return keys.map((k) => keyLabel(k, t)).join(' · ');
  if (!keys.length) return types.map((id) => typeInfo(kind, id)?.label || id).join(' · ');
  return keys.map((k, i) => variantName(rootName(k), kind, types[i])).join(' · ');
}

// A recording's note for an exercise: what was played (keys and types, or the progression) and
// the tempo, e.g. "In C · E♭ · 120 bpm", "D dorian · G mixolydian", "ii–V7–I in F".
export function takeLabel(t: Exercise, keys: Key[] = [], types: string[] | null = null, prog: Progression | null = null, tempo = t.tempo): string {
  const what = exerciseKeysText(keys, t, types, prog);
  return [what && (t.vary || prog ? what : `In ${what}`), tempo && `${tempo} bpm`].filter(Boolean).join(' · ');
}

const patternHint = (kind: Vary['kind']) => (kind === 'chord'
  ? 'Numbers are chord tones: 1 3 5 7, and 8 10 12 14 an octave up. Tap numbers to change the pattern.'
  : 'Numbers are notes of the scale: 1 is the root, and on a 7-note scale 8 is the octave. Tap numbers to change the pattern; the presets fit themselves to scales with more or fewer notes.');

// The notation to show: generated for a progression (a warm-up), a scale or chord type, or the
// exercise's own. (A varying exercise always has a type to show: at least one is turned on.)
// part: play only its first so many chords (part of a lick over part of a progression).
function notationFor(t: Exercise, type: string | undefined, prog: Progression | null = null, part: number | null = null): string {
  if (t.fromTune) return prog ? progressionAbc(prog.chords, { meter: t.meter || '4/4' }) : '';
  if (t.vary) return generateAbc(t.vary.kind, type!, { shape: t.vary.shape, pattern: t.vary.pattern, meter: t.meter || '4/4' });
  return part ? abcFirstChords(t.abc, part) : t.abc;
}

// pid: today's plan item it was opened from; keys, types, prog: what's played today.
export interface ExerciseOpts { pid?: Id; keys?: Key[] | null; types?: string[]; prog?: Progression | null; back?: () => void }

// Detail sheet for an exercise. id null = new exercise. opts.keys: today's keys, to preview first.
export function openExercise(id: Id | null, opts: ExerciseOpts = {}): void {
  const item: Item | undefined = id
    ? itemById(id)
    : { id: uid(), type: 'exercise', name: '', category: 'pattern', keyMode: 'weak', keysPerSession: 2, keys: [], abc: '', meter: '4/4', vary: null, notes: '', priority: 2, level: 0, focus: false, ivl: null, due: null } satisfies Exercise;
  if (!item || item.type !== 'exercise') return;
  const el = document.createElement('ws-exercise-sheet') as ExerciseSheet;
  el.setup(item, !id, opts);
  openSheetView(el, () => el.closed());
}

// How it's set up: a row for each (showing what it's set to), opening a panel with its controls.
// A new exercise shows the controls themselves, all at once.
type PanelKey = 'harmony' | 'kind' | 'vary' | 'keys' | 'level' | 'priority';
const PANEL_LABELS: Record<PanelKey, string> = {
  harmony: 'Chords it goes with', kind: 'Kind', vary: 'Each session', keys: 'Keys', level: 'How well you know it', priority: 'Priority',
};
const TUNES_HELP = 'As a warm-up before a tune, or through a tune’s form. Off for technical work like long tones or interval drills.';

@customElement('ws-exercise-sheet')
export class ExerciseSheet extends View {
  t!: Exercise;
  isNew = false;
  opts: ExerciseOpts = {};
  // Today's plan item it was opened from (it can be in the set more than once, as warm-ups before
  // tunes); opened from elsewhere, its own place in the set, if it has one.
  today: PlanItem[] = [];
  planItem: PlanItem | null = null;
  prog: Progression | null = null; // a tune's progression (warm-ups)
  tempoFrom!: Item; // a warm-up is played at its tune's tempo (the tempo row, notation and takes use that)
  @state() todayKeys: Key[] = []; // changes if today's keys are edited
  @state() previewRoot: Key = 0; // the key shown
  @state() previewType: string | undefined; // the scale or chord type shown
  @state() panel: PanelKey | null = null; // the setting open over the sheet
  @state() playing: 'no' | 'loading' | 'yes' = 'no';
  @state() harmonyText = ''; // the chords it goes with, as typed (or not yet typed: from its notation)
  private stopFn: (() => void) | null = null;
  private tune: TuneObject | null = null; // the notation drawn, to play
  private drawn = ''; // what the notation was drawn for (it's drawn again when that changes)
  private leaving = false; // to another sheet (note, recorder, editor), coming back after
  private added = false;

  setup(t: Exercise, isNew: boolean, opts: ExerciseOpts) {
    Object.assign(this, { t, isNew, opts });
    const state = store.state;
    this.today = state.plan?.date === dateStr() ? state.plan.items.filter((i) => i.itemId === t.id) : [];
    this.planItem = this.today.find((i) => opts.pid && i.pid === opts.pid) || this.today.find((i) => !i.warmup) || null;
    this.prog = this.planItem?.prog || opts.prog || null;
    this.tempoFrom = (this.planItem?.warmup && itemById(this.planItem.warmup)) || t;
    this.todayKeys = opts.keys || this.planItem?.keys || [];
    this.previewRoot = this.asWritten() ? this.writtenC() : this.todayKeys[0] ?? 0;
    this.previewType = this.typeFor(this.previewRoot);
    this.harmonyText = t.harmony ?? this.guessed();
  }
  // Closed: a new exercise with a name is added (unless it's going on to its notation); going
  // back to where it was opened from.
  closed() {
    this.stopFn?.();
    if (this.isNew && !this.leaving) this.addNew();
    if (!this.isNew) render();
    if (!this.leaving) this.opts.back?.();
  }
  addNew() {
    const t = this.t;
    if (this.added || !t.name.trim()) return;
    this.added = true;
    t.name = t.name.trim();
    withUndo(`Added ${t.name}`, () => store.state.items.push(t));
  }
  // Leave this sheet for another (note, recorder, editor) and come back after.
  goTo(fn: () => void) {
    this.leaving = true;
    closeSheet();
    fn();
  }
  back = () => openExercise(this.t.id, { keys: this.todayKeys, back: this.opts.back });
  // A change: saved (a new exercise is saved when it's added), and shown.
  commit() {
    if (!this.isNew) save();
    this.requestUpdate();
  }

  // What Played logs against: its plan item, or if it's only in the set as warm-ups, one of them
  // (shown as itself here, not with a tune's keys) — so it doesn't count for every copy.
  logItem() { return this.planItem || this.today.find((i) => !isPlanItemPlayed(i)) || this.today[0] || null; }
  isPlayed() { const it = this.logItem(); return it ? isPlanItemPlayed(it) : isPlayedToday(this.t.id); }
  // A written exercise can be shown only as written (in its own key), to transpose in your head.
  asWritten() { const t = this.t; return !!t.asWritten && !t.vary && !this.prog && !!t.abc; }
  writtenC() { return writtenToConcert(homeKey(this.t) % 12, view()); } // (the key it's written in)
  // Today's types can include ones not turned on (warm-ups follow a tune's chords).
  todayTypes() { const t = this.t; return t.vary ? (this.planItem?.types || this.opts.types || []).filter((id) => typeInfo(t.vary!.kind, id)) : []; }
  stripTypes() { return [...new Set([...(this.t.vary?.types || []), ...this.todayTypes()])]; }
  // The scale or chord type shown: today's for the key shown, or the first one turned on.
  typeFor(root: Key): string | undefined { return this.todayTypes()[this.todayKeys.indexOf(root)] ?? this.todayTypes()[0] ?? this.t.vary?.types[0]; }
  // A lick played over part of a progression: in which key only its first so many chords (all of
  // it when it's shown only as written).
  partFor(root: Key) { return this.asWritten() ? null : this.planItem?.parts?.[this.todayKeys.indexOf(root)] ?? null; }
  abc() { return notationFor(this.t, this.previewType, this.prog, this.partFor(this.previewRoot)); }
  shift() { return homeShift(this.previewRoot, homeKey(this.t), view()); }
  // A new take's note: today's keys and types, or else the key (and type) shown.
  label() {
    const t = this.t, prog = this.prog;
    return prog || !this.todayKeys.length
      ? takeLabel(t, [this.previewRoot], this.previewType ? [this.previewType] : null, prog, this.tempoFrom.tempo)
      : takeLabel(t, this.todayKeys, this.todayTypes(), prog, this.tempoFrom.tempo);
  }
  // The chords a written exercise goes with, read from the chord symbols in its notation.
  guessed() { return chordChanges(chordsInAbc(this.t.abc)).map((c) => chordName(c)).join(' '); }

  // ---------- The walking bass ----------
  // Through its chords, in the key shown: a progression (a bar a chord), or the chord symbols in
  // its notation (timed by the notes under them), or else the chords typed for it (a bar each).
  // The metronome with a bass line.
  get bassOwner() { return `prog:${this.t.id}`; }
  bassMine() { return metronome.state.running && metronome.state.bass?.owner === this.bassOwner; }
  bassChords() {
    const t = this.t, prog = this.prog;
    if (prog) return prog.chords.map((c) => ({ root: (this.previewRoot + c.d) % 12, family: c.family, beats: 4 }));
    const abc = notationFor(t, this.previewType, null, this.partFor(this.previewRoot));
    const timed = abc ? chordTimes(abc, t.meter || '4/4') : [];
    const list = timed.length ? timed : harmonyOf(t).map((c) => ({ ...c, beats: 4 }));
    // Written as read (in the key it's written in); sounding in the key shown — or, shown only as
    // written, in today's key (the one you're transposing it to).
    const root = this.asWritten() && this.todayKeys.length ? this.todayKeys[0] : this.previewRoot;
    const up = homeShift(root, homeKey(t), view()) + soundingShift(view());
    return list.map((c) => ({ root: (((c.root + up) % 12) + 12) % 12, family: c.family, beats: c.beats }));
  }
  startBass() {
    const chords = this.bassChords();
    if (!chords.length) return;
    const beats = Number(String(this.t.meter || '4/4').split('/')[0]) || 4;
    metronome.start({
      bpm: this.tempoFrom.tempo || 100, beats: this.prog ? 4 : beats, itemId: this.tempoFrom.id,
      bass: { chords, owner: this.bassOwner, label: this.prog ? this.prog.name : this.t.name }, click: store.state.settings.bassClick,
    });
  }

  // ---------- Playing the notation ----------
  stopPlaying() {
    if (!this.stopFn) return;
    this.stopFn();
    this.stopFn = null;
    this.playing = 'no';
  }
  async play() {
    if (this.stopFn) return this.stopPlaying();
    if (!this.tune) return;
    this.playing = 'loading'; // the first time, the sound loads
    try {
      this.stopFn = await playNotation(this.tune, {
        transpose: this.shift() + soundingShift(view()),
        ...playbackFor(this.t.meter),
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
  // Another key or type shown: what's playing stops, and the bass follows.
  show(root: Key, type: string | undefined) {
    this.previewRoot = root;
    this.previewType = type;
    this.stopPlaying();
    if (this.bassMine()) this.startBass(); // in the new key (or type)
  }
  // Full screen, sideways, in the key (and type) shown.
  full() {
    const t = this.t, prog = this.prog;
    this.stopPlaying();
    const abc = this.abc();
    if (!abc) return;
    const shift = this.shift();
    const what = prog ? `${prog.name} in ${rootName(this.previewRoot)}` : exerciseKeysText([this.previewRoot], t, this.previewType ? [this.previewType] : null);
    let fullTune: TuneObject | null = null;
    openFullNotation({
      title: `${t.name} · ${what}`,
      draw: async (el) => { fullTune = await renderNotation(el, abc, { shift, key: homeKey(t), meter: t.meter, tempo: this.tempoFrom.tempo || 100, wide: true }).catch(() => null); },
      play: async (onEnded) => {
        if (!fullTune) return null;
        try {
          return await playNotation(fullTune, {
            transpose: shift + soundingShift(view()),
            ...playbackFor(t.meter),
            onEnded,
            onFallback: (id) => toast(`Couldn’t load the ${SOUNDS[id].label.toLowerCase()} sound — playing the synth`),
          });
        } catch {
          toast('Couldn’t play audio on this device');
          return null;
        }
      },
    });
  }
  editNotation() {
    const t = this.t;
    // For a new exercise (a lick, say) the notation is the point: add it, then write it.
    if (this.isNew) {
      t.name = t.name.trim() || `Untitled ${(CATEGORIES[t.category] || 'exercise').toLowerCase()}`;
      store.state.items.push(t);
      save();
      render();
    }
    this.goTo(() => openNotationEditor(t, this.back));
  }

  render() {
    const t = this.t, isNew = this.isNew, prog = this.prog, planItem = this.planItem;
    return html`
      <textarea class="title-input" id="x-name" rows="1" placeholder="Exercise name" aria-label="Exercise name" enterkeyhint="done" ?autofocus=${isNew}
        .value=${live(t.name)} @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
        @input=${(e: Event) => this.rename(e.target as HTMLTextAreaElement)}></textarea>
      ${isNew ? nothing : statusControl(t, itemStatus(t), (st) => { setItemStatus(t, st); this.commit(); }, (b) => this.menu(b))}
      ${isNew ? nothing : planItem?.warmup
        ? html`<p class="in-today">${raw(ICON.check)}In today’s set, as a warm-up for ${itemById(planItem.warmup)?.name || 'a tune'}</p>`
        : inToday(t) ? html`<p class="in-today">${raw(ICON.check)}In today’s set</p>` : nothing}

      <div class="field-label row-label"><span>Notation</span>${t.vary ? html`<button class="link-btn" id="x-to-pattern" @click=${() => this.toPattern()}>Edit pattern</button>`
        : t.abc ? html`<button class="link-btn" id="x-edit-abc" @click=${() => this.editNotation()}>Edit</button>` : nothing}</div>
      ${t.fromTune && !prog ? html`<p class="fine">This one takes its chords from a tune, so it comes up as a warm-up: tap <b>+ Warm-up</b> on a tune’s card in Today, or <b>Add a warm-up</b> under its chart.</p>` : nothing}
      ${t.vary || t.abc || prog ? this.notationCard() : html`<button class="ghost-btn" id="x-add-abc" @click=${() => this.editNotation()}>${raw(ICON.plus)}<span>Add notation</span></button>`}
      ${planItem?.warmup && !prog && chartFor(this.tempoFrom) // (it has a chart, so it's the tune it's a warm-up for) — in the tune's key
        ? html`<div class="x-tune-chart" id="x-tune-chart"><ws-chart .tune=${this.tempoFrom as Tune} .compact=${true} .startKey=${todayItem(this.tempoFrom)?.key ?? (planItem.form ? planItem.overKey ?? null : null)}></ws-chart></div>` : nothing}
      ${this.todayKeysPart()}
      <label class="field">
        <span class="field-label">How to practice it</span>
        <textarea id="x-notes" rows="3" placeholder="Tempo, articulation, range, variations…" .value=${live(t.notes)} @input=${(e: Event) => { t.notes = (e.target as HTMLTextAreaElement).value; if (!isNew) save(); }}></textarea>
      </label>
      ${isNew ? nothing : levelSuggestionPart(levelSuggestion(t), (l) => { setLevel(t, l); this.commit(); })}

      ${isNew ? nothing : this.tempoFrom !== t
        ? html`<div data-item-id=${this.tempoFrom.id}>${tempoRow(this.tempoFrom, () => this.openMetronome())}<p class="fine">As a warm-up it’s played at ${this.tempoFrom.name}’s tempo.</p></div>`
        : html`<div data-item-id=${t.id}>${tempoRow(t, () => this.openMetronome())}${tempoSuggestionPart(t, tempoSuggestion(t), () => this.requestUpdate())}</div>`}
      ${isNew || !canRecord() ? nothing : this.takes()}
      ${this.settings()}
      ${isNew ? html`<button class="primary-btn" id="x-save" @click=${() => this.add()}>Add exercise</button>` : this.history()}
      ${this.panel ? subPanel(PANEL_LABELS[this.panel], this.panelBody(this.panel), () => (this.panel = null)) : nothing}
    `;
  }
  updated() {
    // The name field wraps onto as many lines as it needs (it stays a single line of text).
    const name = this.querySelector<HTMLTextAreaElement>('#x-name')!;
    name.style.height = 'auto';
    name.style.height = `${name.scrollHeight}px`;
    this.drawNotation();
  }
  // Opening the metronome leaves this sheet; it comes back afterwards.
  openMetronome() {
    this.goTo(() => openMetronome({ itemId: this.t.id, back: this.back }));
  }
  // The notation in the key and type shown, drawn again when that changes.
  async drawNotation() {
    const el = this.querySelector<HTMLElement>('#x-notation');
    const abc = this.abc();
    const what = el && abc ? `${abc}|${this.shift()}|${homeKey(this.t)}|${this.t.meter}` : '';
    if (!el || !abc || what === this.drawn) return;
    this.drawn = what;
    this.tune = await renderNotation(el, abc, { shift: this.shift(), key: homeKey(this.t), meter: this.t.meter, tempo: this.tempoFrom.tempo || 100 })
      .catch(() => { el.innerHTML = '<span class="fine">Couldn’t show this notation.</span>'; return null; });
  }

  notationCard() {
    const t = this.t, prog = this.prog, planItem = this.planItem;
    const todayKeys = this.todayKeys, root = this.previewRoot;
    const bass = this.bassMine();
    const today = planItem?.form ? `Today: through ${this.tempoFrom.name}’s form, in ${kn(planItem.overKey)} — bend it to the changes, or take off from it.`
      : planItem?.over ? `Today: over ${planItem.over}${planItem.overKey != null ? ` in ${kn(planItem.overKey)}` : ''} — play it in ${todayKeys.map((k, i) => `${rootName(k)}${planItem.parts?.[i] ? ` (its first ${planItem.parts[i]} chords)` : ''}`).join(', then ')}`
      : prog ? `Today: ${prog.name} in ${rootName(root)} — ${progressionChords(prog, root)}`
      : t.vary && this.todayTypes().length ? `Today: ${exerciseKeysText(todayKeys, t, this.todayTypes())}`
      : todayKeys.length && this.asWritten() ? `Today: ${todayKeys.map((k) => keyLabel(k, t)).join(', ')}`
      : todayKeys.length ? 'Underlined: today’s keys.' : '';
    return html`
      <div class="notation-card">
        ${this.asWritten() ? nothing : html`<div class="key-strip" role="group" aria-label="Show in key">${[...Array(12).keys()].map((w) => {
          const r = writtenToConcert(w, view());
          return html`<button class="${r === root ? 'on' : ''} ${todayKeys.includes(r) ? 'today' : ''}" data-root=${r}
            @click=${() => this.show(r, t.vary && todayKeys.includes(r) ? this.typeFor(r) : this.previewType)}>${keyLabel(r, t)}</button>`; // (today's keys show with today's type)
        })}</div>`}
        ${t.vary ? html`<div class="type-strip" role="group" aria-label="Show ${t.vary.kind} type">${this.stripTypes().map((id) => html`
          <button class=${id === this.previewType ? 'on' : ''} data-type=${id} @click=${() => this.show(root, id)}>${typeInfo(t.vary!.kind, id)!.short}</button>`)}</div>` : nothing}
        <div class="nt-wrap">
          <div class="notation" id="x-notation"><span class="fine">Loading notation…</span></div>
          <button class="x-full" id="x-full" aria-label="Full screen" title="Full screen" @click=${() => this.full()}>⤢</button>
        </div>
        <div class="play-row">
          <button class="pill-btn ${this.playing === 'no' ? '' : 'on'}" id="x-play" @click=${() => this.play()}>${raw(ICON.play)}<span>${{ no: 'Play', loading: '…', yes: 'Stop' }[this.playing]}</span></button>
          ${prog || this.bassChords().length ? html`<button class="pill-btn bass-btn ${bass ? 'on' : ''}" id="x-bass" aria-label="Walking bass"
            @click=${() => { if (this.bassMine()) metronome.stop(); else this.startBass(); this.requestUpdate(); }}>${raw(bass ? ICON.stop : ICON.play)}<span>Bass</span></button>` : nothing}
          ${playbackOptions(() => this.stopPlaying())}
        </div>
        ${!t.vary && !prog && t.abc ? html`<label class="as-written"><input type="checkbox" id="x-as-written" .checked=${!!t.asWritten} @change=${(e: Event) => this.setAsWritten((e.target as HTMLInputElement).checked)}>
          <span>Only as written, in ${homeName(homeKey(t))} — transpose it in your head</span></label>` : nothing}
        ${today ? html`<p class="fine">${today}</p>` : nothing}
      </div>`;
  }
  setAsWritten(on: boolean) {
    this.stopPlaying();
    if (on) this.t.asWritten = true;
    else delete this.t.asWritten;
    this.previewRoot = this.asWritten() ? this.writtenC() : this.todayKeys[0] ?? 0;
    this.commit();
  }

  // Today's keys (and types) for this exercise, changeable: not for a warm-up (its come from its
  // tune), or one without keys.
  editable() { const t = this.t; return !!this.planItem && !this.planItem.warmup && !t.fromTune && t.keyMode !== 'none'; }
  todayKeysPart() {
    if (!this.editable()) return nothing;
    const t = this.t, it = this.planItem!;
    const keys = it.keys || [];
    const types = t.vary ? it.types || [] : [];
    const help = helpParts('x-today-help', `Tap keys to play ${t.vary ? 'it in (and pick the type for each)' : 'it in'} today${isPlanItemPlayed(it) ? ' — the session you logged changes too' : ''}.`);
    return html`
      <div class="field-label row-label"><span>Today’s keys${help.btn}</span></div>${help.text}
      <div class="today-keys" role="group" aria-label="Today’s keys">${[...Array(12).keys()].map((w) => {
        const k = writtenToConcert(w, view());
        return html`<button class=${keys.includes(k) ? 'on' : ''} data-tk=${k} aria-pressed=${String(keys.includes(k))} @click=${() => this.toggleTodayKey(k)}>${rootName(k)}</button>`;
      })}</div>
      ${t.vary && keys.length ? html`<ul class="today-types">${keys.map((k, i) => html`
        <li><b>${rootName(k)}</b><select data-tt=${i} aria-label="${VARY[t.vary!.kind].label} in ${rootName(k)}" @change=${(e: Event) => this.setTodayType(i, (e.target as HTMLSelectElement).value)}>${Object.entries(VARY[t.vary!.kind].types).map(([id, x]) => html`
          <option value=${id} ?selected=${types[i] === id}>${x.label}</option>`)}</select></li>`)}</ul>` : nothing}`;
  }
  toggleTodayKey(k: Key) {
    const t = this.t, it = this.planItem!;
    const keys = [...(it.keys || [])];
    const types = t.vary ? [...(it.types || [])] : null;
    const i = keys.indexOf(k);
    if (i >= 0) {
      if (keys.length === 1) return toast('Keep at least one key');
      keys.splice(i, 1);
      types?.splice(i, 1);
    } else {
      keys.push(k);
      // A new key gets a type the usual way: one played least.
      if (types) types.push(chooseTypes(t.vary!, 1, itemStats().get(t.id)?.types || [], Math.random, typeCounts())[0] ?? t.vary!.types[0]);
    }
    setTodayKeys(it, keys, types);
    this.todayKeys = it.keys!; // (just set)
    if (t.vary && this.todayKeys.includes(this.previewRoot)) this.previewType = this.typeFor(this.previewRoot);
    this.requestUpdate();
  }
  setTodayType(i: number, type: string) {
    const it = this.planItem!;
    const types = [...(it.types || [])];
    types[i] = type;
    setTodayKeys(it, it.keys!, types);
    if (it.keys![i] === this.previewRoot) this.previewType = type;
    this.requestUpdate();
  }

  // ---------- Settings ----------
  shown(k: PanelKey) {
    const t = this.t;
    if (k === 'harmony') return !this.isNew && !t.vary && !t.fromTune;
    if (k === 'vary' || k === 'keys') return !t.fromTune;
    return true;
  }
  panelValue(k: PanelKey) {
    const t = this.t;
    switch (k) {
      case 'harmony': return (t.harmony ?? this.guessed()) || 'None yet';
      case 'kind': return CATEGORIES[t.category] || 'Other';
      case 'vary': return !t.vary ? 'Key only' : `${t.vary.types.map((id) => typeInfo(t.vary!.kind, id)?.short || id).join(' ')} · ${(SHAPES[t.vary.shape]?.label || '').toLowerCase()}`;
      case 'keys': return t.keyMode === 'none' ? 'No key' : `${t.keysPerSession} · ${KEY_MODES[t.keyMode].label.toLowerCase()}${t.keyMode === 'fixed' && t.keys.length ? `: ${t.keys.map((k) => rootName(k)).join(' ')}` : ''}`;
      case 'level': return LEVELS[t.level ?? 0].label;
      case 'priority': return PRIORITIES[(t.priority || 3) - 1].label;
    }
  }
  settings() {
    const t = this.t;
    const keys = (Object.keys(PANEL_LABELS) as PanelKey[]).filter((k) => this.shown(k));
    if (this.isNew) return keys.map((k) => html`<label class="field-label">${PANEL_LABELS[k]}</label>${this.panelBody(k)}`);
    const row = (key: PanelKey) => ({ key, label: PANEL_LABELS[key], value: this.panelValue(key) });
    const help = helpParts('x-tunes-help', TUNES_HELP);
    return html`${settingRows([
      ...keys.slice(0, 2).map(row),
      !t.fromTune && { content: html`<label class="as-written use-tunes"><span>Use with tunes${help.btn}</span><input type="checkbox" id="x-tunes" .checked=${!t.solo}
        @change=${(e: Event) => { if ((e.target as HTMLInputElement).checked) delete t.solo; else t.solo = true; this.commit(); }}></label>` },
      ...keys.slice(2).map(row),
    ], (k) => (this.panel = k as PanelKey))}${t.fromTune ? nothing : help.text}`;
  }
  // Varying exercises are written out from their pattern: Edit pattern opens its panel.
  async toPattern() {
    this.panel = 'vary';
    await this.updateComplete;
    this.querySelector('.sub-panel .pattern-card')?.scrollIntoView({ block: 'start' });
  }
  // After the scale or chord settings change, today's types for this exercise are picked again
  // (unless it's already been played today).
  varyChanged() {
    if (this.planItem) {
      refreshTypes(this.t);
      this.previewType = this.typeFor(this.previewRoot);
    }
    this.commit();
  }
  panelBody(k: PanelKey) {
    const t = this.t;
    switch (k) {
      case 'harmony': return this.harmonyBody();
      case 'kind': return html`<div class="chips wrap" id="x-cat">${(Object.entries(CATEGORIES) as [Category, string][]).map(([c, l]) => html`<button class="chip ${t.category === c ? 'on' : ''}" data-cat=${c} @click=${() => { t.category = c; this.commit(); }}>${l}</button>`)}</div>`;
      case 'vary': return this.varyBody();
      case 'keys': return this.keysBody();
      case 'level': return html`<div class="seg four" data-field="level">${segButtons(LEVELS.map((l) => [l.v, l.label] as const), t.level, (v) => { setLevel(t, v); this.commit(); })}</div>`;
      case 'priority': return html`<div class="seg four" data-field="priority">${segButtons(PRIORITIES.map((p) => [p.v, p.label] as const), t.priority, (v) => { t.priority = v as Priority; this.commit(); })}</div>`;
    }
  }
  // The chords a written exercise goes with (so it can be a warm-up over them in tunes): typed
  // here, or else read from the chord symbols in its notation. As written, like the notes.
  harmonyBody() {
    const t = this.t;
    const text = this.harmonyText.trim();
    const bad = !!text && !chordsFromText(text);
    const msg = bad ? 'Couldn’t read those chords — like Dm7 G7 Cmaj7.'
      : t.harmony ? 'As typed here (clear it to go back to the notation’s chord symbols).'
      : this.guessed() ? 'From the chord symbols in its notation.' : '';
    return html`
      <div class="field"><input id="x-harmony" .value=${this.harmonyText} placeholder="e.g. Dm7 G7 Cmaj7" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Chords it goes with"
        @input=${(e: Event) => this.setHarmony((e.target as HTMLInputElement).value)}></div>
      <p class="fine ${bad ? 'error' : ''}" id="x-harmony-msg">${msg}</p>
      <p class="fine">The chords it goes over, as written, like the notes — so it comes up as a warm-up for tunes with those chords. Read from the chord symbols in its notation, or typed here.</p>`;
  }
  setHarmony(value: string) {
    const t = this.t;
    this.harmonyText = value;
    const text = value.trim();
    if (text && !chordsFromText(text)) return; // (said so, under it)
    if (!text || text === this.guessed()) delete t.harmony; // the notation's own, then
    else t.harmony = text;
    this.commit();
  }
  varyBody() {
    const t = this.t, vary = t.vary;
    const setKind = (kind: Vary['kind'] | '') => {
      if ((vary?.kind || '') === kind) return;
      t.vary = kind ? { kind, types: [...VARY[kind].defaults], shape: 'updown', pattern: '' } : null;
      this.previewType = t.vary?.types[0];
      this.varyChanged();
    };
    return html`
      <div class="seg" id="x-vary">${([['', 'Key only'], ['scale', 'Scale type'], ['chord', 'Chord type']] as const).map(([v, l]) => html`
        <button class=${(vary?.kind || '') === v ? 'on' : ''} data-vary=${v} @click=${() => setKind(v)}>${l}</button>`)}
      </div>
      <p class="fine">${vary ? `Each key comes with one of the ${vary.kind === 'scale' ? 'scales' : 'chords'} turned on here, favouring the ones you’ve played least. The notation is written out for each.` : 'Practice it in a different key each time — or with a different scale or chord type in each key, too.'}</p>
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
    if (on && vary.types.length === 1) return toast('Keep at least one turned on');
    // Keep the catalogue's order.
    vary.types = Object.keys(typesOf(vary.kind)).filter((x) => (x === id ? !on : vary.types.includes(x)));
    if (!vary.types.includes(this.previewType!)) this.previewType = vary.types[0];
    this.varyChanged();
  }
  setShape(shape: Shape) {
    const vary = this.t.vary!;
    // Custom starts from the preset that was chosen (its numbers to change).
    if (shape === 'custom' && vary.shape !== 'custom') vary.pattern = patternText(vary.kind, vary.shape, vary.pattern);
    vary.shape = shape;
    this.commit();
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
      vary.shape = 'custom';
      vary.pattern = list.join(' ');
      this.stopPlaying();
      this.commit();
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
      <div class="chips wrap" id="x-mode">${(Object.entries(KEY_MODES) as [KeyMode, (typeof KEY_MODES)[KeyMode]][]).map(([k, m]) => html`<button class="chip ${t.keyMode === k ? 'on' : ''}" data-mode=${k} @click=${() => { t.keyMode = k; this.commit(); }}>${m.label}</button>`)}</div>
      <p class="fine">${KEY_MODES[t.keyMode].hint}</p>
      ${t.keyMode === 'fixed' ? html`<div class="keygrid" id="x-fixed">${[...Array(12).keys()].map((w) => {
        const r = writtenToConcert(w, view());
        return html`<button class=${t.keys.includes(r) ? 'on' : ''} data-fixed=${r} @click=${() => { t.keys = t.keys.includes(r) ? t.keys.filter((x) => x !== r) : [...t.keys, r]; this.commit(); }}>${rootName(r)}</button>`;
      })}</div>` : nothing}
      ${t.keyMode !== 'none' ? html`
        <div class="setting">
          <div><b>Keys per session</b><span>How many keys to play it in each time</span></div>
          <div class="stepper" id="x-kps">${stepperButtons(t.keysPerSession, (v) => { t.keysPerSession = v; this.commit(); }, 1, 12)}</div>
        </div>` : nothing}`;
  }

  // ---------- Below the settings ----------
  // Recordings, up top by the notation.
  takes() {
    const takes = entriesFor(this.t.id).filter((e) => e.media?.length);
    return html`
      <div class="field-label row-label"><span>Recordings</span><span class="row-links">
        <button class="link-btn" id="x-rec" @click=${() => this.goTo(() => openRecorder({ itemId: this.t.id, back: this.back, text: this.label() }))}>${raw(ICON.rec)}Record</button></span></div>
      ${takes.length ? html`<ul class="notes panel-list" id="x-takes" @click=${{ handleEvent: () => this.stopPlaying(), capture: true }}>${noteRows(takes.slice(0, 3), { showDate: true, back: this.back, onChange: () => this.requestUpdate() })}</ul>
        ${takes.length > 3 ? html`<p class="fine">${takes.length - 3} more in the Diary.</p>` : nothing}`
        : raw(hintHtml('takes', 'Record yourself playing it to hear how it’s coming along. Takes are kept here and in the Diary.', 'fine'))}`;
  }
  history() {
    const t = this.t;
    const s = itemStats().get(t.id);
    const entries = store.state.log.filter((e) => e.itemId === t.id).sort((a, b) => b.date.localeCompare(a.date));
    const played = this.isPlayed();
    const notes = entriesFor(t.id).filter((e) => !e.media?.length);
    return html`
      <div class="history">
        <div class="history-head">
          <div><b>${s?.count || 0}×</b> played · last ${ago(s?.last)}</div>
          <button class="pill-btn ${played ? 'on' : ''}" id="x-log" @click=${() => this.logToday()}>${raw(ICON.check)}${played ? 'Played today' : 'Log for today'}</button>
        </div>
        ${entries.length ? html`<ul class="history-list">${entries.slice(0, 8).map((e) => html`
          <li><span>${niceDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          <span>${e.progName ? `${e.progName} in ${rootName(entryKeys(e)[0] ?? 0)}` : exerciseKeysText(entryKeys(e), t, e.types)}${e.bpm ? ` · ${e.bpm} bpm` : ''}</span>
          <span class="r-${e.rating || 'ok'}">${RATINGS.find((r) => r.v === (e.rating || 'ok'))!.label}</span></li>`)}</ul>` : nothing}
      </div>
      <div class="field-label row-label"><span>Diary</span><span class="row-links">
        <button class="link-btn" id="x-note" @click=${() => this.goTo(() => openNote(null, { itemId: t.id, back: this.back }))}>${raw(ICON.plus)}Add a note</button></span></div>
      ${notes.length
        ? html`<ul class="notes panel-list" @click=${{ handleEvent: () => this.stopPlaying(), capture: true }}>${noteRows(notes.slice(0, 5), { showDate: true, back: this.back, onChange: () => this.requestUpdate() })}</ul>`
        : html`<p class="fine">Notes about this exercise show up here.</p>`}`;
  }
  logToday() {
    const t = this.t;
    if (this.isPlayed()) unmarkPlayed(t.id, this.logItem());
    else {
      markPlayed(t.id, this.logItem() || { keys: this.todayKeys });
      autoStart();
      haptic();
    }
    save();
    this.requestUpdate();
  }
  rename(el: HTMLTextAreaElement) {
    el.value = el.value.replace(/\s*\n\s*/g, ' ');
    this.t.name = el.value;
    if (!this.isNew && this.t.name.trim()) save();
    this.requestUpdate();
  }
  add() {
    if (!this.t.name.trim()) { this.querySelector<HTMLElement>('#x-name')!.focus(); return toast('Give the exercise a name'); }
    closeSheet(); // adds it
  }
  // ⋯: add to today, swap or take it out (from its card), try it through a tune, delete.
  menu(anchor: HTMLElement) {
    const t = this.t, planItem = this.planItem;
    const card = this.opts.pid && planItem?.pid === this.opts.pid && !isPlanItemPlayed(planItem) ? planItem : null;
    openMenu(anchor, [
      !planItem?.warmup && !inToday(t) && { label: 'Add to today’s set', fn: () => { if (addToToday(t)) toast(`Added ${t.name} to today’s set`); this.requestUpdate(); } },
      card && { label: 'Swap for another', fn: () => { closeSheet(); swapInToday(card); } },
      card && { label: 'Take out of today’s set', fn: () => { closeSheet(); removeFromToday(card); } },
      !t.solo && { label: 'Try it through a tune…', fn: () => this.goTo(() => pickTune(t, { back: this.back })) },
      { label: 'Delete exercise', danger: true, fn: () => {
        if (!confirm(`Delete “${t.name}” and its practice history?`)) return;
        closeSheet();
        withUndo(`Deleted ${t.name}`, () => deleteItem(t.id));
      } },
    ]);
  }
}

// ---------- Notation editor ----------

const METERS = ['4/4', '3/4', '5/4', '6/8', '2/4'];

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

// Edit an exercise's notation (written in its own key: Written in) with a tap keypad or by typing ABC.
// Chord types to tap in the editor: [as written in the notation, label].
const CHORD_QUALITIES = [['maj7', 'Δ7'], ['6', '6'], ['m7', 'm7'], ['m6', 'm6'], ['7', '7'], ['7b9', '7♭9'],
  ['7#9', '7♯9'], ['7alt', '7alt'], ['7sus', '7sus'], ['m7b5', 'ø7'], ['dim7', '°7'], ['m(maj7)', 'mΔ7']];

export function openNotationEditor(t: Exercise, back?: () => void): void {
  let body = t.abc || '';
  let meter = t.meter || '4/4';
  let duration: Duration = 'eighth';
  let dotted = false;
  let accidental = '';
  let typing = false;
  let stopFn: (() => void) | null = null;
  let chord = { open: false, root: '', acc: '' }; // a chord symbol being picked
  const original = { abc: t.abc || '', meter: t.meter || '4/4', home: t.home };
  let tune: TuneObject | null = null;

  const sheet = openSheet(`
    <p class="eyebrow">Notation · ${esc(t.name)}</p>
    <label class="ne-home">Written in <select id="ne-home" aria-label="Key it's written in">${[...Array(24).keys()].map((k) => `<option value="${k}" ${k === (t.home ?? 0) ? 'selected' : ''}>${esc(homeName(k))}</option>`).join('')}</select></label>
    <div class="notation editor-preview" id="ne-preview"></div>
    <div class="ne-text">
      <textarea id="ne-abc" rows="3" inputmode="none" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Notation (ABC)">${esc(body)}</textarea>
      <button class="icon-btn small" id="ne-type" aria-label="Type with the keyboard" title="Type with the keyboard">⌨</button>
    </div>
    <div class="keypad" id="ne-pad">
      <div class="kp-row durations">${Object.entries(DURATIONS).map(([k, d]) => `<button data-dur="${k}" class="${k === duration ? 'on' : ''}" aria-label="${d.label}">${noteIcon(k)}</button>`).join('')}
        <button data-dot aria-label="Dotted">•</button>
        <button data-trip aria-label="Triplet">3</button>
      </div>
      <div class="kp-row mods">
        <button data-acc="^" aria-label="Sharp">♯</button>
        <button data-acc="_" aria-label="Flat">♭</button>
        <button data-acc="=" aria-label="Natural">♮</button>
        <button data-oct="-1" aria-label="Last note down an octave">↓8</button>
        <span class="oct" id="ne-oct"></span>
        <button data-oct="1" aria-label="Last note up an octave">↑8</button>
        <button data-chord aria-label="Chord symbol">Chord</button>
      </div>
      <div class="kp-row notes">${['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((n) => `<button data-note="${n}">${n}</button>`).join('')}</div>
      <div class="kp-row tools">
        <button data-rest aria-label="Rest">Rest</button>
        <button data-tie aria-label="Tie">Tie</button>
        <button data-ins=" " aria-label="Space (breaks beaming)">␣</button>
        <button data-ins=" | " aria-label="Bar line">|</button>
        <button data-move="-1" aria-label="Previous note">◀</button>
        <button data-move="1" aria-label="Next note">▶</button>
        <button data-back aria-label="Delete">⌫</button>
      </div>
      <div class="kp-chord" id="ne-chord" hidden>
        <div class="kp-row notes">${['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((n) => `<button data-croot="${n}">${n}</button>`).join('')}</div>
        <div class="kp-row chord-mods">
          <button data-cacc="b" aria-label="Flat root">♭</button><button data-cacc="#" aria-label="Sharp root">♯</button>
          <span class="oct" id="ne-chord-root">Root?</span>
          <button data-cother>Type…</button><button data-cclose aria-label="Close chords">✕</button>
        </div>
        <div class="kp-row qualities">${CHORD_QUALITIES.map(([q, label]) => `<button data-cq="${q}">${label}</button>`).join('')}</div>
      </div>
    </div>
    <div class="ne-opts">
      <label>Time <select id="ne-meter">${METERS.map((m) => `<option ${m === meter ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <button class="pill-btn" id="ne-play">${ICON.play}<span>Play</span></button>
      ${playbackOptionsHtml()}
    </div>
    <details class="ne-help"><summary>How to write it</summary>
      <p class="fine">Write it in any key (<b>Written in</b>, above), as you read it on your instrument — it’s transposed from there into each key you practice. Lengths are in eighth notes: <code>C</code> eighth, <code>C2</code> quarter, <code>C/</code> sixteenth, <code>C3</code> dotted quarter. <code>^</code> sharp, <code>_</code> flat, each note goes in the octave nearest the one before it; <b>↑8</b> <b>↓8</b> move the note before the cursor (lowercase = octave up, <code>'</code> and <code>,</code> another octave). <b>Chord</b> adds a chord symbol over the next note: tap its root, then its type (<code>"Dm7"</code>; ø7 is <code>m7b5</code>).</p>
    </details>
    <button class="primary-btn" id="ne-save">Done</button>
    <button class="link-btn ne-revert" id="ne-revert" hidden>Undo changes</button>
  `, () => {
    stopFn?.();
    stopPlayback();
    back?.();
  });

  const area = $<HTMLTextAreaElement>('#ne-abc', sheet);
  const preview = $('#ne-preview', sheet);
  let drawTimer: ReturnType<typeof setTimeout> | undefined;
  // Every change is saved as it's made (Undo changes puts back what it was when opened).
  const keep = () => {
    t.abc = body.trim();
    t.meter = meter;
    save();
    $('#ne-revert', sheet).hidden = t.abc === original.abc.trim() && t.meter === original.meter && t.home === original.home;
  };
  const draw = () => {
    keep();
    clearTimeout(drawTimer);
    drawTimer = setTimeout(async () => {
      tune = await renderNotation(preview, body, { meter, tempo: t.tempo || 100, key: t.home ?? 0 }).catch(() => null);
    }, 120);
  };
  const showMods = () => {
    $$('[data-dur]', sheet).forEach((b) => b.classList.toggle('on', b.dataset.dur === duration));
    $('[data-dot]', sheet).classList.toggle('on', dotted);
    $$('[data-acc]', sheet).forEach((b) => b.classList.toggle('on', b.dataset.acc === accidental));
    $('#ne-chord', sheet).hidden = !chord.open;
    $('#ne-pad', sheet).classList.toggle('chording', chord.open); // (in place of the note keys)
    $('[data-chord]', sheet).classList.toggle('on', chord.open);
    $$('[data-croot]', sheet).forEach((x) => x.classList.toggle('on', x.dataset.croot === chord.root));
    $$('[data-cacc]', sheet).forEach((x) => x.classList.toggle('on', x.dataset.cacc === chord.acc));
    $('#ne-chord-root', sheet).textContent = chord.root ? `${chord.root}${chord.acc.replace('b', '♭').replace('#', '♯')}…` : 'Root?';
    // The note before the cursor (the next one goes nearest it; ↑8 ↓8 move it).
    const n = lastNote(body.slice(0, area.selectionStart ?? body.length));
    $('#ne-oct', sheet).textContent = n ? `${n.letter}${n.octave}` : '';
  };

  // Insert at the cursor, or at the end.
  const insert = (text: string) => {
    const start = area.selectionStart ?? body.length;
    const end = area.selectionEnd ?? body.length;
    body = body.slice(0, start) + text + body.slice(end);
    area.value = body;
    const pos = start + text.length;
    area.setSelectionRange(pos, pos);
    draw();
  };
  // Move the note before the cursor up or down an octave.
  const moveLast = (d: number) => {
    const pos = area.selectionStart ?? body.length;
    const r = moveLastNote(body.slice(0, pos), d);
    if (!r) return;
    body = r.text + body.slice(pos);
    area.value = body;
    area.setSelectionRange(pos + r.delta, pos + r.delta);
    draw();
  };
  // Remove the token before the cursor (a note with its accidental and length, a bar, a space…).
  const backspace = () => {
    const pos = area.selectionStart ?? body.length;
    const before = body.slice(0, pos);
    const m = /("[^"]*"|\(3|[_^=]*[A-Ga-gz][,']*\d*\/?\d*-?|\s*\|\s*|\s+|.)$/.exec(before);
    if (!m) return;
    body = before.slice(0, before.length - m[0].length) + body.slice(pos);
    area.value = body;
    const p = before.length - m[0].length;
    area.setSelectionRange(p, p);
    draw();
  };

  // Move the cursor a note (or bar line, or triplet mark) at a time, skipping spaces.
  const TOKEN = /\(3|(?:"[^"]*"\s*)?[_^=]*[A-Ga-gz][,']*\d*\/?\d*-?|\|/g; // a chord symbol goes with its note
  const step = (dir: number) => {
    const pos = area.selectionStart ?? body.length;
    const stops = [0];
    for (const m of body.matchAll(TOKEN)) stops.push(m.index + m[0].length);
    stops.push(body.length);
    const to = dir > 0 ? stops.find((p) => p > pos) ?? body.length : [...stops].reverse().find((p) => p < pos) ?? 0;
    area.focus();
    area.setSelectionRange(to, to);
  };

  // The key it's written in: the key signature changes, the notes keep their pitches.
  $('#ne-home', sheet).onchange = (e) => {
    const k = Number((e.target as HTMLSelectElement).value);
    body = rekey(body, t.home ?? 0, k);
    area.value = body;
    if (k) t.home = k;
    else delete t.home;
    draw();
  };
  $('#ne-pad', sheet).onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.dur) { duration = b.dataset.dur as Duration; dotted = false; }
    else if (b.hasAttribute('data-dot')) dotted = !dotted;
    else if (b.hasAttribute('data-trip')) insert('(3');
    else if (b.dataset.acc != null) accidental = accidental === b.dataset.acc ? '' : b.dataset.acc;
    else if (b.dataset.oct) moveLast(Number(b.dataset.oct));
    else if (b.dataset.note) {
      // In the octave nearest the note before it (move it after with ↑8 ↓8).
      const octave = nearestOctave(b.dataset.note, lastNote(body.slice(0, area.selectionStart ?? body.length)));
      insert(noteToken({ letter: b.dataset.note, accidental, octave, duration, dotted }));
      accidental = ''; // accidentals apply to one note
      haptic();
    } else if (b.hasAttribute('data-rest')) insert(restToken(duration, dotted));
    else if (b.hasAttribute('data-tie')) insert('-');
    else if (b.dataset.ins) insert(b.dataset.ins);
    else if (b.hasAttribute('data-back')) backspace();
    else if (b.dataset.move) step(Number(b.dataset.move));
    // Chord symbols (over the next note; as written, like the notes, and transposed with them):
    // tap a root (♭ ♯), then its type — or type one.
    else if (b.hasAttribute('data-chord') || b.hasAttribute('data-cclose')) {
      chord = { open: b.hasAttribute('data-chord') && !chord.open, root: '', acc: '' };
    } else if (b.dataset.croot) chord.root = b.dataset.croot;
    else if (b.dataset.cacc) chord.acc = chord.acc === b.dataset.cacc ? '' : b.dataset.cacc;
    else if (b.dataset.cq != null) {
      if (!chord.root) return toast('Tap the chord’s root first');
      insert(`"${chord.root}${chord.acc}${b.dataset.cq}"`);
      chord = { open: false, root: '', acc: '' };
    } else if (b.hasAttribute('data-cother')) {
      const sym = (prompt('Chord symbol, as written (like Dm7, G7, Bø7, Cmaj7):') || '').replace(/["\s]/g, '');
      if (sym && !parseChord(sym)) return toast(`“${sym}” isn’t a chord symbol I can read`);
      if (sym) insert(`"${sym}"`);
      chord = { open: false, root: '', acc: '' };
    }
    showMods();
  };
  // Keep the keypad from stealing the cursor position.
  $('#ne-pad', sheet).onpointerdown = (e) => e.preventDefault();

  area.oninput = () => { body = area.value; draw(); showMods(); };
  area.onclick = showMods; // (the note before the cursor)
  $('#ne-type', sheet).onclick = () => {
    typing = !typing;
    area.setAttribute('inputmode', typing ? 'text' : 'none');
    $('#ne-type', sheet).classList.toggle('on', typing);
    area.blur();
    area.focus();
  };
  $('#ne-meter', sheet).onchange = (e) => { meter = (e.target as HTMLSelectElement).value; draw(); };
  bindPlaybackOptions(sheet, () => { if (stopFn) { stopFn(); stopFn = null; $('span', $('#ne-play', sheet)).textContent = 'Play'; } });
  const play = $('#ne-play', sheet);
  play.onclick = async () => {
    if (stopFn) { stopFn(); stopFn = null; $('span', play).textContent = 'Play'; return; }
    if (!tune) return;
    $('span', play).textContent = '…';
    try {
      stopFn = await playNotation(tune, {
        transpose: soundingShift(view()),
        ...playbackFor(meter),
        onEnded: () => { stopFn = null; $('span', play).textContent = 'Play'; },
        onFallback: (id) => toast(`Couldn’t load the ${SOUNDS[id].label.toLowerCase()} sound — playing the synth`),
      });
      if (stopFn !== null) $('span', play).textContent = 'Stop'; // (always: playNotation returns its stop)
    } catch {
      stopFn = null;
      $('span', play).textContent = 'Play';
      toast('Couldn’t play audio on this device');
    }
  };
  $('#ne-save', sheet).onclick = () => closeSheet();
  $('#ne-revert', sheet).onclick = () => {
    body = original.abc;
    meter = original.meter;
    if (original.home) t.home = original.home;
    else delete t.home;
    area.value = body;
    $<HTMLSelectElement>('#ne-meter', sheet).value = meter;
    $<HTMLSelectElement>('#ne-home', sheet).value = String(t.home ?? 0);
    draw();
    toast('Back to how it was');
  };

  showMods();
  draw();
}

// ---------- Library list ----------

// An exercise's row in the library.
export function exerciseRow(t: Exercise, stats: Map<Id, ItemStats>): TemplateResult {
  const s = stats.get(t.id);
  const mode = t.keyMode === 'none' ? 'No key' : `${t.keysPerSession} key${t.keysPerSession > 1 ? 's' : ''} · ${KEY_MODES[t.keyMode].label.toLowerCase()}`;
  return html`
  <li class="row ${t.off ? 'off' : ''}" data-id=${t.id} role="button" tabindex="0">
    <div class="row-main">
      <b>${t.focus ? html`<span class="focus-mark" title="Focus">${raw(ICON.focus)}</span>` : nothing}${t.name}${t.abc ? html` <span class="has-abc" title="Has notation">♪</span>` : nothing}${t.off ? html` <span class="off-mark">off</span>` : nothing}</b>
      <span class="row-sub">${CATEGORIES[t.category] || 'Other'} · ${mode} · ${ago(s?.last)}</span>
    </div>
    ${raw(priBadge(t.priority))}
  </li>`;
}
