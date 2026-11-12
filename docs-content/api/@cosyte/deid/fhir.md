# @cosyte/deid/fhir

`@cosyte/deid/fhir`: the **FHIR R4 de-identification adapter**. The FHIR binding of the
format-agnostic core: it locates PHI **structurally** in a parsed `@cosyte/fhir`
resource, applies the configured de-identification policy, and returns a transformed `FhirComplex`
plus the core's value-free manifest.

**`@cosyte/fhir` is an optional peer dependency**, consumed only from this subpath: a consumer who
only de-identifies FHIR installs it alongside `@cosyte/deid`; the core stays third-party-dep-free. The
adapter reaches FHIR data **only** through `@cosyte/fhir`'s own exported model (`FhirComplex` /
`FhirList` / `FhirPrimitive`, `getProperty`, `resourceType`, the `complex`/`list`/`primitive`
constructors) and its `parseResource` / `serializeResource` codec: it never touches a third-party
JSON substrate, so `@cosyte/deid` declares no third-party runtime dependency of its own.

**What it covers.** FHIR is a **graph of typed resources**, so the map splits by role:
- **Person resources**: `Patient` / `RelatedPerson` / `Practitioner` / `Person` (and the nested
  `Patient.contact` relative): `name` / `telecom` / `photo` removed; `address` → safe 3-digit
  ZIP; `birthDate` and every date → year.
- **Every resource (the universal vectors that leak from any type):** `identifier` pseudonymized by
  `system` (a US-SSN system removed); PHI-bearing **dates** → year; the narrative **`text.div`** blocked
  at any depth; **extension** values blocked (the fail-closed frontier, an unknown extension can carry
  any PHI, incl. an MRN in a local extension); a `Reference.display` (a person label) blocked;
  **embedded content** the pass does not read (an `Attachment.data` or `Attachment.url`, a
  `Binary.data`, a `Signature.data`, every other `base64Binary`) removed, unless the caller keeps
  its kind (below).
- **Every resource, by DATATYPE:** outside a person resource a `HumanName` is removed and an
  `Address` is reduced to the safe 3-digit ZIP **wherever the graph puts it**, so
  `Organization.contact.name` and `Location.address` are treated exactly as `Patient.name` and
  `Patient.address` are. Which resource carries a person's name is the producer's shaping choice;
  coverage does not depend on it. **Inside** a person resource the demographic map above decides, so
  the sweep adds nothing there and a name or an address at a person-resource property the map does
  not list is a residual, stated below.
- **Every resource's logical id, and every literal that names one:** the resource `id`, and the id
  part of a `Bundle.entry.fullUrl`, a `Reference.reference`, a `Bundle.entry.request.url` and a
  `Bundle.entry.response.location`, recorded as medical record numbers. The same id gets the same
  replacement throughout one call, so every reference still resolves. Under a policy that withholds
  that category (Safe Harbor) the replacement is a per-call sequence number not derived from the id
  (`DEID_IDENTIFIER_SUBSTITUTED`); under `pseudonymize` or `hash` it is the keyed surrogate, so
  documents keyed alike link; under any other transform the id is removed. The structure around an
  id is kept (`#`, the resource type, the `urn:uuid:` / `urn:oid:` scheme, a server base one of the
  input's own `fullUrl`s names) and a `/_history/` version suffix is dropped. A literal the pass cannot
  read, and an absolute reference to a server no `fullUrl` in the input names, is removed.
- **Contained resources and `Bundle` entries** are walked, re-deriving each resource's role at its own
  `resourceType`; **clinical resources** (`Observation`, `Condition`, …) are otherwise **retained
  untouched** (the over-scrub guard): their codes, values, units, and statuses survive byte-identical.

**Fail closed** governs the person sweep, the datatype sweep and the frontier: a bare unrecognized
string at a person resource's top level is blocked (an open-ended allow-list can never satisfy Safe
Harbor category (R)), every extension value is blocked, primitive-level `_`-sibling extensions are
dropped by the applier (the side-channel the structural walk cannot otherwise reach), and a swept
`Address` the pass cannot read faithfully (a `postalCode` that is not a whole zip code, an
unexpected JSON shape at a part Safe Harbor would let it keep) is removed **whole** rather than
partly retained. At an element name R4 **types** as one of the two datatypes (`name`, `address`, a
choice-type `locationAddress`, an open `valueAddress` / `valueHumanName`, the `HumanName` arms of
the `defaultValue[x]` / `fixed[x]` / `pattern[x]` choices) **any** complex the
classifier cannot pin down is blocked whole - a text-only representation with no part to key on, one
carrying a property R4 does not define beside a `family` or a `line`, and equally one whose every
property is foreign to both datatypes - because the standard promised a name or an address there and
the pass could not read the one it was given. Exactly two conformant R4 backbones share one of those
element names (`MedicinalProduct.name`, `SubstanceSpecification.name`) and both are excluded
positively, by the property R4 makes `1..1` on each plus that backbone's own closed property set. A
contact's name is removed and recorded whatever shape it arrives in: a string where R4 types a
`HumanName` (`Organization.contact.name`, `InsurancePlan.contact.name`) is blocked, and the string R4
types at a `ContactDetail`'s `name` (the individual to contact) is removed as a name. The
honesty line is unchanged: the output is **"Safe-Harbor-transformed per the configured policy"**,
never "de-identified".

