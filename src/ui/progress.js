import { store } from '../store.js';
import { dateStr, daysBetween, addDays, parseDate, niceDate } from '../dates.js';
import { esc } from '../util.js';
import { itemStats, itemById, isDue } from '../practice.js';
import { $, $$, ui, saveUi, render, pips, levelLabel } from './shell.js';
import { keyFamiliarity, keySessions } from '../keystats.js';
import { writtenToConcert } from '../keys.js';
import { rootName } from './exercise.js';
import { practicedByDay, fmtDuration } from '../practicetime.js';

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
  for (const e of state.log) if (daysBetween(e.date, today) < 7 && itemById(e.itemId)?.type === 'tune') week.add(e.itemId);
  const time = practicedByDay();
  const timeSince = (days) => [...time].reduce((n, [d, ms]) => n + (daysBetween(d, today) < days ? ms : 0), 0);
  // Big numbers for tiles: "45 min", "2.5 h".
  const tileTime = (ms) => (ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${(ms / 3600000).toFixed(1).replace(/\.0$/, '')} h`);
  const tunes = state.items.filter((t) => t.type === 'tune');
  const dueCount = tunes.filter((t) => isDue(t, stats)).length;

  // Heatmap: 17 weeks, columns are weeks (Sun–Sat), latest week on the right.
  const WEEKS = 17;
  const start = addDays(today, -(parseDate(today).getDay() + (WEEKS - 1) * 7));
  let cells = '';
  for (let w = 0; w < WEEKS; w++) {
    for (let dow = 0; dow < 7; dow++) {
      const day = addDays(start, w * 7 + dow);
      const n = perDay.get(day) || 0;
      const lvl = n === 0 ? (time.get(day) ? 1 : 0) : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
      const future = day > today;
      cells += `<button class="cell h${lvl} ${future ? 'future' : ''} ${day === today ? 'today' : ''}" style="grid-column:${w + 1};grid-row:${dow + 1}" data-d="${day}" ${future ? 'disabled' : ''} aria-label="${niceDate(day)}: ${n} tunes"></button>`;
    }
  }

  const levelCounts = [3, 2, 1, 0].map((l) => ({ l, n: tunes.filter((t) => (t.level ?? 0) === l).length }));

  // Keys: how familiar each one is (recent sessions count more), in circle-of-fifths order.
  const fam = keyFamiliarity();
  const sessions = keySessions(30);
  const maxFam = Math.max(...fam, 0.001);
  // Around the circle of fifths, starting from C as written for the instrument shown.
  const keyOrder = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5].map((w) => writtenToConcert(w, state.settings.view));
  const hasKeys = fam.some((x) => x > 0);
  const maxCount = Math.max(...levelCounts.map((c) => c.n), 1);
  const byDate = [...new Set([...perDay.keys(), ...time.keys()])].sort().reverse().slice(0, 10);
  const timeOn = (day) => (time.get(day) ? fmtDuration(time.get(day)) : '');
  const namesOn = (day) => state.log.filter((e) => e.date === day).map((e) => itemById(e.itemId)?.name).filter(Boolean);

  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Your practice</p><h1>Progress</h1></div></header>
    <div class="tiles">
      <div class="tile"><b>${streak}</b><span>day streak</span></div>
      <div class="tile"><b>${days30}</b><span>days practiced<br>in last 30</span></div>
      <div class="tile"><b>${week.size}</b><span>tunes this week</span></div>
      ${time.size ? `
      <div class="tile"><b>${tileTime(timeSince(7))}</b><span>practiced<br>in last 7 days</span></div>
      <div class="tile"><b>${tileTime(timeSince(30))}</b><span>practiced<br>in last 30 days</span></div>` : ''}
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
      <h3 class="section-label">Keys</h3>
      ${hasKeys ? `
        <div class="keybars" role="img" aria-label="How much you've practiced in each key">
          ${keyOrder.map((k) => `
            <button class="keybar" data-key="${k}" aria-label="${esc(rootName(k))}: ${sessions[k]} sessions in the last 30 days">
              <span class="kb-track"><span class="kb-fill" style="height:${Math.max(4, (fam[k] / maxFam) * 100)}%"></span></span>
              <span class="kb-label">${esc(rootName(k))}</span>
            </button>`).join('')}
        </div>
        <p class="fine" id="key-readout">Taller = more recent practice. Exercises set to “weak keys” favour the short ones. Tap a key for details.</p>`
        : '<p class="fine">As you practice tunes and exercises, this shows which keys you’re spending time in.</p>'}
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
        <li><span class="sess-date">${esc(niceDate(day, { weekday: 'short', month: 'short', day: 'numeric' }))}${timeOn(day) ? `<small>${timeOn(day)}</small>` : ''}</span><span>${namesOn(day).map(esc).join(', ') || '<i>Nothing marked played</i>'}</span></li>`).join('')}</ul>`
        : '<p class="empty">Nothing logged yet — play something from Today’s set.</p>'}
    </section>
  `;

  $('#due-tile').onclick = () => { ui.tab = 'tunes'; ui.library = 'tunes'; ui.filter = 'due'; saveUi(); render(); };
  $$('.keybar', root).forEach((b) => (b.onclick = () => {
    const k = Number(b.dataset.key);
    $$('.keybar', root).forEach((x) => x.classList.toggle('sel', x === b));
    $('#key-readout').textContent = `${rootName(k)}: ${sessions[k]} session${sessions[k] === 1 ? '' : 's'} in the last 30 days.`;
  }));
  $('.heat', root).onclick = (e) => {
    const c = e.target.closest('.cell');
    if (!c || c.disabled) return;
    $$('.heat .cell', root).forEach((x) => x.classList.toggle('sel', x === c));
    const names = namesOn(c.dataset.d);
    const t = timeOn(c.dataset.d);
    $('#heat-readout').textContent = `${niceDate(c.dataset.d, { weekday: 'short', month: 'short', day: 'numeric' })}${t ? ` · ${t}` : ''}: ${names.length ? names.join(', ') : t ? 'nothing marked played' : 'no practice logged'}`;
  };
}
