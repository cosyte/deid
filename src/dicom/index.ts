/**
 * `@cosyte/deid/dicom`: the **DICOM de-identification adapter**. The DICOM binding of the format-agnostic
 * core, and the one adapter that **delegates rather than reimplements**:
 * `@cosyte/dicom` already ships the **PS3.15 Annex E** de-identification (the Basic Application Level
 * Confidentiality Profile: tag-level removal of Patient Name/ID/BirthDate, institution, referring physician,
 * dates and the enumerated Annex E attributes; consistent Study/Series/SOP-Instance **UID remapping** so
 * relationships survive; private-tag removal; and the "Patient Identity Removed = YES" + De-identification
 * Method metadata). This adapter **orchestrates** that pass under the unified policy and **folds its
 * value-free report into the unified manifest**: it never re-does Annex E.
 *
 * **`@cosyte/dicom` is an optional peer dependency**, consumed only from this subpath: a consumer who only
 * de-identifies DICOM installs it alongside `@cosyte/deid`; the core stays third-party-dep-free. The adapter
 * reaches DICOM data **only** through `@cosyte/dicom`'s own `parseDicom` / `deidentify` / `serializeDicom`
 * surface: it never touches a third-party substrate and never inspects bytes directly.
 *
 * **Fail closed.** The default `safe-harbor` policy applies the **full Basic Profile with no Retain/Clean
 * deviations**: every private tag is removed, every UID is consistently remapped, and no identifying metadata
 * is retained. The output is **"Safe-Harbor-transformed per the configured policy"**, never "de-identified".
 *
 * **The declaration is machine-readable, not only prose.** Beside the De-identification Method text the
 * delegated pass writes to `(0012,0063)`, this adapter writes the **CID 7050** coded terms for the profile
 * and for every option it applied into De-identification Method Code Sequence `(0012,0064)`, so a receiving
 * archive can branch on a code rather than parse an English sentence. Every option it **withheld** is
 * declared by its coded term on the returned result and never in that sequence, because that sequence
 * carries the codes corresponding to the Profile and Options *used*. The scope over which replacement-UID
 * referential integrity holds is on the result too. The adapter **refuses to declare rather than declare
 * wrongly**: a profile or an option the vocabulary cannot name aborts the pass, and so does a declaration
 * this run cannot read back out of its own serialized output.
 *
 * **The pixel hazard is surfaced, never cleaned.** This is a **metadata-only** de-identifier: it cannot
 * inspect or clean pixels, so recognizable text **burned into the image** (Safe Harbor category Q) is not
 * removed. When Pixel Data is present and not affirmatively marked free of burned-in annotation, the result
 * carries `burnedInAnnotationHazard === true` and the `DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED` warning, and
 * `metadataOnly` is **always** `true`. Such output is **not** safe to release on metadata alone: the pixels
 * need a pixel-capable review (a future `@cosyte/dicom-pixel`).
 *
 * @packageDocumentation
 */

import type { Buffer } from "node:buffer";

import { deidentify as dicomDeidentify, parseDicom, type Dataset } from "@cosyte/dicom";

import {
  BURNED_IN_ANNOTATION_CODE,
  deriveUnexaminedResiduals,
  foldReport,
  foldWarnings,
} from "./fold.js";
import { BASIC_PROFILE_CODE_VALUE, resolveMethodDeclaration } from "./method-codes.js";
import {
  attachMethodCodeSequence,
  INPUT_METHOD_CODE_SEQUENCE_DROPPED_WARNING,
  serializeVerified,
  TAG_DEIDENTIFICATION_METHOD_CODE_SEQUENCE,
} from "./method-sequence.js";
import { resolveDicomOptions } from "./policy-map.js";
import type {
  DicomBufferDeidResult,
  DicomDeidOptions,
  DicomDeidResult,
  DicomDeidWarning,
} from "./types.js";
import { resolveUidReferentialIntegrity } from "./uid-scope.js";

