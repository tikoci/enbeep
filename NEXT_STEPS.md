# Next steps — read this first

This is the **only** tracker for enbeep work. Issues/discussions may hold
conversation, but status lives here. If you finish, block, or re-scope an
item, update this file in the same change that does the work.

## Start-here protocol (any agent, any session)

1. Read this file, then [docs/SPEC.md](docs/SPEC.md) (wire format) and
   [docs/TESTING.md](docs/TESTING.md) (how to test/report).
2. Re-verify the baseline before changing anything:
   `bun install && bun test && bunx tsc --noEmit && bun run lint`
   (baseline at last update: 65 pass + 1 opt-in CHR skip, tsc/lint clean).
3. Work the highest-priority `ready` item. One item per change.
4. When done, move the item to **Done** with date + evidence (test output,
   commit, capture file, or URL). Never delete an item silently; a dropped
   item moves to **Dropped** with the reason.
5. Keep this file short: ≤ ~10 open items. New ideas go in one line under
   **Inbox** until someone promotes them with acceptance criteria.

Status values: `ready` · `blocked` (say by what) · `needs-hardware`.

## State at last update (2026-10-28)

- Offline decoder: verified on RB1100AHx4 + RB953GS-5HnT captures.
- RouterOS integration: `bun run test:chr` fetch-loads the real encoder
  on CHR 7.25 x86, patches the speaker-init branch in RAM, captures
  QEMU pcspk audio, and verifies `Hello` offline. KVM, TCG, and `act`
  rehearsals pass; this is virtual audio, not hardware or live-browser
  evidence. Exact CLI pins, setup, and limits: [docs/CHR-BEEP.md](docs/CHR-BEEP.md).
  The supplementary `chr-beep` job is outside CI/Pages gating;
  GitHub-hosted proof remains part of NS-1.
- Live decoder: desktop verified; iPhone has only passed the in-page
  Self-test, never an over-air frame (see `frames.jsonl` analysis in
  docs/TESTING.md). Repo published as tikoci/enbeep (NS-1 done
  2026-10-28, public, `origin` configured); `main` holds the
  LFS-migrated history. Local `backup/pre-lfs-migrate` deleted after
  the push.
- Try tab: `live.html` opens on Try it — RouterOS load/play panel
  (`$enbeepText`) + editable speaker sender with byte validation;
  11-byte payloads show their text reading; the diagnostics report keeps
  the previous session across one reset. Router step offers paste vs
  fetch as two labelled options (script viewer + copy; same-origin
  one-liner, CHR-verified, experimental pending NS-5) and ends with a
  Decode handoff button. DATA deadline scales with the worst-case frame
  (NS-25 done). `src/` is v2 codec only; the retired batch tools moved
  to `decode/`. Speaker/mic device pairs still need trials (NS-22).
  `.scratch/` is the ignored local retention area (AGENTS.md).
- Encoder (hardened 2026-10-28, now `encode/enbeep.rsc`): `:global`
  re-declarations per the scripting manual, fail-fast `enbeep:` input
  validation, unload one-liner; CHR 7.26beta3 dry-run matrix green
  (paste, API-load, `/import`, `[:parse]`, fetch one-liner E2E). 7.16
  `/import` re-test still needs hardware. Named parameters + defaults
  are the non-blocking NS-27 item.
- Pages gating (NS-21 landed, success path deployed via NS-1): Pages
  deploys only on same-repo push CI success via `workflow_run`, pinned
  to the validated SHA, with no manual dispatch bypass; actionlint
  clean. A failed main revision skipping deploy is still unobserved.
- Diagnostics (NS-28 done): Run checks probes room/clip/band + applied
  mic settings with BT steerage; reports carry the session acoustic
  block, a live-mirrored likely-cause hint, an optional sender note,
  and the last check rows. iPhone trial (NS-4) will use an external
  MiC; internal mic stays the known-hard case.
- Public demo direction (owner clarification): Pages is a primary way
  people will try this. The accurate current README is not a product
  spec or the finished public presentation; NS-24 rewrites it once the
  validated deployment exists. Local review/handoff:
  `.scratch/2026-10-27-readiness/PUBLIC_DEMO_REVIEW.md` (not in clones).

