/**
 * The de-identification **engine** — applies a policy's per-category transforms across a
 * format-agnostic {@link LocusModel}, **failing closed** on anything it cannot confidently handle, and
 * returns the transformed document plus a **value-free manifest**.
 *
 * The reflex is the inverse of a parser's Postel's-Law liberality: an unrecognized structure, an
 * un-locatable identifier, an uncertain field, or a free-text blob is **blocked** (value withheld),
 * never passed through as safe. Clinical values are the mirror guard — a locus marked `clinical` is
 * **retained untouched**, so the engine never degenerates into a blanket-blanking "safe but useless"
 * scrubber.
 *
 * The result is labelled **"Safe-Harbor-transformed per the configured policy"** — never
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
  /** The context carrying the consumer's key, required only when the policy uses a keyed transform. */
  readonly context?: DeidContext;
}

/** The internal per-locus outcome: the transformed value/disposition and the manifest entry (if any). */
interface LocusOutcome {
  readonly value: string | null;
  readonly disposition: TransformedLocus["disposition"];
  readonly manifest?: Omit<DeidManifestEntry, "count">;
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
    case "block":
    default:
      return blocked(locus.path, category, DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED);
  }
}

/** Resolve a single locus to its outcome, applying the fail-closed rule. */
function handleLocus(
  locus: GenericLocus,
  policy: DeidPolicy,
  context: DeidContext | undefined,
): LocusOutcome {
  // Over-scrub guard: a clinical value is not an identifier — retain it untouched.
  if (locus.kind === "clinical") {
    return { value: locus.value, disposition: "retained" };
  }
  // Fail closed: free text can carry any of the 18 categories in prose — block by default, never scrub.
  if (locus.kind === "freetext") {
    return blocked(
      locus.path,
      locus.category ?? SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
      DEID_DISPOSITION_CODES.DEID_FREETEXT_BLOCKED,
    );
  }
  // Fail closed: an unrecognized structure or an unclassified PHI-bearing locus is category (R).
  if (locus.category === undefined || locus.kind === "unknown") {
    return blocked(
      locus.path,
      SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID,
      DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED,
    );
  }
  return applyTransform(policy.transforms[locus.category], locus, locus.category, context);
}

/**
 * De-identify a format-agnostic {@link LocusModel} under a policy. Returns the transformed document
 * and a value-free manifest. The input model is never mutated; the result is deeply frozen.
 *
 * The output is **"Safe-Harbor-transformed per the configured policy"** — it is not certified
 * de-identified, and Expert Determination is not rendered.
 *
 * @param model - The located candidate values to de-identify.
 * @param options - The policy and (for keyed transforms) the key context.
 * @returns The frozen {@link DeidResult}: transformed document + value-free manifest.
 * @throws {@link DeidError} `EMPTY_INPUT` if the model is null or carries no locus list; `DEID_NO_KEY`
 *   if a keyed transform is required but no key context was supplied.
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
  const builder = new ManifestBuilder();
  const loci: TransformedLocus[] = [];

  for (const locus of inputLoci) {
    const outcome = handleLocus(locus, policy, options.context);
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
