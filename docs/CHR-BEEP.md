# Can `:beep` be captured from CHR under QEMU?

Date: 2026-10-28. Guest images: CHR 7.25 x86_64 (booted) and 7.25
ARM64 (unpacked only). Host: Linux x86_64, KVM, QEMU 11.1.2.

**Verdict: yes — on CHR 7.25 x86 with a 2-byte RAM patch at boot,
no image modification needed.** The tested image skips speaker-driver
initialization when CPUID reports a hypervisor, while clearing that
bit prevents boot in our probes. Patching the speaker-init branch
in guest RAM via QEMU's gdbstub
during boot unlocks the whole path: `:beep` programs the virtual
PC speaker, QEMU captures it to WAV, and the project's own offline
decoder reads the frame. Proven end to end: a v2 `"Hello"` frame
transmitted on CHR 7.25 decoded `ok:true`, payload `[72,101,108,108,111]`,
Fletcher `sumOk:true`.

The patch bypasses this one branch; it does not hide virtualization
from the rest of CHR or change the image on disk. This is a lab test
of real RouterOS code driving a virtual speaker. It does not establish
piezo, microphone, phone, or live-browser compatibility.

## Run the integration test

The supported entry point is [test/chr-beep.test.ts](../test/chr-beep.test.ts).
It needs Linux x86_64, Bun, QEMU x86 (`qemu-system-x86_64` and
`qemu-img`), gdb, and network access to download the stock MikroTik
image and the pinned CLI packages. On Ubuntu/Debian:

```bash
sudo apt-get update
sudo apt-get install --no-install-recommends qemu-system-x86 qemu-utils gdb
bun install --frozen-lockfile
bun run test:chr
# Explicit software emulation; KVM is optional:
ENBEEP_CHR_ACCEL=tcg bun run test:chr
```

`test:chr` sets `ENBEEP_CHR_TEST=1`; ordinary `bun test` skips it.
The harness pins quickchr **0.5.3**, centrs **0.1.9-next.24**, and CHR
**7.25 x86**. Package tags such as `next` are not used for resolution.
The patch address and expected original bytes belong to this image;
changing RouterOS requires re-inspection, not just a version bump.
The original bytes are checked before writing, and the replacement
bytes are read back before resuming.

Each run creates a unique disposable quickchr machine, boots frozen,
patches RAM, then serves this checkout's `encode/enbeep.rsc` on
loopback. CHR fetches it via the user-network gateway `10.0.2.2` and
plays `Hello` in the same compound API call. Both API success and
offline verification of the sweep, exact payload, and Fletcher checksum
are required. There are no automatic transmit retries. Stop/remove
run on success and failure; cleanup errors fail the test too.
Command timeouts kill the CLI process group, including bunx's child,
so a hung command cannot keep its output pipes open indefinitely.
Both `add` and `start` specify the version: quickchr 0.5.3 otherwise
resolves the stable channel before looking up a named machine, adding
an unnecessary network dependency even with a cached pinned image.

Evidence stays in `.scratch/chr-beep/run-*/`: provenance README, gdb
script/log, raw `cap.wav`, sliced `frame.wav` with repaired WAV lengths,
offline `result.json`, QEMU log, and `failure.txt` when applicable.
Only stages reached produce files. A failure names the evidence path
and machine; after an external interruption, remove that exact machine
with `bunx --package @tikoci/quickchr@0.5.3 quickchr remove <name>`.
The test has a 25-minute limit; normal local KVM/TCG runs take about a
minute. It is not a long-lived VM fixture.

The separate [CHR beep workflow](../.github/workflows/chr-beep.yml)
runs on PRs and main pushes, with a seven-day `chr-beep` evidence
artifact. It is supplementary, outside the three required CI jobs
and the Pages deployment gate. It has been rehearsed with `act`;
actual GitHub-hosted runner proof waits on NS-1. Both KVM and a forced
TCG rehearsal without `/dev/kvm` passed, including evidence upload.
The TCG retry used a read-only cached stock image: the preceding
cold-cache run hit a MikroTik download outage before VM creation.
That remained a failed test, with diagnostics uploaded.

To rehearse that workflow locally with Docker and `act` (omit the
`--container-options` pair on a host without `/dev/kvm`):

