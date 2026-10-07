import { store, save } from '../store.js';
import { esc } from '../util.js';
import { itemById } from '../practice.js';
import { addEntry, entryById, findItemByName, linkableItems } from '../diary.js';
import { canRecord, pickMime, constraints, saveClip, fmtDuration } from '../media.js';
import { $, $$, ICON, render, toast, openSheet, closeSheet } from './shell.js';
import { holdAudio } from '../audiosession.js';

// Record a practice clip, then keep it (as a diary note, or added to an existing one) or discard it.
//   opts.entryId: add the clip to this diary entry
//   opts.itemId:  link a new note to this tune
//   opts.back:    reopen the sheet this was opened from
export function openRecorder(opts = {}) {
  if (!canRecord()) return toast('Recording isn’t supported in this browser');
  const settings = store.state.settings;
  const tunes = linkableItems();
  const existing = opts.entryId ? entryById(opts.entryId) : null;

  let kind = settings.recordKind === 'video' ? 'video' : 'audio';
  let facing = 'user';
  let stream = null;
  let recorder = null;
  let chunks = [];
  let startedAt = 0;
  let elapsed = 0;
  let take = null; // { blob, url, ms } once a recording has stopped
  let state = 'starting'; // starting | ready | recording | review | blocked
  let mics = []; // microphones to pick from, once allowed: [{ id, label }]
  let closed = false;
  let handled = false; // take kept or discarded
  let tick = null;
  let raf = null;
  let wakeLock = null;
  const levels = [];

  // The mic needs a session that allows it alongside playback (the metronome in your earbuds).
  // Held until the recorder closes, so the metronome isn't interrupted between takes.
  const releaseAudio = holdAudio('record');
  // Created during the tap that opened the recorder, so iOS lets it run (for the level meter).
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  const audioCtx = AudioCtx ? new AudioCtx() : null;
  audioCtx?.resume?.();
  let analyser = null;

  let afterStop = null;
  const sheet = openSheet('<div class="recorder" id="rec"></div>', () => {
    closed = true;
    // Closing with a take in progress or unreviewed keeps it; go back once it's saved.
    let pending = null;
    if (state === 'recording') {
      pending = new Promise((resolve) => { afterStop = resolve; });
      recorder.stop(); // onstop keeps the take
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
    } else if (state === 'review') {
      box.innerHTML = `
        <p class="eyebrow">${kind === 'video' ? 'Video' : 'Audio'} · ${fmtDuration(take.ms)}${tuneName ? ` · ${esc(tuneName)}` : ''}</p>
        <div class="rec-stage review">
          ${kind === 'video'
            ? `<video src="${take.url}" controls playsinline></video>`
            : `<audio src="${take.url}" controls></audio>`}
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
        </div>`;
      const preview = $('#rec-preview', box);
      if (preview && stream) preview.srcObject = stream;
    }
    bind();
  }

  function bind() {
    $$('[data-kind]', box).forEach((b) => (b.onclick = () => {
      if (state === 'recording' || state === 'review' || b.dataset.kind === kind) return;
      kind = b.dataset.kind;
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
    if (go) go.onclick = () => (state === 'recording' ? recorder.stop() : startRecording());
    const mic = $('#rec-mic', box);
    if (mic) mic.onchange = () => {
      settings.recordMic = mic.value;
      save();
      startStream();
    };
    const retry = $('#rec-retry', box);
    if (retry) retry.onclick = startStream;
    const keepBtn = $('#rec-keep', box);
    if (keepBtn) keepBtn.onclick = async () => {
      keepBtn.disabled = true;
      await keep();
      closeSheet();
    };
    const again = $('#rec-again', box);
    if (again) again.onclick = () => { dropTake(); startStream(); };
    const discard = $('#rec-discard', box);
    if (discard) discard.onclick = () => {
      if (take.ms > 20000 && !confirm('Discard this recording?')) return;
      dropTake();
      handled = true;
      closeSheet();
      toast('Recording discarded');
    };
  }

  let streamGen = 0;
  async function startStream() {
    stopStream();
    const gen = ++streamGen;
    state = 'starting';
    view();
    let s;
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
    if (!mics.length) {
      mics = await listMics();
      const builtIn = mics.find((m) => /iphone|ipad|built-?in|internal/i.test(m.label));
      if (!settings.recordMic && builtIn && mics.length > 1 && builtIn.id !== trackMic(s) && gen === streamGen && !closed) {
        settings.recordMic = builtIn.id;
        save();
        return startStream();
      }
    }
    if (gen !== streamGen || closed) return s.getTracks().forEach((tr) => tr.stop());
    if (audioCtx) {
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
    }
    state = 'ready';
    view();
    meter();
  }

  function startRecording() {
    const mimeType = pickMime(kind);
    try {
      recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 128000,
        ...(kind === 'video' ? { videoBitsPerSecond: 2500000 } : {}),
      });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      clearInterval(tick);
      releaseWakeLock();
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || `${kind}/webm` });
      take = { blob, url: URL.createObjectURL(blob), ms: Date.now() - startedAt };
      stopStream();
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
    // Keep the screen on while recording, where supported.
    navigator.wakeLock?.request('screen').then((l) => { wakeLock = l; }).catch(() => {});
  }

  // Scrolling level meter from the microphone.
  function meter() {
    cancelAnimationFrame(raf);
    const buf = analyser ? new Float32Array(analyser.fftSize) : null;
    const draw = () => {
      const canvas = $('#rec-meter', box);
      if (!canvas || !analyser || closed) return;
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      levels.push(Math.min(1, Math.sqrt(peak)));
      if (levels.length > 75) levels.shift();
      const ctx = canvas.getContext('2d');
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

  async function keep() {
    if (!take || handled) return;
    handled = true;
    const t = take;
    const text = $('#rec-text', box)?.value || opts.text || '';
    const tuneInput = $('#rec-tune', box)?.value;
    const tune = tuneInput?.trim() ? findItemByName(tuneInput) : opts.itemId ? { id: opts.itemId } : null;
    try {
      const clip = await saveClip(t.blob, kind, t.ms);
      const entry = existing && entryById(existing.id);
      if (entry) (entry.media ||= []).push(clip);
      else addEntry({ text, itemId: tune?.id || null, flag: opts.flag || null, media: [clip] });
      save();
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
  const trackMic = (s) => s?.getAudioTracks()[0]?.getSettings?.().deviceId || null;
  // The mic in use: the stream's, else the chosen one.
  const currentMic = () => trackMic(stream) || settings.recordMic;

  function stopStream() {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((tr) => tr.stop());
    stream = null;
    analyser = null;
  }

  function releaseWakeLock() {
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
  }

  function teardown() {
    clearInterval(tick);
    releaseWakeLock();
    stopStream();
    audioCtx?.close?.().catch(() => {});
    releaseAudio();
    document.removeEventListener('visibilitychange', onHide);
  }

  // Phones stop capture in the background: finish the take so it can be kept.
  function onHide() {
    if (document.visibilityState === 'hidden' && state === 'recording') recorder.stop();
  }
  document.addEventListener('visibilitychange', onHide);

  startStream();
}
