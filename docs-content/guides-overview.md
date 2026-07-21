---
id: guides-overview
title: Guides
sidebar_position: 1
---

# Guides

Task-oriented recipes for `@cosyte/deid`. These guides cover the policy engine and the transforms, plus a
per-format recipe for each shipped adapter — HL7 v2, C-CDA, FHIR, X12 EDI, NCPDP Telecom, and DICOM.

## Choose a policy

`safe-harbor` is the built-in default. Derive a custom policy with `defineDeidPolicy` — you can only
ever *deviate* from the safe default, never forget a category:

```ts
import { defineDeidPolicy, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

// A research policy that date-shifts instead of generalizing (Expert-Determination-supporting).
const research = defineDeidPolicy({
  name: "research",
  transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
});
```

## Keep records linkable without leaking

Pseudonymize identifiers with a consumer-held key so the same MRN maps to the same surrogate
everywhere, without the surrogate being reversible:

```ts
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY!, patientId: "patient-1" });
// Pass { context } to deidentify; the key never leaves your process.
```

## Read the manifest

Every action is recorded value-free. Watch for `DEID_LOCUS_BLOCKED` / `DEID_FREETEXT_BLOCKED` (the
fail-closed decisions) and `DEID_RESIDUAL_RETAINED` (a kept year or safe 3-digit ZIP) — the residuals
you surface to a human for the §164.514(b)(2)(ii) actual-knowledge test.

## Per-format guides

- [De-identifying HL7 v2](guides-hl7), [C-CDA](guides-ccda), [FHIR](guides-fhir),
  [X12 EDI](guides-x12), [NCPDP Telecom](guides-ncpdp), and [DICOM](guides-dicom).

## Planned guides

- NCPDP SCRIPT (ePrescribing) once a full-fidelity parser surface exists.
- Cross-document longitudinal consistency with date-shift + pseudonymization (Phase 7).
