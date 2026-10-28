// live.test.ts — live decoder state-machine regression (no mic, no browser).
// Loads the real live.html script with stub DOM and drives its state machine
// through window.__enbeep._test with synthetic 60 fps classifier frames.
// Tone plans come from live.html's own tonesForFrame; masking/damage surgery
// mirrors test/frame.test.ts (extend the sync, drop slot 0).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { tonesForPayload } from "../src/frame";

interface LiveVerdict {
  ok: boolean;
  payload?: number[];
  maxDf?: number;
  error?: string | null;
  sweepDropout?: boolean;
  dataErasure?: boolean;
}

interface LiveTestApi {
  reset(sym: number): void;
  feed(ts: number, isSync: boolean, peakFreq: number, peakDb: number, threshDb: number): void;
  verdict(): LiveVerdict | null;
  report(): string;
  runPlan(
    tones: Array<[number, number]>,
    symMs: number,
    offsetHz: number,
    fresh: boolean,
  ): LiveVerdict | null;
}

interface EnbeepHook {
  C: { noiseFloor: number; snrDb: number };
  tonesForFrame(payload: number[], sym: number): Array<[number, number]>;
  encodeMessage(text: string): { ok: boolean; bytes?: number[]; error?: string };
  _test: LiveTestApi;
}

type Tone = [number, number]; // [freqHz, ms]

function makeEl(): Record<string, unknown> {
  const target: Record<string, unknown> = { value: "", textContent: "" };
  return new Proxy(target, {
    get(t, p: string) {
      if (p in t) return t[p];
      return () => undefined; // absorb method calls (addEventListener, ...)
    },
    set(t, p: string, v: unknown) {
      t[p] = v;
      return true;
    },
  });
}

function loadLive(): EnbeepHook {
  const html = readFileSync(new URL("../live.html", import.meta.url), "utf8");
  const open = html.indexOf("<script>");
  const close = html.indexOf("</script>");
  if (open < 0 || close < 0 || close < open) throw new Error("live.html has no inline script");
  const src = html.slice(open + "<script>".length, close);
  const els: Record<string, Record<string, unknown>> = {};
  const windowStub: Record<string, unknown> = { addEventListener: () => undefined };
  const documentStub = {
    getElementById: (id: string) => (els[id] ??= makeEl()),
    createElement: () => makeEl(),
    addEventListener: () => undefined,
    hidden: false,
  };
  const fetchStub = () => Promise.resolve(new Response("{}"));
  const run = new Function("window", "document", "fetch", src) as (
    w: unknown,
    d: unknown,
    f: unknown,
  ) => void;
  run(windowStub, documentStub, fetchStub);
  const hook = windowStub.__enbeep as EnbeepHook | undefined;
  if (!hook?._test) throw new Error("live.html exposes no window.__enbeep._test");
  return hook;
}

const live = loadLive();

// twin1 ground truth (same payload the in-page Self-test plays).
const TWIN1_PAYLOAD = [2, 65, 170, 107, 44, 179, 10, 0, 2, 15, 0];
// pierce-h1 air truth (RB953GS-5HnT, 400 ms): MAC/IP/cpus as decoded offline.
const PIERCE_PAYLOAD = [100, 209, 84, 155, 53, 229, 172, 22, 74, 194, 35];

test("browser demo tone plan matches the shared v2 encoder", () => {
  for (const payload of [TWIN1_PAYLOAD, [72, 101, 108, 108, 111]]) {
    for (const sym of [200, 400]) {
      expect(live.tonesForFrame(payload, sym)).toEqual(
        tonesForPayload(payload, sym).map(({ freq, ms }) => [freq, ms]),
      );
    }
  }
});

/**
 * Feed a tone plan as 60 fps classifier frames; return the first new
 * verdict. The loop lives in the page (_test.runPlan) so the browser
 * smoke check drives the identical code. fresh=false continues
 * listening without reset (the page's real behavior between frames).
 */
function feedPlan(
  tones: Tone[],
  symMs: number,
  offsetHz = 0,
  fresh = true,
): LiveVerdict | null {
  return live._test.runPlan(tones, symMs, offsetHz, fresh);
}

function dataStartOf(tones: Tone[]): number {
  const sep = tones.findIndex(([freq], i) => i > 0 && freq === 4000);
  if (sep < 0) throw new Error("tone plan has no SEP");
  return sep + 1;
}

