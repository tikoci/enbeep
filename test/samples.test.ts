// samples.test.ts — archive regression: every real bigdude recording decodes
// as it did when captured. Locks the margin-reject behavior.
import { expect, test } from "bun:test";
import { readWav } from "../src/wav";
import { decodeRecording } from "../src/frame";

const MAC_IP = [116, 77, 40, 56, 179, 205, 172, 22, 74, 254];

async function decodeSample(name: string, sym: number) {
  const f = Bun.file(new URL(`../samples/${name}`, import.meta.url));
  const wav = readWav(new Uint8Array(await f.arrayBuffer()));
  return decodeRecording(wav.samples, wav.sampleRate, sym);
}

test("probe sweep-only decodes 0..15", async () => {
  const res = await decodeSample("bigdude-probe1.wav", 200);
  expect(res.ok).toBe(true);
  expect(res.len).toBeNull();
  expect(res.sweepNibbles).toEqual([...Array(16).keys()]);
});

// v1 captures (byte-sum era): the v2 decoder must reject them loudly with
// "byte count", never decode them as v2. (v2 air captures extend this file.)
for (const [name, sym] of [
  ["bigdude-frame-200a.wav", 200],
  ["bigdude-frame-200b.wav", 200],
  ["bigdude-frame-200c.wav", 200],
  ["bigdude-frame-300.wav", 300],
  ["bigdude-frame-100.wav", 100],
  ["bigdude-frame-200micB-a.wav", 200],
  ["bigdude-frame-200micB-b.wav", 200],
] as Array<[string, number]>) {
  test(`${name} (v1) is rejected as a format break, not decoded`, async () => {
    const res = await decodeSample(name, sym);
    expect(res.ok).toBe(false);
    expect(res.problems.join(" ")).toMatch(/byte count/);
    // ...but the sweep that identifies the capture still reads clean.
    expect(res.sweepNibbles).toEqual([...Array(16).keys()]);
  });
}

// v2 captures (Fletcher-16 era): exact decodes + one transient reject.
for (const name of ["bigdude-v2-200a.wav", "bigdude-v2-gap-b.wav"]) {
  test(`${name} decodes exact MAC/IP with Fletcher verified`, async () => {
    const res = await decodeSample(name, 200);
    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.payload!.slice(0, 10)).toEqual(MAC_IP);
    expect(res.sum).toHaveLength(2);
    expect(res.sumOk).toBe(true);
    expect(res.maxDfHz).toBeLessThan(50);
  });
}

test("bigdude-v2-gap-a transient is rejected, not decoded", async () => {
  const res = await decodeSample("bigdude-v2-gap-a.wav", 200);
  expect(res.ok).toBe(false);
  expect(res.problems.join(" ")).toMatch(/sweep mismatch/);
});

test("bigdude-v2-200micB-c decodes exact under late windows", async () => {
  // Was a Fletcher reject under center sampling (tone-22 smear); the late
  // window [50%,90%] lets the 3400 Hz ring decay before sampling 2000 Hz.
  const res = await decodeSample("bigdude-v2-200micB-c.wav", 200);
  expect(res.problems).toEqual([]);
  expect(res.ok).toBe(true);
  expect(res.payload!.slice(0, 10)).toEqual(MAC_IP);
  expect(res.sumOk).toBe(true);
});

// iPhone-trial captures (mic B control receiver, late-window decoder).
for (const name of ["bigdude-v2-200micB-d.wav", "bigdude-v2-200micB-e.wav"]) {
  test(`${name} decodes exact`, async () => {
    const res = await decodeSample(name, 200);
    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.payload!.slice(0, 10)).toEqual(MAC_IP);
    expect(res.sumOk).toBe(true);
  });
}

test("bigdude-v2-300micB-b decodes exact at 300 ms", async () => {
  const res = await decodeSample("bigdude-v2-300micB-b.wav", 300);
  expect(res.problems).toEqual([]);
  expect(res.ok).toBe(true);
  expect(res.payload!.slice(0, 10)).toEqual(MAC_IP);
  expect(res.sumOk).toBe(true);
});

test("bigdude-v2-200micB-r3 short tone 0 breaks framing, rejected", async () => {
  // Box-side glitch: tone 0 plays ~120 ms, so no window reads LEN cleanly.
  const res = await decodeSample("bigdude-v2-200micB-r3.wav", 200);
  expect(res.ok).toBe(false);
  expect(res.problems.join(" ")).toMatch(/byte count/);
});

for (const name of [
  "bigdude-v2-200micB-r4.wav", // smear in Fletcher bytes (tone 26)
  "bigdude-v2-200micB-r5.wav", // checksum-byte smear
  "bigdude-v2-200micB-r8.wav", // deepest tone-22 smear (late-proof)
]) {
  test(`${name} is correctly rejected`, async () => {
    const res = await decodeSample(name, 200);
    expect(res.ok).toBe(false);
    expect(res.payload!.slice(0, 10)).toEqual(MAC_IP); // address always survives
  });
}

// pierce (RB953GS-5HnT, 7.16.2) air captures: slow piezo + metal case ring
// mask slot 0 after each sync. Second-hardware generality proof.
const PIERCE_MAC_IP = [100, 209, 84, 155, 53, 229, 172, 22, 74, 194];

for (const [name, sym] of [
  ["pierce-g1.wav", 200],
  ["pierce-k2.wav", 200],
  ["pierce-h1.wav", 400],
  ["pierce-h2.wav", 400],
  ["pierce-m1.wav", 400],
  ["pierce-m2.wav", 400],
] as Array<[string, number]>) {
  test(`${name} decodes exact via slot-0 repair`, async () => {
    const res = await decodeSample(name, sym);
    expect(res.problems).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.sweepDropout).toBe(true);
    expect(res.dataErasure).toBe(true);
    expect(res.payload!.slice(0, 10)).toEqual(PIERCE_MAC_IP);
    expect(res.sumOk).toBe(true);
  });
}

test("pierce-g2.wav sweep edge tone clipped by SEP, rejected", async () => {
  const res = await decodeSample("pierce-g2.wav", 200);
  expect(res.ok).toBe(false);
  expect(res.problems.join(" ")).toMatch(/sweep mismatch/);
});

test("pierce-k1.wav rounding straddle with drift, rejected", async () => {
  // Grid one slot late AND drifting: repair correctly fails closed.
  const res = await decodeSample("pierce-k1.wav", 200);
  expect(res.ok).toBe(false);
  expect(res.problems.join(" ")).toMatch(/byte count/);
});

test("pierce-s2-300.wav weak-tone sweep scramble, rejected", async () => {
  const res = await decodeSample("pierce-s2-300.wav", 300);
  expect(res.ok).toBe(false);
  expect(res.problems.join(" ")).toMatch(/sweep mismatch/);
});
