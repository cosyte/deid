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
 * - **§164.514(e)(2)(ii) is the list's only PARTIAL exclusion.** It removes "Postal address
 *   information, **other than town or city, State, and zip code**", so those three named parts of an
 *   address survive a limited data set while the street, the county or parish, the census tract and
 *   the country do not. That is why the geographic class permits named **parts**
 *   ({@link isRetainablePart}) and `GEOGRAPHIC` stays a category no profile may retain whole
 *   ({@link isRetainableCategory}).
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
  /**
   * The **named parts of a postal address** §164.514(e)(2)(ii) permits a limited data set to carry.
   * The clause excludes "Postal address information, **other than town or city, State, and zip
   * code**", which makes it the **only PARTIAL exclusion** in the list of sixteen: three named parts
   * survive and everything else in the address does not.
   *
   * **What survives**: town or city, State, and the **whole** zip code. The digit limit and the
   * `000` substitution are §164.514(b)(2)(i)(B), which is **Safe Harbor's** rule; (e)(2) states no
   * digit limit and no population condition, so the ZIP is kept in full here.
   *
   * **What does not**: the street address, any second address line, the county or parish, the
   * census tract or other geographic designation, the country, and a birth place. None of those is
   * named by the clause, so none of them is widened by this class.
   *
   * **It permits PARTS, never the category.** `GEOGRAPHIC` stays on
   * {@link LIMITED_DATA_SET_DIRECT_IDENTIFIERS} and {@link isRetainableCategory} still returns
   * `false` for it, because a partial exclusion is not a whole-category one. The only route past
   * that guard is {@link isRetainablePart}, which is keyed on this class, that category and one of
   * the three names above.
   *
   * **Scope, stated rather than implied**: only the **HL7 v2** adapter reads this class today, like
   * every other. Under the C-CDA, FHIR, X12, NCPDP and DICOM adapters an address is reduced exactly
   * as it is without it (the Safe Harbor generalization), which is the stricter direction.
   */
  LIMITED_DATA_SET_GEOGRAPHY: "limited-data-set-geography",
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
 * The **three parts of a postal address §164.514(e)(2)(ii) names as surviving** a limited data set,
 * in the regulation's own words: "other than **town or city, State, and zip code**". Nothing else in
 * an address is named, so nothing else survives: not the street, not a second address line, not the
 * county or parish, not the census tract, not the country, not a birth place.
 *
 * @example
 * ```ts
 * import { LIMITED_DATA_SET_ADDRESS_PARTS } from "@cosyte/deid";
 *
 * LIMITED_DATA_SET_ADDRESS_PARTS.ZIP_CODE; // => "zip-code"
 * ```
 */
export const LIMITED_DATA_SET_ADDRESS_PARTS = {
  /** "town or city": the populated place, and nothing finer. */
  TOWN_OR_CITY: "town-or-city",
  /** "State": the state or province the address sits in. */
  STATE: "state",
  /** "zip code": the WHOLE zip code. The three-digit rule is Safe Harbor's, not (e)(2)'s. */
  ZIP_CODE: "zip-code",
} as const;

/**
 * A value from {@link LIMITED_DATA_SET_ADDRESS_PARTS}: the **named part** of an otherwise-excluded
 * category that an adapter proposes keeping, and that {@link isRetainablePart} checks.
 *
 * @example
 * ```ts
 * import { LIMITED_DATA_SET_ADDRESS_PARTS, type RetainedLocusPart } from "@cosyte/deid";
 *
 * const part: RetainedLocusPart = LIMITED_DATA_SET_ADDRESS_PARTS.STATE;
 * ```
 */
export type RetainedLocusPart =
  (typeof LIMITED_DATA_SET_ADDRESS_PARTS)[keyof typeof LIMITED_DATA_SET_ADDRESS_PARTS];

/** The three permitted part names, as a set, so membership is a lookup rather than a chain. */
const ADDRESS_PART_VALUES: ReadonlySet<string> = new Set<string>(
  Object.values(LIMITED_DATA_SET_ADDRESS_PARTS),
);

/**
 * Whether a **named part** of a locus whose category is otherwise excluded may be retained. This is
 * the **only** route past {@link isRetainableCategory}, and it is narrow by construction: all three
 * of the class, the resolved category and the part name must line up, and each is an allow-list
 * membership rather than a negation.
 *
 * It exists because §164.514(e)(2)(ii) is the list's only **partial** exclusion. Making `GEOGRAPHIC`
 * retainable as a category would keep a county code, a birth place and a street address along with
 * the three parts the clause names, so the category stays excluded and the parts are named here.
 *
 * @param cls - The retention class the adapter proposed for the locus.
 * @param category - The resolved Safe Harbor category of the locus.
 * @param part - The named part the adapter proposed keeping.
 * @returns `true` only for the geographic class, the `GEOGRAPHIC` category, and a named address part.
 * @example
 * ```ts
 * import {
 *   isRetainablePart,
 *   LIMITED_DATA_SET_ADDRESS_PARTS,
 *   RETAINED_LOCUS_CLASSES,
 *   SAFE_HARBOR_CATEGORIES,
 * } from "@cosyte/deid";
 *
 * const geo = RETAINED_LOCUS_CLASSES.LIMITED_DATA_SET_GEOGRAPHY;
 * isRetainablePart(geo, SAFE_HARBOR_CATEGORIES.GEOGRAPHIC, LIMITED_DATA_SET_ADDRESS_PARTS.STATE); // => true
 * isRetainablePart(geo, SAFE_HARBOR_CATEGORIES.NAMES, LIMITED_DATA_SET_ADDRESS_PARTS.STATE); // => false
 * ```
 */
