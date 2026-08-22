/**
 * The **policy engine**: a policy maps each of the 18 Safe Harbor categories to the transform the
 * engine applies. `safe-harbor` is the built-in default; `defineDeidPolicy` derives a custom policy
 * from it. A policy picks the safest defensible transform per category, grounded in
 * §164.514(b)(2).
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "./categories.js";
import { DeidError, FATAL_CODES } from "./codes.js";

/** The reserved label that only a genuinely Safe-Harbor-conforming policy may carry. */
const SAFE_HARBOR_LABEL = "safe-harbor";

/**
 * The name of a transform a policy can assign to a category. `block` is the fail-closed action
 * (withhold the value); `generalize` selects the correct generalization from the locus kind (date /
 * ZIP / age).
 *
 * `byo-redact` is **not** a policy-assignable Safe Harbor transform and **not** something the library
 * performs: it is the manifest marker the engine records when a **consumer-supplied free-text
 * redactor** redacts a free-text locus. The library bundles no redactor; the
 * consumer brings the detector. Assigning `byo-redact` to a category in a policy has no effect beyond
 * the fail-closed default (the engine blocks it), because free-text redaction is driven by the
 * `redactor` option, not by the per-category policy map.
 *
 * `retain` is likewise **not** policy-assignable: it is the manifest marker for a locus the profile's
 * **retention set** deliberately kept unchanged, which is driven by that set and not by the
 * per-category map. Assigning it to a category fails closed to a block, exactly like `byo-redact`.
 *
 * @example
 * ```ts
 * import { type TransformName } from "@cosyte/deid";
 *
 * const t: TransformName = "pseudonymize";
 * ```
 */
export type TransformName =
  | "redact"
  | "generalize"
  | "date-shift"
  | "pseudonymize"
  | "hash"
  | "block"
  | "byo-redact"
  | "retain";

/** The transforms that require the consumer's key (and, for `date-shift`, a per-patient scope). */
export const KEYED_TRANSFORMS: ReadonlySet<TransformName> = new Set([
  "date-shift",
  "pseudonymize",
  "hash",
]);

/**
 * The eight published transform names, as a runtime set. An assignment that is not one of these
 * cannot be classified, so a `safe-harbor`-labelled policy carrying one is **refused**: a pair whose
 * derivation has not been established is never permitted.
 */
const PUBLISHED_TRANSFORM_NAMES: ReadonlySet<unknown> = new Set<TransformName>([
  "redact",
  "generalize",
  "date-shift",
  "pseudonymize",
  "hash",
  "block",
  "byo-redact",
  "retain",
]);

/**
 * Transforms that **withhold** the value rather than compute a replacement from it. `redact` and
 * `block` withhold by definition; `byo-redact` and `retain` are never performed from the per-category
 * map and each falls closed to a block there, so the pair emits a withholding too. None is ever
 * derived-output, on any category.
 */
const WITHHOLDING_TRANSFORMS: ReadonlySet<TransformName> = new Set([
  "redact",
  "block",
  "byo-redact",
  "retain",
]);

/**
 * The two categories §164.514(b)(2)(i) states a permitted **coarsening** for rather than naming an
 * identifier to remove: (B) geography, where the initial three digits of a ZIP may remain, and (C)
 * dates, where the year may remain and an age over 89 is banded. `generalize` is label-permitted on
 * these two and on no other category.
 */
const COARSENING_PERMITTED_CATEGORIES: ReadonlySet<SafeHarborCategory> = new Set([
  SAFE_HARBOR_CATEGORIES.GEOGRAPHIC,
  SAFE_HARBOR_CATEGORIES.DATES,
]);

/**
 * Whether a (category, transform) pair produces a **derived output**: a value computed from that
 * category's own value, rather than a withholding of it or a coarsening the regulation expressly
 * permits for that category. Open at the bottom: an unpublished or unclassified name is treated as
 * derived-output, so the label contract fails closed.
 */
function isDerivedOutputPair(category: SafeHarborCategory, transform: TransformName): boolean {
  if (!PUBLISHED_TRANSFORM_NAMES.has(transform)) {
    return true;
  }
  if (WITHHOLDING_TRANSFORMS.has(transform)) {
    return false;
  }
  if (transform === "generalize") {
    return !COARSENING_PERMITTED_CATEGORIES.has(category);
  }
  // `pseudonymize`, `hash` and `date-shift` compute the replacement from the value, on all 18
  // categories; anything else published but unclassified falls closed here too.
  return true;
}

/**
 * A de-identification policy: a name plus a per-category transform assignment covering all 18
 * categories.
 *
 * @example
 * ```ts
 * import { SAFE_HARBOR_POLICY } from "@cosyte/deid";
 *
 * SAFE_HARBOR_POLICY.name; // => "safe-harbor"
 * ```
 */
