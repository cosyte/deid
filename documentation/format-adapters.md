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
only when every property it carries is one R4 defines on `HumanName`, **and** at least one of them is a
marker property (`family` / `given` / `prefix` / `suffix`), **and** that marker holds **the exact value
shape R4 gives it** - `family` a single string, the other three repeating. An `Address` the same way,
with `line` repeating and `city` / `district` / `state` / `postalCode` / `country` single. All three
halves earn their place: they keep the wider sweep off an **organisation's own `name`** (a plain
string, never a `HumanName`), off a `CodeableConcept` carrying only its `text`, and off every clinical
code, value, unit and status.

Reading the shape **per marker** is what separates a marker from an R4 element that merely shares its
name, and R4 supplies two such collisions. The several elements called `country` are coded concepts
where `Address.country` is a string. And `Questionnaire.item`, `PlanDefinition.action` and
`RequestGroup.action` each carry a `prefix` that is a single string, where a name's `prefix` repeats;
the latter two backbones make **every** child optional, so `{ "prefix": "1." }` alone is a conformant
numbered workflow step, and the shape is the only thing that tells it from a person. The rule leans on
no sibling those other elements happen to require: that would be an assumption about the document, and
this pass validates no conformance.

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
- **A name or an address carrying a property R4 does not define, or carrying its only marker at a
  value shape R4 does not give that marker, at an element name R4 does not type as one of the two
  datatypes.** Positive classification is closed and shape-read, so an unrecognized sibling or the
  wrong shape stops it, and the fail-closed block above is scoped to the typed element names. At any
  other name the same evidence is routinely something else - `{ "prefix": "1." }` is a conformant
  `RequestGroup.action`, not a person - and blocking it would destroy conformant clinical and
  structural content that no re-run restores. Such a value is passed through and counted as an
  unexamined residual position, like anything else no rule names. At a **typed** element name neither
  half is a residual: the standard promised a name or an address there, so whatever the classifier
  declines is blocked whole.
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
