import { cosyteVitest } from "@cosyte/vitest-config";

/**
 * Vitest config for @cosyte/deid from the shared @cosyte/vitest-config standard.
 *
 * Per-directory >= 90 coverage gate on the transforms dir (the crypto-backed units) on top of the
 * global >= 90 gate over all of `src/`. Add directories here as the library grows (e.g. a per-format
 * `loci/` dir once formats are wired).
 */
export default cosyteVitest({
  coverageDirs: ["transforms"],
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
