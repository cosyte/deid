---
"@cosyte/deid": patch
---

DEID-6 — the DICOM de-identification adapter (`@cosyte/deid/dicom`). The one adapter that **delegates
rather than reimplements**: `@cosyte/dicom` already ships the PS3.15 **Annex E** de-identification (the
Basic Application Level Confidentiality Profile), so this adapter orchestrates that pass under the unified
policy and **folds its value-free report into the unified manifest**. `@cosyte/dicom` is an optional peer
dep consumed only from this subpath. `deidentifyDicom(dataset, opts?)` and the convenience
`deidentifyDicomBuffer(bytes, opts?)` (parse → de-id → re-serialize): the full Basic Profile applies by
default (no key needed) — Patient Name/ID/Birth Date, institution, referring physician, dates and the
enumerated Annex E attributes removed; Study/Series/SOP Instance UIDs **consistently remapped** so
relationships survive; **private tags removed** (fail-closed — kept only via a known-safe retain list,
empty by default); clinical/technical values and pixel bytes retained untouched; `Patient Identity
Removed = YES` inserted. **Pixel PHI is flagged, never cleaned** — this is a metadata-only de-identifier
(`metadataOnly` is always `true`), so burned-in annotation raises `burnedInAnnotationHazard` +
`DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED` rather than a false claim of a clean image. The value-free
manifest classifies each acted-on tag to its Safe Harbor category, falling closed to (R) for anything it
cannot positively classify; the source→replacement UID map is never surfaced. The structured-format core
is now feature-complete across all six formats.
