import { store, flush } from '../store.js';
import { dateStr, addDays, niceDate } from '../dates.js';
import { esc } from '../util.js';
import { ensurePlan } from '../plan.js';
import { itemById } from '../practice.js';
import { openTodos } from '../diary.js';
import { timedToday, startPractice } from '../practicetime.js';
import { $, ICON, goTo } from './shell.js';

// The first time the app opens on a practice day (and the timer hasn't run yet), a welcome with
// what's in today's set and a big Start practice. "Not now" leaves it until tomorrow.

export function maybeGreet() {
  const s = store.state;
  if (!s?.settings.instrumentsChosen || s.greetedOn === dateStr() || timedToday()) return;
  if (document.querySelector('.greet')) return;
  openGreet();
}

// Marks today as greeted (the first-run setup counts).
export function greeted() {
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
  const plan = store.state.plan;
  const items = plan.items.map((it) => ({ it, t: itemById(it.itemId) })).filter((x) => x.t);
  const ex = items.filter((x) => x.t.type === 'exercise' && !x.it.warmup).length;
  const tunes = items.filter((x) => x.t.type === 'tune').length;
  const lines = [];
  const parts = [ex && `${ex} exercise${ex > 1 ? 's' : ''}`, tunes && `${tunes} tune${tunes > 1 ? 's' : ''}`].filter(Boolean);
  if (parts.length) lines.push(`Today’s set: ${parts.join(' and ')}`);
  const focus = items.filter((x) => x.it.bucket === 'focus').map((x) => x.t.name);
  if (focus.length) lines.push(`Focus on <b>${focus.map(esc).join('</b>, <b>')}</b>`);
  const prepped = new Set(items.filter((x) => x.it.warmup && itemById(x.it.warmup)).map((x) => x.it.warmup)).size;
  if (prepped) lines.push(`Warm-ups from the chords before ${prepped === 1 ? 'one of them' : `${prepped} of them`}`);
  const remember = openTodos('remember').length;
  if (remember) lines.push(`${remember} thing${remember > 1 ? 's' : ''} to remember`);
  return lines;
}

function openGreet() {
  const n = streak();
  const el = document.createElement('div');
  el.className = 'greet';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'greet-title');
  el.innerHTML = `
    <div class="greet-body">
      <p class="eyebrow">${esc(niceDate(dateStr()))}</p>
      <h1 id="greet-title">${hello()}</h1>
      ${n ? `<p class="greet-streak">${n} day${n > 1 ? 's' : ''} in a row — keep it going</p>` : ''}
      <ul class="greet-plan">${planLines().map((l) => `<li>${l}</li>`).join('')}</ul>
      <button class="primary-btn" id="greet-start">${ICON.play}<span>Start practice</span></button>
      <button class="link-btn" id="greet-skip">Not now</button>
    </div>`;
  document.body.appendChild(el);
  const close = () => {
    document.removeEventListener('keydown', onKey);
    el.remove();
  };
  const onKey = (e) => { if (e.key === 'Escape') skip(); };
  const skip = () => { greeted(); close(); };
  document.addEventListener('keydown', onKey);
  $('#greet-skip', el).onclick = skip;
  $('#greet-start', el).onclick = () => {
    startPractice();
    greeted();
    close();
    goTo('today');
  };
}
