# @cosyte/deid — Project Guide for Claude

## Project

**`@cosyte/deid`** — a developer-focused healthcare **de-identification** library for Node.js/TypeScript,
published under the Cosyte brand. Open-source (MIT). It is a **consumer** of the `@cosyte/*` parsers,
**not a parser sibling**: it borrows the archetype's disciplines (typed diagnostics, immutable output,
the policy/profile system) but **inverts the reflex** — a parser is liberal on input (Postel's Law); a
de-identifier is conservative and **fails closed**.

**North star:** a developer holds a parsed healthcare document full of PHI and calls
`deidentify(model, { policy: "safe-harbor" })`, getting back a Safe-Harbor-transformed model plus a
**value-free manifest** — without reading 45 CFR §164.514, without hand-writing a scrubber, and without
ever being handed a document that silently still contains a name/DOB/MRN, or one whose clinical values
were destroyed. The governing honesty line: output is **"Safe-Harbor-transformed per the configured
policy,"** never "de-identified" / "HIPAA-compliant"; Expert Determination is supported (later phases),
never rendered.

## Status

- **DEID-1…DEID-10 shipped — the roadmap is complete.** Pre-alpha `0.0.x`, not yet published to npm.
  `src/` carries the format-agnostic core (DEID-1: the policy engine `deidentify` / `SAFE_HARBOR_POLICY`
  / `defineDeidPolicy`, the five `node:crypto`-backed transforms, the 18-category Safe Harbor model, the
  fail-closed rule, the value-free manifest) plus **all six per-format adapters** on the core's generic
  locus model: **HL7 v2** (`@cosyte/deid/hl7`, DEID-2), **C-CDA** (`@cosyte/deid/ccda`, DEID-3),
  **FHIR R4** (`@cosyte/deid/fhir`, DEID-4), **X12 EDI** (`@cosyte/deid/x12`) and **NCPDP Telecom**
  (`@cosyte/deid/ncpdp`) (DEID-5), and **DICOM** (`@cosyte/deid/dicom`, DEID-6 — the one adapter that
  **delegates** to `@cosyte/dicom`'s PS3.15 Annex E pass, metadata-only, burned-in pixels flagged not
  cleaned). Each format's parser is an **optional peer dep** consumed only from its subpath (vendored
  `pnpm pack` tarballs pre PUB-FLIP). **NCPDP SCRIPT remains deferred** — its lossy serialize +
  address-less `Patient` model block a faithful structural de-id through the current parser surface.
  **DEID-7** adds the format-agnostic **longitudinal layer** over all six adapters: the corpus registry
  (`createDeidRegistry`) for cross-document consistency, the formalized key contract (consumer-supplied
  key, fail-closed `DEID_NO_KEY`, rotation = intentional linkage breakage), and the `DEID_POLICY_INVALID`
  label guard (date-shift may not wear the `safe-harbor` label). **DEID-8** adds the free-text BYO
  redaction interface (block-by-default; a consumer redactor is consumer-asserted, never re-verified).
  **DEID-9** adds the **Expert-Determination _support_ report** (`buildExpertDeterminationSupportReport`
  / `formatExpertDeterminationSupportReport`): a value-free structuring of the manifest that **supports**
  a HIPAA §164.514(b)(1) Expert Determination and **renders none** (`determination: null`, a prominent
  disclaimer, no fabricated risk score). **DEID-10** is release hardening: **policy profiles**
  (`SAFE_HARBOR_PROFILE`, `LIMITED_DATA_SET_PROFILE`, `defineDeidProfile` under a fail-closed
  **widen-never-narrow** contract, `profileOptions`); a **consolidated leak/over-scrub corpus + pipeline
  fuzz** gating CI across all six formats, proven **non-vacuous** (sentinels present pre-de-id + a
  re-injected sentinel is caught); a **release smoke** (`pnpm smoke`) that loads every subpath in ESM+CJS
  against the built `dist/`; a `docs-content/limitations.md` **honesty doc**; the **tsup shared-core
  chunk fix** (`splitting: true`, so one `DeidContext` registry is shared across subpaths — mixing
  `createDeidContext` with a per-format `deidentify*` no longer throws a fail-closed `DEID_NO_KEY`); and
  two date-shift fixes (timezone-independent ISO-datetime shifting; `maxShiftDays: 0` now fails closed
  with `DEID_CONTEXT_INVALID`). **Third-party runtime deps: zero (`node:crypto` only).**
