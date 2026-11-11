---
"@cosyte/deid": patch
---

An age over 89 written as a number, and several birth dates and contact fields the maps missed, are now removed under the Safe Harbor policy.

This changes output bytes for documents that carry these positions. Under a policy that generalizes dates, the default `safe-harbor` policy included, an age over 89 written as a number is removed and recorded as `DEID_CATEGORY_GENERALIZED` with the disposition `removed`; an age of 89 or under is kept exactly as written, recorded with the disposition `retained` and the code `DEID_RESIDUAL_RETAINED`. The unit is read first, so an age in months, weeks or days is converted to years, and an age with an unknown unit is blocked. The ages located are an HL7 v2 OBX result typed `NM` whose OBX-3 codes it as an age (LOINC `30525-0` and others), a FHIR `Age` (`Condition.onsetAge`, `FamilyMemberHistory.ageAge` and `deceasedAge`, and the other `Age` arms), each bound of an age `Range`, an age-coded `Observation.valueQuantity`, `valueInteger` or `valueRange`, and a C-CDA age observation in the clinical body. Under a date-shift policy every age is kept and recorded as a residual.

Birth dates now treated as birth dates, so a year that shows an age over 89 is removed: HL7 v2 `NK1-16`, an OBX date result coded as a birth date (LOINC `21112-8`), a relative's `birthTime` in a C-CDA family history (and any other `birthTime` in the clinical body), FHIR `FamilyMemberHistory.bornDate`, each bound of `bornPeriod`, `bornString`, and an `Observation.valueDateTime` coded as a birth date.

A removed C-CDA `birthTime`, and a removed C-CDA age, now carry `nullFlavor="MSK"` instead of being written empty. Other removed C-CDA dates are written as before.

The HL7 v2 map now names `NK1-12` (employee number, blocked), `NK1-13` (organisation name, removed) and the v2.7 telecoms `PID-40`, `NK1-40` and `NK1-41` (removed). `NK1-33` and `NK1-37` were swapped in the map: `NK1-33` is now read as the associated party's identifiers (one identifier per repetition, recorded as a medical record number) and `NK1-37` as the contact person's Social Security number. Both were removed before and are removed now; the recorded category, and what a keyed policy does with each, change. FHIR now removes `Location.position` unless every coding on the Location's `type` and `physicalType` is a known facility code in its known system (v3 RoleCode by URI or OID, location-physical-type by URI); a home, an unknown system, a coding with no system, a mixed list or no type at all removes it.

`GenericLocus` gains an optional `ageUnit`. A caller who builds `age` loci by hand sets it to get the number rule; without it an age over 89 still becomes `90+`. `FhirEditKind` gains `"age"` and `CcdaEditKind` gains `"age-value"`: a caller with an exhaustive switch over either adds the new case.
