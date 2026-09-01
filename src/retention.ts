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
 * **Scope, stated rather than implied: only the HL7 v2 adapter reads these classes today.** Passing a
 * retention set to the C-CDA, FHIR, X12, NCPDP or DICOM adapter changes nothing there, so one profile
 * means something narrower for those five formats than it does for HL7 v2. The direction is the safe
 * one (they stay stricter, never looser) and there is no diagnostic for it, which is why it is written
 * here.
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "./categories.js";
import { DeidError, FATAL_CODES } from "./codes.js";

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

/**
 * The **sixteen direct identifiers §164.514(e)(2) excludes from a limited data set**, mapped onto this
 * library's category model: (i) names, (ii) postal address other than town/city/State/ZIP,
 * (iii) telephone, (iv) fax, (v) email, (vi) social security, (vii) medical record, (viii) health plan
 * beneficiary, (ix) account, (x) certificate/licence, (xi) vehicle, (xii) device, (xiii) URL, (xiv) IP,
 * (xv) biometric, (xvi) full-face image.
 *
 * **This is the guard that makes the retention citation true rather than merely asserted.** The
 * argument for keeping an encounter or order number is that this list has no catch-all; the argument
 * for keeping a service date is that it has no date. **Neither argument survives if the value at the
 * locus turns out to be one of the sixteen** -- and a visit number field routinely carries a medical
 * record or account number, typed as such by the standard's own identifier-type code. So retention is
 * **refused** whenever the resolved category is on this list, whatever an adapter asked for, in both
 * the adapter and the engine.
 *
 * Exactly two of the eighteen Safe Harbor categories are absent from it: `DATES` and the (R) catch-all
 * `OTHER_UNIQUE_ID`. Those two, and only those two, are retainable.
 *
 * @example
 * ```ts
 * import { LIMITED_DATA_SET_DIRECT_IDENTIFIERS, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * LIMITED_DATA_SET_DIRECT_IDENTIFIERS.has(SAFE_HARBOR_CATEGORIES.MRN); // => true  (never retainable)
 * LIMITED_DATA_SET_DIRECT_IDENTIFIERS.has(SAFE_HARBOR_CATEGORIES.DATES); // => false (retainable)
 * ```
 */
export const LIMITED_DATA_SET_DIRECT_IDENTIFIERS: ReadonlySet<SafeHarborCategory> = new Set([
  SAFE_HARBOR_CATEGORIES.NAMES,
  SAFE_HARBOR_CATEGORIES.GEOGRAPHIC,
  SAFE_HARBOR_CATEGORIES.PHONE,
  SAFE_HARBOR_CATEGORIES.FAX,
  SAFE_HARBOR_CATEGORIES.EMAIL,
  SAFE_HARBOR_CATEGORIES.SSN,
  SAFE_HARBOR_CATEGORIES.MRN,
  SAFE_HARBOR_CATEGORIES.HEALTH_PLAN_BENEFICIARY,
  SAFE_HARBOR_CATEGORIES.ACCOUNT,
  SAFE_HARBOR_CATEGORIES.CERTIFICATE_LICENSE,
  SAFE_HARBOR_CATEGORIES.VEHICLE,
  SAFE_HARBOR_CATEGORIES.DEVICE,
  SAFE_HARBOR_CATEGORIES.URL,
  SAFE_HARBOR_CATEGORIES.IP_ADDRESS,
  SAFE_HARBOR_CATEGORIES.BIOMETRIC,
  SAFE_HARBOR_CATEGORIES.FULL_FACE_PHOTO,
]);

/**
 * Whether a locus of this category may be retained at all. `false` for every one of the sixteen direct
 * identifiers {@link LIMITED_DATA_SET_DIRECT_IDENTIFIERS} names, whatever retention class an adapter
 * attached to it.
 *
 * @param category - The resolved Safe Harbor category of the locus.
 * @returns `true` only for `DATES` and the (R) catch-all.
 * @example
 * ```ts
 * import { isRetainableCategory, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * isRetainableCategory(SAFE_HARBOR_CATEGORIES.MRN); // => false
 * isRetainableCategory(SAFE_HARBOR_CATEGORIES.DATES); // => true
 * ```
 */
export function isRetainableCategory(category: SafeHarborCategory): boolean {
  return !LIMITED_DATA_SET_DIRECT_IDENTIFIERS.has(category);
}

/**
 * Enforce the **label contract on retention**, failing closed: a policy carrying the reserved
 * `safe-harbor` label may not run with a non-empty retention set. Retaining an admission date or an
 * encounter number is strictly weaker than the transform the label promises, so allowing it would let
 * an options bag emit a Safe-Harbor-labelled result that is not Safe Harbor. This is the retention
 * analogue of the guard that stops a date-shifting policy wearing the same label, and it closes the
 * hand-built-options route that no profile check can see.
 *
 * @param policyName - The name of the resolved policy.
 * @param retainedLoci - The retention classes the options bag carries, if any.
 * @throws {@link DeidError} `DEID_POLICY_INVALID` when a `safe-harbor`-labelled policy is asked to retain.
 * @example
 * ```ts
 * import { assertRetentionContract } from "@cosyte/deid";
 *
 * assertRetentionContract("limited-data-set", ["encounter-dates"]); // ok
 * assertRetentionContract("safe-harbor", []); // ok (retains nothing)
 * ```
 */
export function assertRetentionContract(
  policyName: string,
  retainedLoci: readonly RetainedLocusClass[] | undefined,
): void {
  if (policyName !== "safe-harbor" || retainedLoci === undefined || retainedLoci.length === 0) {
    return;
  }
  throw new DeidError(
    FATAL_CODES.DEID_POLICY_INVALID,
    'a policy carrying the reserved "safe-harbor" label must not retain any identifying locus: ' +
      `retention of ${retainedLoci.map((c) => `"${c}"`).join(", ")} keeps elements Safe Harbor ` +
      "removes. Name the policy distinctly.",
  );
}

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
