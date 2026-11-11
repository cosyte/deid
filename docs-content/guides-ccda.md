---
id: guides-ccda
title: De-identify a C-CDA document
sidebar_label: C-CDA
description: "Run a parsed C-CDA document through the Safe Harbor policy, read what the adapter locates, how to read a C-CDA locus path, and its limits."
---

# De-identify a C-CDA document

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

## De-identify a document

Parse the XML with `@cosyte/ccda`, hand the document to `deidentifyCcda`, and serialize the result.
The document below is synthetic and cut down to a header and one narrative section.

```ts runnable
import { parseCcda } from "@cosyte/ccda";
import { deidentifyCcda } from "@cosyte/deid/ccda";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <id root="2.16.840.1.113883.19.5.99999.1" extension="DOC-0001"/>
  <code code="34133-9" codeSystem="2.16.840.1.113883.6.1"/>
  <title>Synthetic summary</title>
  <effectiveTime value="20200102103000"/>
  <recordTarget>
    <patientRole>
      <id root="2.16.840.1.113883.19.5" extension="ZZMRNCCDA1"/>
      <addr><streetAddressLine>ZZSTREET</streetAddressLine><city>ZZCITY</city><state>MA</state><postalCode>90210</postalCode></addr>
      <telecom value="tel:+1-555-000-1111"/>
      <patient>
        <name><given>ZZGIVEN</given><family>ZZFAMILY</family></name>
        <birthTime value="19900215"/>
      </patient>
    </patientRole>
  </recordTarget>
  <component><structuredBody><component><section>
    <code code="30954-2" codeSystem="2.16.840.1.113883.6.1"/>
    <text>Seen with ZZFAMILY today.</text>
  </section></component></structuredBody></component>
</ClinicalDocument>`;

const { document, manifest } = deidentifyCcda(parseCcda(xml));
const out = document.toString();

