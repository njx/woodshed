import { store } from '../store.js';
import { dateStr, niceDate } from '../dates.js';
import { itemById } from '../practice.js';
import { FLAGS, entryById, openTodos, diaryDays, todoText, findItemByName, linkableItems } from '../diary.js';
import { canRecord, clipUrl, clipFile, fmtDuration, fmtSize, playOnSpeaker } from '../media.js';
import { openRecorder } from './recorder.js';
import { ICON, ui, render, goTo, toast, perform, closeSheet } from './shell.js';
import * as cmd from '../commands/index.js';
import { customElement, property, state } from 'lit/decorators.js';
import { View, mount, html, nothing, raw, openSheetView } from './lit.js';
import type { Clip, DateStr, DiaryEntry, Id } from '../types.js';

type Flag = NonNullable<DiaryEntry['flag']>;
type Filter = 'all' | Flag;

const FLAG_ICON: Record<Flag, string> = { remember: ICON.pin, teacher: ICON.teacher };
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'remember', label: 'To remember' },
  { id: 'teacher', label: 'For teacher' },
];

const dayLabel = (d: DateStr) => {
  const today = dateStr();
  if (d === today) return 'Today';
  return niceDate(d, { weekday: 'short', month: 'short', day: 'numeric' });
};
const timeLabel = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

// ---------- Notes in a list ----------

export interface NoteRowOpts {
  showDate?: boolean; // the day it's from (otherwise the time)
  back?: () => void; // what a note opened from the list goes back to
  onChange?: () => void; // after a note's marked done or a recording's deleted (default: the app's redraw)
}
// A list's notes (to put in its <ul>): tap one to open it; tap its check to mark it done (with
// Undo); play its recordings, or delete them (with Undo).
export function noteRows(entries: DiaryEntry[], { showDate = false, back, onChange = render }: NoteRowOpts = {}) {
  return entries.map((e) => {
    const tune = e.itemId ? itemById(e.itemId) : null;
    const meta = [showDate ? dayLabel(e.date) : timeLabel(e.at), tune?.name, e.flag ? FLAGS[e.flag].label : null].filter(Boolean);
    return html`
    <li class="note ${e.flag ? `flag-${e.flag}` : ''} ${e.done ? 'done' : ''}" data-note=${e.id} @click=${() => openNote(e.id, { back })}>
      ${e.flag
        ? html`<button class="note-check ${e.done ? 'on' : ''}" data-done=${e.id} aria-label=${e.done ? 'Mark not done' : 'Mark done'} aria-pressed=${String(e.done)} @click=${(ev: Event) => { ev.stopPropagation(); toggleDone(e, onChange); }}>${raw(e.done ? ICON.check : FLAG_ICON[e.flag])}</button>`
        : html`<span class="note-dot">${raw(e.media?.length ? (e.media.some((c) => c.kind === 'video') ? ICON.video : ICON.mic) : ICON.note)}</span>`}
      <div class="note-body">
        ${e.text ? html`<p>${e.text}</p>` : e.media?.length ? nothing : html`<p class="muted">(empty)</p>`}
        ${e.media?.length ? html`<div class="clip-pills">${e.media.map((c) => html`
          <button class="clip-pill ${c.kind}" data-play=${c.kind === 'audio' ? `${e.id}:${c.id}` : nothing} aria-label="Play ${c.kind} recording, ${fmtDuration(c.ms)}"
            @click=${(ev: Event) => { if (c.kind !== 'audio') return; ev.stopPropagation(); toggleListPlay(ev.currentTarget as HTMLElement); }}>
            ${raw(c.kind === 'audio' ? ICON.play : ICON.video)}<span>${fmtDuration(c.ms)}</span>
          </button>`)}</div>` : nothing}
        <small>${meta.join(' · ')}</small>
      </div>
      ${e.media?.length ? html`<button class="note-rm" data-rm-take=${e.id} aria-label="Delete this recording" @click=${(ev: Event) => { ev.stopPropagation(); deleteTake(e, onChange); }}>${raw(ICON.skip)}</button>` : nothing}
    </li>`;
  });
}

