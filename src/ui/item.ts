import { store, save } from '../store.js';
import { LEVELS, PRIORITIES, RATINGS, SHIFTS, TRANSPOSITIONS, LISTEN_SERVICES } from '../constants.js';
import { dateStr, niceDate, ago } from '../dates.js';
import { writtenToConcert } from '../keys.js';
import { esc, uid } from '../util.js';
import {
  itemStats, itemById, isPlayedToday, isPlanItemPlayed, markPlayed, unmarkPlayed, setLevel, levelSuggestion, deleteItem,
} from '../practice.js';
import { setItemStatus, itemStatus, addToToday, inToday, todayItem, setTodayKey } from '../plan.js';
import { recordingsFor, recordingUrl, searchUrl, searchName } from '../listen.js';
import { entriesFor } from '../diary.js';
import { noteHtml, bindNotes, openNote } from './diary.js';
import { openRecorder } from './recorder.js';
import { openExercise } from './exercise.js';
import { tempoRowHtml, tempoSuggestionHtml, bindTempo } from './metronome.js';
import { tempoSuggestion } from '../tempo.js';
import { mountChart } from './chart.js';
import { swapInToday, removeFromToday } from './today.js';
import { canRecord } from '../media.js';
import { autoStart } from '../practicetime.js';
import {
  $, $$, ICON, ui, render, toast, withUndo, haptic, openSheet, closeSheet, goTo, kn, suggestionHtml, statusHtml, openMenu, keysText, settingRowsHtml, settingPanel,
} from './shell.js';
import type { ExerciseOpts } from './exercise.js';
import type { Id, Key, Level, Priority, Tune } from '../types.js';

