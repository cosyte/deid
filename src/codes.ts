/**
 * Stable code registries for the de-identification engine: the fatal codes that halt a pass and the
 * value-free **disposition codes** that describe what the engine did at each locus.
 *
 * Both registries are `key === value` so the full set survives an `Object.values(...)` snapshot into a
 * stability tripwire. These codes are part of the public contract: consumers branch on them, so
 * renaming or removing one is a **breaking change**. New codes may be **added** in a later release.
 *
 * @packageDocumentation
 */

/**
 * **Fatal codes**: conditions that abort a de-identification pass by throwing a {@link DeidError}.
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
  /** The input model was null/undefined or carried no locus list, nothing to de-identify. */
  EMPTY_INPUT: "EMPTY_INPUT",
  /**
   * A **keyed** transform (pseudonymize / keyed-hash / date-shift) was required for a category present
   * in the model, but no key (or, for date-shift, no per-patient scope) was supplied. The engine
   * **never** falls back to an unkeyed transform: an unkeyed hash of an identifier is re-identifiable.
   */
  DEID_NO_KEY: "DEID_NO_KEY",
  /**
   * A policy violates the key/label contract: whatever claims the reserved **`safe-harbor`** label,
   * either as a policy **name** or as a profile's declared **standard**, assigns a category a
   * transform whose output for that category is **derived from that category's own value**. A
   * shifted-but-real date is still "an element of a date" under §164.514(b)(2)(i)(C), and a keyed
   * surrogate of a medical record, beneficiary or account number is a code "derived from ...
   * information about the individual", which §164.514(c)(1) does not permit and the (R) exception
   * therefore does not reach. Both are Expert-Determination techniques, **not** Safe Harbor ones, and
   * labelling either `safe-harbor` would misrepresent the residual risk.
   *
   * The refusal names the offending category and transform, carries no value / key / offset, and
   * fires both at mint time and at point of use, so a hand-built policy object cannot slip past. It
   * also covers an assignment that is not a published transform name at all: a pair whose derivation
   * cannot be established is refused, never permitted. A policy that does **not** claim the label is
   * entitled to its keyed surrogate and is applied unchanged. The fatal set is additions-only.
   */
  DEID_POLICY_INVALID: "DEID_POLICY_INVALID",
  /**
   * A {@link DeidContext} was configured with an invalid parameter that would silently weaken
   * de-identification: most importantly a `maxShiftDays` that floors to **0**, which pins **every**
   * per-patient date-shift offset to zero, so a `date-shift` policy would emit the **original real
   * dates** under a research label. A no-op shift is a leak, so the engine rejects the degenerate
   * configuration at construction rather than silently shipping unshifted dates. The fatal set is
   * additions-only.
   */
  DEID_CONTEXT_INVALID: "DEID_CONTEXT_INVALID",
  /**
   * A {@link DeidProfile} spec violates the **widen-never-narrow** contract: a per-site profile derived
   * from a base profile may only move a category to an **equal-or-stronger** transform (more removal,
   * never less), and may never re-weaken a category the base scrubs. A profile that would *reduce* the
   * de-identification strength of any category is rejected, so a site preset can only ever tighten, not
   * quietly loosen, the base standard's protection. The fatal set is additions-only.
   */
  DEID_PROFILE_INVALID: "DEID_PROFILE_INVALID",
  /**
   * The transformed document could not be re-serialized, or no longer round-trips through its own
   * parser: what came back out of the writer is not what the reader reads. A de-identification pass
   * that cannot vouch for the shape of its own output cannot vouch for what a downstream reader will
   * make of the values inside it, so the pass fails rather than hand back a partially transformed
   * document. The fatal set is additions-only.
   */
  DEID_OUTPUT_INVALID: "DEID_OUTPUT_INVALID",
  /**
   * The **value-bearing positions of a structure the pass would hand through could not be enumerated**,
   * so the pass cannot say how much of that structure it never examined.
   *
   * Fail closed on the measurement itself. The alternative outcomes are both worse than a failure: a
   * count of **zero** would tell a determiner the structure held nothing unexamined, and a **partial**
   * count would understate it, and either is read as a measurement rather than as a gap. A pass that
   * cannot enumerate a structure therefore returns nothing at all rather than a number nobody can
   * qualify.
   *
   * The message names the **structure** (a bounded structural token: a segment identifier, an element
   * name, a tag) and carries no value, no key and no offset. The fatal set is additions-only.
   */
  DEID_POSITIONS_UNENUMERABLE: "DEID_POSITIONS_UNENUMERABLE",
  /**
   * A pass would apply a **profile or option that its published coding vocabulary cannot name**, so the
   * machine-readable declaration it is required to write could only be an approximation.
   *
   * Fail closed on the declaration itself. A coded term is read by a downstream system as a property of
   * the document and is acted on **without a human**, so an approximate code is worse than no output at
   * all: it is a claim about what was removed that nobody re-checks, and a document released on a false
   * coded claim cannot be un-released. A pass that cannot name what it did therefore returns nothing
   * rather than a document stamped with a declaration that is not true of it.
   *
   * The message names the **profile or option** (a bounded structural token from the pass's own closed
   * option set, never a value read from the document) and carries no value, no key and no offset. The
   * fatal set is additions-only.
   */
  DEID_DECLARATION_UNNAMEABLE: "DEID_DECLARATION_UNNAMEABLE",
  /**
   * A caller handed an adapter a **document in a format that adapter refuses outright**, rather than
   * the format its entry point de-identifies.
   *
   * Refusal, not best effort. An adapter reaches a document only through the parser surface its peer
   * package publishes, and where that surface cannot express a faithful structural pass, a partial
   * pass is a **false-safety hazard**: it would return a document a consumer reads as
   * Safe-Harbor-transformed while positions the surface never modelled rode straight through it.
   * Refusing is the fail-closed answer and it is the one a test can pin; a documented non-goal in
   * prose is not, because prose is not a behaviour.
   *
   * The message names the **format** and the parser-surface reason, both fixed text this library
   * owns. It carries no value read from the document, no key and no offset, and the pass returns no
   * transformed document, no manifest and no partial output of any kind. The fatal set is
   * additions-only.
   */
  DEID_FORMAT_UNSUPPORTED: "DEID_FORMAT_UNSUPPORTED",
} as const;

