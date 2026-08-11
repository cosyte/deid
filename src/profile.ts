/**
 * **Policy profiles**: named, reusable de-identification presets a site adopts once and applies
 * everywhere. A {@link DeidProfile} bundles a {@link DeidPolicy} with an optional
 * default free-text redactor and the honest metadata that governs how its output may be used.
 *
 * Two presets ship:
 *
 * - {@link SAFE_HARBOR_PROFILE}, the fail-closed default: the built-in Safe Harbor policy, dates
 *   generalized to year, the catch-all (R) blocked.
 * - {@link LIMITED_DATA_SET_PROFILE}: a **research / longitudinal** preset that **date-shifts** dates
 *   (interval-preserving) instead of generalizing them, so time-series utility survives. It is
 *   deliberately **less** protective than Safe Harbor for dates, so it is **not** labelled
 *   `safe-harbor`, it requires a keyed per-patient context, and it is **not** a certified de-identified
 *   output. See {@link LIMITED_DATA_SET_PROFILE} and `docs-content/limitations.md` for the exact posture.
 *
 * {@link defineDeidProfile} derives a per-site profile from a base, under a **widen-never-narrow**
 * contract: a site may move a category to an equal-or-**stronger** transform (more removal), but may
 * **never** re-weaken a category the base scrubs. A site preset can therefore only ever *tighten* the
 * base standard, never quietly loosen it (fail-closed, {@link FATAL_CODES.DEID_PROFILE_INVALID}).
 *
 * **The contract is about the strength of the result, not the size of any list, and retention reads
 * the opposite way round from a transform override.** A profile's `retainedLoci` names identifying
 * loci it *keeps*, so **dropping** a class removes more and is the widening the contract permits,
 * while **adding** one keeps more and is the narrowing it refuses. Reading it as "the derived list may
 * only grow" would invert the guarantee, which is why the check is a **subset** test and not a rank
 * comparison. Note the scope, too: the contract binds a **derived** profile against its base. It says
 * nothing about the built-in presets themselves, so strengthening one of those (retaining less than it
 * used to) is not a contract question at all, and every profile derived from it inherits the stronger
 * base.
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "./categories.js";
import { DeidError, FATAL_CODES } from "./codes.js";
import { type DeidContext } from "./context.js";
import { type DeidOptions } from "./deidentify.js";
import {
  assertPolicyContract,
  defineDeidPolicy,
  SAFE_HARBOR_POLICY,
  type DeidPolicy,
  type TransformName,
} from "./policy.js";
import { type FreeTextRedactor } from "./redactor.js";
import {
  NO_RETAINED_LOCI,
  RETAINED_LOCUS_CLASSES,
  type RetainedLocusClass,
} from "./retention.js";

/**
 * The **protection rank** of a transform: higher means the residual is *less* identifying, so the
 * transform is *stronger* de-identification. Used to enforce the widen-never-narrow contract:
 * `block` (value withheld) is strongest; `date-shift` (a full-precision shifted **real** date) is the
 * weakest transform that still acts. `byo-redact` is ranked with `block` because the policy map never
 * performs it: it fails closed to a block. `retain` ranks **0**, below every transform, because it
 * changes nothing: no base transform is weaker, so no override can ever move a category onto it.
 */
const TRANSFORM_RANK: Readonly<Record<TransformName, number>> = Object.freeze({
  block: 5,
  "byo-redact": 5,
  redact: 4,
  pseudonymize: 3,
  hash: 3,
  generalize: 2,
  "date-shift": 1,
  retain: 0,
});

/** The named standard a profile targets, surfaced so output labelling can never overclaim. */
export type DeidStandard = "safe-harbor" | "limited-data-set" | "custom";

/**
 * A reusable, named de-identification preset: a policy plus its honest usage posture and an optional
 * default free-text redactor.
 *
 * @example
 * ```ts
 * import { SAFE_HARBOR_PROFILE } from "@cosyte/deid";
 *
 * SAFE_HARBOR_PROFILE.name; // => "safe-harbor"
 * ```
 */
