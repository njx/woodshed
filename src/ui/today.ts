import { store, save } from '../store.js';
import { BUCKETS, RATINGS, SHIFTS, LEVELS, TRANSPOSITIONS, CATEGORIES } from '../constants.js';
import { dateStr, niceDate } from '../dates.js';
import { randomOf } from '../util.js';
import {
  itemStats, itemById, planEntry, isPlanItemPlayed, markPlayed, unmarkPlayed, rate, setLevel, tempoSource,
  levelSuggestion, overdue,
} from '../practice.js';
import { ensurePlan, buildPlan, pickItem, makePlanItem, excludedIds, swapWarmup, dropOrphanWarmups, pickFocus } from '../plan.js';
import {
  $, ICON, render, toast, withUndo, haptic, attachSwipe, closeSwipes, kn, keysText,
  switchView, hintDone,
} from './shell.js';
import { tuneRow } from './tunes.js';
import { openItem } from './item.js';
import { rememberPanel, openNote } from './diary.js';
import { pickWarmup } from './pickers.js';
import { openRecorder } from './recorder.js';
import { exerciseKeysText, exerciseRow, rootName, takeLabel } from './exercise.js';
import { entriesFor } from '../diary.js';
import { openMetronome, tempoSuggestionPart } from './metronome.js';
import { openTuner } from './tuner.js';
import { metronome } from '../metronome.js';
import { tuner } from '../tuning.js';
import { writtenName } from '../pitch.js';
import { tempoSuggestion } from '../tempo.js';
import { openAssistant } from './assistant.js';
import { canRecord } from '../media.js';
import { chartFor } from '../charts.js';
import { greeted } from './greet.js';
import { running, startPractice, endPractice, awayStop, countTimeAway, autoStart, practicedMs, fmtDuration, fmtClock } from '../practicetime.js';
import { customElement, property } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { View, mount, html, nothing, raw, levelSuggestionPart, type TemplateResult, priBadge } from './lit.js';
import type { SwipeCard } from './shell.js';
import type { Id, Item, ItemStats, Level, PlanItem, Rating, Transposition } from '../types.js';

export function renderToday(root: HTMLElement): void {
  mount(root, 'ws-today');
}

// The Today screen: the date and tools, the practice timer, today's set as cards (see <ws-card>),
// and what else was played today.
@customElement('ws-today')
export class TodayView extends View {
  render() {
    const state = store.state;
    ensurePlan();
    const plan = state.plan!;
    const stats = itemStats();
    const items = plan.items.filter((it) => itemById(it.itemId));
    const done = items.filter((it) => isPlanItemPlayed(it)).length;
    const today = dateStr();
    const planIds = new Set(items.map((i) => i.itemId));
    const extras = state.log.filter((e) => e.date === today && !planIds.has(e.itemId)).map((e) => itemById(e.itemId)).filter(Boolean) as Item[];
    return html`
      <header class="top today-top">
        <div class="tt-row">
          <p class="eyebrow tt-date"><span class="tt-wd">${niceDate(today, { weekday: 'short' })}, </span>${niceDate(today, { month: 'short', day: 'numeric' })}</p>
          ${toolsHtml()}
        </div>
        <div class="tt-row">
          <h1 class="tt-title">Today’s set</h1>
          <div class="top-actions">
            ${progressRing(done, items.length)}
            <button class="icon-btn" id="reshuffle" aria-label="New set (keeps what you've played)" @click=${() => withUndo('New set picked', () => buildPlan(true))}>${raw(ICON.shuffle)}</button>
          </div>
        </div>
        ${dayNote()}
      </header>
      <ws-timer></ws-timer>
      ${state.settings.instrumentsChosen ? nothing : welcome()}
      ${rememberPanel()}
      ${items.length ? nothing : html`<p class="empty">No tunes yet. Add some on the Tunes tab.</p>`}
      <ul class="cards">${repeat(plan.items.filter((it) => itemById(it.itemId)), (it) => it.pid, (it) => html`<ws-card .item=${it} .stats=${stats}></ws-card>`)}</ul>
      <button class="ghost-btn" id="more" @click=${() => this.oneMore()}>${raw(ICON.plus)}<span>One more tune</span></button>
      ${extras.length ? html`
        <h3 class="section-label">Also played today</h3>
        <ul class="list" @click=${(e: Event) => {
          const row = (e.target as HTMLElement).closest<HTMLElement>('.row');
          if (row) openItem(row.dataset.id!); // (every row has its item's id)
        }}>${extras.map((t) => (t.type === 'exercise' ? exerciseRow(t, stats) : tuneRow(t, stats)))}</ul>` : nothing}
      <ws-hint hint="swipe" text="Swipe a card right when you’ve played it, left to swap or remove it. Tap for details."></ws-hint>
    `;
  }
  updated() {
    liveTools();
  }
  oneMore() {
    const t = pickItem(randomOf(['fresh', 'learn', 'hone']), excludedIds(), itemStats());
    if (!t) return toast('No more tunes to suggest');
    store.state.plan!.items.push(makePlanItem(t, itemStats()));
    dropOrphanWarmups();
    save();
    render();
  }
}

