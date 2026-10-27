// synth.ts — render tone lists to idealized WAV (test fixtures, no hardware).
import { writeWav } from "./wav";
import type { Tone } from "./frame";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Concatenated sine tones at full scale * amp, optional white noise. */
export function renderTones(
  tones: Tone[],
  sampleRate: number,
  opts: { amp?: number; noise?: number; seed?: number } = {},
): Float64Array {
  const { amp = 0.5, noise = 0, seed = 1 } = opts;
  const total = Math.floor(
    tones.reduce((a, t) => a + t.ms, 0) * sampleRate * 0.001,
  );
  const out = new Float64Array(total);
  const rand = mulberry32(seed);
  let pos = 0;
  for (const t of tones) {
    const n = Math.floor(t.ms * sampleRate * 0.001);
    for (let i = 0; i < n && pos < total; i++, pos++) {
      const s = Math.sin((2 * Math.PI * t.freq * (pos / sampleRate)));
      const nz = noise > 0 ? (rand() * 2 - 1) * noise : 0;
      out[pos] = s * amp + nz;
    }
  }
  return out;
}

export function tonesToWavBytes(tones: Tone[], sampleRate: number): Uint8Array {
  return writeWav(renderTones(tones, sampleRate), sampleRate);
}
