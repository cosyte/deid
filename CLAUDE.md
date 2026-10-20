# @cosyte/deid

`@cosyte/deid` is our de-identification library for Node.js and TypeScript, published to npm under MIT from this public repository. It takes a document parsed by one of the `@cosyte/*` parsers (HL7 v2, C-CDA, FHIR R4, X12, NCPDP Telecom, DICOM) and returns a copy transformed per the configured policy (Safe Harbor, a limited data set, or a profile built on one) plus a value-free manifest of what was done where, with keyed date shifting, a bring-your-own free-text redactor and an Expert Determination support report. It has zero runtime dependencies: the parsers are optional peers, vendored as tarballs under `vendor/` for the tests, and the DICOM adapter delegates to that parser's own metadata pass, flagging burned-in pixels rather than cleaning them.

## Gate

From the repo root, in this order, with pnpm 10 (the `packageManager` pin). Where `pnpm --version` prints another major, put the pinned one first on PATH, since `test/docs-content.test.ts` shells out to bare `pnpm`: `mkdir -p ~/.pnpm10 && corepack enable --install-directory ~/.pnpm10 pnpm && export PATH="$HOME/.pnpm10:$PATH"`.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm phi-scan
pnpm test
pnpm test:coverage
pnpm build
pnpm attw
pnpm smoke
pnpm examples
pnpm check:test-selection
pnpm check:no-emdash
pnpm check:no-internal-refs
```

The first nine are the shared `cosyte/.github` CI ladder (`ci / verify`, on Node 22 and 24). `pnpm smoke` is `.github/workflows/smoke.yml`, `pnpm examples` the `examples` job in `.github/workflows/ci.yml`, `pnpm check:test-selection` `.github/workflows/test-selection.yml`, and the last two are the em-dash and public-surface gates. CI alone also loads `dist/` as ESM and as CJS, runs actionlint and CodeQL, packs the tree and installs the tarball into a clean directory, and runs the em-dash check over the PR title, body and commit messages.

## Hazard

Every document this library is handed carries a patient's identity, and what it returns gets released as transformed. A defect here re-identifies patients: an identifier that survives the pass, or that the manifest never mentions, cannot be recalled once the output is shared, and no re-run undoes it. So the reflex is the opposite of a parser's: an unrecognized structure, an identifier we cannot locate, or free text is blocked or removed and recorded, never passed through as safe, and a value, the key or a date-shift offset never reaches the manifest, a diagnostic or a log. Clinical values are the mirror case: scrubbing one is a defect too.

## Rules that bind here

Each names the failure that put it here: a pull request in this repo, or a section of `documentation/agent-notes.md`.

- A manifest locus built from document bytes (a segment id, an element name, a `resourceType`) goes through `src/derived-token.ts`, and one that fails its shape is replaced whole by `WITHHELD_LOCUS_TOKEN` plus its index, never truncated: unbounded narrative prose reached the value-free manifest and the Expert Determination report with no options set. Bound only what comes from the document: a first cut that also bounded DICOM's table-built tags withheld real ones (#25).
- Every position a pass hands through is transformed, recorded or counted, never silently kept: under `safe-harbor` the HL7 v2 pass returned visit and order numbers, admit and discharge dates and every date in EVN, ORC, OBX and other retained segments, unrecorded (#49, #51). Take the domain from what the pass hands through, not from a list (`OBX` reaches it by its own value-type branch and was missed, #51); what no rule examines is counted in `unexaminedResiduals` (#56).
- Decide a locus by what it is (its datatype, its party role), never by the resource or segment around it: a `HumanName` on `Organization.contact`, an `Address` on `Location` (#59) and an employer filed as an organization (#54) all passed through.
- A policy or profile claiming `safe-harbor` may not pseudonymize, hash or date-shift any category, or retain any locus: `DEID_POLICY_INVALID` refuses it, by policy name and by profile standard alike, and retention under any other label needs all three keys (adapter class, `retainedLoci`, a retainable category). The label once shipped keyed surrogates and retained encounter identifiers (#49, #52).
- Two positions never share a manifest row: same-named C-CDA siblings collapsed into one (#29), and an HL7 date is addressed by field, component and repetition (#51).
- `test/corpus/` is the cross-format zero-leak and over-scrub gate, and a sweep sees only sentinels a fixture seeds: a new locus gets a fixture value that is red before the fix (no HL7 fixture carried `PV1-19/44/45`, #49). It is selected only by the `include` glob in `vitest.config.ts`, so never narrow that or `.skip` the suite, and a module that is not a test may not import a published entry point, which is why `test/helpers/run-date-shift.ts` imports `src/` (#23).
- `pnpm phi-scan` follows nothing: a symlink, gitlink or unmerged entry under `src/`, `test/` or `scripts/` refuses the scan (exit 2), the `--staged` route (the pre-commit hook) keeps `--no-renames` and `--diff-filter=AMTU`, and all mode reads the bytes git carries as well as the tree, `vendor/` excluded. Each closed a route that read a PHI payload clean (#33, #34, #38, #47). Exit 1 means hits and nothing else.
- Widen a PHI-scan recogniser only beside the mechanisms it improves on, with a case red before and green after: a per-line split that replaced the rejoin took a hard-wrapped `NM1*IL` from three patient identifiers to zero (#34).
- `pnpm attw` stays `node scripts/attw.mjs --profile node16`, never bare `attw` (`node_modules/.bin`, from the `@arethetypeswrong/cli` devDependency), which exits 0 on a pack with no types (#31).
- `pnpm smoke` takes its subpaths from `package.json` `exports`, never from a list: it was documented as a CI gate while running in no job, and the `Dual ESM/CJS smoke` step in `ci / verify` loads only the root entry (#18).
- Job names in `ci.yml` and `smoke.yml` are required check contexts, and a required job gates its steps: renaming the `ci` job or moving a step (the PHI scan) out of `verify` drops it from the ruleset in silence, and a newly required context leaves every older branch pending until it is rebased (#16, `documentation/agent-notes.md#a-required-context-a-branch-cannot-emit-leaves-the-pr-pending`).
- The changeset summary is the changelog entry: never hand-edit `CHANGELOG.md` or bring back an `[Unreleased]` heading, which shipped in every tarball calling released work unreleased (#42).
- A changeset's first sentence becomes the release bullet: under 200 characters (the release refuses, never trims, #15), standing on its own once identifiers are stripped, and an internal-only change worded so the release drops it: two would have published as consumer changes (#22).
- `README.md`, `docs-content/`, the npm `description` and `/** */` comments in `src/` (they ship in `dist/*.d.ts`) carry no item ids, phase language, ADR numbers or private paths. Restate a limitation rather than cut its citation, since cutting the citation alone would have turned two limits into claims the code does not keep (#21), and never delete a doc comment to pass `pnpm check:no-internal-refs`: every public export carries JSDoc with an `@example`.
- Public text claims what the code blocks and nothing wider: a blanket "fails closed" was narrowed to the cases blocked (#71), and output is "Safe-Harbor-transformed per the configured policy", never "de-identified".
- `.github/workflows/release.yml` keeps all four grants (`actions: read`, `contents: write`, `id-token: write`, `pull-requests: write`): without them every release failed at startup and logged nothing (#12, #53).
- `test/docs-content.test.ts` runs a full `pnpm build` under a 120 s budget and timed out on a loaded box (#22): re-run it before calling it red.
