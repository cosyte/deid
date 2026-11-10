---
id: quickstart
title: Quickstart
sidebar_label: Quickstart
description: "Run the built-in Safe Harbor policy over a parsed document, read the value-free manifest, and see when a keyed transform needs a key."
---

# Quickstart

De-identify a structurally-located model under a policy and read the value-free manifest.
In `@cosyte/deid`, an unrecognized structure or an un-locatable identifier is **blocked**, never
passed through as safe. The result is **"Safe-Harbor-transformed per the configured policy"**, never
"de-identified".

## De-identify a model

The core operates on a **generic locus model**: a flat list of structurally-located candidate values.
The per-format adapters for HL7 v2, C-CDA, FHIR, X12, NCPDP, and DICOM live behind their own subpath
exports and build this model for you.

```ts runnable
import { deidentify, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const { document, manifest } = deidentify(
  {
    loci: [
      {
        path: "PID-5",
        kind: "identifier",
        category: SAFE_HARBOR_CATEGORIES.NAMES,
        value: "SENTINEL_NAME",
      },
      { path: "PID-7", kind: "date", category: SAFE_HARBOR_CATEGORIES.DATES, value: "1985-07-02" },
    ],
  },
  {},
);

document.loci[0]?.value; // => null
document.loci[1]?.value; // => "1985"
manifest[0]?.disposition; // => "removed"
manifest[1]?.code; // => "DEID_RESIDUAL_RETAINED"
```

Each **manifest** entry records the category acted on, the transform applied, the **locus** (a path,
never a value), a count, a disposition, a stable code, and a boolean `reidentificationCode` that is
`true` only where the pass emitted a **keyed surrogate**: the auditable record of _what_ was acted
on, never _what the value was_.

## Keyed transforms

Pseudonymization and keyed hashing use a **keyed HMAC**: the key is the consumer's and never leaves
the process. The **built-in Safe Harbor policy uses no keyed transform at all**: medical record,
health plan beneficiary, and account numbers are **removed**, so it needs no key. A keyed surrogate
is derived from the individual's own value, which is why it belongs to a preset that does not claim
Safe Harbor, such as `LIMITED_DATA_SET_PROFILE`. Supply the key through a context:

```ts runnable
import {
  deidentify,
  createDeidContext,
  profileOptions,
  LIMITED_DATA_SET_PROFILE,
  SAFE_HARBOR_CATEGORIES,
} from "@cosyte/deid";

// In your code the key comes from your secret store, for example process.env.DEID_KEY.
const context = createDeidContext({
  key: "synthetic-example-key-32-bytes!!",
  patientId: "patient-1",
});

const { document, manifest } = deidentify(
  {
    loci: [
      { path: "PID-3", kind: "identifier", category: SAFE_HARBOR_CATEGORIES.MRN, value: "ZZMRN001" },
    ],
  },
  profileOptions(LIMITED_DATA_SET_PROFILE, context),
);

// Under THAT preset the MRN becomes a consistent, non-reversible surrogate; the key is never
// emitted, and the locus is flagged `reidentificationCode` so the support report inventories it.
document.loci[0]?.value === "ZZMRN001"; // => false
manifest[0]?.transform; // => "pseudonymize"
manifest[0]?.reidentificationCode; // => true
```

The key must be at least **16 bytes (128 bits)**, counted as UTF-8 bytes for a string; a shorter one
is refused with `DEID_KEY_TOO_SHORT`. Use 32 random bytes: `openssl rand -hex 32` makes a 64-character
value for `DEID_KEY`, or pass `crypto.randomBytes(32)` directly.

> **About runnable examples.** Every TypeScript sample on these pages, the generated API reference
> aside, is compiled and run in the package's test suite against the built package, and its `// =>`
> results are asserted, so a documented example cannot silently drift from the code.

## Next

- [De-identify an HL7 v2 message](./guides-hl7.md), or the guide for
  [your format](./choose-a-policy.md#find-the-guide-for-your-format).
- [Choose a policy and read the manifest](./choose-a-policy.md).
- [Keep a patient linkable across documents](./guides-longitudinal.md).
- [How the library works](./concepts-archetype.md): the policy engine, the transforms, and fail-closed.
- The [API reference](./api/@cosyte/deid.md#deidentify): every export, generated from source.
