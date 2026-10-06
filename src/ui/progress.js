import { store } from '../store.js';
import { dateStr, daysBetween, addDays, parseDate, niceDate } from '../dates.js';
import { esc } from '../util.js';
import { itemStats, itemById, isDue } from '../practice.js';
import { $, $$, ui, saveUi, render, pips, levelLabel } from './shell.js';

export function renderProgress(root) {
  const state = store.state;
  const today = dateStr();
  const stats = itemStats();
  const perDay = new Map();
  for (const e of state.log) perDay.set(e.date, (perDay.get(e.date) || 0) + 1);

  let streak = 0;
  let d = perDay.has(today) ? today : addDays(today, -1);
  while (perDay.has(d)) { streak++; d = addDays(d, -1); }
  let days30 = 0;
  for (let i = 0; i < 30; i++) if (perDay.has(addDays(today, -i))) days30++;
  const week = new Set();
  for (const e of state.log) if (daysBetween(e.date, today) < 7) week.add(e.itemId);
  const dueCount = state.items.filter((t) => isDue(t, stats)).length;

  // Heatmap: 17 weeks, columns are weeks (Sun–Sat), latest week on the right.
  const WEEKS = 17;
  const start = addDays(today, -(parseDate(today).getDay() + (WEEKS - 1) * 7));
  let cells = '';
  for (let w = 0; w < WEEKS; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const day = addDays(start, w * 7 + dow);
      const n = perDay.get(day) || 0;
      const lvl = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
      const future = day > today;
      cells += `<button class="cell h${lvl} ${future ? 'future' : ''} ${day === today ? 'today' : ''}" style="grid-column:${w + 1};grid-row:${dow + 1}" data-d="${day}" ${future ? 'disabled' : ''} aria-label="${niceDate(day)}: ${n} tunes"></button>`;
    }
  }

  const levelCounts = [3, 2, 1, 0, null].map((l) => ({ l, n: state.items.filter((t) => (t.level ?? null) === l).length }));
  const maxCount = Math.max(...levelCounts.map((c) => c.n), 1);
  const byDate = [...perDay.keys()].sort().reverse().slice(0, 10);
  const namesOn = (day) => state.log.filter((e) => e.date === day).map((e) => itemById(e.itemId)?.name).filter(Boolean);

  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Your practice</p><h1>Progress</h1></div></header>
    <div class="tiles">
      <div class="tile"><b>${streak}</b><span>day streak</span></div>
      <div class="tile"><b>${days30}</b><span>days practiced<br>in last 30</span></div>
      <div class="tile"><b>${week.size}</b><span>tunes this week</span></div>
      <button class="tile link" id="due-tile"><b>${dueCount}</b><span>tunes due<br>for review →</span></button>
    </div>

    <section class="panel">
      <h3 class="section-label">Last ${WEEKS} weeks</h3>
      <div class="heat" style="grid-template-columns:repeat(${WEEKS},1fr)">${cells}</div>
      <div class="heat-foot">
        <span id="heat-readout">Tap a day to see what you played</span>
        <span class="legend">Less <i class="cell h0"></i><i class="cell h1"></i><i class="cell h2"></i><i class="cell h3"></i><i class="cell h4"></i> More</span>
      </div>
    </section>

    <section class="panel">
      <h3 class="section-label">Repertoire</h3>
      <ul class="levels">${levelCounts.map((c) => `
        <li><span class="lv-name">${pips(c.l)}${esc(levelLabel(c.l))}</span>
        <span class="lv-bar"><span style="width:${(c.n / maxCount) * 100}%"></span></span>
        <b>${c.n}</b></li>`).join('')}</ul>
    </section>

    <section class="panel">
      <h3 class="section-label">Recent sessions</h3>
      ${byDate.length ? `<ul class="sessions">${byDate.map((day) => `
        <li><span class="sess-date">${esc(niceDate(day, { weekday: 'short', month: 'short', day: 'numeric' }))}</span><span>${namesOn(day).map(esc).join(', ')}</span></li>`).join('')}</ul>`
        : '<p class="empty">Nothing logged yet — play something from Today’s set.</p>'}
    </section>
  `;

  $('#due-tile').onclick = () => { ui.tab = 'tunes'; ui.filter = 'due'; saveUi(); render(); };
  $('.heat', root).onclick = (e) => {
    const c = e.target.closest('.cell');
    if (!c || c.disabled) return;
    $$('.heat .cell', root).forEach((x) => x.classList.toggle('sel', x === c));
    const names = namesOn(c.dataset.d);
    $('#heat-readout').textContent = `${niceDate(c.dataset.d, { weekday: 'short', month: 'short', day: 'numeric' })}: ${names.length ? names.join(', ') : 'no practice logged'}`;
  };
}
