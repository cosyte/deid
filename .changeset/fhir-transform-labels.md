---
"@cosyte/deid": patch
---

The FHIR adapter can now mark its output as transformed: an opt-in `meta.security` label on each resource it changed, and a Data Absent Reason where it removed a required element.

- **What changed.** `deidentifyFhir` and `deidentifyFhirJson` take a new `transformLabels` option (the new `FhirDeidOptions` type, which extends `DeidOptions`), and `applyFhir` takes it as a fourth argument (`FhirApplyOptions`). With it on, each resource the pass changed gets the `meta.security` coding `REDACTED` from `http://terminology.hl7.org/CodeSystem/v3-ObservationValue`, added to any labels already there, and an element R4 requires that the pass removed or emptied gets the `data-absent-reason` extension with the code `masked` in its place. A contained resource is never labeled; its container is. `FHIR_TRANSFORMED_SECURITY_LABEL` and `FHIR_DATA_ABSENT_REASON` export the two codes.
- **What the label claims.** `REDACTED` says some of the resource was filtered out. It does not say the resource is de-identified, anonymized or pseudonymized.
- **What a caller changes.** Nothing: the option is off by default, and without it the output is what it was. To use it, pass `{ transformLabels: true }`.
