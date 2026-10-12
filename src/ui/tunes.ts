import { store } from '../store.js';
import { ago } from '../dates.js';
import { esc } from '../util.js';
import { itemStats, isDue } from '../practice.js';
import { ICON, ui, saveUi, pips, priBadge, keysText, switchView } from './shell.js';
import { openItem } from './item.js';
import { openExercise, exerciseRow } from './exercise.js';
import { CATEGORIES, TRANSPOSITIONS } from '../constants.js';
import { customElement } from 'lit/decorators.js';
import { View, mount, html, nothing, live, raw, type TemplateResult } from './lit.js';
import type { Exercise, Id, Item, ItemStats, Tune } from '../types.js';

type Stats = Map<Id, ItemStats>;
// A library filter, for one kind of item.
interface Filter<T extends Item> { id: string; label: string; fn: (t: T, stats: Stats) => boolean | undefined }

// A tune's row in the library.
export function tuneRow(t: Tune, stats: Stats): TemplateResult {
  const s = stats.get(t.id);
  const keys = keysText(t);
  return html`
  <li class="row ${t.off ? 'off' : ''}" data-id=${t.id} role="button" tabindex="0">
    <div class="row-main">
      <b>${t.focus ? html`<span class="focus-mark" title="Focus">${raw(ICON.focus)}</span>` : nothing}${t.name}${t.mine ? html` <span class="mine">mine</span>` : nothing}${t.off ? html` <span class="off-mark">off</span>` : nothing}</b>
      <span class="row-sub">${keys ? html`<span class="row-key">${keys}</span> · ` : nothing}${t.style} · ${ago(s?.last)}${s?.count ? ` · ${s.count}×` : ''}</span>
    </div>
    ${raw(pips(t.level))}
    ${raw(priBadge(t.priority))}
  </li>`;
}
// (The same, as HTML, for Today's "Also played today" until Today is a component.)
export function rowHtml(t: Tune, stats: Stats): string {
  const s = stats.get(t.id);
  const keys = keysText(t);
  return `
  <li class="row ${t.off ? 'off' : ''}" data-id="${t.id}" role="button" tabindex="0">
    <div class="row-main">
      <b>${t.focus ? `<span class="focus-mark" title="Focus">${ICON.focus}</span>` : ''}${esc(t.name)}${t.mine ? ' <span class="mine">mine</span>' : ''}${t.off ? ' <span class="off-mark">off</span>' : ''}</b>
      <span class="row-sub">${keys ? `<span class="row-key">${esc(keys)}</span> · ` : ''}${esc(t.style)} · ${esc(ago(s?.last))}${s?.count ? ` · ${s.count}×` : ''}</span>
    </div>
    ${pips(t.level)}
    ${priBadge(t.priority)}
  </li>`;
}

export const FILTERS: Filter<Tune>[] = [
  { id: 'all', label: 'All', fn: () => true },
  { id: 'due', label: 'Due', fn: isDue },
  { id: 'focus', label: 'Focus', fn: (t) => t.focus },
  { id: 'on', label: 'On', fn: (t) => !t.focus && !t.off },
  { id: 'off', label: 'Off', fn: (t) => t.off },
  { id: 'l3', label: 'Mastered', fn: (t) => t.level === 3 },
  { id: 'l2', label: 'Proficient', fn: (t) => t.level === 2 },
  { id: 'l1', label: 'Familiar', fn: (t) => t.level === 1 },
  { id: 'l0', label: "Don't know", fn: (t) => t.level === 0 },
  { id: 'p1', label: 'Critical', fn: (t) => t.priority === 1 },
  { id: 'p2', label: 'High', fn: (t) => t.priority === 2 },
  { id: 'mine', label: 'Mine', fn: (t) => t.mine },
];
const SORTS: Record<string, { label: string; fn: (a: Item, b: Item, s: Stats) => number }> = {
  priority: { label: 'Priority', fn: (a, b) => a.priority - b.priority || a.name.localeCompare(b.name) },
  name: { label: 'A–Z', fn: (a, b) => a.name.localeCompare(b.name) },
  recent: { label: 'Recently played', fn: (a, b, s) => (s.get(b.id)?.last || '').localeCompare(s.get(a.id)?.last || '') || a.name.localeCompare(b.name) },
  stale: { label: 'Longest ago', fn: (a, b, s) => (s.get(a.id)?.last || '').localeCompare(s.get(b.id)?.last || '') || a.priority - b.priority },
  most: { label: 'Most played', fn: (a, b, s) => (s.get(b.id)?.count || 0) - (s.get(a.id)?.count || 0) || a.name.localeCompare(b.name) },
  level: { label: 'Familiarity', fn: (a, b) => (b.level ?? 0) - (a.level ?? 0) || a.priority - b.priority },
};

