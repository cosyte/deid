# @cosyte/deid

Public entry point for `@cosyte/deid`: a healthcare **de-identification** engine.

`@cosyte/deid` is **not** a parser. It is a consumer-tier library: it applies a HIPAA-grounded
de-identification **policy** (Safe Harbor by default) to a structurally-located model of a healthcare
document and returns a transformed model plus a **value-free manifest** of what it acted on. It
borrows the parser archetype's disciplines (typed diagnostics, immutable output, a policy/profile
system) but **inverts the parser's reflex**: it **fails closed**, an unrecognized structure or an
un-locatable identifier is blocked, never passed through as safe.

**Honesty line (governs the whole library).** Results are **"Safe-Harbor-transformed per the
configured policy"**, never "de-identified" and never "HIPAA-compliant". Safe Harbor is implemented
mechanically; the §164.514(b)(2)(ii) actual-knowledge condition is the consumer's; Expert
Determination (§164.514(b)(1)) is *supported*, never *rendered* or certified here.

The root entry ships the **format-agnostic core**: the policy engine, the five transforms, the
18-category Safe Harbor model, the fail-closed rule, and the value-free manifest: tested against a
generic locus model. The per-format locus maps (HL7 v2, C-CDA, FHIR, X12, NCPDP, DICOM) live behind
the matching subpath exports.

## Classes

### DeidContext

An opaque handle to the consumer's key material. Construct it with [createDeidContext](#createdeidcontext); it
exposes **no** secret field and redacts itself through every stringify channel.

#### Example

```ts
import { createDeidContext } from "@cosyte/deid";

const ctx = createDeidContext({ key: process.env.DEID_KEY! });
JSON.stringify({ ctx }); // => '{"ctx":"[DeidContext:redacted]"}'
```

#### Constructors

##### Constructor

