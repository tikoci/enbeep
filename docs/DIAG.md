# docs/DIAG.md — live-decoder failure model + triage playbook

The Diagnostics tab exists so a failure can be triaged **without the
reporter's device**. This doc maps each user-visible failure to the
checks and captured environment that discriminate it, and tells an
agent how to read a pasted report.

In-page tools (Diagnostics tab):

- **Run checks** — guided sequence: `context` (secure? URL?), `audio`
  (sample rate, context state, latency), `mic` (permission + 1 s live
  level probe), `synth` (in-page decode with no mic). Requires IDLE.
- **Self-test** — the `synth` step alone (decoder check only).
- **Copy diagnostics report** — markdown for a capture-report issue
  (fields below). Always ask for this before follow-up questions.

The report keeps the last session across one reset (a retry, Self-test,
or Run checks), but a second reset replaces it — copy before retrying
twice. Run checks appends its synthetic verdicts to the current history;
copy the attempt report first for the cleanest evidence. Stop listening
to run checks, then copy a separate checks report if useful.
For speaker → mic tests, record both devices and use only the receiving
device's result as evidence of an acoustic decode. The Try-it tab holds
the message sender and RouterOS panel; it is not diagnostics.

## Failure model

| # | Symptom | Likely causes | Discriminating datum | Where |
|---|---|---|---|---|
| 1 | Start fails immediately | permission denied; no device; mic busy; insecure context | gUM error name + one-line fix | log line `mic start failed (…)`; `mic` check |
| 2 | Listening, never locks | wrong device; muted; too far; room noise | noise floor vs live peaks; mic label; elapsed time | `sym`/floor line; `mic` check peak |
| 3 | Locks, frames always drop | wrong sym; weak SNR; smear; masking beyond repair | drop-reason histogram; stage where it dies | `### drop reasons`; verdict errors |
| 4 | Sometimes verifies | marginal SNR; distance; movement; drift | verify rate; maxDf trend; repair flags | attempted/verified; verdict lines |
| 5 | Works on desktop, not on phone | sample rate; autoplay policy; browser mic stack; BT latency | sample rate; UA; latency; mic label | `audio:` / `browser:` / `mic:` lines |
| 6 | Verifies but wrong address | stale encoder; user misread | payload bytes vs expected | verdict `✓` line payload |

Reading the drop histogram (case 3), most common first:

- `sweep mismatch` — tones present but off-center: wrong sym, drift,
  or heavy smear. Check `sym:` vs the encoder's sym.
- `byte count` — confident tones, impossible LEN: straddle beyond the
  fallback, or a non-announce frame. Check sym + encoder version.
- `short sweep` / `sweep gap` — sync never cleanly ends: noise during
  PRE/SEP, or signal far too quiet. Check floor + mic peak.
- `tone outside band` — one slot wild: click/pop, or offset badly
  wrong (then *every* frame drops here — suspect calibration).
- `erasure unrecoverable` — masking ate slot 0 and LEN is ambiguous:
  slow piezo + damage. Ask for the WAV.
- `fletcher mismatch` (verdict, not a drop) — structure fine, bits
  wrong: exact-center smear. Ask for the WAV.

## Report field reference

- `page:` / `browser:` — full UA; tells phone vs desktop, Safari vs Chrome.
- `secure:` — `NO` explains every mic failure; fix is HTTPS, not code.
- `mic:` — device label (or `Default input`), track state, `inputs seen`
  (enumerateDevices count; `unknown` = never enumerated).
- `audio:` — context sample rate + state; `none` = never started audio.
- `sym:` + `noise floor:` — setting vs measured floor in dB.
- `frames attempted / verified` — counts from the most recent 20 verdicts,
  including synthetic checks if run in that history; not session totals.
- `### drop reasons` — histogram; keys are stable across slot indices.
- `### frame verdicts` — newest last; `repair` is `none|sweep|data|sweep+data`.
- `### previous session` — prior session's verdicts + drop counts, kept
  across one reset; absent when there is nothing stashed. Verdict lines
  carry `as text "..."` so message payloads read without decoding hex.
- `### log tail` — last 30 log lines, newest last.
- `### still needed` — what only the human knows (router, command,
  distance, WAV). Don't triage past these when they're the gap.

## Agent playbook

1. Read `secure:` first. If `NO`, stop: the fix is serving over HTTPS.
2. Read `mic:` + the `mic` check (if Run checks was used): permission
   errors name themselves; `peak -inf`/very low = wrong device or mute.
3. Read `audio:` sample rate on phone reports: 44100 vs 48000 is fine
   (the decoder adapts), but a missing/suspended context is not.
4. Read `### drop reasons`: one dominant key = one mechanism (table
   above). Scattered keys = too-quiet signal or wrong sym — check
   floor, mic peak, and `sym:` vs the encoder.
5. Read `frames attempted / verified`: 0 attempts after minutes of
   "listening" = case 2 (nothing detected), not case 3.
6. Ask for the WAV when the histogram says signal damage (`fletcher
   mismatch`, `erasure unrecoverable`, `tone outside band` on every
   frame) — air truth beats speculation.
7. A passing `synth` check narrows the failure; it does not rule out a
   decoder bug on real microphone input. Compare the captured WAV in the
   harness/offline decoder with the live report before assigning cause.
