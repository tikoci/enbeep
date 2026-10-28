# Loading the enbeep encoder onto a box

The encoder is `:global` functions. RouterOS globals are **RAM-only**: they
vanish on reboot and must be reloaded (or dropped deliberately with
`/system/script/environment/remove [find where name~"enbeep"]`).
Each function body re-declares the globals it calls, per the scripting
manual, and bad inputs fail fast with an `enbeep:`-prefixed error before
any beep: empty or >255-byte payloads, sym/tone that are not times (bare
`200` would silently mean 200 *seconds*), tone longer than the symbol, or
an unknown interface/address selection.

Loading history: on 7.16 (RB953), `/import`-defined globals silently could
not call other globals (nested calls no-op, no error), and API-loaded
(centrs, recipe B) definitions could fail the same way; symptom is a
dry-run that prints META but no FRAME — reload via recipe A. That predates
the `:global` hardening above, which is the documented fix for exactly
this failure, but it still needs a re-test on real 7.16 hardware: until
then, CLI paste (SSH, recipe A) remains the verified recipe there. On CHR
7.26beta3, paste, API-load, `/import`, and `[:parse ...]`-loading all nest
correctly. (The 7.16 observation came after a silent global loss with no
reboot on 2026-10-27; the loss itself is unexplained.)

## First try: router terminal + web receiver

Use a lab device with a working beeper; support on other hardware is
experimental. The encoder reads interface MAC, a selected IPv4 address,
and CPU load, then sounds the beeper. It defines RAM globals; it does
not install a script/scheduler or change network configuration.
RouterOS's [`:beep` and `:convert` commands](https://manual.mikrotik.com/docs/developer-guides/scripting/)
are the primitives used here; measured hardware behavior is recorded in
[TESTING.md](../docs/TESTING.md).

1. Open a RouterOS terminal (WinBox, WebFig, SSH, or serial). Check the
   beeper with `:beep frequency=4000 length=500ms`. No audible beep means
   this is not yet a usable acoustic sender.
2. Paste the complete contents of [enbeep.rsc](enbeep.rsc)
   into that terminal. If multiline paste is troublesome, use recipe A
   below. Do not `/import` it as a substitute on 7.16.
3. Run `/interface print` and `/ip address print` in that terminal.
   Choose the interface whose MAC you want and the IPv4 entry to send
   (these are selected independently). An address row number works in
   that interactive session; do not assume row `0` in a fresh SSH/API
   call is the same entry. For automation, select exactly one entry by
   its literal address, for example
   `[/ip/address/find where address="192.0.2.1/24"]` in place of `0`
   below. Replace the example with an address already on your router;
   an empty/multiple match is not a valid selection.
4. Dry-run silently, substituting your interface and address selection:

   ```routeros
   $enbeepAnnounce "bridge" 0 200ms 200ms yes
   ```

   Expect META (MAC/IP), FRAME (length/checksum), SYNC and T: lines.
   META without FRAME is a failed load, not a successful dry-run.
   MAC/IP should match the receiver later; CPU/checksum can change
   between a dry-run and a real transmission.
