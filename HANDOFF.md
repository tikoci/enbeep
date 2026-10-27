# enbeep: handoff for Muse Code

*Claude Code (Habitat B), 2026-10-25 late evening, at the applicant's request. This covers where the code stands and what to work on first. The demo decision and its reasons are in `../demo-hardware-notes.md` (#27), which you should read first. Status labels follow the folder rules in `../AGENTS.md`.*

## What this is

`enbeep` is the `:beep` acoustic modem from #27. A RouterOS script plays MFSK-16 tones on the router's piezo: each byte is split into two 4-bit nibbles, and nibble *n* is played at 2000 + 100·*n* Hz, with 4000 Hz as the sync tone. A decoder listens through a microphone and turns the tones back into text. The applicant wrote it with LLMs in March 2026. It ran on one MikroTik (hAP ac lite) recorded with an iPhone, decoded a hardcoded "Hello", and was shelved. It was never on GitHub. This folder is a **copy of the working tree** (no `.git`, `node_modules` or caches). The Mac repo had a single "initial checkin" commit plus uncommitted work, all of which is included here.

**The demo use (decided, #27):** the router beeps **its name and IP address**. The decoder shows them on screen, and the agent takes that and continues over the normal path. The beep is the opening handshake and never carries anything the demo depends on. The applicant will record it with a real microphone over Dante, not an iPhone, and the submission is a recorded video, so takes can be redone.

## File map

| Path | What it is | State |
|---|---|---|
| `encode/enbeep-200ms.rsc` | Calibration sweep followed by a **hardcoded** "Hello" at 200 ms per symbol | Worked on hardware [JOURNALED] |
| `encode/enbeep-test.rsc` | Calibration sweeps at 50/100/150 ms followed by "Hello" at 50 ms | Worked on hardware; use it to re-measure timing |
| `encode/enbeep1.rsc` | First general text encoder | **Broken on RouterOS 7**: it was written for the RouterOS 6 behaviour where `:beep` waits for the tone to finish |
| `encode/enbeep2.rsc` | "Corrected" general text encoder | **Still broken**: see flag 2 |
| `decode/analyze_recording.py` | Offline analyzer for recordings made with the test scripts (finds sections, auto-calibrates, reports accuracy) | 18 tests pass [VERIFIED today] |
| `decode/debeep.gemi1.py` | Original offline decoder (fixed 50 ms windows) | Produces garbage on `iphone-test1.wav`, which was recorded from the broken encoder |
| `decode/probe_*.py` | Throwaway scripts for inspecting FFT output and sync-tone detection | For reference only |
| `live.html` + `serve.ts` | Live decoder in the browser: microphone input, Web Audio spectrum, scrolling waterfall display, state machine | **This is what goes on camera.** It needs work: flags 3–5 |
| `src/*.ts` | Bun wrappers: `afconvert` m4a→wav, and a batch decode runner | Run on macOS only |
| `samples/` | Five real recordings, each as the iPhone m4a original plus a WAV conversion | No location metadata found in the m4a files [VERIFIED today] |
| `README.md`, `.github/copilot-instructions.md` | The previous agents' notes | **Their "hardware findings" don't match the current analyzer output.** See flag 1 |

How to run it: `bun install` (dev tools only), then `bun run test:py` (needs Python 3 with numpy and scipy; tested here on 3.14 / numpy 2.5 / scipy 1.18), then `python3 decode/analyze_recording.py samples/<file>.wav`, then `bun run serve` and open `http://localhost:3456`.

## Flags, concerns and pushback

1. **The written findings are contradicted by the code's own output. Don't build on them.** README and copilot-instructions say symbols shorter than 200 ms are unreliable ("`:delay` rounds to ~0") and that the piezo plays about 100 Hz sharp. Today I ran the current analyzer on all four calibration recordings [VERIFIED]:

   | Recording | Measured offset | 50 ms sweep | 100 ms | 150 ms | "Hello" payload |
   |---|---|---|---|---|---|
   | enbeepTest | −1 Hz | 97.9% | 100% | 25% | FAIL (empty) |
   | enbeepTest2 | 0 Hz | 100% | 100% | 100% | FAIL ("HelÌÏ") |
   | enbeep200ms-lossless | 0 Hz | n/a | n/a | n/a | PASS at 200 ms |
   | enbeep200ms-lossy | 0 Hz | n/a | n/a | n/a | PASS at 200 ms |

   The measured section lengths also match their nominal durations (2.60 s for a nominal 2.55 s at 50 ms), so the hardware was producing short symbols correctly. The 200 ms floor and the +100 Hz offset probably came from an earlier, buggier analyzer. All of this is one device and a phone mic. **Re-measure on the actual demo router (RB953) with the real mic before choosing a symbol length.** The weak point is how the payload is framed and decoded, not the tones themselves: "Hello" failed at 50 ms on both recordings even where the sweeps scored about 100%.

2. **No general encoder works yet.** The only scripts that have worked on hardware play hardcoded tone lists. `enbeep2.rsc` removed every `:delay`. Since `:beep` returns immediately on RouterOS 7 (the repo's own finding), each tone replaces the previous one and the router plays only the last. Writing `$enbeep "text"` correctly (beep, then `:delay` for the same length) is **the first real task**. Two simplifications:
   - Use `:convert $s to=byte-array` (added in RouterOS 7.15 [VERIFIED: rosetta changelog]) in place of the hand-built ASCII table. The table has a stray `\a` in enbeep1, and its handling of characters it can't find is wrong.
   - Check the demo router's RouterOS version first.

3. **Repeated symbols merge in the live decoder.** `live.html` treats a change of frequency as the start of a new symbol (`processFrame`). Two identical nibbles in a row play as one long tone and decode as a single nibble. Name and IP payloads will hit this: `'3'`=0x33, `'f'`=0x66, `'w'`=0x77, and so on. The Python decoders count time slots and don't have this problem. Two possible fixes, in order of my preference [OPINION]:
   - **Incremental frequency keying (IFK).** Use 17 tones; each tone is (previous tone + value + 1) mod 17. Consecutive tones always differ, and because the data lives in the difference between tones, a constant pitch offset no longer matters (which also makes flag 4 moot). It's a few lines of RouterOS arithmetic.
   - **A dedicated "repeat" tone** that means "same nibble as the last one".

   Either way, the encoder and both decoders change together.

4. **The live decoder doesn't correct for pitch offset.** It matches each tone to the nearest nibble frequency, and nibbles are 100 Hz apart. If the RB953 plays even 60 Hz sharp, every nibble decodes as its neighbour. Either do a short calibration at the start of each transmission (the analyzer already estimates the offset from its sweep) or use IFK.

5. **Never film the "Demo" button.** `live.html` has a Demo button that generates "Hello" with oscillators inside the browser and feeds them straight into the decoder, with no speaker or microphone involved. It's a handy self-test, but on video it would show a decode the hardware didn't do. Claims discipline applies to the video too: the filmed decode has to come from the router. Rename the button, or hide it in the filming build.

6. **The payload is too large as written.** At 200 ms per symbol, `"rb953-demo 192.168.88.1"` takes about 10 s. Send the IP as 4 raw bytes (8 tones, 1.6 s) and keep the identity to 8 characters or fewer. **Add a checksum** (a byte sum mod 256 is enough; RouterOS script has bitwise operators if you want CRC-8, but check that on CHR) so the screen can show **✓ verified**. The checksum is what makes the decode credible on video. Sketch [OPINION, unbuilt]: `SYNC · len · identity · ip[4] · sum · SYNC`. That's about 30 tones: roughly 6 s at 200 ms, 3 s at 100 ms.

7. **Use the IP the router really has, on a demo network.** The script should read the address at runtime (`/ip/address`). A DHCP client can run a script when it gets a lease, which gives the strongest version of the gag: plug the router in, it gets an address, and it beeps where you can find it. Not tested: CHR has no speaker, so quickchr can only check that the script parses and runs. Whatever IP appears on screen is in the video, so use a lab address range on the demo network, not the private network's real addressing (folder privacy rule).

8. **Mic and Dante.**
   - Record WAV at 48 kHz directly. The m4a/`afconvert` step was only there for iPhone Voice Memos.
   - `afconvert` is macOS-only. The Linux build machine needs `ffmpeg` if it converts anything.
   - The analyzer reads the sample rate from the file, so 48 kHz needs no code change [VERIFIED by reading the code, not run at 48 k].
   - `live.html` opens the **default** input device. Add a device picker (`enumerateDevices`) or set the Dante Virtual Soundcard channel as the system input.
   - It already turns off the browser's echo cancellation, noise suppression and auto gain control.

9. **Where it runs.** The decoder needs the microphone, so it runs on the desktop, as #27 already splits it. Muse Code's Linux box can own the encoder, the decoders and tests driven by the samples, but it can't be used for filming unless it has the mic.

10. **Timebox it [OPINION].** #24 already warns that the folder's attention drifts toward infrastructure. This is a cold open that can be cut. Suggested budget: **one day of agent time**, then a go/no-go call on the real-hardware recording. If the RB953 in its sealed metal case isn't loud enough (#27 open question 2), the fallback is the RB953 out of its case, or a different unit that beeps.

11. **Placement.** In the build repo, put this in its own directory (e.g. `demo/enbeep/`) with its own tests, kept out of the product path. Keep Python for offline analysis and regression checks against the recorded samples, and `live.html` for the screen. Don't port the Python to TypeScript just for consistency unless the live decoder needs that code.

## Parlor tricks worth considering [OPINION, unproven]

You asked for sounds that stand out. These play on what the hardware already does:

- **The calibration sweep sounds like a modem handshake.** Sixteen rising tones followed by a 4000 Hz squeal reads as "dial-up" to anyone over 35. Keep a short sweep as the preamble: it's also the offset calibration from flag 4. It's practical and it's the recognizable sound.
- **Roll call:** several RB953s on a shelf, each beeping its name in turn, with the waterfall showing one burst per router and the agent building the inventory as they arrive. The routers come from the "dozens on hand" in #27, and it is the "Look after" fleet in audio form. Have them take turns. Two routers sharing the frequency band at once is a research project; skip it.
- **The presenter beat** from #27: point the mic at the router "to hear what it has to say."
- The waterfall is the visual. Make it large on screen and render the decoded text in big type with the ✓.

## Suggested starting place (in order)

1. Read #27, then this file. Run `bun run test:py` and the analyzer on `samples/*.wav`. You should reproduce the flag 1 table (about 5 minutes).
2. Write a general RouterOS 7 encoder `$enbeep` (flag 2), with framing that avoids repeated tones and a checksum (flags 3 and 6). Check it parses and runs on a quickchr CHR.
3. **Gate:** the applicant records `enbeep-test.rsc` on the actual demo RB953 through the real mic, as a WAV. Pick the symbol length and decide whether offset handling is needed **from that recording**, not from the old README.
4. Update `live.html`: input picker, the new framing, offset calibration, a big result card with ✓, and the Demo button renamed or hidden (flags 4, 5, 8).
5. Hand the result to the product: the decoded `{identity, ip}` goes to `serve.ts`, which writes it where the agent picks it up. That's the point where the gag turns into the product story.
6. Film. Retake as needed. Cut the segment if it doesn't land.
