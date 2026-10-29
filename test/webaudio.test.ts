// webaudio.test.ts — deterministic audio-session lifecycle tests (NS-31).
// Loads the real live.html script with stub DOM + stub audio (no mic, no
// browser) and drives its session owner through window.__enbeep._test:
// single-flight startup with Cancel, cleanup on every failure stage,
// exclusive mic-vs-synth ownership, device vanish, mute/unmute/end,
// suspend/resume, and fresh-verdict checks. Real-timing playback is
// covered by test/browser-smoke.ts (A/E); the fake clock here advances
// 5 s per read so tone-wait loops finish in milliseconds.
import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

interface SessionSnapshot {
  state: string;
  starting: boolean;
  inflight: number;
  synthPlaying: boolean;
  checksRunning: boolean;
  sessionIsSynth: boolean;
  interrupted: string | null;
  dead: boolean;
  micFailed: string | null;
  micFailedDetail: {
    stage: string;
    name: string;
    message: string;
    constraint: string | null;
    selected: string | null;
    t: number;
  } | null;
  appliedLabel: string | null;
  startLabel: string;
  selfDisabled: boolean;
  playDisabled: boolean;
  checksDisabled: boolean;
  micDisabled: boolean;
  micValue: string;
  status: string;
  tryErr: string;
  life: Array<{ t: number; name: string; detail: string }>;
}

interface CheckRow {
  name: string;
  ok: boolean;
  detail: string;
  blocked: boolean;
}

interface LifecycleTestApi {
  feed(
    ts: number,
    isSync: boolean,
    peakFreq: number,
    peakDb: number,
    threshDb: number,
    syncDb: number,
    dataDb: number,
  ): void;
  report(): string;
  runPlan(
    tones: Array<[number, number]>,
    symMs: number,
    offsetHz: number,
    fresh: boolean,
  ): { ok: boolean; payload?: number[]; error?: string | null } | null;
  checks(): { running: boolean; results: CheckRow[] };
  start(): Promise<void>;
  stop(): void;
  selfTest(): Promise<boolean>;
  play(): Promise<boolean>;
  runChecks(): Promise<void>;
  devices(): Promise<void>;
  setTryMsg(v: string): void;
  setOpTimeout(ms: number): void;
  session(): SessionSnapshot;
}

interface LifecycleHook {
  C: { noiseFloor: number; snrDb: number };
  tonesForFrame(payload: number[], sym: number): Array<[number, number]>;
  _test: LifecycleTestApi;
}

// --- Stub audio -----------------------------------------------------------

class FakeTrack {
  readyState = "live";
  muted = false;
  stopped = false;
  onended: (() => void) | null = null;
  onmute: (() => void) | null = null;
  onunmute: (() => void) | null = null;
  constructor(
    public label: string,
    private settings: Record<string, number | boolean | null>,
  ) {}
  stop(): void {
    this.stopped = true;
    this.readyState = "ended";
  }
  getSettings(): Record<string, number | boolean | null> {
    return { ...this.settings };
  }
}

class FakeStream {
  constructor(public tracks: FakeTrack[]) {}
  getAudioTracks(): FakeTrack[] {
    return this.tracks;
  }
  getTracks(): FakeTrack[] {
    return this.tracks;
  }
}

function newMicStream(label: string): FakeStream {
  return new FakeStream([
    new FakeTrack(label, {
      sampleRate: 48000,
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    }),
  ]);
}

interface DeviceDesc {
  kind: string;
  deviceId: string;
  label: string;
}

