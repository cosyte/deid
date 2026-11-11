---
"@cosyte/deid": patch
---

The type declarations' comments now describe output in the package's own words, and the FHIR adapter's overview says free text is blocked, as the code does. No behavior changes.

- **FHIR free text.** The `@cosyte/deid/fhir` overview said an `Observation.valueString` and an `Annotation.text` are retained. They are not: a `note`, a `contentString` and an uncoded `valueString` are blocked and recorded as `DEID_FREETEXT_BLOCKED` unless a redactor you supply returns its own text, and the narrative `text.div` is blocked at any depth. The comment now says so. What a pass removes, keeps or records is unchanged.
- **Wording.** The `@example` comments on the HL7 v2, C-CDA, FHIR, X12 and NCPDP results and appliers called their output "de-identified". They now call it transformed, the label the package gives its output (`OUTPUT_LABEL`). The README's samples and status (the 0.2 line) follow.
- Nothing a caller writes needs to change.
