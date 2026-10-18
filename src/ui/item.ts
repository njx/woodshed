import { store } from '../store.js';
import { LEVELS, PRIORITIES, RATINGS, SHIFTS, TRANSPOSITIONS, LISTEN_SERVICES } from '../constants.js';
import { dateStr, niceDate, ago } from '../dates.js';
import { writtenToConcert } from '../keys.js';
import {
  itemStats, itemById, isPlayedToday, isPlanItemPlayed, levelSuggestion, } from '../practice.js';
import { itemStatus, inToday, todayItem } from '../plan.js';
import { recordingsFor, recordingUrl, searchUrl, searchName } from '../listen.js';
import { entriesFor } from '../diary.js';
import { noteRows, openNote } from './diary.js';
import { openRecorder } from './recorder.js';
import { openExercise } from './exercise.js';
import { openMetronome, tempoRow, tempoSuggestionPart } from './metronome.js';
import { tempoSuggestion } from '../tempo.js';
import './chart.js'; // (<ws-chart>)
import { swapInToday, removeFromToday } from './today.js';
import { canRecord } from '../media.js';
import { autoStart } from '../practicetime.js';
import { ICON, ui, render, toast, perform, haptic, closeSheet, goTo, kn, openMenu, keysText } from './shell.js';
import * as cmd from '../commands/index.js';
import { customElement, property, state } from 'lit/decorators.js';
import {
  View, html, nothing, live, raw, openSheetView, segButtons, settingRows, subPanel, statusControl, levelSuggestionPart,
} from './lit.js';
import type { ExerciseOpts } from './exercise.js';
import type { Id, Key, Priority, Tune } from '../types.js';

// Detail sheet for a tune: edit it, listen to recordings, see its history. id null = new tune.
export function openItem(id: Id | null, opts?: ExerciseOpts): void {
  if (id && itemById(id)?.type === 'exercise') return openExercise(id, opts);
  const isNew = !id;
  const t = isNew
    ? { ...cmd.blank.tune(), name: ui.query.trim() }
    : itemById(id) as Tune | undefined; // (an exercise opened above)
  if (!t) return;
  const el = document.createElement('ws-tune-sheet') as TuneSheet;
  Object.assign(el, { tune: t, isNew, pid: opts?.pid });
  // A new tune is added once it has a name: with the button, or by closing the sheet.
  let added = false;
  openSheetView(el, () => {
    if (isNew && !added && t.name.trim()) {
      added = true;
      t.name = t.name.trim();
      ui.query = '';
      perform(cmd.addDraft, { draft: t });
    } else if (!isNew) render();
  });
}

// What's set once and seldom changed: a row for each (showing what it's set to), opening a panel
// with its controls. A new tune shows the controls themselves, all at once.
type PanelKey = 'level' | 'priority' | 'keys' | 'style';
const PANEL_LABELS: Record<PanelKey, string> = { level: 'How well you know it', priority: 'Priority', keys: 'Usual keys', style: 'Style' };

@customElement('ws-tune-sheet')
export class TuneSheet extends View {
  @property({ attribute: false }) tune!: Tune;
  @property({ attribute: false }) isNew = false;
  @property({ attribute: false }) pid: Id | undefined; // opened from its card in today's set
  @state() panel: PanelKey | null = null; // the setting open over the sheet
  @state() adding = false; // adding a recording

  // A change to it: one being made (not in the library yet) takes it straight away; otherwise it's
  // the update_item command, saved and undoable. Then shown (with the chart in it).
  edit(fields: cmd.ItemFields) {
    if (!this.isNew) perform(cmd.updateItem, { item: this.tune.id, ...fields });
    else {
      try { cmd.applyItem(this.tune, fields); } catch (err) { if (err instanceof cmd.CommandError) toast(err.message); else throw err; }
    }
    this.refresh();
  }
  back = () => openItem(this.tune.id, { pid: this.pid }); // (as it was opened: from its card, it's today's)

