import { store, save, flush } from '../store.js';
import { itemById } from '../practice.js';
import { entryById, findItemByName, linkableItems } from '../diary.js';
import * as cmd from '../commands/index.js';
import { canRecord, pickMime, constraints, saveClip, fmtDuration, playOnSpeaker, whileSaving } from '../media.js';
import { mediaDelete } from '../db.js';
import { ICON, render, toast, closeSheet } from './shell.js';
import { holdAudio } from '../audiosession.js';
import { keepAwake } from '../keepawake.js';
import { customElement, state } from 'lit/decorators.js';
import { View, html, nothing, raw, openSheetView } from './lit.js';
import type { Clip, DiaryEntry, Id } from '../types.js';

interface RecorderOpts { entryId?: Id; itemId?: Id | null; flag?: DiaryEntry['flag']; text?: string; back?: () => void }

// Record a practice clip, then keep it (as a diary note, or added to an existing one) or discard it.
//   opts.entryId: add the clip to this diary entry
//   opts.itemId:  link a new note to this tune
//   opts.back:    reopen the sheet this was opened from
//   opts.flag:    a new note's flag; opts.text: its text, to start with
export function openRecorder(opts: RecorderOpts = {}): void {
  if (!canRecord()) return toast('Recording isn’t supported in this browser');
  const el = document.createElement('ws-recorder') as RecorderSheet;
  el.setup(opts); // (now, during the tap that opened it: see audioCtx)
  openSheetView(el, () => el.closed());
}

const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;

@customElement('ws-recorder')
export class RecorderSheet extends View {
  opts: RecorderOpts = {};
  existing: DiaryEntry | null = null;
  @state() kind: Clip['kind'] = 'audio';
  @state() facing = 'user';
  @state() stage: 'starting' | 'ready' | 'recording' | 'review' | 'blocked' = 'starting';
  @state() mics: { id: string; label: string }[] = []; // microphones to pick from, once allowed
  @state() elapsed = 0;
  @state() quiet = false; // recording with no sound coming in for a few seconds
  @state() keeping = false;
  stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  // Once a recording has stopped: it, and it stored (straight away, so a take isn't lost if the
  // app is closed before it's kept: one in no note is offered back in Settings; null if it couldn't be).
  take: { blob: Blob; url: string; ms: number; stored: Promise<Clip | null> } | null = null;
  private isClosed = false;
  private handled = false; // take kept or discarded
  private tick: ReturnType<typeof setInterval> | null = null;
  private raf: number | null = null;
  private levels: number[] = [];
  private releaseRecord: (() => void) | null = null;
  private releaseAwake: () => void = () => {};
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private monoAnalyser: AnalyserNode | null = null; // after the mono step: to check sound comes through it
  private heard = { mic: false, mono: false }; // sound seen on the mic, and on the mono path
  private quietSince = 0; // recording with no sound coming in since (ms)
  private monoStream: MediaStream | null = null; // the stream recorded: see startStream
  private micSource: MediaStreamAudioSourceNode | null = null; // the mic in Web Audio (for the meter and the mono track)
  private afterStop: (() => void) | null = null;
  private streamGen = 0;
  private onHide = () => {
    // Phones stop capture in the background: finish the take so it can be kept.
    if (document.visibilityState === 'hidden' && this.stage === 'recording') this.recorder!.stop();
  };

  setup(opts: RecorderOpts) {
    this.opts = opts;
    this.existing = opts.entryId ? entryById(opts.entryId) ?? null : null;
    this.kind = store.state.settings.recordKind === 'video' ? 'video' : 'audio';
    this.micSession(true);
    // The screen stays on while the recorder is open: a phone that locks mid-take ends the take.
    this.releaseAwake = keepAwake();
    // Created during the tap that opened the recorder, so iOS lets it run (for the level meter).
    this.audioCtx = AudioCtx ? new AudioCtx() : null;
    this.audioCtx?.resume?.();
    document.addEventListener('visibilitychange', this.onHide);
    this.startStream();
  }

  // The mic needs a session that allows it alongside playback (the metronome in your earbuds),
  // held while the mic is on. Not while a take is played back: in that session the iPhone plays
  // through the earpiece, not the loudspeaker, so a take would be barely audible.
  micSession(on: boolean) {
    if (on && !this.releaseRecord) this.releaseRecord = holdAudio('record');
    if (!on && this.releaseRecord) { this.releaseRecord(); this.releaseRecord = null; }
  }

