// decode-samples.ts — RETIRED batch tool (runs decode/debeep.*.py over every
// samples/*.wav). Lives in decode/ with the retired experiments, not in src/
// with the v2 codec. Run via `bun run decode`.
import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const samplesDir = new URL("../samples", import.meta.url).pathname;
const decodeDir = new URL(".", import.meta.url).pathname;

async function main() {
  const sampleEntries = await readdir(samplesDir, { withFileTypes: true });
  const wavFiles = sampleEntries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".wav")
    .map((entry) => entry.name);

  if (wavFiles.length === 0) {
    console.log("No .wav files found in samples/");
    return;
  }

  const decodeEntries = await readdir(decodeDir, { withFileTypes: true });
  const decoderScripts = decodeEntries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith("debeep.") &&
        entry.name.endsWith(".py")
    )
    .map((entry) => entry.name);

  if (decoderScripts.length === 0) {
    console.log("No debeep.*.py decoder scripts found in decode/");
    return;
  }

  const pythonBinary = "python3";

  for (const script of decoderScripts) {
    const decoderId = script.slice("debeep.".length, -".py".length);
    const scriptPath = join(decodeDir, script);

    for (const wav of wavFiles) {
      const inputPath = join(samplesDir, wav);
      const outputPath = join(samplesDir, `${basename(wav, ".wav")}.${decoderId}.txt`);

      console.log(`Decoding ${wav} → ${outputPath} (using ${script})`);

      const proc = Bun.spawn({
        cmd: [pythonBinary, scriptPath, inputPath, outputPath],
        stdout: "inherit",
        stderr: "inherit",
      });

      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new Error(`Python decoder failed: ${script} (exit code ${exitCode})`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
