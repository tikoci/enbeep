// analyze.ts — capture triage report: signal envelope + offline decode +
// sync-ratio scan + optional slot peaks. All DSP via src/* (no copies).
// Usage:
//   bun run rig/analyze.ts --file cap.wav --sym 200
//   bun run rig/analyze.ts --file cap.wav --sym 200 --slots 8.7 15 0.4
// Exit 0 when the report prints; the verdict line carries pass/fail.
import { fftMag, SYNC_FREQ } from "../src/dsp";
import { decodeRecording } from "../src/frame";
import { readWav } from "../src/wav";

const args = process.argv.slice(2);
const get = (k: string, dflt: string): string => {
  const i = args.indexOf(k);
  return i >= 0 && i + 1 < args.length ? (args[i + 1] ?? dflt) : dflt;
};

const file = get("--file", "");
const sym = Number(get("--sym", ""));
const slotsArg = args.indexOf("--slots");
if (!file || !Number.isFinite(sym) || sym <= 0) {
  console.error("usage: bun run rig/analyze.ts --file <wav> --sym <ms> [--slots <startSec> <n> <slotSec> [loHz hiHz]]");
  process.exit(2);
}

const wav = readWav(new Uint8Array(await Bun.file(file).arrayBuffer()));
const sr = wav.sampleRate;
console.log(`file=${file} sr=${sr} ch=${wav.channels} dur=${wav.durationSec.toFixed(1)}s`);

// 1. Envelope: per-second RMS shows where the frame sits in the window.
console.log("--- envelope (per-second RMS) ---");
for (let sec = 0; sec < Math.floor(wav.durationSec); sec++) {
  const seg = wav.samples.subarray(sec * sr, (sec + 1) * sr);
  let sum = 0;
  let peak = 0;
  for (const s of seg) {
    sum += s * s;
    if (Math.abs(s) > peak) peak = Math.abs(s);
  }
  const rms = Math.sqrt(sum / seg.length);
  const db = 20 * Math.log10(rms);
  console.log(`${String(sec).padStart(3)}s rms=${db.toFixed(1)}dBFS peak=${peak.toFixed(3)} ${"#".repeat(Math.max(0, Math.min(50, Math.round(db + 60))))}`);
}

// 2. The decode itself.
console.log("--- decode ---");
const t0 = Date.now();
const res = decodeRecording(wav.samples, sr, sym);
console.log(`verdict=${res.ok ? "OK" : "REJECT"} decodeMs=${Date.now() - t0}`);
for (const p of res.problems) console.log(`problem: ${p}`);
console.log(`syncs=${JSON.stringify(res.syncs.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]))}`);
if (res.sweepNibbles.length) console.log(`sweep=[${res.sweepNibbles.join(",")}] offsetHz=${res.offsetHz.toFixed(1)}`);
if (res.len !== null) {
  console.log(`len=${res.len} payload=[${(res.payload ?? []).join(",")}] sum=[${(res.sum ?? []).join(",")}] sumOk=${res.sumOk}`);
}
console.log(`sweepDropout=${res.sweepDropout} dataErasure=${res.dataErasure} marginalTones=${res.marginalTones} maxDfHz=${res.maxDfHz.toFixed(1)}`);

// 3. Sync-ratio scan: same detector math as src/dsp isSync, but reporting
// the margins, so a near-miss says HOW near instead of just "found 0".
console.log("--- sync scan (hits + near-misses; gate is ratio1>50 and ratio2>0.15) ---");
const win = Math.floor(sr * 0.1);
let best = { t: 0, r1: 0, r2: 0 };
for (let t = 0; t + 0.1 <= wav.durationSec; t += 0.5) {
  const w = wav.samples.subarray(Math.floor(t * sr), Math.floor(t * sr) + win);
  const mag = fftMag(w);
  const n = (mag.length - 1) * 2;
  let total = 0;
  let sync = 0;
  let bestF = 0;
  let bestM = -1;
  for (let i = 0; i < mag.length; i++) {
    const f = (i * sr) / n;
    const m = mag[i] ?? 0;
    total += m;
    if (Math.abs(f - SYNC_FREQ) < 50) sync += m;
    if (f >= 3000 && f <= 5000 && m > bestM) {
      bestM = m;
      bestF = f;
    }
  }
  const avg = total / mag.length;
  const r1 = sync / avg;
  const r2 = sync / total;
  if (r2 > best.r2) best = { t, r1, r2 };
  if (r1 > 50 && r2 > 0.15) {
    console.log(`SYNC  t=${t.toFixed(1)}s ratio1=${r1.toFixed(0)} ratio2=${r2.toFixed(3)} peak3-5k=${bestF.toFixed(0)}Hz`);
  } else if (r1 > 20 || r2 > 0.03) {
    console.log(`  near t=${t.toFixed(1)}s ratio1=${r1.toFixed(0)} ratio2=${r2.toFixed(3)} peak3-5k=${bestF.toFixed(0)}Hz`);
  }
}
console.log(`max ratio2=${best.r2.toFixed(3)} (ratio1=${best.r1.toFixed(0)}) at t=${best.t.toFixed(1)}s`);

// 4. Optional slot drill-down: top-3 peaks per slot (sweep/data forensics).
if (slotsArg >= 0) {
  const s0 = Number(args[slotsArg + 1]);
  const nS = Number(args[slotsArg + 2]);
  const sS = Number(args[slotsArg + 3]);
  const lo = Number(args[slotsArg + 4] ?? "1500");
  const hi = Number(args[slotsArg + 5] ?? "5000");
  if (![s0, nS, sS, lo, hi].every(Number.isFinite) || nS <= 0 || sS <= 0 || nS > 64) {
    console.error("bad --slots args (want: startSec n slotSec [loHz hiHz], n<=64)");
    process.exit(2);
  }
  console.log(`--- slots (${s0}s + ${nS}x${sS}s, ${lo}-${hi}Hz) ---`);
  for (let k = 0; k < nS; k++) {
    const t = s0 + k * sS;
    const mag = fftMag(wav.samples.subarray(Math.floor(t * sr), Math.floor((t + sS) * sr)));
    const n = (mag.length - 1) * 2;
    const bins: Array<[number, number]> = [];
    for (let i = 0; i < mag.length; i++) {
      const f = (i * sr) / n;
      if (f >= lo && f <= hi) bins.push([f, mag[i] ?? 0]);
    }
    bins.sort((p, q) => q[1] - p[1]);
    const top0 = bins[0]?.[1] ?? 1;
    const top = bins.slice(0, 3).map(([f, m]) => `${f.toFixed(0)}Hz(${(m / top0).toFixed(2)})`);
    console.log(`slot${k} t=${t.toFixed(2)}s ${top.join(" ")}`);
  }
}
