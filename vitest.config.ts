import { readFileSync } from "node:fs";

import { cosyteVitest } from "@cosyte/vitest-config";

/**
 * Vitest config for @cosyte/deid from the shared @cosyte/vitest-config standard, which owns the
 * coverage provider, reporters, include and exclude sets and a 90% gate.
 *
 * THE COVERAGE FLOOR IS `quality-floor.json`, read below, and nowhere else. `coverageThresholds`
 * raises the shared 90% gate to that floor for the whole of `src/` and for each directory in
 * `COVERAGE_DIRS`, which `coverageDirs` also holds to the gate on its own, so a well-covered
 * directory cannot carry a poorly covered one. The same file holds the mutation score, and
 * `pnpm quality:check` (`cosyte-ratchet`, the `coverage-ratchet` job in CI) holds the measured
 * coverage to it. A floor only rises: a line no input can reach takes an inline `v8 ignore` comment
 * naming its reason, never a lower number in the file.
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
const COVERAGE_DIRS = ["transforms", "hl7", "ccda", "fhir", "x12", "ncpdp", "dicom"];

/** The four coverage metrics the floor file holds. */
interface CoverageFloor {
  readonly lines: number;
  readonly branches: number;
  readonly functions: number;
  readonly statements: number;
}

/**
 * The coverage floor for every metric, globally and per directory, read from `quality-floor.json`.
 * A file without all four metrics is refused, so a typo there cannot fall back to the shared 90.
 */
function readCoverageFloor(): CoverageFloor {
  const file = JSON.parse(
    readFileSync(new URL("./quality-floor.json", import.meta.url), "utf8"),
  ) as { packages?: Record<string, { coverage?: Partial<CoverageFloor> }> };
  const { lines, branches, functions, statements } = file.packages?.["."]?.coverage ?? {};
  const floor = { lines, branches, functions, statements };
  for (const [metric, value] of Object.entries(floor)) {
    if (typeof value !== "number" || value < 0 || value > 100) {
      throw new Error(`quality-floor.json: the coverage floor for ${metric} is not a score`);
    }
  }
  return floor as CoverageFloor;
}

/** The floor for every metric, globally and per directory. */
const FLOOR = readCoverageFloor();

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
