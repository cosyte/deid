/**
 * The **generalization** transforms — reduce precision until a value is no longer identifying. The
 * three regulation-mandated generalizations of 45 CFR §164.514(b)(2)(i):
 *
 * - **date → year** (C): keep only the four-digit year.
 * - **ZIP → initial three digits, or `000`** (B): retain the three-digit prefix unless its area has
 *   ≤ 20,000 people (the cited restricted list), in which case the prefix becomes `000`.
 * - **age → `90+`** (C): any age over 89 is aggregated to `"90+"`.
 *
 * Each function **fails closed** — it returns `null` when it cannot confidently generalize, so the
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
  return match[1] ?? null;
}

/**
 * Generalize a date to its **year** (§164.514(b)(2)(i)(C)). Accepts common encodings — ISO
 * `YYYY-MM-DD` / `YYYY-MM-DDThh:mm:ss`, HL7 `YYYYMMDD` — anything beginning with a plausible
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
 * Generalize a ZIP code to its safe form (§164.514(b)(2)(i)(B)): the initial three digits, or `000`
 * when those three digits name an area with ≤ 20,000 people (the cited restricted list). Fails closed
 * (`null`) when three leading digits cannot be read.
 *
 * @param zip - The ZIP code (5-digit, ZIP+4, or any form beginning with digits).
 * @returns The `{ value, residual }` outcome — `residual: false` for `000`, `true` for a kept prefix —
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
    // Fully suppressed — no identifying residual remains.
    return { value: "000", residual: false };
  }
  return { value: prefix, residual: true };
}

/**
 * Generalize an age (§164.514(b)(2)(i)(C)): any age **over 89** aggregates to `"90+"`; ages 0–89 are
 * retained (a residual). Fails closed (`null`) for a non-finite or negative age.
 *
 * @param age - The age in years.
 * @returns The `{ value, residual }` outcome — `residual: false` for `"90+"`, `true` for a kept age —
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