function toggleDone(e: DiaryEntry, onChange: () => void) {
  perform(cmd.updateNote, { note: e.id, done: !e.done }, { undo: !e.done });
  onChange();
}

// Deleting a recording, with Undo: a take (or a note that's only a recording) goes altogether; a
// note you wrote keeps its text. The clip file is cleaned up the next time the app starts, if it's
// still not wanted.
function deleteTake(e: DiaryEntry, onChange: () => void) {
  if (listPlayer?.btn.dataset.play?.startsWith(`${e.id}:`)) toggleListPlay(listPlayer.btn);
  if (e.take || !e.text) perform(cmd.deleteNote, { note: e.id });
  else perform(cmd.updateNote, { note: e.id, media: [] }, { undo: true });
  onChange();
}

// One shared player for audio clips played straight from a list (it marks its button playing).
let listPlayer: { audio: HTMLAudioElement; url: string; btn: HTMLElement } | null = null;
async function toggleListPlay(btn: HTMLElement) {
  const [entryId, clipId] = btn.dataset.play!.split(':'); // (a [data-play] button)
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
  const audio = playOnSpeaker(new Audio(url));
  listPlayer = { audio, url, btn };
  btn.classList.add('playing');
  audio.onended = () => { btn.classList.remove('playing'); URL.revokeObjectURL(url); listPlayer = null; };
  audio.play().catch(() => { btn.classList.remove('playing'); toast('Couldn’t play this recording'); });
}

// Open "remember" items, for the top of the Today screen.
export function rememberPanel() {
  const items = openTodos('remember');
  if (!items.length) return nothing;
  return html`
    <section class="remember">
      <h3 class="section-label">${raw(ICON.pin)}To remember</h3>
      <ul class="notes">${noteRows(items.slice(0, 5), { showDate: true })}</ul>
      ${items.length > 5 ? html`<button class="link-btn" data-goto-diary @click=${() => goTo('diary')}>${items.length - 5} more ›</button>` : nothing}
    </section>`;
}

// ---------- The Diary screen ----------

export function renderDiary(root: HTMLElement): void {
  mount(root, 'ws-diary');
}

// Notes and what was played, by day; or the open to-dos to remember or ask the teacher (with what's
// done below).
@customElement('ws-diary')
export class DiaryView extends View {
  render() {
    const filter = (ui.diaryFilter || 'all') as Filter; // (set from FILTERS)
    const flag = filter === 'all' ? null : filter;
    const counts: Partial<Record<Filter, number>> = { remember: openTodos('remember').length, teacher: openTodos('teacher').length };
    const todos = flag ? openTodos(flag) : [];
    return html`
      <header class="top">
        <div><p class="eyebrow">Practice notes</p><h1>Diary</h1></div>
        <div class="top-actions">
          ${canRecord() ? html`<button class="icon-btn" id="diary-rec" aria-label="Record" @click=${() => openRecorder({ flag })}>${raw(ICON.rec)}</button>` : nothing}
          <button class="icon-btn accent" id="add-note" aria-label="Add a note" @click=${() => openNote(null, { flag })}>${raw(ICON.plus)}</button>
        </div>
      </header>
      <div class="chips">${FILTERS.map((f) => html`<button class="chip ${filter === f.id ? 'on' : ''}" data-df=${f.id} @click=${() => { ui.diaryFilter = f.id; this.requestUpdate(); }}>${f.label}${counts[f.id] ? html` <span class="count">${counts[f.id]}</span>` : nothing}</button>`)}</div>
      ${flag ? html`
        <div class="todo-head">
          <span>${todos.length ? `${todos.length} open` : 'Nothing open'}</span>
          ${todos.length ? html`<button class="pill-btn" id="share-todos" @click=${() => shareText(todoText(flag))}>${raw(ICON.share)}Share list</button>` : nothing}
        </div>
        ${todos.length ? html`<ul class="notes panel-list">${noteRows(todos, { showDate: true })}</ul>` : nothing}
        <h3 class="section-label">Done</h3>` : nothing}
      ${this.days(filter)}
    `;
  }
  days(filter: Filter) {
    // In a filtered view the open items are listed above, so the days below show only done ones.
    const shown = diaryDays(filter === 'all' ? undefined : filter)
      .map((d) => ({ ...d, entries: filter === 'all' ? d.entries : d.entries.filter((e) => e.done) }))
      .filter((d) => d.entries.length || d.played.length);
    if (!shown.length) {
      return filter === 'all'
        ? html`<p class="empty">No notes yet. Jot down how practice went, what to work on, or questions for your teacher.</p>`
        : html`<p class="empty fine">Done items show up here.</p>`;
    }
    return shown.map((d) => html`
      <section class="day">
        <h3 class="day-head"><span>${dayLabel(d.date)}</span>${d.date === dateStr() && filter === 'all' ? html`<button class="link-btn" data-add-today @click=${() => openNote(null)}>+ Note</button>` : nothing}</h3>
        ${d.played.length ? html`<p class="played">${raw(ICON.key)}<span>${d.played.join(', ')}</span></p>` : nothing}
        ${d.entries.length ? html`<ul class="notes panel-list">${noteRows(d.entries)}</ul>` : nothing}
      </section>`);
  }
}

