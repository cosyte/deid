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

## The manifest is safe to log; the input is not

Manifest entries and error messages **never contain PHI** (no value, no key, no offset) — they are safe
to log. Never log the input model or the raw document; it carries protected health information.

## Known Limitations (this release — the format-agnostic core)

The library's promise is **narrow and honest**. Do **not** over-trust it:

- **Not a certification.** Output is **"Safe-Harbor-transformed per the configured policy,"** never
  "de-identified" / "HIPAA-compliant". The actual-knowledge condition (§164.514(b)(2)(ii)) is the
  consumer's; Expert Determination is not rendered.
- **No format is wired yet.** This release is the transform/policy/manifest core over a **generic locus
  model**. The caller supplies each locus's `path`, `kind`, and `category`. Per-format locus maps
  (HL7 v2, C-CDA, FHIR, X12, NCPDP, DICOM) — which is where "the parser knows where the name is"
  becomes automatic — arrive in later phases.
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
  false-safety hazard). A bring-your-own redaction interface is a later phase.
- **Date-shift is not Safe Harbor.** It is an Expert-Determination-supporting mode; a shifted real date
  is still a date. The `safe-harbor` policy generalizes dates to year instead.

The **API Reference** always reflects exactly what this release ships — treat it as the source of truth.
