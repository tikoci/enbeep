// frame.test.ts — anchor tests for the v1 frame codec (no hardware needed).
import { expect, test } from "bun:test";
import { peakFreq } from "../src/dsp";
import { decodeRecording, tonesForPayload } from "../src/frame";
import { renderTones } from "../src/synth";
import { readWav, writeWav } from "../src/wav";

const SR = 48000;

// twin1 dry-run ground truth: MAC 02:41:AA:6B:2C:B3, IP 10.0.2.15, cpu 0.
const TWIN1_PAYLOAD = [2, 65, 170, 107, 44, 179, 10, 0, 2, 15, 0];

test("wav round-trips PCM16", () => {
  const s = new Float64Array([0, 0.5, -0.5, 1, -1]);
  const back = readWav(writeWav(s, SR));
  expect(back.sampleRate).toBe(SR);
  expect(back.samples.length).toBe(5);
  for (let i = 0; i < 5; i++) expect(back.samples[i] ?? NaN).toBeCloseTo(s[i] ?? NaN, 3);
});

test("wav reads PCM32 (MiC-native arecord format)", () => {
  // writeWav only writes 16-bit, so build the S32_LE mono RIFF by hand.
  const vals = [0, 0.5, -0.5, 1, -1];
  const data = new Uint8Array(vals.length * 4);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < vals.length; i++) {
    dv.setInt32(i * 4, Math.round((vals[i] ?? 0) * 2147483647), true);
  }
  const head = new Uint8Array(44);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const wstr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) head[o + i] = s.charCodeAt(i);
  };
  wstr(0, "RIFF");
  hv.setUint32(4, 36 + data.length, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  hv.setUint32(16, 16, true);
  hv.setUint16(20, 1, true);
  hv.setUint16(22, 1, true);
  hv.setUint32(24, SR, true);
  hv.setUint32(28, SR * 4, true);
  hv.setUint16(32, 4, true);
  hv.setUint16(34, 32, true);
  wstr(36, "data");
  hv.setUint32(40, data.length, true);
  const buf = new Uint8Array(44 + data.length);
  buf.set(head, 0);
  buf.set(data, 44);
  const back = readWav(buf);
  expect(back.sampleRate).toBe(SR);
  expect(back.samples.length).toBe(vals.length);
  for (let i = 0; i < vals.length; i++) {
    expect(back.samples[i] ?? NaN).toBeCloseTo(vals[i] ?? NaN, 3);
  }
});

test("peakFreq finds a pure tone", () => {
  const n = SR >> 1; // 0.5 s
  const s = new Float64Array(n);
  for (let i = 0; i < n; i++) s[i] = 0.5 * Math.sin((2 * Math.PI * 2500 * i) / SR);
  expect(peakFreq(s, SR)).toBeCloseTo(2500, 0);
});

test("synth frame decodes with verified checksum", () => {
  const wav = renderTones(tonesForPayload(TWIN1_PAYLOAD, 200), SR);
  const res = decodeRecording(wav, SR, 200);
  expect(res.problems).toEqual([]);
  expect(res.ok).toBe(true);
  expect(res.sweepNibbles).toEqual([...Array(16).keys()]);
  expect(Math.abs(res.offsetHz)).toBeLessThan(3);
  expect(res.len).toBe(11);
  expect(res.payload).toEqual(TWIN1_PAYLOAD);
  expect(res.sumOk).toBe(true);
});

test("tampered tone fails Fletcher-16, not silently", () => {
  const tones = tonesForPayload(TWIN1_PAYLOAD, 200);
  const victim = tones[tones.length - 3];
  if (!victim) throw new Error("tone plan too short");
  victim.freq += 100; // corrupt last data tone
  const res = decodeRecording(renderTones(tones, SR), SR, 200);
  expect(res.ok).toBe(false);
  expect(res.problems.join(" ")).toMatch(/checksum/);
});

test("exact-center smear (micB-b signature) fails Fletcher-16", () => {
  // Ring-down smear lands exactly on a wrong center (df ~ 0), so only the
  // checksum can catch it. Replay tone 22 of micB-b: 2000 Hz read as 3400.
  const tones = tonesForPayload(TWIN1_PAYLOAD, 200);
  const dataStart = 1 + 16 + 1; // pre + sweep + sep
  tones[dataStart + 22] = { freq: 3400, ms: 200 };
  const res = decodeRecording(renderTones(tones, SR), SR, 200);
  expect(res.ok).toBe(false);
  expect(res.marginalTones).toBe(0); // confidently wrong — checksum's catch
  expect(res.problems.join(" ")).toMatch(/checksum/);
});

test("noisy frame (20 dB SNR) still decodes", () => {
  const tones = tonesForPayload([72, 105], 200); // "Hi"
  const wav = renderTones(tones, SR, { amp: 0.5, noise: 0.05, seed: 7 });
  const res = decodeRecording(wav, SR, 200);
  expect(res.ok).toBe(true);
  expect(res.payload).toEqual([72, 105]);
});

test("real bigdude probe sweep decodes 0..15", async () => {
  const f = Bun.file(new URL("../samples/bigdude-probe1.wav", import.meta.url));
  const wav = readWav(new Uint8Array(await f.arrayBuffer()));
  const res = decodeRecording(wav.samples, wav.sampleRate, 200);
  expect(res.ok).toBe(true);
  expect(res.syncs.length).toBe(2);
  expect(res.sweepNibbles).toEqual([...Array(16).keys()]);
  expect(Math.abs(res.offsetHz)).toBeLessThan(5);
});

