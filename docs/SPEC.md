# enbeep v2 frame spec

This is the single source of truth for the wire format. The RouterOS
encoder ([encode/enbeep.rsc](../encode/enbeep.rsc)), the offline
decoder ([src/frame.ts](../src/frame.ts)), and the live decoder
([live.html](../live.html)) must all match this document. If code and spec
disagree, the spec wins and the code is the bug.

Status: v2, frozen for the demo. v1 (byte-sum checksum, SOF/EOF tones) is
retired; v1 captures must reject, never decode as v2.

## Why this scheme?

The goal is a playful modem that fits in a RouterOS script and works with
a piezo and an ordinary microphone. These are experimental choices,
based on the [captures tested so far](TESTING.md), not an optimized modem
design or a claim of compatibility with other MFSK protocols.

- **One pitch per hex digit.** [Multiple frequency-shift keying (MFSK)](https://en.wikipedia.org/wiki/Multiple_frequency-shift_keying)
  represents values by choosing a frequency. Here there are 16 choices,
  enough for a four-bit [nibble](https://en.wikipedia.org/wiki/Nibble).
  For example, byte `0x4D` becomes nibble 4 then nibble 13. This maps
  directly to RouterOS integer division and remainder, and needs only
  one `:beep` at a time. More pitches carry more bits per tone, but give
  the receiver more frequencies to distinguish reliably.
- **Slow tones and a sweep every time.** A symbol is one timed tone
  slot. The long slots let the previous beep fade; piezo ringing and room
  echoes otherwise overlap the next symbol
  ([intersymbol interference](https://en.wikipedia.org/wiki/Intersymbol_interference)).
  The sweep checks every data pitch and estimates a common pitch offset.
  This spends time on calibration for every transmission; the chosen
  pitches and timings have evidence on only two router models.
- **Length plus checksum.** The length lets the receiver check how many
  bytes arrived; [Fletcher-16](https://en.wikipedia.org/wiki/Fletcher%27s_checksum)
  adds two check bytes using simple arithmetic. It replaced a byte sum
  after a recorded false accept. It detects many errors but cannot
  guarantee correct data, authenticate a sender, or generally recover
  damaged bytes. The narrow slot-0 repair below is a separate structural
  rule that still requires the checksum to pass.

## Physical layer

- MFSK-16. Data tone for nibble `n` (0-15): `2000 + 100*n` Hz (2000-3500 Hz).
- Sync tone: 4000 Hz. Data band guard: 1800-3700 Hz.
- Symbol slot: nominal 100, 200, 300, or 400 ms. 200 ms is the reference;
  100 ms suffers acoustic inter-symbol interference in measured rooms;
  slow piezos (sealed metal enclosures) may need 400 ms.
- Tone length may be shorter than the slot (`tone < sym`) to leave a decay
  gap. Syncs always play full length. Measured: gaps do not help fast
  piezos (room ring dominates); they can help slow piezos.
- Bytes are sent high nibble first, two tones per byte.
- `:beep` is non-blocking on RouterOS 7: every tone needs a `:delay` of
  the slot length after it.

## Frame layout

All durations in slots of `sym` unless stated in ms.

| Section | Content |
|---|---|
| PRE | 2000 ms @ 4000 Hz, then sweep: nibbles 0,1,...,15 (16 slots) |
| SEP | 1000 ms @ 4000 Hz |
| DATA | `LEN`, payload (`LEN` bytes), `F1`, `F2` — each byte as 2 tones |
| END | 1000 ms @ 4000 Hz |

There are deliberately no SOF/EOF data tones: a single 4000 Hz tone would
merge into the adjacent 1-2 s syncs and be undetectable.

- `LEN` is the payload length in bytes (1 byte; payload ≤ 255 bytes).
- Total DATA tones = `2 * (LEN + 3)`, always even on a clean frame.
- An announce frame payload is 11 bytes (below); a 200 ms announce frame
  is about 12.8 s on air (4 s sync + 3.2 s sweep + 5.6 s data).

## Announce payload (11 bytes)

| Bytes | Meaning |
|---|---|
| 0-5 | MAC address of the named interface, raw bytes |
| 6-9 | IPv4 address (the `/ip address` row's address, without `/prefix`) |
| 10 | CPU load percent at transmit time (a liveness/state byte) |

Decoders must not assume every payload is an announce frame: any
`LEN`-consistent payload with a valid checksum is a valid frame.
`$enbeepText` sends arbitrary text bytes under the same framing.
There is no payload type or character-encoding tag. The live page treats
11-byte payloads as announcements by convention and also shows their
text reading, so an 11-byte message remains visible.

## Checksum: Fletcher-16

Over `[LEN, ...payload]`, arithmetic only (no bitwise ops, RouterOS-safe):

```
s1 = 0; s2 = 0
for b in bytes: s1 = (s1 + b) % 255; s2 = (s2 + s1) % 255
check bytes = [s1, s2]   # sent after the payload
```

Fletcher-16 is mandatory, not advisory. The dominant failure mode is
ring-down smear that lands exactly on a wrong tone center (residual ≈ 0),
so frequency margins cannot detect it; the checksum is a separate,
required error check. v1's byte-sum produced a real false accept on air;
that is why v2 exists. Fletcher-16 also has collisions: for example,
replacing a payload byte `0x00` with `0xFF` leaves these modulo-255 sums
unchanged. No fixed false-accept probability is promised for acoustic
errors, and a pass does not authenticate the sender.

## Calibration and decoding rules

1. Find sync regions (4000 Hz strongly dominant for ≥ 0.5 s).
2. The sweep between PRE and SEP must read nibbles 0..15 in order.
   Its per-tone residuals give one median pitch offset per transmission;
   all data tones are corrected by that offset before rounding.
3. Sample data slots late ([50%, 90%] of each slot in the offline
   decoder): the previous tone's ring decays while the driven tone
   holds, so late windows discriminate loud→quiet transitions best.
4. Verify sweep shape, then data band margin, byte count
   (`bytes == LEN + 3`), and Fletcher-16. Any failure rejects the whole
   frame. There is no partial decode and no "best effort" payload.

Sweep-only probes can report calibration success (`ok: true`,
`payload: null`, `sumOk: false`); that is not a verified data frame.

## Erasure tolerance

On slow piezos a loud 1-2 s sync rings about one slot into the next
tone, masking sweep tone 0 and/or data slot 0 (the `LEN` high nibble).
Both decoders repair this identically:

- A 15-tone sweep reading exactly 1..15 calibrates on the survivors.
- An odd DATA tone count, or a confident-but-impossible `LEN`, may be
  repaired only structurally: frame size forces `LEN`, the missing
  nibble is reconstructed, and Fletcher-16 must still verify.
  Any other shape rejects.

Repairs are flagged, never silent: the offline result carries
`sweepDropout`/`dataErasure`, and the live result card shows which
section was repaired.

## Current implementation limits

These describe today's tools, not additional wire-format rules:

- The browser sender and the live receiver both accept the full 1–255
  UTF-8 byte range: the DATA deadline scales with the worst-case frame
  at the active symbol length, and synthetic live/offline parity covers
  255 bytes at 200/400 ms. Long over-air frames still need hardware
  trials: start with short messages such as `Hello`, and treat 255 bytes
  as a wire limit, not a verified acoustic capability.
- The live result and diagnostics render printable ASCII bytes as text,
  with other bytes shown as `·`; they do not decode UTF-8 for display.
  Hex retains the original bytes. `$enbeepText` transmits the bytes of
  the RouterOS string; non-ASCII terminal input needs separate testing.

## Versioning

Change the format only by bumping the version in this file, the encoder
header, and both decoders together, plus a regression capture that the
old decoder rejects loudly. Silent compatible-looking changes are how
v1 false-accepts happen.