## P0 — publish gate (top first; NS-1 last)

- [ ] **NS-21 Gate Pages deployment on validation** · `blocked` by a
  future failed main run (watch item).
  Workflow change landed 2026-10-28 (actionlint clean, revised after
  review): Pages triggers on CI completion via `workflow_run`, deploys
  only when the conclusion is `success` on a same-repo push event, and
  checks out the validated SHA. No `workflow_dispatch` (it would bypass
  the gate; recovery is a CI re-run). Success path proven by the NS-1
  publish cycle (CI success → Pages deployed the validated SHA).
  Residual: observe a failed main revision skipping deploy.
## P0 — demo truth (claims we must not make unverified)

- [ ] **NS-4 First over-air iPhone capture** · `needs-hardware`
  Pages live decoder on iPhone Safari ← real router frame. Owner will
  trial with an external MiC after NS-28; the phone-internal mic is the
  known-hard case (voice processing, BT reroute, browser mic stack).
  Record which input in the report either way. Done when: a WAV +
  decode JSON + report (docs/TESTING.md §4) is filed, pass or fail. A
  fail spawns a new item with the capture; it does not reopen NS-4.
- [ ] **NS-5 `/tool fetch` load experiment** · `needs-hardware`
  Test whether the one-liner
  `[:parse ([/tool/fetch url="..." output=user as-value]->"data")]`
  behaves like a CLI paste (nested globals work, no flash file) on CHR
  + one real 7.16 box. CHR half done 2026-10-28 for both the one-liner
  and the older fetch-to-file + `[:parse [/file/get ... contents]]`
  form (FRAME len=5 f1=250 f2=170, full T: trace); encode/README.md
  recipe C records the one-liner as CHR-verified. Residual: one real
  7.16 box. Until then, no doc may present fetch-loading as
  hardware-verified.

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

- [ ] **NS-27 Named encoder parameters + defaults** · `ready` (low, non-blocking)
  Accept `$enbeepText text="Hello" symbol=200ms` style named arguments
  with defaults for sym/tone alongside the positional
  `text sym tone dry` form (positional keeps working; decide the exact
  names before implementing). Lower-stakes alternative: a small helper
  with defaults (note `$enbeepText` already plays that role against
  `$enbeepXmit`; align web defaults with it). Done when: both call
  styles dry-run identically on CHR, validation errors stay prefixed
  and fail-fast, and encode/README.md documents the names. Not a
  publish gate.
- [ ] **NS-26 Scheduler autoload trial** · `needs-hardware`
  Check whether the encoder functions can autoload at boot via
  `/system scheduler` (start-up event running the fetch one-liner or a
  stored script) and stay callable from an admin terminal. Globals are
  per-user, so a scheduler-owned load may not be visible where the user
  calls it — that is the question. Owner-volunteered: run on a real
  box, report the scheduler entry + which user sees the globals. Not
  needed for Try It. Done when: encode/README.md records the working
  recipe or the per-user limitation with evidence.

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
- CHR pcspk-beep follow-up after NS-30: `tone < sym` gap-loss verdict.
  CLI versions are already exact pins; moving package tags need no change.
- Diag-UX follow-ups from the first iPhone trial (NS-22): session
  activity timeline (reconstruct what the reporter did — failures get
  wiped by later checks today), sender details as a real form next to
  Copy-diagnostics instead of fill-in-by-hand, README pointer for the
  one-shot report procedure (listen → play once → copy immediately).

## Done

