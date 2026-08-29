/**
 * The de-identification **engine**: applies a policy's per-category transforms across a
 * format-agnostic {@link LocusModel}, **failing closed** on anything it cannot confidently handle, and
 * returns the transformed document plus a **value-free manifest**.
 *
 * The reflex is the inverse of a parser's Postel's-Law liberality: an unrecognized structure, an
 * un-locatable identifier, an uncertain field, or a free-text blob is **blocked** (value withheld),
 * never passed through as safe. Clinical values are the mirror guard: a locus marked `clinical` is
 * **retained untouched**, so the engine never degenerates into a blanket-blanking "safe but useless"
 * scrubber.
 *
 * The result is labelled **"Safe-Harbor-transformed per the configured policy"**, never
 * "de-identified" or "HIPAA-compliant". Expert Determination is not rendered here.
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "./categories.js";
import {
  DeidError,
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  type DeidDispositionCode,
} from "./codes.js";
import { type DeidContext } from "./context.js";
import type { DeidDocument, GenericLocus, TransformedLocus } from "./locus.js";
import { ManifestBuilder, type DeidManifestEntry, type DeidResult } from "./manifest.js";
import { resolvePolicy, type DeidPolicy, type TransformName } from "./policy.js";
import type { FreeTextRedactor } from "./redactor.js";
import {
  assertRetentionContract,
  isRetainableCategory,
  retains,
  type RetainedLocusClass,
} from "./retention.js";
import {
  dateShift,
  generalizeAge,
  generalizeDate,
  generalizeZip,
  keyedHash,
  pseudonymize,
  type GeneralizeOutcome,
} from "./transforms/index.js";

/**
 * Options for {@link deidentify}.
 *
 * @example
 * ```ts
 * import { type DeidOptions, createDeidContext } from "@cosyte/deid";
 *
 * const opts: DeidOptions = { policy: "safe-harbor", context: createDeidContext({ key: "secret" }) };
 * ```
 */
export interface DeidOptions {
  /** The policy to apply. Defaults to the built-in Safe Harbor policy. */
  readonly policy?: DeidPolicy | "safe-harbor";
  /**
   * The **retention classes** the configured profile permits: the named groups of identifying loci a
   * format adapter may pass through unchanged (each one still recorded as a residual). Build this
   * with {@link profileOptions} rather than by hand; the widen-never-narrow contract on a derived
   * profile is what keeps a site preset from adding one.
   *
   * **Absent or empty retains nothing**, so a bare options bag gets the strict treatment.
   */
  readonly retainedLoci?: readonly RetainedLocusClass[];
  /** The context carrying the consumer's key, required only when the policy uses a keyed transform. */
  readonly context?: DeidContext;
  /**
   * A **consumer-supplied** free-text redactor. When present, the engine invokes it
   * at each free-text locus instead of blocking, and records its output as **consumer-asserted**
   * (`DEID_FREETEXT_CONSUMER_REDACTED`). The library bundles **no** redactor. **Fail-closed contract:**
   * when this is omitted, or when the redactor throws or returns nothing, the free-text locus is
   * **blocked** (the safe default), never emitted un-redacted. A returned redaction is trusted as the
   * consumer's; the engine does not re-verify it and does not touch the structural PHI the adapters
   * remove. See {@link FreeTextRedactor}.
   */
  readonly redactor?: FreeTextRedactor;
}

/** The internal per-locus outcome: the transformed value/disposition and the manifest entry (if any). */
interface LocusOutcome {
  readonly value: string | null;
  readonly disposition: TransformedLocus["disposition"];
  readonly manifest?: Omit<DeidManifestEntry, "count" | "reidentificationCode">;
}

/** Build a fail-closed (blocked) outcome for a locus, recording the given disposition code. */
function blocked(
  path: string,
  category: SafeHarborCategory,
  code: DeidDispositionCode,
): LocusOutcome {
  return {
    value: null,
    disposition: "blocked",
    manifest: { category, transform: "block", locus: path, disposition: "blocked", code },
  };
}

/**
 * Build the outcome for a locus the configured profile's **retention set** keeps: the value passes
 * through unchanged, and the fact is **recorded** as a residual so it reaches the retained-quasi-
 * identifier inventory a determiner reads. An unclassified retained locus is recorded as the
 * catch-all (R), never as "nothing happened here".
 */
