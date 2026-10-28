# samples/ — air-capture regression corpus

Every `.wav` here is a real recording of a real piezo through a real mic,
locked in as a test. `bun test` decodes each one and asserts the verdict
it had when captured (exact decode, or reject-for-this-reason).

Naming: `<device>-<era/run>-<mic/sym notes>.wav`. Lab codenames:

| Codename | Device | Notes |
|---|---|---|
| `bigdude-*` | RB1100AHx4, RouterOS 7.26 | Fast piezo, reference hardware |
| `pierce-*` | RB953GS-5HnT, RouterOS 7.16.2 | Slow piezo in a metal enclosure |
| `legacy/*` | hAP ac lite, March 2026 | Retired pre-v2 format (iPhone-era) |

- `*-v2-*` / `pierce-*`: current format (docs/SPEC.md), Fletcher-16.
- `bigdude-frame-*`: retired v1 format. Tests assert the v2 decoder
  rejects them with "byte count" — the format break must stay loud.
- `bigdude-probe1.wav`: sweep-only (calibration success is the result).
- `legacy/`: old calibration format for `decode/*.py` (`make test-py`).
  Not on the v2 path; kept so the old analyzer stays testable.

Ground truth for the v2 captures: bridge MAC `74:4D:28:38:B3:CD` and lab
IP `172.22.74.254/24` (RB1100AHx4 runs; a video-safe lab range), and MAC
`64:D1:54:...` / `172.22.74.194` (RB953 runs). CPU byte varies per run.
These are lab devices published on purpose; use your own lab addressing
for your captures and say so when you contribute one (docs/TESTING.md).

Size note: ~81 MB of audio, stored in Git LFS (`samples/**/*.wav` and
`samples/**/*.m4a` — install `git-lfs` before cloning). Fixtures must
be lossless, so the size is deliberate; LFS keeps clones light without
deleting fixtures — the tests are the spec's teeth.
