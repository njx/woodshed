import { store } from '../store.js';
import { dateStr, niceDate } from '../dates.js';
import { fmtDuration, lessonsByDay } from '../practicetime.js';
import { ICON, perform, render } from './shell.js';
import * as cmd from '../commands/index.js';
import { customElement, property, state } from 'lit/decorators.js';
import { View, html, nothing, raw, openSheetView } from './lit.js';
import type { DateStr, PracticeSession } from '../types.js';

// A day's practice time (from the timer on Today, or a day in Progress): the timer's sessions,
// each one's length changeable or taken out (one started by mistake), and time it missed added.
// (A lesson's time is in its diary note.)

export function openPracticeTime(date: DateStr = dateStr()): void {
  const el = document.createElement('ws-practice-time') as PracticeTimeSheet;
  el.date = date;
  openSheetView(el, () => render());
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

@customElement('ws-practice-time')
export class PracticeTimeSheet extends View {
  @property({ attribute: false }) date: DateStr = dateStr();
  @state() add = ''; // minutes to add, as typed
  private tick: ReturnType<typeof setInterval> | undefined;
  connectedCallback() {
    super.connectedCallback();
    this.tick = setInterval(() => { if (store.state.timing) this.requestUpdate(); }, 30000); // (a running one's minutes)
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.tick);
  }

  sessions(): PracticeSession[] {
    return (store.state.sessions || []).filter((s) => s.date === this.date).sort((a, b) => a.start - b.start);
  }
  render() {
    const day = this.date === dateStr() ? 'Today' : niceDate(this.date, { weekday: 'long', month: 'short', day: 'numeric' });
    const list = this.sessions();
    const endOf = (s: PracticeSession) => (s.id === store.state.timing ? Math.max(s.end, Date.now()) : s.end);
    const total = list.reduce((n, s) => n + endOf(s) - s.start, 0);
    const lesson = lessonsByDay().get(this.date);
    const add = Number(this.add);
    return html`
      <p class="eyebrow">Practice time</p>
      <h2 class="sheet-title">${day}</h2>
      <p class="fine" id="pt-total">${total ? `${fmtDuration(total)} on the timer` : 'Nothing on the timer'}${lesson != null ? `, and a lesson${lesson ? ` (${fmtDuration(lesson)})` : ''}` : ''}.</p>
      ${list.length ? html`<ul class="pt-sessions">${list.map((s) => {
        const on = s.id === store.state.timing;
        return html`
        <li class="pt-session" data-session=${s.id}>
          <span class="pt-when">${clock(s.start)} – ${on ? 'now' : clock(s.end)}</span>
          ${on ? html`<span class="fine">Running · ${fmtDuration(endOf(s) - s.start)}</span>` : html`
            <label class="pt-min"><input type="number" inputmode="numeric" min="1" max="720" .value=${String(Math.round((s.end - s.start) / 60000))}
              aria-label="Minutes, from ${clock(s.start)}" @change=${(e: Event) => this.setMinutes(s, e.target as HTMLInputElement)}><span>min</span></label>
            <button class="icon-btn small" data-rm=${s.id} aria-label="Take out the session from ${clock(s.start)}" @click=${() => this.takeOut(s)}>${raw(ICON.skip)}</button>`}
        </li>`;
      })}</ul>` : nothing}
      <div class="setting pt-add">
        <div><b>Add time</b><span>Practice the timer missed${this.date === dateStr() ? '' : ', that day'}</span></div>
        <label class="pt-min"><input type="number" id="pt-add-min" inputmode="numeric" min="1" max="720" placeholder="0" .value=${this.add}
          aria-label="Minutes to add" @input=${(e: Event) => { this.add = (e.target as HTMLInputElement).value; }}><span>min</span></label>
        <button class="pill-btn" id="pt-add" ?disabled=${!(add >= 1)} @click=${() => this.addTime()}>${raw(ICON.plus)}Add</button>
      </div>
      ${lesson != null ? html`<p class="fine">A lesson’s time is in its note in the Diary.</p>` : nothing}`;
  }
  setMinutes(s: PracticeSession, input: HTMLInputElement) {
    const m = Number(input.value);
    if (m >= 1) perform(cmd.setSessionMinutes, { session: s.id, minutes: m });
    else input.value = String(Math.round((s.end - s.start) / 60000)); // (as it was: take it out with ×)
    this.requestUpdate();
  }
  takeOut(s: PracticeSession) {
    perform(cmd.removeSession, { session: s.id });
    this.requestUpdate();
  }
  addTime() {
    if (perform(cmd.addPracticeTime, { minutes: Number(this.add), ...(this.date === dateStr() ? {} : { date: this.date }) })) this.add = '';
    this.requestUpdate();
  }
}
