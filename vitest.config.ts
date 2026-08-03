import { cosyteVitest } from "@cosyte/vitest-config";

/**
 * Vitest config for @cosyte/deid from the shared @cosyte/vitest-config standard.
 *
 * Per-directory >= 90 coverage gate on the transforms dir (the crypto-backed units) on top of the
 * global >= 90 gate over all of `src/`. Add directories here as the library grows (e.g. a per-format
 * `loci/` dir once formats are wired).
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
 * a published entry point" and "references the PHI scanner", and they reach all but TWO of this
 * repo's test files. For those two — `test/docs-content.test.ts` and `test/scripts/attw-gate.test.ts`,
 * neither of which imports this package — the `.test.`/`.spec.` filename shape is the only rule.
 * Narrowing this glob is caught either way. The counts that used to be written here are not, because
 * they were already stale by one when this line was next read; `pnpm check:test-selection` prints the
 * live ones on every run.
 */
export default cosyteVitest({
  coverageDirs: ["transforms", "hl7", "x12", "ncpdp"],
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
