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

- **DEID-1 shipped: the format-agnostic de-id core.** Pre-alpha `0.0.x`, not yet published to npm.
  `src/` carries the policy engine (`deidentify`, `SAFE_HARBOR_POLICY`, `defineDeidPolicy`), the five
  transforms (redact / generalize / date-shift / pseudonymize / keyed-hash, `node:crypto`-backed), the
  18-category Safe Harbor model, the fail-closed rule, and the value-free manifest — tested against a
  **generic locus model**. Per-format locus maps (HL7 v2, C-CDA, FHIR, X12, NCPDP, DICOM) are the next
  phases (DEID-2…DEID-6). **Third-party runtime deps: zero (`node:crypto` only).**

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
