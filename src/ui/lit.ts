import { LitElement, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

// Screens and sheets as Lit components (https://lit.dev), moving over from template strings one
// at a time. They render into the light DOM (no shadow root), so styles.css applies as before.
//
// The app's state is one plain object (store.state), changed in place and then shown with render()
// (shell.js). A component reads what it needs from it in render(); render() asks the screen's
// component to update, and Lit changes only the parts of the page whose values changed.

export { html, nothing } from 'lit';
export { live } from 'lit/directives/live.js';

export class View extends LitElement {
  createRenderRoot() { return this; }
  // Called by mount() each time the app redraws this screen.
  refresh() { this.requestUpdate(); }
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

// Our own markup (the ICON svgs, help text with <b>): never anything typed in.
export const raw = (s: string) => unsafeHTML(s);

// The ⓘ by a heading and the text it shows and hides (see info() in shell.js, which wires every
// .info-btn on the page): id names the text, so it stays open or shut across updates.
export function infoParts(id: string, help: string) {
  return {
    btn: html`<button type="button" class="info-btn" aria-controls=${id} aria-expanded="false" aria-label="What’s this?">i</button>`,
    text: html`<p class="fine info-text" id=${id} hidden>${raw(help)}</p>`,
  };
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
