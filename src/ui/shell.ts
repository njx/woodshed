import { store, save } from '../store.js';
import { LEVELS, PRIORITIES, TRANSPOSITIONS } from '../constants.js';
import { keyName } from '../keys.js';
import { esc, clone } from '../util.js';
import type { itemStatus } from '../plan.js';
import type { levelSuggestion } from '../practice.js';
import type { Item, Key, Level, Priority, State } from '../types.js';

// The element a selector finds (taken to be there: check the result where it may not be), and
// all of them.
type Root = Document | Element | DocumentFragment;
export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: Root = document): T => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: Root = document): T[] => [...root.querySelectorAll<T>(sel)];

// What a list given as `[cond && x, …]` can hold besides x (skipped).
type Falsy = false | null | undefined | '' | 0;

// ---------- UI state (per device, not part of the backed-up data) ----------

const UI_KEY = 'woodshed.ui';
export interface UiState {
  tab: string;
  query: string;
  filter: string;
  sort: string;
  exFilter?: string;
  library?: string;
  diaryFilter?: string;
}
export const ui: UiState = { tab: 'today', query: '', filter: 'all', sort: 'priority' };
try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch {}
export function saveUi(): void {
  try { localStorage.setItem(UI_KEY, JSON.stringify({ tab: ui.tab, filter: ui.filter, exFilter: ui.exFilter, sort: ui.sort, library: ui.library })); } catch {}
}

// ---------- Rendering ----------

