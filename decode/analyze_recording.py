"""Analyzes a long test recording produced by encode/enbeep-test.rsc.

Usage:
    python3 decode/analyze_recording.py <path-to-wav>
    # or via bun:
    bun run analyze -- samples/test-recording.wav

Expected WAV structure (separated by 2s @ 4000 Hz sync tones):
    [PREAMBLE]  2s @ 4000 Hz
    [S1]  Calibration sweep: 16 freqs x 200ms x 3 reps
    [SEP] 2s @ 4000 Hz
    [S2]  Nibble sweep @ 50ms x 3 reps
    [SEP] 2s @ 4000 Hz
    [S3]  Nibble sweep @ 100ms x 3 reps
    [SEP] 2s @ 4000 Hz
    [S4]  Nibble sweep @ 150ms x 3 reps
    [SEP] 2s @ 4000 Hz
    [S5]  Known payload "Hello" @ 50ms (MFSK-encoded, hardcoded freqs)
    [END] 2s @ 4000 Hz
"""

import argparse
import importlib.machinery
import importlib.util
import os
import tempfile

import numpy as np
from scipy.io import wavfile

BASE_FREQ = 2000
STEP = 100
SYNC_FREQ = 4000
N_NIBBLES = 16
DATA_FREQS = [BASE_FREQ + i * STEP for i in range(N_NIBBLES)]

# Expected decoded message for Section 5
KNOWN_PAYLOAD = "Hello"


# ---------------------------------------------------------------------------
# Audio loading
# ---------------------------------------------------------------------------

def load_audio(path: str) -> tuple[int, np.ndarray]:
    sr, data = wavfile.read(path)
    if len(data.shape) > 1:
        data = data[:, 0]
    max_val = np.max(np.abs(data))
    if max_val == 0:
        raise ValueError("Audio file is silent")
    return sr, data.astype(float) / max_val


# ---------------------------------------------------------------------------
# Core spectral helpers (exported for unit tests)
# ---------------------------------------------------------------------------

def detect_peak_freq(
    window: np.ndarray,
    sample_rate: int,
    freq_min: float | None = None,
    freq_max: float | None = None,
) -> float:
    """Return the peak frequency in Hz of a time-domain window.

    If freq_min/freq_max are given, restrict the search to that band.
    This is essential for piezo hardware whose harmonics (3×–5×) dominate
    the global spectrum and would otherwise mislead argmax.
    """
    fft = np.abs(np.fft.rfft(window))
    freqs = np.fft.rfftfreq(len(window), 1 / sample_rate)
    if freq_min is not None or freq_max is not None:
        lo = freq_min if freq_min is not None else 0.0
        hi = freq_max if freq_max is not None else float(freqs[-1])
        mask = (freqs >= lo) & (freqs <= hi)
        if np.any(mask):
            idx = np.argmax(fft * mask)  # zero out out-of-band bins
            return float(freqs[idx])
    return float(freqs[np.argmax(fft)])


def is_sync_window(window: np.ndarray, sample_rate: int, tol: int = 100) -> bool:
    """Return True if 4000 Hz is strongly dominant in this window.

    Two conditions must both hold:
    1. Tight-band (±50 Hz) power is > 50× the mean bin power — ensures we have a
       strong narrowband tone at 4000 Hz, not just elevated broadband noise.
    2. Tight-band power represents > 15% of total spectral energy — rejects
       false positives from harmonics (e.g. 2nd harmonic of 2000 Hz data tones
       lands at exactly 4000 Hz but carries only ~1-3% of total energy), room
       echo at 4000 Hz, and data tones whose side-lobes touch the 4000 Hz bin.

    Measured values from real MikroTik recordings:
      True 4000 Hz sync:              tight/total ≈ 0.35–0.41
      2nd harmonic / noise:           tight/total < 0.02
      3500 Hz data-tone bleed-in:     tight/total ≈ 0.07
    """
    fft = np.abs(np.fft.rfft(window))
    freqs = np.fft.rfftfreq(len(window), 1 / sample_rate)

    sync_tight = np.abs(freqs - SYNC_FREQ) < 50   # narrow ±50 Hz
    if not np.any(sync_tight):
        return False

    total_power = np.sum(fft)
    if total_power == 0:
        return False

    sync_power = np.sum(fft[sync_tight])
    avg_power = np.mean(fft)

    # Condition 1: strong narrowband peak
    ratio_to_avg = sync_power / avg_power if avg_power > 0 else 0
    # Condition 2: dominates total energy (rejects harmonics and noise)
    ratio_to_total = sync_power / total_power

    return bool(ratio_to_avg > 50 and ratio_to_total > 0.15)