// The tools, as circles at the top right. The metronome's and tuner's show them running (see
// liveTools): the tempo, flashing on the beat; the note, green when in tune.
function toolsHtml() {
  const tool = (id: string, icon: string, label: string, fn: () => void) => html`<button class="hd-tool" id=${id} aria-label=${label} @click=${fn}><span class="hd-icon">${raw(icon)}</span></button>`;
  const live = (id: string, icon: string, label: string, fn: () => void) => html`<button class="hd-tool ${id}" id=${id} aria-label=${label} @click=${fn}>
    <span class="hd-icon">${raw(icon)}</span><b class="hd-live" aria-hidden="true"></b></button>`;
  const s = store.state.settings;
  const multi = s.instruments.length > 1;
  return html`<div class="hd-tools" role="toolbar" aria-label="Tools">
    ${multi ? html`<button class="hd-tool" id="transpose" aria-label="Keys in ${TRANSPOSITIONS[s.view].label}. Tap to switch" @click=${switchView}>
      <span class="hd-icon hd-key">${s.view === 'c' ? 'C' : TRANSPOSITIONS[s.view].label}</span></button>` : nothing}
    ${tool('today-ask', ICON.ask, 'Ask the assistant', () => openAssistant())}
    ${tool('today-note', ICON.note, 'New note', () => openNote(null))}
    ${canRecord() ? tool('today-rec', ICON.rec, 'Record', () => openRecorder()) : nothing}
    ${live('today-metro', ICON.metro, 'Metronome', () => openMetronome())}
    ${live('today-tuner', ICON.tuner, 'Tuner', () => openTuner())}
  </div>`;
}

const HOLD_MS = 600; // the tuner keeps showing a note this long after the sound stops
let liveRaf: number | null = null;
function liveTools() {
  if (liveRaf !== null) cancelAnimationFrame(liveRaf);
  const tick = () => {
    const ms = metronome.state;
    const ts = tuner.state;
    const m = document.getElementById('today-metro');
    if (m) {
      const c = ms.running ? metronome.lastClick() : null;
      m.classList.toggle('live', ms.running);
      m.classList.toggle('beat', !!c && c.since < 0.1);
      m.classList.toggle('accent', !!c && c.since < 0.1 && c.beat === 0 && ms.beats > 1);
      $('.hd-live', m).textContent = ms.running ? String(ms.bpm) : '';
      m.setAttribute('aria-label', ms.running ? `Metronome, ${ms.bpm} bpm` : 'Metronome');
    }
    const tn = document.getElementById('today-tuner');
    if (tn) {
      const last = ts.running ? tuner.last : null;
      const note = last && performance.now() - last.at < HOLD_MS ? last : null;
      const off = note ? Math.abs(note.cents) : 0;
      const name = note ? writtenName(note.midi, store.state.settings.view) : '';
      tn.classList.toggle('live', ts.running);
      tn.classList.toggle('good', !!note && off <= 5);
      // Off pitch: an arc on the top half if sharp, the bottom half if flat; orange when close.
      tn.classList.toggle('sharp', !!note && off > 5 && note.cents > 0);
      tn.classList.toggle('flat', !!note && off > 5 && note.cents < 0);
      tn.classList.toggle('near', !!note && off > 5 && off <= 15);
      $('.hd-live', tn).textContent = ts.running ? name || '–' : '';
      tn.setAttribute('aria-label', !ts.running ? 'Tuner' : !note ? 'Tuner, listening'
        : off <= 5 ? `Tuner: ${name}, in tune` : `Tuner: ${name}, ${Math.round(off)} cents ${note.cents > 0 ? 'sharp' : 'flat'}`);
    }
    if ((ms.running || ts.running) && (m || tn)) liveRaf = requestAnimationFrame(tick);
  };
  tick();
}
metronome.subscribe(() => liveTools());
tuner.subscribe(() => liveTools());