// A screen: draws itself into the root it's given.
export type View = (root: HTMLElement) => void;
let views: Record<string, View> = {};
export function registerViews(v: Record<string, View>): void {
  views = v;
}
export function render(): void {
  const root = $('#view');
  const y = window.scrollY;
  const same = root.dataset.tab === ui.tab;
  root.dataset.tab = ui.tab;
  (views[ui.tab] || views.today)(root);
  $$('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
  window.scrollTo(0, same ? y : 0);
}
export function goTo(tab: string): void {
  ui.tab = tab;
  saveUi();
  closeSheet();
  $('#toast').classList.remove('show');
  render();
}

// ---------- Toast + undo ----------

// A toast's button (like Undo).
export interface ToastAction { label: string; fn: () => void }
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(msg: string, action?: ToastAction): void {
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
export function withUndo(msg: string, fn: () => void): void {
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
export function restoreState(snapshot: State): void {
  store.state = snapshot;
  save();
  closeSheet();
  render();
}
export function haptic(): void {
  navigator.vibrate?.(12);
}

// ---------- Small view helpers ----------

type IconName = 'tuner' | 'check' | 'swap' | 'shuffle' | 'plus' | 'key' | 'skip' | 'focus' | 'search' | 'play' | 'out'
  | 'pin' | 'teacher' | 'mic' | 'share' | 'rec' | 'video' | 'quarter' | 'ask' | 'send' | 'stop' | 'metro' | 'note';
// (The second lot are added below, as the module loads.)
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
} as Record<IconName, string>;

// A concert key named for the transposition currently shown.
export const kn = (k: Key | null | undefined): string => keyName(k, store.state.settings.view);
export const keysText = (t: { keys: Key[] }): string => t.keys.map(kn).join(' / ');
export const levelLabel = (l: Level | null | undefined): string => LEVELS[l ?? 0].label;

export function pips(level: Level | null | undefined): string {
  const n = level ?? 0;
  return `<span class="pips" aria-label="${esc(levelLabel(level))}">${[1, 2, 3].map((i) => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;
}
// Only for the priorities that stand out (critical, high); medium and low show nothing.
export function priBadge(p: Priority): string {
  return p <= 2 ? `<span class="pri p${p}" title="${PRIORITIES[p - 1].label} priority">P${p}</span>` : '';
}

export function transposeToggle(): string {
  const s = store.state.settings;
  const cur = TRANSPOSITIONS[s.view];
  const multi = s.instruments.length > 1;
  return `<button class="transpose ${multi ? '' : 'solo'}" id="transpose" aria-label="Keys shown for ${esc(cur.label)} instruments${multi ? '. Tap to switch' : ''}">
    <span>Keys in</span><b>${esc(cur.label)}</b>${multi ? ICON.swap : ''}</button>`;
}
export function bindTransposeToggle(root: Root): void {
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

let sheetClose: (() => void) | null | undefined = null;
let sheetGen = 0;
let opening: number | null = null; // the frame a sheet slides in on (closing before it still closes it) // which sheet is current (a closed one's cleanup mustn't clear the next)
// Returns the sheet (its content in .sheet-body).
export function openSheet(html: string, onClose?: () => void): HTMLElement {
  sheetGen++;
  closeMenu();
  const root = $('#sheet-root');
  root.innerHTML = `
    <div class="sheet-backdrop"></div>
    <section class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-grab"><span></span><button class="sheet-x" aria-label="Close">${ICON.skip}</button></div>
      <div class="sheet-body">${html}</div>
    </section>`;
  const sheet = $('.sheet', root);
  if (opening !== null) cancelAnimationFrame(opening);
  opening = requestAnimationFrame(() => { opening = null; root.classList.add('open'); });
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
function dragToDismiss(root: HTMLElement, sheet: HTMLElement): void {
  const grab = $('.sheet-grab', sheet);
  const body = $('.sheet-body', sheet);
  const backdrop = $('.sheet-backdrop', root);
  let start: { x: number; y: number; fromGrab: boolean; top: number } | null = null;
  let dragging = false;
  let samples: [number, number][] = []; // recent [t, y], for the flick speed

  const begin = (x: number, y: number, target: Element) => {
    if (target.closest('.sheet-x')) return;
    const fromGrab = grab.contains(target);
    if (!fromGrab && target.closest('input, textarea, select, canvas, [contenteditable], .no-sheet-drag')) return;
    start = { x, y, fromGrab, top: body.scrollTop };
    dragging = false;
    samples = [[performance.now(), y]];
  };
  // Returns true while the sheet follows the finger.
  const move = (x: number, y: number) => {
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
  const end = (y: number, cancelled = false) => {
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
    if (e.touches.length === 1) begin(e.touches[0].clientX, e.touches[0].clientY, e.target as Element);
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (move(e.touches[0].clientX, e.touches[0].clientY)) e.preventDefault(); // the sheet moves, not the page
  }, { passive: false });
  sheet.addEventListener('touchend', (e) => end(e.changedTouches[0].clientY));
  sheet.addEventListener('touchcancel', (e) => end(e.changedTouches[0]?.clientY ?? 0, true));

  grab.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return; // touch is handled above
    begin(e.clientX, e.clientY, e.target as Element);
    if (start) grab.setPointerCapture(e.pointerId); // not when it's the × (its click would be lost)
  });
  grab.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') move(e.clientX, e.clientY); });
  grab.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') end(e.clientY); });
  grab.addEventListener('pointercancel', (e) => { if (e.pointerType === 'mouse') end(e.clientY, true); });
}
export function closeSheet(): void {
  closeMenu();
  const root = $('#sheet-root');
  if (!root.classList.contains('open') && opening == null) return;
  if (opening !== null) cancelAnimationFrame(opening);
  opening = null;
  root.classList.remove('open');
  const sheet = $('.sheet', root);
  if (sheet) sheet.style.transform = '';
  const cb = sheetClose;
  sheetClose = null;
  // Cleared once it's slid away, unless another sheet has been opened since (even one still
  // getting ready, like the recorder).
  const gen = sheetGen;
  setTimeout(() => { if (gen === sheetGen && !root.classList.contains('open')) root.innerHTML = ''; }, 250);
  cb?.();
}

// ---------- Swipeable cards ----------

// Swipes on a card in a .card-wrap:
//   right: past the threshold, calls `right` (mark played);
//   left: reveals the card's actions (buttons in its .swipe-actions, edge-most last), like Mail:
//   a short swipe leaves them open to tap, a long one does the edge-most action.
// actions: [fn, …] in the order of the buttons. Tapping the open card (or another) closes it.
const ACTION_W = 78;
let openWrap: HTMLElement | null = null;
export function closeSwipes(): void {
  if (!openWrap) return;
  const card = openWrap.querySelector<HTMLElement>('.card')!; // (a .card-wrap holds its card)
  card.style.transform = '';
  openWrap.classList.remove('open');
  openWrap.style.setProperty('--pull', '0px');
  openWrap = null;
}
document.addEventListener('pointerdown', (e) => { if (openWrap && !openWrap.contains(e.target as Node)) closeSwipes(); }, true);

// (_swiped: just swiped, so the click that ends it isn't a tap.)
export type SwipeCard = HTMLElement & { _swiped?: boolean };
export interface SwipeOpts { right?: () => void; actions?: (() => void)[] }
export function attachSwipe(card: SwipeCard, { right, actions = [] }: SwipeOpts): void {
  const wrap = card.parentElement!; // the .card-wrap
  const THRESH = 90;
  const openW = actions.length * ACTION_W;
  let sx = 0, sy = 0, dx = 0, base = 0, active = false, decided = false, horiz = false, pid: number | null = null;
  const full = () => Math.max(openW + 70, card.offsetWidth * 0.6);
  wrap.style.setProperty('--open', `${openW}px`);

  $$('.swipe-actions [data-act]', wrap).forEach((b) => (b.onclick = (e) => {
    e.stopPropagation();
    const fn = actions[Number(b.dataset.act)];
    closeSwipes();
    fn?.();
  }));

  // (A swipe can start on one of the card's buttons, its chips; then it isn't a tap on it.)
  card.addEventListener('click', (e) => { if (card._swiped && (e.target as Element).closest('button')) { e.stopPropagation(); e.preventDefault(); } }, true);
  card.addEventListener('pointerdown', (e) => {
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
      card.setPointerCapture(pid!); // (set on pointerdown, before any move)
      card.classList.add('dragging');
      if (openWrap && openWrap !== wrap) closeSwipes();
    }
    dx = base + mx;
    if (dx < 0 && !actions.length) dx = dx / 4; // resist when there's nothing to do
    if (dx > 0 && !right) dx = dx / 4;
    card.style.transform = `translateX(${dx}px)${dx > 0 ? ` rotate(${dx / 50}deg)` : ''}`;
    wrap.dataset.dir = dx > 0 ? 'right' : 'left';
    wrap.style.setProperty('--reveal', String(Math.min(1, Math.abs(dx) / THRESH)));
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
      wrap.style.setProperty('--reveal', '0');
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
      wrap.style.setProperty('--reveal', '0');
      wrap.style.setProperty('--pull', '0px');
      wrap.classList.remove('open');
      if (openWrap === wrap) openWrap = null;
    }
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

// Banner suggesting a level change, shown on played cards and in the detail sheet.
export function suggestionHtml(t: Item, sug: ReturnType<typeof levelSuggestion>): string {
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
  focus: 'Comes up first: a few focus items a day (Settings), taking turns.',
  on: { tune: 'Picked for your set when it’s due.', exercise: 'Picked for your set now and then, and offered as a warm-up.' },
  off: { tune: 'Left out for now: not picked for your set.', exercise: 'Left out for now: not picked, and not offered as a warm-up.' },
};
// At the top of a tune's or exercise's details: Focus / On / Off, and a ⋯ menu (#item-menu) for
// the rest. What Focus or Off means shows under it (On is the usual, and says nothing).
export function statusHtml(t: Item, status: ReturnType<typeof itemStatus>): string {
  const hint = STATUS_HINTS[status];
  return `<div class="item-top"><div class="seg item-status" id="item-status" role="group" aria-label="In the pool">${[['focus', 'Focus'], ['on', 'On'], ['off', 'Off']].map(([v, l]) => `<button class="${status === v ? 'on' : ''}" data-v="${v}">${v === 'focus' ? ICON.focus : ''}${l}</button>`).join('')}</div>
    <button class="icon-btn small item-menu" id="item-menu" aria-label="More">⋯</button></div>
    ${status === 'on' ? '' : `<p class="fine" id="item-status-hint">${esc(typeof hint === 'string' ? hint : hint[t.type])}</p>`}`;
}

// ---------- Hints shown until dismissed (or done) ----------
// A line of help with an ×; once dismissed, or once the thing it explains has been done
// (hintDone), it isn't shown again.
export function hintHtml(id: string, html: string, cls = 'hint'): string {
  if ((store.state.hintsSeen || []).includes(id)) return '';
  return `<p class="${cls} once-hint" data-hint="${id}"><span>${html}</span><button class="hint-x" aria-label="Got it">×</button></p>`;
}
export function hintDone(id: string): void {
  const seen = (store.state.hintsSeen ||= []);
  if (seen.includes(id)) return;
  seen.push(id);
  save();
  document.querySelectorAll(`[data-hint="${id}"]`).forEach((el) => el.remove());
}
// The ×: wired once, for any hint on the page or in a sheet.
document.addEventListener('click', (e) => {
  const x = (e.target as Element).closest?.('.hint-x');
  if (!x) return;
  e.stopPropagation();
  hintDone(x.closest<HTMLElement>('[data-hint]')!.dataset.hint!); // (an × is in its hint, see hintHtml)
}, true);

// ---------- A "⋯" menu ----------
// items: [{ label, fn, danger? }] (falsy ones are skipped). Opens under `anchor`; a tap outside
// (or on an item) closes it.
export interface MenuItem { label: string; fn: () => void; danger?: boolean }
type MenuPop = HTMLDivElement & { _anchor?: Element };
export function openMenu(anchor: Element, items: (MenuItem | Falsy)[]): void {
  // (Its button again closes it.)
  if (openPop && openPop._anchor === anchor) return closeMenu();
  closeMenu();
  const list = items.filter(Boolean) as MenuItem[];
  const pop: MenuPop = document.createElement('div');
  pop.className = 'menu-pop';
  pop.setAttribute('role', 'menu');
  pop.innerHTML = list.map((it, i) => `<button role="menuitem" class="${it.danger ? 'danger' : ''}" data-mi="${i}">${esc(it.label)}</button>`).join('');
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = `${Math.min(r.bottom + 6, window.innerHeight - pop.offsetHeight - 10)}px`;
  pop.style.right = `${Math.max(10, window.innerWidth - r.right)}px`;
  pop.onclick = (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-mi]');
    if (!b) return;
    closeMenu();
    list[Number(b.dataset.mi)].fn();
  };
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
  pop._anchor = anchor;
  openPop = pop;
}
let openPop: MenuPop | null = null;
// A tap outside closes it — not on its own button, whose click does (see openMenu).
function outside(e: Event) { if (openPop && !openPop.contains(e.target as Node) && !openPop._anchor!.contains(e.target as Node)) closeMenu(); }
export function closeMenu(): void {
  openPop?.remove();
  openPop = null;
  document.removeEventListener('pointerdown', outside, true);
}


// ---------- Help behind an ⓘ ----------
// An explanation that isn't needed every time: info(html) gives the ⓘ button (to put by a heading
// or label) and the text it shows and hides (to put under it). Wired once, globally.
let infoN = 0;
export function info(html: string): { btn: string; text: string } {
  const id = `info-${++infoN}`;
  return {
    btn: `<button type="button" class="info-btn" aria-controls="${id}" aria-expanded="false" aria-label="What’s this?">i</button>`,
    text: `<p class="fine info-text" id="${id}" hidden>${html}</p>`,
  };
}
document.addEventListener('click', (e) => {
  const b = (e.target as Element).closest?.('.info-btn');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  const el = document.getElementById(b.getAttribute('aria-controls')!); // (set by info())
  if (!el) return;
  el.hidden = !el.hidden;
  b.setAttribute('aria-expanded', String(!el.hidden));
}, true);

// ---------- Settings as rows, each edited in a panel ----------
// A list of a sheet's settings: each row shows what it's set to; tapping it opens a panel over the
// sheet with the controls for that one (see settingPanel). rows: [{ key, label, value, html? }]
// (html: a control in the row itself, like a switch, instead of a panel).
export interface SettingRow { key?: string; label?: string; value?: string | null; html?: string }
export function settingRowsHtml(rows: (SettingRow | Falsy)[]): string {
  return `<div class="set-list">${(rows.filter(Boolean) as SettingRow[]).map((r) => (r.html
    ? `<div class="set-row">${r.html}</div>`
    : `<button class="set-row" data-open="${r.key}"><span class="set-label">${esc(r.label)}</span><span class="set-value">${esc(r.value || '')}</span><span class="set-go" aria-hidden="true">›</span></button>`)).join('')}</div>`;
}
// The panel for one setting, over the sheet (it stays there through the sheet's redraws: the
// caller fills .sub-body). Returns the panel element; Done (or closePanel) removes it.
export function settingPanel(sheet: HTMLElement, title: string, onDone?: () => void): HTMLDivElement {
  closePanel(sheet);
  const p = document.createElement('div');
  p.className = 'sub-panel';
  p.setAttribute('role', 'dialog');
  p.setAttribute('aria-label', title);
  p.innerHTML = `<div class="sub-head"><b>${esc(title)}</b><button class="pill-btn sub-done">Done</button></div><div class="sub-body"></div>`;
  sheet.appendChild(p);
  p.querySelector<HTMLElement>('.sub-done')!.onclick = () => { closePanel(sheet); onDone?.(); };
  return p;
}
export function closePanel(sheet: Element): void {
  sheet.querySelector('.sub-panel')?.remove();
}

// A sheet to pick one option, with what the setting does: { title, help, options: [[value,
// label, hint?]], value, onPick(value) }. Picking closes it.
export interface ChoiceOpts {
  title: string;
  help?: string;
  options: [value: string, label: string, hint?: string][];
  value: string | null | undefined;
  onPick: (value: string) => void;
}
export function openChoice({ title, help = '', options, value, onPick }: ChoiceOpts): void {
  const sheet = openSheet(`
    <p class="eyebrow">Settings</p>
    <h2 class="sheet-title">${esc(title)}</h2>
    ${help ? `<p class="fine">${help}</p>` : ''}
    <div class="set-list choice-list" role="radiogroup">${options.map(([v, label, hint]) => `
      <button class="set-row ${v === value ? 'on' : ''}" role="radio" aria-checked="${v === value}" data-pick="${esc(v)}">
        <span class="set-label">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</span><span class="set-check" aria-hidden="true">${v === value ? '✓' : ''}</span></button>`).join('')}</div>`);
  sheet.querySelectorAll<HTMLElement>('[data-pick]').forEach((b) => (b.onclick = () => {
    closeSheet();
    onPick(b.dataset.pick!);
  }));
}
