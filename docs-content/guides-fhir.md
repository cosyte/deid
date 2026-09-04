---
id: guides-fhir
title: De-identifying FHIR
sidebar_position: 7
---

# De-identifying FHIR

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

## Quickstart

```ts
import { parseResource, serializeResource } from "@cosyte/fhir";
import { deidentifyFhir } from "@cosyte/deid/fhir";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { resource } = parseResource(json);
const { document, manifest } = deidentifyFhir(resource, { context });

serializeResource(document); // spec-clean, de-identified FHIR JSON
manifest; // value-free audit: category + locus + disposition, never a value
```

A convenience wrapper parses, de-identifies, and re-serializes in one call:

```ts
import { deidentifyFhirJson } from "@cosyte/deid/fhir";
import { createDeidContext } from "@cosyte/deid";

const { json, manifest } = deidentifyFhirJson(input, {
  context: createDeidContext({ key: process.env.DEID_KEY! }),
});
```

The built-in Safe Harbor policy uses **no keyed transform**, so a Safe Harbor pass over a resource
needs no `context` at all. Under a preset that keeps consistent keyed surrogates instead, a `context`
is required and calling without one when the resource needs it is a fatal `DEID_NO_KEY`: the engine
never falls back to an unkeyed surrogate.

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
| **Person resources**: `Patient` / `RelatedPerson` / `Practitioner` / `Person` (+ nested `Patient.contact`, a relative) | `name`, `telecom`, `photo`, `address`, `birthDate`, `deceasedDateTime` | name/telecom/photo **removed**; `address` → safe **3-digit ZIP** (or `000` for a restricted prefix), finer geography dropped; dates → **year** |
| **Every resource, by datatype** | any `HumanName`, any `Address`: `Organization.contact.name`, `Location.address`, `Organization.address`, a choice-type `locationAddress` | name **removed**; address → the same safe **3-digit ZIP** (or `000`), finer geography dropped, that a person resource's address gets |
| **Every resource (the universal PHI vectors)** | `identifier`, PHI-bearing dates, narrative `text.div`, `extension` / `modifierExtension` values, `Reference.display` | identifier **removed** under Safe Harbor, `system` retained (a consistent keyed surrogate by `system` only under a preset that does not claim the label); dates → **year**; narrative div / extension values / reference labels **blocked** |
| **Contained resources & `Bundle` entries** | each nested resource | **walked**: the resource role is re-derived at every `resourceType`, so a contained `RelatedPerson` or a Bundled `Patient` is de-identified too |
| **Clinical resources**: `Observation`, `Condition`, `Encounter`, … | codes, values, units, statuses, reference ranges, reference wiring | **retained untouched** (the over-scrub guard) |

Positive classification is **closed**, and that is the over-scrub guard: an element is a `HumanName`
only when every property it carries is one FHIR R4 defines on `HumanName`, **and** at least one of them
(`family` / `given` / `prefix` / `suffix`) belongs to nothing else, **and** that one holds the value
shape R4 gives it (a string, or a list of strings). An `Address` the same way
(`line` / `city` / `district` / `state` / `postalCode` / `country`). So an **organisation's own `name`**
is untouched (it is a plain string, never a `HumanName`), a `CodeableConcept` carrying only its `text`
is untouched (that shape is an `Observation` code, a dose unit or an order status far more often than
it is a name), a conformant `Questionnaire.item` is untouched (its `prefix` is a `HumanName` marker
name and nothing more), the several R4 elements called `country` that are coded concepts rather than
the string `Address.country` is are untouched, and every clinical code, value, unit and status survives
byte-identical.