/**
 * Run the pass once: delegate Annex E, attach the coded declaration, and verify that this run's own
 * serialized output reads that declaration back unchanged.
 *
 * **The order is the contract.** The coded declaration is resolved *first*, before anything is
 * delegated, so a profile or an option CID 7050 cannot name aborts with neither a de-identified dataset
 * nor de-identified bytes ever coming into existence. Verification runs *last*, over the bytes actually
 * returned, so output stamped Patient Identity Removed YES never leaves carrying a coded claim the pass
 * could not read back.
 *
 * **The returned dataset carries no parse warnings from the input file.** Those describe the bytes as
 * they were *before* anything was removed, so they are not part of the de-identification contract; the
 * warnings raised by this pass are returned on the result instead. The rebuild that drops them is the
 * same rebuild that attaches `(0012,0064)`: only the root needs it, since every nested `Item` is
 * constructed with an empty warnings array by both the parser and the Annex E pass.
 *
 * **The unexamined-residual measurement is derived over the dataset that is actually returned**, the
 * attached sequence included, so it stays a true statement about the artifact the caller holds. That
 * keeps the derivation literal in the way it already is for the Patient Identity Removed and
 * De-identification Method attributes the delegated pass writes: this adapter holds no list of tags to
 * forgive, because a stale entry in one would hide a real attribute rather than a self-signature.
 *
 * The bytes are returned alongside the result so {@link deidentifyDicomBuffer} does not serialize a
 * second time: the buffer entry point hands back exactly the bytes the verification read.
 *
 * @internal
 */
function runDicomPass(
  dataset: Dataset,
  options: DicomDeidOptions,
): { readonly result: DicomDeidResult; readonly bytes: Buffer } {
  const resolved = resolveDicomOptions(options);
  // Resolved before anything is delegated: a profile or option the vocabulary cannot name refuses the
  // pass here, with no dataset and no bytes produced.
  const declaration = resolveMethodDeclaration(BASIC_PROFILE_CODE_VALUE, resolved.retain);
  const inputCarriedMethodCodes = dataset.has(TAG_DEIDENTIFICATION_METHOD_CODE_SEQUENCE);

  const { dataset: deidentified, report } = dicomDeidentify(dataset, {
    retain: [],
    deidentificationMethod: resolved.deidentificationMethod,
    ...(resolved.uidRoot !== undefined ? { uidRoot: resolved.uidRoot } : {}),
    ...(resolved.uidMap !== undefined ? { uidMap: resolved.uidMap } : {}),
  });

  const result = attachMethodCodeSequence(deidentified, declaration.appliedTerms);
  const bytes = serializeVerified(result, declaration.appliedTerms);

  const warnings: readonly DicomDeidWarning[] = Object.freeze([
    ...foldWarnings(report.warnings),
    ...(inputCarriedMethodCodes ? [INPUT_METHOD_CODE_SEQUENCE_DROPPED_WARNING] : []),
  ]);

  return {
    bytes,
    result: Object.freeze({
      dataset: result,
      manifest: foldReport(report),
      // The Annex E pass is delegated, so the measurement is DERIVED from what it returned rather than
      // enumerated from a map this adapter does not hold: an attribute present in the result that the
      // report does not account for is one no rule reached. Nested sequence items and the Part 10 File
      // Meta group included, and a structure that will not yield its positions fails the pass rather
      // than emit a partial count.
      unexaminedResiduals: deriveUnexaminedResiduals(result, report),
      warnings,
      metadataOnly: true,
      burnedInAnnotationHazard: warnings.some((w) => w.code === BURNED_IN_ANNOTATION_CODE),
      retained: Object.freeze([...report.retained]),
      deidentificationMethodCodes: declaration.appliedTerms,
      optionDeclarations: declaration.optionDeclarations,
      uidReferentialIntegrity: resolveUidReferentialIntegrity(options.uidMap),
    }),
  };
}