export interface DeidProfile {
  /** The profile name (also the policy name). */
  readonly name: string;
  /** The standard this profile targets: governs how its output may honestly be described. */
  readonly standard: DeidStandard;
  /** The concrete policy the engine applies. */
  readonly policy: DeidPolicy;
  /**
   * A one-line honest description of what the profile does and does **not** guarantee: surfaced in
   * docs and tooling so a preset is never adopted without its caveats.
   */
  readonly description: string;
  /**
   * Whether the profile **requires** a keyed per-patient {@link DeidContext} to run at all (true when
   * any category uses a keyed transform such as `date-shift` on a category that is always present).
   */
  readonly requiresContext: boolean;
  /**
   * The **retention classes** this profile permits: named groups of *identifying* loci a format
   * adapter passes through unchanged, each one still recorded as a `DEID_RESIDUAL_RETAINED` residual.
   * Empty on {@link SAFE_HARBOR_PROFILE}; {@link LIMITED_DATA_SET_PROFILE} carries the two classes
   * §164.514(e)(2) permits a limited data set to keep.
   */
  readonly retainedLoci: readonly RetainedLocusClass[];
  /** An optional default free-text redactor the profile carries into {@link profileOptions}. */
  readonly redactor?: FreeTextRedactor;
}

const C = SAFE_HARBOR_CATEGORIES;

/**
 * The **Safe Harbor** profile: the fail-closed default. Wraps {@link SAFE_HARBOR_POLICY}: direct
 * identifiers removed, MRN/beneficiary/account pseudonymized, geography and dates generalized, the
 * catch-all (R) blocked. Output is **"Safe-Harbor-transformed per the configured policy"**, never
 * "de-identified".
 *
 * @example
 * ```ts
 * import { SAFE_HARBOR_PROFILE } from "@cosyte/deid";
 *
 * SAFE_HARBOR_PROFILE.standard; // => "safe-harbor"
 * ```
 */
export const SAFE_HARBOR_PROFILE: DeidProfile = Object.freeze({
  name: "safe-harbor",
  standard: "safe-harbor",
  policy: SAFE_HARBOR_POLICY,
  description:
    "HIPAA Safe Harbor (§164.514(b)(2)) transform set: the 18 categories removed/pseudonymized/" +
    "generalized, dates to year, the (R) catch-all blocked. Retains no identifying locus: an " +
    "admission/discharge/service date is reduced to its year and an encounter or order number is " +
    "blocked as (R). Fails closed. Not a certification.",
  requiresContext: false,
  retainedLoci: NO_RETAINED_LOCI,
});

/**
 * The **Limited Data Set / longitudinal research** profile. Identical to Safe Harbor **except** dates
 * are **date-shifted** (a single consistent per-patient offset, intervals preserved) rather than
 * generalized to year, so time-series analysis survives.
 *
 * It also **keeps**, unchanged, the two classes of identifying locus §164.514(e)(2) permits a limited
 * data set to carry and Safe Harbor does not: **encounter dates** (admission / discharge / service /
 * diagnosis) and **encounter and order identifiers** (visit number, placer and filler order numbers).
 * That list of sixteen direct identifiers names no date and has **no catch-all**, which is precisely
 * why these survive here and are removed under Safe Harbor. Each kept locus is still **recorded** as a
 * `DEID_RESIDUAL_RETAINED` residual, so it reaches the determiner's residual inventory.
 *
 * **This is deliberately less protective than Safe Harbor and is NOT Safe Harbor.** A shifted-but-real
 * date is still "an element of a date" (§164.514(b)(2)(i)(C)), so this profile:
 *
 * - is **not** labelled `safe-harbor` (the reserved-label guard would reject it);
 * - **requires** a keyed per-patient {@link DeidContext} (an absent key is a fatal `DEID_NO_KEY`);
 * - produces an **Expert-Determination-supporting** dataset, **not** a certified de-identification, and
 *   **not**, on its own, a HIPAA §164.514(e) Limited Data Set: disclosing an actual Limited Data Set
 *   additionally requires a Data Use Agreement, which is the consumer's responsibility.
 *
 * @example
 * ```ts
 * import { LIMITED_DATA_SET_PROFILE } from "@cosyte/deid";
 *
 * LIMITED_DATA_SET_PROFILE.requiresContext; // => true (date-shift needs a per-patient key)
 * ```
 */
