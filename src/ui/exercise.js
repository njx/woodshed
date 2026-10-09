import { store, save } from '../store.js';
import { autoStart } from '../practicetime.js';
import { LEVELS, PRIORITIES, RATINGS, CATEGORIES, KEY_MODES } from '../constants.js';
import { dateStr, niceDate, ago } from '../dates.js';
import { keyName, writtenToConcert } from '../keys.js';
import { esc, uid } from '../util.js';
import { itemStats, itemById, isPlayedToday, isPlanItemPlayed, markPlayed, unmarkPlayed, setLevel, levelSuggestion, deleteItem } from '../practice.js';
import { syncFocus, refreshTypes, addToToday, inToday, setTodayKeys, typeCounts } from '../plan.js';
import { entryKeys } from '../keystats.js';
import { entriesFor } from '../diary.js';
import { DURATIONS, noteToken, restToken, writtenShift, soundingShift, abcFirstChords } from '../abc.js';
import { chordsInAbc, chordsFromText, chordName } from '../chords.js';
import { VARY, SHAPES, PATTERN_PAD, typesOf, typeInfo, variantName, generateAbc, parsePattern, patternText, progressionAbc, chooseTypes } from '../theory.js';
import { canRecord } from '../media.js';
import { renderNotation, playNotation, stopPlayback, playbackOptionsHtml, bindPlaybackOptions, playbackFor, openFullNotation } from './notation.js';
import { noteHtml, bindNotes, openNote } from './diary.js';
import { openRecorder } from './recorder.js';
import { tempoRowHtml, tempoSuggestionHtml, bindTempo, openMetronome } from './metronome.js';
import { tempoSuggestion } from '../tempo.js';
import { SOUNDS } from '../sounds.js';
import {
  $, $$, ICON, ui, render, toast, withUndo, haptic, openSheet, closeSheet, suggestionHtml, kn,
} from './shell.js';

const view = () => store.state.settings.view;
// Exercise keys are roots (0–11), named as major keys for the instrument shown.
export const rootName = (r) => keyName(r % 12, view());

// A progression's chords in a key: "Am7 · D7 · Gm7 · C7".
export function progressionChords(prog, key) {
  return prog.chords.map((c) => variantName(rootName((key + c.d) % 12), 'chord', c.family)).join(' · ');
}

// What to play: "C · F · B♭", or with scale or chord types "C dor · F harm min", "Cm7 · F7",
// or a progression "iii–VI7–ii–V7 in F".
export function exerciseKeysText(keys = [], t = null, types = null, prog = null) {
  if (prog?.name) return `${prog.name}${keys.length ? ` in ${rootName(keys[0])}` : ''}`;
  const kind = t?.vary?.kind;
  if (!kind || !types?.length) return keys.map(rootName).join(' · ');
  if (!keys.length) return types.map((id) => typeInfo(kind, id)?.label || id).join(' · ');
  return keys.map((k, i) => variantName(rootName(k), kind, types[i])).join(' · ');
}

// A recording's note for an exercise: what was played (keys and types, or the progression) and
// the tempo, e.g. "In C · E♭ · 120 bpm", "D dorian · G mixolydian", "ii–V7–I in F".
export function takeLabel(t, keys = [], types = null, prog = null, tempo = t.tempo) {
  const what = exerciseKeysText(keys, t, types, prog);
  return [what && (t.vary || prog ? what : `In ${what}`), tempo && `${tempo} bpm`].filter(Boolean).join(' · ');
}

const patternHint = (kind) => (kind === 'chord'
  ? 'Numbers are chord tones: 1 3 5 7, and 8 10 12 14 an octave up. Tap numbers to change the pattern.'
  : 'Numbers are notes of the scale: 1 is the root, and on a 7-note scale 8 is the octave. Tap numbers to change the pattern; the presets fit themselves to scales with more or fewer notes.');

// The notation to show: generated for a progression (a warm-up), a scale or chord type, or the
// exercise's own.
// part: play only its first so many chords (part of a lick over part of a progression).
function notationFor(t, type, prog = null, part = null) {
  if (t.fromTune) return prog ? progressionAbc(prog.chords, { meter: t.meter || '4/4' }) : '';
  if (t.vary) return generateAbc(t.vary.kind, type, { shape: t.vary.shape, pattern: t.vary.pattern, meter: t.meter || '4/4' });
  return part ? abcFirstChords(t.abc, part) : t.abc;
}

