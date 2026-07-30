---
"@cosyte/deid": patch
---

A malformed input document could put clinical narrative into the value-free manifest and into the Expert-Determination support report, on default options, and it no longer can.

Five of the six format adapters name a manifest `locus` by interpolating the identifier at that
position: an HL7 v2 segment id, a C-CDA element local name, a FHIR element name and `resourceType`, an
X12 segment id and `ST-01`, an NCPDP segment code. (The DICOM manifest is not in that list and is
unchanged: its locus is composed from the tag and keyword its upstream pass reports, not from document
bytes.) None of those was checked before it was interpolated, and no parser is obliged to hand back an
identifier there. On a line or an element it cannot recognize, a
parser reports whatever bytes stood in that position, and on an unrecognized HL7 narrative
continuation line that content is clinical prose. A 200,039-byte locus from a 200,010-byte input was
reproduced on `deidentifyHl7(msg, {})` with no options set, and the equivalent for C-CDA, FHIR, X12
and NCPDP. `buildExpertDeterminationSupportReport()` copies each locus into `perLocus`, so it
travelled into the structured object a consumer hands to an outside statistician;
`formatExpertDeterminationSupportReport()` does not print loci and was not affected.

Each identifier is now checked against the shape its position promises, against the cited spec for
that format, before it enters a locus. A conforming identifier is returned byte-identical, so a
well-formed document produces exactly the manifest it produced before. A non-conforming one is
refused whole rather than truncated, and the locus reads the new public `WITHHELD_LOCUS_TOKEN`
(`<withheld>`) plus that position's structural index, so two refused positions stay distinct rows.
This is a bound, not an impossibility claim: content that happens to match the shape is still echoed,
and how much that is depends on the position. The HL7, X12 and NCPDP shapes cap at three characters
with no separator and no whitespace; the C-CDA and FHIR element-name shapes cap at 64 and 65, so an
unspaced token that long is still echoed there.

Error messages were not affected and are unchanged; every error this package raises is a fixed
sentence with nothing interpolated.

Separately, `deidentifyDicom()` no longer returns a dataset carrying the input file's parse warnings.
The delegated PS3.15 Annex E pass copied them across from the source dataset, so the de-identified
`Dataset` arrived holding diagnostics written about the bytes as they were before anything was
removed, and one of those may quote a value it could not interpret. The warnings raised by the pass
itself are unchanged and still returned on `DicomDeidResult.warnings`.

If you have `0.0.2` installed, upgrade, and treat any manifest, log, or Expert-Determination support
report produced by `0.0.2` or earlier from input that was not spec-clean as potentially carrying PHI,
on the same footing as the input document. The de-identified output documents were never affected:
this was the audit artifact, not the wire.