export const LIMITED_DATA_SET_PROFILE: DeidProfile = Object.freeze({
  name: "limited-data-set",
  standard: "limited-data-set",
  policy: defineDeidPolicy({
    name: "limited-data-set",
    transforms: { [C.DATES]: "date-shift" },
  }),
  description:
    "Longitudinal research preset: Safe-Harbor identifier handling, but dates are DATE-SHIFTED " +
    "(interval-preserving), not generalized, and the encounter dates and encounter/order identifiers " +
    "§164.514(e)(2) permits are KEPT UNCHANGED and recorded as residuals. Expert-Determination " +
    "territory, NOT Safe Harbor, NOT a certified de-identification. Requires a keyed per-patient context.",
  requiresContext: true,
  retainedLoci: Object.freeze([
    RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES,
    RETAINED_LOCUS_CLASSES.ENCOUNTER_IDENTIFIERS,
  ]),
});

/**
 * The spec accepted by {@link defineDeidProfile}: a name, an optional base profile (default
 * {@link SAFE_HARBOR_PROFILE}), per-category transform overrides, and an optional default redactor.
 *
 * @example
 * ```ts
 * import { type DeidProfileSpec, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * const spec: DeidProfileSpec = {
 *   name: "site-a",
 *   transforms: { [SAFE_HARBOR_CATEGORIES.MRN]: "redact" }, // tighten MRN from pseudonymize to redact
 * };
 * ```
 */
export interface DeidProfileSpec {
  /** The profile name. Must not be a reserved standard label unless it genuinely matches it. */
  readonly name: string;
  /** The base profile to derive from. Defaults to {@link SAFE_HARBOR_PROFILE}. */
  readonly base?: DeidProfile;
  /**
   * Per-category transform overrides. Each may only move a category to an **equal-or-stronger**
   * transform than the base (widen-never-narrow); a weakening override is rejected.
   */
  readonly transforms?: Partial<Readonly<Record<SafeHarborCategory, TransformName>>>;
  /**
   * The retention classes the derived profile permits. Must be a **subset** of the base's: dropping a
   * class removes more (a widening, allowed), adding one keeps more (a narrowing, rejected). Omit to
   * inherit the base's set unchanged.
   */
  readonly retainedLoci?: readonly RetainedLocusClass[];
  /** An optional default free-text redactor the derived profile carries. */
  readonly redactor?: FreeTextRedactor;
  /** An optional human description; a default is synthesized from the base when omitted. */
  readonly description?: string;
}

/** The reserved standard labels a custom profile may not claim. */
const RESERVED_NAMES: ReadonlySet<string> = new Set(["safe-harbor", "limited-data-set"]);

/**
 * Derive a per-site {@link DeidProfile} from a base profile (Safe Harbor by default), enforcing the
 * **widen-never-narrow** contract: every override must move its category to an equal-or-**stronger**
 * transform than the base's. A weakening override, or reclaiming a reserved standard label, is
 * **rejected** ({@link FATAL_CODES.DEID_PROFILE_INVALID}), so a site preset can only tighten, never
 * loosen, the base standard's protection.
 *
 * @param spec - The profile name, base, per-category overrides, and optional redactor.
 * @returns A frozen {@link DeidProfile}.
 * @throws {@link DeidError} `DEID_PROFILE_INVALID` if an override weakens a category, if
 *   `retainedLoci` adds a retention class the base does not retain, or if the name reclaims a reserved
 *   standard label; `DEID_POLICY_INVALID` if the derived policy violates the key/label contract (e.g.
 *   a `safe-harbor`-labelled policy that date-shifts).
 * @example
 * ```ts
 * import { defineDeidProfile, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * const strict = defineDeidProfile({
 *   name: "site-strict",
 *   transforms: { [SAFE_HARBOR_CATEGORIES.MRN]: "redact" }, // pseudonymize -> redact (stronger): OK
 * });
 * strict.policy.transforms[SAFE_HARBOR_CATEGORIES.MRN]; // => "redact"
 * ```
 */
