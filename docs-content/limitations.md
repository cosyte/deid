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
  locus + count + disposition + a boolean `reidentificationCode`, **never the value removed**, never
  the key, never the date-shift offset).
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
| Clean **DICOM burned-in pixels** or full-face images (category Q) | v1 is **metadata-only** (delegated PS3.15 Annex E). Burned-in annotation raises `DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED` and `burnedInAnnotationHazard`; pixel decode is a future `@cosyte/dicom-pixel`. The two pixel options of CID 7050 are declared **withheld** on the result and never written to `(0012,0064)`. **Do not release an image on metadata alone.**                                                       |
| Guarantee **DICOM replacement-UID consistency across calls** by default | Referential integrity of replacement UIDs is guaranteed **only within a single call** unless the caller supplies a shared `uidMap`, which then extends it to every call sharing that cache. The declared scope is on the result (`uidReferentialIntegrity.scope`), so it is read rather than inferred.                                                       |
| Handle **NCPDP SCRIPT** ePrescribing                              | **Refused, not deferred in prose.** The current parser surface (lossy serialize + an address-less `Patient` model) cannot support a faithful structural de-id, so an NCPDP entry point handed a SCRIPT document raises a typed `DEID_FORMAT_UNSUPPORTED` naming the format and the parser-surface reason and returns **no** document, manifest or partial output at all. NCPDP **Telecom** is supported and is unaffected.                                                                                          |
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
  order numbers (OBR-2/3, ORC-2/3) are **removed**. §164.514(b)(2)(i)(C) names admission and discharge
  dates in the regulation text itself.
- **PV1-19 is routed by its CX-5 identifier-type code**, like PID-3. A `VN`-typed or untyped visit
  number is the encounter identifier and is removed as the (R) catch-all; an `MR`/`AN`/`SS`-typed one is
  handled as the medical record / account / social security number it actually is, so it is
  **transformed under both profiles and is never retained** (§164.514(e)(2) names all three). A kept
  visit number is therefore only ever one the wire did not type as something stronger.
- **Dates inside retained HL7 v2 segments are acted on and recorded.** Every position the **HL7
  v2.5.1** segment definitions type as a date or date/time, in any segment whose bytes the pass can
  hand through, is reduced to its year under a Safe-Harbor-named policy, shifted under a date-shift
  policy, or blocked when the configured transform cannot read the value, and **every one of those
  outcomes is in the manifest** and therefore in the support report. That covers the timestamps in EVN,
  PV2, PR1, RXA, RXD, FT1, TXA and SPM, the order dates in ORC and OBR that no earlier limitation
  named, the date components of a date range or other composite (a specimen collection range, an
  order's quantity/timing, a discharged-to location's effective date), an OBX-5 the message itself
  types as a date, and the **OBX segment's own** reference-range, observation and analysis timestamps
  (OBX-12, OBX-14, OBX-19). The classification is **structural, never a guess from the value**: an
  eight-digit numeric result is not a date.
- **The set of segments that reaches is what the pass hands through, not a list of names.** It is the
  HL7 v2 retain-list plus `OBX`, which is handed through by its OBX-2 value-type branch rather than by
  that list. A segment that fails closed is blocked field by field and carries nothing forward, so a
  date inside one cannot survive to be recorded.
- **The version that classification is fixed at is a residual of its own.** It is HL7 v2.5.1 and it is
  never re-read from the message, so identical bytes always yield the same set of positions. A position
  only some other version types as a date is therefore **not** classified and **not acted on** (it is
  counted as an unexamined position, per the next bullets, which is not the same as being classified);
  the same holds for a retained segment v2.5.1 does not define, and for the file and batch envelope
  headers (`FHS`, `BHS`), which number their fields from a leading delimiter.
- **Every NON-DATE field of a retained structure is still passed through untouched.** The carve-outs
  above narrow this class; they do not close it. The attending / referring **provider** names survive
  in PV1-7/8 and OBR-16, among others, and so do the date/time components carried **inside** a
  person-name or address composite (a provider name's effective or expiration date, an authenticator's
  timestamp, a licence expiry), because acting on those dates while leaving the names they qualify
  would record half a position. **Do not read the named loci above as the complete set of what a
  retained structure can carry.** If your threat model includes these, filter them yourself.

