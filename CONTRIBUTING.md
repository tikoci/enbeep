# Contributing to enbeep

This is a small, experimental project. We use a lightweight
[GitHub flow](https://docs.github.com/en/get-started/using-github/github-flow):
short-lived branches, focused pull requests, and a checked `main`.
These are the project defaults after initial publication. GitHub-side
settings still need applying and verifying during NS-1 in
[NEXT_STEPS.md](NEXT_STEPS.md).

## Issues and work selection

Issues hold bug reports, capture reports, questions, and proposals.
For acoustic trials, use the Capture report template and
[reporting guide](docs/TESTING.md#4-reporting-a-capture-what-actually-helps).
For other bugs, include reproduction steps, expected behavior, and the
actual result. A small fix does not need a separate issue first.

[NEXT_STEPS.md](NEXT_STEPS.md) is the only work tracker. Accepted work
goes there with an issue link when available; an open issue alone does
not mean an agent should implement it. Start with its highest-priority
`ready` item unless the owner's current task specifies different work.
Use the `capture` label for trials; GitHub's default labels are
enough for everything else. Labels do not track work status.

## Branches, PRs, and merging

1. Start from current `main` on a short-lived branch with a descriptive
   name, for example `fix/ns-25-data-timeout`. Outside contributors can
   use a fork. `main` is the only long-lived branch.
2. Keep one logical change per PR, including its relevant tests, docs,
   and tracker update. Follow [AGENTS.md](AGENTS.md) for code entry points
   and the required local validation; use [docs/TESTING.md](docs/TESTING.md)
   for browser and hardware checks. Report what was actually tested.
3. Open a PR targeting `main`; use a draft while work is incomplete.
   Give it a clear title describing the resulting change and fill in
   the short template. Link an existing NS item and GitHub issue when
   applicable. Use `Closes #…` only when the issue is fully resolved.
4. Address review comments and pass all required CI checks on the latest
   revision. A maintainer reviews the diff and evidence before merging;
   self-review is fine for the solo maintainer. Agents stop at the PR
   unless their task authorizes merging or publication.
5. Squash merge, using the PR title as the commit title, then delete the
   branch. Branch commits can be ordinary descriptive messages; no
   commit-message parser or special prefixes are required. The PR's
   tracker update records the outcome and evidence.

## CI and Pages

[CI](.github/workflows/ci.yml) runs on PRs and pushes to `main`, including
docs-only changes. All three jobs are required:

| Check | Covers |
|---|---|
| `bun` | Frozen dependency install, TypeScript, lint, codec and capture regressions |
| `python-legacy` | Retired Python analyzer regressions |
| `browser` | Headless Chromium smoke checks, including Web Audio and the WAV harness |

CI does not prove microphone, piezo, or phone compatibility; hardware
evidence follows [docs/TESTING.md](docs/TESTING.md). Workflow changes
should also pass `actionlint` locally.

The supplementary [CHR beep workflow](.github/workflows/chr-beep.yml)
runs a real RouterOS sender through QEMU virtual-speaker capture and
the offline decoder on PRs and main pushes. It is separate from CI and
is not a required check or Pages gate. Run `bun run test:chr` when
changing the encoder or its integration harness; setup, exact version
pins, retained artifacts, and limitations are in
[docs/CHR-BEEP.md](docs/CHR-BEEP.md#run-the-integration-test).

[Pages](.github/workflows/pages.yml) deploys the exact SHA validated by
successful CI on a same-repository push to `main`. PRs do not deploy.
To retry a deployment, re-run that revision's CI; there is no manual
deployment bypass. A green PR permits merging; the merged revision must
pass CI again before Pages deploys.

## GitHub setup at publication

Apply these settings after the initial push and first CI run; this file
documents policy and does not configure GitHub:

- Protect `main`: require a PR, require checks `bun`, `python-legacy`,
  and `browser`, and require the branch to be up to date. Confirm the
  check names against the first CI run. Require review conversations to
  be resolved; leave the required approval count at zero so solo work
  can merge. Apply the rules to administrators too; block force pushes
  and branch deletion.
- Verify the supplementary `chr-beep` run and its capture artifact on
  the first main push too; keep it outside the required checks and
  Pages gate unless that policy is deliberately changed.
- Enable squash merging as the sole merge method, use the PR title for
  its default commit title, and enable automatic branch deletion.
- Create the `capture` issue label used by the existing template.
- Set Pages to deploy through GitHub Actions and verify the surfaces
  and failed-CI behavior listed in NS-1/NS-21. Pages deployment is a
  post-merge check, not a required PR check.

GitHub references: [branch protection](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
and [squash merge settings](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/configuring-commit-squashing-for-pull-requests).
