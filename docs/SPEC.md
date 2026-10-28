# enbeep v2 frame spec

This is the single source of truth for the wire format. The RouterOS
encoder ([encode/enbeep-frame.rsc](../encode/enbeep-frame.rsc)), the offline
decoder ([src/frame.ts](../src/frame.ts)), and the live decoder
([live.html](../live.html)) must all match this document. If code and spec
disagree, the spec wins and the code is the bug.

Status: v2, frozen for the demo. v1 (byte-sum checksum, SOF/EOF tones) is
retired; v1 captures must reject, never decode as v2.

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

## Checksum: Fletcher-16

Over `[LEN, ...payload]`, arithmetic only (no bitwise ops, RouterOS-safe):

```
s1 = 0; s2 = 0
for b in bytes: s1 = (s1 + b) % 255; s2 = (s2 + s1) % 255
check bytes = [s1, s2]   # sent after the payload
```

Fletcher-16 is mandatory, not advisory. The dominant failure mode is
ring-down smear that lands exactly on a wrong tone center (residual ≈ 0),
so frequency margins cannot detect it — only the checksum can
(1/65536 false-accept class). v1's byte-sum (1/256) produced a real
false accept on air; that is why v2 exists.

## Calibration and decoding rules

1. Find sync regions (4000 Hz strongly dominant for ≥ 0.5 s).
2. The sweep between PRE and SEP must read nibbles 0..15 in order.
   Its per-tone residuals give one median pitch offset per transmission;
   all data tones are corrected by that offset before rounding.
3. Sample data slots late ([50%, 90%] of each slot in the offline
   decoder): the previous tone's ring decays while the driven tone
   holds, so late windows discriminate loud→quiet transitions best.
4. Verify, in order: sweep shape, byte count (`bytes == LEN + 3`),
   band margin, Fletcher-16. Any failure rejects the whole frame.
   There is no partial decode and no "best effort" payload.

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

## Versioning

Change the format only by bumping the version in this file, the encoder
header, and both decoders together, plus a regression capture that the
old decoder rejects loudly. Silent compatible-looking changes are how
v1 false-accepts happen.
