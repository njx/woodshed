import { store, save } from '../store.js';
import { LEVELS, PRIORITIES, RATINGS, CATEGORIES, KEY_MODES } from '../constants.js';
import { dateStr, niceDate, ago } from '../dates.js';
import { keyName, writtenToConcert } from '../keys.js';
import { esc, uid } from '../util.js';
import { itemStats, itemById, isPlayedToday, markPlayed, unmarkPlayed, setLevel, levelSuggestion, deleteItem } from '../practice.js';
import { syncFocus, refreshTypes } from '../plan.js';
import { entryKeys } from '../keystats.js';
import { entriesFor } from '../diary.js';
import { DURATIONS, noteToken, restToken, writtenShift, soundingShift } from '../abc.js';
import { VARY, SHAPES, PATTERN_PAD, typesOf, typeInfo, variantName, generateAbc, parsePattern, patternText } from '../theory.js';
import { canRecord } from '../media.js';
import { renderNotation, playNotation, stopPlayback, playbackOptionsHtml, bindPlaybackOptions, playbackFor } from './notation.js';
import { noteHtml, bindNotes, openNote } from './diary.js';
import { openRecorder } from './recorder.js';
import { tempoRowHtml, tempoSuggestionHtml, bindTempo, openMetronome } from './metronome.js';
import { tempoSuggestion } from '../tempo.js';
import { SOUNDS } from '../sounds.js';
import {
  $, $$, ICON, ui, render, toast, withUndo, haptic, openSheet, closeSheet, suggestionHtml,
} from './shell.js';

const view = () => store.state.settings.view;
// Exercise keys are roots (0–11), named as major keys for the instrument shown.
export const rootName = (r) => keyName(r % 12, view());

// What to play: "C · F · B♭", or with scale or chord types "C dor · F harm min", "Cm7 · F7".
export function exerciseKeysText(keys = [], t = null, types = null) {
  const kind = t?.vary?.kind;
  if (!kind || !types?.length) return keys.map(rootName).join(' · ');
  if (!keys.length) return types.map((id) => typeInfo(kind, id)?.label || id).join(' · ');
  return keys.map((k, i) => variantName(rootName(k), kind, types[i])).join(' · ');
}

const patternHint = (kind) => (kind === 'chord'
  ? 'Numbers are chord tones: 1 3 5 7, and 8 10 12 14 an octave up. Tap numbers to change the pattern.'
  : 'Numbers are notes of the scale: 1 is the root, and on a 7-note scale 8 is the octave. Tap numbers to change the pattern; the presets fit themselves to scales with more or fewer notes.');

// The notation to show: generated for a scale or chord type, or the exercise's own.
function notationFor(t, type) {
  if (t.vary) return generateAbc(t.vary.kind, type, { shape: t.vary.shape, pattern: t.vary.pattern, meter: t.meter || '4/4' });
  return t.abc;
}

