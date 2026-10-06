import { store, save } from '../store.js';
import { LEVELS, PRIORITIES, TRANSPOSITIONS } from '../constants.js';
import { keyName } from '../keys.js';
import { esc, clone } from '../util.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- UI state (per device, not part of the backed-up data) ----------

const UI_KEY = 'woodshed.ui';
export const ui = { tab: 'today', query: '', filter: 'all', sort: 'priority' };
try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch {}
export function saveUi() {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ tab: ui.tab, filter: ui.filter, exFilter: ui.exFilter, sort: ui.sort, library: ui.library })); } catch {}
}

// ---------- Rendering ----------

let views = {};
export function registerViews(v) {
  views = v;
}
export function render() {
  const root = $('#view');
  const y = window.scrollY;
  const same = root.dataset.tab === ui.tab;
  root.dataset.tab = ui.tab;
  (views[ui.tab] || views.today)(root);
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  window.scrollTo(0, same ? y : 0);
}
export function goTo(tab) {
  ui.tab = tab;
  saveUi();
  closeSheet();
  $('#toast').classList.remove('show');
  render();
}

// ---------- Toast + undo ----------

let toastTimer;
export function toast(msg, action) {
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
export function withUndo(msg, fn) {
  const snapshot = clone(store.state);
  fn();
  save();
  render();
  toast(msg, {
    label: 'Undo',
    fn: () => {
      store.state = snapshot;
      save();
      render();
    },
  });
}
export function haptic() {
  navigator.vibrate?.(12);
}

// ---------- Small view helpers ----------

export const ICON = {
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  swap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.5c2 0 3.2.9 4.3 2.6l2.4 4.8c1.1 1.7 2.3 2.6 4.3 2.6H21M3 17h3.5c1.4 0 2.4-.5 3.3-1.4M14.2 8.4c.9-.9 1.9-1.4 3.3-1.4H21M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  focus: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/></svg>',
};

// A concert key named for the transposition currently shown.
export const kn = (k) => keyName(k, store.state.settings.view);
export const keysText = (t) => t.keys.map(kn).join(' / ');
export const levelLabel = (l) => (l == null ? 'Not rated' : LEVELS[l].label);

export function pips(level) {
  const n = level == null ? -1 : level;
  return `<span class="pips" aria-label="${esc(levelLabel(level))}">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
}
export function priBadge(p) {
  return `<span class="pri p${p}" title="${PRIORITIES[p - 1].label} priority">P${p}</span>`;
}

export function transposeToggle() {
  const s = store.state.settings;
  const cur = TRANSPOSITIONS[s.view];
  const multi = s.instruments.length > 1;
  return `<button class="transpose ${multi ? '' : 'solo'}" id="transpose" aria-label="Keys shown for ${esc(cur.label)} instruments${multi ? '. Tap to switch' : ''}">
    <span>Keys in</span><b>${esc(cur.label)}</b>${multi ? ICON.swap : ''}</button>`;
}
export function bindTransposeToggle(root) {
  const b = $('#transpose', root);
  if (!b) return;
  b.onclick = () => {
    const s = store.state.settings;
    if (s.instruments.length < 2) return goTo('settings');
    s.view = s.instruments[(s.instruments.indexOf(s.view) + 1) % s.instruments.length];
    save();
    render();
  };
}

// ---------- Bottom sheet ----------

let sheetClose = null;
export function openSheet(html, onClose) {
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
export function closeSheet() {
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

// ---------- Swipeable cards ----------

export function attachSwipe(card, { right, left }) {
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

// Banner suggesting a level change, shown on played cards and in the detail sheet.
export function suggestionHtml(t, sug) {
  if (!sug) return '';
  return `<div class="suggest ${sug.up ? 'up' : 'down'}"><span>${esc(sug.text)}</span>
    <button class="pill-btn" data-level="${sug.to}">${sug.up ? '↑' : '↓'} ${esc(LEVELS[sug.to].label)}</button></div>`;
}

Object.assign(ICON, {
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v16l-5-3.5L7 20z"/></svg>',
  teacher: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3.5V16H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 7.5 12 3.5l4 4M6 11v8a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-8"/></svg>',
  rec: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/></svg>',
  video: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6.5" width="13" height="11" rx="2"/><path d="m16 10.5 5-3v9l-5-3"/></svg>',
  quarter: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="10" cy="18" rx="4.2" ry="3.1" transform="rotate(-20 10 18)" fill="currentColor" stroke="none"/><path d="M13.9 17V4"/></svg>',
  metro: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3h5l4 18h-13zM12 15l5-9M7.5 15h9"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9 10h6M9 14h6M9 18h3"/></svg>',
});
