---
id: guides-ccda
title: De-identifying C-CDA
sidebar_position: 6
---

# De-identifying C-CDA

The `@cosyte/deid/ccda` adapter is the C-CDA binding of the de-identification core. It locates PHI
**structurally** in an HL7 CDA R2.1 document (a `<name>` under `recordTarget/patientRole/patient` is
the patient's name because the CDA standard says so, never because a string "looked like" a name),
applies the configured policy, and returns a transformed `CcdaDocument` plus the core's **value-free
manifest**.

> **`@cosyte/ccda` is an optional peer dependency.** Install it alongside `@cosyte/deid` to use this
> subpath; a consumer who only de-identifies C-CDA pays for nothing else, and the core stays
> third-party-dependency-free. The adapter reaches the CDA DOM only through `@cosyte/ccda`'s hardened
> `parseSecureXml` and re-serializes the node the parser hands back: it never imports the XML substrate
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
when the document needs it is a fatal `DEID_NO_KEY`: the engine never falls back to an unkeyed
surrogate.

## What is located, and how it is transformed

PHI is located at the CDA **header participations**: the patient and every party the standard attaches
to the document. A `<name>` there is always a person or organization; a `<name>` in the clinical body
can be a drug or material name, so the body is deliberately never swept.

| Participation | Loci | Transform |
|---|---|---|
| **recordTarget / patientRole** (+ nested `guardian`) | `id` (MRN / SSN), `addr`, `telecom`, `patient/name`, `birthTime` | name/telecom **removed**; id → consistent **surrogate** (keyed HMAC; SSN-rooted id **removed**); `birthTime` → **year**; `addr` → safe **3-digit ZIP** (or `000`), finer geography dropped |
| **author / dataEnterer / informant / authenticator / legalAuthenticator / participant / custodian** | person `name`, `id`, `addr`, `telecom`, participation `time` | same category transforms: Safe Harbor removes identifiers of **relatives, employers, and household members**, not only the patient |
| **componentOf / documentationOf** | encounter / service-event `id`, `effectiveTime` | ids surrogated; dates → **year** |
| **section `<text>` narrative, `nonXMLBody`** | every narrative block | **fail closed**: blocked, never regex-scrubbed |
| **unknown / `sdtc` / foreign elements carrying a value** | any value-bearing element that is neither mapped PHI nor recognized coded structure | **fail closed**: blocked |
| **structuredBody clinical entries** (codes, values, units, statuses, dosing periods) | none located | **retained untouched** (the over-scrub guard) |

An `id`'s Safe Harbor category is read from its assigning-authority `root` OID: the SSN OID
(`2.16.840.1.113883.4.1`) routes to **removed**, every other person/organization id to a **consistent
surrogate**, so an SSN and an MRN at adjacent `id` loci are handled differently, structurally, from the
parser's typing. A dosing-period `effectiveTime` (`PIVL_TS` / `EIVL_TS`) is a duration, not a calendar
date, and is never generalized.

## How to read a C-CDA locus path

A locus is a `/`-joined path of element names. Entries that agree on **all five** of locus, category,
transform, disposition and code are aggregated into one entry with a running `count`, and two
narratives blocked the same way agree on the other four, so two narrative positions printing the same
path would arrive as **one row with `count: 2`**. That is why the index in a path matters, and it has
one meaning:

> `[n]` is the position's index **among its document siblings that print the same segment name**. It
> appears when more than one sibling prints that name, and always when the name was refused.

```
component/structuredBody/component[0]/section/text   ← the first section's narrative
component/structuredBody/component[1]/section/text   ← the second section's, its own row
recordTarget/patientRole/id[0]                       ← two <id> siblings, one row each
recordTarget/patientRole/patient/name                ← the only <name>, so no index is needed
recordTarget/patientRole/patient/<withheld>[0]       ← name refused; the index is the only "where" left
```

A refused segment (`<withheld>`) always carries an index, since the token itself names nothing.

Three scoping notes, because each is easy to over-read:

- **The index is a document position, not a row number, so the indices in a manifest can be gapped.**
  A sibling that produced nothing to record produces no entry: an empty `<text>`, an `<entry>` whose
  narrative is a `<reference value="#…"/>` into the section rather than character data, a
  `nullFlavor`-only `<id>`. A manifest showing `component[2]` and no `component[0]` or `component[1]`
  means those two siblings had nothing to record, **not** that rows are missing. Count the rows, not
  the indices.
- This covers the segments built from an **element name**: the header sweep and the body narrative
  descent. Some segments are fixed strings instead: `structuredBody`, `nonXMLBody/text`, and the
  `low` / `high` / `center` bounds of an interval. The CDA schema allows each at most once at its
  position; a document that repeats one anyway still prints one path for both.
- An index says two positions were **distinct**, not what stood at either. The path is still
  value-free: no narrative, no identifier, no value.

## The two guarantees

- **No leak.** Every seeded PHI sentinel across the header participations and the section narrative is
  gone from the serialized output. An unmapped element that could carry PHI is blocked, never passed
  through in the clear.
- **No over-scrub.** Coded clinical entries (observation and medication codes, values, units, result
  statuses, and dosing periods) are retained byte-identical. The de-identifier never degenerates into a
  blanket-blanking "safe but useless" scrubber.

## Known limitations (this release)

- Narrative is **block-only**: there is no built-in NLP scrub.
- Within the **retained** clinical body, entry-level service **dates** (`effectiveTime`), entry **ids**,
  in-entry **performer** names, and **family-history** relative demographics are **not**
  de-identified: exactly mirroring the HL7 v2 adapter's retained-clinical-segment boundary. Forgetting one fails
  **safe** (retained in a coded entry), never leaked, because the leak surface for this release is the
  header and the narrative.
- The document `id` / `code` / `title` envelope is retained (like HL7's MSH). The address generalization
  keeps state and country (permitted) and the safe 3-digit ZIP, dropping every finer component.

The honesty line is unchanged: the output is **"Safe-Harbor-transformed per the configured policy,"**
never "de-identified" and never "HIPAA-compliant."
