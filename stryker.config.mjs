import { DEFAULT_MUTATE, cosyteStryker, findBarrels } from "@cosyte/vitest-config/stryker";

// Mutation testing for @cosyte/deid, on the shared StrykerJS config: per-test coverage, static
// mutants ignored, the JSON report at reports/mutation/mutation.json, and no score threshold of its
// own (quality-floor.json decides).
//
//   pnpm mutate:full                           every source file; its score is the floor's
//   pnpm mutate changed --base origin/main     only the source files a change touched
//   pnpm quality:mutation [--base origin/main] the score against quality-floor.json
//
// The files mutated are the shared default, every `.ts` file under `src/` but tests, declarations,
// fixtures, `generated/` folders and the barrels the shared config finds by reading `src/` (today
// `src/index.ts` and `src/transforms/index.ts`; each adapter's `index.ts` holds the adapter itself
// and is mutated), with one generated table left out by name: `src/x12/code-lists.ts`, which
// `scripts/x12-code-lists.ts` writes from the published 005010 data dictionary and which is refreshed
// by running that script, never by hand. `test/x12/code-lists.test.ts` holds it to the dictionary's
// segment definitions.
export default cosyteStryker({
  mutate: [...DEFAULT_MUTATE, ...findBarrels().map((path) => `!${path}`), "!src/x12/code-lists.ts"],
  // The suite without the tests that build the package, compile the examples or test the tooling
  // (see that file).
  vitestConfig: "vitest.mutation.config.ts",
  stryker: {
    // A mutant times out when a test takes longer than timeoutFactor times its first, unmutated
    // run plus timeoutMS. At StrykerJS's defaults (1.5 and 5,000 ms) a mutant near that line can be
    // a timeout on one run and a survivor on the next, which moves a full score the ratchet
    // compares exactly. A wider margin lets a slow mutant that still finishes finish every time, so
    // only a mutant that never ends times out, and the weekly score does not move with the
    // runner's load.
    timeoutFactor: 3,
    timeoutMS: 10_000,
  },
});