- **The repo is already PUBLIC; the package is still unpublished.** Those two are independent here and
  neither implies the other, so do not infer one from the other. `gh api repos/cosyte/deid --jq .visibility`
  reports `public` (checked 2026-07-28), so the flip described above as a pending gate has happened, and
  the "pre `PUB-FLIP`" note on the vendored tarballs is stale as a reason even though the vendoring is
  still real. `npm publish` remains the one standing gate: the registry returns 404 for
  `@cosyte/deid`. **No rejection of this package's own name is recorded anywhere, and no publish
  attempt is recorded either** (`version` is still `0.0.0`, there are no tags, and `CHANGELOG.md` has
  no released section) - note that a failed publish and a never-attempted one both leave a bare 404,
  so the registry cannot tell you which. The hold is a sequencing decision: it waits on the
  name-similarity rejection npm returned for `@cosyte/fhir`, which this package lists as an
  **optional** peer dependency, so nothing mechanically stops a publish. That rejection is specific
  to that one name, not to the `@cosyte` scope, which carries other published packages.
  No version is quoted in this file on purpose; `npm view @cosyte/deid version` is the authority.

## Tech Stack (the shared `@cosyte/*` standard)

This repo inherits the canonical toolchain by depending on the published `@cosyte/*` config packages,
not by copying files. The source of truth is the meta-repo's `documentation/conventions.md` — this is
a summary.

- **Language:** TypeScript (strict, full rigor set incl. `noUncheckedIndexedAccess`) via
  `@cosyte/tsconfig`. **Target ES2023**, `NodeNext`. TypeScript 5.9.x, exact-pinned.
- **Build:** dual ESM + CJS + `.d.ts` via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate
  (per-condition types: `.d.ts` for `import`, `.d.cts` for `require`). The `attw` script is
  **`node scripts/attw.mjs --profile node16`, not the bare CLI** — see the guardrail below.
- **Node:** **>= 22** (CI matrix 22 + 24).
- **Package manager:** `pnpm@10`.
- **Lint/format:** **ESLint 10** + unified `typescript-eslint` (type-checked) via
  `@cosyte/eslint-config`; Prettier via `@cosyte/prettier-config`. Lint at `--max-warnings=0`.
- **Testing:** **Vitest 4** + v8 coverage (`@cosyte/vitest-config`), per-directory >= 90 gates; the
  property-based conformance invariants come from `@cosyte/test-utils` (round-trip, lenient-mode,
  immutability, warning-code stability) — the format-specific arbitraries stay in this repo.
- **CI/CD:** thin callers of the reusable `cosyte/.github` workflows.
- **Runtime deps:** **Zero.** Node stdlib only.
- **License:** MIT.

### Branch protection and Dependabot

- **`main` is protected by a repository ruleset, `ci-required-checks`.** It requires
  `ci / verify (22, ubuntu-latest)`, `ci / verify (24, ubuntu-latest)`, `ci / actionlint`,
  `codeql / analyze (javascript-typescript)`, `smoke (22)`, `smoke (24)` and `no-internal-refs`, each
  pinned to the GitHub Actions app so a commit status of the same name posted by another actor cannot satisfy it, and it
  blocks branch deletion and force-push. Before this existed, `main` had **no rules at all**: every
  check in this repo was advisory, on the branch that publishes a de-identification package.
- **A required context that a branch cannot emit leaves that PR pending, not failing.** Adding the two
  `smoke` contexts therefore blocks any PR whose branch predates `.github/workflows/smoke.yml` until it
  is rebased onto a `main` that has the file. **`no-internal-refs` did exactly the same thing when it
  was added, and for the same reason** (any branch predating `.github/workflows/no-internal-refs.yml`
  cannot emit it). That is the expected cost of requiring a new context, not a fault; rebase the branch.
  Expect it EVERY time a context is added here. It has now happened **twice**: the two `smoke`
  contexts, and `no-internal-refs`. It did NOT happen when the ruleset was created, because the four
  contexts it required then were already being emitted by workflows that shipped with the scaffold.