export function defineDeidProfile(spec: DeidProfileSpec): DeidProfile {
  const base = spec.base ?? SAFE_HARBOR_PROFILE;
  const overrides = spec.transforms ?? {};

  if (RESERVED_NAMES.has(spec.name) && spec.name !== base.name) {
    throw new DeidError(
      FATAL_CODES.DEID_PROFILE_INVALID,
      `"${spec.name}" is a reserved standard label; name a derived site profile distinctly`,
    );
  }

  const retainedLoci = spec.retainedLoci ?? base.retainedLoci;
  const added = retainedLoci.filter((cls) => !base.retainedLoci.includes(cls));
  if (added.length > 0) {
    throw new DeidError(
      FATAL_CODES.DEID_PROFILE_INVALID,
      `retention class(es) ${added.map((c) => `"${c}"`).join(", ")} are not retained by the base ` +
        `profile "${base.name}"; a profile may only DROP a retained class (keep less, remove more), ` +
        "never add one",
    );
  }

  for (const [category, transform] of Object.entries(overrides) as [
    SafeHarborCategory,
    TransformName,
  ][]) {
    const baseTransform = base.policy.transforms[category];
    if (TRANSFORM_RANK[transform] < TRANSFORM_RANK[baseTransform]) {
      throw new DeidError(
        FATAL_CODES.DEID_PROFILE_INVALID,
        `override for category "${category}" ("${transform}") is weaker than the base ` +
          `("${baseTransform}"); a profile may only widen (tighten), never narrow, de-identification`,
      );
    }
  }

  const policy = defineDeidPolicy({
    name: spec.name,
    transforms: { ...base.policy.transforms, ...overrides },
  });
  // Belt-and-braces: the derived policy must still satisfy the key/label contract at mint time.
  assertPolicyContract(policy);

  const requiresContext = Object.values(policy.transforms).some(
    (t) => t === "date-shift" || t === "pseudonymize" || t === "hash",
  );

  return Object.freeze({
    name: spec.name,
    standard: "custom",
    policy,
    description:
      spec.description ??
      `Custom site profile derived from "${base.name}" (tightened, never loosened).`,
    requiresContext,
    retainedLoci: Object.freeze([...retainedLoci]),
    ...(spec.redactor !== undefined ? { redactor: spec.redactor } : {}),
  });
}

/**
 * Build the {@link DeidOptions} to pass to any adapter (`deidentifyHl7`, `deidentifyFhir`, …) from a
 * profile: its policy, its retention set, the supplied key context, and the profile's default redactor
 * (unless overridden). **Going through here is what carries the retention set**: an options bag built
 * by hand from `profile.policy` alone retains nothing, which is the fail-closed direction.
 *
 * @param profile - The profile to apply.
 * @param context - The keyed per-patient context (required by profiles whose `requiresContext` is true).
 * @param overrides - Optional `context`/`redactor` overrides merged over the profile's defaults.
 * @returns The {@link DeidOptions} for an adapter call.
 * @example
 * ```ts
 * import { SAFE_HARBOR_PROFILE, profileOptions, createDeidContext } from "@cosyte/deid";
 *
 * const opts = profileOptions(SAFE_HARBOR_PROFILE, createDeidContext({ key: "k" }));
 * opts.policy === SAFE_HARBOR_PROFILE.policy; // => true
 * ```
 */
export function profileOptions(
  profile: DeidProfile,
  context?: DeidContext,
  overrides?: { readonly context?: DeidContext; readonly redactor?: FreeTextRedactor },
): DeidOptions {
  const ctx = overrides?.context ?? context;
  const redactor = overrides?.redactor ?? profile.redactor;
  return {
    policy: profile.policy,
    retainedLoci: profile.retainedLoci,
    ...(ctx !== undefined ? { context: ctx } : {}),
    ...(redactor !== undefined ? { redactor } : {}),
  };
}
