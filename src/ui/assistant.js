import { store, save } from '../store.js';
import { esc, clone } from '../util.js';
import { itemById } from '../practice.js';
import { send, newConversation, getApiKey, setApiKey, describeError } from '../assistant/agent.js';
import { fmtCost } from '../assistant/cost.js';
import { $, ICON, render, toast, openSheet } from './shell.js';

// Chat with the practice assistant. The conversation lasts while the app is open.
let conv = newConversation();
let transcript = []; // what's shown: { role, text, tools, changes, undo, undone, error, stop }
let pendingNote = null; // told to the assistant with the next message (e.g. "I undid your changes")

const SUGGESTIONS = [
  'Build me a set for tonight',
  'What have I been neglecting?',
  'Add a couple of ballads in flat keys',
  'Which keys am I weakest in?',
  'What should I ask my teacher about?',
];

const TOOL_LABELS = {
  get_today: () => 'Checked today’s set',
  search_library: () => 'Searched your library',
  get_item: (i) => `Looked at ${itemById(i.item_id)?.name || 'an item'}`,
  get_practice_stats: () => 'Checked your practice stats',
  get_diary: () => 'Read your diary',
  report_unsupported: () => 'Noted a request for later',
};

// Minimal, safe formatting for replies: paragraphs, "- " lists, **bold**, *italic*.
function formatReply(text) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  const blocks = [];
  let list = null;
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

