# @cosyte/deid/ncpdp

`@cosyte/deid/ncpdp`: the **NCPDP de-identification adapter**. The NCPDP binding of the
format-agnostic core: it locates PHI **structurally** in a parsed `@cosyte/ncpdp`
**Telecommunication (vD.0)** transaction, applies the configured de-identification policy, and returns
the de-identified Telecom byte stream plus the core's value-free manifest.

**`@cosyte/ncpdp` is an optional peer dependency**, consumed only from this subpath: a consumer who
only de-identifies NCPDP installs it alongside `@cosyte/deid`; the core stays third-party-dep-free. The
adapter reaches NCPDP data **only** through `@cosyte/ncpdp`'s own exported Telecom model
(`TelecomTransaction` / `TelecomSegment` / `TelecomField`) and its `parseTelecom` / `serializeTelecom`
codec: it never touches a third-party substrate.

**What it covers (Telecom vD.0).** The Patient (`01`), Prescriber (`03`), Insurance (`04`),
Coordination-of-Benefits (`05`) and Prior Authorization (`12`) segments, the dates of the Claim
segment (`07`) and of the response DUR segment (`24`), plus the header's Date of Service:
- **Patient (`01`)**: name (`CA`/`CB`) and phone (`CQ`) removed; street (`CM`) and city (`CN`)
  removed; ZIP (`CP`) generalized to its safe 3-digit form; date of birth (`C4`) generalized to year;
  patient id (`CY`) pseudonymized. Gender and state retained.
- **Insurance (`04`)**: cardholder id (`C2`) and group id (`C1`) pseudonymized; cardholder name
  (`CC`/`CD`) removed. Person code retained.
- **Prescriber (`03`)**: the prescriber id (`DB`) removed (prescriber identifiers are in scope for
  NCPDP: the deliberate asymmetry with the X12 adapter, which retains provider identity).
- **Coordination of Benefits (`05`)**: the other-payer cardholder id (`NU`) and group id (`MJ`)
  pseudonymized; the other-payer date (`E8`) generalized to year.
- **Claim (`07`)**: the Date Prescription Written (`DE`) and the Associated Prescription/Service Date
  (`EP`) generalized to year; every other Claim field retained.
