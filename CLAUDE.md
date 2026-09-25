# @cosyte/deid: Project Guide for Claude

> **▶ THE NARRATIVE BEHIND EVERY TRAP BELOW IS IN `documentation/agent-notes.md`**: relocated there
> **verbatim** on 2026-08-04, nothing deleted. Each line here is the imperative; the anchor after it is
> the case that earned it (the measurement, the sha, the negative control). **Read the section before
> you touch the thing it guards.** This file is always-read for every worker that `cd`s in, so it is
> budgeted at write time by this repo's entry in `REPO_CLAUDE`, in the umbrella's
> `.claude/hooks/doc-budget.mjs` (ADR 0023). It is a per-repo ratchet that is LOWERED as relocations
> land, so **no byte figure is written here**: read the hook. The notes are read on demand. **The
> remedy for size is always relocation, never deleting a trap.**

## Project

**`@cosyte/deid`**: a developer-focused healthcare **de-identification** library for Node.js/TypeScript,
published under the Cosyte brand. Open-source (MIT). It is a **consumer** of the `@cosyte/*` parsers,
**not a parser sibling**: it borrows the archetype's disciplines (typed diagnostics, immutable output,
the policy/profile system) but **inverts the reflex**: a parser is liberal on input (Postel's Law); a
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
- **NCPDP SCRIPT remains deferred**: lossy serialize + address-less `Patient` block a faithful
  structural de-id through the current parser surface.
- **The DICOM adapter DELEGATES to `@cosyte/dicom`'s PS3.15 Annex E pass: metadata-only, burned-in
  pixels FLAGGED not cleaned.** Never describe it as cleaning pixels.
- **▶ THE OTHER SCOPED SAFETY CLAIMS, EACH OF WHICH BECOMES A FALSE GUARANTEE IF YOU BROADEN IT.** The
  free-text interface is **block-by-default**, and a consumer redactor is **consumer-asserted, never
  re-verified**. `defineDeidProfile` is fail-closed under a **widen-never-narrow** contract. The
  `DEID_POLICY_INVALID` label guard exists so **date-shift may not wear the `safe-harbor` label**. The
  registry key is consumer-supplied, fail-closed on `DEID_NO_KEY`, and **rotation is intentional linkage
  breakage**. → `documentation/agent-notes.md#shipped-phases-deid-1-through-deid-10`
- **Publish state and repo visibility are INDEPENDENT: check each, never infer one from the other, and
  NEVER QUOTE A VERSION IN THIS FILE.** `npm view @cosyte/deid version`, `git tag` and
  `gh api repos/cosyte/deid --jq .visibility` are the only authorities. **⚠ TWO DATED CLAIMS ARE IN
  PLAY AND NEITHER IS A STANDING FACT:** the publish-state paragraph this file used to carry (itself a
  _correction_ of an earlier "not yet published" claim, preserved at
  `documentation/agent-notes.md#publish-state-and-visibility`), and the umbrella backlog entry
  `CHANGELOG-PREAMBLE-FUTURE-TENSE`, which still names this file alongside `hl7`, `mllp` and
  `transform` as saying "not yet published". **That entry is out of date for `deid`.** Re-measure;
  restate neither as fact from here. `npm publish` is waived by standing founder directive;
  **flipping a repo public is not.**

## Tech Stack (the shared `@cosyte/*` standard)

Per the published `@cosyte/*` config packages, never by copying files: TypeScript strict
(**ES2023**, `NodeNext`, 5.9.x pinned), **Node >= 22** (CI 22+24), **pnpm@10**, dual ESM + CJS via
`tsup`, ESLint 10 + Prettier, `--max-warnings=0`, Vitest 4 at >= 90 per-directory coverage,
**runtime deps zero**, MIT. **`attw` is a WRAPPER, not the bare CLI**: see below. Detail + the vendored
optional-peer arrangement:
`documentation/agent-notes.md#tech-stack-the-shared-cosyte-standard`.

### Branch protection and Dependabot

Relocated in full: [documentation/branch-protection.md](documentation/branch-protection.md).

## Engineering Guardrails

- No `any`. No unjustified `as` casts. Use `unknown` and narrow.
- JSDoc (with `@example`) on every public export: the JSDoc lint rule is an **error** on public
  exports, so this is enforced, not optional.
- Immutable by default. Mutation only via explicit methods.
- No `console.*` in library code. Throw typed errors or return results.
- Short, testable functions over big parsing blobs.
- **Inverted Postel's Law: fail CLOSED.** Unlike a parser, the de-id reflex is conservative: an
  unrecognized structure / un-locatable identifier / uncertain field is **blocked or removed**, never
  passed through as safe. Clinical values are the mirror guard: retained untouched (no over-scrub).
- Fatal errors only for the sanctioned fatal set (`EMPTY_INPUT`, `DEID_NO_KEY`). A keyed transform
  **never** silently falls back to unkeyed. Everything else is a value-free manifest disposition with a
  stable `DEID_*` code + locus (never a value, never the key, never the date-shift offset).
- Coverage: per-directory >= 90% (lines/branches/functions/statements), enforced by
  `pnpm test:coverage`.

### The PHI commit gate (`scripts/phi-scan.ts`)

Every line here is clinical-safety content. Full cases: `documentation/agent-notes.md#the-phi-scan`.

- **The scan FOLLOWS NOTHING: a non-regular in-scope entry REFUSES the scan (exit 2). Never "fix"
  this by following the link.** Both routes read a symlink as **clean**; reproduced on `e040ffc`. The
  narrowing is **structural**; **the kind tokens are labels with a catch-all arm, never the decision:
  do not turn either into a list of shapes.** → `documentation/agent-notes.md#phi-scan-follows-nothing`
- **THE ONE-LETTER TRAP: `--diff-filter` MUST KEEP `T`.** Without it a tracked file replaced by a link
  staged green through `pre-commit`. → `documentation/agent-notes.md#the-one-letter-trap-t-in-the-diff-filter`
- **`R`/`C` are closed by `--no-renames`, not by the filter**: the enumeration becomes a superset and
  the stride structural. **The old "needs the two-path record shape, a scope decision" framing is
  WITHDRAWN as FALSE, not deferred.** → `documentation/agent-notes.md#closed-by-no-renames`
- **A REFUSAL NAMES THE ENTRY'S OWN PATH AND AN ENGINE-OWNED KIND TOKEN, NEVER THE LINK TARGET.** A
  diagnostic about a PHI leak is itself a PHI surface, **and so is the prose explaining it**: no
  example target path in the docblock, CHANGELOG or changeset.
  → `documentation/agent-notes.md#closed-by-no-renames`
- **Two things NOT covered, both measured:** explicit-path mode still reads through a link; a file
  that vanishes between enumeration and read fails **closed** (exit 2) -- a false-red risk, not a
  false-green one. → `documentation/agent-notes.md#closed-by-no-renames`
- **THE WALK ROOTS ARE `src/`, `test/` (ALL of it) AND `scripts/`: A DIFFERENT DECISION FROM EVERY
  SIBLING'S. DO NOT PORT ONE OVER IT.** The old scopes missed **38 tracked files**, four carrying
  inline `PID|…` literals. **`.md` IS EXEMPT ON BOTH ENUMERATING ROUTES AND ON THE INDEX ROUTE (an
  explicit path is still scanned), SO `docs-content/` REMAINS A PUBLISHED CONSUMER SURFACE THIS GATE
  DOES NOT SCAN FOR PHI**: 16 of its 17 files are `.md`; the index adds only `sidebars.json`.
  `.github/` and the root manifests ARE read there; `vendor/` is not.
  → `documentation/agent-notes.md#the-scan-roots`
- **ENUMERATING THE FILES BUYS THE SSN/EMAIL FLOOR AND NOTHING ELSE: a detector has to RECOGNISE the
  document first, and every recogniser was written for a file that _is_ the document.** This repo's
  fixtures are `.ts` string literals, so each file is also scanned as its **decoded, joined
  literals**; four recognisers widened with it.
  → `documentation/agent-notes.md#enumerating-the-files-buys-the-floor-only`
- **WIDENING A RECOGNISER IS TWO-SIDED. EVERY MECHANISM IS "IN ADDITION TO", NEVER "INSTEAD OF": DO
  NOT SIMPLIFY ONE AWAY.** A per-line split silently took a hard-wrapped `NM1*IL` from three patient
  identifiers to zero. **Each of the four mechanisms has a case that goes RED when it is removed:
  verified by removing each one, not by reading the code.**
  → `documentation/agent-notes.md#widening-a-recogniser-is-two-sided`
- **▶ THE EVIDENCE STANDARD FOR THIS REPO: PROVE EVERY WIDENING WITH A CASE THAT IS RED BEFORE AND
  GREEN AFTER. A recogniser that quietly matches nothing reports "no hits."** A claim without a
  red-before case is not evidence. → `documentation/agent-notes.md#what-is-not-claimed-to-be-reached`
- **None of that claims arbitrary embedded text is reached**; the banner in `scripts/phi-scan.ts`
  enumerates what is not. → `documentation/agent-notes.md#what-is-not-claimed-to-be-reached`
- **A comment in `scripts/phi-scan.ts` is INSIDE a scan root**: an escaped example decodes into a
  segment the detector reads as a fixture. It did, on the first draft.
  → `documentation/agent-notes.md#a-comment-in-the-scanner-is-inside-a-scan-root`
- **`19800101` MUST STAY OUT OF THE ALLOW-LIST**: the undeclared DOB four positive tests use; declare
  it and all four assert nothing. → `documentation/agent-notes.md#the-undeclared-dob-must-stay-out-of-the-allow-list`
- **NO FILE IS BYPASSED, AND `--allow-fixture` CANNOT REACH A CLEAN RUN.** A target the run
  ENUMERATED AND NEVER READ refuses it (exit 2), in every mode and on both all-mode routes. The
  flag, the log and the rejection gate are all KEPT, so an attempt is **recorded and refused**, not
  honoured. **There is no whole-file escape left**: declare tokens in `scripts/phi-allow-list.txt`,
  or assemble the shape at run time as `test/scripts/phi-scan.test.ts` now does (a `${…}`
  substitution site at every PHI position; the floor's two shapes built from pieces). **The floor
  was NOT weakened to buy that** and an undeclared SSN shape is still a hard hit.
  → `documentation/agent-notes.md#exactly-one-file-is-bypassed`
- **`U` is in the `--diff-filter` and is REFUSED, not read.** → `documentation/agent-notes.md#unmerged-entries-are-refused`
- **EXIT 1 MEANS HITS AND NOTHING ELSE MAY SPEND IT.** Failure is the default path; do not go back to
  catching by type. → `documentation/agent-notes.md#exit-1-means-hits`
- **ALL MODE READS THE BYTES GIT CARRIES, AS A UNION WITH THE WALK.** Five states printed `OK, no
hits` at exit 0 on base; the decoy at a tracked path is why it exists. **The mechanism is written
  ONCE, at `buildTargetsForIndex`.** **Refusals run AFTER the walk is scanned -- a refusal must not
  swallow a real hit -- `makeRepo()` commits its baseline, and `--allow-fixture` is subtracted here
  too: live, not dead code, because a refusal may not report what it refused over.**
  → `documentation/agent-notes.md#all-mode-reads-the-bytes-git-carries`
- **`vendor/` IS EXCLUDED FROM THAT ROUTE, AS A LITERAL PATH** (45 mojibake hits without it). **A
  "binary blob" PREDICATE was measured and REJECTED: two hand-written `src/*.ts` embed NUL bytes.**
  **The byte skip MAY NOT normalize line endings**; `.md`/`vendor/` apply LAST, after the mode
  refusals. → `documentation/agent-notes.md#what-the-index-route-excludes`
- **THE POSITIVE CONTROL STRIKES `EMAILDOMAIN cosyte.com` AND THE SAME CORPUS REDS.** That floor hit
  is `package.json`'s contact address: **published registry metadata, NOT PHI**; an `EMAILDOMAIN`
  entry is **global and route-blind**. **Never spell the address out in the allow-list: it sits in a
  scan root, and a control that reds on two files proves nothing.**
  → `documentation/agent-notes.md#the-positive-control-and-its-floor-hit`

### The `attw` gate

Relocated in full: [documentation/attw-gate.md](documentation/attw-gate.md).

## Standing disciplines (every change)

Relocated in full: [documentation/standing-disciplines.md](documentation/standing-disciplines.md).
