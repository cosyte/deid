---
id: guides-ccda
title: De-identifying C-CDA
sidebar_position: 6
---

# De-identifying C-CDA

The `@cosyte/deid/ccda` adapter is the C-CDA binding of the de-identification core. It locates PHI
**structurally** in an HL7 CDA R2.1 document — a `<name>` under `recordTarget/patientRole/patient` is
the patient's name because the CDA standard says so, never because a string "looked like" a name —
applies the configured policy, and returns a transformed `CcdaDocument` plus the core's **value-free
manifest**.

> **`@cosyte/ccda` is an optional peer dependency.** Install it alongside `@cosyte/deid` to use this
> subpath; a consumer who only de-identifies C-CDA pays for nothing else, and the core stays
> third-party-dependency-free. The adapter reaches the CDA DOM only through `@cosyte/ccda`'s hardened
> `parseSecureXml` and re-serializes the node the parser hands back — it never imports the XML substrate
> directly.

```bash
npm install @cosyte/deid @cosyte/ccda
```

## Quickstart

```ts
import { parseCcda } from "@cosyte/ccda";
import { deidentifyCcda } from "@cosyte/deid/ccda";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { document, manifest } = deidentifyCcda(parseCcda(xml), { context });

document.toString();  // spec-clean, de-identified C-CDA XML
manifest;             // value-free audit: category + locus + disposition, never a value
```

A keyed transform (patient / provider id pseudonymization) requires a `context`; calling without one
when the document needs it is a fatal `DEID_NO_KEY` — the engine never falls back to an unkeyed
surrogate.

## What is located, and how it is transformed

PHI is located at the CDA **header participations** — the patient and every party the standard attaches
to the document. A `<name>` there is always a person or organization; a `<name>` in the clinical body
can be a drug or material name, so the body is deliberately never swept.

| Participation | Loci | Transform |
|---|---|---|
| **recordTarget / patientRole** (+ nested `guardian`) | `id` (MRN / SSN), `addr`, `telecom`, `patient/name`, `birthTime` | name/telecom **removed**; id → consistent **surrogate** (keyed HMAC; SSN-rooted id **removed**); `birthTime` → **year**; `addr` → safe **3-digit ZIP** (or `000`), finer geography dropped |
| **author / dataEnterer / informant / authenticator / legalAuthenticator / participant / custodian** | person `name`, `id`, `addr`, `telecom`, participation `time` | same category transforms — Safe Harbor removes identifiers of **relatives, employers, and household members**, not only the patient |
| **componentOf / documentationOf** | encounter / service-event `id`, `effectiveTime` | ids surrogated; dates → **year** |
| **section `<text>` narrative, `nonXMLBody`** | every narrative block | **fail closed** — blocked, never regex-scrubbed |
| **unknown / `sdtc` / foreign elements carrying a value** | any value-bearing element that is neither mapped PHI nor recognized coded structure | **fail closed** — blocked |
| **structuredBody clinical entries** (codes, values, units, statuses, dosing periods) | — | **retained untouched** (the over-scrub guard) |

An `id`'s Safe Harbor category is read from its assigning-authority `root` OID — the SSN OID
(`2.16.840.1.113883.4.1`) routes to **removed**, every other person/organization id to a **consistent
surrogate** — so an SSN and an MRN at adjacent `id` loci are handled differently, structurally, from the
parser's typing. A dosing-period `effectiveTime` (`PIVL_TS` / `EIVL_TS`) is a duration, not a calendar
date, and is never generalized.

## The two guarantees

- **No leak.** Every seeded PHI sentinel across the header participations and the section narrative is
  gone from the serialized output. An unmapped element that could carry PHI is blocked, never passed
  through in the clear.
- **No over-scrub.** Coded clinical entries — observation and medication codes, values, units, result
  statuses, and dosing periods — are retained byte-identical. The de-identifier never degenerates into a
  blanket-blanking "safe but useless" scrubber.

## Known limitations (this release)

- Narrative is **block-only** — no NLP scrub yet (a future BYO-redaction interface, deferred to a later
  phase).
- Within the **retained** clinical body, entry-level service **dates** (`effectiveTime`), entry **ids**,
  in-entry **performer** names, and **family-history** relative demographics are a deferred later phase —
  exactly mirroring the HL7 v2 adapter's retained-clinical-segment boundary. Forgetting one fails
  **safe** (retained in a coded entry), never leaked, because the leak surface for this release is the
  header and the narrative.
- The document `id` / `code` / `title` envelope is retained (like HL7's MSH). The address generalization
  keeps state and country (permitted) and the safe 3-digit ZIP, dropping every finer component.

The honesty line is unchanged: the output is **"Safe-Harbor-transformed per the configured policy,"**
never "de-identified" and never "HIPAA-compliant."