- **`scorecard` is deliberately NOT required.** It runs only on `push` to `main` and on a schedule,
  never on `pull_request`, so requiring it would leave every PR pending forever. The `CodeQL` check
  posted by the GitHub Advanced Security app is also not required: it reports alert state, not
  whether the analysis job ran, which is what `codeql / analyze` already gates.
- **Read `.github/workflows/ci.yml`'s job-name banner before renaming a job or splitting a step out
  of `verify`.** A required job gates all of its steps, so promoting a step to its own job silently
  un-requires it, and a renamed job leaves PRs pending rather than failing. The PHI scan is a step of
  `verify`, so it is required only for as long as it stays one. **The leak/over-scrub corpus is not
  protected by that rule at all**: it is `test/corpus/`, selected by the `include` glob in
  `vitest.config.ts` and run inside the `test` / `test:coverage` steps, so narrowing the glob, moving
  the files, or `.skip`-ing the suite drops this repo's headline leak gate with no workflow change and
  nothing for the ruleset to notice. A ruleset binds a context; it cannot tell you the context still
  means what it meant. **The SELECTION half of that is now gated by `pnpm check:test-selection`
  (below); the `.skip` half is not, and neither is anything else about whether a selected suite
  asserts something.**
- **`pnpm smoke` is a real CI gate now, and was not one for as long as it was documented as one.**
  `.github/workflows/smoke.yml` runs `pnpm build` then `pnpm smoke` on `pull_request`, on the same
  Node 22 + 24 matrix as `verify`, and the ruleset requires both of its contexts. Do not treat the
  shared pipeline's `Dual ESM/CJS smoke` step as the same check: it stats and loads the ROOT entry
  only, so it is blind to a broken subpath, a missing headline export, a regressed shared-core chunk
  and an HL7 leak through the built artifact, all of which `pnpm smoke` covers. That last one is
  scoped to HL7 and no further: the cross-format zero-leak gate is `test/corpus/` from source.
  **And the smoke's scope is derived, not listed:** it reads the subpaths out of `package.json`'s
  `exports`, excludes only entries that are structurally data (a bare `.json` target) rather than any
  hand-maintained key list, and refuses to run if its headline-export map disagrees with the rest. A
  published subpath therefore cannot leave the check while the check still reports green. That derivation is the
  gate, as much as the workflow is; replacing it with a hand-written array reopens exactly the hole
  the bullet above describes for `test/corpus/`.
- **`pnpm check:no-internal-refs` is the third repo-owned gate, and it runs in its own workflow.**
  `.github/workflows/no-internal-refs.yml` runs `scripts/check-no-internal-refs.sh` on
  `pull_request`, with **no matrix** (the script is bash + grep + awk with a pinned `LC_ALL`; nothing
  in it moves between Node majors), so its check-run context is the bare job id **`no-internal-refs`**.
  Read the real name off a live check run before requiring it, never off the workflow's `name:`.
  It scans `README.md`, `LICENSE`, `docs-content/`, the npm `description` + `keywords`, `src/` doc
  comments and `src/` string literals. It deliberately does **not** scan `CHANGELOG.md`,
  `.changeset/`, this file, or `//` comments, because the convention names those as where identifiers
  belong. It cannot read `dist/` either: `dist/` is untracked build output, so this is a gate on the
  **source** of the published text, not on the published text.