  render() {
    const t = this.tune, isNew = this.isNew;
    return html`
      <textarea class="title-input" id="f-name" rows="1" placeholder="Tune name" aria-label="Tune name" enterkeyhint="done" ?autofocus=${isNew}
        .value=${live(t.name)} @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
        @input=${(e: Event) => this.rename(e.target as HTMLTextAreaElement)}></textarea>
      ${isNew ? nothing : statusControl(t, itemStatus(t), (st) => this.edit({ status: st }), (b) => this.menu(b))}
      ${!isNew && inToday(t) ? html`<p class="in-today">${raw(ICON.check)}In today’s set</p>` : nothing}
      ${isNew ? nothing : this.todayKey()}
      ${isNew ? nothing : levelSuggestionPart(levelSuggestion(t), (l) => this.edit({ level: l }))}
      ${isNew ? nothing : html`<div data-item-id=${t.id}>${tempoRow(t, () => openMetronome({ itemId: t.id, back: this.back }))}${tempoSuggestionPart(t, tempoSuggestion(t), () => this.requestUpdate())}</div>`}
      ${isNew ? nothing : html`<div id="chart-box" class="chart-box"><ws-chart .tune=${t} .back=${this.back}></ws-chart></div>`}
      <label class="field">
        <span class="field-label">Notes</span>
        <textarea id="f-notes" rows="2" placeholder="Tricky bars, ideas…" .value=${live(t.notes)} @input=${(e: Event) => this.edit({ notes: (e.target as HTMLTextAreaElement).value })}></textarea>
      </label>
      ${settingRows((Object.keys(PANEL_LABELS) as PanelKey[]).map((key) => ({ key, label: PANEL_LABELS[key], value: this.panelValue(key) })), (k) => (this.panel = k as PanelKey))}
      ${isNew ? nothing : html`<div id="listen">${this.listen()}</div>`}
      ${isNew ? html`<button class="primary-btn" id="save-new" @click=${() => this.add()}>Add tune</button>` : this.history()}
      ${this.panel ? subPanel(PANEL_LABELS[this.panel], this.panelBody(this.panel), () => (this.panel = null)) : nothing}
    `;
  }
  updated() {
    // The name field wraps onto as many lines as it needs (it stays a single line of text).
    const name = this.querySelector<HTMLTextAreaElement>('#f-name')!;
    name.style.height = 'auto';
    name.style.height = `${name.scrollHeight}px`;
  }

  rename(el: HTMLTextAreaElement) {
    if (/\n/.test(el.value)) el.value = el.value.replace(/\s*\n\s*/g, ' ');
    if (this.isNew) this.tune.name = el.value; // (checked when it's added)
    else if (el.value.trim()) this.edit({ name: el.value }); // (left as it was while it's empty)
    this.requestUpdate();
  }
  add() {
    if (!this.tune.name.trim()) { this.querySelector<HTMLElement>('#f-name')!.focus(); return toast('Give the tune a name'); }
    closeSheet(); // adds it
  }
  // ⋯: add to today, swap or take it out (from its card), delete.
  menu(anchor: HTMLElement) {
    const t = this.tune;
    const card = this.pid && store.state.plan?.items.find((i) => i.pid === this.pid && !isPlanItemPlayed(i));
    openMenu(anchor, [
      !inToday(t) && { label: 'Add to today’s set', fn: () => { if (perform(cmd.addToToday, { item: t.id })) toast(`Added ${t.name} to today’s set`); this.refresh(); } },
      card && { label: 'Swap for another', fn: () => { closeSheet(); swapInToday(card); } },
      card && { label: 'Take out of today’s set', fn: () => { closeSheet(); removeFromToday(card); } },
      { label: 'Delete tune', danger: true, fn: () => {
        if (!confirm(`Delete “${t.name}” and its practice history?`)) return;
        closeSheet();
        perform(cmd.deleteItem, { item: t.id });
      } },
    ]);
  }

