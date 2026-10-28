// browser-smoke.ts — NS-7 headless check through the REAL page.
// Runs the server with a temp working directory (keeps the repo's
// frames.jsonl free of smoke-test rows), loads it in headless Chromium,
// and asserts: (A) the real Web Audio self-test verifies end-to-end,
// (B) a corrupted synth frame rejects through the page's _test driver,
// (C1/C2) the guided checks pass on quiet file-fed capture and flag
// room+band on loud in-band capture, (E) the Try sender end to end,
// (D) the harness frame/probe distinction, plus zero pageerrors.
// Not part of `bun test` (needs a browser);
// CI runs it, locally: bunx playwright install chromium   (once)
//                    bun run test:browser
import { writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { writeWav } from "../src/wav";

// Type-only: `window` below appears solely inside functions serialized
// into the browser by evaluate/waitForFunction, never at Bun runtime.
// (The repo tsconfig carries no DOM lib on purpose.)
declare const window: unknown;

const PORT = 3937;
const ROOT = new URL("..", import.meta.url).pathname;

function fail(msg: string): never {
  throw new Error(`browser-smoke FAIL: ${msg}`);
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() <= end) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await Bun.sleep(200);
  }
  fail(`server never came up at ${url}`);
}

interface PageVerdict {
  ok: boolean;
  payload?: number[];
  error?: string | null;
}

interface PageHook {
  tonesForFrame(p: number[], s: number): Array<[number, number]>;
  _test: {
    verdict(): PageVerdict | null;
    report(): string;
    runPlan(
      tones: Array<[number, number]>,
      sym: number,
      offset: number,
      fresh: boolean,
    ): PageVerdict | null;
    checks(): {
      running: boolean;
      results: Array<{ name: string; ok: boolean; detail: string }>;
    };
  };
}

const tmp = await mkdtemp(join(tmpdir(), "enbeep-smoke-"));

// Deterministic capture fixtures for (C): quiet room vs loud in-band
// whine, fed as the fake mic. Seeded LCG, not Math.random.
function lcg(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}
const CAP_SR = 48000;
const CAP_SECS = 8;
function captureWav(kind: "quiet" | "loudband"): Uint8Array {
  const n = CAP_SECS * CAP_SR;
  const out = new Float64Array(n);
  const rand = lcg(kind === "quiet" ? 7 : 99);
  for (let i = 0; i < n; i++) {
    // Quiet sits ~18 dB above the mic-silence gate and ~27 dB below
    // the room-loud gate: a live mic in a quiet room, with margin.
    const noise = (rand() * 2 - 1) * (kind === "quiet" ? 0.008 : 0.001);
    out[i] =
      kind === "quiet"
        ? noise
        : 0.5 * Math.sin((2 * Math.PI * 2500 * i) / CAP_SR) + noise;
  }
  return writeWav(out, CAP_SR);
}
const quietWav = join(tmp, "quiet.wav");
const loudWav = join(tmp, "loudband.wav");
writeFileSync(quietWav, captureWav("quiet"));
writeFileSync(loudWav, captureWav("loudband"));

interface CheckRow {
  name: string;
  ok: boolean;
  detail: string;
}

async function runChecksWithCapture(captureFile: string): Promise<CheckRow[]> {
  const b = await chromium.launch({
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      `--use-file-for-fake-audio-capture=${captureFile}`,
    ],
  });
  try {
    const p = await b.newPage();
    const errs: string[] = [];
    p.on("pageerror", (e) => errs.push(String(e)));
    await p.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
    await p.waitForFunction(
      () => (window as unknown as { __enbeep?: object }).__enbeep !== undefined,
      null,
      { timeout: 15000 },
    );
    await p.click("#tabDiag");
    await p.click("#checksBtn");
    await p.waitForFunction(
      () => {
        const s = (window as unknown as { __enbeep: PageHook }).__enbeep._test.checks();
        return !s.running && s.results.length === 7;
      },
      null,
      { timeout: 120000, polling: 500 },
    );
    if (errs.length > 0) fail(`page errors during file-fed checks: ${errs.join(" | ")}`);
    return await p.evaluate(
      () => (window as unknown as { __enbeep: PageHook }).__enbeep._test.checks().results,
    );
  } finally {
    await b.close();
  }
}