- 2026-10-29 — NS-31 WebAudio/mic lifecycle hardening (Codex review
  2026-10-29; report pasted in chat, `.scratch` copy on the owner's
  Mac): single-flight startup with Cancel (generation guard, local
  resource ownership until commit, late grants stopped, idempotent
  teardown), exclusive mic-vs-synth ownership (Self-test/sender refuse
  a live session), picker disabled during capture + devicechange/
  visible refresh + permission-honest options + loud vanished-device
  fallback, context created/resumed in-gesture with a running-clock
  requirement, mute/unmute/end + suspend/resume + wake-lock-release
  handling with frame invalidation, checks gated on a healthy clock
  with blocked (○) rows + fresh synth verdicts, and preserved failure
  identity (stage/name/message/constraint, selected-vs-applied route,
  audio snapshot, lifecycle log, synth-tagged verdicts, hint
  reordered definite-first). Codec + thresholds unchanged. Evidence:
  new `test/webaudio.test.ts` 13 lifecycle regressions, `bun test` 81
  pass + 1 opt-in CHR skip, tsc/lint clean, browser A/B/C1/C2/F/E/D
  green with zero pageerrors, Python legacy 18 pass in `.venv`
  (system python lacks numpy — pre-existing), docs/DIAG.md field
  reference updated. Posted as PR #4 (branch
  `fix/ns-31-webaudio-lifecycle`); review follow-ups below.
