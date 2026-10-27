// dsp.ts — FFT + tone detectors. Ports decode/analyze_recording.py logic.
export const BASE_FREQ = 2000;
export const STEP = 100;
export const SYNC_FREQ = 4000;
export const DATA_LO = 1800;
export const DATA_HI = 3700;

function revBits(x: number, bits: number): number {
  let y = 0;
  for (let i = 0; i < bits; i++) {
    y = (y << 1) | (x & 1);
    x >>= 1;
  }
  return y;
}

/** In-place radix-2 FFT magnitudes (first n/2+1 bins), zero-pads to pow2. */
export function fftMag(samples: Float64Array): Float64Array {
  let n = 1;
  while (n < samples.length) n *= 2;
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(samples);
  const bits = Math.log2(n);
  for (let i = 0; i < n; i++) {
    const j = revBits(i, bits);
    if (j > i) {
      const t = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = t;
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curR = 1;
      let curI = 0;
      for (let j = 0; j < len / 2; j++) {
        const ur = re[i + j] ?? 0;
        const ui = im[i + j] ?? 0;
        const er = re[i + j + len / 2] ?? 0;
        const ei = im[i + j + len / 2] ?? 0;
        const vr = er * curR - ei * curI;
        const vi = er * curI + ei * curR;
        re[i + j] = ur + vr;
        im[i + j] = ui + vi;
        re[i + j + len / 2] = ur - vr;
        im[i + j + len / 2] = ui - vi;
        const nr = curR * wr - curI * wi;
        curI = curR * wi + curI * wr;
        curR = nr;
      }
    }
  }
  const out = new Float64Array(n / 2 + 1);
  for (let i = 0; i <= n / 2; i++) out[i] = Math.hypot(re[i] ?? 0, im[i] ?? 0);
  return out;
}

/** Peak frequency in Hz within [lo, hi] (rectangular window, like analyzer). */
export function peakFreq(
  window: Float64Array,
  sampleRate: number,
  lo = DATA_LO,
  hi = DATA_HI,
): number {
  const mag = fftMag(window);
  const n = (mag.length - 1) * 2;
  let best = 0;
  let bestMag = -1;
  for (let i = 0; i < mag.length; i++) {
    const f = (i * sampleRate) / n;
    if (f < lo || f > hi) continue;
    const m = mag[i] ?? -1;
    if (m > bestMag) {
      bestMag = m;
      best = f;
    }
  }
  return best;
}

/**
 * True when 4000 Hz strongly dominates: tight-band (±50 Hz) power > 50x the
 * mean bin power AND > 15% of total spectral energy. Rejects 2nd harmonics
 * of data tones (which land exactly on 4000 Hz at ~1-3% energy).
 */
export function isSync(window: Float64Array, sampleRate: number): boolean {
  const mag = fftMag(window);
  const n = (mag.length - 1) * 2;
  let total = 0;
  let sync = 0;
  let anyTight = false;
  for (let i = 0; i < mag.length; i++) {
    const f = (i * sampleRate) / n;
    const m = mag[i] ?? 0;
    total += m;
    if (Math.abs(f - SYNC_FREQ) < 50) {
      sync += m;
      anyTight = true;
    }
  }
  if (!anyTight || total === 0) return false;
  const avg = total / mag.length;
  return sync / avg > 50 && sync / total > 0.15;
}

/** Scan for sync regions. Returns [startSec, endSec] pairs merged, >= minLen. */
export function findSyncs(
  samples: Float64Array,
  sampleRate: number,
  minLenSec = 0.5,
): Array<[number, number]> {
  const win = Math.floor(sampleRate * 0.1);
  const hop = Math.floor(sampleRate * 0.05);
  const flags: boolean[] = [];
  for (let s = 0; s + win <= samples.length; s += hop) {
    flags.push(isSync(samples.subarray(s, s + win), sampleRate));
  }
  const regions: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] && start < 0) start = (i * hop) / sampleRate;
    if (!flags[i] && start >= 0) {
      const end = (i * hop) / sampleRate;
      if (end - start >= minLenSec) regions.push([start, end]);
      start = -1;
    }
  }
  if (start >= 0) {
    const end = samples.length / sampleRate;
    if (end - start >= minLenSec) regions.push([start, end]);
  }
  return regions;
}

/** Center-50% peak of one tone slot (avoids edge smear between tones). */
export function tonePeak(
  slot: Float64Array,
  sampleRate: number,
  lo = DATA_LO,
  hi = DATA_HI,
): number {
  const q = Math.floor(slot.length / 4);
  return peakFreq(slot.subarray(q, slot.length - q), sampleRate, lo, hi);
}
