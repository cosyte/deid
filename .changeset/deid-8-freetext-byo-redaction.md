---
"@cosyte/deid": patch
---

DEID-8 — free-text / narrative BYO redaction (roadmap §Phase 8). Free-text loci (HL7 OBX-5/NTE, C-CDA
section `<text>`, FHIR note/div, X12 MSG/NTE, NCPDP free text) keep their fail-closed default (blocked)
and gain an optional **bring-your-own** redaction interface: `DeidOptions.redactor` takes a
consumer-supplied `FreeTextRedactor` that the engine invokes at each free-text locus, writing its output
back in place and recording it as consumer-asserted (`DEID_FREETEXT_CONSUMER_REDACTED`, `byo-redact`
transform). The library bundles **no** NLP model and **no** built-in regex scrub — a naive pass is a
false-safety hazard. Fail-closed contract holds regardless: no redactor / a throwing redactor / a
redactor that returns nothing → block, never a leak; only a returned `{ text }` is written back, trusted
as consumer-asserted (the engine does not re-verify it, and "no findings" is not an attestation). The
structural PHI removal the six adapters perform, the clinical over-scrub guard, and the value-free
manifest are unchanged. New public types: `FreeTextRedactor`, `FreeTextRedactionRequest`,
`FreeTextRedactionResult`; new additions-only disposition code `DEID_FREETEXT_CONSUMER_REDACTED`.
