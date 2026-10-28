---
name: aes67-mic-path
description: Set up the Linux AES67 lab-audio path (aes67-linux-daemon plus Merging Ravenna ALSA) so a Dante AVIO AI2 in AES67 mode appears as an ALSA capture device for enbeep rig captures. Use when adding a new mic, moving a mic, debugging silence, hum, or flaky decodes on the AES67 path, or onboarding a new AES67 source.
---

# AES67 mic path (Linux lab setup)

Environment playbook. Enbeep itself stays out of the driver business: the
environment provides an ALSA capture device, the rig just takes `--mic`.
Dante support here means AES67 mode only (no DVS, no Dante-native).

## Stack

- `aes67-linux-daemon` 4.0.3 (own PTP slave, SAP browser, WebUI on :8080)
- `MergingRavennaALSA.ko` kernel module (virtual ALSA card `RAVENNA`)
- Dante AVIO AI2 (or similar) in AES67 mode, publishing a multicast flow
- enbeep rig unchanged: `--mic plughw:RAVENNA --channels 2`

## Machine prerequisites

- Kernel headers plus gcc; hardware PTP NIC (`/dev/ptp0` present)
- Secure Boot off (unsigned out-of-tree module)
- Omarchy scheme: `mise` for tools, `omarchy pkg add` for packages
  (`cmake`, `boost`, `tcpdump`, `faac`), `pkexec` for privileged commands
- ufw default-deny: allow `9875/udp` (SAP), `319:320/udp` (PTP),
  `5004:5020/udp` (RTP)

## Daemon and driver

Build the daemon per its own README. On this box the `build.sh` clang rule
misfires on the kernel module (`-mpreferred-stack-boundary` and friends);
rebuild the module with GCC and `insmod` by absolute path (pkexec loses cwd).
Persist with `/etc/modules-load.d/aes67.conf` plus the module under
`/lib/modules/.../updates`, install the service with the repo's
`systemd/install.sh` (pkexec-adapted), enable and start it.

`daemon.conf`: set the real NIC (`enp0s31f6` here), SAP `224.2.127.254`.
Health: `GET /api/ptp/status` locked, `GET /api/sink/status/0` shows
`receiving_rtp_packet:true` with all error flags false.

## Dante Controller recipe (AVIO AES67 TX)

Device must be in AES67 mode. Multicast flows are NOT created from the
Device View Transmit tab (Add is greyed out for AES67): use the top menu
**Device > Create Multicast Flow**, then read the address off the
Multicast Transmit Flows list, e.g. `239.69.23.137:5004`. No flow, no RTP,
no SAP: everything downstream stays silent.

AVIO AI2 notes: inputs are line-level (+24dBu default, no preamp), so a
dynamic mic lands very low (approximately -100 dBFS at 20 cm). There is no
usable gain staging on the unit; see the gain hierarchy below.

## Sink configuration (AVIO sends no SAP)

The daemon cannot discover the stream, so self-host the SDP on the daemon
WebUI directory and point the sink at it with `use_sdp:true`:

- SDP: 48 kHz, 2 ch, PCM, `239.69.23.137:5004` (adapt address as needed)
- `PUT /api/sink/0` with the SDP URL, or seed `/etc/status.json`

Verify with `GET /api/sink/status/0`: `receiving_rtp_packet:true`.

## Rig use

```bash
mkdir -p .scratch/captures
bun run rig:capture --mic plughw:RAVENNA --channels 2 \
  --out .scratch/captures/aes67-<name>.wav --dur 50 --lead 6 --target pierce \
  -- '$enbeepAnnounce "bridge" 3 400ms 400ms no'
bun run rig:analyze --file .scratch/captures/aes67-<name>.wav --sym 400
```

Use `plughw:`, never `hw:` (preflight cannot probe it; that note is normal).
Always record both channels even for a mono mic on CH1.

## Gain hierarchy (read before reaching for a preamp)

1. Digital gain in post is a verdict no-op (proven IDENTICAL on raw vs
   +40 dB): it helps humans hear, never helps the decoder.
2. An analog preamp only helps against the converter floor (-114 dBFS).
   Against room noise or mains hum it amplifies signal and noise equally:
   SNR-neutral, decode-neutral. Do not fetch hardware for a hum problem.
3. What moves the decode: mic closeness (signal up, ambient fixed) and
   killing tonal junk (hum harmonics reach the 4 kHz sync window).

## Mic-position protocol

Log mic model, distance, and geometry with every capture; re-validate every
new mic or spot before trusting it:

1. Envelope: floor near -114 (clean) vs -102 (hum, see below)? Frame bumps
   visible at PRE/SEP/END times?
2. Hum check: `rig:analyze --slots <silence-t> 2 1.0 50 8000`.
   Two mechanisms: (a) mic sitting on/near a UPS, inverter, or PSU brick
   lifts the whole broadband floor (saw -102 with the mic on an EcoFlow
   UPS) -- move the mic off it; (b) residual conducted 60/120/180 Hz in
   an otherwise clean -115 floor persists after the move -- suspects are
   ground loop (PoE plus shielded EtherCON plus audio ground is the Dante
   classic), broken XLR shield, or AI2 grounding. Its harmonics reach the
   4 kHz sync window and eat ratio2 margin directly.
3. Margin: sync ratio2 must clear 0.15 with room to spare; 0.18 passed,
   0.141 failed. Near-misses mean SNR, not gain: get closer or quieter.

Log every spot the same way so runs stay comparable: beeper, mic model,
distance in cm, clock-angle and height in cm relative to the beeper, and
the cable route (what the mic sits on or hangs from, what the cable runs
past). Prefer fixed hang points over bench surfaces (benches collect PSU
bricks). A phone photo of the geometry beats a paragraph.

Known-good anchor: SM58 hanging over pierce (RB953GS-5HnT),
AI2 +24dBu (2026-10-27, /tmp/aes67-sm58-hang.wav): floor -115.5 (clean),
signal -102 at PRE/SEP/END, residual conducted 60/120/180 Hz, sync
ratio2 0.149 vs the 0.15 gate -- REJECT by 0.001 on hum, not on path.
The path itself fully decoded this target before (/tmp/aes67-pierce2.wav:
exact MAC/IP/Fletcher, ratio2 0.18).

## Triage

| Symptom | Cause | Fix |
|---|---|---|
| No SAP, no RTP | Multicast flow not created | Dante menu recipe above |
| Zeros, -114 floor, `all_muted` | PTP unlocked / sink muted | Wait for lock, re-plug record |
| Flat -103, RTP payload non-zero | Analog front-end | Check mic plugged, AI2 input, position |
| -102 floor, 60 Hz peak | Mains hum | Cable hygiene, swap XLR, check ground |
| ratio2 near-miss (0.13-0.15) | Low SNR | Closer mic / quieter room, not preamp |
