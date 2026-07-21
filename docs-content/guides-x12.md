---
id: guides-x12
title: De-identifying X12 EDI
sidebar_position: 8
---

# De-identifying X12 EDI

The `@cosyte/deid/x12` adapter is the HIPAA 005010 X12 binding of the de-identification core. It locates
PHI **structurally** in a parsed X12 interchange — a name is at `NM1-03..07` because the X12 TR3 says so,
never because a string "looked like" a name — applies the configured policy, and returns the
de-identified X12 byte stream plus the core's **value-free manifest**.

> **`@cosyte/x12` is an optional peer dependency.** Install it alongside `@cosyte/deid` to use this
> subpath; the core stays third-party-dependency-free. The adapter reaches EDI data only through
> `@cosyte/x12`'s exported model (`X12Interchange` / `X12Segment`, the 1-indexed `elements`, the detected
> `delimiters`) and re-emits with its **byte-faithful** `serializeX12` — so every segment the map does not
> touch keeps its verbatim bytes.

```bash
npm install @cosyte/deid @cosyte/x12
```

## Quickstart

```ts
import { parseX12 } from "@cosyte/x12";
import { deidentifyX12, deidentifyX12String } from "@cosyte/deid/x12";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });

const { x12, manifest } = deidentifyX12(parseX12(raw), { context });
// or, parse + de-identify in one call:
const out = deidentifyX12String(raw, { context });

x12; // the de-identified interchange (byte-faithful for every untouched segment)
manifest; // value-free audit: category + locus + disposition, never a value
```

A keyed transform (identifier pseudonymization — member ids, the `CLM`/`CLP` account number) requires a
`context`; calling without one when the interchange needs it is a fatal `DEID_NO_KEY` — the engine never
falls back to an unkeyed surrogate.

## What is located, and how it is transformed

X12 is a flat, ordered segment stream; the subscriber (2000B/2010BA) and patient (2000C/2010CA) loops are
implicit, so the map keys off each **segment id** plus two **qualifier classifiers**.

| Locus                                                            | Handling                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **`NM1`** — subscriber / patient / dependent (`IL` / `QC` / `03`) | name (`NM1-03..07`) **removed**; id (`NM1-09`) routed by the `NM1-08` qualifier — SSN **removed**, member **pseudonymized** |
| **`NM1`** — recognized provider / organization (`85` / `82` / …)  | **retained** — provider identity is not the individual's PHI (mirrors the HL7 adapter's provider retention)          |
| **`NM1`** — unknown entity code                                  | **fails closed** — name and id blocked (an unrecognized entity could be the patient)                                |
| **`N1`** (payer / provider org)                                 | **retained**; a patient-side or **unknown** party's name + id scrubbed / **fail closed** (same classification as `NM1`) |
| **`SBR`** (subscriber)                                          | `SBR-03` group / policy number **pseudonymized**, `SBR-04` group name **removed**; relationship codes retained       |
| **`N3` / `N4`**                                                 | street + city **removed**; ZIP → safe 3-digit; state retained; an unmapped element (`N4-06` location id) **fails closed** |
| **`DMG-02`**, **`DTP-03`**, **`DTM-02`**                        | dates → **year**                                                                                                    |
| **`PER`**                                                       | contact name + communication numbers **removed**                                                                   |
| **`REF`**                                                       | patient / member / group / SSN identifier removed or **pseudonymized**; recognized admin/provider reference retained; **unknown qualifier fails closed** |
| **`CLM-01` / `CLP-01`**                                         | patient account number **pseudonymized** to a consistent surrogate                                                  |
| **Clinical / financial** (`HI`, `SV*`, `SVC`, `AMT`, `CAS`, …)   | **retained untouched** — diagnosis / procedure / revenue codes, amounts, quantities survive byte-identical          |
| Any **unmapped / unknown** segment                              | **fails closed** — every element blocked                                                                            |

## The `REF` frontier

Distinguishing a patient identifier from an administrative reference is the hardest call. The adapter
routes `REF` by its `REF-01` qualifier: patient identifiers (`SY` SSN, `1W` member, `0F` subscriber, `1L`
group, `EA` medical-record) are removed or pseudonymized; recognized non-patient references (`F8` payer
claim control, `EI` EIN, `TJ` tax id, `G1` prior authorization, provider ids) are retained; and an
**unrecognized qualifier fails closed** — the direct implementation of Safe Harbor category (R) for the
"unusual REF qualifier" that a shape guess would miss.

## Known limitations

Provider / organization identity is **retained** as non-patient PHI; a deployment that must also suppress
it supplies a widening policy in a later profiles phase. A retained clinical segment may carry a residual
patient-related date the map does not surface as `DTP` / `DTM` — a documented limitation mirroring the HL7
adapter; forgetting one fails **safe** (retained, not leaked, but conversely not generalized).
