import { store, save } from '../store.js';
import { BUCKETS, RATINGS, SHIFTS, LEVELS, TRANSPOSITIONS } from '../constants.js';
import { dateStr, niceDate, ago } from '../dates.js';
import { esc, randomOf } from '../util.js';
import {
  itemStats, itemById, planEntry, isPlanItemPlayed, markPlayed, unmarkPlayed, rate, setLevel,
  levelSuggestion, overdue,
} from '../practice.js';
import { ensurePlan, buildPlan, pickItem, makePlanItem, excludedIds, applyExerciseFocus, swapWarmup, dropOrphanWarmups } from '../plan.js';
import {
  $, $$, ICON, render, toast, withUndo, haptic, attachSwipe, pips, priBadge, kn, keysText,
  levelLabel, transposeToggle, bindTransposeToggle, suggestionHtml,
} from './shell.js';
import { rowHtml } from './tunes.js';
import { openItem } from './item.js';
import { rememberPanel, bindNotes, openNote } from './diary.js';
import { openRecorder } from './recorder.js';
import { exerciseKeysText, rootName, takeLabel } from './exercise.js';
import { entriesFor } from '../diary.js';
import { openMetronome, tempoChip, tempoSuggestionHtml, bindTempo } from './metronome.js';
import { openTuner } from './tuner.js';
import { tempoSuggestion } from '../tempo.js';
import { openAssistant } from './assistant.js';
import { CATEGORIES } from '../constants.js';
import { canRecord } from '../media.js';
import { greeted } from './greet.js';
import { running, startPractice, endPractice, awayStop, countTimeAway, autoStart, practicedMs, fmtDuration, fmtClock } from '../practicetime.js';

export function renderToday(root) {
  const state = store.state;
  ensurePlan();
  const stats = itemStats();
  const items = state.plan.items.filter((it) => itemById(it.itemId));
  const done = items.filter((it) => isPlanItemPlayed(it)).length;
  const today = dateStr();
  const planIds = new Set(items.map((i) => i.itemId));
  const extras = state.log.filter((e) => e.date === today && !planIds.has(e.itemId)).map((e) => itemById(e.itemId)).filter(Boolean);

  root.innerHTML = `
    <header class="top today-top">
      <div>
        <p class="eyebrow eyebrow-row"><span>${esc(niceDate(today, { weekday: 'short', month: 'short', day: 'numeric' }))}</span>${transposeToggle()}</p>
        <h1>Today’s set</h1>
        ${dayNote()}
      </div>
      <div class="top-actions">
        ${progressRing(done, items.length)}
        <button class="icon-btn" id="reshuffle" aria-label="New set (keeps what you've played)">${ICON.shuffle}</button>
      </div>
    </header>
    ${timerHtml()}
    ${state.settings.instrumentsChosen ? '' : welcomeHtml()}
    ${rememberPanel()}
    ${items.length ? '' : '<p class="empty">No tunes yet. Add some on the Tunes tab.</p>'}
    <ul class="cards">${state.plan.items.map((it, i) => cardHtml(it, i, stats)).join('')}</ul>
    <button class="ghost-btn" id="more">${ICON.plus}<span>One more tune</span></button>
    <div class="today-tools">
      <button id="today-ask">${ICON.ask}<span>Ask</span></button>
      <button id="today-note">${ICON.note}<span>Note</span></button>
      ${canRecord() ? `<button id="today-rec">${ICON.rec}<span>Record</span></button>` : ''}
      <button id="today-metro">${ICON.metro}<span>Metronome</span></button>
      <button id="today-tuner">${ICON.tuner}<span>Tuner</span></button>
    </div>
    ${extras.length ? `
      <h3 class="section-label">Also played today</h3>
      <ul class="list">${extras.map((t) => rowHtml(t, stats)).join('')}</ul>` : ''}
    <p class="hint">Swipe a card right when you’ve played it, left for a different one. Tap for details.</p>
  `;

  bindTransposeToggle(root);
  bindWelcome(root);
  bindTimer(root);
  $('#reshuffle').onclick = () => withUndo('New set picked', () => buildPlan(true));
  $('#more').onclick = () => {
    const t = pickItem(randomOf(['fresh', 'learn', 'hone']), excludedIds(), stats);
    if (!t) return toast('No more tunes to suggest');
    state.plan.items.push(makePlanItem(t, stats));
    prepTunes();
    save();
    render();
  };
  $('#today-note').onclick = () => openNote(null);
  $('#today-metro').onclick = () => openMetronome();
  $('#today-tuner').onclick = () => openTuner();
  $('#today-ask').onclick = () => openAssistant();
  const rec = $('#today-rec', root);
  if (rec) rec.onclick = () => openRecorder();
  bindNotes(root);
  $$('.list .row', root).forEach((row) => (row.onclick = () => openItem(row.dataset.id)));
  $$('.card', root).forEach((card) => bindCard(card));
}

