/**
 * `@cosyte/deid/dicom` — the **DICOM de-identification adapter**. The DICOM binding of the format-agnostic
 * core (roadmap §Phase 6, §4.7), and the one adapter that **delegates rather than reimplements**:
 * `@cosyte/dicom` already ships the **PS3.15 Annex E** de-identification (the Basic Application Level
 * Confidentiality Profile — tag-level removal of Patient Name/ID/BirthDate, institution, referring physician,
 * dates and the enumerated Annex E attributes; consistent Study/Series/SOP-Instance **UID remapping** so
 * relationships survive; private-tag removal; and the "Patient Identity Removed = YES" + De-identification
 * Method metadata). This adapter **orchestrates** that pass under the unified policy and **folds its
 * value-free report into the unified manifest** — it never re-does Annex E.
 *
 * **`@cosyte/dicom` is an optional peer dependency**, consumed only from this subpath — a consumer who only
 * de-identifies DICOM installs it alongside `@cosyte/deid`; the core stays third-party-dep-free. The adapter
 * reaches DICOM data **only** through `@cosyte/dicom`'s own `parseDicom` / `deidentify` / `serializeDicom`
 * surface — it never touches a third-party substrate and never inspects bytes directly.
 *
 * **Fail closed.** The default `safe-harbor` policy applies the **full Basic Profile with no Retain/Clean
 * deviations**: every private tag is removed, every UID is consistently remapped, and no identifying metadata
 * is retained. The output is **"Safe-Harbor-transformed per the configured policy"**, never "de-identified".
 *
 * **The pixel hazard is surfaced, never cleaned.** This is a **metadata-only** de-identifier: it cannot
 * inspect or clean pixels, so recognizable text **burned into the image** (Safe Harbor category Q) is not
 * removed. When Pixel Data is present and not affirmatively marked free of burned-in annotation, the result
 * carries `burnedInAnnotationHazard === true` and the `DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED` warning, and
 * `metadataOnly` is **always** `true`. Such output is **not** safe to release on metadata alone — the pixels
 * need a pixel-capable review (a future `@cosyte/dicom-pixel`).
 *
 * @packageDocumentation
 */

import {
  deidentify as dicomDeidentify,
  parseDicom,
  serializeDicom,
  type Dataset,
} from "@cosyte/dicom";

import { BURNED_IN_ANNOTATION_CODE, foldReport, foldWarnings } from "./fold.js";
import { resolveDicomOptions } from "./policy-map.js";
import type { DicomBufferDeidResult, DicomDeidOptions, DicomDeidResult } from "./types.js";

/**
 * De-identify a parsed DICOM dataset under a policy (Safe Harbor by default). Delegates the tag-level work to
 * `@cosyte/dicom`'s PS3.15 Annex E `deidentify` (Basic Application Level Confidentiality Profile), then folds
 * its value-free report into the unified manifest. The input dataset is **never mutated** — a fresh
 * de-identified {@link Dataset} is returned.
 *
 * The output is **"Safe-Harbor-transformed per the configured policy"** — it is not certified de-identified,
 * and it is **metadata-only**: pixels are not inspected, so a burned-in-annotation hazard is *flagged*, never
 * cleaned. Always check {@link DicomDeidResult.burnedInAnnotationHazard} before releasing an image.
 *
 * @param dataset - The parsed dataset (`parseDicom(bytes)`).
 * @param options - The policy and (for cross-file UID consistency) a shared `uidMap` / `uidRoot`.
 * @returns The de-identified dataset, the value-free manifest, the warnings, and the metadata-only stance.
 * @example
 * ```ts
 * import { parseDicom } from "@cosyte/dicom";
 * import { deidentifyDicom } from "@cosyte/deid/dicom";
 *
 * const { dataset, manifest, burnedInAnnotationHazard } = deidentifyDicom(parseDicom(part10));
 * manifest; // value-free: category + (gggg,eeee) Keyword + action, never a value
 * if (burnedInAnnotationHazard) {
 *   // do NOT release — pixels may still carry burned-in PHI
 * }
 * ```
 */
export function deidentifyDicom(dataset: Dataset, options: DicomDeidOptions = {}): DicomDeidResult {
  const resolved = resolveDicomOptions(options);
  const { dataset: deidentified, report } = dicomDeidentify(dataset, {
    retain: [],
    deidentificationMethod: resolved.deidentificationMethod,
    ...(resolved.uidRoot !== undefined ? { uidRoot: resolved.uidRoot } : {}),
    ...(resolved.uidMap !== undefined ? { uidMap: resolved.uidMap } : {}),
  });

  const warnings = foldWarnings(report.warnings);
  return Object.freeze({
    dataset: deidentified,
    manifest: foldReport(report),
    warnings,
    metadataOnly: true,
    burnedInAnnotationHazard: warnings.some((w) => w.code === BURNED_IN_ANNOTATION_CODE),
    retained: Object.freeze([...report.retained]),
  });
}

/**
 * Convenience: parse a DICOM Part 10 byte stream, de-identify it, and re-serialize — returning the
 * de-identified bytes and the value-free audit in one call. The re-serialized bytes are a fresh Part 10
 * buffer; the input buffer is never mutated.
 *
 * As with {@link deidentifyDicom}, the result is **metadata-only** — check
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
  const { dataset, manifest, warnings, burnedInAnnotationHazard, retained } = deidentifyDicom(
    parseDicom(bytes),
    options,
  );
  return Object.freeze({
    bytes: serializeDicom(dataset),
    manifest,
    warnings,
    metadataOnly: true,
    burnedInAnnotationHazard,
    retained,
  });
}

export { BURNED_IN_ANNOTATION_CODE } from "./fold.js";
export type {
  DicomDeidOptions,
  DicomDeidResult,
  DicomBufferDeidResult,
  DicomDeidWarning,
} from "./types.js";
export { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
export { OUTPUT_LABEL } from "../index.js";