// Detail sheet for an exercise. id null = new exercise. opts.keys: today's keys, to preview first.
export function openExercise(id, opts = {}) {
  const state = store.state;
  const isNew = !id;
  const t = isNew
    ? { id: uid(), type: 'exercise', name: '', category: 'pattern', keyMode: 'weak', keysPerSession: 2, keys: [], abc: '', meter: '4/4', notes: '', priority: 2, level: null, ivl: null, due: null }
    : itemById(id);
  if (!t) return;
  const planItem = state.plan?.date === dateStr() ? state.plan.items.find((i) => i.itemId === t.id) : null;
  const todayKeys = opts.keys || planItem?.keys || [];
  const todayTypes = () => (planItem?.types || opts.types || []).filter((id) => t.vary?.types.includes(id));
  let previewRoot = todayKeys[0] ?? 0;
  // The scale or chord type shown: today's for the key shown, or the first one turned on.
  const typeFor = (root) => todayTypes()[todayKeys.indexOf(root)] ?? todayTypes()[0] ?? t.vary?.types[0];
  let previewType = typeFor(previewRoot);
  let stopFn = null;

  const body = () => {
    const s = itemStats().get(t.id);
    const entries = state.log.filter((e) => e.itemId === t.id).sort((a, b) => b.date.localeCompare(a.date));
    const played = isPlayedToday(t.id);
    const notes = entriesFor(t.id);
    return `
      <textarea class="title-input" id="x-name" rows="1" placeholder="Exercise name" aria-label="Exercise name" enterkeyhint="done" ${isNew ? 'autofocus' : ''}>${esc(t.name)}</textarea>
      <label class="focus-toggle">
        <span class="focus-icon">${ICON.focus}</span>
        <span><b>Focus</b><small>In your set every day until you turn it off</small></span>
        <input type="checkbox" id="x-focus" role="switch" ${t.focus ? 'checked' : ''}>
      </label>

      <div class="field-label row-label"><span>Notation</span>${t.vary ? '<button class="link-btn" id="x-to-pattern">Edit pattern</button>'
        : t.abc ? '<button class="link-btn" id="x-edit-abc">Edit</button>' : ''}</div>
      ${t.vary || t.abc ? `
        <div class="notation-card">
          <div class="key-strip" role="group" aria-label="Show in key">${[...Array(12).keys()].map((w) => {
            const r = writtenToConcert(w, view());
            return `<button class="${r === previewRoot ? 'on' : ''} ${todayKeys.includes(r) ? 'today' : ''}" data-root="${r}">${esc(rootName(r))}</button>`;
          }).join('')}</div>
          ${t.vary ? `<div class="type-strip" role="group" aria-label="Show ${t.vary.kind} type">${t.vary.types.map((id) => `
            <button class="${id === previewType ? 'on' : ''}" data-type="${id}">${esc(typeInfo(t.vary.kind, id).short)}</button>`).join('')}</div>` : ''}
          <div class="notation" id="x-notation"><span class="fine">Loading notation…</span></div>
          <div class="play-row">
            <button class="pill-btn" id="x-play">${ICON.play}<span>Play</span></button>
            ${playbackOptionsHtml()}
          </div>
          ${t.vary && todayTypes().length ? `<p class="fine">Today: ${esc(exerciseKeysText(todayKeys, t, todayTypes()))}</p>`
            : todayKeys.length ? '<p class="fine">Underlined: today’s keys.</p>' : ''}
        </div>` : `<button class="ghost-btn" id="x-add-abc">${ICON.plus}<span>Add notation</span></button>`}

      ${isNew ? '' : `<div data-item-id="${t.id}">${tempoRowHtml(t)}${tempoSuggestionHtml(tempoSuggestion(t))}</div>`}
      <label class="field-label">Kind</label>
      <div class="chips wrap" id="x-cat">${Object.entries(CATEGORIES).map(([k, l]) => `<button class="chip ${t.category === k ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('')}</div>

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
            <span>${esc(exerciseKeysText(entryKeys(e), t, e.types))}${e.bpm ? ` · ${e.bpm} bpm` : ''}</span>
            <span class="r-${e.rating || 'ok'}">${esc(RATINGS.find((r) => r.v === (e.rating || 'ok')).label)}</span></li>`).join('')}</ul>` : ''}
        </div>
        <div class="field-label row-label"><span>Diary</span><span class="row-links">
          ${canRecord() ? `<button class="link-btn" id="x-rec">${ICON.rec}Record</button>` : ''}
          <button class="link-btn" id="x-note">${ICON.plus}Add a note</button></span></div>
        ${notes.length ? `<ul class="notes panel-list">${notes.slice(0, 5).map((e) => noteHtml(e, { showDate: true })).join('')}</ul>` : '<p class="fine">Notes and recordings about this exercise show up here.</p>'}
        <button class="danger-btn" id="x-delete">Delete exercise</button>`}
    `;
  };

  const outerBack = opts.back;
  let leaving = false;
  const sheet = openSheet(body(), () => {
    stopFn?.();
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
    const abc = notationFor(t, previewType);
    if (!el || !abc) return null;
    return renderNotation(el, abc, { shift: writtenShift(previewRoot, view()), meter: t.meter, tempo: t.tempo || 100 })
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

    if (isNew) {
      $('#x-save', sheet).onclick = () => {
        if (!t.name.trim()) { nameEl.focus(); return toast('Give the exercise a name'); }
        t.name = t.name.trim();
        state.items.push(t);
        save();
        closeSheet();
        render();
        toast(`Added ${t.name}`);
      };
      return;
    }
    $('#x-log', sheet).onclick = () => {
      if (isPlayedToday(t.id)) unmarkPlayed(t.id);
      else {
        markPlayed(t.id, planItem || { keys: todayKeys });
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
    if (rec) rec.onclick = () => goTo(() => openRecorder({ itemId: t.id, back }));
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
  let saved = false;
  let stopFn = null;
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
      </div>
      <div class="kp-row notes">${['C', 'D', 'E', 'F', 'G', 'A', 'B'].map((n) => `<button data-note="${n}">${n}</button>`).join('')}</div>
      <div class="kp-row tools">
        <button data-rest aria-label="Rest">Rest</button>
        <button data-tie aria-label="Tie">Tie</button>
        <button data-ins=" " aria-label="Space (breaks beaming)">␣</button>
        <button data-ins=" | " aria-label="Bar line">|</button>
        <button data-back aria-label="Delete">⌫</button>
      </div>
    </div>
    <div class="ne-opts">
      <label>Time <select id="ne-meter">${METERS.map((m) => `<option ${m === meter ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <button class="pill-btn" id="ne-play">${ICON.play}<span>Play</span></button>
      ${playbackOptionsHtml()}
    </div>
    <p class="fine">Write it in C — it’s transposed into each key you practice. Lengths are in eighth notes: <code>C</code> eighth, <code>C2</code> quarter, <code>C/</code> sixteenth, <code>C3</code> dotted quarter. <code>^</code> sharp, <code>_</code> flat, lowercase = octave up.</p>
    <button class="primary-btn" id="ne-save">Save notation</button>
  `, () => {
    stopFn?.();
    stopPlayback();
    if (saved) save();
    back?.();
  });

  const area = $('#ne-abc', sheet);
  const preview = $('#ne-preview', sheet);
  let drawTimer = null;
  const draw = () => {
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
    const m = /(\(3|[_^=]*[A-Ga-gz][,']*\d*\/?\d*-?|\s*\|\s*|\s+|.)$/.exec(before);
    if (!m) return;
    body = before.slice(0, before.length - m[0].length) + body.slice(pos);
    area.value = body;
    const p = before.length - m[0].length;
    area.setSelectionRange(p, p);
    draw();
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
  $('#ne-save', sheet).onclick = () => {
    t.abc = body.trim();
    t.meter = meter;
    saved = true;
    closeSheet();
    toast('Notation saved');
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
