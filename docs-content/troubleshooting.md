---
id: troubleshooting
title: Troubleshooting and limits
sidebar_label: Troubleshooting
description: "Why a value was blocked, why a keyed transform needs a key, why a policy is refused, and what the manifest is safe to log."
---

# Troubleshooting and limits

## A value I expected to be transformed was `blocked`

That is the **fail-closed rule** working. The engine blocks (withholds the value, disposition
`blocked`) when it cannot confidently handle a locus: an unclassified PHI-bearing locus, an
`unknown`-kind locus, a free-text locus, a date/ZIP whose value it cannot generalize, or a policy
transform it cannot apply to that locus. The block is recorded in the manifest with
[`DEID_LOCUS_BLOCKED`](./codes-and-categories.md#disposition-codes) or [`DEID_FREETEXT_BLOCKED`](./codes-and-categories.md#disposition-codes). It is never a silent pass-through of the value.

## A keyed transform threw `DEID_NO_KEY`

Pseudonymize, keyed-hash, and date-shift are **keyed**, and [`DEID_NO_KEY`](./codes-and-categories.md#fatal-codes) means a category needed one and no key was supplied. Supply a `context`
(`createDeidContext({ key })`): the engine **never** falls back to an unkeyed transform, because an
unkeyed hash of an identifier is re-identifiable. Date-shift additionally needs a `patientId` scope.
The **built-in Safe Harbor policy uses none of the three**, so it never raises this: if a Safe Harbor
pass asks you for a key, a custom policy or profile put a keyed transform in it.

## Creating a context threw `DEID_KEY_TOO_SHORT`

`createDeidContext` and `createDeidRegistry` refuse ([`DEID_KEY_TOO_SHORT`](./codes-and-categories.md#fatal-codes)) a key, or an explicit `dateShiftSeed`, shorter
than **16 bytes (128 bits)**. A short key can be guessed, and a guessed key reverses every surrogate
and date-shift offset made under it. The length is counted on the bytes the HMAC uses: a `Uint8Array`
as given, a string as its UTF-8 bytes. Use 32 random bytes: `crypto.randomBytes(32)`, or the output of
`openssl rand -hex 32` passed as the string it is. The message names the minimum and never carries the
key. A new key gives new surrogates and offsets, so a corpus made under the old key no longer links to
output made under the new one.

## A policy threw `DEID_POLICY_INVALID`

A policy claiming the `safe-harbor` label, either by its own name or through a profile that declares
the `safe-harbor` standard, assigned a category a transform whose output is **derived from that
category's own value**: `pseudonymize`, `hash`, or `date-shift` on any category, or `generalize` on any
category other than (B) geography and (C) dates and ages over 89. The message names the offending
category and transform ([`DEID_POLICY_INVALID`](./codes-and-categories.md#fatal-codes)). Those are Expert-Determination techniques rather than Safe Harbor ones, so
either withhold the value (`redact` or `block`) or name the policy distinctly. The library never silently strengthens a transform, and never renames a policy, behind your back. An assignment that is
not one of the eight published transform names draws the same refusal: a pair whose derivation cannot
be established is refused, never permitted.

## `deidentify` threw `EMPTY_INPUT`

The model was null/undefined or carried no `loci` array ([`EMPTY_INPUT`](./codes-and-categories.md#fatal-codes)). Pass `{ loci: [...] }`.

## `deidentifyDicom` threw `DEID_POSITIONS_UNENUMERABLE` naming a tag

The dataset held an element that carries no value bytes, and the message names where it sits: its
sequence path and its tag ([`DEID_POSITIONS_UNENUMERABLE`](./codes-and-categories.md#fatal-codes)).
The usual cause is a copy made with object spread (`{ ...element }`): from `@cosyte/dicom` 0.1.12 on,
an element's `rawBytes` is read through an accessor, which a spread copy does not carry. Copy an
element through the `Element` constructor from `@cosyte/dicom` instead, passing
`rawBytes: element.rawBytes` with its other fields.

## What the manifest is safe to log, and the one thing to know about the locus

Error messages carry **no PHI**: every message this library raises is a fixed sentence, and no value,
key, or date-shift offset is ever interpolated into one. A manifest entry never carries the value that
was removed, generalized, or pseudonymized, and never the key or the offset. Its
`reidentificationCode` field is a **boolean** flag saying whether a keyed surrogate was emitted there,
never the surrogate, the key, or the offset itself.

The **locus** needs one more sentence, because it is the one field built out of the document rather
than chosen by the library. A per-format adapter names a locus using the identifier at that position:
an HL7 v2 segment id, a C-CDA element name, a FHIR element name, an X12 segment or transaction-set id,
an NCPDP segment code. When the input is malformed, an upstream parser may report something at one of
those positions that is not an identifier at all, and on an unrecognized narrative line that content
can be clinical prose. Each identifier is therefore checked against the
shape its position promises before it is used; one that does not match is refused outright and the
locus reads `WITHHELD_LOCUS_TOKEN` (`<withheld>`) plus a structural index, so two refused positions
stay distinguishable and nothing is silently dropped. An X12 segment id is held to more than its
shape: one the adapter does not recognize is withheld whatever it looks like, because that segment is
removed whole and its id may be a value that landed there.

That is a bound, not a guarantee of impossibility, and how much it leaves behind depends on the
position. An HL7 v2 segment id, an X12 segment or transaction-set id, and an NCPDP code are at most
three characters with no separator and no whitespace, so the residue there is a narrative line whose
entire content is three letters, which is indistinguishable from a real segment id. A C-CDA element
name and a FHIR element name are bounded at 64 and 65 characters, so an unspaced token that long is
still echoed at those positions. No whitespace passes any of the six, which is what keeps prose out,
but "no whitespace" is not "no content". So treat a manifest as safe to log, and treat a run producing
`<withheld>` loci as a signal that the input was not what it claimed to be. Never log the input model
or the raw document; it carries protected health information.

> **If you have `0.0.2` installed, upgrade.** In `0.0.2` and earlier those identifiers were interpolated
> unbounded, so a malformed document could put document content into the manifest and into
> `buildExpertDeterminationSupportReport`'s output. See the changelog entry for the full detail.

## Known limitations (this release, the format-agnostic core)

The library's promise is **narrow and honest**. Do **not** over-trust it:

- **Not a certification.** Output is **"Safe-Harbor-transformed per the configured policy,"** never
  "de-identified" / "HIPAA-compliant". The actual-knowledge condition (§164.514(b)(2)(ii)) is the
  consumer's; Expert Determination is not rendered.
- **The root entry is the generic core.** `@cosyte/deid` itself is the transform/policy/manifest core
  over a **generic locus model**, so the caller supplies each locus's `path`, `kind`, and `category`.
  The per-format locus maps (HL7 v2, C-CDA, FHIR, X12, NCPDP, DICOM), which is where "the parser knows
  where the name is" becomes automatic, live behind the matching subpath exports.
- **A birth year over 89 is removed, measured at the year of the call.** Under the default policy a
  date generalizes to its **year**, recorded as a [`DEID_RESIDUAL_RETAINED`](./codes-and-categories.md#disposition-codes) residual. A **date of birth**
  whose year is 90 or more years before the year the pass runs is removed instead, and recorded as
  [`DEID_CATEGORY_GENERALIZED`](./codes-and-categories.md#disposition-codes). Every format adapter marks the birth dates it locates; on the
  generic core, set `dateOfBirth: true` on a `date` locus yourself, or the year is kept however old it
  is. An age held as a number (an HL7 v2 OBX result coded as an age, a FHIR `Age` or age-coded
  `valueQuantity`, a C-CDA age observation) is located too: over 89 it is removed, and 89 or under it
  is kept exactly as written. On the generic core, set `ageUnit` on an `age` locus for that rule. See
  [Known limitations](./limitations.md#ages-over-89) for the reference date, the year-only
  comparison, the codes read as an age, and the ages the rule does not reach.
- **`GEOGRAPHIC` is generalized as a ZIP.** A locus of category `GEOGRAPHIC` is treated as a ZIP code
  (initial-3-digit or `000`). Street/city/county elements should be **removed**: mark them for
  redaction (or a non-ZIP kind) rather than relying on ZIP generalization, which would keep a leading
  digit fragment (recorded as a residual, never silently). The per-format locus maps classify these
  precisely.
- **Free text is block-only.** A `freetext` locus is blocked by default, no naive regex scrub (a
  false-safety hazard). A bring-your-own redaction interface is available via the `redactor` option.
- **Date-shift is not Safe Harbor.** It is an Expert-Determination-supporting mode; a shifted real date
  is still a date. The `safe-harbor` policy generalizes dates to year instead. A shifted date of birth
  is not aggregated at 90: that rule belongs to the year generalization.

The [API reference](./api/README.md) always reflects exactly what this release ships: treat it as the
source of truth. [Codes and categories](./codes-and-categories.md) lists every fatal and disposition
code named on this page, and [Known limitations](./limitations.md) states the rest of the library's
limits.
