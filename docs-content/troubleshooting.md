---
id: troubleshooting
title: Troubleshooting & limits
sidebar_position: 1
---

# Troubleshooting & Known Limitations

## A value I expected to be transformed was `blocked`

That is the **fail-closed rule** working. The engine blocks (withholds the value, disposition
`blocked`) when it cannot confidently handle a locus: an unclassified PHI-bearing locus, an
`unknown`-kind locus, a free-text locus, a date/ZIP whose value it cannot generalize, or a policy
transform it cannot apply to that locus. The block is recorded in the manifest with
`DEID_LOCUS_BLOCKED` or `DEID_FREETEXT_BLOCKED`. It is never a silent pass-through of the value.

## A keyed transform threw `DEID_NO_KEY`

Pseudonymize, keyed-hash, and date-shift are **keyed**. Supply a `context`
(`createDeidContext({ key })`) — the engine **never** falls back to an unkeyed transform, because an
unkeyed hash of an identifier is re-identifiable. Date-shift additionally needs a `patientId` scope.

## `deidentify` threw `EMPTY_INPUT`

The model was null/undefined or carried no `loci` array. Pass `{ loci: [...] }`.

## What the manifest is safe to log, and the one thing to know about the locus

Error messages carry **no PHI**: every message this library raises is a fixed sentence, and no value,
key, or date-shift offset is ever interpolated into one. A manifest entry never carries the value that
was removed, generalized, or pseudonymized, and never the key or the offset.

The **locus** needs one more sentence, because it is the one field built out of the document rather
than chosen by the library. A per-format adapter names a locus using the identifier at that position:
an HL7 v2 segment id, a C-CDA element name, a FHIR element name, an X12 segment or transaction-set id,
an NCPDP segment code. When the input is malformed, an upstream parser may report something at one of
those positions that is not an identifier at all, and on an unrecognized narrative line that content
can be clinical prose. Each identifier is therefore checked against the
shape its position promises before it is used; one that does not match is refused outright and the
locus reads `WITHHELD_LOCUS_TOKEN` (`<withheld>`) plus a structural index, so two refused positions
stay distinguishable and nothing is silently dropped.

That is a bound, not a guarantee of impossibility, and how much it leaves behind depends on the
position. An HL7 v2 segment id, an X12 segment or transaction-set id and an NCPDP code are at most
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

## Known Limitations (this release — the format-agnostic core)

The library's promise is **narrow and honest**. Do **not** over-trust it:

- **Not a certification.** Output is **"Safe-Harbor-transformed per the configured policy,"** never
  "de-identified" / "HIPAA-compliant". The actual-knowledge condition (§164.514(b)(2)(ii)) is the
  consumer's; Expert Determination is not rendered.
- **The root entry is the generic core.** `@cosyte/deid` itself is the transform/policy/manifest core
  over a **generic locus model**, so the caller supplies each locus's `path`, `kind`, and `category`.
  The per-format locus maps (HL7 v2, C-CDA, FHIR, X12, NCPDP, DICOM) — which is where "the parser knows
  where the name is" becomes automatic — live behind the matching subpath exports.
- **DOB vs. age is not linked in the core.** Under the default policy a date generalizes to its
  **year**, and a year is retained as a `DEID_RESIDUAL_RETAINED` residual. A birth-date *indicative of
  an age over 89* is **not** aggregated to `90+` by the generic core, because resolving DOB→age needs a
  reference date the core does not have. Surface the residual and apply the age-90 rule at the format
  layer (or via a profile) when a DOB is known to indicate age > 89.
- **`GEOGRAPHIC` is generalized as a ZIP.** A locus of category `GEOGRAPHIC` is treated as a ZIP code
  (initial-3-digit or `000`). Street/city/county elements should be **removed** — mark them for
  redaction (or a non-ZIP kind) rather than relying on ZIP generalization, which would keep a leading
  digit fragment (recorded as a residual, never silently). The per-format locus maps classify these
  precisely.
- **Free text is block-only.** A `freetext` locus is blocked by default — no naive regex scrub (a
  false-safety hazard). A bring-your-own redaction interface is available via the `redactor` option.
- **Date-shift is not Safe Harbor.** It is an Expert-Determination-supporting mode; a shifted real date
  is still a date. The `safe-harbor` policy generalizes dates to year instead.

The **API Reference** always reflects exactly what this release ships — treat it as the source of truth.
