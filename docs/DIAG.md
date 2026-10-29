# docs/DIAG.md — live-decoder failure model + triage playbook

The Diagnostics tab exists so a failure can be triaged **without the
reporter's device**. This doc maps each user-visible failure to the
checks and captured environment that discriminate it, and tells an
agent how to read a pasted report.

In-page tools (Diagnostics tab):

- **Run checks** — guided sequence: `context` (secure? URL?), `audio`
  (sample rate, context state, latency), then a 2 s mic probe (first
  half settles, second half measures) feeding four rows: `mic`
  (permission + peak/RMS + applied `getSettings()` + Bluetooth flag),
  `room` (resting p10 level), `clip` (time-domain hot fraction), `band`
  (in-band vs out-of-band energy), then `synth` (in-page decode with no
  mic — must produce a fresh verdict from this run, never reuse an
  older one). Requires IDLE. Rows are pass (✓), fail (✗), or blocked
  (○): without a running audio clock or a mic capture, the acoustic
  rows report blocked instead of measuring silence, and `clip` is
  blocked (not passing) on browsers without the time-domain API (e.g.
  iOS pre-14.1). Thresholds: mic peak ≤ −90 dBFS = dead; room
  resting > −45 dBFS = too loud; clip > 0.1% samples over 0.99 = too
  hot; in-band > −50 dBFS while within 6 dB of out-of-band = whine
  in 1.8–4.1 kHz. A `BLUETOOTH route suspected` flag (explicit
  Bluetooth/AirPods/HFP label, or a headset/unknown label at mono ≤ 16
  kHz; USB labels never suspect) means: disconnect BT / switch to a
  wired, built-in, or USB mic — HFP audio is narrowband and high-latency.
- **Self-test** — the `synth` step alone (decoder check only). Requires
  stopped: it refuses while listening rather than piping oscillator
  tones into a live mic session (same for the Try-tab sender).
- **Copy diagnostics report** — markdown for a capture-report issue
  (fields below). Always ask for this before follow-up questions.

The report keeps the last session across one reset (a retry, Self-test,
or Run checks), but a second reset replaces it — copy before retrying
twice. Run checks appends its synthetic verdicts to the current history;
copy the attempt report first for the cleanest evidence. Stop listening
to run checks, then copy a separate checks report if useful.
For speaker → mic tests, record both devices and use only the receiving
device's result as evidence of an acoustic decode. The Try-it tab holds
the message sender and RouterOS panel; it is not diagnostics.

## Failure model

| # | Symptom | Likely causes | Discriminating datum | Where |
|---|---|---|---|---|
| 1 | Start fails immediately | permission denied; no device; mic busy; insecure context | gUM error name + one-line fix + `hint:` | log line `mic start failed (…)`; `mic` check; `hint:` |
| 2 | Listening, never locks | wrong device; muted; too far; room noise | floor range vs loudest peaks; elapsed; dropouts | `session:` / `signal:` / `band:`; `room`+`band` checks; `hint:` |
| 3 | Locks, frames always drop | wrong sym; weak SNR; smear; masking beyond repair | drop-reason histogram; stage where it dies; SNR est | `### drop reasons`; verdict errors; `signal:`; `hint:` |
| 4 | Sometimes verifies | marginal SNR; distance; movement; drift | verify rate; maxDf trend; repair flags; clip/dropouts | attempted/verified; verdict lines; `session:` / `signal:` |
| 5 | Works on desktop, not on phone | sample rate; autoplay policy; browser mic stack; BT route | applied settings; route class; UA; latency | `route:`; `audio:` / `browser:`; `mic` check BT flag |
| 6 | Verifies but wrong address | wrong interface/IP selection; 11-byte text read as announce; stale encoder; checksum collision | payload bytes vs expected, including text reading | verdict `✓` line payload; `sender:` |

Reading the drop histogram (case 3), most common first:

- `sweep mismatch` — tones present but off-center: wrong sym, drift,
  or heavy smear. Check `sym:` vs the encoder's sym.
- `byte count` — confident tones, impossible LEN: straddle beyond the
  fallback, timing damage, or a stale encoder. The live log says
  `len … vs … bytes`; the histogram groups it as `byte count`.
  Check sym + encoder version. Non-announce payload lengths are valid.
- `data timeout` — DATA ran past the worst-case deadline for the active
  symbol length (`2*(255+3)*sym + 5 s`, NS-25), so the END sync never
  arrived: the sender stopped early, or the mic path lost the tail.
  Check the sender ran to completion before investigating signal
  quality.
- `short sweep` / `sweep gap` — sync never cleanly ends: noise during
  PRE/SEP, or signal far too quiet. Check floor + mic peak.
- `tone outside band` — one slot wild: click/pop, or offset badly
  wrong (then *every* frame drops here — suspect calibration).
- `erasure unrecoverable` — masking ate slot 0 and LEN is ambiguous:
  slow piezo + damage. Ask for the WAV.
- `fletcher mismatch` (verdict, not a drop) — structure fine, bits
  wrong: exact-center smear. Ask for the WAV.

## Report field reference