const server = Bun.spawn([process.execPath, join(ROOT, "serve.ts")], {
  cwd: tmp,
  env: { ...process.env, PORT: String(PORT) },
  stdout: "ignore",
  stderr: "ignore",
});
try {
  await waitFor(`http://localhost:${PORT}/`, 30000);
  for (const path of ["index.html", "live.html", "harness.html", "wav-decode.js", "SPEC.md", "enbeep.rsc"]) {
    const response = await fetch(`http://localhost:${PORT}/${path}`);
    if (!response.ok || !(await response.text()).length) fail(`missing local surface: ${path}`);
  }

  const browser = await chromium.launch({
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  try {
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") console.log("[console.error]", msg.text());
    });
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
    await page.waitForFunction(
      () => (window as unknown as { __enbeep?: object }).__enbeep !== undefined,
      null,
      { timeout: 15000 },
    );

    // (A) real self-test: oscillators -> analyser -> state machine.
    await page.click("#tabDiag");
    await page.click("#selfBtn");
    await page.waitForFunction(
      () =>
        (window as unknown as { __enbeep: PageHook }).__enbeep._test.verdict() !==
        null,
      null,
      { timeout: 90000, polling: 500 },
    );
    const self = await page.evaluate(
      () => (window as unknown as { __enbeep: PageHook }).__enbeep._test.verdict(),
    );
    if (!self?.ok || self.payload?.length !== 11) {
      fail(`self-test should verify 11 bytes, got ${JSON.stringify(self)}`);
    }
    // Synth sessions must not report mic-path measurements: clip and
    // band stats come from the oscillator feed, not a microphone.
    const selfReport = await page.evaluate(
      () => (window as unknown as { __enbeep: PageHook }).__enbeep._test.report(),
    );
    if (!selfReport.includes("clip peak n/a") || !selfReport.includes("- band: n/a (synth feed)")) {
      fail(`synth session must report clip/band n/a, got ${JSON.stringify(selfReport)}`);
    }
    console.log("PASS (A) real Web Audio self-test verifies 11 bytes");

    // (B) corrupted synth frame rejects through the page driver.
    const bad = await page.evaluate(() => {
      const api = (window as unknown as { __enbeep: PageHook }).__enbeep;
      const tones = api.tonesForFrame(
        [100, 209, 84, 155, 53, 229, 172, 22, 74, 194, 35],
        400,
      );
      const pre = tones[0];
      if (!pre) throw new Error("tone plan too short");
      pre[1] += 400;
      tones.splice(1, 1); // mask sweep slot 0
      const sep = tones.findIndex((t, i) => i > 0 && t[0] === 4000);
      const sepTone = tones[sep];
      if (!sepTone) throw new Error("tone plan has no SEP");
      sepTone[1] += 400;
      tones.splice(sep + 1, 1); // mask data slot 0
      const ds = tones.findIndex((t, i) => i > 0 && t[0] === 4000) + 1;
      const victim = tones[ds + 5];
      if (!victim) throw new Error("tone plan too short");
      victim[0] += 100; // exact-center smear: checksum must catch it
      return api._test.runPlan(tones, 400, 2.5, true);
    });
    if (bad?.ok !== false || !/fletcher mismatch/.test(bad?.error ?? "")) {
      fail(`corrupted frame should reject (fletcher), got ${JSON.stringify(bad)}`);
    }
    console.log("PASS (B) corrupted frame rejects:", bad?.error);

    // (C1) guided checks on quiet file-fed capture: everything passes.
    const quiet = await runChecksWithCapture(quietWav);
    const quietFailed = quiet.filter((c) => !c.ok);
    if (quiet.length !== 7 || quietFailed.length > 0) {
      fail(`quiet-capture checks should all pass, got ${JSON.stringify(quiet)}`);
    }
    console.log(
      "PASS (C1) guided checks pass on quiet capture:",
      quiet.map((c) => c.name).join(","),
    );

    // (C2) guided checks on loud in-band capture: room + band fail,
    // everything else passes.
    const loud = await runChecksWithCapture(loudWav);
    const byName: Record<string, boolean> = Object.fromEntries(
      loud.map((c) => [c.name, c.ok]),
    );
    const want: Record<string, boolean> = {
      context: true,
      audio: true,
      mic: true,
      room: false,
      clip: true,
      band: false,
      synth: true,
    };
    for (const [name, ok] of Object.entries(want)) {
      if (byName[name] !== ok) {
        fail(`loud-capture check ${name} should be ${ok}, got ${JSON.stringify(loud)}`);
      }
    }
    console.log("PASS (C2) guided checks flag room+band on loud in-band capture");

    // (E) Try-tab sender end to end: validation, RouterOS preview sync,
    // and a real "Hi" frame through Web Audio into the state machine.
    // Reload first: check B leaves the machine listening, and Play
    // starts its own session from IDLE.
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(
      () => (window as unknown as { __enbeep?: object }).__enbeep !== undefined,
      null,
      { timeout: 15000 },
    );
    await page.click("#tabTry");
    await page.fill("#tryMsg", "");
    await page.click("#playBtn");
    const tryErr = await page.locator("#tryErr").textContent();
    if (!tryErr || !/Type a message/.test(tryErr)) {
      fail(`empty message should validate, tryErr=${JSON.stringify(tryErr)}`);
    }
    await page.fill("#tryMsg", "Hi");
    const rosLive = await page.locator("#rosLive").textContent();
    if (rosLive !== '$enbeepText "Hi" 200ms 200ms no') {
      fail(`RouterOS preview should follow the message, got ${JSON.stringify(rosLive)}`);
    }
    const tryMeta = await page.locator("#tryMeta").textContent();
    if (!tryMeta || !/2 bytes/.test(tryMeta)) {
      fail(`sender meta should count bytes, got ${JSON.stringify(tryMeta)}`);
    }
    await page.click("#playBtn");
    await page.waitForFunction(
      () =>
        (window as unknown as { __enbeep: PageHook }).__enbeep._test.verdict()
          ?.payload?.length === 2,
      null,
      { timeout: 90000, polling: 500 },
    );
    const hi = await page.evaluate(
      () => (window as unknown as { __enbeep: PageHook }).__enbeep._test.verdict(),
    );
    if (!hi?.ok || JSON.stringify(hi.payload) !== "[72,105]") {
      fail(`Try sender should verify "Hi", got ${JSON.stringify(hi)}`);
    }
    console.log('PASS (E) Try-tab sender plays + verifies "Hi" end to end');

    // (D) actual local harness: verified frame and sweep-only distinction.
    await page.goto(`http://localhost:${PORT}/harness.html`);
    await page.setInputFiles("#file", join(ROOT, "samples/bigdude-v2-200a.wav"));
    await page.locator("#verdict").filter({ hasText: "✓ VERIFIED" }).waitFor();
    await page.setInputFiles("#file", join(ROOT, "samples/bigdude-probe1.wav"));
    await page.locator("#verdict").filter({ hasText: "CALIBRATION ONLY" }).waitFor();
    console.log("PASS (D) local harness verifies a frame and labels a probe calibration-only");

    if (pageErrors.length > 0) fail(`page errors: ${pageErrors.join(" | ")}`);
    console.log("PASS page loaded with zero pageerrors");
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
  await rm(tmp, { recursive: true, force: true });
}
console.log("browser-smoke: all green");