- **`pnpm check:test-selection` is the fourth repo-owned gate: it gates what the required test job
  SELECTS, not just that it ran.** `.github/workflows/test-selection.yml` runs
  `scripts/check-test-selection.ts` on `pull_request`, no matrix, so its check-run context is the
  bare job id **`test-selection`**. **That context is deliberately NOT in the ruleset yet.** A
  required context no workflow on `main` has emitted leaves every PR pending and unmergeable, which
  has already happened here twice; let this run on `main` first, then require it as its own change.
  - **What it watches, and what it does not.** Its subject is three sets: every tracked module
    outside `src/` that **imports one of the seven published `exports` subpaths**
    (`test/corpus/leak-corpus.test.ts` among them), every module under `test/` referencing
    `scripts/phi-scan`, and the `.test.`/`.spec.` filename shape. The first two are
    name-independent — a module in them survives a rename, a move to another directory and a
    symlinked path — and they reach every test file but **TWO**: `test/docs-content.test.ts` and
    `test/scripts/attw-gate.test.ts`, neither of which imports this package, rest on the filename
    shape alone. **The tallies that used to be written here are gone deliberately**: they were
    already stale by one before the second of those two files existed, and the OK line of
    `pnpm check:test-selection` prints the live figures on every run — including how many modules
    under `test/` no rule watches (all genuine helpers today).
  - **The subject is DERIVED from `exports`, not listed here, and that choice is the gate.** `ncpdp`
    derives its equivalent from a workflow that hands a path to `vitest run`; **no workflow here does
    that**, so that derivation has no grounding in this repo. The corpus is named today only by prose
    in `ci.yml`, `smoke.yml` and this file, and deriving from prose would make a docs edit the drop
    route. `exports` cannot be quietly narrowed: npm resolves it, `attw` checks it, and
    `scripts/smoke.mjs` already derives its own scope from it. **Replace either derivation with a
    hand-written array and both gates go back to reporting green over whatever subset someone last
    remembered.**
  - **The cost is paid in the repo, not in an exemption list.** There is no exemption for helpers,
    because every exemption `ncpdp` offered was walked through by a rename. So a module that is not a
    test may not import a published entry point: `test/helpers/run-date-shift.ts`, the child-process
    timezone probe, imports `src/context.ts` and `src/transforms/date-shift.ts` directly. Same
    function objects; do not "tidy" it back to the root entry.
  - **Measured limits, none of them claimed closed.** A config that can tell **which run it is in**
    serves this gate a wide selection and CI a narrow one: branching on `process.argv` leaves **29 of
    33 suites not running** with the gate green, and because this check lives in its own workflow,
    branching on `GITHUB_JOB` does the same (6 of 33 left running). A **specifier rewritten into a
    form the gate does not resolve** leaves its subject: a substituted template literal, a `?query`
    suffix and a `resolve.alias` plus a bare specifier were each measured green here and each red on
    `pnpm typecheck` or `pnpm lint`, so they are caught by a different gate, not this one. `.skip`
    inside a selected file is invisible (selection is not execution). Deleting the corpus outright is
    green, because six per-format suites still import those entry points; a move that breaks a
    module's own relative imports is that same delete case (moving the corpus to `scripts/` is green,
    the same move with its imports repaired is red).
  - **A refuter closed two of these rather than documenting them, and that is the precedent to
    follow.** A **backtick** dynamic import and a **tracked symlink** to `src/` each took the corpus
    out of the subject with every other gate green. Both are now closed, and **self-test D** exists
    because the other three self-tests could not see them: A and C take the derived subject as given.
    Do not remove D to "simplify"; without it, gutting the PHI-enablement rule to `return true`
    reports OK while claiming its self-tests reddened.
  - **▶ BUT D COVERS THREE NAMED DERIVATIONS, NOT "the derivations", AND THE DIFFERENCE IS THE ONE
    THING TO READ BEFORE REFACTORING THIS GATE.** It seeds the PHI-enablement rule, the specifier
    extractor, and the **count** of exported subpaths. It does **not** check that each subpath maps
    to its **own** source, and it does **not** cover `resolveSpecifier`. Both gaps are measured:
    pointing every entry at `src/dicom/index.ts` keeps the count at 7, collapses the subject from 31
    modules to **3**, and the gate prints OK saying all four self-tests reddened; a two-line
    `if (fromFile.startsWith("test/corpus/")) return [];` inside `resolveSpecifier` re-adds exactly
    the hand-editable exclusion design rule 1 forbids, with every self-test green. **A refuter
    demanded the sentence be corrected rather than a self-test E added** (a derivation has no closed
    set of spellings, so each new self-test buys one more), which means: **a diff touching
    `exportedSourceEntries` or `resolveSpecifier` is reviewed by a person, and the OK line's counts
    are what a reviewer compares it against.**
