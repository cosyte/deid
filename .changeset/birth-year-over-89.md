---
"@cosyte/deid": patch
---

A date of birth whose year shows an age over 89 is now removed under the Safe Harbor policy, rather than kept as a year.

This changes output bytes for anyone who de-identifies records of people aged 90 or older under a policy that generalizes dates, the default `safe-harbor` policy included. Before, the year of the birth date was kept and recorded as a `DEID_RESIDUAL_RETAINED` residual. Now, when the year is 90 or more years before the UTC year of the call, the field is emptied and the manifest records `DEID_CATEGORY_GENERALIZED` with the disposition `removed`. This covers HL7 v2 `PID-7`, `GT1-8` and `IN1-18`, every C-CDA `<birthTime>`, FHIR `birthDate`, X12 `DMG-02` and NCPDP Telecom `304-C4`. A year-only FHIR `birthDate` is now located and recorded too. DICOM is unchanged: the Basic Profile already empties Patient's Birth Date for everyone.

The age is measured against the year the pass runs, not a date in the document, and by year alone, so the same input can lose a birth year in a later calendar year. Birth years under the line, and every date that is not a date of birth, keep their year exactly as before. A date-shift or retention policy is unaffected.

`GenericLocus` gains an optional `dateOfBirth` flag. A caller who builds loci by hand for the root entry sets `dateOfBirth: true` on a birth-date locus to get the rule; without it the year is kept as before. The HL7, NCPDP Telecom and X12 rule types gain the same optional field.
