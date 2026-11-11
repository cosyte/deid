/**
 * Public types for the DICOM de-identification adapter (`@cosyte/deid/dicom`).
 *
 * @packageDocumentation
 */

import type { Dataset } from "@cosyte/dicom";

import type { DeidManifestEntry } from "../manifest.js";
import type { DeidPolicy } from "../policy.js";
import type { UnexaminedResidual } from "../residual.js";

import type { DicomAnnexEOption } from "./annex-e-options.js";
import type { DicomCodedTerm, DicomOptionDeclaration } from "./method-codes.js";
import type { DicomUidReferentialIntegrity } from "./uid-scope.js";

/**
 * Options controlling a DICOM de-identification run. Extends the unified options with the two DICOM-only
 * knobs that make **relationships survive** de-identification: a shared UID cache and a UID root.
 *
 * The `context` (HMAC key) carried by the unified {@link "@cosyte/deid".DeidOptions} is **not used** here:
 * PS3.15 Annex E dummying and content-derived UID remapping do not consume a keyed-transform key. It is
 * accepted only for API uniformity with the other adapters. The `policy` selects the output **label** and
 * guarantees the fail-closed posture; the DICOM de-identification itself is the Basic Application Level
 * Confidentiality Profile plus the Annex E options named in `annexEOptions`, none by default (the
 * delegated Annex E action map is authoritative, this adapter orchestrates, it does not reimplement).
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
  /**
   * The PS3.15 Annex E options to apply on top of the Basic Profile, from
   * {@link "@cosyte/deid/dicom".DICOM_ANNEX_E_OPTIONS}. None by default. Each applied option is written to
   * `(0012,0064)` by its CID 7050 term and named in `(0012,0063)`, and every attribute a Retain option
   * keeps is a `retained` manifest row.
   *
   * - `"CleanDescriptors"`: descriptions and comments are emptied rather than removed. Allowed under
   *   any policy.
   * - `"RetainPatientCharacteristics"`: age, sex, size, weight and the other characteristics of
   *   Table E.1-1 are kept. Refused under a policy named `safe-harbor`: it keeps an age over 89.
   * - `"RetainDeviceIdentity"`: device serial numbers, station names and device identifiers are kept.
   *   Refused under a policy named `safe-harbor`: it keeps device identifiers.
   *
   * Any other entry is refused with `DEID_POLICY_INVALID`, never ignored.
   *
   * @example
   * ```ts
   * import { defineDeidPolicy } from "@cosyte/deid";
   * import { deidentifyDicom } from "@cosyte/deid/dicom";
   *
   * const research = defineDeidPolicy({ name: "imaging-research" });
   * const { retained } = deidentifyDicom(dataset, {
   *   policy: research,
   *   annexEOptions: ["RetainPatientCharacteristics"],
   * });
   * retained; // => ["RetainPatientCharacteristics"]
   * ```
   */
  readonly annexEOptions?: readonly DicomAnnexEOption[];
}

/**
 * A value-free de-identification warning surfaced from the delegated Annex E pass. Carries a stable code
 * and a PHI-free message, never a decoded pixel or attribute value.
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
 * de-identifier: it cannot inspect or clean pixels, so recognizable text **burned into the image** is not
 * removed. When {@link burnedInAnnotationHazard} is `true`, the output must be treated as **not safe to
 * share** until the pixels are reviewed by a pixel-capable tool (a future `@cosyte/dicom-pixel`).
 *
 * @example
 * ```ts
 * import { deidentifyDicom } from "@cosyte/deid/dicom";
 *
 * const { dataset, manifest, burnedInAnnotationHazard, metadataOnly } = deidentifyDicom(parsed);
 * metadataOnly; // => true: always
 * if (burnedInAnnotationHazard) {
 *   // do NOT release: pixels may carry burned-in PHI this metadata-only pass cannot remove
 * }
 * ```
 */
export interface DicomDeidResult {
  /** The de-identified dataset (a fresh `@cosyte/dicom` `Dataset`; the input is never mutated). */
  readonly dataset: Dataset;
  /** The value-free audit of every attribute acted on: category + locus + action, never a value. */
  readonly manifest: readonly DeidManifestEntry[];
  /**
   * The manifest's **second list**: every attribute present in the returned dataset, nested sequence
   * items included, that the delegated Annex E report does **not** account for, counted and located.
   * Those are the positions no rule reached; an attribute the profile **kept** is not one of them,
   * because keeping it is a decision. An empty list is a **measured zero**, not a silence.
   */
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
  /** Value-free safety warnings from the delegated Annex E pass (notably burned-in annotation). */
  readonly warnings: readonly DicomDeidWarning[];
  /** Always `true`: this is a metadata-only de-identifier; pixels are not inspected or cleaned. */
  readonly metadataOnly: true;
  /**
   * `true` when Pixel Data is present and not affirmatively marked free of burned-in annotation: the
   * output may still carry recognizable text in the image and is **not** safe to release on metadata alone.
   */
  readonly burnedInAnnotationHazard: boolean;
  /**
   * The Annex E Retain/Clean options that were active: exactly the options named in `annexEOptions`,
   * in table order. Empty when none was named, so a reviewer can confirm nothing was retained.
   */
  readonly retained: readonly string[];
  /**
   * The CID 7050 coded terms written to De-identification Method Code Sequence `(0012,0064)` on
   * {@link dataset}: the profile, then every option the run **applied**, in that order. These are the
   * terms corresponding to the Profile and Options *used*, so a withheld option is never among them.
   */
  readonly deidentificationMethodCodes: readonly DicomCodedTerm[];
  /**
   * Every Annex E option this adapter can name, each declared **applied** or **withheld** by its CID
   * 7050 coded term. The withheld half is readable only here, never in `(0012,0064)`.
   */
  readonly optionDeclarations: readonly DicomOptionDeclaration[];
  /** How far replacement-UID referential integrity reaches for this run. */
  readonly uidReferentialIntegrity: DicomUidReferentialIntegrity;
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
  /** Every attribute the delegated report does not account for: the positions no rule reached. */
  readonly unexaminedResiduals: readonly UnexaminedResidual[];
  /** Value-free safety warnings from the delegated Annex E pass. */
  readonly warnings: readonly DicomDeidWarning[];
  /** Always `true`: metadata-only de-identification. */
  readonly metadataOnly: true;
  /** `true` when the image may carry burned-in PHI this metadata-only pass cannot remove. */
  readonly burnedInAnnotationHazard: boolean;
  /** The Annex E Retain/Clean options that were active (empty unless `annexEOptions` named one). */
  readonly retained: readonly string[];
  /**
   * The CID 7050 coded terms written to De-identification Method Code Sequence `(0012,0064)` in
   * {@link bytes}: the profile, then every option the run **applied**. A withheld option is never here.
   */
  readonly deidentificationMethodCodes: readonly DicomCodedTerm[];
  /**
   * Every Annex E option this adapter can name, each declared **applied** or **withheld** by its CID
   * 7050 coded term. The withheld half is readable only here, never in `(0012,0064)`.
   */
  readonly optionDeclarations: readonly DicomOptionDeclaration[];
  /** How far replacement-UID referential integrity reaches for this run. */
  readonly uidReferentialIntegrity: DicomUidReferentialIntegrity;
}