```bash
mkdir -p .scratch/act-artifacts
act push -W .github/workflows/chr-beep.yml -j chr-beep \
  -P ubuntu-latest=catthehacker/ubuntu:act-latest \
  --container-options '--device /dev/kvm' \
  --artifact-server-path "$PWD/.scratch/act-artifacts"
```

The rest of this document records the investigation behind the harness.

## The `:beep` chain on x86 CHR

Unpacked from `/var/pdb/system/image` (NPK container, magic
`1e f1 d0 ba`, squashfs at offset 0x1000) in CHR 7.25:

1. `:beep` is a console builtin. It sends a message to `nova/bin/sys2`.
2. sys2's beep handler (at `0x80594e1`, switch on message id) issues
   `ioctl(fd, 0x6705, freq_millihertz)` for tone-on and `0x6706` for
   off, where `fd` is `/dev/ticker`, opened **once** at sys2 init.
   If `fd == -1` the handler takes a silent early-out branch —
   `:beep` returns OK and does nothing. There is no re-open.
3. `/dev/ticker` belongs to `lib/modules/5.6.3-64/drivers/char/ticker.ko`
   (misc device, minor 243). The module programs the PC speaker
   directly: divisor to ports `0x42`/`0x43` (PIT channel 2, mode 3),
   gate on `0x61`, divisor `1193182000/freq`. Supported ioctls:
   `0x6704` timed beep, `0x6705` tone on, `0x6706` off, `0x6708`
   tone sequence; `0x6707` returns `-ENOTTY`.

No Linux sound stack is involved: the image has no `pcspkr.ko`,
no `snd-*.ko`, and the kernel has no ALSA (`soundcore` absent).
This matches the `tikoci/mikrotik-gpl` disclosure (`CONFIG_SOUND`
off, `CONFIG_INPUT_MISC` off killing the pc-speaker driver) and
kernel 5.6.3 in the inspected CHR image. MikroTik's GPIO beeper code
in the disclosure covers only physical RouterBOARDs (mips/powerpc/tile/arm).

## The catch-22 (both halves proven live)

**Gate 1 — sys2 skips the driver in a VM.** At sys2 init
(`nova/bin/sys2` vaddr `0x805c937`, file offset `0x14937`):

```
0f a2       cpuid            ; EAX=1 (leaf 1, set just above)
85 c9       test   %ecx,%ecx
78 14       js     skip      ; ECX bit 31 = hypervisor present
...         insmod("drivers/char/ticker.ko", "")
skip:
...         open("/dev/ticker", O_WRONLY)   ; unconditional, fails
```

The tested KVM and QEMU TCG CPU configurations both set the hypervisor
bit, so the insmod is skipped, the open fails, `fd` stays -1, and every
`:beep` silently no-ops. The insmod string has exactly one
cross-reference, so this is the only load path. The module itself
has no hardware check (`isSpkCtlBad` validates the ioctl argument,
not hardware) — if loaded, it would write the ports unconditionally.

**Gate 2 — clearing the hypervisor bit prevents boot.** Booting the same image
with `-cpu qemu64,-hypervisor` or `-cpu host,-hypervisor` makes
QEMU exit 0 after ~4 s with an empty serial log, under both KVM
and TCG. A bare-metal control (floppy speaker image, same flags)
stays up. We infer a guest boot guard from these results; that
guard's implementation was not located in disassembly.

Together: hypervisor bit set → boots, no speaker driver;
bit clear → no boot, for the tested configurations. Simply clearing
the bit did not unlock stock CHR audio; the working procedure patches
the later speaker-init branch instead.

## The QEMU side works (positive control)

PC-speaker capture on `-M pc` needs explicit wiring; all verified
on QEMU 11.1.2:

```
-M pc,pcspk-audiodev=wav -audiodev wav,id=wav,path=cap.wav
```

- `pcspk` is not a pluggable `-device` on QEMU 11; it is wired via
  the machine property `pcspk-audiodev`. `-soundhw` no longer exists.