export interface DeidPolicy {
  /** The policy name: surfaced in output labelling ("Safe-Harbor-transformed per the configured policy"). */
  readonly name: string;
  /** The transform applied to each Safe Harbor category. */
  readonly transforms: Readonly<Record<SafeHarborCategory, TransformName>>;
}

/**
 * The built-in **Safe Harbor** policy. Direct identifiers with no analytic value are redacted, and
 * that includes the medical record, health plan beneficiary and account numbers: their value is
 * **removed**, never replaced by a keyed surrogate. Geography and dates are generalized; the
 * open-ended catch-all (R) is **blocked** (fail-closed). Dates generalize to year, and a keyed
 * surrogate of an identifier is derived from information about the individual, so both date-shift and
 * pseudonymization are Expert-Determination techniques rather than Safe Harbor ones. A consumer who
 * needs a consistent keyed surrogate for those three categories uses
 * `LIMITED_DATA_SET_PROFILE`, which does not claim Safe Harbor.
 *
 * @example
 * ```ts
 * import { SAFE_HARBOR_POLICY, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * SAFE_HARBOR_POLICY.transforms[SAFE_HARBOR_CATEGORIES.MRN]; // => "redact"
 * ```
 */
export const SAFE_HARBOR_POLICY: DeidPolicy = Object.freeze({
  name: "safe-harbor",
  transforms: Object.freeze({
    [SAFE_HARBOR_CATEGORIES.NAMES]: "redact",
    [SAFE_HARBOR_CATEGORIES.GEOGRAPHIC]: "generalize",
    [SAFE_HARBOR_CATEGORIES.DATES]: "generalize",
    [SAFE_HARBOR_CATEGORIES.PHONE]: "redact",
    [SAFE_HARBOR_CATEGORIES.FAX]: "redact",
    [SAFE_HARBOR_CATEGORIES.EMAIL]: "redact",
    [SAFE_HARBOR_CATEGORIES.SSN]: "redact",
    [SAFE_HARBOR_CATEGORIES.MRN]: "redact",
    [SAFE_HARBOR_CATEGORIES.HEALTH_PLAN_BENEFICIARY]: "redact",
    [SAFE_HARBOR_CATEGORIES.ACCOUNT]: "redact",
    [SAFE_HARBOR_CATEGORIES.CERTIFICATE_LICENSE]: "redact",
    [SAFE_HARBOR_CATEGORIES.VEHICLE]: "redact",
    [SAFE_HARBOR_CATEGORIES.DEVICE]: "redact",
    [SAFE_HARBOR_CATEGORIES.URL]: "redact",
    [SAFE_HARBOR_CATEGORIES.IP_ADDRESS]: "redact",
    [SAFE_HARBOR_CATEGORIES.BIOMETRIC]: "redact",
    [SAFE_HARBOR_CATEGORIES.FULL_FACE_PHOTO]: "redact",
    [SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID]: "block",
  }),
});

/**
 * The spec accepted by {@link defineDeidPolicy}: a name and a **partial** transform map that overrides
 * the Safe Harbor defaults for the categories it names.
 *
 * @example
 * ```ts
 * import { type DeidPolicySpec, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * const spec: DeidPolicySpec = {
 *   name: "research",
 *   transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
 * };
 * ```
 */
export interface DeidPolicySpec {
  /** The policy name. */
  readonly name: string;
  /** Per-category transform overrides; unlisted categories keep their Safe Harbor default. */
  readonly transforms?: Partial<Readonly<Record<SafeHarborCategory, TransformName>>>;
}

/**
 * Derive a custom policy from the Safe Harbor defaults. Unlisted categories keep the safe default, so
 * a custom policy can only ever be built by *deviating* from Safe Harbor deliberately, never by
 * forgetting a category. The result is frozen.
 *
 * @param spec - The policy name and per-category overrides.
 * @returns A frozen {@link DeidPolicy} covering all 18 categories.
 * @example
 * ```ts
 * import { defineDeidPolicy, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * const research = defineDeidPolicy({
 *   name: "research",
 *   transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
 * });
 * research.transforms[SAFE_HARBOR_CATEGORIES.NAMES]; // => "redact" (kept from Safe Harbor)
 * ```
 */
export function defineDeidPolicy(spec: DeidPolicySpec): DeidPolicy {
  const policy: DeidPolicy = Object.freeze({
    name: spec.name,
    transforms: Object.freeze({ ...SAFE_HARBOR_POLICY.transforms, ...(spec.transforms ?? {}) }),
  });
  assertPolicyContract(policy);
  return policy;
}

