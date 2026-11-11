/**
 * The **generalization** transforms: reduce precision until a value is no longer identifying. The
 * three regulation-mandated generalizations of 45 CFR §164.514(b)(2)(i):
 *
 * - **date → year** (C): keep only the four-digit year.
 * - **ZIP → initial three digits, or `000`** (B): retain the three-digit prefix unless its area has
 *   ≤ 20,000 people (the cited restricted list), in which case the prefix becomes `000`.
 * - **age → `90+`** (C): any age over 89 is aggregated to `"90+"`.
 *
 * Each function **fails closed**: it returns `null` when it cannot confidently generalize, so the
 * engine blocks the locus rather than passing an unreduced value through as safe.
 *
 * @packageDocumentation
 */

import { RESTRICTED_ZIP3 } from "../restricted-zip.js";

/**
 * The outcome of a generalization: the reduced value plus whether it retains a coarse **residual**
 * (a kept year, a retained safe 3-digit ZIP prefix) that the manifest must surface for the
 * actual-knowledge test, versus a fully non-identifying result (`000`, `90+`).
 */
export interface GeneralizeOutcome {
  /** The generalized value. */
  readonly value: string;
  /** `true` when a coarse identifying residual was retained; `false` when fully suppressed. */
  readonly residual: boolean;
}

/** Extract a four-digit year from the front of a date string, or `null` if none is present. */
function extractYear(value: string): string | null {
  const match = /^\s*(\d{4})/.exec(value);
  if (match === null) {
    return null;
  }
  const year = Number(match[1]);
  // Guard against an implausible year (e.g. a leading-zero value) that signals the field is not a date.
  if (year < 1000) {
    return null;
  }
  /* v8 ignore next -- group 1 is not optional in the pattern, so it is defined whenever the match is */
  return match[1] ?? null;
}

/**
 * Generalize a date to its **year** (§164.514(b)(2)(i)(C)). Accepts common encodings: ISO
 * `YYYY-MM-DD` / `YYYY-MM-DDThh:mm:ss`, HL7 `YYYYMMDD`, anything beginning with a plausible
 * four-digit year. Fails closed (`null`) when no year can be extracted; the retained year is a
 * residual.
 *
 * @param value - The date value to generalize.
 * @returns The `{ value: year, residual: true }` outcome, or `null` if no year is present.
 * @example
 * ```ts
 * import { generalizeDate } from "@cosyte/deid";
 *
 * generalizeDate("2019-03-14")?.value; // => "2019"
 * generalizeDate("not-a-date");        // => null
 * ```
 */
export function generalizeDate(value: string): GeneralizeOutcome | null {
  const year = extractYear(value);
  if (year === null) {
    return null;
  }
  // A retained year is a coarse residual, surfaced for the actual-knowledge test.
  return { value: year, residual: true };
}

/**
 * Whether a year kept from a **date of birth** is indicative of an age over 89
 * (§164.514(b)(2)(i)(C)): the year is 90 or more years before `referenceYear`. By year alone, so a
 * person who turns 90 in the reference year is counted whether or not the birthday has passed: the
 * year cannot say, and the rule aggregates every year that may show such an age.
 *
 * @param year - The four-digit year {@link generalizeDate} kept.
 * @param referenceYear - The year the age is measured at.
 * @returns `true` when the year must be aggregated rather than kept.
 * @internal
 */
export function birthYearShowsAgeOver89(year: string, referenceYear: number): boolean {
  return referenceYear - Number(year) > 89;
}

/**
 * Years per unit an age may be written in: the UCUM codes for a year, a month, a week, a day, an hour
 * and a minute (the mean Julian and Gregorian forms included), and the spelled-out words a producer
 * writes when it gives no UCUM code. Matched without regard to case. An empty unit is a year: an age
 * observation that states no unit is read as the unit an age is given in by default.
 */
const YEARS_PER_UNIT: ReadonlyMap<string, number> = new Map([
  ["", 1],
  ["a", 1],
  ["a_j", 1],
  ["a_g", 1],
  ["ann", 1],
  ["y", 1],
  ["yr", 1],
  ["yrs", 1],
  ["year", 1],
  ["years", 1],
  ["mo", 1 / 12],
  ["mo_j", 1 / 12],
  ["mo_g", 1 / 12],
  ["month", 1 / 12],
  ["months", 1 / 12],
  ["wk", 7 / 365.25],
  ["week", 7 / 365.25],
  ["weeks", 7 / 365.25],
  ["d", 1 / 365.25],
  ["day", 1 / 365.25],
  ["days", 1 / 365.25],
  ["h", 1 / 8766],
  ["hour", 1 / 8766],
  ["hours", 1 / 8766],
  ["min", 1 / 525960],
]);

/**
 * An age written as a number in a unit, in **years**, or `null` when it cannot be read: the value is
 * not a plain non-negative decimal, or the unit is not one {@link YEARS_PER_UNIT} names. A caller fails
 * closed on `null`.
 *
 * @param value - The age as the document writes it (`"93"`, `"18"`, `"45.5"`).
 * @param unit - The unit as the document writes it (`"a"`, `"mo"`, `"years"`, or `""` for none).
 * @returns The age in years, or `null`.
 * @internal
 */
export function ageInYears(value: string, unit: string): number | null {
  if (!/^\s*\+?(?:\d+(?:\.\d*)?|\.\d+)\s*$/.test(value)) return null;
  const perUnit = YEARS_PER_UNIT.get(unit.trim().toLowerCase());
  if (perUnit === undefined) return null;
  return Number(value) * perUnit;
}

/**
 * Generalize a ZIP code to its safe form (§164.514(b)(2)(i)(B)): the initial three digits, or `000`
 * when those three digits name an area with ≤ 20,000 people (the cited restricted list). Fails closed
 * (`null`) when three leading digits cannot be read.
 *
 * @param zip - The ZIP code (5-digit, ZIP+4, or any form beginning with digits).
 * @returns The `{ value, residual }` outcome (`residual: false` for `000`, `true` for a kept prefix),
 *   or `null` if fewer than three leading digits are present.
 * @example
 * ```ts
 * import { generalizeZip } from "@cosyte/deid";
 *
 * generalizeZip("90210")?.value; // => "902"
 * generalizeZip("03601")?.value; // => "000"  (036 is a restricted prefix)
 * ```
 */
export function generalizeZip(zip: string): GeneralizeOutcome | null {
  const digits = zip.replace(/\D/g, "");
  if (digits.length < 3) {
    return null;
  }
  const prefix = digits.slice(0, 3);
  if (RESTRICTED_ZIP3.has(prefix)) {
    // Fully suppressed, no identifying residual remains.
    return { value: "000", residual: false };
  }
  return { value: prefix, residual: true };
}

/**
 * Generalize an age (§164.514(b)(2)(i)(C)): any age **over 89** aggregates to `"90+"`; ages 0 to 89 are
 * retained (a residual). Fails closed (`null`) for a non-finite or negative age.
 *
 * @param age - The age in years.
 * @returns The `{ value, residual }` outcome (`residual: false` for `"90+"`, `true` for a kept age),
 *   or `null` if the age is not a finite non-negative number.
 * @example
 * ```ts
 * import { generalizeAge } from "@cosyte/deid";
 *
 * generalizeAge(92)?.value; // => "90+"
 * generalizeAge(89)?.value; // => "89"
 * ```
 */
export function generalizeAge(age: number): GeneralizeOutcome | null {
  if (!Number.isFinite(age) || age < 0) {
    return null;
  }
  if (age > 89) {
    return { value: "90+", residual: false };
  }
  return { value: String(Math.floor(age)), residual: true };
}
