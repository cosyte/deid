---
id: guides-dicom
title: De-identify a DICOM file
sidebar_label: DICOM
description: "Run a DICOM file through @cosyte/dicom's metadata pass, keep UIDs consistent across a study, and see why burned-in pixels are flagged, never cleaned."
---

# De-identify a DICOM file

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

## De-identify a file

Parse the Part 10 bytes with `@cosyte/dicom` and hand the dataset to `deidentifyDicom`, or pass the
bytes to `deidentifyDicomBuffer`, which parses, de-identifies and re-serializes in one call. You read
the bytes from your own file; so that each sample on this page runs on its own, it starts by building
a small synthetic file.

```ts runnable
import { parseDicom } from "@cosyte/dicom";
import { deidentifyDicom, deidentifyDicomBuffer } from "@cosyte/deid/dicom";

// A small synthetic Part 10 file in Explicit VR Little Endian, built here so the sample runs.
type El = [group: number, element: number, vr: string, value: string];
function part10(elements: El[]): Buffer {
  const encode = ([group, element, vr, text]: El): Buffer => {
    const pad = text.length % 2 === 0 ? "" : vr === "UI" ? "\0" : " ";
    const value = Buffer.from(text + pad, "latin1");
    const head = Buffer.alloc(vr === "OB" ? 12 : 8);
    head.writeUInt16LE(group, 0);
    head.writeUInt16LE(element, 2);
    head.write(vr, 4, "latin1");
    if (vr === "OB") head.writeUInt32LE(value.length, 8);
    else head.writeUInt16LE(value.length, 6);
    return Buffer.concat([head, value]);
  };
  const syntax: El = [0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"];
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), ...[syntax, ...elements].map(encode)]);
}

const part10Bytes = part10([
  [0x0008, 0x0060, "CS", "CT"],
  [0x0010, 0x0010, "PN", "ZZFAMILY^ZZGIVEN"],
  [0x0010, 0x0020, "LO", "ZZ-MRN-0001"],
  [0x0020, 0x000d, "UI", "1.2.826.0.1.3680043.10.999.1"],
]);

const { dataset, manifest, burnedInAnnotationHazard, metadataOnly } = deidentifyDicom(
  parseDicom(part10Bytes),
);

// or, parse, de-identify and re-serialize in one call:
const { bytes } = deidentifyDicomBuffer(part10Bytes);
bytes.includes("ZZFAMILY"); // => false

// value-free audit: category + "(gggg,eeee) Keyword" + disposition, never a value
manifest.map((entry) => `${entry.locus} ${entry.disposition}`); // => ["(0010,0010) Patient's Name removed", "(0010,0020) Patient ID removed", "(0020,000d) Study Instance UID transformed"]
dataset.get("00080060")?.value; // => { kind: "strings", values: ["CT"] }
dataset.get("00120062")?.value; // => { kind: "strings", values: ["YES"] }
manifest[2]?.reidentificationCode; // => true
metadataOnly; // => true
burnedInAnnotationHazard; // => false
```

