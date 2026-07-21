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
  with `DEID_CONTEXT_INVALID`). **Third-party runtime deps: zero (`node:crypto` only).** The two standing
  human gates remain: `npm publish` and the public-repo flip (**`PUB-FLIP`**).

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
