---
id: concepts-archetype
title: Core concepts
sidebar_position: 1
---

# Core Concepts

`@cosyte/deid` is built from five pieces: the **policy engine**, the **five transforms**, the
**18-category Safe Harbor model**, the **fail-closed rule**, and the **value-free manifest**.

## Fail closed (the inverted reflex)

A parser is liberal in what it accepts. A de-identifier is the opposite: on **any** ambiguity — an
unrecognized structure, an un-locatable identifier, a field it cannot classify, a free-text blob, a
date/ZIP it cannot generalize — it **blocks** the value (withholds it), and records the decision. It
never passes a value through as "probably safe". Liberality here leaks patients.

The mirror guard is **over-scrub**: a locus marked `clinical` (a lab value, a dose, a code, a status)
is **retained untouched**. The engine never degenerates into a blanket-blanking "safe but useless"
scrubber.

## The five transforms

- **redact** — remove the value (the fail-safe floor; the default for SSN, phone, email, URL, IP, …).
- **generalize** — reduce precision: **date → year**, **ZIP → initial 3 digits or `000`** (the cited
  ≤20,000-population rule), **age → `90+`** for ages over 89.
- **date-shift** — shift every date for a patient by a single deterministic per-patient offset,
  preserving intervals. An **Expert-Determination** technique (a shifted real date is still a date), so
  it is **not** used under the Safe Harbor policy — the offset never leaks.
- **pseudonymize** — replace an identifier (MRN, beneficiary, account) with a consistent **keyed
  HMAC-SHA-256** surrogate so records still link, without being reversible without the key.
- **hash** — a keyed one-way digest. An **unsalted** hash of an identifier is re-identifiable, so the
  library keys it; the unkeyed path is off by default and documented non-conforming to §164.514(c).

## The 18 Safe Harbor categories

The `SAFE_HARBOR_CATEGORIES` registry models §164.514(b)(2)(i)(A)–(R), including the open-ended
catch-all **(R)** — "any other unique identifying number, characteristic, or code" — which is exactly
why fail-closed is not optional: a closed allow-list of 17 concrete types can never satisfy (R).

## The value-free manifest

Every `DeidManifestEntry` records the **category** acted on, the **transform** applied, the **locus**
(a path — segment/field index, XPath, FHIRPath, DICOM tag), a **count**, a **disposition**, and a
stable **code**. It **never** records the value that was removed, generalized, or pseudonymized — a
manifest that logged a value would be a PHI leak in the audit trail. The date-shift offset and the HMAC
key never appear anywhere.

## Immutability

The input model is never mutated; `deidentify` returns a deeply frozen `DeidResult`.