// Detail sheet for an exercise. id null = new exercise. opts.keys: today's keys, to preview first.
export function openExercise(id, opts = {}) {
  const state = store.state;
  const isNew = !id;
  const t = isNew
    ? { id: uid(), type: 'exercise', name: '', category: 'pattern', keyMode: 'weak', keysPerSession: 2, keys: [], abc: '', meter: '4/4', notes: '', priority: 2, level: 0, ivl: null, due: null }
    : itemById(id);
  if (!t) return;
  // Today's plan item it was opened from (it can be in the set more than once, as warm-ups
  // before tunes); opened from elsewhere, its own place in the set, if it has one.
  const today = state.plan?.date === dateStr() ? state.plan.items.filter((i) => i.itemId === t.id) : [];
  const planItem = today.find((i) => opts.pid && i.pid === opts.pid) || today.find((i) => !i.warmup) || null;
  // What Played logs against: that, or if it's only in the set as warm-ups, one of them (shown as
  // itself here, not with a tune's keys) — so it doesn't count for every copy.
  const logItem = () => planItem || today.find((i) => !isPlanItemPlayed(i)) || today[0] || null;
  // A lick played over part of a progression: in which key only its first so many chords; and
  // what it's over, in words.
  const partFor = (root) => planItem?.parts?.[todayKeys.indexOf(root)] ?? null;
  const overText = () => {
    const where = planItem.overKey != null ? ` in ${kn(planItem.overKey)}` : '';
    const keys = todayKeys.map((k, i) => `${rootName(k)}${planItem.parts?.[i] ? ` (its first ${planItem.parts[i]} chords)` : ''}`);
    return `Today: over ${planItem.over}${where} — play it in ${keys.join(', then ')}`;
  };
  // A warm-up is played at its tune's tempo (the tempo row, notation and takes use that).
  const tempoFrom = (planItem?.warmup && itemById(planItem.warmup)) || t;
  const isPlayed = () => (logItem() ? isPlanItemPlayed(logItem()) : isPlayedToday(t.id));
  let todayKeys = opts.keys || planItem?.keys || []; // changes if today's keys are edited
  const prog = planItem?.prog || opts.prog || null; // a tune's progression (warm-ups)
  // Today's types can include ones not turned on (warm-ups follow a tune's chords).
  const todayTypes = () => (t.vary ? (planItem?.types || opts.types || []).filter((id) => typeInfo(t.vary.kind, id)) : []);
  const stripTypes = () => [...new Set([...(t.vary?.types || []), ...todayTypes()])];
  let previewRoot = todayKeys[0] ?? 0;
  // The scale or chord type shown: today's for the key shown, or the first one turned on.
  const typeFor = (root) => todayTypes()[todayKeys.indexOf(root)] ?? todayTypes()[0] ?? t.vary?.types[0];
  let previewType = typeFor(previewRoot);
  // A new take's note: today's keys and types, or else the key (and type) shown.
  const label = () => (prog || !todayKeys.length
    ? takeLabel(t, [previewRoot], previewType ? [previewType] : null, prog, tempoFrom.tempo)
    : takeLabel(t, todayKeys, todayTypes(), prog, tempoFrom.tempo));
  let stopFn = null;

  const body = () => {
    const s = itemStats().get(t.id);
    const entries = state.log.filter((e) => e.itemId === t.id).sort((a, b) => b.date.localeCompare(a.date));
    const played = isPlayed();
    const all = entriesFor(t.id);
    const takes = all.filter((e) => e.media?.length); // recordings, up top by the notation
    const notes = all.filter((e) => !e.media?.length);
    return `
      <textarea class="title-input" id="x-name" rows="1" placeholder="Exercise name" aria-label="Exercise name" enterkeyhint="done" ${isNew ? 'autofocus' : ''}>${esc(t.name)}</textarea>
      <label class="focus-toggle">
        <span class="focus-icon">${ICON.focus}</span>
        <span><b>Focus</b><small>In your set every day until you turn it off</small></span>
        <input type="checkbox" id="x-focus" role="switch" ${t.focus ? 'checked' : ''}>
      </label>
      ${isNew || t.focus ? '' : planItem?.warmup
        ? `<p class="in-today">${ICON.check}In today’s set, as a warm-up for ${esc(itemById(planItem.warmup)?.name || 'a tune')}</p>`
        : inToday(t)
        ? `<p class="in-today">${ICON.check}In today’s set</p>`
        : `<button class="ghost-btn add-today" id="x-today">${ICON.plus}<span>Add to today’s set</span></button>`}

      <div class="field-label row-label"><span>Notation</span>${t.vary ? '<button class="link-btn" id="x-to-pattern">Edit pattern</button>'
        : t.abc ? '<button class="link-btn" id="x-edit-abc">Edit</button>' : ''}</div>
      ${t.fromTune && !prog ? '<p class="fine">This one takes its chords from a tune, so it comes up as a warm-up: open a tune’s details and tap <b>Warm up for this tune</b>, or choose <b>From tunes</b> in Settings.</p>' : ''}
      ${t.vary || t.abc || prog ? `
        <div class="notation-card">
          <div class="key-strip" role="group" aria-label="Show in key">${[...Array(12).keys()].map((w) => {
            const r = writtenToConcert(w, view());
            return `<button class="${r === previewRoot ? 'on' : ''} ${todayKeys.includes(r) ? 'today' : ''}" data-root="${r}">${esc(rootName(r))}</button>`;
          }).join('')}</div>
          ${t.vary ? `<div class="type-strip" role="group" aria-label="Show ${t.vary.kind} type">${stripTypes().map((id) => `
            <button class="${id === previewType ? 'on' : ''}" data-type="${id}">${esc(typeInfo(t.vary.kind, id).short)}</button>`).join('')}</div>` : ''}
          <div class="nt-wrap">
            <div class="notation" id="x-notation"><span class="fine">Loading notation…</span></div>
            <button class="x-full" id="x-full" aria-label="Full screen" title="Full screen">⤢</button>
          </div>
          <div class="play-row">
            <button class="pill-btn" id="x-play">${ICON.play}<span>Play</span></button>
            ${playbackOptionsHtml()}
          </div>
          ${planItem?.over ? `<p class="fine">${esc(overText())}</p>`
            : prog ? `<p class="fine">Today: ${esc(prog.name)} in ${esc(rootName(previewRoot))} — ${esc(progressionChords(prog, previewRoot))}</p>`
            : t.vary && todayTypes().length ? `<p class="fine">Today: ${esc(exerciseKeysText(todayKeys, t, todayTypes()))}</p>`
            : todayKeys.length ? '<p class="fine">Underlined: today’s keys.</p>' : ''}
        </div>` : `<button class="ghost-btn" id="x-add-abc">${ICON.plus}<span>Add notation</span></button>`}
      ${todayHtml()}

      ${isNew ? '' : tempoFrom !== t
        ? `<div data-item-id="${tempoFrom.id}">${tempoRowHtml(tempoFrom)}<p class="fine">As a warm-up it’s played at ${esc(tempoFrom.name)}’s tempo.</p></div>`
        : `<div data-item-id="${t.id}">${tempoRowHtml(t)}${tempoSuggestionHtml(tempoSuggestion(t))}</div>`}
      ${isNew || !canRecord() ? '' : `
        <div class="field-label row-label"><span>Recordings</span><span class="row-links">
          <button class="link-btn" id="x-rec">${ICON.rec}Record</button></span></div>
        ${takes.length ? `<ul class="notes panel-list" id="x-takes">${takes.slice(0, 3).map((e) => noteHtml(e, { showDate: true })).join('')}</ul>
          ${takes.length > 3 ? `<p class="fine">${takes.length - 3} more in the Diary.</p>` : ''}`
          : '<p class="fine">Record yourself playing it to hear how it’s coming along. Takes are kept here and in the Diary.</p>'}`}
      ${harmonyHtml()}
      <label class="field-label">Kind</label>
      <div class="chips wrap" id="x-cat">${Object.entries(CATEGORIES).map(([k, l]) => `<button class="chip ${t.category === k ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('')}</div>

${t.fromTune ? '' : `
      <label class="field-label">Each session, vary the</label>
      <div class="seg" id="x-vary">
        <button class="${!t.vary ? 'on' : ''}" data-vary="">Key only</button>
        <button class="${t.vary?.kind === 'scale' ? 'on' : ''}" data-vary="scale">Scale type</button>
        <button class="${t.vary?.kind === 'chord' ? 'on' : ''}" data-vary="chord">Chord type</button>
      </div>
      ${t.vary ? `
        <p class="fine">Each key comes with one of the ${t.vary.kind === 'scale' ? 'scales' : 'chords'} turned on here, favouring the ones you’ve played least. The notation is written out for each.</p>
        <div class="chips wrap" id="x-types">${Object.entries(typesOf(t.vary.kind)).map(([id, x]) => `
          <button class="chip ${t.vary.types.includes(id) ? 'on' : ''}" data-vtype="${id}" aria-pressed="${t.vary.types.includes(id)}">${esc(x.label)}</button>`).join('')}</div>
        <label class="field-label">Pattern</label>
        <div class="chips wrap" id="x-shape">${Object.entries(SHAPES).filter(([, x]) => x.kinds.includes(t.vary.kind)).map(([id, x]) => `
          <button class="chip ${t.vary.shape === id ? 'on' : ''}" data-shape="${id}">${esc(x.label)}</button>`).join('')}</div>
        <div class="pattern-card">
          <div class="pattern-line" id="x-pattern" aria-live="polite">${esc(patternText(t.vary.kind, t.vary.shape, t.vary.pattern)) || '&nbsp;'}</div>
          <div class="keypad pattern-pad" id="x-pad">${PATTERN_PAD[t.vary.kind].map((n) => `<button data-pn="${n}">${n}</button>`).join('')}
            <button data-pn="back" aria-label="Delete the last number">⌫</button><button data-pn="clear">Clear</button></div>
          <p class="fine" id="x-pattern-msg">${patternHint(t.vary.kind)}</p>
        </div>` : ''}

      <label class="field-label">Choose keys by</label>
      <div class="chips wrap" id="x-mode">${Object.entries(KEY_MODES).map(([k, m]) => `<button class="chip ${t.keyMode === k ? 'on' : ''}" data-mode="${k}">${m.label}</button>`).join('')}</div>
      <p class="fine">${esc(KEY_MODES[t.keyMode].hint)}</p>
      ${t.keyMode === 'fixed' ? `<div class="keygrid" id="x-fixed">${[...Array(12).keys()].map((w) => {
        const r = writtenToConcert(w, view());
        return `<button class="${t.keys.includes(r) ? 'on' : ''}" data-fixed="${r}">${esc(rootName(r))}</button>`;
      }).join('')}</div>` : ''}
      ${t.keyMode !== 'none' ? `
        <div class="setting">
          <div><b>Keys per session</b><span>How many keys to play it in each time</span></div>
          <div class="stepper" id="x-kps"><button data-d="-1" aria-label="Fewer">−</button><output>${t.keysPerSession}</output><button data-d="1" aria-label="More">+</button></div>
        </div>` : ''}

`}
      <label class="field-label">How well do you know it?</label>
      ${isNew ? '' : suggestionHtml(t, levelSuggestion(t))}
      <div class="seg four" data-field="level">${LEVELS.map((l) => `<button class="${t.level === l.v ? 'on' : ''}" data-v="${l.v}">${l.label}</button>`).join('')}</div>
      <label class="field-label">Priority</label>
      <div class="seg four" data-field="priority">${PRIORITIES.map((p) => `<button class="${t.priority === p.v ? 'on' : ''}" data-v="${p.v}">${p.label}</button>`).join('')}</div>
      <label class="field">
        <span class="field-label">How to practice it</span>
        <textarea id="x-notes" rows="3" placeholder="Tempo, articulation, range, variations…">${esc(t.notes)}</textarea>
      </label>

      ${isNew ? `<button class="primary-btn" id="x-save">Add exercise</button>` : `
        <div class="history">
          <div class="history-head">
            <div><b>${s?.count || 0}×</b> played · last ${esc(ago(s?.last))}</div>
            <button class="pill-btn ${played ? 'on' : ''}" id="x-log">${ICON.check}${played ? 'Played today' : 'Log for today'}</button>
          </div>
          ${entries.length ? `<ul class="history-list">${entries.slice(0, 8).map((e) => `
            <li><span>${esc(niceDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</span>
            <span>${esc(e.progName ? `${e.progName} in ${rootName(entryKeys(e)[0] ?? 0)}` : exerciseKeysText(entryKeys(e), t, e.types))}${e.bpm ? ` · ${e.bpm} bpm` : ''}</span>
            <span class="r-${e.rating || 'ok'}">${esc(RATINGS.find((r) => r.v === (e.rating || 'ok')).label)}</span></li>`).join('')}</ul>` : ''}
        </div>
        <div class="field-label row-label"><span>Diary</span><span class="row-links">
          <button class="link-btn" id="x-note">${ICON.plus}Add a note</button></span></div>
        ${notes.length ? `<ul class="notes panel-list">${notes.slice(0, 5).map((e) => noteHtml(e, { showDate: true })).join('')}</ul>` : '<p class="fine">Notes about this exercise show up here.</p>'}
        <button class="danger-btn" id="x-delete">Delete exercise</button>`}
    `;
  };

  // Today's keys (and types) for this exercise, changeable: not for a warm-up (its come from its
  // tune), or one without keys.
  const editable = () => !!planItem && !planItem.warmup && !t.fromTune && t.keyMode !== 'none';
  function todayHtml() {
    if (!editable()) return '';
    const keys = planItem.keys || [];
    const types = t.vary ? planItem.types || [] : [];
    const played = isPlanItemPlayed(planItem);
    return `
      <div class="field-label row-label"><span>Today’s keys</span></div>
      <div class="today-keys" role="group" aria-label="Today’s keys">${[...Array(12).keys()].map((w) => {
        const k = writtenToConcert(w, view());
        return `<button class="${keys.includes(k) ? 'on' : ''}" data-tk="${k}" aria-pressed="${keys.includes(k)}">${esc(rootName(k))}</button>`;
      }).join('')}</div>
      ${t.vary && keys.length ? `<ul class="today-types">${keys.map((k, i) => `
        <li><b>${esc(rootName(k))}</b><select data-tt="${i}" aria-label="${esc(VARY[t.vary.kind].label)} in ${esc(rootName(k))}">${Object.entries(VARY[t.vary.kind].types).map(([id, x]) => `
          <option value="${id}" ${types[i] === id ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></li>`).join('')}</ul>` : ''}
      <p class="fine">Tap keys to play ${t.vary ? 'it in (and pick the type for each)' : 'it in'} today${played ? ' — the session you logged changes too' : ''}.</p>`;
  }

  // The chords a written exercise goes with (so it can be a warm-up over them in tunes): typed
  // here, or else read from the chord symbols in its notation. Written in C, like the notes.
  const guessed = () => chordsInAbc(t.abc).filter((c, i, a) => i === 0 || c.root !== a[i - 1].root || c.q !== a[i - 1].q).map((c) => chordName(c)).join(' ');
  function harmonyHtml() {
    if (isNew || t.vary || t.fromTune) return '';
    const g = guessed();
    return `
      <label class="field"><span class="field-label">Chords it goes with</span>
        <input id="x-harmony" value="${esc(t.harmony ?? g)}" placeholder="e.g. Dm7 G7 Cmaj7" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
      <p class="fine" id="x-harmony-msg">${t.harmony ? 'As typed here (clear it to go back to the notation’s chord symbols).'
        : g ? 'From the chord symbols in its notation — change them here if they’re not right.'
        : 'Type the chords it goes over, in C like the notes (or add chord symbols to its notation), so it can come up as a warm-up for tunes with those chords.'}</p>`;
  }

  const outerBack = opts.back;
  let leaving = false;
  let added = false;
  // A new exercise is added once it has a name: with the button, or by closing the sheet.
  const addNew = () => {
    if (added || !t.name.trim()) return false;
    added = true;
    t.name = t.name.trim();
    withUndo(`Added ${t.name}`, () => state.items.push(t));
    return true;
  };
  const sheet = openSheet(body(), () => {
    stopFn?.();
    if (isNew && !leaving) addNew();
    if (!isNew) render();
    if (!leaving) outerBack?.();
  });
  const commit = () => { if (!isNew) save(); };
  // After the scale or chord settings change, today's types for this exercise are picked again
  // (unless it's already been played today).
  const varyChanged = () => {
    if (planItem) {
      refreshTypes(t);
      previewType = typeFor(previewRoot);
    }
    commit();
    refresh();
  };
  const back = () => openExercise(t.id, { keys: todayKeys, back: outerBack });
  const refresh = () => {
    const bodyEl = $('.sheet-body', sheet);
    const y = bodyEl.scrollTop;
    bodyEl.innerHTML = body();
    bodyEl.scrollTop = y;
    bind();
  };
  // Leave this sheet for another (note, recorder, editor) and come back after.
  const goTo = (fn) => {
    leaving = true;
    closeSheet();
    fn();
  };

  async function drawNotation() {
    const el = $('#x-notation', sheet);
    const abc = notationFor(t, previewType, prog, partFor(previewRoot));
    if (!el || !abc) return null;
    return renderNotation(el, abc, { shift: writtenShift(previewRoot, view()), meter: t.meter, tempo: tempoFrom.tempo || 100 })
      .catch(() => { el.innerHTML = '<span class="fine">Couldn’t show this notation.</span>'; return null; });
  }

  function bind() {
    let tune = null;
    drawNotation().then((x) => { tune = x; });
    const stopPlaying = () => {
      if (!stopFn) return;
      stopFn();
      stopFn = null;
      const p = $('#x-play', sheet);
      p?.classList.remove('on');
      if (p) $('span', p).textContent = 'Play';
    };
    $$('[data-root]', sheet).forEach((b) => (b.onclick = async () => {
      previewRoot = Number(b.dataset.root);
      // Today's keys show with today's scale or chord type.
      if (t.vary && todayKeys.includes(previewRoot)) previewType = typeFor(previewRoot);
      $$('[data-root]', sheet).forEach((x) => x.classList.toggle('on', x === b));
      $$('[data-type]', sheet).forEach((x) => x.classList.toggle('on', x.dataset.type === previewType));
      stopPlaying();
      tune = await drawNotation();
    }));
    $$('[data-type]', sheet).forEach((b) => (b.onclick = async () => {
      previewType = b.dataset.type;
      $$('[data-type]', sheet).forEach((x) => x.classList.toggle('on', x === b));
      stopPlaying();
      tune = await drawNotation();
    }));
    const play = $('#x-play', sheet);
    if (play) play.onclick = async () => {
      if (stopFn) { stopFn(); stopFn = null; play.classList.remove('on'); $('span', play).textContent = 'Play'; return; }
      if (!tune) return;
      play.classList.add('on');
      $('span', play).textContent = '…'; // the first time, the sound loads
      try {
        stopFn = await playNotation(tune, {
          transpose: writtenShift(previewRoot, view()) + soundingShift(view()),
          ...playbackFor(t.meter),
          onEnded: () => { stopFn = null; play.classList.remove('on'); $('span', play).textContent = 'Play'; },
          onFallback: (id) => toast(`Couldn’t load the ${SOUNDS[id].label.toLowerCase()} sound — playing the synth`),
        });
        if (stopFn) $('span', play).textContent = 'Stop';
      } catch {
        stopFn = null;
        play.classList.remove('on');
        $('span', play).textContent = 'Play';
        toast('Couldn’t play audio on this device');
      }
    };

    bindPlaybackOptions(sheet, stopPlaying);

    // Today's keys and types.
    $$('[data-tk]', sheet).forEach((b) => (b.onclick = () => {
      const k = Number(b.dataset.tk);
      const keys = [...(planItem.keys || [])];
      const types = t.vary ? [...(planItem.types || [])] : null;
      const i = keys.indexOf(k);
      if (i >= 0) {
        if (keys.length === 1) return toast('Keep at least one key');
        keys.splice(i, 1);
        types?.splice(i, 1);
      } else {
        keys.push(k);
        // A new key gets a type the usual way: one played least.
        if (types) types.push(chooseTypes(t.vary, 1, itemStats().get(t.id)?.types || [], Math.random, typeCounts())[0] ?? t.vary.types[0]);
      }
      setTodayKeys(planItem, keys, types);
      todayKeys = planItem.keys;
      if (t.vary && todayKeys.includes(previewRoot)) previewType = typeFor(previewRoot);
      refresh();
    }));
    $$('[data-tt]', sheet).forEach((sel) => (sel.onchange = () => {
      const i = Number(sel.dataset.tt);
      const types = [...(planItem.types || [])];
      types[i] = sel.value;
      setTodayKeys(planItem, planItem.keys, types);
      if (planItem.keys[i] === previewRoot) previewType = sel.value;
      refresh();
    }));

    // Full screen, sideways, in the key (and type) shown.
    const full = $('#x-full', sheet);
    if (full) full.onclick = () => {
      stopPlaying();
      const abc = notationFor(t, previewType, prog, partFor(previewRoot));
      if (!abc) return;
      const shift = writtenShift(previewRoot, view());
      const what = prog ? `${prog.name} in ${rootName(previewRoot)}` : exerciseKeysText([previewRoot], t, previewType ? [previewType] : null);
      let fullTune = null;
      openFullNotation({
        title: `${t.name} · ${what}`,
        draw: async (el) => { fullTune = await renderNotation(el, abc, { shift, meter: t.meter, tempo: tempoFrom.tempo || 100, wide: true }).catch(() => null); },
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
    };

    const editAbc = $('#x-edit-abc', sheet) || $('#x-add-abc', sheet);
    if (editAbc) editAbc.onclick = () => {
      // For a new exercise (a lick, say) the notation is the point: add it, then write it.
      if (isNew) {
        t.name = t.name.trim() || `Untitled ${(CATEGORIES[t.category] || 'exercise').toLowerCase()}`;
        state.items.push(t);
        save();
        render();
      }
      goTo(() => openNotationEditor(t, back));
    };

    const nameEl = $('#x-name', sheet);
    const fit = () => { nameEl.style.height = 'auto'; nameEl.style.height = `${nameEl.scrollHeight}px`; };
    fit();
    nameEl.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } };
    nameEl.oninput = () => {
      nameEl.value = nameEl.value.replace(/\s*\n\s*/g, ' ');
      fit();
      t.name = nameEl.value;
      if (!isNew && t.name.trim()) commit();
    };
    $('#x-focus', sheet).onchange = (e) => {
      t.focus = e.target.checked;
      if (!isNew && state.plan?.date === dateStr()) {
        if (t.focus) state.plan.focusSkipped = (state.plan.focusSkipped || []).filter((x) => x !== t.id);
        syncFocus();
      }
      commit();
    };
    $$('[data-cat]', sheet).forEach((b) => (b.onclick = () => { t.category = b.dataset.cat; commit(); refresh(); }));
    $$('[data-vary]', sheet).forEach((b) => (b.onclick = () => {
      const kind = b.dataset.vary;
      if ((t.vary?.kind || '') === kind) return;
      t.vary = kind ? { kind, types: [...VARY[kind].defaults], shape: 'updown', pattern: '' } : null;
      previewType = t.vary?.types[0];
      varyChanged();
    }));
    $$('[data-vtype]', sheet).forEach((b) => (b.onclick = () => {
      const id = b.dataset.vtype;
      const on = t.vary.types.includes(id);
      if (on && t.vary.types.length === 1) return toast('Keep at least one turned on');
      // Keep the catalogue's order.
      t.vary.types = Object.keys(typesOf(t.vary.kind)).filter((x) => (x === id ? !on : t.vary.types.includes(x)));
      if (!t.vary.types.includes(previewType)) previewType = t.vary.types[0];
      varyChanged();
    }));
    $$('[data-shape]', sheet).forEach((b) => (b.onclick = () => { t.vary.shape = b.dataset.shape; commit(); refresh(); }));
    // Varying exercises are written out from their pattern, further down.
    const toPattern = $('#x-to-pattern', sheet);
    if (toPattern) toPattern.onclick = () => $('#x-shape', sheet)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    // The number pad edits the pattern; changing a preset makes it your own.
    $$('[data-pn]', sheet).forEach((b) => (b.onclick = async () => {
      const nums = patternText(t.vary.kind, t.vary.shape, t.vary.pattern).split(' ').filter(Boolean);
      const v = b.dataset.pn;
      if (v === 'back') nums.pop();
      else if (v === 'clear') nums.length = 0;
      else if (nums.length < 64) nums.push(v);
      t.vary.shape = 'custom';
      t.vary.pattern = nums.join(' ');
      $$('[data-shape]', sheet).forEach((x) => x.classList.toggle('on', x.dataset.shape === 'custom'));
      $('#x-pattern', sheet).innerHTML = esc(t.vary.pattern) || '&nbsp;';
      const { error } = parsePattern(t.vary.pattern, t.vary.kind);
      const msg = $('#x-pattern-msg', sheet);
      msg.textContent = error ? (nums.length ? error : 'Tap some numbers.') : patternHint(t.vary.kind);
      msg.classList.toggle('error', !!error);
      commit();
      if (error) return;
      stopPlaying();
      tune = await drawNotation();
    }));
    $$('[data-mode]', sheet).forEach((b) => (b.onclick = () => { t.keyMode = b.dataset.mode; commit(); refresh(); }));
    $$('[data-fixed]', sheet).forEach((b) => (b.onclick = () => {
      const r = Number(b.dataset.fixed);
      t.keys = t.keys.includes(r) ? t.keys.filter((x) => x !== r) : [...t.keys, r];
      commit();
      refresh();
    }));
    const kps = $('#x-kps', sheet);
    if (kps) kps.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      t.keysPerSession = Math.max(1, Math.min(12, t.keysPerSession + Number(b.dataset.d)));
      $('output', kps).textContent = t.keysPerSession;
      commit();
    };
    $$('.seg[data-field]', sheet).forEach((seg) => (seg.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (seg.dataset.field === 'level') setLevel(t, Number(b.dataset.v));
      else t.priority = Number(b.dataset.v);
      commit();
      refresh();
    }));
    const sug = $('.suggest [data-level]', sheet);
    if (sug) sug.onclick = () => { setLevel(t, Number(sug.dataset.level)); commit(); refresh(); };
    $('#x-notes', sheet).oninput = (e) => { t.notes = e.target.value; commit(); };
    const harm = $('#x-harmony', sheet);
    if (harm) harm.oninput = () => {
      const text = harm.value.trim();
      const msg = $('#x-harmony-msg', sheet);
      const parsed = text ? chordsFromText(text) : [];
      msg.classList.toggle('error', !parsed);
      if (!parsed) { msg.textContent = 'Couldn’t read those chords — like Dm7 G7 Cmaj7.'; return; }
      if (!text || text === guessed()) delete t.harmony; // the notation's own, then
      else t.harmony = text;
      msg.textContent = t.harmony ? 'As typed here (clear it to go back to the notation’s chord symbols).' : 'From the chord symbols in its notation.';
      commit();
    };
    const addBtn = $('#x-today', sheet);
    if (addBtn) addBtn.onclick = () => { if (addToToday(t)) toast(`Added ${t.name} to today’s set`); refresh(); };

    if (isNew) {
      $('#x-save', sheet).onclick = () => {
        if (!t.name.trim()) { nameEl.focus(); return toast('Give the exercise a name'); }
        closeSheet(); // adds it
      };
      return;
    }
    $('#x-log', sheet).onclick = () => {
      if (isPlayed()) unmarkPlayed(t.id, logItem());
      else {
        markPlayed(t.id, logItem() || { keys: todayKeys });
        autoStart();
        haptic();
      }
      save();
      refresh();
    };
    $('#x-note', sheet).onclick = () => goTo(() => openNote(null, { itemId: t.id, back }));
    bindTempo($('[data-item-id]', sheet) || sheet, { onChange: refresh });
    // Opening the metronome leaves this sheet; come back to it afterwards.
    $$('[data-metro]', sheet).forEach((b) => (b.onclick = () => goTo(() => openMetronome({ itemId: t.id, back }))));
    const rec = $('#x-rec', sheet);
    if (rec) rec.onclick = () => goTo(() => openRecorder({ itemId: t.id, back, text: label() }));
    bindNotes(sheet, back, refresh);
    // Opening a note replaces this sheet without closing it: stop any playback first.
    $$('[data-note]', sheet).forEach((li) => li.addEventListener('click', () => stopFn?.(), true));
    $('#x-delete', sheet).onclick = () => {
      if (!confirm(`Delete “${t.name}” and its practice history?`)) return;
      closeSheet();
      withUndo(`Deleted ${t.name}`, () => deleteItem(t.id));
    };
  }
  bind();
}

