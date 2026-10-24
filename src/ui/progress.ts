import { store } from '../store.js';
import { dateStr, daysBetween, addDays, parseDate, niceDate } from '../dates.js';
import { itemById } from '../practice.js';
import { levelLabel } from './shell.js';
import { customElement, state } from 'lit/decorators.js';
import { View, mount, html, nothing, pips } from './lit.js';
import { keyFamiliarity, keySessions } from '../keystats.js';
import { writtenToConcert } from '../keys.js';
import { rootName } from './exercise.js';
import { timeByDay, lessonsByDay, practiceDays, streak as streakDays, fmtDuration } from '../practicetime.js';
import type { DateStr, Id, Key } from '../types.js';

export function renderProgress(root: HTMLElement): void {
  mount(root, 'ws-progress');
}

const WEEKS = 17; // the heatmap's
const dayLong = (day: DateStr) => niceDate(day, { weekday: 'short', month: 'short', day: 'numeric' });
// Big numbers for tiles: "45 min", "2.5 h".
const tileTime = (ms: number) => (ms < 3600000 ? `${Math.round(ms / 60000)} min` : `${(ms / 3600000).toFixed(1).replace(/\.0$/, '')} h`);

// The Progress screen: streaks and time, a heatmap of the last weeks, keys, repertoire, sessions.
@customElement('ws-progress')
export class ProgressView extends View {
  @state() selKey: Key | null = null; // the key bar tapped
  @state() selDay: DateStr | null = null; // the heatmap day tapped

  render() {
    const state = store.state;
    const today = dateStr();
    const perDay = new Map<DateStr, number>();
    for (const e of state.log) perDay.set(e.date, (perDay.get(e.date) || 0) + 1);

    // (Days that count: something played, the timer run, or a lesson — see practicetime.ts.)
    const streak = streakDays();
    const counted = practiceDays();
    let days30 = 0;
    for (let i = 0; i < 30; i++) if (counted.has(addDays(today, -i))) days30++;
    const week = new Set<Id>();
    for (const e of state.log) if (daysBetween(e.date, today) < 7 && itemById(e.itemId)?.type === 'tune') week.add(e.itemId);
    const time = timeByDay(); // (the timer's and lessons')
    const lessons = lessonsByDay();
    const timeSince = (days: number) => [...time].reduce((n, [d, ms]) => n + (daysBetween(d, today) < days ? ms : 0), 0);
    const tunes = state.items.filter((t) => t.type === 'tune');
    // Average time on the days timed in the last 30.
    const timedDays = [...time].filter(([d, ms]) => ms > 0 && daysBetween(d, today) < 30).length;
    const avgDay = timedDays ? timeSince(30) / timedDays : 0;

    // Heatmap: columns are weeks (Sun–Sat), latest week on the right.
    const start = addDays(today, -(parseDate(today).getDay() + (WEEKS - 1) * 7));
    const days = [...Array(WEEKS * 7).keys()].map((i) => ({ day: addDays(start, i), w: Math.floor(i / 7), dow: i % 7 }));
    const levelCounts = ([3, 2, 1, 0] as const).map((l) => ({ l, n: tunes.filter((t) => (t.level ?? 0) === l).length }));

    // Keys: how familiar each one is (recent sessions count more), around the circle of fifths,
    // starting from C as written for the instrument shown.
    const fam = keyFamiliarity();
    const sessions = keySessions(30);
    const maxFam = Math.max(...fam, 0.001);
    const keyOrder = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5].map((w) => writtenToConcert(w, state.settings.view));
    const hasKeys = fam.some((x) => x > 0);
    const maxCount = Math.max(...levelCounts.map((c) => c.n), 1);
    const byDate = [...new Set([...perDay.keys(), ...time.keys()])].sort().reverse().slice(0, 10);
    const timeOn = (day: DateStr) => { const ms = time.get(day); return ms ? fmtDuration(ms) : ''; };
    // What was played on a day, after its lesson, if it had one ("Lesson (45 min)").
    const namesOn = (day: DateStr) => [
      ...(lessons.has(day) ? [`Lesson${lessons.get(day) ? ` (${fmtDuration(lessons.get(day)!)})` : ''}`] : []),
      ...state.log.filter((e) => e.date === day).map((e) => itemById(e.itemId)?.name).filter(Boolean),
    ];
    const sel = this.selDay;
    const selNames = sel ? namesOn(sel) : [];