- `page:` / `browser:` — full UA; tells phone vs desktop, Safari vs Chrome.
- `secure:` — `NO` explains every mic failure; fix is HTTPS, not code.
- `mic:` — selected picker label vs applied track label (picking another
  input never switches a live stream; the picker is disabled during
  capture), track state, `inputs seen` (enumerateDevices count;
  `unknown` = never enumerated).
- `audio:` — live context sample rate + state; after Stop, the snapshot
  taken at teardown (`ended (was …)`); `none` = never started audio.
- `capture:` — last mic-startup/probe failure with stage
  (`context`/`permission`/`activate`/`probe`), error name + message,
  failing constraint if any, and the selected device; kept across Stop.
  `no failures recorded` when nothing failed.
- `sym:` + `noise floor:` — setting vs current floor in dB (point value;
  the `signal:` range below is the session record).
- `route:` — last-known mic label (+ `bluetooth`/`usb`/`headset` class
  when matched) and applied `getSettings()` (sample rate, channels,
  EC/NS/AGC as the OS applied them — requests may be ignored, esp.
  iOS). The label is the track's own at stream start, not the live
  picker. `none (synth feed)` under synthetic tests.
- `session:` — listening elapsed, attempts/verified, rAF-gap dropouts,
  tab-hidden count. Proves "0 attempts after N min" (case 2).
- `signal:` — floor min–max, loudest sync/data dB, SNR estimate (loudest
  minus floor min), clip peak (% of full scale; `n/a` under synth).
- `band:` — session in-band vs out-of-band power-mean dB + Δ; `n/a (synth
  feed)` without a mic. Near-0 Δ with a loud in-band = whine; both low
  = quiet room (see the `band` check for the verdict form).
- `hint:` — the page's likely-cause read, same text as the live hint
  under the status line. Definite failures outrank guesses: mic-path
  failure → capture interrupted (muted track / suspended audio) → BT
  route → loud-room/no-lock (30+ s, no preamble) → sym mismatch (loud +
  sweep/byte-count drops, no verify). `none` when nothing matches.
  Trust but verify against the session block — the hint compresses;
  the numbers are the evidence.
- `sender:` — optional in-page sender note (sym/tone/interface); `(not
  given …)` when empty. Sym mismatch is the #1 confound: chase this
  before re-tuning thresholds.
- `frames attempted / verified` — counts from the most recent 20 verdicts,
  including synthetic checks if run in that history; not session totals.
- `### last checks` — the most recent Run-checks rows, if run (context,
  audio, mic, room, clip, band, synth with ✓/✗/○; ○ = blocked, could
  not measure). Absent when checks never ran in this page load.
- `### audio lifecycle` — timestamped session-ownership events (start
  requested/active/failed, cancel, stop, synth refused/playing,
  mute/unmute/end, context suspend/resume, device changes). Absent when
  no audio session ran yet. Use it to tell a dead mic from a cancelled
  start or a suspended clock.
- `### drop reasons` — histogram; keys are stable across slot indices.
- `### frame verdicts` — newest last; `repair` is `none|sweep|data|sweep+data`;
  synthetic verdicts (Self-test / sender / checks) carry a `synth` tag.
- `### previous session` — prior session's verdicts + drop counts, kept
  across one reset; absent when there is nothing stashed. Verdict lines
  carry `as text "..."` so message payloads read without decoding hex.
- `### log tail` — last 30 log lines, newest last.
- `### still needed` — what only the human knows (router, command,
  distance, WAV). Don't triage past these when they're the gap.

## Agent playbook

1. Read `secure:` first. If `NO`, stop: the fix is serving over HTTPS.
2. Read `capture:` + `### audio lifecycle`: a FAILED stage names the
   broken step (permission vs clock vs probe); cancel/stop/suspend
   events explain empty sessions. Then `hint:` + `route:`: a mic-path or
   interrupted hint, or a BT flag, ends most phone mysteries — steer to
   a wired/built-in/USB mic before anything else.
   Then `sender:`: an unknown sender sym is the next confound.
3. Read `session:` + `signal:` + `band:`: 0 attempts after minutes of
   "listening" = case 2 (nothing detected), not case 3. Floor range vs
   loudest peaks gives the SNR story; clip peak + dropouts explain
   intermittent cases; in-band Δ names whine vs quiet.
4. Read `mic:` + `### last checks` (if Run checks was used): permission
   errors name themselves; `peak -inf`/very low = wrong device or mute.
   The `room`/`clip`/`band` rows pre-date the session — compare with the
   session block for drift (moved mic, changed room).
5. Read `audio:` sample rate on phone reports: 44100 vs 48000 is fine
   (the decoder adapts), but a missing/suspended context is not.
6. Read `### drop reasons`: one dominant key = one mechanism (table
   above). Scattered keys = too-quiet signal or wrong sym — check
   floor, mic peak, and `sym:` vs the encoder.
7. Ask for the WAV when the histogram says signal damage (`fletcher
   mismatch`, `erasure unrecoverable`, `tone outside band` on every
   frame) — air truth beats speculation.
8. A passing `synth` check narrows the failure; it does not rule out a
   decoder bug on real microphone input. Compare the captured WAV in the
   harness/offline decoder with the live report before assigning cause.
