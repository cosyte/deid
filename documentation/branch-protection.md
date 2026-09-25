### Branch protection and Dependabot

- **`main` is protected by the repository ruleset `ci-required-checks`** (7 required contexts, each
  pinned to the GitHub Actions app; blocks deletion and force-push). Before it, `main` had **no rules at
  all**. → `documentation/agent-notes.md#the-ruleset-ci-required-checks`
- **A required context a branch cannot emit leaves that PR PENDING, not failing: rebase it.** Expect it
  EVERY time a context is added; it has happened twice.
  → `documentation/agent-notes.md#a-required-context-a-branch-cannot-emit-leaves-the-pr-pending`
- **Never require `scorecard`** (it never runs on `pull_request`), nor the GHAS `CodeQL` check.
  → `documentation/agent-notes.md#why-scorecard-is-not-required`
- **Read `ci.yml`'s job-name banner before renaming a job or splitting a step out of `verify`**: a
  required job gates its steps, so promoting one silently un-requires it. **The PHI scan is a STEP of
  `verify`, so it is required only for as long as it stays one.** **The leak/over-scrub corpus
  (`test/corpus/`, the cross-format zero-leak gate, proven non-vacuous) is protected by NO ruleset**: it
  is glob-selected in `vitest.config.ts`, so narrowing the glob, moving it or `.skip`-ing it drops this
  repo's headline leak gate with nothing to notice.
  → `documentation/agent-notes.md#job-names-and-what-a-ruleset-cannot-see`
- **`pnpm smoke` is a real gate; the shared pipeline's `Dual ESM/CJS smoke` step is NOT the same check**
  (root entry only). **Its scope is DERIVED from `package.json`'s `exports`: replacing that with a
  hand-written array reopens the hole above.** **Its leak sweep is HL7-ONLY**: the cross-format
  zero-leak gate is `test/corpus/`, from source. → `documentation/agent-notes.md#the-smoke-gate`
- **`pnpm check:no-internal-refs`** runs in its own workflow; context is the bare job id
  `no-internal-refs`. **Read a real context name off a live check run, never off a workflow's `name:`.**
  It gates the _source_ of published text, not `dist/`. **It DELIBERATELY does not scan `CHANGELOG.md`,
  `.changeset/`, this file, or `//` comments: identifiers BELONG there, so do not "fix" one out of
  them.** → `documentation/agent-notes.md#the-no-internal-refs-gate`
- **`pnpm check:test-selection` gates what the required test job SELECTS.** Context `test-selection` is
  **deliberately NOT in the ruleset yet**: let it run on `main` first. **Its subject is DERIVED from
  `exports`; there is no exemption list, because every exemption a sibling offered was walked through by
  a rename. The cost is paid in the repo instead: A MODULE THAT IS NOT A TEST MAY NOT IMPORT A PUBLISHED
  ENTRY POINT.** So `test/helpers/run-date-shift.ts` imports `src/` directly on purpose: **do not
  "tidy" it back to the root entry.** **Self-test D covers THREE NAMED DERIVATIONS, not "the
  derivations": a diff touching `exportedSourceEntries` or `resolveSpecifier` is reviewed by a person
  against the OK line's counts. DO NOT REMOVE D TO "SIMPLIFY"**: the other three self-tests cannot see
  what it sees. Selection is not execution, and the measured limits are listed, none claimed closed.
  **The per-rule tallies are absent from this file DELIBERATELY: they went stale before the files they
  counted existed. The OK line prints the live figures on every run; do not write one back in here.**
  → `documentation/agent-notes.md#the-test-selection-gate`
- **`pnpm check:agent-notes` gates this file's pointers into the narrative one**, on `pnpm check` and
  `pnpm test`, riding required `ci / verify`; NO new required context. **MATCHER, ANCHOR SPACE AND
  CORPUS PARTITION WERE EACH DERIVED FROM THIS TREE AND NONE PORTS**: a bare anchor or explicit anchor
  tag REFUSES; the partition is **UTF-8 decodability, NOT NUL**. **It asserts this repo's promise,
  never a universal about a sibling. Never clear a red by deleting a pointer, heading or span.**
  → `documentation/agent-notes.md#the-narrative-pointer-gate`
- **The ruleset BLOCKS the "Version Packages" PR by design: it needs one push** (an empty commit onto
  `changeset-release/main`), done **last**, immediately before merging. `bypass_actors` is empty on
  purpose. → `documentation/agent-notes.md#the-version-packages-pr-is-blocked-by-design`
- **Unproven, and stated as unproven: PRs from FORKS.** No fork PR has ever run here.
  → `documentation/agent-notes.md#fork-pull-requests-are-unproven`
- **Nothing in this repository can observe its own ruleset: do NOT take this section as evidence.**
  Verify with `gh api repos/cosyte/deid/rules/branches/main`.
  → `documentation/agent-notes.md#nothing-here-can-observe-its-own-ruleset`
- **Dependabot cannot see the six vendored sibling parsers** (`file:` tarballs) or `pnpm.overrides`,
  re-pack the `@cosyte/dicom` tarball by hand when the upstream pass changes.
  → `documentation/agent-notes.md#what-dependabot-watches`
- **The config buys VERSION updates only; automatic SECURITY update PRs are a separate repo setting**
  that read `disabled`. Check `gh api repos/cosyte/deid --jq .security_and_analysis`, not this line.
  → `documentation/agent-notes.md#what-the-dependabot-config-does-not-buy`
- **Unobserved: whether Dependabot's pnpm updater tolerates this manifest. Do not read "no open
  Dependabot PR" as "nothing is stale".**
  → `documentation/agent-notes.md#whether-the-pnpm-updater-tolerates-this-manifest`