// Swap (for another pick, warm-up or focus item) or take out an unplayed item of today's set —
// from its card (swipe left) or its details (⋯).
  // Take it out of today's set: a focus item for today, a warm-up, or a pick (not suggested again today).
export function removeFromToday(item: PlanItem): void {
  const state = store.state;
  const i = state.plan!.items.indexOf(item); // (the item is from today's set)
  const name = () => itemById(item.itemId)!.name;
  if (i < 0 || isPlanItemPlayed(item)) return;
  const msg = item.warmup ? `Took out the ${name()} warm-up` : `Took ${name()} out of today’s set`;
  withUndo(msg, () => {
    if (item.bucket === 'focus') state.plan!.focusSkipped.push(item.itemId);
    else if (!item.warmup) state.plan!.skipped.push(item.itemId);
    state.plan!.items.splice(i, 1);
    dropOrphanWarmups(); // a tune's warm-ups go with it
  });
}
export function swapInToday(item: PlanItem): void {
  const state = store.state;
  const i = state.plan!.items.indexOf(item);
  const name = () => itemById(item.itemId)!.name;
  if (i < 0 || isPlanItemPlayed(item)) return;
  if (item.warmup) {
    const was = name();
    if (!swapWarmup(i)) { render(); return toast('No other warm-up for this tune'); }
    save();
    render();
    return toast(`Swapped the ${was} warm-up`);
  }
  const focus = item.bucket === 'focus';
  const was = itemById(item.itemId)!;
  // A focus item swaps for another focus one; anything else, for a pick from its group.
  const t = focus ? pickFocus(was) : pickItem(item.bucket, excludedIds(), itemStats());
  if (!t) {
    render();
    return toast(focus ? `No other focus ${was.type === 'exercise' ? 'exercises' : 'tunes'} to swap in` : item.bucket === 'exercise' ? 'No other exercises to suggest' : 'No other tunes to suggest');
  }
  withUndo(`Swapped out ${name()}`, () => {
    if (focus) state.plan!.focusSkipped.push(item.itemId);
    else state.plan!.skipped.push(item.itemId);
    state.plan!.items[i] = makePlanItem(t, itemStats(), item.bucket);
    dropOrphanWarmups();
  });
}


// A card in today's set: swipe right to mark it played, left to swap or remove it; tap for its
// details. Kept for its plan item (by pid), so its swipe stays attached as the set changes.
@customElement('ws-card')
export class Card extends View {
  @property({ attribute: false }) item!: PlanItem;
  @property({ attribute: false }) stats!: Map<Id, ItemStats>;
  private swiping = false;

