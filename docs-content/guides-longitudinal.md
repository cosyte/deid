---
id: guides-longitudinal
title: Keep a patient linkable across documents
sidebar_label: Linkable records
description: "Keep one patient linkable across documents with a keyed registry, the key contract, and what the limited-data-set preset keeps."
---

# Keep a patient linkable across documents

Research and analytics need a transformed record that stays **linkable**: the same patient across a
whole corpus of documents must map to the same pseudonyms and the same shifted dates, so a longitudinal
history holds together, while absolute calendar positions and real identifiers are gone. This is the
job of the **registry** (`createDeidRegistry`).

> **Honesty note.** Date-shifting **retains dates in shifted form**, so a shifted-but-real date is still
> "an element of a date" under 45 CFR §164.514(b)(2)(i)(C). A keyed surrogate of an identifier is
> likewise **derived from information about the individual**, so it is not a §164.514(c)(1) code and
> the (R) exception does not reach it. Both are therefore **Expert-Determination-supporting**
> techniques, **not** Safe Harbor. The library enforces this: a policy carrying the `safe-harbor`
> label may carry **neither** (see below), and it is refused with a typed fatal naming the offending
> category and transform. Under Safe Harbor, dates are generalized to year, and the medical record,
> health plan beneficiary, and account numbers are removed instead. Every keyed surrogate a
> non-Safe-Harbor preset does emit is flagged `reidentificationCode` in the manifest and inventoried
> in the Expert-Determination support report.

## Cross-document consistency

A `DeidRegistry` holds the consumer's key and mints a per-patient context on demand. The same patient
key always yields the same deterministic date-shift offset, so a patient's dates shift identically
across every document: intervals (`3 days later` stays 3 days later) are preserved exactly. The same
identifier maps to the same pseudonym corpus-wide.

```ts runnable
import {
  createDeidRegistry,
  deidentify,
  defineDeidPolicy,
  SAFE_HARBOR_CATEGORIES,
} from "@cosyte/deid";

const registry = createDeidRegistry({ key: "consumer-held-secret" });
const research = defineDeidPolicy({
  name: "research",
  transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
});

// One patient scope, reused across every document belonging to that patient.
const ctx = registry.forPatient("patient-1");
const shift = (date: string) =>
  deidentify(
    {
      loci: [{ path: "PID-7", kind: "date", category: SAFE_HARBOR_CATEGORIES.DATES, value: date }],
    },
    { policy: research, context: ctx },
  ).document.loci[0]?.value;

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
  error: the registry redacts itself through every stringify channel.
- **Fail closed, no weak default.** There is no built-in or default key. An absent or empty key is a
  fatal `DEID_NO_KEY`, never a silent fallback that would produce a re-identifiable surrogate.
- **At least 16 bytes; use 32 random bytes.** `createDeidRegistry` and `createDeidContext` refuse a
  key, or an explicit `dateShiftSeed`, shorter than 16 bytes (128 bits) with a fatal
  `DEID_KEY_TOO_SHORT`. The length is counted on the bytes the HMAC uses: a `Uint8Array` as given, a
  string as its UTF-8 bytes (a hex or base64 string is not decoded). Make a key with
  `crypto.randomBytes(32)` or `openssl rand -hex 32`, and store it as you would any secret: keeping it
  is what keeps the corpus linkable. The check counts bytes, not randomness, so a short phrase padded
  to 16 characters passes it and is still guessable.
- **Rotation is intentional linkage breakage.** A new key deterministically produces _different_
  offsets and _different_ pseudonyms, so a corpus transformed under a rotated key **no longer links**
  to records made under the old key. Rotate to sever linkage; keep the key to preserve it. The library
  holds **no persistent key store**: key custody and lifetime are yours. The rest of what stays with
  you is in [What the caller still owns](./what-the-caller-still-owns.md).

```ts runnable throws
import { createDeidRegistry } from "@cosyte/deid";

// No key → DEID_NO_KEY. The library never falls back to a weak default.
createDeidRegistry({ key: "" });
```

```ts runnable throws
import { createDeidRegistry } from "@cosyte/deid";

// 15 bytes → DEID_KEY_TOO_SHORT. The message names the minimum and never the key.
createDeidRegistry({ key: "synthetic-key15" });
```

```ts runnable
import { randomBytes } from "node:crypto";
import { createDeidRegistry } from "@cosyte/deid";

