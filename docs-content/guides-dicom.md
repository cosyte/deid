---
id: guides-dicom
title: De-identifying DICOM
sidebar_position: 10
---

# De-identifying DICOM

The `@cosyte/deid/dicom` adapter is the DICOM binding of the de-identification core, and the one adapter
that **delegates rather than reimplements**. `@cosyte/dicom` already ships the **PS3.15 Annex E**
de-identification (the Basic Application Level Confidentiality Profile), so this adapter **orchestrates**
that pass under the unified policy and **folds its value-free report into the unified manifest**. It never
re-does Annex E.

> **`@cosyte/dicom` is an optional peer dependency.** Install it alongside `@cosyte/deid` to use this
> subpath. The adapter reaches DICOM data only through `@cosyte/dicom`'s own `parseDicom` / `deidentify` /
> `serializeDicom` surface.

```bash
npm install @cosyte/deid @cosyte/dicom
```

## Quickstart

```ts
import { parseDicom } from "@cosyte/dicom";
import { deidentifyDicom, deidentifyDicomBuffer } from "@cosyte/deid/dicom";

const { dataset, manifest, burnedInAnnotationHazard, metadataOnly } = deidentifyDicom(
  parseDicom(part10Bytes),
);

// or, parse → de-identify → re-serialize in one call:
const { bytes } = deidentifyDicomBuffer(part10Bytes);

manifest; // value-free audit: category + "(gggg,eeee) Keyword" + disposition, never a value
metadataOnly; // => true: always (see the pixel hazard below)
```

No key context is required: Annex E dummying and content-derived UID remapping do not use the
pseudonymization key. Pass a `context` for API uniformity if you like; the DICOM adapter ignores it.

## What is located, and how it is transformed

The **Basic Application Level Confidentiality Profile** is authoritative for what happens to each tag. The
default `safe-harbor` policy applies it in full, with no Retain/Clean deviations:

| Locus                                                        | Handling                                                                                        |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Patient Name/ID/Birth Date, Other Patient IDs                | removed / emptied per Annex E                                                                    |
| Institution, Referring/Performing physician, operators       | removed                                                                                          |
| Dates and times directly related to the individual           | removed / dummied per Annex E                                                                    |
| Accession, device serial, and other identifiers              | removed                                                                                          |
| **Study / Series / SOP Instance UIDs**                       | **consistently remapped** (`U`) so the study/series/image relationships survive                 |
| **Private tags**                                             | **removed** (fail-closed, kept only when a known-safe retain list names them; empty by default) |
| Modality, image geometry, coded technique, pixel bytes       | **retained untouched**: the clinical/technical payload survives                                |

The output carries the mandated `Patient Identity Removed = YES` marker and a De-identification Method
naming the profile and the policy.

## The coded declaration: what a machine reads instead of a sentence

PS3.15 E.1.1 asks for `Patient Identity Removed (0012,0062) = YES` and then, additionally, for "one or
more codes from CID 7050 'De-identification Method' corresponding to the Profile and Options used" in
**De-identification Method Code Sequence `(0012,0064)`**, "and/or a text string describing the method
used" in **De-identification Method `(0012,0063)`**. This adapter writes **both**: the English sentence
stays exactly as it was, and the coded terms are added beside it, so a receiving archive can branch on a
code instead of parsing prose.

```ts
import { parseDicom } from "@cosyte/dicom";
import { deidentifyDicom } from "@cosyte/deid/dicom";

const { dataset, deidentificationMethodCodes, optionDeclarations } = deidentifyDicom(
  parseDicom(part10Bytes),
);

// What went INTO (0012,0064): the profile, then every option the run applied.
deidentificationMethodCodes;
// => [{ codeValue: "113100", codingSchemeDesignator: "DCM",
//       codeMeaning: "Basic Application Confidentiality Profile" }]

// Every option, applied or withheld, by its coded term. Under the default policy all twelve are
// withheld, because the full Basic Profile applies with no Retain/Clean deviations.
optionDeclarations.filter((d) => d.status === "withheld").length; // => 12

dataset.get("00120064"); // the same terms, on the dataset and in the re-serialized bytes
```

Three rules govern it, and the second is the one to read twice:

- **Only the published terms are ever emitted.** Every Code Value, Code Meaning and Coding Scheme
  Designator comes from the thirteen rows of CID 7050 (context group `1.2.840.10008.6.1.925`),
  reproduced verbatim. Nothing is composed, abbreviated or paraphrased, and no term outside that table
  is emitted into the dataset or onto the result.
