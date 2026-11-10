---
id: guides-x12
title: De-identifying X12 EDI
sidebar_position: 8
description: "What the X12 EDI adapter locates, how each position is transformed, the REF frontier, and its known limitations."
---

# De-identifying X12 EDI

The `@cosyte/deid/x12` adapter is the HIPAA 005010 X12 binding of the de-identification core. It locates
PHI **structurally** in a parsed X12 interchange (a name is at `NM1-03..07` because the X12 TR3 says so,
never because a string "looked like" a name), applies the configured policy, and returns the
de-identified X12 byte stream plus the core's **value-free manifest**.

> **`@cosyte/x12` is an optional peer dependency.** Install it alongside `@cosyte/deid` to use this
> subpath; the core stays third-party-dependency-free. The adapter reaches EDI data only through
> `@cosyte/x12`'s exported model (`X12Interchange` / `X12Segment`, the 1-indexed `elements`, the detected
> `delimiters`) and re-emits with its **byte-faithful** `serializeX12`, so every segment the map does not
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

The built-in Safe Harbor policy uses **no keyed transform**, so a Safe Harbor pass over an interchange
needs no `context` at all. Under a preset that keeps consistent keyed surrogates instead, a `context`
is required and calling without one when the interchange needs it is a fatal `DEID_NO_KEY`: the engine
never falls back to an unkeyed surrogate.

## What is located, and how it is transformed

X12 is a flat, ordered segment stream; the subscriber (2000B/2010BA) and patient (2000C/2010CA) loops are
implicit, so the map keys off each **segment id** plus two **qualifier classifiers**.

| Locus                                                            | Handling                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **`NM1`**: subscriber / patient / dependent (`IL` / `QC` / `03`) | name (`NM1-03..07`) **removed**; id (`NM1-09`) routed by the `NM1-08` qualifier: SSN **removed**, member **removed** under Safe Harbor |
| **`NM1`** / **`N1`**: the individual's employer (`36`)          | name and id **removed**, on the same footing as a patient-side party: §164.514(b)(2)(i) removes the identifiers of the individual's **employers**, so an employer is not an unrelated organization |
| **`NM1`**: recognized provider / organization (`85` / `82` / …)  | **retained**: provider identity is not the individual's PHI (mirrors the HL7 adapter's provider retention), and the **entity-identifier code** it was classified on is recorded, value-free, at the party's locus |
| **`NM1`**: unknown entity code                                  | **fails closed**: name and id blocked (an unrecognized entity could be the patient)                                |
| **`N1`** (payer / provider org)                                 | **retained**; a patient-side or **unknown** party's name + id scrubbed / **fail closed** (same classification as `NM1`) |
| **`SBR`** (subscriber)                                          | `SBR-03` group / policy number **removed** under Safe Harbor, `SBR-04` group name **removed**; relationship codes retained |
| **`N3` / `N4`**                                                 | street + city **removed**; ZIP → safe 3-digit; state retained; an unmapped element (`N4-06` location id) **fails closed** |
| **`DMG-02`**, **`DTP-03`**, **`DTM-02`**                        | dates → **year**                                                                                                    |
| **`PER`**                                                       | contact name + communication numbers **removed**                                                                   |
| **`REF`**                                                       | patient / member / group / SSN identifier **removed** under Safe Harbor; recognized admin/provider reference retained; **unknown qualifier fails closed** |
| **Code positions** (`NM1-01` / `08`, `N1-01` / `03`, `REF-01`, `N4-02` / `04`) | a recognized code (entity code, identification code qualifier, `REF` qualifier, state or province, ISO country) is kept as written; any other value **fails closed**: removed and recorded at its own position |
| **`CLM-01` / `CLP-01`**                                         | patient account number **removed** under Safe Harbor (a consistent surrogate only under a preset that does not claim the label) |
| **Free text** (`MSG-01`, `III-04`, `K3-01`, `NTE-02`)           | **fails closed**: blocked (coded siblings retained), never scrubbed by a naive pass                                |
| **Clinical / financial** (`HI`, `SV*`, `SVC`, `AMT`, `CAS`, …)   | **retained**: diagnosis / procedure / revenue codes, amounts, quantities of their expected shape survive byte-identical |
| **Every other position**, envelope included                     | kept only when it has the shape its position expects; any other value, and any position no rule names, **fails closed** |
| Any **unmapped / unknown** segment                              | **fails closed**: removed whole, identifier included, each value recorded under a `<withheld>` segment id; `SE-01` counts it out |

## The `REF` frontier

Distinguishing a patient identifier from an administrative reference is the hardest call. The adapter
routes `REF` by its `REF-01` qualifier: patient identifiers (`SY` SSN, `1W` member, `0F` subscriber, `1L`
group, `EA` medical-record) are acted on under the configured policy; recognized non-patient references (`F8` payer
claim control, `EI` EIN, `TJ` tax id, `G1` prior authorization, provider ids) are retained; and an
**unrecognized qualifier fails closed**: the direct implementation of Safe Harbor category (R) for the
"unusual REF qualifier" that a shape guess would miss.

