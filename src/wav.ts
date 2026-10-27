// wav.ts — minimal PCM WAV read/write (16-bit, mono or stereo). Zero deps.
export interface Wav {
  sampleRate: number;
  channels: number;
  samples: Float64Array; // mono mix, normalized to [-1, 1]
  durationSec: number;
}

export function readWav(buf: Uint8Array): Wav {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const str = (o: number, n: number) =>
    String.fromCharCode(...buf.subarray(o, o + n));
  if (str(0, 4) !== "RIFF" || str(8, 4) !== "WAVE") {
    throw new Error("not a RIFF/WAVE file");
  }
  let off = 12;
  let fmtChannels = 0;
  let fmtRate = 0;
  let fmtBits = 0;
  let fmtCode = 0;
  let dataStart = 0;
  let dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = str(off, 4);
    const size = v.getUint32(off + 4, true);
    if (id === "fmt ") {
      fmtCode = v.getUint16(off + 8, true);
      fmtChannels = v.getUint16(off + 10, true);
      fmtRate = v.getUint32(off + 12, true);
      fmtBits = v.getUint16(off + 22, true);
    } else if (id === "data") {
      dataStart = off + 8;
      dataLen = size;
    }
    off += 8 + size + (size % 2);
  }
  if (fmtCode !== 1 || fmtBits !== 16) {
    throw new Error(`unsupported WAV format code=${fmtCode} bits=${fmtBits}`);
  }
  if (!dataStart || !fmtRate || !fmtChannels) throw new Error("bad WAV chunks");
  const frames = Math.floor(dataLen / (fmtChannels * 2));
  const samples = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < fmtChannels; c++) {
      acc += v.getInt16(dataStart + (i * fmtChannels + c) * 2, true);
    }
    samples[i] = acc / fmtChannels / 32768;
  }
  return {
    sampleRate: fmtRate,
    channels: fmtChannels,
    samples,
    durationSec: frames / fmtRate,
  };
}

export function writeWav(
  samples: Float64Array,
  sampleRate: number,
): Uint8Array {
  const n = samples.length;
  const buf = new Uint8Array(44 + n * 2);
  const v = new DataView(buf.buffer);
  const wstr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i);
  };
  wstr(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  wstr(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    v.setInt16(44 + i * 2, Math.round(s * 32767), true);
  }
  return buf;
}
