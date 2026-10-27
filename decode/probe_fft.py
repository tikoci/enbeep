import warnings
import numpy as np
from scipy.io import wavfile

warnings.filterwarnings('ignore')
sr, raw = wavfile.read('samples/enbeepTest.wav')
if raw.ndim > 1:
    raw = raw[:, 0]
data = raw.astype(float) / max(np.max(np.abs(raw)), 1)

print(f'Duration: {len(data)/sr:.2f}s at {sr} Hz, shape={raw.shape}')

# Preamble ends ~4.55s; first calibration tone (2000 Hz, 200ms) starts there.
# Probe each nibble expected in the calibration (200ms windows, no gaps since delay≈0)
base_freq = 2000
step = 100
window_s = 0.19  # 200ms beep but delay≈0 so effective ~190ms per tone
start_s = 4.6    # right after preamble separator

print('\nCalibration frequency probe (first 8 nibbles, first rep):')
print(f'  {"nibble":>6}  {"target_hz":>10}  {"best_in_band":>14}  {"global_peak":>12}  {"ratio":>8}')

for n in range(8):
    t0 = start_s + n * window_s
    s = int(t0 * sr)
    e = int((t0 + window_s) * sr)
    win = data[s:e]
    fft = np.abs(np.fft.rfft(win))
    freqs = np.fft.rfftfreq(len(win), 1 / sr)

    target = base_freq + n * step

    # Global peak
    glob_hz = freqs[np.argmax(fft)]

    # Peak restricted to [1800, 3700] Hz data band
    mask = (freqs >= 1800) & (freqs <= 3700)
    band_hz = freqs[mask][np.argmax(fft[mask])] if np.any(mask) else -1.0

    # Power ratio: band power vs total
    band_power = np.sum(fft[mask] ** 2)
    total_power = np.sum(fft ** 2)
    ratio = band_power / total_power if total_power > 0 else 0

    print(f'  {n:>6}  {target:>10}  {band_hz:>14.0f}  {glob_hz:>12.0f}  {ratio:>8.3f}')
