import { LitElement, html, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { openSheet } from './shell.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

// Screens and sheets as Lit components (https://lit.dev), moving over from template strings one
// at a time. They render into the light DOM (no shadow root), so styles.css applies as before.
//
// The app's state is one plain object (store.state), changed in place and then shown with render()
// (shell.js). A component reads what it needs from it in render(); render() asks the screen's
// component to update, and Lit changes only the parts of the page whose values changed.

export { html, nothing, type TemplateResult } from 'lit';
export { live } from 'lit/directives/live.js';

export class View extends LitElement {
  createRenderRoot() { return this; }
  connectedCallback() {
    super.connectedCallback();
    // Laid out as if it weren't there: its parts are the page's, as before it was a component.
    this.style.display = 'contents';
  }
  // Called by mount() each time the app redraws this screen. The components in it show the same
  // data (changed in place, so their properties needn't change): they're redrawn too.
  refresh() {
    this.requestUpdate();
    this.querySelectorAll('*').forEach((el) => { if (el instanceof View) el.requestUpdate(); });
  }
}

// A screen's component in the #view container: made the first time, then refreshed.
export function mount(root: HTMLElement, tag: string): View {
  let el = root.firstElementChild as View | null;
  if (root.childElementCount !== 1 || !el || el.localName !== tag) {
    el = document.createElement(tag) as View;
    root.replaceChildren(el);
  } else el.refresh();
  return el;
}

// A sheet (see openSheet in shell.ts) holding a component.
export function openSheetView<T extends HTMLElement>(el: T, onClose?: () => void): T {
  openSheet('', onClose).querySelector('.sheet-body')!.append(el);
  return el;
}

// Our own markup (the ICON svgs, help text with <b>): never anything typed in.
export const raw = (s: string) => unsafeHTML(s);

// ---------- Shared pieces ----------
// Stateless controls are template functions; the caller wraps them in its own element (with the
// class and attributes it's styled and found by). Pieces with state of their own are components.

// A segmented control's buttons: the one for value is on; tapping one calls pick.
export function segButtons<V extends string | number>(options: readonly (readonly [V, unknown])[], value: V | null | undefined, pick: (v: V) => void) {
  return options.map(([v, label]) => html`<button class=${v === value ? 'on' : ''} data-v=${v} @click=${() => pick(v)}>${label}</button>`);
}

// A stepper's −, value and +, kept within min…max.
export function stepperButtons(value: number, change: (v: number) => void, min: number, max: number) {
  return html`<button data-d="-1" aria-label="Fewer" @click=${() => change(Math.max(min, value - 1))}>−</button><output>${value}</output><button data-d="1" aria-label="More" @click=${() => change(Math.min(max, value + 1))}>+</button>`;
}

// A section's heading, with what it's about behind an ⓘ: tapped, the text shows under it.
// (Its ⓘ toggles itself — data-own — rather than through shell.ts's info().)
let headingN = 0;
@customElement('ws-heading')
export class Heading extends View {
  @property() label = '';
  @property() help = '';
  @state() open = false;
  private textId = `heading-${++headingN}`;
  render() {
    return html`<h3 class="section-label">${this.label}${this.help ? html`<button type="button" class="info-btn" data-own aria-controls=${this.textId} aria-expanded=${String(this.open)} aria-label="What’s this?" @click=${() => (this.open = !this.open)}>i</button>` : nothing}</h3>
      ${this.help ? html`<p class="fine info-text" id=${this.textId} ?hidden=${!this.open}>${raw(this.help)}</p>` : nothing}`;
  }
}

// A list of settings, each row showing what it's set to; tapping one calls open(key) (see
// settingRowsHtml in shell.js).
export interface SettingRow { key: string; label: string; value?: string }
export function settingRows(rows: SettingRow[], open: (key: string) => void) {
  return html`<div class="set-list">${rows.map((r) => html`
    <button class="set-row" data-open=${r.key} @click=${() => open(r.key)}>
      <span class="set-label">${r.label}</span><span class="set-value">${r.value || ''}</span><span class="set-go" aria-hidden="true">›</span>
    </button>`)}</div>`;
}