const EXERCISE_FILTERS: Filter<Exercise>[] = [
  { id: 'all', label: 'All', fn: () => true },
  { id: 'due', label: 'Due', fn: isDue },
  { id: 'focus', label: 'Focus', fn: (t) => t.focus },
  { id: 'on', label: 'On', fn: (t) => !t.focus && !t.off && !t.fromTune },
  { id: 'off', label: 'Off', fn: (t) => t.off },
  ...Object.entries(CATEGORIES).map(([k, label]) => ({ id: `c-${k}`, label: `${label}s`, fn: (t: Exercise) => t.category === k })),
];

export function renderTunes(root: HTMLElement): void {
  mount(root, 'ws-library');
}

// The library: tunes or exercises, searched, filtered and sorted (all remembered on this device,
// in ui).
@customElement('ws-library')
export class LibraryView extends View {
  render() {
    const exercises = ui.library === 'exercises';
    const kind = exercises ? 'exercise' : 'tune';
    // (Each kind's filters and rows get only that kind: see items.)
    const filters = (exercises ? EXERCISE_FILTERS : FILTERS) as Filter<Item>[];
    const filterKey = exercises ? 'exFilter' : 'filter';
    const filter = ui[filterKey] || 'all';
    const items = store.state.items.filter((t) => t.type === kind);
    const stats = itemStats();
    const q = ui.query.trim().toLowerCase();
    const f = filters.find((x) => x.id === filter) || filters[0];
    const list = items
      .filter((t: Item & { style?: string; category?: string }) => f.fn(t, stats) && (!q || t.name.toLowerCase().includes(q) || (t.style || t.category || '').toLowerCase().includes(q)))
      .sort((a, b) => (SORTS[ui.sort] || SORTS.priority).fn(a, b, stats));
    // How many are focused, next to the Focus filter (more than a day's worth take turns).
    const focused = items.filter((t) => t.focus).length;
    const max = store.state.settings[exercises ? 'focusExercises' : 'focusTunes'];
    const focusCount = focused ? html` <span class="count ${focused > max ? 'over' : ''}" title=${focused > max ? `${max} a day, taking turns` : ''}>${focused}</span>` : nothing;
    const view = TRANSPOSITIONS[store.state.settings.view];
    const multi = store.state.settings.instruments.length > 1;
    // A change to what's shown, remembered on this device.
    const show = (fn: () => void) => { fn(); saveUi(); this.requestUpdate(); };

    return html`
      <header class="top">
        <div>
          <p class="eyebrow">${items.length} ${exercises ? 'exercises' : 'tunes'}</p>
          <h1>${exercises ? 'Exercises' : 'Tunes'}</h1>
        </div>
        <button class="icon-btn accent" id="add" aria-label="Add ${exercises ? 'an exercise' : 'a tune'}" @click=${() => (exercises ? openExercise(null) : openItem(null))}>${raw(ICON.plus)}</button>
      </header>
      <div class="seg library-seg">${([['tunes', 'Tunes'], ['exercises', 'Exercises']] as const).map(([lib, label]) => html`<button class=${(exercises ? 'exercises' : 'tunes') === lib ? 'on' : ''} data-lib=${lib} @click=${() => show(() => { ui.library = lib; ui.query = ''; })}>${label}</button>`)}</div>
      <div class="searchbar">
        ${raw(ICON.search)}
        <input id="q" type="search" placeholder="Search ${exercises ? 'exercises' : 'tunes'}" .value=${live(ui.query)} autocomplete="off" enterkeyhint="search"
          @input=${(e: Event) => { ui.query = (e.target as HTMLInputElement).value; this.requestUpdate(); }}>
      </div>
      <div class="chips" role="tablist">${filters.map((x) => html`<button class="chip ${filter === x.id ? 'on' : ''}" data-f=${x.id} @click=${() => show(() => { ui[filterKey] = x.id; })}>${x.label}${x.id === 'focus' ? focusCount : nothing}</button>`)}</div>
      <div class="list-head">
        <span id="count">${list.length === items.length ? '' : `${list.length} shown`}</span>
        <button class="transpose ${multi ? '' : 'solo'}" id="transpose" aria-label="Keys shown for ${view.label} instruments${multi ? '. Tap to switch' : ''}" @click=${switchView}>
          <span>Keys in</span><b>${view.label}</b>${multi ? raw(ICON.swap) : nothing}</button>
        <label class="sort"><span class="sr">Sort</span>
          <select id="sort" @change=${(e: Event) => show(() => { ui.sort = (e.target as HTMLSelectElement).value; })}>${Object.entries(SORTS).map(([k, v]) => html`<option value=${k} ?selected=${ui.sort === k}>${v.label}</option>`)}</select>
        </label>
      </div>
      <ul class="list" id="tune-list" @click=${(e: Event) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
        if (row) openItem(row.dataset.id!); // (every row has its item's id)
      }}>${list.length
        ? list.map((t) => (t.type === 'exercise' ? exerciseRow(t, stats) : tuneRow(t, stats)))
        : html`<li class="empty">Nothing matches.</li>`}</ul>
    `;
  }
}
