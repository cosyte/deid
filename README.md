<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="Cosyte: a plus mark set in two overlapping rounded squares, one solid and one outlined, beside the Cosyte wordmark" src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/deid

> Healthcare **de-identification** for Node.js and TypeScript: a HIPAA-grounded policy engine that
> **fails closed** and emits a **value-free manifest**.

`@cosyte/deid` applies a de-identification **policy** (HIPAA Safe Harbor by default) to a
structurally-located model of a healthcare document and returns a transformed model plus a value-free
audit of everything it acted on. It is a **consumer** of the `@cosyte/*` parsers, not a parser sibling:
it borrows the archetype's disciplines (typed diagnostics, immutable output, a policy/profile system)
but **inverts the reflex**: where a parser is liberal on input, a de-identifier is conservative and
**fails closed**. Third-party runtime dependencies: **zero** (every primitive is `node:crypto`).

> **The honesty line.** Results are **"Safe-Harbor-transformed per the configured policy"**, never
> "de-identified" and never "HIPAA-compliant". Safe Harbor is implemented mechanically; the
> actual-knowledge condition (§164.514(b)(2)(ii)) is the consumer's; **Expert Determination
> (§164.514(b)(1)) is supported, never rendered or certified.** The certification is
> always the consumer's.

> **Status:** pre-alpha (`0.0.x`), published on npm. This release ships the **format-agnostic
> core** plus six format bindings: the **HL7 v2 adapter** (`@cosyte/deid/hl7`), the **C-CDA adapter**
> (`@cosyte/deid/ccda`), the **FHIR R4 adapter** (`@cosyte/deid/fhir`), the **X12 EDI adapter**
> (`@cosyte/deid/x12`), the **NCPDP Telecom adapter** (`@cosyte/deid/ncpdp`), and the **DICOM adapter**
> (`@cosyte/deid/dicom`), plus the **longitudinal layer**, the corpus registry (`createDeidRegistry`)
> for cross-document consistency and the formalized key contract, and the **Expert-Determination support
> report** (`buildExpertDeterminationSupportReport`) that structures the manifest for a statistician
> **without ever rendering a determination**. NCPDP SCRIPT is **not** supported, and an entry point
> handed one refuses it outright rather than returning a partial pass.

## Install

```bash
npm install @cosyte/deid
```

## De-identify

```ts
import { deidentify, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const { document, manifest } = deidentify(
  {
    loci: [
      { path: "PID-5", kind: "identifier", category: SAFE_HARBOR_CATEGORIES.NAMES, value: name },
      { path: "PID-7", kind: "date", category: SAFE_HARBOR_CATEGORIES.DATES, value: dob },
      { path: "OBX-5", kind: "clinical", value: "5.4 mmol/L" },
    ],
  },
  {},
);

// document.loci[0].value === null   (name removed)
// document.loci[1].value === "<year>" (date generalized)
// document.loci[2].value === "5.4 mmol/L" (clinical value retained, the over-scrub guard)
// manifest records each category + locus + disposition, never a value.
```

## Keyed transforms

Pseudonymization and keyed hashing use a **keyed HMAC-SHA-256**; the key is the consumer's and never
leaves the process. The **built-in Safe Harbor policy uses none of them**: a surrogate derived from
the individual's own value is a re-identification code §164.514(c)(1) does not permit, so medical
record, health plan beneficiary and account numbers are **removed** and the profile needs **no key at
all**. Keyed surrogates live behind a preset that does not claim Safe Harbor:

```ts
import {
  deidentify,
  createDeidContext,
  profileOptions,
  LIMITED_DATA_SET_PROFILE,
} from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY!, patientId: "patient-1" });
deidentify(model, profileOptions(LIMITED_DATA_SET_PROFILE, context));
// Under THAT preset the MRN becomes a consistent, non-reversible surrogate; the key never appears in
// the output or manifest, the locus carries `reidentificationCode: true`, and the support report
// lists it in the keyed-surrogate residual inventory an expert must reason about.
```

A policy carrying the `safe-harbor` label that assigns a category a transform whose output is
**derived from that category's own value** is refused with a typed `DEID_POLICY_INVALID` fatal naming
the category and the transform, at mint time and at the point of use alike. A policy that does not
claim the label keeps its keyed surrogate: nothing is silently strengthened behind the caller's back.

## De-identify an HL7 v2 message