- **A withheld option is declared on the result and NEVER in `(0012,0064)`.** The standard's own words
  are "corresponding to the Profile and Options **used**", so a term in that sequence means the option
  was applied. Writing a withheld term there would tell an archive the opposite of the truth. Read
  `optionDeclarations` for what was withheld; read the sequence only for what was used.
- **It refuses to declare rather than declare wrongly.** A profile or an option CID 7050 cannot name
  aborts the pass with `DEID_DECLARATION_UNNAMEABLE` before any output exists, and a declaration this
  run cannot read back out of its own serialized bytes aborts it with `DEID_OUTPUT_INVALID`. A coded
  term is acted on by downstream systems without a human, and a study released on a false coded claim
  cannot be un-released, so no output is the safe answer.

A De-identification Method Code Sequence the **input** already carried is **dropped**, not merged with:
its items are unaudited bytes from an untrusted file, and no de-identification rule inspects what is
inside that sequence, so keeping any of it would put unexamined input text inside output stamped
`Patient Identity Removed = YES`. The loss is disclosed rather than made silently, by a value-free
`DICOM_INPUT_DEIDENTIFICATION_METHOD_CODES_DROPPED` warning that carries no Code Value, no Code Meaning
and no other text read from the input.

## UID remapping: keeping relationships

Study/Series/SOP Instance UIDs are replaced with internally-consistent surrogates: the **same** source UID
always maps to the **same** replacement, so images still group into series and series into studies. The
mapping is content-derived, so it is consistent across runs even without shared state; pass one `Map` as
`uidMap` across a whole archive to make it consistent by construction (and O(1) on repeats):

```ts
import { parseDicom } from "@cosyte/dicom";
import { deidentifyDicom } from "@cosyte/deid/dicom";

const uidMap = new Map<string, string>();
for (const file of studyFiles) {
  const { dataset } = deidentifyDicom(parseDicom(file), { uidMap });
  // every object in the study now shares consistently-remapped Study/Series UIDs
}
```

The source→replacement map is **never** surfaced in the value-free result (a source UID is a re-linking
vector). If you need it for your own re-identification key store, you own the `uidMap` you pass in.

**How far that guarantee reaches is on the result, not only in this paragraph.** With **no** shared
cache, referential integrity of the replacement UIDs is guaranteed **only within the single call**: the
replacement UIDs of one call are not promised to agree with those of any other, because that would
depend on inputs you control (a differing `uidRoot`, most obviously). Supply a shared cache and the
guarantee reaches every call that shares it, and you own its lifetime and extent. The two cases are told
apart by reading a value rather than by remembering which arguments were passed:

```ts
import { deidentifyDicom } from "@cosyte/deid/dicom";

deidentifyDicom(dataset).uidReferentialIntegrity.scope; // => "single-call"

const uidMap = new Map<string, string>();
deidentifyDicom(dataset, { uidMap }).uidReferentialIntegrity.scope; // => "caller-supplied-cache"

// The same fact in one PHI-free sentence, safe to log or to file in a disclosure record:
deidentifyDicom(dataset).uidReferentialIntegrity.statement;
```

## The burned-in-pixel hazard: flagged, never cleaned

This is a **metadata-only** de-identifier: `metadataOnly` is always `true`. It cannot inspect or clean
pixels, so recognizable text **burned into the image** (Safe Harbor category Q, full-face photographs and
comparable images) is **not** removed. When Pixel Data is present and not affirmatively marked free of
burned-in annotation, the result flags it:

```ts
import { deidentifyDicom, BURNED_IN_ANNOTATION_CODE } from "@cosyte/deid/dicom";

const { burnedInAnnotationHazard, warnings } = deidentifyDicom(dataset);
if (burnedInAnnotationHazard) {
  // do NOT release the image on metadata alone: pixels may carry burned-in PHI.
  warnings.some((w) => w.code === BURNED_IN_ANNOTATION_CODE); // true
}
```

Pixel-level cleaning needs pixel decode and is out of scope (a future `@cosyte/dicom-pixel`). The adapter
warns rather than giving a false sense of safety.

## Known limitations

- **Metadata only**: pixels are never inspected; a burned-in-annotation hazard is *flagged*, never
  cleaned. The two pixel options of CID 7050 (`113101` Clean Pixel Data, `113102` Clean Recognizable
  Visual Features) are therefore always declared **withheld** and are never written to `(0012,0064)`.
- **No Retain/Clean deviations**: the full Basic Profile always applies (maximal removal).
  Expert-Determination retain options are **not** offered, so every Annex E option is declared
  withheld.
- **Replacement-UID referential integrity is guaranteed within one call** unless you supply a shared
  `uidMap`, in which case it reaches every call that shares it. The declared scope is on the result.
