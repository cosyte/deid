---
id: guides-fhir
title: De-identifying FHIR
sidebar_position: 7
---

# De-identifying FHIR

The `@cosyte/deid/fhir` adapter is the FHIR R4 binding of the de-identification core. It locates PHI
**structurally** in a parsed FHIR resource — a `name` under a `Patient` is the patient's name because
the FHIR spec says so, never because a string "looked like" a name — applies the configured policy, and
returns a transformed resource model plus the core's **value-free manifest**.

> **`@cosyte/fhir` is an optional peer dependency.** Install it alongside `@cosyte/deid` to use this
> subpath; a consumer who only de-identifies FHIR pays for nothing else, and the core stays
> third-party-dependency-free. The adapter reaches FHIR data only through `@cosyte/fhir`'s exported model
> (`FhirComplex` / `FhirList` / `FhirPrimitive`, `getProperty`, `resourceType`, the node constructors)
> and its `parseResource` / `serializeResource` codec — it never imports a third-party JSON substrate.

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

A keyed transform (identifier pseudonymization) requires a `context`; calling without one when the
resource needs it is a fatal `DEID_NO_KEY` — the engine never falls back to an unkeyed surrogate.

## What is located, and how it is transformed

FHIR is a **graph of typed resources**, so the locus map splits by resource role. A `name` / `address` /
`telecom` is PHI inside a person resource; the same datatype in `Location` or `Organization` is
facility/administrative data and is left to the clinical-retain path — the FHIR analogue of the C-CDA
adapter sweeping only the header participations, never the clinical body.

| Scope | Loci | Transform |
|---|---|---|
| **Person resources** — `Patient` / `RelatedPerson` / `Practitioner` / `Person` (+ nested `Patient.contact`, a relative) | `name`, `telecom`, `photo`, `address`, `birthDate`, `deceasedDateTime` | name/telecom/photo **removed**; `address` → safe **3-digit ZIP** (or `000` for a restricted prefix), finer geography dropped; dates → **year** |
| **Every resource (the universal PHI vectors)** | `identifier`, PHI-bearing dates, narrative `text.div`, `extension` / `modifierExtension` values, `Reference.display` | identifier → consistent **surrogate** by `system` (keyed HMAC; a **US-SSN** system **removed**); dates → **year**; narrative div / extension values / reference labels **blocked** |
| **Contained resources & `Bundle` entries** | each nested resource | **walked** — the resource role is re-derived at every `resourceType`, so a contained `RelatedPerson` or a Bundled `Patient` is de-identified too |
| **Clinical resources** — `Observation`, `Condition`, `Encounter`, … | codes, values, units, statuses, reference ranges, reference wiring | **retained untouched** (the over-scrub guard) |

An identifier's Safe Harbor category is read from its `system` URI — the US-SSN system
(`http://hl7.org/fhir/sid/us-ssn` or its OID form) routes to **removed**, every other identifier to a
**consistent surrogate** with the `system` retained. A `Reference.display` (usually a person's name) is
blocked, while a `Coding.display` (a coded term such as `Sodium`) is retained — the two are distinguished
structurally, not by the property name.

Dates are detected by **value shape**: any primitive whose whole value is a real calendar date
(`YYYY-MM`, `YYYY-MM-DD`, or a full instant) with a valid month/day is generalized to its year, wherever
it sits — so a date in an unexpected element is caught too. A bare four-digit year is already
Safe-Harbor-safe and is left as-is; a clinical code that merely looks date-ish (`2951-2`, `1234-56`) is
not mistaken for a date, so it survives.

## Fail closed

- A bare **unrecognized string** at a person resource's top level is **blocked** — a positive allow-list
  of recognized coded/administrative elements governs the person sweep, so a vendor `<Patient>`-level
  field cannot ride through in the clear (an open-ended allow-list can never satisfy Safe Harbor's
  open-ended category (R)).
- A **`display` that is not on a `Coding`** is a Reference person-label and is **blocked** — including a
  display-only (`{ display }`) or type+display reference that names no `reference`/`identifier` target. A
  Coding is identified positively (a `code`/`system` sibling), so `Coding.display` (a coded term) is
  retained; every other `display` fails closed.
- Every **extension value** is dropped — a complex `valueAddress` / `valueHumanName` / `valueIdentifier`,
  a `modifierExtension`, a deeply nested extension, and a primitive-level `_`-sibling extension alike.
  Extensions are the FHIR leak frontier; the `url` skeleton is kept, the payload is not.
- **Free-text prose** is blocked by default — the `note` element (`Annotation.text` + author), a
  `Communication`/message `contentString`, and an **uncoded `valueString`** (the FHIR analogue of an
  HL7 OBX-5 typed `ST`, which the sibling HL7 adapter also fails closed on; a structured `valueQuantity`
  / `valueCodeableConcept` / `valueDateTime` result is retained).
- The narrative **`text.div`** is blocked at any depth (resource-, section-, entry-level).

## The two guarantees

- **No leak.** Every seeded PHI sentinel across the person resources, the universal vectors, the nested
  `contact` relative, and a contained resource is gone from the serialized output. An unmapped element or
  extension that could carry PHI is blocked, never passed through in the clear.
- **No over-scrub.** Clinical resources — observation and medication codes, values, units, result
  statuses, reference ranges, coded displays — are retained, and reference **wiring**
  (`Reference.reference` pointers) is preserved, so linkage survives identifier pseudonymization.

## Known limitations (this release)

- Extension values are **block-only** — no profile-aware retention yet, so a `us-core-*` demographic
  extension is dropped rather than kept (deferred to a later policy-profiles phase).
- Reference **wiring** and resource logical `id`s are preserved structurally; coordinated
  pseudonymization of resource ids across a corpus (so the same patient links across documents) is the
  longitudinal phase.
- Free-text **prose** loci (`note`, `contentString`, uncoded `valueString`) fail closed by default; a
  semantic (NLP) narrative scrub, `contentAttachment` binary content, and person names embedded in
  non-person resources (`Organization.contact.name`, `Location.address`) remain out of scope.

The honesty line is unchanged: the output is **"Safe-Harbor-transformed per the configured policy,"**
never "de-identified" and never "HIPAA-compliant."
