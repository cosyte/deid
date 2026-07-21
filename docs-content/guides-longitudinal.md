---
id: guides-longitudinal
title: Longitudinal de-identification
sidebar_position: 8
---

# Longitudinal de-identification

Research and analytics need a de-identified record that stays **linkable**: the same patient across a
whole corpus of documents must map to the same pseudonyms and the same shifted dates, so a longitudinal
history holds together — while absolute calendar positions and real identifiers are gone. This is the
job of the **registry** (`createDeidRegistry`).

> **Honesty note.** Date-shifting **retains dates in shifted form**, so a shifted-but-real date is still
> "an element of a date" under 45 CFR §164.514(b)(2)(i)(C). Date-shift is therefore an
> **Expert-Determination-supporting** technique, **not** Safe Harbor. The library enforces this: a
> policy that date-shifts may **not** carry the `safe-harbor` label (see below). Under Safe Harbor,
> dates are generalized to year instead.

## Cross-document consistency

A `DeidRegistry` holds the consumer's key and mints a per-patient context on demand. The same patient
key always yields the same deterministic date-shift offset, so a patient's dates shift identically
across every document — intervals (`3 days later` stays 3 days later) are preserved exactly. The same
identifier maps to the same pseudonym corpus-wide.

```ts runnable
import { createDeidRegistry, deidentify, defineDeidPolicy, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const registry = createDeidRegistry({ key: "consumer-held-secret" });
const research = defineDeidPolicy({
  name: "research",
  transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
});

// One patient scope, reused across every document belonging to that patient.
const ctx = registry.forPatient("patient-1");
const shift = (date: string) =>
  deidentify(
    { loci: [{ path: "PID-7", kind: "date", category: SAFE_HARBOR_CATEGORIES.DATES, value: date }] },
    { policy: research, context: ctx },
  ).document.loci[0].value;

// The same input date de-identifies to the same shifted value in every document (linkage preserved).
shift("2020-03-01") === shift("2020-03-01"); // => true

// The same MRN maps to the same pseudonym across the whole corpus.
registry.pseudonym("MRN-1") === registry.pseudonym("MRN-1"); // => true
```

Use `registry.forPatient(patientKey)` once per patient and pass its context to `deidentify` (or any
per-format adapter) for that patient's documents. Use `registry.pseudonym(id)` for a corpus-wide
consistent surrogate of a standalone identifier, and `registry.remapUid(uid)` for opaque unique
identifiers (study/series/instance UIDs, GUIDs) you thread across files.

## The key contract

- **You supply the key.** The HMAC key (and an optional distinct date-shift seed) is the consumer's. It
  is held only inside the library and **never** appears in an output document, a manifest, or a thrown
  error — the registry redacts itself through every stringify channel.
- **Fail closed — no weak default.** There is no built-in or default key. An absent or empty key is a
  fatal `DEID_NO_KEY`, never a silent fallback that would produce a re-identifiable surrogate.
- **Rotation is intentional linkage breakage.** A new key deterministically produces *different*
  offsets and *different* pseudonyms, so a corpus de-identified under a rotated key **no longer links**
  to records made under the old key. Rotate to sever linkage; keep the key to preserve it. The library
  holds **no persistent key store** — key custody and lifetime are yours.

```ts runnable throws
import { createDeidRegistry } from "@cosyte/deid";

// No key → DEID_NO_KEY. The library never falls back to a weak default.
createDeidRegistry({ key: "" });
```

A date-shifting policy may not claim the Safe Harbor label — the library rejects the mislabel rather
than emit shifted real dates under a Safe Harbor claim:

```ts runnable throws
import { defineDeidPolicy, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

// A shifted real date is still a date element — this is Expert-Determination, not Safe Harbor.
defineDeidPolicy({ name: "safe-harbor", transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" } });
```
