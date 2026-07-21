---
id: guides-hl7
title: De-identifying HL7 v2
sidebar_position: 5
---

# De-identifying HL7 v2

The `@cosyte/deid/hl7` adapter is the first end-to-end format binding of the de-identification core. It
locates PHI **structurally** in the parsed [`@cosyte/hl7`](https://github.com/cosyte/hl7) model — a name
is at PID-5 because the HL7 v2 standard says PID-5 is the patient name, never because a string "looked
like" a name — applies the configured policy, and returns a transformed `Hl7Message` plus the core's
**value-free manifest**.

> **`@cosyte/hl7` is an optional peer dependency.** Install it alongside `@cosyte/deid` to use this
> subpath; a consumer who only de-identifies HL7 v2 pays for nothing else, and the core stays
> dependency-free.

```bash
npm install @cosyte/deid @cosyte/hl7
```

## Quickstart

```ts
import { parseHL7 } from "@cosyte/hl7";
import { deidentifyHl7 } from "@cosyte/deid/hl7";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { document, manifest } = deidentifyHl7(parseHL7(rawMessage), { context });

document.toString();  // spec-clean, de-identified HL7 wire
manifest;             // value-free audit: category + locus + disposition, never a value
```

A keyed transform (MRN / account / beneficiary pseudonymization) requires a `context`; calling without
one when the message needs it is a fatal `DEID_NO_KEY` — the engine never falls back to an unkeyed
surrogate.

## What is located, and how it is transformed

| Segment | Loci | Transform |
|---|---|---|
| **PID** | name (5/6/9), DOB (7/29), address (11), SSN (19), phone (13/14), driver's licence (20), MRN/account/mother-id (2/3/4/18/21), county (12), birth place (23) | names/phone/SSN/licence **removed**; MRN/account → consistent **surrogate** (keyed HMAC); DOB → **year**; ZIP → safe **3-digit** (or `000`); county/birth place fail closed |
| **NK1 / GT1 / IN1 / IN2** | relatives / guarantor / insured names, addresses, phones, SSNs, DOBs, member/policy/Medicare/Medicaid ids | same category transforms — Safe Harbor removes identifiers of **relatives, employers, and household members**, not only the patient |
| **OBX-5, NTE-3** | narrative / ambiguous free text (OBX-5 unless OBX-2 types it structured) | **fail closed** — blocked, never regex-scrubbed |
| **MRG / ACC / FAM / PEO / PDA** | known patient-identity / relative / geographic segments absent from the map | **fail closed** — blocked (e.g. a merge message's prior name + MRN) |
| **Z-segments / unknown structure** | every populated field | **fail closed** — blocked |
| Retained clinical/administrative segments (an explicit allow-list — OBR, ORC, AL1, DG1, PV1, RX*, …) | — | **retained untouched** (the over-scrub guard) |

A recognized segment is retained **only** if it is on the explicit retain-list; anything else fails
closed. OBX-5 is retained only when OBX-2 positively types it as a structured clinical value (numeric,
coded, or date/time) — narrative (`TX`/`FT`), ambiguous String (`ST`), and any empty/unknown OBX-2 block.

The identifier type inside a PID-3 list is read from the CX-5 type code (`SS` → SSN removed, `MR` → MRN
pseudonymized, `AN` → account, `MA`/`MC`/`PN` → beneficiary), so an SSN and an MRN in the same field are
handled differently — structurally, from the parser's typing.

## The two guarantees

- **No leak.** Every seeded PHI sentinel across PID/NK1/GT1/IN1/IN2, the free-text loci, and Z-segments
  is gone from the serialized output. An unmapped locus that could carry PHI is blocked, never passed
  through in the clear.
- **No over-scrub.** Structured clinical OBX values, units, LOINC/coded observation identifiers,
  reference ranges, and result statuses are retained byte-identical — the de-identifier never degenerates
  into a blanket-blanking "safe but useless" scrubber.

## Known limitations (this release)

- Free text is **block-only** — no NLP scrub yet (a future BYO-redaction interface).
- Within **retained** clinical / visit segments, patient-related **dates** (OBR / DG1 / PV1 timestamps),
  **visit identifiers** (PV1-19), and **provider** names (PV1-7/8, OBR-16) are a deferred later phase.
- The address generalization keeps only the Safe Harbor 3-digit ZIP (the permitted state is also
  dropped — conservative, never a leak).

The honesty line is unchanged: the output is **"Safe-Harbor-transformed per the configured policy,"**
never "de-identified" and never "HIPAA-compliant."
