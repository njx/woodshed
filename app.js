import { SEED_TUNES } from './tunes.js';

// ---------- Constants ----------

const STORE_KEY = 'woodshed.v1';
const UI_KEY = 'woodshed.ui';

const LEVELS = [
  { v: 0, label: "Don't know" },
  { v: 1, label: 'Familiar' },
  { v: 2, label: 'Proficient' },
  { v: 3, label: 'Mastered' },
];
const PRIORITIES = [
  { v: 1, label: 'Critical' },
  { v: 2, label: 'High' },
  { v: 3, label: 'Medium' },
  { v: 4, label: 'Low' },
];
const BUCKETS = {
  hone: { label: 'Hone', fallback: ['learn', 'fresh'] },
  learn: { label: 'Learn', fallback: ['fresh', 'hone'] },
  fresh: { label: 'New', fallback: ['learn', 'hone'] },
};
const PRIORITY_WEIGHTS = {
  off: [1, 1, 1, 1],
  some: [3, 2, 1.4, 1],
  strong: [8, 4, 2, 1],
};

// Keys are stored as concert pitch: 0–11 = C..B major, 12–23 = C..B minor.
const MAJOR = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
const MINOR = ['Cm', 'C♯m', 'Dm', 'E♭m', 'Em', 'Fm', 'F♯m', 'Gm', 'G♯m', 'Am', 'B♭m', 'Bm'];
const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHIFTS = {
  1: 'up a half step', 2: 'up a whole step', 3: 'up a minor 3rd', 4: 'up a major 3rd',
  5: 'up a 4th', 6: 'a tritone away', 7: 'down a 4th', 8: 'down a major 3rd',
  9: 'down a minor 3rd', 10: 'down a whole step', 11: 'down a half step',
};
const TRANSPOSITIONS = {
  c: { label: 'Concert', short: 'C', offset: 0, hint: 'Piano, guitar, bass, flute, vocals' },
  bb: { label: 'B♭', short: 'B♭', offset: 2, hint: 'Tenor & soprano sax, trumpet, clarinet' },
  eb: { label: 'E♭', short: 'E♭', offset: 9, hint: 'Alto & baritone sax' },
  f: { label: 'F', short: 'F', offset: 7, hint: 'French horn' },
};

// Spaced repetition: starting review interval (days) per familiarity level.
const BASE_INTERVAL = { null: 1, 0: 1, 1: 2, 2: 4, 3: 7 };
const MAX_INTERVAL = { null: 14, 0: 14, 1: 30, 2: 45, 3: 90 };
const RATINGS = [
  { v: 'rough', label: 'Rough' },
  { v: 'ok', label: 'OK' },
  { v: 'solid', label: 'Solid' },
];

const DEFAULT_SETTINGS = {
  hone: 2,
  learn: 2,
  fresh: 1,
  priority: 'some',
  newKeys: 'mastered', // 'mastered' | 'proficient' | 'never'
  instruments: ['c'], // transpositions you play, in toggle order
  view: 'c', // transposition keys are currently shown in
};

// ---------- Utilities ----------

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clone = (o) => JSON.parse(JSON.stringify(o));

function dateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}
function ago(last) {
  if (!last) return 'never played';
  const d = daysBetween(last, dateStr());
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.round(d / 7)} weeks ago`;
  return `${Math.round(d / 30)} months ago`;
}
function niceDate(s, opts = { weekday: 'long', month: 'short', day: 'numeric' }) {
  return parseDate(s).toLocaleDateString(undefined, opts);
}
function parseKey(name) {
  const m = /^([A-G])([b#♭♯]?)(m?)$/.exec(name.trim());
  if (!m) return null;
  let root = NOTE_INDEX[m[1]] + (m[2] === 'b' || m[2] === '♭' ? -1 : m[2] ? 1 : 0);
  root = (root + 12) % 12;
  return root + (m[3] ? 12 : 0);
}
function isMinor(k) {
  return k >= 12;
}
// Name of a concert key as written for the current (or given) transposition.
function keyName(k, view = state.settings.view) {
  if (k == null) return '';
  const root = ((k % 12) + TRANSPOSITIONS[view].offset) % 12;
  return isMinor(k) ? MINOR[root] : MAJOR[root];
}
function levelLabel(l) {
  return l == null ? 'Not rated' : LEVELS[l].label;
}
function bucketOf(t) {
  if (t.level >= 2) return 'hone';
  if (t.level === 1) return 'learn';
  return 'fresh';
}
function weightedPick(items, weightFn) {
  const weights = items.map(weightFn);
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return null;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
function randomOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- State ----------

function seedState() {
  return {
    version: 1,
    tunes: SEED_TUNES.map((t) => ({
      id: uid(),
      name: t.name,
      style: t.style,
      priority: t.priority,
      level: t.level ?? null,
      keys: (t.keys || []).map(parseKey).filter((k) => k != null),
      notes: t.notes || '',
      mine: !!t.mine,
      ivl: null, // current review interval in days
      due: null, // next review date
    })),
    log: [],
    plan: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}

function normalize(s) {
  s.settings = { ...DEFAULT_SETTINGS, ...s.settings };
  if (!s.settings.instruments?.length) s.settings.instruments = ['c'];
  if (!s.settings.instruments.includes(s.settings.view)) s.settings.view = s.settings.instruments[0];
  for (const t of s.tunes) if (!Array.isArray(t.keys)) t.keys = [];
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn('Could not load saved data', e);
  }
  return seedState();
}

let state = loadState();
let ui = { tab: 'today', query: '', filter: 'all', sort: 'priority' };
try { ui = { ...ui, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') }; } catch {}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Could not save — storage is full or blocked');
  }
}
function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ tab: ui.tab, filter: ui.filter, sort: ui.sort })); } catch {}
}

// Ask the browser not to evict our data (matters most on iOS).
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

const tuneById = (id) => state.tunes.find((t) => t.id === id);

function tuneStats() {
  const stats = new Map();
  for (const e of state.log) {
    let s = stats.get(e.tuneId);
    if (!s) stats.set(e.tuneId, (s = { count: 0, last: null, keys: [] }));
    s.count++;
    if (!s.last || e.date > s.last) s.last = e.date;
    if (e.key != null) s.keys.push(e.key);
  }
  return stats;
}

// ---------- Spaced repetition ----------

// How overdue a tune is: 1 = due today, 2 = twice its interval since last played.
function overdue(t, stats) {
  const last = stats.get(t.id)?.last;
  if (!last) return 2;
  const since = daysBetween(last, dateStr());
  if (since <= 0) return 0;
  return since / (t.ivl || BASE_INTERVAL[t.level]);
}

function schedule(t, rating, prev) {
  const base = BASE_INTERVAL[t.level];
  const p = prev.ivl || base;
  let ivl;
  if (rating === 'rough') ivl = 1;
  else if (rating === 'solid') ivl = Math.max(Math.round(base * 1.5), Math.round(p * 2.5));
  else ivl = Math.max(base, Math.round(p * 1.6));
  // The very first time through, don't jump ahead too far.
  if (!prev.ivl && rating !== 'rough') ivl = rating === 'solid' ? Math.round(base * 1.5) : base;
  t.ivl = Math.min(ivl, MAX_INTERVAL[t.level]);
  t.due = addDays(dateStr(), t.ivl);
}

// ---------- Planning ----------

function weightFor(t, stats, bucket) {
  const pw = PRIORITY_WEIGHTS[state.settings.priority] || PRIORITY_WEIGHTS.some;
  let w = pw[(t.priority || 3) - 1];
  const s = stats.get(t.id);
  if (s?.last === dateStr()) return 0;
  if (bucket === 'fresh') {
    // Keep coming back to a new tune you've started, while it's due.
    if (s?.count && overdue(t, stats) >= 1) w *= 4;
    return w;
  }
  const o = overdue(t, stats);
  w *= o < 0.5 ? 0.05 : Math.pow(Math.min(o, 4), 1.5);
  return w;
}

function wantsNewKey(t) {
  const mode = state.settings.newKeys;
  if (mode === 'never') return false;
  return mode === 'proficient' ? t.level >= 2 : t.level === 3;
}

// Prefer whichever candidate key has been practiced least; ties go to the earlier one.
function leastPracticed(candidates, played) {
  let best = [], min = Infinity;
  for (const k of candidates) {
    const n = played.filter((p) => p === k).length;
    if (n < min) { min = n; best = [k]; } else if (n === min) best.push(k);
  }
  return best;
}

function chooseKey(t, stats) {
  const played = stats.get(t.id)?.keys || [];
  if (wantsNewKey(t)) {
    if (!t.keys.length) return { key: null, alt: true, shift: randomOf(Object.keys(SHIFTS).map(Number)) };
    const minor = isMinor(t.keys[0]);
    const others = [...Array(12).keys()].map((r) => r + (minor ? 12 : 0)).filter((k) => !t.keys.includes(k));
    return { key: randomOf(leastPracticed(others, played)), alt: true, shift: null };
  }
  if (!t.keys.length) return { key: null, alt: false, shift: null };
  return { key: leastPracticed(t.keys, played)[0], alt: false, shift: null };
}

function pickTune(bucket, exclude, stats) {
  for (const b of [bucket, ...BUCKETS[bucket].fallback]) {
    const pool = state.tunes.filter((t) => bucketOf(t) === b && !exclude.has(t.id));
    const t = weightedPick(pool, (t) => weightFor(t, stats, b));
    if (t) return t;
  }
  return null;
}

function makeItem(t, stats, bucket = bucketOf(t)) {
  return { tuneId: t.id, bucket, ...chooseKey(t, stats) };
}

function excludedIds() {
  const ex = new Set(state.plan?.skipped || []);
  for (const it of state.plan?.items || []) ex.add(it.tuneId);
  return ex;
}

// keepPlayed: rebuild today's set but keep whatever has already been played.
function buildPlan(keepPlayed = false) {
  const stats = tuneStats();
  const today = dateStr();
  const prev = keepPlayed && state.plan?.date === today ? state.plan : null;
  const kept = prev ? prev.items.filter((it) => isPlayedToday(it.tuneId)) : [];
  const exclude = new Set(prev ? [...prev.skipped, ...prev.items.map((i) => i.tuneId)] : []);
  const items = [...kept];
  const counts = { hone: 0, learn: 0, fresh: 0 };
  kept.forEach((it) => counts[it.bucket]++);
  for (const b of ['hone', 'learn', 'fresh']) {
    for (let i = counts[b]; i < state.settings[b]; i++) {
      const t = pickTune(b, exclude, stats);
      if (!t) break;
      exclude.add(t.id);
      items.push(makeItem(t, stats));
    }
  }
  const order = { hone: 0, learn: 1, fresh: 2 };
  items.sort((a, b) => order[a.bucket] - order[b.bucket]);
  state.plan = { date: today, items, skipped: prev ? [...exclude].filter((id) => !items.some((i) => i.tuneId === id)) : [] };
  save();
}

function ensurePlan() {
  if (!state.plan || state.plan.date !== dateStr()) buildPlan();
}

// ---------- Logging ----------

function todaysEntry(tuneId) {
  const today = dateStr();
  return state.log.find((e) => e.tuneId === tuneId && e.date === today);
}
function isPlayedToday(tuneId) {
  return !!todaysEntry(tuneId);
}
function markPlayed(tuneId, item) {
  if (isPlayedToday(tuneId)) return;
  const t = tuneById(tuneId);
  const entry = {
    id: uid(), date: dateStr(), tuneId, at: Date.now(),
    key: item?.key ?? null, alt: !!item?.alt, shift: item?.shift ?? null,
    rating: 'ok', prev: { ivl: t.ivl, due: t.due },
  };
  state.log.push(entry);
  schedule(t, entry.rating, entry.prev);
}
function rate(tuneId, rating) {
  const e = todaysEntry(tuneId);
  const t = tuneById(tuneId);
  if (!e || !t) return;
  e.rating = rating;
  schedule(t, rating, e.prev);
}
function unmarkPlayed(tuneId) {
  const e = todaysEntry(tuneId);
  if (!e) return;
  const t = tuneById(tuneId);
  if (t && e.prev) { t.ivl = e.prev.ivl; t.due = e.prev.due; }
  state.log = state.log.filter((x) => x !== e);
}
// Change a tune's familiarity. Ratings logged before the change no longer count toward
// level suggestions, and a tune played today is rescheduled for its new level.
function setLevel(t, level) {
  if (t.level === level) return;
  t.level = level;
  t.levelSetAt = Date.now();
  const e = todaysEntry(t.id);
  if (e) schedule(t, e.rating, e.prev);
}

// Suggest moving up after 3 solid sessions in a row, or down after 2 rough ones,
// counting only sessions since the level was last changed.
const SOLID_TO_LEVEL_UP = 3;
const ROUGH_TO_LEVEL_DOWN = 2;
function levelSuggestion(t) {
  const recent = state.log
    .filter((e) => e.tuneId === t.id && (e.at || 0) > (t.levelSetAt || 0))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0));
  const streak = (rating, n) => recent.length >= n && recent.slice(0, n).every((e) => e.rating === rating);
  if (t.level !== 3 && streak('solid', SOLID_TO_LEVEL_UP)) {
    const to = t.level == null ? 1 : t.level + 1;
    return { to, up: true, text: `${SOLID_TO_LEVEL_UP} solid sessions in a row — ready for ${LEVELS[to].label}?` };
  }
  if (t.level > 0 && streak('rough', ROUGH_TO_LEVEL_DOWN)) {
    const to = t.level - 1;
    return { to, up: false, text: `${ROUGH_TO_LEVEL_DOWN} rough sessions in a row — mark it ${LEVELS[to].label} for now?` };
  }
  return null;
}
function suggestionHtml(t) {
  const sug = levelSuggestion(t);
  if (!sug) return '';
  return `<div class="suggest ${sug.up ? 'up' : 'down'}"><span>${esc(sug.text)}</span>
    <button class="pill-btn" data-level="${sug.to}">${sug.up ? '↑' : '↓'} ${esc(LEVELS[sug.to].label)}</button></div>`;
}

// ---------- Toast ----------

let toastTimer;
function toast(msg, action) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');
  if (action) {
    $('button', el).onclick = () => {
      el.classList.remove('show');
      action.fn();
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 5000 : 2500);
}
function withUndo(msg, fn) {
  const snapshot = clone(state);
  fn();
  save();
  render();
  toast(msg, {
    label: 'Undo',
    fn: () => {
      state = snapshot;
      save();
      render();
    },
  });
}
function haptic() {
  navigator.vibrate?.(12);
}

// ---------- Rendering helpers ----------

function pips(level) {
  const n = level == null ? -1 : level;
  return `<span class="pips" aria-label="${esc(levelLabel(level))}">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
}
function priBadge(p) {
  return `<span class="pri p${p}" title="${PRIORITIES[p - 1].label} priority">P${p}</span>`;
}
function keysText(t) {
  return t.keys.length ? t.keys.map((k) => keyName(k)).join(' / ') : '';
}
function transposeToggle() {
  const ins = state.settings.instruments;
  const cur = TRANSPOSITIONS[state.settings.view];
  return `<button class="transpose ${ins.length > 1 ? '' : 'solo'}" id="transpose" aria-label="Keys shown for ${esc(cur.label)} instruments${ins.length > 1 ? '. Tap to switch' : ''}">
    <span>Keys in</span><b>${esc(cur.label)}</b>${ins.length > 1 ? ICON.swap : ''}</button>`;
}
function bindTransposeToggle(root) {
  const b = $('#transpose', root);
  if (!b) return;
  b.onclick = () => {
    const ins = state.settings.instruments;
    if (ins.length < 2) {
      ui.tab = 'settings';
      saveUi();
      return render();
    }
    state.settings.view = ins[(ins.indexOf(state.settings.view) + 1) % ins.length];
    save();
    render();
  };
}
const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.5c2 0 3.2.9 4.3 2.6l2.4 4.8c1.1 1.7 2.3 2.6 4.3 2.6H21M3 17h3.5c1.4 0 2.4-.5 3.3-1.4M14.2 8.4c.9-.9 1.9-1.4 3.3-1.4H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
};