def find_separators(
    data: np.ndarray,
    sample_rate: int,
    min_dur_s: float = 1.0,
    hop_ms: int = 50,
) -> list[tuple[int, int]]:
    """Find time ranges (in samples) where 4000 Hz sync tone lasts >= min_dur_s.

    Uses a 100ms analysis window at hop_ms steps.
    Returns list of (start_sample, end_sample) for each separator.
    """
    win_len = int(sample_rate * 0.1)   # 100ms analysis window
    hop = int(sample_rate * (hop_ms / 1000))
    min_hops = int((min_dur_s * 1000) / hop_ms)

    sync_flags: list[bool] = []
    for i in range(0, len(data) - win_len, hop):
        window = data[i : i + win_len]
        sync_flags.append(is_sync_window(window, sample_rate))

    separators: list[tuple[int, int]] = []
    in_sep = False
    run_start = 0

    for idx, flag in enumerate(sync_flags):
        if flag and not in_sep:
            in_sep = True
            run_start = idx
        elif not flag and in_sep:
            in_sep = False
            if idx - run_start >= min_hops:
                separators.append((run_start * hop, idx * hop))

    if in_sep:
        if len(sync_flags) - run_start >= min_hops:
            separators.append((run_start * hop, len(data)))

    return separators


def detect_tone_sequence(
    segment: np.ndarray,
    sample_rate: int,
    tone_len_ms: int,
    freq_min: float | None = None,
    freq_max: float | None = None,
    estimated_count: int | None = None,
) -> list[float]:
    """Slice `segment` into windows and return the peak Hz of each.

    If estimated_count is given the window size is computed from segment
    length so that exactly estimated_count windows fit — useful when the
    effective symbol duration differs from the nominal tone_len_ms (e.g.
    RouterOS 7 `:delay` rounding).
    """
    if estimated_count is not None and estimated_count > 0:
        tone_len = len(segment) // estimated_count
    else:
        tone_len = int(sample_rate * (tone_len_ms / 1000))
    if tone_len == 0:
        return []
    detected: list[float] = []
    pos = 0
    while pos + tone_len <= len(segment):
        window = segment[pos : pos + tone_len]
        detected.append(detect_peak_freq(window, sample_rate, freq_min, freq_max))
        pos += tone_len
    return detected


def nearest_nibble(freq: float, tol: int = 150) -> int | None:
    """Map Hz → nibble index (0–15), or None if outside tolerance.

    Default tolerance is 150 Hz (1.5 steps) to accommodate the ~+100 Hz
    systematic hardware frequency offset observed on MikroTik piezo buzzers.
    """
    dists = [abs(freq - f) for f in DATA_FREQS]
    idx = int(np.argmin(dists))
    return idx if dists[idx] < tol else None


def compute_freq_offset(detected_hz: list[float], expected_nibbles: list[int]) -> float:
    """Estimate the systematic hardware frequency offset from paired measurements.

    Returns the median of (detected − expected) across all pairs, in Hz.
    A positive value means the hardware produces tones higher than requested.
    """
    offsets = [
        det - (BASE_FREQ + exp * STEP)
        for det, exp in zip(detected_hz, expected_nibbles)
    ]
    return float(np.median(offsets)) if offsets else 0.0


# ---------------------------------------------------------------------------
# Section analysers
# ---------------------------------------------------------------------------

