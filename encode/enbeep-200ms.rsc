# SUPERSEDED hardcoded test — do not use for frames. Superseded by enbeep.rsc.
# (Kept as the v1-era calibration/payload capture script for samples/ regression history.)
# enbeep-200ms.rsc
# Focused calibration + payload test using ONLY 200ms symbols.
#
# Background:
#   RouterOS 7 :beep is NON-BLOCKING.  Sub-200ms :delay values appear to
#   round toward 0 on tested hardware (hAP ac lite).  Only 200ms symbols
#   are reliable: ~193ms effective duration (97% of nominal).
#
# Usage: paste the file into a terminal, then run $enbeep200ms.
# (Do not stage scripts on flash for /import; the load scheme is CLI
# globals, fetch+parse, or /system/script — see encode/README.md.)
#
# Record the output and analyze with:
#   bun run convert && bun run analyze -- samples/<file>.wav
#
# Expected structure (each section separated by 2s @ 4000 Hz):
#
#  [PREAMBLE]  2s @ 4000 Hz
#  [S1]  Calibration: 16 data freqs @ 200ms each, 3 reps (total 9.6s)
#         → measures actual piezo output freq per nibble; auto-detects +100 Hz offset
#  [SEP]  2s @ 4000 Hz
#  [S2]  Known payload "Hello" @ 200ms (MFSK-16 encoded)
#         → end-to-end decode validation
#  [END]  2s @ 4000 Hz
#
# Hardware findings (MikroTik hAP ac lite):
#   - Piezo produces ~+100 Hz higher than requested (2000 Hz req → ~2100 Hz actual)
#   - 3rd harmonics dominate globally; decoder restricts FFT to [1800, 3700] Hz band
#   - Minimum reliable symbol period: 200ms total (beep + delay)
#   - :beep is non-blocking; :delay below ~200ms rounds to near 0

:global enbeep200ms do={
    :local baseFreq 2000;
    :local step     100;
    :local syncFreq 4000;
    :local sym      200ms;

    # ---- PREAMBLE: 2s sync tone ----
    :beep frequency=$syncFreq length=2s;
    :delay 2s;

    # ---- S1: Calibration sweep ----
    # 16 data frequencies (2000-3500 Hz) held 200ms each, 3 repetitions.
    # The decoder uses this to measure the piezo's actual frequency per bin.
    :for rep from=0 to=2 do={
        :for n from=0 to=15 do={
            :beep frequency=($baseFreq + ($n * $step)) length=$sym;
            :delay $sym;
        }
    }

    # ---- SEP ----
    :beep frequency=$syncFreq length=2s;
    :delay 2s;

    # ---- S2: Known payload "Hello" @ 200ms ----
    # Hardcoded MFSK-16 encoding (avoids script lookup-table bugs).
    # "Hello" byte values: 72 101 108 108 111
    #   H = 0x48 → high nibble 4 (2400 Hz), low nibble  8 (2800 Hz)
    #   e = 0x65 → high nibble 6 (2600 Hz), low nibble  5 (2500 Hz)
    #   l = 0x6C → high nibble 6 (2600 Hz), low nibble 12 (3200 Hz)
    #   l = 0x6C → same
    #   o = 0x6F → high nibble 6 (2600 Hz), low nibble 15 (3500 Hz)
    :beep frequency=$syncFreq length=$sym;
    :delay $sym;
    :beep frequency=2400 length=$sym;
    :delay $sym;
    :beep frequency=2800 length=$sym;
    :delay $sym;
    :beep frequency=2600 length=$sym;
    :delay $sym;
    :beep frequency=2500 length=$sym;
    :delay $sym;
    :beep frequency=2600 length=$sym;
    :delay $sym;
    :beep frequency=3200 length=$sym;
    :delay $sym;
    :beep frequency=2600 length=$sym;
    :delay $sym;
    :beep frequency=3200 length=$sym;
    :delay $sym;
    :beep frequency=2600 length=$sym;
    :delay $sym;
    :beep frequency=3500 length=$sym;
    :delay $sym;
    :beep frequency=$syncFreq length=$sym;
    :delay $sym;

    # ---- END MARKER ----
    :beep frequency=$syncFreq length=2s;
    :delay 2s;
}
