# AGENTS.md

`@cosyte/deid` is our de-identification library for Node.js and TypeScript, published to npm under
MIT. It takes a document parsed by one of the `@cosyte/*` parsers (HL7 v2, C-CDA, FHIR R4, X12,
NCPDP Telecom, and DICOM) and returns a copy transformed per the configured policy, plus a value-free
manifest of what was done where. It has zero runtime dependencies.

## Build and test

Use the pnpm version that `packageManager` in `package.json` pins: run
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
pnpm check:agent-notes
```

A change that reaches the published package adds a changeset (`pnpm changeset`).

## Data

Synthetic data only. Every document this library handles carries a patient's identity: never put a
real patient's data in a test, a fixture, an example, an issue, or a log. `pnpm phi-scan` checks the
tree, and it is a floor, not proof.

## Contributing

See [CONTRIBUTING.md](https://github.com/cosyte/.github/blob/main/CONTRIBUTING.md).
