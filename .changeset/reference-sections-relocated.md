---
"@cosyte/deid": patch
---

Documentation only. The README now carries the overview, the install and de-identify quickstart, the
HL7 v2 walkthrough and the limitations, and the remaining reference sections move into this
repository's `documentation/` directory, linked from the heading each one left behind.

Nothing was rewritten and nothing was removed. Every section moved whole and unchanged, under its own
heading, so each scoped claim reads exactly as it did: the output is Safe-Harbor-transformed per the
configured policy and never certified, free text is blocked by default, a consumer redactor is
consumer-asserted and never re-verified, the DICOM pass is metadata-only with burned-in pixels
flagged rather than cleaned, and NCPDP SCRIPT is refused outright.

The C-CDA, FHIR, X12, NCPDP Telecom and DICOM adapter references, together with the free-text section
they cross-reference, are in `documentation/format-adapters.md`. The keyed transforms, the
longitudinal registry, the Expert-Determination support report and the policy profiles are in
`documentation/policy-and-reports.md`.
