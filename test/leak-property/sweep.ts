/**
 * The shared half of the **generated leak property**: one sentinel sweep, one run configuration and
 * one tally, used by a property per format adapter (`test/leak-property/*.test.ts`).
 *
 * The leak corpus (`test/corpus/leak-corpus.test.ts`) seeds fixed fixtures at the positions its
 * author thought of. The defects that got past it were of one class: a value in a SHAPE the locus
 * rule did not expect (a plain string where a composite was expected, a value in a qualifier, a name
 * nested one level deeper) passed through verbatim. A fixed fixture cannot find the next one. So each
 * property here builds a document from generated parts, places tagged synthetic sentinels at generated
 * positions and in generated shapes, runs the adapter, and holds every sentinel to one rule:
 *
 * - it is **absent** from the output, the manifest and the residual inventory, or
 * - it survives in the output and the residual inventory **names its locus** as unexamined, so a
 *   consumer reading the inventory sees the position it still carries.
 *
 * A sentinel in the manifest or in a residual record is a leak whatever the output holds: those lists
 * are value-free by contract.
 *
 * **It never passes silently.** Every sentinel is asserted present in the input before the pass, so an
 * absence after it means something; a run that placed no sentinel fails; the tally of outcomes is
 * printed and must show that sentinels were placed and handled, not merely refused; and each adapter's
 * file carries a tamper case, a sentinel put back into a real output, that the same sweep must catch.
 *
 * **Runs and seeds.** `DEID_LEAK_RUNS` sets the run count (100 by default, the pull request budget;
 * the nightly workflow sets 10,000) and `DEID_LEAK_SEED` replays one seed. Each property prints its
 * seed before it runs, and fast-check prints the seed and the path of a failing case, so any failure
 * is reproducible from the log alone.
 *
 * Every sentinel is a synthetic token (`ZQLK` and capitals); nothing here is or resembles real data.
 */

import fc from "fast-check";

import { type UnexaminedResidual } from "../../src/residual.js";

/** The run count: about 100 on a pull request, 10,000 in the nightly workflow. */
export const LEAK_RUNS: number = readPositiveInt("DEID_LEAK_RUNS", 100);

/** Read a positive integer from the environment, or fall back to the default. */
function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.length === 0) return fallback;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

/** The seed for one property: `DEID_LEAK_SEED` when set, a fresh one otherwise. */
export function leakSeed(): number {
  const raw = process.env["DEID_LEAK_SEED"];
  if (raw !== undefined && raw.length > 0) {
    const n = Number(raw);
    if (!Number.isSafeInteger(n)) throw new Error("DEID_LEAK_SEED must be an integer");
    return n | 0;
  }
  return (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) | 0;
}

/** The shape a sentinel was placed in, for the tally and the failure message. */
export type LeakShape =
  | "plain-for-composite"
  | "extra-repeat"
  | "extra-component"
  | "subcomponent"
  | "qualifier-or-code"
  | "nested"
  | "plain";

/** One sentinel as placed: the token, the shape, and a description of where it went. */
export interface Placement {
  readonly sentinel: string;
  readonly shape: LeakShape;
  /** Where the generator put it, in the adapter's own terms. Test output only. */
  readonly where: string;
}

/**
 * What one pass produced, as the sweep reads it.
 *
 * `residualAt(sentinel)` answers whether the residual inventory names the locus the sentinel sits at
 * in the INPUT: each adapter derives that locus from the parsed input itself, so the answer rests on
 * where the parser put the sentinel and not on where the generator meant to put it.
 */
export interface PassOutcome {
  /** The serialized output. Empty when the pass refused the document. */
  readonly output: string;
  /** The manifest, or any value-free list the pass returned beside it. */
  readonly manifest: unknown;
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
  readonly residualAt: (sentinel: string) => boolean;
  /** `true` when the pass refused the document with a documented fatal: nothing was released. */
  readonly refused: boolean;
  /**
   * For a pin that rests on a decision the manifest records (an X12 party its role keeps): whether
   * that decision was taken for the structure holding the sentinel. Absent means never.
   */
  readonly decidedKeep?: (sentinel: string) => boolean;
}

/**
 * A keep the property reaches and this suite does not close: a position where the adapter keeps a
 * value on purpose when it has the position's shape. Each is named on the limitations page and pinned
 * in `./found.test.ts`, which asserts it still survives. The sweep counts a pinned survivor and prints
 * the count; it never counts one as removed.
 */
export interface Pin {
  /** Whether a placement is at a pinned position, read from where the generator put it. */
  readonly applies: (placement: Placement, outcome: PassOutcome) => boolean;
}

/** How each sentinel fared, counted over a whole property run. */
export interface LeakTally {
  cases: number;
  placed: number;
  removed: number;
  residual: number;
  pinned: number;
  refused: number;
  readonly shapes: Map<LeakShape, number>;
}

/** A fresh tally. */
export function newTally(): LeakTally {
  return {
    cases: 0,
    placed: 0,
    removed: 0,
    residual: 0,
    pinned: 0,
    refused: 0,
    shapes: new Map(),
  };
}

/**
 * Sweep one outcome for every placed sentinel. Returns the violations, each naming the sentinel, its
 * shape and where it was placed; an empty list is a pass. The tally, when given, is updated.
 */
