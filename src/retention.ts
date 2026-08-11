/**
 * **Policy-scoped retention classes**: the named, enumerated groups of *identifying* loci that a
 * profile may deliberately pass through **untouched**, and that a stricter profile removes.
 *
 * This is the format-agnostic half of a decision the HL7 v2 adapter (and, in time, the other format
 * adapters) makes at extraction: whether a locus that lives inside an otherwise-retained clinical or
 * visit structure is *kept* or *acted on*. It exists because the two standards this library models
 * draw the line in **different places**, and reading either one off the other is a compliance trap:
 *
 * - **Safe Harbor, §164.514(b)(2)(i)(C)**, requires removal of *all elements of dates (except year)
 *   directly related to an individual*, and names **admission and discharge dates** among them. The
 *   catch-all, **(R)**, then requires removal of *any other unique identifying number, characteristic,
 *   or code*, which is what a visit/encounter number and a placer/filler order number are. So under a
 *   Safe-Harbor-labelled policy **neither class may be retained**, and the built-in Safe Harbor
 *   profile retains **nothing**.
 * - **A limited data set, §164.514(e)(2)**, excludes an enumerated list of **sixteen** direct
 *   identifiers. That list contains **no dates at all** and **no catch-all**: it names names, postal
 *   address detail, telephone, fax, email, social security, medical record, health plan beneficiary,
 *   account, certificate/licence, vehicle, device, URL, IP, biometric, and full-face-image
 *   identifiers, and stops. Admission, discharge and service dates, and an encounter or order number,
 *   are therefore **permitted to remain** in a limited data set.
 *
 * **Retention is never silent.** A locus retained under a class is still recorded in the value-free
 * manifest as a `DEID_RESIDUAL_RETAINED` residual, so it reaches the retained-quasi-identifier
 * inventory a determiner reads. A retained identifier that no artifact names is invisible twice over,
 * which is the failure mode this module is designed against.
 *
 * **The default is retain-nothing.** Every entry point defaults to an empty retention set, so an
 * options bag that never mentions retention gets the strict treatment (fail closed).
 *
 * @packageDocumentation
 */

/**
 * The stable registry of retention classes. `key === value` so the full set survives an
 * `Object.values(...)` snapshot into a stability tripwire. These are part of the public contract:
 * renaming or removing one is a **breaking change**; new classes may be **added** in a later release.
 *
 * @example
 * ```ts
 * import { RETAINED_LOCUS_CLASSES } from "@cosyte/deid";
 *
 * RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES; // => "encounter-dates"
 * ```
 */
export const RETAINED_LOCUS_CLASSES = {
  /**
   * Patient-related **dates** carried by retained clinical / visit structures: admission, discharge,
   * observation / service, and diagnosis dates. These are elements of dates directly related to the
   * individual, so **Safe Harbor removes them** (only the year may remain); a limited data set
   * **may keep them**, because §164.514(e)(2)'s direct-identifier list names no date.
   */
  ENCOUNTER_DATES: "encounter-dates",
  /**
   * **Encounter and order identifiers**: the visit / encounter number, and the placer and filler order
   * numbers. These are not one of the seventeen concrete Safe Harbor identifier types, so Safe Harbor
   * reaches them through the **(R)** catch-all and they are blocked; §164.514(e)(2) has **no**
   * catch-all, so a limited data set **may keep them**.
   */
  ENCOUNTER_IDENTIFIERS: "encounter-identifiers",
} as const;

/**
 * A value from {@link RETAINED_LOCUS_CLASSES}: the class a profile lists to keep, and an adapter
 * checks before it passes a locus through.
 *
 * @example
 * ```ts
 * import { RETAINED_LOCUS_CLASSES, type RetainedLocusClass } from "@cosyte/deid";
 *
 * const cls: RetainedLocusClass = RETAINED_LOCUS_CLASSES.ENCOUNTER_IDENTIFIERS;
 * ```
 */
export type RetainedLocusClass =
  (typeof RETAINED_LOCUS_CLASSES)[keyof typeof RETAINED_LOCUS_CLASSES];

/** The empty retention set: the fail-closed default every entry point uses. */
export const NO_RETAINED_LOCI: readonly RetainedLocusClass[] = Object.freeze([]);

/**
 * Test whether a retention class is enabled by a (possibly absent) retention set. An absent or empty
 * set retains **nothing**, so a caller that never mentions retention gets the strict treatment.
 *
 * @param classes - The retention classes a profile or options bag enabled, if any.
 * @param cls - The class to test.
 * @returns `true` only when `classes` is present and lists `cls`.
 * @example
 * ```ts
 * import { retains, RETAINED_LOCUS_CLASSES } from "@cosyte/deid";
 *
 * retains(undefined, RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES); // => false (fail closed)
 * retains(["encounter-dates"], RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES); // => true
 * ```
 */
export function retains(
  classes: readonly RetainedLocusClass[] | undefined,
  cls: RetainedLocusClass,
): boolean {
  return classes !== undefined && classes.includes(cls);
}