export function isRetainablePart(
  cls: RetainedLocusClass,
  category: SafeHarborCategory,
  part: RetainedLocusPart,
): boolean {
  return (
    cls === RETAINED_LOCUS_CLASSES.LIMITED_DATA_SET_GEOGRAPHY &&
    category === SAFE_HARBOR_CATEGORIES.GEOGRAPHIC &&
    ADDRESS_PART_VALUES.has(part)
  );
}

/**
 * Whether a value is a **whole zip code** this library will carry through unreduced under
 * {@link RETAINED_LOCUS_CLASSES.LIMITED_DATA_SET_GEOGRAPHY}: five digits, optionally followed by the
 * ZIP+4 add-on with or without its hyphen. Nothing else, and no surrounding whitespace.
 *
 * **It is deliberately stricter than the generalization's input rule, and the asymmetry is the
 * point**: generalization reduces whatever it is given until it is safe, so reading three leading
 * digits off a malformed value is safe. Retention emits the value **unreduced**, so a value whose
 * shape this library cannot vouch for is not retained at all: the locus falls back to the Safe
 * Harbor generalization, which fails closed to dropping the whole address.
 *
 * @param zip - The candidate zip code, exactly as it sits at the locus.
 * @returns `true` only for `12345`, `12345-6789` or `123456789`.
 * @example
 * ```ts
 * import { isRetainableZipCode } from "@cosyte/deid";
 *
 * isRetainableZipCode("62704"); // => true
 * isRetainableZipCode("627"); // => false (a partial ZIP is not a zip code)
 * ```
 */
export function isRetainableZipCode(zip: string): boolean {
  return /^\d{5}(?:-?\d{4})?$/.test(zip);
}

/**
 * The retention classes a profile **declaring** the `limited-data-set` standard may carry: exactly
 * those §164.514(e)(2) leaves out of its sixteen direct identifiers, plus the parts (e)(2)(ii) names.
 *
 * The list has **no date** and **no catch-all**, so encounter dates and encounter / order identifiers
 * survive it; (e)(2)(ii) is a **partial** exclusion, so the three named address parts survive it. A
 * class outside this set is a claim the regulation does not support, and
 * {@link assertLimitedDataSetRetention} refuses it rather than letting the profile wear the name.
 *
 * @example
 * ```ts
 * import { LIMITED_DATA_SET_RETENTION_CLASSES, RETAINED_LOCUS_CLASSES } from "@cosyte/deid";
 *
 * LIMITED_DATA_SET_RETENTION_CLASSES.has(RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES); // => true
 * ```
 */
export const LIMITED_DATA_SET_RETENTION_CLASSES: ReadonlySet<RetainedLocusClass> = new Set([
  RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES,
  RETAINED_LOCUS_CLASSES.ENCOUNTER_IDENTIFIERS,
  RETAINED_LOCUS_CLASSES.LIMITED_DATA_SET_GEOGRAPHY,
]);

/**
 * Enforce §164.514(e)(2) on a profile that **declares** the `limited-data-set` standard: every class
 * it retains must be one {@link LIMITED_DATA_SET_RETENTION_CLASSES} permits. A profile carrying the
 * regulation's name while keeping something the regulation excludes is refused, naming the class,
 * before any locus is transformed.
 *
 * @param subject - What is being checked, for the diagnostic (a profile, a derivation base).
 * @param retainedLoci - The retention classes the profile carries, if any.
 * @throws {@link DeidError} `DEID_PROFILE_INVALID` naming every class outside the permitted set.
 * @example
 * ```ts
 * import { assertLimitedDataSetRetention } from "@cosyte/deid";
 *
 * assertLimitedDataSetRetention("a profile", ["encounter-dates"]); // ok
 * ```
 */
export function assertLimitedDataSetRetention(
  subject: string,
  retainedLoci: readonly RetainedLocusClass[] | undefined,
): void {
  if (retainedLoci === undefined || retainedLoci.length === 0) {
    return;
  }
  const beyond = retainedLoci.filter((cls) => !LIMITED_DATA_SET_RETENTION_CLASSES.has(cls));
  if (beyond.length === 0) {
    return;
  }
  throw new DeidError(
    FATAL_CODES.DEID_PROFILE_INVALID,
    `${subject} declaring the "limited-data-set" standard may not retain the locus class(es) ` +
      `${beyond.map((c) => `"${c}"`).join(", ")}: §164.514(e)(2) excludes them from a limited ` +
      "data set. Drop the class, or declare a custom standard.",
  );
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