// ---------- Today view ----------

function renderToday(root) {
  ensurePlan();
  const stats = tuneStats();
  const items = state.plan.items.filter((it) => tuneById(it.tuneId));
  const done = items.filter((it) => isPlayedToday(it.tuneId)).length;
  const today = dateStr();
  const planIds = new Set(items.map((i) => i.tuneId));
  const extras = state.log.filter((e) => e.date === today && !planIds.has(e.tuneId)).map((e) => tuneById(e.tuneId)).filter(Boolean);

  root.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">${esc(niceDate(today))}</p>
        <h1>Today’s set</h1>
      </div>
      <button class="icon-btn" id="reshuffle" aria-label="New set (keeps what you've played)">${ICON.shuffle}</button>
    </header>
    ${state.settings.instrumentsChosen ? '' : `
    <div class="welcome">
      <h2>What do you play?</h2>
      <p>Keys will be shown for your instrument. Pick more than one to switch between them.</p>
      <div class="chips">${Object.entries(TRANSPOSITIONS).map(([id, tr]) => `<button class="chip ${state.settings.instruments.includes(id) ? 'on' : ''}" data-ins="${id}">${esc(tr.label)}</button>`).join('')}</div>
      <p>${Object.values(TRANSPOSITIONS).map((tr) => `<b>${esc(tr.label)}</b>: ${esc(tr.hint)}`).join('<br>')}</p>
      <button class="primary-btn" id="ins-done">Done</button>
    </div>`}
    <div class="progress-row">
      <div class="progress" aria-label="${done} of ${items.length} played">
        <div class="bar"><span style="width:${items.length ? (done / items.length) * 100 : 0}%"></span></div>
        <p>${done === items.length && items.length ? 'All done — nice work 🎷' : `${done} of ${items.length} played`}</p>
      </div>
      ${transposeToggle()}
    </div>
    ${items.length ? '' : '<p class="empty">No tunes yet. Add some on the Tunes tab.</p>'}
    <ul class="cards">${state.plan.items.map((it, i) => cardHtml(it, i, stats)).join('')}</ul>
    <button class="ghost-btn" id="more">${ICON.plus}<span>One more tune</span></button>
    ${extras.length ? `
      <h3 class="section-label">Also played today</h3>
      <ul class="list">${extras.map((t) => rowHtml(t, stats)).join('')}</ul>` : ''}
    <p class="hint">Swipe a card right when you’ve played it, left for a different tune. Tap for details.</p>
  `;

  bindTransposeToggle(root);
  $$('.welcome .chip', root).forEach((c) => (c.onclick = () => {
    const s = state.settings;
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
  const insDone = $('#ins-done', root);
  if (insDone) insDone.onclick = () => { state.settings.instrumentsChosen = true; save(); render(); };
  $('#reshuffle').onclick = () => withUndo('New set picked', () => buildPlan(true));
  $('#more').onclick = () => {
    const t = pickTune(randomOf(['fresh', 'learn', 'hone']), excludedIds(), stats);
    if (!t) return toast('No more tunes to suggest');
    state.plan.items.push(makeItem(t, stats));
    save();
    render();
  };
  $$('.list .row', root).forEach((row) => (row.onclick = () => openTune(row.dataset.id)));

  $$('.card', root).forEach((card) => {
    const i = Number(card.dataset.i);
    const item = state.plan.items[i];
    const toggle = () => {
      if (isPlayedToday(item.tuneId)) unmarkPlayed(item.tuneId);
      else { markPlayed(item.tuneId, item); haptic(); }
      save();
      render();
    };
    const swap = () => {
      if (isPlayedToday(item.tuneId)) return;
      const t = pickTune(item.bucket, excludedIds(), tuneStats());
      if (!t) return toast('No other tunes to suggest');
      withUndo(`Swapped out ${tuneById(item.tuneId).name}`, () => {
        state.plan.skipped.push(item.tuneId);
        state.plan.items[i] = makeItem(t, tuneStats(), item.bucket);
      });
    };
    $('.check', card).onclick = (e) => { e.stopPropagation(); toggle(); };
    const swapBtn = $('.swap', card);
    if (swapBtn) swapBtn.onclick = (e) => { e.stopPropagation(); swap(); };
    $$('.rating button', card).forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      rate(item.tuneId, b.dataset.v);
      save();
      render();
    }));
    $$('[data-level]', card).forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const t = tuneById(item.tuneId);
      setLevel(t, Number(b.dataset.level));
      save();
      render();
      toast(`${t.name}: ${LEVELS[t.level].label}`);
    }));
    card.onclick = (e) => { if (!card._swiped && !e.target.closest('.rating, .levels-row, .suggest')) openTune(item.tuneId); };
    attachSwipe(card, {
      right: toggle,
      left: isPlayedToday(item.tuneId) ? null : swap,
    });
  });
}

function keyChip(it, t) {
  if (it.alt) {
    if (it.key == null) return `<div class="keychip alt">${ICON.key}<span>Transpose it <b>${SHIFTS[it.shift]}</b></span></div>`;
    return `<div class="keychip alt">${ICON.key}<span>Try it in <b>${keyName(it.key)}</b></span><small>usually ${esc(keysText(t))}</small></div>`;
  }
  if (it.key == null) return '';
  const others = t.keys.filter((k) => k !== it.key);
  return `<div class="keychip">${ICON.key}<span>Key of <b>${keyName(it.key)}</b></span>${others.length ? `<small>also ${others.map((k) => keyName(k)).join(', ')}</small>` : ''}</div>`;
}

function cardHtml(it, i, stats) {
  const t = tuneById(it.tuneId);
  if (!t) return '';
  const s = stats.get(t.id);
  const entry = todaysEntry(t.id);
  const played = !!entry;
  const late = !played && it.bucket !== 'fresh' && s?.count && overdue(t, stats) >= 1.5;
  return `
  <li class="card-wrap">
    <div class="swipe-bg" aria-hidden="true">
      <span class="bg-right">${ICON.check}${played ? 'Unmark' : 'Played'}</span>
      <span class="bg-left">Swap${ICON.swap}</span>
    </div>
    <article class="card b-${it.bucket} ${played ? 'done' : ''}" data-i="${i}" tabindex="0">
      <div class="card-top">
        <span class="bucket"><i></i>${BUCKETS[it.bucket].label}</span>
        <span class="style">${esc(t.style)}</span>
        ${priBadge(t.priority)}
      </div>
      <h2>${esc(t.name)}</h2>
      <div class="card-sub">${pips(t.level)}<span>${esc(levelLabel(t.level))} · ${esc(ago(s?.last))}${s?.count ? ` · ${s.count}×` : ''}${late ? ' · <em>overdue</em>' : ''}</span></div>
      ${keyChip(it, t)}
      <div class="card-actions">
        ${played
          ? `<div class="rating" role="group" aria-label="How did it go?">${RATINGS.map((r) => `<button class="${entry.rating === r.v ? 'on' : ''}" data-v="${r.v}">${r.label}</button>`).join('')}</div>`
          : `<button class="swap icon-btn small" aria-label="Swap for a different tune">${ICON.swap}</button>`}
        <button class="check ${played ? 'on' : ''}" aria-label="${played ? 'Unmark played' : 'Mark played'}" aria-pressed="${played}">${ICON.check}</button>
      </div>
      ${played ? `
        ${suggestionHtml(t)}
        <div class="levels-row" role="group" aria-label="How well do you know it now?">
          ${LEVELS.map((l) => `<button class="${t.level === l.v ? 'on' : ''}" data-level="${l.v}" aria-pressed="${t.level === l.v}">${l.label}</button>`).join('')}
        </div>` : ''}
    </article>
  </li>`;
}

function attachSwipe(card, { right, left }) {
  const wrap = card.parentElement;
  const THRESH = 90;
  let sx = 0, sy = 0, dx = 0, active = false, decided = false, horiz = false, pid = null;

  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    sx = e.clientX; sy = e.clientY; dx = 0;
    active = true; decided = false; horiz = false; pid = e.pointerId;
    card._swiped = false;
  });
  card.addEventListener('pointermove', (e) => {
    if (!active) return;
    const mx = e.clientX - sx, my = e.clientY - sy;
    if (!decided) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      decided = true;
      horiz = Math.abs(mx) > Math.abs(my);
      if (!horiz) { active = false; return; }
      card.setPointerCapture(pid);
      card.classList.add('dragging');
    }
    dx = mx;
    if (dx < 0 && !left) dx = dx / 4; // resist when swap isn't allowed
    card.style.transform = `translateX(${dx}px) rotate(${dx / 50}deg)`;
    wrap.dataset.dir = dx > 0 ? 'right' : 'left';
    wrap.style.setProperty('--reveal', Math.min(1, Math.abs(dx) / THRESH));
    wrap.classList.toggle('armed', Math.abs(dx) >= THRESH);
  });
  const end = () => {
    if (!active) return;
    active = false;
    if (!horiz) return;
    card._swiped = true;
    setTimeout(() => (card._swiped = false), 50);
    card.classList.remove('dragging');
    wrap.classList.remove('armed');
    if (dx >= THRESH && right) {
      card.style.transform = '';
      wrap.style.setProperty('--reveal', 0);
      right();
    } else if (dx <= -THRESH && left) {
      card.style.transform = `translateX(${-window.innerWidth}px) rotate(-8deg)`;
      card.style.opacity = '0';
      setTimeout(left, 180);
    } else {
      card.style.transform = '';
      wrap.style.setProperty('--reveal', 0);
    }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

// ---------- Tunes view ----------

function rowHtml(t, stats) {
  const s = stats.get(t.id);
  const keys = keysText(t);
  return `
  <li class="row" data-id="${t.id}" role="button" tabindex="0">
    <div class="row-main">
      <b>${esc(t.name)}${t.mine ? ' <span class="mine">mine</span>' : ''}</b>
      <span class="row-sub">${keys ? `<span class="row-key">${esc(keys)}</span> · ` : ''}${esc(t.style)} · ${esc(ago(s?.last))}${s?.count ? ` · ${s.count}×` : ''}</span>
    </div>
    ${pips(t.level)}
    ${priBadge(t.priority)}
  </li>`;
}

const FILTERS = [
  { id: 'all', label: 'All', fn: () => true },
  { id: 'due', label: 'Due', fn: (t, s) => t.level >= 1 && (!t.due || t.due <= dateStr()) && s.get(t.id)?.last !== dateStr() },
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

function renderTunes(root) {
  root.innerHTML = `
    <header class="top">
      <div>
        <p class="eyebrow">${state.tunes.length} tunes</p>
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
    const stats = tuneStats();
    const q = ui.query.trim().toLowerCase();
    const f = FILTERS.find((x) => x.id === ui.filter) || FILTERS[0];
    const list = state.tunes
      .filter((t) => f.fn(t, stats) && (!q || t.name.toLowerCase().includes(q) || t.style.toLowerCase().includes(q)))
      .sort((a, b) => SORTS[ui.sort].fn(a, b, stats));
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
    if (row) openTune(row.dataset.id);
  };
  $('#add').onclick = () => openTune(null);
}

