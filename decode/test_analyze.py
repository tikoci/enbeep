"""Unit tests for decode/analyze_recording.py helper functions.

All tests use synthetic audio — no real recording required.
"""

import os
import sys
import unittest

import numpy as np
from scipy.io import wavfile

# Allow running from repo root or from decode/ directory
sys.path.insert(0, os.path.dirname(__file__))

from analyze_recording import (
    BASE_FREQ,
    DATA_FREQS,
    N_NIBBLES,
    SYNC_FREQ,
    STEP,
    detect_peak_freq,
    detect_tone_sequence,
    find_separators,
    is_sync_window,
    load_audio,
    nearest_nibble,
    analyze_nibble_sweep,
    analyze_calibration,
)

SR = 44100


def make_tone(freq: float, duration_s: float, amp: float = 0.5) -> np.ndarray:
    t = np.arange(int(SR * duration_s)) / SR
    return amp * np.sin(2 * np.pi * freq * t)


def make_silence(duration_s: float) -> np.ndarray:
    return np.zeros(int(SR * duration_s))


class TestSpectrumHelpers(unittest.TestCase):
    def test_detect_peak_freq_pure_tone(self):
        for nibble in range(N_NIBBLES):
            freq = BASE_FREQ + nibble * STEP
            window = make_tone(freq, 0.05)
            got = detect_peak_freq(window, SR)
            self.assertAlmostEqual(got, freq, delta=10, msg=f"nibble {nibble}")

    def test_detect_peak_freq_sync(self):
        window = make_tone(SYNC_FREQ, 0.05)
        got = detect_peak_freq(window, SR)
        self.assertAlmostEqual(got, SYNC_FREQ, delta=10)

    def test_is_sync_window_true(self):
        window = make_tone(SYNC_FREQ, 0.1)
        self.assertTrue(is_sync_window(window, SR))

    def test_is_sync_window_false_on_data_tone(self):
        window = make_tone(2500, 0.1)  # nibble 5
        self.assertFalse(is_sync_window(window, SR))

    def test_nearest_nibble_exact(self):
        for n, freq in enumerate(DATA_FREQS):
            self.assertEqual(nearest_nibble(freq), n)

    def test_nearest_nibble_out_of_range(self):
        self.assertIsNone(nearest_nibble(SYNC_FREQ))   # 4000 Hz, too far from any data freq
        self.assertIsNone(nearest_nibble(1000))         # below base


class TestFindSeparators(unittest.TestCase):
    def _build_recording(self):
        """Build a short synthetic test recording with 3 sections and 4 separators."""
        parts = [
            make_tone(SYNC_FREQ, 2.0),  # preamble
            make_tone(2000, 0.5),       # "section 1" stub
            make_tone(SYNC_FREQ, 2.0),  # sep
            make_tone(2100, 0.5),       # "section 2" stub
            make_tone(SYNC_FREQ, 2.0),  # end marker
        ]
        return np.concatenate(parts).astype(np.float32)

    def test_finds_three_separators(self):
        data = self._build_recording()
        seps = find_separators(data, SR, min_dur_s=1.0)
        self.assertEqual(len(seps), 3)

    def test_separator_boundaries_reasonable(self):
        data = self._build_recording()
        seps = find_separators(data, SR, min_dur_s=1.0)
        for s, e in seps:
            dur_s = (e - s) / SR
            self.assertGreaterEqual(dur_s, 1.0)  # all separators last at least 1s

    def test_short_sync_not_a_separator(self):
        """A 50ms SOF tone must NOT be detected as a separator (min_dur=1s)."""
        data = np.concatenate([
            make_tone(SYNC_FREQ, 0.05),  # short SOF — should be ignored
            make_tone(2000, 0.5),
            make_tone(SYNC_FREQ, 2.0),   # real separator
        ])
        seps = find_separators(data, SR, min_dur_s=1.0)
        self.assertEqual(len(seps), 1)


class TestDetectToneSequence(unittest.TestCase):
    def test_all_nibbles_50ms(self):
        """Generate all 16 nibble tones at 50ms and verify detection."""
        parts = [make_tone(BASE_FREQ + n * STEP, 0.05) for n in range(N_NIBBLES)]
        segment = np.concatenate(parts)
        tones = detect_tone_sequence(segment, SR, tone_len_ms=50)
        self.assertEqual(len(tones), N_NIBBLES)
        for n, freq in enumerate(tones):
            self.assertEqual(nearest_nibble(freq), n, msg=f"nibble {n}")

    def test_all_nibbles_100ms(self):
        parts = [make_tone(BASE_FREQ + n * STEP, 0.10) for n in range(N_NIBBLES)]
        segment = np.concatenate(parts)
        tones = detect_tone_sequence(segment, SR, tone_len_ms=100)
        self.assertEqual(len(tones), N_NIBBLES)
        for n, freq in enumerate(tones):
            self.assertEqual(nearest_nibble(freq), n, msg=f"nibble {n}")


class TestSectionAnalyzers(unittest.TestCase):
    def _make_sweep(self, tone_len_ms: int, reps: int = 3) -> np.ndarray:
        """Build the exact audio enbeep-test.rsc S2/S3/S4 would produce."""
        parts: list[np.ndarray] = []
        for _ in range(reps):
            parts.append(make_tone(SYNC_FREQ, tone_len_ms / 1000))
            for n in range(N_NIBBLES):
                parts.append(make_tone(BASE_FREQ + n * STEP, tone_len_ms / 1000))
        return np.concatenate(parts)

    def _make_calibration(self) -> np.ndarray:
        """All 16 data freqs at 200ms each, 3 reps."""
        parts: list[np.ndarray] = []
        for _ in range(3):
            for n in range(N_NIBBLES):
                parts.append(make_tone(BASE_FREQ + n * STEP, 0.2))
        return np.concatenate(parts)

    def test_calibration_100_percent(self):
        seg = self._make_calibration()
        pct, _offset = analyze_calibration(seg, SR)
        self.assertEqual(pct, 100.0)

    def test_nibble_sweep_50ms_100_percent(self):
        seg = self._make_sweep(50)
        pct = analyze_nibble_sweep(seg, SR, 50, "test 50ms")
        self.assertEqual(pct, 100.0)

    def test_nibble_sweep_100ms_100_percent(self):
        seg = self._make_sweep(100)
        pct = analyze_nibble_sweep(seg, SR, 100, "test 100ms")
        self.assertEqual(pct, 100.0)

    def test_nibble_sweep_150ms_100_percent(self):
        seg = self._make_sweep(150)
        pct = analyze_nibble_sweep(seg, SR, 150, "test 150ms")
        self.assertEqual(pct, 100.0)


if __name__ == "__main__":
    unittest.main()
