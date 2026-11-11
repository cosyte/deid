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

A pull request is ready when these pass, in this order. CI runs the first ten on Linux, Windows and
macOS on Node 22, 24, and 26 (`quality:check` in its own `coverage-ratchet` job), and the suite
under Bun.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm phi-scan
pnpm test
pnpm test:coverage
pnpm quality:check --base origin/main
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
pnpm test:perf
```

A change that reaches the published package adds a changeset (`pnpm changeset`).

## The testing standard

`quality-floor.json` holds the coverage and the mutation score CI measures, and they only rise;
`vitest.config.ts` reads its coverage floor from there, for `src/` and for each directory on its own.
`pnpm quality:check` holds coverage to it (after `pnpm test:coverage`); with `--base origin/main`
every changed line coverage counts must also have run. On a pull request CI's `mutation` job mutates
the changed source files with `stryker.config.mjs` and every mutant in the changed lines must be
killed. `.github/workflows/weekly-mutation.yml` runs the full run (`pnpm mutate:full`) twice a week,
in eight shards, and holds its score to the floor; raise a floor with `pnpm quality:raise` after a
full run. Mutation runs the suite of `vitest.mutation.config.ts`, without the tests that build the
package, compile the examples or test the tooling, and with every property on one fixed seed.

Every property runs through `test/helpers/property.ts`: 100 cases on a pull request, 10,000 nightly
(`nightly-properties.yml` runs `pnpm test:property`; `leak-property.yml` runs the leak properties),
its seed printed first, a failure replayed with `COSYTE_PROPERTY_SEED` and `COSYTE_PROPERTY_PATH`.
A property passes no case count of its own.

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
