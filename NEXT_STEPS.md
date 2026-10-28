# Next steps — read this first

This is the **only** tracker for enbeep work. Issues/discussions may hold
conversation, but status lives here. If you finish, block, or re-scope an
item, update this file in the same change that does the work.

## Start-here protocol (any agent, any session)

1. Read this file, then [docs/SPEC.md](docs/SPEC.md) (wire format) and
   [docs/TESTING.md](docs/TESTING.md) (how to test/report).
2. Re-verify the baseline before changing anything:
   `bun install && bun test && bunx tsc --noEmit && bun run lint`
   (baseline at last update: 59 pass, tsc clean, lint clean).
3. Work the highest-priority `ready` item. One item per change.
4. When done, move the item to **Done** with date + evidence (test output,
   commit, capture file, or URL). Never delete an item silently; a dropped
   item moves to **Dropped** with the reason.
5. Keep this file short: ≤ ~10 open items. New ideas go in one line under
   **Inbox** until someone promotes them with acceptance criteria.

Status values: `ready` · `blocked` (say by what) · `needs-hardware`.

## State at last update (2026-10-28)

- Offline decoder: verified on RB1100AHx4 + RB953GS-5HnT captures.
- Live decoder: desktop verified; iPhone has only passed the in-page
  Self-test, never an over-air frame (see `frames.jsonl` analysis in
  docs/TESTING.md). Repo not yet published to GitHub; the pre-publish
  worktree is consolidated into local commits on `main`, unpushed (no
  remote configured). NS-20 still governs the public history decision.
- Try tab (NS-23 done): `live.html` opens on Try it — RouterOS load/play
  panel (`$enbeepText`) + editable speaker sender with byte validation;
  11-byte payloads show their text reading; the diagnostics report keeps
  the previous session across one reset. `src/` is v2 codec only; the
  retired batch tools moved to `decode/`. Speaker/mic device pairs still
  need trials (NS-22). `.scratch/` is the ignored local retention area
  (AGENTS.md).
- Public demo direction (owner clarification): Pages is a primary way
  people will try this. The accurate current README is not a product
  spec or the finished public presentation; NS-24 rewrites it once the
  validated deployment exists. Local review/handoff:
  `.scratch/2026-10-27-readiness/PUBLIC_DEMO_REVIEW.md` (not in clones).

## P0 — publish gate (top first; NS-1 last)

- [ ] **NS-20 Decide initial public Git history / LFS migration** · `ready`
  LFS attributes do not convert old commits: `git lfs migrate info
  --include-ref=refs/heads/main` finds ~81 MB WAV + 3.7 MB M4A as plain
  Git objects. Choose preservation + migration or a clean public history;
  do not rewrite existing history as routine cleanup. Done when: the
  publication history is chosen, its text/credentials reviewed, and a
  fresh LFS checkout runs the gates without relying on local files.
- [ ] **NS-21 Gate Pages deployment on validation** · `ready`
  Current CI and Pages workflows independently run on push to main, so
  a failed CI run can still deploy. Done when: Pages only deploys a
  validated revision, including browser/harness checks; demonstrate a
  failing revision cannot deploy. Keep this as a workflow change rather
  than claiming a local smoke test proves GitHub deployment works.
- [ ] **NS-1 Publish and prove the public surfaces** · `ready`
  Push to GitHub; enable Actions + Pages. Done when: CI is green on
  `main`, the Pages URL serves `/` (live decoder), `/harness.html`, and
  `/enbeep-frame.rsc` (fetch each, record the URL here).
  No Git remote is configured in this checkout yet. After publishing,
  feed verified demo/issue URLs into the public README pass (NS-24).
## P0 — demo truth (claims we must not make unverified)

- [ ] **NS-4 First over-air iPhone capture** · `needs-hardware`
  Pages live decoder on iPhone Safari ← real router frame. Done when:
  a WAV + decode JSON + report (docs/TESTING.md §4) is filed, pass or
  fail. A fail spawns a new item with the capture; it does not reopen NS-4.
- [ ] **NS-5 `/tool fetch` load experiment** · `needs-hardware`
  Test whether a fetched `.rsc` loaded via
  `[:parse [/file get enbeep-frame.rsc contents]]` behaves like a CLI
  paste (nested globals work) on CHR + one real 7.16 box. Done when:
  result is written into encode/README.md as verified or rejected.
  Until then, no doc may present fetch-loading as working.

