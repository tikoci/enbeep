# Testing enbeep (and reporting what you find)

enbeep's whole value is "it worked on hardware we don't own." This page is
how to test without our lab, and how to report results so they refine the
scheme instead of becoming anecdotes.

## What is verified today (Oct 2026)

| Path | Hardware | Result |
|---|---|---|
| Offline decode | RB1100AHx4 (7.26) → USB mic, 200/300 ms | Exact, Fletcher ✓ |
| Offline decode | RB953GS-5HnT (7.16.2, metal case) → USB mic, 200/400 ms | Exact via slot-0 repair |
| Live decode | Desktop browser, USB mic | Working |
| Live decode | iPhone Safari | **Self-test only** — see below |
| Live decode over air | iPhone Safari ← router piezo | **Not yet verified. Top ask.** |
| Two-device browser demo | Speaker → another device's live mic | Walkthrough available; **no recorded device-pair verification yet** |

Automated: `bun test` covers codec units and captures in `samples/` as
regressions. Install Git LFS and run `git lfs pull` after cloning so those
fixtures are audio, not pointer files. Typecheck and lint are also
required. Recheck a recorded hardware frame any time with
`make decode FILE=samples/bigdude-v2-200a.wav SYM=200`
(expect `ok: true` and `sumOk: true`).

About iPhone: mic access needs a secure context. `bun run serve:tls`
(self-signed) is an experimental LAN option; certificate trust depends
on the device, and accepting a warning may not enable microphone access.
Prefer trusted HTTPS hosting, such as the planned GitHub Pages build
(publication/URL verification is NS-1 in NEXT_STEPS.md). In our frame
log the iPhone has only completed the in-page Self-test payload, never an over-air announce
frame. Treat "iPhone works" as an open question until a capture below
says otherwise.

## 1. No router (5 minutes)

1. `bun install && bun test` — codec + capture regression must pass.
2. `bun run serve`, open http://localhost:3456, select **Diagnostics**,
   press **Self-test**.
   The page synthesizes a frame and decodes it. This checks one synthetic
   decoder path, not the acoustics or all possible input — don't film it
   as a hardware decode.
3. Open http://localhost:3456/harness.html and drop a WAV from `samples/`.
   Verified frames show ✓ with MAC/IP; intentional rejects show ✗ with
   the reason. A sweep-only probe shows **CALIBRATION ONLY**, not a
   verified payload. `bun run serve` builds the harness automatically.
4. `bunx playwright install chromium` (once), then `bun run test:browser` —
   headless check through the real page: the Web Audio self-test
   verifies end-to-end and a corrupted synth frame rejects.

