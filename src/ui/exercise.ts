import { store } from '../store.js';
import { autoStart } from '../practicetime.js';
import { RATINGS, CATEGORIES, KEY_MODES } from '../constants.js';
import { dateStr, niceDate, ago } from '../dates.js';
import { keyName, writtenToConcert } from '../keys.js';
import { itemStats, itemById, isPlayedToday, isPlanItemPlayed, levelSuggestion, playTempo } from '../practice.js';
import { itemStatus, inToday, typeCounts, todayItem } from '../plan.js';
import { chartFor } from '../charts.js';
import './chart.js'; // (<ws-chart>)
import './exercise-settings.js'; // (<ws-exercise-settings>)
import type { ExerciseSettings } from './exercise-settings.js';
import { swapInToday, removeFromToday } from './today.js';
import { pickTune } from './pickers.js';
import { harmonyOf } from '../warmups.js';
import { entryKeys } from '../keystats.js';
import { entriesFor } from '../diary.js';
import { soundingShift, homeKey, homeShift, homeName, chordTimes } from '../abc.js';
import { chordsInAbc, chordName, chordChanges, abcFirstChords } from '../chords.js';
import { VARY, typeInfo, variantName, generateAbc, progressionAbc, chooseTypes } from '../theory.js';
import { canRecord } from '../media.js';
import { renderNotation, playNotation, playbackOptions, playbackFor, openFullNotation } from './notation.js';
import { noteRows, openNote } from './diary.js';
import { openNotationEditor } from './notation-editor.js';
import { openRecorder } from './recorder.js';
import { tempoRow, tempoSuggestionPart, openMetronome } from './metronome.js';
import { tempoSuggestion } from '../tempo.js';
import { SOUNDS } from '../sounds.js';
import { metronome } from '../metronome.js';
import { customElement, state } from 'lit/decorators.js';
import {
  View, html, nothing, live, raw, openSheetView, statusControl, levelSuggestionPart, helpParts,
  type TemplateResult, priBadge } from './lit.js';
import type { TuneObject } from 'abcjs';
import type { Exercise, Id, Item, ItemStats, Key, PlanItem, Progression, Tune } from '../types.js';
import {
  ICON, render, toast, perform, haptic, closeSheet, kn, openMenu, overLabel } from './shell.js';
