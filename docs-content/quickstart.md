---
id: quickstart
title: Quickstart
sidebar_position: 1
---

# Quickstart

De-identify a structurally-located model under a policy and read the value-free manifest.
`@cosyte/deid` **fails closed**: anything it cannot confidently handle is **blocked**, never passed
through as safe. The result is **"Safe-Harbor-transformed per the configured policy"** — never
"de-identified".

## De-identify a model

The core operates on a **generic locus model** — a flat list of structurally-located candidate values.
(Per-format adapters for HL7 v2, C-CDA, FHIR, X12, NCPDP, and DICOM arrive in later phases.)

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
never a value), a count, a disposition, and a stable code — the auditable record of *what* was acted
on, never *what the value was*.

## Keyed transforms

Pseudonymization and keyed hashing use a **keyed HMAC** — the key is the consumer's and never leaves
the process. Supply it through a context:

```ts
import { deidentify, createDeidContext, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY!, patientId: "patient-1" });

const result = deidentify(
  { loci: [{ path: "PID-3", kind: "identifier", category: SAFE_HARBOR_CATEGORIES.MRN, value: mrn }] },
  { context },
);
// The MRN is replaced by a consistent, non-reversible surrogate; the key is never emitted.
```

> **About runnable examples.** The first block above is tagged ```` ```ts runnable ````: the docs
> build extracts it, runs it against the package, and asserts the `// =>` result — so a documented
> example can never silently drift from the code.

## Next

- [Core Concepts](./concepts-archetype) — the policy engine, the transforms, and fail-closed.
- **API Reference** — every export, generated from source.