  // Closing with a take in progress or unreviewed keeps it; go back once it's saved.
  closed() {
    this.isClosed = true;
    let pending: Promise<void> | null = null;
    if (this.stage === 'recording') {
      pending = new Promise<void>((resolve) => { this.afterStop = resolve; });
      this.recorder!.stop(); // onstop keeps the take
    } else if (this.take && !this.handled) pending = this.keep();
    const finish = () => {
      this.teardown();
      render();
      this.opts.back?.();
    };
    if (pending) pending.then(finish);
    else finish();
  }

  // A take being played back stops (and gives up the speaker) before it's replaced.
  willUpdate(changed: Map<string, unknown>) {
    if (changed.has('stage') && changed.get('stage') === 'review') {
      this.querySelectorAll<HTMLMediaElement>('.rec-stage.review audio, .rec-stage.review video').forEach((el) => el.pause());
    }
  }
  updated() {
    const preview = this.querySelector<HTMLVideoElement>('#rec-preview');
    if (preview && this.stream && preview.srcObject !== this.stream) preview.srcObject = this.stream;
    const player = this.querySelector<HTMLMediaElement & { _speaker?: boolean }>('.rec-stage.review audio, .rec-stage.review video');
    if (player && !player._speaker) { player._speaker = true; playOnSpeaker(player); }
  }

  render() {
    const kind = this.kind, stage = this.stage;
    if (stage === 'review' && !this.take) return nothing; // (discarded: closing)
    const tuneName = this.existing?.itemId ? itemById(this.existing.itemId)?.name : this.opts.itemId ? itemById(this.opts.itemId)?.name : '';
    const header = html`
      <div class="rec-head">
        <div class="seg rec-kind" aria-disabled=${stage === 'recording' || stage === 'review' ? 'true' : nothing}>
          ${(['audio', 'video'] as const).map((k) => html`<button class=${kind === k ? 'on' : ''} data-kind=${k} @click=${() => this.setKind(k)}>${k === 'audio' ? 'Audio' : 'Video'}</button>`)}
        </div>
        ${kind === 'video' && stage !== 'review' ? html`<button class="icon-btn small" id="rec-flip" aria-label="Switch camera" @click=${() => this.flip()}>${raw(ICON.swap)}</button>` : nothing}
      </div>
      ${this.mics.length > 1 && stage !== 'review' ? html`
        <label class="rec-mic"><span>Mic</span><select id="rec-mic" ?disabled=${stage === 'recording'} @change=${(e: Event) => this.setMic((e.target as HTMLSelectElement).value)}>${this.mics.map((m) => html`
          <option value=${m.id} ?selected=${m.id === this.currentMic()}>${m.label}</option>`)}</select></label>` : nothing}`;
    let body;
    if (stage === 'blocked') {
      body = html`${header}
        <div class="rec-stage blocked">
          <p><b>No access to the ${kind === 'video' ? 'camera or microphone' : 'microphone'}.</b></p>
          <p class="fine">Allow it for this site in your browser’s settings (on iPhone: Settings → Apps → Safari → Microphone/Camera), then try again.</p>
          <button class="pill-btn" id="rec-retry" @click=${() => this.startStream()}>Try again</button>
        </div>`;
    } else if (stage === 'review') { // (with a take)
      const take = this.take!;
      body = html`
        <p class="eyebrow">${kind === 'video' ? 'Video' : 'Audio'} · ${fmtDuration(take.ms)}${tuneName ? ` · ${tuneName}` : ''}</p>
        <div class="rec-stage review">
          ${kind === 'video' ? html`<video src=${take.url} controls playsinline></video>` : html`<audio src=${take.url} controls></audio>`}
        </div>
        ${this.existing ? nothing : html`
          <textarea id="rec-text" rows="2" placeholder="Add a note (optional)" .value=${this.opts.text || ''}></textarea>
          <input id="rec-tune" list="rec-tunes" .value=${tuneName || ''} placeholder="Tune or exercise (optional)" aria-label="Tune or exercise" autocomplete="off">
          <datalist id="rec-tunes">${linkableItems().map((t) => html`<option value=${t.name}></option>`)}</datalist>`}
        <div class="rec-actions">
          <button class="ghost-btn" id="rec-discard" @click=${() => this.discard()}>Discard</button>
          <button class="ghost-btn" id="rec-again" @click=${() => { this.dropTake(); this.startStream(); }}>Record again</button>
        </div>
        <button class="primary-btn" id="rec-keep" ?disabled=${this.keeping} @click=${async () => { this.keeping = true; await this.keep(); closeSheet(); }}>Keep</button>`;
    } else {
      const recording = stage === 'recording';
      body = html`${header}
        <div class="rec-stage ${kind}">
          ${kind === 'video' ? html`<video id="rec-preview" autoplay muted playsinline class=${this.facing === 'user' ? 'mirror' : ''}></video>` : nothing}
          <canvas id="rec-meter" width="600" height=${kind === 'video' ? 60 : 140} aria-hidden="true"></canvas>
          ${stage === 'starting' ? html`<p class="rec-wait">Waiting for the ${kind === 'video' ? 'camera' : 'microphone'}…</p>` : nothing}
        </div>
        <div class="rec-controls">
          <span class="rec-time ${recording ? 'live' : ''}" id="rec-time">${fmtDuration(this.elapsed)}</span>
          <button class="rec-btn ${recording ? 'stop' : ''}" id="rec-go" ?disabled=${stage === 'starting'}
            aria-label=${recording ? 'Stop recording' : 'Start recording'} @click=${() => (this.stage === 'recording' ? this.recorder!.stop() : this.startRecording())}><span></span></button>
          <span class="rec-hint">${recording ? 'Recording' : 'Tap to record'}</span>
        </div>
        <p class="fine rec-quiet" id="rec-quiet" ?hidden=${!this.quiet}>No sound is coming in from ${this.mics.find((m) => m.id === this.currentMic())?.label || 'the microphone'}${this.mics.length > 1 ? ' — try another Mic above' : ''}.</p>`;
    }
    return html`<div class="recorder" id="rec">${body}</div>`;
  }