- **Prior Authorization (`12`)**: the type code (`EU`) kept in the form of a code; the number
  submitted (`EV`) and every other field (a representative's name or address, say) removed.
- **Response DUR / PPS (`24`)**: the Previous Date Of Fill (`FU`) generalized to year.
- **Header**: Date of Service generalized to year.

**Fail closed.** A free-text field (`544-FY` DUR free text, `504-F4` response message) is blocked
wherever it appears; a segment that is neither mapped nor on the recognized clinical / financial retain
list (including a response Patient / Insurance segment) is blocked field-by-field. Clinical and
financial values (NDC drug codes, quantities, days supply, pricing amounts, DUR reason codes) are
**retained untouched** (the over-scrub guard). The output is **"Safe-Harbor-transformed per the
configured policy"**, never "de-identified".

**NCPDP SCRIPT is REFUSED, and the refusal is a behaviour rather than a paragraph.**
`@cosyte/ncpdp`'s SCRIPT (ePrescribing XML) surface cannot be structurally de-identified faithfully
through its public API: `serializeScript` emits **only the modeled fields** (a parse → serialize
round-trip drops every unmodeled XML element), and the SCRIPT `Patient` model carries **no address,
phone, or patient-id** field. Performing a partial de-id through that surface would silently drop
unmodeled content and leave unmodeled patient identifiers unhandled: a false-safety hazard, which
the fail-closed posture forbids. So an entry point here that is handed SCRIPT **refuses it**, with a
typed, value-free `DEID_FORMAT_UNSUPPORTED` diagnostic naming the format and the parser-surface
reason, and returns no document, no manifest and no partial output at all (see
`./script-refusal.js`). Telecom callers are untouched by the guard.

## Interfaces

### TelecomDeidResult

The result of de-identifying an NCPDP Telecom transaction: the de-identified Telecom byte stream plus
the core's value-free manifest of every category acted on and every locus blocked.

#### Example

```ts
import { parseTelecom } from "@cosyte/ncpdp/telecom";
import { deidentifyTelecom } from "@cosyte/deid/ncpdp";
import { createDeidContext } from "@cosyte/deid";

const tx = parseTelecom(raw);
const result: TelecomDeidResult = deidentifyTelecom(tx, {
  context: createDeidContext({ key: process.env.DEID_KEY! }),
});
result.telecom;  // transformed NCPDP Telecom text
result.manifest; // value-free audit: category + locus, never a value
```

#### Properties

##### manifest

> `readonly` **manifest**: readonly [`DeidManifestEntry`](../deid.md#deidmanifestentry)[]

The value-free audit of every action, in locus order (never a value, never a key).

##### telecom

> `readonly` **telecom**: `string`

The de-identified NCPDP Telecom byte stream.

##### unexaminedResiduals

> `readonly` **unexaminedResiduals**: readonly [`UnexaminedResidual`](../deid.md#unexaminedresidual)[]

The manifest's **second list**: every value-bearing field this pass handed through that **no locus
rule named**, counted and located. A retained clinical / financial segment contributes all of its
fields, and the fixed header contributes every position but the one Date of Service a rule reaches.
An empty list is a **measured zero**, not a silence.

***

### TelecomExtraction

The paired output of [extractTelecomLoci](#extracttelecomloci): loci for the engine + coordinates for the applier.

#### Properties

##### coords

> `readonly` **coords**: [`TelecomCoord`](#telecomcoord)[]

The write-back coordinates, index-aligned with [loci](#loci).

##### loci

> `readonly` **loci**: [`GenericLocus`](../deid.md#genericlocus)[]

The located candidate values, in document order.

##### unexaminedResiduals

> `readonly` **unexaminedResiduals**: readonly [`UnexaminedResidual`](../deid.md#unexaminedresidual)[]

Every **value-bearing field the pass hands through that no locus rule named**: the fields of a
retained clinical / financial segment, and the positions of the transmission header that is emitted
(the response header's own, on a response). Counted and located, never transformed.

***

### TelecomFieldRule

A mapped PHI-bearing field within a segment: the mode and (for the direct modes) its category.

#### Properties

##### category?

> `readonly` `optional` **category?**: [`SafeHarborCategory`](../deid.md#safeharborcategory)

The Safe Harbor category, for the direct modes (`redact` / `date` / `zip` / `id`).

##### dateOfBirth?

> `readonly` `optional` **dateOfBirth?**: `boolean`

For `date` fields only: `true` when the field is a **date of birth**, so a year that shows an age
over 89 is removed rather than kept (see `GenericLocus.dateOfBirth`).

##### mode

> `readonly` **mode**: [`TelecomFieldMode`](#telecomfieldmode)

How to extract and rewrite the field value.

## Type Aliases

### TelecomCoord

> **TelecomCoord** = \{ `target`: `"header-date-of-service"`; \} \| \{ `fieldIndex`: `number`; `segmentIndex`: `number`; `target`: `"field"`; \}

A write-back coordinate: the structural location of one extracted locus in the transaction. Either
the fixed header's Date of Service, or the field at `fieldIndex` of the segment at `segmentIndex`.
Carries no value.

***

### TelecomFieldMode

> **TelecomFieldMode** = `"redact"` \| `"date"` \| `"zip"` \| `"id"` \| `"block"`

How the extractor turns a mapped NCPDP field into a locus and how the applier rewrites it: the same
mode vocabulary as the X12 adapter (the transform itself is chosen by the engine from the category):

- `redact`: a direct identifier with no analytic value (a name, a phone number). Cleared to `""`.
- `date`: a date value (date of birth, other-payer date). Generalized to year.
- `zip`: a postal code (`325-CP`). Generalized to the safe 3-digit form.
- `id`: an identifier value (patient id, cardholder id, group id). Pseudonymized to a consistent
  keyed surrogate (or removed when the category resolves to SSN).
- `block`: a value with no clean structured generalization (a street line, a city, a prescriber
  identifier). Fails **closed**: removed and recorded as category (R).

## Variables

### NCPDP\_MULTI\_TRANSACTION\_REFUSAL\_MESSAGE

> `const` **NCPDP\_MULTI\_TRANSACTION\_REFUSAL\_MESSAGE**: `string`

The refusal diagnostic, in full. Fixed text this library owns: it carries no value read from the
document, no key and no offset, so it is safe to log wherever a `DeidError` message is safe to log.

#### Example

```ts
import { NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE } from "@cosyte/deid/ncpdp";
NCPDP_MULTI_TRANSACTION_REFUSAL_MESSAGE.includes("more than one transaction"); // => true
```

***

### NCPDP\_SCRIPT\_REFUSAL\_MESSAGE

> `const` **NCPDP\_SCRIPT\_REFUSAL\_MESSAGE**: `string`

The refusal diagnostic, in full. Fixed text this library owns: it names the format and states the
parser-surface reason, and it carries no value read from the document, no key and no offset, so it
is safe to log wherever a `DeidError` message is safe to log.

#### Example

```ts
import { NCPDP_SCRIPT_REFUSAL_MESSAGE } from "@cosyte/deid/ncpdp";

NCPDP_SCRIPT_REFUSAL_MESSAGE.includes("SCRIPT"); // => true
```

***

### TELECOM\_FREE\_TEXT\_FIELDS

> `const` **TELECOM\_FREE\_TEXT\_FIELDS**: `ReadonlySet`\<`string`\>

NCPDP Telecom **free-text** field ids that carry human prose and therefore any of the 18 categories:
blocked by default, never scrubbed by a naive pass, wherever they appear (including
inside an otherwise-retained clinical / response segment). `544-FY` is the DUR free-text message,
`504-F4` is the response Message field, and `526-FQ` is the response Additional Message Information.

#### Example

```ts
import { TELECOM_FREE_TEXT_FIELDS } from "@cosyte/deid/ncpdp";

TELECOM_FREE_TEXT_FIELDS.has("FY"); // => true (DUR free text, fails closed)
```

***

### TELECOM\_LOCUS\_MAP

> `const` **TELECOM\_LOCUS\_MAP**: `Readonly`\<`Record`\<`string`, `Readonly`\<`Record`\<`string`, [`TelecomFieldRule`](#telecomfieldrule)\>\>\>\>

The full NCPDP Telecom locus map: segment id → its mapped PHI-bearing fields. A segment absent from
this map is either a recognized clinical / financial segment (retained, [TELECOM\_RETAIN\_SEGMENTS](#telecom_retain_segments))
or an unknown segment (failed closed by the extractor).

#### Example

```ts
import { TELECOM_LOCUS_MAP } from "@cosyte/deid/ncpdp";

TELECOM_LOCUS_MAP["01"]?.CB?.category; // => "NAMES"  (Patient Last Name)
```

***

### TELECOM\_RETAIN\_SEGMENT\_REASONS

> `const` **TELECOM\_RETAIN\_SEGMENT\_REASONS**: `Readonly`\<`Record`\<`string`, `string`\>\>

**Why each kept Telecom segment is kept**: segment id → the reason it is retained rather than mapped.
A segment is kept whole only with a reason listed here, and [TELECOM\_RETAIN\_SEGMENTS](#telecom_retain_segments) is read off
this table, so the two cannot drift apart. The reasons are the over-scrub guard: each segment carries
the drug, quantity, pricing, clinical or adjudication values a released claim exists to keep, and
removing them would destroy what the output is for.

Kept is not unexamined: a free-text field in any of them fails closed, a dated field
[TELECOM\_RETAINED\_SEGMENT\_RULES](#telecom_retained_segment_rules) names is transformed, and every other populated field is counted
as an unexamined residual.

#### Example

```ts
import { TELECOM_RETAIN_SEGMENT_REASONS } from "@cosyte/deid/ncpdp";

TELECOM_RETAIN_SEGMENT_REASONS["11"]; // => "Pricing: the amounts claimed and their qualifiers."
TELECOM_RETAIN_SEGMENT_REASONS["12"]; // => undefined (Prior Authorization is mapped, not kept)
```

***

### TELECOM\_RETAIN\_SEGMENTS

> `const` **TELECOM\_RETAIN\_SEGMENTS**: `ReadonlySet`\<`string`\>

The recognized **clinical / financial / pharmacy** Telecom segments retained (passed through
untouched): the positive half of the fail-closed rule (the analogue of the HL7 / X12 retain lists),
read off [TELECOM\_RETAIN\_SEGMENT\_REASONS](#telecom_retain_segment_reasons), so a segment is kept only with a listed reason. They
carry NDC drug codes, quantities, days-supply, pricing amounts, and DUR reason codes, so their values
survive the over-scrub test byte-identical. A free-text field inside one of these still fails closed.
A segment id that is neither mapped ([TELECOM\_LOCUS\_MAP](#telecom_locus_map)) nor on this list is blocked
field-by-field. Prior Authorization (`12`) is mapped, not kept.

A retained segment keeps every field but the ones [TELECOM\_RETAINED\_SEGMENT\_RULES](#telecom_retained_segment_rules) names: the
Claim segment's dates of the individual's care (`414-DE`, `457-EP`) and the response DUR segment's
Previous Date Of Fill (`530-FU`) are generalized like any other date.

**Documented limitation (mirrors the HL7 / X12 adapters).** A retained segment may carry a field the
field tables we hold do not place, or a per-prescription reference (`402-D2` Rx reference number).
Each is kept and counted as an unexamined residual, never passed through unrecorded; forgetting a
clinical segment here fails **safe**: blocked, not leaked.

#### Example

```ts
import { TELECOM_RETAIN_SEGMENTS } from "@cosyte/deid/ncpdp";

TELECOM_RETAIN_SEGMENTS.has("07"); // => true (Claim, NDC / quantity / pricing retained)
TELECOM_RETAIN_SEGMENTS.has("12"); // => false (Prior Authorization, mapped)
```

***

### TELECOM\_RETAINED\_SEGMENT\_RULES

> `const` **TELECOM\_RETAINED\_SEGMENT\_RULES**: `Readonly`\<`Record`\<`string`, `Readonly`\<`Record`\<`string`, [`TelecomFieldRule`](#telecomfieldrule)\>\>\>\>

The **dated fields of a retained segment**: the fields of a recognized clinical / financial segment
([TELECOM\_RETAIN\_SEGMENTS](#telecom_retain_segments)) that a rule reaches although the segment itself is retained. Every
other field of such a segment is kept untouched and counted as an unexamined residual; a field named
here is located and transformed by its rule, the same way a date in a mapped segment is.

The Claim segment (`07`) carries two dates of the individual's care, and Safe Harbor removes every
element of a date but the year from a date directly related to an individual:

- `414-DE` Date Prescription Written, the day the prescriber wrote the patient's prescription;
- `457-EP` Associated Prescription/Service Date, the date of the patient's earlier fill or service
  this claim is tied to (a partial fill's completion, say).

The response DUR / PPS segment (`24`) carries one: `530-FU` Previous Date Of Fill, the day the
patient's earlier prescription that the alert is about was filled. `@cosyte/ncpdp` names it in its
field table and lifts it as the alert's previous date of fill.

Each is treated as the header Date of Service (`401-D1`) and the other payer date (`443-E8`) are:
generalized to the year under Safe Harbor, shifted under a profile that shifts dates. The Pricing
segment (`11`) carries amounts and codes and no date, so it has no entry here; the Prescriber segment
(`03`) is a mapped segment, where every field but its id qualifier is removed.

#### Example

```ts
import { TELECOM_RETAINED_SEGMENT_RULES } from "@cosyte/deid/ncpdp";

TELECOM_RETAINED_SEGMENT_RULES["07"]?.DE?.mode; // => "date"  (Date Prescription Written)
TELECOM_RETAINED_SEGMENT_RULES["07"]?.D7; // => undefined (the NDC, retained)
TELECOM_RETAINED_SEGMENT_RULES["24"]?.FU?.mode; // => "date"  (Previous Date Of Fill)
```

***

### TELECOM\_SEGMENT\_RETAIN\_FIELDS

> `const` **TELECOM\_SEGMENT\_RETAIN\_FIELDS**: `Readonly`\<`Record`\<`string`, `ReadonlySet`\<`string`\>\>\>

The **recognized non-identifier fields** retained within each mapped PHI segment: the positive
complement to [TELECOM\_LOCUS\_MAP](#telecom_locus_map) that closes the fail-closed frontier *inside* a PHI segment.

A Patient / Prescriber / Insurance / COB segment carries many fields; the scrub map names only the
identifiers it transforms. Without this list an **unmapped** field in one of those segments would ride
through untouched, and the NCPDP standard defines identifier fields the scrub map does not enumerate
(e.g. `350-HN` Patient E-Mail, `359-2A` Medigap ID, a `990-MA`-style alternate id). So the extractor
treats a populated field in a PHI segment that is **neither** scrubbed **nor** on this retain list as a
candidate identifier and **blocks it** (Safe Harbor category (R)). This list therefore enumerates only
the fields that are positively **non-identifying**: coded demographics (gender, state, relationship,
place of service, smoker/pregnancy indicators, id-type qualifiers), non-patient payer references, and
monetary amounts / counts, so removing anything else can never destroy a clinical/financial value.

Grounded in the NCPDP Telecommunication Standard vD.0 segment field lists and the sibling
`@cosyte/ncpdp` `FIELD_NAMES` registry.

#### Example

```ts
import { TELECOM_SEGMENT_RETAIN_FIELDS } from "@cosyte/deid/ncpdp";

TELECOM_SEGMENT_RETAIN_FIELDS["01"]?.has("C5"); // => true  (gender, retained)
TELECOM_SEGMENT_RETAIN_FIELDS["01"]?.has("HN"); // => false (patient email, blocked)
```

## Functions

### applyTelecom()

> **applyTelecom**(`original`, `transformed`, `coords`): `string`

Write the engine's transformed loci back onto a reconstruction of `original` and return the
de-identified NCPDP Telecom byte stream. `transformed` and `coords` are index-aligned (both preserve
extraction order).

#### Parameters

##### original

`TelecomTransaction`

The parsed transaction to de-identify (never mutated).

##### transformed

readonly [`TransformedLocus`](../deid.md#transformedlocus)[]

The engine's transformed loci, in extraction order.

##### coords

readonly [`TelecomCoord`](#telecomcoord)[]

The write-back coordinates, index-aligned with `transformed`.

#### Returns

`string`

The de-identified NCPDP Telecom string (canonical, per `serializeTelecom`).

#### Example

```ts
import { parseTelecom } from "@cosyte/ncpdp/telecom";
import { extractTelecomLoci, applyTelecom } from "@cosyte/deid/ncpdp";
import { deidentify } from "@cosyte/deid";

const tx = parseTelecom(raw);
const { loci, coords } = extractTelecomLoci(tx);
const { document } = deidentify({ loci }, { context });
const clean = applyTelecom(tx, document.loci, coords); // transformed Telecom text
```

***

### deidentifyTelecom()

> **deidentifyTelecom**(`tx`, `options?`): [`TelecomDeidResult`](#telecomdeidresult)

De-identify a parsed NCPDP Telecom transaction under a policy (Safe Harbor by default). PHI is located
structurally from the `@cosyte/ncpdp` Telecom model: the Patient / Prescriber / Insurance / COB
segment fields and the header Date of Service; the input transaction is never mutated (the
de-identified stream is re-serialized from a reconstruction).

The output is **"Safe-Harbor-transformed per the configured policy"**: it is not certified
de-identified, and Expert Determination is not rendered.

#### Parameters

##### tx

`TelecomTransaction`

The parsed Telecom transaction (`parseTelecom(raw)`).

##### options?

[`DeidOptions`](../deid.md#deidoptions) = `{}`

The policy and (for keyed transforms, identifier pseudonymization) the key context.
  A keyed transform with no context is a fatal `DEID_NO_KEY`, never an unkeyed fallback.

#### Returns

[`TelecomDeidResult`](#telecomdeidresult)

The de-identified Telecom stream and the value-free manifest.

#### Throws

["@cosyte/deid".DeidError](../deid.md#deiderror) `DEID_NO_KEY` when a keyed transform is required for a
  category present in the transaction but no key context was supplied;
  `DEID_FORMAT_UNSUPPORTED` when the model handed in is an ePrescribing SCRIPT message rather than
  a Telecom transaction, a Telecom transmission that carries more than one transaction, or a
  transaction that carries more than one Patient or Claim segment, all of which this adapter
  refuses outright rather than half-handle.

#### Example

```ts
import { parseTelecom } from "@cosyte/ncpdp/telecom";
import { deidentifyTelecom } from "@cosyte/deid/ncpdp";
import { createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const { telecom, manifest } = deidentifyTelecom(parseTelecom(raw), { context });
```

***

### deidentifyTelecomString()

> **deidentifyTelecomString**(`raw`, `options?`): [`TelecomDeidResult`](#telecomdeidresult)

Convenience: parse raw NCPDP Telecom text, de-identify it, and return the de-identified Telecom string
and the value-free manifest in one call. Parse warnings are not part of the de-id contract and are
discarded here; call `parseTelecom` directly if you need them.

#### Parameters

##### raw

`string`

Raw NCPDP Telecom transaction text.

##### options?

[`DeidOptions`](../deid.md#deidoptions) = `{}`

The policy and key context (see [deidentifyTelecom](#deidentifytelecom)).

#### Returns

[`TelecomDeidResult`](#telecomdeidresult)

The de-identified Telecom string and the value-free manifest.

#### Throws

["@cosyte/deid".DeidError](../deid.md#deiderror) `DEID_FORMAT_UNSUPPORTED` when the text is an XML
  document, which on an NCPDP surface is ePrescribing SCRIPT: it is refused before it is parsed,
  so no partial output exists to return; and when the transmission carries more than one
  transaction, or a Patient or Claim segment more than once, which is refused before anything is
  extracted.

#### Example

```ts
import { deidentifyTelecomString } from "@cosyte/deid/ncpdp";
import { createDeidContext } from "@cosyte/deid";

const { telecom, manifest } = deidentifyTelecomString(input, {
  context: createDeidContext({ key: process.env.DEID_KEY! }),
});
```

***

### extractTelecomLoci()

> **extractTelecomLoci**(`tx`): [`TelecomExtraction`](#telecomextraction)

Walk a parsed NCPDP Telecom transaction and extract every PHI-bearing (or fail-closed) locus,
structurally, from the `@cosyte/ncpdp` model. Never mutates the transaction.

The transaction is also **enumerated**: the value-bearing fields it hands through that no rule above
named are counted and located as unexamined residuals. The retained clinical / financial segments'
fields are the bulk of it, and the emitted transmission header's own positions join them: only a
request's Date of Service is named. Nothing is transformed on account of the measurement.

#### Parameters

##### tx

`TelecomTransaction`

The parsed Telecom transaction (`parseTelecom(raw)`).

#### Returns

[`TelecomExtraction`](#telecomextraction)

The loci (for the engine), their index-aligned write-back coordinates, and the unexamined
  residual positions the pass hands through.

#### Throws

DeidError `DEID_POSITIONS_UNENUMERABLE` when a segment's value-bearing fields cannot
  be enumerated: the pass fails rather than emit a zero or a partial count.

#### Example

```ts
import { parseTelecom } from "@cosyte/ncpdp/telecom";
import { extractTelecomLoci } from "@cosyte/deid/ncpdp";

const { loci } = extractTelecomLoci(parseTelecom(raw));
loci.length; // number of located candidate values
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
