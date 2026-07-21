/**
 * Stable code registries for the de-identification engine — the fatal codes that halt a pass and the
 * value-free **disposition codes** that describe what the engine did at each locus.
 *
 * Both registries are `key === value` so the full set survives an `Object.values(...)` snapshot into a
 * stability tripwire. These codes are part of the public contract: consumers branch on them, so
 * renaming or removing one is a **breaking change**. New codes may be **added** in later phases.
 *
 * @packageDocumentation
 */

/**
 * **Fatal codes** — conditions that abort a de-identification pass by throwing a {@link DeidError}.
 * The engine fails **closed**: it never silently degrades a fatal into a pass-through of PHI.
 *
 * @example
 * ```ts
 * import { FATAL_CODES } from "@cosyte/deid";
 *
 * FATAL_CODES.DEID_NO_KEY; // => "DEID_NO_KEY"
 * ```
 */
export const FATAL_CODES = {
  /** The input model was null/undefined or carried no locus list — nothing to de-identify. */
  EMPTY_INPUT: "EMPTY_INPUT",
  /**
   * A **keyed** transform (pseudonymize / keyed-hash / date-shift) was required for a category present
   * in the model, but no key (or, for date-shift, no per-patient scope) was supplied. The engine
   * **never** falls back to an unkeyed transform — an unkeyed hash of an identifier is re-identifiable.
   */
  DEID_NO_KEY: "DEID_NO_KEY",
} as const;

/**
 * A value from {@link FATAL_CODES} — the code carried by a thrown {@link DeidError}.
 *
 * @example
 * ```ts
 * import { FATAL_CODES, type FatalCode } from "@cosyte/deid";
 *
 * const code: FatalCode = FATAL_CODES.EMPTY_INPUT;
 * ```
 */
export type FatalCode = (typeof FATAL_CODES)[keyof typeof FATAL_CODES];

/**
 * **Disposition codes** — the value-free record of what the engine did at a locus. Every manifest
 * entry carries exactly one. They describe the *action and its residual*, never the value acted on.
 *
 * @example
 * ```ts
 * import { DEID_DISPOSITION_CODES } from "@cosyte/deid";
 *
 * DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED; // => "DEID_LOCUS_BLOCKED"
 * ```
 */
export const DEID_DISPOSITION_CODES = {
  /** A category was removed outright (redaction). */
  DEID_CATEGORY_REMOVED: "DEID_CATEGORY_REMOVED",
  /** A category was generalized to a fully non-identifying form (ZIP → `000`, age → `90+`). */
  DEID_CATEGORY_GENERALIZED: "DEID_CATEGORY_GENERALIZED",
  /** A category was replaced by a consistent keyed-HMAC surrogate (pseudonymization). */
  DEID_CATEGORY_PSEUDONYMIZED: "DEID_CATEGORY_PSEUDONYMIZED",
  /** A date was shifted by a deterministic per-patient offset (interval-preserving). */
  DEID_CATEGORY_DATE_SHIFTED: "DEID_CATEGORY_DATE_SHIFTED",
  /** A value was replaced by a keyed one-way digest (keyed hash). */
  DEID_CATEGORY_HASHED: "DEID_CATEGORY_HASHED",
  /** Fail-closed: an unrecognized / un-locatable / uncertain locus was blocked (value withheld). */
  DEID_LOCUS_BLOCKED: "DEID_LOCUS_BLOCKED",
  /** Fail-closed: a free-text locus was blocked by default (no naive regex scrub). */
  DEID_FREETEXT_BLOCKED: "DEID_FREETEXT_BLOCKED",
  /**
   * A generalization retained a coarse residual (a kept year, a retained safe 3-digit ZIP prefix).
   * Surfaced so a human can apply the §164.514(b)(2)(ii) actual-knowledge test with the facts present.
   */
  DEID_RESIDUAL_RETAINED: "DEID_RESIDUAL_RETAINED",
} as const;

/**
 * A value from {@link DEID_DISPOSITION_CODES} — the code every manifest entry carries.
 *
 * @example
 * ```ts
 * import { DEID_DISPOSITION_CODES, type DeidDispositionCode } from "@cosyte/deid";
 *
 * const code: DeidDispositionCode = DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED;
 * ```
 */
export type DeidDispositionCode =
  (typeof DEID_DISPOSITION_CODES)[keyof typeof DEID_DISPOSITION_CODES];

/**
 * The error thrown on a {@link FATAL_CODES} condition. Carries a stable `code`; its `message` is
 * safe to log — it **never** contains PHI (no value, no key, no offset).
 *
 * @example
 * ```ts
 * import { deidentify, DeidError, FATAL_CODES } from "@cosyte/deid";
 *
 * try {
 *   deidentify(null as never, {});
 * } catch (err) {
 *   if (err instanceof DeidError && err.code === FATAL_CODES.EMPTY_INPUT) {
 *     // handle empty input
 *   }
 * }
 * ```
 */
export class DeidError extends Error {
  /** The stable fatal code. */
  public readonly code: FatalCode;

  /**
   * @param code - The {@link FatalCode} classifying this fatal.
   * @param message - A PHI-free explanation safe to log.
   */
  public constructor(code: FatalCode, message: string) {
    super(message);
    this.name = "DeidError";
    this.code = code;
  }
}
