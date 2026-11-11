---
id: guides-fhir
title: De-identify a FHIR resource
sidebar_label: FHIR R4
description: "Run a FHIR R4 resource through the Safe Harbor policy, read how names and addresses are classified by datatype, where it fails closed, and its limits."
---

# De-identify a FHIR resource

The `@cosyte/deid/fhir` adapter is the FHIR R4 binding of the de-identification core. It locates PHI
**structurally** in a parsed FHIR resource (a `name` under a `Patient` is the patient's name because
the FHIR spec says so, never because a string "looked like" a name), applies the configured policy, and
returns a transformed resource model plus the core's **value-free manifest**.

> **`@cosyte/fhir` is an optional peer dependency.** Install it alongside `@cosyte/deid` to use this
> subpath; a consumer who only de-identifies FHIR pays for nothing else, and the core stays
> third-party-dependency-free. The adapter reaches FHIR data only through `@cosyte/fhir`'s exported model
> (`FhirComplex` / `FhirList` / `FhirPrimitive`, `getProperty`, `resourceType`, the node constructors)
> and its `parseResource` / `serializeResource` codec: it never imports a third-party JSON substrate.

```bash
npm install @cosyte/deid @cosyte/fhir
```

## De-identify a resource

Parse the JSON with `@cosyte/fhir`, hand the resource to `deidentifyFhir`, and serialize the result.
The resource below is synthetic.

```ts runnable
import { parseResource, serializeResource } from "@cosyte/fhir";
import { deidentifyFhir } from "@cosyte/deid/fhir";

const json = JSON.stringify({
  resourceType: "Patient",
  id: "example",
  identifier: [{ system: "urn:oid:2.16.840.1.113883.19.5", value: "ZZMRNFHIR01" }],
  name: [{ family: "ZZFAMILY", given: ["ZZGIVEN"] }],
  telecom: [{ system: "phone", value: "555-000-1234" }],
  gender: "female",
  birthDate: "1985-03-02",
  address: [{ line: ["ZZSTREET"], city: "ZZCITY", state: "MA", postalCode: "90210" }],
});

const { resource } = parseResource(json);
const { document, manifest } = deidentifyFhir(resource);

serializeResource(document); // => '{"resourceType":"Patient","id":"1","identifier":[{"system":"urn:oid:2.16.840.1.113883.19.5"}],"gender":"female","birthDate":"1985","address":[{"state":"MA","postalCode":"902"}]}'
manifest.map((entry) => entry.locus); // => ["Patient.id", "Patient.identifier.value", "Patient.name", "Patient.telecom", "Patient.birthDate", "Patient.address"]
```

A convenience wrapper parses, de-identifies, and re-serializes in one call:

```ts runnable
import { deidentifyFhirJson } from "@cosyte/deid/fhir";

const input = JSON.stringify({
  resourceType: "Patient",
  name: [{ family: "ZZFAMILY" }],
  birthDate: "1985-03-02",
});

const { json, manifest } = deidentifyFhirJson(input);
json; // => '{"resourceType":"Patient","birthDate":"1985"}'
manifest.length; // => 2
```

