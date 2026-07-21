---
id: guides-dicom
title: De-identifying DICOM
sidebar_position: 10
---

# De-identifying DICOM

The `@cosyte/deid/dicom` adapter is the DICOM binding of the de-identification core — and the one adapter
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
metadataOnly; // => true — always (see the pixel hazard below)
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
| **Private tags**                                             | **removed** (fail-closed — kept only when a known-safe retain list names them; empty by default) |
| Modality, image geometry, coded technique, pixel bytes       | **retained untouched** — the clinical/technical payload survives                                |

The output carries the mandated `Patient Identity Removed = YES` marker and a De-identification Method
naming the profile and the policy.

## UID remapping — keeping relationships

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

## The burned-in-pixel hazard — flagged, never cleaned

This is a **metadata-only** de-identifier: `metadataOnly` is always `true`. It cannot inspect or clean
pixels, so recognizable text **burned into the image** (Safe Harbor category Q — full-face photographs and
comparable images) is **not** removed. When Pixel Data is present and not affirmatively marked free of
burned-in annotation, the result flags it:

```ts
import { deidentifyDicom, BURNED_IN_ANNOTATION_CODE } from "@cosyte/deid/dicom";

const { burnedInAnnotationHazard, warnings } = deidentifyDicom(dataset);
if (burnedInAnnotationHazard) {
  // do NOT release the image on metadata alone — pixels may carry burned-in PHI.
  warnings.some((w) => w.code === BURNED_IN_ANNOTATION_CODE); // true
}
```

Pixel-level cleaning needs pixel decode and is out of scope (a future `@cosyte/dicom-pixel`). The adapter
warns rather than giving a false sense of safety.

## Known limitations

- **Metadata only** — pixels are never inspected; a burned-in-annotation hazard is *flagged*, never
  cleaned.
- **No Retain/Clean deviations in this release** — the full Basic Profile always applies (maximal
  removal). Expert-Determination retain options are a later phase.
