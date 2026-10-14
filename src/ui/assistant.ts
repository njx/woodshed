import { esc } from '../util.js';
import { itemById } from '../practice.js';
import { send, newConversation, getApiKey, setApiKey, describeError } from '../assistant/agent.js';
import { fmtCost } from '../assistant/cost.js';
import { canUndo, undo as undoChanges, CommandError, type UndoEntry } from '../commands/index.js';
import { ICON, render, toast, offerUndo } from './shell.js';
import { customElement, state } from 'lit/decorators.js';
import { View, html, nothing, raw, openSheetView } from './lit.js';
import type { AssistantError, Stop, TurnChanges } from '../assistant/agent.js';
import type { Confirm } from '../assistant/tools.js';

// Chat with the practice assistant. The conversation lasts while the app is open.
let conv = newConversation();
// A message or a reply in the chat (see AssistantSheet.entry).
interface Entry {
  role: 'user' | 'bot';
  text: string;
  tools?: string[];
  pending?: boolean;
  changes?: string[];
  cost?: number;
  undo?: UndoEntry | null; // its changes, as one undo (see commands/core.ts)
  undone?: boolean;
  confirms?: (Confirm & { done?: boolean })[]; // changes waiting for a tap (deleting something with history)
  stop?: Stop;
  error?: string;
}
let transcript: Entry[] = []; // what's shown: { role, text, tools, changes, undo, undone, error, stop }
let pendingNote: string | null = null; // told to the assistant with the next message (e.g. "I undid your changes")

const SUGGESTIONS = [
  'Build me a set for tonight',
  'What have I been neglecting?',
  'Add a couple of ballads in flat keys',
  'Which keys am I weakest in?',
  'What should I ask my teacher about?',
];

// (input: the tool's input as Claude sent it, untyped here.)
const TOOL_LABELS: Record<string, (input: any) => string> = {
  get_today: () => 'Checked today’s set',
  search_library: () => 'Searched your library',
  get_item: (i) => `Looked at ${itemById(i.item)?.name || 'an item'}`,
  get_practice_stats: () => 'Checked your practice stats',
  get_diary: () => 'Read your diary',
  report_unsupported: () => 'Noted a request for later',
};

// Minimal, safe formatting for replies: paragraphs, "- " lists, **bold**, *italic*. (The text is
// escaped first: the only markup is what's added here.)
function formatReply(text: string) {
  const inline = (s: string) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  const blocks: string[] = [];
  let list: string[] | null = null;
  for (const line of text.split('\n')) {
    const m = /^\s*(?:[-•*]|\d+[.)])\s+(.*)$/.exec(line);
    if (m) {
      (list ||= []).push(`<li>${inline(m[1])}</li>`);
      continue;
    }
    if (list) { blocks.push(`<ul>${list.join('')}</ul>`); list = null; }
    if (line.trim()) blocks.push(`<p>${inline(line)}</p>`);
  }
  if (list) blocks.push(`<ul>${list.join('')}</ul>`);
  return blocks.join('');
}

export async function openAssistant() {
  const key = await getApiKey();
  if (!key) return openKeySetup(() => openAssistant());
  const el = document.createElement('ws-assistant') as AssistantSheet;
  openSheetView(el, () => el.closed());
}

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

@customElement('ws-assistant')
export class AssistantSheet extends View {
  @state() busy = false;
  @state() listening = false;
  private controller: AbortController | null = null;
  private rec: SpeechRecognition | null = null;

  get input() { return this.querySelector<HTMLTextAreaElement>('#chat-text')!; }
  closed() {
    this.controller?.abort();
    this.stopListening();
    render();
  }
  // The newest at the bottom, in view.
  updated() {
    const body = this.closest('.sheet-body');
    if (body) body.scrollTop = body.scrollHeight;
  }