// ---------- Notation editor ----------

const METERS = ['4/4', '3/4', '5/4', '6/8', '2/4'];

// Small note icons for the length buttons.
function noteIcon(d) {
  const head = d === 'whole' || d === 'half'
    ? '<ellipse cx="9" cy="19" rx="4.6" ry="3.3" transform="rotate(-20 9 19)" fill="none" stroke="currentColor" stroke-width="1.8"/>'
    : '<ellipse cx="9" cy="19" rx="4.6" ry="3.3" transform="rotate(-20 9 19)" fill="currentColor"/>';
  const stem = d === 'whole' ? '' : '<path d="M13.2 18V3.5" stroke="currentColor" stroke-width="1.8"/>';
  const flags = { eighth: 1, sixteenth: 2 }[d] || 0;
  const flag = Array.from({ length: flags }, (_, i) => `<path d="M13.2 ${3.5 + i * 4.5}c0 3 5 4 4.5 8" fill="none" stroke="currentColor" stroke-width="1.8"/>`).join('');
  return `<svg viewBox="0 0 22 24" aria-hidden="true">${head}${stem}${flag}</svg>`;
}

// Edit an exercise's notation (written in C) with a tap keypad or by typing ABC.
export function openNotationEditor(t, back) {
  let body = t.abc || '';
  let meter = t.meter || '4/4';
  let duration = 'eighth';
  let dotted = false;
  let accidental = '';
  let octave = 4;
  let typing = false;
  let stopFn = null;
  const original = { abc: t.abc || '', meter: t.meter || '4/4' };
  let tune = null;

  const sheet = openSheet(`
    <p class="eyebrow">Notation · ${esc(t.name)}</p>
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
        <button data-oct="-1" aria-label="Octave down">8vb</button>
        <span class="oct" id="ne-oct"></span>
        <button data-oct="1" aria-label="Octave up">8va</button>
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
    </div>
    <div class="ne-opts">
      <label>Time <select id="ne-meter">${METERS.map((m) => `<option ${m === meter ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <button class="pill-btn" id="ne-play">${ICON.play}<span>Play</span></button>
      ${playbackOptionsHtml()}
    </div>
    <p class="fine">Write it in C — it’s transposed into each key you practice. Lengths are in eighth notes: <code>C</code> eighth, <code>C2</code> quarter, <code>C/</code> sixteenth, <code>C3</code> dotted quarter. <code>^</code> sharp, <code>_</code> flat, lowercase = octave up. <b>Chord</b> adds a chord symbol over the next note (<code>"Dm7"</code>).</p>
    <button class="primary-btn" id="ne-save">Done</button>
    <button class="link-btn ne-revert" id="ne-revert" hidden>Undo changes</button>
  `, () => {
    stopFn?.();
    stopPlayback();
    back?.();
  });

  const area = $('#ne-abc', sheet);
  const preview = $('#ne-preview', sheet);
  let drawTimer = null;
  // Every change is saved as it's made (Undo changes puts back what it was when opened).
  const keep = () => {
    t.abc = body.trim();
    t.meter = meter;
    save();
    $('#ne-revert', sheet).hidden = t.abc === original.abc.trim() && t.meter === original.meter;
  };
  const draw = () => {
    keep();
    clearTimeout(drawTimer);
    drawTimer = setTimeout(async () => {
      tune = await renderNotation(preview, body, { meter, tempo: t.tempo || 100 }).catch(() => null);
    }, 120);
  };
  const showMods = () => {
    $$('[data-dur]', sheet).forEach((b) => b.classList.toggle('on', b.dataset.dur === duration));
    $('[data-dot]', sheet).classList.toggle('on', dotted);
    $$('[data-acc]', sheet).forEach((b) => b.classList.toggle('on', b.dataset.acc === accidental));
    $('#ne-oct', sheet).textContent = `C${octave}–B${octave}`;
  };

  // Insert at the cursor, or at the end.
  const insert = (text) => {
    const start = area.selectionStart ?? body.length;
    const end = area.selectionEnd ?? body.length;
    body = body.slice(0, start) + text + body.slice(end);
    area.value = body;
    const pos = start + text.length;
    area.setSelectionRange(pos, pos);
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
  const step = (dir) => {
    const pos = area.selectionStart ?? body.length;
    const stops = [0];
    for (const m of body.matchAll(TOKEN)) stops.push(m.index + m[0].length);
    stops.push(body.length);
    const to = dir > 0 ? stops.find((p) => p > pos) ?? body.length : [...stops].reverse().find((p) => p < pos) ?? 0;
    area.focus();
    area.setSelectionRange(to, to);
  };

  $('#ne-pad', sheet).onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.preventDefault();
    if (b.dataset.dur) { duration = b.dataset.dur; dotted = false; }
    else if (b.hasAttribute('data-dot')) dotted = !dotted;
    else if (b.hasAttribute('data-trip')) insert('(3');
    else if (b.dataset.acc != null) accidental = accidental === b.dataset.acc ? '' : b.dataset.acc;
    else if (b.dataset.oct) octave = Math.max(2, Math.min(6, octave + Number(b.dataset.oct)));
    else if (b.dataset.note) {
      insert(noteToken({ letter: b.dataset.note, accidental, octave, duration, dotted }));
      accidental = ''; // accidentals apply to one note
      haptic();
    } else if (b.hasAttribute('data-rest')) insert(restToken(duration, dotted));
    else if (b.hasAttribute('data-tie')) insert('-');
    else if (b.dataset.ins) insert(b.dataset.ins);
    else if (b.hasAttribute('data-back')) backspace();
    else if (b.dataset.move) step(Number(b.dataset.move));
    else if (b.hasAttribute('data-chord')) {
      // Over the next note; written in C like the notes, and transposed with them.
      const sym = (prompt('Chord symbol, as written in C (like Dm7, G7, Cmaj7):') || '').replace(/["\s]/g, '');
      if (sym) insert(`"${sym}"`);
    }
    showMods();
  };
  // Keep the keypad from stealing the cursor position.
  $('#ne-pad', sheet).onpointerdown = (e) => e.preventDefault();

  area.oninput = () => { body = area.value; draw(); };
  $('#ne-type', sheet).onclick = () => {
    typing = !typing;
    area.setAttribute('inputmode', typing ? 'text' : 'none');
    $('#ne-type', sheet).classList.toggle('on', typing);
    area.blur();
    area.focus();
  };
  $('#ne-meter', sheet).onchange = (e) => { meter = e.target.value; draw(); };
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
      if (stopFn) $('span', play).textContent = 'Stop';
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
    area.value = body;
    $('#ne-meter', sheet).value = meter;
    draw();
    toast('Back to how it was');
  };

  showMods();
  draw();
}

// ---------- Library list ----------

export function exerciseRowHtml(t, stats) {
  const s = stats.get(t.id);
  const mode = t.keyMode === 'none' ? 'No key' : `${t.keysPerSession} key${t.keysPerSession > 1 ? 's' : ''} · ${KEY_MODES[t.keyMode].label.toLowerCase()}`;
  return `
  <li class="row" data-id="${t.id}" role="button" tabindex="0">
    <div class="row-main">
      <b>${t.focus ? `<span class="focus-mark" title="Focus">${ICON.focus}</span>` : ''}${esc(t.name)}${t.abc ? ' <span class="has-abc" title="Has notation">♪</span>' : ''}</b>
      <span class="row-sub">${esc(CATEGORIES[t.category] || 'Other')} · ${esc(mode)} · ${esc(ago(s?.last))}</span>
    </div>
    <span class="pri p${t.priority}">P${t.priority}</span>
  </li>`;
}
