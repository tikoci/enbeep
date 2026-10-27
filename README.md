# enbeep

MFSK-16 acoustic modem: a RouterOS piezo beeps, a microphone decodes.
The demo payload is an **announce frame** — the router's MAC, IPv4, and a
state byte — verified on screen with a checksum. The beep is the handshake,
never the channel.

Status: working on air (RB1100AHx4 → Apogee MiC, 11/18 frames byte-exact,
6 principled rejects, 1 false-accept on the retired v1 format).

## Quick start

```bash
bun install
make test            # 18 Bun tests (synth + air-capture regression)

# Decode a recording (JSON result, exit 0 = verified):
make decode FILE=samples/bigdude-v2-200a.wav SYM=200

# Live decoder page (mic picker, waterfall, result card):
make serve            # -> http://localhost:3456
```

## The v2 frame

Data tones at 2000+100·nibble Hz, 200 ms slots (100/300 also play):

```
PRE  2s @ 4000 Hz + 16-tone sweep 2000..3500 (per-tx calibration)
SEP  1s @ 4000 Hz
DATA LEN, payload bytes, FLETCHER16 (2 tones/byte)
END  1s @ 4000 Hz
```

No SOF/EOF tones — 1-tone 4000 Hz markers merge into the adjacent syncs.
The 16-tone sweep calibrates pitch offset per transmission; Fletcher-16
(arithmetic-only, RouterOS-safe) verifies the bytes.

## Encoder (RouterOS 7)

`encode/enbeep-frame.rsc` — paste the file or transport it minified over
SSH (no router file writes). Needs 7.15+ (`:convert … to=byte-array`).

```routeros
$enbeepAnnounce "bridge" 0 200ms 200ms no   # MAC+IPv4+cpu frame, live
$enbeepText "Hello" 200ms 200ms no          # text frame, live
$enbeepAnnounce "bridge" 0 200ms 200ms yes  # dry-run: :put trace, silent
```

Args are `(interface, addressRow, symbol, tone, dry)`. Tone may be shorter
than the slot (`200ms 150ms`) but measured air shows no benefit — the room,
not the piezo, dominates smear. Long frames need `--timeout 30s` on the
SSH transport (10 s default kills a 12.8 s frame mid-payload).

## Decoder (Bun, zero deps)

- `src/decode.ts` — offline WAV → JSON CLI (`--file`, `--sym`).
- `src/{wav,dsp,frame,synth}.ts` — WAV IO, FFT detectors, v2 codec, synth.
- `live.html` (+ `serve.ts`) — live mic decoder: slot-counting state
  machine (repeat-nibble safe), sweep calibration, result card with ✓/✗,
  mic + symbol pickers, self-test (synthesized, never film as hardware).
- `test/` — `bun test`: codec unit tests plus every air capture as a
  regression case (v1 captures assert the format break loudly).

## Samples

`samples/bigdude-*.wav` — the regression corpus: probe sweep, v1 speed
matrix (100/200/300 ms) at two mic positions, v2 control + gap runs.
Ground truth: bridge MAC `74:4D:28:38:B3:CD`, lab IP `172.22.74.254/24`
(video-safe range), cpu sampled per run. `samples/legacy/` holds the retired
iPhone-era captures (hAP ac lite, March 2026); `decode/*.py` is the analyzer
for that old calibration format (`make test-py`). Neither is on the v2 path.

## Measured findings (bigdude + MiC, Oct 2026)

- 200/300 ms: exact decodes, offsets −0.2…+0.4 Hz, timing nominal.
- 100 ms: acoustic ISI (quiet-after-loud smear), durations still exact —
  the old "`:delay` rounds to 0 / +100 Hz piezo" claims reproduce on
  neither tested hardware.
- 1 m off-axis costs ~14 dB SNR (39 → 25 dB); still decodes.
- Failure mode is always ring-down smear onto a wrong-but-confident
  center — only the checksum catches it (Fletcher-16: 1/65536 class).
  Sampling slots late ([50%,90%]) beats centered windows because ring
  decays while the driven tone holds; the systematic killer is the
  3400→2000 Hz transition (cpu and checksum high nibbles when <16).