// ---------- Tune sheet ----------

function openTune(id) {
  const isNew = !id;
  const t = isNew
    ? { id: uid(), name: ui.query.trim(), style: 'Standard', priority: 2, level: 0, keys: [], notes: '', mine: true, ivl: null, due: null }
    : tuneById(id);
  if (!t) return;
  const styles = [...new Set(state.tunes.map((x) => x.style))].sort();
  const view = TRANSPOSITIONS[state.settings.view];
  // Key chips are laid out by written pitch for the current transposition.
  const writtenToConcert = (w) => (w - view.offset + 12) % 12;

  const keyGrid = () => [false, true].map((minor) => `
    <div class="keygrid">${[...Array(12).keys()].map((w) => {
      const k = writtenToConcert(w) + (minor ? 12 : 0);
      const pos = t.keys.indexOf(k);
      return `<button class="${pos >= 0 ? 'on' : ''} ${pos === 0 ? 'primary' : ''}" data-k="${k}" aria-pressed="${pos >= 0}">${keyName(k)}</button>`;
    }).join('')}</div>`).join('');

  const body = () => {
    const s = tuneStats().get(t.id);
    const entries = state.log.filter((e) => e.tuneId === t.id).sort((a, b) => b.date.localeCompare(a.date));
    const played = isPlayedToday(t.id);
    return `
      <input class="title-input" id="f-name" value="${esc(t.name)}" placeholder="Tune name" aria-label="Tune name" ${isNew ? 'autofocus' : ''}>
      <label class="field-label">How well do you know it?</label>
      ${isNew ? '' : suggestionHtml(t)}
      <div class="seg four" data-field="level">${LEVELS.map((l) => `<button class="${t.level === l.v ? 'on' : ''}" data-v="${l.v}">${l.label}</button>`).join('')}</div>
      <label class="field-label">Priority</label>
      <div class="seg four" data-field="priority">${PRIORITIES.map((p) => `<button class="${t.priority === p.v ? 'on' : ''}" data-v="${p.v}">${p.label}</button>`).join('')}</div>
      <div class="field-label row-label"><span>Usual keys</span><small>${esc(view.label)}${view.offset ? '' : ' pitch'} · first = most common</small></div>
      <div id="keygrids">${keyGrid()}</div>
      <label class="field">
        <span class="field-label">Style</span>
        <input id="f-style" list="styles" value="${esc(t.style)}">
        <datalist id="styles">${styles.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>
      </label>
      <label class="field">
        <span class="field-label">Notes</span>
        <textarea id="f-notes" rows="2" placeholder="Recordings, tricky bars, ideas…">${esc(t.notes)}</textarea>
      </label>
      ${isNew ? `<button class="primary-btn" id="save-new">Add tune</button>` : `
        <div class="history">
          <div class="history-head">
            <div><b>${s?.count || 0}×</b> played · last ${esc(ago(s?.last))}${t.due ? `<br><small>Next review ${t.due <= dateStr() ? '<b>due now</b>' : esc(niceDate(t.due, { month: 'short', day: 'numeric' }))}</small>` : ''}</div>
            <button class="pill-btn ${played ? 'on' : ''}" id="log-today">${ICON.check}${played ? 'Played today' : 'Log for today'}</button>
          </div>
          ${entries.length ? `<ul class="history-list">${entries.slice(0, 8).map((e) => `
            <li><span>${esc(niceDate(e.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</span>
            <span>${e.key != null ? esc(keyName(e.key)) : e.shift ? esc(SHIFTS[e.shift]) : ''}${e.alt ? ' <em>new key</em>' : ''}</span>
            <span class="r-${e.rating || 'ok'}">${esc(RATINGS.find((r) => r.v === (e.rating || 'ok')).label)}</span></li>`).join('')}</ul>` : ''}
        </div>
        <button class="danger-btn" id="delete">Delete tune</button>`}
    `;
  };

  const sheet = openSheet(body(), () => { if (!isNew) render(); });
  const commit = () => { if (!isNew) save(); };
  const refresh = () => {
    const y = $('.sheet-body', sheet).scrollTop;
    $('.sheet-body', sheet).innerHTML = body();
    $('.sheet-body', sheet).scrollTop = y;
    bind();
  };
  const bind = () => {
    const sug = $('.suggest [data-level]', sheet);
    if (sug) sug.onclick = () => { setLevel(t, Number(sug.dataset.level)); commit(); refresh(); };
    $('#f-name', sheet).oninput = (e) => { t.name = e.target.value; if (!isNew && t.name.trim()) commit(); };
    $('#f-style', sheet).onchange = (e) => { t.style = e.target.value.trim() || 'Standard'; commit(); };
    $('#f-notes', sheet).oninput = (e) => { t.notes = e.target.value; commit(); };
    $('#keygrids', sheet).onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const k = Number(b.dataset.k);
      t.keys = t.keys.includes(k) ? t.keys.filter((x) => x !== k) : [...t.keys, k];
      $('#keygrids', sheet).innerHTML = keyGrid();
      commit();
    };
    $$('.seg', sheet).forEach((seg) => {
      seg.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (seg.dataset.field === 'level') {
          setLevel(t, Number(b.dataset.v));
          commit();
          return refresh();
        }
        t[seg.dataset.field] = Number(b.dataset.v);
        $$('button', seg).forEach((x) => x.classList.toggle('on', x === b));
        commit();
      };
    });
    if (isNew) {
      $('#save-new', sheet).onclick = () => {
        if (!t.name.trim()) { $('#f-name', sheet).focus(); return toast('Give the tune a name'); }
        t.name = t.name.trim();
        state.tunes.push(t);
        save();
        closeSheet();
        ui.query = '';
        render();
        toast(`Added ${t.name}`);
      };
    } else {
      $('#log-today', sheet).onclick = () => {
        if (isPlayedToday(t.id)) unmarkPlayed(t.id);
        else {
          const item = state.plan?.date === dateStr() && state.plan.items.find((i) => i.tuneId === t.id);
          markPlayed(t.id, item || { key: t.keys[0] ?? null });
          haptic();
        }
        save();
        refresh();
      };
      $('#delete', sheet).onclick = () => {
        if (!confirm(`Delete “${t.name}” and its practice history?`)) return;
        closeSheet();
        withUndo(`Deleted ${t.name}`, () => {
          state.tunes = state.tunes.filter((x) => x.id !== t.id);
          state.log = state.log.filter((e) => e.tuneId !== t.id);
          if (state.plan) state.plan.items = state.plan.items.filter((i) => i.tuneId !== t.id);
        });
      };
    }
  };
  bind();
}

let sheetClose = null;
function openSheet(html, onClose) {
  const root = $('#sheet-root');
  root.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-grab"><span></span></div>
      <div class="sheet-body">${html}</div>
    </section>`;
  const sheet = $('.sheet', root);
  requestAnimationFrame(() => root.classList.add('open'));
  $('.sheet-backdrop', root).onclick = closeSheet;
  sheetClose = onClose;

  // Drag the grab handle down to dismiss.
  const grab = $('.sheet-grab', root);
  let sy = null;
  grab.addEventListener('pointerdown', (e) => { sy = e.clientY; grab.setPointerCapture(e.pointerId); sheet.style.transition = 'none'; });
  grab.addEventListener('pointermove', (e) => { if (sy != null) sheet.style.transform = `translateY(${Math.max(0, e.clientY - sy)}px)`; });
  grab.addEventListener('pointerup', (e) => {
    sheet.style.transition = '';
    if (sy != null && e.clientY - sy > 80) closeSheet();
    else sheet.style.transform = '';
    sy = null;
  });
  return sheet;
}
function closeSheet() {
  const root = $('#sheet-root');
  if (!root.classList.contains('open')) return;
  root.classList.remove('open');
  const sheet = $('.sheet', root);
  if (sheet) sheet.style.transform = '';
  const cb = sheetClose;
  sheetClose = null;
  setTimeout(() => { if (!root.classList.contains('open')) root.innerHTML = ''; }, 250);
  cb?.();
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

// ---------- Progress view ----------

function renderProgress(root) {
  const today = dateStr();
  const stats = tuneStats();
  const perDay = new Map();
  for (const e of state.log) perDay.set(e.date, (perDay.get(e.date) || 0) + 1);

  let streak = 0;
  let d = perDay.has(today) ? today : addDays(today, -1);
  while (perDay.has(d)) { streak++; d = addDays(d, -1); }
  let days30 = 0;
  for (let i = 0; i < 30; i++) if (perDay.has(addDays(today, -i))) days30++;
  const week = new Set();
  for (const e of state.log) if (daysBetween(e.date, today) < 7) week.add(e.tuneId);
  const dueCount = state.tunes.filter((t) => FILTERS[1].fn(t, stats)).length;

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

  const levelCounts = [3, 2, 1, 0, null].map((l) => ({ l, n: state.tunes.filter((t) => (t.level ?? null) === l).length }));
  const maxCount = Math.max(...levelCounts.map((c) => c.n), 1);
  const byDate = [...perDay.keys()].sort().reverse().slice(0, 10);

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
      ${byDate.length ? `<ul class="sessions">${byDate.map((day) => {
        const tunes = state.log.filter((e) => e.date === day).map((e) => tuneById(e.tuneId)?.name).filter(Boolean);
        return `<li><span class="sess-date">${esc(niceDate(day, { weekday: 'short', month: 'short', day: 'numeric' }))}</span><span>${tunes.map(esc).join(', ')}</span></li>`;
      }).join('')}</ul>` : '<p class="empty">Nothing logged yet — play something from Today’s set.</p>'}
    </section>
  `;

  $('#due-tile').onclick = () => { ui.tab = 'tunes'; ui.filter = 'due'; saveUi(); render(); };
  $('.heat', root).onclick = (e) => {
    const c = e.target.closest('.cell');
    if (!c || c.disabled) return;
    $$('.heat .cell', root).forEach((x) => x.classList.toggle('sel', x === c));
    const names = state.log.filter((x) => x.date === c.dataset.d).map((x) => tuneById(x.tuneId)?.name).filter(Boolean);
    $('#heat-readout').textContent = `${niceDate(c.dataset.d, { weekday: 'short', month: 'short', day: 'numeric' })}: ${names.length ? names.join(', ') : 'no practice logged'}`;
  };
}

// ---------- Settings view ----------

function renderSettings(root) {
  const s = state.settings;
  const stepper = (key, label, hint) => `
    <div class="setting">
      <div><b>${label}</b><span>${hint}</span></div>
      <div class="stepper" data-key="${key}">
        <button data-d="-1" aria-label="Fewer">−</button><output>${s[key]}</output><button data-d="1" aria-label="More">+</button>
      </div>
    </div>`;
  const seg = (key, opts) => `<div class="seg" data-setting="${key}">${opts.map(([v, l]) => `<button class="${s[key] === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join('')}</div>`;

  root.innerHTML = `
    <header class="top"><div><p class="eyebrow">Woodshed</p><h1>Settings</h1></div></header>

    <section class="panel">
      <h3 class="section-label">Instruments you play</h3>
      <p class="fine">Keys are shown for these. With more than one, tap <b>Keys in …</b> on the Today screen to switch.</p>
      <ul class="instruments">${Object.entries(TRANSPOSITIONS).map(([id, tr]) => `
        <li><label>
          <input type="checkbox" data-ins="${id}" ${s.instruments.includes(id) ? 'checked' : ''}>
          <span class="ins-name">${esc(tr.label)}${id === 'c' ? '' : ' instruments'}</span>
          <span class="ins-hint">${esc(tr.hint)}</span>
        </label></li>`).join('')}</ul>
    </section>

    <section class="panel">
      <h3 class="section-label">Daily mix</h3>
      ${stepper('hone', 'Hone', 'Proficient & mastered tunes')}
      ${stepper('learn', 'Learn', 'Tunes you’re familiar with')}
      ${stepper('fresh', 'New', 'Tunes you don’t know yet')}
      <p class="fine">Changes apply to tomorrow’s set, or tap <b>Rebuild today’s set</b>.</p>
      <button class="ghost-btn" id="rebuild">${ICON.shuffle}<span>Rebuild today’s set</span></button>
    </section>

    <section class="panel">
      <h3 class="section-label">How much should priority matter?</h3>
      ${seg('priority', [['off', 'Not at all'], ['some', 'Some'], ['strong', 'A lot']])}
      <p class="fine">Tunes are picked mostly by when they’re due for review. Each time you play one and rate it, its next review is pushed further out — “Solid” pushes it further, “Rough” brings it back tomorrow. Priority tips the balance among tunes that are due.</p>
    </section>

    <section class="panel">
      <h3 class="section-label">Practice in other keys for</h3>
      ${seg('newKeys', [['mastered', 'Mastered'], ['proficient', 'Proficient +'], ['never', 'Never']])}
      <p class="fine">Other tunes rotate through their usual keys. Keys you’ve practiced less come up first.</p>
    </section>

    <section class="panel">
      <h3 class="section-label">Your data</h3>
      <p class="fine">Everything is stored on this device only. Export a backup now and then — and before switching phones.</p>
      <div class="btn-row">
        <button class="ghost-btn" id="export">Export backup</button>
        <label class="ghost-btn file-btn">Import backup<input type="file" id="import" accept="application/json,.json"></label>
      </div>
      <button class="danger-btn" id="reset">Reset everything</button>
    </section>
  `;

  $$('[data-ins]', root).forEach((cb) => (cb.onchange = () => {
    const picked = $$('[data-ins]', root).filter((x) => x.checked).map((x) => x.dataset.ins);
    if (!picked.length) { cb.checked = true; return toast('Pick at least one'); }
    s.instruments = picked;
    s.instrumentsChosen = true;
    if (!picked.includes(s.view)) s.view = picked[0];
    save();
  }));
  $$('.stepper', root).forEach((st) => {
    st.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const k = st.dataset.key;
      s[k] = Math.max(0, Math.min(8, s[k] + Number(b.dataset.d)));
      $('output', st).textContent = s[k];
      save();
    };
  });
  $$('.seg[data-setting]', root).forEach((sg) => {
    sg.onclick = (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      s[sg.dataset.setting] = b.dataset.v;
      $$('button', sg).forEach((x) => x.classList.toggle('on', x === b));
      save();
    };
  });
  $('#rebuild').onclick = () => {
    buildPlan(true);
    ui.tab = 'today';
    saveUi();
    render();
    toast('Today’s set rebuilt');
  };
  $('#export').onclick = exportData;
  $('#import').onchange = importData;
  $('#reset').onclick = () => {
    if (!confirm('Erase all practice history and edits, and start over from the original list?')) return;
    if (!confirm('Really? This can’t be undone (unless you have a backup).')) return;
    state = seedState();
    save();
    render();
    toast('Reset to the original list');
  };
}

