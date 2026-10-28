// convert-audio.ts — RETIRED batch tool (macOS afconvert .m4a→.wav for the
// legacy corpus). Lives in decode/ with the other retired experiments, not
// in src/ with the v2 codec. Run via `bun run convert`.
import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

const samplesDir = new URL("../samples", import.meta.url).pathname;

async function main() {
  const entries = await readdir(samplesDir, { withFileTypes: true });

  const m4aFiles = entries
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".m4a")
    .map((entry) => entry.name);

  if (m4aFiles.length === 0) {
    console.log("No .m4a files found in samples/");
    return;
  }

  for (const file of m4aFiles) {
    const inputPath = join(samplesDir, file);
    const outputPath = join(samplesDir, `${basename(file, ".m4a")}.wav`);

    console.log(`Converting ${file} → ${outputPath}`);

    const proc = Bun.spawn({
      cmd: ["afconvert", "-f", "WAVE", "-d", "LEI16@44100", inputPath, outputPath],
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      throw new Error(`afconvert failed for ${file} (exit code ${exitCode})`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
