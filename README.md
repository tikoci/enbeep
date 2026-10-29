# enbeep

Can a MikroTik router introduce itself by beeping its MAC and IP address?
enbeep is a **fun, experimental acoustic modem** that tries exactly that:
a RouterOS script uses `:beep` to play data through the router's piezo,
and a web page on a nearby laptop or phone listens through its microphone
and checks the bytes. It is a hobby project, not a production tool.
It uses MFSK-16 (16 pitches, four bits per tone), a calibration sweep, and
a Fletcher-16 checksum. A typical announcement takes about 13 seconds.

This is a demo and an ongoing experiment, with successful captures from
two router models. It is fragile: the beeper, enclosure, microphone,
room, and browser all matter. Expect rejected frames and hardware that
needs more experiments. A checksum pass checks the received bytes; it
does not authenticate the sender. Don't rely on this for provisioning,
monitoring, discovery, or anything operational.

The receiver shows the interface MAC, a selected IPv4 address, and CPU
load at transmit time. Those values travel audibly, without a network
connection between sender and receiver. Each transmission is one-way;
there is no acknowledgement or automatic retry. Part of the TIKOCI
experiments; not affiliated with or endorsed by MikroTik.

## How the beeps carry data

Each tone represents one hexadecimal digit: two tones make a byte. The
sender starts with a long sync beep and a sweep through all 16 pitches
so the receiver can check the signal and estimate its pitch offset. Then
it sends the length, the message bytes, and a checksum, ending with
another sync beep. The receiver checks the whole frame before calling
it verified.

