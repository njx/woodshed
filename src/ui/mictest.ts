import { holdAudio } from '../audiosession.js';
import { acquireAudio, matchSampleRate, type Audio } from '../audio.js';
import { customElement, state } from 'lit/decorators.js';
import { View, html, nothing, segButtons, openSheetView } from './lit.js';

// A mic test (Settings → Microphone): the mic opened the ways the tuner and recorder open it, each
// part switchable, to find which one an external mic doesn't get on with. E.g. a USB mic whose
// headphone monitoring stops when the app starts listening: flip one thing at a time, listening in
// its headphones, and see which keeps it going. It shows what the phone actually gave.

interface Options {
  session: 'safari' | 'record'; // leave the iPhone's session to Safari (as the app does), or set play-and-record ourselves
  channels: 'one' | 'any'; // ask for one channel, or take what the mic gives
  processing: 'off' | 'default'; // the phone's echo cancellation, noise suppression and auto level off, or as Safari sets them
  webAudio: 'on' | 'off'; // the mic into Web Audio (the tuner's analyser, the recorder's meter), at the mic's sample rate
}
const ASIS: Options = { session: 'safari', channels: 'one', processing: 'off', webAudio: 'on' }; // (as the app does it)

export function openMicTest(): void {
  openSheetView(document.createElement('ws-mic-test'), () => (document.querySelector('ws-mic-test') as MicTest | null)?.stop());
}

// The iPhone's audio session set directly (the 'record' option: what the app used to do).
function setSession(type: 'auto' | 'play-and-record') {
  try { if (navigator.audioSession) navigator.audioSession.type = type; } catch { /* not supported */ }
}

@customElement('ws-mic-test')
export class MicTest extends View {
  @state() opts: Options = { ...ASIS };
  @state() mics: { id: string; label: string }[] = [];
  @state() mic = ''; // '' = the phone's default
  @state() running = false;
  @state() info = '';
  @state() level = 0;
  private stream: MediaStream | null = null;
  private audio: Audio | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private releaseSession: (() => void) | null = null;
  private raf = 0;

  connectedCallback() {
    super.connectedCallback();
    this.listMics();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this.stop();
  }
  async listMics() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.mics = all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    } catch { /* none to list */ }
  }

  async start() {
    this.stop();
    const o = this.opts;
    // (From the tap: the shared audio may start here.)
    if (o.webAudio === 'on') this.audio = acquireAudio();
    this.releaseSession = holdAudio('record'); // (as the tuner and recorder do: Safari's session)
    if (o.session === 'record') setSession('play-and-record');
    const audio: MediaTrackConstraints = {
      ...(o.processing === 'off' ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : {}),
      ...(o.channels === 'one' ? { channelCount: { ideal: 1 } } : {}),
      ...(this.mic ? { deviceId: { exact: this.mic } } : {}),
    };
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
    } catch (err) {
      this.info = `Couldn’t open the mic: ${(err as Error).name}`;
      return this.stop(false);
    }
    this.running = true;
    const track = this.stream.getAudioTracks()[0];
    const s = track?.getSettings?.() ?? {};
    if (!this.mics.length) await this.listMics(); // (names show once allowed)
    if (this.audio) {
      matchSampleRate(s.sampleRate);
      const ctx = this.audio.ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      this.source = ctx.createMediaStreamSource(this.stream);
      this.source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const tick = () => {
        analyser.getFloatTimeDomainData(buf);
        this.level = Math.min(1, Math.max(...buf.map(Math.abs)) * 3);
        this.raf = requestAnimationFrame(tick);
      };
      tick();
    }
    const session = navigator.audioSession?.type ?? 'n/a';
    this.info = [
      `Mic: ${track?.label || '?'}`,
      `Channels: ${s.channelCount ?? '?'} · Sample rate: ${s.sampleRate ?? '?'}`,
      `Echo cancellation: ${s.echoCancellation ?? '?'} · Noise suppression: ${s.noiseSuppression ?? '?'} · Auto level: ${s.autoGainControl ?? '?'}`,
      `iPhone audio session: ${session}`,
      this.audio ? `Web Audio: ${this.audio.ctx.sampleRate} Hz, ${this.audio.ctx.state}` : 'Web Audio: not used',
    ].join('\n');
  }
  stop(clear = true) {
    cancelAnimationFrame(this.raf);
    this.source?.disconnect();
    this.source = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.audio?.release();
    this.audio = null;
    this.releaseSession?.();
    this.releaseSession = null;
    if (this.opts.session === 'record') setSession('auto');
    this.running = false;
    this.level = 0;
    if (clear) this.info = '';
  }
  set<K extends keyof Options>(k: K, v: Options[K]) {
    this.opts = { ...this.opts, [k]: v };
    if (this.running) this.start(); // (again, with the change)
  }

  render() {
    const o = this.opts;
    const row = <K extends keyof Options>(k: K, label: string, hint: string, options: [Options[K], string][]) => html`
      <div class="setting"><div><b>${label}</b><span>${hint}</span></div>
        <div class="seg" data-mt=${k}>${segButtons(options, o[k], (v) => this.set(k, v))}</div></div>`;
    return html`
      <p class="eyebrow">Microphone</p>
      <h2 class="sheet-title">Mic test</h2>
      <p class="fine">The mic opened the ways the tuner and recorder open it. Start, then change one thing at a time to see which an external mic doesn’t like — for example, listening in a USB mic’s headphones for its monitoring to stop. The first choice in each is what the app does now.</p>
      ${this.mics.length > 1 ? html`<label class="rec-mic"><span>Mic</span><select id="mt-mic" @change=${(e: Event) => { this.mic = (e.target as HTMLSelectElement).value; if (this.running) this.start(); }}>
        <option value="" ?selected=${!this.mic}>Phone’s choice</option>
        ${this.mics.map((m) => html`<option value=${m.id} ?selected=${m.id === this.mic}>${m.label}</option>`)}</select></label>` : nothing}
      ${row('session', 'Audio session', 'Left to Safari, or record mode set by the app', [['safari', 'Safari’s'], ['record', 'Record mode']])}
      ${row('channels', 'Channels', 'Ask for one, or take what the mic gives', [['one', 'One'], ['any', 'As it comes']])}
      ${row('processing', 'Phone’s processing', 'Echo cancellation, noise suppression, auto level', [['off', 'Off'], ['default', 'Safari’s default']])}
      ${row('webAudio', 'Web Audio', 'The level meter and tuner listen through it', [['on', 'On'], ['off', 'Off']])}
      <button class="primary-btn" id="mt-go" @click=${() => (this.running ? this.stop() : this.start())}>${this.running ? 'Stop' : 'Start'}</button>
      ${this.running && o.webAudio === 'on' ? html`<div class="mt-level" aria-hidden="true"><i style="width:${Math.round(this.level * 100)}%"></i></div>` : nothing}
      ${this.info ? html`<pre class="mt-info" id="mt-info">${this.info}</pre>` : nothing}`;
  }
}
