"""Probe separator detection quality in a recording.

Usage: python3 decode/probe_separators.py samples/enbeepTest2.wav
"""
import sys
import numpy as np
from scipy.io import wavfile

SYNC_FREQ = 4000
WIN_S = 0.1  # 100ms analysis window


def probe(data, sr, center_s, label):
    win_len = int(sr * WIN_S)
    ci = int(center_s * sr)
    w = data[max(0, ci - win_len // 2) : ci + win_len // 2]
    if len(w) == 0:
        return
    fft = np.abs(np.fft.rfft(w))
    freqs = np.fft.rfftfreq(len(w), 1 / sr)
    total = np.sum(fft)
    avg = np.mean(fft)
    peak_hz = freqs[np.argmax(fft)]

    sync_tight = np.abs(freqs - SYNC_FREQ) < 50
    sync_wide = np.abs(freqs - SYNC_FREQ) < 100
    sync_pwr_tight = np.sum(fft[sync_tight])
    sync_pwr_wide = np.sum(fft[sync_wide])

    harm_bins = np.abs(freqs - SYNC_FREQ / 2) < 100  # 2000 Hz, potential 2nd harmonic source
    harm_pwr = np.sum(fft[harm_bins])

    print(
        f"{label:35s}  peak={peak_hz:5.0f}Hz  "
        f"sync_tight/avg={sync_pwr_tight/avg:5.1f}  "
        f"sync_wide/avg={sync_pwr_wide/avg:5.1f}  "
        f"sync_tight/total={sync_pwr_tight/total:.3f}  "
        f"2kHz/total={harm_pwr/total:.3f}"
    )


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "samples/enbeepTest2.wav"
    sr, raw = wavfile.read(path)
    if len(raw.shape) > 1:
        raw = raw[:, 0]
    data = raw.astype(float) / max(np.max(np.abs(raw)), 1)

    print(f"Loaded: {path}  ({len(data)/sr:.1f}s @ {sr} Hz)")
    print()
    print(f"{'Label':35s}  {'peak':>8}  {'s_t/avg':>9}  {'s_w/avg':>9}  {'s_t/tot':>9}  {'2k/tot':>8}")
    print("-" * 90)

    # Known separator midpoints from analyze output (recording 2):
    seps2 = [
        (0.00, 4.35, "sep[0] PREAMBLE"),
        (8.05, 9.15, "sep[1] *** false? ***"),
        (11.30, 12.30, "sep[2] *** false? ***"),
        (13.50, 16.25, "sep[3] real SEP?"),
        (16.35, 22.80, "sep[4] real SEP?"),
        (22.85, 24.80, "sep[5]"),
        (24.90, 28.50, "sep[6]"),
        (33.25, 34.45, "sep[7]"),
        (35.10, 37.60, "sep[8]"),
        (37.65, 44.63, "sep[9] END?"),
    ]

    for s, e, label in seps2:
        mid = (s + e) / 2
        probe(data, sr, mid, f"{label} mid={mid:.1f}s")

    print()
    print("-- S1 calibration section probes (4.35–8.05s) --")
    for t in [4.6, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 7.9]:
        probe(data, sr, t, f"S1 @ {t:.1f}s")


if __name__ == "__main__":
    main()