The qualifier itself is kept only when it is a code one of those lists names, exactly as written. A
sender who drops one element separator shifts the identifier left into `REF-01` (or into `NM1-08`,
`N1-03`, or the `N4` state), so a value there that is not a recognized code is removed and recorded
at its own position, never kept on the strength of where it sits. The same holds for an unrecognized
`REF-01` code such as `ZZ`: it goes with the value it routes.

## Every position is decided

A missing element separator shifts every value after it one position left, and an extra one shifts them
right, so an identifier can land in a code position, a date position, or a position past the last one a
rule names. The adapter decides every element it hands through, so none of those leaves in the clear:

- **A code position keeps only a code it knows, exactly as written.** The entity code, the
  identification code qualifier, the `REF` qualifier, the `N4` state and country, and every qualifier
  and code of `DMG`, `PER`, `DTP`, `DTM`, `SBR`, `CLM`, `HI` and the retained segments are checked
  against the position's code list, or against the exact shape of a published code set (ICD-10-CM,
  ICD-10-PCS, HCPCS, CARC, RARC). A lower-case or space-padded code is not the code.
- **A refused code routes nothing.** The party and reference classifiers read a code only after it
  passed that check. `NM1*pr*...` places no party outside the scope clause, so its name and
  identifier are removed; `REF*f8*...` is no administrative reference, so `REF-02` is removed.
- **A date position keeps only a valid date in the declared format.** `DMG-02` in the `DMG-01`
  format, `DTP-03` in the `DTP-02` format (`D8`, `RD8`, `DT`), `DTM-02` as `CCYYMMDD`. A date of the
  individual inside a retained segment (`PAT-06`, `INS-12`, an `HI` occurrence or procedure date) is
  generalized the same way, at its own component. A value that is no valid date in its format, a `TM`
  time of day included, is removed rather than cut down to whatever its front looks like.
- **Amounts, quantities and counts keep only a number**, and a trace, control or trading partner number
  keeps a bounded run of printable characters.
- **A free-text component is removed**: a procedure description inside `SV1-01`, a 999's copy of a bad
  data element (`IK4-04`), the business unit value a 999 context names (`CTX-01-2`).
- **A position no rule names is removed**: `NM1-10` onward, `N1-05` onward, `REF-03` onward, and any
  element past the last one a retained segment uses. `NM1-02` keeps only `1` or `2`, so a last name
  shifted there is removed as well.
- **A segment identifier is decided too.** The parser reads a segment's identifier as the text before
  its first element separator, so an extra segment terminator (`DMG*D8~19800101*F~`) or a missing
  separator (`NM1ZZMEMBER*X~`) puts a value where the identifier belongs. A segment whose identifier
  is not one the pass recognizes is removed whole, identifier included, and each value it carried is
  recorded at its own position under a withheld segment id (`837/<withheld>[0]-0` for the identifier).
  The identifier is withheld even when it has the shape of one, because a two-letter last name or a
  name suffix does. The transaction set's `SE-01` is reduced by one for each segment removed, so a
  count that was right stays right.
- **The envelope is decided too.** An `ISA`, `GS`, `GE`, `TA1`, `IEA`, `ST` or `SE` element of the
  wrong shape is removed (an `ISA` element becomes blanks of its own width, so the header keeps its 106
  bytes). A segment the parser found outside every transaction set is removed whole, identifier
  included, and recorded under `orphan/`, and bytes after the `IEA` that are not blank (a whole second
  interchange, say) are removed and recorded at `trailingBytes`.

Each removal is a blocked manifest row at its own position (`837/NM1[0]-10`, `837/HI[0]-1-4` for a
component). Recognized codes, valid dates and amounts on well-formed input keep their output. Because
nothing is left unexamined, `unexaminedResiduals` is always empty for X12: the count is still taken, and
it is a measured zero. The transaction's creation date (`BHT-04`), a payment's effective date
(`BPR-16`) and the envelope dates are kept when they are valid dates: they date the exchange, not the
individual.

## Known limitations

Provider / organization identity is **retained** as non-patient identity, and there is **no** option to
suppress it: the retention is structural, in the extractor, not a per-category policy choice. It is not
silent, though: every retained party emits a value-free manifest row naming the entity-identifier code
that placed it outside the scope clause, so a reader can check the classification rather than infer it
from an absence. Code lists cover what the HIPAA 005010 TR3s use for 837, 835, 270 / 271, 276 / 277,
278, 834, 999 and TA1, checked against a well-formed transaction set of each kind; a real but rarer code
outside them is removed and recorded, which over-removes a code rather than passing an unchecked value.
The same holds for a segment: one the pass has no rule or shape for is removed whole even when it is a
real X12 segment. That includes the 835 provider adjustment and summary segments (`PLB`, `TS3`) and the
834 segments beyond `INS` / `HD` that carry member detail (`EC`, `ICM`, `HLH`, `LUI`, `COB`, `IDC`).
