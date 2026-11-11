---
id: dicom-annex-e-options
title: Which Annex E options the DICOM adapter offers
sidebar_label: DICOM Annex E options
description: "The decision record for the PS3.15 Annex E options the DICOM adapter offers, the ones it does not offer yet, and why pixel cleaning stays out."
---

# Which Annex E options the DICOM adapter offers

This page records a decision: which PS3.15 Annex E options a caller of `@cosyte/deid/dicom` can name,
which ones it cannot name yet, and why. [De-identify a DICOM file](./guides-dicom.md#apply-an-annex-e-option)
shows how to use the ones it offers.

## What we read

We read PS3.15 2026d firsthand: Table E.1-1 (the action for each attribute under the Basic Profile and
under each option column) and section E.3 (what each option means). That is the edition
`@cosyte/dicom` generates its action table from. A change to Table E.1-1 published after that edition
reaches this adapter when `@cosyte/dicom` takes it, and not before.

`@cosyte/dicom`'s `deidentify()` applies the Basic Profile and every metadata option column of the
table: Clean Graphics, Clean Structured Content, Clean Descriptors, both Retain Longitudinal Temporal
Information options (Full Dates and Modified Dates), Retain Patient Characteristics, Retain Device
Identity, Retain UIDs, Retain Safe Private and Retain Institution Identity. It does not apply the two
pixel options, Clean Pixel Data and Clean Recognizable Visual Features, because it never reads a pixel.
So the peer can express every option this page discusses; the question is which ones this adapter can
apply honestly.

## What we offer

Three options, named in `annexEOptions`:

| Option                          | CID 7050 | What it does in this pass                                                      | Under the `safe-harbor` label           |
| ------------------------------- | -------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| `CleanDescriptors`              | `113105` | Descriptions and comments are cleaned: a text value is emptied                | Allowed: it keeps nothing               |
| `RetainPatientCharacteristics`  | `113108` | Age, sex, size, weight, ethnic group, smoking and pregnancy status are kept    | Refused: it keeps an age over 89        |
| `RetainDeviceIdentity`          | `113109` | Device serial numbers, station names, detector and gantry identifiers are kept | Refused: it keeps device identifiers    |

Each was chosen because the column is applied in full by `@cosyte/dicom`, one CID 7050 term names it
exactly, and what it keeps or cleans is the same in every file. That makes three statements true at
once: the run did what the term says, the term in De-identification Method Code Sequence `(0012,0064)`
is the right one, and the manifest can name every attribute the option kept.

The rules that come with them:

- **The safe-harbor label is refused for an option that keeps what Safe Harbor removes.** A run under a
  policy named exactly `safe-harbor`, the default included, that names `RetainPatientCharacteristics`
  or `RetainDeviceIdentity` throws `DEID_POLICY_INVALID` before anything is de-identified. Name your
  policy distinctly to keep them.
- **An option we do not offer is refused, never ignored.** Ignoring a name would release output made
  under a different option set than the one the caller asked for.
- **What an option keeps is in the manifest.** Every attribute a Retain option kept is a `retained` row
  with `DEID_RESIDUAL_RETAINED`, so it reaches the residual inventory an expert reads.
- **What was applied is declared.** Each applied option is written to `(0012,0064)` by its CID 7050
  term, named in De-identification Method `(0012,0063)`, listed on `retained`, and marked `applied` in
  `optionDeclarations`. Every other option is declared `withheld` on the result and never written to
  the dataset.

## What we do not offer yet, and why

- **Retain Longitudinal Temporal Information with Modified Dates (`113107`).** `@cosyte/dicom` applies
  the modified-dates column as a clean, which empties each date, and then writes Longitudinal Temporal
  Information Modified `(0028,0303)` as `MODIFIED`. It shifts no date. Offering the option as it stands
  would declare `113107` and `MODIFIED` over dates that are empty: a recipient told the longitudinal
  relationships were kept would find none. It waits until this adapter shifts those dates itself, with
  the same keyed date shift the other adapters use.
- **Retain Longitudinal Temporal Information with Full Dates (`113106`).** It keeps every date as it
  was. A keyed date shift serves the same need with less kept, so we offer that first.
- **Retain UIDs (`113110`).** An original UID is a re-linking key. The consistent replacement UIDs
  already keep every study, series and image relationship.
- **Retain Safe Private (`113111`).** What it keeps rests on the sending system's own declaration, or
  on a vendor profile the caller supplies. It waits for a way to pass that profile and for a test of
  what it keeps.
- **Retain Institution Identity (`113112`), Clean Graphics (`113103`) and Clean Structured Content
  (`113104`).** Not in this first set. Each would follow the same pattern as the three above.

## Pixel cleaning stays out

Clean Pixel Data (`113101`) and Clean Recognizable Visual Features (`113102`) describe work on the
image itself. This adapter is metadata only: it never reads a pixel, so it cannot remove text burned
into an image or a recognizable face. Both are always declared `withheld`, a burned-in-annotation hazard
is flagged with `burnedInAnnotationHazard`, and no option a caller names changes that.