The choices favor a small, understandable RouterOS script over speed.
The [scheme explained](docs/SPEC.md#why-this-scheme) covers the trade-offs
and links to Wikipedia for MFSK, nibbles, and acoustic interference; the
rest of that document specifies the exact wire format.

## Open the web interface

**Pre-publication:** there is no verified public demo URL yet. Until
[NS-1](NEXT_STEPS.md) records one, run the page locally:

```bash
bun install
bun run serve
# Open http://localhost:3456 on this computer.
```

The server provides the live decoder at `/` and the recording decoder at
`/harness.html`. No router tools are needed on the receiving computer.
Microphone access needs HTTPS or `localhost`; a phone opening
`http://<laptop-ip>:3456` does not get the localhost exception. For a
phone, use trusted HTTPS hosting (the planned GitHub Pages site), or
`bun run serve:tls` for a local certificate experiment. The generated
self-signed certificate may need device-specific trust setup; accepting
a warning alone is not a portable mic-access recipe.

Keep the receiver page visible and the screen awake during a frame.
Browser support is experimental: desktop live decoding has worked;
**iPhone has passed only the in-page Self-test, not an over-air frame**.
The [tested paths and capture instructions](docs/TESTING.md) distinguish
automated checks from hardware evidence.

## Try a beeping MikroTik router

You need a RouterOS 7.15+ device with a working piezo beeper, terminal
access, and a computer or phone with a microphone. Other models are
untested. A [patched CHR integration test](docs/CHR-BEEP.md) exercises
the encoder through a virtual PC speaker; physical acoustics still
need a beeper and microphone.

1. Open the receiver page. In **Decode**, choose **200 ms** and press
   **Start Listening**; allow microphone access. Place the mic about
   0.3 m from the beeper in a quiet room.
2. Follow [the encoder loading instructions](encode/README.md). They
   cover a terminal paste or SSH, choosing your interface and IPv4
   address, and a silent dry-run. (The page's **Try it** tab lists the
   same load + `$enbeepText` commands.) On 7.16, loading via `/import`
   or the API has failed; use the paste/SSH recipe. `/tool fetch`
   loading is still an experiment.
3. In that router terminal, after loading, run this example with **your
   interface and address selection**:

   ```routeros
   $enbeepAnnounce "bridge" 0 200ms 200ms no
   ```

   Here `0` selects an IPv4 address entry; see the loading guide before
   copying it. The MAC comes from the named interface, and the IP entry
   is selected separately. This reads those values and sounds the
   beeper; it does not configure networking or install a scheduler.
4. Wait for the whole frame (~13 s). A verified result should match your
   MAC/IP; CPU load varies between runs. A rejection is useful evidence,
   too. For a slow beeper, try **400 ms** on the receiver and
   `400ms 300ms no` on the router (~22 s).

RB1100AHx4 and RB953GS-5HnT captures are in the
[test results](docs/TESTING.md). Please report other models, whether they
pass or fail.

## Try two computers, laptops, or phones

One device's speaker can stand in for the router. This uses the **same v2
encoding**, including the sweep and checksum; it tests speakers and mics,
not RouterOS or a router piezo. This walkthrough still needs reports
from real device pairs.

1. Open the live page on both devices. The receiving device needs HTTPS
   or its own localhost server as described above.
2. On the **receiver**, open **Decode**, choose **200 ms** and **Start
   Listening**. Put it near the sender, with its page visible.
3. On the **sender**, open **Try it**, type a short ASCII message (or keep
   `Hello`), and press **Play message**. It plays the message through the speaker
   while also checking it internally. Use the built-in speaker at a
   moderate volume, with headphones/Bluetooth disconnected. `Hello`
   takes about 10 seconds plus a short wait; longer messages take longer.
   See the [current message limits](docs/SPEC.md#current-implementation-limits)
   before trying long messages or non-ASCII text.
4. Look at the **receiver's** result: it shows the message text plus hex.
   A pass on the sender alone proves only its internal decoder. It does
   not prove sound reached the other device. Both pages must use the
   same symbol length; if you retry at 400 ms, set both before starting
   again.

For a one-device check, use **Diagnostics → Self-test**. To test saved
audio, open `/harness.html`, choose a WAV from [samples/](samples/), and
match its symbol length. The [corpus guide](samples/README.md) identifies
successful frames, intentional rejects, probes, and legacy formats.

## Report a success or a problem

While the receiving page still has your attempt, open **Diagnostics →
Copy diagnostics report** and save it. The report keeps your last
session across one reset, but a second reset replaces it, so copy before
retrying twice. Then stop listening and use **Run checks** for a
separate environment check if needed; copy that report too.

Open a GitHub issue using **Capture report** once the repo is public, or
send the reports to the maintainer during this pre-publication phase.
Include the router model/RouterOS version (or both speaker/mic devices),
browser/OS, command, symbol length, distance, expected result, and what
happened. A WAV recording and harness/CLI JSON are especially helpful.
See [the reporting checklist](docs/TESTING.md#4-reporting-a-capture-what-actually-helps)
and [troubleshooting guide](docs/DIAG.md).

Review reports and recordings before sharing: they can expose MAC/IP,
device labels, page URLs, and background speech. The live page processes
audio locally, but posts verdicts and browser information to its own
host's `api/frame`; the supplied development server saves these in
ignored `frames.jsonl`. Static Pages hosting has no logging endpoint.
The WAV harness does not upload recordings. The live page also requests
optional Google Fonts; system fonts work when those are unavailable.

## Work on the experiment

Use Bun. For the audio regression suite, install Git LFS before cloning,
then fetch the fixtures with `git lfs pull`.

```bash
bun install && bun test && bunx tsc --noEmit && bun run lint
bun run frame:decode --file samples/bigdude-v2-200a.wav --sym 200
# Optional real-browser checks (synthetic audio, not hardware evidence):
bunx playwright install chromium
bun run test:browser
# Optional real RouterOS sender → virtual-speaker capture → offline decode:
# Linux x86_64, QEMU + gdb + network; setup and limits in docs/CHR-BEEP.md
bun run test:chr
```

The current structure is deliberately small:

| Path | Purpose |
|---|---|
| [encode/](encode/README.md) | RouterOS v2 encoder and loading recipes; older scripts are marked legacy |
| `src/` | WAV I/O, DSP, offline frame decoder, test synthesis |
| [live.html](live.html), [serve.ts](serve.ts) | Live Web Audio receiver and development server |
| [harness.html](harness.html), `web/` | Recording decoder using the shared offline codec |
| `test/`, [samples/](samples/README.md) | Codec, browser, and CHR checks; real acoustic regression fixtures |
| [rig/](rig/README.md) | Optional Linux recording/trigger tools for repeated hardware trials |
| `decode/`, `samples/legacy/` | Retired experiments + batch tools; outside the v2 path |

Start agent/contributor work at [AGENTS.md](AGENTS.md) and
[NEXT_STEPS.md](NEXT_STEPS.md), the sole work tracker. Branches, PRs,
and CI policy are in [CONTRIBUTING.md](CONTRIBUTING.md). The
[wire spec](docs/SPEC.md) is authoritative; keep both decoders and the
encoder aligned. Use ignored `.scratch/` for work worth retaining locally
between sessions; it is not part of a clone or a published test result.

License: [MIT](LICENSE).