- **▶ THE RULESET BLOCKS THE "Version Packages" PR, AND THAT IS EXPECTED. IT NEEDS ONE PUSH.**
  Changesets opens the release PR as `github-actions[bot]` using the default `GITHUB_TOKEN`, and
  GitHub does not start workflow runs for events raised by that token. So the version PR gets **zero
  check runs**, not failing ones, and required contexts that never arrive leave it `BLOCKED`
  forever. `bypass_actors` is empty on purpose, so **not even a repo admin can merge past it.** The
  fix is one commit onto `changeset-release/main`, which fires `pull_request: synchronize` under a
  real user and produces every one of them (count them off `gh api
repos/cosyte/deid/rulesets/19907854`, not off this file):

  ```bash
  gh pr checkout <n> -R cosyte/deid   # the "Version Packages" PR
  git commit --allow-empty -m "chore: run CI on the version PR"
  git push
  ```

  Do the push **last**, immediately before merging: if another changeset lands on `main` first, the
  release workflow re-runs and the bot moves the branch head again, dropping the PR back to zero
  checks. That is not the escape failing; repeat it. A bypass actor would clear it too and was
  rejected, because it would mean a human could merge a **red** PR on this package, which is what the
  ruleset exists to prevent.

- **Unproven, and stated as unproven: pull requests from FORKS.** This is a public repo with no
  external contributors yet, so no fork PR has ever run here. Two things are expected to differ and
  neither has been observed: a first-time contributor's workflows do not run until a maintainer
  approves them, which looks identical to the version-PR trap above (zero checks, `BLOCKED`); and
  `codeql / analyze` needs `security-events: write`, which a fork's `GITHUB_TOKEN` cannot be granted,
  so that fourth context may fail or not report.
- **Nothing in this repository can observe its own ruleset.** It lives on GitHub, not in these files.
  Delete it and every test here still passes, `pnpm test:coverage` still gates, the PHI scan still
  runs, and these lines still claim protection that is gone. **Do not take this section as
  evidence.** Verify with `gh api repos/cosyte/deid/rules/branches/main`, which reports what is
  actually in force.
- **`.github/dependabot.yml`** watches `npm` (the single root `package.json` + `pnpm-lock.yaml`) and
  `github-actions`. It **cannot** see the six sibling parsers: they are optional peer deps installed
  from `pnpm pack` tarballs committed under `vendor/` via `file:` specifiers, which Dependabot does
  not bump. `@cosyte/deid/dicom` delegates its pass to `@cosyte/dicom`, so that vendored tarball is
  the version the DICOM tests actually exercise, so re-pack it by hand when the upstream pass changes.
  `package.json` also carries `pnpm.overrides`, which Dependabot does not manage; when a bump makes
  one redundant, remove the override by hand.
- **What the Dependabot config does NOT buy, since the file is easy to over-read.** It configures
  **version** updates on a weekly schedule. Automatic **security** update PRs are a separate repo
  setting: alerts are on for this repo, but `security_and_analysis.dependabot_security_updates`
  reported `disabled` when this was written, so an advisory raises an alert and does not open a fix PR
  by itself. That setting is not in these files either. Check it with
  `gh api repos/cosyte/deid --jq .security_and_analysis`, not by reading this line.
- **Unobserved, and stated as unobserved: whether Dependabot's pnpm updater tolerates this manifest.**
  Six `devDependencies` here are `file:` tarballs under `vendor/`, which is unusual in this org. No
  real Dependabot run has been seen against it, so it is not known whether it skips those entries
  cleanly or errors the whole `npm` job. **Do not read "no open Dependabot PR" as "nothing is
  stale"** until one weekly run has actually been observed; that inference is the exact mistake the
  missing config caused in the first place.

## Engineering Guardrails

- No `any`. No unjustified `as` casts. Use `unknown` and narrow.
- JSDoc (with `@example`) on every public export — the JSDoc lint rule is an **error** on public
  exports, so this is enforced, not optional.
- Immutable by default. Mutation only via explicit methods.
- No `console.*` in library code. Throw typed errors or return results.
- Short, testable functions over big parsing blobs.
- **Inverted Postel's Law: fail CLOSED.** Unlike a parser, the de-id reflex is conservative — an
  unrecognized structure / un-locatable identifier / uncertain field is **blocked or removed**, never
  passed through as safe. Clinical values are the mirror guard: retained untouched (no over-scrub).
