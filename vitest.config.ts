import { cosyteVitest } from "@cosyte/vitest-config";

/**
 * Vitest config for @cosyte/deid from the shared @cosyte/vitest-config standard, which owns the
 * coverage provider, reporters, include and exclude sets and a 90% gate.
 *
 * This repository is at 100% lines, branches, functions and statements, so `coverageThresholds`
 * raises the shared 90% gate to 100 for the whole of `src/` and for each directory in
 * `COVERAGE_DIRS`, which `coverageDirs` also holds to the gate on its own, so a well-covered
 * directory cannot carry a poorly covered one. A floor only rises: a line no input can reach takes an
 * inline `v8 ignore` comment naming its reason, never a lower number here.
 *
 * THE `include` BELOW IS THE SOLE SELECTOR FOR EVERY TEST CI RUNS, AND IT IS GUARDED.
 * `@cosyte/vitest-config` supplies no `include` of its own and spreads this `test` block last, so
 * narrowing this line (or adding an `exclude`, or a `projects` split) silently drops whole suites
 * while every required check stays green. That includes `test/corpus/leak-corpus.test.ts`, the
 * cross-format zero-leak and over-scrub corpus. Coverage cannot backstop it: coverage is measured
 * over `src/**` only, so dropping the corpus costs close to no coverage percent at all.
 *
 * `pnpm check:test-selection` is the gate. It asks vitest which files this config actually resolves
 * to and reds if a tracked module in its subject is not among them, so a narrowing here fails a
 * check rather than passing quietly. Widen this glob freely; narrowing it is the thing to think
 * twice about, and the gate will make you. Note the scope: the name-independent rules are "imports
 * a published entry point" and "references the PHI scanner", and they reach all but ONE of this
 * repo's test files. For that one, `test/examples-typecheck.test.ts`, which imports neither this
 * package nor the scanner, the `.test.`/`.spec.` filename shape is the only rule.
 * Narrowing this glob is caught either way. The counts that used to be written here are not, because
 * they were already stale by one when this line was next read; `pnpm check:test-selection` prints the
 * live ones on every run.
 */
const COVERAGE_DIRS = ["transforms", "hl7", "x12", "ncpdp"];

/** The floor for every metric, globally and per directory. */
const FLOOR = { lines: 100, branches: 100, functions: 100, statements: 100 };

export default cosyteVitest({
  coverageDirs: COVERAGE_DIRS,
  coverageThresholds: {
    ...FLOOR,
    ...Object.fromEntries(COVERAGE_DIRS.map((dir) => [`src/${dir}/**`, { ...FLOOR }])),
  },
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
