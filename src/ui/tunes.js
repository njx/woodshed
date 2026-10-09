import { store } from '../store.js';
import { ago } from '../dates.js';
import { esc } from '../util.js';
import { itemStats, isDue } from '../practice.js';
import { $, $$, ICON, ui, saveUi, pips, priBadge, keysText, transposeToggle, bindTransposeToggle } from './shell.js';
import { openItem } from './item.js';
import { openExercise, exerciseRowHtml } from './exercise.js';
import { CATEGORIES } from '../constants.js';

export function rowHtml(t, stats) {
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

export const FILTERS = [
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
const SORTS = {
  priority: { label: 'Priority', fn: (a, b) => a.priority - b.priority || a.name.localeCompare(b.name) },
  name: { label: 'A–Z', fn: (a, b) => a.name.localeCompare(b.name) },
  recent: { label: 'Recently played', fn: (a, b, s) => (s.get(b.id)?.last || '').localeCompare(s.get(a.id)?.last || '') || a.name.localeCompare(b.name) },
  stale: { label: 'Longest ago', fn: (a, b, s) => (s.get(a.id)?.last || '').localeCompare(s.get(b.id)?.last || '') || a.priority - b.priority },
  most: { label: 'Most played', fn: (a, b, s) => (s.get(b.id)?.count || 0) - (s.get(a.id)?.count || 0) || a.name.localeCompare(b.name) },
  level: { label: 'Familiarity', fn: (a, b) => (b.level ?? 0) - (a.level ?? 0) || a.priority - b.priority },
};

const EXERCISE_FILTERS = [
  { id: 'all', label: 'All', fn: () => true },
  { id: 'due', label: 'Due', fn: isDue },
  { id: 'focus', label: 'Focus', fn: (t) => t.focus },
  { id: 'on', label: 'On', fn: (t) => !t.focus && !t.off && !t.fromTune },
  { id: 'off', label: 'Off', fn: (t) => t.off },
  ...Object.entries(CATEGORIES).map(([k, label]) => ({ id: `c-${k}`, label: `${label}s`, fn: (t) => t.category === k })),
];

export function renderTunes(root) {
  const exercises = ui.library === 'exercises';
  const kind = exercises ? 'exercise' : 'tune';
  const filters = exercises ? EXERCISE_FILTERS : FILTERS;
  const filterKey = exercises ? 'exFilter' : 'filter';
  const items = () => store.state.items.filter((t) => t.type === kind);
  root.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">${items().length} ${exercises ? 'exercises' : 'tunes'}</p>
        <h1>${exercises ? 'Exercises' : 'Tunes'}</h1>
      </div>
      <button class="icon-btn accent" id="add" aria-label="Add ${exercises ? 'an exercise' : 'a tune'}">${ICON.plus}</button>
    </header>
    <div class="seg library-seg"><button class="${exercises ? '' : 'on'}" data-lib="tunes">Tunes</button><button class="${exercises ? 'on' : ''}" data-lib="exercises">Exercises</button></div>
    <div class="searchbar">
      ${ICON.search}
      <input id="q" type="search" placeholder="Search ${exercises ? 'exercises' : 'tunes'}" value="${esc(ui.query)}" autocomplete="off" enterkeyhint="search">
    </div>
    <div class="chips" role="tablist">${filters.map((f) => `<button class="chip ${(ui[filterKey] || 'all') === f.id ? 'on' : ''}" data-f="${f.id}">${f.label}</button>`).join('')}</div>
    <div class="list-head">
      <span id="count"></span>
      ${transposeToggle()}
      <label class="sort"><span class="sr">Sort</span>
        <select id="sort">${Object.entries(SORTS).map(([k, v]) => `<option value="${k}" ${ui.sort === k ? 'selected' : ''}>${v.label}</option>`).join('')}</select>
      </label>
    </div>
    <ul class="list" id="tune-list"></ul>
  `;
  const fill = () => {
    const stats = itemStats();
    const q = ui.query.trim().toLowerCase();
    const f = filters.find((x) => x.id === (ui[filterKey] || 'all')) || filters[0];
    const list = items()
      .filter((t) => f.fn(t, stats) && (!q || t.name.toLowerCase().includes(q) || (t.style || t.category || '').toLowerCase().includes(q)))
      .sort((a, b) => (SORTS[ui.sort] || SORTS.priority).fn(a, b, stats));
    $('#count').textContent = `${list.length} shown`;
    const row = exercises ? exerciseRowHtml : rowHtml;
    $('#tune-list').innerHTML = list.length ? list.map((t) => row(t, stats)).join('') : '<li class="empty">Nothing matches.</li>';
  };
  fill();
  bindTransposeToggle(root);
  $('#q').oninput = (e) => { ui.query = e.target.value; fill(); };
  $('#sort').onchange = (e) => { ui.sort = e.target.value; saveUi(); fill(); };
  $$('[data-lib]', root).forEach((b) => (b.onclick = () => {
    ui.library = b.dataset.lib;
    ui.query = '';
    saveUi();
    renderTunes(root);
  }));
  $$('.chip', root).forEach((c) => (c.onclick = () => {
    ui[filterKey] = c.dataset.f;
    saveUi();
    $$('.chip', root).forEach((x) => x.classList.toggle('on', x === c));
    fill();
  }));
  $('#tune-list').onclick = (e) => {
    const row = e.target.closest('.row');
    if (row) openItem(row.dataset.id);
  };
  $('#add').onclick = () => (exercises ? openExercise(null) : openItem(null));
}

