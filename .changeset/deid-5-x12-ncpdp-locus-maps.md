---
"@cosyte/deid": patch
---

DEID-5 — the X12 EDI and NCPDP Telecom de-identification adapters (`@cosyte/deid/x12`,
`@cosyte/deid/ncpdp`). Each binds the format-agnostic core to a parser model, locating PHI
**structurally** (never by regex over the bytes) and returning the de-identified byte stream plus the
value-free manifest. `@cosyte/x12` and `@cosyte/ncpdp` are optional peer deps consumed only from their
subpaths. X12: entity-classified `NM1` (patient scrubbed / provider retained / unknown fails closed),
`N3`/`N4`/`DMG`/`PER`/`DTP` handled universally, qualifier-classified `REF` (unknown qualifier fails
closed), `CLM-01`/`CLP-01` account pseudonymized. NCPDP Telecom: Patient/Prescriber/Insurance/COB
fields + header Date of Service, free-text and unknown segments fail closed. NCPDP SCRIPT deferred (its
lossy serialize and address-less Patient model make a faithful structural de-id infeasible through the
current parser surface).
