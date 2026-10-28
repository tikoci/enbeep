// enbeep — entry stub. The real entry points are:
//   bun run serve.ts          live decoder page (http://localhost:3456)
//   bun src/decode.ts --file <wav> --sym <ms>   offline WAV decode (JSON)
//   bun test                  codec + air-capture regression tests
// See README.md and docs/SPEC.md.
console.log("enbeep: run `bun run serve` for the live decoder, or `bun src/decode.ts --file <wav> --sym 200` to decode a recording.");