## P1 — public demo experience

- [ ] **NS-24 Public README / Pages onboarding pass** · `blocked` by NS-1
  (including NS-21's validated deployment). Rewrite around the
  implemented visitor experience: open the verified HTTPS demo, choose
  router or two-device message mode, try it, and get useful help/report
  a failure. Include real URLs and evidence-backed screenshots/examples
  if helpful. Keep the current README accurate meanwhile; it does not
  constrain the intended product or replace docs/SPEC.md. Done when:
  each advertised action is available in the deployed code and the
  instructions match the page, with experimental limits still clear.

## P2 — refine the scheme (needs outside hardware)

- [ ] **NS-22 Two-device browser acoustic trial** · `needs-hardware`
  Test the browser sender → separate live mic on at least one real device
  pair; use the fixed Self-test as a baseline, then the editable Try-tab
  sender. Done when: report names both devices, OS/browsers, symbol
  length, volume and distance, with receiver report and WAV if possible,
  pass or fail. The sender's internal decode does not count.
- [ ] **NS-8 Slow-piezo generality** · `needs-hardware`
  Two more slow-piezo models captured per docs/TESTING.md. Done when:
  we decide, with captures cited, whether repair stays decoder-side
  (NS-6) or moves to an encoder-side SEP decay gap.
- [ ] **NS-9 Phone matrix** · `needs-hardware`
  Android Chrome + one more iPhone/iOS version, over air, 0.3 m and 1 m.
  Done when: results are rows in the docs/TESTING.md verified table.

## Inbox (unscoped — promote with acceptance criteria or drop)

- Beeper inventory (low, owner idea): which RouterOS models have a
  working `:beep` piezo — `:beep` always exists but is silent without
  hardware, and no MikroTik metadata is known to list it. Survey specs
  and reported models; no doc may claim coverage without evidence.
  Of interest to Rosetta too (device-capability knowledge); no issue
  filed yet per owner — keep it here until scoped.
- rig mac parity: recorder backend abstraction (arecord is Linux-only); keep mac/linux a dev pair.
- Sync-ghost veto (detector-side, needs N>2 first): 2000 Hz tones ghost 4 kHz sync windows at fundamental nulls; fail-closed twice so far.
- Encoder self-probing symbol length (seed: `encode/probe-short.rsc`).
- Roll-call multi-router demo (sequential announces, one mic).
- rig dual-mic simultaneous mode (`--listen`/no-trigger: two mics, one
  trigger, matched A/B).
- Mic position log: fixed hang points + geometry convention per the
  aes67-mic-path skill.

## Done

- 2026-10-28 — NS-23 Try tab + failure/reporting: `live.html` opens on
  "Try it" (RouterOS load/dry-run/play panel with copyable `$enbeepText`
  commands + editable speaker sender, 1..255 byte validation, air-time
  estimate, RouterOS preview sync); 11-byte payloads render MAC/IP plus
  their text reading in the result card and reports; the diagnostics
  report keeps the previous session across one reset; retired batch
  tools moved `src/` → `decode/` with lint/typecheck coverage kept;
  added the referenced `.github/ISSUE_TEMPLATE/capture-report.md`.
  Evidence: 59 bun pass (3 new live tests), tsc/lint clean, browser
  smoke A–E green incl. end-to-end "Hi" send. Working tree only.
- 2026-10-27 — Owner's public-demo direction saved in ignored
  `.scratch/2026-10-27-readiness/PUBLIC_DEMO_REVIEW.md`, linked from the
  scratch README and this tracker. NS-23 captures the required product
  work behind the public story; NS-24 returns to the README after the
  sender and validated Pages deployment exist. Current README retained
  as an accurate description of today's implementation. Documentation
  only; baseline gate rechecked: 56 pass, tsc/lint clean.
- 2026-10-27 — Publication-readiness review (user-requested scope before
  NS-1): README now describes the experimental limits, router setup,
  two-device browser demo, privacy/logging, and reporting. Aligned
  TESTING/DIAG/capture template and loading guide; fixed text helper
  argument order, local harness routes, and sweep-only verification
  label. Ignored `.scratch/` + agent retention guidance, test discovery
  rooted in `test/`, scratch excluded from tsc. Preserved four existing
  NS-15/18/19 `/tmp` captures locally in
  `.scratch/2026-10-27-readiness/captures/` with provenance notes.
  Evidence: required gate 56 pass + tsc/lint; browser smoke A-D pass
  (D uses real sample frame + probe in local harness); text helper
  `Hello` silent dry-run on CHR 7.26beta3 matched v2 tone frequencies,
  len=5 f1=250 f2=170 (temporary globals removed). No new acoustic
  verification or publication. Local Pages artifact build + doc links
  checked; legacy Python suite 18 pass in the existing `.venv`
  (`make test-py`; system Python lacks numpy). Limited recognizable-key
  scan found no matches in 49 historical text blobs; full publication
  history review remains NS-20. Larger findings tracked as NS-20/21/22.
  Working tree only.
- 2026-10-27 — NS-19 AES67 daemon persistence: driver in
  `/lib/modules/.../updates` + `modules-load.d`, service installed via
  pkexec-adapted `install.sh` (custom NIC, SAP `224.2.127.254`,
  self-hosted `avio.sdp`), systemd enabled + started; PTP locked, sink
  `receiving_rtp_packet` after restart. Anchor capture with the SM58
  hanging over pierce: floor -115.5 (EcoFlow hum gone), residual
  conducted 60/120/180 Hz, ratio2 0.149 vs the 0.15 gate (REJECT by
  0.001, environmental; the path previously fully decoded pierce2 OK).
  Setup playbook shipped as repo skill `.agents/skills/aes67-mic-path`
  (`valid:true`, zero diagnostics). Evidence:
  `/tmp/aes67-sm58-hang.wav`. Boot-survival noted for the next reboot.
  Working tree only.
- 2026-10-27 — NS-18 AES67 receive implementation: aes67-linux-daemon
  (Merging ALSA driver, GCC-built after build.sh's clang rule misfired;
  daemon PTP-slaved to the AI2) + sink with hardcoded SDP (the AI2
  sends no SAP) → card 2 RAVENNA; `rig:capture` gained `--channels` +
  non-`hw:` mic names for it. VALIDATED: RB953 400 ms frame via
  SM58→AI2→AES67 decoded OK (exact MAC/IP/Fletcher, sync ratio2 ≈
  0.18, zero repairs). Evidence: `/tmp/aes67-pierce2.wav`, gate green
  (55 pass). Daemon still foreground (see NS-19); AI2 line-level input
  with no preamp caps margin. Working tree only.
- 2026-10-27 — NS-17 AES67 spike: path is aes67-linux-daemon
  (Merging ALSA driver, own PTP slave, SAP discovery built in; GPL)
  → virtual ALSA capture → rig unchanged. Box ready (kernel 7.2.8 +
  headers + gcc; /dev/ptp0 present for HW-timestamped PTP).
  VERDICT: workable, BLOCKED — zero AES67/Dante presence on the lab
  LAN (no SAP in 15 s, no Dante mDNS ads, no ARP). No driver
  installed (nothing to validate against). Follow-up: NS-18.
  Working tree only.
- 2026-10-27 — NS-15 hardware rig in-repo: `rig/capture.ts` (arecord +
  centrs-trigger orchestration; CDB + mic preflights; `--yes` /
  `--timeout` regularized after the write-shaped block) +
  `rig/analyze.ts` (envelope + decode + sync scan + `--slots`
  drill-down, all DSP via `src/*`, no copies) + `rig/README.md`
  (setup, standard run, fast triage); package lint/format + biome
  includes now cover `rig/`; TESTING.md §2 is rig-first (stale
  `make serve:tls` / 40-tests fixed). Moved-spot validation ran
  THROUGH the rig, pure CDB, no env: bigdude syncs 0.38 (was 0.08)
  but a 3500 Hz null rejects the sweep [...,14,14]; pierce sweep
  0..15 clean incl. 2300, 25/28 data exact, Fletcher honestly
  rejects 3 faded-fundamental tones. Evidence: canonical gate green
  (54 pass, tsc, 17-file lint); `/tmp/rig-bigdude.wav` +
  `/tmp/rig-pierce.wav` triaged by repo tools only. Working tree only.
- 2026-10-27 — NS-16 32-bit WAV read: `readWav` accepts PCM 32-bit
  (MiC-native `arecord` S32_LE) as well as 16-bit; 16-bit path
  bit-identical, write stays 16-bit. Evidence: new
  `test/frame.test.ts` S32 test, `bun test` 54 pass, tsc + lint
  clean. Working tree only.
- 2026-10-27 — NS-2 LFS from the start: `samples/**/*.wav` +
  `samples/**/*.m4a` tracked (`.gitattributes`), `.m4a` originals kept
  for provenance; CI `bun` + `python-legacy` checkouts fetch LFS.
  Evidence: `git check-attr` shows `filter=lfs` on WAV/M4A (incl.
  legacy), plain git on text/code. Working tree only.
- 2026-10-27 — NS-3 identifiers approved as-is: lab MACs + 172.22.74.x
  publish unchanged (no regeneration). No code change. Working tree only.
- 2026-10-27 — NS-14 device-free triage: `docs/DIAG.md` failure model
  (6 failures → checks + agent playbook); guided Run-checks sequence
  (context/audio/mic-probe/synth) with per-error mic guidance; report
  v2 (env block, counters, drop-reason histogram); smoke check C runs
  the checks with a fake mic. Evidence: `bun test` 53 pass,
  `bun run test:browser` green (A+B+C). Working tree only.
- 2026-10-27 — NS-13 tikoci family styling: exact banner (MT logo SVGs
  byte-identical, by + TIKOCI badge → tikoci.dev), Pico v2.1 dark
  tokens mirrored as CSS vars with no Pico import (owner redirect:
  styling only, zero new deps), exact site-footer wording/layout,
  subpath-safe relative `api/frame` post; page makes zero
  cross-origin requests so tikoci.dev and tikoci.github.io both work
  unchanged, no CORS config needed. Evidence: `bun test` 51 pass,
  `bun run test:browser` green, screenshots verified desktop + mobile.
  Follow-up same day: body font restacked to JetBrains Mono first
  (tikoci main look) with the exact variable-font spec; filed
  [tikoci.github.io#13](https://github.com/tikoci/tikoci.github.io/issues/13)
  for an agent-ready page template. Working tree only.
- 2026-10-27 — NS-7 headless CI check: `test/browser-smoke.ts`
  (Playwright/Chromium) serves a pristine live.html copy from tmp,
  asserts the real Web Audio self-test verifies 11 bytes and a
  corrupted synth rejects (fletcher), zero pageerrors; `_test.runPlan`
  now shared by the bun + browser drivers. Evidence:
  `bun run test:browser` green locally, 51 bun tests green; first real
  CI run happens on the NS-1 push. Working tree only.
- 2026-10-27 — NS-12 diagnostics report: session verdict/log history
  feeds one button that fills + copies paste-ready markdown (browser,
  mic, sym, verdicts with repair flags, log tail, fill-in lines
  matching the capture template); clipboard failure falls back to
  manual select; builder covered by 2 live tests. Evidence: `bun test`
  51 pass. Working tree only.
- 2026-10-27 — NS-11 decode/diagnostics tabs: Decode holds start,
  pickers, status, result; Diagnostics holds self-test, waterfall,
  indicators, hex, log; tab switch is presentational only (canvas
  re-inits on show, waterfall guarded while hidden). Evidence:
  `bun test` 49 pass. Working tree only.
- 2026-10-27 — NS-10 tikoci restyle: topbar with TIKOCI badge →
  tikoci.github.io, © + not-affiliated footer, JetBrains Mono/Manrope
  stacks (Google Fonts link is optional enhancement; system fallbacks
  keep the page working offline); still one file. Evidence: `bun test`
  49 pass. Working tree only.
- 2026-10-27 — NS-6 slot-0 repair in the live decoder: `finishSweep`
  accepts a 15-tone 1..15 sweep, `finishData` repairs odd-count and
  straddle erasures structurally under Fletcher-16 (mirrors
  `src/frame.ts`); `window.__enbeep._test` drives the real state
  machine for `test/live.test.ts` (9 tests: clean self-test path,
  pierce-class 2×2 matrix, 4 fail-closed guards; reusable by NS-7);
  SPEC/README/TESTING divergence notes removed. Evidence: `bun test`
  49 pass. Working tree only.
- 2026-10-26 — Publish review + small fixes: SPEC/TESTING docs, WAV
  harness, CI/Pages workflows, real Biome lint gate, de-personalized
  README, legacy-script banners, 400 ms live option. Working tree only;
  NS-1 owns the push.

## Dropped

- (none yet)