async function shareText(text: string) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if ((e as DOMException).name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Couldn’t share on this device');
  }
}

// ---------- Note editor ----------

// Dictation, where the browser has speech recognition. (On iPhone, the first time asks for speech
// recognition permission, and that can leave it stuck: see the watchdog below.)
const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const START_WAIT_MS = 6000;

// A note in the editor: a saved entry, or a new one (no id, time or recordings until it's saved).
type NoteDraft = Pick<DiaryEntry, 'text' | 'flag' | 'itemId' | 'done' | 'date'> & Partial<DiaryEntry>;
interface NoteOpts { flag?: Flag | null; itemId?: Id | null; back?: () => void }

// id null = new note. opts.itemId links a new note to a tune; opts.flag preselects a flag;
// opts.back reopens whatever sheet the note was opened from.
export function openNote(id: Id | null, opts: NoteOpts = {}): void {
  const isNew = !id;
  const e: NoteDraft | undefined = isNew ? { text: '', flag: opts.flag || null, itemId: opts.itemId || null, done: false, date: dateStr() } : entryById(id);
  if (!e) return;
  const el = document.createElement('ws-note-sheet') as NoteSheet;
  Object.assign(el, { entry: e, isNew, opts });
  // Closing the sheet any way (button, backdrop, swipe down) keeps what you typed.
  openSheetView(el, () => el.closed());
}

@customElement('ws-note-sheet')
export class NoteSheet extends View {
  @property({ attribute: false }) entry!: NoteDraft;
  @property({ attribute: false }) isNew = false;
  @property({ attribute: false }) opts: NoteOpts = {};
  @state() listening = false;
  private rec: SpeechRecognition | null = null;
  private finished = false; // (saved, or deleted, already)
  private next: (() => void) | null = null; // where to go after closing, instead of opts.back (e.g. the recorder)
  private urls: string[] = [];
  private done: boolean | undefined; // Done, as ticked (saved with the note)
  @state() flag: Flag | null = null; // its flag, as picked (saved with the note)
  connectedCallback() {
    super.connectedCallback();
    this.flag = this.entry.flag;
  }
  private shut = false; // closed

  get text() { return this.querySelector<HTMLTextAreaElement>('#n-text')!; }