def analyze_calibration(
    segment: np.ndarray,
    sample_rate: int,
) -> tuple[float, float]:
    """Section 1: 16 freqs × 200ms × 3 reps.

    Returns (accuracy_pct, freq_offset_hz).
    freq_offset_hz is the median hardware frequency offset (detected − expected)
    computed from this calibration run.  Pass it to analyze_nibble_sweep so the
    sweep sections are corrected for the same hardware drift.
    """
    print("\n=== S1: Calibration Sweep (200ms × 3 reps) ===")
    # Restrict FFT to data band to avoid harmonic misdetection.
    # Use estimated_count=48 so the window size adapts to actual timing
    # (RouterOS 7 timer rounding may compress symbol durations).
    tones = detect_tone_sequence(
        segment, sample_rate, 200,
        freq_min=BASE_FREQ - 200, freq_max=BASE_FREQ + N_NIBBLES * STEP + 200,
        estimated_count=48,
    )
    expected = list(range(N_NIBBLES)) * 3
    print(f"  Detected {len(tones)} tones (expected {len(expected)})")

    freq_offset = compute_freq_offset(list(tones[: len(expected)]), expected[: len(tones)])
    print(f"  Estimated hardware freq offset: {freq_offset:+.0f} Hz")

    correct = 0
    for i, (exp_n, det_hz) in enumerate(zip(expected, tones)):
        exp_hz = BASE_FREQ + exp_n * STEP
        corrected_hz = det_hz - freq_offset
        det_n = nearest_nibble(corrected_hz)
        if det_n == exp_n:
            correct += 1
        else:
            raw_drift = det_hz - exp_hz
            print(
                f"  [{i:2d}] nibble {exp_n:2d}: expected {exp_hz} Hz, "
                f"in-band {det_hz:.0f} Hz (drift {raw_drift:+.0f} Hz) → "
                f"corrected {corrected_hz:.0f} Hz → nibble {det_n}"
            )

    pct = 100.0 * correct / max(len(expected), 1)
    print(f"  Accuracy (after offset correction): {correct}/{len(expected)} = {pct:.1f}%")
    return pct, freq_offset


def _find_sync_positions(
    segment: np.ndarray,
    sample_rate: int,
    win_len: int,
    hop: int,
) -> list[tuple[int, int]]:
    """Return (start, end) sample ranges of 4000 Hz sync tone bursts.

    Scans with a sliding window of win_len at hop intervals.
    Returns a list of (cluster_start, cluster_end) tuples, where
    cluster_start is the first sample of the first detected window and
    cluster_end is the last sample + win_len of the last detected window.
    Adjacent hits within one win_len become one cluster.
    """
    freqs = np.fft.rfftfreq(win_len, 1 / sample_rate)
    sync_tight = np.abs(freqs - SYNC_FREQ) < 50
    hot: list[int] = []
    for pos in range(0, len(segment) - win_len, hop):
        w = segment[pos : pos + win_len]
        fft = np.abs(np.fft.rfft(w))
        total = np.sum(fft)
        avg = np.mean(fft)
        if total == 0 or avg == 0:
            continue
        sp = np.sum(fft[sync_tight])
        if sp / avg > 50 and sp / total > 0.15:
            hot.append(pos)

    clusters: list[tuple[int, int]] = []
    if not hot:
        return clusters
    cstart = hot[0]
    cprev = hot[0]
    for pos in hot[1:]:
        if pos - cprev > win_len:
            clusters.append((cstart, cprev + win_len))
            cstart = pos
        cprev = pos
    clusters.append((cstart, cprev + win_len))
    return clusters


