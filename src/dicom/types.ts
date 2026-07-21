/**
 * Public types for the DICOM de-identification adapter (`@cosyte/deid/dicom`).
 *
 * @packageDocumentation
 */

import type { Dataset } from "@cosyte/dicom";

import type { DeidManifestEntry } from "../manifest.js";
import type { DeidPolicy } from "../policy.js";

/**
 * Options controlling a DICOM de-identification run. Extends the unified options with the two DICOM-only
 * knobs that make **relationships survive** de-identification: a shared UID cache and a UID root.
 *
 * The `context` (HMAC key) carried by the unified {@link "@cosyte/deid".DeidOptions} is **not used** here —
 * PS3.15 Annex E dummying and content-derived UID remapping do not consume a keyed-transform key. It is
 * accepted only for API uniformity with the other adapters. The `policy` selects the output **label** and
 * guarantees the fail-closed posture; the DICOM de-identification itself is **always** the full Basic
 * Application Level Confidentiality Profile (the delegated Annex E action map is authoritative — this
 * adapter orchestrates, it does not reimplement).
 *
 * @example
 * ```ts
 * import { deidentifyDicom, type DicomDeidOptions } from "@cosyte/deid/dicom";
 *
 * // One shared cache makes UID remapping consistent across every file in a study/archive.
 * const uidMap = new Map<string, string>();
 * const opts: DicomDeidOptions = { uidMap };
 * ```
 */
export interface DicomDeidOptions {
  /** The policy to apply. Defaults to the built-in Safe Harbor policy. Selects the output label. */
  readonly policy?: DeidPolicy | "safe-harbor";
  /**
   * A caller-owned source→replacement UID cache. Share one `Map` across a whole study/archive so
   * Study/Series/SOP Instance UIDs remap **consistently** and the relationships between de-identified
   * objects survive. The map holds UIDs (instance identifiers), never patient data; the adapter does not
   * surface it in the value-free result, so pass your own `Map` if you need the mapping.
   */
  readonly uidMap?: Map<string, string>;
  /** Root for generated replacement UIDs (Annex E action `U`); undefined → `@cosyte/dicom` default. */
  readonly uidRoot?: string;
}

/**
 * A value-free de-identification warning surfaced from the delegated Annex E pass. Carries a stable code
 * and a PHI-free message — never a decoded pixel or attribute value.
 *
 * @example
 * ```ts
 * import { deidentifyDicom, type DicomDeidWarning } from "@cosyte/deid/dicom";
 *
 * const { warnings } = deidentifyDicom(dataset);
 * warnings.forEach((w: DicomDeidWarning) => console.warn(w.code)); // safe to log
 * ```
 */
export interface DicomDeidWarning {
  /** The stable `@cosyte/dicom` warning code (e.g. `DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED`). */
  readonly code: string;
  /** A PHI-free description safe to log. */
  readonly message: string;
}

/**
 * The result of de-identifying a parsed DICOM dataset: the fresh de-identified {@link Dataset}, the folded
 * value-free manifest, the safety warnings, and the honest **metadata-only** stance.
 *
 * The input dataset is never mutated. **`metadataOnly` is always `true`**: this is a *metadata*
 * de-identifier — it cannot inspect or clean pixels, so recognizable text **burned into the image** is not
 * removed. When {@link burnedInAnnotationHazard} is `true`, the output must be treated as **not safe to
 * share** until the pixels are reviewed by a pixel-capable tool (a future `@cosyte/dicom-pixel`).
 *
 * @example
 * ```ts
 * import { deidentifyDicom } from "@cosyte/deid/dicom";
 *
 * const { dataset, manifest, burnedInAnnotationHazard, metadataOnly } = deidentifyDicom(parsed);
 * metadataOnly; // => true — always
 * if (burnedInAnnotationHazard) {
 *   // do NOT release: pixels may carry burned-in PHI this metadata-only pass cannot remove
 * }
 * ```
 */
export interface DicomDeidResult {
  /** The de-identified dataset (a fresh `@cosyte/dicom` `Dataset`; the input is never mutated). */
  readonly dataset: Dataset;
  /** The value-free audit of every attribute acted on — category + locus + action, never a value. */
  readonly manifest: readonly DeidManifestEntry[];
  /** Value-free safety warnings from the delegated Annex E pass (notably burned-in annotation). */
  readonly warnings: readonly DicomDeidWarning[];
  /** Always `true` — this is a metadata-only de-identifier; pixels are not inspected or cleaned. */
  readonly metadataOnly: true;
  /**
   * `true` when Pixel Data is present and not affirmatively marked free of burned-in annotation — the
   * output may still carry recognizable text in the image and is **not** safe to release on metadata alone.
   */
  readonly burnedInAnnotationHazard: boolean;
  /**
   * The Annex E Retain/Clean options that were active. Empty in this phase (the full Basic Profile applies
   * with no deviations); surfaced so a reviewer can confirm nothing was retained.
   */
  readonly retained: readonly string[];
}

/**
 * The result of {@link deidentifyDicomBuffer}: the re-serialized de-identified Part 10 bytes plus the same
 * audit fields as {@link DicomDeidResult} (minus the in-memory dataset).
 *
 * @example
 * ```ts
 * import { deidentifyDicomBuffer } from "@cosyte/deid/dicom";
 *
 * const { bytes, burnedInAnnotationHazard } = deidentifyDicomBuffer(part10);
 * // `bytes` is a fresh Part 10 buffer; safe to persist only if !burnedInAnnotationHazard.
 * ```
 */
export interface DicomBufferDeidResult {
  /** The de-identified DICOM Part 10 byte stream (freshly serialized). */
  readonly bytes: Buffer;
  /** The value-free audit of every attribute acted on. */
  readonly manifest: readonly DeidManifestEntry[];
  /** Value-free safety warnings from the delegated Annex E pass. */
  readonly warnings: readonly DicomDeidWarning[];
  /** Always `true` — metadata-only de-identification. */
  readonly metadataOnly: true;
  /** `true` when the image may carry burned-in PHI this metadata-only pass cannot remove. */
  readonly burnedInAnnotationHazard: boolean;
  /** The Annex E Retain/Clean options that were active (empty in this phase). */
  readonly retained: readonly string[];
}