  render() {
    const it = this.item;
    const t = itemById(it.itemId);
    if (!t) return nothing; // (deleted: its card is on its way out)
    const s = this.stats.get(t.id);
    const entry = planEntry(it);
    const played = !!entry;
    // The key (or, once played, the rating) beside the ✓; with neither, the name is.
    const chip = played
      ? html`<div class="rating" role="group" aria-label="How did it go?">${RATINGS.map((r) => html`<button class=${entry.rating === r.v ? 'on' : ''} data-v=${r.v} @click=${(e: Event) => this.rate(e, r.v)}>${r.label}</button>`)}</div>`
      : keyChip(it, t);
    const name = html`<h2>${t.name}</h2>`;
    const late = !played && (it.bucket === 'hone' || it.bucket === 'learn') && s?.count && overdue(t, this.stats) >= 1.5;
    return html`
    <li class="card-wrap">
      <div class="swipe-bg" aria-hidden="true">
        <span class="bg-right">${raw(ICON.check)}${played ? 'Unmark' : 'Played'}</span>
      </div>
      ${played ? nothing : html`<div class="swipe-actions">${this.actions().map(([a, fn], n) => html`
        <button class="sa-${a}" data-act=${n} tabindex="-1" @click=${(e: Event) => { e.stopPropagation(); closeSwipes(); fn(); }}>${raw(a === 'swap' ? ICON.swap : ICON.skip)}<span>${a === 'swap' ? 'Swap' : 'Remove'}</span></button>`)}</div>`}
      <article class="card b-${it.bucket} ${played ? 'done' : ''}" data-item-id=${t.id} tabindex="0" @click=${(e: Event) => this.open(e)}>
        <div class="card-top">
          <span class="bucket"><i></i>${it.warmup ? 'Warm-up' : BUCKETS[it.bucket].label}</span>
          <span class="style">${it.warmup ? `for ${itemById(it.warmup)?.name || 'a tune'}` : t.type === 'exercise' ? CATEGORIES[t.category] || '' : t.style}</span>
          ${late ? html`<em class="late">overdue</em>` : nothing}
          ${priBadge(t.priority)}
          <span class="card-tools">${this.noteChip(t)}${this.recChip(t)}${this.tempoChip(tempoSource(t, it))}</span>
        </div>
        ${chip !== nothing ? name : nothing}
        <div class="card-actions">
          ${chip !== nothing ? chip : name}
          <button class="check ${played ? 'on' : ''}" aria-label=${played ? 'Unmark played' : 'Mark played'} aria-pressed=${String(played)} @click=${(e: Event) => { e.stopPropagation(); this.toggle(); }}>${raw(ICON.check)}</button>
        </div>
        ${t.type === 'tune' && !it.warmup && !played && chartFor(t) ? html`<button class="link-btn add-warm" data-add-warm @click=${(e: Event) => { e.stopPropagation(); pickWarmup(t); }}>${raw(ICON.plus)}Warm-up</button>` : nothing}
        ${played ? levelSuggestionPart(levelSuggestion(t), (l) => this.levelUp(t, l)) : nothing}
        ${played && !it.warmup ? tempoSuggestionPart(t, tempoSuggestion(t), render) : nothing}
      </article>
    </li>`;
  }
  updated() {
    const card = this.querySelector<SwipeCard>('.card');
    if (!card) return;
    if (!this.swiping) {
      this.swiping = true;
      // (Once a card's been swiped, the hint about swiping goes. An action that leaves the card —
      // one that couldn't swap — leaves it where it was, not slid away.)
      const swiped = (fn: () => void) => () => { hintDone('swipe'); card.style.transform = ''; card.style.opacity = ''; fn(); };
      attachSwipe(card, () => ({
        right: swiped(() => this.toggle()),
        actions: isPlanItemPlayed(this.item) ? [] : this.actions().map(([, fn]) => swiped(fn)),
      }));
    }
  }
  levelUp(t: Item, l: Level) {
    setLevel(t, l);
    save();
    render();
    toast(`${t.name} is now ${LEVELS[t.level].label}`);
  }