// Detail sheet for a tune: edit it, listen to recordings, see its history. id null = new tune.
export function openItem(id: Id | null, opts?: ExerciseOpts): void {
  const state = store.state;
  if (id && itemById(id)?.type === 'exercise') return openExercise(id, opts);
  const isNew = !id;
  // (A new tune has no `focus` yet: unset reads as not.)
  const t = isNew
    ? { id: uid(), type: 'tune', name: ui.query.trim(), style: 'Standard', priority: 2, level: 0, keys: [] as Key[], notes: '', mine: true, ivl: null, due: null } satisfies Omit<Tune, 'focus'> as Tune
    : itemById(id) as Tune | undefined; // (an exercise opened above)
  if (!t) return;
  // TODO(ts): exercises have no style, so this has undefined in it too (an empty <option> below).
  const styles = [...new Set(state.items.map((x) => ('style' in x ? x.style : undefined)))].sort();
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
    return `
      <textarea class="title-input" id="f-name" rows="1" placeholder="Tune name" aria-label="Tune name" enterkeyhint="done" ${isNew ? 'autofocus' : ''}>${esc(t.name)}</textarea>
      ${isNew ? '' : statusHtml(t, itemStatus(t))}
      ${!isNew && inToday(t) ? `<p class="in-today">${ICON.check}In today’s set</p>` : ''}
      ${isNew ? '' : todayKeyHtml()}
      ${isNew ? '' : suggestionHtml(t, levelSuggestion(t))}
      ${isNew ? '' : `<div data-item-id="${t.id}">${tempoRowHtml(t)}${tempoSuggestionHtml(tempoSuggestion(t))}</div>`}
      ${isNew ? '' : '<div id="chart-box" class="chart-box"></div>'}
      <label class="field">
        <span class="field-label">Notes</span>
        <textarea id="f-notes" rows="2" placeholder="Tricky bars, ideas…">${esc(t.notes)}</textarea>
      </label>
      ${isNew ? detailsHtml() : settingRowsHtml(Object.entries(PANELS).map(([key, x]) => ({ key, label: x.label, value: x.value() })))}
      ${isNew ? '' : `<div id="listen">${listenHtml()}</div>`}
      ${isNew ? `<button class="primary-btn" id="save-new">Add tune</button>` : `
        <div class="history">
          <div class="history-head">
            <div><b>${s?.count || 0}×</b> played · last ${esc(ago(s?.last))}${t.due ? `<br><small>Next review ${t.due <= dateStr() ? '<b>due now</b>' : esc(niceDate(t.due, { month: 'short', day: 'numeric' }))}</small>` : ''}</div>
            <button class="pill-btn ${played ? 'on' : ''}" id="log-today">${ICON.check}${played ? 'Played today' : 'Log for today'}</button>
          </div>
          ${entries.length ? `<ul class="history-list">${entries.slice(0, 8).map((e) => `
            <li><span>${esc(niceDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</span>
            <span>${e.key != null ? esc(kn(e.key)) : e.shift ? esc(SHIFTS[e.shift]) : ''}${e.alt ? ' <em>new key</em>' : ''}${e.bpm ? ` · ${e.bpm} bpm` : ''}</span>
            <span class="r-${e.rating || 'ok'}">${esc(RATINGS.find((r) => r.v === (e.rating || 'ok'))!.label)}</span></li>`).join('')}</ul>` : ''}
        </div>
        <div class="field-label row-label"><span>Diary</span><span class="row-links">
          ${canRecord() ? `<button class="link-btn" id="rec-tune">${ICON.rec}Record</button>` : ''}
          <button class="link-btn" id="add-tune-note">${ICON.plus}Add a note</button></span></div>
        ${(() => {
          const notes = entriesFor(t.id);
          return notes.length
            ? `<ul class="notes panel-list">${notes.slice(0, 5).map((e) => noteHtml(e, { showDate: true })).join('')}</ul>`
            : '<p class="fine">Notes you write about this tune show up here.</p>';
        })()}`}
    `;
  };

  // Set once and seldom changed: a row for each (what it's set to), opening a panel with its
  // controls. A new tune shows the controls themselves, all at once.
  const PANELS = {
    level: { label: 'How well you know it', value: () => LEVELS[t.level ?? 0].label,
      html: () => `<div class="seg four" data-field="level">${LEVELS.map((l) => `<button class="${t.level === l.v ? 'on' : ''}" data-v="${l.v}">${l.label}</button>`).join('')}</div>` },
    priority: { label: 'Priority', value: () => PRIORITIES[(t.priority || 3) - 1].label,
      html: () => `<div class="seg four" data-field="priority">${PRIORITIES.map((p) => `<button class="${t.priority === p.v ? 'on' : ''}" data-v="${p.v}">${p.label}</button>`).join('')}</div>` },
    keys: { label: 'Usual keys', value: () => keysText(t) || 'None yet',
      html: () => {
        const tr = TRANSPOSITIONS[view];
        return `<p class="fine">${esc(tr.label)}${tr.offset ? '' : ' pitch'} · the first is the most common.</p><div id="keygrids">${keyGrid()}</div>`;
      } },
    style: { label: 'Style', value: () => t.style,
      html: () => `<div class="field"><input id="f-style" list="styles" value="${esc(t.style)}" aria-label="Style">
        <datalist id="styles">${styles.map((s) => `<option value="${esc(s)}">`).join('')}</datalist></div>` },
  };
  function detailsHtml() {
    return Object.values(PANELS).map((x) => `<label class="field-label">${x.label}</label>${x.html()}`).join('');
  }
  let panel: keyof typeof PANELS | null = null; // the panel open over the sheet (a key of PANELS), if any
  const fillPanel = () => {
    const el = sheet.querySelector('.sub-panel');
    if (!el || !panel) { panel = null; return; }
    el.querySelector('.sub-body')!.innerHTML = PANELS[panel].html();
  };

  // Today's key, changeable (the chart and its warm-ups follow).
  // (t! below: it's checked above, but that doesn't reach into a function declaration.)
  function todayKeyHtml() {
    const it = todayItem(t!);
    if (!it) return '';
    const minor = (it.key ?? t!.keys?.[0] ?? 0) >= 12;
    const keys = [...Array(12).keys()].map((r) => r + (minor ? 12 : 0));
    return `
      <div class="setting today-key">
        <div><b>Today in</b><span>${it.key != null && t!.keys.includes(it.key) ? 'One of its usual keys' : 'A new key for it'}</span></div>
        <select id="f-todaykey" aria-label="Today’s key">
          ${it.key == null ? '<option value="" selected>—</option>' : ''}
          ${keys.map((k) => `<option value="${k}" ${k === it.key ? 'selected' : ''}>${esc(kn(k))}${t!.keys.includes(k) ? ' · usual' : ''}</option>`).join('')}
        </select>
      </div>`;
  }

  let added = false;
  // A new tune is added once it has a name: with the button, or by closing the sheet.
  const sheet = openSheet(body(), () => {
    if (isNew && !added && t.name.trim()) {
      added = true;
      t.name = t.name.trim();
      ui.query = '';
      withUndo(`Added ${t.name}`, () => state.items.push(t));
    } else if (!isNew) render();
  });
  const commit = () => { if (!isNew) save(); };
  const refresh = () => {
    const y = $('.sheet-body', sheet).scrollTop;
    $('.sheet-body', sheet).innerHTML = body();
    $('.sheet-body', sheet).scrollTop = y;
    fillPanel();
    bind();
  };

  const bindListen = () => {
    const box = $('#listen', sheet);
    if (!box) return;
    $('#listen-service', box).onclick = () => goTo('settings');
    $('#rec-add-toggle', box).onclick = () => {
      const form = $<HTMLFormElement>('#rec-form', box);
      form.hidden = !form.hidden;
      if (!form.hidden) (form.artist as HTMLInputElement).focus();
    };
    $('#rec-form', box).onsubmit = (e) => {
      e.preventDefault();
      const f = e.target as HTMLFormElement;
      const artist = (f.artist as HTMLInputElement).value.trim();
      if (!artist) return;
      t.recordings = [...(t.recordings || []), { artist, album: (f.album as HTMLInputElement).value.trim() || null }];
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
    $$('#item-status button', sheet).forEach((b) => (b.onclick = () => {
      setItemStatus(t, b.dataset.v as ReturnType<typeof itemStatus>);
      commit();
      refresh();
    }));
    const sug = $('.suggest [data-level]', sheet);
    if (sug) sug.onclick = () => { setLevel(t, Number(sug.dataset.level) as Level); commit(); refresh(); };
    // The name field wraps onto as many lines as it needs, but stays a single line of text.
    const nameEl = $<HTMLTextAreaElement>('#f-name', sheet);
    const fit = () => { nameEl.style.height = 'auto'; nameEl.style.height = `${nameEl.scrollHeight}px`; };
    fit();
    nameEl.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); nameEl.blur(); } };
    nameEl.oninput = () => {
      if (/\n/.test(nameEl.value)) nameEl.value = nameEl.value.replace(/\s*\n\s*/g, ' ');
      fit();
      t.name = nameEl.value;
      if (!isNew && t.name.trim()) commit();
    };
    const style = $('#f-style', sheet);
    if (style) style.onchange = (e) => { t.style = (e.target as HTMLInputElement).value.trim() || 'Standard'; commit(); };
    $('#f-notes', sheet).oninput = (e) => { t.notes = (e.target as HTMLTextAreaElement).value; commit(); };
    const grids = $('#keygrids', sheet);
    if (grids) grids.onclick = (e) => {
      const b = (e.target as Element).closest('button');
      if (!b) return;
      const k = Number(b.dataset.k);
      t.keys = t.keys.includes(k) ? t.keys.filter((x) => x !== k) : [...t.keys, k];
      $('#keygrids', sheet).innerHTML = keyGrid();
      commit();
    };
    $$('.seg[data-field]', sheet).forEach((seg) => {
      seg.onclick = (e) => {
        const b = (e.target as Element).closest('button');
        if (!b) return;
        if (seg.dataset.field === 'level') {
          setLevel(t, Number(b.dataset.v) as Level);
          commit();
          return refresh();
        }
        t[seg.dataset.field as 'priority'] = Number(b.dataset.v) as Priority; // (level's done above)
        $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
        commit();
      };
    });
    const keySel = $<HTMLSelectElement>('#f-todaykey', sheet);
    if (keySel) keySel.onchange = () => {
      if (keySel.value === '') return;
      setTodayKey(todayItem(t)!, Number(keySel.value)); // (it's shown for an item in today's set)
      refresh();
    };
    // A setting's row opens its panel over the sheet; Done goes back to the rows.
    $$('[data-open]', sheet).forEach((b) => (b.onclick = () => {
      panel = b.dataset.open as keyof typeof PANELS;
      settingPanel(sheet, PANELS[panel].label, () => { panel = null; refresh(); });
      refresh();
    }));
    // ⋯: add to today, delete.
    const menu = $('#item-menu', sheet);
    // (From its card in today's set: swap it or take it out, as a swipe left does.)
    const card = opts?.pid && store.state.plan?.items.find((i) => i.pid === opts.pid && !isPlanItemPlayed(i));
    if (menu) menu.onclick = () => openMenu(menu, [
      !inToday(t) && { label: 'Add to today’s set', fn: () => { if (addToToday(t)) toast(`Added ${t.name} to today’s set`); refresh(); } },
      card && { label: 'Swap for another', fn: () => { closeSheet(); swapInToday(card); } },
      card && { label: 'Take out of today’s set', fn: () => { closeSheet(); removeFromToday(card); } },
      { label: 'Delete tune', danger: true, fn: () => {
        if (!confirm(`Delete “${t.name}” and its practice history?`)) return;
        closeSheet();
        withUndo(`Deleted ${t.name}`, () => deleteItem(t.id));
      } },
    ]);
    if (isNew) {
      $('#save-new', sheet).onclick = () => {
        if (!t.name.trim()) { $('#f-name', sheet).focus(); return toast('Give the tune a name'); }
        closeSheet(); // adds it
      };
    } else {
      $('#log-today', sheet).onclick = () => {
        if (isPlayedToday(t.id)) unmarkPlayed(t.id);
        else {
          markPlayed(t.id, todayItem(t) || { key: t.keys[0] ?? null });
          autoStart();
          haptic();
        }
        save();
        refresh();
      };
      const back = () => openItem(t.id);
      mountChart($('#chart-box', sheet), t, { back });
      bindTempo(sheet, { back, onChange: refresh });
      $('#add-tune-note', sheet).onclick = () => openNote(null, { itemId: t.id, back });
      const recTune = $('#rec-tune', sheet);
      if (recTune) recTune.onclick = () => openRecorder({ itemId: t.id, back });
      bindNotes(sheet, back, refresh);
    }
  };
  bind();
}