// Slow-piezo masking (pierce RB953 signature): a loud sync rings one slot
// into the next tone. Simulated by extending the sync and dropping slot 0.
test("masked slot 0 (sweep 1..15 + 27 data tones) still decodes exact", () => {
  const tones = tonesForPayload(TWIN1_PAYLOAD, 200);
  const pre = tones[0];
  if (!pre) throw new Error("tone plan too short");
  pre.ms += 200; // PRE overruns into sweep tone 0
  tones.splice(1, 1); // drop sweep nibble 0 -> 15 survivors
  const dataStart = 1 + 15 + 1; // pre + sweep + sep (post-drop indices)
  const sep = tones[dataStart - 1];
  if (!sep) throw new Error("tone plan too short");
  sep.ms += 200; // SEP overruns into data slot 0 (LEN hi-nibble)
  tones.splice(dataStart, 1); // drop data tone 0 -> 27 survivors
  const res = decodeRecording(renderTones(tones, SR), SR, 200);
  expect(res.problems).toEqual([]);
  expect(res.ok).toBe(true);
  expect(res.sweepDropout).toBe(true);
  expect(res.dataErasure).toBe(true);
  expect(res.sweepNibbles).toEqual([-1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  expect(res.len).toBe(11);
  expect(res.payload).toEqual(TWIN1_PAYLOAD);
  expect(res.sumOk).toBe(true);
});

test("dropout sweep with a wrong survivor still rejects", () => {
  const tones = tonesForPayload(TWIN1_PAYLOAD, 200);
  const pre = tones[0];
  if (!pre) throw new Error("tone plan too short");
  pre.ms += 200;
  tones.splice(1, 1);
  const corrupt = tones[2]; // survivor nibble 2 -> reads 3
  if (!corrupt) throw new Error("tone plan too short");
  corrupt.freq += 100;
  const res = decodeRecording(renderTones(tones, SR), SR, 200);
  expect(res.ok).toBe(false);
  expect(res.problems.join(" ")).toMatch(/sweep mismatch/);
});

test("erased data with unrecoverable LEN hi-nibble rejects", () => {
  const tones = tonesForPayload(TWIN1_PAYLOAD, 200);
  const dataStart = 1 + 16 + 1;
  const sep = tones[dataStart - 1];
  if (!sep) throw new Error("tone plan too short");
  sep.ms += 200;
  tones.splice(dataStart, 1); // 27 survivors; S0 = LEN-lo = 11
  const s0 = tones[dataStart]; // corrupt S0: hi = (11-6)/16 not integer
  if (!s0) throw new Error("tone plan too short");
  s0.freq = 2600;
  const res = decodeRecording(renderTones(tones, SR), SR, 200);
  expect(res.ok).toBe(false);
  expect(res.problems.join(" ")).toMatch(/unrecoverable/);
});

// Rounding straddle (pierce k1 signature): slot 0 masked but the window
// still measures full, so the grid sits one slot late reading true tones
// 1..27 and LEN reads (B,0)=0xB0 with df ~ 0. Structural repair rescues it.
test("straddled grid (confident wrong LEN) repairs via fallback", () => {
  const tones = tonesForPayload(TWIN1_PAYLOAD, 200);
  const dataStart = 1 + 16 + 1;
  const sep = tones[dataStart - 1];
  if (!sep) throw new Error("tone plan too short");
  sep.ms += 200; // overrun absorbs tone 0's time...
  tones.splice(dataStart, 1); // ...tone 0 gone, grid one late...
  tones.splice(dataStart + 27, 0, { freq: 2000, ms: 200 }); // ...junk 28th slot
  const res = decodeRecording(renderTones(tones, SR), SR, 200);
  expect(res.ok).toBe(true);
  expect(res.dataErasure).toBe(true);
  expect(res.len).toBe(11);
  expect(res.payload).toEqual(TWIN1_PAYLOAD);
  expect(res.sumOk).toBe(true);
});

test("confident-wrong LEN hi-nibble repairs via count (bigdude yo)", () => {
  const tones = tonesForPayload([121, 111], 200);
  const dataStart = 1 + 16 + 1;
  const s0 = tones[dataStart];
  if (!s0) throw new Error("tone plan too short");
  s0.freq += 200; // LEN 0x02 -> 0x22, loud and confident
  const res = decodeRecording(renderTones(tones, SR), SR, 200);
  expect(res.ok).toBe(true);
  expect(res.dataErasure).toBe(true);
  expect(res.len).toBe(2);
  expect(res.payload).toEqual([121, 111]);
  expect(res.sumOk).toBe(true);
});

test("straddled grid with corrupt interior still rejects byte count", () => {
  const tones = tonesForPayload(TWIN1_PAYLOAD, 200);
  const dataStart = 1 + 16 + 1;
  const sep = tones[dataStart - 1];
  if (!sep) throw new Error("tone plan too short");
  sep.ms += 200;
  tones.splice(dataStart, 1);
  tones.splice(dataStart + 27, 0, { freq: 2000, ms: 200 });
  const corrupt = tones[dataStart + 10];
  if (!corrupt) throw new Error("tone plan too short");
  corrupt.freq += 200; // interior damage: repair must fail closed
  const res = decodeRecording(renderTones(tones, SR), SR, 200);
  expect(res.ok).toBe(false);
  expect(res.problems.join(" ")).toMatch(/byte count/);
});
