/**
 * The **policy engine** — a policy maps each of the 18 Safe Harbor categories to the transform the
 * engine applies. `safe-harbor` is the built-in default; `defineDeidPolicy` derives a custom policy
 * from it. A policy picks the safest defensible transform per category (the §2.1 table of the roadmap,
 * grounded in §164.514(b)(2)).
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "./categories.js";

/**
 * The name of a transform a policy can assign to a category. `block` is the fail-closed action
 * (withhold the value); `generalize` selects the correct generalization from the locus kind (date /
 * ZIP / age).
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
  | "block";

/** The transforms that require the consumer's key (and, for `date-shift`, a per-patient scope). */
export const KEYED_TRANSFORMS: ReadonlySet<TransformName> = new Set([
  "date-shift",
  "pseudonymize",
  "hash",
]);

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
  /** The policy name — surfaced in output labelling ("Safe-Harbor-transformed per the configured policy"). */
  readonly name: string;
  /** The transform applied to each Safe Harbor category. */
  readonly transforms: Readonly<Record<SafeHarborCategory, TransformName>>;
}

/**
 * The built-in **Safe Harbor** policy. Direct identifiers with no analytic value are redacted; MRN /
 * beneficiary / account numbers are pseudonymized (consistent surrogates); geography and dates are
 * generalized; the open-ended catch-all (R) is **blocked** (fail-closed). Dates generalize to year —
 * date-shift is an Expert-Determination mode, not Safe Harbor.
 *
 * @example
 * ```ts
 * import { SAFE_HARBOR_POLICY, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * SAFE_HARBOR_POLICY.transforms[SAFE_HARBOR_CATEGORIES.MRN]; // => "pseudonymize"
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
    [SAFE_HARBOR_CATEGORIES.MRN]: "pseudonymize",
    [SAFE_HARBOR_CATEGORIES.HEALTH_PLAN_BENEFICIARY]: "pseudonymize",
    [SAFE_HARBOR_CATEGORIES.ACCOUNT]: "pseudonymize",
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
  return Object.freeze({
    name: spec.name,
    transforms: Object.freeze({ ...SAFE_HARBOR_POLICY.transforms, ...(spec.transforms ?? {}) }),
  });
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
  return policy;
}
