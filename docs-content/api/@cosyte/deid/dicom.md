# @cosyte/deid/dicom

`@cosyte/deid/dicom`: the **DICOM de-identification adapter**. The DICOM binding of the format-agnostic
core, and the one adapter that **delegates rather than reimplements**:
`@cosyte/dicom` already ships the **PS3.15 Annex E** de-identification (the Basic Application Level
Confidentiality Profile: tag-level removal of Patient Name/ID/BirthDate, institution, referring physician,
dates and the enumerated Annex E attributes; consistent Study/Series/SOP-Instance **UID remapping** so
relationships survive; private-tag removal; and the "Patient Identity Removed = YES" + De-identification
Method metadata). This adapter **orchestrates** that pass under the unified policy and **folds its
value-free report into the unified manifest**: it never re-does Annex E.

**`@cosyte/dicom` is an optional peer dependency**, consumed only from this subpath: a consumer who only
de-identifies DICOM installs it alongside `@cosyte/deid`; the core stays third-party-dep-free. The adapter
reaches DICOM data **only** through `@cosyte/dicom`'s own `parseDicom` / `deidentify` / `serializeDicom`
surface: it never touches a third-party substrate and never inspects bytes directly.

**Fail closed.** The default `safe-harbor` policy applies the **full Basic Profile with no Retain/Clean
deviations**: every private tag is removed, every UID is consistently remapped, and no identifying metadata
is retained. The output is **"Safe-Harbor-transformed per the configured policy"**, never "de-identified".

**The declaration is machine-readable, not only prose.** Beside the De-identification Method text the
delegated pass writes to `(0012,0063)`, this adapter writes the **CID 7050** coded terms for the profile
and for every option it applied into De-identification Method Code Sequence `(0012,0064)`, so a receiving
archive can branch on a code rather than parse an English sentence. Every option it **withheld** is
declared by its coded term on the returned result and never in that sequence, because that sequence
carries the codes corresponding to the Profile and Options *used*. The scope over which replacement-UID
referential integrity holds is on the result too. The adapter **refuses to declare rather than declare
wrongly**: a profile or an option the vocabulary cannot name aborts the pass, and so does a declaration
this run cannot read back out of its own serialized output.

**The pixel hazard is surfaced, never cleaned.** This is a **metadata-only** de-identifier: it cannot
inspect or clean pixels, so recognizable text **burned into the image** (Safe Harbor category Q) is not
removed. When Pixel Data is present and not affirmatively marked free of burned-in annotation, the result
carries `burnedInAnnotationHazard === true` and the `DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED` warning, and
`metadataOnly` is **always** `true`. Such output is **not** safe to release on metadata alone: the pixels
need a pixel-capable review (a future `@cosyte/dicom-pixel`).

## Interfaces

### DicomBufferDeidResult

