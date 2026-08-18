---
id: guides-hl7
title: De-identifying HL7 v2
sidebar_position: 5
---

# De-identifying HL7 v2

The `@cosyte/deid/hl7` adapter is the first end-to-end format binding of the de-identification core. It
locates PHI **structurally** in the parsed [`@cosyte/hl7`](https://github.com/cosyte/hl7) model (a name
is at PID-5 because the HL7 v2 standard says PID-5 is the patient name, never because a string "looked
like" a name), applies the configured policy, and returns a transformed `Hl7Message` plus the core's
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

document.toString(); // spec-clean, de-identified HL7 wire
manifest; // value-free audit: category + locus + disposition, never a value
```

A keyed transform (MRN / account / beneficiary pseudonymization) requires a `context`; calling without
one when the message needs it is a fatal `DEID_NO_KEY`: the engine never falls back to an unkeyed
surrogate.

## What is located, and how it is transformed

| Segment                                                                                              | Loci                                                                                                                                                       | Transform                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PID**                                                                                              | name (5/6/9), DOB (7/29), address (11), SSN (19), phone (13/14), driver's licence (20), MRN/account/mother-id (2/3/4/18/21), county (12), birth place (23) | names/phone/SSN/licence **removed**; MRN/account → consistent **surrogate** (keyed HMAC); DOB → **year**; ZIP → safe **3-digit** (or `000`); county/birth place fail closed |
| **NK1 / GT1 / IN1 / IN2**                                                                            | relatives / guarantor / insured names, addresses, phones, SSNs, DOBs, member/policy/Medicare/Medicaid ids                                                  | same category transforms: Safe Harbor removes identifiers of **relatives, employers, and household members**, not only the patient                                          |
| **OBX-5, NTE-3**                                                                                     | narrative / ambiguous free text (OBX-5 unless OBX-2 types it structured)                                                                                   | **fail closed**: blocked, never regex-scrubbed                                                                                                                              |
| **MRG / ACC / FAM / PEO / PDA**                                                                      | known patient-identity / relative / geographic segments absent from the map                                                                                | **fail closed**: blocked (e.g. a merge message's prior name + MRN)                                                                                                          |
| **Z-segments / unknown structure**                                                                   | every populated field                                                                                                                                      | **fail closed**: blocked                                                                                                                                                    |
| **PV1-19, OBR-2/3, ORC-2/3** | visit number, placer + filler order numbers, inside retained segments | **removed**. PV1-19 is routed by its CX-5 type code like PID-3: `VN`/untyped is the encounter identifier, removed as (R) and retainable under a profile that names the class; `MR`/`AN`/`SS` is transformed as that identifier under **both** profiles, never retained |
| **PV1-44/45, OBR-7, DG1-5**                                                                          | admit, discharge, observation and diagnosis dates, inside retained segments                                                                                | → **year** (§164.514(b)(2)(i)(C) names admission and discharge); kept whole, and recorded, only under a profile that names the class                                        |
| **Every other date position of a retained segment** (EVN-2/3/6, PV2-8/9/…, ORC-9/15, OBR-6/8/14/22, SPM-17/18/19, RXA-3/4, FT1-4/5, TXA-4/6/7/8, MSH-7, …) | every field HL7 v2.5.1 types `DT` or `TS`, and every date/time **component** of a date range or other composite it defines | → **year** under a Safe-Harbor-named policy, **shifted** under a date-shift policy, **blocked** when the transform cannot read the value; **recorded** either way, one manifest entry per repetition and per component |
| **OBX-5 typed as a date by OBX-2** (`DT`, `DTM`, `TS`, `DR`)                                        | the observation value the message itself types as a date                                                                                                   | same as the row above: acted on and recorded, per repetition, and per range component for a `DR`                                                                            |
| Retained clinical/administrative segments (an explicit allow-list: OBR, ORC, AL1, DG1, PV1, RX\*, …) | every field except the rows above                                                                                                                          | **retained untouched** (the over-scrub guard)                                                                                                                               |

A recognized segment is retained **only** if it is on the explicit retain-list; anything else fails
closed. OBX-5 is retained only when OBX-2 positively types it as a structured clinical value (numeric,
coded, or a time of day): narrative (`TX`/`FT`), ambiguous String (`ST`), and any empty/unknown OBX-2
block, and a **date/time** value type makes OBX-5 a date the pass acts on rather than a value it keeps.

### How a date position is decided, and at which version

A date is located from the **HL7 v2.5.1 segment definitions** (chapters 2 to 15), never from the shape
of the value: an eight-digit numeric lab result is not a date, and free text mentioning a year is not
one either. The classification is committed in the library as an auditable table of positions, each
carrying the chapter, the field number, the component number where the date sits inside a composite,
and the name the standard gives it, so a reviewer can re-derive a row rather than trust it.

The version is **fixed at 2.5.1** and is never re-read from `MSH-12`: identical wire bytes yield an
identical set of date positions whatever version a sender declares. The price is stated in the
limitations below.

Each position is acted on **at its own unit**. A `DT`/`TS` field is acted on as a field; a date inside
a composite (a specimen collection range, an order's quantity/timing, a discharged-to location's
effective date) is acted on as **that component only**, so its siblings keep their bytes and their
component positions. A repeating field gets one locus **per repetition**, so an unreadable repetition is
emptied without disturbing the one beside it. The manifest path carries all three: `ORC-9[0]` is a
field, `SPM-17[0].2` is a component, and `OBX[1]-5[0]` names the repetition.

The identifier type inside a PID-3 list is read from the CX-5 type code (`SS` → SSN removed, `MR` → MRN
pseudonymized, `AN` → account, `MA`/`MC`/`PN` → beneficiary), so an SSN and an MRN in the same field are
handled differently, structurally, from the parser's typing.

## The two guarantees

- **No leak.** Every seeded PHI sentinel across PID/NK1/GT1/IN1/IN2, the encounter dates and order
  identifiers, every other date inside a retained segment, the free-text loci, and Z-segments is gone
  from the serialized output under the Safe Harbor profile. An unmapped locus that could carry PHI is
  blocked, never passed through in the clear.
- **No over-scrub.** Structured clinical OBX values, units, LOINC/coded observation identifiers,
  reference ranges, result statuses, times of day (`TM`), and every component of a composite that is not
  itself a date are retained byte-identical: the de-identifier never degenerates into a
  blanket-blanking "safe but useless" scrubber. The one narrowing of that guarantee is stated rather
  than implied: an OBX-5 whose OBX-2 types it as a **date** is a date, and is acted on and recorded like
  any other, so a structured OBX value is retained byte-identical **except** for that date-typed subset.

## Known limitations (this release)

- Free text is **block-only**: there is no built-in NLP scrub.
- Dates inside retained segments **are** acted on and recorded, and the classification is fixed at HL7
  **v2.5.1**. A position that only some other version of the standard types as a date is therefore a
  **residual**: it is not classified, not acted on, and not recorded. The same applies to a segment the
  retain-list keeps that v2.5.1 does not define, and to the file and batch envelope headers (`FHS`,
  `BHS`), whose creation timestamps are left untouched because those headers number their fields from a
  leading delimiter.
- Within retained segments, the **non-date** positions the maps do not name are still passed through
  untouched and recorded nowhere. That includes the **provider and other non-patient person names**
  (PV1-7/8, OBR-16 and their siblings), and the date/time components that live **inside** a person-name
  or address composite (an effective, expiration or action-performed date carried by a provider name,
  an authenticator's timestamp, a licence expiry). Retaining a segment is not auditing every field in
  it. If your threat model includes these, filter them yourself.
- The address generalization keeps only the Safe Harbor 3-digit ZIP (the permitted state is also
  dropped, conservative, never a leak).
- Under a **date-shift** policy, a date whose encoding that transform does not accept, including a
  legitimately reduced-precision value (year only, or year and month), is **blocked** rather than
  shifted: a recorded utility loss, never a value passed through unshifted.

The honesty line is unchanged: the output is **"Safe-Harbor-transformed per the configured policy,"**
never "de-identified" and never "HIPAA-compliant."