function retainedResidual(locus: GenericLocus, category: SafeHarborCategory): LocusOutcome {
  return {
    value: locus.value,
    disposition: "retained",
    manifest: {
      category,
      transform: "retain",
      locus: locus.path,
      disposition: "retained",
      code: DEID_DISPOSITION_CODES.DEID_RESIDUAL_RETAINED,
    },
  };
}

/**
 * Build the outcome for a **party-role record**: an adapter classified a party's role as **outside**
 * §164.514(b)(2)(i)'s scope clause, left that party's name and identifiers in place, and is recording
 * the role code it decided on at the party's own structural locus. Nothing is written back (the record
 * carries no value at all) and the row names the code, so a retention that used to be silent is
 * auditable.
 *
 * The category is (A) names: a party's identity is what the clause governs and what the pass left
 * alone. The code is `DEID_PARTY_ROLE_RETAINED`, deliberately not the residual code, so this row never
 * joins the determiner's retained-quasi-identifier inventory: an out-of-scope party is not a residual
 * of the individual's own identity.
 */
function partyRoleRetained(locus: GenericLocus, roleCode: string): LocusOutcome {
  return {
    value: locus.value,
    disposition: "retained",
    manifest: {
      category: SAFE_HARBOR_CATEGORIES.NAMES,
      transform: "retain",
      locus: locus.path,
      disposition: "retained",
      code: DEID_DISPOSITION_CODES.DEID_PARTY_ROLE_RETAINED,
      partyRole: roleCode,
    },
  };
}

/** Choose the right generalization for a locus from its kind, then its category. `null` = can't. */
function generalizeLocus(
  locus: GenericLocus,
  category: SafeHarborCategory,
): GeneralizeOutcome | null {
  if (locus.kind === "date") {
    return generalizeDate(locus.value);
  }
  if (locus.kind === "age") {
    return generalizeAge(Number(locus.value));
  }
  if (locus.kind === "zip" || category === SAFE_HARBOR_CATEGORIES.GEOGRAPHIC) {
    return generalizeZip(locus.value);
  }
  if (category === SAFE_HARBOR_CATEGORIES.DATES) {
    return generalizeDate(locus.value);
  }
  return null;
}

/** Require a bound context for a keyed transform, or fail closed with the fatal DEID_NO_KEY. */
function requireContext(context: DeidContext | undefined, transform: TransformName): DeidContext {
  if (context === undefined) {
    throw new DeidError(
      FATAL_CODES.DEID_NO_KEY,
      `the "${transform}" transform is keyed but no key context was supplied`,
    );
  }
  return context;
}

/** Apply a policy transform to a classified, non-free-text locus. */
function applyTransform(
  transform: TransformName,
  locus: GenericLocus,
  category: SafeHarborCategory,
  context: DeidContext | undefined,
): LocusOutcome {
  switch (transform) {
    case "redact":
      return {
        value: null,
        disposition: "removed",
        manifest: {
          category,
          transform,
          locus: locus.path,
          disposition: "removed",
          code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
        },
      };
    case "generalize": {
      const gen = generalizeLocus(locus, category);
      if (gen === null) {
        return blocked(locus.path, category, DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED);
      }
      return {
        value: gen.value,
        disposition: "transformed",
        manifest: {
          category,
          transform,
          locus: locus.path,
          disposition: "transformed",
          code: gen.residual
            ? DEID_DISPOSITION_CODES.DEID_RESIDUAL_RETAINED
            : DEID_DISPOSITION_CODES.DEID_CATEGORY_GENERALIZED,
        },
      };
    }
    case "date-shift": {
      const shifted = dateShift(locus.value, requireContext(context, transform));
      if (shifted === null) {
        return blocked(locus.path, category, DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED);
      }
      return {
        value: shifted,
        disposition: "transformed",
        manifest: {
          category,
          transform,
          locus: locus.path,
          disposition: "transformed",
          code: DEID_DISPOSITION_CODES.DEID_CATEGORY_DATE_SHIFTED,
        },
      };
    }
    case "pseudonymize":
      return {
        value: pseudonymize(locus.value, requireContext(context, transform)),
        disposition: "transformed",
        manifest: {
          category,
          transform,
          locus: locus.path,
          disposition: "transformed",
          code: DEID_DISPOSITION_CODES.DEID_CATEGORY_PSEUDONYMIZED,
        },
      };
    case "hash":
      return {
        value: keyedHash(locus.value, requireContext(context, transform)),
        disposition: "transformed",
        manifest: {
          category,
          transform,
          locus: locus.path,
          disposition: "transformed",
          code: DEID_DISPOSITION_CODES.DEID_CATEGORY_HASHED,
        },
      };
    case "byo-redact":
    case "retain":
    case "block":
    default:
      // Neither `byo-redact` nor `retain` is a category transform: free-text redaction is driven by
      // the `redactor` option and retention by the profile's retention set, not by the policy map. If
      // a policy assigns either (or `block`, or anything unknown) to a category, fail closed (block).
      // `retain` in particular must never keep a value from here: reaching this arm means a policy
      // asked for it per-category, which is not how retention is decided.
      return blocked(locus.path, category, DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED);
  }
}