  setKind(k: Clip['kind']) {
    if (this.stage === 'recording' || this.stage === 'review' || k === this.kind) return;
    this.kind = k;
    store.state.settings.recordKind = k;
    save();
    this.startStream();
  }
  flip() {
    if (this.stage === 'recording') return;
    this.facing = this.facing === 'user' ? 'environment' : 'user';
    this.startStream();
  }
  setMic(id: string) {
    const settings = store.state.settings;
    settings.recordMic = id;
    settings.recordMicLabel = this.mics.find((m) => m.id === id)?.label || null;
    save();
    this.startStream();
  }
  discard() {
    if (this.take!.ms > 20000 && !confirm('Discard this recording?')) return;
    this.dropTake();
    this.handled = true;
    closeSheet();
    toast('Recording discarded');
  }

  async startStream(): Promise<void> {
    const settings = store.state.settings;
    this.stopStream();
    this.micSession(true);
    const gen = ++this.streamGen;
    this.stage = 'starting';
    const kind = this.kind, facing = this.facing;
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia(constraints(kind, facing, settings.recordMic || null))
        // The chosen mic isn't there now (earbuds put away): the default one.
        .catch((err) => (settings.recordMic && err.name !== 'NotAllowedError'
          ? navigator.mediaDevices.getUserMedia(constraints(kind, facing)) : Promise.reject(err)));
    } catch (err) {
      if (gen !== this.streamGen) return;
      console.warn('getUserMedia failed', err);
      this.stage = 'blocked';
      return;
    }
    // Switched camera or audio/video (or closed) while this one was starting: let it go.
    if (gen !== this.streamGen || this.isClosed) return s.getTracks().forEach((tr) => tr.stop());
    this.stream = s;
    // With headphones in, the phone may switch to their mic; the phone's own is usually better for
    // an instrument (and lets the metronome play in the earbuds). Mic names show once allowed.
    // The mic is remembered by name too: iOS can give mics new ids (e.g. after asking for
    // permission again), and the old id would quietly fall back to the earbuds' mic.
    if (!this.mics.length) {
      this.mics = await listMics();
      const want = settings.recordMicLabel
        ? this.mics.find((m) => m.label === settings.recordMicLabel)
        : this.mics.find((m) => /iphone|ipad|built-?in|internal/i.test(m.label)); // first time: the phone's own
      if (want && this.mics.length > 1 && want.id !== trackMic(s) && gen === this.streamGen && !this.isClosed) {
        settings.recordMic = want.id;
        settings.recordMicLabel = want.label;
        save();
        return this.startStream();
      }
    }
    if (gen !== this.streamGen || this.isClosed) return s.getTracks().forEach((tr) => tr.stop());
    this.monoStream = null;
    this.heard = { mic: false, mono: false };
    // Earbuds can switch the audio to another rate when their mic comes on; an audio engine
    // left at the old one hears silence. Start it again to match.
    const rate = s.getAudioTracks()[0]?.getSettings?.().sampleRate;
    if (this.audioCtx && rate && this.audioCtx.sampleRate !== rate) {
      this.audioCtx.close?.().catch(() => {});
      this.audioCtx = new AudioCtx();
      this.audioCtx.resume?.().catch(() => {});
    }
    const audioCtx = this.audioCtx;
    if (audioCtx) {
      this.analyser = audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      const source = audioCtx.createMediaStreamSource(s);
      this.micSource = source;
      source.connect(this.analyser);
      // What's recorded: the mic's first channel only, as a mono track (with the camera, if any),
      // so a take plays in both ears even if the phone gives two channels with sound in one.
      try {
        const mono = audioCtx.createGain();
        mono.channelCount = 1;
        mono.channelCountMode = 'explicit';
        mono.channelInterpretation = 'discrete'; // channel 1 as it is, not averaged with a silent one
        const dest = audioCtx.createMediaStreamDestination();
        dest.channelCount = 1;
        source.connect(mono).connect(dest);
        this.monoAnalyser = audioCtx.createAnalyser();
        this.monoAnalyser.fftSize = 1024;
        mono.connect(this.monoAnalyser);
        this.monoStream = new MediaStream([...s.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      } catch (err) {
        console.warn('Recording the mic as it comes', err);
      }
    }
    this.stage = 'ready';
    this.meter();
  }

  startRecording() {
    const kind = this.kind;
    const mimeType = pickMime(kind);
    // Through Web Audio (mono) only while it's running and, if the mic has been heard, passing
    // the sound on; otherwise the mic as it comes (better two channels than silence).
    const monoWorks = this.audioCtx?.state === 'running' && (!this.heard.mic || this.heard.mono);
    const source = this.monoStream && monoWorks ? this.monoStream : this.stream!; // (recording starts once ready)
    this.quietSince = 0;
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(source, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 128000,
        ...(kind === 'video' ? { videoBitsPerSecond: 2500000 } : {}),
      });
    } catch {
      recorder = new MediaRecorder(source);
    }
    this.recorder = recorder;
    this.chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(this.tick ?? undefined);
      const blob = new Blob(this.chunks, { type: recorder.mimeType || mimeType || `${kind}/webm` });
      const ms = Date.now() - this.startedAt;
      this.take = { blob, url: URL.createObjectURL(blob), ms, stored: whileSaving(() => saveClip(blob, kind, ms)).catch(() => null) };
      this.stopStream();
      this.micSession(false); // (so the take plays on the loudspeaker)
      if (this.isClosed) return this.keep().then(() => this.afterStop?.());
      this.stage = 'review';
    };
    recorder.start(1000);
    this.startedAt = Date.now();
    this.elapsed = 0;
    this.stage = 'recording';
    this.tick = setInterval(() => { this.elapsed = Date.now() - this.startedAt; }, 250);
  }

  // Scrolling level meter from the microphone.
  meter() {
    cancelAnimationFrame(this.raf ?? 0);
    const analyser = this.analyser;
    const buf = analyser ? new Float32Array(analyser.fftSize) : null;
    const draw = () => {
      const canvas = this.querySelector<HTMLCanvasElement>('#rec-meter');
      if (!analyser || this.isClosed || analyser !== this.analyser) return;
      if (!canvas) { this.raf = requestAnimationFrame(draw); return; } // (not drawn yet)
      // (buf: made with the analyser)
      analyser.getFloatTimeDomainData(buf!);
      let peak = 0;
      for (const v of buf!) peak = Math.max(peak, Math.abs(v));
      if (peak > 0.02) this.heard.mic = true;
      if (this.monoAnalyser) {
        this.monoAnalyser.getFloatTimeDomainData(buf!);
        if (buf!.some((v) => Math.abs(v) > 0.005)) this.heard.mono = true;
        analyser.getFloatTimeDomainData(buf!); // back to the mic's, for drawing below
      }
      // Recording with nothing coming in for a few seconds: say so (and which mic it is).
      if (this.stage === 'recording' && peak < 0.003) {
        this.quietSince ||= performance.now();
        if (!this.quiet && performance.now() - this.quietSince > 3000) this.quiet = true;
      } else {
        this.quietSince = 0;
        if (this.quiet) this.quiet = false;
      }
      const levels = this.levels;
      levels.push(Math.min(1, Math.sqrt(peak)));
      if (levels.length > 75) levels.shift();
      const ctx = canvas.getContext('2d')!;
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = getComputedStyle(canvas).color;
      const bw = w / 75;
      levels.forEach((l, i) => {
        const bh = Math.max(3, l * h * 0.9);
        ctx.globalAlpha = this.stage === 'recording' ? 1 : 0.45;
        ctx.fillRect(i * bw + 1, (h - bh) / 2, bw - 3, bh);
      });
      this.raf = requestAnimationFrame(draw);
    };
    this.raf = requestAnimationFrame(draw);
  }

  // (Saving a take holds off an update's reload until the note pointing to it is saved too.)
  keep() { return whileSaving(() => this.keepTake()); }
  async keepTake() {
    if (!this.take || this.handled) return;
    this.handled = true;
    const t = this.take, opts = this.opts;
    const text = this.querySelector<HTMLTextAreaElement>('#rec-text')?.value || opts.text || '';
    const tuneInput = this.querySelector<HTMLInputElement>('#rec-tune')?.value;
    const tune = tuneInput?.trim() ? findItemByName(tuneInput) : opts.itemId ? { id: opts.itemId } : null;
    try {
      const clip = (await t.stored) ?? await saveClip(t.blob, this.kind, t.ms);
      const entry = this.existing && entryById(this.existing.id);
      if (entry) cmd.exec(cmd.updateNote, { note: entry.id, media: [...(entry.media || []), clip] });
      else cmd.exec(cmd.addNote, { text, ...(tune ? { item: tune.id } : {}), ...(opts.flag ? { flag: opts.flag } : {}), media: [clip], take: true });
      // Saved now, not in a moment: the note is what keeps the recording.
      if (!(await flush())) throw new Error('The note wasn’t saved');
      render();
      toast(entry ? 'Recording added' : 'Recording saved to your diary');
      URL.revokeObjectURL(t.url);
    } catch (err) {
      // Don't lose the take: offer it as a file instead (the URL stays alive for that).
      console.warn('Could not save recording', err);
      toast('Couldn’t save the recording — storage may be full', {
        label: 'Download',
        fn: () => {
          const a = document.createElement('a');
          a.href = t.url;
          a.download = `woodshed-take.${(t.blob.type || '').includes('mp4') ? 'mp4' : 'webm'}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        },
      });
    }
  }

  dropTake() {
    if (this.take) {
      URL.revokeObjectURL(this.take.url);
      this.take.stored.then((clip) => clip && mediaDelete(clip.id)).catch(() => {});
    }
    this.take = null;
    this.elapsed = 0;
  }
  // The mic in use: the stream's, else the chosen one.
  currentMic() { return trackMic(this.stream) || store.state.settings.recordMic; }

  stopStream() {
    cancelAnimationFrame(this.raf ?? 0);
    this.monoStream?.getAudioTracks().forEach((tr) => tr.stop());
    this.monoStream = null;
    this.micSource?.disconnect(); // the old mic's meter and mono chain go with it
    this.micSource = null;
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    this.analyser = null;
  }

  teardown() {
    this.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => el.pause());
    clearInterval(this.tick ?? undefined);
    this.stopStream();
    this.audioCtx?.close?.().catch(() => {});
    this.micSession(false);
    this.releaseAwake();
    document.removeEventListener('visibilitychange', this.onHide);
  }
}

async function listMics() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}
const trackMic = (s: MediaStream | null) => s?.getAudioTracks()[0]?.getSettings?.().deviceId || null;