  render() {
    const e = this.entry, isNew = this.isNew;
    const tuneName = e.itemId ? itemById(e.itemId)?.name || '' : '';
    return html`
      <p class="eyebrow">${isNew ? 'New note' : dayLabel(e.date)}</p>
      <div class="note-editor">
        <textarea id="n-text" rows="5" placeholder="How did it go? What to work on next…" ?autofocus=${isNew} .value=${e.text}></textarea>
        ${Recognition ? html`<button class="mic-btn ${this.listening ? 'on' : ''}" id="n-mic" aria-label="Dictate" @click=${() => this.dictate()}>${raw(ICON.mic)}</button>` : nothing}
      </div>
      ${Recognition ? nothing : html`<p class="fine">Tip: use the microphone on your keyboard to dictate.</p>`}
      <div class="flag-row">${(Object.entries(FLAGS) as [Flag, (typeof FLAGS)[Flag]][]).map(([k, f]) => html`
        <button class="flag-btn flag-${k} ${this.flag === k ? 'on' : ''}" data-flag=${k} aria-pressed=${String(this.flag === k)} @click=${() => { this.flag = this.flag === k ? null : k; }}>${raw(FLAG_ICON[k])}${f.label}</button>`)}
      </div>
      <label class="field">
        <span class="field-label">Tune (optional)</span>
        <input id="n-tune" list="n-tunes" .value=${tuneName} placeholder="Which tune or exercise is this about?" autocomplete="off">
        <datalist id="n-tunes">${linkableItems().map((t) => html`<option value=${t.name}></option>`)}</datalist>
      </label>
      ${e.media?.length ? html`<div class="field-label">Recordings</div><ul class="clips" id="n-clips">${e.media.map((c, i) => html`
        <li data-clip=${i}>
          <div class="clip-player ${c.kind}"><span class="fine">Loading…</span></div>
          <div class="clip-meta">
            <span>${c.kind === 'video' ? 'Video' : 'Audio'} · ${fmtDuration(c.ms)} · ${fmtSize(c.size)}</span>
            <button class="link-btn" data-clip-share=${i} @click=${() => this.shareClip(i)}>${raw(ICON.share)}Save</button>
            <button class="link-btn danger" data-clip-rm=${i} @click=${() => this.removeClip(i)}>${raw(ICON.skip)}Remove</button>
          </div>
        </li>`)}</ul>` : nothing}
      ${canRecord() ? html`<button class="ghost-btn rec-start" id="n-record" @click=${() => this.record()}>${raw(ICON.rec)}<span>${e.media?.length ? 'Record another' : 'Record audio or video'}</span></button>` : nothing}
      ${!isNew && this.flag ? html`<label class="done-toggle"><input type="checkbox" id="n-done" .checked=${this.done ?? e.done} @change=${(ev: Event) => { this.done = (ev.target as HTMLInputElement).checked; }}> Done</label>` : nothing}
      <button class="primary-btn" id="n-save" @click=${() => this.saveNote()}>${isNew ? 'Save note' : 'Done'}</button>
      ${isNew ? nothing : html`<button class="danger-btn" id="n-delete" @click=${() => this.deleteNote()}>Delete note</button>`}
    `;
  }
  // Players for this note's clips.
  firstUpdated() {
    (this.entry.media || []).forEach(async (c, i) => {
      const url = await clipUrl(c);
      if (this.shut) { if (url) URL.revokeObjectURL(url); return; } // (closed meanwhile)
      const slot = this.querySelector<HTMLElement>(`[data-clip="${i}"] .clip-player`);
      if (!slot) return;
      if (!url) { slot.innerHTML = '<span class="fine">Not on this device (recordings aren’t included in backups).</span>'; return; }
      this.urls.push(url);
      slot.innerHTML = c.kind === 'video' ? `<video src="${url}" controls playsinline preload="metadata"></video>` : `<audio src="${url}" controls preload="metadata"></audio>`;
      playOnSpeaker(slot.querySelector<HTMLMediaElement>('audio, video')!);
    });
  }
  closed() {
    this.shut = true;
    this.stopListening();
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    if (!this.finished && this.commit() && this.isNew) toast('Note saved');
    render();
    if (this.next) this.next();
    else this.opts.back?.();
  }
  // Saves what's in the editor; false if there's nothing to save (no text and no recordings).
  commit(media?: Clip[]) {
    const e = this.entry;
    const tune = findItemByName(this.querySelector<HTMLInputElement>('#n-tune')!.value);
    const text = this.text.value;
    if (!text.trim() && !(media ?? e.media)?.length) return false;
    if (this.isNew) return !!perform(cmd.addNote, { text, ...(this.flag ? { flag: this.flag } : {}), ...(tune ? { item: tune.id } : {}) });
    return !!perform(cmd.updateNote, {
      note: e.id!, text, flag: this.flag ?? 'none', item: tune?.id || null,
      ...(this.done != null ? { done: this.done } : {}), ...(media ? { media } : {}),
    });
  }
  saveNote() {
    if (!this.text.value.trim() && !this.entry.media?.length) {
      if (this.isNew) return this.text.focus();
      return toast('A note needs some text — or delete it');
    }
    closeSheet();
  }
  deleteNote() { // (only for a saved note)
    const id = this.entry.id!;
    this.finished = true;
    closeSheet();
    perform(cmd.deleteNote, { note: id });
  }
  // Record a take for it (saving it first), then come back to it.
  record() {
    const e = this.entry, back = this.opts.back;
    if (!this.isNew) {
      this.commit();
      this.next = () => openRecorder({ entryId: e.id, back: () => openNote(e.id!, { back }) }); // (saved: it has an id)
    } else if (this.text.value.trim()) {
      this.commit();
      const created = store.state.diary[store.state.diary.length - 1];
      this.next = () => openRecorder({ entryId: created.id, back: () => openNote(created.id, { back }) });
    } else {
      const tune = findItemByName(this.querySelector<HTMLInputElement>('#n-tune')!.value);
      this.next = () => openRecorder({ itemId: tune?.id || this.opts.itemId, flag: this.flag, back });
    }
    this.finished = true;
    closeSheet();
  }
  async shareClip(i: number) {
    const e = this.entry;
    const c = e.media![i]; // (its clips are listed)
    const file = await clipFile(c, `woodshed-${e.date}-${c.id.slice(0, 4)}`);
    if (!file) return toast('This recording isn’t on this device');
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (err) { if ((err as DOMException).name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  removeClip(i: number) {
    if (!confirm('Remove this recording?')) return;
    const e = this.entry;
    const media = e.media!.filter((_, j) => j !== i);
    // (The clip file itself is cleaned up later, if it's still in no note: see media.ts.)
    this.finished = true;
    if (!this.commit(media)) {
      // Nothing left in the note: no text and no recordings.
      closeSheet();
      perform(cmd.deleteNote, { note: e.id! }); // (a saved note: it has recordings)
      return;
    }
    this.next = () => openNote(e.id!, this.opts); // reopen to redraw the clip list
    closeSheet();
  }

  // Dictation, where the browser supports speech recognition.
  stopListening() {
    const r0 = this.rec;
    this.rec = null;
    try { r0?.abort(); } catch { /* already over */ }
    this.listening = false;
  }
  dictate() {
    if (this.rec) return this.stopListening();
    const rec = (this.rec = new Recognition!()); // (the mic button is there only with it)
    const text = this.text;
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (ev) => {
      const said = [...ev.results].slice(ev.resultIndex).filter((r) => r.isFinal).map((r) => r[0].transcript.trim()).join(' ');
      if (said) text.value = `${text.value.trimEnd()}${text.value.trim() ? ' ' : ''}${said}`;
    };
    rec.onerror = (ev) => {
      this.stopListening();
      if (ev.error !== 'aborted') toast('Dictation isn’t available — try the mic on your keyboard');
    };
    rec.onend = () => { if (this.rec === rec) this.stopListening(); };
    // If it hasn't started listening in a while (e.g. stuck after a permission prompt), give up
    // rather than leave the note waiting: it usually works the next time.
    let started = false;
    rec.onaudiostart = rec.onstart = () => { started = true; };
    setTimeout(() => {
      if (this.rec !== rec || started) return;
      this.stopListening();
      toast('Dictation didn’t start — try again, or use the mic on your keyboard');
    }, START_WAIT_MS);
    try {
      rec.start();
      this.listening = true;
    } catch {
      this.stopListening();
    }
  }
}