The built-in Safe Harbor policy uses **no keyed transform**, so a Safe Harbor pass over a resource
needs no `context` at all. Under a preset that keeps consistent keyed surrogates instead, a `context`
is required and calling without one when the resource needs it is a fatal `DEID_NO_KEY`: the engine
never falls back to an unkeyed surrogate. [Choose a policy](./choose-a-policy.md#use-a-profile) shows
how to pass one.

## What is located, and how it is transformed

FHIR is a **graph of typed resources**, so the locus map splits by resource role for the elements a
resource's type really does decide, and by the **element's own datatype** for the two it does not. A
person's name and a postal address are acted on wherever the graph puts them outside a person
resource, because which resource carries one is a choice the producing system made: the same home
address arrives at `Patient.address` from one sender and at `Location.address` from a home-health
sender, and coverage that depended on that choice would not be coverage at all. Inside a person
resource the map decides instead, which reaches the elements it lists and no others; that is the last
of the residuals below.

| Scope | Loci | Transform |
|---|---|---|
| **Person resources**: `Patient` / `RelatedPerson` / `Practitioner` / `Person` (+ nested `Patient.contact`, a relative) | `name`, `telecom`, `photo`, `address`, `birthDate`, `deceasedDateTime` | name/telecom/photo **removed**; `address` → safe **3-digit ZIP** (or `000` for a restricted prefix), finer geography dropped; dates → **year**, and a `birthDate` whose year shows an age over 89 is **removed** |
| **Every resource, by datatype** | any `HumanName`, any `Address`: `Organization.contact.name`, `Location.address`, `Organization.address`, a choice-type `locationAddress` | name **removed**; address → the same safe **3-digit ZIP** (or `000`), finer geography dropped, that a person resource's address gets |
| **Every resource (the universal PHI vectors)** | `identifier`, PHI-bearing dates, narrative `text.div`, `extension` / `modifierExtension` values, `Reference.display` | identifier **removed** under Safe Harbor, `system` retained (a consistent keyed surrogate by `system` only under a preset that does not claim the label); dates → **year**; narrative div / extension values / reference labels **blocked** |
| **Every resource's logical id** | the resource `id`; the id in a `Bundle.entry.fullUrl`, a `Reference.reference`, a `Bundle.entry.request.url` and a `Bundle.entry.response.location` | **replaced**, the same id by the same value throughout the call so every reference still resolves: a per-call stand-in under Safe Harbor, a keyed surrogate under a keyed policy (see [Resource ids and references](#resource-ids-and-references)) |
| **Contained resources and `Bundle` entries** | each nested resource | **walked**: the resource role is re-derived at every `resourceType`, so a contained `RelatedPerson` or a Bundled `Patient` is de-identified too |
| **Clinical resources**: `Observation`, `Condition`, `Encounter`, … | codes, values, units, statuses, reference ranges, reference wiring | **retained untouched** (the over-scrub guard); the wiring keeps every link, with the ids in it replaced |

Positive classification is **closed**, and that is the over-scrub guard: an element is a `HumanName`
only when every property it carries is one FHIR R4 defines on `HumanName`, **and** at least one of them
is a marker property (`family` / `given` / `prefix` / `suffix`), **and** that marker holds **the exact value shape R4 gives it**: `family` a single string, the other three repeating. An `Address` the same
way, with `line` repeating and `city` / `district` / `state` / `postalCode` / `country` single. So an
**organization's own `name`** is untouched (it is a plain string, never a `HumanName`), a
`CodeableConcept` carrying only its `text` is untouched (that shape is an `Observation` code, a dose
unit, or an order status far more often than it is a name), and every clinical code, value, unit, and
status survives byte-identical.

Reading the shape **per marker** is what separates a marker from an R4 element that merely shares its
name. The several elements called `country` are coded concepts where `Address.country` is a string, and
`Questionnaire.item`, `PlanDefinition.action`, and `RequestGroup.action` each carry a `prefix` that is a
single string where a name's `prefix` repeats. The latter two backbones make **every** child optional,
so `{ "prefix": "1." }` alone is a conformant numbered workflow step, and the shape is the only thing
that tells it from a person's name. The rule leans on no sibling those other elements happen to
require: that would be an assumption about the document, and this pass validates no conformance.

An identifier's Safe Harbor category is read from its `system` URI: the US-SSN system
(`http://hl7.org/fhir/sid/us-ssn` or its OID form) routes to the SSN category, every other identifier
to the medical record number category, and the configured policy's transform for that category is what
runs, with the `system` retained either way. A `Reference.display` (usually a person's name) is
blocked, while a `Coding.display` (a coded term such as `Sodium`) is retained: the two are distinguished
structurally, not by the property name.

Dates are detected by **value shape**: any primitive whose whole value is a real calendar date
(`YYYY-MM`, `YYYY-MM-DD`, or a full instant) with a valid month/day is generalized to its year, wherever
it sits, so a date in an unexpected element is caught too. A bare four-digit year is left as-is,
except at `birthDate`, where it is the very year the age rule reads: a year-only `birthDate` is
located and recorded like a full one, and removed when it shows an age over 89; a clinical code that merely looks date-ish (`2951-2`, `1234-56`) is
not mistaken for a date, so it survives.

## Resource ids and references

A FHIR server gives every resource a logical `id`, and the id of a `Patient` is often the medical record
number itself. So every resource's `id` (a `Bundle` entry's resource and a contained resource
included) is replaced, and so is the id part of every literal that names one: a `Bundle.entry.fullUrl`,
a `Reference.reference`, a `Bundle.entry.request.url` and a `Bundle.entry.response.location`. Each is
recorded at its own position under the medical record number category, and the same id gets the same
replacement everywhere in one call, so every reference still resolves to the resource it named.

What replaces it depends on the configured transform for that category:

- **`redact` or `block` (the Safe Harbor default):** a **stand-in**, the sequence number of the id
  among the distinct ids met in the call, counted from 1 in document order. It is not computed from the
  id, so two documents that differ only in their ids come out identical, and it means nothing outside
  the call. A UUID is replaced by a UUID (`00000000-0000-4000-8000-` and the number in twelve hex
  digits) and an OID by an OID under `2.25`, so a `urn:uuid:` or `urn:oid:` stays valid. The manifest
  code is `DEID_IDENTIFIER_SUBSTITUTED` and the entry is not flagged as a re-identification code. No
  key is needed.
- **`pseudonymize` or `hash` (the limited data set preset pseudonymizes):** the **keyed surrogate**.
  For an id that is neither a UUID nor an OID it is exactly what `registry.pseudonym(id)` returns under
  `pseudonymize`; a UUID becomes the first 128 bits of the same digest laid out as a version 8 UUID,
  and an OID those 128 bits as a decimal under `2.25`. The same key gives the same surrogate in every
  call, so a corpus links. The entry is flagged `reidentificationCode` and lands in the support
  report's keyed-surrogate inventory: Expert-Determination territory, not Safe Harbor.
- **Any other transform:** the id is removed, and every literal carrying it with it.

```ts runnable
import { deidentifyFhirJson } from "@cosyte/deid/fhir";

const input = JSON.stringify({
  resourceType: "Bundle",
  type: "collection",
  entry: [
    { fullUrl: "urn:uuid:zz-entry-1", resource: { resourceType: "Patient", id: "zz-mrn-123" } },
    {
      resource: {
        resourceType: "Observation",
        status: "final",
        code: { text: "ZZ test" },
        subject: { reference: "Patient/zz-mrn-123" },
      },
    },
  ],
});

const { json, manifest } = deidentifyFhirJson(input);
const out = JSON.parse(json);

out.entry[0].fullUrl; // => "urn:uuid:1"
out.entry[0].resource.id; // => "2"
out.entry[1].resource.subject.reference; // => "Patient/2"
manifest.map((entry) => entry.code); // => ["DEID_IDENTIFIER_SUBSTITUTED", "DEID_IDENTIFIER_SUBSTITUTED", "DEID_IDENTIFIER_SUBSTITUTED"]
```

The structure around an id is kept: the `#` of a contained reference, the resource type, the
`urn:uuid:` or `urn:oid:` scheme, and the server base of an absolute URL. A `/_history/vid` version
suffix is dropped, so a version-specific reference becomes a reference to the same resource. `#` alone
(a reference to the containing resource) and a resource type alone in a request url (a create) carry
no id and are kept.

What the pass cannot read is **removed** and recorded as blocked (the (R) catch-all), never kept:

- a literal whose resource type is not one of the 148 codes of the R4 `resource-types` code system, a
  search or conditional url (`Patient?identifier=...`), a relative, absolute or `#` id outside the R4
  `id` alphabet (a `urn:uuid:` or `urn:oid:` tail is replaced whatever it holds), a scheme
  other than `http`, `https`, `urn:uuid:` and `urn:oid:`, an empty string, and a value that is not a
  string (a number, an object);
- an **absolute reference to another server**: one whose base is not the base of a `fullUrl` in the
  same input. It cannot resolve inside the document, so a single resource carrying an absolute
  reference loses it too;
- a resource `id` held as an object or a list.

A removed reference leaves the rest of its `Reference` in place (its `type`, its `identifier` under
the identifier rule), and an empty one as `{}`.

## Fail closed

- A bare **unrecognized string** at a person resource's top level is **blocked**: a positive allow-list
  of recognized coded/administrative elements governs the person sweep, so a vendor `<Patient>`-level
  field cannot ride through in the clear (an open-ended allow-list can never satisfy Safe Harbor's
  open-ended category (R)).
- A **`display` that is not on a `Coding`** is a Reference person-label and is **blocked**, including a
  display-only (`{ display }`) or type+display reference that names no `reference`/`identifier` target. A
  Coding is identified positively (a `code`/`system` sibling), so `Coding.display` (a coded term) is
  retained; every other `display` fails closed.
- Every **extension value** is dropped: a complex `valueAddress` / `valueHumanName` / `valueIdentifier`,
  a `modifierExtension`, a deeply nested extension, and a primitive-level `_`-sibling extension alike.
  Extensions are the FHIR leak frontier; the `url` skeleton is kept, the payload is not.
- A **swept `Address` the pass cannot read faithfully** is removed **whole**, never partly retained: a
  `postalCode` that is not a whole zip code (a four-digit `0110` still has three leading digits, and
  keeping them would retain a fragment of something that was never a ZIP), or an unexpected JSON shape
  where R4 types a string at a part the reduction would re-emit verbatim. The street, the city, the
  state, the country, and the ZIP all go, and the disposition is recorded.
- At an element name R4 **types** as one of the two datatypes (`name`, `address`, the choice-type
  `locationAddress`, an open `valueAddress` / `valueHumanName`, the `HumanName` arms of the
  `defaultValue[x]`, `fixed[x]` and `pattern[x]` choices), **any** complex the classifier cannot
  pin down is **blocked whole** rather than descended into: a `{ text }` or `{ use, text }`
  representation with no part it can key on, a `{ family, given, … }` or `{ line, city, … }` carrying
  some property R4 does not define, and equally a `{ streetAddress, town, zip }` whose every property
  is foreign to both datatypes. The standard promised a name or an address there and the pass could not
  read the one it was handed, so the question is readability and not which keys arrived: adding an
  unrecognized sibling to an already unreadable element never unblocks it. Exactly two conformant R4
  backbones share one of those element names, `MedicinalProduct.name` and
  `SubstanceSpecification.name`, and each is excluded positively by the property R4 makes `1..1` on it
  plus its own closed property set. A plain string (or any other primitive) at one of those names is
  not the datatype either and is blocked whole too, except where R4 itself types the element as a
  string that names no person: `name` (`Organization.name`, `Location.name`) and the two `address`
  elements R4 types as a url, an `Endpoint`'s own and a `CapabilityStatement` messaging endpoint's,
  which stay untouched. A contact's name is not one of them. A string where R4 types a `HumanName`,
  at `Organization.contact.name` or `InsurancePlan.contact.name`, is blocked like any other. The
  `name` of a `ContactDetail` (the `contact`, `author`, `editor`, `endorser` and `reviewer` of the
  conformance and knowledge resources, and the `ContactDetail` arms of an open `value[x]`) is a
  string R4 documents as the name of the individual to contact, so it is removed as a name, and any
  other shape there is blocked. A contact sent as a bare string is blocked whole. The one other
  string R4 puts at `address`, `AuditEvent.agent.network.address`,
  holds a machine name, an IP address or a phone number, so it is blocked like any other. The
  disposition is recorded either way. That block is scoped to those element
  names deliberately, and the residual it leaves is stated below.
- **Free-text prose** is blocked by default: the `note` element (`Annotation.text` + author), a
  `Communication`/message `contentString`, and an **uncoded `valueString`** (the FHIR analogue of an
  HL7 OBX-5 typed `ST`, which the sibling HL7 adapter also fails closed on; a structured `valueQuantity`
  / `valueCodeableConcept` / `valueDateTime` result is retained).
- The narrative **`text.div`** is blocked at any depth (resource-, section-, entry-level).
- An **age held as a number** is located: an `Age` (`Condition.onsetAge`, `FamilyMemberHistory.ageAge`
  and `deceasedAge`, `Procedure.performedAge`, and the other `Age` arms), each bound of an age `Range`,
  and an `Observation.valueQuantity`, `valueInteger` or `valueRange` whose `code` names an age (LOINC
  `30525-0`, among others). Over 89
  the quantity's `value` is **removed** and its unit kept; 89 or under it is kept exactly as written,
  and the manifest records it either way (see [the limitations page](./limitations.md#ages-over-89)).
- `FamilyMemberHistory.bornDate`, each bound of `bornPeriod`, `bornString` and an
  `Observation.valueDateTime` coded as a birth date (LOINC `21112-8`) are **dates of birth**, like
  `birthDate`: a year that shows an age over 89 is removed.
- **`Location.position`** is removed, as geography finer than a State, unless the Location carries a
  facility `type` code (a hospital, an emergency room, a pharmacy, ...) in v3 RoleCode, every coding on
  its `type` is one, its `physicalType` names nothing that removes it, and it has no `partOf` (see
  [the limitations page](./limitations.md#ages-over-89)). A physical type alone never keeps a position.

## The two guarantees

- **No leak.** Every seeded PHI sentinel across the person resources, the universal vectors, the nested
  `contact` relative, and a contained resource is gone from the serialized output. An unmapped element or
  extension that could carry PHI is blocked, never passed through in the clear.
- **No over-scrub.** Clinical resources (observation and medication codes, values, units, result
  statuses, reference ranges, coded displays) are retained, and reference **wiring**
  (`Reference.reference` pointers) is preserved with the ids in it replaced, so intra-document linkage
  survives under a policy that withholds, pseudonymizes or hashes the medical record number category.

## Known limitations (this release)

- Extension values are **block-only**: there is no profile-aware retention, so a `us-core-*`
  demographic extension is dropped rather than kept.
- Resource ids are replaced, but **not every place an id can be written is read**. The server base of a
  `fullUrl`, and of an absolute reference to that server, is kept verbatim: it names the server, and
  a base that carries anything else carries it out. An id written anywhere else is passed through and
  counted as an unexamined position: `meta.versionId`, `meta.source`, `Bundle.link.url` (a search
  link), an `Attachment.url`, any other uri, and an element's own `id`.
- Under the Safe Harbor default the stand-ins are **per call**: the same resource de-identified in two
  calls gets two unrelated ids, and a reference from one call's output does not resolve in another's.
  Linkage across documents needs a keyed policy, which does not claim Safe Harbor.
- Free-text **prose** loci (`note`, `contentString`, uncoded `valueString`) fail closed by default; a
  semantic (NLP) narrative scrub and `contentAttachment` binary content remain out of scope.
- Three surfaces are still not reached because FHIR types no person at the position: a
  **`ContactPoint` outside a person resource** (a phone or an email on an `Organization`, a `Location`,
  or an `Endpoint`), an **organization's own `name`** (a plain string, never a `HumanName`), and the
  **individual's employer carried as a separate `Organization` resource**, which would need a
  cross-resource role derivation rather than a typed read.
- A fourth is the stated cost of the closed, shape-read classification: **a name or an address carrying
  a property R4 does not define, or carrying its only marker at a value shape R4 does not give that
  marker, at an element name R4 does not type as one of the two datatypes.** The unrecognized sibling
  or the wrong shape stops the classifier, and the fail-closed block above is scoped to the typed
  element names, because at any other name the same evidence is routinely something else:
  `{ "prefix": "1." }` is a conformant `RequestGroup.action` and not a person. Blocking it there would
  destroy conformant clinical and structural content, the mirror defect and the one no re-run restores.
  At a **typed** element name neither half is a residual: whatever the classifier declines is blocked
  whole.
- A fifth is the scope of the datatype sweep: **a name or an address inside a person resource, at a
  property the demographic map does not list.** The map has already decided `name`, `telecom`, `photo`,
  and `address` there, so the sweep does not run inside a person resource, and a vendor
  `Patient.alias` carrying `{ family, given }` is passed through where the same bytes on an
  `Organization` are removed.

The honesty line is unchanged: the output is **"Safe-Harbor-transformed per the configured policy,"**
never "de-identified" and never "HIPAA-compliant."

## Reference

- [`deidentifyFhir`](./api/@cosyte/deid/fhir.md#deidentifyfhir),
  [`deidentifyFhirJson`](./api/@cosyte/deid/fhir.md#deidentifyfhirjson) and
  [`FhirDeidResult`](./api/@cosyte/deid/fhir.md#fhirdeidresult)
- [`classifyFhirPersonalDatatype`](./api/@cosyte/deid/fhir.md#classifyfhirpersonaldatatype),
  [`categoryForIdentifierSystem`](./api/@cosyte/deid/fhir.md#categoryforidentifiersystem),
  [`PERSON_RESOURCE_TYPES`](./api/@cosyte/deid/fhir.md#person_resource_types) and
  [`isFhirDateValue`](./api/@cosyte/deid/fhir.md#isfhirdatevalue): the rules this page describes
- [`DeidOptions`](./api/@cosyte/deid.md#deidoptions)
- [Codes and categories](./codes-and-categories.md): every disposition and fatal code
