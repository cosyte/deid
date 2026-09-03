/**
 * The declared **scope of replacement-UID referential integrity** for a run.
 *
 * Replacement UIDs are what make a de-identified study still a study: Study, Series and SOP Instance
 * UIDs are remapped rather than removed, so images still group into series and series into studies. The
 * question a consumer has to answer before relying on that is *how far* the guarantee reaches, and until
 * now the only answer was a sentence in a guide. It is a value on the result instead, so the two cases
 * are told apart by reading a field rather than by remembering which arguments were passed.
 *
 * **What is guaranteed, stated as a guarantee rather than as an observation.** With no shared cache the
 * library guarantees consistency **within the single call** and no further: the replacement UIDs of one
 * call are not promised to agree with those of any other, because the promise would depend on inputs the
 * caller controls (notably a `uidRoot` that may differ between calls). With a caller-supplied cache the
 * guarantee reaches every call that shares it, and the caller owns its lifetime and extent.
 *
 * @packageDocumentation
 */

/**
 * How far replacement-UID referential integrity reaches for a run.
 *
 * - `single-call` - no cross-file UID cache was supplied: the guarantee holds within this call only.
 * - `caller-supplied-cache` - a cache was supplied: the guarantee reaches every call that shares it.
 *
 * @example
 * ```ts
 * import { deidentifyDicom, type DicomUidScope } from "@cosyte/deid/dicom";
 *
 * const scope: DicomUidScope = deidentifyDicom(dataset).uidReferentialIntegrity.scope;
 * scope; // => "single-call"
 * ```
 */
export type DicomUidScope = "single-call" | "caller-supplied-cache";

/**
 * The declared scope of replacement-UID referential integrity: a machine-readable discriminant and the
 * statement it stands for, both read off the result.
 *
 * @example
 * ```ts
 * import { deidentifyDicom } from "@cosyte/deid/dicom";
 *
 * const uidMap = new Map<string, string>();
 * deidentifyDicom(dataset).uidReferentialIntegrity.scope; // => "single-call"
 * deidentifyDicom(dataset, { uidMap }).uidReferentialIntegrity.scope; // => "caller-supplied-cache"
 * ```
 */
export interface DicomUidReferentialIntegrity {
  /** How far the guarantee reaches. Distinguishes a run given a shared cache from one given none. */
  readonly scope: DicomUidScope;
  /** The same fact in one PHI-free sentence, safe to log or to copy into a disclosure record. */
  readonly statement: string;
}

/** The statement for a run given no shared cache. A constant: it never quotes an input. */
const SINGLE_CALL_STATEMENT =
  "Referential integrity of replacement UIDs is guaranteed only within this single call: no shared " +
  "cross-file UID cache was supplied, so these replacement UIDs are not promised to agree with those " +
  "of any other call.";

/** The statement for a run given a shared cache. A constant: it never quotes an input. */
const SHARED_CACHE_STATEMENT =
  "Referential integrity of replacement UIDs is guaranteed across every call that shares the " +
  "cross-file UID cache supplied by the caller, who owns its lifetime and extent.";

/**
 * Resolve the referential-integrity scope from whether the caller supplied a cross-file UID cache.
 *
 * @param uidMap - The caller-owned source to replacement UID cache, or `undefined` when none was given.
 * @returns The declared scope and its statement.
 * @internal
 */
export function resolveUidReferentialIntegrity(
  uidMap: ReadonlyMap<string, string> | undefined,
): DicomUidReferentialIntegrity {
  return Object.freeze(
    uidMap === undefined
      ? { scope: "single-call" as const, statement: SINGLE_CALL_STATEMENT }
      : { scope: "caller-supplied-cache" as const, statement: SHARED_CACHE_STATEMENT },
  );
}