/**
 * De-identify a parsed DICOM dataset under a policy (Safe Harbor by default). Delegates the tag-level work to
 * `@cosyte/dicom`'s PS3.15 Annex E `deidentify` (Basic Application Level Confidentiality Profile), then folds
 * its value-free report into the unified manifest. The input dataset is **never mutated**: a fresh
 * de-identified {@link Dataset} is returned.
 *
 * The output is **"Safe-Harbor-transformed per the configured policy"**: it is not certified de-identified,
 * and it is **metadata-only**: pixels are not inspected, so a burned-in-annotation hazard is *flagged*, never
 * cleaned. Always check {@link DicomDeidResult.burnedInAnnotationHazard} before releasing an image.
 *
 * The returned dataset carries **no parse warnings from the input file**. Those describe the bytes as they
 * were *before* anything was removed, so they are not part of the de-identification contract; the warnings
 * raised by **this pass** are returned separately on {@link DicomDeidResult.warnings}.
 *
 * The output **declares itself in the standard's own vocabulary**. The CID 7050 coded terms for the
 * profile and for every option the run applied are written to De-identification Method Code Sequence
 * `(0012,0064)` beside the unchanged `(0012,0063)` text and `(0012,0062) YES`; every option the run
 * **withheld** is declared on {@link DicomDeidResult.optionDeclarations} and never in that sequence, and
 * the scope over which replacement-UID referential integrity holds is on
 * {@link DicomDeidResult.uidReferentialIntegrity}.
 *
 * @param dataset - The parsed dataset (`parseDicom(bytes)`).
 * @param options - The policy and (for cross-file UID consistency) a shared `uidMap` / `uidRoot`.
 * @returns The de-identified dataset, the value-free manifest, the coded declaration, the warnings, and
 *   the metadata-only stance.
 * @throws {@link DeidError} `DEID_POSITIONS_UNENUMERABLE` when a dataset, a sequence item or the Part 10
 *   File Meta group will not yield its positions, so no honest count exists for this study.
 * @throws {@link DeidError} `DEID_DECLARATION_UNNAMEABLE` when a profile or an Annex E option in play has
 *   no naming term in CID 7050, so the coded declaration could only be an approximation.
 * @throws {@link DeidError} `DEID_OUTPUT_INVALID` when the coded declaration cannot be read back out of
 *   this run's own serialized output, so the pass cannot vouch for what a downstream reader will see.
 * @example
 * ```ts
 * import { parseDicom } from "@cosyte/dicom";
 * import { deidentifyDicom } from "@cosyte/deid/dicom";
 *
 * const { dataset, manifest, burnedInAnnotationHazard } = deidentifyDicom(parseDicom(part10));
 * manifest; // value-free: category + (gggg,eeee) Keyword + action, never a value
 * if (burnedInAnnotationHazard) {
 *   // do NOT release: pixels may still carry burned-in PHI
 * }
 * ```
 */
export function deidentifyDicom(dataset: Dataset, options: DicomDeidOptions = {}): DicomDeidResult {
  return runDicomPass(dataset, options).result;
}

/**
 * Convenience: parse a DICOM Part 10 byte stream, de-identify it, and re-serialize, returning the
 * de-identified bytes and the value-free audit in one call. The re-serialized bytes are a fresh Part 10
 * buffer; the input buffer is never mutated.
 *
 * As with {@link deidentifyDicom}, the result is **metadata-only**: check
 * {@link DicomBufferDeidResult.burnedInAnnotationHazard} before persisting or sharing the bytes.
 *
 * @param bytes - Raw DICOM Part 10 bytes.
 * @param options - The policy and (for cross-file UID consistency) a shared `uidMap` / `uidRoot`.
 * @returns The de-identified Part 10 bytes and the value-free audit.
 * @example
 * ```ts
 * import { deidentifyDicomBuffer } from "@cosyte/deid/dicom";
 *
 * const { bytes, manifest, burnedInAnnotationHazard } = deidentifyDicomBuffer(part10);
 * if (!burnedInAnnotationHazard) fs.writeFileSync("clean.dcm", bytes);
 * ```
 */
export function deidentifyDicomBuffer(
  bytes: Buffer | Uint8Array | ArrayBuffer,
  options: DicomDeidOptions = {},
): DicomBufferDeidResult {
  const { result, bytes: serialized } = runDicomPass(parseDicom(bytes), options);
  return Object.freeze({
    // Exactly the bytes the round-trip verification read the coded declaration back out of: the buffer
    // entry point never re-serializes, so it cannot hand back bytes that were never verified.
    bytes: serialized,
    manifest: result.manifest,
    unexaminedResiduals: result.unexaminedResiduals,
    warnings: result.warnings,
    metadataOnly: true,
    burnedInAnnotationHazard: result.burnedInAnnotationHazard,
    retained: result.retained,
    deidentificationMethodCodes: result.deidentificationMethodCodes,
    optionDeclarations: result.optionDeclarations,
    uidReferentialIntegrity: result.uidReferentialIntegrity,
  });
}

export { BURNED_IN_ANNOTATION_CODE } from "./fold.js";
export { INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE } from "./method-sequence.js";
export {
  CID_7050,
  CID_7050_CONTEXT_GROUP_UID,
  CID_7050_VERSION,
  type DicomCodedTerm,
  type DicomOptionDeclaration,
  type DicomOptionStatus,
} from "./method-codes.js";
export type { DicomUidReferentialIntegrity, DicomUidScope } from "./uid-scope.js";
export { type UnexaminedResidual } from "../residual.js";
export type {
  DicomDeidOptions,
  DicomDeidResult,
  DicomBufferDeidResult,
  DicomDeidWarning,
} from "./types.js";
export { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
export { OUTPUT_LABEL } from "../index.js";