/**
 * A value from {@link FATAL_CODES}: the code carried by a thrown {@link DeidError}.
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
 * **Disposition codes**: the value-free record of what the engine did at a locus. Every manifest
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
   * A free-text locus was redacted **by a consumer-supplied BYO redactor**, not by
   * the library. The library ships **no** NLP/PHI-detection engine; it orchestrates the consumer's
   * redactor at free-text loci and records the outcome here. This code is **consumer-asserted, never a
   * library guarantee**: "no findings" from a BYO redactor is not an attestation, and a redactor's
   * completeness is the consumer's responsibility (Expert-Determination territory). The
   * structural PHI removal the format adapters perform is unaffected: this covers only the free *prose*.
   */
  DEID_FREETEXT_CONSUMER_REDACTED: "DEID_FREETEXT_CONSUMER_REDACTED",
  /**
   * A generalization retained a coarse residual (a kept year, a retained safe 3-digit ZIP prefix).
   * Surfaced so a human can apply the §164.514(b)(2)(ii) actual-knowledge test with the facts present.
   */
  DEID_RESIDUAL_RETAINED: "DEID_RESIDUAL_RETAINED",
  /**
   * A **party** was left in place because the role its format types at that party puts it **outside**
   * §164.514(b)(2)(i)'s scope clause (a treating clinician, a facility, a payer, a payee, a submitter,
   * a receiver, a clearinghouse: not the individual, a relative, an employer or a household member).
   * The entry names the party's structural locus and, in `partyRole`, the **role code the pass
   * classified on**, so a retention decision that used to be silent can be audited. It carries no name,
   * no identifier and no other value.
   *
   * It is deliberately **not** `DEID_RESIDUAL_RETAINED`: that code is a residual of the *individual's*
   * own identity (a kept year, a safe ZIP prefix, a whole value a limited-data-set retention set kept)
   * and feeds the determiner's retained-quasi-identifier inventory. A party outside the scope clause is
   * a different fact and stays out of that inventory. The disposition-code set is additions-only.
   */
  DEID_PARTY_ROLE_RETAINED: "DEID_PARTY_ROLE_RETAINED",
  /**
   * A **value-bearing position inside a structure the pass handed through that no locus rule names**.
   * The pass reached **no decision** there: it neither acted on the position, nor blocked it, nor
   * decided to keep it. The record exists so that such a position is counted and located rather than
   * passing through in silence.
   *
   * It is deliberately **not** `DEID_RESIDUAL_RETAINED`, and the difference is the whole point of the
   * code: that one is a residual of a value the pass **examined** (a kept year, a safe 3-digit ZIP
   * prefix, a whole value a retention class kept) and it feeds the determiner's retained-quasi-identifier
   * inventory. This one is the opposite fact, an **unexamined** position, and it has its own inventory
   * so a kept year and a position nothing looked at can never be read as the same thing.
   *
   * **It is a measurement, not an allegation.** An unexamined position is not thereby an identifier: a
   * clinical code, a unit and a status all sit at positions no locus rule names. Nothing is scrubbed,
   * removed or generalized on account of this record, and the position has **no established Safe Harbor
   * category**, because no rule established one. The record carries the structural locus, a count and
   * the fact of being unexamined: never a value, never a key, never an offset. The disposition-code set
   * is additions-only.
   */
  DEID_POSITION_UNEXAMINED: "DEID_POSITION_UNEXAMINED",
} as const;

/**
 * A value from {@link DEID_DISPOSITION_CODES}: the code every manifest entry carries.
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
 * safe to log: it **never** contains PHI (no value, no key, no offset).
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