  panelValue(k: PanelKey) {
    const t = this.tune;
    return { level: LEVELS[t.level ?? 0].label, priority: PRIORITIES[(t.priority || 3) - 1].label, keys: keysText(t) || 'None yet', style: t.style }[k];
  }
  panelBody(k: PanelKey) {
    const t = this.tune;
    if (k === 'level') return html`<div class="seg four" data-field="level">${segButtons(LEVELS.map((l) => [l.v, l.label] as const), t.level, (v) => this.edit({ level: v }))}</div>`;
    if (k === 'priority') return html`<div class="seg four" data-field="priority">${segButtons(PRIORITIES.map((p) => [p.v, p.label] as const), t.priority, (v) => this.edit({ priority: v as Priority }))}</div>`;
    if (k === 'keys') {
      const tr = TRANSPOSITIONS[store.state.settings.view];
      return html`<p class="fine">${tr.label}${tr.offset ? '' : ' pitch'} · the first is the most common.</p><div id="keygrids">${this.keyGrid()}</div>`;
    }
    // The styles in use, to pick from.
    const styles = [...new Set(store.state.items.flatMap((x) => (x.type === 'tune' ? [x.style] : [])))].sort();
    return html`<div class="field"><input id="f-style" list="styles" .value=${live(t.style)} aria-label="Style" @change=${(e: Event) => this.edit({ style: (e.target as HTMLInputElement).value })}>
      <datalist id="styles">${styles.map((s) => html`<option value=${s}></option>`)}</datalist></div>`;
  }
  // Its usual keys: chips laid out by written pitch for the instrument shown; the first is its main key.
  keyGrid() {
    const t = this.tune;
    const view = store.state.settings.view;
    const toggle = (k: Key) => this.edit({ keys: t.keys.includes(k) ? t.keys.filter((x) => x !== k) : [...t.keys, k] });
    return [false, true].map((minor) => html`
      <div class="keygrid">${[...Array(12).keys()].map((w) => {
        const k = writtenToConcert(w, view) + (minor ? 12 : 0);
        const pos = t.keys.indexOf(k);
        return html`<button class="${pos >= 0 ? 'on' : ''} ${pos === 0 ? 'primary' : ''}" data-k=${k} aria-pressed=${String(pos >= 0)} @click=${() => toggle(k)}>${kn(k)}</button>`;
      })}</div>`);
  }

  // Today's key, changeable (the chart and its warm-ups follow).
  todayKey() {
    const t = this.tune;
    const it = todayItem(t);
    if (!it) return nothing;
    const minor = (it.key ?? t.keys?.[0] ?? 0) >= 12;
    const keys = [...Array(12).keys()].map((r) => r + (minor ? 12 : 0));
    return html`
      <div class="setting today-key">
        <div><b>Today in</b><span>${it.key != null && t.keys.includes(it.key) ? 'One of its usual keys' : 'A new key for it'}</span></div>
        <select id="f-todaykey" aria-label="Today’s key" @change=${(e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          if (v === '') return;
          perform(cmd.changeToday, { entry: it.pid, key: Number(v) });
          this.refresh(); // (the chart follows)
        }}>
          ${it.key == null ? html`<option value="" selected>—</option>` : nothing}
          ${keys.map((k) => html`<option value=${k} ?selected=${k === it.key}>${kn(k)}${t.keys.includes(k) ? ' · usual' : ''}</option>`)}
        </select>
      </div>`;
  }