An identifier's Safe Harbor category is read from its `system` URI: the US-SSN system
(`http://hl7.org/fhir/sid/us-ssn` or its OID form) routes to the SSN category, every other identifier
to the medical record number category, and the configured policy's transform for that category is what
runs, with the `system` retained either way. A `Reference.display` (usually a person's name) is
blocked, while a `Coding.display` (a coded term such as `Sodium`) is retained: the two are distinguished
structurally, not by the property name.

Dates are detected by **value shape**: any primitive whose whole value is a real calendar date
(`YYYY-MM`, `YYYY-MM-DD`, or a full instant) with a valid month/day is generalized to its year, wherever
it sits, so a date in an unexpected element is caught too. A bare four-digit year is already
Safe-Harbor-safe and is left as-is; a clinical code that merely looks date-ish (`2951-2`, `1234-56`) is
not mistaken for a date, so it survives.

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
  state, the country and the ZIP all go, and the disposition is recorded.
- At an element name R4 **types** as one of the two datatypes (`name`, `address`, the choice-type
  `locationAddress`, an open `valueAddress` / `valueHumanName`), **any** complex the classifier cannot
  pin down is **blocked whole** rather than descended into: a `{ text }` or `{ use, text }`
  representation with no part it can key on, a `{ family, given, … }` or `{ line, city, … }` carrying
  some property R4 does not define, and equally a `{ streetAddress, town, zip }` whose every property
  is foreign to both datatypes. The standard promised a name or an address there and the pass could not
  read the one it was handed, so the question is readability and not which keys arrived: adding an
  unrecognized sibling to an already unreadable element never unblocks it. Exactly two conformant R4
  backbones share one of those element names, `MedicinalProduct.name` and
  `SubstanceSpecification.name`, and each is excluded positively by the property R4 makes `1..1` on it
  plus its own closed property set; a plain string there (`Organization.name`, `Endpoint.address`) is
  never a candidate. The disposition is recorded either way. That block is scoped to those element
  names deliberately, and the residual it leaves is stated below.
- **Free-text prose** is blocked by default: the `note` element (`Annotation.text` + author), a
  `Communication`/message `contentString`, and an **uncoded `valueString`** (the FHIR analogue of an
  HL7 OBX-5 typed `ST`, which the sibling HL7 adapter also fails closed on; a structured `valueQuantity`
  / `valueCodeableConcept` / `valueDateTime` result is retained).
- The narrative **`text.div`** is blocked at any depth (resource-, section-, entry-level).

## The two guarantees

- **No leak.** Every seeded PHI sentinel across the person resources, the universal vectors, the nested
  `contact` relative, and a contained resource is gone from the serialized output. An unmapped element or
  extension that could carry PHI is blocked, never passed through in the clear.
- **No over-scrub.** Clinical resources (observation and medication codes, values, units, result
  statuses, reference ranges, coded displays) are retained, and reference **wiring**
  (`Reference.reference` pointers) is preserved, so intra-document linkage survives whichever
  transform the configured policy applies to an identifier.

## Known limitations (this release)

- Extension values are **block-only**: there is no profile-aware retention, so a `us-core-*`
  demographic extension is dropped rather than kept.
- Reference **wiring** and resource logical `id`s are preserved structurally; coordinated
  pseudonymization of resource ids across a corpus (so the same patient links across documents) is
  **not** performed.
- Free-text **prose** loci (`note`, `contentString`, uncoded `valueString`) fail closed by default; a
  semantic (NLP) narrative scrub and `contentAttachment` binary content remain out of scope.
- Three surfaces are still not reached because FHIR types no person at the position: a
  **`ContactPoint` outside a person resource** (a phone or an email on an `Organization`, a `Location`
  or an `Endpoint`), an **organisation's own `name`** (a plain string, never a `HumanName`), and the
  **individual's employer carried as a separate `Organization` resource**, which would need a
  cross-resource role derivation rather than a typed read.
- A fourth is the stated cost of the closed classification: **a name or an address carrying a property
  R4 does not define, at an element name R4 does not type as one of the two datatypes.** The
  unrecognized sibling stops the classifier, and the fail-closed block above is scoped to the typed
  element names, because at any other name the same evidence is routinely something else:
  `{ prefix, linkId, text, type }` is a conformant `Questionnaire.item` and not a person. Blocking it
  there would destroy conformant clinical and structural content, the mirror defect and the one no
  re-run restores.
- A fifth is the scope of the datatype sweep: **a name or an address inside a person resource, at a
  property the demographic map does not list.** The map has already decided `name`, `telecom`, `photo`
  and `address` there, so the sweep does not run inside a person resource, and a vendor
  `Patient.alias` carrying `{ family, given }` is passed through where the same bytes on an
  `Organization` are removed.

The honesty line is unchanged: the output is **"Safe-Harbor-transformed per the configured policy,"**
never "de-identified" and never "HIPAA-compliant."