/**
 * Enforce the **label contract** on a transform assignment, **failing closed** if it is violated:
 * whatever claims the reserved `safe-harbor` label may not assign a category a transform whose output
 * for that category is **derived from that category's own value**. A keyed surrogate of a medical
 * record number, like a shifted-but-real date, is derived from information about the individual, so
 * §164.514(c)(1) does not permit it as a retained code and the (R) exception does not reach it: those
 * are Expert-Determination techniques, not Safe Harbor ones.
 *
 * Every (category, transform) pair has a determined outcome. `redact` and `block` withhold the value,
 * and `byo-redact` and `retain` fall closed to a block from the per-category map, so none of the four
 * is ever derived-output. `pseudonymize`, `hash` and `date-shift` compute the replacement from the
 * value, so each is derived-output on all 18 categories. `generalize` is permitted on (B) geography
 * and (C) dates-and-ages-over-89, the two sub-paragraphs that state a permitted coarsening, and is
 * derived-output on the other sixteen. An assignment that is not a published transform name at all
 * cannot be classified and is refused rather than allowed.
 *
 * @param transforms - The per-category assignment claiming the label.
 * @param claimant - A library-owned phrase naming the surface that claims the label, for the message.
 * @throws {@link DeidError} with code `DEID_POLICY_INVALID`, naming the offending category and
 *   transform, and carrying no value, no key and no offset.
 * @internal
 */
export function assertSafeHarborTransformContract(
  transforms: Readonly<Record<SafeHarborCategory, TransformName>>,
  claimant: string,
): void {
  // Regulatory order (A→R), so a policy offending in more than one place names the first
  // sub-paragraph that offends and the outcome is deterministic.
  for (const category of Object.values(SAFE_HARBOR_CATEGORIES)) {
    const transform = transforms[category];
    if (!PUBLISHED_TRANSFORM_NAMES.has(transform)) {
      throw new DeidError(
        FATAL_CODES.DEID_POLICY_INVALID,
        `${claimant} assigns category "${category}" a transform that is not one of the published ` +
          "transform names, so whether its output would be derived from that category's own value " +
          "cannot be established. A pair whose derivation is unknown is refused, never permitted: " +
          "assign one of the published transforms, or name the policy distinctly.",
      );
    }
    if (!isDerivedOutputPair(category, transform)) {
      continue;
    }
    const because =
      transform === "generalize"
        ? "coarsening is permitted only for (B) geographic subdivisions and (C) dates and ages over " +
          "89, so a coarsened value of this category is still derived from the value it replaces"
        : "its output for that category is computed from the category's own value, so it is a " +
          "re-identification code §164.514(c)(1) does not permit";
    throw new DeidError(
      FATAL_CODES.DEID_POLICY_INVALID,
      `${claimant} must not assign category "${category}" the "${transform}" transform: ` +
        `${because}. Withhold the value instead, or name the policy distinctly.`,
    );
  }
}

/**
 * Enforce the key/label contract on a policy, **failing closed** if it is violated: a policy whose
 * name is exactly the reserved `safe-harbor` label may carry no derived-output pair (see
 * {@link assertSafeHarborTransformContract}). The comparison is exact, so a policy named
 * `Safe-Harbor` is a differently-named policy the guard does not reach. Enforced both when a policy is
 * minted ({@link defineDeidPolicy}) and, so a hand-built {@link DeidPolicy} object cannot slip past,
 * at the point of use ({@link resolvePolicy}).
 *
 * @param policy - The policy to validate.
 * @throws {@link DeidError} with code `DEID_POLICY_INVALID` if the contract is violated.
 * @internal
 */
export function assertPolicyContract(policy: DeidPolicy): void {
  if (policy.name !== SAFE_HARBOR_LABEL) {
    return;
  }
  assertSafeHarborTransformContract(
    policy.transforms,
    `a policy carrying the reserved "${SAFE_HARBOR_LABEL}" label`,
  );
}

/**
 * Resolve the policy argument accepted by the engine: the string `"safe-harbor"` (or `undefined`)
 * yields the built-in policy; a {@link DeidPolicy} object is returned as-is.
 *
 * @param policy - `"safe-harbor"`, a {@link DeidPolicy}, or `undefined`.
 * @returns The concrete policy to apply.
 * @example
 * ```ts
 * import { resolvePolicy, SAFE_HARBOR_POLICY } from "@cosyte/deid";
 *
 * resolvePolicy("safe-harbor") === SAFE_HARBOR_POLICY; // => true
 * ```
 */
export function resolvePolicy(policy: DeidPolicy | "safe-harbor" | undefined): DeidPolicy {
  if (policy === undefined || policy === "safe-harbor") {
    return SAFE_HARBOR_POLICY;
  }
  // Fail closed on a hand-built policy object that violates the key/label contract (defineDeidPolicy
  // already checks its own output, but a consumer can construct a DeidPolicy literal directly).
  assertPolicyContract(policy);
  return policy;
}
