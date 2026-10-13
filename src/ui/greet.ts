import { store, flush } from '../store.js';
import { dateStr, addDays, niceDate } from '../dates.js';
import { ensurePlan } from '../plan.js';
import { itemById } from '../practice.js';
import { openTodos } from '../diary.js';
import { timedToday, startPractice } from '../practicetime.js';
import { ICON, goTo } from './shell.js';
import { customElement } from 'lit/decorators.js';
import { View, html, nothing, raw, type TemplateResult } from './lit.js';
import type { Item, PlanItem } from '../types.js';

// The first time the app opens on a practice day (and the timer hasn't run yet), a welcome with
// what's in today's set and a big Start practice. "Not now" leaves it until tomorrow.

export function maybeGreet(): void {
  const s = store.state;
  if (!s?.settings.instrumentsChosen || s.greetedOn === dateStr() || timedToday()) return;
  if (document.querySelector('ws-greet')) return;
  openGreet();
}

// Marks today as greeted (the first-run setup counts).
export function greeted(): void {
  store.state.greetedOn = dateStr();
  flush(); // right away: closing the app straight after shouldn't bring it back
}

function hello(h = new Date().getHours()) {
  if (h >= 4 && h < 12) return 'Good morning';
  if (h >= 12 && h < 17) return 'Good afternoon';
  return 'Good evening';
}

// Days in a row with something played, up to yesterday.
function streak() {
  const days = new Set(store.state.log.map((e) => e.date));
  let n = 0;
  for (let d = addDays(dateStr(), -1); days.has(d); d = addDays(d, -1)) n++;
  return n;
}

function planLines() {
  ensurePlan();
  const plan = store.state.plan!; // (ensurePlan made it)
  const items = plan.items.map((it) => ({ it, t: itemById(it.itemId) })).filter((x): x is { it: PlanItem; t: Item } => !!x.t);
  const ex = items.filter((x) => x.t.type === 'exercise' && !x.it.warmup).length;
  const tunes = items.filter((x) => x.t.type === 'tune').length;
  const lines: (string | TemplateResult)[] = [];
  const parts = [ex && `${ex} exercise${ex > 1 ? 's' : ''}`, tunes && `${tunes} tune${tunes > 1 ? 's' : ''}`].filter(Boolean);
  if (parts.length) lines.push(`Today’s set: ${parts.join(' and ')}`);
  const focus = items.filter((x) => x.it.bucket === 'focus').map((x) => x.t.name);
  if (focus.length) lines.push(html`Focus on ${focus.map((f, i) => html`${i ? ', ' : ''}<b>${f}</b>`)}`);
  const prepped = new Set(items.filter((x) => x.it.warmup && itemById(x.it.warmup)).map((x) => x.it.warmup)).size;
  if (prepped) lines.push(`Warm-ups from the chords before ${prepped === 1 ? 'one of them' : `${prepped} of them`}`);
  const remember = openTodos('remember').length;
  if (remember) lines.push(`${remember} thing${remember > 1 ? 's' : ''} to remember`);
  return lines;
}

function openGreet() {
  document.body.appendChild(document.createElement('ws-greet'));
}

@customElement('ws-greet')
export class Greet extends View {
  private onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.skip(); };
  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this.onKey);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this.onKey);
  }
  skip() { greeted(); this.remove(); }
  start() {
    startPractice();
    greeted();
    this.remove();
    goTo('today');
  }
  render() {
    const n = streak();
    return html`
      <div class="greet" role="dialog" aria-modal="true" aria-labelledby="greet-title">
        <div class="greet-body">
          <p class="eyebrow">${niceDate(dateStr())}</p>
          <h1 id="greet-title">${hello()}</h1>
          ${n ? html`<p class="greet-streak">${n} day${n > 1 ? 's' : ''} in a row — keep it going</p>` : nothing}
          <ul class="greet-plan">${planLines().map((l) => html`<li>${l}</li>`)}</ul>
          <button class="primary-btn" id="greet-start" @click=${() => this.start()}>${raw(ICON.play)}<span>Start practice</span></button>
          <button class="link-btn" id="greet-skip" @click=${() => this.skip()}>Not now</button>
        </div>
      </div>`;
  }
}
