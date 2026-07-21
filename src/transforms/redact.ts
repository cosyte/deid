/**
 * The **redaction / removal** transform — the fail-safe floor of the taxonomy.
 *
 * Redaction deletes the element outright: lowest utility (the data is gone), lowest re-identification
 * risk. It is the default for direct identifiers with no analytic value (SSN, phone, email, URL, IP,
 * license plate), and the conservative fallback whenever the engine is in doubt. A removed value is
 * represented as `null` in the transformed document — the locus is present, its value withheld.
 *
 * @packageDocumentation
 */

/**
 * Redact a value. Returns `null` — the removed-value sentinel used throughout the transformed
 * document. Pure and keyless.
 *
 * @returns `null`, signalling the value has been removed.
 * @example
 * ```ts
 * import { redact } from "@cosyte/deid";
 *
 * redact(); // => null
 * ```
 */
export function redact(): null {
  return null;
}
