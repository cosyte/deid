---
"@cosyte/deid": patch
---

DEID-2 — the HL7 v2 de-identification adapter (`@cosyte/deid/hl7`): the first end-to-end format binding
of the core. It locates PHI structurally in the parsed `@cosyte/hl7` model (never by regex) and returns a
transformed `Hl7Message` plus the value-free manifest. Structured locus map over PID (patient) and
NK1/GT1/IN1/IN2 (relatives/guarantor/insured) — names/SSN/phone removed, MRN/account/beneficiary
pseudonymized (keyed HMAC), DOB → year, address → safe 3-digit ZIP, PID-3 routed by CX-5 type code.
OBX-5/NTE free text and Z-segments/unknown structure fail closed; clinical values, units, codes, and
statuses survive untouched. `@cosyte/hl7` is an optional peer dependency consumed only from the `/hl7`
subpath; third-party runtime deps stay zero. Leak-test and over-scrub-test gates ship as tests, and
`phi-scan` gains HL7 structured field-level detection.
