import type { ViteUserConfig } from "vitest/config";
import { configDefaults } from "vitest/config";

import shared from "./vitest.config.js";

const config = shared as ViteUserConfig;

/**
 * The Vitest run StrykerJS uses for mutation testing (`stryker.config.mjs`): the suite of
 * `vitest.config.ts`, without the files that cannot judge a mutant.
 *
 * StrykerJS mutates `src/` inside a sandbox and switches each mutant on in the test process, so a
 * test only kills a mutant when it runs the source in that process. The files left out below do
 * not, and each would cost every run a build, a compile or a child process:
 *
 * - `test/docs-content.test.ts` runs `pnpm build` and runs the docs samples against `dist/`, which
 *   is built from the plain sources, not the instrumented ones;
 * - `test/examples-typecheck.test.ts` type-checks `examples/` with the TypeScript compiler against
 *   the built package, which runs no code;
 * - `test/scripts/` tests this repository's own tooling in `scripts/` (the PHI scan and the
 *   changelog), each in a child process;
 * - `test/fhir/pattern-guard.test.ts` reads the FHIR sources under `src/` as text to find every
 *   pattern they write, and StrykerJS's rewrite of them (each regular expression mutated in place)
 *   is not the source it guards.
 *
 * What they prove is proved by `pnpm test` on every pull request. No other test in this suite reads
 * a file under `src/` as text, so none fails on StrykerJS's rewrite of it.
 *
 * Every property runs from one fixed seed here (`COSYTE_PROPERTY_SEED`, read by
 * `test/helpers/property.ts`), at the pull request depth of 100 cases: a property draws a fresh seed
 * on every other run, and in a mutation run a fresh seed would let a mutant that only some cases
 * reach be killed on one run and survive the next, which moves a full score the ratchet compares
 * exactly. The generated leak properties (`test/leak-property/`) stay in, at the same depth and seed.
 *
 * The instrumented code runs several times slower than the plain build, so a test's budget here is
 * 60 s rather than 10 s. StrykerJS sets each mutant's own timeout from the time the test took in its
 * first run (`stryker.config.mjs`), so this budget does not slow the mutant runs.
 */
const mutation: ViteUserConfig = {
  ...config,
  test: {
    ...config.test,
    exclude: [
      ...(config.test?.exclude ?? configDefaults.exclude),
      "test/docs-content.test.ts",
      "test/examples-typecheck.test.ts",
      "test/scripts/**",
      "test/fhir/pattern-guard.test.ts",
    ],
    env: {
      ...config.test?.env,
      COSYTE_PROPERTY_SEED: "424242",
      COSYTE_PROPERTY_RUNS: "100",
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
};

export default mutation;