function entryHtml(e, i) {
  if (e.role === 'user') return `<div class="msg user"><p>${esc(e.text)}</p></div>`;
  const latestUndoable = transcript.findLastIndex((x) => x.changes?.length && !x.undone) === i;
  return `
    <div class="msg bot">
      ${e.tools?.length ? `<div class="tool-lines">${e.tools.map((t) => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      ${e.text ? `<div class="bot-text">${formatReply(e.text)}</div>` : e.pending ? '<div class="typing"><i></i><i></i><i></i></div>' : ''}
      ${e.changes?.length ? `
        <div class="changes ${e.undone ? 'undone' : ''}">
          <ul>${e.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          ${e.undone ? '<span class="fine">Undone</span>' : latestUndoable ? `<button class="pill-btn" data-undo="${i}">Undo</button>` : ''}
        </div>` : ''}
      ${e.error ? `<p class="chat-error">${esc(e.error)}</p>` : ''}
      ${e.stop === 'refusal' ? '<p class="chat-error">The assistant couldn’t help with that one.</p>' : ''}
      ${e.stop === 'too_many_steps' ? '<p class="fine">That took a lot of steps, so I stopped. Ask me to carry on if needed.</p>' : ''}
      ${e.cost ? `<p class="msg-cost">${fmtCost(e.cost)}</p>` : ''}
    </div>`;
}

export async function openAssistant() {
  const key = await getApiKey();
  if (!key) return openKeySetup(() => openAssistant());

  const busy = { on: false, controller: null };
  const sheet = openSheet(`
    <div class="chat">
      <div class="chat-head">
        <p class="eyebrow">Assistant <span class="chat-cost" id="chat-cost"></span></p>
        <button class="link-btn" id="chat-new">New chat</button>
      </div>
      <div class="chat-log" id="chat-log"></div>
      <form class="chat-input" id="chat-form">
        <textarea id="chat-text" rows="1" placeholder="Ask about your practice…" enterkeyhint="send"></textarea>
        ${Recognition ? `<button type="button" class="icon-btn small" id="chat-mic" aria-label="Dictate">${ICON.mic}</button>` : ''}
        <button type="submit" class="chat-send" id="chat-send" aria-label="Send">${ICON.send}</button>
      </form>
    </div>`, () => { busy.controller?.abort(); stopListening(); render(); });

  const log = $('#chat-log', sheet);
  const input = $('#chat-text', sheet);
  const sendBtn = $('#chat-send', sheet);
  const body = $('.sheet-body', sheet);

  const draw = () => {
    $('#chat-cost', sheet).textContent = conv.cost ? `· ${fmtCost(conv.cost)} this chat` : '';
    log.innerHTML = transcript.length
      ? transcript.map(entryHtml).join('')
      : `<div class="chat-empty">
          <p>Ask me to plan or change today’s practice, find tunes, look at your progress, or answer music questions.</p>
          <div class="chips wrap">${SUGGESTIONS.map((s) => `<button class="chip" data-suggest="${esc(s)}">${esc(s)}</button>`).join('')}</div>
        </div>`;
    log.querySelectorAll('[data-suggest]').forEach((b) => (b.onclick = () => submit(b.dataset.suggest)));
    log.querySelectorAll('[data-undo]').forEach((b) => (b.onclick = () => undo(Number(b.dataset.undo))));
    body.scrollTop = body.scrollHeight;
  };
  const fit = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 140)}px`; };
  const setBusy = (on) => {
    busy.on = on;
    sendBtn.innerHTML = on ? ICON.stop : ICON.send;
    sendBtn.setAttribute('aria-label', on ? 'Stop' : 'Send');
  };

  function undo(i) {
    const e = transcript[i];
    if (!e?.undo) return;
    store.state = e.undo;
    save();
    e.undone = true;
    pendingNote = 'I undid the changes you just made.';
    render();
    draw();
    toast('Changes undone');
  }

  async function submit(text) {
    text = text.trim();
    if (!text || busy.on) return;
    stopListening();
    input.value = '';
    fit();
    const snapshot = clone(store.state);
    transcript.push({ role: 'user', text });
    const reply = { role: 'bot', text: '', tools: [], pending: true };
    transcript.push(reply);
    draw();
    setBusy(true);
    busy.controller = new AbortController();
    const message = pendingNote ? `(${pendingNote})\n\n${text}` : text;
    pendingNote = null;
    try {
      const result = await send(conv, message, {
        signal: busy.controller.signal,
        onText: (d) => { reply.text += d; draw(); },
        onStep: () => { if (reply.text && !reply.text.endsWith('\n')) reply.text += '\n\n'; },
        onTool: ({ name, input: args, write }) => {
          if (!write && TOOL_LABELS[name]) {
            const label = TOOL_LABELS[name](args);
            if (!reply.tools.includes(label)) reply.tools.push(label);
            draw();
          }
        },
      });
      reply.stop = result.stop;
      reply.changes = result.changes;
      reply.cost = result.cost;
      if (result.changes.length) {
        reply.undo = snapshot;
        render(); // refresh the screen behind the chat
      }
    } catch (err) {
      reply.error = await describeError(err);
      if (err?.code === 'no_key') return openKeySetup(() => openAssistant());
    } finally {
      reply.pending = false;
      setBusy(false);
      busy.controller = null;
      draw();
    }
  }

  $('#chat-form', sheet).onsubmit = (e) => {
    e.preventDefault();
    if (busy.on) busy.controller?.abort();
    else submit(input.value);
  };
  input.oninput = fit;
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-form', sheet).requestSubmit(); }
  };
  $('#chat-new', sheet).onclick = () => {
    if (busy.on) return;
    conv = newConversation();
    transcript = [];
    pendingNote = null;
    draw();
  };

  // Dictation, where the browser supports it.
  let rec = null;
  function stopListening() {
    rec?.stop();
    rec = null;
    $('#chat-mic', sheet)?.classList.remove('on');
  }
  const mic = $('#chat-mic', sheet);
  if (mic) mic.onclick = () => {
    if (rec) return stopListening();
    rec = new Recognition();
    rec.continuous = true;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (ev) => {
      const said = [...ev.results].slice(ev.resultIndex).filter((r) => r.isFinal).map((r) => r[0].transcript.trim()).join(' ');
      if (said) { input.value = `${input.value.trimEnd()}${input.value.trim() ? ' ' : ''}${said}`; fit(); }
    };
    rec.onerror = () => stopListening();
    rec.onend = () => { if (rec) stopListening(); };
    try { rec.start(); mic.classList.add('on'); } catch { stopListening(); }
  };

  draw();
}

const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

// First-run setup: the assistant uses the user's own Anthropic API key.
export function openKeySetup(then) {
  const sheet = openSheet(`
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
    <button class="primary-btn" id="key-save">Save key</button>
  `);
  $('#key-save', sheet).onclick = async () => {
    const v = $('#key-input', sheet).value.trim();
    if (!v.startsWith('sk-')) return toast('That doesn’t look like an Anthropic API key');
    await setApiKey(v);
    toast('Key saved');
    then?.();
  };
}