The result of [deidentifyDicomBuffer](#deidentifydicombuffer): the re-serialized de-identified Part 10 bytes plus the same
audit fields as [DicomDeidResult](#dicomdeidresult) (minus the in-memory dataset).

#### Example

```ts
import { deidentifyDicomBuffer } from "@cosyte/deid/dicom";

const { bytes, burnedInAnnotationHazard } = deidentifyDicomBuffer(part10);
// `bytes` is a fresh Part 10 buffer; safe to persist only if !burnedInAnnotationHazard.
```

#### Properties

##### burnedInAnnotationHazard

> `readonly` **burnedInAnnotationHazard**: `boolean`

`true` when the image may carry burned-in PHI this metadata-only pass cannot remove.

##### bytes

> `readonly` **bytes**: `Buffer`

The de-identified DICOM Part 10 byte stream (freshly serialized).

##### deidentificationMethodCodes

> `readonly` **deidentificationMethodCodes**: readonly [`DicomCodedTerm`](#dicomcodedterm)[]

The CID 7050 coded terms written to De-identification Method Code Sequence `(0012,0064)` in
[bytes](#bytes): the profile, then every option the run **applied**. A withheld option is never here.

##### manifest

> `readonly` **manifest**: readonly [`DeidManifestEntry`](../deid.md#deidmanifestentry)[]

The value-free audit of every attribute acted on.

##### metadataOnly

> `readonly` **metadataOnly**: `true`

Always `true`: metadata-only de-identification.

##### optionDeclarations

> `readonly` **optionDeclarations**: readonly [`DicomOptionDeclaration`](#dicomoptiondeclaration)[]

Every Annex E option this adapter can name, each declared **applied** or **withheld** by its CID
7050 coded term. The withheld half is readable only here, never in `(0012,0064)`.

##### retained

> `readonly` **retained**: readonly `string`[]

The Annex E Retain/Clean options that were active (always empty).

##### uidReferentialIntegrity

> `readonly` **uidReferentialIntegrity**: [`DicomUidReferentialIntegrity`](#dicomuidreferentialintegrity)

How far replacement-UID referential integrity reaches for this run.

##### unexaminedResiduals

> `readonly` **unexaminedResiduals**: readonly [`UnexaminedResidual`](../deid.md#unexaminedresidual)[]

Every attribute the delegated report does not account for: the positions no rule reached.

##### warnings

> `readonly` **warnings**: readonly [`DicomDeidWarning`](#dicomdeidwarning)[]

Value-free safety warnings from the delegated Annex E pass.

***

### DicomCodedTerm

One coded term of CID 7050: the triplet a `(0012,0064)` item carries, and the same triplet as it is
surfaced on a result. Every field is reproduced verbatim from the published context group.

#### Example

```ts
import { deidentifyDicom, type DicomCodedTerm } from "@cosyte/deid/dicom";

const { deidentificationMethodCodes } = deidentifyDicom(dataset);
deidentificationMethodCodes.forEach((term: DicomCodedTerm) => {
  term.codeValue; // => "113100"
  term.codingSchemeDesignator; // => "DCM"
});
```

#### Properties

##### codeMeaning

> `readonly` **codeMeaning**: `string`

The Code Meaning `(0008,0104)`, verbatim from CID 7050.

##### codeValue

> `readonly` **codeValue**: `string`

The Code Value `(0008,0100)`, verbatim from CID 7050.

##### codingSchemeDesignator

> `readonly` **codingSchemeDesignator**: `"DCM"`

The Coding Scheme Designator `(0008,0102)`. `DCM` on every row of CID 7050.

***

### DicomDeidOptions

Options controlling a DICOM de-identification run. Extends the unified options with the two DICOM-only
knobs that make **relationships survive** de-identification: a shared UID cache and a UID root.

The `context` (HMAC key) carried by the unified ["@cosyte/deid".DeidOptions](../deid.md#deidoptions) is **not used** here:
PS3.15 Annex E dummying and content-derived UID remapping do not consume a keyed-transform key. It is
accepted only for API uniformity with the other adapters. The `policy` selects the output **label** and
guarantees the fail-closed posture; the DICOM de-identification itself is **always** the full Basic
Application Level Confidentiality Profile (the delegated Annex E action map is authoritative, this
adapter orchestrates, it does not reimplement).

#### Example

```ts
import { deidentifyDicom, type DicomDeidOptions } from "@cosyte/deid/dicom";

// One shared cache makes UID remapping consistent across every file in a study/archive.
const uidMap = new Map<string, string>();
const opts: DicomDeidOptions = { uidMap };
```

#### Properties

##### policy?

> `readonly` `optional` **policy?**: [`DeidPolicy`](../deid.md#deidpolicy) \| `"safe-harbor"`

The policy to apply. Defaults to the built-in Safe Harbor policy. Selects the output label.

##### uidMap?

> `readonly` `optional` **uidMap?**: `Map`\<`string`, `string`\>

A caller-owned source→replacement UID cache. Share one `Map` across a whole study/archive so
Study/Series/SOP Instance UIDs remap **consistently** and the relationships between de-identified
objects survive. The map holds UIDs (instance identifiers), never patient data; the adapter does not
surface it in the value-free result, so pass your own `Map` if you need the mapping.

##### uidRoot?

> `readonly` `optional` **uidRoot?**: `string`

Root for generated replacement UIDs (Annex E action `U`); undefined → `@cosyte/dicom` default.

***

### DicomDeidResult

The result of de-identifying a parsed DICOM dataset: the fresh de-identified Dataset, the folded
value-free manifest, the safety warnings, and the honest **metadata-only** stance.

The input dataset is never mutated. **`metadataOnly` is always `true`**: this is a *metadata*
de-identifier: it cannot inspect or clean pixels, so recognizable text **burned into the image** is not
removed. When [burnedInAnnotationHazard](#burnedinannotationhazard-1) is `true`, the output must be treated as **not safe to
share** until the pixels are reviewed by a pixel-capable tool (a future `@cosyte/dicom-pixel`).

#### Example

```ts
import { deidentifyDicom } from "@cosyte/deid/dicom";

const { dataset, manifest, burnedInAnnotationHazard, metadataOnly } = deidentifyDicom(parsed);
metadataOnly; // => true: always
if (burnedInAnnotationHazard) {
  // do NOT release: pixels may carry burned-in PHI this metadata-only pass cannot remove
}
```

#### Properties

##### burnedInAnnotationHazard

> `readonly` **burnedInAnnotationHazard**: `boolean`

`true` when Pixel Data is present and not affirmatively marked free of burned-in annotation: the
output may still carry recognizable text in the image and is **not** safe to release on metadata alone.

##### dataset

> `readonly` **dataset**: `Dataset`

The de-identified dataset (a fresh `@cosyte/dicom` `Dataset`; the input is never mutated).

##### deidentificationMethodCodes

> `readonly` **deidentificationMethodCodes**: readonly [`DicomCodedTerm`](#dicomcodedterm)[]

The CID 7050 coded terms written to De-identification Method Code Sequence `(0012,0064)` on
[dataset](#dataset): the profile, then every option the run **applied**, in that order. These are the
terms corresponding to the Profile and Options *used*, so a withheld option is never among them.

##### manifest

> `readonly` **manifest**: readonly [`DeidManifestEntry`](../deid.md#deidmanifestentry)[]

The value-free audit of every attribute acted on: category + locus + action, never a value.

##### metadataOnly

> `readonly` **metadataOnly**: `true`

Always `true`: this is a metadata-only de-identifier; pixels are not inspected or cleaned.

##### optionDeclarations

> `readonly` **optionDeclarations**: readonly [`DicomOptionDeclaration`](#dicomoptiondeclaration)[]

Every Annex E option this adapter can name, each declared **applied** or **withheld** by its CID
7050 coded term. The withheld half is readable only here, never in `(0012,0064)`.

##### retained

> `readonly` **retained**: readonly `string`[]

The Annex E Retain/Clean options that were active. Always empty (the full Basic Profile applies
with no deviations); surfaced so a reviewer can confirm nothing was retained.

##### uidReferentialIntegrity

> `readonly` **uidReferentialIntegrity**: [`DicomUidReferentialIntegrity`](#dicomuidreferentialintegrity)

How far replacement-UID referential integrity reaches for this run.

##### unexaminedResiduals

> `readonly` **unexaminedResiduals**: readonly [`UnexaminedResidual`](../deid.md#unexaminedresidual)[]

The manifest's **second list**: every attribute present in the returned dataset, nested sequence
items included, that the delegated Annex E report does **not** account for, counted and located.
Those are the positions no rule reached; an attribute the profile **kept** is not one of them,
because keeping it is a decision. An empty list is a **measured zero**, not a silence.

##### warnings

> `readonly` **warnings**: readonly [`DicomDeidWarning`](#dicomdeidwarning)[]

Value-free safety warnings from the delegated Annex E pass (notably burned-in annotation).

***

### DicomDeidWarning

A value-free de-identification warning surfaced from the delegated Annex E pass. Carries a stable code
and a PHI-free message, never a decoded pixel or attribute value.

#### Example

```ts
import { deidentifyDicom, type DicomDeidWarning } from "@cosyte/deid/dicom";

const { warnings } = deidentifyDicom(dataset);
warnings.forEach((w: DicomDeidWarning) => console.warn(w.code)); // safe to log
```

#### Properties

##### code

> `readonly` **code**: `string`

The stable `@cosyte/dicom` warning code (e.g. `DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED`).

##### message

> `readonly` **message**: `string`

A PHI-free description safe to log.

***

### DicomOptionDeclaration

One Annex E option, declared by its CID 7050 coded term and by whether this run applied it.

A **withheld** declaration is only ever readable here: it is never written into De-identification
Method Code Sequence `(0012,0064)`, because that sequence carries the codes corresponding to the
Profile and Options *used*, and a withheld term there would say the opposite of the truth.

#### Example

```ts
import { deidentifyDicom, type DicomOptionDeclaration } from "@cosyte/deid/dicom";

const { optionDeclarations } = deidentifyDicom(dataset);
const retainUids: DicomOptionDeclaration | undefined = optionDeclarations.find(
  (d) => d.term.codeValue === "113110",
);
retainUids?.status; // => "withheld": UIDs are remapped, never retained
```

#### Properties

##### status

> `readonly` **status**: [`DicomOptionStatus`](#dicomoptionstatus)

Whether the run applied this option or deliberately withheld it.

##### term

> `readonly` **term**: [`DicomCodedTerm`](#dicomcodedterm)

The CID 7050 coded term naming this option, verbatim from the table.

***

### DicomUidReferentialIntegrity

The declared scope of replacement-UID referential integrity: a machine-readable discriminant and the
statement it stands for, both read off the result.

#### Example

```ts
import { deidentifyDicom } from "@cosyte/deid/dicom";

const uidMap = new Map<string, string>();
deidentifyDicom(dataset).uidReferentialIntegrity.scope; // => "single-call"
deidentifyDicom(dataset, { uidMap }).uidReferentialIntegrity.scope; // => "caller-supplied-cache"
```

#### Properties

##### scope

> `readonly` **scope**: [`DicomUidScope`](#dicomuidscope)

How far the guarantee reaches. Distinguishes a run given a shared cache from one given none.

##### statement

> `readonly` **statement**: `string`

The same fact in one PHI-free sentence, safe to log or to copy into a disclosure record.

## Type Aliases

### DicomOptionStatus

> **DicomOptionStatus** = `"applied"` \| `"withheld"`

Whether an Annex E option was applied by the run or deliberately withheld from it.

#### Example

```ts
import { deidentifyDicom, type DicomOptionStatus } from "@cosyte/deid/dicom";

const { optionDeclarations } = deidentifyDicom(dataset);
const status: DicomOptionStatus | undefined = optionDeclarations[0]?.status;
status; // => "withheld"
```

***

### DicomUidScope

> **DicomUidScope** = `"single-call"` \| `"caller-supplied-cache"`

How far replacement-UID referential integrity reaches for a run.

- `single-call` - no cross-file UID cache was supplied: the guarantee holds within this call only.
- `caller-supplied-cache` - a cache was supplied: the guarantee reaches every call that shares it.

#### Example

```ts
import { deidentifyDicom, type DicomUidScope } from "@cosyte/deid/dicom";

const scope: DicomUidScope = deidentifyDicom(dataset).uidReferentialIntegrity.scope;
scope; // => "single-call"
```

## Variables

### BURNED\_IN\_ANNOTATION\_CODE

> `const` **BURNED\_IN\_ANNOTATION\_CODE**: `"DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED"` = `"DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED"`

The `@cosyte/dicom` warning code that flags un-removable burned-in pixel annotation. Re-exported from
`@cosyte/deid/dicom` so consumers can branch on the burned-in hazard by its stable code.

#### Example

```ts
import { deidentifyDicom, BURNED_IN_ANNOTATION_CODE } from "@cosyte/deid/dicom";

const { warnings } = deidentifyDicom(dataset);
const burnedIn = warnings.some((w) => w.code === BURNED_IN_ANNOTATION_CODE);
```

***

### CID\_7050

> `const` **CID\_7050**: readonly [`DicomCodedTerm`](#dicomcodedterm)[]

**Table CID 7050, verbatim.** Thirteen rows, Coding Scheme Designator `DCM` on every one, Code Values
`113100` through `113112`. This is the closed set: a term outside it is never emitted, into the
dataset or onto a result.

#### Example

```ts
import { CID_7050 } from "@cosyte/deid/dicom";

CID_7050.length; // => 13
CID_7050[0]?.codeMeaning; // => "Basic Application Confidentiality Profile"
```

***

### CID\_7050\_CONTEXT\_GROUP\_UID

> `const` **CID\_7050\_CONTEXT\_GROUP\_UID**: `"1.2.840.10008.6.1.925"` = `"1.2.840.10008.6.1.925"`

The context group UID of CID 7050, recorded beside the table as its provenance so a reader can check
the transcription against the published vocabulary rather than against this file.

#### Example

```ts
import { CID_7050_CONTEXT_GROUP_UID } from "@cosyte/deid/dicom";

CID_7050_CONTEXT_GROUP_UID; // => "1.2.840.10008.6.1.925"
```

***

### CID\_7050\_VERSION

> `const` **CID\_7050\_VERSION**: `"20170914"` = `"20170914"`

The version of the CID 7050 context group these rows were transcribed from. Recorded for the same
reason as the UID: it names the edition a reader should compare against.

#### Example

```ts
import { CID_7050_VERSION } from "@cosyte/deid/dicom";

CID_7050_VERSION; // => "20170914"
```

***

### INPUT\_METHOD\_CODE\_SEQUENCE\_DROPPED\_CODE

> `const` **INPUT\_METHOD\_CODE\_SEQUENCE\_DROPPED\_CODE**: `"DICOM_INPUT_DEIDENTIFICATION_METHOD_CODES_DROPPED"` = `"DICOM_INPUT_DEIDENTIFICATION_METHOD_CODES_DROPPED"`

Raised when the **input** carried a De-identification Method Code Sequence and this pass replaced it
with its own. The prior sequence's items are dropped rather than merged: they are unaudited bytes from
an untrusted file, and `(0012,0064)` is not in Table E.1-1, so no Annex E rule ever inspected what was
inside them. Keeping any of it would put unexamined input text inside output stamped Patient Identity
Removed YES.

The loss is disclosed rather than made silently, and the disclosure is **value-free**: the message is
a constant, so it can carry no Code Value, no Code Meaning and no other text read from the input.

#### Example

```ts
import { deidentifyDicom, INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE } from "@cosyte/deid/dicom";

const { warnings } = deidentifyDicom(dataset);
warnings.some((w) => w.code === INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE);
```

## Functions

### deidentifyDicom()

> **deidentifyDicom**(`dataset`, `options?`): [`DicomDeidResult`](#dicomdeidresult)

De-identify a parsed DICOM dataset under a policy (Safe Harbor by default). Delegates the tag-level work to
`@cosyte/dicom`'s PS3.15 Annex E `deidentify` (Basic Application Level Confidentiality Profile), then folds
its value-free report into the unified manifest. The input dataset is **never mutated**: a fresh
de-identified Dataset is returned.

The output is **"Safe-Harbor-transformed per the configured policy"**: it is not certified de-identified,
and it is **metadata-only**: pixels are not inspected, so a burned-in-annotation hazard is *flagged*, never
cleaned. Always check [DicomDeidResult.burnedInAnnotationHazard](#burnedinannotationhazard-1) before releasing an image.

The returned dataset carries **no parse warnings from the input file**. Those describe the bytes as they
were *before* anything was removed, so they are not part of the de-identification contract; the warnings
raised by **this pass** are returned separately on [DicomDeidResult.warnings](#warnings-1).

The output **declares itself in the standard's own vocabulary**. The CID 7050 coded terms for the
profile and for every option the run applied are written to De-identification Method Code Sequence
`(0012,0064)` beside the unchanged `(0012,0063)` text and `(0012,0062) YES`; every option the run
**withheld** is declared on [DicomDeidResult.optionDeclarations](#optiondeclarations-1) and never in that sequence, and
the scope over which replacement-UID referential integrity holds is on
[DicomDeidResult.uidReferentialIntegrity](#uidreferentialintegrity-1).

#### Parameters

##### dataset

`Dataset`

The parsed dataset (`parseDicom(bytes)`).

##### options?

[`DicomDeidOptions`](#dicomdeidoptions) = `{}`

The policy and (for cross-file UID consistency) a shared `uidMap` / `uidRoot`.

#### Returns

[`DicomDeidResult`](#dicomdeidresult)

The de-identified dataset, the value-free manifest, the coded declaration, the warnings, and
  the metadata-only stance.

#### Throws

DeidError `DEID_POSITIONS_UNENUMERABLE` when a dataset, a sequence item or the Part 10
  File Meta group will not yield its positions, so no honest count exists for this study, or when an
  element carries no value bytes (a copy of an `Element` made by object spread keeps no `rawBytes`;
  copy one through the `Element` constructor instead).

#### Throws

DeidError `DEID_DECLARATION_UNNAMEABLE` when a profile or an Annex E option in play has
  no naming term in CID 7050, so the coded declaration could only be an approximation.

#### Throws

DeidError `DEID_OUTPUT_INVALID` when the coded declaration cannot be read back out of
  this run's own serialized output, so the pass cannot vouch for what a downstream reader will see.

#### Example

```ts
import { parseDicom } from "@cosyte/dicom";
import { deidentifyDicom } from "@cosyte/deid/dicom";

const { dataset, manifest, burnedInAnnotationHazard } = deidentifyDicom(parseDicom(part10));
manifest; // value-free: category + (gggg,eeee) Keyword + action, never a value
if (burnedInAnnotationHazard) {
  // do NOT release: pixels may still carry burned-in PHI
}
```

***

### deidentifyDicomBuffer()

> **deidentifyDicomBuffer**(`bytes`, `options?`): [`DicomBufferDeidResult`](#dicombufferdeidresult)

Convenience: parse a DICOM Part 10 byte stream, de-identify it, and re-serialize, returning the
de-identified bytes and the value-free audit in one call. The re-serialized bytes are a fresh Part 10
buffer; the input buffer is never mutated.

As with [deidentifyDicom](#deidentifydicom), the result is **metadata-only**: check
[DicomBufferDeidResult.burnedInAnnotationHazard](#burnedinannotationhazard) before persisting or sharing the bytes.

#### Parameters

##### bytes

`ArrayBuffer` \| `Buffer`\<`ArrayBufferLike`\> \| `Uint8Array`\<`ArrayBufferLike`\>

Raw DICOM Part 10 bytes.

##### options?

[`DicomDeidOptions`](#dicomdeidoptions) = `{}`

The policy and (for cross-file UID consistency) a shared `uidMap` / `uidRoot`.

#### Returns

[`DicomBufferDeidResult`](#dicombufferdeidresult)

The de-identified Part 10 bytes and the value-free audit.

#### Example

```ts
import { deidentifyDicomBuffer } from "@cosyte/deid/dicom";

const { bytes, manifest, burnedInAnnotationHazard } = deidentifyDicomBuffer(part10);
if (!burnedInAnnotationHazard) fs.writeFileSync("clean.dcm", bytes);
```

## References

### OUTPUT\_LABEL

Re-exports [OUTPUT_LABEL](../deid.md#output_label)

***

### SAFE\_HARBOR\_CATEGORIES

Re-exports [SAFE_HARBOR_CATEGORIES](../deid.md#safe_harbor_categories)

***

### SafeHarborCategory

Re-exports [SafeHarborCategory](../deid.md#safeharborcategory)

***

### UnexaminedResidual

Re-exports [UnexaminedResidual](../deid.md#unexaminedresidual)
