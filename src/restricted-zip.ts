/**
 * The **restricted three-digit ZIP prefixes** for HIPAA Safe Harbor — 45 CFR §164.514(b)(2)(i)(B).
 *
 * Safe Harbor retains the **initial three digits of a ZIP code** *only if*, according to the current
 * publicly available Census data, the geographic unit formed by those three digits contains **more
 * than 20,000 people**. For the three-digit prefixes whose population is **20,000 or fewer**, the
 * initial three digits must be changed to **`000`**.
 *
 * This list is the **cited, published** set (never invented — ADR 0018 public-cited-only): the 17
 * three-digit ZCTAs enumerated in the HHS Office for Civil Rights *Guidance Regarding Methods for
 * De-identification of Protected Health Information* (2012), derived from **2000 Census** data. Getting
 * this list wrong under-generalizes a rural patient (a leak), so it is versioned and cited, and a
 * consumer who must apply a different Census vintage supplies their own via a policy (a later phase).
 *
 * @packageDocumentation
 */

/**
 * The Census vintage this list is grounded in, surfaced so a consumer knows exactly which published
 * artifact the `000` rule is applied from.
 *
 * @example
 * ```ts
 * import { RESTRICTED_ZIP3_SOURCE } from "@cosyte/deid";
 *
 * RESTRICTED_ZIP3_SOURCE.census; // => "2000"
 * ```
 */
export const RESTRICTED_ZIP3_SOURCE = Object.freeze({
  census: "2000",
  citation:
    "HHS OCR, Guidance Regarding Methods for De-identification of PHI (2012); 45 CFR §164.514(b)(2)(i)(B)",
});

/**
 * The 17 restricted three-digit ZIP prefixes (population ≤ 20,000 per 2000 Census). A ZIP whose first
 * three digits are in this set is generalized to `000`; any other prefix retains its three digits.
 *
 * @example
 * ```ts
 * import { RESTRICTED_ZIP3 } from "@cosyte/deid";
 *
 * RESTRICTED_ZIP3.has("036"); // => true
 * RESTRICTED_ZIP3.has("902"); // => false
 * ```
 */
export const RESTRICTED_ZIP3: ReadonlySet<string> = new Set([
  "036",
  "059",
  "063",
  "102",
  "203",
  "556",
  "692",
  "790",
  "821",
  "823",
  "830",
  "831",
  "878",
  "879",
  "884",
  "890",
  "893",
]);
