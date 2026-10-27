# Loading the enbeep encoder onto a box

The encoder is `:global` functions. RouterOS globals are **RAM-only**: they
vanish on reboot and must be reloaded. The `.rsc` file may live on flash
for reference, but **do not `/import` it on 7.16** (RB953): import-defined
globals silently cannot call other globals (nested calls no-op, no error).
CLI-pasted definitions nest fine on all versions tested.

Load recipe (from a checkout, via centrs):

```bash
# 1. minify: strip #-lines/blank lines, join with spaces
python3 -c "
lines = [l.strip() for l in open('encode/enbeep-frame.rsc')]
one = ' '.join(l for l in lines if l and not l.startswith('#'))
open('/tmp/enbeep-min.rsc', 'w').write(one)
print(len(one), 'chars')
"
# 2. paste as one command (python keeps \$vars exact, no shell interpolation)
python3 -c "
import subprocess
cmd = open('/tmp/enbeep-min.rsc').read()
r = subprocess.run(['centrs', 'execute', '<handle>', cmd, '--yes',
                    '--timeout', '60s'], capture_output=True, text=True)
print('RC:', r.returncode, r.stdout[:200], r.stderr[:200])
"
# 3. verify: dry-run must print META + FRAME + sweep T: + data T: lines
centrs execute <handle> '$enbeepAnnounce "bridge" 3 200ms 200ms yes' --yes
```

Find `<handle>` / interface / address-row per box (`devices show`, `/ip address
print`); the row number in the verify command must be the lab address.

- bigdude (RB1100AHx4, 7.26): `"bridge" 3` (lab .254); fast piezo, 200 ms.
- pierce (RB953GS-5HnT, 7.16.2): `"bridge" 3` (lab .194); slow piezo in an
  RF Elements alu enclosure, paste-load only, prefers 400 ms + tone gap
  (`... 400ms 300ms no`).
