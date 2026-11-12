---
"@cosyte/deid": patch
---

The FHIR adapter can keep an animal patient's coded species, breed and gender status, with the new `keepPatientAnimal` option, off by default.

- **What changed.** `FhirDeidOptions` and the new `FhirExtractOptions` (the second argument `extractFhirLoci` now takes) gain `keepPatientAnimal`. With it on, a `Patient`'s first extension whose `url` is exactly `http://hl7.org/fhir/StructureDefinition/patient-animal` keeps the `valueCodeableConcept` of its first `species`, `breed` and `genderStatus` sub-extension, as codes: each `Coding`'s `system`, `version`, `code`, `userSelected` and, beside a code or system, `display`. A kept code gets no manifest row and is counted in `unexaminedResiduals`. Everything else stays blocked: a look-alike URL, any other sub-extension or repeat, any other `value[x]` such as a `valueString`, the concept's free `text`, and every other extension. `FHIR_PATIENT_ANIMAL_URL` exports the URL.
- **What a caller changes.** Nothing. Without the option, the output, the manifest and the unexamined residuals are the same as before, byte for byte. To keep the animal fields, pass `keepPatientAnimal: true`, and only when the codes come from a terminology you trust: a kept code is not read, so a code that is really a name passes through.
