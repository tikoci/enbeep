// capture.ts — coordinated over-air capture: records the mic while firing
// one RouterOS trigger through centrs. Single foreground process (no shell
// backgrounding): the recorder is a child this process awaits.
// Auth is centrs's job (CDB identities + stored creds); this tool never
// sees a secret. Thin glue over arecord + centrs; decode the result with
// rig/analyze.ts or src/decode.ts.
// Usage:
//   bun run rig/capture.ts --mic hw:1,0 --out cap.wav --dur 35 --lead 6 \
//     --target bigdude -- '$enbeepAnnounce "bridge" 0 200ms 200ms no'
//   Stereo cards (e.g. AES67 sinks): --mic plughw:RAVENNA --channels 2
//   (the offline decoder mixes to mono). Non-hw: ALSA names skip the
//   card preflight; recorder failure is still caught at spawn.
// Exit: 0 captured (trigger ok) · 2 usage · 3 preflight · 4 recorder ·
// 5 trigger failed (the wav is still kept for inspection).

const args = process.argv.slice(2);
const sep = args.indexOf("--");
const flags = sep < 0 ? args : args.slice(0, sep);
const command = sep < 0 ? [] : args.slice(sep + 1);
const get = (k: string, dflt: string): string => {
  const i = flags.indexOf(k);
  return i >= 0 && i + 1 < flags.length ? (flags[i + 1] ?? dflt) : dflt;
};

const mic = get("--mic", "");
const out = get("--out", "");
const dur = Number(get("--dur", ""));
const lead = Number(get("--lead", "6"));
const target = get("--target", "");
const format = get("--format", "S32_LE");
const rate = get("--rate", "48000");
const channels = get("--channels", "1");

if (
  !mic ||
  !out ||
  !Number.isFinite(dur) ||
  dur <= 0 ||
  !Number.isFinite(lead) ||
  lead < 0 ||
  lead >= dur ||
  !target ||
  command.length === 0
) {
  console.error(
    "usage: bun run rig/capture.ts --mic <alsa-device> --out <wav> --dur <s> " +
      "--target <cdb-identity> [--lead <s>] [--format S32_LE|S16_LE] " +
      "[--rate <hz>] [--channels <n>] -- '<routeros command>'",
  );
  process.exit(2);
}
if (format !== "S32_LE" && format !== "S16_LE") {
  console.error(`bad --format ${format} (want S32_LE or S16_LE)`);
  process.exit(2);
}

const runSync = (cmd: string[]): { code: number; out: string } => {
  try {
    const p = Bun.spawnSync(cmd);
    const stdout = p.stdout;
    const bytes = typeof stdout === "string" ? new TextEncoder().encode(stdout) : stdout;
    return { code: p.exitCode ?? 1, out: new TextDecoder().decode(bytes) };
  } catch {
    return { code: 127, out: "" };
  }
};

// Preflight 1: CDB identity resolves.
const show = runSync(["centrs", "devices", "show", target]);
if (show.code === 127) {
  console.error("centrs not found on PATH (see rig/README.md)");
  process.exit(3);
}
if (show.code !== 0) {
  console.error(`unknown centrs target "${target}" (register with \`centrs devices add\`; see rig/README.md)`);
  process.exit(3);
}
// Preflight 2: mic card exists (USB indices shift across reboots).
const cards = runSync(["arecord", "-l"]);
if (cards.code === 127) {
  console.error("arecord not found on PATH (install alsa-utils)");
  process.exit(3);
}
const cardNo = /hw:(\d+)/.exec(mic)?.[1];
if (!cardNo) {
  console.error(`note: cannot preflight non-hw mic ${mic}; proceeding`);
} else if (!cards.out.includes(`card ${cardNo}:`)) {
  console.error(`mic ${mic} not in \`arecord -l\`:\n${cards.out}`);
  process.exit(3);
}

const rec = Bun.spawn(
  ["arecord", "-D", mic, "-f", format, "-r", rate, "-c", channels, "-d", String(dur), out],
  { stdout: "ignore", stderr: "pipe" },
);
await Bun.sleep(500);
if (rec.exitCode !== null) {
  const err = await new Response(rec.stderr).text();
  console.error(`recorder exited immediately (code ${rec.exitCode}): ${err.trim()}`);
  process.exit(4);
}
await Bun.sleep(Math.max(0, (lead - 0.5) * 1000));
const t0 = Date.now();
// --yes: beep triggers classify as write-shaped, and this is
// non-interactive by design; the command is echoed in our own logs for
// review. --timeout 60s: frames run 13-22 s.
const trig = Bun.spawn(["centrs", "execute", "--yes", "--timeout", "60s", target, "--", ...command], {
  stdout: "pipe",
  stderr: "pipe",
  stdin: "ignore",
});
// The trigger must finish inside the recording; on overrun kill it so the
// capture still ends on time (a partial frame is data, a hung run is not).
const budgetMs = Math.max(5000, (dur - lead) * 1000);
const killer = Bun.sleep(budgetMs).then(() => {
  if (trig.exitCode === null) trig.kill();
});
await trig.exited;
const took = ((Date.now() - t0) / 1000).toFixed(1);
await killer;
const [tout, terr] = await Promise.all([
  new Response(trig.stdout).text(),
  new Response(trig.stderr).text(),
]);
if (trig.exitCode === null) {
  console.log(`trigger KILLED after ${(budgetMs / 1000).toFixed(0)}s budget (took=${took}s, frame may be partial)`);
} else {
  console.log(`trigger exit=${trig.exitCode} took=${took}s`);
}
console.log((tout + terr).slice(0, 800));
await rec.exited;
console.log(`recorded ${out}`);
if (trig.exitCode !== 0) process.exit(5);