import * as cmd from '../commands/index.js';

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
    : cmd.blank.exercise();
  if (!item || item.type !== 'exercise') return;
  const el = document.createElement('ws-exercise-sheet') as ExerciseSheet;
  el.setup(item, !id, opts);
  openSheetView(el, () => el.closed());
}

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
  forTune: Tune | null = null; // the tune it's a warm-up for (with a tempo of its own: see playTempo)
  @state() todayKeys: Key[] = []; // changes if today's keys are edited
  @state() previewRoot: Key = 0; // the key shown
  @state() previewType: string | undefined; // the scale or chord type shown
  @state() playing: 'no' | 'loading' | 'yes' = 'no';
  private stopFn: (() => void) | null = null;
  private tune: TuneObject | null = null; // the notation drawn, to play
  private drawn = ''; // what the notation was drawn for (it's drawn again when that changes)
  private drawnIn: HTMLElement | null = null; // …and where (a new place, e.g. its card shown again, is drawn in afresh)
  private plays = 0; // each Play, so one stopped while its sound loads can tell
  private leaving = false; // to another sheet (note, recorder, editor), coming back after
  private added = false;

  setup(t: Exercise, isNew: boolean, opts: ExerciseOpts) {
    Object.assign(this, { t, isNew, opts });
    const state = store.state;
    this.today = state.plan?.date === dateStr() ? state.plan.items.filter((i) => i.itemId === t.id) : [];
    this.planItem = this.today.find((i) => opts.pid && i.pid === opts.pid) || this.today.find((i) => !i.warmup) || null;
    this.prog = this.planItem?.prog || opts.prog || null;
    this.forTune = (this.planItem?.warmup && itemById(this.planItem.warmup) as Tune | undefined) || null;
    this.todayKeys = opts.keys || this.planItem?.keys || [];
    this.previewRoot = this.asWritten() || t.keyMode === 'none' ? this.writtenC() : this.todayKeys[0] ?? 0;
    this.previewType = this.typeFor(this.previewRoot);
  }
  // Closed: a new exercise with a name is added (unless it's going on to its notation); going
  // back to where it was opened from.
  closed() {
    this.stopPlaying();
    if (this.isNew && !this.leaving) this.addNew();
    if (!this.isNew) render();
    if (!this.leaving) this.opts.back?.();
  }
  addNew() {
    const t = this.t;
    if (this.added || !t.name.trim()) return;
    this.added = true;
    perform(cmd.addDraft, { draft: t });
  }
  // Leave this sheet for another (note, recorder, editor) and come back after.
  goTo(fn: () => void) {
    this.leaving = true;
    closeSheet();
    fn();
  }
  back = () => openExercise(this.t.id, { ...this.opts, keys: this.todayKeys }); // (as it was opened: a warm-up stays one)
  // A change to it: one being made (not in the library yet) takes it straight away; otherwise it's
  // the update_item command, saved and undoable (which also picks today's keys and types again
  // when how it picks them changes). Then shown. False if it couldn't be done (it says why).
  edit(fields: cmd.ItemFields): boolean {
    let ok = true;
    if (!this.isNew) ok = !!perform(cmd.updateItem, { item: this.t.id, ...fields });
    else {
      try { cmd.applyItem(this.t, fields); } catch (err) { if (!(err instanceof cmd.CommandError)) throw err; toast(err.message); ok = false; }
    }
    this.refresh();
    return ok;
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
  // Its tempo: its own, or as a warm-up, the warm-up's (the tempo row, notation, bass and takes use it).
  tempo() { return playTempo(this.t, this.forTune ? this.planItem : null); }
  // The metronome's (and bass's) target: the exercise, and which warm-up it is.
  warmPid() { return this.forTune ? this.planItem!.pid : undefined; }
  // A lick played over part of a progression: in which key only its first so many chords (all of
  // it when it's shown only as written).
  partFor(root: Key) { return this.asWritten() ? null : this.planItem?.parts?.[this.todayKeys.indexOf(root)] ?? null; }
  abc() { return notationFor(this.t, this.previewType, this.prog, this.partFor(this.previewRoot)); }
  shift() { return homeShift(this.previewRoot, homeKey(this.t), view()); }
  // A new take's note: today's keys and types, or else the key (and type) shown.
  label() {
    const t = this.t, prog = this.prog;
    return prog || !this.todayKeys.length
      ? takeLabel(t, [this.previewRoot], this.previewType ? [this.previewType] : null, prog, this.tempo())
      : takeLabel(t, this.todayKeys, this.todayTypes(), prog, this.tempo());
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
    return list.map((c) => ({ root: (((c.root + up) % 12) + 12) % 12, family: c.family, q: c.q, beats: c.beats }));
  }
  startBass() {
    const chords = this.bassChords();
    if (!chords.length) return;
    const beats = Number(String(this.t.meter || '4/4').split('/')[0]) || 4;
    metronome.start({
      bpm: this.tempo() || 100, beats: this.prog ? 4 : beats, itemId: this.t.id, pid: this.warmPid(),
      bass: { chords, owner: this.bassOwner, label: this.prog ? this.prog.name : this.t.name },
      click: store.state.settings.bassClick, countIn: store.state.settings.bassCountIn,
    });
  }

  // ---------- Playing the notation ----------
  stopPlaying() {
    this.plays++; // (one still loading is stopped as soon as it starts)
    this.stopFn?.();
    this.stopFn = null;
    this.playing = 'no';
  }
  async play() {
    if (this.stopFn) return this.stopPlaying();
    if (!this.tune || this.playing === 'loading') return;
    const play = ++this.plays;
    this.playing = 'loading'; // the first time, the sound loads
    try {
      const stop = await playNotation(this.tune, {
        transpose: this.shift() + soundingShift(view()),
        ...playbackFor(this.t.meter),
        onEnded: () => { this.stopFn = null; this.playing = 'no'; },
        onFallback: (id) => toast(`Couldn’t load the ${SOUNDS[id].label.toLowerCase()} sound — playing the synth`),
      });
      if (play !== this.plays) return stop(); // stopped (or the sheet closed) while it loaded
      this.stopFn = stop;
      this.playing = 'yes';
    } catch {
      if (play !== this.plays) return;
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
      draw: async (el) => { fullTune = await renderNotation(el, abc, { shift, key: homeKey(t), meter: t.meter, tempo: this.tempo() || 100, wide: true }).catch(() => null); },
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
      this.added = true;
      perform(cmd.addDraft, { draft: t }, { quiet: true });
    }
    this.goTo(() => openNotationEditor(t, this.back));
  }

  render() {
    const t = this.t, isNew = this.isNew, prog = this.prog, planItem = this.planItem;
    return html`
      <textarea class="title-input" id="x-name" rows="1" placeholder="Exercise name" aria-label="Exercise name" enterkeyhint="done" ?autofocus=${isNew}
        .value=${live(t.name)} @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
        @input=${(e: Event) => this.rename(e.target as HTMLTextAreaElement)}></textarea>
      ${isNew ? nothing : statusControl(t, itemStatus(t), (st) => this.edit({ status: st }), (b) => this.menu(b))}
      ${isNew ? nothing : planItem?.warmup
        ? html`<p class="in-today">${raw(ICON.check)}In today’s set, as a warm-up for ${itemById(planItem.warmup)?.name || 'a tune'}</p>`
        : inToday(t) ? html`<p class="in-today">${raw(ICON.check)}In today’s set</p>` : nothing}

      <div class="field-label row-label"><span>Notation</span>${t.vary ? html`<button class="link-btn" id="x-to-pattern" @click=${() => this.toPattern()}>Edit pattern</button>`
        : t.abc ? html`<button class="link-btn" id="x-edit-abc" @click=${() => this.editNotation()}>Edit</button>` : nothing}</div>
      ${t.fromTune && !prog ? html`<p class="fine">This one takes its chords from a tune, so it comes up as a warm-up: tap <b>+ Warm-up</b> on a tune’s card in Today, or <b>Add a warm-up</b> under its chart.</p>` : nothing}
      ${t.vary || t.abc || prog ? this.notationCard() : html`<button class="ghost-btn" id="x-add-abc" @click=${() => this.editNotation()}>${raw(ICON.plus)}<span>Add notation</span></button>`}
      ${planItem && this.forTune && !prog && chartFor(this.forTune) // (a warm-up: its tune's chart, in the tune's key)
        ? html`<div class="x-tune-chart" id="x-tune-chart"><ws-chart .tune=${this.forTune} .compact=${true} .startKey=${todayItem(this.forTune)?.key ?? (planItem.form ? planItem.overKey ?? null : null)}></ws-chart></div>` : nothing}
      ${this.todayKeysPart()}
      <label class="field">
        <span class="field-label">How to practice it</span>
        <textarea id="x-notes" rows="3" placeholder="Tempo, articulation, range, variations…" .value=${live(t.notes)} @input=${(e: Event) => this.edit({ notes: (e.target as HTMLTextAreaElement).value })}></textarea>
      </label>
      ${isNew ? nothing : levelSuggestionPart(levelSuggestion(t), (l) => this.edit({ level: l }))}

      ${isNew ? nothing : this.forTune
        ? html`<div data-item-id=${t.id}>${tempoRow({ id: t.id, tempo: this.tempo() }, () => this.openMetronome(), 'warm-up tempo')}<p class="fine">It started at ${this.forTune.name}’s tempo; changing one doesn’t change the other.</p></div>`
        : html`<div data-item-id=${t.id}>${tempoRow(t, () => this.openMetronome())}${tempoSuggestionPart(t, tempoSuggestion(t), () => this.requestUpdate())}</div>`}
      ${isNew || !canRecord() ? nothing : this.takes()}
      <ws-exercise-settings .sheet=${this}></ws-exercise-settings>
      ${isNew ? html`<button class="primary-btn" id="x-save" @click=${() => this.add()}>Add exercise</button>` : this.history()}
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
    this.goTo(() => openMetronome({ itemId: this.t.id, pid: this.warmPid(), back: this.back }));
  }
  // The notation in the key and type shown, drawn again when that changes.
  async drawNotation() {
    const el = this.querySelector<HTMLElement>('#x-notation');
    const abc = this.abc();
    const what = el && abc ? `${abc}|${this.shift()}|${homeKey(this.t)}|${this.t.meter}` : '';
    if (!el || !abc || (what === this.drawn && el === this.drawnIn)) return;
    this.drawn = what;
    this.drawnIn = el;
    this.tune = await renderNotation(el, abc, { shift: this.shift(), key: homeKey(this.t), meter: this.t.meter, tempo: this.tempo() || 100 })
      .catch(() => { el.innerHTML = '<span class="fine">Couldn’t show this notation.</span>'; return null; });
  }

  notationCard() {
    const t = this.t, prog = this.prog, planItem = this.planItem;
    const todayKeys = this.todayKeys, root = this.previewRoot;
    const bass = this.bassMine();
    const today = planItem?.form ? `Today: through ${this.forTune?.name ?? 'its tune'}’s form, in ${kn(planItem.overKey)} — bend it to the changes, or take off from it.`
      : planItem?.over ? `Today: over ${overLabel(planItem.over)}${planItem.overKey != null ? ` in ${kn(planItem.overKey)}` : ''} — play it in ${todayKeys.map((k, i) => `${rootName(k)}${planItem.parts?.[i] ? ` (its first ${planItem.parts[i]} chords)` : ''}`).join(', then ')}`
      : prog ? `Today: ${prog.name} in ${rootName(root)} — ${progressionChords(prog, root)}`
      : t.vary && this.todayTypes().length ? `Today: ${exerciseKeysText(todayKeys, t, this.todayTypes())}`
      : todayKeys.length && this.asWritten() ? `Today: ${todayKeys.map((k) => keyLabel(k, t)).join(', ')}`
      : todayKeys.length ? 'Underlined: today’s keys.' : '';
    return html`
      <div class="notation-card">
        ${this.asWritten() || t.keyMode === 'none' ? nothing : html`<div class="key-strip" role="group" aria-label="Show in key">${[...Array(12).keys()].map((w) => {
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
    if (!this.edit({ as_written: on })) return;
    this.previewRoot = this.asWritten() ? this.writtenC() : this.todayKeys[0] ?? 0;
    this.requestUpdate();
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
    if (!perform(cmd.changeToday, { entry: it.pid, keys, ...(types ? { types } : {}) })) return;
    this.todayKeys = it.keys!; // (just set)
    if (t.vary && this.todayKeys.includes(this.previewRoot)) this.previewType = this.typeFor(this.previewRoot);
    this.requestUpdate();
  }
  setTodayType(i: number, type: string) {
    const it = this.planItem!;
    const types = [...(it.types || [])];
    types[i] = type;
    if (!perform(cmd.changeToday, { entry: it.pid, keys: it.keys!, types })) return;
    if (it.keys![i] === this.previewRoot) this.previewType = type;
    this.requestUpdate();
  }

  // ---------- Settings (see exercise-settings.ts) ----------
  // Varying exercises are written out from their pattern: Edit pattern opens its panel.
  toPattern() {
    this.querySelector<ExerciseSettings>('ws-exercise-settings')?.openPanel('vary', '.pattern-card');
  }
  // Its scale or chord settings changed (and today's types with them, unless it's been played
  // today): the type shown follows.
  varyChanged(fields: cmd.ItemFields) {
    if (!this.edit(fields)) return;
    this.previewType = this.typeFor(this.previewRoot);
    this.requestUpdate();
  }
  // How it picks its keys changed (and today's keys with them, unless it's been played today):
  // what's shown follows — with no key, the notation as written.
  keysChanged(fields: cmd.ItemFields) {
    const t = this.t;
    this.stopPlaying();
    if (!this.edit(fields)) return;
    if (this.planItem) this.todayKeys = this.planItem.keys || [];
    this.previewRoot = this.asWritten() || t.keyMode === 'none' ? this.writtenC() : this.todayKeys[0] ?? this.previewRoot;
    this.previewType = this.typeFor(this.previewRoot);
    this.requestUpdate();
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
        : html`<ws-hint hint="takes" cls="fine" text="Record yourself playing it to hear how it’s coming along. Takes are kept here and in the Diary."></ws-hint>`}`;
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
    const t = this.t, it = this.logItem();
    if (this.isPlayed()) perform(cmd.unmarkPlayed, { item: t.id, entry: it?.pid });
    else if (perform(cmd.markPlayed, { item: t.id, entry: it?.pid, keys: this.todayKeys })) {
      autoStart();
      haptic();
    }
    this.requestUpdate();
  }
  rename(el: HTMLTextAreaElement) {
    el.value = el.value.replace(/\s*\n\s*/g, ' ');
    if (this.isNew) this.t.name = el.value; // (checked when it's added)
    else if (el.value.trim()) this.edit({ name: el.value }); // (left as it was while it's empty)
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
      !planItem?.warmup && !inToday(t) && { label: 'Add to today’s set', fn: () => { if (perform(cmd.addToToday, { item: t.id })) toast(`Added ${t.name} to today’s set`); this.refresh(); } },
      card && { label: 'Swap for another', fn: () => { closeSheet(); swapInToday(card); } },
      card && { label: 'Take out of today’s set', fn: () => { closeSheet(); removeFromToday(card); } },
      !t.solo && { label: 'Try it through a tune…', fn: () => this.goTo(() => pickTune(t, { back: this.back })) },
      { label: 'Delete exercise', danger: true, fn: () => {
        if (!confirm(`Delete “${t.name}” and its practice history?`)) return;
        closeSheet();
        perform(cmd.deleteItem, { item: t.id });
      } },
    ]);
  }
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
    ${priBadge(t.priority)}
  </li>`;
}
