---
"@cosyte/deid": patch
---

DEID-1 — the format-agnostic de-identification core: the policy engine (`deidentify`,
`SAFE_HARBOR_POLICY`, `defineDeidPolicy`), the five `node:crypto`-backed transforms (redact,
generalize date→year / ZIP→3-digit-or-`000` / age→`90+`, deterministic per-patient date-shift,
keyed-HMAC pseudonymize, keyed hash), the 18-category HIPAA Safe Harbor model, the fail-closed rule,
and the value-free manifest — tested against a generic locus model. Output is labelled
"Safe-Harbor-transformed per the configured policy", never "de-identified". Replaces the parser-template
scaffold stubs.
