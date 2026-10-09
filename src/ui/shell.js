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
  const rev = store.rev;
  toast(msg, {
    label: 'Undo',
    fn: () => {
      if (store.rev !== rev) return toast('Can’t undo — other things have changed since');
      restoreState(snapshot);
    },
  });
}
// Puts back an earlier copy of the state. An open sheet holds objects from the replaced state,
// so it's closed (after the swap, so anything it reopens reads the restored state).
export function restoreState(snapshot) {
  store.state = snapshot;
  save();
  closeSheet();
  render();
}
export function haptic() {
  navigator.vibrate?.(12);
}

// ---------- Small view helpers ----------

export const ICON = {
  tuner: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 16a8 8 0 1 1 15 0"/><path d="M12 16l3.5-6"/><circle cx="12" cy="16" r="1.4"/></svg>',
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
export const levelLabel = (l) => LEVELS[l ?? 0].label;

export function pips(level) {
  const n = level ?? 0;
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
      <div class="sheet-grab"><span></span><button class="sheet-x" aria-label="Close">${ICON.skip}</button></div>
      <div class="sheet-body">${html}</div>
    </section>`;
  const sheet = $('.sheet', root);
  requestAnimationFrame(() => root.classList.add('open'));
  $('.sheet-backdrop', root).onclick = closeSheet;
  $('.sheet-x', root).onclick = closeSheet;
  sheetClose = onClose;
  dragToDismiss(root, sheet);
  return sheet;
}

// Pull a sheet down to close it: by its handle, or from anywhere once it's scrolled to the top
// (not from a text field, slider or sideways swipe). Far enough, or a quick flick, closes it;
// otherwise it springs back. Touch uses touch events (so the page can't take the gesture over
// half way); a mouse can drag the handle.
function dragToDismiss(root, sheet) {
  const grab = $('.sheet-grab', sheet);
  const body = $('.sheet-body', sheet);
  const backdrop = $('.sheet-backdrop', root);
  let start = null; // { x, y, fromGrab, top }
  let dragging = false;
  let samples = []; // recent [t, y], for the flick speed

  const begin = (x, y, target) => {
    if (target.closest('.sheet-x')) return;
    const fromGrab = grab.contains(target);
    if (!fromGrab && target.closest('input, textarea, select, canvas, [contenteditable], .no-sheet-drag')) return;
    start = { x, y, fromGrab, top: body.scrollTop };
    dragging = false;
    samples = [[performance.now(), y]];
  };
  // Returns true while the sheet follows the finger.
  const move = (x, y) => {
    if (!start) return false;
    const dy = y - start.y, dx = x - start.x;
    if (!dragging) {
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return false;
      // Downward, mostly vertical, and from the handle or with the content at its top.
      if (dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.2 && (start.fromGrab || (start.top <= 0 && body.scrollTop <= 0))) {
        dragging = true;
        sheet.style.transition = 'none';
        backdrop.style.transition = 'none';
      } else {
        start = null;
        return false;
      }
    }
    const d = Math.max(0, dy);
    sheet.style.transform = `translateY(${d}px)`;
    backdrop.style.opacity = String(Math.max(0.15, 1 - d / Math.max(300, sheet.offsetHeight)));
    samples.push([performance.now(), y]);
    if (samples.length > 6) samples.shift();
    return true;
  };
  const end = (y, cancelled = false) => {
    if (!start) return;
    const was = dragging;
    const dy = y - start.y;
    start = null;
    dragging = false;
    if (!was) return;
    sheet.style.transition = '';
    backdrop.style.transition = '';
    backdrop.style.opacity = '';
    const [t0, y0] = samples[0];
    const speed = (y - y0) / Math.max(1, performance.now() - t0); // px per ms
    if (!cancelled && (dy > Math.min(140, sheet.offsetHeight * 0.3) || (speed > 0.5 && dy > 30))) closeSheet();
    else sheet.style.transform = '';
  };

  sheet.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) begin(e.touches[0].clientX, e.touches[0].clientY, e.target);
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (move(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault(); // the sheet moves, not the page
  }, { passive: false });
  sheet.addEventListener('touchend', (e) => end(e.changedTouches[0].clientY));
  sheet.addEventListener('touchcancel', (e) => end(e.changedTouches[0]?.clientY ?? 0, true));

  grab.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return; // touch is handled above
    begin(e.clientX, e.clientY, e.target);
    if (start) grab.setPointerCapture(e.pointerId); // not when it's the × (its click would be lost)
  });
  grab.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') move(e.clientX, e.clientY); });
  grab.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') end(e.clientY); });
  grab.addEventListener('pointercancel', (e) => { if (e.pointerType === 'mouse') end(e.clientY, true); });
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

// Swipes on a card in a .card-wrap:
//   right: past the threshold, calls `right` (mark played);
//   left: reveals the card's actions (buttons in its .swipe-actions, edge-most last), like Mail:
//   a short swipe leaves them open to tap, a long one does the edge-most action.
// actions: [fn, …] in the order of the buttons. Tapping the open card (or another) closes it.
const ACTION_W = 78;
let openWrap = null;
export function closeSwipes() {
  if (!openWrap) return;
  const card = openWrap.querySelector('.card');
  card.style.transform = '';
  openWrap.classList.remove('open');
  openWrap.style.setProperty('--pull', '0px');
  openWrap = null;
}
document.addEventListener('pointerdown', (e) => { if (openWrap && !openWrap.contains(e.target)) closeSwipes(); }, true);

export function attachSwipe(card, { right, actions = [] }) {
  const wrap = card.parentElement;
  const THRESH = 90;
  const openW = actions.length * ACTION_W;
  let sx = 0, sy = 0, dx = 0, base = 0, active = false, decided = false, horiz = false, pid = null;
  const full = () => Math.max(openW + 70, card.offsetWidth * 0.6);
  wrap.style.setProperty('--open', `${openW}px`);

  $$('.swipe-actions [data-act]', wrap).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const fn = actions[Number(b.dataset.act)];
    closeSwipes();
    fn?.();
  }));

  card.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    sx = e.clientX; sy = e.clientY; dx = 0;
    base = wrap.classList.contains('open') ? -openW : 0;
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
      if (openWrap && openWrap !== wrap) closeSwipes();
    }
    dx = base + mx;
    if (dx < 0 && !actions.length) dx = dx / 4; // resist when there's nothing to do
    if (dx > 0 && !right) dx = dx / 4;
    card.style.transform = `translateX(${dx}px)${dx > 0 ? ` rotate(${dx / 50}deg)` : ''}`;
    wrap.dataset.dir = dx > 0 ? 'right' : 'left';
    wrap.style.setProperty('--reveal', Math.min(1, Math.abs(dx) / THRESH));
    wrap.style.setProperty('--pull', `${Math.max(0, -dx)}px`);
    wrap.classList.toggle('armed', dx >= THRESH || (actions.length > 0 && -dx >= full()));
  });
  const end = () => {
    if (!active) return;
    active = false;
    if (!horiz) {
      // A tap on an open card closes it rather than opening it.
      if (wrap.classList.contains('open')) { card._swiped = true; setTimeout(() => (card._swiped = false), 50); closeSwipes(); }
      return;
    }
    card._swiped = true;
    setTimeout(() => (card._swiped = false), 50);
    card.classList.remove('dragging');
    wrap.classList.remove('armed');
    if (dx >= THRESH && right) {
      card.style.transform = '';
      wrap.style.setProperty('--reveal', 0);
      right();
    } else if (actions.length && -dx >= full()) {
      // All the way: the edge-most action, the card sliding off.
      wrap.classList.remove('open');
      if (openWrap === wrap) openWrap = null;
      card.style.transform = `translateX(${-window.innerWidth}px)`;
      card.style.opacity = '0';
      setTimeout(actions[actions.length - 1], 180);
    } else if (actions.length && -dx >= openW / 2) {
      card.style.transform = `translateX(${-openW}px)`;
      wrap.style.setProperty('--pull', `${openW}px`);
      wrap.classList.add('open');
      openWrap = wrap;
    } else {
      card.style.transform = '';
      wrap.style.setProperty('--reveal', 0);
      wrap.style.setProperty('--pull', '0px');
      wrap.classList.remove('open');
      if (openWrap === wrap) openWrap = null;
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
  ask: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l1.6 4.2 4.2 1.6-4.2 1.6L12 15.1l-1.6-4.2-4.2-1.6 4.2-1.6zM18.5 14l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8zM6 15.5l.6 1.4 1.4.6-1.4.6L6 19.5l-.6-1.4-1.4-.6 1.4-.6z"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/></svg>',
  metro: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 3h5l4 18h-13zM12 15l5-9M7.5 15h9"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM9 10h6M9 14h6M9 18h3"/></svg>',
});

// Focus / On / Off for a tune or exercise (see plan.js itemStatus), with what it means.
const STATUS_HINTS = {
  focus: 'In your set every day until you change it.',
  on: { tune: 'Picked for your set when it’s due.', exercise: 'Picked for your set now and then, and offered as a warm-up.' },
  off: { tune: 'Left out for now: not picked for your set.', exercise: 'Left out for now: not picked, and not offered as a warm-up.' },
};
export function statusHtml(t, status) {
  const hint = STATUS_HINTS[status];
  return `<div class="seg item-status" id="item-status" role="group" aria-label="In the pool">${[['focus', 'Focus'], ['on', 'On'], ['off', 'Off']].map(([v, l]) => `<button class="${status === v ? 'on' : ''}" data-v="${v}">${v === 'focus' ? ICON.focus : ''}${l}</button>`).join('')}</div>
    <p class="fine" id="item-status-hint">${esc(typeof hint === 'string' ? hint : hint[t.type])}</p>`;
}
