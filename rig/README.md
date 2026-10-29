# rig/ — hardware test rig

Coordinated over-air capture + triage for enbeep frames. Two tools, no
new dependencies (Bun + `arecord` + `centrs`):

- `capture.ts` — records the mic while firing one RouterOS trigger
  through centrs (CDB identity). Preflights the target + mic first.
- `analyze.ts` — triage report for a capture: signal envelope, offline
  decode verdict, sync-ratio scan, optional slot peaks. All DSP via
  `src/*`; exit 0 whenever the report prints.

Run as `bun run rig/capture.ts ...` / `bun run rig/analyze.ts ...`
(shortcuts: `bun run rig:capture`, `bun run rig:analyze`).

## Setup (once per machine)

1. **Bun + audio**: `bun install`; `arecord -l` must list your mic
   (Linux: alsa-utils). Note the card as `hw:N,0` — USB indices shift
   across reboots, so re-check each session.
2. **centrs + CDB**: install centrs (tikoci's RouterOS hub). Register
   each router under a short session name (`centrs devices add <ip>
   --session <name> ...` — see `centrs devices add --help` for the
   credential options; `centrs discover --save` finds neighbors over
   MNDP). Verify with `centrs devices show <name>` and
   `centrs execute <name> -- '/system resource print'`.
3. **Secrets live in the CDB** (`~/.config/tikoci/winbox.cdb`, mode
   0600), never in this repo. `execute` also honors `CENTRS_USERNAME`
   / `CENTRS_PASSWORD` env as fallback. The rig never sees a secret.

## Standard run

1. Paste-load the encoder on the router ([encode/README.md](../encode/README.md)
   recipe A paste; globals don't survive reboot).
2. Dry-run through centrs (silent, prints ground truth):
   `centrs execute --yes <name> -- '$enbeepAnnounce "bridge" <row> 200ms 200ms yes'`
   (`--yes`: even the dry-run classifies as write-shaped — it's an
   opaque global call. At a TTY you can answer the prompt instead.)
   Note META (mac/ip) + FRAME (len/f1/f2). MAC/IP must match later;
   CPU and therefore checksum can change between this and the real run.
3. Run `mkdir -p .scratch/captures`, then capture (choose a unique name
   for each trial so it remains findable next session):
   `bun run rig:capture --mic hw:1,0 --out .scratch/captures/cap.wav --dur 35 --lead 6 --target <name> -- '$enbeepAnnounce "bridge" <row> 200ms 200ms no'`
   Duration guide: frame ≈ 2 + 16·sym + 1 + (len+3)·2·sym + 1 s, plus
   ~10 s lead/tail (200 ms → ~13 s frame → 30–35 s window;
   400 ms → ~22 s frame → 45–50 s window).
4. Analyze: `bun run rig:analyze --file .scratch/captures/cap.wav --sym 200`
   `verdict=OK` + your MAC/IP = success. Anything else = data: keep
   the wav and read the sync scan (next section, then
   [docs/TESTING.md](../docs/TESTING.md) §3).

## AES67 sources (validated 2026-10-27)

An AES67 stream arrives as an ordinary ALSA card — here card 2
`RAVENNA` via aes67-linux-daemon + Merging driver. Driver setup is
environment, outside this repo; the rig just needs the card's name,
channel count, and the plug layer:

`bun run rig:capture --mic plughw:RAVENNA --channels 2 --format S32_LE ...`

(the offline decoder mixes to mono; S32 holds the sink's S24
losslessly). Validated end to end: RB953 400 ms frame close-mic'd via
Shure SM58 → AVIO AI2 → AES67 multicast → daemon sink decoded `OK`
with exact MAC/IP/Fletcher and sync ratio2 ≈ 0.18 — at −100 dBFS,
15 dB above the digital floor. Notes: the AI2 needs a Dante-side
AES67 transmit flow (Device menu → Create Multicast Flow → AES67
section) and sends no SAP, so the sink takes a hardcoded SDP; Dante
PTP is the clock (daemon locks as slave); keep analog input gain hot,
since level here is purely a source-gain story. Full setup playbook,
mic-position protocol, and hum triage live in the repo skill
`.agents/skills/aes67-mic-path/SKILL.md` — start there when adding a mic
or chasing a near-miss (residual conducted 60/120/180 Hz ate our margin
to ratio2 0.149 on 2026-10-27; keep mic cable off UPS bricks).

## Reading a failure (fast triage)

- `found 0 syncs`, scan max ratio2 < 0.15 but ratio1 > 50: the tone is
  there but buried — move the mic closer and on-axis (4 kHz syncs sit
  ~15 dB under data tones on some piezos; 1 m off-axis cost ~14 dB in
  our room).
- `sweep mismatch` with one wild slot: run `--slots` over the sweep —
  a room null at that tone lets ambient tones win the peak-pick (our
  lab has a constant 1868 Hz coil whine in-band; record your room's
  silence first so you know yours).
- Extra sync regions mid-data: a 2000 Hz tone's 2nd harmonic can trip
  the detector where the fundamental nulls. Note it; don't retune.
- Sweep/data counts off by one with ring: the expected slow-piezo
  shape (slot-0 repair covers it); see [docs/SPEC.md](../docs/SPEC.md).
- Loud broadband thumps (handling, glasses): outside the sync regions
  they are ignored — the envelope shows where they landed. Mid-frame
  they smear tones and Fletcher rejects honestly; re-record.
- Don't poll the router right before a frame: API/SSH logins spike
  cpu-load on small boards (28→80% seen on MIPS), and the cpu byte
  varies per run — a dry-run checks the load and selected MAC/IP, not
  the exact CPU/checksum of the following transmission.
