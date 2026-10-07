import { store, save } from '../store.js';
import { LEVELS, PRIORITIES, RATINGS, SHIFTS, TRANSPOSITIONS, LISTEN_SERVICES } from '../constants.js';
import { dateStr, niceDate, ago } from '../dates.js';
import { writtenToConcert } from '../keys.js';
import { esc, uid } from '../util.js';
import {
  itemStats, itemById, isPlayedToday, markPlayed, unmarkPlayed, setLevel, levelSuggestion, deleteItem,
} from '../practice.js';
import { syncFocus } from '../plan.js';
import { recordingsFor, recordingUrl, searchUrl, searchName } from '../listen.js';
import { entriesFor } from '../diary.js';
import { noteHtml, bindNotes, openNote } from './diary.js';
import { openRecorder } from './recorder.js';
import { openExercise } from './exercise.js';
import { tempoRowHtml, tempoSuggestionHtml, bindTempo } from './metronome.js';
import { tempoSuggestion } from '../tempo.js';
import { canRecord } from '../media.js';
import {
  $, $$, ICON, ui, render, toast, withUndo, haptic, openSheet, closeSheet, goTo, kn, suggestionHtml,
} from './shell.js';

// Detail sheet for a tune: edit it, listen to recordings, see its history. id null = new tune.
export function openItem(id, opts) {
  const state = store.state;
  if (id && itemById(id)?.type === 'exercise') return openExercise(id, opts);
  const isNew = !id;
  const t = isNew
    ? { id: uid(), type: 'tune', name: ui.query.trim(), style: 'Standard', priority: 2, level: 0, keys: [], notes: '', mine: true, ivl: null, due: null }
    : itemById(id);
  if (!t) return;
  const styles = [...new Set(state.items.map((x) => x.style))].sort();
  const view = state.settings.view;

  // Key chips are laid out by written pitch for the current transposition.
  const keyGrid = () => [false, true].map((minor) => `
    <div class="keygrid">${[...Array(12).keys()].map((w) => {
      const k = writtenToConcert(w, view) + (minor ? 12 : 0);
      const pos = t.keys.indexOf(k);
      return `<button class="${pos >= 0 ? 'on' : ''} ${pos === 0 ? 'primary' : ''}" data-k="${k}" aria-pressed="${pos >= 0}">${kn(k)}</button>`;
    }).join('')}</div>`).join('');

  const listenHtml = () => {
    const service = state.settings.listen;
    const recs = recordingsFor(t);
    return `
      <div class="field-label row-label"><span>Listen</span><button class="link-btn" id="listen-service">${esc(LISTEN_SERVICES[service].label)} ›</button></div>
      <ul class="recordings">
        ${recs.map((r, i) => `
          <li>
            <a href="${esc(recordingUrl(service, t, r))}" target="_blank" rel="noopener">
              <span class="rec-play">${ICON.play}</span>
              <span class="rec-text"><b>${esc(r.artist)}</b><small>${esc([r.album, r.year].filter(Boolean).join(' · ') || 'Search this artist')}</small></span>
              <span class="rec-out">${ICON.out}</span>
            </a>
            ${r.mine ? `<button class="rec-remove" data-rm="${i}" aria-label="Remove this recording">${ICON.skip}</button>` : ''}
          </li>`).join('')}
        <li class="rec-more">
          <a href="${esc(searchUrl(service, searchName(t)))}" target="_blank" rel="noopener">${ICON.search}<span>${recs.length ? 'Other versions' : `Search ${esc(LISTEN_SERVICES[service].label)}`}</span></a>
          <button class="link-btn" id="rec-add-toggle">${ICON.plus}Add one</button>
        </li>
      </ul>
      <form class="rec-form" id="rec-form" hidden>
        <input name="artist" placeholder="Artist" required autocomplete="off">
        <input name="album" placeholder="Album (optional)" autocomplete="off">
        <button class="pill-btn" type="submit">Add</button>
      </form>`;
  };

  const body = () => {
    const s = itemStats().get(t.id);
    const entries = state.log.filter((e) => e.itemId === t.id).sort((a, b) => b.date.localeCompare(a.date));
    const played = isPlayedToday(t.id);
    const tr = TRANSPOSITIONS[view];
    return `
      <textarea class="title-input" id="f-name" rows="1" placeholder="Tune name" aria-label="Tune name" enterkeyhint="done" ${isNew ? 'autofocus' : ''}>${esc(t.name)}</textarea>
      <label class="focus-toggle">
        <span class="focus-icon">${ICON.focus}</span>
        <span><b>Focus</b><small>In your set every day until you turn it off</small></span>
        <input type="checkbox" id="f-focus" role="switch" ${t.focus ? 'checked' : ''}>
      </label>
      ${isNew ? '' : `<div id="listen">${listenHtml()}</div>`}
      ${isNew ? '' : `<div data-item-id="${t.id}">${tempoRowHtml(t)}${tempoSuggestionHtml(tempoSuggestion(t))}</div>`}
      <label class="field-label">How well do you know it?</label>
      ${isNew ? '' : suggestionHtml(t, levelSuggestion(t))}
      <div class="seg four" data-field="level">${LEVELS.map((l) => `<button class="${t.level === l.v ? 'on' : ''}" data-v="${l.v}">${l.label}</button>`).join('')}</div>
      <label class="field-label">Priority</label>
      <div class="seg four" data-field="priority">${PRIORITIES.map((p) => `<button class="${t.priority === p.v ? 'on' : ''}" data-v="${p.v}">${p.label}</button>`).join('')}</div>
      <div class="field-label row-label"><span>Usual keys</span><small>${esc(tr.label)}${tr.offset ? '' : ' pitch'} · first = most common</small></div>
      <div id="keygrids">${keyGrid()}</div>
      <label class="field">
        <span class="field-label">Style</span>
        <input id="f-style" list="styles" value="${esc(t.style)}">
        <datalist id="styles">${styles.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      </label>
      <label class="field">
        <span class="field-label">Notes</span>
        <textarea id="f-notes" rows="2" placeholder="Tricky bars, ideas…">${esc(t.notes)}</textarea>
      </label>
      ${isNew ? `<button class="primary-btn" id="save-new">Add tune</button>` : `
        <div class="history">
          <div class="history-head">
            <div><b>${s?.count || 0}×</b> played · last ${esc(ago(s?.last))}${t.due ? `<br><small>Next review ${t.due <= dateStr() ? '<b>due now</b>' : esc(niceDate(t.due, { month: 'short', day: 'numeric' }))}</small>` : ''}</div>
            <button class="pill-btn ${played ? 'on' : ''}" id="log-today">${ICON.check}${played ? 'Played today' : 'Log for today'}</button>
          </div>
          ${entries.length ? `<ul class="history-list">${entries.slice(0, 8).map((e) => `
            <li><span>${esc(niceDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</span>
            <span>${e.key != null ? esc(kn(e.key)) : e.shift ? esc(SHIFTS[e.shift]) : ''}${e.alt ? ' <em>new key</em>' : ''}${e.bpm ? ` · ${e.bpm} bpm` : ''}</span>
            <span class="r-${e.rating || 'ok'}">${esc(RATINGS.find((r) => r.v === (e.rating || 'ok')).label)}</span></li>`).join('')}</ul>` : ''}
        </div>
        <div class="field-label row-label"><span>Diary</span><span class="row-links">
          ${canRecord() ? `<button class="link-btn" id="rec-tune">${ICON.rec}Record</button>` : ''}
          <button class="link-btn" id="add-tune-note">${ICON.plus}Add a note</button></span></div>
        ${(() => {
          const notes = entriesFor(t.id);
          return notes.length
            ? `<ul class="notes panel-list">${notes.slice(0, 5).map((e) => noteHtml(e, { showDate: true })).join('')}</ul>`
            : '<p class="fine">Notes you write about this tune show up here.</p>';
        })()}
        <button class="danger-btn" id="delete">Delete tune</button>`}
    `;
  };

  const sheet = openSheet(body(), () => { if (!isNew) render(); });
  const commit = () => { if (!isNew) save(); };
  const refresh = () => {
    const y = $('.sheet-body', sheet).scrollTop;
    $('.sheet-body', sheet).innerHTML = body();
    $('.sheet-body', sheet).scrollTop = y;
    bind();
  };

  const bindListen = () => {
    const box = $('#listen', sheet);
    if (!box) return;
    $('#listen-service', box).onclick = () => goTo('settings');
    $('#rec-add-toggle', box).onclick = () => {
      const form = $('#rec-form', box);
      form.hidden = !form.hidden;
      if (!form.hidden) form.artist.focus();
    };
    $('#rec-form', box).onsubmit = (e) => {
      e.preventDefault();
      const f = e.target;
      const artist = f.artist.value.trim();
      if (!artist) return;
      t.recordings = [...(t.recordings || []), { artist, album: f.album.value.trim() || null }];
      commit();
      box.innerHTML = listenHtml();
      bindListen();
    };
    $$('[data-rm]', box).forEach((b) => (b.onclick = () => {
      t.recordings = (t.recordings || []).filter((_, i) => i !== Number(b.dataset.rm));
      commit();
      box.innerHTML = listenHtml();
      bindListen();
    }));
  };

  const bind = () => {
    bindListen();
    $('#f-focus', sheet).onchange = (e) => {
      t.focus = e.target.checked;
      if (!isNew && state.plan?.date === dateStr()) {
        if (t.focus) state.plan.focusSkipped = (state.plan.focusSkipped || []).filter((x) => x !== t.id);
        syncFocus();
      }
      commit();
    };
    const sug = $('.suggest [data-level]', sheet);
    if (sug) sug.onclick = () => { setLevel(t, Number(sug.dataset.level)); commit(); refresh(); };
    // The name field wraps onto as many lines as it needs, but stays a single line of text.
    const nameEl = $('#f-name', sheet);
    const fit = () => { nameEl.style.height = 'auto'; nameEl.style.height = `${nameEl.scrollHeight}px`; };
    fit();
    nameEl.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } };
    nameEl.oninput = () => {
      if (/\n/.test(nameEl.value)) nameEl.value = nameEl.value.replace(/\s*\n\s*/g, ' ');
      fit();
      t.name = nameEl.value;
      if (!isNew && t.name.trim()) commit();
    };
    $('#f-style', sheet).onchange = (e) => { t.style = e.target.value.trim() || 'Standard'; commit(); };
    $('#f-notes', sheet).oninput = (e) => { t.notes = e.target.value; commit(); };
    $('#keygrids', sheet).onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const k = Number(b.dataset.k);
      t.keys = t.keys.includes(k) ? t.keys.filter((x) => x !== k) : [...t.keys, k];
      $('#keygrids', sheet).innerHTML = keyGrid();
      commit();
    };
    $$('.seg', sheet).forEach((seg) => {
      seg.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (seg.dataset.field === 'level') {
          setLevel(t, Number(b.dataset.v));
          commit();
          return refresh();
        }
        t[seg.dataset.field] = Number(b.dataset.v);
        $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
        commit();
      };
    });
    if (isNew) {
      $('#save-new', sheet).onclick = () => {
        if (!t.name.trim()) { $('#f-name', sheet).focus(); return toast('Give the tune a name'); }
        t.name = t.name.trim();
        state.items.push(t);
        save();
        closeSheet();
        ui.query = '';
        render();
        toast(`Added ${t.name}`);
      };
    } else {
      $('#log-today', sheet).onclick = () => {
        if (isPlayedToday(t.id)) unmarkPlayed(t.id);
        else {
          const planItem = state.plan?.date === dateStr() && state.plan.items.find((i) => i.itemId === t.id);
          markPlayed(t.id, planItem || { key: t.keys[0] ?? null });
          haptic();
        }
        save();
        refresh();
      };
      const back = () => openItem(t.id);
      bindTempo(sheet, { back, onChange: refresh });
      $('#add-tune-note', sheet).onclick = () => openNote(null, { itemId: t.id, back });
      const recTune = $('#rec-tune', sheet);
      if (recTune) recTune.onclick = () => openRecorder({ itemId: t.id, back });
      bindNotes(sheet, back, refresh);
      $('#delete', sheet).onclick = () => {
        if (!confirm(`Delete “${t.name}” and its practice history?`)) return;
        closeSheet();
        withUndo(`Deleted ${t.name}`, () => deleteItem(t.id));
      };
    }
  };
  bind();
}
