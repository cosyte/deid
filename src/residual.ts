/**
 * **Unexamined residual positions**: the measurement that tells an *empty* residual inventory apart
 * from an *unmeasured* one.
 *
 * The engine fails closed on **structures**: an unrecognized segment, resource, loop or extension is
 * blocked. It does not fail closed on **positions inside a structure it hands through**. A value-bearing
 * position inside such a structure that no locus rule names is passed through untouched, and until this
 * module existed it was recorded nowhere at all. The consequence was not the pass-through, which is a
 * stated limitation a consumer can filter for, but the **silence**: a support report whose residual
 * inventories are empty reads the same whether the pass found nothing or measured nothing, and a
 * determiner acts on that emptiness.
 *
 * So every such position is **counted and located**, in the value-free record, as an
 * {@link UnexaminedResidual}. Three things follow, and each is load-bearing:
 *
 * - **Counting is not removal.** Nothing is scrubbed, generalized or blocked on account of a count.
 *   What to do about a measured residual is a separate decision made with the number in hand, and the
 *   mirror risk of acting now is over-removal, which destroys clinical meaning.
 * - **An unexamined position has no Safe Harbor category**, because no rule established one. It is not
 *   an allegation of PHI: a clinical code, a dose unit and an order status all sit at positions no locus
 *   rule names. A residual record therefore never joins the 18-category coverage and never moves the
 *   count of categories a pass acted on.
 * - **The record is value-free like everything else here**: the structural locus, a count and the fact
 *   of being unexamined. Never a value, never a key, never a date-shift offset. A diagnostic about PHI
 *   the pass could not examine would be a PHI leak in the audit trail, which is the one exposure no
 *   later run can undo.
 *
 * ## The two fail-safes
 *
 * - **A locus that cannot be expressed is still counted.** An adapter builds a locus by interpolating an
 *   identifier it read out of the document, and that identifier is only an identifier by convention (see
 *   `./derived-token.ts`). When the position's locus cannot be expressed the record is written under
 *   {@link WITHHELD_LOCUS_TOKEN} and flagged {@link UnexaminedResidual.locusWithheld}. It is **never**
 *   dropped from the count: losing the "where" must not also lose the "how many".
 * - **A structure that cannot be enumerated fails the pass.** {@link failUnenumerableStructure} throws a
 *   typed, value-free fatal rather than let the pass emit a zero or a partial count for that document.
 *   Both of those read as a measurement, and a measurement nobody can qualify is worse than a failure.
 *
 * @packageDocumentation
 */

import { DeidError, DEID_DISPOSITION_CODES, FATAL_CODES } from "./codes.js";
import { WITHHELD_LOCUS_TOKEN } from "./derived-token.js";

/**
 * One **value-bearing position a pass handed through that no locus rule named**, counted and located in
 * the value-free record.
 *
 * @example
 * ```ts
 * import { type UnexaminedResidual } from "@cosyte/deid";
 *
 * const residual: UnexaminedResidual = {
 *   locus: "PV1-7",
 *   count: 1,
 *   examined: false,
 *   locusWithheld: false,
 *   code: "DEID_POSITION_UNEXAMINED",
 * };
 * ```
 */
export interface UnexaminedResidual {
  /**
   * The format-neutral **structural locus** of the position (segment/field index · path · tag), or
   * {@link WITHHELD_LOCUS_TOKEN} when it could not be expressed. **Never** a value, a key or an offset.
   */
  readonly locus: string;
  /** How many value-bearing positions at this locus were handed through unexamined. */
  readonly count: number;
  /**
   * Always `false`: the fact this record exists to state. No locus rule reached the position, so the
   * pass neither acted on it, nor blocked it, nor decided to keep it. A literal rather than a
   * convention, so a consumer merging inventories cannot mistake one of these for an acted-on entry.
   */
  readonly examined: false;
  /**
   * `true` when the position's structural locus **could not be expressed** and {@link locus} is
   * therefore {@link WITHHELD_LOCUS_TOKEN}. The position is still counted: an inexpressible "where" is
   * never a reason to drop a "how many". Value-free (a boolean).
   */
  readonly locusWithheld: boolean;
  /** The stable disposition code: always `DEID_POSITION_UNEXAMINED`. */
  readonly code: typeof DEID_DISPOSITION_CODES.DEID_POSITION_UNEXAMINED;
}