For a speaker → microphone experiment, follow the
[two-device walkthrough](../README.md#try-two-computers-laptops-or-phones).
The sender's Try-it Play message emits the same v2 framing. Only the
receiver's verdict is acoustic evidence. Report both devices, browsers,
volume, distance, and symbol length, including failed attempts.
Start with short ASCII text; the [current implementation limits](SPEC.md#current-implementation-limits)
cover the live timeout for long messages and the ASCII-only text preview.

## 2. Router, no special mic (the real test)

You need: a RouterOS 7.15+ device with a piezo beeper, any laptop/phone
mic, a quiet-ish room, and (for the coordinated rig) `arecord` +
centrs with the router registered — [rig/README.md](../rig/README.md)
has the 5-minute setup.

1. Load the encoder ([encode/README.md](../encode/README.md), recipe A).
   Dry-run first through centrs (`... yes`): check META/FRAME/T: lines,
   no sound. If it prints META but no FRAME on 7.16, the globals were
   API-loaded and can't nest — reload via SSH (recipe A). The receiver
   must match the META MAC/IP. CPU and therefore checksum can change on
   the next transmission; a separate dry-run is not exact checksum ground truth.
   Note them, and don't poll the router again
   before the frame (logins spike cpu-load on small boards and the cpu
   byte varies per run).
2. Record the room first: 5 s of silence on the same mic/gain you'll use.
   Note mic model, distance, and orientation — they matter more than
   any setting in the decoder.
3. Run `mkdir -p .scratch/captures`. Capture a frame with the rig (one
   command records + triggers):
   `bun run rig:capture --mic hw:1,0 --out .scratch/captures/cap.wav --dur 35 --lead 6 --target <cdb-name> -- '$enbeepAnnounce "bridge" <row> 200ms 200ms no'`
   (window guide: 200 ms → 30–35 s, 400 ms → 45–50 s; details in
   `rig/README.md`). No rig? Record manually as WAV, 44.1/48 kHz
   (start before, stop after) while you trigger by hand.
4. Triage: `bun run rig:analyze --file .scratch/captures/cap.wav --sym 200`.
   `verdict=OK` + your MAC/IP = success. Anything else = keep the
   file; it's data (§3). Machine-readable verdict:
   `make decode FILE=<your.wav> SYM=200`. A full frame needs `ok: true`
   and `sumOk: true`; exit 0 alone also covers sweep-only calibration.
5. Also try the live page (Pages build on a phone is ideal): hold the
   phone 0.3-1 m away, start listening before you trigger the frame.

## 3. If it fails (in expected order)

1. **100 ms?** Don't. Start at 200 ms; try 300/400 ms before anything else.
2. **Slow/quiet piezo, metal case?** Try `400ms 300ms` (gap) and get the
   mic closer and on-axis. 1 m off-axis cost ~14 dB in our room.
3. **Sweep mismatch / byte count / checksum?** That's the decoder
   rejecting honestly. Save the WAV; don't retune thresholds to force it.
4. **Live rejects but offline accepts?** Both decoders now implement
   slot-0 erasure repair (docs/SPEC.md), so that pairing is a bug, not
   an expected divergence. File it with the WAV.

## 4. Reporting a capture (what actually helps)

From the live page, open the Diagnostics tab and **Copy diagnostics
report** while the attempt is still present. The report keeps your last
session across one reset (a retry, Self-test, or Run checks), but a
second reset replaces it — copy before retrying twice. Fill the sender
note first (sym/tone/interface): it travels in the report and sym
mismatch is the #1 confound. Run checks appends its own synthetic
verdicts to the current history, so copy the attempt report first for
the cleanest evidence. Then stop listening, run **Run checks** (room,
clip, and band rows predict acoustic failure before you play a frame),
and copy a second report if useful — it embeds the check rows plus the
session's acoustic block (route, elapsed, floor range, SNR estimate).
Paste both reports — they carry the checklist below plus the decode
history an agent needs to triage (field reference + playbook:
`docs/DIAG.md`).

Open an issue with:

- Router model, RouterOS version, enclosure/case if any; for a browser
  sender, both devices/OS/browsers and speaker volume instead
- Command used (interface, row, sym, tone, dry)
- Mic (model or "phone, model X"), distance, room (one line)
- Symbol length, decoder (offline / live / harness), full JSON result
- The WAV itself if you can share it. Room recordings can include
  speech and other sounds, and the payload contains MAC/IP. Review audio
  and reports (device labels and page URLs too) before posting; use lab
  addressing and say whether you permit inclusion as a trimmed fixture.
  If GitHub will not accept a WAV attachment, attach it in a ZIP.

Good captures become `samples/` regression tests with a one-line credit.
Rejects are as valuable as decodes: the corpus includes captures that
must keep failing for the right reason.

## 5. Refining the scheme (open questions)

- Should the existing slot-0 repair remain decoder-side, or should slow
  piezos use a longer SEP decay gap on the encoder side? Needs captures
  from ≥ 2 slow-piezo models to decide.
- Is 200 ms the right default, or should the encoder measure its own
  piezo (probe sweep → pick sym)? `encode/probe-short.rsc` is the seed.
- iPhone/Android over-air matrix: mics, browsers, distances, cases.
- `/tool fetch` loading: RouterOS can fetch the `.rsc` from the Pages
  URL, but `/import`-defined globals can't call globals on 7.16.
  A `[:parse [/file get ... contents]]` load might behave like a paste —
  **unverified; test on CHR + one real box before documenting it.**
