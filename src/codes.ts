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
  /**
   * A policy violates the key/label contract — most importantly, it applies the interval-preserving
   * **`date-shift`** transform while carrying the reserved **`safe-harbor`** label. A shifted-but-real
   * date is still "an element of a date" under §164.514(b)(2)(i)(C), so date-shift is an
   * Expert-Determination technique, **not** Safe Harbor; labelling it `safe-harbor` would misrepresent
   * the residual risk. The engine rejects it at point of use rather than silently emit shifted real
   * dates under a Safe Harbor claim. (Roadmap §Phase 7; the fatal set is additions-only — §Phase 1.)
   */
  DEID_POLICY_INVALID: "DEID_POLICY_INVALID",
  /**
   * A {@link DeidContext} was configured with an invalid parameter that would silently weaken
   * de-identification — most importantly a `maxShiftDays` that floors to **0**, which pins **every**
   * per-patient date-shift offset to zero, so a `date-shift` policy would emit the **original real
   * dates** under a research label. A no-op shift is a leak, so the engine rejects the degenerate
   * configuration at construction rather than silently shipping unshifted dates. (Additions-only fatal
   * — §Phase 1; §Phase 10 release hardening.)
   */
  DEID_CONTEXT_INVALID: "DEID_CONTEXT_INVALID",
  /**
   * A {@link DeidProfile} spec violates the **widen-never-narrow** contract: a per-site profile derived
   * from a base profile may only move a category to an **equal-or-stronger** transform (more removal,
   * never less), and may never re-weaken a category the base scrubs. A profile that would *reduce* the
   * de-identification strength of any category is rejected, so a site preset can only ever tighten — not
   * quietly loosen — the base standard's protection. (Additions-only fatal — §Phase 10 release
   * hardening; roadmap §Phase 10 policy profiles.)
   */
  DEID_PROFILE_INVALID: "DEID_PROFILE_INVALID",
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
   * A free-text locus was redacted **by a consumer-supplied BYO redactor** (roadmap §Phase 8), not by
   * the library. The library ships **no** NLP/PHI-detection engine; it orchestrates the consumer's
   * redactor at free-text loci and records the outcome here. This code is **consumer-asserted, never a
   * library guarantee**: "no findings" from a BYO redactor is not an attestation, and a redactor's
   * completeness is the consumer's responsibility (Expert-Determination territory — §2.2). The
   * structural PHI removal the format adapters perform is unaffected — this covers only the free *prose*.
   */
  DEID_FREETEXT_CONSUMER_REDACTED: "DEID_FREETEXT_CONSUMER_REDACTED",
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
