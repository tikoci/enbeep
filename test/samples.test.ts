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