  // What a left swipe offers, the same on every card: Swap, and Remove (for today) at the edge,
  // which a long swipe does. (A focus item swaps for another focus one.)
  actions(): ['swap' | 'remove', () => void][] {
    return [['swap', () => swapInToday(this.item)], ['remove', () => removeFromToday(this.item)]];
  }
  toggle() {
    const item = this.item;
    if (isPlanItemPlayed(item)) unmarkPlayed(item.itemId, item);
    else {
      markPlayed(item.itemId, item);
      autoStart();
      haptic();
      if (store.state.plan!.items.every((it) => !itemById(it.itemId) || isPlanItemPlayed(it))) toast('All done for today — nice work 🎷');
    }
    save();
    render();
  }
  rate(e: Event, r: Rating) {
    e.stopPropagation();
    rate(this.item.itemId, r, this.item);
    save();
    render();
  }
  open(e: Event) {
    const card = e.currentTarget as SwipeCard;
    if (card._swiped || (e.target as Element).closest('.rating, .suggest, .tempo-chip, .add-warm')) return;
    openItem(this.item.itemId, { keys: this.item.keys, pid: this.item.pid });
  }
  // A note on it: today's count, and a tap to write one.
  noteChip(t: Item) {
    const n = entriesFor(t.id).filter((e) => e.date === dateStr() && !e.media?.length).length;
    return html`<button class="note-chip ${n ? '' : 'empty'}" aria-label="Note on ${t.name}${n ? ` (${n} today)` : ''}" @click=${(e: Event) => { e.stopPropagation(); openNote(null, { itemId: t.id }); }}>${raw(ICON.note)}${n ? html`<span>${n}</span>` : nothing}</button>`;
  }
  // Record a take of it; shows how many were recorded today.
  recChip(t: Item) {
    if (!canRecord()) return nothing;
    const n = entriesFor(t.id).filter((e) => e.date === dateStr() && e.media?.length).length;
    return html`<button class="rec-chip ${n ? '' : 'empty'}" aria-label="Record ${t.name}${n ? ` (${n} today)` : ''}" @click=${(e: Event) => { e.stopPropagation(); this.record(t); }}>${raw(ICON.rec)}${n ? html`<span>${n}</span>` : nothing}</button>`;
  }
  record(t: Item) {
    const item = this.item;
    const text = t.type === 'exercise'
      ? takeLabel(t, item.keys || [], item.types || null, item.prog || null, tempoSource(t, item).tempo)
      : [item.key != null && `In ${kn(item.key)}`, t.tempo && `${t.tempo} bpm`].filter(Boolean).join(' · ');
    openRecorder({ itemId: t.id, text, back: render });
  }
  // Its tempo (a warm-up's is its tune's), opening the metronome.
  tempoChip(t: Item) {
    const open = (e: Event) => { e.stopPropagation(); openMetronome({ itemId: t.id }); };
    return t.tempo
      ? html`<button class="tempo-chip" aria-label="Tempo ${t.tempo} bpm, open metronome" @click=${open}>${raw(ICON.quarter)}<span>${t.tempo}</span></button>`
      : html`<button class="tempo-chip empty" aria-label="Set a tempo" @click=${open}>${raw(ICON.metro)}</button>`;
  }
}

function keyChip(it: PlanItem, t: Item): TemplateResult | typeof nothing {
  const chip = (cls: string, main: TemplateResult, sub?: string) => html`<div class="keychip ${cls}">${raw(ICON.key)}<div class="kc-text"><span>${main}</span>${sub ? html`<small>${sub}</small>` : nothing}</div></div>`;
  if (t.type === 'exercise') {
    if (!it.keys?.length && !it.types?.length) return nothing;
    // (An exercise's set item has its keys, see makePlanItem.)
    if (it.form) return chip('multi', html`Through the form in <b>${kn(it.overKey ?? it.keys![0])}</b>`, 'with its chords and a bass');
    if (it.prog) return chip('multi', html`<b>${it.prog.name}</b> in <b>${rootName(it.keys![0])}</b>`, 'tap for notation');
    // A lick or pattern over part of a progression (in a key, or a sequence of keys), or over one chord.
    if (it.over && it.overKey != null) {
      const seq = it.keys!.length > 1 ? `played in ${it.keys!.map(rootName).join(', then ')}` : 'tap for notation';
      return chip('multi', html`Over <b>${it.over}</b> in <b>${kn(it.overKey)}</b>`, seq);
    }
    if (it.over) return chip('multi', html`Over <b>${it.over}</b>`, `in ${rootName(it.keys![0])}`);
    // The whole list matters here, so it wraps (between keys) rather than being cut off.
    const what = exerciseKeysText(it.keys!, t, it.types).split(' · ');
    return chip('multi', html`${it.keys?.length ? 'In ' : ''}${what.map((w, i) => html`${i ? ' · ' : ''}<b>${w}</b>`)}`, t.abc || t.vary ? 'tap for notation' : '');
  }
  if (it.alt) {
    if (it.key == null) return chip('alt', html`Transpose it <b>${SHIFTS[it.shift!]}</b>`);
    return chip('alt', html`Try it in <b>${kn(it.key)}</b>`, `usually ${keysText(t)}`);
  }
  if (it.key == null) return nothing;
  const others = t.keys.filter((k) => k !== it.key);
  return chip('', html`Key of <b>${kn(it.key)}</b>`, others.length ? `also ${others.map(kn).join(', ')}` : '');
}

