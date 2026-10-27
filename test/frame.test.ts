// frame.test.ts — anchor tests for the v1 frame codec (no hardware needed).
import { expect, test } from "bun:test";
import { readWav, writeWav } from "../src/wav";
import { peakFreq } from "../src/dsp";
import { decodeRecording, tonesForPayload } from "../src/frame";
import { renderTones } from "../src/synth";

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