/**
 * Accumulates {@link UnexaminedResidual} records, aggregating identical loci into one entry with a
 * running `count`. Insertion order is preserved, so an inventory reads in document order.
 *
 * This is the **enumeration contract** an adapter satisfies: for every structure the pass hands through,
 * enumerate its value-bearing positions and {@link record} the ones no locus rule names. An adapter that
 * cannot enumerate a structure's positions calls {@link failUnenumerableStructure} instead of recording
 * a partial answer.
 *
 * @internal
 */
export class UnexaminedResidualBuilder {
  private readonly entries = new Map<string, UnexaminedResidual>();

  /**
   * Record one value-bearing position no locus rule named. Pass `undefined` (or an empty string) as the
   * locus when the position's structural locus cannot be expressed at all: the record is written under
   * {@link WITHHELD_LOCUS_TOKEN} and flagged, never dropped.
   *
   * A locus an adapter composed **around** a refused identifier (`<withheld>-7`, `<withheld>[2]/AM`)
   * is flagged too: the "where" it prints is partial, and a reader must not take a partial locus for a
   * whole one. Its surviving structural coordinates are still emitted, because they are positions and
   * positions are value-free.
   */
  public record(locus: string | undefined): void {
    const empty = locus === undefined || locus.length === 0;
    const key = empty ? WITHHELD_LOCUS_TOKEN : locus;
    const withheld = empty || key.includes(WITHHELD_LOCUS_TOKEN);
    const existing = this.entries.get(key);
    if (existing === undefined) {
      this.entries.set(key, {
        locus: key,
        count: 1,
        examined: false,
        locusWithheld: withheld,
        code: DEID_DISPOSITION_CODES.DEID_POSITION_UNEXAMINED,
      });
      return;
    }
    this.entries.set(key, { ...existing, count: existing.count + 1 });
  }

  /** How many positions have been recorded so far, counts included. A measured number, never an estimate. */
  public get total(): number {
    let total = 0;
    for (const entry of this.entries.values()) total += entry.count;
    return total;
  }

  /** Freeze and return the accumulated records in insertion order. */
  public build(): readonly UnexaminedResidual[] {
    return Object.freeze([...this.entries.values()].map((e) => Object.freeze(e)));
  }
}

/**
 * **The second fail-safe.** Fail the pass because the value-bearing positions of a structure it would
 * hand through cannot be enumerated, so no honest count exists for this document.
 *
 * A zero would say the structure held nothing unexamined and a partial count would understate it; both
 * are read as measurements. The pass therefore returns nothing at all.
 *
 * @param structure - A **bounded structural token** naming the structure (a segment identifier, an
 *   element name, a tag). It reaches a thrown message, so an adapter passes the same bounded token it
 *   would put in a locus, never raw bytes read out of the document.
 * @throws {@link DeidError} always, with the code `DEID_POSITIONS_UNENUMERABLE`.
 * @internal
 */
export function failUnenumerableStructure(structure: string): never {
  const named = structure.length > 0 ? structure : WITHHELD_LOCUS_TOKEN;
  throw new DeidError(
    FATAL_CODES.DEID_POSITIONS_UNENUMERABLE,
    `the value-bearing positions of the structure at ${named} could not be enumerated; ` +
      "no unexamined-residual count is emitted for this pass",
  );
}

/**
 * Run an adapter's per-structure enumeration under the second fail-safe: anything thrown while
 * enumerating a structure's value-bearing positions becomes the typed, value-free
 * `DEID_POSITIONS_UNENUMERABLE` fatal naming that structure.
 *
 * A {@link DeidError} raised inside (a fatal the engine itself decided on: a missing key, an invalid
 * policy) passes through unchanged: it is already a typed, value-free failure and re-labelling it would
 * lose the reason the pass actually failed.
 *
 * @param structure - The bounded structural token naming the structure being enumerated.
 * @param enumerate - The enumeration to run.
 * @returns Whatever `enumerate` returns.
 * @internal
 */
export function enumerateOrFail<T>(structure: string, enumerate: () => T): T {
  try {
    return enumerate();
  } catch (err) {
    if (err instanceof DeidError) throw err;
    return failUnenumerableStructure(structure);
  }
}
