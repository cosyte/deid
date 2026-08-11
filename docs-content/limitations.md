# Known Limitations & Honesty

**`@cosyte/deid` transforms a healthcare document per a configured de-identification policy (Safe
Harbor by default) and emits a value-free manifest of what it acted on. It never labels output
"de-identified," and it never certifies HIPAA de-identification.** Safe Harbor is implemented
mechanically; **Expert Determination is _supported_, never _rendered_.** The structured-field core is
the guarantee; **free text is blocked by default**; **DICOM is metadata-only** (burned-in pixels are
flagged, not cleaned). The library **fails closed**: on any ambiguity it blocks or removes, never
passes a value through as "probably safe."

Read this page before you rely on the library for anything that leaves your control.

## What it does

- Locates PHI **structurally** at each parser's loci (never by regex over raw bytes) and applies the
  configured policy transform per Safe Harbor category.
- Returns an immutable transformed document plus a **value-free manifest** (category + transform +
  locus + count + disposition, **never the value removed**, never the key, never the date-shift offset).
- **Fails closed:** an unrecognized structure, an un-locatable identifier, an unknown segment/extension,
  or a free-text blob is **blocked or removed**, never emitted as safe.
- Preserves clinical/financial values (codes, units, results, statuses, amounts), the **over-scrub
  guard**, so it does not degenerate into a "safe but useless" blanket scrubber.