    return html`
      <header class="top"><div><p class="eyebrow">Your practice</p><h1>Progress</h1></div></header>
      <div class="tiles">
        <div class="tile"><b>${streak}</b><span>day streak</span></div>
        <div class="tile"><b>${days30}</b><span>days practiced<br>in last 30</span></div>
        <div class="tile"><b>${week.size}</b><span>tunes this week</span></div>
        ${time.size ? html`
        <div class="tile"><b>${tileTime(timeSince(7))}</b><span>practiced<br>in last 7 days</span></div>
        <div class="tile"><b>${tileTime(timeSince(30))}</b><span>practiced<br>in last 30 days</span></div>
        <div class="tile"><b>${tileTime(avgDay)}</b><span>a day on average<br>(days practiced)</span></div>` : nothing}
      </div>

      <section class="panel">
        <h3 class="section-label">Last ${WEEKS} weeks</h3>
        <div class="heat" style="grid-template-columns:repeat(${WEEKS},1fr)">${days.map(({ day, w, dow }) => {
          const n = perDay.get(day) || 0;
          const lvl = n === 0 ? (time.get(day) || lessons.has(day) ? 1 : 0) : n === 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : 4;
          const future = day > today;
          const lesson = lessons.has(day);
          return html`<button class="cell h${lvl} ${lesson ? 'lesson' : ''} ${future ? 'future' : ''} ${day === today ? 'today' : ''} ${day === sel ? 'sel' : ''}" style="grid-column:${w + 1};grid-row:${dow + 1}" data-d=${day} ?disabled=${future} aria-label="${niceDate(day)}: ${n} tunes${lesson ? ', a lesson' : ''}" @click=${() => (this.selDay = day)}></button>`;
        })}</div>
        <div class="heat-foot">
          <span id="heat-readout">${sel
            ? `${dayLong(sel)}${timeOn(sel) ? ` · ${timeOn(sel)}` : ''}: ${selNames.length ? selNames.join(', ') : timeOn(sel) ? 'nothing marked played' : 'no practice logged'}`
            : 'Tap a day to see what you played'}</span>
          <span class="legend">Less <i class="cell h0"></i><i class="cell h1"></i><i class="cell h2"></i><i class="cell h3"></i><i class="cell h4"></i> More${lessons.size ? html` · <i class="cell h1 lesson"></i> Lesson` : nothing}</span>
        </div>
      </section>

      <section class="panel">
        <h3 class="section-label">Keys</h3>
        ${hasKeys ? html`
          <div class="keybars" role="img" aria-label="How much you've practiced in each key">
            ${keyOrder.map((k) => html`
              <button class="keybar ${k === this.selKey ? 'sel' : ''}" data-key=${k} aria-label="${rootName(k)}: ${sessions[k]} sessions in the last 30 days" @click=${() => (this.selKey = k)}>
                <span class="kb-track"><span class="kb-fill" style="height:${Math.max(4, (fam[k] / maxFam) * 100)}%"></span></span>
                <span class="kb-label">${rootName(k)}</span>
              </button>`)}
          </div>
          <p class="fine" id="key-readout">${this.selKey != null
            ? `${rootName(this.selKey)}: ${sessions[this.selKey]} session${sessions[this.selKey] === 1 ? '' : 's'} in the last 30 days.`
            : 'Taller = more recent practice. Exercises set to “weak keys” favour the short ones. Tap a key for details.'}</p>`
          : html`<p class="fine">As you practice tunes and exercises, this shows which keys you’re spending time in.</p>`}
      </section>

      <section class="panel">
        <h3 class="section-label">Repertoire</h3>
        <ul class="levels">${levelCounts.map((c) => html`
          <li><span class="lv-name">${pips(c.l)}${levelLabel(c.l)}</span>
          <span class="lv-bar"><span style="width:${(c.n / maxCount) * 100}%"></span></span>
          <b>${c.n}</b></li>`)}</ul>
      </section>

      <section class="panel">
        <h3 class="section-label">Recent sessions</h3>
        ${byDate.length ? html`<ul class="sessions">${byDate.map((day) => html`
          <li><span class="sess-date">${dayLong(day)}${timeOn(day) ? html`<small>${timeOn(day)}</small>` : nothing}</span><span>${namesOn(day).join(', ') || html`<i>Nothing marked played</i>`}</span></li>`)}</ul>`
          : html`<p class="empty">Nothing logged yet — play something from Today’s set.</p>`}
      </section>
    `;
  }
}