export function sweep(
  placements: readonly Placement[],
  outcome: PassOutcome,
  tally?: LeakTally,
  pins: readonly Pin[] = [],
): string[] {
  const violations: string[] = [];
  const manifest = JSON.stringify(outcome.manifest) ?? "";
  const residuals = JSON.stringify(outcome.unexaminedResiduals);
  if (tally !== undefined) tally.cases += 1;
  for (const p of placements) {
    const label = `${p.sentinel} (${p.shape} at ${p.where})`;
    if (tally !== undefined) {
      tally.placed += 1;
      tally.shapes.set(p.shape, (tally.shapes.get(p.shape) ?? 0) + 1);
    }
    if (manifest.includes(p.sentinel)) violations.push(`${label} is in the manifest`);
    if (residuals.includes(p.sentinel)) violations.push(`${label} is in a residual record`);
    if (outcome.refused) {
      if (outcome.output.length > 0) violations.push(`${label}: a refused pass returned output`);
      if (tally !== undefined) tally.refused += 1;
      continue;
    }
    if (!outcome.output.includes(p.sentinel)) {
      if (tally !== undefined) tally.removed += 1;
      continue;
    }
    if (outcome.residualAt(p.sentinel)) {
      if (tally !== undefined) tally.residual += 1;
      continue;
    }
    if (pins.some((pin) => pin.applies(p, outcome))) {
      if (tally !== undefined) tally.pinned += 1;
      continue;
    }
    violations.push(`${label} survives in the output and no residual names its locus`);
  }
  return violations;
}

/**
 * Hold a tally to the never-silent rule: sentinels were placed, and some were handled by the pass
 * rather than every document being refused. Returns the reasons it fails, empty when it holds.
 */
export function silentRunReasons(tally: LeakTally): string[] {
  const reasons: string[] = [];
  if (tally.cases === 0) reasons.push("no case ran");
  if (tally.placed === 0) reasons.push("no sentinel was placed");
  if (tally.removed + tally.residual === 0) reasons.push("no sentinel reached a decided outcome");
  return reasons;
}

/** One line for the log: the seed, the runs and the tally. */
export function describeRun(name: string, seed: number, tally: LeakTally): string {
  const shapes = [...tally.shapes.entries()].map(([s, n]) => `${s}=${String(n)}`).join(" ");
  return (
    `[leak-property] ${name}: seed=${String(seed)} runs=${String(LEAK_RUNS)} ` +
    `cases=${String(tally.cases)} placed=${String(tally.placed)} removed=${String(tally.removed)} ` +
    `residual=${String(tally.residual)} pinned=${String(tally.pinned)} ` +
    `refused=${String(tally.refused)} ${shapes}`
  );
}

/**
 * A sentinel token: `ZQLK`, four generated capitals, then a two-digit index and `X`. Capitals only,
 * so it needs no escape in any format and cannot read as a date, a number or a code.
 */
export const sentinelStem: fc.Arbitrary<string> = fc
  .stringMatching(/^[A-Z]{4}$/)
  .map((s) => `ZQLK${s}`);

/** The `index`-th sentinel of a case from its stem. */
export function sentinelAt(stem: string, index: number): string {
  return `${stem}${String(index).padStart(2, "0")}X`;
}

/**
 * Run one adapter's property with the shared run count and a printed seed, then hold the tally to the
 * never-silent rule. `check` returns the violations for one case; any violation fails the property.
 */
export function runLeakProperty<T>(
  name: string,
  arbitrary: fc.Arbitrary<T>,
  check: (value: T, tally: LeakTally) => string[],
): LeakTally {
  const seed = leakSeed();
  const tally = newTally();
  // Printed before the run, so a run that hangs or dies still names its seed.
  process.stdout.write(`[leak-property] ${name}: seed=${String(seed)} runs=${String(LEAK_RUNS)}\n`);
  fc.assert(
    fc.property(arbitrary, (value) => {
      const violations = check(value, tally);
      if (violations.length > 0) throw new Error(violations.join("\n"));
    }),
    { seed, numRuns: LEAK_RUNS },
  );
  process.stdout.write(`${describeRun(name, seed, tally)}\n`);
  const reasons = silentRunReasons(tally);
  if (reasons.length > 0) throw new Error(`${name} ran silently: ${reasons.join("; ")}`);
  return tally;
}

/**
 * The tamper proof: the sweep must catch a sentinel put back into a REAL output of the adapter, and one
 * put into its manifest. Returns what the sweep said about each, for the caller to assert on.
 */
export function tamper(
  placements: readonly Placement[],
  outcome: PassOutcome,
): { readonly inOutput: string; readonly inManifest: string } {
  const [first] = placements;
  if (first === undefined) throw new Error("the tamper case placed no sentinel");
  const inOutput = sweep([first], {
    ...outcome,
    refused: false,
    output: `${outcome.output}${first.sentinel}`,
    residualAt: () => false,
  }).join("\n");
  const inManifest = sweep([first], { ...outcome, manifest: [{ locus: first.sentinel }] }).join(
    "\n",
  );
  return { inOutput, inManifest };
}
