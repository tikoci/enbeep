# enbeep-test.rsc
# Systematic calibration + timing test sequence for MFSK-16.
#
# Record the entire output in one session (~40 seconds), then run:
#   python3 decode/analyze_recording.py <your-recording.wav>
#
# Test structure (each section separated by 2s @ 4000 Hz):
#
#  [PREAMBLE]  2s @ 4000 Hz (start marker)
#  [S1]  Calibration: all 16 data freqs at 200ms each, 3 reps
#         → tells you which frequencies the piezo actually produces
#  [SEP]  2s @ 4000 Hz
#  [S2]  Nibble sweep @ 50ms, 3 reps  (mini-SOF + nibbles 0-15)
#         → current baseline timing
#  [SEP]  2s @ 4000 Hz
#  [S3]  Nibble sweep @ 100ms, 3 reps
#         → double duration, should be more reliable
#  [SEP]  2s @ 4000 Hz
#  [S4]  Nibble sweep @ 150ms, 3 reps
#         → conservative, maximum reliability
#  [SEP]  2s @ 4000 Hz
#  [S5]  Known payload "Hello" @ 50ms (MFSK-16 encoded, hardcoded frequencies)
#         → real end-to-end decode validation
#  [END]  2s @ 4000 Hz (end marker)
#
# Total runtime: ~40s (not counting RouterOS loop overhead)
#
# RouterOS 7 timing findings (measured from real hardware recording):
#   - :beep is NON-BLOCKING in RouterOS 7 (changed from <7); :delay IS needed.
#   - :delay values below ~200ms appear to round toward 0 on this hardware.
#   - Only 200ms tones are reliable; 50ms/100ms/150ms give severely compressed timing.
#   - Minimum recommended symbol period: 200ms (beep + delay).
# Hardware frequency offset (MikroTik piezo observation):
#   - Piezo produces tones ~+100 Hz higher than the requested frequency.
#   - e.g. :beep frequency=2000 → ~2100 Hz actual output.
#   - The decoder compensates via band-restricted FFT + auto-calibration from S1.
# Harmonic distortion note:
#   - Piezo produces strong 3rd harmonics (e.g. 2100 Hz tone → strong peak at 6300+ Hz).
#   - Global FFT argmax hits the harmonic; decoder must restrict to [1800, 3700] Hz band.

:global enbeepTest do={
    :local baseFreq 2000;
    :local step     100;
    :local syncFreq 4000;

    # ---- PREAMBLE: 2s sync tone so recorder can find the start ----
    :beep frequency=$syncFreq length=2s;
    :delay 2s

    # ---- S1: Calibration sweep ----
    # All 16 data frequencies (2000-3500 Hz) each held 200ms, repeated 3 times.
    # Use this to measure the piezo's actual output frequency per bin.
    :for rep from=0 to=2 do={
        :for n from=0 to=15 do={
            :beep frequency=($baseFreq + ($n * $step)) length=200ms;
            :delay 200ms
        }
    }

    # ---- SEP ----
    :beep frequency=$syncFreq length=2s;
    :delay 2s

    # ---- S2: Nibble sweep @ 50ms ----
    # Each rep: 1 mini-SOF + all 16 nibble tones.
    :for rep from=0 to=2 do={
        :beep frequency=$syncFreq length=50ms;
                 :delay 50ms
        :for n from=0 to=15 do={
            :beep frequency=($baseFreq + ($n * $step)) length=50ms; 
            :delay 50ms
        }
    }

    # ---- SEP ----
    :beep frequency=$syncFreq length=2s;
    :delay 2s

    # ---- S3: Nibble sweep @ 100ms ----
    :for rep from=0 to=2 do={
        :beep frequency=$syncFreq length=100ms;
        :delay 100ms
        :for n from=0 to=15 do={
            :beep frequency=($baseFreq + ($n * $step)) length=100ms;
            :delay 100ms
        }
    }

    # ---- SEP ----
    :beep frequency=$syncFreq length=2s;
    :delay 2s

    # ---- S4: Nibble sweep @ 150ms ----
    :for rep from=0 to=2 do={
        :beep frequency=$syncFreq length=150ms;
        :delay 150ms
        :for n from=0 to=15 do={
            :beep frequency=($baseFreq + ($n * $step)) length=150ms;
            :delay 150ms
        }
    }

    # ---- SEP ----
    :beep frequency=$syncFreq length=2s;
    :delay 2s

    # ---- S5: Known payload "Hello" @ 50ms ----
    # Hardcoded MFSK-16 encoding (no lookup table — avoids script bugs).
    # "Hello" byte values: 72 101 108 108 111
    #   H = 0x48 -> high nibble 4 (2400 Hz), low nibble  8 (2800 Hz)
    #   e = 0x65 -> high nibble 6 (2600 Hz), low nibble  5 (2500 Hz)
    #   l = 0x6C -> high nibble 6 (2600 Hz), low nibble 12 (3200 Hz)
    #   l = 0x6C -> same
    #   o = 0x6F -> high nibble 6 (2600 Hz), low nibble 15 (3500 Hz)
    :beep frequency=$syncFreq length=50ms;
    :delay 50ms
    :beep frequency=2400 length=50ms;
    :delay 50ms
    :beep frequency=2800 length=50ms;
    :delay 50ms
    :beep frequency=2600 length=50ms;
    :delay 50ms
    :beep frequency=2500 length=50ms;
    :delay 50ms
    :beep frequency=2600 length=50ms;
    :delay 50ms
    :beep frequency=3200 length=50ms;
    :delay 50ms
    :beep frequency=2600 length=50ms;
    :delay 50ms
    :beep frequency=3200 length=50ms;
    :delay 50ms
    :beep frequency=2600 length=50ms;
    :delay 50ms
    :beep frequency=3500 length=50ms;
    :delay 50ms
    :beep frequency=$syncFreq length=50ms;
    :delay 50ms

    # ---- END MARKER ----
    :beep frequency=$syncFreq length=2s;
    :delay 2s
}