  // Recordings to listen to (on the service picked in Settings), and your own.
  listen() {
    const t = this.tune;
    const service = store.state.settings.listen;
    const recs = recordingsFor(t);
    const label = LISTEN_SERVICES[service].label;
    return html`
      <div class="field-label row-label"><span>Listen</span><button class="link-btn" id="listen-service" @click=${() => goTo('settings')}>${label} ›</button></div>
      <ul class="recordings">
        ${recs.map((r, i) => html`
          <li>
            <a href=${recordingUrl(service, t, r)} target="_blank" rel="noopener">
              <span class="rec-play">${raw(ICON.play)}</span>
              <span class="rec-text"><b>${r.artist}</b><small>${[r.album, r.year].filter(Boolean).join(' · ') || 'Search this artist'}</small></span>
              <span class="rec-out">${raw(ICON.out)}</span>
            </a>
            ${r.mine ? html`<button class="rec-remove" data-rm=${i} aria-label="Remove this recording" @click=${() => { perform(cmd.removeRecording, { tune: t.id, artist: r.artist, album: r.album ?? '' }); this.refresh(); }}>${raw(ICON.skip)}</button>` : nothing}
          </li>`)}
        <li class="rec-more">
          <a href=${searchUrl(service, searchName(t))} target="_blank" rel="noopener">${raw(ICON.search)}<span>${recs.length ? 'Other versions' : `Search ${label}`}</span></a>
          <button class="link-btn" id="rec-add-toggle" @click=${() => this.toggleAdding()}>${raw(ICON.plus)}Add one</button>
        </li>
      </ul>
      <form class="rec-form" id="rec-form" ?hidden=${!this.adding} @submit=${(e: Event) => this.addRecording(e)}>
        <input name="artist" placeholder="Artist" required autocomplete="off">
        <input name="album" placeholder="Album (optional)" autocomplete="off">
        <button class="pill-btn" type="submit">Add</button>
      </form>`;
  }
  async toggleAdding() {
    this.adding = !this.adding;
    await this.updateComplete;
    if (this.adding) this.querySelector<HTMLInputElement>('#rec-form [name=artist]')!.focus();
  }
  addRecording(e: Event) {
    e.preventDefault();
    const f = e.target as HTMLFormElement;
    const field = (name: string) => (f.elements.namedItem(name) as HTMLInputElement).value.trim();
    const artist = field('artist');
    if (!artist) return;
    if (!perform(cmd.addRecording, { tune: this.tune.id, artist, album: field('album') || undefined })) return;
    f.reset();
    this.adding = false;
    this.refresh();
  }

  // How often and when it's been played; logging it for today; its notes and takes.
  history() {
    const t = this.tune;
    const s = itemStats().get(t.id);
    const entries = store.state.log.filter((e) => e.itemId === t.id).sort((a, b) => b.date.localeCompare(a.date));
    const played = isPlayedToday(t.id);
    const notes = entriesFor(t.id);
    return html`
      <div class="history">
        <div class="history-head">
          <div><b>${s?.count || 0}×</b> played · last ${ago(s?.last)}${t.due ? html`<br><small>Next review ${t.due <= dateStr() ? html`<b>due now</b>` : niceDate(t.due, { month: 'short', day: 'numeric' })}</small>` : nothing}</div>
          <button class="pill-btn ${played ? 'on' : ''}" id="log-today" @click=${() => this.logToday()}>${raw(ICON.check)}${played ? 'Played today' : 'Log for today'}</button>
        </div>
        ${entries.length ? html`<ul class="history-list">${entries.slice(0, 8).map((e) => html`
          <li><span>${niceDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
          <span>${e.key != null ? kn(e.key) : e.shift ? SHIFTS[e.shift] : ''}${e.alt ? html` <em>new key</em>` : nothing}${e.bpm ? ` · ${e.bpm} bpm` : ''}</span>
          <span class="r-${e.rating || 'ok'}">${RATINGS.find((r) => r.v === (e.rating || 'ok'))!.label}</span></li>`)}</ul>` : nothing}
      </div>
      <div class="field-label row-label"><span>Diary</span><span class="row-links">
        ${canRecord() ? html`<button class="link-btn" id="rec-tune" @click=${() => openRecorder({ itemId: t.id, back: this.back })}>${raw(ICON.rec)}Record</button>` : nothing}
        <button class="link-btn" id="add-tune-note" @click=${() => openNote(null, { itemId: t.id, back: this.back })}>${raw(ICON.plus)}Add a note</button></span></div>
      ${notes.length
        ? html`<ul class="notes panel-list">${noteRows(notes.slice(0, 5), { showDate: true, back: this.back, onChange: () => this.requestUpdate() })}</ul>`
        : html`<p class="fine">Notes you write about this tune show up here.</p>`}`;
  }
  logToday() {
    const t = this.tune;
    if (isPlayedToday(t.id)) perform(cmd.unmarkPlayed, { item: t.id });
    else if (perform(cmd.markPlayed, { item: t.id, entry: todayItem(t)?.pid })) {
      autoStart();
      haptic();
    }
    this.requestUpdate();
  }
}
