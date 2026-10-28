# Minimal v2 probe (sweep-only). For the full frame use enbeep.rsc.
# probe-short.rsc — minimal audibility/timing probe (bigdude-approved 2026-10-26).
# 2s @ 4000 Hz, 16 data freqs @ 200ms, 2s @ 4000 Hz. Total ~7.2s.
# One-liner form (SSH/console): the :global block below also runs inline as
# { :beep ...; :delay ...; :for ...; ... } — see twin1 validation note.
:global enbeepProbeShort do={
    :local baseFreq 2000;
    :local step 100;
    :local syncFreq 4000;
    :beep frequency=$syncFreq length=2s;
    :delay 2s;
    :for n from=0 to=15 do={
        :beep frequency=($baseFreq + ($n * $step)) length=200ms;
        :delay 200ms;
    }
    :beep frequency=$syncFreq length=2s;
    :delay 2s;
}