- **Every one of those positions IS counted and located, as an unexamined residual.** A value-bearing
  position inside a structure the pass hands through that no locus rule names is recorded on
  `result.unexaminedResiduals` with its **structural locus**, a **count** and the fact that nothing
  examined it. It carries no value, no key and no offset, exactly like the manifest,
  and it is a separate list precisely so that a position nothing looked at can never be mistaken for a
  residual of a value the pass did examine. All six adapters produce it: the fields of a retained HL7 v2
  segment, the entry dates / entry ids / in-entry performers and family-history demographics inside a
  retained C-CDA clinical body, the codes and statuses a FHIR walk descends past, the elements of a
  retained X12 segment, the fields of a retained NCPDP segment and its fixed header, and every DICOM
  attribute the delegated Annex E report does not account for, nested sequence items included.

- **The envelope around a document is counted too, in every format that has one.** Retaining a
  _structure_ names no position inside it, so the positions of an HL7 v2 `MSH`, of a CDA document
  envelope, of the X12 interchange and functional-group envelope (`ISA` / `TA1` / `GS` / `GE` / `IEA`)
  and of the DICOM Part 10 File Meta group `(0002,xxxx)` are all enumerated and reported. Read those
  counts as the measurement they are: control numbers, trading-partner ids, timestamps and transfer
  syntaxes sit there, and the number says only that no rule examined them.

- **The unit is the position, never the element it sits on.** A rule that reaches one position says
  nothing about the ones beside it: a C-CDA `<telecom use="HP" value="...">` has its `@value` removed
  and its `@use` handed through, and the `@use` is counted. That is why the inventory can list a
  coordinate on an element the manifest also names.

- **A position is wherever the format lets a value sit, not only where a value usually sits.** The
  enumeration is derived from what each parser's model can carry, so it reaches the places a value is
  easy to overlook: XML character data delivered as a **CDATA section** rather than as text, and the
  **comments** and **processing instructions** an XML document is re-serialized with, each counted at
  its own carrier's coordinate; a FHIR primitive's **`_`-sibling element id**, which travels beside the
  value it annotates; and whatever a **partly** rewritten structure keeps, such as the state and country
  of a generalized address, which are re-emitted exactly as they arrived along with anything riding
  inside them.

