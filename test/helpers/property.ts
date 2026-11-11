/**
 * How every property in this suite runs: at the shared depth, from a seed it prints first.
 *
 * - **Depth.** The shared runner in `@cosyte/test-utils` reads `COSYTE_PROPERTY_RUNS`: unset, a
 *   property runs 100 cases (a pull request); the nightly workflows set 10,000.
 * - **Seed.** `COSYTE_PROPERTY_SEED` replays one seed, and `COSYTE_PROPERTY_PATH` one failing case
 *   of it, already shrunk. Unset, a fresh seed is drawn. Either way the seed is printed before the
 *   property runs, so a run that hangs or dies still names it, and a failure prints the seed and the
 *   path again beside fast-check's report.
 *
 * A property passes no case count of its own, so the environment decides the depth of every one. A
 * property that must run at another depth passes `numRuns` and says why at its own site.
 */

import { assertProperty, PROPERTY_ENV, resolvePropertyRun } from "@cosyte/test-utils";
import type fc from "fast-check";

/** What a property may set for itself; the environment wins over each. */
export interface CheckPropertyOptions {
  /** The case count, for a property that documents why it differs from the shared depth. */
  readonly numRuns?: number;
}

/**
 * The seed a property runs from: `COSYTE_PROPERTY_SEED` when set, a fresh one otherwise, printed
 * with the depth before the run.
 *
 * @param name - The property's name, which leads the printed line.
 * @param numRuns - The depth the property asks for, when it documents one.
 * @returns The seed and the resolved depth.
 */
export function propertyRun(
  name: string,
  numRuns?: number,
): { readonly seed: number; readonly numRuns: number } {
  const run = resolvePropertyRun(numRuns === undefined ? {} : { numRuns });
  const seed = run.seed ?? (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0;
  process.stdout.write(
    `[property] ${name}: ${PROPERTY_ENV.seed}=${String(seed)} ${PROPERTY_ENV.runs}=${String(run.numRuns)}\n`,
  );
  return { seed, numRuns: run.numRuns };
}

/**
 * Run a fast-check property at the shared depth from a printed seed, and throw a replayable error
 * naming the seed and the path when it fails.
 *
 * @param name - The property's name.
 * @param property - The property.
 * @param options - A documented depth of its own, if any.
 */
export function checkProperty<Ts>(
  name: string,
  property: fc.IProperty<Ts>,
  options: CheckPropertyOptions = {},
): void {
  const { seed } = propertyRun(name, options.numRuns);
  assertProperty(name, property, {
    seed,
    ...(options.numRuns === undefined ? {} : { numRuns: options.numRuns }),
  });
}
