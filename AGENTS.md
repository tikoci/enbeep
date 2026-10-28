# Agent guide — enbeep

Start at [NEXT_STEPS.md](NEXT_STEPS.md). It is the only work tracker:
pick the top `ready` item, do it, update the file in the same change.

Follow [CONTRIBUTING.md](CONTRIBUTING.md) for branches, issues, PRs,
required CI checks, merging, and Pages deployment policy.

Canonical docs (do not duplicate their content elsewhere):

- [docs/SPEC.md](docs/SPEC.md) — v2 wire format. Spec wins over code.
- [docs/TESTING.md](docs/TESTING.md) — test levels + capture reports.
- [docs/DIAG.md](docs/DIAG.md) — failure model + report triage playbook.
- [encode/README.md](encode/README.md) — RouterOS loading recipes.
- [samples/README.md](samples/README.md) — capture corpus + codenames.

README.md describes the current user experience; it is not the product
spec. Intended experience changes live in NEXT_STEPS.md; docs/SPEC.md
remains authoritative for the wire format.

Toolchain: Bun, not Node/npm (`bun test`, `bun run`, `bunx`).
Verify before claiming done:

```bash
bun install && bun test && bunx tsc --noEmit && bun run lint
```

Project facts that bite: `:beep` is non-blocking on RouterOS 7; the live
decoder mirrors the offline codec including slot-0 repair
(`test/live.test.ts` drives the real state machine via
`window.__enbeep._test`); never present Self-test or `/tool fetch`
loading as hardware-verified.

Code reading order after the canonical docs: `encode/enbeep.rsc`
(sender), `src/frame.ts` (tone plan + offline codec), then `live.html`
(`processFrame` → `finishSweep` / `finishData`). The live page is a
self-contained receiver with its own Web Audio detector and state
machine; it does not import the offline codec. The WAV harness does,
through `web/wav-entry.ts`. For protocol work, check both
`test/frame.test.ts` and `test/live.test.ts`; `test/samples.test.ts`
locks the real-capture verdicts. `index.ts` is only a pointer to the
actual entry points, not the app implementation.

Use `mkdir -p .scratch` for local work worth keeping between sessions:
captures, analysis, trial scripts, and agent handoff notes. The whole
directory is gitignored; prefer a dated/descriptive subdirectory with a
short README explaining provenance, commands, results, and what remains.
Look there before repeating experiments. Use `/tmp` for disposable work,
and promote durable fixtures/docs into the tracked tree deliberately.
Scratch is local, not a backup or a second tracker: status still belongs
in NEXT_STEPS.md, and another clone or CI cannot rely on scratch files.
Typecheck and default test discovery exclude scratch; durable regression
tests belong in `test/` (`bunfig.toml` sets that discovery root).