- **What is removed is not counted, and that is the point of the number.** The inventory measures what
  the pass _hands through_, so a position it deletes (an address line, a blocked narrative and every
  carrier inside one, a FHIR primitive's extension metadata) does not appear: counting one would report
  an exposure that does not exist. The count is a measurement of what left the pass untouched.

- **Counting is not removal, and it is not an allegation.** Nothing is scrubbed, generalized, blocked
  or otherwise transformed on account of the count: what to do about a measured residual is a separate
  decision, and the mirror risk of acting on it blindly is over-removal, which destroys clinical
  meaning. A position no rule examined also has **no established Safe Harbor category**, so it is
  attributed to none of the 18 and moves no category total: a clinical code, a dose unit and an order
  status all sit at positions like these.

- **Two fail-safes, because a count nobody can qualify is worse than no count.** A position whose
  structural locus cannot be expressed is **still counted**, recorded under a withheld locus token and
  flagged, so losing the "where" never also loses the "how many". And a structure whose value-bearing
  positions cannot be enumerated **fails the pass** with a typed `DEID_POSITIONS_UNENUMERABLE` error
  naming the structure, rather than emitting a zero or a partial count that a reader would take for a
  clearance.

- **Two stated edges of the count itself, so it is not read as finer than it is.** An **X12 element is
  one position even when it carries a composite**: `HI-01` holding a qualifier and a diagnosis code is
  counted once, not twice, which is the unit every X12 locus already uses. And **undecoded bytes after
  an X12 interchange's `IEA` terminator contribute no position at all**: they are neither a segment nor
  a loop, they commonly hold a whole second interchange, and any number reported for them would measure
  nothing. Those bytes are re-emitted, and the count does not speak for them.

- **The employer is a Safe Harbor subject, and two employer surfaces still are not reached.**
  §164.514(b)(2)(i) removes the identifiers of the individual "or of relatives, **employers**, or
  household members", so an X12 party whose entity-identifier code is `36` and the employer positions
  the HL7 v2.5.1 financial segments type (GT1-16/17/18/19/29, IN1-10/11, IN2-3/49/50/64, and IN2-70 as
  an organisation) are acted on and recorded. What that does **not** reach: **an employer named only in
  free text**, which is the consumer's redactor's business like any other prose; and **an employer
  carried as a separate `Organization` resource in a FHIR graph**, where no role is typed at the
  position and the reference `display` that names it is blocked rather than classified. The guarantor's
  employer organisation name at **GT1-51** is likewise unreached: it is not among the positions this
  pass names.

<a id="fhir-non-person-loci"></a>

- **In FHIR, the element's DATATYPE decides, not the resource carrying it.** Which resource a person's
  name or address ends up on is a choice the producing system made, and the same home address arrives
  at `Patient.address` from one sender and at `Location.address` from a home-health sender. So a
  `HumanName` is removed and an `Address` is reduced to the Safe Harbor granularity **wherever the
  graph puts them outside a person resource**, `Organization.contact.name` and `Location.address`
  included, in contained resources and `Bundle` entries as well. Neither is stated as out of scope any
  longer. Inside a person resource the demographic map decides instead, which is a narrower reach and
  the last residual below. Positive classification is closed and marker-bound, which is what keeps the
  wider sweep off a clinical value: an element is a `HumanName` only when every property it carries is
  one FHIR R4 defines on `HumanName`, at least one of them belongs to nothing else, and that one holds
  the string or list-of-strings value R4 gives it; an `Address` the same way. A newly reached element
  the pass cannot read faithfully, an `Address` whose `postalCode` is not a whole zip code or an
  unexpected shape at a part the reduction would keep, is **removed whole** and recorded, never partly
  retained. So is **any** complex the classifier cannot pin down at an element name R4 **types** as one
  of the two datatypes (`name`, `address`, a choice-type `locationAddress`, an open `valueAddress` /
  `valueHumanName`) - whether nothing is left to key on, a property R4 does not define sits beside a
  `family` or a `line`, or every property it carries is foreign to both datatypes. The test is whether
  the pass can read what the standard promised at that position, not which keys are present, so an
  unrecognized sibling never unblocks an element that was already unreadable. Two conformant R4
  backbones share one of those element names, `MedicinalProduct.name` and `SubstanceSpecification.name`,
  and both are excluded positively: the property R4 makes `1..1` on each, plus that backbone's own
  closed property set. A plain string at one of those names is never a candidate at all, which is what
  leaves `Organization.name` and `Endpoint.address` alone.

- **Five FHIR surfaces this release still does not reach.** Three because no person is typed at the
  position. A **`ContactPoint` outside a person resource**: a phone or an email on an `Organization`,
  a `Location` or an `Endpoint` is passed through, because widening to telecom would put a payer's or a
  facility's own switchboard number in scope, which the HL7 v2 pass deliberately keeps (`IN1-7`, the
  insurer's own phone, is untouched there). An **organisation's own `name`**: a plain string, never a
  `HumanName`, and administrative content rather than a person's identity. And the **individual's
  employer carried as a separate `Organization` resource**, per the bullet above. The fourth is the
  stated cost of the closed classification: **a name or an address carrying a property R4 does not
  define, at an element name R4 does not type as one of the two datatypes.** The unrecognized sibling
  stops the classifier, and the fail-closed block is scoped to the typed element names, because at any
  other name that same evidence is routinely something else entirely: `{ prefix, linkId, text, type }`
  is a conformant `Questionnaire.item` and not a person, and blocking it would destroy conformant
  clinical and structural content, which is the mirror defect and the one no re-run restores. The
  fifth is the scope of the sweep itself: **a name or an address inside a person resource, at a
  property the demographic map does not list.** The map already decides `name`, `telecom`, `photo` and
  `address` there, so the datatype sweep does not run, and a vendor `Patient.alias` carrying
  `{ family, given }` is passed through where the same bytes on an `Organization` are removed. All
  five are passed through, and all five are counted as unexamined residual positions like anything
  else no rule names.

Vendor-proprietary loci absent from public specs are deferred, **not invented**: a quirk is encoded
only when a real de-identified document grounds it.

<a id="policy-profiles"></a>

## Policy profiles, and the Limited Data Set caveat

- **`SAFE_HARBOR_PROFILE`**: the fail-closed default, dates generalized to year, the (R) catch-all
  blocked. It retains **no** identifying locus: an admission, discharge or service date keeps only its
  year, and an encounter or order number is removed. It emits **no keyed surrogate**: the medical
  record, health plan beneficiary and account numbers are **removed**, because a surrogate derived
  from the individual's own value is not a §164.514(c)(1) code and the (R) exception does not reach
  it. It therefore **needs no key at all**.
- **`LIMITED_DATA_SET_PROFILE`**: a **research / longitudinal** preset that **date-shifts** dates
  (interval-preserving) rather than generalizing them, and that keeps a **consistent keyed surrogate**
  for the medical record, health plan beneficiary and account numbers so cross-document linkage
  survives. It is deliberately **less protective than Safe Harbor** on both counts: a shifted-but-real
  date is still "an element of a date," and a keyed surrogate is a re-identification code anyone
  holding the key can reverse the linkage of. Therefore it is **not** labelled `safe-harbor`, it
  **requires** a keyed per-patient context, and it produces an **Expert-Determination-supporting**
  dataset, **not** a certified de-identification, and **not**, on its own, a HIPAA §164.514(e) Limited
  Data Set. Disclosing an actual Limited Data Set additionally requires a **Data Use Agreement**, which
  is the consumer's responsibility. Every keyed surrogate it emits is flagged `reidentificationCode`
  in the manifest and listed in the support report's keyed-surrogate residual inventory.

  It also **keeps unchanged** the three classes §164.514(e)(2) permits and Safe Harbor does not: the
  **encounter dates** (admission / discharge / service / diagnosis), the **encounter and order
  identifiers** (a `VN`-typed or untyped visit number, and the placer and filler order numbers), and
  the **named parts of a postal address**. That list of sixteen direct identifiers names no date and
  has no catch-all, which is exactly why the first two survive here and are removed under Safe Harbor.
  It **does** name medical record, account and social security numbers, so a PV1-19 typed as one of
  those is transformed here too. Every one is still **recorded** as a `DEID_RESIDUAL_RETAINED` residual
  and appears in the support report's inventory, so nothing is kept silently.

<a id="limited-data-set-geography"></a>

### What a limited data set keeps of an address, and what it still removes

§164.514(e)(2)(ii) is the **only partial exclusion** in the list of sixteen. It removes "postal address
information, **other than town or city, State, and zip code**", so under the
`limited-data-set-geography` retention class those three named parts survive and **everything else in
the address does not**: the street address, any second address line, the county or parish, the census
tract or other geographic designation, and the country. A county-code field and a birth place are
removed under every profile, because the clause names neither.

- **The zip code is kept WHOLE.** The initial-three-digits rule, and the `000` substitution for a
  prefix whose area has 20,000 people or fewer, are §164.514(b)(2)(i)(B): **Safe Harbor's** rule, with
  no (e)(2) counterpart. A restricted-prefix ZIP is therefore carried in full under this class, and is
  still reduced to `000` under Safe Harbor, which this class does not touch.
- **The allowance follows the party list.** (e)(2) opens on "the individual or of relatives, employers,
  or household members", so the patient, the next of kin, the guarantor, the guarantor's employer and
  the insured are all treated alike.
- **Every kept part is recorded**, as a `DEID_RESIDUAL_RETAINED` residual located to its own field,
  repetition and component, so it reaches the determiner's residual inventory.
- **Nothing widens by omission.** A profile or an options bag that does not name the class reduces
  every address exactly as it always did. Options built by hand from a profile's `policy` alone keep
  nothing, and a profile derived from the Safe Harbor base may not add the class at all.
- **It fails closed.** An address whose zip code is not a whole zip code is not partially kept: the
  locus falls back to the Safe Harbor generalization, which drops the whole address when it cannot read
  a prefix. No residual is recorded for anything that was not actually retained.
- **The geographic allowance is honoured by the HL7 v2 pass alone.** The **C-CDA, FHIR, X12, NCPDP and
  DICOM** adapters do not read retention classes at all, so under those five an address is reduced
  exactly as Safe Harbor reduces it. They remain stricter, and that is the safe direction, but one
  profile therefore means something narrower for those five formats than it does for HL7 v2.
- **A profile that DECLARES the `limited-data-set` standard is checked against the regulation.** A
  retention class beyond those (e)(2) permits is a fatal `DEID_PROFILE_INVALID` naming the class, both
  where the profile becomes engine options and where it is used as a derivation base.

**On dates the preset is deliberately STRICTER than the regulation.** §164.514(e)(2) names no date, so
a limited data set may carry dates at full precision. This preset date-shifts them anyway. Removing
more than the regulation requires is always lawful; the alternative would hand every existing consumer
real patient dates on an upgrade, and no re-run undoes a disclosure.

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
