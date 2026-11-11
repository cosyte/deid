# @cosyte/deid/ccda

`@cosyte/deid/ccda`: the **C-CDA de-identification adapter**. The C-CDA binding of the
format-agnostic core: it locates PHI **structurally** in an HL7 CDA R2.1 document,
applies the configured de-identification policy, and returns a transformed `CcdaDocument` plus the
core's value-free manifest.

**`@cosyte/ccda` is an optional peer dependency**, consumed only from this subpath: a consumer who
only de-identifies C-CDA installs it alongside `@cosyte/deid`; the core stays third-party-dep-free.
The adapter reaches the CDA DOM **only** through `@cosyte/ccda`'s exported, XXE-hardened
`parseSecureXml` and re-serializes through the DOM node the parser hands back: it never imports the
XML substrate (`@xmldom/xmldom`, the parser's own ratified dependency) directly, so
`@cosyte/deid` declares no third-party runtime dependency of its own.

**What it covers.** The structured PHI loci of the CDA **header participations**: `recordTarget`
(patient) + the nested `guardian`, and `author` / `informant` / `authenticator` /
`legalAuthenticator` / `dataEnterer` / `participant` / `custodian` / `documentationOf` /
`componentOf` (relatives / providers / contacts): via the cited [CCDA\_LOCUS\_MAP](#ccda_locus_map):
person `<name>` and `<telecom>` removed; person-role `<id>` pseudonymized (assigning root retained,
SSN-rooted ids redacted); `<addr>` reduced to the safe 3-digit ZIP; `<birthTime>` / participation and
encounter dates generalized to year. **Fail closed** everywhere else: section narrative `<text>`
blocks and the unstructured `nonXMLBody` are blocked (no naive scrub); an element carrying a value
that is neither mapped PHI nor recognized coded/administrative structure is blocked; foreign / `sdtc`
elements are blocked. Coded clinical structure (the **structuredBody** entries' codes, values,
units, and statuses) is **retained untouched** (the over-scrub guard); a `<name>` there is a drug or
material name, never a person, and survives. The honesty line is unchanged: the output is
**"Safe-Harbor-transformed per the configured policy"**, never "de-identified".

**Known limitations.** Narrative is block-only (no semantic narrative de-id).
Within the **retained** clinical body, entry-level service dates (`effectiveTime`), entry ids,
in-entry performer names, and family-history relative demographics are **not** de-identified:
exactly mirroring the HL7 v2 adapter's retained-clinical-segment boundary; forgetting one fails
**safe** (retained), never leaked, because the leak surface this adapter covers is the header +
narrative. The
document `id` / `title` / `code` envelope is retained (like HL7's MSH); the address generalization
keeps state + country (permitted) and the safe 3-digit ZIP, dropping every finer component.

**Every one of those positions is enumerated.** A value-bearing position inside the retained body or
the envelope that no locus rule names is **counted and located** as an unexamined residual on
[CcdaDeidResult.unexaminedResiduals](#unexaminedresiduals), at its own coordinates (an element's attribute, an
element's direct text). The unit is that position and never the element it sits on, so a
`<telecom use="HP" value="...">` whose `@value` is removed still reports its `@use`, which is handed
through untouched. Nothing is transformed on account of it: the measurement exists so an empty
residual inventory can be told apart from an unmeasured one.

## Interfaces

### CcdaCoord

A write-back coordinate: a direct handle to the DOM node one extracted locus came from, plus how to
write the transformed value back onto it. Carries no value.

#### Properties

##### edit

> `readonly` **edit**: [`CcdaEditKind`](#ccdaeditkind)

How to write the transformed value back.

##### node

> `readonly` **node**: `Element`

The DOM element to edit.

***

### CcdaDeidResult

The result of de-identifying a C-CDA document: the transformed document plus the core's value-free
manifest of every category acted on and every locus blocked.

#### Example

```ts
import { parseCcda } from "@cosyte/ccda";
import { deidentifyCcda } from "@cosyte/deid/ccda";

const result: CcdaDeidResult = deidentifyCcda(parseCcda(xml), {});
result.document.toString(); // de-identified C-CDA XML
```

#### Properties

##### document

> `readonly` **document**: `CcdaDocument`

The de-identified document: a fresh, independent CcdaDocument; the input is never mutated.

##### manifest

> `readonly` **manifest**: readonly [`DeidManifestEntry`](../deid.md#deidmanifestentry)[]

The value-free audit of every action, in locus order (never a value, never a key).

##### unexaminedResiduals

> `readonly` **unexaminedResiduals**: readonly [`UnexaminedResidual`](../deid.md#unexaminedresidual)[]

The manifest's **second list**: every value-bearing position this pass handed through that **no
locus rule named**, counted and located. The retained clinical body's entry dates, entry ids,
in-entry performer names and family-history relative demographics are measured here rather than
passing through in silence. An empty list is a **measured zero**, not a silence.

***

### CcdaExtraction

The paired output of [extractCcdaLoci](#extractccdaloci): loci for the engine + coordinates for the applier.

#### Properties

##### coords

> `readonly` **coords**: [`CcdaCoord`](#ccdacoord)[]

The write-back coordinates, index-aligned with [loci](#loci).

##### loci

> `readonly` **loci**: [`GenericLocus`](../deid.md#genericlocus)[]

The located candidate values, in document order.

##### unexaminedResiduals

> `readonly` **unexaminedResiduals**: readonly [`UnexaminedResidual`](../deid.md#unexaminedresidual)[]

Every **value-bearing position the pass hands through that no locus rule named**: an attribute or a
run of direct text on an element inside the retained clinical body, the document envelope, or a
wrapper the header sweep passed over. The unit is the position, so an attribute no rule reached is
listed even where the pass acted on a *different* attribute of the same element. Counted and
located, never transformed.

## Type Aliases

### CcdaEditKind

> **CcdaEditKind** = `"clear-element"` \| `"clear-telecom"` \| `"id"` \| `"date-value"` \| `"age-value"` \| `"address"` \| `"block"` \| `"block-text"`

How the applier writes one transformed locus back onto the CDA DOM node it came from.

***

### CcdaElementMode

> **CcdaElementMode** = `"name"` \| `"telecom"` \| `"addr"` \| `"date"` \| `"id"`

How the extractor turns a mapped C-CDA element into a locus and how the applier writes it back:

- `name`: a person `<name>` (patient / guardian / author / informant / relative). Redacted: the
  whole element is cleared. In the header, `<name>` is always a person or organization name (never a
  clinical drug/material name: those live in the retained clinical body), so it is always PHI.
- `telecom`: a `<telecom value="tel:…|mailto:…|fax:…">`. Redacted: the `@value` is cleared.
- `addr`: a structured `<addr>`. Generalized: only the Safe Harbor 3-digit ZIP (`postalCode`) is
  kept (state / country retained as permitted); every finer geographic child is dropped.
- `date`: a `<birthTime>` / `<time>` / `<effectiveTime>` calendar timestamp (its `@value`, and any
  `low`/`high`/`center` child `@value`). Generalized to year. Dosing-period `PIVL_TS`/`EIVL_TS`
  intervals are **not** dates and are excluded (they live in the clinical body, never swept).
- `id`: an `<id root= extension=>` at a person role (MRN / SSN / member / account). Pseudonymized:
  only the id value component is replaced (assigning-authority root retained), with an SSN-rooted id
  routed to the SSN category (redacted): the structural, parser-typed knife-edge.

## Variables

### CCDA\_CODED\_ELEMENTS

> `const` **CCDA\_CODED\_ELEMENTS**: `ReadonlySet`\<`string`\>

The **positive allow-list** of recognized coded / administrative / structural CDA element names whose
own value is coded structure, not free PHI: the over-scrub guard. This is an **explicit set**, never
a `localName.endsWith("Code")` pattern: an open-ended suffix match would silently retain an unknown
vendor element (e.g. `<customPatientCode>`) and leak the PHI it carries. An element on this list is
not itself acted on, **but the extractor still descends into it**: a `<code>` can wrap a free-text
`<originalText>` and a `<maritalStatusCode>` could nest a `<name>`; those children are handled by the
normal walk (blocked / redacted), never passed through because their parent was recognized. Anything
**not** on this list that carries a value fails closed (the (R) catch-all).

***

### CCDA\_ENVELOPE\_ELEMENTS

> `const` **CCDA\_ENVELOPE\_ELEMENTS**: `ReadonlySet`\<`string`\>

The **document-envelope** elements: direct children of `ClinicalDocument` that carry no direct
patient/relative Safe Harbor identifier and are retained untouched, exactly as HL7 v2's MSH envelope
is. The document `effectiveTime` is handled separately (it is a service-related
date → generalized); everything here is passed through.

#### Example

```ts
import { CCDA_ENVELOPE_ELEMENTS } from "@cosyte/deid/ccda";

CCDA_ENVELOPE_ELEMENTS.has("confidentialityCode"); // => true
```

***

### CCDA\_LOCUS\_MAP

> `const` **CCDA\_LOCUS\_MAP**: `Readonly`\<`Record`\<`string`, \{ `category`: [`SafeHarborCategory`](../deid.md#safeharborcategory); `mode`: [`CcdaElementMode`](#ccdaelementmode); \}\>\>

The C-CDA element-type map: local element name → its handling mode and the Safe Harbor category it
carries. Applied by the extractor only inside a **header person participation**; the clinical body is
retained untouched (the over-scrub guard) and narrative `<text>` fails closed.

#### Example

```ts
import { CCDA_LOCUS_MAP } from "@cosyte/deid/ccda";

CCDA_LOCUS_MAP.name?.category;   // => "NAMES"
CCDA_LOCUS_MAP.birthTime?.mode;  // => "date"
```

## Functions

### applyCcda()

> **applyCcda**(`transformed`, `coords`): `void`

Write the engine's transformed loci back onto the CDA DOM the extractor walked. Mutates the tree in
place (it is a fresh parse, never the caller's model). `transformed` and `coords` are index-aligned.

#### Parameters

##### transformed

readonly [`TransformedLocus`](../deid.md#transformedlocus)[]

The engine's transformed loci, in extraction order.

##### coords

readonly [`CcdaCoord`](#ccdacoord)[]

The write-back coordinates, index-aligned with `transformed`.

#### Returns

`void`

#### Example

```ts
import { parseSecureXml, resolveLimits } from "@cosyte/ccda";
import { extractCcdaLoci, applyCcda } from "@cosyte/deid/ccda";
import { deidentify } from "@cosyte/deid";

const dom = parseSecureXml(xml, resolveLimits(undefined), () => {});
const { loci, coords } = extractCcdaLoci(dom.documentElement);
const { document } = deidentify({ loci }, { context });
applyCcda(document.loci, coords);
// dom now serializes to spec-clean, de-identified C-CDA XML.
```

***

### categoryForIdRoot()

> **categoryForIdRoot**(`root`, `fallback?`): [`SafeHarborCategory`](../deid.md#safeharborcategory)

Resolve the Safe Harbor category for a person-role `<id>` from its assigning-authority `root` OID: an
SSN-rooted id is an **SSN** (redacted); every other person/organization id defaults to **MRN**
(pseudonymized to a consistent surrogate, the assigning authority retained). This is the structural,
parser-typed way to tell an SSN from an MRN at a CDA id locus: the C-CDA analogue of HL7's CX-5
identifier-type routing knife-edge.

#### Parameters

##### root

`string` \| `undefined`

The `id/@root` OID/UUID, or `undefined`.

##### fallback?

[`SafeHarborCategory`](../deid.md#safeharborcategory) = `C.MRN`

The category to use when the root is unrecognized/absent (defaults to MRN).

#### Returns

[`SafeHarborCategory`](../deid.md#safeharborcategory)

The resolved Safe Harbor category.

#### Example

```ts
import { categoryForIdRoot, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid/ccda";

categoryForIdRoot("2.16.840.1.113883.4.1"); // => "SSN"
categoryForIdRoot("2.16.840.1.113883.19.5"); // => "MRN"
```

***

### deidentifyCcda()

> **deidentifyCcda**(`doc`, `options?`): [`CcdaDeidResult`](#ccdadeidresult)

De-identify a parsed C-CDA document under a policy (Safe Harbor by default). PHI is located
structurally from the CDA header participations and the section narrative; the input document is
never mutated (the adapter re-parses its serialized form into a fresh, independent DOM to edit).

The output is **"Safe-Harbor-transformed per the configured policy"**: it is not certified
de-identified, and Expert Determination is not rendered.

#### Parameters

##### doc

`CcdaDocument`

The parsed C-CDA document to de-identify (produced by `@cosyte/ccda`'s `parseCcda`).

##### options?

[`DeidOptions`](../deid.md#deidoptions) = `{}`

The policy and (for keyed transforms: id pseudonymization) the key context. A keyed
  transform with no context is a fatal `DEID_NO_KEY`, never an unkeyed fallback.

#### Returns

[`CcdaDeidResult`](#ccdadeidresult)

The de-identified document and the value-free manifest.

#### Throws

DeidError `EMPTY_INPUT` when the document carries no serializable `ClinicalDocument`
  root; `DEID_NO_KEY` when a keyed transform is required but no key context was supplied.

#### Example

```ts
import { parseCcda } from "@cosyte/ccda";
import { deidentifyCcda } from "@cosyte/deid/ccda";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { document, manifest } = deidentifyCcda(parseCcda(xml), { context });
// document.getPatient()?.name === undefined  (name removed)
// manifest records each category + locus, never a value.
```

***

### extractCcdaLoci()

> **extractCcdaLoci**(`root`): [`CcdaExtraction`](#ccdaextraction)

Walk a parsed CDA document element (`ClinicalDocument`) and extract every PHI-bearing (or fail-closed)
locus, structurally, from the CDA header participations and the section narrative. Never mutates the
tree: the applier writes onto it after the engine transforms the loci.

The document is also **enumerated**: every value-bearing position it hands through that no rule above
named is counted and located as an unexamined residual. That is where the retained clinical body's
entry dates, entry ids, in-entry performer names and family-history relative demographics show up, and
the document envelope's own values with them. Nothing is transformed on account of the measurement.

#### Parameters

##### root

`Element`

The `ClinicalDocument` DOM element (from `parseSecureXml(...).documentElement`).

#### Returns

[`CcdaExtraction`](#ccdaextraction)

The loci (for the engine), their index-aligned write-back coordinates, and the unexamined
  residual positions the pass hands through.

#### Throws

DeidError `DEID_POSITIONS_UNENUMERABLE` when the document's value-bearing positions
  cannot be enumerated: the pass fails rather than emit a zero or a partial count.

#### Example

```ts
import { parseSecureXml, resolveLimits } from "@cosyte/ccda";
import { extractCcdaLoci } from "@cosyte/deid/ccda";

const dom = parseSecureXml(xml, resolveLimits(undefined), () => {});
const { loci } = extractCcdaLoci(dom.documentElement);
loci.length; // number of located candidate values
```

***

### isRetainedCcdaElement()

> **isRetainedCcdaElement**(`localName`): `boolean`

`true` when an element is on the recognized coded/structural allow-list ([CCDA\_CODED\_ELEMENTS](#ccda_coded_elements)):
its own value is retained untouched (the over-scrub guard). The extractor still descends into it, so
a name / address / free-text child a vendor nested inside is handled, never passed through.

#### Parameters

##### localName

`string`

The element's local name (namespace already confirmed HL7 v3 by the caller).

#### Returns

`boolean`

`true` when the element is a recognized coded/structural non-identifier.

#### Example

```ts
import { isRetainedCcdaElement } from "@cosyte/deid/ccda";

isRetainedCcdaElement("administrativeGenderCode"); // => true
isRetainedCcdaElement("customPatientCode");        // => false  (unknown → fails closed)
isRetainedCcdaElement("streetAddressLine");        // => false
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
