# @cosyte/deid/hl7

`@cosyte/deid/hl7`: the **HL7 v2 de-identification adapter**. The first end-to-end format binding of
the format-agnostic core: it locates PHI **structurally** in the parsed
`@cosyte/hl7` model, applies the configured de-identification policy, and returns a transformed
`Hl7Message` plus the core's value-free manifest.

**`@cosyte/hl7` is an optional peer dependency**, consumed only from this subpath: a consumer who
only de-identifies HL7 v2 installs it alongside `@cosyte/deid`; the core stays dependency-free. Import
this module as `@cosyte/deid/hl7`.

**What it covers.** The structured PHI loci of **PID** (patient), **NK1** / **GT1** / **IN1** / **IN2**
(relatives / guarantor / insured) via the cited [HL7\_LOCUS\_MAP](#hl7_locus_map). **Fail closed**
everywhere else: a recognized segment is retained only if it is on the explicit [RETAIN\_SEGMENTS](#retain_segments)
clinical/administrative list, so a *known* patient-identity segment absent from the map (**MRG** prior
name + MRN on a merge, **FAM**, **ACC**, **PEO**, **PDA**) is blocked, not passed through, and
Z-segments / structure unknown to the parser are blocked. **OBX-5** is retained only when OBX-2
positively types it as a structured clinical value (numeric / coded / a time of day); narrative
(`TX`/`FT`), ambiguous String (`ST`), and any empty/unknown OBX-2 fail closed, as do **NTE-3**
comments, and a **date/time** value type makes OBX-5 a date this pass acts on. The OBX segment's own
date/time fields are acted on too (below). Structured clinical values / units / codes / status are
**retained untouched** (the over-scrub guard). The honesty line is unchanged: the output is
**"Safe-Harbor-transformed per the configured policy"**, never "de-identified".

**Inside a retained segment**, the identifying dates and the encounter / order numbers are carved
back out ([RETAINED\_LOCUS\_RULES](#retained_locus_rules)): under a Safe-Harbor-labelled policy the admit (PV1-44),
discharge (PV1-45), observation (OBR-7) and diagnosis (DG1-5) dates generalize to their **year**, and
the visit number (PV1-19) and the placer / filler order numbers (OBR-2/3, ORC-2/3) are **removed**. A
profile that names their retention class keeps them **unchanged and recorded**.

**The individual's employer is a Safe Harbor subject**, because §164.514(b)(2)(i) removes the
identifiers of the individual "or of relatives, **employers**, or household members" of the
individual. So the employer positions the financial segments type are acted on and recorded like any
other mapped locus: the guarantor's employer name (GT1-16), address (GT1-17) and phone (GT1-18), the
guarantor employee and employer ids (GT1-19, GT1-29), the insured's group employer id and name
(IN1-10, IN1-11), the insured's employer name (IN2-3), the employer contact person's name and phone
(IN2-49, IN2-50) and the insured's employer phone (IN2-64). **IN2-70** types an *organisation* rather
than a value, so it goes through the shared party-role test ([HL7\_ORGANISATION\_PARTY\_RULES](#hl7_organisation_party_rules),
[HL7\_PARTY\_ROLE\_TABLE](#hl7_party_role_table)) that the X12 adapter applies to an `NM1` / `N1` party, and fails closed:
the role there is the insured's employer, which the clause names, so name and identifier both go. The
*insurer's* own company name, address and phone (IN1-3/4/5/7) and the coded employment status
(GT1-20) are untouched: neither is the individual's, a relative's or an employer's identity.

**PV1-19 is a CX list routed by its CX-5 identifier-type code**, exactly like PID-3: a `VN`-typed or
untyped value is the encounter identifier (removed as the (R) catch-all, retainable), while an
`MR`/`AN`/`SS`-typed one is handled as the identifier it really is and is **transformed under both
profiles, never retained** -- §164.514(e)(2) names all three, so keeping one would republish in the
clear the identifier the pass pseudonymized at PID-3 in the same message.

**Every other date inside a segment the pass hands through** is located from [HL7\_DATE\_LOCI](#hl7_date_loci),
the committed HL7 v2.5.1 enumeration, and acted on under the configured policy at the unit the
standard gives it: a `DT`/`TS` field, a single date component of a composite, one repetition at a
time. Its domain is [HL7\_PASSED\_THROUGH\_SEGMENTS](#hl7_passed_through_segments): the retain-list **plus OBX**, whose own
observation (OBX-14), analysis (OBX-19) and reference-range (OBX-12) timestamps are swept like any
other even though the retain-list does not name the segment. Each outcome is recorded, so a consumer
reads the manifest and knows which dates the output still carries.

**Every position the pass hands through is enumerated.** A value-bearing position inside a segment
this adapter hands through that no locus rule names is **counted and located** as an unexamined
residual on [Hl7DeidResult.unexaminedResiduals](#unexaminedresiduals): the provider names in PV1-7/8 and OBR-16, the
date components carried inside a person-name or address composite, and the coded positions of every
retained segment. Nothing is transformed on account of it: the measurement exists so an empty residual
inventory can be told apart from an unmeasured one.

**Known limitations.** Free text is block-only (no scrub); every **non-date** field of a retained
segment that the maps do not name is still passed through untouched, which includes the provider names
in PV1-7/8 and OBR-16 and the date components carried inside a person-name or address composite. The
date classification is fixed at v2.5.1, so a position only another version types as a date is a stated
residual, as are the file and batch envelope headers. The address generalization keeps only the Safe
Harbor 3-digit ZIP and conservatively drops the (permitted) state as well.

**The postal-address allowance of §164.514(e)(2)(ii)** is the one place a profile can ask this pass to
keep MORE geography than that. A profile naming the `limited-data-set-geography` retention class keeps
the town or city (XAD.3), the State (XAD.4) and the **whole** zip code (XAD.5) of every mapped address
(PID-11, NK1-4, NK1-32, GT1-5, GT1-17, IN1-19), each recorded as a `DEID_RESIDUAL_RETAINED` residual
at its own component, and drops the street and every other component. The three-digit / `000` rule is
Safe Harbor's, so a restricted-prefix ZIP is kept in full under this class. **Nothing widens by
omission**: without the class an address is reduced exactly as it always was. An address whose ZIP is
not a whole zip code **fails closed** to that same generalization, which drops the whole repetition.
The county code (PID-12) and the birth place (PID-23) are blocked under every profile: (e)(2)(ii)
names neither. This adapter is the ONLY one that reads retention classes; the other five stay at Safe
Harbor geography.

## Interfaces

### Hl7Coord

A write-back coordinate: the exact structural location of one extracted locus in the message's raw
segment tree. Carries no value.

#### Properties

##### component?

> `readonly` `optional` **component?**: `number`

1-based component number, for a `date-component` or an `address-part` edit. Absent for every
other edit.

##### edit

> `readonly` **edit**: [`Hl7EditKind`](#hl7editkind)

How to write the transformed value back.

##### field

> `readonly` **field**: `number`

1-based HL7 field number.

##### rep

> `readonly` **rep**: `number`

0-based repetition index.

##### segIndex

> `readonly` **segIndex**: `number`

Absolute index of the segment in `Hl7Message.rawSegments`.

***

### Hl7DateLocusRule

One date position of one retained segment. `component` is present exactly when the date is a
component of a composite field, in which case the locus is that component and never the field that
contains it.

#### Example

```ts
import { HL7_DATE_LOCI } from "@cosyte/deid/hl7";

HL7_DATE_LOCI.ORC?.loci.find((l) => l.field === 9)?.datatype; // => "TS"
```

#### Properties

##### component?

> `readonly` `optional` **component?**: `number`

1-based component number, when the date is a component of a composite field.

##### composite?

> `readonly` `optional` **composite?**: `string`

The composite field datatype the component sits in (`DR`, `TQ`, `DLD`, …), when it is one.

##### datatype

> `readonly` **datatype**: [`Hl7DateDatatype`](#hl7datedatatype)

The datatype the v2.5.1 definition gives the position.

##### field

> `readonly` **field**: `number`

1-based HL7 field number.

##### name

> `readonly` **name**: `string`

The name the v2.5.1 segment (or composite) definition gives the position. Never a value.

***

### Hl7DeidResult

The result of de-identifying an HL7 v2 message: the transformed message plus the core's value-free
manifest of every category acted on and every locus blocked.

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
import { deidentifyHl7 } from "@cosyte/deid/hl7";

const result: Hl7DeidResult = deidentifyHl7(parseHL7(raw), {});
result.document.toString(); // de-identified HL7 wire
```

#### Properties

##### document

> `readonly` **document**: `Hl7Message`

The de-identified message: a fresh, independent Hl7Message; the input is never mutated.

##### manifest

> `readonly` **manifest**: readonly [`DeidManifestEntry`](../deid.md#deidmanifestentry)[]

The value-free audit of every action, in locus order (never a value, never a key).

##### unexaminedResiduals

> `readonly` **unexaminedResiduals**: readonly [`UnexaminedResidual`](../deid.md#unexaminedresidual)[]

The manifest's **second list**: every value-bearing position inside a segment this pass handed
through that **no locus rule named**, counted and located. Nothing here was transformed, blocked or
kept by a decision, because nothing reached it; an empty list is therefore a **measured zero**, not
a silence. Hand it to `buildExpertDeterminationSupportReport` alongside the manifest so the support
report can say which of the two it is.

***

### Hl7Extraction

The paired output of [extractHl7Loci](#extracthl7loci): loci for the engine + coordinates for the applier.

#### Properties

##### coords

> `readonly` **coords**: [`Hl7Coord`](#hl7coord)[]

The write-back coordinates, index-aligned with [loci](#loci).

##### loci

> `readonly` **loci**: [`GenericLocus`](../deid.md#genericlocus)[]

The located candidate values, in document order.

##### unexaminedResiduals

> `readonly` **unexaminedResiduals**: readonly [`UnexaminedResidual`](../deid.md#unexaminedresidual)[]

Every **value-bearing position the pass hands through that no locus rule named**, counted and
located. Not loci: nothing here is transformed, blocked or retained by a decision, and the list is
the measurement of what the pass never examined (see `./positions.ts`).

***

### Hl7ExtractOptions

Options for [extractHl7Loci](#extracthl7loci). The retention set comes from the configured profile via
profileOptions; **omitting it retains nothing**, which is the fail-closed default.

#### Properties

##### retainedLoci?

> `readonly` `optional` **retainedLoci?**: readonly [`RetainedLocusClass`](../deid.md#retainedlocusclass)[]

The retention classes the profile permits. Absent or empty keeps no identifying locus.

***

### Hl7FieldRule

A single mapped PHI-bearing field within a segment.

#### Properties

##### category

> `readonly` **category**: [`SafeHarborCategory`](../deid.md#safeharborcategory)

The Safe Harbor category this field carries.

##### field

> `readonly` **field**: `number`

1-based HL7 field number (e.g. `5` for PID-5).

##### mode

> `readonly` **mode**: [`Hl7FieldMode`](#hl7fieldmode)

How to extract and write the field back.

##### routeByTypeCode?

> `readonly` `optional` **routeByTypeCode?**: `boolean`

For `id` fields only: when `true`, the category is resolved **per repetition** from the CX-5
identifier-type code (`SS` → SSN, `MR` → MRN, `AN`/`AC` → account, `MA`/`MB`/`PN` → beneficiary),
falling back to [category](#category) for an unrecognized or absent type code. This is the structural,
parser-typed way to tell an SSN from an MRN inside one PID-3 list.

***

### Hl7OrgPartyRule

An **organisation-typed party position**: a field whose v2.5.1 definition types a whole party rather
than one identifying value, so it is decided by the party-role test rather than by a flat category
rule. The whole field is the unit: an `XON` carries the organisation's name (component 1) and its
identifier (component 10) together, and a party the clause reaches loses both.

#### Example

```ts
import { HL7_ORGANISATION_PARTY_RULES } from "@cosyte/deid/hl7";

HL7_ORGANISATION_PARTY_RULES["IN2"]?.[0]?.field; // => 70
```

#### Properties

##### field

> `readonly` **field**: `number`

1-based HL7 field number (e.g. `70` for IN2-70).

##### role

> `readonly` **role**: `string`

The role the v2.5.1 field definition types at this party; a key of [HL7\_PARTY\_ROLES](#hl7_party_roles).

***

### Hl7RetainedFieldRule

One field carved back out of a retained segment: an identifying locus a profile may keep, but only
by naming its [RetainedLocusClass](../deid.md#retainedlocusclass). Absent that, the engine acts on it under the policy.

#### Properties

##### category

> `readonly` **category**: [`SafeHarborCategory`](../deid.md#safeharborcategory)

The Safe Harbor category the locus carries when the policy acts on it. For a `routeByTypeCode`
field this is only the **fallback**: the real category is read from the identifier-type code.

##### field

> `readonly` **field**: `number`

1-based HL7 field number (e.g. `44` for PV1-44).

##### kind

> `readonly` **kind**: `"identifier"` \| `"date"`

`date` generalizes to year under Safe Harbor; `identifier` is blocked as the (R) catch-all.

##### retention

> `readonly` **retention**: [`RetainedLocusClass`](../deid.md#retainedlocusclass)

The retention class a profile must name for this locus to survive.

##### routeByTypeCode?

> `readonly` `optional` **routeByTypeCode?**: `boolean`

For a **CX** field: resolve the category **per repetition** from the CX-5 identifier-type code
(HL7 Table 0203), exactly as PID-3 does, and write back only the id-number component.

**This is a safety requirement, not a nicety.** PV1-19 is a CX, and a visit-number field routinely
carries an `MR` medical record number or an `AN` account number: both are named by
§164.514(e)(2), so both must be transformed rather than retained even under a limited-data-set
preset. Reading the code is what stops the pass republishing, in the clear, the very identifier it
pseudonymized at PID-3 in the same message.

***

### Hl7SegmentDateLoci

One retained segment's date positions, plus the citation a reviewer re-derives them from.

#### Example

```ts
import { HL7_DATE_LOCI } from "@cosyte/deid/hl7";

HL7_DATE_LOCI.EVN?.chapter; // => "3"
```

#### Properties

##### chapter

> `readonly` **chapter**: `string`

The chapter of the v2.5.1 standard that defines the segment.

##### fields

> `readonly` **fields**: `number`

How many fields that definition has: the extent of the walk these rows came from.

##### loci

> `readonly` **loci**: readonly [`Hl7DateLocusRule`](#hl7datelocusrule)[]

Every date position of the segment, in ascending field then component order.

##### note?

> `readonly` `optional` **note?**: `string`

Why the row set is what it is, where that is not obvious from the segment definition alone.

## Type Aliases

### Hl7DateDatatype

> **Hl7DateDatatype** = `"DT"` \| `"DTM"` \| `"TS"`

The datatypes that make a position a date locus. `DT` is a calendar date, `TS` a time stamp, and
`DTM` a date/time as later versions of the standard spell it (reachable only through an `OBX-2`
value type, never through a v2.5.1 field definition). A `TM` time of day is **not** here: a time of
day carries no element of a date.

#### Example

```ts
import { type Hl7DateDatatype } from "@cosyte/deid/hl7";

const dt: Hl7DateDatatype = "TS";
```

***

### Hl7EditKind

> **Hl7EditKind** = `"whole-field"` \| `"id-number"` \| `"address-zip"` \| `"address-part"` \| `"date-field"` \| `"date-component"` \| `"none"`

How the applier writes a transformed locus back onto the cloned raw tree. `none` writes **nothing**:
it is the coordinate of a locus the profile's retention set kept, which must stay byte-identical
(a whole-field write would flatten its components and repetitions into a single value).

`date-field` and `date-component` are the two units a date locus can have: the first rewrites the
date component of **one repetition** of a field, the second rewrites **one component** of one
repetition and leaves every sibling component at its own ordinal.

`address-part` is the §164.514(e)(2)(ii) unit: it **reduces the address repetition to the five XAD
slots the named parts occupy, all empty**, before writing its own component, so the street, the
county and every other position of the address are gone whether or not a locus addressed them.

***

### Hl7FieldMode

> **Hl7FieldMode** = `"redact"` \| `"date"` \| `"id"` \| `"address"` \| `"block"`

How the extractor turns a mapped HL7 field into loci and how the applier writes the result back:

- `redact`: a whole-field direct identifier with no analytic value (name, phone, email, SSN,
  licence). One locus per field; the field is cleared (or, under a deviating policy, replaced).
- `date`: a whole-field date/timestamp (DOB, death date). One locus per field; generalized to year.
- `id`, a repeating identifier field (CX list: MRN / account / member id). **One locus per
  repetition** so each identifier gets its own consistent surrogate; only the id-number component
  (CX.1) is replaced, the assigning authority / type code are retained.
- `address`: a structured address (XAD). **One locus per repetition**; the Safe Harbor 3-digit-ZIP
  generalization is applied and every finer geographic component (street / city / county) is dropped.
- `block`: a geographic or other identifier with no clean structured generalization (county code,
  birth place). Fails **closed**: removed and recorded, never passed through.

## Variables

### HL7\_DATE\_LOCI

> `const` **HL7\_DATE\_LOCI**: `Readonly`\<`Record`\<`string`, [`Hl7SegmentDateLoci`](#hl7segmentdateloci)\>\>

The enumeration: every segment of [HL7\_PASSED\_THROUGH\_SEGMENTS](#hl7_passed_through_segments), and every date position HL7
v2.5.1 gives it.

Every segment of that domain appears here, including the ones with no date position at all, so that
"this segment was walked and carries none" and "this segment was never walked" are different facts
rather than the same silence.

#### Example

```ts
import { HL7_DATE_LOCI } from "@cosyte/deid/hl7";

HL7_DATE_LOCI.SPM?.loci.filter((l) => l.field === 17).length; // => 2 (a date range: two components)
```

***

### HL7\_DATE\_LOCUS\_VERSION

> `const` **HL7\_DATE\_LOCUS\_VERSION**: `"2.5.1"` = `"2.5.1"`

The version of the HL7 standard every row of [HL7\_DATE\_LOCI](#hl7_date_loci) is derived from. The
classification is fixed here and is never re-derived per message.

#### Example

```ts
import { HL7_DATE_LOCUS_VERSION } from "@cosyte/deid/hl7";

HL7_DATE_LOCUS_VERSION; // => "2.5.1"
```

***

### HL7\_LOCUS\_MAP

> `const` **HL7\_LOCUS\_MAP**: `Readonly`\<`Record`\<`string`, readonly [`Hl7FieldRule`](#hl7fieldrule)[]\>\>

The full HL7 v2 locus map: segment type → its mapped PHI-bearing fields. A segment absent from this
map is either free text (OBX/NTE, handled by the extractor's free-text path), unknown structure
(Z-segments / segments unknown to the parser, failed closed), or a recognized non-PHI segment
(retained untouched).

#### Example

```ts
import { HL7_LOCUS_MAP } from "@cosyte/deid/hl7";

HL7_LOCUS_MAP.PID?.find((r) => r.field === 5)?.category; // => "NAMES"
```

***

### HL7\_ORGANISATION\_PARTY\_RULES

> `const` **HL7\_ORGANISATION\_PARTY\_RULES**: `Readonly`\<`Record`\<`string`, readonly [`Hl7OrgPartyRule`](#hl7orgpartyrule)[]\>\>

The organisation-typed party positions of the mapped segments, by segment type. `IN2-70` (Insured
Employer Organization Name and ID, `XON`) is the one the standard types today: the role at that
position is the insured's **employer**, which §164.514(b)(2)(i) names, so the role test cannot
establish it as outside the clause and the position fails closed, name and identifier together.

#### Example

```ts
import { HL7_ORGANISATION_PARTY_RULES, HL7_PARTY_ROLES } from "@cosyte/deid/hl7";

HL7_ORGANISATION_PARTY_RULES["IN2"]?.[0]?.role; // => HL7_PARTY_ROLES.INSURED_EMPLOYER
```

***

### HL7\_PARTY\_ROLE\_TABLE

> `const` **HL7\_PARTY\_ROLE\_TABLE**: [`PartyRoleTable`](../deid.md#partyroletable)

The HL7 v2 **party-role table**: which side of §164.514(b)(2)(i)'s scope clause each role in
[HL7\_PARTY\_ROLES](#hl7_party_roles) puts a party on. It is the v2 half of the same test the X12 adapter runs over
an `NM1-01` / `N1-01` entity-identifier code, and it fails closed the same way: a role on neither
list is `unknown`, and an unknown party is treated as a Safe Harbor subject.

The outside-scope list is **empty on purpose**. The one organisation-typed position mapped today,
`IN2-70`, is the individual's employer, which the clause names; the insurer's own company name,
address and phone (`IN1-3/4/5/7`) are outside the clause but carry **no role code at the position**
to classify on, so they are retained by the over-scrub guard rather than by this table. Recording a
role code the standard does not type there would be inventing one.

#### Example

```ts
import { classifyPartyRole } from "@cosyte/deid";
import { HL7_PARTY_ROLE_TABLE, HL7_PARTY_ROLES } from "@cosyte/deid/hl7";

classifyPartyRole(HL7_PARTY_ROLES.INSURED_EMPLOYER, HL7_PARTY_ROLE_TABLE).scope;
// => "safe-harbor-subject" (an employer is never outside the clause)
```

***

### HL7\_PARTY\_ROLES

> `const` **HL7\_PARTY\_ROLES**: `object`

The **roles v2.5.1 field definitions type at an organisation-typed party position**. Unlike X12,
where `NM1-01` / `N1-01` carry an entity-identifier code on the wire, a v2 organisation position
names its party's role in the *standard's own definition of the field*: `IN2-70` is "Insured Employer
Organization Name and ID", so the role at that position is the insured's employer, whatever the
organisation's name happens to be. These tokens are this library's names for those roles; they are
never read off a document.

#### Type Declaration

##### INSURED\_EMPLOYER

> `readonly` **INSURED\_EMPLOYER**: `"INSURED_EMPLOYER"` = `"INSURED_EMPLOYER"`

The insured's employer, the party `IN2-70` types. §164.514(b)(2)(i) names employers.

#### Example

```ts
import { HL7_PARTY_ROLES } from "@cosyte/deid/hl7";

HL7_PARTY_ROLES.INSURED_EMPLOYER; // => "INSURED_EMPLOYER"
```

***

### HL7\_PASSED\_THROUGH\_SEGMENTS

> `const` **HL7\_PASSED\_THROUGH\_SEGMENTS**: `ReadonlySet`\<`string`\>

The **domain** of [HL7\_DATE\_LOCI](#hl7_date_loci): every segment whose bytes this adapter can pass through, so
every segment inside which a full-precision date could survive the pass. It is the
[RETAIN\_SEGMENTS](#retain_segments) retain-list **plus `OBX`**, the one segment the adapter passes through by its
own `OBX-2` value-type branch instead of by the list.

The distinction is deliberate and is the reason this set exists rather than the retain-list alone:
membership of a list is not what makes a date position dangerous, surviving the pass is. A segment
that fails closed is blocked field by field and leaks nothing, so it is not here; `OBX` is not on the
retain-list yet keeps every field the value-type branch does not touch, which is exactly the shape
that hides a date. **This set adds no segment to the retain-list**: what the adapter retains is
unchanged, and this only fixes what the date enumeration must be complete over.

#### Example

```ts
import { HL7_PASSED_THROUGH_SEGMENTS, RETAIN_SEGMENTS } from "@cosyte/deid/hl7";

HL7_PASSED_THROUGH_SEGMENTS.has("OBX"); // => true  (passed through, not retain-listed)
RETAIN_SEGMENTS.has("OBX"); // => false (the retain-list is unchanged)
```

***

### OBX\_DATE\_VALUE\_TYPES

> `const` **OBX\_DATE\_VALUE\_TYPES**: `ReadonlySet`\<`string`\>

The `OBX-2` value types that make `OBX-5` a date locus. Unlike every position in
[HL7\_DATE\_LOCI](#hl7_date_loci), this one is **declared by the message**: `OBX-2` types the value carried at
`OBX-5`, so no table is needed and none is consulted. `DR` makes the locus **component-granular**
(a range start and a range end); the other three make it the field.

#### Example

```ts
import { OBX_DATE_VALUE_TYPES } from "@cosyte/deid/hl7";

OBX_DATE_VALUE_TYPES.has("TM"); // => false (a time of day is not an element of a date)
```

***

### RETAIN\_SEGMENTS

> `const` **RETAIN\_SEGMENTS**: `ReadonlySet`\<`string`\>

Recognized segments retained (passed through) by the HL7 v2 de-identifier. Anything not on this list,
and not a mapped PID-family segment or OBX/NTE: fails closed.

#### Example

```ts
import { RETAIN_SEGMENTS } from "@cosyte/deid/hl7";

RETAIN_SEGMENTS.has("OBR"); // => true  (clinical order, retained)
RETAIN_SEGMENTS.has("MRG"); // => false (prior patient identity, fails closed)
```

***

### RETAINED\_LOCUS\_RULES

> `const` **RETAINED\_LOCUS\_RULES**: `Readonly`\<`Record`\<`string`, readonly [`Hl7RetainedFieldRule`](#hl7retainedfieldrule)[]\>\>

The **carve-out table**: for each retained segment, the fields that are identifying rather than
clinical. Every position is grounded in the HL7 v2.x segment definitions.

The dates are elements of dates directly related to the individual, which §164.514(b)(2)(i)(C)
removes (admission and discharge are named in the regulation text itself); the visit number and the
placer / filler order numbers are unique identifying codes, which §164.514(b)(2)(i)(R) removes. Both
groups are absent from §164.514(e)(2)'s sixteen direct identifiers, so a limited data set may keep
them, which is what the retention classes express.

#### Example

```ts
import { RETAINED_LOCUS_RULES } from "@cosyte/deid/hl7";

RETAINED_LOCUS_RULES.PV1?.find((r) => r.field === 44)?.retention; // => "encounter-dates"
```

## Functions

### applyHl7()

> **applyHl7**(`original`, `transformed`, `coords`): `Hl7Message`

Write the engine's transformed loci back onto a clone of `original` and return a fresh
Hl7Message. `transformed` and `coords` are index-aligned (both preserve extraction order).

#### Parameters

##### original

`Hl7Message`

The parsed message to de-identify (never mutated).

##### transformed

readonly [`TransformedLocus`](../deid.md#transformedlocus)[]

The engine's transformed loci, in extraction order.

##### coords

readonly [`Hl7Coord`](#hl7coord)[]

The write-back coordinates, index-aligned with `transformed`.

#### Returns

`Hl7Message`

A new, independent de-identified Hl7Message.

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
import { extractHl7Loci, applyHl7 } from "@cosyte/deid/hl7";
import { deidentify } from "@cosyte/deid";

const msg = parseHL7(raw);
const { loci, coords } = extractHl7Loci(msg);
const { document } = deidentify({ loci }, { context });
const clean = applyHl7(msg, document.loci, coords);
clean.toString(); // spec-clean, de-identified HL7
```

***

### categoryForIdentifierType()

> **categoryForIdentifierType**(`typeCode`, `fallback`): [`SafeHarborCategory`](../deid.md#safeharborcategory)

Resolve a Safe Harbor category from an HL7 CX-5 identifier-type code (HL7 Table 0203), for a `id`
field mapped with `routeByTypeCode`. Unrecognized or absent codes fall back to `fallback`.

#### Parameters

##### typeCode

`string` \| `undefined`

The CX-5 identifier type code (e.g. `"MR"`, `"SS"`, `"AN"`).

##### fallback

[`SafeHarborCategory`](../deid.md#safeharborcategory)

The category to use when the code is unrecognized or absent.

#### Returns

[`SafeHarborCategory`](../deid.md#safeharborcategory)

The resolved Safe Harbor category.

#### Example

```ts
import { categoryForIdentifierType, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid/hl7";

categoryForIdentifierType("SS", SAFE_HARBOR_CATEGORIES.MRN); // => "SSN"
```

***

### deidentifyHl7()

> **deidentifyHl7**(`msg`, `options?`): [`Hl7DeidResult`](#hl7deidresult)

De-identify a parsed HL7 v2 message under a policy (Safe Harbor by default). PHI is located
structurally from the `@cosyte/hl7` model; the input message is never mutated.

The output is **"Safe-Harbor-transformed per the configured policy"**: it is not certified
de-identified, and Expert Determination is not rendered.

#### Parameters

##### msg

`Hl7Message`

The parsed HL7 v2 message to de-identify.

##### options?

[`DeidOptions`](../deid.md#deidoptions) = `{}`

The policy, the profile's retention classes, and (for keyed transforms, MRN /
  account / beneficiary pseudonymization) the key context. A keyed transform with no context is a
  fatal `DEID_NO_KEY`, never an unkeyed fallback. **Retention defaults to nothing**, so a bare
  options bag removes the encounter dates and identifiers rather than keeping them.

#### Returns

[`Hl7DeidResult`](#hl7deidresult)

The de-identified message and the value-free manifest.

#### Throws

DeidError `DEID_NO_KEY` when a keyed transform is required for a category present in
  the message but no key context was supplied.

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
import { deidentifyHl7 } from "@cosyte/deid/hl7";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { document, manifest } = deidentifyHl7(parseHL7(raw), { context });
// document.get("PID.5.1") === undefined  (name removed)
// manifest records each category + locus, never a value.
```

***

### extractHl7Loci()

> **extractHl7Loci**(`msg`, `options?`): [`Hl7Extraction`](#hl7extraction)

Walk a parsed HL7 v2 message and extract every PHI-bearing (or fail-closed) locus, structurally, from
the `@cosyte/hl7` model. Never mutates the message.

Every segment is also **enumerated**: the value-bearing positions it hands through that no rule above
named are counted and located as unexamined residuals, so such a position is measured rather than
passing through in silence. Nothing is transformed on account of that measurement, and a structure
whose positions cannot be enumerated fails the pass rather than contributing a zero.

#### Parameters

##### msg

`Hl7Message`

The parsed HL7 v2 message.

##### options?

[`Hl7ExtractOptions`](#hl7extractoptions) = `{}`

The configured profile's retention classes. Omitted retains nothing (fail closed).

#### Returns

[`Hl7Extraction`](#hl7extraction)

The loci (for the engine), their index-aligned write-back coordinates, and the unexamined
  residual positions the pass hands through.

#### Throws

DeidError `DEID_POSITIONS_UNENUMERABLE` when a segment's value-bearing positions
  cannot be enumerated: the pass fails rather than emit a zero or a partial count.

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
import { extractHl7Loci } from "@cosyte/deid/hl7";

const { loci } = extractHl7Loci(parseHL7(raw));
loci.length; // number of located candidate values
```

## References

### isRetainableZipCode

Re-exports [isRetainableZipCode](../deid.md#isretainablezipcode)

***

### LIMITED\_DATA\_SET\_ADDRESS\_PARTS

Re-exports [LIMITED_DATA_SET_ADDRESS_PARTS](../deid.md#limited_data_set_address_parts)

***

### RETAINED\_LOCUS\_CLASSES

Re-exports [RETAINED_LOCUS_CLASSES](../deid.md#retained_locus_classes)

***

### RetainedLocusClass

Re-exports [RetainedLocusClass](../deid.md#retainedlocusclass)

***

### RetainedLocusPart

Re-exports [RetainedLocusPart](../deid.md#retainedlocuspart)

***

### retains

Re-exports [retains](../deid.md#retains)

***

### SAFE\_HARBOR\_CATEGORIES

Re-exports [SAFE_HARBOR_CATEGORIES](../deid.md#safe_harbor_categories)

***

### SafeHarborCategory

Re-exports [SafeHarborCategory](../deid.md#safeharborcategory)

***

### UnexaminedResidual

Re-exports [UnexaminedResidual](../deid.md#unexaminedresidual)