**Primitive formats.** Every primitive the pass keeps is checked against the format the R4
definitions give its type (the pattern of a `code`, an `id`, a date kind, a `time`, a uri kind, an
`oid`, a `uuid`, a `base64Binary`, a number kind and a `boolean`, and the range of an integer
kind), and a `code` at an element R4 binds, required, to a value set it defines against that set's
codes; a value that does not fit is blocked whole. A format stops only what it rules out: a name
that fits a `code`, an `id` or a `uri` is kept and counted as unexamined. An extension's `url` is
kept verbatim when it fits the `uri` format.

**Known limitations.** Extension values are block-only (no profile-aware retention, a
`us-core-*` demographic extension is dropped, not kept), with one opt-in exception: under
`keepPatientAnimal` the coded species, breed and gender status of the `patient-animal` extension
are kept.
Resource ids are replaced and the reference wiring is kept, with what that does not reach stated:
the server base of a `fullUrl`, and of an absolute reference to it, is kept verbatim; and an id
written anywhere else (`meta.versionId`, `meta.source`, `Bundle.link.url`, any other uri) that fits the format R4 gives its type is passed through and counted as unexamined. Under the Safe
Harbor default the stand-ins are per call, so the same resource transformed in two calls gets two
unrelated ids; linkage across calls needs a keyed policy, which does not claim Safe Harbor.
Free text is blocked, not retained. A `note` (`Annotation` text, author and time, as one unit), a
`contentString` and an uncoded `valueString` are free-text loci: removed and recorded as
`DEID_FREETEXT_BLOCKED` unless a consumer-supplied redactor returns its own text for them. The
rendered narrative `text.div` is blocked at any depth, with no redactor. A coded or typed result
(`valueQuantity`, `valueCodeableConcept`, `valueDateTime`) is kept (the over-scrub guard).
Five surfaces the datatype sweep deliberately does **not** reach. Three because no datatype types a
person at the position: a **`ContactPoint` outside a person resource** (widening to telecom would put
a payer's own switchboard number in scope, which the sibling adapters keep); an **organisation's own
`name`**, a plain string and not a `HumanName`; and the **individual's employer carried as a separate
`Organization` resource**, which would need a cross-resource role derivation R4 types nowhere (the
`Reference.display` naming it is blocked either way). The fourth is the stated cost of the closed,
shape-read classification: a name or an address carrying a property R4 does not define, **or**
carrying its only marker at a value shape R4 does not give that marker, at an element name R4 does
not type as one of the two datatypes, because there that same evidence is routinely a conformant
structural element (`{ prefix: "1." }` is a `RequestGroup.action`) and blocking it would destroy
content no re-run restores. At a **typed** element name neither half is a residual, because the
fail-closed rule above blocks whatever the classifier declined. The fifth is the scope of the sweep
itself: **inside** a person resource it does not
run, because the demographic map has already decided `name` / `telecom` / `photo` / `address` there,
so a `HumanName` or an `Address` at a person-resource property that map does not list is passed
through and counted as unexamined - the same bytes an `Organization` would have had removed.

**Transform labels, opt-in.** With `transformLabels: true` the output says, inside the FHIR, what
the pass did: each resource it changed carries the `meta.security` coding `REDACTED` from the v3
`ObservationValue` code system, and an element R4 requires that it removed carries the Data Absent
Reason `masked` in its place, so the resource keeps its required elements. A contained resource is
never labeled (R4 `dom-5`); its container is. The label says that some content was filtered out,
never that the resource is de-identified. Off by default.

**Embedded content, opt-in.** An `Attachment.data`, an `Attachment.url`, a `Binary.data`, a
`Signature.data` and every other `base64Binary` outside an extension can hold a whole document (a
scanned form, a PDF, a C-CDA) that the pass does not read, so each is removed by default with a
blocked row that carries no value. `keepEmbeddedContent` names the kinds to keep
([FHIR\_EMBEDDED\_CONTENT\_KINDS](#fhir_embedded_content_kinds)); each kept element is kept unread and recorded as
`DEID_EMBEDDED_CONTENT_RETAINED`. An extension's value stays blocked whatever its type.

**Device identifiers.** On a `Device`, the `serialNumber`, `lotNumber`, `distinctIdentifier`, every
`identifier` value (but a Social Security number's) and the UDI carrier's `deviceIdentifier`,
`carrierHRF` and `carrierAIDC` are category (M), device identifiers and serial numbers. Both presets
remove each with a row that carries no value, and keeping embedded content does not keep a
`carrierAIDC`. The device's name, model, type and status are kept.

**Animal patients, opt-in.** With `keepPatientAnimal: true` a `Patient`'s `patient-animal`
extension keeps the coded `valueCodeableConcept` of its `species`, `breed` and `genderStatus`
sub-extensions. Only that exact URL and those three parts: a look-alike URL, another sub-extension,
a `valueString` and the concept's free `text` are blocked as every extension value is. Off by default.

## Interfaces

### FhirApplyOptions

Options for [applyFhir](#applyfhir).

#### Example

```ts
import { type FhirApplyOptions } from "@cosyte/deid/fhir";

const options: FhirApplyOptions = { transformLabels: true };
```

#### Properties

##### transformLabels?

> `readonly` `optional` **transformLabels?**: `boolean`

Write the transform labels: the `meta.security` coding on each resource the rebuild changed, and
a Data Absent Reason in place of a removed element R4 requires. Off by default.

***

### FhirCoord

A write-back coordinate: a direct handle to the exact model node one extracted locus came from, plus
how to rewrite it. Node identity ties the coordinate to the tree the applier rebuilds. Carries no value.

#### Properties

##### edit

> `readonly` **edit**: [`FhirEditKind`](#fhireditkind)

How to write the transformed value back.

##### node

> `readonly` **node**: `FhirNode`

The model node to rewrite (a primitive, an `Address` complex, or a property-value node to drop).

***

### FhirDeidOptions

Options for [deidentifyFhir](#deidentifyfhir) and [deidentifyFhirJson](#deidentifyfhirjson): the core's
["@cosyte/deid".DeidOptions](../deid.md#deidoptions) plus the FHIR-only `transformLabels`, `keepPatientAnimal` and
`keepEmbeddedContent`.

#### Example

```ts
import { deidentifyFhirJson, type FhirDeidOptions } from "@cosyte/deid/fhir";

const options: FhirDeidOptions = { transformLabels: true };
const { json } = deidentifyFhirJson('{"resourceType":"Patient","name":[{"family":"ZZ"}]}', options);
```

#### Extends

- [`DeidOptions`](../deid.md#deidoptions)

#### Properties

##### context?

> `readonly` `optional` **context?**: [`DeidContext`](../deid.md#deidcontext)

The context carrying the consumer's key, required only when the policy uses a keyed transform.

###### Inherited from

[`DeidOptions`](../deid.md#deidoptions).[`context`](../deid.md#context)

##### keepEmbeddedContent?

> `readonly` `optional` **keepEmbeddedContent?**: readonly [`FhirEmbeddedContentKind`](#fhirembeddedcontentkind)[]

The kinds of embedded content to keep, from [FHIR\_EMBEDDED\_CONTENT\_KINDS](#fhir_embedded_content_kinds). Content the pass
does not read (an `Attachment.data`, an `Attachment.url`, a `Binary.data`, a `Signature.data`, any
other `base64Binary` outside an extension) can hold a whole document, so it is removed by default,
with a blocked row that carries no value. A kind named here is kept as it arrived, unread, and each
kept element gets a `DEID_EMBEDDED_CONTENT_RETAINED` row at its locus. Name a kind only for content
you know carries nothing that identifies a person. Empty by default. See [FhirExtractOptions](#fhirextractoptions).

##### keepPatientAnimal?

> `readonly` `optional` **keepPatientAnimal?**: `boolean`

Keep the species, breed and gender status of an animal patient, from the R4 `patient-animal`
extension ([FHIR\_PATIENT\_ANIMAL\_URL](#fhir_patient_animal_url), matched exactly) on a `Patient`. Only the
`valueCodeableConcept` of the `species`, `breed` and `genderStatus` sub-extensions is kept, as
codes; the concept's `text`, any other `value[x]`, any other sub-extension and every other
extension stay blocked. The kept codes are counted as unexamined residuals. Off by default, so the
output is unchanged unless a caller asks. See [FhirExtractOptions](#fhirextractoptions).

##### parseIssues?

> `readonly` `optional` **parseIssues?**: readonly `FhirIssue`[]

The issues `parseResource` returned beside the resource, so that each `_`-sibling the reader
dropped for being written beside an element that is not a primitive gets a blocked row
(`Observation._code`), with no value. [deidentifyFhirJson](#deidentifyfhirjson) passes them itself. See
[FhirExtractOptions](#fhirextractoptions).

##### policy?

> `readonly` `optional` **policy?**: [`DeidPolicy`](../deid.md#deidpolicy) \| `"safe-harbor"`

The policy to apply. Defaults to the built-in Safe Harbor policy.

###### Inherited from

[`DeidOptions`](../deid.md#deidoptions).[`policy`](../deid.md#policy)

##### redactor?

> `readonly` `optional` **redactor?**: [`FreeTextRedactor`](../deid.md#freetextredactor)

A **consumer-supplied** free-text redactor. When present, the engine invokes it
at each free-text locus instead of blocking, and records its output as **consumer-asserted**
(`DEID_FREETEXT_CONSUMER_REDACTED`). The library bundles **no** redactor. **Fail-closed contract:**
when this is omitted, or when the redactor throws or returns nothing, the free-text locus is
**blocked** (the safe default), never emitted un-redacted. A returned redaction is trusted as the
consumer's; the engine does not re-verify it and does not touch the structural PHI the adapters
remove. See [FreeTextRedactor](../deid.md#freetextredactor).

###### Inherited from

[`DeidOptions`](../deid.md#deidoptions).[`redactor`](../deid.md#redactor)

##### retainedLoci?

> `readonly` `optional` **retainedLoci?**: readonly [`RetainedLocusClass`](../deid.md#retainedlocusclass)[]

The **retention classes** the configured profile permits: the named groups of identifying loci a
format adapter may pass through unchanged (each one still recorded as a residual). Build this
with profileOptions rather than by hand; the widen-never-narrow contract on a derived
profile is what keeps a site preset from adding one.

**Absent or empty retains nothing**, so a bare options bag gets the strict treatment.

###### Inherited from

[`DeidOptions`](../deid.md#deidoptions).[`retainedLoci`](../deid.md#retainedloci)

##### transformLabels?

> `readonly` `optional` **transformLabels?**: `boolean`

Mark the output as transformed, inside the FHIR. Each resource the pass changed gets the
`meta.security` coding [FHIR\_TRANSFORMED\_SECURITY\_LABEL](#fhir_transformed_security_label) (`REDACTED`), and an element R4
requires that the pass removed gets the Data Absent Reason [FHIR\_DATA\_ABSENT\_REASON](#fhir_data_absent_reason)
(`masked`) in its place. A contained resource is never labeled; its container is. The label
claims that some content was filtered out, not that the resource is de-identified. Off by
default, so the output is unchanged unless a caller asks.

***

### FhirDeidResult

The result of de-identifying a FHIR resource: the transformed resource model plus the core's
value-free manifest of every category acted on and every locus blocked.

#### Example

```ts
import { parseResource } from "@cosyte/fhir";
import { deidentifyFhir } from "@cosyte/deid/fhir";
import { createDeidContext } from "@cosyte/deid";

const { resource } = parseResource(json);
const result: FhirDeidResult = deidentifyFhir(resource, {
  context: createDeidContext({ key: process.env.DEID_KEY! }),
});
result.manifest; // value-free audit: category + locus, never a value
```

#### Properties

##### document

> `readonly` **document**: `FhirComplex`

The de-identified resource: a fresh, independent `FhirComplex`; the input is never mutated.

##### manifest

> `readonly` **manifest**: readonly [`DeidManifestEntry`](../deid.md#deidmanifestentry)[]

The value-free audit of every action, in locus order (never a value, never a key).

##### unexaminedResiduals

> `readonly` **unexaminedResiduals**: readonly [`UnexaminedResidual`](../deid.md#unexaminedresidual)[]

The manifest's **second list**: every value-bearing position this pass handed through that **no
locus rule named**, counted and located. In FHIR that is largely the clinical resources' codes,
units and statuses, which no rule here examines. An empty list is a **measured zero**, not a
silence.

***

### FhirExtraction

The paired output of [extractFhirLoci](#extractfhirloci): loci for the engine + coordinates for the applier.

#### Properties

##### coords

> `readonly` **coords**: [`FhirCoord`](#fhircoord)[]

The write-back coordinates, index-aligned with [loci](#loci).

##### loci

> `readonly` **loci**: [`GenericLocus`](../deid.md#genericlocus)[]

The located candidate values, in document order.

##### unexaminedResiduals

> `readonly` **unexaminedResiduals**: readonly [`UnexaminedResidual`](../deid.md#unexaminedresidual)[]

Every **value-bearing position the pass hands through that no locus rule named**: a primitive
carrying a non-empty value that neither a PHI rule nor the fail-closed person sweep reached. The
clinical resources' codes, units and statuses are the bulk of it, and that is the honest answer:
nothing examined them. Counted and located, never transformed.

***

### FhirExtractOptions

Options for [extractFhirLoci](#extractfhirloci).

#### Example

```ts
import { type FhirExtractOptions } from "@cosyte/deid/fhir";

const options: FhirExtractOptions = { keepPatientAnimal: true };
```

#### Properties

##### keepEmbeddedContent?

> `readonly` `optional` **keepEmbeddedContent?**: readonly [`FhirEmbeddedContentKind`](#fhirembeddedcontentkind)[]

The kinds of embedded content to keep ([FhirEmbeddedContentKind](#fhirembeddedcontentkind)). An element that embeds
content the pass does not read (an `Attachment.data`, an `Attachment.url`, a `Binary.data`, a
`Signature.data`, any other `base64Binary` outside an extension) is removed by default, with a
blocked row that carries no value. Naming its kind here keeps it as it arrived, unread, and
records the keep at its locus as `DEID_EMBEDDED_CONTENT_RETAINED`. Name a kind only for content
you know carries nothing that identifies a person. Empty by default, so nothing is kept unless a
caller asks.

##### keepPatientAnimal?

> `readonly` `optional` **keepPatientAnimal?**: `boolean`

Keep the species, breed and gender status of an animal patient. On a `Patient`, the first
extension whose `url` is exactly [FHIR\_PATIENT\_ANIMAL\_URL](#fhir_patient_animal_url) keeps the `valueCodeableConcept`
of its first `species`, `breed` and `genderStatus` sub-extension, as codes only: each `Coding`'s
`system`, `version`, `code`, `userSelected` (a boolean only) and `display`. Everything else in it
is blocked as before: the concept's `text`, any other `value[x]` (a `valueString` among them), any
other sub-extension, any nested extension, and any key R4 does not define there. Every other extension stays blocked. Off by default, so
the output is unchanged unless a caller asks.

##### parseIssues?

> `readonly` `optional` **parseIssues?**: readonly `FhirIssue`[]

The issues `parseResource` returned beside the resource. The reader drops a `_`-sibling written
beside an element that is not a primitive (`"_code": { ... }` beside a `CodeableConcept`, or
beside a list of structures), since FHIR JSON gives it no meaning there, and raises
`MISPLACED_PRIMITIVE_EXTENSION` at the element. For each such issue the pass records a blocked
row at the `_`-sibling's locus (`Observation._code`), with no value, so a manifest reader sees
the drop. Every other issue is ignored. Without it, the dropped sibling gets no row, and nothing
else changes.

## Type Aliases

### FhirDemographicMode

> **FhirDemographicMode** = `"redact"` \| `"address"`

The **demographic element** names that carry direct PHI **inside a person resource** (and its nested
`contact` relative): `name` (HumanName), `telecom` (ContactPoint), and `photo` (Attachment)
are redacted whole; `address` (Address) is generalized to the safe 3-digit ZIP. `birthDate` and every
other date is handled generically by [isFhirDateValue](#isfhirdatevalue) (date → year), so it is deliberately not
listed here.

***

### FhirEditKind

> **FhirEditKind** = `"drop"` \| `"set-primitive"` \| `"address"` \| `"age"` \| `"reference"` \| `"primitive-id"`

How the applier rewrites one extracted locus onto a fresh copy of the node it came from:

- `drop`: remove the node entirely (a redacted `name`/`telecom`/`photo` property, a blocked
  extension value, a blocked `Reference.display`, a blocked unknown person string, a blocked
  narrative `div`, or a redacted SSN `Identifier.value`). The parent complex omits the property; a
  parent list omits the item.
- `set-primitive`: replace a primitive's value with the transformed string (a generalized date, a
  pseudonymized `Identifier.value`); a `null` transform result degrades to `drop`.
- `address`: rebuild an `Address` complex, keeping `state`/`country` and the generalized 3-digit
  `postalCode`, dropping every finer geographic component.
- `age`: the `value` of a `Quantity` that holds an age. The number is kept exactly as it arrived when
  the pass kept the age, and dropped otherwise: an age over 89, one the pass could not read, or a
  surrogate a custom policy computed, since a decimal is never written back as a string.
- `reference`: a literal that carries a logical id (a `fullUrl`, a `Reference.reference`, a request
  url or a response location). The id part is replaced by the transformed value and the structure
  around it is kept: the `#`, the resource type, the `urn:uuid:` or `urn:oid:` scheme, or the server
  base. A version suffix (`/_history/vid`) is dropped. A `null` transform result drops the literal.
- `primitive-id`: the element id of a primitive the applier writes back (its `_`-sibling `id`). The
  primitive keeps its value and takes the transformed value as its id; a `null` result writes it
  with no id.

***

### FhirEmbeddedContentKind

> **FhirEmbeddedContentKind** = `"attachment-data"` \| `"attachment-url"` \| `"binary-data"` \| `"signature-data"` \| `"base64-binary"`

A kind of FHIR element that embeds content the adapter does not read:

- `attachment-data`: an `Attachment.data`, wherever an `Attachment` sits (`DocumentReference`,
  `Media`, `DiagnosticReport.presentedForm`, `Communication.payload`, a `QuestionnaireResponse`
  answer, a `Parameters` value, and every other place R4 types one);
- `attachment-url`: an `Attachment.url`, which points at the attachment's content (a server url, a
  relative reference to a `Binary`, or a `data:` url that carries the content itself);
- `binary-data`: a `Binary.data`;
- `signature-data`: a `Signature.data`, the signature itself, which can enclose the signed content;
- `base64-binary`: every other element R4 types as `base64Binary` (an `Attachment.hash`,
  `AuditEvent.entity.query`, a `valueBase64Binary` outside an extension).

An extension's value is not among them: every extension value is blocked whatever its type, and no
kind here keeps one. Nor is a `Device`'s `udiCarrier.carrierAIDC`: it holds the device's UDI, a
device identifier, so it is removed as category (M) whatever kind is kept.

#### Example

```ts
import { type FhirEmbeddedContentKind } from "@cosyte/deid/fhir";

const kind: FhirEmbeddedContentKind = "attachment-data";
```

***

### FhirPersonalDatatype

> **FhirPersonalDatatype** = `"human-name"` \| `"address"`

The two FHIR R4 datatypes this adapter acts on wherever they sit: `HumanName` (removed whole) and
`Address` (reduced to the geographic granularity Safe Harbor permits).

#### Example

```ts
import { type FhirPersonalDatatype } from "@cosyte/deid/fhir";

const datatype: FhirPersonalDatatype = "human-name";
```

## Variables

### FHIR\_DATA\_ABSENT\_REASON

> `const` **FHIR\_DATA\_ABSENT\_REASON**: `object`

The Data Absent Reason extension the FHIR adapter writes, under `transformLabels`, in place of a
value the pass removed where R4 requires the element (`min` of 1 or more): the R4
`data-absent-reason` extension with the code `masked`.

#### Type Declaration

##### url

> `readonly` **url**: `"http://hl7.org/fhir/StructureDefinition/data-absent-reason"` = `"http://hl7.org/fhir/StructureDefinition/data-absent-reason"`

##### valueCode

> `readonly` **valueCode**: `"masked"` = `"masked"`

#### Example

```ts
import { FHIR_DATA_ABSENT_REASON } from "@cosyte/deid/fhir";

FHIR_DATA_ABSENT_REASON.valueCode; // => "masked"
```

***

### FHIR\_DEMOGRAPHIC\_ELEMENTS

> `const` **FHIR\_DEMOGRAPHIC\_ELEMENTS**: `Readonly`\<`Record`\<`string`, [`FhirDemographicMode`](#fhirdemographicmode)\>\>

The person-resource demographic element map: element name → how the applier handles it. Applied
within a [PERSON\_RESOURCE\_TYPES](#person_resource_types) resource subtree; outside one, the datatype-keyed sweep
reaches a `HumanName` and an `Address` on its own terms while a body `Coding.display` is still
never swept. A mapped element is handled as a **unit**: the extractor does not descend into it, so
a redacted `name` never has an inner primitive ride through.

#### Example

```ts
import { FHIR_DEMOGRAPHIC_ELEMENTS } from "@cosyte/deid/fhir";

FHIR_DEMOGRAPHIC_ELEMENTS.name;    // => "redact"
FHIR_DEMOGRAPHIC_ELEMENTS.address; // => "address"
```

***

### FHIR\_EMBEDDED\_CONTENT\_KINDS

> `const` **FHIR\_EMBEDDED\_CONTENT\_KINDS**: readonly [`FhirEmbeddedContentKind`](#fhirembeddedcontentkind)[]

Every [FhirEmbeddedContentKind](#fhirembeddedcontentkind), in a fixed order: the values `keepEmbeddedContent` accepts.

#### Example

```ts
import { FHIR_EMBEDDED_CONTENT_KINDS } from "@cosyte/deid/fhir";

FHIR_EMBEDDED_CONTENT_KINDS.includes("binary-data"); // => true
```

***

### FHIR\_PATIENT\_ANIMAL\_URL

> `const` **FHIR\_PATIENT\_ANIMAL\_URL**: `"http://hl7.org/fhir/StructureDefinition/patient-animal"` = `"http://hl7.org/fhir/StructureDefinition/patient-animal"`

The canonical URL of the R4 `patient-animal` extension, the one extension
[FhirExtractOptions.keepPatientAnimal](#keeppatientanimal-1) keeps any value of. Matched exactly: a look-alike (a
version suffix, another host, a trailing slash, a change of case) is an unknown extension.

***

### FHIR\_TRANSFORMED\_SECURITY\_LABEL

> `const` **FHIR\_TRANSFORMED\_SECURITY\_LABEL**: `object`

The `meta.security` coding the FHIR adapter writes, under `transformLabels`, on every resource the
pass changed: the v3 `ObservationValue` integrity code `REDACTED`. It claims that some portion of
the resource was filtered out and is not included, and nothing more: not that the resource is
de-identified, anonymized or pseudonymized.

#### Type Declaration

##### code

> `readonly` **code**: `"REDACTED"` = `"REDACTED"`

##### display

> `readonly` **display**: `"redacted"` = `"redacted"`

##### system

> `readonly` **system**: `"http://terminology.hl7.org/CodeSystem/v3-ObservationValue"` = `"http://terminology.hl7.org/CodeSystem/v3-ObservationValue"`

#### Example

```ts
import { FHIR_TRANSFORMED_SECURITY_LABEL } from "@cosyte/deid/fhir";

FHIR_TRANSFORMED_SECURITY_LABEL.code; // => "REDACTED"
```

***

### PERSON\_RESOURCE\_TYPES

> `const` **PERSON\_RESOURCE\_TYPES**: `ReadonlySet`\<`string`\>

The **identifying (person) resource types** whose demographic elements carry direct Safe Harbor PHI.
Scoped to those four, and that scope now governs the `telecom` / `photo` sweep and the
bare-unrecognized-string frontier **only**: a `HumanName` or an `Address` is acted on by its own
datatype wherever it sits, including on a `Location` or an `Organization` (see `./datatype.js`).
What stays outside every rule here is an organisation's own `name`, which is a plain string R4
types at no personal datatype at all.

#### Example

```ts
import { PERSON_RESOURCE_TYPES } from "@cosyte/deid/fhir";

PERSON_RESOURCE_TYPES.has("Patient");     // => true
PERSON_RESOURCE_TYPES.has("Observation"); // => false
```

***

### RECOGNIZED\_PERSON\_ELEMENTS

> `const` **RECOGNIZED\_PERSON\_ELEMENTS**: `ReadonlySet`\<`string`\>

The **positive allow-list** of person-resource top-level element names whose own primitive value is
recognized structural / coded / administrative data (not free PHI): the over-scrub guard for the
fail-closed person sweep. A **bare-string** top-level property of a person resource that is neither a
mapped demographic, an `identifier`/`text`/`extension`/`contained`, nor on this list is **blocked**
(the (R) catch-all): a vendor `<Patient>`-level string field (`ssn`, `motherMaidenName`)
cannot ride through in the clear. This is an **explicit set**, never a suffix/shape heuristic, for the
exact reason the C-CDA map is: an open-ended match would silently retain an unknown field and leak it.
The list covers the R4 person-resource scalar/coded elements; complex children are descended into
regardless (their PHI is caught by the datatype rules), so this gate only governs direct scalars.

## Functions

### applyFhir()

> **applyFhir**(`resource`, `transformed`, `coords`, `options?`): `FhirComplex`

Rebuild a de-identified resource from the engine's transformed loci and the extractor's coordinates.
`transformed` and `coords` are index-aligned (both preserve extraction order). Returns a fresh,
independent "@cosyte/fhir".FhirComplex; the input `resource` is never mutated.

#### Parameters

##### resource

`FhirComplex`

The original parsed resource the extractor walked.

##### transformed

readonly [`TransformedLocus`](../deid.md#transformedlocus)[]

The engine's transformed loci, in extraction order.

##### coords

readonly [`FhirCoord`](#fhircoord)[]

The write-back coordinates, index-aligned with `transformed`.

##### options?

[`FhirApplyOptions`](#fhirapplyoptions) = `{}`

`transformLabels` writes the transform labels (off by default).

#### Returns

`FhirComplex`

The de-identified resource tree.

#### Example

```ts
import { parseResource } from "@cosyte/fhir";
import { extractFhirLoci, applyFhir } from "@cosyte/deid/fhir";
import { deidentify } from "@cosyte/deid";

const { resource } = parseResource(json);
const { loci, coords } = extractFhirLoci(resource);
const { document } = deidentify({ loci }, { context });
const deidentified = applyFhir(resource, document.loci, coords);
```

***

### categoryForIdentifierSystem()

> **categoryForIdentifierSystem**(`system`, `fallback?`): [`SafeHarborCategory`](../deid.md#safeharborcategory)

Resolve the Safe Harbor category for a FHIR `Identifier` from its `system` URI: a US-SSN system is an
**SSN** (redacted); every other identifier defaults to **MRN** (pseudonymized to a consistent
surrogate, the `system` retained). Structural, parser-typed routing, never a guess from the value's
shape.

#### Parameters

##### system

`string` \| `undefined`

The `Identifier.system` URI, or `undefined`.

##### fallback?

[`SafeHarborCategory`](../deid.md#safeharborcategory) = `C.MRN`

The category for a non-SSN / absent system (defaults to MRN).

#### Returns

[`SafeHarborCategory`](../deid.md#safeharborcategory)

The resolved Safe Harbor category.

#### Example

```ts
import { categoryForIdentifierSystem, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid/fhir";

categoryForIdentifierSystem("http://hl7.org/fhir/sid/us-ssn");   // => "SSN"
categoryForIdentifierSystem("http://hospital.example/mrn");      // => "MRN"
```

***

### classifyFhirPersonalDatatype()

> **classifyFhirPersonalDatatype**(`node`): [`FhirPersonalDatatype`](#fhirpersonaldatatype) \| `undefined`

Classify a node as a FHIR R4 `HumanName` or `Address` from its own structure, or `undefined` when
it is neither. Structural, closed, and marker-bound by the value shape R4 gives **that** marker as
well as by its name: see this module's own documentation for why all three halves of the test are
required and what the test deliberately does not reach.

A node this returns `undefined` for is **not** thereby safe. It is only "not positively one of the
two", which is a different statement; at a position R4 types as one of these datatypes the caller
asks carriesFhirPersonalEvidence next and fails closed on the answer.

#### Parameters

##### node

`FhirNode`

Any node of the parsed `@cosyte/fhir` element tree.

#### Returns

[`FhirPersonalDatatype`](#fhirpersonaldatatype) \| `undefined`

The datatype, or `undefined` when the node is not positively one of the two.

#### Example

```ts
import { complex, list, primitive } from "@cosyte/fhir";
import { classifyFhirPersonalDatatype } from "@cosyte/deid/fhir";

const name = complex([{ name: "family", value: primitive("ZZFAMILY") }]);
classifyFhirPersonalDatatype(name); // => "human-name"

const address = complex([{ name: "city", value: primitive("ZZCITY") }]);
classifyFhirPersonalDatatype(address); // => "address"

// A CodeableConcept carrying only its text is a clinical code, never a name.
classifyFhirPersonalDatatype(complex([{ name: "text", value: primitive("Sodium") }])); // => undefined

// A coded `country`: R4 types Address.country as a string, so a complex there is another datatype.
const coded = complex([{ name: "country", value: complex([{ name: "text", value: primitive("US") }]) }]);
classifyFhirPersonalDatatype(coded); // => undefined

// R4 types HumanName.prefix as repeating, so a name's prefix arrives as a list ...
classifyFhirPersonalDatatype(complex([{ name: "prefix", value: list([primitive("Dr.")]) }])); // => "human-name"
// ... while a single string at `prefix` is a numbered workflow step, not a person.
classifyFhirPersonalDatatype(complex([{ name: "prefix", value: primitive("1.") }])); // => undefined

// An organisation's own name is a plain string, so no datatype rule reaches it.
classifyFhirPersonalDatatype(primitive("Springfield Clinic")); // => undefined
```

***

### deidentifyFhir()

> **deidentifyFhir**(`resource`, `options?`): [`FhirDeidResult`](#fhirdeidresult)

De-identify a parsed FHIR resource (or `Bundle`) under a policy (Safe Harbor by default). PHI is
located structurally from the `@cosyte/fhir` model: the person-resource demographics, every
`HumanName` and `Address` by its datatype wherever the graph carries it **outside** a person
resource, and the universal identifier / date / narrative / extension / reference vectors; the
input resource is never mutated (the immutable model is rebuilt into a fresh tree). The surfaces
this does not reach are stated rather than implied: see this module's own **Known limitations**
above, and `docs-content/limitations.md` for the shipped enumeration.

The output is **"Safe-Harbor-transformed per the configured policy"**: it is not certified
de-identified, and Expert Determination is not rendered.

#### Parameters

##### resource

`FhirComplex`

The parsed FHIR resource to de-identify (`parseResource(json).resource`).

##### options?

[`FhirDeidOptions`](#fhirdeidoptions) = `{}`

The policy and (for keyed transforms, identifier pseudonymization) the key context.
  A keyed transform with no context is a fatal `DEID_NO_KEY`, never an unkeyed fallback.
  `transformLabels` writes the transform labels and `keepPatientAnimal` keeps an animal patient's
  species, breed and gender status (see [FhirDeidOptions](#fhirdeidoptions)).

#### Returns

[`FhirDeidResult`](#fhirdeidresult)

The de-identified resource and the value-free manifest.

#### Throws

["@cosyte/deid".DeidError](../deid.md#deiderror) `DEID_NO_KEY` when a keyed transform is required for a
  category present in the resource but no key context was supplied.

#### Example

```ts
import { parseResource, serializeResource } from "@cosyte/fhir";
import { deidentifyFhir } from "@cosyte/deid/fhir";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { resource } = parseResource(json);
const { document, manifest } = deidentifyFhir(resource, { context });
serializeResource(document); // transformed FHIR JSON
```

***

### deidentifyFhirJson()

> **deidentifyFhirJson**(`json`, `options?`): [`FhirDeidResult`](#fhirdeidresult) & `object`

Convenience: parse raw FHIR JSON, de-identify it, and return the transformed resource, the serialized
de-identified JSON, and the value-free manifest in one call. The parse warnings are read for one
thing: each `_`-sibling the reader dropped for being written beside an element that is not a
primitive gets a blocked row ([FhirDeidOptions.parseIssues](#parseissues)). They are not returned; call
`parseResource` directly if you need them.

#### Parameters

##### json

`string`

Raw FHIR JSON text.

##### options?

[`FhirDeidOptions`](#fhirdeidoptions) = `{}`

The policy and key context (see [deidentifyFhir](#deidentifyfhir)).

#### Returns

[`FhirDeidResult`](#fhirdeidresult) & `object`

The transformed resource, its serialized JSON, and the value-free manifest.

#### Example

```ts
import { deidentifyFhirJson } from "@cosyte/deid/fhir";
import { createDeidContext } from "@cosyte/deid";

const { json, manifest } = deidentifyFhirJson(input, {
  context: createDeidContext({ key: process.env.DEID_KEY! }),
});
```

***

### extractFhirLoci()

> **extractFhirLoci**(`resource`, `options?`): [`FhirExtraction`](#fhirextraction)

Walk a parsed FHIR resource (or `Bundle`) and extract every PHI-bearing (or fail-closed) locus,
structurally, from the `@cosyte/fhir` model. Never mutates the tree: the applier rebuilds a fresh
tree from the returned coordinates.

The tree is also **enumerated**: every primitive carrying a value that no rule above named is counted
and located as an unexamined residual. The clinical resources are the bulk of that, and honestly so:
this adapter has no `clinical` locus at all, it simply descends past a code, a unit and a status
without deciding anything, so those positions are unexamined and the measurement says so.

#### Parameters

##### resource

`FhirComplex`

The parsed FHIR resource (`parseResource(json).resource`).

##### options?

[`FhirExtractOptions`](#fhirextractoptions) = `{}`

`keepPatientAnimal` keeps an animal patient's species, breed and gender status
  (see [FhirExtractOptions](#fhirextractoptions)); off by default.

#### Returns

[`FhirExtraction`](#fhirextraction)

The loci (for the engine), their index-aligned write-back coordinates, and the unexamined
  residual positions the pass hands through.

#### Throws

DeidError `DEID_POSITIONS_UNENUMERABLE` when the resource's value-bearing positions
  cannot be enumerated: the pass fails rather than emit a zero or a partial count.

#### Example

```ts
import { parseResource } from "@cosyte/fhir";
import { extractFhirLoci } from "@cosyte/deid/fhir";

const { resource } = parseResource(json);
const { loci } = extractFhirLoci(resource);
loci.length; // number of located candidate values
```

***

### isFhirDateValue()

> **isFhirDateValue**(`value`): `boolean`

`true` when a primitive string value is a **FHIR date / dateTime / instant** carrying month precision
or finer: i.e. a PHI element of a date under Safe Harbor §164.514(b)(2)(i)(C). A bare four-digit year
(`"1985"`) is already Safe-Harbor-safe and returns `false` (it is retained, not re-generalized).

Detection is **value-shaped and validated**, not element-name-based: any primitive whose whole value
is a real calendar date (`YYYY-MM`, `YYYY-MM-DD`, or a full `YYYY-MM-DDThh:mm:ss…` instant, with a
plausible year, month `01` to `12`, and day `01` to `31`) is a date wherever it sits, so a date in an
unexpected or vendor element is generalized too (fail closed on dates). The strict full-match with
month/day validation is what keeps a clinical code (`"2951-2"`, `"1234-56"`) from being mistaken for a
date and over-scrubbed: `2951-2` has a one-digit tail, `1234-56` has an impossible month.

#### Parameters

##### value

`string`

The primitive's string value.

#### Returns

`boolean`

`true` when the value is a real date/dateTime with month-or-finer precision.

#### Example

```ts
import { isFhirDateValue } from "@cosyte/deid/fhir";

isFhirDateValue("2019-03-14");          // => true
isFhirDateValue("2019-03-14T09:00:00Z");// => true
isFhirDateValue("1985");                // => false  (year only, already safe)
isFhirDateValue("2951-2");              // => false  (a LOINC code, not a date)
isFhirDateValue("1234-56");             // => false  (impossible month 56)
```

## References

### SAFE\_HARBOR\_CATEGORIES

Re-exports [SAFE_HARBOR_CATEGORIES](../deid.md#safe_harbor_categories)

***

### SafeHarborCategory

Re-exports [SafeHarborCategory](../deid.md#safeharborcategory)

***

### UnexaminedResidual

Re-exports [UnexaminedResidual](../deid.md#unexaminedresidual)
