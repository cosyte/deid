---
"@cosyte/deid": patch
---

DEID-7 — the longitudinal layer: cross-document consistency + the key contract. Adds the **corpus
registry** (`createDeidRegistry` / `DeidRegistry`) that keeps a longitudinal record **linkable** after
de-identification: `registry.forPatient(patientKey)` mints a memoized, deterministically-scoped context
so the same patient's dates shift by the same offset — intervals preserved — across every document and
every run; `registry.pseudonym(id)` and `registry.remapUid(uid)` give corpus-wide consistent surrogates
so the same identifier/UID links everywhere while distinct inputs never collide. The registry holds the
consumer's key in a module-private `WeakMap` and **redacts itself through every stringify channel** — the
key and the per-patient offset never appear in output, manifest, or error.

Formalizes the **key contract**: the consumer supplies the HMAC key (and optional distinct date-shift
seed); there is **no weak default** (an absent/empty key is a fatal `DEID_NO_KEY`, never a silent
fallback); and rotating the key is **intentional linkage breakage** (a new key deterministically yields
different offsets and pseudonyms, un-linking a corpus from records made under the old key). The library
holds no persistent key store — custody is the consumer's.

Adds the **`DEID_POLICY_INVALID`** fatal and enforces the label contract at point of use: a policy that
applies the interval-preserving `date-shift` transform may **not** carry the reserved `safe-harbor`
label, because a shifted-but-real date is still a date element (§164.514(b)(2)(i)(C)) — date-shift is an
Expert-Determination-supporting technique, not Safe Harbor. This does not weaken any per-format leak or
over-scrub guarantee; the six adapters are unchanged.