// 32 random bytes: the key to use. Persist it to keep linkage across runs.
const registry = createDeidRegistry({ key: randomBytes(32) });
registry.pseudonym("MRN-1") === registry.pseudonym("MRN-1"); // => true
```

A date-shifting policy may not claim the Safe Harbor label: the library rejects the mislabel rather
than emit shifted real dates under a Safe Harbor claim:

```ts runnable throws
import { defineDeidPolicy, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

// A shifted real date is still a date element: this is Expert-Determination, not Safe Harbor.
defineDeidPolicy({
  name: "safe-harbor",
  transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
});
```

The same guard covers a keyed surrogate, which is derived from the individual's own value in exactly
the same way. The fatal names the offending category and the offending transform:

```ts runnable throws
import { defineDeidPolicy, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

// A keyed surrogate of a medical record number is a re-identification code §164.514(c)(1) does not
// permit, so it may not wear the label either.
defineDeidPolicy({
  name: "safe-harbor",
  transforms: { [SAFE_HARBOR_CATEGORIES.MRN]: "pseudonymize" },
});
```

## What the limited-data-set preset keeps, and where it is stricter than the regulation

The preset carries the three retention classes §164.514(e)(2) permits: the encounter dates, the
encounter and order identifiers, and the postal address parts (e)(2)(ii) names. On an address that is
the **town or city, the State, and the WHOLE zip code**; the street address and every other geographic
component are removed, and every kept part is recorded as a residual at its own component. The
three-digit / `000` ZIP rule is §164.514(b)(2)(i)(B), Safe Harbor's, so a restricted-prefix ZIP is kept
in full here and is still suppressed under Safe Harbor. The geographic allowance is honored by the
**HL7 v2 pass alone**: the C-CDA, FHIR, X12, NCPDP, and DICOM adapters reduce an address exactly as Safe
Harbor does.

**On dates the preset is deliberately stricter than the regulation it is named for.** §164.514(e)(2)
enumerates sixteen direct identifiers and **names no date at all**, so a limited data set may lawfully
carry dates at full precision. This preset date-shifts them anyway: removing more than the regulation
requires is always lawful, and the alternative would hand every existing consumer real patient dates on
an upgrade. The preset says so in its own machine-readable description, so the choice is readable
without reading this page:

```ts runnable
import { LIMITED_DATA_SET_PROFILE, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

// Dates are STILL date-shifted, not carried at full precision.
LIMITED_DATA_SET_PROFILE.policy.transforms[SAFE_HARBOR_CATEGORIES.DATES]; // => "date-shift"
LIMITED_DATA_SET_PROFILE.requiresContext; // => true

// And the preset's own description states the choice, and whose the data use agreement is.
const described = LIMITED_DATA_SET_PROFILE.description;
described.includes("deliberately STRICTER than"); // => true
described.includes("which names no date and so permits full precision"); // => true
described.includes("removing more by choice"); // => true
described.includes("DATA USE AGREEMENT"); // => true
described.includes("CONSUMER'S responsibility"); // => true
described.includes("neither holds nor checks one"); // => true

// The geographic allowance, and its one-adapter scope, are stated there too.
described.includes("WHOLE zip code"); // => true
described.includes("HL7 v2 pass ALONE"); // => true
```

## Reference

- [`createDeidRegistry`](./api/@cosyte/deid.md#createdeidregistry),
  [`DeidRegistry`](./api/@cosyte/deid.md#deidregistry) and
  [`DeidRegistrySpec`](./api/@cosyte/deid.md#deidregistryspec)
- [`createDeidContext`](./api/@cosyte/deid.md#createdeidcontext) and
  [`DeidContextSpec`](./api/@cosyte/deid.md#deidcontextspec)
- [`deidentify`](./api/@cosyte/deid.md#deidentify),
  [`defineDeidPolicy`](./api/@cosyte/deid.md#definedeidpolicy) and
  [`LIMITED_DATA_SET_PROFILE`](./api/@cosyte/deid.md#limited_data_set_profile)
- [Codes and categories](./codes-and-categories.md#fatal-codes): `DEID_NO_KEY`,
  `DEID_KEY_TOO_SHORT` and `DEID_POLICY_INVALID`
