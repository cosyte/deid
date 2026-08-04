# @cosyte/deid — Project Guide for Claude

> **▶ THE NARRATIVE BEHIND EVERY TRAP BELOW IS IN `documentation/agent-notes.md`** — relocated there
> **verbatim** on 2026-08-04, nothing deleted. Each line here is the imperative; the anchor after it is
> the case that earned it (the measurement, the sha, the negative control). **Read the section before
> you touch the thing it guards.** This file is always-read for every worker that `cd`s in, so it is
> budgeted at write time by the umbrella's `.claude/hooks/doc-budget.mjs` (ADR 0023, amended
> 2026-08-04); the notes are read on demand. **The number lives in that hook, not here** — the ADR
> states the policy, the hook states the byte figure, and the hook is what refuses the write. **The
> remedy for size is always relocation, never deleting a trap.**

## Project

**`@cosyte/deid`** — a developer-focused healthcare **de-identification** library for Node.js/TypeScript,
published under the Cosyte brand. Open-source (MIT). It is a **consumer** of the `@cosyte/*` parsers,
**not a parser sibling**: it borrows the archetype's disciplines (typed diagnostics, immutable output,
the policy/profile system) but **inverts the reflex** — a parser is liberal on input (Postel's Law); a
de-identifier is conservative and **fails closed**.

**North star:** a developer holds a parsed healthcare document full of PHI and calls
`deidentify(model, { policy: "safe-harbor" })`, getting back a Safe-Harbor-transformed model plus a
**value-free manifest**. The governing honesty line: output is **"Safe-Harbor-transformed per the
configured policy,"** never "de-identified" / "HIPAA-compliant"; Expert Determination is **supported,
never rendered**. Full statement: `documentation/agent-notes.md#project`.

## Status

- **DEID-1…DEID-10 shipped; the roadmap is complete.** Pre-alpha on the `0.0.x` ladder. Format-agnostic
  core plus **all six adapters** (`hl7`, `ccda`, `fhir`, `x12`, `ncpdp`, `dicom`), the longitudinal
  registry, the BYO free-text interface, the Expert-Determination _support_ report, and DEID-10 release
  hardening (profiles, leak/over-scrub corpus, `pnpm smoke`, the tsup shared-core chunk fix).
  **Third-party runtime deps: zero (`node:crypto` only).** What each phase shipped, and the scoped
  claims that go with it: `documentation/agent-notes.md#shipped-phases-deid-1-through-deid-10`.
- **NCPDP SCRIPT remains deferred** — lossy serialize + address-less `Patient` block a faithful
  structural de-id through the current parser surface.
- **The DICOM adapter DELEGATES to `@cosyte/dicom`'s PS3.15 Annex E pass: metadata-only, burned-in
  pixels FLAGGED not cleaned.** Never describe it as cleaning pixels.
- **▶ THE OTHER SCOPED SAFETY CLAIMS, EACH OF WHICH BECOMES A FALSE GUARANTEE IF YOU BROADEN IT.** The
  free-text interface is **block-by-default**, and a consumer redactor is **consumer-asserted, never
  re-verified**. `defineDeidProfile` is fail-closed under a **widen-never-narrow** contract. The
  `DEID_POLICY_INVALID` label guard exists so **date-shift may not wear the `safe-harbor` label**. The
  registry key is consumer-supplied, fail-closed on `DEID_NO_KEY`, and **rotation is intentional linkage
  breakage**. → `documentation/agent-notes.md#shipped-phases-deid-1-through-deid-10`
- **Publish state and repo visibility are INDEPENDENT — check each, never infer one from the other, and
  NEVER QUOTE A VERSION IN THIS FILE.** `npm view @cosyte/deid version`, `git tag` and
  `gh api repos/cosyte/deid --jq .visibility` are the only authorities. **⚠ TWO DATED CLAIMS ARE IN
  PLAY AND NEITHER IS A STANDING FACT:** the publish-state paragraph this file used to carry (itself a
  _correction_ of an earlier "not yet published" claim, preserved at
  `documentation/agent-notes.md#publish-state-and-visibility`), and the umbrella backlog entry
  `CHANGELOG-PREAMBLE-FUTURE-TENSE`, which still names this file alongside `hl7`, `mllp` and
  `transform` as saying "not yet published" — **that entry is out of date for `deid`.** Re-measure;
  restate neither as fact from here. `npm publish` is waived by standing founder directive;
  **flipping a repo public is not.**

## Tech Stack (the shared `@cosyte/*` standard)

Inherited by depending on the published `@cosyte/*` config packages, not by copying files. Source of
truth is the meta-repo's `documentation/conventions.md`; the full per-line detail is
`documentation/agent-notes.md#tech-stack-the-shared-cosyte-standard`.

- **Language:** TypeScript strict (full rigor set incl. `noUncheckedIndexedAccess`), **ES2023**,
  `NodeNext`, TS 5.9.x exact-pinned. **Node >= 22** (CI matrix 22 + 24). **pnpm@10.**
- **Build:** dual ESM + CJS + `.d.ts` via `tsup`. The `attw` script is
  **`node scripts/attw.mjs --profile node16`, not the bare CLI** — see the guardrail below.
- **Lint/format:** ESLint 10 + type-checked `typescript-eslint`, Prettier, `--max-warnings=0`.
- **Testing:** Vitest 4 + v8 coverage, per-directory >= 90 gates; invariants from `@cosyte/test-utils`.
- **CI/CD:** thin callers of the reusable `cosyte/.github` workflows. **Runtime deps: zero.** MIT.
- Each format's parser is an **optional peer dep** consumed only from its subpath, installed from
  `pnpm pack` tarballs committed under `vendor/`.

### Branch protection and Dependabot

- **`main` is protected by the repository ruleset `ci-required-checks`** (7 required contexts, each
  pinned to the GitHub Actions app; blocks deletion and force-push). Before it, `main` had **no rules at
  all**. → `documentation/agent-notes.md#the-ruleset-ci-required-checks`
- **A required context a branch cannot emit leaves that PR PENDING, not failing — rebase it.** Expect it
  EVERY time a context is added; it has happened twice.
  → `documentation/agent-notes.md#a-required-context-a-branch-cannot-emit-leaves-the-pr-pending`
- **Never require `scorecard`** (it never runs on `pull_request`), nor the GHAS `CodeQL` check.
  → `documentation/agent-notes.md#why-scorecard-is-not-required`
- **Read `ci.yml`'s job-name banner before renaming a job or splitting a step out of `verify`** — a
  required job gates its steps, so promoting one silently un-requires it. **The PHI scan is a STEP of
  `verify`, so it is required only for as long as it stays one.** **The leak/over-scrub corpus
  (`test/corpus/`, the cross-format zero-leak gate, proven non-vacuous) is protected by NO ruleset**: it
  is glob-selected in `vitest.config.ts`, so narrowing the glob, moving it or `.skip`-ing it drops this
  repo's headline leak gate with nothing to notice.
  → `documentation/agent-notes.md#job-names-and-what-a-ruleset-cannot-see`
- **`pnpm smoke` is a real gate; the shared pipeline's `Dual ESM/CJS smoke` step is NOT the same check**
  (root entry only). **Its scope is DERIVED from `package.json`'s `exports` — replacing that with a
  hand-written array reopens the hole above.** **Its leak sweep is HL7-ONLY** — the cross-format
  zero-leak gate is `test/corpus/`, from source. → `documentation/agent-notes.md#the-smoke-gate`
- **`pnpm check:no-internal-refs`** runs in its own workflow; context is the bare job id
  `no-internal-refs`. **Read a real context name off a live check run, never off a workflow's `name:`.**
  It gates the _source_ of published text, not `dist/`.
  → `documentation/agent-notes.md#the-no-internal-refs-gate`
- **`pnpm check:test-selection` gates what the required test job SELECTS.** Context `test-selection` is
  **deliberately NOT in the ruleset yet** — let it run on `main` first. **Its subject is DERIVED from
  `exports`; there is no exemption list, because every exemption a sibling offered was walked through by
  a rename. The cost is paid in the repo instead: A MODULE THAT IS NOT A TEST MAY NOT IMPORT A PUBLISHED
  ENTRY POINT.** So `test/helpers/run-date-shift.ts` imports `src/` directly on purpose — **do not
  "tidy" it back to the root entry.** **Self-test D covers THREE NAMED DERIVATIONS, not "the
  derivations": a diff touching `exportedSourceEntries` or `resolveSpecifier` is reviewed by a person
  against the OK line's counts. DO NOT REMOVE D TO "SIMPLIFY"** — the other three self-tests cannot see
  what it sees. Selection is not execution, and the measured limits are listed, none claimed closed.
  → `documentation/agent-notes.md#the-test-selection-gate`
- **The ruleset BLOCKS the "Version Packages" PR by design — it needs one push** (an empty commit onto
  `changeset-release/main`), done **last**, immediately before merging. `bypass_actors` is empty on
  purpose. → `documentation/agent-notes.md#the-version-packages-pr-is-blocked-by-design`
- **Unproven, and stated as unproven: PRs from FORKS.** No fork PR has ever run here.
  → `documentation/agent-notes.md#fork-pull-requests-are-unproven`
- **Nothing in this repository can observe its own ruleset — do NOT take this section as evidence.**
  Verify with `gh api repos/cosyte/deid/rules/branches/main`.
  → `documentation/agent-notes.md#nothing-here-can-observe-its-own-ruleset`
- **Dependabot cannot see the six vendored sibling parsers** (`file:` tarballs) or `pnpm.overrides` —
  re-pack the `@cosyte/dicom` tarball by hand when the upstream pass changes.
  → `documentation/agent-notes.md#what-dependabot-watches`
- **The config buys VERSION updates only; automatic SECURITY update PRs are a separate repo setting**
  that read `disabled`. Check `gh api repos/cosyte/deid --jq .security_and_analysis`, not this line.
  → `documentation/agent-notes.md#what-the-dependabot-config-does-not-buy`
- **Unobserved: whether Dependabot's pnpm updater tolerates this manifest. Do not read "no open
  Dependabot PR" as "nothing is stale".**
  → `documentation/agent-notes.md#whether-the-pnpm-updater-tolerates-this-manifest`

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

### The PHI commit gate (`scripts/phi-scan.ts`)

Every line here is clinical-safety content. Full cases: `documentation/agent-notes.md#the-phi-scan`.

- **The scan FOLLOWS NOTHING — a non-regular in-scope entry REFUSES the scan (exit 2). Never "fix" this
  by following the link.** Both enumerating routes read a symlink as **clean**; reproduced on
  `e040ffc`. The narrowing is **structural** on both routes; **the kind tokens are labels with a catch-all arm, never
  the decision — do not turn either into a list of shapes to match.**
  → `documentation/agent-notes.md#phi-scan-follows-nothing`
- **THE ONE-LETTER TRAP: `--diff-filter` MUST KEEP `T`.** Without it a tracked file replaced by a link
  staged green through `pre-commit`. → `documentation/agent-notes.md#the-one-letter-trap-t-in-the-diff-filter`
- **`R`/`C` are closed by `--no-renames`, not by the filter** — the enumeration is a superset and the
  record stride becomes structural. **The old "needs the two-path record shape, a scope decision"
  framing is WITHDRAWN as FALSE, not deferred.** → `documentation/agent-notes.md#closed-by-no-renames`
- **A REFUSAL NAMES THE ENTRY'S OWN REPO-RELATIVE PATH AND AN ENGINE-OWNED KIND TOKEN, NEVER THE LINK
  TARGET** — working-tree text that can itself carry PHI. **A diagnostic about a PHI leak is itself a
  PHI surface, and so is the prose explaining it**: no example target path goes in the docblock, the
  CHANGELOG or the changeset. → `documentation/agent-notes.md#closed-by-no-renames`
- **Two things NOT covered, both measured:** explicit-path mode still reads through a link; a file that
  vanishes between enumeration and read fails **closed** (exit 2) — a false-red risk, not a false-green
  one. The siblings' TOCTOU machinery was deliberately not ported.
  → `documentation/agent-notes.md#closed-by-no-renames`
- **THE SCAN ROOTS ARE `src/`, `test/` (ALL of it) AND `scripts/` — A DIFFERENT DECISION FROM EVERY
  SIBLING'S. DO NOT PORT ONE OVER IT.** The old scopes missed **38 tracked files**, four already
  carrying inline HL7 `PID|…` literals. → `documentation/agent-notes.md#the-scan-roots`
- **ENUMERATING THE FILES BUYS THE SSN/EMAIL FLOOR AND NOTHING ELSE — a detector has to RECOGNISE the
  document first, and every recogniser was written for a file that _is_ the document.** This repo's
  fixtures are `.ts` string literals, so each file is also scanned as its **decoded, joined literals**;
  four recognisers widened with it (X12's offset-0 `ISA`, a bare `PID|…`, an indented segment, HL7's
  doubled backslash). → `documentation/agent-notes.md#enumerating-the-files-buys-the-floor-only`
- **WIDENING A RECOGNISER IS TWO-SIDED. EVERY MECHANISM IS "IN ADDITION TO", NEVER "INSTEAD OF" — DO NOT
  SIMPLIFY ONE AWAY.** A per-line split silently took a hard-wrapped `NM1*IL` from three patient
  identifiers to zero. Each piece is read per line **and** rejoined; indentation is stripped in the
  literal view only. **Each of the four mechanisms has a case that goes RED when it is removed —
  verified by removing each one, not by reading the code.**
  → `documentation/agent-notes.md#widening-a-recogniser-is-two-sided`
- **▶ THE EVIDENCE STANDARD FOR THIS REPO: PROVE EVERY WIDENING WITH A CASE THAT IS RED BEFORE AND GREEN
  AFTER. A recogniser that quietly matches nothing reports "no hits."** This is how a redaction widening
  is accepted here — a claim without a red-before case is not evidence.
  → `documentation/agent-notes.md#widening-a-recogniser-is-two-sided` (the per-mechanism form) and
  `documentation/agent-notes.md#what-is-not-claimed-to-be-reached` (the sentence itself)
- **None of that claims arbitrary embedded text is reached**; the banner in `scripts/phi-scan.ts`
  enumerates what is not. → `documentation/agent-notes.md#what-is-not-claimed-to-be-reached`
- **A comment in `scripts/phi-scan.ts` is INSIDE a scan root** — an escaped example decodes into a
  segment the detector reads as a fixture. It did, on the first draft.
  → `documentation/agent-notes.md#a-comment-in-the-scanner-is-inside-a-scan-root`
- **`19800101` MUST STAY OUT OF THE ALLOW-LIST** — it is the undeclared DOB four positive tests use;
  declare it and all four assert nothing.
  → `documentation/agent-notes.md#the-undeclared-dob-must-stay-out-of-the-allow-list`
- **EXACTLY ONE FILE IS BYPASSED AND IT NEEDS BOTH HALVES** (`--allow-fixture` **and** a
  `phi-scan-overrides.md` entry): `test/scripts/phi-scan.test.ts`. **Real PHI pasted into that one file
  is not caught — that is the stated cost.** → `documentation/agent-notes.md#exactly-one-file-is-bypassed`
- **`U` is in the `--diff-filter` and is REFUSED, not read.**
  → `documentation/agent-notes.md#unmerged-entries-are-refused`
- **EXIT 1 MEANS HITS AND NOTHING ELSE MAY SPEND IT.** Failure is the default path; do not go back to
  catching by type. → `documentation/agent-notes.md#exit-1-means-hits`

### The `attw` gate

- **`attw` SAYS "does not contain types" AND EXITS 0, SO THE `attw` SCRIPT IS A WRAPPER, NOT THE BARE
  CLI** — for a package that ships types that is a broken publish reported as a pass.
  → `documentation/agent-notes.md#attw-exits-0-on-an-untyped-package`
- **Concurrency only supplies the condition; the BUILD ORDER is the trigger** — `tsup` emits JS before
  declarations, so every build has a window. The answer is **not** a lock, a lease or a build queue.
  **Do not read the measured window timings as constants.**
  → `documentation/agent-notes.md#the-build-order-is-the-trigger`
- **TOTAL declaration loss is silent; PARTIAL loss exits 1. A missing JS entry point is invisible to a
  types analyser. Do not carry a sibling's sentence over without re-running it here, and specifically do
  NOT write "No problems found" into that row — it is false for this package even on a pristine run.**
  → `documentation/agent-notes.md#what-is-measured-on-this-package`
- **`scripts/attw.mjs` carries TWO nets that catch different things** (a manifest-path preflight, and a
  post-check on the untyped sentence). **Anything that would hide the sentence is refused BY OPTION NAME,
  in TWO shapes: an argv token, and a combined short-option cluster containing `q` or `f`** — a
  whole-token-only draft walked back to exit 0 over an untyped pack. **That is a claim about two shapes,
  not that no spelling remains.** → `documentation/agent-notes.md#the-two-nets`
- **This is a PER-REPO script. Landing it here fixes this repo only** — check the siblings before
  claiming the class is closed. → `documentation/agent-notes.md#what-the-gate-test-pins`

## Standing disciplines (every change)

Mirrors the disciplines in the meta-repo's `documentation/conventions.md` — they bind here too. Full
text and every sub-case: `documentation/agent-notes.md#standing-disciplines-every-change`.

1. **Documentation follows code** — this repo's `README.md` / `docs-content/`, the meta-repo
   `documentation/repos/deid.md` ("last verified" bumped), and the `ecosystem-map.md` status table.
2. **Version + changelog** — a Changeset (`patch` on the `0.0.x` ladder) + a `CHANGELOG.md`
   `[Unreleased]` entry per meaningful change. Renaming a stable warning code is a **breaking change**.
3. **Crew + knowledgebase loop** — if the public API or warning codes change, flag/update the matching
   `crew` healthcare skill + the KB product doc.
4. **No internal project bookkeeping on a public surface** (founder directive, 2026-07-27). Item ids,
   phase/roadmap language, ADR numbers and meta-repo paths belong in the changeset, `CHANGELOG.md`, the
   commit, the PR and the roadmap — never in `README.md`, `docs-content/`, the npm `description`, a
   release body, or the JSDoc that compiles into `dist/**/*.d.ts`. Gated by
   `pnpm check:no-internal-refs`. → `documentation/agent-notes.md#no-internal-project-bookkeeping-on-a-public-surface`
   - **The gate keys on KNOWN PROJECT PREFIXES, never the `WORD-N` shape — in THIS repo that is not
     stylistic.** `deid` documents the loci of all six standards (`PID-3`, `NM1-03`, `DTP-03`, `CLP-01`,
     `US-SSN`, `ICD-10-CM`, …); a shape rule deletes the coordinates a consumer needs to audit what was
     transformed. **Never resync the prefix list with a sibling copy** without re-reading why `SYNTH` is
     here and absent in `ncpdp`'s. → `documentation/agent-notes.md#the-gate-keys-on-known-project-prefixes`
   - **The bare-`§` non-catch is a DECISION pinned by `BARE_SECTION_SAMPLE`** — `§` here is
     overwhelmingly `§164.514`. Closing that gap has to be deliberate.
     → `documentation/agent-notes.md#the-section-sign-non-catch`
   - **The gate catches identifiers, not English about our process, and the residual is large. A count is
     a function of the rule set: quote the rule set with the count, or the count means nothing.**
     → `documentation/agent-notes.md#the-gate-catches-identifiers-not-english`
   - **CUT, do not rewrite.** In THIS package the risk is a safety one: every claim is deliberately
     scoped, and two sentences in one sweep would have become **guarantees the code does not provide** if
     the citation had simply been cut. Restate as a limitation instead.
     → `documentation/agent-notes.md#cut-do-not-rewrite`
   - **THE RELEASE BODY IS THE ONE PUBLIC SURFACE THIS REPO CANNOT GATE, AND `.changeset/` IS ITS
     SOURCE.** An internal-only change is dropped **by word**, not reworded — fix the changeset's wording,
     and **never widen the shared word list in `cosyte/.github` to fit one repo's prose.** The renderer
     strips phase language and cannot check the result reads: **open every changeset with a sentence that
     stands on its own once the identifier is gone.**
     → `documentation/agent-notes.md#the-release-body-is-the-one-public-surface-this-repo-cannot-gate`
   - **Stated as a limit, not chased: that fix depends on ANOTHER REPO's word list holding, and nothing
     here fails when it changes.** → `documentation/agent-notes.md#the-word-list-is-in-another-repo`
   - **The mitigation is redundancy, not coverage. Do not read the recorded figures as the measurement —
     re-run the probe against the renderer.**
     → `documentation/agent-notes.md#the-leave-one-out-measurement-and-its-probe`
   - **Do not let a changeset headline drift toward the 200-character HARD REFUSAL** — it refuses (it
     does not trim) on the version commit, after the Version PR has merged.
     → `documentation/agent-notes.md#the-200-character-headline-refusal`