def analyze_nibble_sweep(
    segment: np.ndarray,
    sample_rate: int,
    tone_len_ms: int,
    label: str,
    freq_offset: float = 0.0,
) -> float:
    """Sections 2–4: [mini-SOF + nibbles 0–15] × 3 reps.

    freq_offset (Hz): systematic hardware offset learned from S1 calibration.
    Detected frequencies are shifted by -freq_offset before nibble matching.

    Alignment strategy:
    1. Try to find the 3 SOF positions within the segment by searching for
       short 4000 Hz bursts.  If found, each rep is decoded between consecutive
       SOF markers.
    2. If SOF search fails (e.g. SOF collapsed due to RouterOS timing), fall
       back to adaptive window slicing with estimated_count=51.

    Returns data-tone detection accuracy %.
    """
    print(f"\n=== {label} (tone {tone_len_ms}ms × 3 reps) ===")

    # Adaptive window size: fit 51 tones into the whole segment
    n_expected = 3 * (1 + N_NIBBLES)
    tone_len = max(1, len(segment) // n_expected)
    effective_ms = tone_len * 1000 // sample_rate
    print(f"  Segment {len(segment)/sample_rate:.2f}s  →  effective window ~{effective_ms}ms")

    # --- Step 1: try to find SOF positions via 4000 Hz search ---
    # Use half-tone-len hop to get sub-symbol resolution
    hop = max(1, tone_len // 2)
    clusters = _find_sync_positions(segment, sample_rate, tone_len, hop)

    # Each cluster is (start_sample, end_sample) of a detected SOF burst.
    # The true SOF onset is the cluster start; the data symbols begin right
    # after the cluster end (i.e. after one full SOF symbol).  We use the
    # cluster duration to refine tone_len if the cluster spans multiple hops.
    print(f"  SOF positions found: {len(clusters)} (want 3)")

    if len(clusters) >= 2:
        # --- Aligned mode: decode each detectable rep from its SOF ---
        clusters = clusters[:3]

        # The last detected window in each cluster ends approximately one hop
        # past the true SOF end, because a window that partially overlaps the
        # SOF can still pass the sync threshold.  Therefore:
        #   data_start ≈ cluster_end - hop
        # where hop = tone_len // 2.  This formula is exact when the final
        # detection window covers exactly half SOF / half first-data-tone.
        data_starts = [max(0, cend - hop) for _cstart, cend in clusters]

        # Refine per-symbol duration from the gap between consecutive data starts.
        # One full rep = 1 SOF + N_NIBBLES data tones.
        if len(data_starts) >= 2:
            rep_samples = data_starts[1] - data_starts[0]
            rep_tone_len = max(1, rep_samples // (1 + N_NIBBLES))
        else:
            rep_tone_len = tone_len

        sync_ok = len(clusters)
        data_ok = 0
        data_total = 0
        for rep_idx, data_start in enumerate(data_starts):
            for n in range(N_NIBBLES):
                pos = data_start + n * rep_tone_len
                if pos + rep_tone_len > len(segment):
                    break
                w = segment[pos : pos + rep_tone_len]
                det_hz = detect_peak_freq(w, sample_rate, BASE_FREQ - 200, BASE_FREQ + N_NIBBLES * STEP + 200)
                corrected_hz = det_hz - freq_offset
                det_n = nearest_nibble(corrected_hz)
                data_total += 1
                if det_n == n:
                    data_ok += 1
                else:
                    exp_hz = BASE_FREQ + n * STEP
                    print(
                        f"  [rep{rep_idx} n{n:2d}] expected {exp_hz} Hz, "
                        f"in-band {det_hz:.0f} Hz → corrected {corrected_hz:.0f} Hz → nibble {det_n}"
                    )
    else:
        # --- Fallback: adaptive window slice (no SOF alignment) ---
        print("  No reliable SOF markers found; using adaptive window (SOF ignored)")
        tones = detect_tone_sequence(
            segment, sample_rate, tone_len_ms,
            freq_min=BASE_FREQ - 200, freq_max=SYNC_FREQ + 200,
            estimated_count=n_expected,
        )
        sync_ok = 0
        data_ok = 0
        data_total = 0
        expected_flat: list[int | str] = []
        for _ in range(3):
            expected_flat.append("SYNC")
            expected_flat.extend(range(N_NIBBLES))
        for i, (exp, det_hz) in enumerate(zip(expected_flat, tones)):
            corrected_hz = det_hz - freq_offset
            if exp == "SYNC":
                if abs(det_hz - SYNC_FREQ) < 200:
                    sync_ok += 1
            else:
                data_total += 1
                det_n = nearest_nibble(corrected_hz)
                if det_n == exp:
                    data_ok += 1
                else:
                    exp_hz = BASE_FREQ + int(exp) * STEP
                    print(
                        f"  [{i:2d}] nibble {exp}: expected {exp_hz} Hz, "
                        f"in-band {det_hz:.0f} Hz → corrected {corrected_hz:.0f} Hz → nibble {det_n}"
                    )

    pct = 100.0 * data_ok / max(data_total, 1)
    print(f"  SOF accuracy:  {sync_ok}/3")
    print(f"  Data accuracy: {data_ok}/{data_total} = {pct:.1f}%")
    return pct


def analyze_known_payload(
    segment: np.ndarray,
    sample_rate: int,
    tone_len_ms: int = 50,
    freq_offset: float = 0.0,
) -> bool:
    """Decode the known 'Hello' payload segment.  Returns True if decoded correctly."""
    print(f"\n=== S5: Known Payload 'Hello' @ {tone_len_ms}ms ===")

    # In the enbeep-200ms.rsc format, the separator between the calibration
    # sweep and the Hello payload is the same 4000 Hz frequency as the SOF.
    # RouterOS plays them back-to-back with no gap, so find_separators absorbs
    # the SOF into the separator.  The segment therefore starts directly with
    # the first data nibble — no SOF present.
    # Detect whether the segment begins with a SOF or raw data tones.
    first_win = int(sample_rate * tone_len_ms / 1000)
    sof_freq = detect_peak_freq(segment[:first_win], sample_rate)
    has_sof = abs(sof_freq - SYNC_FREQ) < 200

    n_nibbles = len(KNOWN_PAYLOAD) * 2   # 2 nibbles per character

    if has_sof:
        # Standard path: SOF present → delegate to debeep.gemi1.py
        decoder_path = os.path.join(os.path.dirname(__file__), "debeep.gemi1.py")
        loader = importlib.machinery.SourceFileLoader("debeep_gemi1", decoder_path)
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec)  # type: ignore
        loader.exec_module(module)  # type: ignore

        with tempfile.TemporaryDirectory() as tmp:
            tmppath = os.path.join(tmp, "seg.wav")
            wavfile.write(tmppath, sample_rate, (segment * 32767).astype(np.int16))
            result = module.decode_audio(tmppath, tone_len_ms=tone_len_ms)
    else:
        # No-SOF path: segment is raw data tones; decode directly.
        # This happens with enbeep-200ms.rsc because the HelloPayload SOF
        # (4000 Hz @ 200ms) immediately follows the 2s separator (also 4000 Hz)
        # and the two are indistinguishable — the separator absorbs the SOF.
        print("  (No SOF detected at segment start — decoding data tones directly)")
        # Determine the actual payload length by detecting where the END MARKER
        # (4000 Hz) begins at the tail of the segment.  The RouterOS script
        # appends a 2s sync tone immediately after the last data nibble; this
        # runs right into the section separator but a small fraction of it (up
        # to one separator-detector hop ≈ 50ms) bleeds into the segment.
        # Using that boundary gives a more accurate per-slot step size than
        # dividing the total segment length by n_nibbles.
        n_nibbles = len(KNOWN_PAYLOAD) * 2
        wl_sync = int(sample_rate * 0.1)      # 100ms sync detection window
        hop_sync = max(1, wl_sync // 2)       # 50ms hop
        sync_clusters = _find_sync_positions(segment, sample_rate, wl_sync, hop_sync)
        if sync_clusters:
            # Payload ends at the first sync cluster that starts in the last
            # third of the segment (it's the END MARKER, not a data-tone glitch).
            mid = len(segment) // 3
            end_clusters = [c for c in sync_clusters if c[0] >= mid]
            payload_end = end_clusters[0][0] if end_clusters else len(segment)
        else:
            # Tight-band detection missed the END MARKER (can happen with lossy
            # audio compression reducing 4000 Hz amplitude).  Fall back to a
            # loose backward scan: start from the tail and find the first 100ms
            # window where the 4000 Hz narrow band has sp/avg > 5.
            payload_end = len(segment)
            for pos in range(len(segment) - wl_sync, len(segment) // 2, -hop_sync):
                w = segment[pos : pos + wl_sync]
                fft = np.abs(np.fft.rfft(w))
                freqs = np.fft.rfftfreq(wl_sync, 1 / sample_rate)
                sync_tight = np.abs(freqs - SYNC_FREQ) < 50
                sp = float(np.sum(fft[sync_tight]))
                av = float(np.mean(fft))
                if av > 0 and sp / av > 5:
                    # pos is the start of the END MARKER window; add half a hop
                    # to centre the estimate on the marker onset.
                    payload_end = pos + hop_sync
                    break

        step = max(1, payload_end // n_nibbles)   # samples per tone slot
        win = max(1, step * 3 // 4)               # 75% analysis window

        tones: list[float] = []
        for i in range(n_nibbles):
            center = i * step + step // 2
            start = max(0, center - win // 2)
            end = min(len(segment), start + win)
            w = segment[start:end]
            tones.append(detect_peak_freq(
                w, sample_rate,
                BASE_FREQ - 200, BASE_FREQ + N_NIBBLES * STEP + 200,
            ))
        chars: list[str] = []
        for i in range(0, len(tones) - 1, 2):
            n_hi = nearest_nibble(tones[i] - freq_offset)
            n_lo = nearest_nibble(tones[i + 1] - freq_offset)
            if n_hi is not None and n_lo is not None:
                chars.append(chr(n_hi * 16 + n_lo))
        result = "".join(chars)

    ok = result == KNOWN_PAYLOAD
    print(f"  Expected: {KNOWN_PAYLOAD!r}")
    print(f"  Decoded:  {result!r}")
    print(f"  Result:   {'PASS ✓' if ok else 'FAIL ✗'}")
    return ok


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Analyze an enbeep-test.rsc recording to score MFSK-16 detection"
    )
    parser.add_argument("wav", help="Path to the recorded WAV file (16-bit PCM)")
    args = parser.parse_args(argv)

    sample_rate, data = load_audio(args.wav)
    duration = len(data) / sample_rate
    print(f"Loaded: {args.wav}  ({duration:.1f}s @ {sample_rate} Hz)")

    seps = find_separators(data, sample_rate, min_dur_s=1.0)
    print(f"\nFound {len(seps)} section separators (each should be ~2s @ 4000 Hz):")
    for i, (s, e) in enumerate(seps):
        print(f"  [{i}]  {s / sample_rate:.2f}s – {e / sample_rate:.2f}s")

    if len(seps) < 2:
        print("\nERROR: Need at least 2 separators to find sections. Check recording.")
        return 1

    # Segments are audio between consecutive separators
    segments = [
        data[seps[i][1] : seps[i + 1][0]]
        for i in range(len(seps) - 1)
    ]

    print(f"\nFound {len(segments)} segments:")
    for i, seg in enumerate(segments):
        print(f"  [S{i+1}]  {len(seg)/sample_rate:.2f}s")

    results: dict[str, float] = {}
    freq_offset = 0.0

    if len(segments) >= 1:
        results["calibration (200ms)"], freq_offset = analyze_calibration(
            segments[0], sample_rate
        )

    if len(segments) == 2:
        # enbeep-200ms.rsc format: calibration + Hello payload only (no sweeps)
        analyze_known_payload(segments[1], sample_rate, tone_len_ms=200, freq_offset=freq_offset)
    else:
        if len(segments) >= 2:
            results["sweep 50ms"] = analyze_nibble_sweep(
                segments[1], sample_rate, 50, "S2: Nibble Sweep", freq_offset
            )

        if len(segments) >= 3:
            results["sweep 100ms"] = analyze_nibble_sweep(
                segments[2], sample_rate, 100, "S3: Nibble Sweep", freq_offset
            )

        if len(segments) >= 4:
            results["sweep 150ms"] = analyze_nibble_sweep(
                segments[3], sample_rate, 150, "S4: Nibble Sweep", freq_offset
            )

        if len(segments) >= 5:
            analyze_known_payload(segments[4], sample_rate)

    # Summary
    print("\n=== Summary ===")
    for label, pct in results.items():
        bar = "█" * int(pct / 5)
        print(f"  {label:25s}  {pct:5.1f}%  {bar}")

    sweep_results = {k: v for k, v in results.items() if k.startswith("sweep")}
    if sweep_results:
        best = max(sweep_results, key=sweep_results.get)
        print(f"\n  Best timing: {best} → {sweep_results[best]:.1f}% data accuracy")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
