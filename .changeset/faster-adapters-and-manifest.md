---
"@cosyte/deid": patch
---

The HL7 v2, DICOM and X12 passes and the manifest now do less work per document, and every de-identified output, manifest row and unexamined residual is unchanged.

- **HL7 v2.** The check that the transformed message round-trips through its parser now reads the message once and writes it back once, where it read it twice and wrote it three times. The result carries the wire it wrote on a new `hl7` field, the same text as `document.toString()`, so a caller that wants the text no longer writes the message again: read `result.hl7` instead of calling `result.document.toString()`. A new `deidentifyHl7String(raw, options)` parses one message and de-identifies it, like `deidentifyX12String` and `deidentifyFhirJson`. Both are additions; nothing existing changed, and a message that does not round-trip is still refused with `DEID_OUTPUT_INVALID`.
- **DICOM.** Pixel Data is copied at most once. `deidentifyDicomBuffer` writes its file with the Pixel Data value copied once, straight into the returned buffer, and `deidentifyDicom` no longer writes the Pixel Data at all to check the coded method declaration, which sits in front of it. The bytes returned are the same bytes as before.
- **The manifest and the unexamined residuals.** A repeated row or position is counted in place, and a manifest row is found by its locus instead of a key built for every value, so the policy engine's time grows in line with the number of loci.
- **X12.** The X12 pass records the elements it decided on each segment directly, instead of under a key built for each segment.

The parsers the tests and benchmarks run against move to their current releases: `@cosyte/hl7` 0.1.8, `@cosyte/ccda` 0.1.6, `@cosyte/fhir` 0.1.8, `@cosyte/x12` 0.1.10 and `@cosyte/dicom` 0.1.11. The peer ranges are unchanged.
