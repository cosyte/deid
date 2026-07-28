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
  (per-condition types: `.d.ts` for `import`, `.d.cts` for `require`).
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
  `codeql / analyze (javascript-typescript)`, `smoke (22)` and `smoke (24)`, each pinned to the GitHub
  Actions app so a commit status of the same name posted by another actor cannot satisfy it, and it
  blocks branch deletion and force-push. Before this existed, `main` had **no rules at all**: every
  check in this repo was advisory, on the branch that publishes a de-identification package.
- **A required context that a branch cannot emit leaves that PR pending, not failing.** Adding the two
  `smoke` contexts therefore blocks any PR whose branch predates `.github/workflows/smoke.yml` until it
  is rebased onto a `main` that has the file. That is the expected cost of requiring a new context, not
  a fault; rebase the branch.
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
  means what it meant.
- **`pnpm smoke` is a real CI gate now, and was not one for as long as it was documented as one.**
  `.github/workflows/smoke.yml` runs `pnpm build` then `pnpm smoke` on `pull_request`, on the same
  Node 22 + 24 matrix as `verify`, and the ruleset requires both of its contexts. Do not treat the
  shared pipeline's `Dual ESM/CJS smoke` step as the same check: it stats and loads the ROOT entry
  only, so it is blind to a broken subpath, a missing headline export, a regressed shared-core chunk
  and a leak, all of which `pnpm smoke` covers. **And the smoke's scope is derived, not listed:** it
  reads the subpaths out of `package.json`'s `exports` and refuses to run if its headline-export map
  disagrees with them, so the check cannot be narrowed under a green result. That derivation is the
  gate, as much as the workflow is; replacing it with a hand-written array reopens exactly the hole
  the bullet above describes for `test/corpus/`.
- **▶ THE RULESET BLOCKS THE "Version Packages" PR, AND THAT IS EXPECTED. IT NEEDS ONE PUSH.**
  Changesets opens the release PR as `github-actions[bot]` using the default `GITHUB_TOKEN`, and
  GitHub does not start workflow runs for events raised by that token. So the version PR gets **zero
  check runs**, not failing ones, and four required contexts that never arrive leave it `BLOCKED`
  forever. `bypass_actors` is empty on purpose, so **not even a repo admin can merge past it.** The
  fix is one commit onto `changeset-release/main`, which fires `pull_request: synchronize` under a
  real user and produces all four checks:

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
