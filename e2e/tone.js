import fs from 'node:fs';

// Writes a WAV file used as the fake microphone: a sax-like tone (weak fundamental, strong
// overtones) at concert B♭3 8 cents sharp, a pause, then concert D4 sagging from in tune to
// 25 cents flat. Chromium loops it.
export function writeTone(path) {
  const sr = 48000;
  const samples = [];
  const tone = (hz, secs, cents) => {
    let ph = 0;
    for (let i = 0; i < sr * secs; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * hz * 2 ** (cents(t) / 1200)) / sr;
      let v = 0;
      [0.5, 1, 0.7, 0.4, 0.25, 0.15].forEach((h, k) => { v += h * Math.sin(ph * (k + 1)); });
      samples.push(0.14 * v * Math.min(1, t / 0.05, (secs - t) / 0.05));
    }
  };
  const rest = (secs) => { for (let i = 0; i < sr * secs; i++) samples.push(0); };
  tone(233.08, 2.5, () => 8);
  rest(0.5);
  tone(293.66, 3, (t) => (-25 * t) / 3);
  rest(0.5);

  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32000), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path, Buffer.concat([h, data]));
}
