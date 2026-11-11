---
id: guides-x12
title: De-identify an X12 interchange
sidebar_label: X12 EDI
description: "Run an X12 EDI interchange through the Safe Harbor policy, read what is located, how each position is decided, the REF frontier, and its limits."
---

# De-identify an X12 interchange

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

## De-identify an interchange

Parse the interchange with `@cosyte/x12` and hand it to `deidentifyX12`, or pass the raw text to
`deidentifyX12String`, which parses and de-identifies in one call. The 837P below is synthetic and
cut down to one claim.

```ts runnable
import { parseX12 } from "@cosyte/x12";
import { deidentifyX12, deidentifyX12String } from "@cosyte/deid/x12";

const raw = [
  "ISA*00*          *00*          *ZZ*COMMERCIAL     *ZZ*CLINICSUBMTR   *260615*0930*^*00501*000000002*0*P*:~",
  "GS*HC*COMMERCIAL*CLINICSUBMTR*20260615*0930*2*X*005010X222A2~",
  "ST*837*0002~",
  "BHT*0019*00*REF01*20260615*0930*CH~",
  "HL*1**20*1~",
  "NM1*85*2*BILLINGPROV LLC*****XX*1999999999~",
  "HL*2*1*22*0~",
  "SBR*P*18*ZZPOLICY777******CI~",
  "NM1*IL*1*ZZSUBLAST*ZZSUBFIRST****MI*ZZMEMBERX12~",
  "N3*ZZSUBSTREET~",
  "N4*ZZSUBCITY*OH*44101~",
  "DMG*D8*19850302*M~",
  "CLM*ZZACCTX12*100.00***11:B:1*Y*A*Y*Y~",
  "HI*ABK:E1165~",
  "SV1*HC:99213*100.00*UN*1***1~",
  "DTP*472*D8*20260601~",
  "SE*14*0002~",
  "GE*1*2~",
  "IEA*1*000000002~",
].join("\n");

const { x12, manifest, unexaminedResiduals } = deidentifyX12(parseX12(raw));
// or, parse + de-identify in one call:
deidentifyX12String(raw).x12 === x12; // => true

x12.includes("NM1*IL*1******MI*~"); // => true
x12.includes("DMG*D8*1985*M~"); // => true
x12.includes("N4**OH*441~"); // => true
x12.includes("NM1*85*2*BILLINGPROV LLC*****XX*1999999999~"); // => true
x12.includes("SV1*HC:99213*100.00*UN*1***1~"); // => true
manifest[0]?.code; // => "DEID_PARTY_ROLE_RETAINED"
unexaminedResiduals.length; // => 0
```

The subscriber's name, identifier, street, city and claim account number are gone, the date of
birth keeps its year, the ZIP keeps a safe three-digit prefix, and the billing provider, the codes
and the amounts are kept. The manifest names each position, and the provider's row records the
entity code it was kept on.