The `@cosyte/deid/hl7` adapter locates PHI **structurally** in the parsed [`@cosyte/hl7`](https://github.com/cosyte/hl7)
model, never by regex over the raw bytes, and returns a transformed `Hl7Message` plus the value-free
manifest. `@cosyte/hl7` is an **optional peer dependency**: install it alongside `@cosyte/deid` to use
this subpath; the core stays dependency-free.

```bash
npm install @cosyte/deid @cosyte/hl7
```

```ts
import { parseHL7 } from "@cosyte/hl7";
import { deidentifyHl7 } from "@cosyte/deid/hl7";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { document, manifest } = deidentifyHl7(parseHL7(rawMessage), { context });

document.toString(); // spec-clean, de-identified HL7 wire
// PID-5 (name), NK1/GT1/IN1/IN2 relatives, SSN, phone, MRN and account → removed;
// DOB → year; address → safe 3-digit ZIP. OBX-5/NTE free text and Z-segments fail closed (blocked).
// Admit/discharge/observation/diagnosis dates → year; visit and order numbers blocked as (R).
// Structured clinical OBX values, units, codes, and statuses survive untouched.
```

**What it covers.** The structured PHI loci of **PID** (patient) and **NK1 / GT1 / IN1 / IN2**
(relatives / guarantor / insured), typed by the `@cosyte/hl7` model. **Fail closed** everywhere else: a
recognized segment is retained **only** if it is on an explicit clinical/administrative retain-list,
so a known patient-identity segment absent from the map (e.g. **MRG** prior name + MRN on a merge, **FAM**,
**ACC**) is blocked, never passed through, and Z-segments / structure unknown to the parser are blocked.
**OBX-5** is retained only when OBX-2 positively types it as a structured clinical value (numeric /
coded / a time of day); narrative (`TX`/`FT`), ambiguous String (`ST`), and any empty/unknown OBX-2 fail
closed, as do **NTE-3** comments, and a **date/time** value type makes OBX-5 a date the pass acts on.
Structured clinical values, units, codes, and statuses survive untouched.

**The individual's employer is a Safe Harbor subject, not an unrelated organisation.**
§164.514(b)(2)(i) removes the identifiers of the individual "or of relatives, **employers**, or
household members", so the employer positions the v2.5.1 financial segments type are acted on and
recorded like any other mapped locus: the guarantor's employer name (**GT1-16**), address
(**GT1-17**, reduced to the safe 3-digit ZIP) and phone (**GT1-18**); the guarantor employee and
employer identification numbers (**GT1-19**, **GT1-29**); the insured's group employer id and name
(**IN1-10**, **IN1-11**); the insured's employer name (**IN2-3**); the employer contact person's name
and phone (**IN2-49**, **IN2-50**); and the insured's employer phone (**IN2-64**). **IN2-70** types an
_organisation_ rather than a value, so it goes through the same party-role test the X12 adapter applies
to an `NM1` / `N1` party and **fails closed**: an employer is never outside the scope clause, so the
organisation's name and its identifier both go. The mirror control holds: the coded employment status
(**GT1-20**) and the _insurer's own_ company id, name, address and phone (**IN1-3/4/5/7**) are
untouched, because none of them is the individual's, a relative's or an employer's identity.

**Inside a retained segment**, the identifying loci are carved back out: under a Safe-Harbor-labelled
policy the admit (PV1-44), discharge (PV1-45), observation (OBR-7) and diagnosis (DG1-5) dates keep only
their **year**, and the visit number (PV1-19) with the placer and filler order numbers (OBR-2/3, ORC-2/3)
are **removed**. A profile that names their retention class, as the limited-data-set preset does, keeps
them **unchanged and recorded**. PV1-19 is a CX list routed by its CX-5 identifier-type code, like PID-3:
only a `VN`-typed or untyped visit number is the encounter identifier, while an `MR`/`AN`/`SS`-typed one
is transformed as the medical record / account / social security number it is, under **both** profiles.

**The postal-address allowance of §164.514(e)(2)(ii)** is the one place a profile can ask this adapter
to keep _more_ geography than the safe 3-digit ZIP. That clause removes "postal address information,
**other than town or city, State, and zip code**", which makes it the only **partial** exclusion in the
limited data set's list of sixteen. A profile naming the `limited-data-set-geography` retention class,
as the limited-data-set preset does, keeps the **town or city** (XAD.3), the **State** (XAD.4) and the
**whole zip code** (XAD.5) of every mapped address (**PID-11**, **NK1-4**, **NK1-32**, **GT1-5**,
**GT1-17**, **IN1-19**), each recorded as a `DEID_RESIDUAL_RETAINED` residual at its own component, and
drops the street address along with every other geographic component: the county or parish, the census
tract, the country. The county-code field (**PID-12**) and the birth place (**PID-23**) are removed
under every profile, because the clause names neither. The three-digit / `000` rule is
§164.514(b)(2)(i)(B), **Safe Harbor's**, so a restricted-prefix ZIP is kept in full under this class and
is still suppressed under Safe Harbor. **Nothing widens by omission**: without the class an address is
reduced exactly as it always was, and an address whose zip code is not a whole zip code falls back to
that generalization, which drops the whole address rather than keeping part of it. This adapter is the
**only** one that reads retention classes; under C-CDA, FHIR, X12, NCPDP and DICOM an address is reduced
exactly as Safe Harbor reduces it.

**Every other date inside a segment the pass hands through** is acted on and recorded too: every
position the HL7 **v2.5.1** segment definitions type as a date or date/time, at its own unit (a field, a
component of a composite, one repetition at a time), plus an OBX-5 the message types as a date. That
reaches ORC-9 and ORC-15, the EVN / PV2 / PR1 / RXA / RXD / FT1 / TXA / SPM timestamps, the date
components of a range or other composite, and the **OBX segment's own** reference-range, observation and
analysis timestamps (OBX-12 / OBX-14 / OBX-19), which survive the value-type branch that decides OBX-5.
The classification is structural and version-fixed: an eight-digit numeric result is not a date, and
`MSH-12` moves no position.

**Known limitations (this release).** Free text is block-by-default (no built-in scrub; opt-in BYO
redaction: see [Free text](#free-text-block-by-default--byo-redaction)); every **non-date** field of a
retained segment that the carve-outs do not name is **not** de-identified, which still includes the
_provider_ names in PV1-7/8 and OBR-16, the guarantor's employer organisation name at GT1-51, and the
date components carried inside a person-name or address composite; a position only a version other than
v2.5.1 types as a date is a stated residual; the address generalization keeps only the Safe Harbor
3-digit ZIP, unless the profile names the §164.514(e)(2)(ii) geographic retention class described
above.

**Those positions are now counted and located, which is a different thing from being cleaned.** Every
value-bearing position a pass hands through that no locus rule names is recorded as an **unexamined
residual** on `result.unexaminedResiduals`, with its structural locus, a count and the fact that nothing
examined it, and never a value. Hand that list to the support report alongside the manifest and the
report says how many there were; hand it an empty list and the report says the inventory was **measured
and empty**, which reads differently from a pass that measured nothing at all.

**Counting is not removal, and an unexamined position is not an allegation.** Nothing is scrubbed,
generalized or blocked on account of the count, and a position no rule examined has no established Safe
Harbor category, so it joins none of the 18 and moves no category total. A clinical code, a dose unit and
an order status all sit at positions like these. The two fail-safes are worth knowing: a position whose
locus cannot be expressed is still counted, under a withheld locus token, and a structure whose positions
cannot be enumerated **fails the pass** rather than contribute a zero a reader would take for a
clearance.

**What counts as a position is derived from what each parser's model can carry**, not from the places a
value usually sits, so the enumeration reaches the easily-overlooked ones: XML character data delivered
as a CDATA section rather than as text, the comments and processing instructions a document is
re-serialized with, a FHIR primitive's `_`-sibling element id, and whatever a partly rewritten structure
keeps (the state and country of a generalized address travel exactly as they arrived, with anything
riding inside them). Conversely a position the pass _removes_ is not counted: the number measures what
left the pass untouched. [Limitations](./docs-content/limitations.md) states the count's two edges.

**Employer surfaces that remain residual, in every format.** Two, named so a consumer can tell a
covered surface from an uncovered one. **An employer named only in free text** (an OBX-5 narrative, an
NTE comment, a C-CDA section `<text>`, a FHIR `note`) is reached only by an opt-in BYO redactor, never
by this library. And **an employer carried as a separate organisation resource in a FHIR graph** is not
reached either: in FHIR an employer arrives as a `Reference` (whose `display` is already blocked) to a
standalone `Organization` whose `name` the map retains as administrative data, so classifying it would
be a cross-resource role derivation rather than a typed position. The employer positions above are the
covered ones: they are typed at the position by X12 and by HL7 v2, which is what makes them decidable.

## De-identify a C-CDA document

The `@cosyte/deid/ccda` adapter locates PHI **structurally** in a parsed [`@cosyte/ccda`](https://github.com/cosyte/ccda)
document (a `<name>` under `recordTarget/patientRole/patient` is the patient's name because the CDA
standard says so), and returns a transformed `CcdaDocument` plus the value-free manifest. `@cosyte/ccda`
is an **optional peer dependency**; the adapter reaches the CDA DOM only through its hardened
`parseSecureXml` and re-serializes the node it hands back, so the core stays third-party-dependency-free.

```bash
npm install @cosyte/deid @cosyte/ccda
```

```ts
import { parseCcda } from "@cosyte/ccda";
import { deidentifyCcda } from "@cosyte/deid/ccda";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { document, manifest } = deidentifyCcda(parseCcda(xml), { context });

document.toString(); // spec-clean, de-identified C-CDA XML
// recordTarget/guardian/author/informant/custodian names, telecom, ids, addresses, birthTime, and
// participation/encounter dates → transformed; section narrative <text> and unknown elements fail
// closed. Coded clinical entries (codes, values, units, statuses, dosing periods) survive untouched.
```

**What it covers.** The structured PHI loci of the CDA **header participations**: `recordTarget`
(patient) + nested `guardian`, and `author` / `dataEnterer` / `informant` / `authenticator` /
`legalAuthenticator` / `participant` / `custodian` / `documentationOf` / `componentOf` (relatives /
providers / contacts). Person `<name>` / `<telecom>` removed; person-role `<id>` removed under Safe
Harbor, assigning root retained (a consistent surrogate only under a preset that does not claim the
label); `<addr>` reduced to the safe 3-digit ZIP; `<birthTime>` and
participation / encounter dates generalized to year. **Fail closed** everywhere else: section narrative
`<text>` blocks and the unstructured `nonXMLBody` are blocked; a value-bearing element that is neither
mapped PHI nor recognized coded structure is blocked; foreign / `sdtc` elements are blocked. The clinical
`structuredBody` entries are **retained untouched** (the over-scrub guard): a `<name>` there is a drug
or material name, not a person.

**Known limitations (this release).** Narrative is block-by-default (no built-in scrub; opt-in BYO
redaction: see [Free text](#free-text-block-by-default--byo-redaction)); within the **retained**
clinical body, entry service _dates_, entry _ids_, in-entry _performer_ names, and _family-history_
relative demographics are **not** de-identified (mirroring the HL7 adapter's boundary); the document
`id`/`code`/`title` envelope is retained (like HL7's MSH).

## De-identify a FHIR R4 resource

The `@cosyte/deid/fhir` adapter locates PHI **structurally** in a parsed [`@cosyte/fhir`](https://github.com/cosyte/fhir)
resource (a `name` under a `Patient` is the patient's name because FHIR says so), and returns a
transformed resource model plus the value-free manifest. `@cosyte/fhir` is an **optional peer
dependency**; the adapter reaches FHIR data only through its exported model and `parseResource` /
`serializeResource` codec, so the core stays third-party-dependency-free.

```bash
npm install @cosyte/deid @cosyte/fhir
```

```ts
import { parseResource, serializeResource } from "@cosyte/fhir";
import { deidentifyFhir } from "@cosyte/deid/fhir";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { resource } = parseResource(json);
const { document, manifest } = deidentifyFhir(resource, { context });

serializeResource(document); // spec-clean, de-identified FHIR JSON
// Patient/RelatedPerson/Practitioner/Person names, telecom, photo → removed; address → safe 3-digit ZIP;
// birthDate + every date → year; identifiers removed under Safe Harbor (surrogated by system only
// under a preset that does not claim the label).
// Narrative text.div, extension values, and Reference.display fail closed; contained resources and
// Bundle entries are walked. Clinical resources (Observation values, codes, units, statuses) survive.
// Outside a person resource a HumanName or an Address is acted on wherever it sits,
// Organization.contact.name and Location.address included: the element's datatype decides.
```

FHIR is a **graph of typed resources**, so the map splits by role:

| Scope                                                                                                     | Loci                                                                                                                                      | Transform                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Person resources** (`Patient` / `RelatedPerson` / `Practitioner` / `Person` + nested `Patient.contact`) | `name`, `telecom`, `photo`, `address`, `birthDate`, dates                                                                                 | name/telecom/photo **removed**; `address` → safe **3-digit ZIP** (or `000`); dates → **year**                                                                                                       |
| **Every resource, by DATATYPE**                                                                           | any `HumanName`, any `Address` (`Organization.contact.name`, `Location.address`, `Organization.address`, a choice-type `locationAddress`) | name **removed**; address → the same safe **3-digit ZIP** (or `000`) a person resource's address gets                                                                                               |
| **Every resource (universal PHI vectors)**                                                                | `identifier`, dates, narrative `text.div`, `extension` values, `Reference.display`                                                        | identifier **removed** under Safe Harbor (a surrogate by `system` only under a preset that does not claim the label); dates → **year**; narrative / extension values / reference labels **blocked** |
| **Clinical resources** (`Observation`, `Condition`, …)                                                    | codes, values, units, statuses, reference wiring                                                                                          | **retained untouched** (the over-scrub guard)                                                                                                                                                       |

A `Reference.display` (a person label) is blocked; a `Coding.display` (a coded term like `Sodium`) is
retained: the two are told apart structurally. Contained resources and `Bundle` entries are walked, with
each resource's role re-derived at its own `resourceType`.

**Why the datatype and not the resource type.** Which resource carries a person's name is a choice the
producing system made: the same home address arrives at `Patient.address` from one sender and at
`Location.address` from a home-health sender. A rule keyed on the enclosing resource therefore hands you
coverage that depends on that choice. Positive classification is **closed**: an element is a `HumanName`
only when every property it carries is one R4 defines on `HumanName`, **and** at least one of them
(`family` / `given` / `prefix` / `suffix`) belongs to nothing else, **and** that one holds the value
shape R4 gives it (a string, or a list of strings). An `Address` the same way
(`line` / `city` / `district` / `state` / `postalCode` / `country`). All three halves earn their place:
they keep the wider sweep off an **organisation's own `name`** (a plain string, never a `HumanName`),
off a `CodeableConcept` carrying only its `text`, off a conformant `Questionnaire.item` (whose `prefix`
is a `HumanName` marker name), off the several R4 elements called `country` that are coded concepts
rather than the string `Address.country` is, and off every clinical code, value, unit and status.

**Fail closed** governs the person sweep and the frontier: a bare unrecognized string at a person
resource's top level is blocked (an allow-list can never satisfy Safe Harbor category (R)); a `display`
that is not on a `Coding` is treated as a Reference person-label and blocked, including a display-only
(`{ display }`) or type+display reference that names no target; every extension value (a complex
`valueAddress` / `valueHumanName`, a `modifierExtension`, a nested extension, or a primitive-level
`_`-sibling extension) is dropped; and free-text loci (`note` Annotations, `contentString`, an uncoded
`valueString`) are blocked (the FHIR analogue of the HL7 adapter's OBX-5-`ST` / NTE fail-closed default).

**Fail closed on a newly reached element too.** A swept `Address` this pass cannot read faithfully is
removed **whole** rather than partly retained: a `postalCode` that is not a whole zip code (a
four-digit `0110` still has three leading digits, and generalizing it would keep a fragment of
something that was never a ZIP), or an unexpected JSON shape at a part Safe Harbor would let it keep,
takes the street, the city, the state, the country and the ZIP with it, and the disposition is
recorded. At an element name R4 **types** as one of the two datatypes - `name`, `address`, the
choice-type `locationAddress`, an open `valueAddress` / `valueHumanName` - **any** complex the
classifier cannot pin down is blocked whole rather than descended into: a `{ text }` or
`{ use, text }` representation with no part to key on, a `{ family, given, … }` carrying some property
R4 does not define, and equally a `{ streetAddress, town, zip }` whose every property is foreign to
both datatypes. The standard promised a name or an address there and the pass could not read the one
it was given, so the boundary is readability rather than which keys happen to be present: adding an
unrecognized sibling to an element that was already unreadable never unblocks it. Exactly two
conformant R4 backbones share one of those element names - `MedicinalProduct.name` and
`SubstanceSpecification.name` - and both are excluded positively, by the property R4 makes `1..1` on
each together with that backbone's own closed property set. A plain string at one of those names is
not a complex and is never a candidate, which is what leaves `Organization.name` and
`Endpoint.address` untouched. The disposition is recorded either way. That block is scoped to those
positions on purpose; the residual it leaves is stated below.

**Known limitations (this release).** Extension values are block-only (no profile-aware retention, a
`us-core-*` demographic extension is dropped). Reference
_wiring_ (`Reference.reference` pointers, resource logical `id`s) is preserved structurally; coordinated
pseudonymization of resource ids across a corpus is **not** performed. Free-text **prose** loci
(`note`, `contentString`, uncoded `valueString`) fail closed by default, or run through an opt-in BYO
redactor (see [Free text](#free-text-block-by-default--byo-redaction)); a **built-in** semantic (NLP)
narrative scrub and `contentAttachment` binary content remain out of scope for this release.

Five residual surfaces, the first three because FHIR types no person at the position:

- **A `ContactPoint` outside a person resource.** A phone or an email on an `Organization`, a
  `Location` or an `Endpoint` is passed through. Widening to telecom here would put a payer's or a
  facility's own switchboard number in scope, which the HL7 v2 adapter deliberately keeps (`IN1-7`,
  the insurer's own phone, is untouched there).
- **An organisation's own `name`.** It is a plain string, not a `HumanName`, so no datatype rule
  reaches it, and it is administrative content rather than a person's identity.
- **The individual's employer carried as a separate `Organization` resource.** Unlike X12 and HL7 v2,
  FHIR types no employer role at the position, so reaching it would be a cross-resource role
  derivation rather than a typed read. The `Reference.display` that names it is blocked either way.
- **A name or an address carrying a property R4 does not define, at an element name R4 does not type
  as one of the two datatypes.** Positive classification is closed, so an unrecognized sibling stops
  it, and the fail-closed block above is scoped to the typed element names. At any other name the same
  evidence is routinely something else - `{ prefix, linkId, text, type }` is a conformant
  `Questionnaire.item`, not a person - and blocking it would destroy conformant clinical and
  structural content that no re-run restores. Such a value is passed through and counted as an
  unexamined residual position, like anything else no rule names.
- **A name or an address INSIDE a person resource, at a property the demographic map does not list.**
  The datatype sweep runs outside a person resource only, because inside one the map above has already
  decided `name`, `telecom`, `photo` and `address`. A vendor `Patient.alias` carrying
  `{ family, given }` is therefore passed through, where the same bytes on an `Organization` are
  removed. Counted as unexamined like the rest.

## De-identify an X12 EDI interchange

The `@cosyte/deid/x12` adapter locates PHI **structurally** in a parsed [`@cosyte/x12`](https://github.com/cosyte/x12)
interchange (HIPAA 005010: 837 claims, 835 remittance, 270/271 eligibility, …). `@cosyte/x12` is an
**optional peer dependency**; the adapter reaches EDI data only through its exported model and re-emits
with its byte-faithful `serializeX12`.

```ts
import { parseX12 } from "@cosyte/x12";
import { deidentifyX12 } from "@cosyte/deid/x12";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { x12, manifest } = deidentifyX12(parseX12(raw), { context });
// `x12` is the de-identified interchange; `manifest` is the value-free audit.
```

| Locus                                                        | Handling                                                                                                                                                     |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`NM1`** (subscriber / patient / dependent)                 | name (`03–07`) **removed**; id (`09`) routed by the `08` qualifier: SSN **removed**, member **removed** under Safe Harbor                                    |
| **`NM1` / `N1`** (employer, entity code `36`)                | name + id **removed** on the same footing as a patient-side party: §164.514(b)(2)(i) names the individual's **employers**                                    |
| **`NM1`** (recognized provider / organization)               | **retained** (provider identity is not the individual's PHI, mirroring the HL7 adapter), and the **role code** it was classified on is recorded at its locus |
| **`NM1`** (unknown entity code)                              | **fails closed**: name + id blocked                                                                                                                          |
| **`N1` / `SBR`**                                             | `N1` payer/provider org retained (patient-side/unknown party fails closed); `SBR-03` group/policy **removed** under Safe Harbor, `SBR-04` group name removed |
| **`N3` / `N4`**                                              | street + city **removed**, ZIP → safe 3-digit, state retained (unmapped `N4-06` location id fails closed)                                                    |
| **`DMG-02`**, **`DTP-03`**, **`DTM-02`**                     | dates → **year**                                                                                                                                             |
| **`PER`**                                                    | contact name + communication numbers **removed**                                                                                                             |
| **`REF`**                                                    | patient / member / group / SSN identifier **removed** under Safe Harbor; admin/provider reference retained; **unknown qualifier fails closed**               |
| **`CLM-01` / `CLP-01`**                                      | patient account number **removed** under Safe Harbor (pseudonymized only under a preset that does not claim it)                                              |
| **Clinical / financial** (`HI`, `SV*`, `SVC`, `AMT`, `CAS`…) | **retained untouched**: diagnosis / procedure codes, amounts, quantities survive byte-identical                                                              |

## De-identify an NCPDP Telecom transaction

The `@cosyte/deid/ncpdp` adapter locates PHI **structurally** in a parsed [`@cosyte/ncpdp`](https://github.com/cosyte/ncpdp)
Telecommunication (vD.0) transaction. `@cosyte/ncpdp` is an **optional peer dependency**.

```ts
import { parseTelecom } from "@cosyte/ncpdp/telecom";
import { deidentifyTelecom } from "@cosyte/deid/ncpdp";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { telecom, manifest } = deidentifyTelecom(parseTelecom(raw), { context });
```

The Patient (`01`), Insurance (`04`), and Coordination-of-Benefits (`05`) segments and the header Date of
Service carry the individual's identity: name / phone / street / city **removed**, ZIP → 3-digit, DOB and
dates → year, patient / cardholder / group ids **removed** under Safe Harbor. The Prescriber (`03`) id is **removed**
(a deliberate asymmetry with the X12 adapter's provider-retention stance). A free-text field
(`544-FY` DUR, `504-F4` message) and any unmapped / unknown segment **fail closed**; the clinical /
financial segments (NDC drug codes, quantities, days-supply, pricing, DUR codes) are retained untouched.

**NCPDP SCRIPT (ePrescribing XML) is REFUSED, not half-handled**: its parser's `serializeScript` emits
only modeled fields (a round-trip drops unmodeled XML) and its `Patient` model has no address / phone /
patient-id field, so a faithful structural de-id is not achievable through the current public surface,
and shipping a partial pass would be a false-safety hazard the fail-closed posture forbids. Hand a
SCRIPT document to either NCPDP entry point and you get a typed `DEID_FORMAT_UNSUPPORTED` error naming
the format and the parser-surface reason, and **no** transformed document, manifest or partial output
of any kind, rather than whatever the Telecom parser would have made of those bytes. Telecom callers
are unaffected.

## De-identify a DICOM study

The `@cosyte/deid/dicom` adapter **delegates rather than reimplements**: [`@cosyte/dicom`](https://github.com/cosyte/dicom)
already ships the **PS3.15 Annex E** de-identification (the Basic Application Level Confidentiality
Profile), so this adapter orchestrates that pass under the unified policy and folds its value-free report
into the unified manifest. `@cosyte/dicom` is an **optional peer dependency**.

```ts
import { parseDicom } from "@cosyte/dicom";
import { deidentifyDicom, deidentifyDicomBuffer } from "@cosyte/deid/dicom";

const { dataset, manifest, burnedInAnnotationHazard } = deidentifyDicom(parseDicom(part10Bytes));
const { bytes } = deidentifyDicomBuffer(part10Bytes); // parse → de-id → re-serialize in one call
```

The full Basic Profile applies by default (no key needed): Patient Name/ID/Birth Date, institution,
referring physician, dates and the enumerated Annex E attributes are **removed**; Study / Series / SOP
Instance UIDs are **consistently remapped** so image/series/study relationships survive; **private tags are
removed** (fail-closed, kept only via a known-safe retain list, empty by default); clinical/technical
values and pixel bytes are **retained untouched**. The output carries `Patient Identity Removed = YES`.

**The declaration is machine-readable, not only prose.** Beside the De-identification Method text at
`(0012,0063)`, the pass writes the **CID 7050** coded terms for the profile and for every option it
applied into **De-identification Method Code Sequence `(0012,0064)`**, so a receiving archive branches on
a code rather than parsing a sentence. Every option it **withheld** is declared by its coded term on the
result (`optionDeclarations`) and never in that sequence, because a term there means "used". A profile or
option the vocabulary cannot name, or a declaration the run cannot read back out of its own serialized
bytes, aborts the pass rather than publishing an approximate claim. A sequence the **input** carried is
dropped, with a value-free warning: no de-identification rule inspects its contents, so none of it may
ride inside output stamped `Patient Identity Removed = YES`.

**Replacement-UID referential integrity is scoped, and the scope is on the result.** With no shared
`uidMap` it is guaranteed **only within the single call** (`uidReferentialIntegrity.scope` is
`"single-call"`); supply one and it reaches every call that shares it.

**Pixel PHI is flagged, never cleaned.** This is a **metadata-only** de-identifier (`metadataOnly` is
always `true`): it cannot inspect pixels, so recognizable text **burned into the image** (Safe Harbor
category Q) is not removed. When Pixel Data may carry burned-in annotation, the result sets
`burnedInAnnotationHazard === true` and emits `DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED`: do **not** release
such an image on metadata alone. Pixel cleaning is a future `@cosyte/dicom-pixel`.

## Keep a longitudinal record linkable

For research and analytics, the same patient must stay linkable across a whole corpus after de-id. A
**registry** (`createDeidRegistry`) holds your key and keeps the same patient's dates shifting by the
same offset, intervals preserved, and the same identifier mapping to the same pseudonym, across every
document and every run.

```ts
import {
  createDeidRegistry,
  deidentify,
  defineDeidPolicy,
  SAFE_HARBOR_CATEGORIES,
} from "@cosyte/deid";

const registry = createDeidRegistry({ key: process.env.DEID_KEY! });
const research = defineDeidPolicy({
  name: "research", // date-shift may NOT wear the "safe-harbor" label, it is Expert-Determination
  transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
});

const ctx = registry.forPatient("patient-1"); // reuse for every document of this patient
deidentify(model, { policy: research, context: ctx }); // dates shift consistently, intervals intact
registry.pseudonym("MRN-1"); // same MRN → same surrogate corpus-wide
```

**The key contract.** You supply the key; there is **no weak default** (an absent key is a fatal
`DEID_NO_KEY`, never a silent fallback). Rotating the key is **intentional linkage breakage**: a new
key un-links a corpus from records made under the old one. The library holds no persistent key store.
Date-shift retains dates in shifted form, and a keyed surrogate is derived from the individual's own
value, so both are Expert-Determination-supporting, **not** Safe Harbor. The library rejects any
policy claiming the `safe-harbor` label that carries either (`DEID_POLICY_INVALID`), naming the
offending category and transform.

## Free text: block-by-default + BYO redaction

Narrative loci (HL7 `OBX-5` / `NTE`, C-CDA section `<text>`, FHIR `note` / `div`, X12 `MSG` / `NTE`,
NCPDP free text) can carry any of the 18 categories in prose, with no structural handle on where. The
default is **fail-closed**: with no redactor, every free-text locus is **blocked** (value withheld). The
library ships **no** NLP model and **no** built-in regex scrub: a naive pass over clinical prose is a
false-safety hazard.

To redact free text rather than block it, **bring your own redactor**: a function wrapping your regex /
pattern engine or clinical-NER de-id model. The engine invokes it at each free-text locus and writes its
output back in place, recording the locus as **consumer-asserted** (`DEID_FREETEXT_CONSUMER_REDACTED`).

```ts
import { deidentifyHl7 } from "@cosyte/deid/hl7";
import { type FreeTextRedactor } from "@cosyte/deid";

const redactor: FreeTextRedactor = ({ text }) => ({ text: myNerModel.scrub(text) });
const { document } = deidentifyHl7(parseHL7(raw), { context, redactor });
```

**The fail-closed contract holds regardless of the redactor.** No redactor → block; the redactor throws
→ block; the redactor returns nothing → block; the redactor returns `{ text }` → written back in place.
A redactor is never allowed to leak free text through on failure.

**The honesty boundary.** A returned redaction is trusted as consumer-asserted: the engine does **not**
re-scan it for residual PHI, and "no findings" from a BYO redactor is **not** an attestation. A BYO
redactor's completeness is the consumer's responsibility (Expert-Determination territory). The structural
PHI removal the adapters perform, and the clinical over-scrub guard, are **unchanged**: the redactor
handles the free _prose_ only.

## Expert-Determination support, never certification

HIPAA has two routes to de-identification: **Safe Harbor** (mechanical, implemented here) and **Expert
Determination** (§164.514(b)(1), a qualified statistician's risk judgment). `@cosyte/deid` **supports**
the latter and **never renders** it. `buildExpertDeterminationSupportReport(manifest)` structures the
value-free manifest into what an expert reasons about: per-locus dispositions, coverage across all 18
categories, and **two residual inventories**, then hands it over. The
**retained-quasi-identifier inventory** holds pieces of the original value that survived (year-only
dates, safe 3-digit ZIP prefixes, exact ages ≤ 89, and any whole value a profile's retention set
kept). The **keyed-surrogate residual inventory** is its sibling and holds every locus flagged
`reidentificationCode`: a replacement **derived** from the value under your key, where no plaintext
survives but the linkage does. They are kept apart on purpose, because a determiner reasons about the
two very differently.

```ts
import { buildExpertDeterminationSupportReport } from "@cosyte/deid";

const { manifest } = deidentifyHl7(parseHL7(raw), { context });
const report = buildExpertDeterminationSupportReport(manifest, { policy: "safe-harbor" });
report.determination; // => null: the library never renders one
```

**The hard boundary.** The report **never** says the output "is de-identified", **never** computes or
fabricates a re-identification **risk score**, and reaches no conclusion: `determination` is always
`null` and a prominent disclaimer leads. It is value-free (loci / categories / dispositions / counts,
never a value). The one quasi-identifier statistic it can surface (the smallest equivalence-class size,
a **k-anonymity indicator**) is computed **only** over class sizes _you_ supply (the library has no view
of quasi-identifier values) and is stamped a descriptive input, never a verdict.
`formatExpertDeterminationSupportReport(report)` renders the same facts as Markdown for a statistician.

## Policy profiles: reusable presets, widen-never-narrow

Two named presets ship, and `defineDeidProfile()` derives a per-site profile that can only ever
**tighten** the base, never loosen it.

```ts
import {
  SAFE_HARBOR_PROFILE,
  LIMITED_DATA_SET_PROFILE,
  defineDeidProfile,
  profileOptions,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
} from "@cosyte/deid";

// The fail-closed default (dates → year, MRN/beneficiary/account REMOVED, the (R) catch-all blocked).
// It uses no keyed transform, so it needs no key.
SAFE_HARBOR_PROFILE.standard; // => "safe-harbor"

// A longitudinal research preset: dates are DATE-SHIFTED, not generalized, and MRN / beneficiary /
// account keep a CONSISTENT KEYED SURROGATE so linkage survives. It also keeps the postal address
// parts §164.514(e)(2)(ii) NAMES (town or city, State, the WHOLE zip code) under the HL7 v2 pass, with
// the street and every other geographic component removed and each kept part recorded. On DATES it is
// deliberately STRICTER than §164.514(e)(2), which names no date at all: it shifts them by choice.
// Deliberately less protective than Safe Harbor → NOT labelled "safe-harbor", requires a keyed
// per-patient context, and is NOT a certified de-identification (nor, on its own, a §164.514(e)
// Limited Data Set; that needs a Data Use Agreement, which is yours, and which this library neither
// holds nor checks).
LIMITED_DATA_SET_PROFILE.requiresContext; // => true

// A per-site profile may only move a category to an equal-or-STRONGER transform; a weakening override
// is a fatal DEID_PROFILE_INVALID.
const strict = defineDeidProfile({
  name: "site-strict",
  transforms: { [SAFE_HARBOR_CATEGORIES.GEOGRAPHIC]: "redact" }, // generalize → redact (stronger): OK
});

const ctx = createDeidContext({ key: process.env.DEID_KEY! });
const opts = profileOptions(strict, ctx); // pass straight to any adapter
```

## Known limitations & honesty

`@cosyte/deid` **transforms per a policy and evidences what it did: it never certifies**. Read
[`docs-content/limitations.md`](docs-content/limitations.md) before relying on it for anything that
leaves your control: the fail-closed posture, structured-core-only (free text is block-by-default),
**DICOM metadata-only** (burned-in pixels flagged, not cleaned), **NCPDP SCRIPT refused**, the BYO
free-text redactor is the consumer's responsibility, and the Expert-Determination report **makes no
determination**.

## The design in five pieces

- **Policy engine**: `safe-harbor` built in; `defineDeidPolicy()` to deviate deliberately.
- **Five transforms**: redact, generalize (date→year, ZIP→3-digit/`000`, age→`90+`), keyed date-shift,
  keyed-HMAC pseudonymize, keyed hash.
- **18 Safe Harbor categories**: §164.514(b)(2)(i)(A)–(R), including the open-ended catch-all (R).
- **Fail-closed rule**: anything uncertain is blocked, never passed through; clinical values are
  retained untouched.
- **Value-free manifest**: category + transform + locus + count + disposition + code + a boolean
  `reidentificationCode` (`true` only where a keyed surrogate was emitted) + a `partyRole` code (only
  where a party was left in place because its role sits outside the scope clause), never a value, never
  the key, never the date-shift offset. The locus is the one field built out of the document: a
  per-format adapter names the position with the identifier that sits there, so each identifier is
  checked against the shape its position promises and a non-conforming one is refused as
  `WITHHELD_LOCUS_TOKEN` (`<withheld>`) rather than echoed.

## License

MIT © Cosyte