The modality is kept, the name and the patient ID are removed, the study UID is replaced, and the
output carries `Patient Identity Removed = YES`. This file has no Pixel Data, so there is no
burned-in-annotation hazard to flag; [the section below](#the-burned-in-pixel-hazard-flagged-never-cleaned)
shows one that does.

No key context is required: Annex E dummying and content-derived UID remapping do not use the
pseudonymization key, so `deidentifyDicom` takes no `context` option. The manifest still records a
replaced UID with the `pseudonymize` transform and `reidentificationCode: true`, so the
[support report](./guides-expert-determination.md) lists it among the keyed-surrogate residuals,
although no key of yours derived it.

## What is located, and how it is transformed

The **Basic Application Level Confidentiality Profile** is authoritative for what happens to each tag. With
no Annex E option named, the pass applies it in full, with no Retain/Clean deviations:

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

## Apply an Annex E option

Three PS3.15 Annex E options can be named in `annexEOptions`. Each one is applied by `@cosyte/dicom`,
written to De-identification Method Code Sequence `(0012,0064)` by its CID 7050 term, named in
De-identification Method `(0012,0063)`, and listed on `retained`:

| Option                         | CID 7050 | What it does                                                                                                                                                                                                                                                                                                            | Under a policy named `safe-harbor`                     |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `CleanDescriptors`             | `113105` | Empties text descriptions and comments rather than removing them, and removes each coded list in the option's column (see below)                                                                                                                                                                                        | Refused: `@cosyte/dicom` keeps coded list items        |
| `RetainPatientCharacteristics` | `113108` | Keeps age, sex, size, weight, ethnic group, smoking and pregnancy status                                                                                                                                                                                                                                                | Refused: it keeps an age over 89                       |
| `RetainDeviceIdentity`         | `113109` | Keeps device serial numbers, station names, detector and gantry identifiers; calibration, manufacture and installation dates; Scheduled Study Location, Scheduled Procedure Step Location and the station geographic location code sequences; the original Device UID and Manufacturer's Device Class UID, not remapped | Refused: it keeps device identifiers, dates and places |

Every option keeps something Safe Harbor removes, so the reserved `safe-harbor` label is refused for
each: a run under the default policy that names one throws `DEID_POLICY_INVALID` before anything is
de-identified. Name your policy distinctly to use them. An option that is not in the table above, or
one named twice, is refused the same way, never ignored. Every attribute a Retain option kept is a
`retained` row of the manifest with `DEID_RESIDUAL_RETAINED`, so it reaches the residual inventory
rather than surviving unmentioned.

**Clean Descriptors and coded lists.** Table E.1-1 gives Clean Descriptors a `C` on sequences as well
as on text: Admitting Diagnoses Code Sequence `(0008,1084)`, the diagnosis code sequences `(0008,1301)`
to `(0008,1304)`, Reason for Visit Code Sequence `(0032,1067)`, Request Attributes Sequence
`(0040,0275)`, Reason for Requested Procedure Code Sequence `(0040,100A)` and Prescription Notes
Sequence `(3010,0081)`. `@cosyte/dicom` cleans such a sequence by keeping it and its items, and the
Code Value, Coding Scheme Designator and free-text Code Meaning in each item survive. So this adapter
removes each such sequence that sits at the top level of the dataset, and the manifest records it
`removed`, never cleaned. One nested inside a sequence the pass keeps cannot be removed here, so the
run throws `DEID_FORMAT_UNSUPPORTED` and returns nothing; run without the option and the Basic Profile
removes it.

```ts runnable
import { parseDicom } from "@cosyte/dicom";
import { defineDeidPolicy } from "@cosyte/deid";
import { deidentifyDicom } from "@cosyte/deid/dicom";

// A small synthetic Part 10 file in Explicit VR Little Endian, built here so the sample runs.
type El = [group: number, element: number, vr: string, value: string];
function part10(elements: El[]): Buffer {
  const encode = ([group, element, vr, text]: El): Buffer => {
    const pad = text.length % 2 === 0 ? "" : vr === "UI" ? "\0" : " ";
    const value = Buffer.from(text + pad, "latin1");
    const head = Buffer.alloc(vr === "OB" ? 12 : 8);
    head.writeUInt16LE(group, 0);
    head.writeUInt16LE(element, 2);
    head.write(vr, 4, "latin1");
    if (vr === "OB") head.writeUInt32LE(value.length, 8);
    else head.writeUInt16LE(value.length, 6);
    return Buffer.concat([head, value]);
  };
  const syntax: El = [0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"];
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), ...[syntax, ...elements].map(encode)]);
}

const dataset = parseDicom(
  part10([
    [0x0010, 0x0010, "PN", "ZZFAMILY^ZZGIVEN"],
    [0x0010, 0x1010, "AS", "042Y"],
    [0x0010, 0x1030, "DS", "71.5"],
  ]),
);

// A policy that does not claim the safe-harbor label, so a Retain option may run under it.
const research = defineDeidPolicy({ name: "imaging-research" });
const result = deidentifyDicom(dataset, {
  policy: research,
  annexEOptions: ["RetainPatientCharacteristics"],
});

result.retained; // => ["RetainPatientCharacteristics"]
result.deidentificationMethodCodes.map((term) => term.codeValue); // => ["113100", "113108"]
result.dataset.get("00101010")?.rawBytes.toString("latin1"); // => "042Y"
result.dataset.get("00100010")?.rawBytes.length; // => 0
result.manifest.filter((entry) => entry.disposition === "retained").map((entry) => entry.locus); // => ["(0010,1010) Patient's Age", "(0010,1030) Patient's Weight"]
```

Under the default policy, the same option is refused:

```ts runnable throws
import { parseDicom } from "@cosyte/dicom";
import { deidentifyDicom } from "@cosyte/deid/dicom";

// A small synthetic Part 10 file in Explicit VR Little Endian, built here so the sample runs.
type El = [group: number, element: number, vr: string, value: string];
function part10(elements: El[]): Buffer {
  const encode = ([group, element, vr, text]: El): Buffer => {
    const pad = text.length % 2 === 0 ? "" : vr === "UI" ? "\0" : " ";
    const value = Buffer.from(text + pad, "latin1");
    const head = Buffer.alloc(vr === "OB" ? 12 : 8);
    head.writeUInt16LE(group, 0);
    head.writeUInt16LE(element, 2);
    head.write(vr, 4, "latin1");
    if (vr === "OB") head.writeUInt32LE(value.length, 8);
    else head.writeUInt16LE(value.length, 6);
    return Buffer.concat([head, value]);
  };
  const syntax: El = [0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"];
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), ...[syntax, ...elements].map(encode)]);
}

const dataset = parseDicom(part10([[0x0010, 0x1010, "AS", "093Y"]]));

// Throws DEID_POLICY_INVALID: the safe-harbor label may not keep an age over 89.
deidentifyDicom(dataset, { annexEOptions: ["RetainPatientCharacteristics"] });
```

[Which Annex E options the DICOM adapter offers](./dicom-annex-e-options.md) records why these three,
why the others wait, and why pixel cleaning stays out.

## The coded declaration: what a machine reads instead of a sentence

PS3.15 E.1.1 asks for `Patient Identity Removed (0012,0062) = YES` and then, additionally, for "one or
more codes from CID 7050 'De-identification Method' corresponding to the Profile and Options used" in
**De-identification Method Code Sequence `(0012,0064)`**, "and/or a text string describing the method
used" in **De-identification Method `(0012,0063)`**. This adapter writes **both**: the English sentence
stays exactly as it was, and the coded terms are added beside it, so a receiving archive can branch on a
code instead of parsing prose.

```ts runnable
import { parseDicom } from "@cosyte/dicom";
import { deidentifyDicom } from "@cosyte/deid/dicom";

// A small synthetic Part 10 file in Explicit VR Little Endian, built here so the sample runs.
type El = [group: number, element: number, vr: string, value: string];
function part10(elements: El[]): Buffer {
  const encode = ([group, element, vr, text]: El): Buffer => {
    const pad = text.length % 2 === 0 ? "" : vr === "UI" ? "\0" : " ";
    const value = Buffer.from(text + pad, "latin1");
    const head = Buffer.alloc(vr === "OB" ? 12 : 8);
    head.writeUInt16LE(group, 0);
    head.writeUInt16LE(element, 2);
    head.write(vr, 4, "latin1");
    if (vr === "OB") head.writeUInt32LE(value.length, 8);
    else head.writeUInt16LE(value.length, 6);
    return Buffer.concat([head, value]);
  };
  const syntax: El = [0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"];
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), ...[syntax, ...elements].map(encode)]);
}

const part10Bytes = part10([[0x0010, 0x0010, "PN", "ZZFAMILY^ZZGIVEN"]]);
const { dataset, deidentificationMethodCodes, optionDeclarations } = deidentifyDicom(
  parseDicom(part10Bytes),
);

// What went INTO (0012,0064): the profile, then every option the run applied.
deidentificationMethodCodes; // => [{ codeValue: "113100", codingSchemeDesignator: "DCM", codeMeaning: "Basic Application Confidentiality Profile" }]

// Every option, applied or withheld, by its coded term. Under the default policy all twelve are
// withheld, because the full Basic Profile applies with no Retain/Clean deviations.
optionDeclarations.filter((d) => d.status === "withheld").length; // => 12

// The same terms, on the dataset and in the re-serialized bytes.
dataset.get("00120064")?.value.kind; // => "sequence"
```

Three rules govern it, and the second is the one to read twice:

- **Only the published terms are ever emitted.** Every Code Value, Code Meaning, and Coding Scheme
  Designator comes from the thirteen rows of CID 7050 (context group `1.2.840.10008.6.1.925`),
  reproduced verbatim. Nothing is composed, abbreviated, or paraphrased, and no term outside that table
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
`DICOM_INPUT_DEIDENTIFICATION_METHOD_CODES_DROPPED` warning that carries no Code Value, no Code Meaning,
and no other text read from the input.

## UID remapping: keeping relationships

Study/Series/SOP Instance UIDs are replaced with internally-consistent surrogates: the **same** source UID
always maps to the **same** replacement, so images still group into series and series into studies. The
mapping is content-derived, so it is consistent across runs even without shared state; pass one `Map` as
`uidMap` across a whole archive to make it consistent by construction (and O(1) on repeats):

```ts runnable
import { parseDicom } from "@cosyte/dicom";
import { deidentifyDicom } from "@cosyte/deid/dicom";

// A small synthetic Part 10 file in Explicit VR Little Endian, built here so the sample runs.
type El = [group: number, element: number, vr: string, value: string];
function part10(elements: El[]): Buffer {
  const encode = ([group, element, vr, text]: El): Buffer => {
    const pad = text.length % 2 === 0 ? "" : vr === "UI" ? "\0" : " ";
    const value = Buffer.from(text + pad, "latin1");
    const head = Buffer.alloc(vr === "OB" ? 12 : 8);
    head.writeUInt16LE(group, 0);
    head.writeUInt16LE(element, 2);
    head.write(vr, 4, "latin1");
    if (vr === "OB") head.writeUInt32LE(value.length, 8);
    else head.writeUInt16LE(value.length, 6);
    return Buffer.concat([head, value]);
  };
  const syntax: El = [0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"];
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), ...[syntax, ...elements].map(encode)]);
}

// Two objects of one synthetic study, as you would read them from the study's files.
const study = "1.2.826.0.1.3680043.10.999.1";
const studyFiles = [
  part10([[0x0020, 0x000d, "UI", study], [0x0020, 0x0013, "IS", "1"]]),
  part10([[0x0020, 0x000d, "UI", study], [0x0020, 0x0013, "IS", "2"]]),
];

const uidMap = new Map<string, string>();
const replaced = studyFiles.map((file) => {
  const { dataset } = deidentifyDicom(parseDicom(file), { uidMap });
  return JSON.stringify(dataset.get("0020000D")?.value);
});

// every object in the study now shares consistently-remapped Study UIDs
replaced[0] === replaced[1]; // => true
replaced[0]?.includes(study); // => false
```

The source→replacement map is **never** surfaced in the value-free result (a source UID is a re-linking
vector). If you need it for your own re-identification key store, you own the `uidMap` you pass in.

**How far that guarantee reaches is on the result, not only in this paragraph.** With **no** shared
cache, referential integrity of the replacement UIDs is guaranteed **only within the single call**: the
replacement UIDs of one call are not promised to agree with those of any other, because that would
depend on inputs you control (a differing `uidRoot`, most obviously). Supply a shared cache and the
guarantee reaches every call that shares it, and you own its lifetime and extent. The two cases are told
apart by reading a value rather than by remembering which arguments were passed:

```ts runnable
import { parseDicom } from "@cosyte/dicom";
import { deidentifyDicom } from "@cosyte/deid/dicom";

// A small synthetic Part 10 file in Explicit VR Little Endian, built here so the sample runs.
type El = [group: number, element: number, vr: string, value: string];
function part10(elements: El[]): Buffer {
  const encode = ([group, element, vr, text]: El): Buffer => {
    const pad = text.length % 2 === 0 ? "" : vr === "UI" ? "\0" : " ";
    const value = Buffer.from(text + pad, "latin1");
    const head = Buffer.alloc(vr === "OB" ? 12 : 8);
    head.writeUInt16LE(group, 0);
    head.writeUInt16LE(element, 2);
    head.write(vr, 4, "latin1");
    if (vr === "OB") head.writeUInt32LE(value.length, 8);
    else head.writeUInt16LE(value.length, 6);
    return Buffer.concat([head, value]);
  };
  const syntax: El = [0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"];
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), ...[syntax, ...elements].map(encode)]);
}

const dataset = parseDicom(part10([[0x0020, 0x000d, "UI", "1.2.826.0.1.3680043.10.999.1"]]));

deidentifyDicom(dataset).uidReferentialIntegrity.scope; // => "single-call"

const uidMap = new Map<string, string>();
deidentifyDicom(dataset, { uidMap }).uidReferentialIntegrity.scope; // => "caller-supplied-cache"

// The same fact in one PHI-free sentence, safe to log or to file in a disclosure record:
deidentifyDicom(dataset).uidReferentialIntegrity.statement.startsWith("Referential integrity"); // => true
```

## The burned-in-pixel hazard: flagged, never cleaned

This is a **metadata-only** de-identifier: `metadataOnly` is always `true`. It cannot inspect or clean
pixels, so recognizable text **burned into the image** (Safe Harbor category Q, full-face photographs and
comparable images) is **not** removed. When Pixel Data is present and not affirmatively marked free of
burned-in annotation, the result flags it:

```ts runnable
import { parseDicom } from "@cosyte/dicom";
import { deidentifyDicom, BURNED_IN_ANNOTATION_CODE } from "@cosyte/deid/dicom";

// A small synthetic Part 10 file in Explicit VR Little Endian, built here so the sample runs.
type El = [group: number, element: number, vr: string, value: string];
function part10(elements: El[]): Buffer {
  const encode = ([group, element, vr, text]: El): Buffer => {
    const pad = text.length % 2 === 0 ? "" : vr === "UI" ? "\0" : " ";
    const value = Buffer.from(text + pad, "latin1");
    const head = Buffer.alloc(vr === "OB" ? 12 : 8);
    head.writeUInt16LE(group, 0);
    head.writeUInt16LE(element, 2);
    head.write(vr, 4, "latin1");
    if (vr === "OB") head.writeUInt32LE(value.length, 8);
    else head.writeUInt16LE(value.length, 6);
    return Buffer.concat([head, value]);
  };
  const syntax: El = [0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"];
  return Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), ...[syntax, ...elements].map(encode)]);
}

// A synthetic file with Pixel Data and no Burned In Annotation (0028,0301) element marking it free.
const dataset = parseDicom(part10([[0x7fe0, 0x0010, "OB", "\0\0\0\0"]]));

const { burnedInAnnotationHazard, warnings } = deidentifyDicom(dataset);
burnedInAnnotationHazard; // => true
// do NOT release the image on metadata alone: pixels may carry burned-in PHI.
warnings.some((w) => w.code === BURNED_IN_ANNOTATION_CODE); // => true
```

Pixel-level cleaning needs pixel decode and is out of scope (a future `@cosyte/dicom-pixel`). The adapter
warns rather than giving a false sense of safety.

## Known limitations

- **Metadata only**: pixels are never inspected; a burned-in-annotation hazard is *flagged*, never
  cleaned. The two pixel options of CID 7050 (`113101` Clean Pixel Data, `113102` Clean Recognizable
  Visual Features) are therefore always declared **withheld** and are never written to `(0012,0064)`.
- **Three Annex E options, no more**: Clean Descriptors, Retain Patient Characteristics and Retain
  Device Identity can be named, none under a policy named `safe-harbor`; every other option is
  refused. Clean Descriptors refuses a file with a cleaned coded list nested inside a kept sequence. With none named, the full Basic Profile
  applies (maximal removal) and every option is declared withheld.
- **Replacement-UID referential integrity is guaranteed within one call** unless you supply a shared
  `uidMap`, in which case it reaches every call that shares it. The declared scope is on the result.

[What the caller still owns](./what-the-caller-still-owns.md) lists the duties that stay with you
before you release the output, with a table of what this adapter does not cover.

## Reference

- [`deidentifyDicom`](./api/@cosyte/deid/dicom.md#deidentifydicom),
  [`deidentifyDicomBuffer`](./api/@cosyte/deid/dicom.md#deidentifydicombuffer),
  [`DicomDeidOptions`](./api/@cosyte/deid/dicom.md#dicomdeidoptions) and
  [`DicomDeidResult`](./api/@cosyte/deid/dicom.md#dicomdeidresult)
- [Which Annex E options the DICOM adapter offers](./dicom-annex-e-options.md)
- [`DicomOptionDeclaration`](./api/@cosyte/deid/dicom.md#dicomoptiondeclaration),
  [`CID_7050`](./api/@cosyte/deid/dicom.md#cid_7050) and
  [`DicomUidReferentialIntegrity`](./api/@cosyte/deid/dicom.md#dicomuidreferentialintegrity)
- [`BURNED_IN_ANNOTATION_CODE`](./api/@cosyte/deid/dicom.md#burned_in_annotation_code) and
  [`INPUT_METHOD_CODE_SEQUENCE_DROPPED_CODE`](./api/@cosyte/deid/dicom.md#input_method_code_sequence_dropped_code)