  render() {
    return html`
      <div class="chat">
        <div class="chat-head">
          <p class="eyebrow">Assistant <span class="chat-cost" id="chat-cost">${conv.cost ? `· ${fmtCost(conv.cost)} this chat` : ''}</span></p>
          <button class="link-btn" id="chat-new" @click=${() => this.newChat()}>New chat</button>
        </div>
        <div class="chat-log" id="chat-log">${transcript.length
          ? transcript.map((e, i) => this.entry(e, i))
          : html`<div class="chat-empty">
              <p>Ask me to plan or change today’s practice, find tunes, look at your progress, or answer music questions.</p>
              <div class="chips wrap">${SUGGESTIONS.map((x) => html`<button class="chip" data-suggest=${x} @click=${() => this.submit(x)}>${x}</button>`)}</div>
            </div>`}</div>
        <form class="chat-input" id="chat-form" @submit=${(e: Event) => { e.preventDefault(); if (this.busy) this.controller?.abort(); else this.submit(this.input.value); }}>
          <textarea id="chat-text" rows="1" placeholder="Ask about your practice…" enterkeyhint="send" @input=${() => this.fit()}
            @keydown=${(e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.querySelector<HTMLFormElement>('#chat-form')!.requestSubmit(); } }}></textarea>
          ${Recognition ? html`<button type="button" class="icon-btn small ${this.listening ? 'on' : ''}" id="chat-mic" aria-label="Dictate" @click=${() => this.dictate()}>${raw(ICON.mic)}</button>` : nothing}
          <button type="submit" class="chat-send" id="chat-send" aria-label=${this.busy ? 'Stop' : 'Send'}>${raw(this.busy ? ICON.stop : ICON.send)}</button>
        </form>
      </div>`;
  }
  entry(e: Entry, i: number) {
    if (e.role === 'user') return html`<div class="msg user"><p>${e.text}</p></div>`;
    // Undo is offered for the latest changes only, and only while nothing else has changed since.
    const undoable = !e.undone && canUndo(e.undo);
    return html`
      <div class="msg bot">
        ${e.tools?.length ? html`<div class="tool-lines">${e.tools.map((t) => html`<span>${t}</span>`)}</div>` : nothing}
        ${e.text ? html`<div class="bot-text">${raw(formatReply(e.text))}</div>` : e.pending ? html`<div class="typing"><i></i><i></i><i></i></div>` : nothing}
        ${e.changes?.length ? html`
          <div class="changes ${e.undone ? 'undone' : ''}">
            <ul>${e.changes.map((c) => html`<li>${c}</li>`)}</ul>
            ${e.undone ? html`<span class="fine">Undone</span>` : undoable ? html`<button class="pill-btn" data-undo=${i} @click=${() => this.undo(i)}>Undo</button>` : nothing}
          </div>` : nothing}
        ${e.confirms?.length ? html`<div class="confirms">${e.confirms.map((c, j) => html`
          <div class="confirm"><span>${c.question}</span>${c.done ? html`<span class="fine">Done</span>`
            : html`<button class="pill-btn danger" data-confirm=${`${i}:${j}`} ?disabled=${this.busy} @click=${() => this.confirm(e, j)}>Yes</button>`}</div>`)}</div>` : nothing}
        ${e.error ? html`<p class="chat-error">${e.error}</p>` : nothing}
        ${e.stop === 'refusal' ? html`<p class="chat-error">The assistant couldn’t help with that one.</p>` : nothing}
        ${e.stop === 'too_many_steps' ? html`<p class="fine">That took a lot of steps, so I stopped. Ask me to carry on if needed.</p>` : nothing}
        ${e.cost ? html`<p class="msg-cost">${fmtCost(e.cost)}</p>` : nothing}
      </div>`;
  }
  fit() {
    const input = this.input;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }
  newChat() {
    if (this.busy) return;
    conv = newConversation();
    transcript = [];
    pendingNote = null;
    this.requestUpdate();
  }

  undo(i: number) {
    const e = transcript[i];
    if (!e?.undo || this.busy) return;
    if (!undoChanges(e.undo)) { this.requestUpdate(); return toast('Can’t undo — other things have changed since'); }
    e.undone = true;
    pendingNote = 'I undid the changes you just made.';
    render();
    this.requestUpdate();
    toast('Changes undone');
  }

  // A change the assistant asked for, confirmed: done (with its own undo, in the toast).
  confirm(e: Entry, j: number) {
    const c = e.confirms![j];
    if (this.busy || c.done) return; // (not while a turn's changes are being gathered into one undo)
    try {
      const done = c.run();
      c.done = true;
      pendingNote = `I confirmed: ${c.question}`;
      render();
      offerUndo(done);
    } catch (err) {
      toast(err instanceof CommandError ? err.message : 'Couldn’t do that');
    }
    this.requestUpdate();
  }