// After tunes come or go: warm-ups for a tune that's gone go with it, and in "Before tunes" a tune
// added (or swapped in) gets its own.
function prepTunes() {
  dropOrphanWarmups(store.state.plan);
  if (store.state.settings.exerciseFocus === 'tunes') applyExerciseFocus(store.state.plan);
}

function bindCard(card) {
  const state = store.state;
  const i = Number(card.dataset.i);
  const item = state.plan.items[i];
  const toggle = () => {
    if (isPlanItemPlayed(item)) unmarkPlayed(item.itemId, item);
    else {
      markPlayed(item.itemId, item);
      autoStart();
      haptic();
      if (state.plan.items.every((it) => !itemById(it.itemId) || isPlanItemPlayed(it))) toast('All done for today — nice work 🎷');
    }
    save();
    render();
  };
  const name = () => itemById(item.itemId).name;
  // Take it out of today's set: a focus item for today, a warm-up, or a pick (not suggested again today).
  const skip = () => {
    if (isPlanItemPlayed(item)) return;
    const msg = item.warmup ? `Took out the ${name()} warm-up` : `Took ${name()} out of today’s set`;
    withUndo(msg, () => {
      if (item.bucket === 'focus') state.plan.focusSkipped.push(item.itemId);
      else if (!item.warmup) state.plan.skipped.push(item.itemId);
      state.plan.items.splice(i, 1);
      prepTunes(); // a tune's warm-ups go with it
    });
  };
  const swap = () => {
    if (isPlanItemPlayed(item)) return;
    if (item.warmup) {
      const was = name();
      if (!swapWarmup(i)) { render(); return toast('No other warm-up for this tune'); }
      save();
      render();
      return toast(`Swapped the ${was} warm-up`);
    }
    const t = pickItem(item.bucket, excludedIds(), itemStats());
    if (!t) { render(); return toast(item.bucket === 'exercise' ? 'No other exercises to suggest' : 'No other tunes to suggest'); }
    withUndo(`Swapped out ${name()}`, () => {
      state.plan.skipped.push(item.itemId);
      state.plan.items[i] = makePlanItem(t, itemStats(), item.bucket);
      prepTunes();
    });
  };
  $('.check', card).onclick = (e) => { e.stopPropagation(); toggle(); };
  const swapBtn = $('.swap', card);
  if (swapBtn) swapBtn.onclick = (e) => { e.stopPropagation(); (item.bucket === 'focus' ? skip : swap)(); };
  $$('.rating button', card).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    rate(item.itemId, b.dataset.v, item);
    save();
    render();
  }));
  const sug = $('.suggest [data-level]', card);
  if (sug) sug.onclick = (e) => {
    e.stopPropagation();
    const t = itemById(item.itemId);
    setLevel(t, Number(sug.dataset.level));
    save();
    render();
    toast(`${t.name} is now ${LEVELS[t.level].label}`);
  };
  bindTempo(card, { onChange: render });
  const recBtn = $('.rec-chip', card);
  if (recBtn) recBtn.onclick = (e) => {
    e.stopPropagation();
    const t = itemById(item.itemId);
    const text = t.type === 'exercise'
      ? takeLabel(t, item.keys || [], item.types || null, item.prog || null)
      : [item.key != null && `In ${kn(item.key)}`, t.tempo && `${t.tempo} bpm`].filter(Boolean).join(' · ');
    openRecorder({ itemId: t.id, text, back: render });
  };
  card.onclick = (e) => { if (!card._swiped && !e.target.closest('.rating, .suggest, .tempo-chip')) openItem(item.itemId, { keys: item.keys, pid: item.pid }); };
  attachSwipe(card, {
    right: toggle,
    actions: isPlanItemPlayed(item) ? [] : leftActions(item).map((a) => (a === 'swap' ? swap : skip)),
  });
}

