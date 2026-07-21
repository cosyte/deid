/**
 * The unified-policy → **PS3.15 Annex E option** mapping for the DICOM adapter (roadmap §Phase 6, §4.7).
 *
 * DICOM is the one format `deid` **delegates rather than reimplements**: `@cosyte/dicom` already ships the
 * PS3.15 **Basic Application Level Confidentiality Profile** and the metadata-affecting Annex E Options.
 * This module resolves the unified {@link DeidOptions} into a `@cosyte/dicom` `DeidentifyOptions` — and it
 * does so **fail-closed**: the default `safe-harbor` policy always applies the **full Basic Profile with no
 * Retain/Clean deviations** (maximal removal), so every private tag is removed and every UID is consistently
 * remapped. There is no per-category auto-derivation, on purpose: the Annex E option model is coarser than
 * the 18-category Safe Harbor model, so auto-relaxing it from a policy would risk *under*-removal. A
 * deviation that retains identifying metadata is an Expert-Determination choice deferred to a later phase —
 * this phase cannot be talked into keeping PHI.
 *
 * @packageDocumentation
 */

import { resolvePolicy } from "../policy.js";

import type { DicomDeidOptions } from "./types.js";

/**
 * The subset of `@cosyte/dicom`'s `DeidentifyOptions` this phase produces. Typed structurally (not by
 * importing the parser's type) so the core stays decoupled; the `/dicom` subpath is where the real
 * `@cosyte/dicom` types are used.
 *
 * @internal
 */
export interface ResolvedDicomOptions {
  /** Annex E Retain/Clean options to activate. Always empty in this phase (full Basic Profile). */
  readonly retain: readonly never[];
  /** Root for generated replacement UIDs (Annex E action `U`); undefined → `@cosyte/dicom` default. */
  readonly uidRoot?: string;
  /** Caller-owned source→replacement UID cache for cross-file consistency. */
  readonly uidMap?: Map<string, string>;
  /** The de-identification method text written to `(0012,0063)`. */
  readonly deidentificationMethod: string;
}

/**
 * Resolve the unified de-id options into the concrete `@cosyte/dicom` de-identification options for this
 * phase: the full Basic Profile (no Retain/Clean options), consistent UID remapping, and a policy-named
 * De-identification Method string. The `context` (HMAC key) is intentionally unused — Annex E dummying and
 * content-derived UID remapping do not consume the keyed-transform key; it is accepted only for API
 * uniformity with the other adapters.
 *
 * @param options - The unified de-id options (policy + optional UID cache/root).
 * @returns The fail-closed `@cosyte/dicom` de-identification options.
 * @internal
 */
export function resolveDicomOptions(options: DicomDeidOptions): ResolvedDicomOptions {
  const policy = resolvePolicy(options.policy);
  const base: ResolvedDicomOptions = {
    retain: [],
    deidentificationMethod: `Cosyte @cosyte/deid — PS3.15 Basic Application Level Confidentiality Profile (metadata only); policy "${policy.name}"`,
  };
  return {
    ...base,
    ...(options.uidRoot !== undefined ? { uidRoot: options.uidRoot } : {}),
    ...(options.uidMap !== undefined ? { uidMap: options.uidMap } : {}),
  };
}
