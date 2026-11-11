---
id: intro
title: Getting started
sidebar_label: Overview
description: "What @cosyte/deid does: it applies a de-identification policy to a parsed healthcare document and returns the copy with a value-free manifest."
---

# @cosyte/deid

Apply a HIPAA-grounded **de-identification policy** to a healthcare document's structurally-located
model and get back a transformed model plus a **value-free manifest** of everything acted on, without
reading 45 CFR §164.514 or hand-writing a scrubber.

`@cosyte/deid` is a consumer-tier library, **not a parser**. It borrows the Cosyte parser archetype's
disciplines (typed diagnostics, immutable output, a policy/profile system) but **inverts the parser's
reflex**: where a parser is liberal on input (Postel's Law), a de-identifier is conservative: an
unrecognized structure or an un-locatable identifier is **blocked**, never passed through as safe.

> **The honesty line that governs the whole library.** Results are **"Safe-Harbor-transformed per the
> configured policy"**, never "de-identified" and never "HIPAA-compliant". Safe Harbor is implemented
> mechanically; the §164.514(b)(2)(ii) actual-knowledge condition is the consumer's; Expert
> Determination (§164.514(b)(1)) is _supported_, never _rendered_ or certified. The
> certification is always the consumer's.

## Who it is for

Teams that hold healthcare documents in one of the six formats and need a copy transformed under a
stated policy, with a value-free record of what was done where. It is not a detector of identifiers
in prose (free text is blocked unless you bring your own redactor), and it is not a certification:
the actual-knowledge condition and any Expert Determination stay with the organization that
releases the data.

> **Status:** `0.1`, published to npm. Below 1.0, a breaking change raises the minor version and
> the changelog says what broke. This release ships the **format-agnostic core** (policy engine,
> five transforms, 18-category Safe Harbor model, fail-closed rule, value-free manifest) **plus six
> format bindings**: HL7 v2 (`@cosyte/deid/hl7`), C-CDA (`@cosyte/deid/ccda`),
> FHIR R4 (`@cosyte/deid/fhir`), X12 EDI (`@cosyte/deid/x12`), NCPDP Telecom (`@cosyte/deid/ncpdp`) and
> DICOM (`@cosyte/deid/dicom`). NCPDP SCRIPT is **not** supported, and an entry point handed one
> refuses it outright rather than returning a partial pass.

## Install

```bash
npm install @cosyte/deid
```

## The 30-second version

```ts runnable
import { deidentify, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const { document, manifest } = deidentify(
  {
    loci: [
      {
        path: "PID-19",
        kind: "identifier",
        category: SAFE_HARBOR_CATEGORIES.SSN,
        value: "900000001",
      },
    ],
  },
  {},
);

document.loci[0]?.value; // => null
manifest[0]?.category; // => "SSN"
manifest[0]?.locus; // => "PID-19"
JSON.stringify(manifest).includes("900000001"); // => false
```

The value is removed, and the manifest records the category and the locus, never the value.

## Next

- [Installation](./installation.md): the package, the parsers for your formats, and a smoke test.
- [Quickstart](./quickstart.md): de-identify a model and read the manifest.
- [De-identify an HL7 v2 message](./guides-hl7.md): the first end-to-end format adapter
  (`@cosyte/deid/hl7`), and the [other format guides](./choose-a-policy.md#find-the-guide-for-your-format).
- [How the library works](./concepts-archetype.md): the policy engine, the transforms, and fail-closed.
- [Known limitations and honesty](./limitations.md): read it before you rely on the library for
  anything that leaves your control.
- [What the caller still owns](./what-the-caller-still-owns.md): the duties that stay with you
  before you release output, and what each adapter does not cover.