out.includes("ZZFAMILY"); // => false
out.includes("ZZMRNCCDA1"); // => false
out.includes('<birthTime value="1990"/>'); // => true
out.includes("<postalCode>902</postalCode>"); // => true
manifest.find((entry) => entry.locus.endsWith("section/text"))?.code; // => "DEID_FREETEXT_BLOCKED"
```

The built-in Safe Harbor policy uses **no keyed transform**, so a Safe Harbor pass over a C-CDA needs
no `context` at all. Under a preset that keeps consistent keyed surrogates instead, a `context` is
required and calling without one when the document needs it is a fatal `DEID_NO_KEY`: the engine
never falls back to an unkeyed surrogate. [Choose a policy](./choose-a-policy.md#use-a-profile) shows
how to pass one.

## What is located, and how it is transformed

PHI is located at the CDA **header participations**: the patient and every party the standard attaches
to the document. A `<name>` there is always a person or organization; a `<name>` in the clinical body
can be a drug or material name, so the body is deliberately never swept for names. In the body the
pass reads only narrative, every `<birthTime>` and the value of an age observation.

| Participation | Loci | Transform |
|---|---|---|
| **recordTarget / patientRole** (+ nested `guardian`) | `id` (MRN / SSN), `addr`, `telecom`, `patient/name`, `birthTime` | name/telecom **removed**; `id` extension **removed** under Safe Harbor (a consistent keyed surrogate only under a preset that does not claim the label), assigning root retained unless the header replaced the same root; an `id` with no extension has its root **replaced** (see below); `birthTime` → **year** (removed, with `nullFlavor="MSK"`, when the year shows an age over 89); `addr` → safe **3-digit ZIP** (or `000`), finer geography dropped |
| **author / dataEnterer / informant / authenticator / legalAuthenticator / participant / custodian** | person `name`, `id`, `addr`, `telecom`, participation `time` | same category transforms: Safe Harbor removes identifiers of **relatives, employers, and household members**, not only the patient |
| **componentOf / documentationOf** | encounter / service-event `id`, `effectiveTime` | ids acted on under the configured transform; dates → **year** |
| **section `<text>` narrative, `nonXMLBody`** | every narrative block | **fail closed**: blocked, never regex-scrubbed |
| **unknown / `sdtc` / foreign elements carrying a value** | any value-bearing element that is neither mapped PHI nor recognized coded structure | **fail closed**: blocked |
| **structuredBody `birthTime`** (a relative's in a family history, the subject of an entry) | `birthTime` `@value`, and each bound of an interval | → **year**; **removed** with `nullFlavor="MSK"` when the year shows an age over 89 |
| **structuredBody age observation** (`code` names an age, such as SNOMED CT `445518008`) | the `PQ` `value` (or each bound of an `IVL_PQ`), its unit read from `@unit` | over 89 **removed** with `nullFlavor="MSK"`; 89 or under kept exactly as written; recorded either way (see [the limitations page](./limitations.md#ages-over-89)) |
| **structuredBody clinical entries** (codes, values, units, statuses, dosing periods) | n/a | **retained untouched** (the over-scrub guard) |

An `id`'s Safe Harbor category is read from its assigning-authority `root` OID: the SSN OID
(`2.16.840.1.113883.4.1`) routes to the SSN category, every other person/organization id to the
medical record number category, so the parser's typing, not a guess, decides which transform the
configured policy applies to each. A dosing-period `effectiveTime` (`PIVL_TS` / `EIVL_TS`) is a
duration, not a calendar date, and is never generalized.

An `<id>` with **no extension**, or an empty one, is identified by its `root` alone, so the root is
the identifier and is **replaced**, never kept: in every header participation and in the document's
own `<id>` and `<setId>`. Under the Safe Harbor default the replacement is a stand-in in the root's
shape (an OID under `2.25`, a UUID, or a plain token) counted from 1 in the order the distinct roots
are met in one call, recorded as `DEID_IDENTIFIER_SUBSTITUTED`; under a keyed preset it is the keyed
surrogate. The same root gets the same replacement throughout the document, so a `setId` that repeats
the `id`, an author named in two participations, and a clinical body `<id>` carrying a root the header
replaced all still match.

A root the header replaced is replaced on **every** element that carries it as its `@root`, with an
extension or without: a header `<id>` with an extension, the document's own `<id>` and `<setId>` with
an extension, and a clinical body `<id>` with an extension all take the same replacement, recorded at
the root's own position (`component/structuredBody/.../observation/id@root`). The extension beside it
is decided as before: transformed in the header, kept and counted in the body and on the document's
own ids. A root the header did not replace is left where it was: on a body `<id>` it is kept and
counted, and on the document `<id>` and `<setId>` with an extension it is kept and counted with the
extension. A document transformed in two calls gets two unrelated stand-ins for the same root.

## How to read a C-CDA locus path

A locus is a `/`-joined path of element names. Entries that agree on **all five** of locus, category,
transform, disposition, and code are aggregated into one entry with a running `count`, and two
narratives blocked the same way agree on the other four, so two narrative positions printing the same
path would arrive as **one row with `count: 2`**. That is why the index in a path matters, and it has
one meaning:

> `[n]` is the position's index **among its document siblings that print the same segment name**. It
> appears when more than one sibling prints that name, and always when the name was refused.

```text
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

## What the leak and over-scrub tests check

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
  transformed: exactly mirroring the HL7 v2 adapter's retained-clinical-segment boundary. Forgetting one fails
  **safe** (retained in a coded entry), never leaked, because the leak surface for this release is the
  header and the narrative.
- The document `id` / `code` / `title` envelope is retained (like HL7's MSH). The address generalization
  keeps state and country (permitted) and the safe 3-digit ZIP, dropping every finer component.

The honesty line is unchanged: the output is **"Safe-Harbor-transformed per the configured policy,"**
never "de-identified" and never "HIPAA-compliant."

## Reference

- [`deidentifyCcda`](./api/@cosyte/deid/ccda.md#deidentifyccda) and
  [`CcdaDeidResult`](./api/@cosyte/deid/ccda.md#ccdadeidresult)
- [`CCDA_LOCUS_MAP`](./api/@cosyte/deid/ccda.md#ccda_locus_map) and
  [`categoryForIdRoot`](./api/@cosyte/deid/ccda.md#categoryforidroot): the participations and the
  `root` routing this page describes
- [`DeidOptions`](./api/@cosyte/deid.md#deidoptions) and
  [`WITHHELD_LOCUS_TOKEN`](./api/@cosyte/deid.md#withheld_locus_token)
- [Codes and categories](./codes-and-categories.md): every disposition and fatal code
