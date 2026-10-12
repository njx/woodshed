import { store, save, flush } from '../store.js';
import { esc } from '../util.js';
import { itemById } from '../practice.js';
import { addEntry, entryById, findItemByName, linkableItems } from '../diary.js';
import { canRecord, pickMime, constraints, saveClip, fmtDuration, playOnSpeaker, whileSaving } from '../media.js';
import { $, $$, ICON, render, toast, openSheet, closeSheet } from './shell.js';
import { holdAudio } from '../audiosession.js';
import { keepAwake } from '../keepawake.js';
import type { Clip, DiaryEntry, Id } from '../types.js';

// Record a practice clip, then keep it (as a diary note, or added to an existing one) or discard it.
//   opts.entryId: add the clip to this diary entry
//   opts.itemId:  link a new note to this tune
//   opts.back:    reopen the sheet this was opened from
//   opts.flag:    a new note's flag; opts.text: its text, to start with
export function openRecorder(opts: { entryId?: Id; itemId?: Id | null; flag?: DiaryEntry['flag']; text?: string; back?: () => void } = {}): void {
  if (!canRecord()) return toast('Recording isn’t supported in this browser');
  const settings = store.state.settings;
  const tunes = linkableItems();
  const existing = opts.entryId ? entryById(opts.entryId) : null;

  let kind: Clip['kind'] = settings.recordKind === 'video' ? 'video' : 'audio';
  let facing = 'user';
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let elapsed = 0;
  let take: { blob: Blob; url: string; ms: number } | null = null; // once a recording has stopped
  let state: 'starting' | 'ready' | 'recording' | 'review' | 'blocked' = 'starting';
  let mics: { id: string; label: string }[] = []; // microphones to pick from, once allowed
  let closed = false;
  let handled = false; // take kept or discarded
  let tick: ReturnType<typeof setInterval> | null = null;
  let raf: number | null = null;
  const levels: number[] = [];

  // The mic needs a session that allows it alongside playback (the metronome in your earbuds),
  // held while the mic is on. Not while a take is played back: in that session the iPhone plays
  // through the earpiece, not the loudspeaker, so a take would be barely audible.
  let releaseRecord: (() => void) | null = null;
  const micSession = (on: boolean) => {
    if (on && !releaseRecord) releaseRecord = holdAudio('record');
    if (!on && releaseRecord) { releaseRecord(); releaseRecord = null; }
  };
  const releaseAudio = () => micSession(false);
  micSession(true);
  // The screen stays on while the recorder is open: a phone that locks mid-take ends the take.
  const releaseAwake = keepAwake();
  // Created during the tap that opened the recorder, so iOS lets it run (for the level meter).
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  let audioCtx = AudioCtx ? new AudioCtx() : null;
  audioCtx?.resume?.();
  let analyser: AnalyserNode | null = null;
  let monoAnalyser: AnalyserNode | null = null; // after the mono step: to check sound comes through it
  let heard = { mic: false, mono: false }; // sound seen on the mic, and on the mono path
  let quietSince = 0; // recording with no sound coming in since (ms)
  let monoStream: MediaStream | null = null; // the stream recorded: see startStream
  let micSource: MediaStreamAudioSourceNode | null = null; // the mic in Web Audio (for the meter and the mono track)

  let afterStop: (() => void) | null = null;
  const sheet = openSheet('<div class="recorder" id="rec"></div>', () => {
    closed = true;
    // Closing with a take in progress or unreviewed keeps it; go back once it's saved.
    let pending: Promise<void> | null = null;
    if (state === 'recording') {
      pending = new Promise<void>((resolve) => { afterStop = resolve; });
      recorder!.stop(); // onstop keeps the take
    } else if (take && !handled) pending = keep();
    const finish = () => {
      teardown();
      render();
      opts.back?.();
    };
    if (pending) pending.then(finish);
    else finish();
  });
  const box = $('#rec', sheet);

  function view() {
    if (closed) return;
    // A take being played back stops (and gives up the speaker) before it's replaced.
    box.querySelectorAll<HTMLMediaElement>('.rec-stage.review audio, .rec-stage.review video').forEach((el) => el.pause());
    const tuneName = existing?.itemId ? itemById(existing.itemId)?.name : opts.itemId ? itemById(opts.itemId)?.name : '';
    const header = `
      <div class="rec-head">
        <div class="seg rec-kind" ${state === 'recording' || state === 'review' ? 'aria-disabled="true"' : ''}>
          ${['audio', 'video'].map((k) => `<button class="${kind === k ? 'on' : ''}" data-kind="${k}">${k === 'audio' ? 'Audio' : 'Video'}</button>`).join('')}
        </div>
        ${kind === 'video' && state !== 'review' ? `<button class="icon-btn small" id="rec-flip" aria-label="Switch camera">${ICON.swap}</button>` : ''}
      </div>
      ${mics.length > 1 && state !== 'review' ? `
        <label class="rec-mic"><span>Mic</span><select id="rec-mic" ${state === 'recording' ? 'disabled' : ''}>${mics.map((m) => `
          <option value="${esc(m.id)}" ${m.id === currentMic() ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select></label>` : ''}`;

    if (state === 'blocked') {
      box.innerHTML = `${header}
        <div class="rec-stage blocked">
          <p><b>No access to the ${kind === 'video' ? 'camera or microphone' : 'microphone'}.</b></p>
          <p class="fine">Allow it for this site in your browser’s settings (on iPhone: Settings → Apps → Safari → Microphone/Camera), then try again.</p>
          <button class="pill-btn" id="rec-retry">Try again</button>
        </div>`;
    } else if (state === 'review') { // (with a take)
      box.innerHTML = `
        <p class="eyebrow">${kind === 'video' ? 'Video' : 'Audio'} · ${fmtDuration(take!.ms)}${tuneName ? ` · ${esc(tuneName)}` : ''}</p>
        <div class="rec-stage review">
          ${kind === 'video'
            ? `<video src="${take!.url}" controls playsinline></video>`
            : `<audio src="${take!.url}" controls></audio>`}
        </div>
        ${existing ? '' : `
          <textarea id="rec-text" rows="2" placeholder="Add a note (optional)">${esc(opts.text || '')}</textarea>
          <input id="rec-tune" list="rec-tunes" value="${esc(tuneName || '')}" placeholder="Tune or exercise (optional)" aria-label="Tune or exercise" autocomplete="off">
          <datalist id="rec-tunes">${tunes.map((t) => `<option value="${esc(t.name)}">`).join('')}</datalist>`}
        <div class="rec-actions">
          <button class="ghost-btn" id="rec-discard">Discard</button>
          <button class="ghost-btn" id="rec-again">Record again</button>
        </div>
        <button class="primary-btn" id="rec-keep">Keep</button>`;
    } else {
      const recording = state === 'recording';
      box.innerHTML = `${header}
        <div class="rec-stage ${kind}">
          ${kind === 'video' ? `<video id="rec-preview" autoplay muted playsinline class="${facing === 'user' ? 'mirror' : ''}"></video>` : ''}
          <canvas id="rec-meter" width="600" height="${kind === 'video' ? 60 : 140}" aria-hidden="true"></canvas>
          ${state === 'starting' ? `<p class="rec-wait">Waiting for the ${kind === 'video' ? 'camera' : 'microphone'}…</p>` : ''}
        </div>
        <div class="rec-controls">
          <span class="rec-time ${recording ? 'live' : ''}" id="rec-time">${fmtDuration(elapsed)}</span>
          <button class="rec-btn ${recording ? 'stop' : ''}" id="rec-go" ${state === 'starting' ? 'disabled' : ''}
            aria-label="${recording ? 'Stop recording' : 'Start recording'}"><span></span></button>
          <span class="rec-hint">${recording ? 'Recording' : 'Tap to record'}</span>
        </div>
        <p class="fine rec-quiet" id="rec-quiet" hidden>No sound is coming in from ${esc(mics.find((m) => m.id === currentMic())?.label || 'the microphone')}${mics.length > 1 ? ' — try another Mic above' : ''}.</p>`;
      const preview = $<HTMLVideoElement>('#rec-preview', box);
      if (preview && stream) preview.srcObject = stream;
    }
    const player = $<HTMLMediaElement>('.rec-stage.review audio, .rec-stage.review video', box);
    if (player) playOnSpeaker(player);
    bind();
  }

  function bind() {
    $$('[data-kind]', box).forEach((b) => (b.onclick = () => {
      if (state === 'recording' || state === 'review' || b.dataset.kind === kind) return;
      kind = b.dataset.kind as Clip['kind']; // (data-kind: 'audio' or 'video')
      settings.recordKind = kind;
      save();
      startStream();
    }));
    const flip = $('#rec-flip', box);
    if (flip) flip.onclick = () => {
      if (state === 'recording') return;
      facing = facing === 'user' ? 'environment' : 'user';
      startStream();
    };
    const go = $('#rec-go', box);
    if (go) go.onclick = () => (state === 'recording' ? recorder!.stop() : startRecording());
    const mic = $<HTMLSelectElement>('#rec-mic', box);
    if (mic) mic.onchange = () => {
      settings.recordMic = mic.value;
      settings.recordMicLabel = mics.find((m) => m.id === mic.value)?.label || null;
      save();
      startStream();
    };
    const retry = $('#rec-retry', box);
    if (retry) retry.onclick = startStream;
    const keepBtn = $<HTMLButtonElement>('#rec-keep', box);
    if (keepBtn) keepBtn.onclick = async () => {
      keepBtn.disabled = true;
      await keep();
      closeSheet();
    };
    const again = $('#rec-again', box);
    if (again) again.onclick = () => { dropTake(); startStream(); };
    const discard = $('#rec-discard', box);
    if (discard) discard.onclick = () => {
      if (take!.ms > 20000 && !confirm('Discard this recording?')) return;
      dropTake();
      handled = true;
      closeSheet();
      toast('Recording discarded');
    };
  }

  let streamGen = 0;
  async function startStream(): Promise<void> {
    stopStream();
    micSession(true);
    const gen = ++streamGen;
    state = 'starting';
    view();
    let s: MediaStream;
    try {
      s = await navigator.mediaDevices.getUserMedia(constraints(kind, facing, settings.recordMic || null))
        // The chosen mic isn't there now (earbuds put away): the default one.
        .catch((err) => (settings.recordMic && err.name !== 'NotAllowedError'
          ? navigator.mediaDevices.getUserMedia(constraints(kind, facing)) : Promise.reject(err)));
    } catch (err) {
      if (gen !== streamGen) return;
      console.warn('getUserMedia failed', err);
      state = 'blocked';
      return view();
    }
    // Switched camera or audio/video (or closed) while this one was starting: let it go.
    if (gen !== streamGen || closed) return s.getTracks().forEach((tr) => tr.stop());
    stream = s;
    // With headphones in, the phone may switch to their mic; the phone's own is usually better for
    // an instrument (and lets the metronome play in the earbuds). Mic names show once allowed.
    // The mic is remembered by name too: iOS can give mics new ids (e.g. after asking for
    // permission again), and the old id would quietly fall back to the earbuds' mic.
    if (!mics.length) {
      mics = await listMics();
      const want = settings.recordMicLabel
        ? mics.find((m) => m.label === settings.recordMicLabel)
        : mics.find((m) => /iphone|ipad|built-?in|internal/i.test(m.label)); // first time: the phone's own
      if (want && mics.length > 1 && want.id !== trackMic(s) && gen === streamGen && !closed) {
        settings.recordMic = want.id;
        settings.recordMicLabel = want.label;
        save();
        return startStream();
      }
    }
    if (gen !== streamGen || closed) return s.getTracks().forEach((tr) => tr.stop());
    monoStream = null;
    heard = { mic: false, mono: false };
    // Earbuds can switch the audio to another rate when their mic comes on; an audio engine
    // left at the old one hears silence. Start it again to match.
    const rate = stream.getAudioTracks()[0]?.getSettings?.().sampleRate;
    if (audioCtx && rate && audioCtx.sampleRate !== rate) {
      audioCtx.close?.().catch(() => {});
      audioCtx = new AudioCtx();
      audioCtx.resume?.().catch(() => {});
    }
    if (audioCtx) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      const source = audioCtx.createMediaStreamSource(stream);
      micSource = source;
      source.connect(analyser);
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
        monoAnalyser = audioCtx.createAnalyser();
        monoAnalyser.fftSize = 1024;
        mono.connect(monoAnalyser);
        monoStream = new MediaStream([...stream.getVideoTracks(), ...dest.stream.getAudioTracks()]);
      } catch (err) {
        console.warn('Recording the mic as it comes', err);
      }
    }
    state = 'ready';
    view();
    meter();
  }

  function startRecording() {
    const mimeType = pickMime(kind);
    // Through Web Audio (mono) only while it's running and, if the mic has been heard, passing
    // the sound on; otherwise the mic as it comes (better two channels than silence).
    const monoWorks = audioCtx?.state === 'running' && (!heard.mic || heard.mono);
    const source = monoStream && monoWorks ? monoStream : stream!; // (recording starts once ready)
    quietSince = 0;
    try {
      recorder = new MediaRecorder(source, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 128000,
        ...(kind === 'video' ? { videoBitsPerSecond: 2500000 } : {}),
      });
    } catch {
      recorder = new MediaRecorder(source);
    }
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(tick ?? undefined);
      const blob = new Blob(chunks, { type: recorder!.mimeType || mimeType || `${kind}/webm` });
      take = { blob, url: URL.createObjectURL(blob), ms: Date.now() - startedAt };
      stopStream();
      micSession(false); // (so the take plays on the loudspeaker)
      if (closed) return keep().then(() => afterStop?.());
      state = 'review';
      view();
    };
    recorder.start(1000);
    startedAt = Date.now();
    elapsed = 0;
    state = 'recording';
    view();
    tick = setInterval(() => {
      elapsed = Date.now() - startedAt;
      const t = $('#rec-time', box);
      if (t) t.textContent = fmtDuration(elapsed);
    }, 250);
  }

  // Scrolling level meter from the microphone.
  function meter() {
    cancelAnimationFrame(raf ?? 0);
    const buf = analyser ? new Float32Array(analyser.fftSize) : null;
    const draw = () => {
      const canvas = $<HTMLCanvasElement>('#rec-meter', box);
      if (!canvas || !analyser || closed) return;
      // (buf: made with the analyser)
      analyser.getFloatTimeDomainData(buf!);
      let peak = 0;
      for (const v of buf!) peak = Math.max(peak, Math.abs(v));
      if (peak > 0.02) heard.mic = true;
      if (monoAnalyser) {
        monoAnalyser.getFloatTimeDomainData(buf!);
        if (buf!.some((v) => Math.abs(v) > 0.005)) heard.mono = true;
        analyser.getFloatTimeDomainData(buf!); // back to the mic's, for drawing below
      }
      // Recording with nothing coming in for a few seconds: say so (and which mic it is).
      const hint = $('#rec-quiet', box);
      if (state === 'recording' && peak < 0.003) {
        quietSince ||= performance.now();
        if (hint && performance.now() - quietSince > 3000) hint.hidden = false;
      } else {
        quietSince = 0;
        if (hint) hint.hidden = true;
      }
      levels.push(Math.min(1, Math.sqrt(peak)));
      if (levels.length > 75) levels.shift();
      const ctx = canvas.getContext('2d')!;
      const { width: w, height: h } = canvas;
      ctx.clearRect(0, 0, w, h);
      const color = getComputedStyle(canvas).color;
      ctx.fillStyle = color;
      const bw = w / 75;
      levels.forEach((l, i) => {
        const bh = Math.max(3, l * h * 0.9);
        ctx.globalAlpha = state === 'recording' ? 1 : 0.45;
        ctx.fillRect(i * bw + 1, (h - bh) / 2, bw - 3, bh);
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
  }

  // (Saving a take holds off an update's reload until the note pointing to it is saved too.)
  const keep = () => whileSaving(keepTake);
  async function keepTake() {
    if (!take || handled) return;
    handled = true;
    const t = take;
    const text = $<HTMLTextAreaElement>('#rec-text', box)?.value || opts.text || '';
    const tuneInput = $<HTMLInputElement>('#rec-tune', box)?.value;
    const tune = tuneInput?.trim() ? findItemByName(tuneInput) : opts.itemId ? { id: opts.itemId } : null;
    try {
      const clip = await saveClip(t.blob, kind, t.ms);
      const entry = existing && entryById(existing.id);
      if (entry) (entry.media ||= []).push(clip);
      else addEntry({ text, itemId: tune?.id || null, flag: opts.flag || null, media: [clip], take: true });
      await flush(); // saved now, not in a moment: the note is what keeps the recording
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

  function dropTake() {
    if (take) URL.revokeObjectURL(take.url);
    take = null;
    elapsed = 0;
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
  // The mic in use: the stream's, else the chosen one.
  const currentMic = () => trackMic(stream) || settings.recordMic;

  function stopStream() {
    cancelAnimationFrame(raf ?? 0);
    monoStream?.getAudioTracks().forEach((tr) => tr.stop());
    monoStream = null;
    micSource?.disconnect(); // the old mic's meter and mono chain go with it
    micSource = null;
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
    analyser = null;
  }

  function teardown() {
    box.querySelectorAll<HTMLMediaElement>('audio, video').forEach((el) => el.pause());
    clearInterval(tick ?? undefined);
    stopStream();
    audioCtx?.close?.().catch(() => {});
    releaseAudio();
    releaseAwake();
    document.removeEventListener('visibilitychange', onHide);
  }

  // Phones stop capture in the background: finish the take so it can be kept.
  function onHide() {
    if (document.visibilityState === 'hidden' && state === 'recording') recorder!.stop();
  }
  document.addEventListener('visibilitychange', onHide);

  startStream();
}
