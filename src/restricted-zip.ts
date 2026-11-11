/**
 * The **restricted three-digit ZIP prefixes** for HIPAA Safe Harbor: 45 CFR §164.514(b)(2)(i)(B).
 *
 * Safe Harbor retains the **initial three digits of a ZIP code** *only if*, according to the current
 * publicly available Census data, the geographic unit formed by combining all ZIP codes with the same
 * three initial digits contains **more than 20,000 people**. For the three-digit prefixes whose
 * population is **20,000 or fewer**, the initial three digits must be changed to **`000`**.
 *
 * This list is the union of two published sources, never invented:
 *
 * - the prefixes whose **2020 Census** population is 20,000 or fewer: table P1 (total population) of
 *   the Demographic and Housing Characteristics File, by five-digit ZIP Code Tabulation Area (ZCTA),
 *   summed over the ZCTAs that share the first three digits. That gives 18 prefixes, the same 18 the
 *   2010 Census gives;
 * - the 17 prefixes the HHS Office for Civil Rights *Guidance Regarding Methods for De-identification
 *   of Protected Health Information* (2012) lists from **2000 Census** data. Five of them (`063`,
 *   `790`, `830`, `831`, `890`) are over 20,000 in the 2020 Census; they stay on the list so no ZIP
 *   this library reduced to `000` before keeps its prefix now.
 *
 * Getting this list wrong under-generalizes a rural patient (a leak), so it is versioned and cited by
 * {@link RESTRICTED_ZIP3_SOURCE}. The list is a fixed export ({@link RESTRICTED_ZIP3}), not a policy
 * option; the limitations page says how it was built and how to rebuild it from a newer census.
 *
 * @packageDocumentation
 */

/**
 * The Census vintage and dataset this list is grounded in, surfaced so a consumer knows exactly which
 * published artifact the `000` rule is applied from.
 *
 * @example
 * ```ts
 * import { RESTRICTED_ZIP3_SOURCE } from "@cosyte/deid";
 *
 * RESTRICTED_ZIP3_SOURCE.census; // => "2020"
 * ```
 */
export const RESTRICTED_ZIP3_SOURCE = Object.freeze({
  census: "2020",
  dataset: "2020 Census Demographic and Housing Characteristics File, table P1, by five-digit ZCTA",
  citation:
    "45 CFR §164.514(b)(2)(i)(B); HHS OCR, Guidance Regarding Methods for De-identification of PHI (2012), whose 2000 Census list is kept",
});

/**
 * The 23 restricted three-digit ZIP prefixes: the 18 whose 2020 Census population is 20,000 or fewer,
 * plus the 5 more the HHS guidance lists from the 2000 Census. A ZIP whose first three digits are in
 * this set is generalized to `000`; any other prefix retains its three digits.
 *
 * @example
 * ```ts
 * import { RESTRICTED_ZIP3 } from "@cosyte/deid";
 *
 * RESTRICTED_ZIP3.has("036"); // => true
 * RESTRICTED_ZIP3.has("369"); // => true
 * RESTRICTED_ZIP3.has("902"); // => false
 * ```
 */
export const RESTRICTED_ZIP3: ReadonlySet<string> = new Set([
  // 2020 Census, 20,000 or fewer (each also on the HHS list unless marked).
  "036",
  "059",
  "102",
  "202", // 2020 only
  "203",
  "204", // 2020 only
  "205", // 2020 only
  "369", // 2020 only
  "556",
  "692",
  "753", // 2020 only
  "772", // 2020 only
  "821",
  "823",
  "878",
  "879",
  "884",
  "893",
  // HHS guidance (2000 Census) only: over 20,000 in 2020, kept so no output loosens.
  "063",
  "790",
  "830",
  "831",
  "890",
]);