- 2026-10-29 — NS-31 review follow-ups (Macroscope, PR #4): bound
  every pending audio promise (5 resume sites + wake-lock request +
  checks enumeration share a 5 s `settleBefore` race, shrinkable via
  `_test`), so a stuck autoplay promise can no longer wedge startup,
  playback, or checks; sync tracking now resets on loop gaps,
  interruption, and recovery (a gap no longer counts toward the 800 ms
  preamble); the tick loop decodes nothing while interrupted but stays
  armed. Evidence: 4 new `test/webaudio.test.ts` regressions (17 total
  in file; verified to fail on the pre-fix page while the other 13
  pass), `bun test` 85 pass + 1 skip, tsc/lint clean, browser
  A/B/C1/C2/F/E/D green.
- 2026-10-29 — NS-31 review follow-ups (CodeRabbit, PR #4): post-commit
  setup failures now release the committed mic/context via
  `stopListening` and report at a new `setup` stage (its Major on
  pending `resume()` was already fixed by the previous push); the
  checks probe closes a local context even on mid-probe throws;
  recovery requires a live unmuted track plus a running clock (no
  cross-clearing); `playTones` reports whether the audio finished and
  both callers pass it up; an unplayed synth check reports blocked.
  Evidence: 3 new + 2 strengthened `test/webaudio.test.ts` tests (20
  in file; the 4 behavior-change tests fail on the pre-fix page while
  the other 16 pass), `bun test` 88 pass + 1 skip, tsc/lint clean,
  browser A/B/C1/C2/F/E/D green. The stub-button fix this round also
  made two earlier tests exercise their real paths.
- 2026-10-29 — NS-31 review follow-ups, round 3 (Macroscope, PR #4):
  late wake-lock grants after the request timeout are released instead
  of leaking past Stop; startup rechecks context/track health after
  the wake-lock yield (suspension/mute/ended in that window
  interrupts instead of presenting healthy capture); a page tap
  resumes a suspended live session, making the interruption message
  true. Evidence: 3 new `test/webaudio.test.ts` regressions (23 in
  file; all 3 fail on the pre-fix page while the other 20 pass), `bun
  test` 91 pass + 1 skip, tsc/lint clean, browser A/B/C1/C2/F/E/D
  green. Note: CodeRabbit auto incremental reviews are disabled on
  this repo, so it only reviewed the first push — re-review needs a
  manual `@coderabbitai review` trigger.
- 2026-10-29 — NS-31 review follow-ups, round 4 (Macroscope, PR #4):
  checks runs are cancellable (same generation discipline as
  startup): the button reads Cancel while a run is live, cancelling
  frees mic-free playback at once, a late probe grant's tracks are
  stopped and never adopted, the probe loop and synth phase never run
  for a dead run, and rows/report state stay untouched after cancel.
  Evidence: 3 new `test/webaudio.test.ts` regressions (26 in file;
  all 3 fail on the pre-fix page while the other 23 pass), `bun test`
  94 pass + 1 skip, tsc/lint clean, browser A/B/C1/C2/F/E/D green,
  docs/DIAG.md notes the Cancel behavior.
- 2026-10-29 — NS-31 review follow-ups, round 5 (Codex + Macroscope,
  PR #4): an ended mic track now invalidates the in-progress frame
  and parks the decode loop until a new session (recovery can never
  clear a dead path); the checks probe watches clock/track health
  mid-measurement and blocks the dependent rows instead of reporting
  passes on stale samples; cancelling before the checks mic request
  never opens a permission prompt; wake-lock re-acquisition shares
  startup's release handling (plus late-grant release when stopped
  mid-request); the checks button stays an enabled Cancel through
  the synth phase. Evidence: 5 new + 1 extended
  `test/webaudio.test.ts` tests (31 in file; all 6 fail on the
  pre-fix page while the other 25 pass), `bun test` 99 pass + 1
  skip, tsc/lint clean, browser A/B/C1/C2/F/E/D green, docs/DIAG.md
  notes the mid-probe blocks + Cancel behavior.
- 2026-10-29 — NS-31 review follow-ups, round 6 (Claude, PR #4): a
  wake-lock re-acquire that lands while another grant already holds
  the handle (a second visibility return, or Stop/Start mid-request)
  is released instead of overwriting and orphaning the held lock; the
  checks probe treats a trackless grant as `NotFoundError` (same as
  startup) instead of crashing in the probe loop. Evidence: 2 new
  `test/webaudio.test.ts` regressions (33 in file; both fail on the
  pre-fix page while the other 31 pass), `bun test` 101 pass + 1
  skip, tsc/lint clean, browser A/B/C1/C2/F/E/D green.
- 2026-10-28 — NS-1 Publish and prove the public surfaces: created
  tikoci/enbeep (public), pushed `main` only at `add372c` (backup +
  `t3/*` refs stayed local), LFS 39/39 objects. First cycle green:
  CI (bun/python-legacy/browser), CHR beep + downloadable artifact,
  Pages deployed the validated SHA via `workflow_run`. Verified
  https://tikoci.dev/enbeep/ (live decoder), `/harness.html`,
  `/enbeep.rsc` (all 200, byte sizes match). GitHub settings applied:
  squash-only + PR-title + autodelete, `capture` label, Pages workflow
  builds, `main` protection (PR, 3 strict checks, 0 approvals, admins
  included). Backup ref deleted post-push. Demo URLs feed NS-24.
- 2026-10-28 — Pre-publication CHR/code/docs review: isolated VM names
  (parallel KVM/TCG runs pass), original + replacement patch-byte
  checks, explicit WAV format + shared WAV reader, API failure no
  longer accepted just because audio grew, cleanup errors surfaced,
  capture/verdict/log artifacts retained locally and uploaded by the
  workflow. Failure probing caught bunx's surviving child keeping
  stdout open after timeout; kill the command process group, covered
  by a default-suite regression. Pin `start --version 7.25` too:
  quickchr otherwise contacts the stable-channel endpoint before
  looking up the named VM, which hung during this review. README,
  TESTING, CHR-BEEP, encoder guide, CONTRIBUTING and AGENTS aligned
  around virtual audio vs hardware evidence and the supplementary
  workflow. NS-21's remaining GitHub-only proof marked blocked by
  NS-1; the obsolete moving-tag follow-up is resolved by exact pins.
  Evidence: 65 bun pass + 1 expected CHR skip, tsc/lint/actionlint clean,
  browser A/B/C1/C2/F/E/D + 18 Python tests green; final KVM/TCG runs
  41/54 s; wrong-signature probe rejects before writing and cleans up.
  `act` KVM passed including artifact upload; software-only `act` TCG
  passed in 60 s with the stock image cached read-only (the preceding
  cold-cache run hit a MikroTik download outage, with failure artifacts
  successfully uploaded). Commands/logs:
  `.scratch/2026-10-28-chr-review/README.md`. Working tree only.
- 2026-10-28 — NS-30 CHR pcspk-beep integration test:
  `test/chr-beep.test.ts` (`bun run test:chr`, gated on
  `ENBEEP_CHR_TEST=1`) boots x86 CHR 7.25 via quickchr@0.5.3
  (`--qemu-arg` pcspk audiodev, `start --frozen`, gdbstub RAM patch
  with verify-before-write, `continue`), fetch-parses + transmits
  `$enbeepText "Hello"` in one compound API call (same-session; a
  split load/transmit flaked once), and decodes the sliced capture
  (`ok:true`, sweep 0–15, payload Hello, Fletcher OK). Separate
  `.github/workflows/chr-beep.yml` (not a Pages gate). Evidence: local
  KVM 42 s + TCG 53 s green (cmdline-verified `-accel tcg`), `act`
  rehearsal with `/dev/kvm` green in 58 s, default `bun test` 64 pass
  + 1 skip, tsc/lint/actionlint clean. Follow-ups stay in the inbox
  (`tone<sym` gap verdict; the original tag-switch note is superseded
  by the review above). Side findings in
  docs/CHR-BEEP.md: compound-call requirement, KVM-optional proof,
  one unexplained CHR reboot in ~1 h. Working tree only.
- 2026-10-28 — NS-29/NS-20 review follow-ups (2 P2s + 1 P3): backup ref
  restored to the verified pre-migration commit with an old-value guard
  (main untouched); smoke (F) now requires the signal/band lines and
  parses finite in-bounds clip-peak %, in/out-of-band dB, and floor
  range (missing/n/a/NaN all fail); samples/README.md LFS status
  aligned with completed NS-20. Evidence: 64 bun pass, tsc/lint clean,
  browser A/B/C1/C2/F/E/D green. No commit per review instructions.
- 2026-10-28 — NS-20 history preserved + migrated to LFS: 15/15 commits
  rewritten (`main` e5f510d → 8074118), no `*.wav`/`*.m4a` left as plain
  objects (largest blob now 100 KB), 39 files / 87 MB in LFS. Review:
  secret scan clean; text IPs all private/docs/multicast (public-looking
  hits are SVG path fragments in live.html); no emails, phones, home
  paths, SSIDs, geo; single role-account author; lab MACs per NS-3.
  Fresh-clone proof: documented `git lfs install` + pull materializes
  real audio (also caught that only `--local` LFS config existed here),
  then 64 pass + tsc + lint + full smoke green. Local-only backup ref
  `backup/pre-lfs-migrate` until the NS-1 push (NS-1 records the push
  scope + ref deletion); review caught the migrate moving the backup to
  the new HEAD too, so it was restored to e5f510d with an expected-old-
  value guard and re-verified (main at 8074118, original ~3.9 MB blobs
  readable under the backup). Working tree only.
- 2026-10-28 — NS-29 file-fed live-listen: smoke (F) feeds a rendered
  11-byte v2 frame WAV as the fake mic, presses Start Listening for
  real, and asserts a mic-path verify of the exact payload plus
  populated clip/band session lines and ≤2 dropouts. Closes the
  tick()-mic-path coverage gap (clip scan, band accumulation, dropout
  counting, floor learning). Evidence: browser
  A/B/C1/C2/F/E/D green. Working tree only.
- 2026-10-28 — NS-28 review follow-ups (4 P2s): synth sessions no
  longer report mic-path clip/band (sessionIsSynth gate); Run checks
  probes the selected mic (deviceId); route line keeps the track's own
  label across picker changes/Stop; classifier ranks USB over generic
  headset and only suspects bare-headset labels on lo-fi settings.
  Regression cover: smoke A asserts clip/band n/a after Self-test; bun
  classifier cases; codex repro
  (`.scratch/2026-10-28-ns28-review/repro.ts`) confirms n/a + saved
  label + deviceId in constraints (its 7-row wait times out on the
  failure path by design — no mic, no probe rows). Evidence: 64 bun
  pass, tsc/lint clean, browser A/B/C1/C2/E/D green. Working tree only.
- 2026-10-28 — NS-28 pre-flight + no-harness reports: 2 s mic probe feeds
  `mic` (peak/RMS/applied settings/BT flag), `room` (resting p10),
  `clip`, `band` (power-mean in-vs-out) rows; report gains route,
  session (elapsed/dropouts/hidden), signal (floor range, loudest,
  SNR est, clip), band, live-mirrored `hint:` (BT → mic-path → loud
  room → sym mismatch), sender note, and embedded last-checks; DIAG.md
  maps the new fields to cases 1–6 with thresholds; TESTING §4 steers
  reporters to the sender note + checks. No new `api/frame` payload.
  Evidence: 64 bun pass (threshold units + report/hint integration),
  browser A/B/C1(file-fed quiet all-pass)/C2(loud in-band flags
  room+band)/E/D green, tsc/lint clean. Working tree only.
- 2026-10-28 — Owner-requested GitHub collaboration policy:
  CONTRIBUTING.md documents short-lived branches into main, focused PRs,
  three required CI jobs, maintainer review with zero required external
  approvals, squash merge + branch cleanup, and Pages after validated
  main pushes. Issues remain reports/discussion; NEXT_STEPS stays the
  sole tracker. Added a short PR template and README/agent links. NS-1
  includes the settings checklist; no GitHub settings applied locally.
  Evidence: final required gate 61 pass + tsc/lint clean; 56 local
  Markdown link targets exist; diff whitespace clean. Documentation only.
- 2026-10-28 — Owner + review follow-ups: encoder renamed to
  `encode/enbeep.rsc` (all refs); fetch recipe is the CHR-verified
  single-expression one-liner (no flash file); Try-tab router step split
  into labelled paste/fetch options with the `/import` aside removed
  from the human path; Try tab ends with a Decode handoff button; Pages
  gate tightened (no `workflow_dispatch` bypass, same-repo push source
  guard); DIAG.md `data timeout` entry rewritten for the NS-25
  deadline. New tracking: NS-26 scheduler autoload trial
  (owner-volunteered hardware), inbox idea for named encoder parameters.
  Evidence: 61 bun pass, tsc/lint clean, browser A–E green, actionlint
  clean, CHR one-liner E2E. Working tree only.
- 2026-10-28 — NS-25 live DATA deadline scales with the frame: worst-case
  `2*(255+3)*symMs + 5 s` replaces the fixed 30 s (no early-LEN shortcut:
  slot-0 masking makes the first tones untrustworthy). New
  `test/live.test.ts` parity (5 B control, 80 B @200 ms, 40 B @400 ms,
  255 B @200/400 ms through both decoders) + missing-END timeout test.
  SPEC limits section now claims the full 1..255 range synthetically and
  keeps long over-air frames as untested. Evidence: 61 bun pass, browser
  A–E green. Working tree only.
- 2026-10-28 — Owner-requested encoder hardening for a forum audience:
  `:global` re-declarations per the scripting manual (the documented fix
  for the 7.16 `/import` nesting failure; centrs `explain` still warns on
  the 5 substitution-headed nested calls, as it must offline),
  fail-fast `enbeep:` validation (payload 1..255, sym/tone times with a
  50 ms..10 s sanity range — bare `200` would silently mean 200 s — tone
  ≤ sym, friendly interface/address errors), unload one-liner, integer
  division note. CHR 7.26beta3 matrix green: identical tone plan before/
  after, all 8 error cases fail loud, paste/API-load/`/import`/parse-load
  all nest, real `/tool fetch` E2E. encode/README.md gained recipe C +
  validation notes. 7.16 hardware re-test still open. Working tree only.
- 2026-10-28 — Owner-requested Pages install UX: Try-tab router step now
  shows the script in-page (lazy fetch + copy) with a plain-file
  fallback link, plus a same-origin `/tool fetch` one-liner computed
  from `document.baseURI` (labelled experimental, CHR-verified, pending
  NS-5). Evidence: browser A–E green, zero pageerrors, Try-panel
  screenshot reviewed. Working tree only.
- 2026-10-28 — Owner-requested docs/code-readability review (small fixes
  before publication; no history rewrite or deployment): README names
  `:beep` → nearby mic, hobby scope and one-way delivery; SPEC explains
  the encoding choices with Wikipedia background links, removes the
  unsupported fixed Fletcher false-accept probability, and distinguishes
  wire limits from live timeout/ASCII-preview limits. Added agent code
  reading order; aligned loading, triage, capture and LFS notes. Larger
  new finding is NS-25; NS-20/21 remain publication gates. Evidence:
  final required gate 59 pass + tsc/lint clean; browser A–E green;
  46 local Markdown links resolve; diff whitespace clean. Deterministic
  timeout reproductions retained locally in
  `.scratch/2026-10-28-doc-review/`. Documentation changes only.
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