/** Slow-piezo signature: the sync overruns one slot into the next tone. */
function maskSweep0(tones: Tone[], symMs: number): void {
  const pre = tones[0];
  if (!pre) throw new Error("tone plan too short");
  pre[1] += symMs;
  tones.splice(1, 1);
}

function maskData0(tones: Tone[], symMs: number): void {
  const dataStart = dataStartOf(tones);
  const sep = tones[dataStart - 1];
  if (!sep) throw new Error("tone plan too short");
  sep[1] += symMs;
  tones.splice(dataStart, 1);
}

function shiftTone(tones: Tone[], index: number, dHz: number): void {
  const t = tones[index];
  if (!t) throw new Error("tone plan too short");
  t[0] += dHz;
}

test("live clean synth frame verifies (self-test path)", () => {
  const v = feedPlan(live.tonesForFrame(TWIN1_PAYLOAD, 200), 200);
  expect(v?.ok).toBe(true);
  expect(v?.payload).toEqual(TWIN1_PAYLOAD);
  expect(v?.sweepDropout).toBe(false);
  expect(v?.dataErasure).toBe(false);
});

test("live pierce-class frame (masked sweep+data slot 0) verifies via repair", () => {
  const tones = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskSweep0(tones, 400);
  maskData0(tones, 400);
  const v = feedPlan(tones, 400, 2.5); // small pitch offset: survivors calibrate
  expect(v?.ok).toBe(true);
  expect(v?.payload).toEqual(PIERCE_PAYLOAD);
  expect(v?.maxDf ?? 99).toBeLessThan(1);
  expect(v?.sweepDropout).toBe(true);
  expect(v?.dataErasure).toBe(true);
});

test("live masked sweep alone verifies via repair", () => {
  const tones = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskSweep0(tones, 400);
  const v = feedPlan(tones, 400, 2.5);
  expect(v?.ok).toBe(true);
  expect(v?.payload).toEqual(PIERCE_PAYLOAD);
  expect(v?.sweepDropout).toBe(true);
  expect(v?.dataErasure).toBe(false);
});

test("live masked data slot 0 alone verifies via repair", () => {
  const tones = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskData0(tones, 400);
  const v = feedPlan(tones, 400, 2.5);
  expect(v?.ok).toBe(true);
  expect(v?.payload).toEqual(PIERCE_PAYLOAD);
  expect(v?.sweepDropout).toBe(false);
  expect(v?.dataErasure).toBe(true);
});

test("live repaired frame with a smudged tone still fails Fletcher-16", () => {
  const tones = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskSweep0(tones, 400);
  maskData0(tones, 400);
  shiftTone(tones, dataStartOf(tones) + 5, 100); // exact-center smear
  const v = feedPlan(tones, 400, 2.5);
  expect(v?.ok).toBe(false);
  expect(v?.error ?? "").toMatch(/fletcher mismatch/);
});

test("live erased data with unrecoverable LEN hi-nibble rejects", () => {
  const tones = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskData0(tones, 400);
  const dataStart = dataStartOf(tones);
  const s0 = tones[dataStart]; // corrupt S0: hi = (11-6)/16 not integer
  if (!s0) throw new Error("tone plan too short");
  s0[0] = 2600;
  const v = feedPlan(tones, 400);
  expect(v?.ok).toBe(false);
  expect(v?.error ?? "").toMatch(/unrecoverable/);
});

test("live dropout sweep with a wrong survivor still rejects", () => {
  const tones = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskSweep0(tones, 400);
  shiftTone(tones, 2, 100); // survivor nibble 2 reads 3
  const v = feedPlan(tones, 400);
  expect(v?.ok).toBe(false);
  expect(v?.error ?? "").toMatch(/sweep mismatch/);
});

test("live straddled grid (confident wrong LEN) repairs via fallback", () => {
  const tones = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskData0(tones, 400);
  const dataStart = dataStartOf(tones);
  tones.splice(dataStart + 27, 0, [2000, 400]); // junk 28th slot
  const v = feedPlan(tones, 400);
  expect(v?.ok).toBe(true);
  expect(v?.payload).toEqual(PIERCE_PAYLOAD);
  expect(v?.dataErasure).toBe(true);
});

test("live straddled grid with corrupt interior still rejects byte count", () => {
  const tones = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskData0(tones, 400);
  const dataStart = dataStartOf(tones);
  tones.splice(dataStart + 27, 0, [2000, 400]);
  shiftTone(tones, dataStart + 10, 200); // interior damage: fail closed
  const v = feedPlan(tones, 400);
  expect(v?.ok).toBe(false);
  expect(v?.error ?? "").toMatch(/vs 14 bytes/);
});