interface PageScript {
  devices?: DeviceDesc[];
  enumerateFails?: boolean;
  gum?: (constraints: unknown) => Promise<FakeStream>;
  ctxFailCtor?: boolean;
  ctxStartSuspended?: boolean;
  ctxResumeStuck?: boolean;
  ctxResumeHangs?: boolean;
  failGraph?: boolean;
  wakeLock?: boolean;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// --- Stub DOM -------------------------------------------------------------

interface MiniOption {
  value: string;
  textContent: string;
  text: string;
  disabled: boolean;
}

function newOption(): MiniOption {
  return { value: "", textContent: "", text: "", disabled: false };
}

// Functional <select>: the picker tests need real option semantics
// (value restore, vanished-device fallback). text mirrors textContent
// the way a real HTMLOptionElement does.
class MiniSelect {
  options: MiniOption[] = [{ ...newOption(), textContent: "Default input", text: "Default input" }];
  selectedIndex = 0;
  disabled = false;
  title = "";
  get value(): string {
    return this.options[this.selectedIndex]?.value ?? "";
  }
  set value(v: string) {
    const i = this.options.findIndex((o) => o.value === v);
    this.selectedIndex = Math.max(i, 0);
  }
  set innerHTML(_: string) {
    this.options = [{ ...newOption(), textContent: "Default input", text: "Default input" }];
    this.selectedIndex = 0;
  }
  appendChild(o: MiniOption): MiniOption {
    o.text = o.textContent;
    this.options.push(o);
    return o;
  }
  addEventListener(): void {}
}

function makeEl(init?: Record<string, unknown>): Record<string, unknown> {
  const target: Record<string, unknown> = { value: "", textContent: "", ...(init ?? {}) };
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

const LIVE_SRC = (() => {
  const html = readFileSync(new URL("../live.html", import.meta.url), "utf8");
  const open = html.indexOf("<script>");
  const close = html.indexOf("</script>");
  if (open < 0 || close < 0 || close < open) throw new Error("live.html has no inline script");
  return html.slice(open + "<script>".length, close);
})();

interface LoadedPage {
  api: LifecycleTestApi;
  hook: LifecycleHook;
  micSel: MiniSelect;
  gumCalls: unknown[];
  streams: FakeStream[];
  ctxInstances: FakeCtx[];
  gainTotal: () => number;
  mdListeners: Record<string, Array<() => void>>;
  docListeners: Record<string, Array<(...a: unknown[]) => void>>;
  docStub: Record<string, unknown>;
  wakeRequests: number;
  sentinels: AnyRecord[];
  ticks: Array<(ts: number) => void>;
  setDevices(devs: DeviceDesc[]): void;
  fireDeviceChange(): void;
}

// biome-ignore lint/suspicious/noExplicitAny: stub file; fakes cross the untyped page boundary.
type AnyRecord = Record<string, any>;

type AnalyserMode = "quiet" | "sync";

class FakeAnalyser {
  mode: AnalyserMode = "quiet";
  fftSize = 4096;
  frequencyBinCount = 2048;
  smoothingTimeConstant = 0;
  getFloatFrequencyData(buf: Float32Array): void {
    if (this.mode === "quiet") {
      buf.fill(-80);
      return;
    }
    // Loud sync band for tick-driven tests: binHz = 48000/4096, so
    // 3900–4100 Hz lands on bins 332..350.
    buf.fill(-90);
    for (let i = 325; i <= 355 && i < buf.length; i++) buf[i] = -20;
  }
  getFloatTimeDomainData(buf: Float32Array): void {
    buf.fill(0);
  }
  connect(): void {}
  disconnect(): void {}
}

class FakeCtx {
  sampleRate = 48000;
  state = "running";
  resumeCalls = 0;
  closed = false;
  gainCount = 0;
  analysers: FakeAnalyser[] = [];
  listeners: Record<string, Array<() => void>> = {};
  private clock = 0;
  constructor(private script: PageScript) {
    if (script.ctxFailCtor) throw new Error("ctx ctor boom");
    if (script.ctxStartSuspended) this.state = "suspended";
  }
  // Advancing clock: tone-wait loops finish in ms instead of wall-sleeping
  // the frame. Scheduling math still works (end times derive from reads).
  get currentTime(): number {
    const v = this.clock;
    this.clock += 5;
    return v;
  }
  async resume(): Promise<void> {
    this.resumeCalls++;
    if (this.script.ctxResumeHangs) await new Promise<void>(() => {});
    else if (!this.script.ctxResumeStuck) this.state = "running";
  }
  async close(): Promise<void> {
    this.closed = true;
    this.state = "closed";
  }
  createMediaStreamSource(_s: unknown): { connect(): void; disconnect(): void } {
    if (this.script.failGraph) throw new Error("graph boom");
    return { connect() {}, disconnect() {} };
  }
  createAnalyser(): FakeAnalyser {
    const an = new FakeAnalyser();
    this.analysers.push(an);
    return an;
  }
  createGain(): AnyRecord {
    this.gainCount++;
    return { gain: { value: 0 }, connect() {}, disconnect() {} };
  }
  createOscillator(): AnyRecord {
    return {
      frequency: { value: 0 },
      type: "",
      connect() {},
      disconnect() {},
      start() {},
      stop() {},
      onended: null,
    };
  }
  addEventListener(t: string, f: () => void): void {
    const list = this.listeners[t] ?? [];
    list.push(f);
    this.listeners[t] = list;
  }
  fireState(s: string): void {
    this.state = s;
    for (const f of this.listeners.statechange ?? []) f();
  }
}

function loadPage(script: PageScript = {}): LoadedPage {
  let devices: DeviceDesc[] = script.devices ?? [];
  const gumCalls: unknown[] = [];
  const streams: FakeStream[] = [];
  const ctxInstances: FakeCtx[] = [];
  const mdListeners: Record<string, Array<() => void>> = {};
  const docListeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  const sentinels: AnyRecord[] = [];
  let wakeRequests = 0;

  const mediaDevices = {
    enumerateDevices: async (): Promise<DeviceDesc[]> => {
      if (script.enumerateFails) throw new Error("enumeration denied");
      return devices.map((d) => ({ ...d }));
    },
    getUserMedia: (c: unknown): Promise<FakeStream> => {
      gumCalls.push(c);
      const p = script.gum ? script.gum(c) : Promise.resolve(newMicStream("Fake Mic"));
      void p.then(
        (s) => streams.push(s),
        () => {}, // the page owns the rejection; the tap must not throw unhandled
      );
      return p;
    },
    addEventListener: (t: string, f: () => void): void => {
      const list = mdListeners[t] ?? [];
      list.push(f);
      mdListeners[t] = list;
    },
  };
  const nav: AnyRecord = { userAgent: "webaudio-test", mediaDevices };
  if (script.wakeLock) {
    nav.wakeLock = {
      request: async (_kind: string): Promise<AnyRecord> => {
        wakeRequests++;
        const listeners: Record<string, Array<() => void>> = {};
        const sentinel: AnyRecord = {
          released: false,
          addEventListener: (t: string, f: () => void): void => {
            const list = listeners[t] ?? [];
            list.push(f);
            listeners[t] = list;
          },
          release: async (): Promise<void> => {
            for (const f of listeners.release ?? []) f();
          },
          __fireRelease: (): void => {
            for (const f of listeners.release ?? []) f();
          },
        };
        sentinels.push(sentinel);
        return sentinel;
      },
    };
  }
  (globalThis as AnyRecord).navigator = nav;
  // Capture rAF callbacks without running them: tick-driven tests invoke
  // the real loop by hand with scripted timestamps.
  const ticks: Array<(ts: number) => void> = [];
  (globalThis as AnyRecord).requestAnimationFrame = (cb: (ts: number) => void): number => {
    ticks.push(cb);
    return ticks.length;
  };
  (globalThis as AnyRecord).location = { protocol: "https:", host: "test", href: "https://test/" };

  const Ctx = class extends FakeCtx {
    constructor() {
      super(script);
      ctxInstances.push(this);
    }
  };
  const windowStub: AnyRecord = {
    addEventListener: () => undefined,
    AudioContext: Ctx,
    isSecureContext: true,
  };

  const gfx = {
    fillRect() {},
    getImageData: () => ({}),
    putImageData() {},
    createImageData: () => ({ data: [] }),
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
  };
  const micSel = new MiniSelect();
  const els: Record<string, AnyRecord> = {
    micSel: micSel as unknown as AnyRecord,
    // Buttons need real disabled/text state: the guards read them, and a
    // proxy's absorb-anything function is truthy (would fake "disabled").
    startBtn: makeEl({ textContent: "Start Listening", className: "", disabled: false }),
    selfBtn: makeEl({ textContent: "Self-test", disabled: false }),
    playBtn: makeEl({ textContent: "Play message", disabled: false }),
    checksBtn: makeEl({ textContent: "Run checks", disabled: false }),
    symSel: makeEl({ value: "200" }),
    waterfall: makeEl({ width: 0, height: 0, getContext: () => gfx }),
    waterfallWrap: makeEl({
      getBoundingClientRect: () => ({ width: 300 }),
      querySelectorAll: () => [],
      appendChild: () => undefined,
    }),
    senderNote: makeEl({ value: "" }),
  };
  const documentStub: AnyRecord = {
    getElementById: (id: string): unknown => (els[id] ??= makeEl(
      id === "freqLabel" || id === "nibbleLabel" || id === "confLabel"
        ? { classList: { add() {}, remove() {} } }
        : undefined,
    )),
    createElement: (tag: string): unknown =>
      tag === "option" ? newOption() : makeEl({ className: "", style: {} }),
    addEventListener: (t: string, f: (...a: unknown[]) => void): void => {
      const list = docListeners[t] ?? [];
      list.push(f);
      docListeners[t] = list;
    },
    hidden: false,
  };
  const run = new Function("window", "document", "fetch", LIVE_SRC) as (
    w: unknown,
    d: unknown,
    f: unknown,
  ) => void;
  run(windowStub, documentStub, () => Promise.resolve(new Response("{}")));
  const hook = windowStub.__enbeep as LifecycleHook | undefined;
  if (!hook?._test) throw new Error("live.html exposes no window.__enbeep._test");
  return {
    api: hook._test,
    hook,
    micSel,
    gumCalls,
    streams,
    ctxInstances,
    gainTotal: () => ctxInstances.reduce((n, c) => n + c.gainCount, 0),
    mdListeners,
    docListeners,
    docStub: documentStub,
    get wakeRequests() {
      return wakeRequests;
    },
    sentinels,
    ticks,
    setDevices: (devs: DeviceDesc[]) => {
      devices = devs;
    },
    fireDeviceChange: () => {
      for (const f of mdListeners.devicechange ?? []) f();
    },
  };
}

// Restore the real globals after every test: the stubs are per-page.
const RealNav = (globalThis as AnyRecord).navigator;
const hadRAF = "requestAnimationFrame" in globalThis;
const RealRAF = (globalThis as AnyRecord).requestAnimationFrame;
const hadLoc = "location" in globalThis;
const RealLoc = (globalThis as AnyRecord).location;
afterEach(() => {
  (globalThis as AnyRecord).navigator = RealNav;
  if (hadRAF) (globalThis as AnyRecord).requestAnimationFrame = RealRAF;
  else delete (globalThis as AnyRecord).requestAnimationFrame;
  if (hadLoc) (globalThis as AnyRecord).location = RealLoc;
  else delete (globalThis as AnyRecord).location;
});

function lifeHas(t: LoadedPage, name: string, part: string): boolean {
  return t.api.session().life.some((e) => e.name === name && e.detail.includes(part));
}

test("startup commits one session and Stop restores controls + report snapshot", async () => {
  const t = loadPage();
  await t.api.start();
  const s = t.api.session();
  expect(s.state).toBe("listening");
  expect(s.starting).toBe(false);
  expect(s.inflight).toBe(0);
  expect(s.appliedLabel).toBe("Fake Mic");
  expect(s.sessionIsSynth).toBe(false);
  expect(s.startLabel).toBe("Stop");
  expect(s.selfDisabled).toBe(true);
  expect(s.playDisabled).toBe(true);
  expect(s.checksDisabled).toBe(true);
  expect(s.micDisabled).toBe(true);
  expect(t.gumCalls.length).toBe(1);
  expect(lifeHas(t, "start", "active")).toBe(true);
  t.api.stop();
  const idle = t.api.session();
  expect(idle.state).toBe("idle");
  expect(idle.startLabel).toBe("Start Listening");
  expect(idle.micDisabled).toBe(false);
  expect(idle.selfDisabled).toBe(false);
  const report = t.api.report();
  expect(report).toContain("- audio: 48000 Hz · ended (was running)");
  expect(report).toContain("- capture: no failures recorded");
});

test("repeat Start cancels; a third tap waits; the late grant is stopped", async () => {
  const d = deferred<FakeStream>();
  let n = 0;
  const t = loadPage({
    gum: () => (++n === 1 ? d.promise : Promise.resolve(newMicStream("Second Mic"))),
  });
  const p1 = t.api.start(); // permission prompt "open"
  await Bun.sleep(5);
  expect(t.api.session().starting).toBe(true);
  expect(t.api.session().startLabel).toBe("Cancel");
  await t.api.start(); // cancel tap
  expect(t.api.session().starting).toBe(false);
  expect(t.api.session().status).toBe("Cancelling…");
  await t.api.start(); // third tap while unsettled: no new request
  expect(t.gumCalls.length).toBe(1);
  expect(t.api.session().status).toBe("Still cancelling the last request…");
  const late = newMicStream("Late Mic");
  d.resolve(late);
  await p1;
  expect(late.tracks[0]?.stopped).toBe(true); // owned + stopped, never committed
  const s = t.api.session();
  expect(s.state).toBe("idle");
  expect(s.inflight).toBe(0);
  expect(s.status).toBe("Ready");
  expect(s.appliedLabel).toBeNull();
  expect(lifeHas(t, "start", "late grant")).toBe(true);
  // The page is usable again after the settle.
  await t.api.start();
  expect(t.api.session().state).toBe("listening");
  expect(t.api.session().appliedLabel).toBe("Second Mic");
  expect(t.gumCalls.length).toBe(2);
});

test("mic denial cleans up the pre-created context and keeps failure identity", async () => {
  const t = loadPage({
    gum: () => Promise.reject(Object.assign(new Error("Permission denied"), { name: "NotAllowedError" })),
  });
  await t.api.start();
  const s = t.api.session();
  expect(s.state).toBe("idle");
  expect(s.micFailed).toBe("NotAllowedError");
  expect(s.micFailedDetail?.stage).toBe("permission");
  expect(s.micFailedDetail?.name).toBe("NotAllowedError");
  expect(s.status).toContain("Mic error");
  expect(s.startLabel).toBe("Start Listening");
  expect(s.micDisabled).toBe(false);
  expect(t.ctxInstances.length).toBe(1);
  expect(t.ctxInstances[0]?.closed).toBe(true); // no leaked context
  expect(t.api.report()).toContain(
    "- capture: FAILED @permission (NotAllowedError): Permission denied",
  );
});

test("suspended clock fails startup without leaking the granted stream", async () => {
  const t = loadPage({ ctxStartSuspended: true, ctxResumeStuck: true });
  await t.api.start();
  const s = t.api.session();
  expect(s.state).toBe("idle");
  expect(s.micFailed).toBe("AudioSuspended");
  expect(s.micFailedDetail?.stage).toBe("activate");
  expect(t.streams.length).toBe(1);
  expect(t.streams[0]?.tracks[0]?.stopped).toBe(true);
  expect(t.ctxInstances[0]?.closed).toBe(true);
});

test("context construction failure never reaches the microphone", async () => {
  const t = loadPage({ ctxFailCtor: true });
  await t.api.start();
  expect(t.api.session().micFailedDetail?.stage).toBe("context");
  expect(t.gumCalls.length).toBe(0);
});

test("self-test and sender refuse a live mic session (exclusive ownership)", async () => {
  const t = loadPage();
  await t.api.start();
  t.api.setTryMsg("Hi");
  expect(await t.api.selfTest()).toBe(false);
  expect(await t.api.play()).toBe(false);
  expect(t.gainTotal()).toBe(0); // no oscillator touched the mic analyser
  expect(t.api.session().tryErr).toContain("Stop listening first");
  expect(t.api.session().state).toBe("listening");
  expect(lifeHas(t, "synth", "refused")).toBe(true);
  t.api.stop();
});

test("checks refuse a live session; Start refuses running checks", async () => {
  const d = deferred<FakeStream>();
  let n = 0;
  const t = loadPage({
    gum: () => (++n === 1 ? Promise.resolve(newMicStream("Fake Mic")) : d.promise),
  });
  await t.api.start();
  await t.api.runChecks();
  const pre = t.api.checks().results;
  expect(pre.length).toBe(1);
  expect(pre[0]?.name).toBe("pre");
  expect(pre[0]?.ok).toBe(false);
  t.api.stop();

  const p = t.api.runChecks(); // probe starts (do not await yet)
  expect(t.api.session().checksRunning).toBe(true);
  for (let i = 0; i < 200 && t.gumCalls.length < 2; i++) await Bun.sleep(5);
  expect(t.gumCalls.length).toBe(2); // the probe's request, still pending
  await t.api.start(); // refused while checks run
  expect(t.api.session().status).toBe("Checks are running — wait for them to finish");
  expect(t.gumCalls.length).toBe(2); // the refusal requested nothing
  d.resolve(newMicStream("Probe Mic"));
  await p;
  expect(t.api.session().checksRunning).toBe(false);
  expect(t.gumCalls.length).toBe(2);
});

test("checks synth row needs a fresh verdict, not a stale pass", async () => {
  const t = loadPage();
  // Seed a stale verified verdict, then return to IDLE without clearing it.
  const v = t.api.runPlan(t.hook.tonesForFrame([1, 2, 3], 200), 200, 0, true);
  expect(v?.ok).toBe(true);
  t.api.stop(); // IDLE; lastVerdict survives (as in the page)
  await t.api.runChecks();
  const rows = t.api.checks().results;
  expect(rows.length).toBe(7);
  const synth = rows.find((r) => r.name === "synth");
  expect(t.gainTotal()).toBeGreaterThan(0); // tones really played this run
  expect(synth?.ok).toBe(false); // …but no NEW verdict: rAF never ticks here
  expect(synth?.blocked).toBe(false); // completed playback judges the verdict
  expect(synth?.detail).toContain("no verdict");
});

test("mute invalidates the frame, unmute recovers, end is permanent", async () => {
  const t = loadPage();
  await t.api.start();
  // Drive LISTENING -> SWEEP: a long sync run, then its end.
  const thresh = -55 + 12;
  for (let ts = 0; ts <= 900; ts += 50) {
    t.api.feed(ts, true, 2500, thresh - 20, thresh, thresh + 25, thresh - 20);
  }
  t.api.feed(1000, false, 2000, thresh + 25, thresh, thresh - 20, thresh + 25);
  expect(t.api.session().state).toBe("sweep");
  const track = t.streams[0]?.tracks[0];
  expect(track).toBeDefined();
  track?.onmute?.();
  const muted = t.api.session();
  expect(muted.state).toBe("listening"); // frame invalidated, fresh sync required
  expect(muted.interrupted).toContain("muted");
  expect(muted.status).toContain("muted");
  track?.onunmute?.();
  const recovered = t.api.session();
  expect(recovered.interrupted).toBeNull();
  expect(recovered.status).toBe("Listening — waiting for sync tone…");
  track?.onended?.();
  const dead = t.api.session();
  expect(dead.dead).toBe(true);
  expect(dead.status).toContain("Mic track ended");
  t.api.stop();
});

test("context suspend/resume interrupts and recovers the session", async () => {
  const t = loadPage();
  await t.api.start();
  const ctx = t.ctxInstances[0];
  expect(ctx).toBeDefined();
  ctx?.fireState("suspended");
  expect(t.api.session().interrupted).toContain("suspended");
  ctx?.fireState("running");
  expect(t.api.session().interrupted).toBeNull();
  t.api.stop();
});

test("vanished selected device falls back to default loudly", async () => {
  const A = { kind: "audioinput", deviceId: "a", label: "Mic A" };
  const B = { kind: "audioinput", deviceId: "b", label: "Mic B" };
  const t = loadPage({ devices: [A, B] });
  await t.api.devices();
  t.micSel.value = "b";
  await t.api.start();
  expect(t.gumCalls[0]).toEqual({
    audio: expect.objectContaining({ deviceId: { exact: "b" } }),
  });
  expect(t.api.session().micDisabled).toBe(true);
  t.setDevices([A]); // B unplugged
  t.fireDeviceChange();
  await Bun.sleep(5);
  expect(t.micSel.value).toBe(""); // default, not a silent stale id
  expect(t.api.session().micValue).toBe("");
  expect(lifeHas(t, "devices", "vanished")).toBe(true);
  t.api.stop();
});

test("pre-permission picker is honest; enumeration failure never blocks capture", async () => {
  const t = loadPage({ devices: [{ kind: "audioinput", deviceId: "", label: "" }] });
  await t.api.devices();
  expect(t.micSel.options.length).toBe(2);
  expect(t.micSel.options[1]?.disabled).toBe(true);
  expect(t.micSel.options[1]?.textContent).toContain("needs permission");
  expect(t.api.report()).toContain("inputs seen: 1");
  t.api.stop();
  const t2 = loadPage({ enumerateFails: true });
  await t2.api.devices();
  expect(t2.api.report()).toContain("inputs seen: unknown");
  await t2.api.start(); // capture proceeds without a device list
  expect(t2.api.session().state).toBe("listening");
  t2.api.stop();
});

test("loop gap clears the preamble run (no lock on stale sync)", async () => {
  const t = loadPage();
  await t.api.start();
  const tick = t.ticks[0];
  expect(tick).toBeDefined();
  const an = t.ctxInstances[0]?.analysers[0];
  expect(an).toBeDefined();
  if (an) an.mode = "sync";
  let ts = 10000;
  for (let i = 0; i < 60; i++) {
    ts += 1000 / 60;
    tick?.(ts); // ~1 s of observed sync through the real loop
  }
  ts += 500;
  tick?.(ts); // the hole: counted and invalidated, run cleared
  expect(t.api.report()).toContain("dropouts 1");
  const thresh = -55 + 12;
  t.api.feed(ts + 16, false, 2000, thresh + 25, thresh, thresh - 20, thresh + 25);
  expect(t.api.session().state).toBe("listening"); // pre-gap sync cannot lock
  t.api.stop();
});

test("muted ticks decode nothing; recovery needs fresh sync", async () => {
  const t = loadPage();
  await t.api.start();
  const tick = t.ticks[0];
  expect(tick).toBeDefined();
  const track = t.streams[0]?.tracks[0];
  expect(track).toBeDefined();
  track?.onmute?.();
  const an = t.ctxInstances[0]?.analysers[0];
  if (an) an.mode = "sync"; // frozen loud data, as a suspended clock leaves it
  let ts = 20000;
  for (let i = 0; i < 70; i++) {
    ts += 1000 / 60;
    tick?.(ts);
  }
  expect(t.api.session().state).toBe("listening");
  expect(t.api.report()).toContain("no frames yet");
  const thresh = -55 + 12;
  t.api.feed(ts + 16, false, 2000, thresh + 25, thresh, thresh - 20, thresh + 25);
  expect(t.api.session().state).toBe("listening"); // no run survived the hole
  track?.onunmute?.();
  for (let s = 0; s <= 900; s += 50) {
    t.api.feed(ts + 100 + s, true, 2500, thresh - 20, thresh, thresh + 25, thresh - 20);
  }
  t.api.feed(ts + 1100, false, 2000, thresh + 25, thresh, thresh - 20, thresh + 25);
  expect(t.api.session().state).toBe("sweep"); // fresh post-recovery sync locks
  t.api.stop();
});

test("interruption and recovery both clear sync tracking", async () => {
  const t = loadPage();
  await t.api.start();
  const thresh = -55 + 12;
  for (let s = 0; s <= 600; s += 50) {
    t.api.feed(s, true, 2500, thresh - 20, thresh, thresh + 25, thresh - 20);
  }
  const track = t.streams[0]?.tracks[0];
  track?.onmute?.(); // clears the 600 ms pre-hole run
  // feed() bypasses the tick skip by design: samples arriving mid-hole
  // must still not complete afterwards, so recovery resets again.
  for (let s = 700; s <= 1600; s += 50) {
    t.api.feed(s, true, 2500, thresh - 20, thresh, thresh + 25, thresh - 20);
  }
  track?.onunmute?.();
  t.api.feed(1700, false, 2000, thresh + 25, thresh, thresh - 20, thresh + 25);
  expect(t.api.session().state).toBe("listening");
  t.api.stop();
});

test("hung resume cannot wedge startup, playback, or checks", async () => {
  const t = loadPage({ ctxStartSuspended: true, ctxResumeHangs: true });
  t.api.setOpTimeout(50);
  await t.api.start();
  const s = t.api.session();
  expect(s.state).toBe("idle");
  expect(s.inflight).toBe(0);
  expect(s.micFailed).toBe("AudioSuspended");
  expect(s.startLabel).toBe("Start Listening");
  expect(s.micDisabled).toBe(false);
  expect(await t.api.selfTest()).toBe(false);
  expect(t.api.session().synthPlaying).toBe(false);
  await t.api.runChecks();
  const rows = t.api.checks().results;
  expect(rows.length).toBe(7);
  expect(rows.find((r) => r.name === "audio")?.ok).toBe(false);
  expect(rows.find((r) => r.name === "mic")?.blocked).toBe(true);
  const synth = rows.find((r) => r.name === "synth");
  expect(synth?.blocked).toBe(true); // unplayed synth is blocked, not rejected
  expect(t.api.session().checksRunning).toBe(false);
});

test("post-commit setup failure releases the mic and reports", async () => {
  const t = loadPage({ failGraph: true });
  await t.api.start();
  const s = t.api.session();
  expect(s.state).toBe("idle");
  expect(s.micFailedDetail?.stage).toBe("setup");
  expect(s.status).toContain("Mic error"); // reported, not a quiet leak
  expect(s.startLabel).toBe("Start Listening");
  expect(t.streams[0]?.tracks[0]?.stopped).toBe(true);
  expect(t.ctxInstances[0]?.closed).toBe(true);
  expect(t.api.report()).toContain("- capture: FAILED @setup");
});

test("recovery waits for a healthy path (no cross-clearing)", async () => {
  const t = loadPage();
  await t.api.start();
  const track = t.streams[0]?.tracks[0];
  const ctx = t.ctxInstances[0];
  expect(track).toBeDefined();
  expect(ctx).toBeDefined();
  if (track) track.muted = true; // OS mutes without firing yet
  ctx?.fireState("suspended");
  expect(t.api.session().interrupted).toContain("suspended");
  ctx?.fireState("running"); // resume must NOT clear the live mute
  expect(t.api.session().interrupted).toContain("suspended");
  if (track) track.muted = false;
  track?.onunmute?.();
  expect(t.api.session().interrupted).toBeNull();
  // An ended track never recovers either.
  track?.onmute?.();
  expect(t.api.session().interrupted).toContain("muted");
  track?.stop();
  if (track) track.muted = false;
  track?.onunmute?.();
  expect(t.api.session().interrupted).toContain("muted");
  t.api.stop();
});

test("Stop mid-play reports incomplete playback, controls restored", async () => {
  const t = loadPage();
  const p = t.api.selfTest();
  for (let i = 0; i < 200 && t.gainTotal() === 0; i++) await Bun.sleep(5);
  expect(t.gainTotal()).toBeGreaterThan(0); // tones scheduled, wait loop spinning
  t.api.stop(); // user bails out before the audio clock finishes
  expect(await p).toBe(false);
  const s = t.api.session();
  expect(s.synthPlaying).toBe(false);
  expect(s.state).toBe("idle");
  expect(s.selfDisabled).toBe(false);
});

test("wake-lock auto-release clears the handle so return re-acquires", async () => {
  const t = loadPage({ wakeLock: true });
  await t.api.start();
  expect(t.wakeRequests).toBe(1);
  expect(t.sentinels.length).toBe(1);
  const vis = t.docListeners.visibilitychange ?? [];
  expect(vis.length).toBe(1);
  const doc = t.docStub as Record<string, unknown>;
  // Hide + return with the handle held: no duplicate request.
  doc.hidden = true;
  for (const f of vis) await f();
  doc.hidden = false;
  for (const f of vis) await f();
  expect(t.wakeRequests).toBe(1);
  // OS auto-release fires `release`: the handle clears, so the next
  // return re-acquires (a stale handle would block it forever).
  t.sentinels[0]?.__fireRelease();
  doc.hidden = true;
  for (const f of vis) await f();
  doc.hidden = false;
  for (const f of vis) await f();
  expect(t.wakeRequests).toBe(2);
  t.api.stop();
});