The built-in Safe Harbor policy uses **no keyed transform**, so a Safe Harbor pass over an interchange
needs no `context` at all. Under a preset that keeps consistent keyed surrogates instead, a `context`
is required and calling without one when the interchange needs it is a fatal `DEID_NO_KEY`: the engine
never falls back to an unkeyed surrogate. [Choose a policy](./choose-a-policy.md#use-a-profile) shows
how to pass one.

## What is located, and how it is transformed

X12 is a flat, ordered segment stream; the subscriber (2000B/2010BA) and patient (2000C/2010CA) loops are
implicit, so the map keys off each **segment id** plus two **qualifier classifiers**.

| Locus                                                            | Handling                                                                                                            |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **`NM1`**: subscriber / patient / dependent (`IL` / `QC` / `03`) | name (`NM1-03..07`) **removed**; id (`NM1-09`) routed by the `NM1-08` qualifier: SSN **removed**, member **removed** under Safe Harbor |
| **`NM1`** / **`N1`**: the individual's employer (`36`, the plan sponsor `P5`, and in an `820` the premium payer `PR`) | name and id **removed**, on the same footing as a patient-side party: §164.514(b)(2)(i) removes the identifiers of the individual's **employers**, so an employer is not an unrelated organization |
| **`NM1`**: recognized provider / organization (`85` / `82` / …)  | **retained**: provider identity is not the individual's PHI (mirrors the HL7 adapter's provider retention), and the **entity-identifier code** it was classified on is recorded, value-free, at the party's locus |
| **`NM1`**: the Other Insured (`GB`), an 834 responsible person, an ambulance pick-up or drop-off location | name and id **removed** like the individual's: the 005010 TR3s use these codes for people around the individual and for places that can be the individual's own |
| **`NM1`**: unknown entity code                                  | **fails closed**: name and id blocked (an unrecognized entity could be the patient); a real entity code no role table names is kept, its party's name and id are not |
| **`N1`** (payer / provider org)                                 | **retained**; a patient-side or **unknown** party's name + id scrubbed / **fail closed** (same classification as `NM1`) |
| **`SBR`** (subscriber)                                          | `SBR-03` group / policy number **removed** under Safe Harbor, `SBR-04` group name **removed**; relationship codes retained |
| **`N3` / `N4`**                                                 | street + city **removed**; ZIP → safe 3-digit; state retained; an unmapped element (`N4-06` location id) **fails closed** |
| **`DMG-02`**, **`DTP-03`**, **`DTM-02`**                        | dates → **year**; a `DMG-02` birth year that shows an age over 89 is **removed**                                    |
| **`PER`**                                                       | contact name + communication numbers **removed**                                                                   |
| **`REF`**                                                       | patient / member / group / SSN identifier **removed** under Safe Harbor; recognized admin/provider reference retained; **unknown qualifier fails closed** |
| **Code positions** (`NM1-01` / `08`, `N1-01` / `03`, `REF-01`, `N4-02` / `04`) | a code of the element's complete 005010 list (entity code, identification code qualifier, `REF` qualifier, country), or a state or province, is kept as written; any other value **fails closed**: removed and recorded at its own position |
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

The qualifier itself is kept when it is a code of element 128's complete 005010 list, exactly as
written. A real qualifier on neither list (the 837 `XZ` prescription number, the 271 `18` plan number)
keeps its place, and the value it qualifies fails closed, because the code alone does not say whose it
is. A sender who drops one element separator shifts the identifier left into `REF-01` (or into
`NM1-08`, `N1-03`, or the `N4` state), so a value there that is no code at all is removed and recorded
at its own position, never kept on the strength of where it sits, and it goes with the value it would
route.

## Every position is decided

A missing element separator shifts every value after it one position left, and an extra one shifts them
right, so an identifier can land in a code position, a date position, or a position past the last one a
rule names. The adapter decides every element it hands through, so none of those leaves in the clear:

- **A code position keeps only a real code, exactly as written.** The entity code, the
  identification code qualifier, the `REF` qualifier, the `N4` state and country, and every qualifier
  and code of `DMG`, `PER`, `DTP`, `DTM`, `SBR`, `CLM`, `HI` and the retained segments are checked
  against the complete 005010 code list of the position's data element (the 277CA `AMT*YU` and
  `QTY*AA` among them), or, where the codes come from outside X12, against the exact shape of the
  published code set (ICD-10-CM, ICD-10-PCS, HCPCS, CARC, RARC, the NUBC codes, the provider
  taxonomy). A lower-case or space-padded code is not the code.
