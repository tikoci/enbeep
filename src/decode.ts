// decode.ts — offline frame decoder CLI: bun src/decode.ts --file x.wav --sym 200
import { decodeRecording } from "./frame";
import { readWav } from "./wav";

const args = process.argv.slice(2);
const get = (k: string, dflt: string): string => {
  const i = args.indexOf(k);
  return i >= 0 && i + 1 < args.length ? (args[i + 1] ?? dflt) : dflt;
};

const file = get("--file", "");
const sym = Number(get("--sym", "200"));
if (!file || !Number.isFinite(sym) || sym <= 0) {
  console.error("usage: bun src/decode.ts --file <wav> --sym <ms>");
  process.exit(2);
}

const wav = readWav(new Uint8Array(await Bun.file(file).arrayBuffer()));
const t0 = Date.now();
const res = decodeRecording(wav.samples, wav.sampleRate, sym);
console.log(JSON.stringify({
  file,
  symMs: sym,
  sampleRate: wav.sampleRate,
  durationSec: +wav.durationSec.toFixed(2),
  decodeMs: Date.now() - t0,
  ...res,
  syncs: res.syncs.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)]),
  offsetHz: +res.offsetHz.toFixed(1),
}));
process.exit(res.ok ? 0 : 1);
