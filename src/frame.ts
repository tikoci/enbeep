// frame.ts — enbeep v2 frame codec. Mirrors encode/enbeep-frame.rsc.
// Layout: PRE(2s sync + 16-tone sweep) · SEP(1s) · LEN+payload+FLETCHER16 · END(1s)
// (No SOF/EOF tones: 1-tone 4000 Hz markers merge into the adjacent 1s syncs.
// v2 replaces the v1 byte-sum with Fletcher-16 after a real 1/256-class
// false-accept on air; v1 captures fail here with "byte count."
// Slow piezo + resonant case (pierce RB953): a loud 1-2 s sync rings ~1 slot
// into the next tone, masking data slot 0. Sweep tolerates a missing tone 0
// (survivors must be exactly 1..15); data repairs an erased LEN hi-nibble
// structurally (LEN is forced by frame size) under Fletcher-16. Any other
// shape still rejects.)
import { BASE_FREQ, DATA_HI, DATA_LO, STEP, SYNC_FREQ, findSyncs, tonePeak } from "./dsp";

export interface Tone {
  freq: number;
  ms: number;
}

/** Build the full tone list for a payload, exactly as the .rsc plays it. */
export function tonesForPayload(payload: number[], symMs: number): Tone[] {
  const tones: Tone[] = [];
  const sync = (ms: number) => tones.push({ freq: SYNC_FREQ, ms });
  const data = (nib: number) => tones.push({ freq: BASE_FREQ + nib * STEP, ms: symMs });
  sync(2000);
  for (let n = 0; n < 16; n++) data(n);
  sync(1000);
  const len = payload.length;
  const [f1, f2] = fletcher16([len, ...payload]);
  for (const b of [len, ...payload, f1, f2]) {
    data(Math.floor(b / 16));
    data(b % 16);
  }
  sync(1000);
  return tones;
}

export interface FrameResult {
  ok: boolean;
  problems: string[];
  syncs: Array<[number, number]>;
  sweepNibbles: number[];
  offsetHz: number;
  /** Per-data-tone residual vs assigned nibble center, Hz (after offset). */
  toneDf: number[];
  maxDfHz: number;
  marginalTones: number;
  len: number | null;
  payload: number[] | null;
  /** Fletcher-16 check bytes [f1, f2]. */
  sum: number[] | null;
  sumOk: boolean;
  /** Sweep slot 0 masked by sync overrun; calibrated on tones 1..15. */
  sweepDropout: boolean;
  /** Data slot 0 (LEN hi-nibble) masked; repaired structurally. */
  dataErasure: boolean;
}

/**
 * Band-guard threshold. Note round() bounds interior residuals to <=50 Hz by
 * construction, so this only fires on clamped edge tones (peak outside the
 * data band entirely). Real smear detection comes from the Fletcher-16 check
 * below, not from margins — see the v2 note in docs.
 */
export const MARGIN_HZ = 50;

/** Fletcher-16 over bytes (arithmetic only — no bitwise ops needed). */
export function fletcher16(bytes: number[]): [number, number] {
  let s1 = 0;
  let s2 = 0;
  for (const b of bytes) {
    s1 = (s1 + b) % 255;
    s2 = (s2 + s1) % 255;
  }
  return [s1, s2];
}