5. Start the [web receiver](../README.md#try-a-beeping-mikrotik-router)
   at **200 ms**, then call the same function with `no` instead of
   `yes`. Keep the terminal connected through the ~13 s frame. At
   400 ms, the frame takes ~22 s; set the receiver to match.

The announce arguments are `(interface, addressRowOrId, symbol, tone,
dry)`. Tone should be no longer than the symbol slot. Text uses the same
framing with `(text, symbol, tone, dry)`:

```routeros
$enbeepText "Hello" 200ms 200ms yes
$enbeepText "Hello" 200ms 200ms no
```

The web receiver shows payloads as hex with a printable-ASCII reading;
an 11-byte payload also gets an announcement reading by convention.
The format has no payload type tag. Start with short ASCII text; see
the [current implementation limits](../docs/SPEC.md#current-implementation-limits).
Text transmission has less hardware coverage than announcements.
The text helper's argument order was corrected during the 2026-10-27
readiness review; `"Hello" 200ms 200ms yes` was dry-run on CHR
7.26beta3 and matched the shared v2 tone plan (len=5, f1=250, f2=170).
That is logic evidence, not a new over-air hardware result.
Reload the globals after reboot. `/tool fetch` + parse-loading works on
CHR 7.26beta3 (recipe C) but NS-5 still needs one real 7.16 box; do not
use it as the first-try recipe until then.

## Recipe A: SSH from a checkout

Any SSH client; Python below only minifies the source:

```bash
# 1. minify: strip #-lines/blank lines, join with spaces
python3 -c "
lines = [l.strip() for l in open('encode/enbeep.rsc')]
one = ' '.join(l for l in lines if l and not l.startswith('#'))
from pathlib import Path
Path('.scratch').mkdir(exist_ok=True)
Path('.scratch/enbeep-min.rsc').write_text(one)
print(len(one), 'chars')
"
# 2. paste as one SSH command (replace user/host; quote so \$vars survive)
ssh admin@192.168.88.1 "$(cat .scratch/enbeep-min.rsc)"
# 3. verify: dry-run must print META + FRAME + sweep T: + data T: lines
# Replace bridge and the example address with values already on your router.
ssh admin@192.168.88.1 '$enbeepAnnounce "bridge" [/ip/address/find where address="192.0.2.1/24"] 200ms 200ms yes'
```

Find the interface name and IPv4 address on your box first
(`/interface print`, `/ip address print`); the selector must match exactly
one address you want announced. A long frame needs a generous client timeout
(a 200 ms announce frame is ~13 s on air; a 10 s default kills it mid-frame).

## Recipe B: optional centrs tooling

Via centrs (TIKOCI's RouterOS tooling, if installed):

```bash
# 1. minify: strip #-lines/blank lines, join with spaces
python3 -c "
lines = [l.strip() for l in open('encode/enbeep.rsc')]
one = ' '.join(l for l in lines if l and not l.startswith('#'))
from pathlib import Path
Path('.scratch').mkdir(exist_ok=True)
Path('.scratch/enbeep-min.rsc').write_text(one)
print(len(one), 'chars')
"
# 2. paste as one command (python keeps \$vars exact, no shell interpolation)
python3 -c "
import subprocess
cmd = open('.scratch/enbeep-min.rsc').read()
r = subprocess.run(['centrs', 'execute', '<handle>', cmd, '--yes',
                    '--timeout', '60s'], capture_output=True, text=True)
print('RC:', r.returncode, r.stdout[:200], r.stderr[:200])
"
# 3. verify: dry-run must print META + FRAME + sweep T: + data T: lines
centrs execute <handle> --yes -- '$enbeepAnnounce "bridge" [/ip/address/find where address="192.0.2.1/24"] 200ms 200ms yes'
```

Find `<handle>` / interface / address per box (`centrs devices show`,
`/ip address print`); replace the example address in the verify command.

## Recipe C: experimental fetch from the site (CHR-verified, needs 7.16 hardware)

One line, no file download: fetch returns the script as data and `:parse`
runs it in the current scope, like a paste:

```routeros
[:parse ([/tool/fetch url="https://<site>/enbeep.rsc" output=user as-value]->"data")]
```

Replace `<site>` with the host serving the decoder page; the page's Try it
tab shows this command with the URL filled in. Verified on CHR 7.26beta3
(dry-run prints the full FRAME + T: trace, no file left on flash); the
older two-step fetch-to-file + `[:parse [/file/get ... contents]]` form
passed there too. NS-5 keeps this experimental until one real 7.16 box
confirms it. Verify with the dry-run in step 4 above: META without FRAME
means the load failed.

Validated hardware (lab codenames in `samples/` map to these models):

- RB1100AHx4 (RouterOS 7.26): `"bridge" <row>`; fast piezo, 200 ms works.
- RB953GS-5HnT (RouterOS 7.16.2): `"bridge" <row>`; slow piezo in a metal
  enclosure, paste-load only, prefers 400 ms slot + shorter tone
  (`... 400ms 300ms no`).

Other RouterOS 7.15+ devices with a piezo beeper are experiments; please
report model, RouterOS version, symbol length, and mic in an issue (see
[../docs/TESTING.md](../docs/TESTING.md)). Devices without a beeper
(CHR, most ARM cloud images) can only dry-run (`yes`).