/**
 * Coerce an arbitrary redactor return into the redacted prose, or `null` to fail closed. A valid result
 * is an object carrying a string `text` (an empty string is a valid "all prose removed" redaction);
 * everything else (`null`, `undefined`, a non-object, or a missing/non-string `text`) is treated as
 * "the redactor returned nothing" and fails closed.
 */
function redactedProse(result: unknown): string | null {
  if (result === null || result === undefined || typeof result !== "object") {
    return null;
  }
  const text: unknown = (result as { text?: unknown }).text;
  return typeof text === "string" ? text : null;
}

/**
 * Handle a free-text locus. **Fail closed** by default: with no consumer redactor the prose is blocked.
 * With a BYO redactor, invoke it and treat a returned redaction as *consumer-asserted*, but still
 * fail closed if it throws or returns nothing, so a redactor failure never leaks free text.
 */
function handleFreeText(locus: GenericLocus, redactor: FreeTextRedactor | undefined): LocusOutcome {
  const category = locus.category ?? SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID;
  if (redactor === undefined) {
    return blocked(locus.path, category, DEID_DISPOSITION_CODES.DEID_FREETEXT_BLOCKED);
  }
  let prose: string | null;
  try {
    // Everything that touches the redactor's return, the call AND reading `.text` off it, is inside
    // the try, so even a throwing getter / hostile Proxy fails closed rather than crashing the pass.
    prose = redactedProse(
      redactor({
        text: locus.value,
        locus: locus.path,
        ...(locus.category !== undefined ? { category: locus.category } : {}),
      }),
    );
  } catch {
    // Fail closed: a throwing redactor never passes the free text through.
    return blocked(locus.path, category, DEID_DISPOSITION_CODES.DEID_FREETEXT_BLOCKED);
  }
  if (prose === null) {
    // Fail closed: the redactor returned nothing usable.
    return blocked(locus.path, category, DEID_DISPOSITION_CODES.DEID_FREETEXT_BLOCKED);
  }
  return {
    value: prose,
    disposition: "transformed",
    manifest: {
      category,
      transform: "byo-redact",
      locus: locus.path,
      disposition: "transformed",
      code: DEID_DISPOSITION_CODES.DEID_FREETEXT_CONSUMER_REDACTED,
    },
  };
}

