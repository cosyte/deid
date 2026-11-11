# AGENTS.md

`@cosyte/deid` is our de-identification library for Node.js and TypeScript, published to npm under
MIT. It takes a document parsed by one of the `@cosyte/*` parsers (HL7 v2, C-CDA, FHIR R4, X12,
NCPDP Telecom, and DICOM) and returns a copy transformed per the configured policy, plus a value-free
manifest of what was done where. It has zero runtime dependencies.

## Build and test

Use Node.js 22.22.2 or later (the floor `@cosyte/process` sets for the dev tools; the package itself
runs on any Node 22) and the pnpm version that `packageManager` in `package.json` pins: run
`corepack enable pnpm --install-directory <dir>` and put `<dir>` first on `PATH`.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

## The gate

A pull request is ready when these pass, in this order. CI runs the first nine on Node 22, 24, and 26.

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
pnpm check:readme
pnpm check:claude-card
pnpm check:catalog
pnpm check:process
pnpm check:docs-content
pnpm check:docs-reference
pnpm test:perf
```

`pnpm check:docs-content` holds `docs-content/` to the docs-content standard: the sidebar, each page's
front matter, the required pages, and every link into the reference. The API reference in
`docs-content/api/` is generated from the TSDoc comments of every entry point in `exports`, and
`pnpm check:docs-reference` fails when the committed pages differ from a fresh generation or an
export has no TSDoc summary. After changing a public export or its comment, run
`pnpm docs:reference` and commit the pages. The `version` script regenerates them, since they
print `VERSION`.

A change that reaches the published package adds a changeset (`pnpm changeset`).

## Performance

`pnpm test:perf` builds, then runs the scaling gates in `test/perf/` (does a pass grow faster than
its input?), apart from `pnpm test` and never under coverage. `bench/deid.bench.mjs` is the
benchmark suite on `@cosyte/bench`, every input built in code by `bench/shapes.mjs`; the comments
at its top say how to take a reading, a profile and a base against head comparison. Take a full
reading on a GitHub runner through the Bench workflow, not on a shared machine.

## Data

Synthetic data only. Every document this library handles carries a patient's identity: never put a
real patient's data in a test, a fixture, an example, an issue, or a log. `pnpm phi-scan` checks the
tree, and it is a floor, not proof.

## Contributing

See [CONTRIBUTING.md](https://github.com/cosyte/.github/blob/main/CONTRIBUTING.md).