test("live diagnostics report covers verdicts, repair flags, and log tail", () => {
  // Fail first (wrong survivor), then verify pierce-class without reset:
  // continuous listening, like the real page.
  const bad = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskSweep0(bad, 400);
  shiftTone(bad, 2, 100);
  expect(feedPlan(bad, 400)?.ok).toBe(false);
  const good = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskSweep0(good, 400);
  maskData0(good, 400);
  expect(feedPlan(good, 400, 2.5, false)?.ok).toBe(true);
  const report = live._test.report();
  expect(report).toContain("### frame verdicts (2)");
  expect(report).toContain("✓ 64:D1:54:9B:35:E5 172.22.74.194 cpu 35");
  expect(report).toContain("repair sweep+data");
  expect(report).toContain("✗ sweep mismatch");
  expect(report).toContain("### log tail");
  expect(report).toContain("preamble locked");
  expect(report).toContain("- sym: 400 ms");
  expect(report).toContain("Router model / RouterOS version");
});

test("live diagnostics report before any frame says so", () => {
  live._test.reset(200);
  const report = live._test.report();
  expect(report).toContain("### frame verdicts (0)");
  expect(report).toContain("(none yet");
});

test("live report carries env block, counters, and drop histogram", () => {
  // Mixed session without reset: two distinct rejects, then a verify.
  const bad = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskSweep0(bad, 400);
  shiftTone(bad, 2, 100); // sweep mismatch
  expect(feedPlan(bad, 400)?.ok).toBe(false);
  const straddle = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskData0(straddle, 400);
  const ds = dataStartOf(straddle);
  straddle.splice(ds + 27, 0, [2000, 400]);
  shiftTone(straddle, ds + 10, 200); // interior damage: byte count
  expect(feedPlan(straddle, 400, 0, false)?.ok).toBe(false);
  const good = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskSweep0(good, 400);
  maskData0(good, 400);
  expect(feedPlan(good, 400, 2.5, false)?.ok).toBe(true);
  const report = live._test.report();
  expect(report).toContain("### drop reasons (2)");
  expect(report).toContain("- sweep mismatch ×1");
  expect(report).toContain("- byte count ×1");
  expect(report).toContain("frames attempted: 3 · verified: 1");
  expect(report).toContain("- secure: unknown");
  expect(report).toContain("- audio: none (start listening or run checks)");
  expect(report).toContain("inputs seen: unknown");
});

test("live histogram resets with the session", () => {
  const bad = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskSweep0(bad, 400);
  shiftTone(bad, 2, 100);
  expect(feedPlan(bad, 400)?.ok).toBe(false);
  expect(live._test.report()).toContain("### drop reasons (1)");
  live._test.reset(400);
  const report = live._test.report();
  expect(report).toContain("### drop reasons (0)");
  expect(report).toContain("frames attempted: 0");
});

test("live encodeMessage validates the Try-tab sender (1..255 bytes)", () => {
  expect(live.encodeMessage("")).toEqual({ ok: false, error: expect.stringContaining("Type a message") });
  expect(live.encodeMessage("Hello")).toEqual({ ok: true, bytes: [72, 101, 108, 108, 111] });
  const tooLong = live.encodeMessage("x".repeat(256));
  expect(tooLong.ok).toBe(false);
  expect(tooLong.error ?? "").toMatch(/256 bytes/);
});

test("live 11-byte text is readable, not MAC/IP only", () => {
  const text = [72, 101, 108, 108, 111, 32, 87, 111, 114, 108, 100]; // "Hello World"
  const v = feedPlan(live.tonesForFrame(text, 200), 200);
  expect(v?.ok).toBe(true);
  expect(v?.payload).toEqual(text);
  expect(live._test.report()).toContain('as text "Hello World"');
});

test("live report keeps the previous attempt across one reset", () => {
  const bad = live.tonesForFrame(PIERCE_PAYLOAD, 400);
  maskSweep0(bad, 400);
  shiftTone(bad, 2, 100);
  expect(feedPlan(bad, 400)?.ok).toBe(false);
  live._test.reset(400);
  const report = live._test.report();
  expect(report).toContain("### frame verdicts (0)");
  expect(report).toContain("### previous session (1, kept across one reset)");
  expect(report).toContain("✗ sweep mismatch");
  expect(report).toContain("drops: sweep mismatch ×1");
});