/** Resolve a single locus to its outcome, applying the fail-closed rule. */
function handleLocus(
  locus: GenericLocus,
  policy: DeidPolicy,
  context: DeidContext | undefined,
  redactor: FreeTextRedactor | undefined,
  retainedLoci: readonly RetainedLocusClass[] | undefined,
): LocusOutcome {
  // Over-scrub guard: a clinical value is not an identifier, retain it untouched.
  if (locus.kind === "clinical") {
    return { value: locus.value, disposition: "retained" };
  }
  // Free text can carry any of the 18 categories in prose. Block by default; a BYO redactor (§Phase 8)
  // may redact it in place, consumer-asserted, but a redactor failure still fails closed.
  if (locus.kind === "freetext") {
    return handleFreeText(locus, redactor);
  }
  // A PARTY-ROLE RECORD: the adapter's own role table established this party as outside the scope
  // clause, so its name and identifiers stay where they are and the role code is recorded here. The
  // record carries NO value, and a marked locus that carries one is refused rather than retained: that
  // is the one way this marker could otherwise become a route for passing an identifier through. It
  // sits after the free-text and clinical guards, so neither can be re-labelled into it.
  if (locus.partyRole !== undefined) {
    if (locus.value.length > 0) {
      return blocked(
        locus.path,
        locus.category ?? SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
        DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED,
      );
    }
    return partyRoleRetained(locus, locus.partyRole);
  }
  // Fail closed: an unrecognized structure or an unclassified PHI-bearing locus is category (R).
  if (locus.category === undefined || locus.kind === "unknown") {
    return blocked(
      locus.path,
      SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
      DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED,
    );
  }
  // Retention needs THREE independent keys to line up, and any one of them missing means the policy
  // transform runs instead:
  //   1. the adapter proposed a class for this locus;
  //   2. the CONFIGURED OPTIONS list that class (an adapter cannot retain anything by itself, and an
  //      options bag that never mentions retention keeps nothing);
  //   3. the resolved category is one a limited data set may carry at all: never one of the sixteen
  //      direct identifiers §164.514(e)(2) enumerates. A visit-number field routinely carries a
  //      medical record or account number, typed as such by the standard's own identifier-type code,
  //      and keeping THAT would republish in the clear the very identifier the pass pseudonymized
  //      elsewhere in the same document.
  // It is also reached only AFTER the three fail-closed guards above, so free text and unrecognized
  // structure can never be retained however an adapter marks them; and a kept locus is always recorded.
  if (
    locus.retention !== undefined &&
    retains(retainedLoci, locus.retention) &&
    isRetainableCategory(locus.category)
  ) {
    return retainedResidual(locus, locus.category);
  }
  return applyTransform(policy.transforms[locus.category], locus, locus.category, context);
}

/**
 * De-identify a format-agnostic {@link LocusModel} under a policy. Returns the transformed document
 * and a value-free manifest. The input model is never mutated; the result is deeply frozen.
 *
 * The output is **"Safe-Harbor-transformed per the configured policy"**: it is not certified
 * de-identified, and Expert Determination is not rendered.
 *
 * @param model - The located candidate values to de-identify.
 * @param options - The policy and (for keyed transforms) the key context.
 * @returns The frozen {@link DeidResult}: transformed document + value-free manifest.
 * @throws {@link DeidError} `EMPTY_INPUT` if the model is null or carries no locus list; `DEID_NO_KEY`
 *   if a keyed transform is required but no key context was supplied; `DEID_POLICY_INVALID` if a
 *   `safe-harbor`-labelled policy is asked to retain an identifying locus.
 * @example
 * ```ts
 * import { deidentify, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";
 *
 * const result = deidentify(
 *   { loci: [{ path: "PID-19", kind: "identifier", category: SAFE_HARBOR_CATEGORIES.SSN, value: "SENTINEL" }] },
 *   {},
 * );
 * result.document.loci[0]?.value;      // => null (removed)
 * result.manifest[0]?.disposition;     // => "removed"
 * ```
 */
export function deidentify(
  model: { readonly loci?: readonly GenericLocus[] },
  options: DeidOptions,
): DeidResult {
  const inputLoci: readonly GenericLocus[] | undefined =
    model === null || model === undefined ? undefined : model.loci;
  if (inputLoci === undefined || inputLoci === null) {
    throw new DeidError(FATAL_CODES.EMPTY_INPUT, "de-identify requires a model with a loci array");
  }
  const policy = resolvePolicy(options.policy);
  // Fail closed on the label: a "safe-harbor"-labelled policy may not retain, however the options bag
  // was built. This is the one route no profile-level check can see.
  assertRetentionContract(policy.name, options.retainedLoci);
  const builder = new ManifestBuilder();
  const loci: TransformedLocus[] = [];

  for (const locus of inputLoci) {
    const outcome = handleLocus(
      locus,
      policy,
      options.context,
      options.redactor,
      options.retainedLoci,
    );
    loci.push(
      Object.freeze({
        path: locus.path,
        kind: locus.kind,
        value: outcome.value,
        disposition: outcome.disposition,
      }),
    );
    if (outcome.manifest !== undefined) {
      builder.add(outcome.manifest);
    }
  }

  const document: DeidDocument = Object.freeze({ loci: Object.freeze(loci) });
  return Object.freeze({ document, manifest: builder.build() });
}