- Ships two named [policy profiles](#policy-profiles) and a `defineDeidProfile()` that can only ever
  **tighten** (widen safety), never loosen, a base standard.

## What it does NOT do

| It does **not**…                                                  | Because…                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Certify HIPAA de-identification                                   | The library **transforms and evidences**; it never certifies. Output is _"Safe-Harbor-transformed per the configured policy,"_ never _"de-identified."_                                                                                                                                                       |
| Discharge the §164.514(b)(2)(ii) **actual-knowledge** clause      | That is an organizational judgment about what a recipient knows: the library surfaces the residual (kept year, safe-3-digit ZIP) so a human can apply it, but cannot make it.                                                                                                                                 |
| Render or certify **Expert Determination** (§164.514(b)(1))       | _"The risk is very small"_ is a qualified statistician's contextual judgment about a dataset **and its recipient**. The [ED support report](#expert-determination) emits value-free facts as **input**; `determination` is always `null` and it computes no risk score.                                       |
| De-identify **free text / narrative**                             | Free-text loci (HL7 OBX-5/NTE, C-CDA narrative `<text>`, FHIR notes/`div`, X12 MSG/NTE, NCPDP free text) are **blocked by default**. A [BYO redactor](#free-text) is **consumer-asserted**, never the library's guarantee; a naive built-in regex scrub is deliberately **refused** as a false-safety hazard. |
| Clean **DICOM burned-in pixels** or full-face images (category Q) | v1 is **metadata-only** (delegated PS3.15 Annex E). Burned-in annotation raises `DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED` and `burnedInAnnotationHazard`; pixel decode is a future `@cosyte/dicom-pixel`. **Do not release an image on metadata alone.**                                                       |
| Handle **NCPDP SCRIPT** ePrescribing                              | **Deferred.** The current parser surface (lossy serialize + an address-less `Patient` model) cannot support a faithful structural de-id, so SCRIPT is **not** silently half-handled. NCPDP **Telecom** is supported.                                                                                          |
| Guarantee against a determined re-identification attack           | De-identification reduces risk to the regulatory bar; it is not a cryptographic guarantee. **Key custody is the consumer's**: a leaked HMAC key or date-shift offset re-identifies.                                                                                                                           |
| Do anything the manifest does not record                          | If it is not in the manifest, the library did not do it. The manifest is the complete, value-free audit.                                                                                                                                                                                                      |

## Fail-closed posture

Uniquely, harm here runs in **two** directions and both are guarded:

- **Under-scrub (a leak):** a missed PHI element leaves a patient identifiable. The reflex is the
  inverse of a parser's Postel's-Law liberality: **when in doubt, block/remove.**
- **Over-scrub (destroyed meaning):** a clinical value wrongly treated as an identifier destroys data a
  clinician relies on. Clinical-kind loci are **retained untouched**.

A keyed transform with no key is a **fatal** `DEID_NO_KEY`, never a silent unkeyed fallback (an
unkeyed hash of an identifier is re-identifiable). A context configured with `maxShiftDays: 0` is a
fatal `DEID_CONTEXT_INVALID`, a zero-bound shift is a guaranteed no-op, i.e. the original real dates.

<a id="retained-loci"></a>

## What is retained, and what "fails closed" does NOT cover

**Fail-closed is a rule about _structures_, not about every field.** An unrecognized segment, resource,
loop, or extension is blocked. But a segment on a format's **retain-list** is passed through, and
retaining the structure is not the same as auditing every field inside it. Read this before you assume
an unmapped position was removed.

Two things follow, and the second is the one that surprises people:

- **The identifying loci inside retained HL7 v2 structures are carved back out and acted on.** Under a
  Safe-Harbor-labelled policy the admit (PV1-44), discharge (PV1-45), observation (OBR-7) and diagnosis
  (DG1-5) dates are reduced to their **year**, and the visit number (PV1-19) with the placer and filler
  order numbers (OBR-2/3, ORC-2/3) are **blocked** as the (R) catch-all. §164.514(b)(2)(i)(C) names
  admission and discharge dates in the regulation text itself.
- **Every other field of a retained structure is still passed through untouched, and recorded
  nowhere.** The carve-out above narrows this class; it does not close it. Full-precision timestamps
  survive in EVN, PV2, PR1, RXA, RXD, FT1, TXA and SPM, and the attending / referring **provider**
  names survive in PV1-7/8 and OBR-16, among others. None of them is in the manifest, so none is in the
  support report either. **Do not read the named loci above as the complete set of what a retained
  structure can carry.** If your threat model includes these, filter them yourself.

Vendor-proprietary loci absent from public specs are deferred, **not invented**: a quirk is encoded
only when a real de-identified document grounds it.

<a id="policy-profiles"></a>

## Policy profiles, and the Limited Data Set caveat

- **`SAFE_HARBOR_PROFILE`**: the fail-closed default, dates generalized to year, the (R) catch-all
  blocked. It retains **no** identifying locus: an admission, discharge or service date keeps only its
  year, and an encounter or order number is removed.
- **`LIMITED_DATA_SET_PROFILE`**: a **research / longitudinal** preset that **date-shifts** dates
  (interval-preserving) rather than generalizing them. It is deliberately **less protective than Safe
  Harbor** for dates: a shifted-but-real date is still "an element of a date." Therefore it is **not**
  labelled `safe-harbor`, it **requires** a keyed per-patient context, and it produces an
  **Expert-Determination-supporting** dataset, **not** a certified de-identification, and **not**, on
  its own, a HIPAA §164.514(e) Limited Data Set. Disclosing an actual Limited Data Set additionally
  requires a **Data Use Agreement**, which is the consumer's responsibility.

  It also **keeps unchanged** the two classes §164.514(e)(2) permits and Safe Harbor does not: the
  **encounter dates** (admission / discharge / service / diagnosis) and the **encounter and order
  identifiers** (visit number, placer and filler order numbers). That list of sixteen direct
  identifiers names no date and has no catch-all, which is exactly why these survive here and are
  removed under Safe Harbor. Every one is still **recorded** as a `DEID_RESIDUAL_RETAINED` residual and
  appears in the support report's inventory, so nothing is kept silently.

`defineDeidProfile()`'s widen-never-narrow contract covers retention too, and it reads the opposite way
round from a transform override: a derived profile may **drop** a retained class (keep less, remove
more) but may never **add** one. Retention is also opt-in at the call: options built by hand from a
profile's `policy` alone keep nothing.

`defineDeidProfile()` derives a per-site profile under a **widen-never-narrow** contract: a site may
move a category to an equal-or-stronger transform (more removal), but **never** re-weaken a category,
a weakening override is a fatal `DEID_PROFILE_INVALID`. A site preset can only tighten the base.

<a id="free-text"></a>

## Free text is the consumer's responsibility

The library bundles **no** NLP/PHI detector. With no redactor, free-text loci are **blocked**. With a
`FreeTextRedactor`, its output is recorded as **consumer-asserted** (`DEID_FREETEXT_CONSUMER_REDACTED`)
and is **not re-verified** by the library: "no findings" from a redactor is not an attestation. The
structural PHI the adapters remove is unaffected either way.

<a id="expert-determination"></a>

## The Expert-Determination report makes no determination

The report is descriptive input a determiner consumes and documents; it reaches no conclusion:

```ts runnable
import { OUTPUT_LABEL, SAFE_HARBOR_PROFILE, LIMITED_DATA_SET_PROFILE } from "@cosyte/deid";

// The output is never labelled "de-identified".
OUTPUT_LABEL; // => "Safe-Harbor-transformed per the configured policy"
OUTPUT_LABEL.includes("de-identified"); // => false

// Safe Harbor is the fail-closed default; the LDS preset is honestly not Safe Harbor.
SAFE_HARBOR_PROFILE.standard; // => "safe-harbor"
LIMITED_DATA_SET_PROFILE.standard; // => "limited-data-set"
LIMITED_DATA_SET_PROFILE.requiresContext; // => true
```

```ts runnable
import { buildExpertDeterminationSupportReport } from "@cosyte/deid";

const report = buildExpertDeterminationSupportReport([], { policy: "safe-harbor" });
report.determination; // => null
report.disclaimer.includes("NOT a determination"); // => true
```

The library's promise is narrow and honest: **structured-field, fail-closed, policy-driven
Safe-Harbor transformation with a value-free manifest, never a leaked patient, never a destroyed
clinical value, and never a claim of "de-identified."**
