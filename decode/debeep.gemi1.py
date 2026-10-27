import argparse
import sys

import numpy as np
from scipy.io import wavfile

# --- Configuration (Matches RouterOS Script) ---
BASE_FREQ = 2000
STEP = 100
TONE_LEN_MS = 50
SYNC_FREQ = 4000
FS_TOLERANCE = 150   # Hz tolerance for frequency matching (wider to handle ~+100 Hz hardware drift)
# Data-band FFT restriction: avoid picking harmonic peaks from piezo buzzer
DATA_FREQ_MIN = BASE_FREQ - 200          # 1800 Hz
DATA_FREQ_MAX = BASE_FREQ + 16 * STEP + 200  # 3800 Hz

def decode_audio(filename, tone_len_ms: int = TONE_LEN_MS):
    sample_rate, data = wavfile.read(filename)
    
    # Convert to mono if stereo
    if len(data.shape) > 1:
        data = data[:, 0]
    
    # Normalize audio
    data = data.astype(float) / np.max(np.abs(data))
    
    # Calculate samples per tone
    samples_per_tone = int(sample_rate * (tone_len_ms / 1000))
    
    # 1. Find the Sync Tone (4000 Hz)
    # We look for the first window where 4000Hz is dominant.
    # This is a bit rigid on real recordings; we allow the sync tone to be
    # detected by checking the energy around the expected frequency.
    start_idx = 0

    for i in range(0, len(data) - samples_per_tone, samples_per_tone // 2):
        window = data[i : i + samples_per_tone]
        fft_data = np.abs(np.fft.rfft(window))
        freqs = np.fft.rfftfreq(len(window), 1 / sample_rate)

        # Use a small band around the sync frequency to account for drift
        sync_bins = np.abs(freqs - SYNC_FREQ) < FS_TOLERANCE
        if not np.any(sync_bins):
            continue

        sync_power = np.sum(fft_data[sync_bins])
        avg_power = np.mean(fft_data)

        # If the sync tone power is significantly higher than the average, take it.
        if avg_power > 0 and sync_power / avg_power > 5:
            start_idx = i + samples_per_tone
            break
    
    if start_idx == 0:
        return "Sync tone not found."

    # 2. Extract Nibbles
    nibbles = []
    # We jump by TONE_LEN_MS to hit the center of the next tones
    current_pos = start_idx
    while current_pos + samples_per_tone < len(data):
        window = data[current_pos : current_pos + samples_per_tone]
        fft_data = np.abs(np.fft.rfft(window))
        freqs = np.fft.rfftfreq(len(window), 1/sample_rate)
        
        peak_freq = freqs[np.argmax(fft_data)]
        
        # Check if we hit the end-of-frame sync tone or silence.
        # Use global peak here – sync is at 4000 Hz, well above data band.
        if abs(peak_freq - SYNC_FREQ) < FS_TOLERANCE:
            break

        # Restrict FFT to data band to avoid harmonic misdetection.
        # Piezo buzzers produce strong 3rd/5th harmonics; global argmax
        # would land on the harmonic rather than the fundamental.
        mask = (freqs >= DATA_FREQ_MIN) & (freqs <= DATA_FREQ_MAX)
        if np.any(mask):
            band_peak_freq = freqs[np.argmax(fft_data * mask)]
        else:
            band_peak_freq = peak_freq

        # Map in-band frequency to nearest nibble (0-15)
        data_freqs = [BASE_FREQ + i * STEP for i in range(16)]
        dists = [abs(band_peak_freq - f) for f in data_freqs]
        best = int(np.argmin(dists))
        nibble = best if dists[best] < FS_TOLERANCE else None
        if nibble is not None:
            nibbles.append(nibble)
        
        current_pos += samples_per_tone

    # 3. Reconstruct Bytes
    output = ""
    for i in range(0, len(nibbles) - 1, 2):
        high = nibbles[i]
        low = nibbles[i+1]
        char_code = (high * 16) + low
        output += chr(char_code)
        
    return output


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Decode a WAV file to text using debeep protocol")
    parser.add_argument("input", help="Input WAV file")
    parser.add_argument("output", help="Output text file")
    args = parser.parse_args(argv)

    decoded = decode_audio(args.input)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(decoded)

    print(f"Decoded {args.input} → {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())