  async submit(text: string) {
    text = text.trim();
    if (!text || this.busy) return;
    this.stopListening();
    this.input.value = '';
    this.fit();
    transcript.push({ role: 'user', text });
    const reply: Entry & { tools: string[] } = { role: 'bot', text: '', tools: [], pending: true };
    transcript.push(reply);
    this.busy = true;
    this.controller = new AbortController();
    const finishTurn = (r: TurnChanges | undefined) => {
      reply.changes = r?.changes || [];
      reply.cost = r?.cost || 0;
      reply.undo = r?.undo;
      reply.confirms = r?.confirms;
      if (r?.undo) render(); // refresh the screen behind the chat
    };
    const message = pendingNote ? `(${pendingNote})\n\n${text}` : text;
    pendingNote = null;
    let stepAt = 0; // where this step's text starts in the reply
    try {
      const result = await send(conv, message, {
        signal: this.controller.signal,
        onText: (d) => { reply.text += d; this.requestUpdate(); },
        onStep: () => { if (reply.text && !reply.text.endsWith('\n')) reply.text += '\n\n'; stepAt = reply.text.length; },
        onRetry: () => { reply.text = reply.text.slice(0, stepAt); this.requestUpdate(); },
        onTool: ({ name, input: args, write }) => {
          if (!write && TOOL_LABELS[name]) {
            const label = TOOL_LABELS[name](args);
            if (!reply.tools.includes(label)) reply.tools.push(label);
            this.requestUpdate();
          }
        },
      });
      reply.stop = result.stop;
      finishTurn(result);
    } catch (err) {
      finishTurn((err as AssistantError)?.partial); // changes made before the error still get listed, with Undo
      reply.error = await describeError(err);
      if ((err as AssistantError)?.code === 'no_key') return openKeySetup(() => openAssistant());
    } finally {
      reply.pending = false;
      this.busy = false;
      this.controller = null;
      this.requestUpdate();
    }
  }

  // Dictation, where the browser supports it.
  stopListening() {
    this.rec?.stop();
    this.rec = null;
    this.listening = false;
  }
  dictate() {
    if (this.rec) return this.stopListening();
    const rec = (this.rec = new Recognition!()); // (there's a mic button only with it)
    rec.continuous = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (ev) => {
      const input = this.input;
      const said = [...ev.results].slice(ev.resultIndex).filter((r) => r.isFinal).map((r) => r[0].transcript.trim()).join(' ');
      if (said) { input.value = `${input.value.trimEnd()}${input.value.trim() ? ' ' : ''}${said}`; this.fit(); }
    };
    rec.onerror = () => this.stopListening();
    rec.onend = () => { if (this.rec) this.stopListening(); };
    try { rec.start(); this.listening = true; } catch { this.stopListening(); }
  }
}

// First-run setup: the assistant uses the user's own Anthropic API key.
export function openKeySetup(then?: () => void): void {
  const el = document.createElement('ws-key-setup') as KeySetup;
  el.then = then;
  openSheetView(el);
}

@customElement('ws-key-setup')
export class KeySetup extends View {
  then: (() => void) | undefined;
  async saveKey() {
    const v = this.querySelector<HTMLInputElement>('#key-input')!.value.trim();
    if (!v.startsWith('sk-')) return toast('That doesn’t look like an Anthropic API key');
    await setApiKey(v);
    toast('Key saved');
    this.then?.();
  }
  render() {
    return html`
      <p class="eyebrow">Assistant</p>
      <h2 class="sheet-title">Connect your Anthropic API key</h2>
      <p>The assistant is Claude, running with your own API key. You pay Anthropic directly for what you use — usually a few cents per conversation. This is separate from any Claude Pro or Max subscription, which doesn’t cover API use. The app shows what each reply costs.</p>
      <ol class="steps">
        <li>Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>, sign in, and add some credit under Billing.</li>
        <li>Create an API key and copy it.</li>
        <li>Paste it here.</li>
      </ol>
      <label class="field">
        <span class="field-label">API key</span>
        <input id="key-input" type="password" autocomplete="off" spellcheck="false" placeholder="sk-ant-…">
      </label>
      <p class="fine">The key is stored only on this device (not in backups). When you use the assistant, your question and the relevant practice data are sent to Anthropic.</p>
      <button class="primary-btn" id="key-save" @click=${() => this.saveKey()}>Save key</button>
    `;
  }
}