- Fatal errors only for the sanctioned fatal set (`EMPTY_INPUT`, `DEID_NO_KEY`). A keyed transform
  **never** silently falls back to unkeyed. Everything else is a value-free manifest disposition with a
  stable `DEID_*` code + locus (never a value, never the key, never the date-shift offset).
- Coverage: per-directory >= 90% (lines/branches/functions/statements), enforced by
  `pnpm test:coverage`.
- **▶ `attw` SAYS "does not contain types" AND EXITS 0, SO THE `attw` SCRIPT IS A WRAPPER, NOT THE
  BARE CLI.** `getExitCode.js` in `@arethetypeswrong/cli` opens with `if (!analysis.types) return 0`
  — an untyped package is a legitimate npm package, so "no types at all" is a description, not a
  problem, and the problem list is never consulted. No `--profile`, `--ignore-rules` or config
  setting reaches that early return. For a package that ships types it means the declarations were
  **not in the tarball**, which is a broken publish reported as a pass. A false red costs an hour; a
  false green merges.
  **Concurrency only supplies the condition; the trigger is the build order.** `tsup` emits JS in one
  pass and declarations in a later one, so every build has a window where `dist/` holds `.mjs`/`.cjs`
  and no declarations — measured here from `dist/index.mjs` to `dist/index.d.ts` at 6.9 s and 10.0 s
  on two builds. **Do not read those as a constant**: this box runs under a hard 2.0-CPU quota and the
  figure moves with load. So the answer is **not** a lock, a lease or a build queue: the gate must be
  able to say its own inputs were missing, whatever removed them.
  **What is measured on THIS package, with the real `--profile node16` invocation, and where it
  differs from the single-entry siblings** (no version is quoted, because a quoted one drifts): no
  `dist` at all, and `dist` built with every
  declaration deleted, both print the sentence and exit 0. But deleting only the **entry**
  declarations exits **1** — `tsup` emits shared declaration chunks this manifest never names, so a
  PARTIAL loss still leaves `analysis.types` true and `attw` does its job. It is TOTAL loss that is
  silent, and total loss is the shape of the build window. Deleting only `dist/index.mjs` and
  `dist/index.cjs` still reports every node16 resolution 🟢 and exits 0 — a missing JS entry point is
  invisible to a tool that analyses types. **Do not carry a sibling's sentence about this over
  without re-running it here**, and specifically **do not write "No problems found" into that last
  row**: that is what a single-entry FIXTURE prints, a draft of this entry generalized it to the
  package, and it is false here — `render/typed.js` emits it only on an empty problem list, and this
  package always carries ignored node10 `NoResolution` problems, so it is absent even from a
  PRISTINE run. Measured both ways.
  `scripts/attw.mjs` carries **two nets that catch different things** — a preflight that every
  relative path `package.json` promises (`main`, `module`, `types`, `typings`, every string leaf of
  `exports`) exists and is non-empty, which catches the window, reaches the missing-JS case, and
  _names the files_; and a post-check on the untyped sentence, which catches what the preflight
  structurally cannot — declarations on disk but excluded from the tarball by `files`/`.npmignore`.
  No instance of that second case is on record here. **The post-check reads a string, so what would
  hide that string is refused, not tolerated**: `--quiet`, `--format json` and a `.attw.json` setting
  either were each measured against this repo's own binary to hand back exit 0 with the sentence
  unreadable; `--config-path` is refused **by inference, not measurement**. The refusal is by option
  name and never by value, and "by name" means **two matched shapes**: an argv token (before any
  `=`), **and a combined short-option cluster containing `q` or `f`** — commander reads `-Pf json` as
  `--pack --format json`, so `-f` is never a token, and a whole-token-only draft of this guard let
  that spelling walk back to **exit 0 over an untyped pack**. Both shapes are pinned. **That is a
  claim about two shapes, not a claim that no spelling remains**; the empty-transcript net is there
  for the one nobody enumerated, and if another turns up the honest answer may be to correct this
  paragraph rather than grow the guard a second time.
  `test/scripts/attw-gate.test.ts` pins both nets against the real binary, including the upstream
  exit-0 itself, a negative control on a well-formed package, and that a real `attw` failure still
  fails. It also pins **`--profile node16` end to end** on a fixture shaped like this package
  (subpath exports into a directory) that exits 1 without the flag and 0 with it, plus the manifest
  line that sends it — a port that wired up the wrapper and dropped the flag would otherwise be green.
  **This is a per-repo script.** Landing it here fixes this repo only; check the siblings before
  claiming the class is closed.

