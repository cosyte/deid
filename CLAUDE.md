# @cosyte/deid

Our de-identification library for Node.js and TypeScript, published to npm under MIT from this
public repository. It takes a document parsed by one of the `@cosyte/*` parsers (HL7 v2, C-CDA,
FHIR R4, X12, NCPDP Telecom, and DICOM) and returns a copy transformed per the configured policy,
plus a value-free manifest of what was done where. No runtime dependencies; the parsers are
optional peers (`^0.1`), installed from npm for the tests.

@AGENTS.md

## Gate

From the repo root, in this order, with the pinned pnpm 10 first on PATH (AGENTS.md says how):
`test/docs-content.test.ts` shells out to bare `pnpm`.

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm format:check && pnpm phi-scan
pnpm test && pnpm test:coverage && pnpm build && pnpm attw
pnpm smoke && pnpm examples && pnpm check:test-selection
pnpm check:no-emdash && pnpm check:no-internal-refs
pnpm check:readme && pnpm check:claude-card && pnpm check:catalog
```

The first nine are the shared `ci / verify` ladder, on Node 22, 24, and 26. `smoke`, `examples`,
`test-selection` and `documents` have their own jobs; the dash and attw gates are script-utils'.

## Hazard

Every document handed to this library carries a patient's identity, and its output is released as
transformed. An identifier that survives the pass, or that the manifest never mentions, cannot be
recalled once shared. So an unrecognized structure, an identifier we cannot locate, or free text is
blocked or removed and recorded, never passed through, and a value, the key, or a date-shift offset
never reaches the manifest, a diagnostic, or a log. Scrubbing a clinical value is a defect too.

## Rules that bind here

- A manifest locus built from document bytes goes through `src/derived-token.ts`; one that fails
  its shape becomes `WITHHELD_LOCUS_TOKEN` plus its index, never truncated (#25).
- Every position a pass hands through is transformed, recorded, or counted in
  `unexaminedResiduals`; take the domain from what the pass hands through (#49, #51, #56).
- Decide a locus by what it is (datatype, party role), never by the segment around it (#54, #59).
- A policy or profile claiming `safe-harbor` never pseudonymizes, hashes, date-shifts, or retains:
  `DEID_POLICY_INVALID` refuses it (#49, #52). Two positions never share a manifest row (#29, #51).
- `test/corpus/` is the zero-leak and over-scrub gate: a new locus gets a fixture value that is red
  before the fix, and vitest's `include` is never narrowed nor the suite skipped (#23, #49).
- `pnpm phi-scan` follows nothing, keeps `--no-renames` and `--diff-filter=AMTU`, reads what git
  carries, and exits 1 for hits only (#33, #34, #38, #47); widen a recogniser red to green (#34).
- `pnpm attw` is `cosyte-attw` with `scripts/attw.exclude`, never bare attw (exits 0 untyped, #31).
- `pnpm smoke` takes its subpaths from `package.json` `exports`, never from a list (#18).
- Job names in `ci.yml` and `smoke.yml` are required contexts, and a required job gates its steps:
  renaming one or moving a step out of `verify` drops it from the ruleset in silence (#16).
- The changeset summary is the changelog entry: never hand-edit `CHANGELOG.md` (#42); its first
  sentence stays under 200 characters and reads on its own without identifiers (#15, #22).
- Public text carries no item ids, phase words, ADR numbers or private paths, keeps every JSDoc
  `@example`, and claims only what the code blocks: never "de-identified" (#21, #71).
- `release.yml` keeps all four grants, or every release fails at startup (#12, #53).
- `test/docs-content.test.ts` builds under a 120 s budget: re-run it before calling it red (#22).