- **A real code with no route keeps its place; what it qualifies does not.** A `REF` qualifier on
  neither `REF` table, an entity code on no role table (the 837I `ZZ` other operating physician), or
  an `HI` qualifier whose code shape the adapter does not know is kept, and the reference value, the
  party's name and identifier, or the `HI` code is removed and recorded.
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
- **A shift into a number is caught by the position it left empty.** A number shape cannot tell a
  shifted date or account number from an amount, so the adapter looks for the shift instead. A position
  the 005010 TR3s require (`CLM-01`, `CLP-01`, `CAS-03`, an `HI` entry's qualifier and code),
  or one a qualifier implies (a date format implies its date, as `HI` `C022-03` / `04` and `PAT-05` /
  `06` pair; a unit or a qualifier implies its value), cannot be empty while a later position holds a
  value. When one is, every value after it was shifted there, and each is removed and recorded at its
  own position: `HI*BH:11:D8::20260118` loses the date in `C022-05`, and `CLM**4455667701*150...`
  loses everything after the empty `CLM-01`. An `HI` amount or quantity (`C022-05` / `06`) is kept only
  under a value code (`BE`), the one qualifier the TR3s give an amount.
- **A shift left is caught by the first value out of place.** A missing separator moves every later
  value one place left, so no position is left empty. A value that fails the shape of a required
  position, or of a narrow one (a code, a date, a composite of codes), shows the shift instead: `PAT-07`
  keeps only `01`, the pound the TR3s allow, so `PAT*19******D8*20250117` loses the date of death in
  `PAT-08`. The values between the last narrow position whose value held and that one may be shifted
  ones too, so they are removed with every value after it. The `ISA` is read at fixed byte positions,
  so nothing in it can be shifted, and each of its elements is decided alone.
- **`STC` keeps only its codes.** A claim status keeps its status composites (`STC-01`, `STC-10`,
  `STC-11`: the category and status codes in the form of their code sources, the entity identifier and
  the code list qualifier from their 005010 lists) and its payment method (`STC-07`, from its list).
  Every other position is removed and recorded at its own position, in a 277 and a 277CA alike: the
  status, adjudication and check dates (`STC-02`, `-06`, `-08`), the amounts (`STC-04`, `-05`), the
  action code (`STC-03`), the check or EFT trace number (`STC-09`) and the message (`STC-12`). An
  amount sits right before the adjudication date, so a separator left out between them moves the date
  into the amount, where it passes as a number, and when the date is the last element nothing after
  it can fail and show the shift (`STC*F2:88*20260126**1500*20260128`). So no `STC` date or amount is
  kept, wherever it sits. Every other date of the individual (`DTP-03`, `DMG-02`, `DTM-02`, `PAT-06`,
  `INS-12`, an `HI` date) has its format or qualifier code right before it, so a separator left out
  puts the date in that code's place, where it fails, and one added puts it in a position that is a
  code, a date, or not kept.
- **The required positions are read for the transaction set.** A position is required where the TR3
  of the set the segment sits in requires it: the 270, 271 and 278 `INS` keep `INS-17` with no
  `INS-03` or `INS-05`, and a 278 service line keeps its unit and count with no line charge.
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
from an absence. Each code position is checked against the complete 005010 code list of its data
element, and a well-formed transaction set of each kind (837P, 837I, 837D, 835, 270, 271, 276, 277,
277CA, 278, 834, 999) keeps every code it carries. A segment the pass has no rule or shape for is
removed whole even when it is a real X12 segment. That includes the 835 provider adjustment and summary
segments (`PLB`, `TS3`, `TS2`), the 837 segments `CUR`, `CR5` to `CR8`, `FRM`, `SV4` and `RDM`, and the
834 segments beyond `INS` / `HD` that carry member detail (`EC`, `ICM`, `HLH`, `LUI`, `COB`, `IDC`).
The 837 provider taxonomy (`PRV`), other insurance indicators (`OI`) and dental `DN1` / `DN2` segments
are kept by shape.

An interchange is one patient context. An `837` names a subscriber and a dependent patient, and an
interchange can carry claims for many patients, so this is not refused; under a **date-shift** policy
every date in it moves by the one offset the context derives (see
[the limitations page](./limitations.md#one-context-per-call-however-many-people-the-document-names)).

## Reference

- [`deidentifyX12`](./api/@cosyte/deid/x12.md#deidentifyx12),
  [`deidentifyX12String`](./api/@cosyte/deid/x12.md#deidentifyx12string) and
  [`X12DeidResult`](./api/@cosyte/deid/x12.md#x12deidresult)
- [`classifyNm1Party`](./api/@cosyte/deid/x12.md#classifynm1party),
  [`classifyRefQualifier`](./api/@cosyte/deid/x12.md#classifyrefqualifier),
  [`PROVIDER_ENTITY_CODES`](./api/@cosyte/deid/x12.md#provider_entity_codes),
  [`EMPLOYER_ENTITY_CODES`](./api/@cosyte/deid/x12.md#employer_entity_codes) and
  [`X12_FREE_TEXT_ELEMENTS`](./api/@cosyte/deid/x12.md#x12_free_text_elements): the routing this page
  describes
- [`DeidOptions`](./api/@cosyte/deid.md#deidoptions)
- [Codes and categories](./codes-and-categories.md): every disposition and fatal code
