import { store, save } from '../store.js';
import { dateStr, niceDate } from '../dates.js';
import { esc } from '../util.js';
import { itemById } from '../practice.js';
import { FLAGS, addEntry, entryById, deleteEntry, openTodos, diaryDays, todoText, findItemByName, linkableItems } from '../diary.js';
import { canRecord, clipUrl, clipFile, fmtDuration, fmtSize } from '../media.js';
import { openRecorder } from './recorder.js';
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
        : `<span class="note-dot">${e.media?.length ? (e.media.some((c) => c.kind === 'video') ? ICON.video : ICON.mic) : ICON.note}</span>`}
      <div class="note-body">
        ${e.text ? `<p>${esc(e.text)}</p>` : e.media?.length ? '' : '<p class="muted">(empty)</p>'}
        ${clipPills(e)}
        <small>${meta.map(esc).join(' · ')}</small>
      </div>
      ${e.media?.length ? `<button class="note-rm" data-rm-take="${e.id}" aria-label="Delete this recording">${ICON.skip}</button>` : ''}
    </li>`;
}

function clipPills(e) {
  if (!e.media?.length) return '';
  return `<div class="clip-pills">${e.media.map((c) => `
    <button class="clip-pill ${c.kind}" ${c.kind === 'audio' ? `data-play="${e.id}:${c.id}"` : ''} aria-label="Play ${c.kind} recording, ${fmtDuration(c.ms)}">
      ${c.kind === 'audio' ? ICON.play : ICON.video}<span>${fmtDuration(c.ms)}</span>
    </button>`).join('')}</div>`;
}

// One shared player for audio clips played straight from a list.
let listPlayer = null;
async function toggleListPlay(btn) {
  const [entryId, clipId] = btn.dataset.play.split(':');
  const playing = btn.classList.contains('playing');
  if (listPlayer) {
    listPlayer.audio.pause();
    URL.revokeObjectURL(listPlayer.url);
    listPlayer.btn.classList.remove('playing');
    listPlayer = null;
  }
  if (playing) return;
  const clip = entryById(entryId)?.media?.find((c) => c.id === clipId);
  const url = clip && (await clipUrl(clip));
  if (!url) return toast('This recording isn’t on this device');
  const audio = new Audio(url);
  listPlayer = { audio, url, btn };
  btn.classList.add('playing');
  audio.onended = () => { btn.classList.remove('playing'); URL.revokeObjectURL(url); listPlayer = null; };
  audio.play().catch(() => { btn.classList.remove('playing'); toast('Couldn’t play this recording'); });
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
  $$('[data-play]', root).forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); toggleListPlay(b); }));
  // Deleting a recording, with Undo: a take (or a note that's only a recording) goes altogether; a
  // note you wrote keeps its text. The clip file is cleaned up the next time the app starts, if
  // it's still not wanted.
  $$('[data-rm-take]', root).forEach((b) => (b.onclick = (ev) => {
    ev.stopPropagation();
    const diary = store.state.diary;
    const i = diary.findIndex((x) => x.id === b.dataset.rmTake);
    if (i < 0) return;
    const e = diary[i];
    if (listPlayer?.btn.dataset.play?.startsWith(`${e.id}:`)) toggleListPlay(listPlayer.btn);
    const whole = e.take || !e.text;
    const media = e.media;
    if (whole) diary.splice(i, 1);
    else e.media = [];
    save();
    onChange();
    toast(media.length > 1 ? 'Recordings deleted' : 'Recording deleted', { label: 'Undo', fn: () => {
      if (store.state.diary !== diary) return toast('Can’t undo — other things have changed since');
      if (whole) diary.splice(Math.min(i, diary.length), 0, e);
      else e.media = media;
      save();
      onChange();
    } });
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
      <div class="top-actions">
        ${canRecord() ? `<button class="icon-btn" id="diary-rec" aria-label="Record">${ICON.rec}</button>` : ''}
        <button class="icon-btn accent" id="add-note" aria-label="Add a note">${ICON.plus}</button>
      </div>
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
  const rec = $('#diary-rec', root);
  if (rec) rec.onclick = () => openRecorder({ flag: filter === 'all' ? null : filter });
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

// Dictation, where the browser has speech recognition — but not on iPhone/iPad, where it can freeze
// a home-screen app (and the keyboard's own mic button does the same job reliably).
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const Recognition = isIOS ? null : globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

// id null = new note. opts.itemId links a new note to a tune; opts.flag preselects a flag;
// opts.back reopens whatever sheet the note was opened from.
export function openNote(id, opts = {}) {
  const isNew = !id;
  const e = isNew ? { text: '', flag: opts.flag || null, itemId: opts.itemId || null, done: false, date: dateStr() } : entryById(id);
  if (!e) return;
  const tunes = linkableItems();
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
      <input id="n-tune" list="n-tunes" value="${esc(tuneName())}" placeholder="Which tune or exercise is this about?" autocomplete="off">
      <datalist id="n-tunes">${tunes.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>
    </label>
    ${e.media?.length ? `<div class="field-label">Recordings</div><ul class="clips" id="n-clips">${e.media.map((c, i) => `
      <li data-clip="${i}">
        <div class="clip-player ${c.kind}"><span class="fine">Loading…</span></div>
        <div class="clip-meta">
          <span>${c.kind === 'video' ? 'Video' : 'Audio'} · ${fmtDuration(c.ms)} · ${fmtSize(c.size)}</span>
          <button class="link-btn" data-clip-share="${i}">${ICON.share}Save</button>
          <button class="link-btn danger" data-clip-rm="${i}">${ICON.skip}Remove</button>
        </div>
      </li>`).join('')}</ul>` : ''}
    ${canRecord() ? `<button class="ghost-btn rec-start" id="n-record">${ICON.rec}<span>${e.media?.length ? 'Record another' : 'Record audio or video'}</span></button>` : ''}
    ${!isNew && e.flag ? `<label class="done-toggle"><input type="checkbox" id="n-done" ${e.done ? 'checked' : ''}> Done</label>` : ''}
    <button class="primary-btn" id="n-save">${isNew ? 'Save note' : 'Done'}</button>
    ${isNew ? '' : '<button class="danger-btn" id="n-delete">Delete note</button>'}
  `, () => {
    // Closing the sheet any way (button, backdrop, swipe down) keeps what you typed.
    stopListening();
    urls.forEach((u) => URL.revokeObjectURL(u));
    if (!finished && commit() && isNew) toast('Note saved');
    render();
    if (next) next();
    else opts.back?.();
  });
  let finished = false;
  let next = null; // where to go after closing, instead of opts.back (e.g. the recorder)
  const urls = [];

  // Players for this note's clips.
  (e.media || []).forEach(async (c, i) => {
    const url = await clipUrl(c);
    const slot = $(`[data-clip="${i}"] .clip-player`, sheet);
    if (!slot) return;
    if (!url) { slot.innerHTML = '<span class="fine">Not on this device (recordings aren’t included in backups).</span>'; return; }
    urls.push(url);
    slot.innerHTML = c.kind === 'video' ? `<video src="${url}" controls playsinline preload="metadata"></video>` : `<audio src="${url}" controls preload="metadata"></audio>`;
  });
  $$('[data-clip-share]', sheet).forEach((b) => (b.onclick = async () => {
    const c = e.media[Number(b.dataset.clipShare)];
    const file = await clipFile(c, `woodshed-${e.date}-${c.id.slice(0, 4)}`);
    if (!file) return toast('This recording isn’t on this device');
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (err) { if (err.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }));
  $$('[data-clip-rm]', sheet).forEach((b) => (b.onclick = () => {
    if (!confirm('Remove this recording?')) return;
    const i = Number(b.dataset.clipRm);
    e.media = e.media.filter((_, j) => j !== i);
    // The clip file itself is cleaned up the next time the app starts.
    if (!commit()) {
      // Nothing left in the note: no text and no recordings.
      deleteEntry(e.id);
      save();
      finished = true;
      closeSheet();
      return toast('Note deleted');
    }
    finished = true;
    next = () => openNote(e.id, opts); // reopen to redraw the clip list
    closeSheet();
  }));
  const recBtn = $('#n-record', sheet);
  if (recBtn) recBtn.onclick = () => {
    const back = opts.back;
    if (!isNew) {
      commit();
      finished = true;
      next = () => openRecorder({ entryId: e.id, back: () => openNote(e.id, { back }) });
    } else if (text.value.trim()) {
      commit();
      const created = store.state.diary[store.state.diary.length - 1];
      finished = true;
      next = () => openRecorder({ entryId: created.id, back: () => openNote(created.id, { back }) });
    } else {
      const tune = findItemByName($('#n-tune', sheet).value);
      finished = true;
      next = () => openRecorder({ itemId: tune?.id || opts.itemId, flag: e.flag, back });
    }
    closeSheet();
  };

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
    const r0 = rec;
    rec = null;
    try { r0?.abort(); } catch { /* already over */ }
    $('#n-mic', sheet)?.classList.remove('on');
  }
  const mic = $('#n-mic', sheet);
  if (mic) mic.onclick = () => {
    if (rec) return stopListening();
    rec = new Recognition();
    rec.continuous = false; // a phrase at a time: continuous mode is unreliable in some browsers
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
    const tune = findItemByName($('#n-tune', sheet).value);
    const fields = { text: text.value, flag: e.flag, itemId: tune?.id || null };
    if (!fields.text.trim() && !e.media?.length) return false;
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
    if (!text.value.trim() && !e.media?.length) {
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
