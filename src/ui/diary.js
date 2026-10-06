import { store, save } from '../store.js';
import { dateStr, niceDate } from '../dates.js';
import { esc } from '../util.js';
import { itemById } from '../practice.js';
import { FLAGS, addEntry, entryById, deleteEntry, openTodos, diaryDays, todoText } from '../diary.js';
import { $, $$, ICON, ui, render, goTo, toast, withUndo, openSheet, closeSheet } from './shell.js';

const FLAG_ICON = { remember: ICON.pin, teacher: ICON.teacher };
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'remember', label: 'To remember' },
  { id: 'teacher', label: 'For teacher' },
];

const dayLabel = (d) => {
  const today = dateStr();
  if (d === today) return 'Today';
  return niceDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
};
const timeLabel = (at) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

export function noteHtml(e, { showDate = false } = {}) {
  const tune = e.itemId ? itemById(e.itemId) : null;
  const meta = [showDate ? dayLabel(e.date) : timeLabel(e.at), tune?.name, e.flag ? FLAGS[e.flag].label : null].filter(Boolean);
  return `
    <li class="note ${e.flag ? `flag-${e.flag}` : ''} ${e.done ? 'done' : ''}" data-note="${e.id}">
      ${e.flag
        ? `<button class="note-check ${e.done ? 'on' : ''}" data-done="${e.id}" aria-label="${e.done ? 'Mark not done' : 'Mark done'}" aria-pressed="${e.done}">${e.done ? ICON.check : FLAG_ICON[e.flag]}</button>`
        : `<span class="note-dot">${ICON.note}</span>`}
      <div class="note-body">
        <p>${esc(e.text)}</p>
        <small>${meta.map(esc).join(' · ')}</small>
      </div>
    </li>`;
}

// Tapping a note opens it; tapping its check toggles done. Works in any list of notes.
export function bindNotes(root, back, onChange = render) {
  $$('[data-done]', root).forEach((b) => (b.onclick = (ev) => {
    ev.stopPropagation();
    const e = entryById(b.dataset.done);
    e.done = !e.done;
    save();
    onChange();
    if (e.done) toast('Marked done', { label: 'Undo', fn: () => { e.done = false; save(); onChange(); } });
  }));
  $$('[data-note]', root).forEach((li) => (li.onclick = () => openNote(li.dataset.note, { back })));
  $$('[data-goto-diary]', root).forEach((b) => (b.onclick = () => goTo('diary')));
}

// Open "remember" items, for the top of the Today screen.
export function rememberPanel() {
  const items = openTodos('remember');
  if (!items.length) return '';
  return `
    <section class="remember">
      <h3 class="section-label">${ICON.pin}To remember</h3>
      <ul class="notes">${items.slice(0, 5).map((e) => noteHtml(e, { showDate: true })).join('')}</ul>
      ${items.length > 5 ? `<button class="link-btn" data-goto-diary>${items.length - 5} more ›</button>` : ''}
    </section>`;
}

export function renderDiary(root) {
  const filter = ui.diaryFilter || 'all';
  const counts = { remember: openTodos('remember').length, teacher: openTodos('teacher').length };
  const days = diaryDays(filter === 'all' ? undefined : filter);
  const todos = filter === 'all' ? [] : openTodos(filter);

  root.innerHTML = `
    <header class="top">
      <div><p class="eyebrow">Practice notes</p><h1>Diary</h1></div>
      <button class="icon-btn accent" id="add-note" aria-label="Add a note">${ICON.plus}</button>
    </header>
    <div class="chips">${FILTERS.map((f) => `<button class="chip ${filter === f.id ? 'on' : ''}" data-df="${f.id}">${f.label}${counts[f.id] ? ` <span class="count">${counts[f.id]}</span>` : ''}</button>`).join('')}</div>
    ${filter !== 'all' ? `
      <div class="todo-head">
        <span>${todos.length ? `${todos.length} open` : 'Nothing open'}</span>
        ${todos.length ? `<button class="pill-btn" id="share-todos">${ICON.share}Share list</button>` : ''}
      </div>
      ${todos.length ? `<ul class="notes panel-list">${todos.map((e) => noteHtml(e, { showDate: true })).join('')}</ul>` : ''}
      <h3 class="section-label">Done</h3>` : ''}
    ${renderDays(days, filter)}
  `;

  $('#add-note').onclick = () => openNote(null, { flag: filter === 'all' ? null : filter });
  $$('[data-add-today]', root).forEach((b) => (b.onclick = () => openNote(null)));
  $$('[data-df]', root).forEach((c) => (c.onclick = () => { ui.diaryFilter = c.dataset.df; render(); }));
  const share = $('#share-todos', root);
  if (share) share.onclick = () => shareText(todoText(filter));
  bindNotes(root);
}

function renderDays(days, filter) {
  // In a filtered view the open items are listed above, so the days below show only done ones.
  const shown = days
    .map((d) => ({ ...d, entries: filter === 'all' ? d.entries : d.entries.filter((e) => e.done) }))
    .filter((d) => d.entries.length || d.played.length);
  if (!shown.length) {
    return filter === 'all'
      ? '<p class="empty">No notes yet. Jot down how practice went, what to work on, or questions for your teacher.</p>'
      : '<p class="empty fine">Done items show up here.</p>';
  }
  return shown.map((d) => `
    <section class="day">
      <h3 class="day-head"><span>${esc(dayLabel(d.date))}</span>${d.date === dateStr() && filter === 'all' ? '<button class="link-btn" data-add-today>+ Note</button>' : ''}</h3>
      ${d.played.length ? `<p class="played">${ICON.key}<span>${d.played.map(esc).join(', ')}</span></p>` : ''}
      ${d.entries.length ? `<ul class="notes panel-list">${d.entries.map((e) => noteHtml(e)).join('')}</ul>` : ''}
    </section>`).join('');
}

