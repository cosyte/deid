---
id: guides-overview
title: Guides
sidebar_position: 1
---

# Guides

Task-oriented recipes for `@cosyte/deid`. This release ships the **format-agnostic core**, so the
guides here cover the policy engine and the transforms; per-format recipes (de-identify a real
`ORU^R01`, a C-CDA CCD, a FHIR Bundle) arrive as the format adapters land.

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
  [X12 EDI](guides-x12), and [NCPDP Telecom](guides-ncpdp).

## Planned guides

- De-identify a DICOM study (orchestrating the parser's PS3.15 Annex E pass).
- NCPDP SCRIPT (ePrescribing) once a full-fidelity parser surface exists.
- Cross-document longitudinal consistency with date-shift + pseudonymization (Phase 7).
