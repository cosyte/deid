---
id: quickstart
title: Quickstart
sidebar_position: 1
---

# Quickstart

De-identify a structurally-located model under a policy and read the value-free manifest.
`@cosyte/deid` **fails closed**: anything it cannot confidently handle is **blocked**, never passed
through as safe. The result is **"Safe-Harbor-transformed per the configured policy"**, never
"de-identified".

## De-identify a model

The core operates on a **generic locus model**: a flat list of structurally-located candidate values.
The per-format adapters for HL7 v2, C-CDA, FHIR, X12, NCPDP and DICOM live behind their own subpath
exports.

```ts runnable
import { deidentify, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const { document, manifest } = deidentify(
  {
    loci: [
      { path: "PID-5", kind: "identifier", category: SAFE_HARBOR_CATEGORIES.NAMES, value: "SENTINEL_NAME" },
      { path: "PID-7", kind: "date", category: SAFE_HARBOR_CATEGORIES.DATES, value: "1985-07-02" },
    ],
  },
  {},
);

document.loci[0].value; // => null
document.loci[1].value; // => "1985"
manifest[0].disposition; // => "removed"
```

Each **manifest** entry records the category acted on, the transform applied, the **locus** (a path,
never a value), a count, a disposition, a stable code, and a boolean `reidentificationCode` that is
`true` only where the pass emitted a **keyed surrogate**: the auditable record of *what* was acted
on, never *what the value was*.

## Keyed transforms

Pseudonymization and keyed hashing use a **keyed HMAC**: the key is the consumer's and never leaves
the process. The **built-in Safe Harbor policy uses no keyed transform at all** - medical record,
health plan beneficiary and account numbers are **removed** - so it needs no key. A keyed surrogate
is derived from the individual's own value, which is why it belongs to a preset that does not claim
Safe Harbor, such as `LIMITED_DATA_SET_PROFILE`. Supply the key through a context:

```ts
import { deidentify, createDeidContext, profileOptions, LIMITED_DATA_SET_PROFILE } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY!, patientId: "patient-1" });

const result = deidentify(model, profileOptions(LIMITED_DATA_SET_PROFILE, context));
// Under THAT preset the MRN becomes a consistent, non-reversible surrogate; the key is never
// emitted, and the locus is flagged `reidentificationCode` so the support report inventories it.
```

> **About runnable examples.** The first block above is tagged ```` ```ts runnable ````: the docs
> build extracts it, runs it against the package, and asserts the `// =>` result, so a documented
> example can never silently drift from the code.

## Next

- [Core Concepts](./concepts-archetype): the policy engine, the transforms, and fail-closed.
- **API Reference**: every export, generated from source.
