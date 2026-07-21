---
id: intro
title: Getting started
sidebar_position: 1
---

# @cosyte/deid

Apply a HIPAA-grounded **de-identification policy** to a healthcare document's structurally-located
model and get back a transformed model plus a **value-free manifest** of everything acted on — without
reading 45 CFR §164.514 or hand-writing a scrubber.

`@cosyte/deid` is a consumer-tier library, **not a parser**. It borrows the cosyte parser archetype's
disciplines (typed diagnostics, immutable output, a policy/profile system) but **inverts the parser's
reflex**: where a parser is liberal on input (Postel's Law), a de-identifier is conservative — it
**fails closed**. An unrecognized structure or an un-locatable identifier is **blocked**, never passed
through as safe.

> **The honesty line that governs the whole library.** Results are **"Safe-Harbor-transformed per the
> configured policy"** — never "de-identified" and never "HIPAA-compliant". Safe Harbor is implemented
> mechanically; the §164.514(b)(2)(ii) actual-knowledge condition is the consumer's; Expert
> Determination (§164.514(b)(1)) is *supported* by later phases, never *rendered* or certified. The
> certification is always the consumer's.

> **Status:** pre-alpha (`0.0.x`), not yet published to npm. This release ships the **format-agnostic
> core**: the policy engine, the five transforms, the 18-category Safe Harbor model, the fail-closed
> rule, and the value-free manifest — tested against a generic locus model. Per-format adapters
> (HL7 v2, C-CDA, FHIR, X12, NCPDP, DICOM) land in subsequent phases.

## Install

```bash
npm install @cosyte/deid
```

## The 30-second version

```ts
import { deidentify, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const { document, manifest } = deidentify(
  { loci: [{ path: "PID-19", kind: "identifier", category: SAFE_HARBOR_CATEGORIES.SSN, value: ssn }] },
  {},
);
// document.loci[0].value === null (removed); manifest records the category + locus, never the value.
```

## Next

- [Quickstart](./quickstart) — de-identify a model and read the manifest.
- [Core Concepts](./concepts-archetype) — the policy engine, the transforms, and fail-closed.