const fail = (partial: Partial<FrameResult>, why: string): FrameResult => ({
  ok: false,
  problems: [...(partial.problems ?? []), why],
  syncs: partial.syncs ?? [],
  sweepNibbles: partial.sweepNibbles ?? [],
  offsetHz: partial.offsetHz ?? 0,
  toneDf: partial.toneDf ?? [],
  maxDfHz: partial.maxDfHz ?? 0,
  marginalTones: partial.marginalTones ?? 0,
  len: partial.len ?? null,
  payload: partial.payload ?? null,
  sum: partial.sum ?? null,
  sumOk: false,
  sweepDropout: partial.sweepDropout ?? false,
  dataErasure: partial.dataErasure ?? false,
});

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2) return s[mid] ?? 0;
  return ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export function decodeRecording(
  samples: Float64Array,
  sampleRate: number,
  symMs: number,
): FrameResult {
  const syncs = findSyncs(samples, sampleRate);
  if (syncs.length < 2) {
    return fail({ syncs }, `want >=2 sync regions, found ${syncs.length}`);
  }
  // Sweep segment between first two syncs.
  const s0 = syncs[0];
  const s1 = syncs[1];
  if (!s0 || !s1) return fail({ syncs }, "sync regions vanished");
  const [s0e, s1s] = [s0[1], s1[0]];
  const sweep = samples.subarray(Math.floor(s0e * sampleRate), Math.floor(s1s * sampleRate));
  const nTones = Math.round(sweep.length / sampleRate / (symMs / 1000));
  const sweepDropout = nTones === 15;
  if (nTones !== 16 && !sweepDropout) {
    return fail({ syncs }, `sweep has ${nTones} tones, want 16`);
  }
  const nSweep = sweepDropout ? 15 : 16;
  const firstNib = sweepDropout ? 1 : 0;
  const slotLen = sweep.length / nSweep;
  const sweepNibbles: number[] = sweepDropout ? [-1] : [];
  const offsets: number[] = [];
  for (let n = firstNib; n < 16; n++) {
    const k = n - firstNib;
    const slot = sweep.subarray(Math.floor(k * slotLen), Math.floor((k + 1) * slotLen));
    const f = tonePeak(slot, sampleRate);
    const expected = BASE_FREQ + n * STEP;
    offsets.push(f - expected);
    sweepNibbles.push(Math.round((f - expected) / STEP) + n);
  }
  const offsetHz = median(offsets);
  const sweepOk = sweepNibbles.every((v, i) => (sweepDropout && i === 0 ? v === -1 : v === i));
  const base = { syncs, sweepNibbles, offsetHz, sweepDropout };
  if (!sweepOk) {
    return fail(base, `sweep mismatch: [${sweepNibbles.join(",")}]`);
  }
  if (syncs.length < 3) {
    // Sweep-only recording (e.g. probe-short): calibration success is the result.
    return {
      ok: true, problems: [], ...base, toneDf: [], maxDfHz: 0, marginalTones: 0,
      len: null, payload: null, sum: null, sumOk: false, dataErasure: false,
    };
  }
  // Payload section between syncs[1] and syncs[2].
  const s1b = syncs[1];
  const s2 = syncs[2];
  if (!s1b || !s2) return fail({ syncs }, "sync regions vanished");
  const seg = samples.subarray(
    Math.floor(s1b[1] * sampleRate), Math.floor(s2[0] * sampleRate));
  const nSec = Math.round(seg.length / sampleRate / (symMs / 1000));
  // Odd window: post-sync masking ate data slot 0 (LEN hi-nibble) after the
  // 1 s SEP; the measured tones are played tones 1..nSec. Repaired
  // structurally below (frame size forces LEN) under Fletcher-16.
  const dataErasure = nSec % 2 === 1;
  const secLen = seg.length / nSec;
  const measured: number[] = [];
  for (let i = 0; i < nSec; i++) {
    const slot = seg.subarray(Math.floor(i * secLen), Math.floor((i + 1) * secLen));
    // Narrow data band (a v1 SOF/EOF leftover admitted 4000 Hz SEP tails)
    // + late window: ring decays while the driven tone holds, so the
    // slot's second half discriminates loud→quiet transitions best.
    measured.push(tonePeak(slot, sampleRate, DATA_LO, DATA_HI, 0.5, 0.1));
  }
  if (measured.length < (dataErasure ? 5 : 6)) {
    return fail(base, `data section too short: ${measured.length} tones`);
  }
  const toNib = (f: number) => {
    const n = Math.round((f - offsetHz - BASE_FREQ) / STEP);
    return Math.max(0, Math.min(15, n));
  };

  const verify = (
    nibs: number[],
    frqs: number[],
    erased: boolean,
    allowFallback: boolean,
  ): FrameResult => {
    const toneDf = frqs.map((f, i) => f - offsetHz - (BASE_FREQ + (nibs[i] ?? 0) * STEP));
    const maxDfHz = toneDf.reduce((a, d) => Math.max(a, Math.abs(d)), 0);
    const marginalTones = toneDf.filter((d) => Math.abs(d) > MARGIN_HZ).length;
    const margined = { ...base, toneDf, maxDfHz, marginalTones, dataErasure: erased };
    const bytes: number[] = [];
    for (let i = 0; i < nibs.length; i += 2) {
      bytes.push((nibs[i] ?? 0) * 16 + (nibs[i + 1] ?? 0));
    }
    const len = bytes[0];
    if (len === undefined) return fail({ ...base }, "empty data section");
    if (marginalTones > 0) {
      return fail(
        { ...margined, len, payload: bytes.slice(1), sum: bytes.slice(-2) },
        `${marginalTones} tones outside data band (max |df| ${maxDfHz.toFixed(0)} Hz)`,
      );
    }
    if (bytes.length !== len + 3) {
      // Rounding straddle: slot 0 masked but the window still measured full,
      // so the grid sits one slot late reading true tones 1..27 (k1: LEN
      // reads (B,6)=182, all df ~ 0). Reinterpret slots 0..n-2 as tones
      // 1..n-1 and re-verify from scratch — structural LEN plus Fletcher-16,
      // never a blind accept. Checksum failures never reach here
      // (exact-center smear must keep failing); only confident structural
      // misses qualify.
      if (allowFallback && marginalTones === 0 && maxDfHz <= 25 && nibs.length >= 6) {
        const re = repairErasure(nibs.slice(0, -1), frqs.slice(0, -1));
        // Success adopts the repaired verdict; failure keeps the original
        // byte-count verdict (message-stable: v1 format breaks still read
        // "byte count", never "checksum mismatch").
        if (re && re.ok) return re;
      }
      return fail({ ...margined, len }, `byte count ${bytes.length} != len+3 for len=${len}`);
    }
    const payload = bytes.slice(1, 1 + len);
    const sum = bytes.slice(1 + len);
    const [e1, e2] = fletcher16([len, ...payload]);
    const sumOk = sum.length === 2 && sum[0] === e1 && sum[1] === e2;
    if (!sumOk) {
      return fail({ ...margined, len, payload, sum }, "checksum mismatch");
    }
    return { ok: true, problems: [], ...margined, len, payload, sum, sumOk };
  };

  const repairErasure = (sNibs: number[], sFrqs: number[]): FrameResult | null => {
    const nB = (sNibs.length + 1) / 2;
    if (!Number.isInteger(nB)) return null;
    const wantLen = nB - 3;
    const lo = sNibs[0] ?? -1;
    const hi = (wantLen - lo) / 16;
    if (lo < 0 || !Number.isInteger(hi) || hi < 0 || hi > 15) return null;
    // Synthetic slot 0 at its assigned center: df 0 by construction,
    // excluded from the marginal count (unmeasured, checksum-guarded).
    return verify(
      [hi, ...sNibs],
      [offsetHz + BASE_FREQ + hi * STEP, ...sFrqs],
      true,
      false,
    );
  };

  if (dataErasure) {
    const re = repairErasure(
      measured.map(toNib),
      measured,
    );
    if (re) return re;
    return fail(
      { ...base, dataErasure },
      `data slot 0 masked, LEN hi-nibble unrecoverable (${nSec} tones)`,
    );
  }
  return verify(measured.map(toNib), measured, false, true);
}