## Standing disciplines (every change)

Mirrors the three disciplines in the meta-repo's `documentation/conventions.md` — they bind here too:

1. **Documentation follows code** — a change to the public surface/stack/status isn't done until the
   docs are: this repo's docs content (`README.md`, `docs-content/`), the meta-repo
   `documentation/repos/deid.md` (bump its "last verified" date), and the `ecosystem-map.md`
   status table.
2. **Version + changelog** — a Changeset (`patch` on the `0.0.x` ladder) + a `CHANGELOG.md`
   `[Unreleased]` entry per meaningful change. Renaming a stable warning code is a **breaking change**.
3. **Crew + knowledgebase loop** — if this parser's public API or warning codes change, flag/update
   the matching `crew` healthcare skill + the KB product doc.
4. **No internal project bookkeeping on a public surface** (founder directive, 2026-07-27). What a
   consumer reads (`README.md`, `docs-content/`, the npm `description`, a release body, and the
   JSDoc that compiles into `dist/**/*.d.ts` and renders on hover) says what the software does and
   what changed. Item identifiers (`DEID-8`), phase and roadmap-section language (`roadmap §4.6`,
   `Phase 10`), ADR numbers, meta-repo paths and "how this got built" commentary belong in the
   changeset, `CHANGELOG.md`, the commit, the PR and the roadmap. Gated by
   `pnpm check:no-internal-refs` and `.github/workflows/no-internal-refs.yml`.

   **The gate keys on known project prefixes, never the `WORD-N` shape, and in THIS repo that is not
   a stylistic choice.** `deid` consumes all six parsers, so it documents the loci of all six
   standards on one page: `PID-3`, `OBX-5`, `PID-19`, `CX-5`, `NM1-03`, `REF-01`, `DTP-03`, `CLP-01`,
   `N4-06`, plus `ICD-10-CM`, `US-SSN`, `HMAC-SHA` and `YYYY-MM-DD`. Those are the coordinates a
   consumer needs in order to audit what was and was not transformed. A shape rule deletes them.
   Never re-key it on `WORD-N`, and never resync the prefix list with a sibling copy without
   re-reading why `SYNTH` is present here and absent in `ncpdp`'s.

   **The `§` non-catch is a decision, pinned by a self-test.** Bare `(§4.6)` roadmap-section
   citations are NOT caught by any rule, and 19 of them were cleared by hand. A bare-`§` rule was
   refused because `§` in this package is overwhelmingly `§164.514`, the regulation the library
   implements and the thing a consumer most needs to look up. `BARE_SECTION_SAMPLE` in the script
   asserts that no rule matches it, so closing that gap has to be deliberate.

   **The gate catches identifiers, not English about our process, and the residual is large here.**
   `phase` at the end of a clause ("arrive in later phases.") is deliberately uncaught, because
   determiner-plus-`phase` collides with ordinary clinical English. That shape was **all 18** of the
   public-markdown instances this sweep removed, which is why the markdown measured **0 by rule**
   while still saying "no format is wired yet" on a page published to docs.cosyte.com. **A count is
   a function of the rule set: quote the rule set with the count, or the count means nothing.**

   **CUT, do not rewrite.** Stripping a citation is a deletion; the temptation to improve the
   sentence around it is how a hygiene sweep ships a new falsehood. In THIS package that risk is a
   safety one: every claim here is deliberately scoped ("Safe-Harbor-transformed per the configured
   policy", never "de-identified"; a BYO redactor is consumer-asserted, never re-verified; the DICOM
   pass is metadata-only with burned-in pixels flagged, not cleaned; the release smoke's leak sweep
   is **HL7-only**). Two sentences in this sweep would have become guarantees the code does not
   provide if the roadmap pointer had simply been cut: provider identity being suppressible by a
   widening policy in X12 (it is not; the retention is structural, in the extractor) and a different
   Census vintage being supplied via a policy (it is not; `RESTRICTED_ZIP3` is a fixed export and
   `DeidPolicy` carries only `name` + `transforms`). Both were restated as limitations instead.

   **THE RELEASE BODY IS THE ONE PUBLIC SURFACE THIS REPO CANNOT GATE, AND `.changeset/` IS ITS
   SOURCE.** `pnpm check:no-internal-refs` deliberately does not scan `.changeset/`, and it could not
   help here anyway: the release body is rendered by `cosyte/.github`'s `scripts/release-notes.mjs`
   from the FIRST SENTENCE of each changeset a version consumes. So a changeset's opening sentence is
   published text written in a file the local gate treats as private. Two consequences, both measured
   on the 13 pending changesets on 2026-07-28 with that renderer's own `collectHeadlines`:
   - **An internal-only change is DROPPED from the body by word, not reworded.** `INTERNAL_ONLY_CHANGE`
     recognises the category from words like `Dependabot`, `CodeQL`, `actionlint`, `no runtime impact`.
     A changeset that states exactly those facts in none of those words is KEPT and published, which is
     what `deid-ci-required-checks.md` and `deid-smoke-ci-gate.md` both did. The fix is to reword the
     changeset so the renderer drops it. **Never widen the word list in `cosyte/.github` to cover a
     changeset here** — that grows a shared gate to fit one repo's prose.
   - **The renderer strips phase language from the first sentence and cannot check the result reads.**
     It refuses several _shapes_ a bad cut leaves in the bytes (a tail ending in a function word, a
     single-letter stump, doubled or orphaned clause punctuation, an emptied parenthetical, a headline
     over 200 characters, an unsafe mid-clause cut), because a gate reads bytes and not grammar. A
     translated sentence that is well-formed but wrong passes all of them.
     `deid-10-release-hardening.md` opened with the item identifier, a parenthesised roadmap phase,
     and the trailing clause "the final roadmap phase". The phase-strip rendered the public bullet
     `Release hardening, the final` — no rule catches it, because `final` is not a function word.
     Open every changeset with a sentence that stands on its own once the identifier is gone.

   **STATED AS A LIMIT, NOT CHASED: this fix depends on another repo's word list holding.** Both
   entries are dropped only because `INTERNAL_ONLY_CHANGE` in `cosyte/.github` still carries the words
   they use. Nothing in this repository observes that list, and nothing here fails when it changes:
   that is this repo's "gate that cannot observe its subject", moved one repo over, and it is not
   fixable from here.

   The mitigation taken is redundancy, not coverage, and its exact strength was measured leave-one-out
   over all 25 alternatives on 2026-07-28: `deid-ci-required-checks.md` matches **four** (`CodeQL`,
   `actionlint`, `Dependabot`, `no runtime impact`) and `deid-smoke-ci-gate.md` matches **three**
   (`CodeQL`, `actionlint`, `no runtime impact`). **Removing any single alternative republishes
   neither** — dropping `\bCodeQL\b` alone leaves both dropped. What would republish them is losing
   _all_ of the words one entry uses, and the residual risk is that they are all CI vocabulary, so a
   single cleanup of that regex could plausibly remove them together. Do not read this paragraph as
   the measurement; re-run it against the renderer, which is the only thing that can answer:

   ```js
   // node probe.mjs, with <meta> the checkout that holds the .github submodule
   import { readFileSync, readdirSync } from "node:fs";
   import { collectHeadlines } from "<meta>/.github/scripts/release-notes.mjs";
   const d = ".changeset";
   const files = readdirSync(d)
     .filter((f) => f.endsWith(".md") && f !== "README.md")
     .map((f) => ({ id: f, text: readFileSync(`${d}/${f}`, "utf8") }));
   const r = collectHeadlines(files, "@cosyte/deid");
   console.log(
     r.kept.length,
     r.dropped.map((x) => x.id),
   );
   ```

   **And do not let a headline drift toward the 200-character hard refusal.** `collectHeadlines`
   REFUSES (it does not trim) a translated headline over 200, and it does so on the version commit,
   after the Version PR has merged, costing the documented revert-and-re-version recovery. Measured
   2026-07-28: `deid-public-surface-hygiene.md` is at **182** and `deid-1-format-agnostic-core.md` at
   **175**. One more clause in either opening sentence trips it.