> **new DeidContext**(): [`DeidContext`](#deidcontext)

**`Internal`**

Use [createDeidContext](#createdeidcontext).

###### Returns

[`DeidContext`](#deidcontext)

#### Methods

##### forPatient()

> **forPatient**(`patientId`): [`DeidContext`](#deidcontext)

Derive a sibling context scoped to a different patient, reusing the same key and seed. Used to
de-identify a multi-patient corpus with one key while keeping each patient's date-shift offset
distinct.

###### Parameters

###### patientId

`string`

The patient scope for the derived context.

###### Returns

[`DeidContext`](#deidcontext)

A new [DeidContext](#deidcontext) sharing this one's key/seed, scoped to `patientId`.

###### Example

```ts
import { createDeidContext } from "@cosyte/deid";

const base = createDeidContext({ key: process.env.DEID_KEY! });
const forPatient = base.forPatient("patient-2");
```

##### toJSON()

> **toJSON**(): `string`

Redacts through `JSON.stringify`.

###### Returns

`string`

##### toString()

> **toString**(): `string`

Redacts through `String(...)` and template interpolation.

###### Returns

`string`

***

### DeidError

The error thrown on a [FATAL\_CODES](#fatal_codes) condition. Carries a stable `code`; its `message` is
safe to log: it **never** contains PHI (no value, no key, no offset).

#### Example

```ts
import { deidentify, DeidError, FATAL_CODES } from "@cosyte/deid";

try {
  deidentify(null as never, {});
} catch (err) {
  if (err instanceof DeidError && err.code === FATAL_CODES.EMPTY_INPUT) {
    // handle empty input
  }
}
```

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new DeidError**(`code`, `message`): [`DeidError`](#deiderror)

###### Parameters

###### code

[`FatalCode`](#fatalcode)

The [FatalCode](#fatalcode) classifying this fatal.

###### message

`string`

A PHI-free explanation safe to log.

###### Returns

[`DeidError`](#deiderror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: [`FatalCode`](#fatalcode)

The stable fatal code.

***

### DeidRegistry

The corpus-level consistency handle. Construct it with [createDeidRegistry](#createdeidregistry). It holds the
consumer's key in a module-private registry: the handle exposes **no** secret field and redacts
itself through every stringify channel.

#### Example

```ts
import { createDeidRegistry } from "@cosyte/deid";

const registry = createDeidRegistry({ key: process.env.DEID_KEY! });
// Same patient across documents shifts by the same offset:
const a = registry.forPatient("patient-1");
const b = registry.forPatient("patient-1");
a === b; // => true (memoized, same handle, same offset)
```

#### Constructors

##### Constructor

> **new DeidRegistry**(): [`DeidRegistry`](#deidregistry)

**`Internal`**

Use [createDeidRegistry](#createdeidregistry).

###### Returns

[`DeidRegistry`](#deidregistry)

#### Methods

##### forPatient()

> **forPatient**(`patientKey`): [`DeidContext`](#deidcontext)

Return the [DeidContext](#deidcontext) scoped to `patientKey`, minting and memoizing it on first use. The
same key always yields the same context, hence the same deterministic date-shift offset, so a
patient's dates shift consistently across every document in the corpus. Pass this context as
`DeidOptions.context` to [deidentify](#deidentify) (or a per-format adapter) for that patient's documents.

###### Parameters

###### patientKey

`string`

A stable per-patient key (an MRN, an enterprise patient id, the consumer's
  choice, provided it is the same across that patient's documents).

###### Returns

[`DeidContext`](#deidcontext)

The patient-scoped, self-redacting context.

###### Example

```ts
import { createDeidRegistry } from "@cosyte/deid";

const registry = createDeidRegistry({ key: process.env.DEID_KEY! });
const ctx = registry.forPatient("patient-1");
```

##### pseudonym()

> **pseudonym**(`id`): `string`

Map an identifier to its corpus-wide **consistent pseudonym**: a keyed-HMAC surrogate that is the
same for the same input everywhere and not reversible without the key. Patient-independent: the
same MRN maps to the same token regardless of which patient scope processes it, so records link.

###### Parameters

###### id

`string`

The identifier to pseudonymize (MRN, beneficiary number, account number).

###### Returns

`string`

The consistent lowercase-hex surrogate.

###### Example

```ts
import { createDeidRegistry } from "@cosyte/deid";

const registry = createDeidRegistry({ key: process.env.DEID_KEY! });
registry.pseudonym("MRN-1") === registry.pseudonym("MRN-1"); // => true (consistent)
```

##### remapUid()

> **remapUid**(`uid`): `string`

Map an opaque unique identifier (a DICOM study/series/instance UID, a GUID) to its corpus-wide
**consistent surrogate**, so cross-document UID linkage survives de-identification. Domain-separated
from [pseudonym](#pseudonym), so a UID and an identifier with the same text never share a surrogate. This
is the format-agnostic linkage primitive; a format that owns UID *validity* (DICOM UIDs must be a
valid `0.…` OID) handles that in its own adapter.

###### Parameters

###### uid

`string`

The unique identifier to remap.

###### Returns

`string`

The consistent lowercase-hex surrogate.

###### Example

```ts
import { createDeidRegistry } from "@cosyte/deid";

const registry = createDeidRegistry({ key: process.env.DEID_KEY! });
registry.remapUid("1.2.840.113619.2.55") === registry.remapUid("1.2.840.113619.2.55"); // => true
```

##### toJSON()

> **toJSON**(): `string`

Redacts through `JSON.stringify`.

###### Returns

`string`

##### toString()

> **toString**(): `string`

Redacts through `String(...)` and template interpolation.

###### Returns

`string`

## Interfaces

### CategoryCoverage

Per-category coverage, for one of the 18 Safe Harbor categories (45 CFR §164.514(b)(2)(i)(A) to (R)),
whether the pass acted on it and how. Present for **all 18** categories in the report (in regulatory
order A→R), so a reader sees the categories **not** acted on as plainly as those that were.

#### Example

```ts
import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([
  { category: SAFE_HARBOR_CATEGORIES.SSN, transform: "redact", locus: "PID-19", count: 1,
    disposition: "removed", code: "DEID_CATEGORY_REMOVED", reidentificationCode: false },
]);
const ssn = report.categoryCoverage.find((c) => c.category === SAFE_HARBOR_CATEGORIES.SSN);
ssn?.actedOn; // => true
```

#### Properties

##### actedOn

> `readonly` **actedOn**: `boolean`

`true` when at least one manifest entry acted on this category.

##### category

> `readonly` **category**: [`SafeHarborCategory`](#safeharborcategory)

The Safe Harbor category.

##### codes

> `readonly` **codes**: readonly [`DeidDispositionCode`](#deiddispositioncode)[]

The distinct disposition codes recorded for this category, sorted.

##### dispositions

> `readonly` **dispositions**: `Readonly`\<`Record`\<[`ReportDisposition`](#reportdisposition), `number`\>\>

Count of acted-on values by disposition.

##### letter

> `readonly` **letter**: `string`

The §164.514(b)(2)(i) sub-paragraph letter (A to R).

##### number

> `readonly` **number**: `number`

The category ordinal (1 to 18).

##### residualRetained

> `readonly` **residualRetained**: `boolean`

`true` when a coarse identifying **residual** was retained for this category.

##### title

> `readonly` **title**: `string`

A short human title (no PHI).

##### totalCount

> `readonly` **totalCount**: `number`

Total count of values acted on across every locus of this category.

##### transforms

> `readonly` **transforms**: readonly [`TransformName`](#transformname)[]

The distinct transforms applied to this category, sorted.

***

### DeidContextSpec

Specification for [createDeidContext](#createdeidcontext).

#### Example

```ts
import { createDeidContext } from "@cosyte/deid";

const ctx = createDeidContext({ key: process.env.DEID_KEY!, patientId: "patient-1" });
```

#### Properties

##### dateShiftSeed?

> `readonly` `optional` **dateShiftSeed?**: `string` \| `Uint8Array`\<`ArrayBufferLike`\>

A separate seed for deriving per-patient date-shift offsets. Defaults to the `key` when omitted,
so date-shifting works out of the box; supply a distinct seed to decouple the two secrets. An
explicit seed has the same 16-byte minimum as the key.

##### key

> `readonly` **key**: `string` \| `Uint8Array`\<`ArrayBufferLike`\>

The HMAC key for keyed transforms. Consumer-held; never emitted. At least 16 bytes (128 bits),
counted as UTF-8 bytes when given as a string; use 32 random bytes.

##### maxShiftDays?

> `readonly` `optional` **maxShiftDays?**: `number`

Absolute bound (days) on the per-patient date-shift offset. Defaults to 365.

##### patientId?

> `readonly` `optional` **patientId?**: `string`

The patient scope this context de-identifies. Required for the deterministic date-shift offset.

***

### DeidDocument

The transformed document: the same loci with de-identified values. Format-specific documents
replace this `unknown`-shaped placeholder; the core returns this generic shape.

#### Example

```ts
import { type DeidDocument } from "@cosyte/deid";

const doc: DeidDocument = { loci: [] };
```

#### Properties

##### loci

> `readonly` **loci**: readonly [`TransformedLocus`](#transformedlocus)[]

The transformed loci.

***

### DeidManifestEntry

A single value-free manifest entry.

#### Example

```ts
import { type DeidManifestEntry, SAFE_HARBOR_CATEGORIES, DEID_DISPOSITION_CODES } from "@cosyte/deid";

const entry: DeidManifestEntry = {
  category: SAFE_HARBOR_CATEGORIES.SSN,
  transform: "redact",
  locus: "PID-19",
  count: 1,
  disposition: "removed",
  code: DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED,
  reidentificationCode: false,
};
```

#### Properties

##### category

> `readonly` **category**: [`SafeHarborCategory`](#safeharborcategory)

The Safe Harbor category acted on.

##### code

> `readonly` **code**: [`DeidDispositionCode`](#deiddispositioncode)

The stable disposition code.

##### count

> `readonly` **count**: `number`

How many values at this locus/category/disposition were acted on.

##### disposition

> `readonly` **disposition**: `"transformed"` \| `"removed"` \| `"blocked"` \| `"retained"`

The disposition. `retained` is the honest fourth outcome, and it covers two different kept things,
told apart by the entry's `code`:

- an **identifying** locus the configured profile's retention set deliberately kept unchanged,
  paired with `DEID_RESIDUAL_RETAINED`, so a kept identifier reaches the determiner's residual
  inventory rather than being invisible;
- a **party** whose role places it outside §164.514(b)(2)(i)'s scope clause, paired with
  `DEID_PARTY_ROLE_RETAINED` and the [partyRole](#partyrole) code that placed it there. That is not a
  residual of the individual's identity and does not join the residual inventory.

(Clinical values kept by the over-scrub guard are **not** identifiers and are not manifest entries
at all.)

##### locus

> `readonly` **locus**: `string`

The format-neutral locus (segment/field index · path · tag), **never** a value.

##### partyRole?

> `readonly` `optional` **partyRole?**: `string`

The **role code** that placed a party outside §164.514(b)(2)(i)'s scope clause, present **only** on
a `DEID_PARTY_ROLE_RETAINED` entry. It answers, at the party's own locus, the question a silent
retention could not: *on what did the pass decide this party is not the individual, a relative, an
employer or a household member?*

Value-free and **additive**, like [reidentificationCode](#reidentificationcode): it is a code from a role table this
library ships (an X12 element 98 entity-identifier code; the role an HL7 v2.5.1 field definition
types at an organisation-typed position), never a name, an identifier, an address or any other
value read off the document, and no other field of the entry changes on account of it.

##### reidentificationCode

> `readonly` **reidentificationCode**: `boolean`

`true` exactly at a locus where the pass emitted a **keyed surrogate**: the output of
`pseudonymize`, `hash` or `date-shift`, which is computed from the value it replaced and is
therefore a **re-identification code** anyone holding the key can reverse the linkage of. `false`
at every other locus.

It is value-free (a boolean; never a value, a key or a shift offset) and **additive**: no other
field of this entry changes on account of it, so a consumer branching on `transform`,
`disposition` or `code` reads exactly what it read before. It is what the Expert-Determination
support report's **keyed-surrogate residual inventory** is built from, so an expert can reason
about the residual a surrogate leaves rather than discover it from the transform name.

##### transform

> `readonly` **transform**: [`TransformName`](#transformname)

The transform applied.

***

### DeidOptions

Options for [deidentify](#deidentify).

#### Example

```ts
import { type DeidOptions, createDeidContext } from "@cosyte/deid";

const context = createDeidContext({ key: process.env.DEID_KEY! });
const opts: DeidOptions = { policy: "safe-harbor", context };
```

#### Extended by

- [`FhirDeidOptions`](deid/fhir.md#fhirdeidoptions)

#### Properties

##### context?

> `readonly` `optional` **context?**: [`DeidContext`](#deidcontext)

The context carrying the consumer's key, required only when the policy uses a keyed transform.

##### policy?

> `readonly` `optional` **policy?**: [`DeidPolicy`](#deidpolicy) \| `"safe-harbor"`

The policy to apply. Defaults to the built-in Safe Harbor policy.

##### redactor?

> `readonly` `optional` **redactor?**: [`FreeTextRedactor`](#freetextredactor)

A **consumer-supplied** free-text redactor. When present, the engine invokes it
at each free-text locus instead of blocking, and records its output as **consumer-asserted**
(`DEID_FREETEXT_CONSUMER_REDACTED`). The library bundles **no** redactor. **Fail-closed contract:**
when this is omitted, or when the redactor throws or returns nothing, the free-text locus is
**blocked** (the safe default), never emitted un-redacted. A returned redaction is trusted as the
consumer's; the engine does not re-verify it and does not touch the structural PHI the adapters
remove. See [FreeTextRedactor](#freetextredactor).

##### retainedLoci?

> `readonly` `optional` **retainedLoci?**: readonly [`RetainedLocusClass`](#retainedlocusclass)[]

The **retention classes** the configured profile permits: the named groups of identifying loci a
format adapter may pass through unchanged (each one still recorded as a residual). Build this
with [profileOptions](#profileoptions) rather than by hand; the widen-never-narrow contract on a derived
profile is what keeps a site preset from adding one.

**Absent or empty retains nothing**, so a bare options bag gets the strict treatment.

***

### DeidPolicy

A de-identification policy: a name plus a per-category transform assignment covering all 18
categories.

#### Example

```ts
import { SAFE_HARBOR_POLICY } from "@cosyte/deid";

SAFE_HARBOR_POLICY.name; // => "safe-harbor"
```

#### Properties

##### name

> `readonly` **name**: `string`

The policy name: surfaced in output labelling ("Safe-Harbor-transformed per the configured policy").

##### transforms

> `readonly` **transforms**: `Readonly`\<`Record`\<[`SafeHarborCategory`](#safeharborcategory), [`TransformName`](#transformname)\>\>

The transform applied to each Safe Harbor category.

***

### DeidPolicySpec

The spec accepted by [defineDeidPolicy](#definedeidpolicy): a name and a **partial** transform map that overrides
the Safe Harbor defaults for the categories it names.

#### Example

```ts
import { type DeidPolicySpec, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const spec: DeidPolicySpec = {
  name: "research",
  transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
};
```

#### Properties

##### name

> `readonly` **name**: `string`

The policy name.

##### transforms?

> `readonly` `optional` **transforms?**: `Partial`\<`Readonly`\<`Record`\<[`SafeHarborCategory`](#safeharborcategory), [`TransformName`](#transformname)\>\>\>

Per-category transform overrides; unlisted categories keep their Safe Harbor default.

***

### DeidProfile

A reusable, named de-identification preset: a policy plus its honest usage posture and an optional
default free-text redactor.

#### Example

```ts
import { SAFE_HARBOR_PROFILE } from "@cosyte/deid";

SAFE_HARBOR_PROFILE.name; // => "safe-harbor"
```

#### Properties

##### description

> `readonly` **description**: `string`

A one-line honest description of what the profile does and does **not** guarantee: surfaced in
docs and tooling so a preset is never adopted without its caveats.

##### name

> `readonly` **name**: `string`

The profile name (also the policy name).

##### policy

> `readonly` **policy**: [`DeidPolicy`](#deidpolicy)

The concrete policy the engine applies.

##### redactor?

> `readonly` `optional` **redactor?**: [`FreeTextRedactor`](#freetextredactor)

An optional default free-text redactor the profile carries into [profileOptions](#profileoptions).

##### requiresContext

> `readonly` **requiresContext**: `boolean`

Whether the profile **requires** a keyed per-patient [DeidContext](#deidcontext) to run at all (true when
any category uses a keyed transform such as `date-shift` on a category that is always present).

##### retainedLoci

> `readonly` **retainedLoci**: readonly [`RetainedLocusClass`](#retainedlocusclass)[]

The **retention classes** this profile permits: named groups of *identifying* loci a format
adapter passes through unchanged, each one still recorded as a `DEID_RESIDUAL_RETAINED` residual.
Empty on [SAFE\_HARBOR\_PROFILE](#safe_harbor_profile); [LIMITED\_DATA\_SET\_PROFILE](#limited_data_set_profile) carries the three classes
§164.514(e)(2) permits a limited data set to keep. A profile that DECLARES the
`limited-data-set` standard is checked against that regulation's own list, so a class beyond it
is a fatal [FATAL\_CODES.DEID\_PROFILE\_INVALID](#deid_profile_invalid) rather than an unsupported claim.

##### standard

> `readonly` **standard**: [`DeidStandard`](#deidstandard)

The standard this profile targets: governs how its output may honestly be described.

***

### DeidProfileSpec

The spec accepted by [defineDeidProfile](#definedeidprofile): a name, an optional base profile (default
[SAFE\_HARBOR\_PROFILE](#safe_harbor_profile)), per-category transform overrides, and an optional default redactor.

#### Example

```ts
import { type DeidProfileSpec, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const spec: DeidProfileSpec = {
  name: "site-a",
  transforms: { [SAFE_HARBOR_CATEGORIES.GEOGRAPHIC]: "redact" }, // tighten: generalize -> redact
};
```

#### Properties

##### base?

> `readonly` `optional` **base?**: [`DeidProfile`](#deidprofile)

The base profile to derive from. Defaults to [SAFE\_HARBOR\_PROFILE](#safe_harbor_profile).

##### description?

> `readonly` `optional` **description?**: `string`

An optional human description; a default is synthesized from the base when omitted.

##### name

> `readonly` **name**: `string`

The profile name. Must not be a reserved standard label unless it genuinely matches it.

##### redactor?

> `readonly` `optional` **redactor?**: [`FreeTextRedactor`](#freetextredactor)

An optional default free-text redactor the derived profile carries.

##### retainedLoci?

> `readonly` `optional` **retainedLoci?**: readonly [`RetainedLocusClass`](#retainedlocusclass)[]

The retention classes the derived profile permits. Must be a **subset** of the base's: dropping a
class removes more (a widening, allowed), adding one keeps more (a narrowing, rejected). Omit to
inherit the base's set unchanged.

##### transforms?

> `readonly` `optional` **transforms?**: `Partial`\<`Readonly`\<`Record`\<[`SafeHarborCategory`](#safeharborcategory), [`TransformName`](#transformname)\>\>\>

Per-category transform overrides. Each may only move a category to an **equal-or-stronger**
transform than the base (widen-never-narrow); a weakening override is rejected.

***

### DeidRegistrySpec

Specification for [createDeidRegistry](#createdeidregistry). Mirrors [DeidContextSpec](#deidcontextspec) minus the per-patient
scope: the registry mints patient scopes itself via [DeidRegistry.forPatient](#forpatient-1).

#### Example

```ts
import { createDeidRegistry } from "@cosyte/deid";

const registry = createDeidRegistry({ key: process.env.DEID_KEY! });
```

#### Properties

##### dateShiftSeed?

> `readonly` `optional` **dateShiftSeed?**: `string` \| `Uint8Array`\<`ArrayBufferLike`\>

A separate seed for deriving per-patient date-shift offsets. Defaults to the `key` when omitted;
supply a distinct seed to decouple pseudonymization from date-shifting.

##### key

> `readonly` **key**: `string` \| `Uint8Array`\<`ArrayBufferLike`\>

The HMAC key for keyed transforms. Consumer-held; never emitted. At least 16 bytes (128 bits),
counted as UTF-8 bytes when given as a string; use 32 random bytes.

##### maxShiftDays?

> `readonly` `optional` **maxShiftDays?**: `number`

Absolute bound (days) on each derived per-patient date-shift offset. Defaults to 365.

***

### DeidResult

The immutable result of a de-id pass: the transformed document plus the value-free manifest.

#### Example

```ts
import { deidentify } from "@cosyte/deid";

const result = deidentify({ loci: [] }, {});
result.manifest; // => [] (nothing acted on)
```

#### Properties

##### document

> `readonly` **document**: [`DeidDocument`](#deiddocument)

The transformed document (the generic locus document from the core).

##### manifest

> `readonly` **manifest**: readonly [`DeidManifestEntry`](#deidmanifestentry)[]

The value-free audit of every action, in locus order.

***

### DispositionSummary

A roll-up of how many values landed in each disposition across the whole report: the one-glance
posture of the pass. Every field is a count; none is a value.

#### Example

```ts
import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([
  { category: SAFE_HARBOR_CATEGORIES.SSN, transform: "redact", locus: "PID-19", count: 2,
    disposition: "removed", code: "DEID_CATEGORY_REMOVED", reidentificationCode: false },
]);
report.dispositionSummary.removed; // => 2
```

#### Properties

##### blocked

> `readonly` **blocked**: `number`

Loci failed closed (blocked; value withheld).

##### freeTextBlocked

> `readonly` **freeTextBlocked**: `number`

Free-text loci blocked by default (`DEID_FREETEXT_BLOCKED`).

##### freeTextConsumerRedacted

> `readonly` **freeTextConsumerRedacted**: `number`

Free-text loci redacted by a **consumer-supplied** BYO redactor (`DEID_FREETEXT_CONSUMER_REDACTED`).

##### removed

> `readonly` **removed**: `number`

Values removed outright.

##### residualRetained

> `readonly` **residualRetained**: `number`

Of the transformed values, how many retained a coarse residual (`DEID_RESIDUAL_RETAINED`).

##### retained

> `readonly` **retained**: `number`

Loci the pass kept unchanged **and recorded**: identifying loci the profile's retention set kept
(each one a residual below), plus parties whose role placed them outside §164.514(b)(2)(i)'s scope
clause (each one naming the role code it was classified on, and none of them a residual).

##### transformed

> `readonly` **transformed**: `number`

Values replaced with a surrogate / generalized / shifted / hashed / BYO-redacted.

##### unexaminedResidualPositions

> `readonly` **unexaminedResidualPositions**: `number` \| `null`

**Value-bearing positions the pass handed through that no locus rule named**
(`DEID_POSITION_UNEXAMINED`), or `null` when the pass reported **no measurement at all**.

The `null` is the point: a bare `0` in a roll-up is read as "nothing was handed through
unexamined", which is exactly the claim an unmeasured pass cannot make. A number here is a
measurement; `null` says there is none to report.

These positions are **not** counted in [transformed](#transformed), [removed](#removed), [blocked](#blocked) or
[retained](#retained): no value was acted on, blocked or kept by a decision, so folding them into any of
those four would overstate what the pass did.

***

### ExpertDeterminationReportOptions

Options for [buildExpertDeterminationSupportReport](#buildexpertdeterminationsupportreport).

#### Properties

##### policy?

> `readonly` `optional` **policy?**: `string` \| [`DeidPolicy`](#deidpolicy)

The policy applied (or its name): surfaced as the report's policy label.

##### quasiIdentifiers?

> `readonly` `optional` **quasiIdentifiers?**: [`QuasiIdentifierClassInput`](#quasiidentifierclassinput)

Consumer-supplied quasi-identifier equivalence-class sizes for the descriptive k-indicator.

##### unexaminedResiduals?

> `readonly` `optional` **unexaminedResiduals?**: readonly [`UnexaminedResidual`](#unexaminedresidual)[] \| readonly (readonly [`UnexaminedResidual`](#unexaminedresidual)[])[]

The **unexamined residual positions** a pass measured, as returned alongside its manifest by every
format adapter. A single pass's list, or an array of them for a corpus, matching the shape of the
`manifests` argument.

**Supplying it, even empty, is what makes the inventory _measured_.** Omitting it leaves
[ExpertDeterminationSupportReport.unexaminedResidualsMeasured](#unexaminedresidualsmeasured) `false` and the roll-up count
`null`, so the report says plainly that nothing was counted rather than printing a zero a reader
would take for a clearance. An empty array is the opposite claim, and a real one: the pass
enumerated the positions it handed through and none went unexamined.

***

### ExpertDeterminationSupportReport

The structured, value-free Expert-Determination **support** report. Machine-readable (this object) and
human-readable (via [formatExpertDeterminationSupportReport](#formatexpertdeterminationsupportreport)). It **supports** a determination
and is **never** one: `determination` is always `null` and [disclaimer](#disclaimer) leads.

#### Example

```ts
import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([
  { category: SAFE_HARBOR_CATEGORIES.NAMES, transform: "redact", locus: "PID-5", count: 1,
    disposition: "removed", code: "DEID_CATEGORY_REMOVED", reidentificationCode: false },
]);
report.determination; // => null (the library never renders one)
report.totals.categoriesActedOn; // => 1
```

#### Properties

##### categoryCoverage

> `readonly` **categoryCoverage**: readonly [`CategoryCoverage`](#categorycoverage)[]

Coverage for all 18 Safe Harbor categories, in regulatory order (A→R).

##### determination

> `readonly` **determination**: `null`

Always `null`: the library renders **no** determination.

##### disclaimer

> `readonly` **disclaimer**: `string`

The prominent non-certification statement ([EXPERT\_DETERMINATION\_DISCLAIMER](#expert_determination_disclaimer)).

##### dispositionSummary

> `readonly` **dispositionSummary**: [`DispositionSummary`](#dispositionsummary)

The disposition roll-up.

##### documentCount

> `readonly` **documentCount**: `number`

How many documents' manifests this report summarizes (1 for a single manifest).

##### keyedSurrogateResiduals

> `readonly` **keyedSurrogateResiduals**: readonly [`KeyedSurrogateResidual`](#keyedsurrogateresidual)[]

The **keyed-surrogate residual inventory**: every locus whose manifest entry carries
`reidentificationCode`, so a determiner can reason about the linkage a keyed surrogate preserves.
A sibling of [retainedQuasiIdentifiers](#retainedquasiidentifiers), never folded into it.

##### kind

> `readonly` **kind**: `"expert-determination-support"`

A stable discriminant for the report shape.

##### outputLabel

> `readonly` **outputLabel**: `string`

The output label the pass applied: "Safe-Harbor-transformed per the configured policy".

##### perLocus

> `readonly` **perLocus**: readonly [`DeidManifestEntry`](#deidmanifestentry)[]

Every acted-on locus, aggregated and in a deterministic order: the value-free manifest, structured.

##### policy

> `readonly` **policy**: `string` \| `null`

The policy name applied, or `null` if not supplied.

##### quasiIdentifierStatistics

> `readonly` **quasiIdentifierStatistics**: [`QuasiIdentifierStatistics`](#quasiidentifierstatistics-1) \| `null`

Descriptive quasi-identifier statistics, **only** when the consumer supplied class sizes; else `null`.

##### retainedQuasiIdentifiers

> `readonly` **retainedQuasiIdentifiers**: readonly [`RetainedQuasiIdentifier`](#retainedquasiidentifier)[]

The retained-quasi-identifier residual inventory (coarse residuals the pass recorded as retained).

##### totals

> `readonly` **totals**: `object`

Headline totals.

###### categoriesActedOn

> `readonly` **categoriesActedOn**: `number`

How many of the 18 Safe Harbor categories were acted on.

###### loci

> `readonly` **loci**: `number`

Count of **distinct acted-on loci** (distinct locus paths across the whole report).

###### rows

> `readonly` **rows**: `number`

Count of aggregated `perLocus` rows (distinct category·transform·locus·disposition·code tuples).

##### unexaminedResiduals

> `readonly` **unexaminedResiduals**: readonly [`UnexaminedResidual`](#unexaminedresidual)[]

The **unexamined-residual inventory**: every value-bearing position the pass handed through that no
locus rule named, with its structural locus and a count. A **sibling** of
[retainedQuasiIdentifiers](#retainedquasiidentifiers), never folded into it: that inventory holds residuals of values the
pass **examined**, and admitting an unexamined position would make a kept year and a position
nothing looked at indistinguishable.

Empty when the pass measured none **and** when nothing was measured at all: read
[unexaminedResidualsMeasured](#unexaminedresidualsmeasured) to tell those apart.

##### unexaminedResidualsMeasured

> `readonly` **unexaminedResidualsMeasured**: `boolean`

`true` when the pass **reported a measurement** of its unexamined residual positions, whatever the
count. `false` says no measurement was supplied, so an empty [unexaminedResiduals](#unexaminedresiduals-1) is silence
rather than a measured zero, and the determiner is told which it is instead of inferring it.

***

### FreeTextRedactionRequest

The value-bearing request the engine hands a [FreeTextRedactor](#freetextredactor) at each free-text locus. This
is the **one** place a value crosses into consumer code by design: it never reaches the manifest.

#### Example

```ts
import { type FreeTextRedactionRequest } from "@cosyte/deid";

const request: FreeTextRedactionRequest = { text: "patient prose…", locus: "OBX-5" };
```

#### Properties

##### category?

> `readonly` `optional` **category?**: [`SafeHarborCategory`](#safeharborcategory)

The Safe Harbor category associated with the locus, when the adapter could classify it.

##### locus

> `readonly` **locus**: `string`

The format-neutral locus path (e.g. `"OBX-5"`, `"section/text"`): value-free, for routing/logging.

##### text

> `readonly` **text**: `string`

The free-text prose at the locus, for the consumer's redactor to de-identify.

***

### FreeTextRedactionResult

The successful result of a [FreeTextRedactor](#freetextredactor): the redacted prose to write back in place. To
**decline** a locus (so the engine fails closed and blocks it), a redactor returns `null` /
`undefined` or throws: it never returns un-redacted text expecting the engine to catch a miss.

#### Example

```ts
import { type FreeTextRedactionResult } from "@cosyte/deid";

const result: FreeTextRedactionResult = { text: "patient [REDACTED]…" };
```

#### Properties

##### text

> `readonly` **text**: `string`

The redacted prose. May be an empty string (all prose removed); that is a valid redaction.

***

### GeneralizeOutcome

The outcome of a generalization: the reduced value plus whether it retains a coarse **residual**
(a kept year, a retained safe 3-digit ZIP prefix) that the manifest must surface for the
actual-knowledge test, versus a fully non-identifying result (`000`, `90+`).

#### Properties

##### residual

> `readonly` **residual**: `boolean`

`true` when a coarse identifying residual was retained; `false` when fully suppressed.

##### value

> `readonly` **value**: `string`

The generalized value.

***

### GenericLocus

A single structurally-located candidate value. `category` is omitted when the caller cannot classify
the locus: an unclassified PHI-bearing locus is treated as catch-all (R) and **fails closed**.

#### Example

```ts
import { type GenericLocus, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const locus: GenericLocus = {
  path: "PID-5",
  kind: "identifier",
  category: SAFE_HARBOR_CATEGORIES.NAMES,
  value: "SENTINEL_NAME_01",
};
```

#### Properties

##### ageUnit?

> `readonly` `optional` **ageUnit?**: `string`

The **unit** of an `age` locus whose value is a **number held in a field that holds a number**: an
HL7 v2 `NM` result, a FHIR `Quantity.value`, a CDA `PQ` `@value`. The unit is the document's own
(`"a"`, `"mo"`, `"wk"`, `"d"`, a spelled-out `"years"`), and `""` when the document gives none,
which is read as years.

Present, it changes what the `generalize` transform writes. The `"90+"` category cannot be written
into a number, so an age over 89 (measured in years after reading the unit) is **removed** and
recorded as `DEID_CATEGORY_GENERALIZED`; an age of 89 or under is kept **exactly as written**, with
the disposition `retained` and the code `DEID_RESIDUAL_RETAINED`; an age whose value or unit cannot be read is blocked. Under `date-shift`
the age is kept and recorded as a residual: a shift keeps every interval, and an age is one.

Absent (the default) an `age` locus takes the `"90+"` generalization as before. The format
adapters set it on the ages they locate; a caller building loci by hand sets it on its own.

##### category?

> `readonly` `optional` **category?**: [`SafeHarborCategory`](#safeharborcategory)

The Safe Harbor category, when known. Omit to force fail-closed handling as category (R).

##### dateOfBirth?

> `readonly` `optional` **dateOfBirth?**: `boolean`

`true` when this `date` locus is a **date of birth**. §164.514(b)(2)(i)(C) lets a date keep its
year, except a year indicative of an age over 89. So when the configured transform generalizes
the date to its year and that year is **90 or more years before the year of the call**, the year
is removed instead of kept, and the manifest records `DEID_CATEGORY_GENERALIZED` rather than a
residual. The comparison is by year alone, so a person who may already be 90 is aggregated.

Absent (the default) a date keeps its year however old it is. The format adapters set it on the
birth dates they locate; a caller building loci by hand sets it on its own.

##### kind

> `readonly` **kind**: [`LocusKind`](#locuskind)

The kind of value at this locus.

##### maxLength?

> `readonly` `optional` **maxLength?**: `number`

The **most characters the position may hold**, when the format bounds it: an X12 element's
maximum length, for example. Present, it bounds every value the engine writes there:

- a **keyed surrogate** (`pseudonymize`, `hash`) longer than this is cut to its first `maxLength`
  characters of lowercase hex, 4 bits each, when that keeps at least 80 bits (20 characters). A
  position shorter than 20 characters cannot carry a surrogate that links safely, so the value is
  **blocked** instead (removed, recorded as `DEID_LOCUS_BLOCKED`). A referenced identifier whose
  surrogate in its own shape (a UUID, an OID) does not fit is written as the cut hex digest;
- a **stand-in** that does not fit in its shape is written as its bare sequence number;
- any **other** value the engine writes that is longer than this is blocked.

A value kept exactly as it arrived is not checked. A value that is not a whole number of zero or
more is read as `0`, so every value written there is blocked. Absent (the default) nothing is
bounded, exactly as before. The X12 adapter sets it; a caller building loci by hand sets it on
its own.

##### partyRole?

> `readonly` `optional` **partyRole?**: `string`

The **role code** an adapter classified a *party* on, present **only** at a locus that records a
party whose role places it **outside** §164.514(b)(2)(i)'s scope clause and whose name and
identifiers the pass therefore left in place. The engine records the code in the manifest at this
locus (`DEID_PARTY_ROLE_RETAINED`) and writes nothing back, so a retention that used to be silent
can be audited.

It is a **code, never a value**: an adapter sets it from its own committed role table (see
`classifyPartyRole`), and a locus carrying it must carry an empty [value](#value-1): a party-role
record has no value to hand anywhere. A non-empty one **fails closed** (blocked) rather than being
retained, so this marker can never become a route for passing an identifier through.

##### path

> `readonly` **path**: `string`

The format-neutral path to the value. Recorded in the manifest; **never** a value.

##### referencedId?

> `readonly` `optional` **referencedId?**: `boolean`

`true` when the value is an identifier **other positions of the same document point at**: a FHIR
resource's logical `id`, or the id part of a `fullUrl` or a reference to one. Removing it would cut
every link to it, so the engine writes a replacement instead, the same one for the same value
throughout the call:

- under `redact` or `block` (the Safe Harbor default for its category), a **stand-in**: a sequence
  number counted from 1 in the order the distinct values are first met in the call, never computed
  from the value, recorded as `DEID_IDENTIFIER_SUBSTITUTED`;
- under `pseudonymize` or `hash`, the **keyed surrogate** that transform computes, recorded as it
  always is and flagged `reidentificationCode`.

Either replacement keeps the value's shape: a UUID becomes a UUID, an OID an OID under `2.25`, and
anything else a plain token. Under any other transform the locus is blocked. Absent (the default)
the locus takes its policy transform exactly as before. The FHIR adapter sets it; a caller building
loci by hand sets it on its own.

##### retainedPart?

> `readonly` `optional` **retainedPart?**: [`RetainedLocusPart`](#retainedlocuspart)

The **named part** of an otherwise-excluded category this locus carries, present only where the
regulation's exclusion is **partial**. §164.514(e)(2)(ii) is the one such clause: it removes
postal address information "other than town or city, State, and zip code", so a locus addressing
one of those three parts is marked here and the rest of the address is not marked at all.

Like [retention](#retention) it is a *proposal*: the engine keeps the value only if the options list
the class **and** [isRetainablePart](#isretainablepart) accepts the class, the resolved category and this
part together. It is the **only** route past the never-retainable category guard, and it does
not widen that guard: `GEOGRAPHIC` remains a category no profile may retain whole.

**An adapter that sets this must address ONE part**, at its own structural locus (a component,
not the whole address), because the engine keeps exactly what the locus carries. Marking a whole
address with a part name would keep the whole address, which is the failure this field exists to
make impossible to reach by accident rather than one it can detect.

##### retention?

> `readonly` `optional` **retention?**: [`RetainedLocusClass`](#retainedlocusclass)

The **retention class** this locus belongs to, when an adapter can name one. It is a *proposal*,
never a decision: the engine keeps the value only if the configured options **also** list this
class, **and** the resolved category is one a limited data set may carry at all. Both keys are
required, so an adapter cannot retain anything on its own and a stale marker cannot leak a value.

Absent (the default) the locus takes its normal policy transform. This is **not** the over-scrub
guard: a `clinical` locus is not an identifier and is retained without a manifest row, whereas a
locus marked here **is** identifying and is always recorded when it is kept.

##### value

> `readonly` **value**: `string`

The value at the locus. Consumed by the engine, never copied into the manifest.

***

### KeyedSurrogateResidual

One entry in the **keyed-surrogate residual inventory**: a locus where the pass replaced the value
with a surrogate **derived from that value under the consumer's key** (`pseudonymize`, `hash` or
`date-shift`), which the manifest marks with `reidentificationCode`. Anyone holding the key can
re-link those records, so §164.514(c)(1) does not permit such a code under Safe Harbor and the
residual is an **Expert-Determination** consideration.

This inventory is a **sibling** of [RetainedQuasiIdentifier](#retainedquasiidentifier), never a member of it: a retained
quasi-identifier is a piece of the original value that survived (a year, a safe 3-digit ZIP prefix,
a whole kept date), while this is a computed replacement that carries no plaintext but preserves
linkage. Carrying `transform` on every row is what keeps the two distinguishable at a glance.

Value-free, like everything else here: the locus, the category, the count and the transform, never
a value, a key or a shift offset.

#### Example

```ts
import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([
  { category: SAFE_HARBOR_CATEGORIES.MRN, transform: "pseudonymize", locus: "PID-3", count: 1,
    disposition: "transformed", code: "DEID_CATEGORY_PSEUDONYMIZED", reidentificationCode: true },
]);
report.keyedSurrogateResiduals[0]?.transform; // => "pseudonymize"
```

#### Properties

##### category

> `readonly` **category**: [`SafeHarborCategory`](#safeharborcategory)

The Safe Harbor category the surrogate stands in for.

##### count

> `readonly` **count**: `number`

How many values at this locus were replaced by a keyed surrogate.

##### locus

> `readonly` **locus**: `string`

The format-neutral locus (segment/field index · path · tag), **never** a value.

##### transform

> `readonly` **transform**: [`TransformName`](#transformname)

Which keyed transform produced it: `pseudonymize`, `hash` or `date-shift`.

***

### LocusModel

The format-agnostic input model: a flat list of located candidate values. A per-format adapter
produces this from a parsed HL7 / C-CDA / FHIR / X12 / NCPDP / DICOM model.

#### Example

```ts
import { type LocusModel } from "@cosyte/deid";

const model: LocusModel = { loci: [{ path: "PID-3", kind: "identifier", value: "X" }] };
```

#### Properties

##### loci

> `readonly` **loci**: readonly [`GenericLocus`](#genericlocus)[]

The located candidate values to de-identify.

***

### PartyRoleTable

One format's two role-code lists. Both are the format's own committed vocabulary (X12 element 98
entity-identifier codes; the role an HL7 v2.5.1 field definition types at a party), never a value read
off a document.

#### Example

```ts
import { type PartyRoleTable } from "@cosyte/deid";

const table: PartyRoleTable = { subject: new Set(["36"]), outside: new Set(["85"]) };
```

#### Properties

##### outside

> `readonly` **outside**: `ReadonlySet`\<`string`\>

Role codes that place the party outside the clause: provider / facility / payer / payee / submitter.

##### subject

> `readonly` **subject**: `ReadonlySet`\<`string`\>

Role codes the scope clause reaches: the individual, a relative, an **employer**, a household member.

***

### QuasiIdentifierClassInput

**Consumer-supplied** quasi-identifier equivalence-class data. The library never derives this: it has
no view of the quasi-identifier **values**. The consumer, who holds the values, groups their records by
the chosen quasi-identifier set (e.g. 3-digit ZIP × birth year × sex) and supplies the size of each
distinct group; the report echoes descriptive counts over those sizes (see [QuasiIdentifierStatistics](#quasiidentifierstatistics-1)).

#### Example

```ts
import { type QuasiIdentifierClassInput } from "@cosyte/deid";

// Consumer grouped 100 records into classes of these sizes over their chosen quasi-identifier set:
const qi: QuasiIdentifierClassInput = {
  quasiIdentifierSet: "3-digit ZIP × birth year × sex",
  equivalenceClassSizes: [40, 33, 20, 5, 1, 1],
};
```

#### Properties

##### equivalenceClassSizes

> `readonly` **equivalenceClassSizes**: readonly `number`[]

One size per distinct quasi-identifier combination: the record count in that equivalence class.

##### quasiIdentifierSet?

> `readonly` `optional` **quasiIdentifierSet?**: `string`

A human label for the quasi-identifier set the sizes were computed over. No PHI.

***

### QuasiIdentifierStatistics

Descriptive statistics over **consumer-supplied** equivalence-class sizes, including the smallest
class size, the widely-used **k-anonymity indicator**.

**This is not a risk score and not a determination.** It is arithmetic over sizes the consumer
supplied: the library counts what it is given, applies no threshold, draws no `k ≥ n ⇒ safe`
conclusion, and emits no verdict. A statistician documents an indicator like this *as one input* to a
§164.514(b)(1) determination: the determination remains theirs. See [note](#note).

#### Example

```ts
import { buildExpertDeterminationSupportReport } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([], {
  quasiIdentifiers: { equivalenceClassSizes: [40, 20, 5, 1, 1] },
});
report.quasiIdentifierStatistics?.minimumEquivalenceClassSize; // => 1
report.quasiIdentifierStatistics?.uniqueRecords;               // => 2
```

#### Properties

##### distinctCombinations

> `readonly` **distinctCombinations**: `number`

Number of distinct quasi-identifier combinations = the number of equivalence classes supplied.

##### minimumEquivalenceClassSize

> `readonly` **minimumEquivalenceClassSize**: `number`

The smallest equivalence-class size: the **k-anonymity indicator**. Descriptive only.

##### note

> `readonly` **note**: `string`

The honesty note: this is a descriptive input, never a risk score or determination.

##### quasiIdentifierSet

> `readonly` **quasiIdentifierSet**: `string` \| `null`

The label the consumer gave the quasi-identifier set, or `null` if unlabelled.

##### totalRecords

> `readonly` **totalRecords**: `number`

Total records across all classes = the sum of the supplied sizes.

##### uniqueRecords

> `readonly` **uniqueRecords**: `number`

How many records fall in a class of size 1 (sample-uniques on the chosen set). Descriptive only.

***

### RetainedQuasiIdentifier

One entry in the **retained-quasi-identifier residual inventory**: an identifying element the pass
**deliberately kept** for analytic utility and **recorded** as `DEID_RESIDUAL_RETAINED`. Two things
land here:

- a **coarse residual** left by a generalization: a year-only date, a retained safe 3-digit ZIP
  prefix, an exact age ≤ 89;
- a **whole value kept by the profile's retention set**: under a limited-data-set preset, an
  admission / discharge / service date or an encounter or order number, which a Safe-Harbor-labelled
  policy removes instead.

These are exactly the residuals an expert reasons about under the §164.514(b)(2)(ii)
actual-knowledge test, and the second kind is the stronger one: it is a full, unreduced value.

**A keyed surrogate is NOT one of these and never joins this list.** It is a *replacement* computed
from the value rather than a piece of the value that survived, so it is inventoried separately as a
[KeyedSurrogateResidual](#keyedsurrogateresidual): the two kinds are different residuals and a determiner reasons about
them differently.

#### Example

```ts
import { buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([
  { category: SAFE_HARBOR_CATEGORIES.DATES, transform: "generalize", locus: "PID-7", count: 1,
    disposition: "transformed", code: "DEID_RESIDUAL_RETAINED", reidentificationCode: false },
]);
report.retainedQuasiIdentifiers[0]?.locus; // => "PID-7"
```

#### Properties

##### category

> `readonly` **category**: [`SafeHarborCategory`](#safeharborcategory)

The Safe Harbor category of the retained residual.

##### count

> `readonly` **count**: `number`

How many values at this locus retained a residual.

##### locus

> `readonly` **locus**: `string`

The format-neutral locus (segment/field index · path · tag), **never** a value.

##### transform

> `readonly` **transform**: [`TransformName`](#transformname)

How the residual arose, so the two kinds are not indistinguishable in the inventory: `generalize`
left a coarse residual (a year, a safe 3-digit ZIP prefix, an age ≤ 89), while `retain` kept the
**whole unreduced value**. A determiner reasons about those very differently.

***

### TransformedLocus

The transformed value of a locus after a de-id pass: the reduced/surrogate `value`, or `null` when
the value was removed or blocked (fail-closed). Carries no secret and no original value.

#### Example

```ts
import { type TransformedLocus } from "@cosyte/deid";

const t: TransformedLocus = { path: "PID-3", kind: "identifier", value: null, disposition: "removed" };
```

#### Properties

##### disposition

> `readonly` **disposition**: `"transformed"` \| `"removed"` \| `"blocked"` \| `"retained"`

What happened to the value.

##### kind

> `readonly` **kind**: [`LocusKind`](#locuskind)

The kind of value at this locus (unchanged from input).

##### path

> `readonly` **path**: `string`

The format-neutral path (unchanged from input).

##### value

> `readonly` **value**: `string` \| `null`

The transformed value, or `null` when removed / blocked.

***

### UnexaminedResidual

One **value-bearing position a pass handed through that no locus rule named**, counted and located in
the value-free record.

#### Example

```ts
import { type UnexaminedResidual } from "@cosyte/deid";

const residual: UnexaminedResidual = {
  locus: "PV1-7",
  count: 1,
  examined: false,
  locusWithheld: false,
  code: "DEID_POSITION_UNEXAMINED",
};
```

#### Properties

##### code

> `readonly` **code**: `"DEID_POSITION_UNEXAMINED"`

The stable disposition code: always `DEID_POSITION_UNEXAMINED`.

##### count

> `readonly` **count**: `number`

How many value-bearing positions at this locus were handed through unexamined.

##### examined

> `readonly` **examined**: `false`

Always `false`: the fact this record exists to state. No locus rule reached the position, so the
pass neither acted on it, nor blocked it, nor decided to keep it. A literal rather than a
convention, so a consumer merging inventories cannot mistake one of these for an acted-on entry.

##### locus

> `readonly` **locus**: `string`

The format-neutral **structural locus** of the position (segment/field index · path · tag), or
[WITHHELD\_LOCUS\_TOKEN](#withheld_locus_token) when it could not be expressed. **Never** a value, a key or an offset.

##### locusWithheld

> `readonly` **locusWithheld**: `boolean`

`true` when the position's structural locus **could not be expressed** and [locus](#locus-4) is
therefore [WITHHELD\_LOCUS\_TOKEN](#withheld_locus_token). The position is still counted: an inexpressible "where" is
never a reason to drop a "how many". Value-free (a boolean).

## Type Aliases

### DeidDispositionCode

> **DeidDispositionCode** = *typeof* [`DEID_DISPOSITION_CODES`](#deid_disposition_codes)\[keyof *typeof* [`DEID_DISPOSITION_CODES`](#deid_disposition_codes)\]

A value from [DEID\_DISPOSITION\_CODES](#deid_disposition_codes): the code every manifest entry carries.

#### Example

```ts
import { DEID_DISPOSITION_CODES, type DeidDispositionCode } from "@cosyte/deid";

const code: DeidDispositionCode = DEID_DISPOSITION_CODES.DEID_CATEGORY_REMOVED;
```

***

### DeidStandard

> **DeidStandard** = `"safe-harbor"` \| `"limited-data-set"` \| `"custom"`

The named standard a profile targets, surfaced so output labelling can never overclaim.

***

### FatalCode

> **FatalCode** = *typeof* [`FATAL_CODES`](#fatal_codes)\[keyof *typeof* [`FATAL_CODES`](#fatal_codes)\]

A value from [FATAL\_CODES](#fatal_codes): the code carried by a thrown [DeidError](#deiderror).

#### Example

```ts
import { FATAL_CODES, type FatalCode } from "@cosyte/deid";

const code: FatalCode = FATAL_CODES.EMPTY_INPUT;
```

***

### FreeTextRedactor

> **FreeTextRedactor** = (`request`) => [`FreeTextRedactionResult`](#freetextredactionresult) \| `null` \| `undefined`

A consumer-supplied free-text redactor. The engine invokes it at each free-text locus and treats a
returned [FreeTextRedactionResult](#freetextredactionresult) as **consumer-asserted** (recorded as
`DEID_FREETEXT_CONSUMER_REDACTED`). Returning `null` / `undefined`, or throwing, makes the engine
**fail closed** and block the locus. The library never inspects the returned text for residual PHI;
completeness is the consumer's responsibility.

#### Parameters

##### request

[`FreeTextRedactionRequest`](#freetextredactionrequest)

The free-text value, its value-free locus path, and its category when known.

#### Returns

[`FreeTextRedactionResult`](#freetextredactionresult) \| `null` \| `undefined`

The redacted prose as `{ text }`, or `null` / `undefined` to decline (engine blocks).

#### Example

```ts
import { deidentify, type FreeTextRedactor } from "@cosyte/deid";

// A consumer plugs in their own detector; the library bundles none.
const redactor: FreeTextRedactor = ({ text }) => ({ text: myNerModel.scrub(text) });
const result = deidentify(model, { redactor });
```

***

### LocusKind

> **LocusKind** = `"identifier"` \| `"date"` \| `"age"` \| `"zip"` \| `"freetext"` \| `"clinical"` \| `"unknown"`

The kind of value at a locus: drives which generalization applies and whether the engine must
fail closed. `clinical` is the over-scrub guard: a clinical value (a lab result, a dose, a code, a
status) is **not** an identifier and must survive untouched.

#### Example

```ts
import { type LocusKind } from "@cosyte/deid";

const kind: LocusKind = "identifier";
```

***

### PartyRoleClassification

> **PartyRoleClassification** = \{ `roleCode`: `string`; `scope`: `"safe-harbor-subject"` \| `"outside-scope"`; \} \| \{ `roleCode?`: `undefined`; `scope`: `"unknown"`; \}

The outcome of [classifyPartyRole](#classifypartyrole). `roleCode` is present only when the role was **recognized**,
and is then the matching member of the caller's own table: it carries no name, no identifier and no
other value, so it is safe to record in the value-free manifest.

#### Union Members

##### Type Literal

\{ `roleCode`: `string`; `scope`: `"safe-harbor-subject"` \| `"outside-scope"`; \}

###### roleCode

> `readonly` **roleCode**: `string`

The matching member of the caller's table: a code, never a value.

###### scope

> `readonly` **scope**: `"safe-harbor-subject"` \| `"outside-scope"`

The role was recognized on one of the two lists.

***

##### Type Literal

\{ `roleCode?`: `undefined`; `scope`: `"unknown"`; \}

###### roleCode?

> `readonly` `optional` **roleCode?**: `undefined`

Never carried for an unrecognized role: an unknown code is not this library's to echo.

###### scope

> `readonly` **scope**: `"unknown"`

The role is absent, empty, or on neither list: fail closed.

#### Example

```ts
import { classifyPartyRole, type PartyRoleClassification } from "@cosyte/deid";

const c: PartyRoleClassification = classifyPartyRole("85", {
  subject: new Set(["36"]),
  outside: new Set(["85"]),
});
c.scope; // => "outside-scope"
```

***

### PartyRoleScope

> **PartyRoleScope** = `"safe-harbor-subject"` \| `"outside-scope"` \| `"unknown"`

Where a party's role places it relative to §164.514(b)(2)(i):

- `safe-harbor-subject`: the individual, a relative, an employer or a household member. Name and
  identifiers are transformed under the Safe Harbor categories.
- `outside-scope`: a party the clause does not reach (provider / facility / payer / payee / submitter
  / receiver / clearinghouse). Name and identifiers are left in place.
- `unknown`: the role could not be established. **Fails closed**, handled exactly like a subject.

#### Example

```ts
import { type PartyRoleScope } from "@cosyte/deid";

const scope: PartyRoleScope = "outside-scope";
```

***

### ReportDisposition

> **ReportDisposition** = `"transformed"` \| `"removed"` \| `"blocked"` \| `"retained"`

A manifest disposition: the four outcomes an acted-on locus can have. `retained` covers two kept
things, told apart by the entry's code: an **identifying** locus the configured profile's retention
set deliberately kept unchanged (`DEID_RESIDUAL_RETAINED`, which also appears in the residual
inventory below), and a **party** whose role places it outside §164.514(b)(2)(i)'s scope clause
(`DEID_PARTY_ROLE_RETAINED`, which does not: it is not a residual of the individual's identity).

***

### RetainedLocusClass

> **RetainedLocusClass** = *typeof* [`RETAINED_LOCUS_CLASSES`](#retained_locus_classes)\[keyof *typeof* [`RETAINED_LOCUS_CLASSES`](#retained_locus_classes)\]

A value from [RETAINED\_LOCUS\_CLASSES](#retained_locus_classes): the class a profile lists to keep, and an adapter
checks before it passes a locus through.

#### Example

```ts
import { RETAINED_LOCUS_CLASSES, type RetainedLocusClass } from "@cosyte/deid";

const cls: RetainedLocusClass = RETAINED_LOCUS_CLASSES.ENCOUNTER_IDENTIFIERS;
```

***

### RetainedLocusPart

> **RetainedLocusPart** = *typeof* [`LIMITED_DATA_SET_ADDRESS_PARTS`](#limited_data_set_address_parts)\[keyof *typeof* [`LIMITED_DATA_SET_ADDRESS_PARTS`](#limited_data_set_address_parts)\]

A value from [LIMITED\_DATA\_SET\_ADDRESS\_PARTS](#limited_data_set_address_parts): the **named part** of an otherwise-excluded
category that an adapter proposes keeping, and that [isRetainablePart](#isretainablepart) checks.

#### Example

```ts
import { LIMITED_DATA_SET_ADDRESS_PARTS, type RetainedLocusPart } from "@cosyte/deid";

const part: RetainedLocusPart = LIMITED_DATA_SET_ADDRESS_PARTS.STATE;
```

***

### SafeHarborCategory

> **SafeHarborCategory** = *typeof* [`SAFE_HARBOR_CATEGORIES`](#safe_harbor_categories)\[keyof *typeof* [`SAFE_HARBOR_CATEGORIES`](#safe_harbor_categories)\]

A value from [SAFE\_HARBOR\_CATEGORIES](#safe_harbor_categories): the type a policy and a manifest entry carry.

#### Example

```ts
import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "@cosyte/deid";

const c: SafeHarborCategory = SAFE_HARBOR_CATEGORIES.SSN;
```

***

### TransformName

> **TransformName** = `"redact"` \| `"generalize"` \| `"date-shift"` \| `"pseudonymize"` \| `"hash"` \| `"block"` \| `"byo-redact"` \| `"retain"`

The name of a transform a policy can assign to a category. `block` is the fail-closed action
(withhold the value); `generalize` selects the correct generalization from the locus kind (date /
ZIP / age).

`byo-redact` is **not** a policy-assignable Safe Harbor transform and **not** something the library
performs: it is the manifest marker the engine records when a **consumer-supplied free-text
redactor** redacts a free-text locus. The library bundles no redactor; the
consumer brings the detector. Assigning `byo-redact` to a category in a policy has no effect beyond
the fail-closed default (the engine blocks it), because free-text redaction is driven by the
`redactor` option, not by the per-category policy map.

`retain` is likewise **not** policy-assignable: it is the manifest marker for a locus the profile's
**retention set** deliberately kept unchanged, which is driven by that set and not by the
per-category map. Assigning it to a category fails closed to a block, exactly like `byo-redact`.

#### Example

```ts
import { type TransformName } from "@cosyte/deid";

const t: TransformName = "pseudonymize";
```

## Variables

### DEID\_DISPOSITION\_CODES

> `const` **DEID\_DISPOSITION\_CODES**: `object`

**Disposition codes**: the value-free record of what the engine did at a locus. Every manifest
entry carries exactly one. They describe the *action and its residual*, never the value acted on.

#### Type Declaration

##### DEID\_CATEGORY\_DATE\_SHIFTED

> `readonly` **DEID\_CATEGORY\_DATE\_SHIFTED**: `"DEID_CATEGORY_DATE_SHIFTED"` = `"DEID_CATEGORY_DATE_SHIFTED"`

A date was shifted by a deterministic per-patient offset (interval-preserving).

##### DEID\_CATEGORY\_GENERALIZED

> `readonly` **DEID\_CATEGORY\_GENERALIZED**: `"DEID_CATEGORY_GENERALIZED"` = `"DEID_CATEGORY_GENERALIZED"`

A category was generalized to a fully non-identifying form: a ZIP whose area is restricted → `000`,
an age over 89 → `90+`, or, where a field cannot hold `90+`, an age over 89 or a birth year that
shows one removed.

##### DEID\_CATEGORY\_HASHED

> `readonly` **DEID\_CATEGORY\_HASHED**: `"DEID_CATEGORY_HASHED"` = `"DEID_CATEGORY_HASHED"`

A value was replaced by a keyed one-way digest (keyed hash).

##### DEID\_CATEGORY\_PSEUDONYMIZED

> `readonly` **DEID\_CATEGORY\_PSEUDONYMIZED**: `"DEID_CATEGORY_PSEUDONYMIZED"` = `"DEID_CATEGORY_PSEUDONYMIZED"`

A category was replaced by a consistent keyed-HMAC surrogate (pseudonymization).

##### DEID\_CATEGORY\_REMOVED

> `readonly` **DEID\_CATEGORY\_REMOVED**: `"DEID_CATEGORY_REMOVED"` = `"DEID_CATEGORY_REMOVED"`

A category was removed outright (redaction).

##### DEID\_FREETEXT\_BLOCKED

> `readonly` **DEID\_FREETEXT\_BLOCKED**: `"DEID_FREETEXT_BLOCKED"` = `"DEID_FREETEXT_BLOCKED"`

Fail-closed: a free-text locus was blocked by default (no naive regex scrub).

##### DEID\_FREETEXT\_CONSUMER\_REDACTED

> `readonly` **DEID\_FREETEXT\_CONSUMER\_REDACTED**: `"DEID_FREETEXT_CONSUMER_REDACTED"` = `"DEID_FREETEXT_CONSUMER_REDACTED"`

A free-text locus was redacted **by a consumer-supplied BYO redactor**, not by
the library. The library ships **no** NLP/PHI-detection engine; it orchestrates the consumer's
redactor at free-text loci and records the outcome here. This code is **consumer-asserted, never a
library guarantee**: "no findings" from a BYO redactor is not an attestation, and a redactor's
completeness is the consumer's responsibility (Expert-Determination territory). The
structural PHI removal the format adapters perform is unaffected: this covers only the free *prose*.

##### DEID\_IDENTIFIER\_SUBSTITUTED

> `readonly` **DEID\_IDENTIFIER\_SUBSTITUTED**: `"DEID_IDENTIFIER_SUBSTITUTED"` = `"DEID_IDENTIFIER_SUBSTITUTED"`

An identifier that other positions of the same document point at (a FHIR resource's logical `id`,
the id part of a `fullUrl` or of a reference) was **removed and a stand-in written in its place**,
because the configured transform for its category withholds the value (`redact` or `block`). The
stand-in is a sequence number counted from 1 in the order the distinct identifiers are first met in
one call, written in the identifier's shape (a UUID, an OID, or a plain token). It is not computed
from the identifier; the same identifier gets the same stand-in throughout the call, so every link
still resolves, and it means nothing outside that call. It is not a keyed surrogate, so the entry's
`reidentificationCode` is `false`. The disposition-code set is additions-only.

##### DEID\_LOCUS\_BLOCKED

> `readonly` **DEID\_LOCUS\_BLOCKED**: `"DEID_LOCUS_BLOCKED"` = `"DEID_LOCUS_BLOCKED"`

Fail-closed: an unrecognized / un-locatable / uncertain locus was blocked (value withheld).

##### DEID\_PARTY\_ROLE\_RETAINED

> `readonly` **DEID\_PARTY\_ROLE\_RETAINED**: `"DEID_PARTY_ROLE_RETAINED"` = `"DEID_PARTY_ROLE_RETAINED"`

A **party** was left in place because the role its format types at that party puts it **outside**
§164.514(b)(2)(i)'s scope clause (a treating clinician, a facility, a payer, a payee, a submitter,
a receiver, a clearinghouse: not the individual, a relative, an employer or a household member).
The entry names the party's structural locus and, in `partyRole`, the **role code the pass
classified on**, so a retention decision that used to be silent can be audited. It carries no name,
no identifier and no other value.

It is deliberately **not** `DEID_RESIDUAL_RETAINED`: that code is a residual of the *individual's*
own identity (a kept year, a safe ZIP prefix, a whole value a limited-data-set retention set kept)
and feeds the determiner's retained-quasi-identifier inventory. A party outside the scope clause is
a different fact and stays out of that inventory. The disposition-code set is additions-only.

##### DEID\_POSITION\_UNEXAMINED

> `readonly` **DEID\_POSITION\_UNEXAMINED**: `"DEID_POSITION_UNEXAMINED"` = `"DEID_POSITION_UNEXAMINED"`

A **value-bearing position inside a structure the pass handed through that no locus rule names**.
The pass reached **no decision** there: it neither acted on the position, nor blocked it, nor
decided to keep it. The record exists so that such a position is counted and located rather than
passing through in silence.

It is deliberately **not** `DEID_RESIDUAL_RETAINED`, and the difference is the whole point of the
code: that one is a residual of a value the pass **examined** (a kept year, a safe 3-digit ZIP
prefix, a whole value a retention class kept) and it feeds the determiner's retained-quasi-identifier
inventory. This one is the opposite fact, an **unexamined** position, and it has its own inventory
so a kept year and a position nothing looked at can never be read as the same thing.

**It is a measurement, not an allegation.** An unexamined position is not thereby an identifier: a
clinical code, a unit and a status all sit at positions no locus rule names. Nothing is scrubbed,
removed or generalized on account of this record, and the position has **no established Safe Harbor
category**, because no rule established one. The record carries the structural locus, a count and
the fact of being unexamined: never a value, never a key, never an offset. The disposition-code set
is additions-only.

##### DEID\_RESIDUAL\_RETAINED

> `readonly` **DEID\_RESIDUAL\_RETAINED**: `"DEID_RESIDUAL_RETAINED"` = `"DEID_RESIDUAL_RETAINED"`

A generalization retained a coarse residual (a kept year, a retained safe 3-digit ZIP prefix).
Surfaced so a human can apply the §164.514(b)(2)(ii) actual-knowledge test with the facts present.

#### Example

```ts
import { DEID_DISPOSITION_CODES } from "@cosyte/deid";

DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED; // => "DEID_LOCUS_BLOCKED"
```

***

### EXPERT\_DETERMINATION\_DISCLAIMER

> `const` **EXPERT\_DETERMINATION\_DISCLAIMER**: `string`

The prominent non-certification statement. It is the first field a reader sees and is repeated at the
head of the human-readable rendering. Its job is to make over-claiming impossible to do by accident:
the report supports a determination, it is never the determination.

#### Example

```ts
import { EXPERT_DETERMINATION_DISCLAIMER } from "@cosyte/deid";

EXPERT_DETERMINATION_DISCLAIMER.includes("NOT a determination"); // => true
```

***

### FATAL\_CODES

> `const` **FATAL\_CODES**: `object`

**Fatal codes**: conditions that abort a de-identification pass by throwing a [DeidError](#deiderror).
The engine fails **closed**: it never silently degrades a fatal into a pass-through of PHI.

#### Type Declaration

##### DEID\_CONTEXT\_INVALID

> `readonly` **DEID\_CONTEXT\_INVALID**: `"DEID_CONTEXT_INVALID"` = `"DEID_CONTEXT_INVALID"`

A [DeidContext](#deidcontext) was configured with an invalid parameter that would silently weaken
de-identification: most importantly a `maxShiftDays` that floors to **0**, which pins **every**
per-patient date-shift offset to zero, so a `date-shift` policy would emit the **original real
dates** under a research label. A no-op shift is a leak, so the engine rejects the degenerate
configuration at construction rather than silently shipping unshifted dates. The fatal set is
additions-only.

##### DEID\_DECLARATION\_UNNAMEABLE

> `readonly` **DEID\_DECLARATION\_UNNAMEABLE**: `"DEID_DECLARATION_UNNAMEABLE"` = `"DEID_DECLARATION_UNNAMEABLE"`

A pass would apply a **profile or option that its published coding vocabulary cannot name**, so the
machine-readable declaration it is required to write could only be an approximation.

Fail closed on the declaration itself. A coded term is read by a downstream system as a property of
the document and is acted on **without a human**, so an approximate code is worse than no output at
all: it is a claim about what was removed that nobody re-checks, and a document released on a false
coded claim cannot be un-released. A pass that cannot name what it did therefore returns nothing
rather than a document stamped with a declaration that is not true of it.

The message names the **profile or option** (a bounded structural token from the pass's own closed
option set, never a value read from the document) and carries no value, no key and no offset. The
fatal set is additions-only.

##### DEID\_FORMAT\_UNSUPPORTED

> `readonly` **DEID\_FORMAT\_UNSUPPORTED**: `"DEID_FORMAT_UNSUPPORTED"` = `"DEID_FORMAT_UNSUPPORTED"`

A caller handed an adapter a **document in a format that adapter refuses outright**, rather than
the format its entry point de-identifies, or a shape of that format it refuses outright (an NCPDP
Telecom transmission carrying more than one transaction).

Refusal, not best effort. An adapter reaches a document only through the parser surface its peer
package publishes, and where that surface cannot express a faithful structural pass, a partial
pass is a **false-safety hazard**: it would return a document a consumer reads as
Safe-Harbor-transformed while positions the surface never modelled rode straight through it.
Refusing is the fail-closed answer and it is the one a test can pin; a documented non-goal in
prose is not, because prose is not a behaviour.

The message names the **format** and the parser-surface reason, both fixed text this library
owns. It carries no value read from the document, no key and no offset, and the pass returns no
transformed document, no manifest and no partial output of any kind. The fatal set is
additions-only.

##### DEID\_KEY\_TOO\_SHORT

> `readonly` **DEID\_KEY\_TOO\_SHORT**: `"DEID_KEY_TOO_SHORT"` = `"DEID_KEY_TOO_SHORT"`

An HMAC key or an explicit date-shift seed is **shorter than 16 bytes (128 bits)**. The length is
measured on the bytes the HMAC uses: a `Uint8Array` as given, a string as its UTF-8 encoding (a
hex or base64 string is not decoded). A short key can be guessed, and a guessed key reverses
every keyed surrogate and every date-shift offset made under it, so the context refuses it at
construction rather than mint surrogates nobody can trust.

The message names the minimum and how to make a key (32 random bytes), and carries no key, no
part of one, and no length. An empty key stays `DEID_NO_KEY`. The fatal set is additions-only.

##### DEID\_NO\_KEY

> `readonly` **DEID\_NO\_KEY**: `"DEID_NO_KEY"` = `"DEID_NO_KEY"`

A **keyed** transform (pseudonymize / keyed-hash / date-shift) was required for a category present
in the model, but no key (or, for date-shift, no per-patient scope) was supplied. The engine
**never** falls back to an unkeyed transform: an unkeyed hash of an identifier is re-identifiable.

##### DEID\_OUTPUT\_INVALID

> `readonly` **DEID\_OUTPUT\_INVALID**: `"DEID_OUTPUT_INVALID"` = `"DEID_OUTPUT_INVALID"`

The transformed document could not be re-serialized, or no longer round-trips through its own
parser: what came back out of the writer is not what the reader reads. A de-identification pass
that cannot vouch for the shape of its own output cannot vouch for what a downstream reader will
make of the values inside it, so the pass fails rather than hand back a partially transformed
document. The fatal set is additions-only.

##### DEID\_POLICY\_INVALID

> `readonly` **DEID\_POLICY\_INVALID**: `"DEID_POLICY_INVALID"` = `"DEID_POLICY_INVALID"`

A policy violates the key/label contract: whatever claims the reserved **`safe-harbor`** label,
either as a policy **name** or as a profile's declared **standard**, assigns a category a
transform whose output for that category is **derived from that category's own value**. A
shifted-but-real date is still "an element of a date" under §164.514(b)(2)(i)(C), and a keyed
surrogate of a medical record, beneficiary or account number is a code "derived from ...
information about the individual", which §164.514(c)(1) does not permit and the (R) exception
therefore does not reach. Both are Expert-Determination techniques, **not** Safe Harbor ones, and
labelling either `safe-harbor` would misrepresent the residual risk.

The refusal names the offending category and transform, carries no value / key / offset, and
fires both at mint time and at point of use, so a hand-built policy object cannot slip past. It
also covers an assignment that is not a published transform name at all: a pair whose derivation
cannot be established is refused, never permitted. A policy that does **not** claim the label is
entitled to its keyed surrogate and is applied unchanged. The fatal set is additions-only.

##### DEID\_POSITIONS\_UNENUMERABLE

> `readonly` **DEID\_POSITIONS\_UNENUMERABLE**: `"DEID_POSITIONS_UNENUMERABLE"` = `"DEID_POSITIONS_UNENUMERABLE"`

The **value-bearing positions of a structure the pass would hand through could not be enumerated**,
so the pass cannot say how much of that structure it never examined.

Fail closed on the measurement itself. The alternative outcomes are both worse than a failure: a
count of **zero** would tell a determiner the structure held nothing unexamined, and a **partial**
count would understate it, and either is read as a measurement rather than as a gap. A pass that
cannot enumerate a structure therefore returns nothing at all rather than a number nobody can
qualify.

The message names the **structure** (a bounded structural token: a segment identifier, an element
name, a tag) and carries no value, no key and no offset. The fatal set is additions-only.

##### DEID\_PROFILE\_INVALID

> `readonly` **DEID\_PROFILE\_INVALID**: `"DEID_PROFILE_INVALID"` = `"DEID_PROFILE_INVALID"`

A [DeidProfile](#deidprofile) spec violates the **widen-never-narrow** contract: a per-site profile derived
from a base profile may only move a category to an **equal-or-stronger** transform (more removal,
never less), and may never re-weaken a category the base scrubs. A profile that would *reduce* the
de-identification strength of any category is rejected, so a site preset can only ever tighten, not
quietly loosen, the base standard's protection. The fatal set is additions-only.

##### EMPTY\_INPUT

> `readonly` **EMPTY\_INPUT**: `"EMPTY_INPUT"` = `"EMPTY_INPUT"`

The input model was null/undefined or carried no locus list, nothing to de-identify.

#### Example

```ts
import { FATAL_CODES } from "@cosyte/deid";

FATAL_CODES.DEID_NO_KEY; // => "DEID_NO_KEY"
```

***

### KEYED\_TRANSFORMS

> `const` **KEYED\_TRANSFORMS**: `ReadonlySet`\<[`TransformName`](#transformname)\>

The transforms that require the consumer's key (and, for `date-shift`, a per-patient scope).

***

### LIMITED\_DATA\_SET\_ADDRESS\_PARTS

> `const` **LIMITED\_DATA\_SET\_ADDRESS\_PARTS**: `object`

The **three parts of a postal address §164.514(e)(2)(ii) names as surviving** a limited data set,
in the regulation's own words: "other than **town or city, State, and zip code**". Nothing else in
an address is named, so nothing else survives: not the street, not a second address line, not the
county or parish, not the census tract, not the country, not a birth place.

#### Type Declaration

##### STATE

> `readonly` **STATE**: `"state"` = `"state"`

"State": the state or province the address sits in.

##### TOWN\_OR\_CITY

> `readonly` **TOWN\_OR\_CITY**: `"town-or-city"` = `"town-or-city"`

"town or city": the populated place, and nothing finer.

##### ZIP\_CODE

> `readonly` **ZIP\_CODE**: `"zip-code"` = `"zip-code"`

"zip code": the WHOLE zip code. The three-digit rule is Safe Harbor's, not (e)(2)'s.

#### Example

```ts
import { LIMITED_DATA_SET_ADDRESS_PARTS } from "@cosyte/deid";

LIMITED_DATA_SET_ADDRESS_PARTS.ZIP_CODE; // => "zip-code"
```

***

### LIMITED\_DATA\_SET\_DIRECT\_IDENTIFIERS

> `const` **LIMITED\_DATA\_SET\_DIRECT\_IDENTIFIERS**: `ReadonlySet`\<[`SafeHarborCategory`](#safeharborcategory)\>

The **sixteen direct identifiers §164.514(e)(2) excludes from a limited data set**, mapped onto this
library's category model: (i) names, (ii) postal address other than town/city/State/ZIP,
(iii) telephone, (iv) fax, (v) email, (vi) social security, (vii) medical record, (viii) health plan
beneficiary, (ix) account, (x) certificate/licence, (xi) vehicle, (xii) device, (xiii) URL, (xiv) IP,
(xv) biometric, (xvi) full-face image.

**This is the guard that makes the retention citation true rather than merely asserted.** The
argument for keeping an encounter or order number is that this list has no catch-all; the argument
for keeping a service date is that it has no date. **Neither argument survives if the value at the
locus turns out to be one of the sixteen** -- and a visit number field routinely carries a medical
record or account number, typed as such by the standard's own identifier-type code. So retention is
**refused** whenever the resolved category is on this list, whatever an adapter asked for, in both
the adapter and the engine.

Exactly two of the eighteen Safe Harbor categories are absent from it: `DATES` and the (R) catch-all
`OTHER_UNIQUE_ID`. Those two, and only those two, are retainable.

#### Example

```ts
import { LIMITED_DATA_SET_DIRECT_IDENTIFIERS, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

LIMITED_DATA_SET_DIRECT_IDENTIFIERS.has(SAFE_HARBOR_CATEGORIES.MRN); // => true  (never retainable)
LIMITED_DATA_SET_DIRECT_IDENTIFIERS.has(SAFE_HARBOR_CATEGORIES.DATES); // => false (retainable)
```

***

### LIMITED\_DATA\_SET\_PROFILE

> `const` **LIMITED\_DATA\_SET\_PROFILE**: [`DeidProfile`](#deidprofile)

The **Limited Data Set / longitudinal research** profile. Identical to Safe Harbor **except** that
dates are **date-shifted** (a single consistent per-patient offset, intervals preserved) rather than
generalized to year, and that the medical record, health plan beneficiary and account numbers are
replaced by a **consistent keyed surrogate** rather than removed, so cross-document linkage
survives. Both are keyed transforms, and both are why this preset does not, and may not, claim Safe
Harbor: a surrogate derived from the individual's own value is a re-identification code
§164.514(c)(1) does not permit. Every such locus is flagged `reidentificationCode` in the manifest
and listed in the support report's keyed-surrogate residual inventory.

It also **keeps**, unchanged, the three classes of identifying locus §164.514(e)(2) permits a limited
data set to carry and Safe Harbor does not: **encounter dates** (admission / discharge / service /
diagnosis), **encounter and order identifiers** (visit number, placer and filler order numbers), and
the **postal address parts (e)(2)(ii) names**: town or city, State and the **whole** zip code, with
the street address and every other geographic component removed. That list of sixteen direct
identifiers names no date and has **no catch-all**, which is precisely why the first two survive
here and are removed under Safe Harbor; (e)(2)(ii) is its only **partial** exclusion, which is why
the third does. The three-digit / `000` ZIP rule is §164.514(b)(2)(i)(B), **Safe Harbor's**, and has
no (e)(2) counterpart, so a restricted-prefix ZIP is kept in full here too. Each kept locus is still
**recorded** as a `DEID_RESIDUAL_RETAINED` residual, located to its own component, so it reaches the
determiner's residual inventory.

**The geographic allowance is honoured by the HL7 v2 pass alone.** The C-CDA, FHIR, X12, NCPDP and
DICOM adapters do not read retention classes, so under those five an address is reduced exactly as
Safe Harbor reduces it. The direction is the safe one and it is stated rather than left to be
discovered.

**On dates the preset is deliberately STRICTER than §164.514(e)(2).** The list of sixteen names no
date, so a limited data set may carry dates at full precision; this preset date-shifts them anyway,
by choice. Removing more than the regulation requires is always lawful, and the alternative would
hand every existing consumer real patient dates on an upgrade, which is the direction no re-run
undoes.

**This is deliberately less protective than Safe Harbor and is NOT Safe Harbor.** A shifted-but-real
date is still "an element of a date" (§164.514(b)(2)(i)(C)), so this profile:

- is **not** labelled `safe-harbor` (the reserved-label guard would reject it);
- **requires** a keyed per-patient [DeidContext](#deidcontext) (an absent key is a fatal `DEID_NO_KEY`);
- produces an **Expert-Determination-supporting** dataset, **not** a certified de-identification, and
  **not**, on its own, a HIPAA §164.514(e) Limited Data Set: disclosing an actual Limited Data Set
  additionally requires a Data Use Agreement, which is the consumer's responsibility.

#### Example

```ts
import { LIMITED_DATA_SET_PROFILE } from "@cosyte/deid";

LIMITED_DATA_SET_PROFILE.requiresContext; // => true (date-shift needs a per-patient key)
```

***

### LIMITED\_DATA\_SET\_RETENTION\_CLASSES

> `const` **LIMITED\_DATA\_SET\_RETENTION\_CLASSES**: `ReadonlySet`\<[`RetainedLocusClass`](#retainedlocusclass)\>

The retention classes a profile **declaring** the `limited-data-set` standard may carry: exactly
those §164.514(e)(2) leaves out of its sixteen direct identifiers, plus the parts (e)(2)(ii) names.

The list has **no date** and **no catch-all**, so encounter dates and encounter / order identifiers
survive it; (e)(2)(ii) is a **partial** exclusion, so the three named address parts survive it. A
class outside this set is a claim the regulation does not support, and
[assertLimitedDataSetRetention](#assertlimiteddatasetretention) refuses it rather than letting the profile wear the name.

#### Example

```ts
import { LIMITED_DATA_SET_RETENTION_CLASSES, RETAINED_LOCUS_CLASSES } from "@cosyte/deid";

LIMITED_DATA_SET_RETENTION_CLASSES.has(RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES); // => true
```

***

### NO\_RETAINED\_LOCI

> `const` **NO\_RETAINED\_LOCI**: readonly [`RetainedLocusClass`](#retainedlocusclass)[]

The empty retention set: the fail-closed default every entry point uses.

***

### OUTPUT\_LABEL

> `const` **OUTPUT\_LABEL**: `"Safe-Harbor-transformed per the configured policy"` = `"Safe-Harbor-transformed per the configured policy"`

The label the library applies to its output. Deliberately **not** "de-identified" /
"HIPAA-compliant": the certification is always the consumer's.

#### Example

```ts
import { OUTPUT_LABEL } from "@cosyte/deid";

OUTPUT_LABEL; // => "Safe-Harbor-transformed per the configured policy"
```

***

### RESTRICTED\_ZIP3

> `const` **RESTRICTED\_ZIP3**: `ReadonlySet`\<`string`\>

The 23 restricted three-digit ZIP prefixes: the 18 whose 2020 Census population is 20,000 or fewer,
plus the 5 more the HHS guidance lists from the 2000 Census. A ZIP whose first three digits are in
this set is generalized to `000`; any other prefix retains its three digits.

#### Example

```ts
import { RESTRICTED_ZIP3 } from "@cosyte/deid";

RESTRICTED_ZIP3.has("036"); // => true
RESTRICTED_ZIP3.has("369"); // => true
RESTRICTED_ZIP3.has("902"); // => false
```

***

### RESTRICTED\_ZIP3\_SOURCE

> `const` **RESTRICTED\_ZIP3\_SOURCE**: `Readonly`\<\{ `census`: `"2020"`; `citation`: `"45 CFR §164.514(b)(2)(i)(B); HHS OCR, Guidance Regarding Methods for De-identification of PHI (2012), whose 2000 Census list is kept"`; `dataset`: `"2020 Census Demographic and Housing Characteristics File, table P1, by five-digit ZCTA"`; \}\>

The Census vintage and dataset this list is grounded in, surfaced so a consumer knows exactly which
published artifact the `000` rule is applied from.

#### Example

```ts
import { RESTRICTED_ZIP3_SOURCE } from "@cosyte/deid";

RESTRICTED_ZIP3_SOURCE.census; // => "2020"
```

***

### RETAINED\_LOCUS\_CLASSES

> `const` **RETAINED\_LOCUS\_CLASSES**: `object`

The stable registry of retention classes. `key === value` so the full set survives an
`Object.values(...)` snapshot into a stability tripwire. These are part of the public contract:
renaming or removing one is a **breaking change**; new classes may be **added** in a later release.

#### Type Declaration

##### ENCOUNTER\_DATES

> `readonly` **ENCOUNTER\_DATES**: `"encounter-dates"` = `"encounter-dates"`

Patient-related **dates** carried by retained clinical / visit structures: admission, discharge,
observation / service, and diagnosis dates. These are elements of dates directly related to the
individual, so **Safe Harbor removes them** (only the year may remain); a limited data set
**may keep them**, because §164.514(e)(2)'s direct-identifier list names no date.

##### ENCOUNTER\_IDENTIFIERS

> `readonly` **ENCOUNTER\_IDENTIFIERS**: `"encounter-identifiers"` = `"encounter-identifiers"`

**Encounter and order identifiers**: the visit / encounter number, and the placer and filler order
numbers. These are not one of the seventeen concrete Safe Harbor identifier types, so Safe Harbor
reaches them through the **(R)** catch-all and they are blocked; §164.514(e)(2) has **no**
catch-all, so a limited data set **may keep them**.

##### LIMITED\_DATA\_SET\_GEOGRAPHY

> `readonly` **LIMITED\_DATA\_SET\_GEOGRAPHY**: `"limited-data-set-geography"` = `"limited-data-set-geography"`

The **named parts of a postal address** §164.514(e)(2)(ii) permits a limited data set to carry.
The clause excludes "Postal address information, **other than town or city, State, and zip
code**", which makes it the **only PARTIAL exclusion** in the list of sixteen: three named parts
survive and everything else in the address does not.

**What survives**: town or city, State, and the **whole** zip code. The digit limit and the
`000` substitution are §164.514(b)(2)(i)(B), which is **Safe Harbor's** rule; (e)(2) states no
digit limit and no population condition, so the ZIP is kept in full here.

**What does not**: the street address, any second address line, the county or parish, the
census tract or other geographic designation, the country, and a birth place. None of those is
named by the clause, so none of them is widened by this class.

**It permits PARTS, never the category.** `GEOGRAPHIC` stays on
[LIMITED\_DATA\_SET\_DIRECT\_IDENTIFIERS](#limited_data_set_direct_identifiers) and [isRetainableCategory](#isretainablecategory) still returns
`false` for it, because a partial exclusion is not a whole-category one. The only route past
that guard is [isRetainablePart](#isretainablepart), which is keyed on this class, that category and one of
the three names above.

**Scope, stated rather than implied**: only the **HL7 v2** adapter reads this class today, like
every other. Under the C-CDA, FHIR, X12, NCPDP and DICOM adapters an address is reduced exactly
as it is without it (the Safe Harbor generalization), which is the stricter direction.

#### Example

```ts
import { RETAINED_LOCUS_CLASSES } from "@cosyte/deid";

RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES; // => "encounter-dates"
```

***

### SAFE\_HARBOR\_CATEGORIES

> `const` **SAFE\_HARBOR\_CATEGORIES**: `object`

The stable registry of the 18 Safe Harbor identifier categories. `key === value` so the set
survives an `Object.values(...)` snapshot into a stability tripwire. Renaming a category is a
**breaking change**: consumers branch on these in policies and manifests.

#### Type Declaration

##### ACCOUNT

> `readonly` **ACCOUNT**: `"ACCOUNT"` = `"ACCOUNT"`

(J) Account numbers.

##### BIOMETRIC

> `readonly` **BIOMETRIC**: `"BIOMETRIC"` = `"BIOMETRIC"`

(P) Biometric identifiers, including finger and voice prints.

##### CERTIFICATE\_LICENSE

> `readonly` **CERTIFICATE\_LICENSE**: `"CERTIFICATE_LICENSE"` = `"CERTIFICATE_LICENSE"`

(K) Certificate / license numbers.

##### DATES

> `readonly` **DATES**: `"DATES"` = `"DATES"`

(C) All elements of dates (except year) directly related to the individual, and all ages \> 89.

##### DEVICE

> `readonly` **DEVICE**: `"DEVICE"` = `"DEVICE"`

(M) Device identifiers and serial numbers.

##### EMAIL

> `readonly` **EMAIL**: `"EMAIL"` = `"EMAIL"`

(F) Email addresses.

##### FAX

> `readonly` **FAX**: `"FAX"` = `"FAX"`

(E) Fax numbers.

##### FULL\_FACE\_PHOTO

> `readonly` **FULL\_FACE\_PHOTO**: `"FULL_FACE_PHOTO"` = `"FULL_FACE_PHOTO"`

(Q) Full-face photographs and any comparable images.

##### GEOGRAPHIC

> `readonly` **GEOGRAPHIC**: `"GEOGRAPHIC"` = `"GEOGRAPHIC"`

(B) All geographic subdivisions smaller than a state: street, city, county, precinct, ZIP, geocodes.

##### HEALTH\_PLAN\_BENEFICIARY

> `readonly` **HEALTH\_PLAN\_BENEFICIARY**: `"HEALTH_PLAN_BENEFICIARY"` = `"HEALTH_PLAN_BENEFICIARY"`

(I) Health plan beneficiary numbers.

##### IP\_ADDRESS

> `readonly` **IP\_ADDRESS**: `"IP_ADDRESS"` = `"IP_ADDRESS"`

(O) IP addresses.

##### MRN

> `readonly` **MRN**: `"MRN"` = `"MRN"`

(H) Medical record numbers.

##### NAMES

> `readonly` **NAMES**: `"NAMES"` = `"NAMES"`

(A) Names: patient, relatives, employers, household members.

##### OTHER\_UNIQUE\_ID

> `readonly` **OTHER\_UNIQUE\_ID**: `"OTHER_UNIQUE_ID"` = `"OTHER_UNIQUE_ID"`

(R) Any other unique identifying number, characteristic, or code (the open-ended catch-all).

##### PHONE

> `readonly` **PHONE**: `"PHONE"` = `"PHONE"`

(D) Telephone numbers.

##### SSN

> `readonly` **SSN**: `"SSN"` = `"SSN"`

(G) Social Security numbers.

##### URL

> `readonly` **URL**: `"URL"` = `"URL"`

(N) Web URLs.

##### VEHICLE

> `readonly` **VEHICLE**: `"VEHICLE"` = `"VEHICLE"`

(L) Vehicle identifiers and serial numbers, including license plates.

#### Example

```ts
import { SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

SAFE_HARBOR_CATEGORIES.MRN; // => "MRN"
```

***

### SAFE\_HARBOR\_CATEGORY\_META

> `const` **SAFE\_HARBOR\_CATEGORY\_META**: `Readonly`\<`Record`\<[`SafeHarborCategory`](#safeharborcategory), \{ `letter`: `string`; `number`: `number`; `title`: `string`; \}\>\>

Per-category regulatory metadata: the §164.514(b)(2)(i) sub-paragraph letter (A to R), the ordinal
number (1 to 18), and a short human title. Grounded firsthand in the regulation text; contains no PHI.

#### Example

```ts
import { SAFE_HARBOR_CATEGORY_META, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

SAFE_HARBOR_CATEGORY_META[SAFE_HARBOR_CATEGORIES.GEOGRAPHIC].letter; // => "B"
```

***

### SAFE\_HARBOR\_POLICY

> `const` **SAFE\_HARBOR\_POLICY**: [`DeidPolicy`](#deidpolicy)

The built-in **Safe Harbor** policy. Direct identifiers with no analytic value are redacted, and
that includes the medical record, health plan beneficiary and account numbers: their value is
**removed**, never replaced by a keyed surrogate. Geography and dates are generalized; the
open-ended catch-all (R) is **blocked** (fail-closed). Dates generalize to year, and a keyed
surrogate of an identifier is derived from information about the individual, so both date-shift and
pseudonymization are Expert-Determination techniques rather than Safe Harbor ones. A consumer who
needs a consistent keyed surrogate for those three categories uses
`LIMITED_DATA_SET_PROFILE`, which does not claim Safe Harbor.

#### Example

```ts
import { SAFE_HARBOR_POLICY, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

SAFE_HARBOR_POLICY.transforms[SAFE_HARBOR_CATEGORIES.MRN]; // => "redact"
```

***

### SAFE\_HARBOR\_PROFILE

> `const` **SAFE\_HARBOR\_PROFILE**: [`DeidProfile`](#deidprofile)

The **Safe Harbor** profile: the fail-closed default. Wraps [SAFE\_HARBOR\_POLICY](#safe_harbor_policy): direct
identifiers removed, medical record / beneficiary / account numbers **removed** rather than replaced
by a keyed surrogate, geography and dates generalized, the catch-all (R) blocked. It therefore
needs **no key at all**. Output is **"Safe-Harbor-transformed per the configured policy"**, never
"de-identified".

#### Example

```ts
import { SAFE_HARBOR_PROFILE } from "@cosyte/deid";

SAFE_HARBOR_PROFILE.standard; // => "safe-harbor"
```

***

### VERSION

> `const` **VERSION**: `string` = `"0.2.10"`

Library version string, synced with `package.json#version` at release time.

#### Example

```ts
import { VERSION } from "@cosyte/deid";

typeof VERSION; // => "string"
```

***

### WITHHELD\_LOCUS\_TOKEN

> `const` **WITHHELD\_LOCUS\_TOKEN**: `"<withheld>"` = `"<withheld>"`

What a manifest locus prints in place of an identifier it may not echo, i.e. an identifier the adapter
read out of the document that does not match the shape its position promises.

Deliberately carries **no length and no prefix of the refused token**: the length of a refused
identifier is itself derived from the content that was refused.

#### Example

```ts
import { WITHHELD_LOCUS_TOKEN } from "@cosyte/deid";

// A manifest entry whose position could not be trusted reads, e.g., "<withheld>-1".
WITHHELD_LOCUS_TOKEN; // => "<withheld>"
```

## Functions

### assertLimitedDataSetRetention()

> **assertLimitedDataSetRetention**(`subject`, `retainedLoci`): `void`

Enforce §164.514(e)(2) on a profile that **declares** the `limited-data-set` standard: every class
it retains must be one [LIMITED\_DATA\_SET\_RETENTION\_CLASSES](#limited_data_set_retention_classes) permits. A profile carrying the
regulation's name while keeping something the regulation excludes is refused, naming the class,
before any locus is transformed.

#### Parameters

##### subject

`string`

What is being checked, for the diagnostic (a profile, a derivation base).

##### retainedLoci

readonly [`RetainedLocusClass`](#retainedlocusclass)[] \| `undefined`

The retention classes the profile carries, if any.

#### Returns

`void`

#### Throws

[DeidError](#deiderror) `DEID_PROFILE_INVALID` naming every class outside the permitted set.

#### Example

```ts
import { assertLimitedDataSetRetention } from "@cosyte/deid";

assertLimitedDataSetRetention("a profile", ["encounter-dates"]); // ok
```

***

### assertRetentionContract()

> **assertRetentionContract**(`policyName`, `retainedLoci`): `void`

Enforce the **label contract on retention**, failing closed: a policy carrying the reserved
`safe-harbor` label may not run with a non-empty retention set. Retaining an admission date or an
encounter number is strictly weaker than the transform the label promises, so allowing it would let
an options bag emit a Safe-Harbor-labelled result that is not Safe Harbor. This is the retention
analogue of the guard that stops a date-shifting policy wearing the same label, and it closes the
hand-built-options route that no profile check can see.

#### Parameters

##### policyName

`string`

The name of the resolved policy.

##### retainedLoci

readonly [`RetainedLocusClass`](#retainedlocusclass)[] \| `undefined`

The retention classes the options bag carries, if any.

#### Returns

`void`

#### Throws

[DeidError](#deiderror) `DEID_POLICY_INVALID` when a `safe-harbor`-labelled policy is asked to retain.

#### Example

```ts
import { assertRetentionContract } from "@cosyte/deid";

assertRetentionContract("limited-data-set", ["encounter-dates"]); // ok
assertRetentionContract("safe-harbor", []); // ok (retains nothing)
```

***

### buildExpertDeterminationSupportReport()

> **buildExpertDeterminationSupportReport**(`manifests`, `options?`): [`ExpertDeterminationSupportReport`](#expertdeterminationsupportreport)

Build the [ExpertDeterminationSupportReport](#expertdeterminationsupportreport) from the value-free manifest(s) of one or more
de-identification passes. Deterministic; the input is never mutated; the result is deeply frozen.

Accepts either a **single** manifest (`readonly DeidManifestEntry[]`) or a **corpus** (an array of
manifests). Counts for identical loci are summed across the corpus. The report is **value-free**: it
carries categories, dispositions, loci, and counts, **never a PHI value**, and it renders **no
determination**: `determination` is `null` and the disclaimer leads.

#### Parameters

##### manifests

readonly [`DeidManifestEntry`](#deidmanifestentry)[] \| readonly (readonly [`DeidManifestEntry`](#deidmanifestentry)[])[]

A single manifest, or an array of manifests (a corpus).

##### options?

[`ExpertDeterminationReportOptions`](#expertdeterminationreportoptions) = `{}`

The policy label and optional consumer-supplied quasi-identifier class sizes.

#### Returns

[`ExpertDeterminationSupportReport`](#expertdeterminationsupportreport)

The frozen, value-free support report.

#### Example

```ts
import { deidentify, buildExpertDeterminationSupportReport, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const { manifest } = deidentify(
  { loci: [{ path: "PID-5", kind: "name", category: SAFE_HARBOR_CATEGORIES.NAMES, value: "X" }] },
  {},
);
const report = buildExpertDeterminationSupportReport(manifest, { policy: "safe-harbor" });
report.determination;   // => null
report.policy;          // => "safe-harbor"
```

***

### classifyPartyRole()

> **classifyPartyRole**(`roleCode`, `table`): [`PartyRoleClassification`](#partyroleclassification)

Classify a party from the role code its format types at the party, against that format's own
[PartyRoleTable](#partyroletable). Comparison is trimmed and upper-cased, so a lower-case wire code resolves to
the same committed member. An absent, empty or unlisted code is `unknown` and **fails closed**.

#### Parameters

##### roleCode

`string`

The role code the format types at the party (`NM1-01` / `N1-01`; the role an HL7
  v2.5.1 field definition names at an organisation-typed position).

##### table

[`PartyRoleTable`](#partyroletable)

The format's committed subject / outside-scope role lists.

#### Returns

[`PartyRoleClassification`](#partyroleclassification)

The classification, carrying the table's own code when the role was recognized.

#### Example

```ts
import { classifyPartyRole } from "@cosyte/deid";

const table = { subject: new Set(["36"]), outside: new Set(["85"]) };
classifyPartyRole("36", table); // => { scope: "safe-harbor-subject", roleCode: "36" }
classifyPartyRole("zq", table); // => { scope: "unknown" }  (fails closed)
```

***

### createDeidContext()

> **createDeidContext**(`spec`): [`DeidContext`](#deidcontext)

Create a [DeidContext](#deidcontext) from consumer-held key material. The key is coerced to bytes and stored
only in the module-private registry, never on the returned handle.

#### Parameters

##### spec

[`DeidContextSpec`](#deidcontextspec)

The key, optional date-shift seed, optional patient scope, and offset bound.

#### Returns

[`DeidContext`](#deidcontext)

An opaque, self-redacting context.

#### Throws

[DeidError](#deiderror) with code `DEID_NO_KEY` if the key (or an explicit seed) is empty, and
  `DEID_KEY_TOO_SHORT` if either is shorter than 16 bytes.

#### Example

```ts
import { randomBytes } from "node:crypto";
import { createDeidContext } from "@cosyte/deid";

// 32 random bytes. Keep the key to keep surrogates and offsets stable across runs.
const ctx = createDeidContext({ key: randomBytes(32), patientId: "patient-1" });
```

***

### createDeidRegistry()

> **createDeidRegistry**(`spec`): [`DeidRegistry`](#deidregistry)

Create a [DeidRegistry](#deidregistry) from consumer-held key material. **Fails closed** on an absent/empty
key: there is no default or weak key (the underlying [createDeidContext](#createdeidcontext) throws `DEID_NO_KEY`,
and `DEID_KEY_TOO_SHORT` for a key or seed under 16 bytes).
The key is stored only in the module-private state, never on the returned handle.

#### Parameters

##### spec

[`DeidRegistrySpec`](#deidregistryspec)

The key, optional date-shift seed, and optional offset bound.

#### Returns

[`DeidRegistry`](#deidregistry)

An opaque, self-redacting corpus consistency handle.

#### Throws

[DeidError](#deiderror) with code `DEID_NO_KEY` if the key (or an explicit seed) is empty, and
  `DEID_KEY_TOO_SHORT` if either is shorter than 16 bytes.

#### Example

```ts
import { randomBytes } from "node:crypto";
import { createDeidRegistry } from "@cosyte/deid";

// 32 random bytes. Keep the key to keep surrogates and offsets stable across runs.
const registry = createDeidRegistry({ key: randomBytes(32) });
```

***

### dateShift()

> **dateShift**(`value`, `ctx`): `string` \| `null`

Shift a date by the context's deterministic per-patient offset, preserving intervals. Supports ISO
`YYYY-MM-DD`, HL7 `YYYYMMDD`, and an ISO datetime (`YYYY-MM-DDThh:mm…`). Fails closed (`null`) on an
unparseable or invalid date.

**Timezone-independent.** Only the calendar-date portion is shifted (via UTC calendar math); a
datetime's time-of-day and zone designator are preserved **verbatim**, so the same input yields the
same output on every host regardless of the machine's `TZ`. Because the offset is a whole number of
days and the clock/zone are untouched, intervals are preserved exactly.

The **offset is not returned**: only the shifted value is. Two dates for the same patient move by
the same amount, so the number of days between them is unchanged.

#### Parameters

##### value

`string`

The date value to shift.

##### ctx

[`DeidContext`](#deidcontext)

The de-identification context (must carry a `patientId` scope for the offset).

#### Returns

`string` \| `null`

The shifted date at the original precision, or `null` if it could not be parsed.

#### Throws

[DeidError](#deiderror) with code `DEID_NO_KEY` if the context has no per-patient scope.

#### Example

```ts
import { dateShift, createDeidContext } from "@cosyte/deid";

const ctx = createDeidContext({ key: process.env.DEID_KEY!, patientId: "patient-1" });
const a = dateShift("2020-01-01", ctx);
const b = dateShift("2020-01-11", ctx);
// a and b are shifted, but remain exactly 10 days apart.
```

***

### defineDeidPolicy()

> **defineDeidPolicy**(`spec`): [`DeidPolicy`](#deidpolicy)

Derive a custom policy from the Safe Harbor defaults. Unlisted categories keep the safe default, so
a custom policy can only ever be built by *deviating* from Safe Harbor deliberately, never by
forgetting a category. The result is frozen.

#### Parameters

##### spec

[`DeidPolicySpec`](#deidpolicyspec)

The policy name and per-category overrides.

#### Returns

[`DeidPolicy`](#deidpolicy)

A frozen [DeidPolicy](#deidpolicy) covering all 18 categories.

#### Example

```ts
import { defineDeidPolicy, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const research = defineDeidPolicy({
  name: "research",
  transforms: { [SAFE_HARBOR_CATEGORIES.DATES]: "date-shift" },
});
research.transforms[SAFE_HARBOR_CATEGORIES.NAMES]; // => "redact" (kept from Safe Harbor)
```

***

### defineDeidProfile()

> **defineDeidProfile**(`spec`): [`DeidProfile`](#deidprofile)

Derive a per-site [DeidProfile](#deidprofile) from a base profile (Safe Harbor by default), enforcing the
**widen-never-narrow** contract: every override must move its category to an equal-or-**stronger**
transform than the base's. A weakening override, or reclaiming a reserved standard label, is
**rejected** ([FATAL\_CODES.DEID\_PROFILE\_INVALID](#deid_profile_invalid)), so a site preset can only tighten, never
loosen, the base standard's protection.

#### Parameters

##### spec

[`DeidProfileSpec`](#deidprofilespec)

The profile name, base, per-category overrides, and optional redactor.

#### Returns

[`DeidProfile`](#deidprofile)

A frozen [DeidProfile](#deidprofile).

#### Throws

[DeidError](#deiderror) `DEID_PROFILE_INVALID` if an override weakens a category, if
  `retainedLoci` adds a retention class the base does not retain, or if the name reclaims a reserved
  standard label; `DEID_POLICY_INVALID` if the base declares the `safe-harbor` standard while
  carrying a derived-output pair, or if the derived policy violates the key/label contract (e.g. a
  `safe-harbor`-labelled policy that date-shifts). A base refused at derive time is refused with
  `DEID_PROFILE_INVALID` first: a profile that is refused never mints a policy to label.

#### Example

```ts
import { defineDeidProfile, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const strict = defineDeidProfile({
  name: "site-strict",
  transforms: { [SAFE_HARBOR_CATEGORIES.GEOGRAPHIC]: "redact" }, // generalize -> redact: OK
});
strict.policy.transforms[SAFE_HARBOR_CATEGORIES.GEOGRAPHIC]; // => "redact"
```

***

### deidentify()

> **deidentify**(`model`, `options`): [`DeidResult`](#deidresult)

De-identify a format-agnostic [LocusModel](#locusmodel) under a policy. Returns the transformed document
and a value-free manifest. The input model is never mutated; the result is deeply frozen.

The output is **"Safe-Harbor-transformed per the configured policy"**: it is not certified
de-identified, and Expert Determination is not rendered.

#### Parameters

##### model

The located candidate values to de-identify.

###### loci?

readonly [`GenericLocus`](#genericlocus)[]

##### options

[`DeidOptions`](#deidoptions)

The policy and (for keyed transforms) the key context.

#### Returns

[`DeidResult`](#deidresult)

The frozen [DeidResult](#deidresult): transformed document + value-free manifest.

#### Throws

[DeidError](#deiderror) `EMPTY_INPUT` if the model is null or carries no locus list; `DEID_NO_KEY`
  if a keyed transform is required but no key context was supplied; `DEID_POLICY_INVALID` if a
  `safe-harbor`-labelled policy is asked to retain an identifying locus.

#### Example

```ts
import { deidentify, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

const result = deidentify(
  { loci: [{ path: "PID-19", kind: "identifier", category: SAFE_HARBOR_CATEGORIES.SSN, value: "SENTINEL" }] },
  {},
);
result.document.loci[0]?.value;      // => null (removed)
result.manifest[0]?.disposition;     // => "removed"
```

***

### formatExpertDeterminationSupportReport()

> **formatExpertDeterminationSupportReport**(`report`): `string`

Render an [ExpertDeterminationSupportReport](#expertdeterminationsupportreport) as a human-readable Markdown document: the same
value-free facts as the structured object, led by the non-certification disclaimer. Suitable to hand
to a statistician alongside the machine-readable report.

#### Parameters

##### report

[`ExpertDeterminationSupportReport`](#expertdeterminationsupportreport)

A report from [buildExpertDeterminationSupportReport](#buildexpertdeterminationsupportreport).

#### Returns

`string`

A Markdown string (value-free: categories, dispositions, loci, counts, never a value).

#### Example

```ts
import { buildExpertDeterminationSupportReport, formatExpertDeterminationSupportReport } from "@cosyte/deid";

const md = formatExpertDeterminationSupportReport(buildExpertDeterminationSupportReport([]));
md.startsWith("# Expert-Determination support report"); // => true
```

***

### generalizeAge()

> **generalizeAge**(`age`): [`GeneralizeOutcome`](#generalizeoutcome) \| `null`

Generalize an age (§164.514(b)(2)(i)(C)): any age **over 89** aggregates to `"90+"`; ages 0 to 89 are
retained (a residual). Fails closed (`null`) for a non-finite or negative age.

#### Parameters

##### age

`number`

The age in years.

#### Returns

[`GeneralizeOutcome`](#generalizeoutcome) \| `null`

The `{ value, residual }` outcome (`residual: false` for `"90+"`, `true` for a kept age),
  or `null` if the age is not a finite non-negative number.

#### Example

```ts
import { generalizeAge } from "@cosyte/deid";

generalizeAge(92)?.value; // => "90+"
generalizeAge(89)?.value; // => "89"
```

***

### generalizeDate()

> **generalizeDate**(`value`): [`GeneralizeOutcome`](#generalizeoutcome) \| `null`

Generalize a date to its **year** (§164.514(b)(2)(i)(C)). Accepts common encodings: ISO
`YYYY-MM-DD` / `YYYY-MM-DDThh:mm:ss`, HL7 `YYYYMMDD`, anything beginning with a plausible
four-digit year. Fails closed (`null`) when no year can be extracted; the retained year is a
residual.

#### Parameters

##### value

`string`

The date value to generalize.

#### Returns

[`GeneralizeOutcome`](#generalizeoutcome) \| `null`

The `{ value: year, residual: true }` outcome, or `null` if no year is present.

#### Example

```ts
import { generalizeDate } from "@cosyte/deid";

generalizeDate("2019-03-14")?.value; // => "2019"
generalizeDate("not-a-date");        // => null
```

***

### generalizeZip()

> **generalizeZip**(`zip`): [`GeneralizeOutcome`](#generalizeoutcome) \| `null`

Generalize a ZIP code to its safe form (§164.514(b)(2)(i)(B)): the initial three digits, or `000`
when those three digits name an area with ≤ 20,000 people (the cited restricted list). Fails closed
(`null`) when three leading digits cannot be read.

#### Parameters

##### zip

`string`

The ZIP code (5-digit, ZIP+4, or any form beginning with digits).

#### Returns

[`GeneralizeOutcome`](#generalizeoutcome) \| `null`

The `{ value, residual }` outcome (`residual: false` for `000`, `true` for a kept prefix),
  or `null` if fewer than three leading digits are present.

#### Example

```ts
import { generalizeZip } from "@cosyte/deid";

generalizeZip("90210")?.value; // => "902"
generalizeZip("03601")?.value; // => "000"  (036 is a restricted prefix)
```

***

### isRetainableCategory()

> **isRetainableCategory**(`category`): `boolean`

Whether a locus of this category may be retained at all. `false` for every one of the sixteen direct
identifiers [LIMITED\_DATA\_SET\_DIRECT\_IDENTIFIERS](#limited_data_set_direct_identifiers) names, whatever retention class an adapter
attached to it.

#### Parameters

##### category

[`SafeHarborCategory`](#safeharborcategory)

The resolved Safe Harbor category of the locus.

#### Returns

`boolean`

`true` only for `DATES` and the (R) catch-all.

#### Example

```ts
import { isRetainableCategory, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid";

isRetainableCategory(SAFE_HARBOR_CATEGORIES.MRN); // => false
isRetainableCategory(SAFE_HARBOR_CATEGORIES.DATES); // => true
```

***

### isRetainablePart()

> **isRetainablePart**(`cls`, `category`, `part`): `boolean`

Whether a **named part** of a locus whose category is otherwise excluded may be retained. This is
the **only** route past [isRetainableCategory](#isretainablecategory), and it is narrow by construction: all three
of the class, the resolved category and the part name must line up, and each is an allow-list
membership rather than a negation.

It exists because §164.514(e)(2)(ii) is the list's only **partial** exclusion. Making `GEOGRAPHIC`
retainable as a category would keep a county code, a birth place and a street address along with
the three parts the clause names, so the category stays excluded and the parts are named here.

#### Parameters

##### cls

[`RetainedLocusClass`](#retainedlocusclass)

The retention class the adapter proposed for the locus.

##### category

[`SafeHarborCategory`](#safeharborcategory)

The resolved Safe Harbor category of the locus.

##### part

[`RetainedLocusPart`](#retainedlocuspart)

The named part the adapter proposed keeping.

#### Returns

`boolean`

`true` only for the geographic class, the `GEOGRAPHIC` category, and a named address part.

#### Example

```ts
import {
  isRetainablePart,
  LIMITED_DATA_SET_ADDRESS_PARTS,
  RETAINED_LOCUS_CLASSES,
  SAFE_HARBOR_CATEGORIES,
} from "@cosyte/deid";

const geo = RETAINED_LOCUS_CLASSES.LIMITED_DATA_SET_GEOGRAPHY;
isRetainablePart(geo, SAFE_HARBOR_CATEGORIES.GEOGRAPHIC, LIMITED_DATA_SET_ADDRESS_PARTS.STATE); // => true
isRetainablePart(geo, SAFE_HARBOR_CATEGORIES.NAMES, LIMITED_DATA_SET_ADDRESS_PARTS.STATE); // => false
```

***

### isRetainableZipCode()

> **isRetainableZipCode**(`zip`): `boolean`

Whether a value is a **whole zip code** this library will carry through unreduced under
[RETAINED\_LOCUS\_CLASSES.LIMITED\_DATA\_SET\_GEOGRAPHY](#limited_data_set_geography): five digits, optionally followed by the
ZIP+4 add-on with or without its hyphen. Nothing else, and no surrounding whitespace.

**It is deliberately stricter than the generalization's input rule, and the asymmetry is the
point**: generalization reduces whatever it is given until it is safe, so reading three leading
digits off a malformed value is safe. Retention emits the value **unreduced**, so a value whose
shape this library cannot vouch for is not retained at all: the locus falls back to the Safe
Harbor generalization, which fails closed to dropping the whole address.

#### Parameters

##### zip

`string`

The candidate zip code, exactly as it sits at the locus.

#### Returns

`boolean`

`true` only for `12345`, `12345-6789` or `123456789`.

#### Example

```ts
import { isRetainableZipCode } from "@cosyte/deid";

isRetainableZipCode("62704"); // => true
isRetainableZipCode("627"); // => false (a partial ZIP is not a zip code)
```

***

### keyedHash()

> **keyedHash**(`value`, `ctx`): `string`

Replace a value with a **keyed one-way digest** (HMAC-SHA-256). Like [pseudonymize](#pseudonymize) it is
consistent and non-reversible without the key, but domain-separated so it is a distinct surrogate
space from pseudonyms.

#### Parameters

##### value

`string`

The value to hash.

##### ctx

[`DeidContext`](#deidcontext)

The de-identification context holding the consumer's key.

#### Returns

`string`

A lowercase-hex keyed digest, consistent per (key, value).

#### Example

```ts
import { keyedHash, createDeidContext } from "@cosyte/deid";

const ctx = createDeidContext({ key: process.env.DEID_KEY! });
typeof keyedHash("value", ctx); // => "string"
```

***

### profileOptions()

> **profileOptions**(`profile`, `context?`, `overrides?`): [`DeidOptions`](#deidoptions)

Build the [DeidOptions](#deidoptions) to pass to any adapter (`deidentifyHl7`, `deidentifyFhir`, …) from a
profile: its policy, its retention set, the supplied key context, and the profile's default redactor
(unless overridden). **Going through here is what carries the retention set**: an options bag built
by hand from `profile.policy` alone retains nothing, which is the fail-closed direction.

It is also where the **label contract** is enforced on a profile that DECLARES the `safe-harbor`
standard: a profile claiming that standard while assigning a category a transform whose output is
derived from that category's own value is refused here, before any locus is transformed, because
the engine downstream sees only the policy and not the standard the profile claimed.

#### Parameters

##### profile

[`DeidProfile`](#deidprofile)

The profile to apply.

##### context?

[`DeidContext`](#deidcontext)

The keyed per-patient context (required by profiles whose `requiresContext` is true).

##### overrides?

Optional `context`/`redactor` overrides merged over the profile's defaults.

###### context?

[`DeidContext`](#deidcontext)

###### redactor?

[`FreeTextRedactor`](#freetextredactor)

#### Returns

[`DeidOptions`](#deidoptions)

The [DeidOptions](#deidoptions) for an adapter call.

#### Throws

[DeidError](#deiderror) `DEID_POLICY_INVALID` when the profile claims the `safe-harbor` label, on
  either its policy name or its declared standard, while carrying a derived-output pair.

#### Example

```ts
import { SAFE_HARBOR_PROFILE, profileOptions, createDeidContext } from "@cosyte/deid";

const opts = profileOptions(SAFE_HARBOR_PROFILE, createDeidContext({ key: process.env.DEID_KEY! }));
opts.policy === SAFE_HARBOR_PROFILE.policy; // => true
```

***

### pseudonymize()

> **pseudonymize**(`id`, `ctx`): `string`

Replace an identifier with a **consistent keyed-HMAC surrogate**. The same input under the same key
always yields the same surrogate (linkage preserved); the surrogate is **not reversible without the
key** (collision-resistant, key-dependent). Domain-separated from [keyedHash](#keyedhash).

#### Parameters

##### id

`string`

The identifier to pseudonymize (MRN, beneficiary number, account number).

##### ctx

[`DeidContext`](#deidcontext)

The de-identification context holding the consumer's key.

#### Returns

`string`

A lowercase-hex surrogate, consistent per (key, id).

#### Example

```ts
import { pseudonymize, createDeidContext } from "@cosyte/deid";

const ctx = createDeidContext({ key: process.env.DEID_KEY! });
pseudonymize("MRN-123", ctx) === pseudonymize("MRN-123", ctx); // => true (consistent)
```

***

### redact()

> **redact**(): `null`

Redact a value. Returns `null`: the removed-value sentinel used throughout the transformed
document. Pure and keyless.

#### Returns

`null`

`null`, signalling the value has been removed.

#### Example

```ts
import { redact } from "@cosyte/deid";

redact(); // => null
```

***

### resolvePolicy()

> **resolvePolicy**(`policy`): [`DeidPolicy`](#deidpolicy)

Resolve the policy argument accepted by the engine: the string `"safe-harbor"` (or `undefined`)
yields the built-in policy; a [DeidPolicy](#deidpolicy) object is returned as-is.

#### Parameters

##### policy

[`DeidPolicy`](#deidpolicy) \| `"safe-harbor"` \| `undefined`

`"safe-harbor"`, a [DeidPolicy](#deidpolicy), or `undefined`.

#### Returns

[`DeidPolicy`](#deidpolicy)

The concrete policy to apply.

#### Example

```ts
import { resolvePolicy, SAFE_HARBOR_POLICY } from "@cosyte/deid";

resolvePolicy("safe-harbor") === SAFE_HARBOR_POLICY; // => true
```

***

### retains()

> **retains**(`classes`, `cls`): `boolean`

Test whether a retention class is enabled by a (possibly absent) retention set. An absent or empty
set retains **nothing**, so a caller that never mentions retention gets the strict treatment.

#### Parameters

##### classes

readonly [`RetainedLocusClass`](#retainedlocusclass)[] \| `undefined`

The retention classes a profile or options bag enabled, if any.

##### cls

[`RetainedLocusClass`](#retainedlocusclass)

The class to test.

#### Returns

`boolean`

`true` only when `classes` is present and lists `cls`.

#### Example

```ts
import { retains, RETAINED_LOCUS_CLASSES } from "@cosyte/deid";

retains(undefined, RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES); // => false (fail closed)
retains(["encounter-dates"], RETAINED_LOCUS_CLASSES.ENCOUNTER_DATES); // => true
```

***

### unkeyedHash()

> **unkeyedHash**(`value`): `string`

A **plain, unsalted SHA-256** digest: **NON-CONFORMING** to §164.514(c) and never used by the
engine. It is re-identifiable for a small, enumerable identifier space (an attacker hashes every
candidate and matches). Exported solely so the test suite can *prove* the reversibility hazard the
keyed path avoids. **Do not use this to de-identify anything.**

#### Parameters

##### value

`string`

The value to hash.

#### Returns

`string`

The lowercase-hex SHA-256 of `value`: reversible for a small input space.

#### Example

```ts
import { unkeyedHash } from "@cosyte/deid";

// Deterministic and unsalted: this is the footgun, shown so tests can assert against it.
unkeyedHash("a") === unkeyedHash("a"); // => true
```