async function exportData() {
  const json = JSON.stringify({ app: 'woodshed', exported: new Date().toISOString(), ...state }, null, 1);
  const name = `woodshed-backup-${dateStr()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Woodshed backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(e) {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.tunes) || !Array.isArray(data.log)) throw new Error('not a backup');
    if (!confirm(`Replace current data with this backup (${data.tunes.length} tunes, ${data.log.length} log entries)?`)) return;
    state = normalize({ version: 1, tunes: data.tunes, log: data.log, plan: data.plan || null, settings: data.settings });
    save();
    render();
    toast('Backup restored');
  } catch {
    toast('That file doesn’t look like a Woodshed backup');
  }
}

// ---------- App shell ----------

const VIEWS = { today: renderToday, tunes: renderTunes, progress: renderProgress, settings: renderSettings };

function render() {
  const root = $('#view');
  const y = window.scrollY;
  const same = root.dataset.tab === ui.tab;
  root.dataset.tab = ui.tab;
  (VIEWS[ui.tab] || renderToday)(root);
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  window.scrollTo(0, same ? y : 0);
}

$$('.tab').forEach((b) => (b.onclick = () => {
  if (ui.tab === b.dataset.tab) return window.scrollTo({ top: 0, behavior: 'smooth' });
  ui.tab = b.dataset.tab;
  saveUi();
  closeSheet();
  $('#toast').classList.remove('show');
  render();
}));

// Roll over to a new day's set if the app stays open past midnight.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.plan?.date !== dateStr()) render();
});

render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