- With `wav` audiodev alone (no `pcspk-audiodev`), no file is produced.
- Positive control: a 512-byte boot sector programming PIT ch2 at
  1000 Hz, 8 s under KVM → 1,384,372-byte WAV (~7.9 s of audio).
  Capture works identically under KVM, so acceleration is not a variable.
- Quirk: QEMU leaves the RIFF/data length fields zero — parse the PCM
  payload directly (44-byte header, then stereo s16le 44.1 kHz by
  default). Python's `wave` module rejects the header.
- quickchr 0.5.3 wires this up: `--qemu-arg` passthrough (a second
  `-M pc,pcspk-audiodev=cap` last-wins over quickchr's own `-M pc`,
  verified live) plus `start --frozen` (gdbstub on
  `<machineDir>/gdb.sock`) / `continue` for the RAM patch below. The
  NS-30 harness uses only those primitives, no hand-built QEMU.

## Live probe log (x86)

| # | Guest / flags | Action | Result |
|---|---|---|---|
| 1 | CHR 7.25, KVM, pcspk-audiodev | `:beep 2000 Hz 1 s`, `:delay`, `:beep 3000 Hz 1 s` via REST (`centrs execute --via rest-api`, all `ok`) | `cap.wav` = 44 bytes (header only). Guest never touched the speaker. `/log` clean. |
| 2 | floppy speaker image, KVM, pcspk-audiodev | boot, run 8 s | 1,384,372-byte WAV. Capture path proven; guest silence is RouterOS's doing. |
| 3 | CHR 7.25, KVM, `+ -cpu host,-hypervisor` | boot | QEMU exits 0 after ~4 s, empty serial. |
| 4 | CHR 7.25, KVM, `+ -cpu qemu64,-hypervisor` | boot | Same: exit 0 after ~4 s. (`-cpu qemu64` without the minus flag boots fine — the bit is the variable.) |
| 5 | CHR 7.25, TCG, `+ -cpu qemu64,-hypervisor` | boot | Same: exit 0. Guard is accel-independent. |

## ARM64: no viable track

The ARM64 CHR image also ships `drivers/char/ticker.ko`, but with a
GPIO backend: `gpio_beep_probe`, `compatible = "rb,gpio-beep"`,
`gpiod_*` calls. The QEMU `virt` DTB has no such node, so the probe
can never bind — and even with DT surgery the toggles would land on
a virtual GPIO with no audio linkage (capture would mean
synthesizing audio from GPIO traces, not recording sound). Worse,
ARM64 sys2 shows the same virtualization awareness via DMI: the
strings `/sys/class/dmi/id/chassis_vendor` and `QEMU` sit adjacent
to the `ticker.ko`/`/dev/ticker` references. ARM64 was inspected,
never booted; not worth pursuing for acoustic testing.

(On real hardware there is no x86/ARM divide — beeper presence is
per RouterBOARD model, e.g. ARM-based RB1100AHx4 has a fast piezo
while newer ARM boards have none.)

## The working procedure (2026-10-28, verified)

Stock CHR 7.25 image, no modification. The gate is patched in guest
RAM once per boot:

1. Boot frozen with gdbstub and audio capture:
   `qemu-system-x86_64 -M pc,pcspk-audiodev=cap -accel kvm
   -drive file=chr-7.25.img,format=raw,if=virtio -netdev user,...`
   `-audiodev wav,id=cap,path=cap.wav -display none -s -S`
2. `gdb -batch`: `target remote :1234`, `hb *0x805c93b`,
   `continue`. When it hits, verify bytes `78 14`, write
   `90 90`, verify, `detach`. (The inspected sys2 is a fixed-address,
   non-PIE 32-bit executable.) Then boot continues; sys2 loads `ticker.ko`
   and `:beep` works.
3. Drive `:beep` over REST as usual. Note `cap.wav`'s size before
   transmitting — the file also contains an earlier ~0.2 s boot
   beep at 1000 Hz.
4. Slice the frame's bytes, wrap in a correct WAV header (QEMU
   leaves RIFF lengths zero; the project's `readWav` wants them),
   decode with `bun run frame:decode --file <wav> --sym 200`.

Verified result: `$enbeepText "Hello" 200ms 200ms no` →
10.43 s capture → decode `ok:true`, sweep nibbles 0–15, offset
4 Hz, payload `[72,101,108,108,111]`, Fletcher OK. A 2000/3000 Hz
two-tone check decoded exact frequencies and 1.0 s durations.