function keyChip(it, t) {
  const chip = (cls, main, sub) => `<div class="keychip ${cls}">${ICON.key}<div class="kc-text"><span>${main}</span>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
  if (t.type === 'exercise') {
    if (!it.keys?.length && !it.types?.length) return '';
    if (it.prog) return chip('multi', `<b>${esc(it.prog.name)}</b> in <b>${esc(rootName(it.keys[0]))}</b>`, 'tap for notation');
    const what = esc(exerciseKeysText(it.keys, t, it.types)).replaceAll(' · ', '</b> · <b>');
    // The whole list matters here, so it wraps (between keys) rather than being cut off.
    return chip('multi', `${it.keys?.length ? 'In ' : ''}<b>${what}</b>`, t.abc || t.vary ? 'tap for notation' : '');
  }
  if (it.alt) {
    if (it.key == null) return chip('alt', `Transpose it <b>${SHIFTS[it.shift]}</b>`);
    return chip('alt', `Try it in <b>${kn(it.key)}</b>`, `usually ${esc(keysText(t))}`);
  }
  if (it.key == null) return '';
  const others = t.keys.filter((k) => k !== it.key);
  return chip('', `Key of <b>${kn(it.key)}</b>`, others.length ? `also ${others.map(kn).join(', ')}` : '');
}

// What ties today's exercises together (Settings → Exercises), if anything.
// The practice timer: start, end (with undo), and after the app was closed a while, the choice
// to count the time away too.
function timerHtml() {
  const total = practicedMs();
  const bar = (cls, text, buttons) => `<div class="ptimer ${cls}"><span class="pt-text">${text}</span><span class="pt-btns">${buttons}</span></div>`;
  if (running()) {
    return bar('on', `<span class="pt-dot" aria-hidden="true"></span>Practicing · <b id="pt-clock">${fmtClock(total)}</b> today`,
      `<button class="pill-btn" id="pt-end">${ICON.stop}End practice</button>`);
  }
  const away = awayStop();
  if (away) {
    const at = new Date(away.end).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return bar('', `<b>${fmtDuration(total)}</b> today. The timer stopped at ${esc(at)}, when the app was closed.`,
      `<button class="pill-btn" id="pt-away">${ICON.plus}Count since then</button><button class="pill-btn" id="pt-start">${ICON.play}Start again</button>`);
  }
  if (total) return bar('', `Practiced <b>${fmtDuration(total)}</b> today`, `<button class="pill-btn" id="pt-start">${ICON.play}Resume</button>`);
  return bar('', 'Practice timer', `<button class="pill-btn" id="pt-start">${ICON.play}Start practice</button>`);
}

let clock = null;
function bindTimer(root) {
  const start = $('#pt-start', root);
  if (start) start.onclick = () => { startPractice(); render(); };
  const away = $('#pt-away', root);
  if (away) away.onclick = () => { countTimeAway(); render(); };
  const end = $('#pt-end', root);
  if (end) end.onclick = () => withUndo(`Practice ended · ${fmtDuration(practicedMs())} today`, () => endPractice());
  clearInterval(clock);
  if (running()) {
    clock = setInterval(() => {
      const el = document.getElementById('pt-clock');
      if (!el || !running()) return clearInterval(clock);
      el.textContent = fmtClock(practicedMs());
    }, 1000);
  }
}

function dayNote() {
  const s = store.state.settings;
  const plan = store.state.plan;
  if (s.exerciseFocus === 'day' && plan.dayKeys?.length) {
    return `<p class="day-note">Key${plan.dayKeys.length > 1 ? 's' : ''} of the day: <b>${plan.dayKeys.map((r) => esc(rootName(r))).join(' · ')}</b></p>`;
  }
  if (s.exerciseFocus === 'tunes') {
    const n = new Set(plan.items.filter((it) => it.warmup && itemById(it.warmup)).map((it) => it.warmup)).size;
    if (n) return `<p class="day-note">Each tune comes with warm-ups from its chords, just before it.</p>`;
    return '<p class="day-note">None of today’s tunes has a chord chart, so there are no warm-ups for them.</p>';
  }
  return '';
}

function cardHtml(it, i, stats) {
  const t = itemById(it.itemId);
  if (!t) return '';
  const s = stats.get(t.id);
  const entry = planEntry(it);
  const played = !!entry;
  const late = !played && (it.bucket === 'hone' || it.bucket === 'learn') && s?.count && overdue(t, stats) >= 1.5;
  const focus = it.bucket === 'focus';
  return `
  <li class="card-wrap">
    <div class="swipe-bg" aria-hidden="true">
      <span class="bg-right">${ICON.check}${played ? 'Unmark' : 'Played'}</span>
    </div>
    ${played ? '' : `<div class="swipe-actions">${leftActions(it).map((a, n) => `
      <button class="sa-${a}" data-act="${n}" tabindex="-1">${a === 'swap' ? ICON.swap : ICON.skip}<span>${a === 'swap' ? 'Swap' : 'Remove'}</span></button>`).join('')}</div>`}
    <article class="card b-${it.bucket} ${played ? 'done' : ''}" data-i="${i}" data-item-id="${t.id}" tabindex="0">
      <div class="card-top">
        <span class="bucket"><i></i>${it.warmup ? 'Warm-up' : BUCKETS[it.bucket].label}</span>
        <span class="style">${esc(it.warmup ? `for ${itemById(it.warmup)?.name || 'a tune'}` : t.type === 'exercise' ? CATEGORIES[t.category] || '' : t.style)}</span>
        ${priBadge(t.priority)}
      </div>
      <h2>${esc(t.name)}</h2>
      <div class="card-sub">${pips(t.level)}<span>${esc(levelLabel(t.level))} · ${esc(ago(s?.last))}${s?.count ? ` · ${s.count}×` : ''}${late ? ' · <em>overdue</em>' : ''}</span>${recChip(t)}${tempoChip(t)}</div>
      <div class="card-actions">
        ${keyChip(it, t)}
        ${played ? '' : `<button class="swap icon-btn small" aria-label="${focus ? 'Skip for today' : it.warmup ? 'Swap for another warm-up' : t.type === 'exercise' ? 'Swap for a different exercise' : 'Swap for a different tune'}">${focus ? ICON.skip : ICON.swap}</button>`}
        <button class="check ${played ? 'on' : ''}" aria-label="${played ? 'Unmark played' : 'Mark played'}" aria-pressed="${played}">${ICON.check}</button>
      </div>
      ${played ? `<div class="rating" role="group" aria-label="How did it go?"><span>How did it go?</span>${RATINGS.map((r) => `<button class="${entry.rating === r.v ? 'on' : ''}" data-v="${r.v}">${r.label}</button>`).join('')}</div>` : ''}
      ${played ? suggestionHtml(t, levelSuggestion(t)) : ''}
      ${played ? tempoSuggestionHtml(tempoSuggestion(t)) : ''}
    </article>
  </li>`;
}

// Record a take of it; shows how many were recorded today.
function recChip(t) {
  if (!canRecord()) return '';
  const n = entriesFor(t.id).filter((e) => e.date === dateStr() && e.media?.length).length;
  return `<button class="rec-chip ${n ? '' : 'empty'}" aria-label="Record ${esc(t.name)}${n ? ` (${n} today)` : ''}">${ICON.rec}${n ? `<span>${n}</span>` : ''}</button>`;
}

// What a left swipe offers, the same on every card: Swap, and Remove (for today) at the edge, which
// a long swipe does. Focus items are chosen, so they can only be removed for today.
function leftActions(it) {
  return it.bucket === 'focus' ? ['remove'] : ['swap', 'remove'];
}

function progressRing(done, total) {
  const R = 19, C = 2 * Math.PI * R;
  const frac = total ? done / total : 0;
  const complete = total > 0 && done === total;
  return `<div class="ring ${complete ? 'complete' : ''}" role="img" aria-label="${done} of ${total} played">
    <svg viewBox="0 0 44 44" aria-hidden="true">
      <circle class="ring-track" cx="22" cy="22" r="${R}"/>
      <circle class="ring-fill" cx="22" cy="22" r="${R}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - frac)}"/>
    </svg>
    <span>${complete ? ICON.check : `${done}<small>/${total}</small>`}</span>
  </div>`;
}

function welcomeHtml() {
  const s = store.state.settings;
  return `
    <div class="welcome">
      <h2>What do you play?</h2>
      <p>Keys will be shown for your instrument. Pick more than one to switch between them.</p>
      <div class="chips">${Object.entries(TRANSPOSITIONS).map(([id, tr]) => `<button class="chip ${s.instruments.includes(id) ? 'on' : ''}" data-ins="${id}">${esc(tr.label)}</button>`).join('')}</div>
      <p>${Object.values(TRANSPOSITIONS).map((tr) => `<b>${esc(tr.label)}</b>: ${esc(tr.hint)}`).join('<br>')}</p>
      <button class="primary-btn" id="ins-done">Done</button>
    </div>`;
}

function bindWelcome(root) {
  $$('.welcome .chip', root).forEach((c) => (c.onclick = () => {
    const s = store.state.settings;
    const id = c.dataset.ins;
    if (s.instruments.includes(id)) {
      if (s.instruments.length === 1) return;
      s.instruments = s.instruments.filter((x) => x !== id);
      if (s.view === id) s.view = s.instruments[0];
    } else {
      s.instruments = [...s.instruments, id];
      s.view = id; // show keys for the instrument just picked
    }
    c.classList.toggle('on', s.instruments.includes(id));
    save();
  }));
  const done = $('#ins-done', root);
  if (done) done.onclick = () => { store.state.settings.instrumentsChosen = true; greeted(); render(); window.scrollTo(0, 0); };
}
