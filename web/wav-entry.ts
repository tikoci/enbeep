// wav-entry.ts — browser bundle entry for the WAV test harness.
// Built for GitHub Pages with:
//   bun build web/wav-entry.ts --target browser --outfile _site/wav-decode.js
// Exposes window.__enbeepDecode(arrayBuffer, symMs) -> FrameResult & meta.
// This is the same src/ codec the offline CLI uses — no third copy.
import { decodeRecording } from "../src/frame";
import { readWav } from "../src/wav";

interface HarnessWindow {
  __enbeepDecode?: (buf: ArrayBuffer, symMs: number) => unknown;
}

const w = globalThis as unknown as HarnessWindow;
w.__enbeepDecode = (buf: ArrayBuffer, symMs: number) => {
  const wav = readWav(new Uint8Array(buf));
  const res = decodeRecording(wav.samples, wav.sampleRate, symMs);
  return {
    ...res,
    syncs: res.syncs.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]),
    offsetHz: +res.offsetHz.toFixed(1),
    sampleRate: wav.sampleRate,
    channels: wav.channels,
    durationSec: +wav.durationSec.toFixed(2),
  };
};