async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Couldn’t share on this device');
  }
}

// ---------- Note editor ----------

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

// id null = new note. opts.itemId links a new note to a tune; opts.flag preselects a flag;
// opts.back reopens whatever sheet the note was opened from.
export function openNote(id, opts = {}) {
  const isNew = !id;
  const e = isNew ? { text: '', flag: opts.flag || null, itemId: opts.itemId || null, done: false, date: dateStr() } : entryById(id);
  if (!e) return;
  const tunes = store.state.items.filter((t) => t.type === 'tune');
  const tuneName = () => (e.itemId ? itemById(e.itemId)?.name || '' : '');

  const sheet = openSheet(`
    <p class="eyebrow">${esc(isNew ? 'New note' : dayLabel(e.date))}</p>
    <div class="note-editor">
      <textarea id="n-text" rows="5" placeholder="How did it go? What to work on next…" ${isNew ? 'autofocus' : ''}>${esc(e.text)}</textarea>
      ${Recognition ? `<button class="mic-btn" id="n-mic" aria-label="Dictate">${ICON.mic}</button>` : ''}
    </div>
    ${Recognition ? '' : '<p class="fine">Tip: use the microphone on your keyboard to dictate.</p>'}
    <div class="flag-row">${Object.entries(FLAGS).map(([k, f]) => `
      <button class="flag-btn flag-${k} ${e.flag === k ? 'on' : ''}" data-flag="${k}" aria-pressed="${e.flag === k}">${FLAG_ICON[k]}${f.label}</button>`).join('')}
    </div>
    <label class="field">
      <span class="field-label">Tune (optional)</span>
      <input id="n-tune" list="n-tunes" value="${esc(tuneName())}" placeholder="Which tune is this about?" autocomplete="off">
      <datalist id="n-tunes">${tunes.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>
    </label>
    ${!isNew && e.flag ? `<label class="done-toggle"><input type="checkbox" id="n-done" ${e.done ? 'checked' : ''}> Done</label>` : ''}
    <button class="primary-btn" id="n-save">${isNew ? 'Save note' : 'Done'}</button>
    ${isNew ? '' : '<button class="danger-btn" id="n-delete">Delete note</button>'}
  `, () => {
    // Closing the sheet any way (button, backdrop, swipe down) keeps what you typed.
    stopListening();
    if (!finished && commit() && isNew) toast('Note saved');
    render();
    opts.back?.();
  });
  let finished = false;

  const text = $('#n-text', sheet);
  $$('[data-flag]', sheet).forEach((b) => (b.onclick = () => {
    e.flag = e.flag === b.dataset.flag ? null : b.dataset.flag;
    $$('[data-flag]', sheet).forEach((x) => {
      x.classList.toggle('on', x.dataset.flag === e.flag);
      x.setAttribute('aria-pressed', x.dataset.flag === e.flag);
    });
  }));

  // Dictation, where the browser supports speech recognition.
  let rec = null;
  function stopListening() {
    rec?.stop();
    rec = null;
    $('#n-mic', sheet)?.classList.remove('on');
  }
  const mic = $('#n-mic', sheet);
  if (mic) mic.onclick = () => {
    if (rec) return stopListening();
    rec = new Recognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (ev) => {
      const said = [...ev.results].slice(ev.resultIndex).filter((r) => r.isFinal).map((r) => r[0].transcript.trim()).join(' ');
      if (said) text.value = `${text.value.trimEnd()}${text.value.trim() ? ' ' : ''}${said}`;
    };
    rec.onerror = (ev) => {
      stopListening();
      if (ev.error !== 'aborted') toast('Dictation isn’t available — try the mic on your keyboard');
    };
    rec.onend = () => { if (rec) stopListening(); };
    try {
      rec.start();
      mic.classList.add('on');
    } catch {
      stopListening();
    }
  };

  const commit = () => {
    const name = $('#n-tune', sheet).value.trim().toLowerCase();
    const tune = name ? tunes.find((t) => t.name.toLowerCase() === name) : null;
    const fields = { text: text.value, flag: e.flag, itemId: tune?.id || null };
    if (!fields.text.trim()) return false;
    if (isNew) addEntry(fields);
    else {
      Object.assign(e, fields, { text: fields.text.trim() });
      const done = $('#n-done', sheet);
      if (done) e.done = done.checked;
      if (!e.flag) e.done = false;
    }
    save();
    return true;
  };

  $('#n-save', sheet).onclick = () => {
    if (!text.value.trim()) {
      if (isNew) return text.focus();
      return toast('A note needs some text — or delete it');
    }
    closeSheet();
  };
  const del = $('#n-delete', sheet);
  if (del) del.onclick = () => {
    finished = true;
    closeSheet();
    withUndo('Note deleted', () => deleteEntry(e.id));
  };
}
