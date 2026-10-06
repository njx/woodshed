import { store } from '../store.js';
import { ago } from '../dates.js';
import { esc } from '../util.js';
import { itemStats, isDue } from '../practice.js';
import { $, $$, ICON, ui, saveUi, pips, priBadge, keysText, transposeToggle, bindTransposeToggle } from './shell.js';
import { openItem } from './item.js';

export function rowHtml(t, stats) {
  const s = stats.get(t.id);
  const keys = keysText(t);
  return `
  <li class="row" data-id="${t.id}" role="button" tabindex="0">
    <div class="row-main">
      <b>${t.focus ? `<span class="focus-mark" title="Focus">${ICON.focus}</span>` : ''}${esc(t.name)}${t.mine ? ' <span class="mine">mine</span>' : ''}</b>
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
  { id: 'l3', label: 'Mastered', fn: (t) => t.level === 3 },
  { id: 'l2', label: 'Proficient', fn: (t) => t.level === 2 },
  { id: 'l1', label: 'Familiar', fn: (t) => t.level === 1 },
  { id: 'l0', label: "Don't know", fn: (t) => t.level === 0 },
  { id: 'nr', label: 'Not rated', fn: (t) => t.level == null },
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
  level: { label: 'Familiarity', fn: (a, b) => (b.level ?? -1) - (a.level ?? -1) || a.priority - b.priority },
};

export function renderTunes(root) {
  const tunes = () => store.state.items.filter((t) => t.type === 'tune');
  root.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">${tunes().length} tunes</p>
        <h1>Tunes</h1>
      </div>
      <button class="icon-btn accent" id="add" aria-label="Add a tune">${ICON.plus}</button>
    </header>
    <div class="searchbar">
      ${ICON.search}
      <input id="q" type="search" placeholder="Search tunes" value="${esc(ui.query)}" autocomplete="off" enterkeyhint="search">
    </div>
    <div class="chips" role="tablist">${FILTERS.map((f) => `<button class="chip ${ui.filter === f.id ? 'on' : ''}" data-f="${f.id}">${f.label}</button>`).join('')}</div>
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
    const f = FILTERS.find((x) => x.id === ui.filter) || FILTERS[0];
    const list = tunes()
      .filter((t) => f.fn(t, stats) && (!q || t.name.toLowerCase().includes(q) || t.style.toLowerCase().includes(q)))
      .sort((a, b) => (SORTS[ui.sort] || SORTS.priority).fn(a, b, stats));
    $('#count').textContent = `${list.length} shown`;
    $('#tune-list').innerHTML = list.length ? list.map((t) => rowHtml(t, stats)).join('') : '<li class="empty">Nothing matches.</li>';
  };
  fill();
  bindTransposeToggle(root);
  $('#q').oninput = (e) => { ui.query = e.target.value; fill(); };
  $('#sort').onchange = (e) => { ui.sort = e.target.value; saveUi(); fill(); };
  $$('.chip', root).forEach((c) => (c.onclick = () => {
    ui.filter = c.dataset.f;
    saveUi();
    $$('.chip', root).forEach((x) => x.classList.toggle('on', x === c));
    fill();
  }));
  $('#tune-list').onclick = (e) => {
    const row = e.target.closest('.row');
    if (row) openItem(row.dataset.id);
  };
  $('#add').onclick = () => openItem(null);
}