Caveats for harness use:

- **Gaps are not captured.** QEMU's pcspk backend emits samples only
  while the speaker is enabled, so the WAV is concatenated tone
  bursts with no timeline. For `tone == sym` configs (the standard
  200 ms/200 ms: continuous tones, no gaps even acoustically) the
  capture is complete. For `tone < sym` (e.g. 400 ms/300 ms) the
  decay gaps are lost; whether the decoder tolerates that is
  untested.
- **RAM patch per boot.** gdb must attach before sys2's init runs;
  booting frozen (`-S`) makes this deterministic. KVM clears x86
  debug registers on guest reboot, so breakpoints do not survive
  one. A guest reboot loses the patch and must fail the current test.
- Harness notes (NS-30, all observed live): drive fetch-parse and
  transmit as **one compound API call** — a transmit in the call after
  a good fetch-load was once rejected; the compound call passes in the
  recorded runs. The session/global cause has not been isolated.
  KVM is optional: the full test passes under
  `-accel tcg` in 53 s on an i7-6700TE (virtual-time audio decodes
  identically; budget generous timeouts on slower hosts). One
  unexplained CHR reboot occurred during a ~1 h lab session (uptime
  reset; patch and globals lost) — the harness fails loud on this via
  API failure, missing capture growth, or failed decode. Do not assume
  a patched CHR stays up indefinitely.

Open follow-ups live in [NEXT_STEPS.md](../NEXT_STEPS.md).

## Rejected approaches

1. ~~**Patch `sys2` in a copied guest image.**~~ Tried, blocked:
   rebuilt NPKs (pristine tree + stock bytes except the 2-byte
   sys2 patch; also a byte-identical-content control rebuilt with
   two mksquashfs versions) are rejected at boot with
   `ERROR: no system package found!` from init's package scan,
   while the original NPK written back through the same debugfs
   procedure boots fine. So boot DOES verify the NPK somehow.
   Partially mapped since: init (in the kernel's embedded
   initramfs cpio) parses NPK attributes and hashes through a
   streaming SHA256 object; the exact hashed input and expected
   digest location were not pinned down (the 40-hex header field
   matches no plain region hash tried). The RAM-patch procedure
   above makes this track unnecessary for lab use.
2. **QGA `guest-exec`** — unlikely. Would need RouterOS's guest agent
   to support arbitrary exec (doubtful), and even then sys2's `fd`
   is opened once at boot, so a manually insmodded ticker.ko would
   still leave `:beep` silent until a sys2 restart (i.e. reboot,
   re-arming the gate). Rejected without testing.
3. **Timed CPUID flip** (bit set for the boot guard, clear for sys2's
   init seconds later) — no QEMU interface can change CPUID at
   runtime; would need a custom QEMU build. Impractical.
   Superseded by the RAM patch.

## Evidence index

- Disassembly offsets above are for CHR 7.25 x86 (`sys2` 302160
  bytes, ELF32-i386; `ticker.ko` 7080 bytes, ELF64, vermagic
  `5.6.3-64`). CHR 7.26beta3 reproduces the same ticker.ko symbols,
  port-I/O fingerprint, ioctls, and sys2 `/dev/ticker` reference.
- Scratch for this probe (kept locally, gitignored):
  `.scratch/2026-10-28-chr-beep/` — `README.md` (commands),
  `gen_boot.py` (floppy generator), `analyze.py` (Goertzel timeline),
  `cap.wav` (full session capture: boot beep + two-tone check +
  Hello frame), `hello.wav` (sliced frame with fixed header —
  decodes to `Hello`).
- Carved image copies and ad-hoc parsers lived in `/tmp/chr-beep`
  (disposable, not preserved).
- Kernel-config half of this story: [tikoci/mikrotik-gpl](https://github.com/tikoci/mikrotik-gpl),
  `2025-03-19/configs/{x86_64,arm64}.config`
  (`CONFIG_SOUND` unset on both; `PCSPKR_PLATFORM=y` on x86 is an
  arch-default stub with no driver behind it).
