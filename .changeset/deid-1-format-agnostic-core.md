---
"@cosyte/deid": patch
---

The de-identification core: a policy engine, five crypto-backed transforms and the 18-category HIPAA
Safe Harbor model, failing closed and never labelling output de-identified. The engine is
`deidentify` / `SAFE_HARBOR_POLICY` / `defineDeidPolicy`; the `node:crypto`-backed transforms are
redact, generalize (date to year, ZIP to 3-digit-or-`000`, age to `90+`), deterministic per-patient
date-shift, keyed-HMAC pseudonymize and keyed hash, with a value-free manifest, tested against a
generic locus model. Output is labelled
"Safe-Harbor-transformed per the configured policy", never "de-identified". Replaces the parser-template
scaffold stubs.