// The practice timer: start, end (with undo), and after the app was closed a while, the choice
// to count the time away too. It ticks while running.
@customElement('ws-timer')
export class Timer extends View {
  private clock: ReturnType<typeof setInterval> | undefined;
  connectedCallback() {
    super.connectedCallback();
    this.clock = setInterval(() => { if (running()) this.requestUpdate(); }, 1000);
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this.clock);
  }
  render() {
    const total = practicedMs();
    const bar = (cls: string, text: TemplateResult, buttons: TemplateResult) => html`<div class="ptimer ${cls}"><span class="pt-text">${text}</span><span class="pt-btns">${buttons}</span></div>`;
    const start = (label: string, aria?: string) => html`<button class="pill-btn" id="pt-start" aria-label=${aria ?? nothing} @click=${() => { startPractice(); render(); }}>${raw(ICON.play)}${label}</button>`;
    if (running()) {
      return bar('on', html`<span class="pt-dot" aria-hidden="true"></span>Practicing · <b id="pt-clock">${fmtClock(total)}</b> today`,
        html`<button class="pill-btn" id="pt-end" aria-label="End practice" @click=${() => withUndo(`Practice ended · ${fmtDuration(practicedMs())} today`, () => endPractice())}>${raw(ICON.stop)}End</button>`);
    }
    const away = awayStop();
    if (away) {
      const at = new Date(away.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return bar('', html`<b>${fmtDuration(total)}</b> today. The timer stopped at ${at}, when the app was closed.`,
        html`<button class="pill-btn" id="pt-away" @click=${() => { countTimeAway(); render(); }}>${raw(ICON.plus)}Count since then</button>${start('Start again')}`);
    }
    if (total) return bar('', html`Practiced <b>${fmtDuration(total)}</b> today`, start('Resume'));
    return bar('', html`Practice timer`, start('Start', 'Start practice'));
  }
}

function dayNote() {
  const s = store.state.settings;
  const plan = store.state.plan!; // (the screen made it)
  if (s.exerciseFocus === 'day' && plan.dayKeys?.length) {
    return html`<div class="tt-sub eyebrow-row"><p class="day-note">Key${plan.dayKeys.length > 1 ? 's' : ''} of the day: <b>${plan.dayKeys.map((r) => rootName(r)).join(' · ')}</b></p></div>`;
  }
  return nothing;
}

function progressRing(done: number, total: number) {
  const R = 19, C = 2 * Math.PI * R;
  const frac = total ? done / total : 0;
  const complete = total > 0 && done === total;
  return html`<div class="ring ${complete ? 'complete' : ''}" role="img" aria-label="${done} of ${total} played">
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <circle class="ring-track" cx="22" cy="22" r=${R}/>
      <circle class="ring-fill" cx="22" cy="22" r=${R} stroke-dasharray=${C} stroke-dashoffset=${C * (1 - frac)}/>
    </svg>
    <span>${complete ? raw(ICON.check) : html`${done}<small>/${total}</small>`}</span>
  </div>`;
}

// First run: which instruments you play (keys are shown for them).
function welcome() {
  const s = store.state.settings;
  const pick = (id: Transposition) => {
    if (s.instruments.includes(id)) {
      if (s.instruments.length === 1) return;
      s.instruments = s.instruments.filter((x) => x !== id);
      if (s.view === id) s.view = s.instruments[0];
    } else {
      s.instruments = [...s.instruments, id];
      s.view = id; // show keys for the instrument just picked
    }
    save();
    render();
  };
  return html`
    <div class="welcome">
      <h2>What do you play?</h2>
      <p>Keys will be shown for your instrument. Pick more than one to switch between them.</p>
      <div class="chips">${(Object.entries(TRANSPOSITIONS) as [Transposition, (typeof TRANSPOSITIONS)[Transposition]][]).map(([id, tr]) => html`<button class="chip ${s.instruments.includes(id) ? 'on' : ''}" data-ins=${id} @click=${() => pick(id)}>${tr.label}</button>`)}</div>
      <p>${Object.values(TRANSPOSITIONS).map((tr, i) => html`${i ? html`<br>` : nothing}<b>${tr.label}</b>: ${tr.hint}`)}</p>
      <button class="primary-btn" id="ins-done" @click=${() => { s.instrumentsChosen = true; greeted(); render(); window.scrollTo(0, 0); }}>Done</button>
    </div>`;
}
