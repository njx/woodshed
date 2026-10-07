import { store, save } from '../store.js';
import { LEVELS, PRIORITIES, RATINGS, CATEGORIES, KEY_MODES } from '../constants.js';
import { dateStr, niceDate, ago } from '../dates.js';
import { keyName, writtenToConcert } from '../keys.js';
import { esc, uid } from '../util.js';
import { itemStats, itemById, isPlayedToday, markPlayed, unmarkPlayed, setLevel, levelSuggestion, deleteItem } from '../practice.js';
import { syncFocus } from '../plan.js';
import { entryKeys } from '../keystats.js';
import { entriesFor } from '../diary.js';
import { DURATIONS, noteToken, restToken, writtenShift, soundingShift } from '../abc.js';
import { canRecord } from '../media.js';
import { renderNotation, playNotation, stopPlayback } from './notation.js';
import { noteHtml, bindNotes, openNote } from './diary.js';
import { openRecorder } from './recorder.js';
import { tempoRowHtml, tempoSuggestionHtml, bindTempo, openMetronome } from './metronome.js';
import { tempoSuggestion } from '../tempo.js';
import {
  $, $$, ICON, ui, render, toast, withUndo, haptic, openSheet, closeSheet, suggestionHtml,
} from './shell.js';

const view = () => store.state.settings.view;
// Exercise keys are roots (0–11), named as major keys for the instrument shown.
export const rootName = (r) => keyName(r % 12, view());

export function exerciseKeysText(keys) {
  return keys.map(rootName).join(' · ');
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
  let previewRoot = todayKeys[0] ?? 0;
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

      <div class="field-label row-label"><span>Notation</span>${t.abc ? `<button class="link-btn" id="x-edit-abc">Edit</button>` : ''}</div>
      ${t.abc ? `
        <div class="notation-card">
          <div class="key-strip" role="group" aria-label="Show in key">${[...Array(12).keys()].map((w) => {
            const r = writtenToConcert(w, view());
            return `<button class="${r === previewRoot ? 'on' : ''} ${todayKeys.includes(r) ? 'today' : ''}" data-root="${r}">${esc(rootName(r))}</button>`;
          }).join('')}</div>
          <div class="notation" id="x-notation"><span class="fine">Loading notation…</span></div>
          <div class="play-row">
            <button class="pill-btn" id="x-play">${ICON.play}<span>Play</span></button>
            <span class="fine">at ${t.tempo || 100} bpm</span>
          </div>
          ${todayKeys.length ? '<p class="fine">Underlined: today’s keys.</p>' : ''}
        </div>` : `<button class="ghost-btn" id="x-add-abc">${ICON.plus}<span>Add notation</span></button>`}

      ${isNew ? '' : `<div data-item-id="${t.id}">${tempoRowHtml(t)}${tempoSuggestionHtml(tempoSuggestion(t))}</div>`}
      <label class="field-label">Kind</label>
      <div class="chips wrap" id="x-cat">${Object.entries(CATEGORIES).map(([k, l]) => `<button class="chip ${t.category === k ? 'on' : ''}" data-cat="${k}">${l}</button>`).join('')}</div>

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
            <span>${esc(exerciseKeysText(entryKeys(e)))}${e.bpm ? ` · ${e.bpm} bpm` : ''}</span>
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
    if (!el || !t.abc) return null;
    return renderNotation(el, t.abc, { shift: writtenShift(previewRoot, view()), meter: t.meter, tempo: t.tempo || 100 })
      .catch(() => { el.innerHTML = '<span class="fine">Couldn’t show this notation.</span>'; return null; });
  }

  function bind() {
    let tune = null;
    drawNotation().then((x) => { tune = x; });
    $$('[data-root]', sheet).forEach((b) => (b.onclick = async () => {
      previewRoot = Number(b.dataset.root);
      $$('[data-root]', sheet).forEach((x) => x.classList.toggle('on', x === b));
      stopFn?.();
      tune = await drawNotation();
    }));
    const play = $('#x-play', sheet);
    if (play) play.onclick = async () => {
      if (stopFn) { stopFn(); stopFn = null; play.classList.remove('on'); $('span', play).textContent = 'Play'; return; }
      if (!tune) return;
      play.classList.add('on');
      $('span', play).textContent = 'Stop';
      try {
        stopFn = await playNotation(tune, {
          transpose: writtenShift(previewRoot, view()) + soundingShift(view()),
          onEnded: () => { stopFn = null; play.classList.remove('on'); $('span', play).textContent = 'Play'; },
        });
      } catch {
        stopFn = null;
        play.classList.remove('on');
        $('span', play).textContent = 'Play';
        toast('Couldn’t play audio on this device');
      }
    };

    const editAbc = $('#x-edit-abc', sheet) || $('#x-add-abc', sheet);
    if (editAbc) editAbc.onclick = () => {
      if (isNew) return toast('Add the exercise first, then its notation');
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
  const play = $('#ne-play', sheet);
  play.onclick = async () => {
    if (stopFn) { stopFn(); stopFn = null; $('span', play).textContent = 'Play'; return; }
    if (!tune) return;
    $('span', play).textContent = 'Stop';
    try {
      stopFn = await playNotation(tune, { transpose: soundingShift(view()), onEnded: () => { stopFn = null; $('span', play).textContent = 'Play'; } });
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
