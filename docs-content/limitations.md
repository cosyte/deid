---
id: limitations
title: Known limitations and honesty
sidebar_label: Known limitations
description: "What @cosyte/deid does and does not do, what fails closed and what that does not cover, the Limited Data Set caveat, and free text."
---

# Known limitations and honesty

**`@cosyte/deid` transforms a healthcare document per a configured de-identification policy (Safe
Harbor by default) and emits a value-free manifest of what it acted on. It never labels output
"de-identified," and it never certifies HIPAA de-identification.** Safe Harbor is implemented
mechanically; **Expert Determination is _supported_, never _rendered_.** The structured-field core is
the guarantee; **free text is blocked by default**; **DICOM is metadata-only** (burned-in pixels are
flagged, not cleaned). On an unrecognized structure, an un-locatable identifier, an unknown segment
or extension, or a free-text blob, the library blocks or removes, never passing a value through as
"probably safe."

Read this page before you rely on the library for anything that leaves your control.
[What the caller still owns](./what-the-caller-still-owns.md) lists, in one place, the duties this
page leaves with you, and a table per adapter of what it does not cover.

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

| It does **not**…                                                        | Because…                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Certify HIPAA de-identification                                         | The library **transforms and evidences**; it never certifies. Output is _"Safe-Harbor-transformed per the configured policy,"_ never _"de-identified."_                                                                                                                                                                                                                                                                    |
| Discharge the §164.514(b)(2)(ii) **actual-knowledge** clause            | That is an organizational judgment about what a recipient knows: the library surfaces the residual (kept year, safe-3-digit ZIP) so a human can apply it, but cannot make it.                                                                                                                                                                                                                                              |
| Render or certify **Expert Determination** (§164.514(b)(1))             | _"The risk is very small"_ is a qualified statistician's contextual judgment about a dataset **and its recipient**. The [ED support report](#expert-determination) emits value-free facts as **input**; `determination` is always `null` and it computes no risk score.                                                                                                                                                    |
| De-identify **free text / narrative**                                   | Free-text loci (HL7 OBX-5/NTE, C-CDA narrative `<text>`, FHIR notes/`div`, X12 MSG/NTE, NCPDP free text) are **blocked by default**. A [BYO redactor](#free-text) is **consumer-asserted**, never the library's guarantee; a naive built-in regex scrub is deliberately **refused** as a false-safety hazard.                                                                                                              |
| Clean **DICOM burned-in pixels** or full-face images (category Q)       | v1 is **metadata-only** (delegated PS3.15 Annex E). Burned-in annotation raises `DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED` and `burnedInAnnotationHazard`; pixel decode is a future `@cosyte/dicom-pixel`. The two pixel options of CID 7050 are declared **withheld** on the result and never written to `(0012,0064)`. **Do not release an image on metadata alone.**                                                      |
| Guarantee **DICOM replacement-UID consistency across calls** by default | Referential integrity of replacement UIDs is guaranteed **only within a single call** unless the caller supplies a shared `uidMap`, which then extends it to every call sharing that cache. The declared scope is on the result (`uidReferentialIntegrity.scope`), so it is read rather than inferred.                                                                                                                     |
| Handle **NCPDP SCRIPT** ePrescribing                                    | **Refused, not deferred in prose.** The current parser surface (lossy serialize + an address-less `Patient` model) cannot support a faithful structural de-id, so an NCPDP entry point handed a SCRIPT document raises a typed `DEID_FORMAT_UNSUPPORTED` naming the format and the parser-surface reason and returns **no** document, manifest or partial output at all. NCPDP **Telecom** is supported and is unaffected. |
| Guarantee against a determined re-identification attack                 | De-identification reduces risk to the regulatory bar; it is not a cryptographic guarantee. **Key custody is the consumer's**: a leaked HMAC key or date-shift offset re-identifies.                                                                                                                                                                                                                                        |
| Do anything the manifest does not record                                | If it is not in the manifest, the library did not do it. The manifest is the complete, value-free audit.                                                                                                                                                                                                                                                                                                                   |

## Fail-closed posture

Uniquely, harm here runs in **two** directions and both are guarded:

- **Under-scrub (a leak):** a missed PHI element leaves a patient identifiable. The reflex is the
  inverse of a parser's Postel's-Law liberality: **when in doubt, block/remove.**
- **Over-scrub (destroyed meaning):** a clinical value wrongly treated as an identifier destroys data a
  clinician relies on. Clinical-kind loci are **retained untouched**.

A keyed transform with no key is a **fatal** `DEID_NO_KEY`, never a silent unkeyed fallback (an
unkeyed hash of an identifier is re-identifiable). A key or date-shift seed shorter than 16 bytes
(128 bits) is a fatal `DEID_KEY_TOO_SHORT`. A context configured with `maxShiftDays: 0` is a
fatal `DEID_CONTEXT_INVALID`, a zero-bound shift is a guaranteed no-op, i.e. the original real dates.

<a id="retained-loci"></a>

## What is retained, and what "fails closed" does NOT cover

**Fail-closed is a rule about _structures_, not about every field.** An unrecognized segment, resource,
loop, or extension is blocked. But a segment on a format's **retain-list** is passed through, and
retaining the structure is not the same as auditing every field inside it. Read this before you assume
an unmapped position was removed.

Two things follow, and the second is the one that surprises people:

- **The identifying loci inside retained HL7 v2 structures are carved back out and acted on.** Under a
  Safe-Harbor-labeled policy the admit (PV1-44), discharge (PV1-45), observation (OBR-7) and diagnosis
  (DG1-5) dates are reduced to their **year**, and the visit number (PV1-19) with the placer and filler order numbers (OBR-2/3, ORC-2/3) are
  **blocked** as the (R) catch-all: the value does not reach the output, and the manifest records a
  block (`DEID_LOCUS_BLOCKED`), not a removal. §164.514(b)(2)(i)(C) names admission and discharge
  dates in the regulation text itself.
- **PV1-19 is routed by its CX-5 identifier-type code**, like PID-3. A `VN`-typed or untyped visit
  number is the encounter identifier and is blocked as the (R) catch-all; an `MR`/`AN`/`SS`-typed one is
  handled as the medical record / account / social security number it actually is, so it is
  **transformed under both profiles and is never retained** (§164.514(e)(2) names all three). A kept
  visit number is therefore only ever one the wire did not type as something stronger.
- **Dates inside retained HL7 v2 segments are acted on and recorded.** Every position the **HL7
  v2.5.1** segment definitions type as a date or date/time, in any segment whose bytes the pass can
  hand through, is reduced to its year under a Safe-Harbor-named policy, shifted under a date-shift
  policy, or blocked when the configured transform cannot read the value, and **every one of those
  outcomes is in the manifest** and therefore in the support report. That covers the timestamps in EVN,
  PV2, PR1, RXA, RXD, FT1, TXA, and SPM, the order dates in ORC and OBR that no earlier limitation
  named, the date components of a date range or other composite (a specimen collection range, an
  order's quantity/timing, a discharged-to location's effective date), an OBX-5 the message itself
  types as a date, and the **OBX segment's own** reference-range, observation, and analysis timestamps
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
  timestamp, a license expiry), because acting on those dates while leaving the names they qualify
  would record half a position. **Do not read the named loci above as the complete set of what a
  retained structure can carry.** If your threat model includes these, filter them yourself.

- **Every one of those positions IS counted and located, as an unexamined residual.** A value-bearing
  position inside a structure the pass hands through that no locus rule names is recorded on
  `result.unexaminedResiduals` with its **structural locus**, a **count**, and the fact that nothing
  examined it. It carries no value, no key, and no offset, exactly like the manifest,
  and it is a separate list precisely so that a position nothing looked at can never be mistaken for a
  residual of a value the pass did examine. All six adapters produce it: the fields of a retained HL7 v2
  segment, the entry dates / entry ids / in-entry performers and family-history demographics inside a
  retained C-CDA clinical body, the codes and statuses a FHIR walk descends past, the fields of a
  retained NCPDP segment and its fixed header, and every DICOM attribute the delegated Annex E report
  does not account for, nested sequence items included. **X12 leaves none:** every element it hands
  through, envelope included, is kept only when it has the shape its position expects and is removed
  and recorded otherwise, so its list is always a measured zero. The
  [X12 guide](./guides-x12.md#every-position-is-decided) says what each position expects.

- **The envelope around a document is counted too, in every format that has one.** Retaining a
  _structure_ names no position inside it, so the positions of an HL7 v2 `MSH`, of a CDA document
  envelope, and of the DICOM Part 10 File Meta group `(0002,xxxx)` are all enumerated and reported (the
  X12 interchange and functional-group envelope is decided instead, like the rest of X12). Read those
  counts as the measurement they are: control numbers, trading-partner ids, timestamps, and transfer
  syntaxes sit there, and the number says only that no rule examined them.

- **The unit is the position, never the element it sits on.** A rule that reaches one position says
  nothing about the ones beside it: a C-CDA `<telecom use="HP" value="...">` has its `@value` removed
  and its `@use` handed through, and the `@use` is counted. That is why the inventory can list a
  coordinate on an element the manifest also names.

- **A position is wherever the format lets a value sit, not only where a value usually sits.** The
  enumeration is derived from what each parser's model can carry, so it reaches the places a value is
  easy to overlook: XML character data delivered as a **CDATA section** rather than as text, and the
  **comments** and **processing instructions** an XML document is re-serialized with, each counted at
  its own carrier's coordinate; and whatever a **partly** rewritten structure keeps, such as the state
  and country of a generalized address, which are re-emitted with their extensions, bar what the pass
  blocked or replaced there (in FHIR, every value and unknown key of an extension on their
  `_`-sibling, every element id, which is replaced, and a part that is not a string, which is blocked
  whole).

- **What is removed is not counted, and that is the point of the number.** The inventory measures what
  the pass _hands through_, so a position it deletes (an address line, a blocked narrative and every
  carrier inside one, a FHIR primitive's extension metadata) does not appear: counting one would report
  an exposure that does not exist. The count is a measurement of what left the pass untouched.

- **Counting is not removal, and it is not an allegation.** Nothing is scrubbed, generalized, blocked,
  or otherwise transformed on account of the count: what to do about a measured residual is a separate
  decision, and the mirror risk of acting on it blindly is over-removal, which destroys clinical
  meaning. A position no rule examined also has **no established Safe Harbor category**, so it is
  attributed to none of the 18 and moves no category total: a clinical code, a dose unit, and an order
  status all sit at positions like these.

- **Two fail-safes, because a count nobody can qualify is worse than no count.** A position whose
  structural locus cannot be expressed is **still counted**, recorded under a withheld locus token, and
  flagged, so losing the "where" never also loses the "how many". And a structure whose value-bearing
  positions cannot be enumerated **fails the pass** with a typed `DEID_POSITIONS_UNENUMERABLE` error
  naming the structure, rather than emitting a zero or a partial count that a reader would take for a
  clearance.

- **An X12 segment the pass does not recognize is removed whole, not counted.** Its identifier may be a
  value that an extra segment terminator or a missing separator put there, so it is removed with the
  segment's other values, each recorded under a withheld segment id, and the transaction set's `SE-01`
  counts it out. A real X12 segment the pass has no shape for (`PLB`, `TS3`, `TS2`, the 837 `CUR`,
  `CR5` to `CR8`, `FRM`, `SV4` and `RDM`, the 834 member detail segments beyond `INS` / `HD`) is removed
  the same way, which over-removes it rather than passing it through.

- **An X12 code no rule routes on keeps its place, and the value behind it is removed.** A `REF`
  qualifier on neither `REF` table, an entity code on no role table, and an `HI` qualifier with no code
  shape the adapter knows are real 005010 codes, so they stay; the reference value, the party's name
  and identifier, or the `HI` code they qualify is removed and recorded, because the code alone does
  not say whose it is. That over-removes, for example, the 837 prescription number (`REF*XZ`) and the
  837I other operating physician (`NM1*ZZ`).

- **An X12 value shifted past an empty required position is removed with everything after it.** A
  number shape cannot tell a shifted date or account number from an amount, so the adapter treats a
  position the TR3 of the transaction set requires, or one a qualifier implies, left empty before a
  later value as a shift, and removes and records every value after it. That over-removes a malformed
  segment that only omits a required position (the x12 library's 837D sample omits `SV3-02`, so its
  place of service and count go too), rather than keep a value it cannot place.
- **An X12 value that fails the shape of a required or narrow position takes its neighbours with it.**
  A value that is no code, no date or no valid composite at a required position, or at any code, date
  or composite position, shows a separator was added or left out. Every value after it is removed, and
  so is every value back to the last code, date or composite before it that held. That over-removes a
  segment with one bad code: the x12 library's 837I samples write the three-digit bill type `111` in
  `CLM-05-1`, which takes the claim's charge and its `Y` / `A` / `Y` / `Y` codes; an `HI` entry written
  with a decimal point (`J45.50`) takes the entries after it; an unknown `CARC` or `HD-01` takes the
  amounts after it; and an unknown claim status category takes the payment method and the status
  composites after it. A weight in `PAT-07` / `08` after a relationship code with
  no date of death between them is removed too, because two extra separators put a date of death there.
- **An X12 `STC` keeps only its codes.** A claim status keeps its status composites (`STC-01`, `-10`,
  `-11`) and its payment method (`STC-07`). Its dates, amounts, action code, check or EFT trace number
  and message are removed and recorded wherever they sit, even in a well-formed 277 or 277CA, where a
  Safe-Harbor-named policy would otherwise keep each date's year. A separator left out between an
  amount and the adjudication date after it moves the date into the amount, where it passes as a
  number, and when the date is the last element nothing after it can fail and show the shift, so no date
  or amount in `STC` can be placed. The claim status category and status codes are checked against the
  form of their external code sources, not the published lists themselves.
- **Some X12 shifts are not detectable.** A shift that leaves no required or implied position empty and
  puts no value where a narrow shape refuses it, such as a value code's amount where another number
  belongs, is kept. So are two separator errors that cancel out, one left out and one added further
  along, when every value between them still fits its position.

- **X12 bytes after the `IEA` are not counted; they are removed.** They are neither a segment nor a
  loop, and they commonly hold a whole second interchange the parser did not decode, so no rule can
  decide them. Bytes there that are not blank are removed and recorded at `trailingBytes`; a blank
  line after the last terminator stays.

- **The employer is a Safe Harbor subject, and two employer surfaces still are not reached.**
  §164.514(b)(2)(i) removes the identifiers of the individual "or of relatives, **employers**, or
  household members", so an X12 party whose entity-identifier code is `36` (or `P5`, or `PR` in an
  `820` premium payment, where the premium payer is the members' employer) and the employer positions
  the HL7 v2.5.1 financial segments type (GT1-16/17/18/19/29, IN1-10/11, IN2-3/49/50/64, and IN2-70 as
  an organization) are acted on and recorded. What that does **not** reach: **an employer named only in
  free text**, which is the consumer's redactor's business like any other prose; and **an employer
  carried as a separate `Organization` resource in a FHIR graph**, where no role is typed at the
  position and the reference `display` that names it is blocked rather than classified. The guarantor's
  employer organization name at **GT1-51** is likewise unreached: it is not among the positions this
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
  one FHIR R4 defines on `HumanName`, at least one of them is a marker property (`family`, `given`,
  `prefix`, `suffix`), and that marker holds **the exact value shape R4 gives it**: `family` a single
  string, the other three repeating. An `Address` the same way, with `line` repeating and `city`,
  `district`, `state`, `postalCode`, and `country` single. Reading the shape per marker is what
  separates a marker from an R4 element that merely shares its name, and R4 supplies two such
  collisions: `country`, which every colliding element types as a `CodeableConcept` where an address
  types a string, and `prefix`, which `Questionnaire.item`, `PlanDefinition.action`, and
  `RequestGroup.action` each type as a single string where a name types it repeating. Both of the
  latter two backbones make **every** child optional, so a conformant instance can carry nothing but
  `prefix`, and the shape is the only thing that tells it from a person's name. A newly reached element
  the pass cannot read faithfully, an `Address` whose `postalCode` is not a whole zip code or an
  unexpected shape at a part the reduction would keep, is **removed whole** and recorded, never partly
  retained. So is **any** complex the classifier cannot pin down at an element name R4 **types** as one
  of the two datatypes (`name`, `address`, a choice-type `locationAddress`, an open `valueAddress` /
  `valueHumanName`, the `HumanName` arms of the `defaultValue[x]`, `fixed[x]` and `pattern[x]`
  choices), whether nothing is left to key on, a property R4 does not define sits beside a
  `family` or a `line`, or every property it carries is foreign to both datatypes. The test is whether
  the pass can read what the standard promised at that position, not which keys are present, so an
  unrecognized sibling never unblocks an element that was already unreadable. Two conformant R4
  backbones share one of those element names, `MedicinalProduct.name` and `SubstanceSpecification.name`,
  and both are excluded positively: the property R4 makes `1..1` on each, plus that backbone's own
  closed property set. A plain string (or any other primitive) at one of those names is blocked whole
  as well, except where R4 itself types the element as a string that names no person: `name`
  (`Organization.name`, `Location.name`) and the two `address` elements R4 types as a url, an
  `Endpoint`'s own and a `CapabilityStatement` messaging endpoint's, which are left alone. A
  contact's name is not one of them. A string where R4 types a `HumanName`, at
  `Organization.contact.name` or `InsurancePlan.contact.name`, is blocked like any other. The `name`
  of a `ContactDetail` (the `contact`, `author`, `editor`, `endorser` and `reviewer` of the
  conformance and knowledge resources, and the `ContactDetail` arms of an open `value[x]`) is a
  string R4 documents as the name of the individual to contact, so it is removed as a name, and any
  other shape there is blocked. A contact sent as a bare string is blocked whole. The one
  other string R4 puts at `address`, `AuditEvent.agent.network.address`, holds a machine name, an IP
  address or a phone number, so it is blocked.

- **Three FHIR surfaces this release still does not reach**, because no person is typed at the
  position. A **`ContactPoint` outside a person resource**: a phone or an email on an `Organization`,
  a `Location`, or an `Endpoint` is passed through, because widening to telecom would put a payer's or a
  facility's own switchboard number in scope, which the HL7 v2 pass deliberately keeps (`IN1-7`, the
  insurer's own phone, is untouched there). An **organization's own `name`**: a plain string, never a
  `HumanName`, and administrative content rather than a person's identity. And the **individual's
  employer carried as a separate `Organization` resource**, per the bullet above. All three are passed
  through, and all three are counted as unexamined residual positions like anything else no rule
  names. Two more that earlier releases named are now closed by the block on [keys R4 does not
  define](#fhir-unknown-keys): a name or an address at an element name R4 does not type as one, and
  one at a property of a person resource the demographic map does not list (a vendor
  `Patient.alias`). A `family` or a `line` is a key R4 does not define at such a position, so it is
  blocked, and `Patient.alias` is blocked whole. What still reaches the output there is content whose
  every key R4 defines at its position, which is the conformant element itself (`{ prefix }` on a
  `RequestGroup.action`, a numbered step and not a person), counted as unexamined like any other
  value no rule names.

<a id="fhir-resource-ids"></a>

- **FHIR resource ids are replaced; what that does not reach.** Every resource's logical `id` and the
  id in every `Bundle.entry.fullUrl`, `Reference.reference`, `Bundle.entry.request.url` and
  `Bundle.entry.response.location` is replaced by the same value throughout one call, recorded as a
  medical record number, so every reference still resolves (see
  [the FHIR guide](./guides-fhir.md#resource-ids-and-references)). A literal the pass cannot read,
  and an absolute reference to a server no `fullUrl` in the input names, is removed, and so is every
  conditional header of a `Bundle.entry.request` (`ifNoneExist`, `ifMatch`, `ifNoneMatch`), which can
  carry an identifier in a search string or a version id in an entity tag. A transaction Bundle sent
  to a server after the pass therefore creates its resources unconditionally: where the input asked
  the server to create a resource only if none matched (`ifNoneExist`), the output asks it to create
  one every time, so loading the output into a server that already holds the resources can create
  duplicates. Four things are
  not covered. The **server base** of an absolute `fullUrl`, and of an absolute reference to that same
  server, is kept verbatim: it names the server, and a base that carries anything else carries it out.
  An **id written anywhere else** is passed through and counted as an unexamined position:
  `meta.versionId`, `meta.source`, a `Bundle.link.url` (a search link can carry a query on an
  identifier), an `Attachment.url`, and any other uri, url or canonical. An element's own `id` is
  replaced, as the next item says. Under
  the Safe Harbor default the stand-ins are **per call**, so the same resource transformed in two
  calls gets two unrelated ids and one call's references do not resolve in another call's output;
  linkage across calls needs a keyed policy, which does not claim Safe Harbor. And a removed
  reference leaves the rest of its `Reference` in place, an empty one as `{}`.

<a id="fhir-unknown-keys"></a>

- **FHIR keys R4 does not define: blocked everywhere.** A key R4 does not define where it sits is
  text a sender chose, so it is blocked whole, whatever it holds, at any depth of any resource or
  datatype: at a resource's top level (`Observation.zzNote`), in a datatype (`Coding`, `Identifier`,
  `Meta`, `Narrative`, a `Reference`), in a datatype inside one, in a backbone element, in a contained
  resource and in a `Bundle` entry and its request, on person, clinical and infrastructure resources
  alike. It is recorded at its own position with no value, under every profile and with every option
  at its default, and it is no longer counted as an unexamined residual. The row does not repeat the
  key either, since a name or an identifier can be spelled as one: `<withheld>` and the key's place
  among its parent's keys stand in for it, so `Observation.code.coding[0].zzNote`, the third key of
  its `Coding`, is recorded at `Observation.code.coding[0].<withheld>[2]`. A row at a key R4 defines
  keeps its name. The names come from the R4 (4.0.1) definitions of every resource and datatype, a choice
  element under each concrete name it is written as (`valueQuantity`), with what it holds and
  whether it repeats. A key inside a reduced `Address` that the `Address` datatype does not define is
  removed by the reduction and recorded as well. No option keeps such a key: a profile that adds
  elements outside an extension is not conformant R4, and its content is blocked. This changes the
  output for any input that carries such a key: the key is gone where it used to be passed through.

  The same holds for a value of a shape R4 does not define where it sits, read from the same
  definitions. That includes a primitive of another JSON type than the one R4 gives it, at every
  depth and in every choice element: a number or a boolean where R4 puts a string
  (`"valueString": 987654321`, a `CodeableConcept.text` of `42`, an element or resource `id` held as a
  number), and a string where R4 puts a boolean, an integer or a decimal (`"valueBoolean": "yes"`,
  `Bundle.total` as `"3"`, a `Quantity.value` as `"5"`), or another JSON type there. R4 writes a
  `boolean` as a JSON boolean, an `integer`, a `decimal`, a `positiveInt` and an `unsignedInt` as a
  JSON number, and every other primitive as a JSON string. Where no other rule read it, such a value
  used to be passed through with no row at all. Then a string, a number, a boolean or a `null` where a structure belongs (a
  `"subject": "..."` where R4 puts a `Reference`, a `"contained": ["..."]`, a `Bundle` entry's
  `"resource": "..."`), a structure where a primitive belongs (`"status": { ... }`, a `HumanName`
  sent where R4 puts a string), a list where R4 puts one value (`"code": [ ... ]`), one value where
  R4 puts a list (`"identifier": { ... }`, `"note": { ... }`), and a `null` that pads no repeating
  primitive. Each is blocked whole at its own locus (`Observation.subject`,
  `Patient.generalPractitioner[0]`), with no value, whatever it holds, under every profile. Such a
  value used to be passed through and counted, or read item by item by the rule for the element; a
  caller who sent a single object where R4 puts a list now loses it, which is a loss of utility on a
  document that is not conformant R4, not a leak.

  A resource whose `resourceType` is missing or is not one R4 defines (a name R4 does not give a
  resource, an abstract `Resource` or `DomainResource`, a datatype's name) is removed whole, wherever
  it sits: at the root the output is `{}`, and contained or in a `Bundle` entry it is gone from its
  list. Its type and every field it carries (`implicitRules`, `language`, `meta.source` among them)
  are text a sender chose. It gets one blocked row at its own locus with no value, and at the root
  that locus is `<withheld>`, so the type the sender wrote does not reach the manifest either.

  Inside an `extension` or a `modifierExtension`, at any depth and on every resource, only the `url`,
  the element `id` (replaced, as every element id is) and the nested extensions are kept. Every other
  key is blocked and recorded at its own locus, with no value: a `value[x]`
  (`Observation.extension[0].valueString`), and equally a key R4 does not give an extension (`note`,
  `comment`, any name), whatever it holds, whose row names its position and not the key
  (`Observation.extension[0].<withheld>[1]`). A `url` or an `id` that is not a string (a number, a boolean, an object, a list) is
  blocked the same way. An extension on a primitive's `_`-sibling is blocked like this on the
  `state` or `country` an `Address` keeps; every other one is removed with the primitive's metadata,
  and each one removed that way is recorded as blocked at its own locus
  (`Patient._birthDate.extension[0]`), with no value, so a manifest reader sees the drop. A
  primitive the pass removes takes its extensions with it, and its own row covers them. That costs a
  row for each such extension and nothing else: none of the committed FHIR fixtures or the benchmark
  documents carries one, so their manifests are unchanged, and a document that does carry them (a
  birth time on `_birthDate`, a data-absent reason on a coding's `_code`) gets one more row for each
  (`test/fhir/row-cost.test.ts` pins the counts). A `state` or `country` an `Address` keeps that is not a string (an
  object, a list, a number, a boolean) is blocked whole and recorded at its locus
  (`Patient.address.state`) on a person resource, and a swept `Address` carrying one is removed whole.
  A key on a `_`-sibling itself other than `id` and `extension` is not read by `@cosyte/fhir` and does
  not reach the output, and it gets no manifest row, since the parsed resource does not carry it.

<a id="fhir-sibling-text"></a>

- **A FHIR `_`-sibling that is not an object: blocked everywhere.** FHIR JSON gives a primitive's
  `_`-sibling an object holding its `id` and `extension`. When one arrives as anything else (a string,
  a number, a boolean or a `null` in `_status`, or a list in the slot of a repeating primitive),
  `@cosyte/fhir` keeps its text so that its writer can hand it back. Every primitive the pass writes is
  built from its value, the replacement of its element `id` and the extensions the pass kept, and
  nothing else, so that
  text never reaches the output. It is recorded as a block at the `_`-sibling's own locus
  (`Observation._status`, `Patient.address._state`, `Observation.extension[0]._url`) with no value,
  on every resource and at every depth: beside a code, in an extension, a modifier extension or a
  nested extension, on a part an `Address` keeps and on an extension on one, in a contained resource
  and in a `Bundle` entry, and in the `patient-animal` extension with `keepPatientAnimal` on or off.
  Beside a primitive the pass removes, the text goes with it and the primitive's own row covers it. A
  list beside a single value is refused by `@cosyte/fhir` (`PRIMITIVE_EXTENSION_MISALIGNED`) before
  the pass runs.

<a id="fhir-element-ids"></a>

- **A FHIR element `id` is replaced, never kept.** R4 lets every element carry an `id`, gives it no
  meaning beyond the document, and puts no limit on what a sender writes there, so the pass reads it as
  free text. Every element id the output keeps is replaced, on every resource and at every depth: the
  `id` of a datatype (`Observation.code.id`), a `Coding`, a backbone element, a `Bundle.entry`, an
  extension and a nested extension, and a primitive's `_`-sibling `id` (`Observation._status.id`, the
  `_state.id` of a part an address keeps). An id inside something the pass blocks whole is not
  replaced but removed with it, under one row for the whole: under a key R4 does not define, in a
  value of a shape R4 does not define where it sits (a structure where R4 puts a primitive), and in a
  resource of a type R4 does not define. The replacement is the one a resource's logical id gets,
  under the same rule and in the same table: the same id is replaced by the same value throughout one
  call, a per-call sequence number under Safe Harbor and a keyed surrogate, flagged as a
  re-identification code, under a policy that pseudonymizes or hashes the medical record number
  category. Each has a manifest row at its locus (`Observation.code.id`), with no value. A policy that
  neither withholds nor keys that category removes every element id instead. An element id that is
  not a string (an object, a list, a number, a boolean) is removed and recorded.

  We replace rather than remove so that a link to an element id still resolves: the `actionId` of a
  `relatedAction` in a `RequestGroup` or a `PlanDefinition`, at any depth of nested actions, is
  replaced by the same value as the action it names. No other element is read as a link to an
  element id, so a reference to one written anywhere else no longer resolves, and keeps the id it
  named: a `StructureDefinition`'s `contentReference`, the fixture ids a `TestScript` names, and a
  fragment in a narrative or an extension (both of which the pass already removes). A reader that
  relied on an element id's text (a slice name inside an element id) loses it.

Vendor-proprietary loci absent from public specs are deferred, **not invented**: a quirk is encoded
only when a real document, its identifiers removed, grounds it.

<a id="generated-leak-property"></a>

### What the generated leak property still finds kept

Our test suite carries a generated leak property for each of the six adapters: it writes tagged
synthetic values at generated positions and in generated shapes (a plain string where a structure is
expected, an extra repetition or component, a value in a code or qualifier position, a nested
structure) and checks that each one is removed, or is counted on `unexaminedResiduals` at its own
position, read back from where the parsed input holds it. The values come in four forms: an
11-character run of capitals and digits, and three short ones of letters only, shaped like a short
code (`ZQVABA`), a surname (`Zqvaba`) and a hyphenated name (`Zqv-Aba`), because a value kept on its
shape is found only by a value of that shape. The cases below are values it finds kept that are
neither removed nor counted. Each is a value kept on purpose because it has the shape its position
expects, so a value that has that shape is kept whatever it is. Each is pinned by a test that reads the
shape from the input and fails the day the keep stops being true.

**Identifiers that survive, and why.** Every case below is an identifier, or can hold one, and leaves
in the output as it arrived:

- an HL7 v2 identifier's assigning authority (CX.4), counted;
- an X12 originating company id and its supplemental code (`TRN-03`, `TRN-04`), a code-shaped
  procedure code, a provider's or payer's own name and numbers, and the claim, authorization,
  referral and classification numbers listed below, none of them counted;
- a C-CDA header code and display name and the assigning-authority root of an `<id>` that has an
  extension, not counted, and the document's own `id` and `setId` when they have an extension,
  counted, each unless its root is one the header replaced;
- a C-CDA clinical body `<id>`, counted, except that a root the header replaced is replaced there,
  with an extension or without, and only the extension is kept and counted;
- a FHIR person resource's `language` that is a two-letter code on the list, written in small letters
  (`li`, `bo` and `ng` are languages, and as surnames written that way they are kept);
- an NCPDP Telecom other payer id of five or six digits.

Each is kept because removing it would remove a value the format needs that is not the individual's
in a conforming document (an organization's id, a code, a clinical record's own id), and because the
pass cannot tell such a value from an identifier that happens to have the same shape. A caller who
needs any of them gone must remove it after the pass.

- **HL7 v2:** none. An identifier's assigning authority (CX.4) is kept as it arrived, and it is
  counted as an unexamined residual at its own component.
- **X12:** a trace number (`TRN-02`) is assigned per transaction, so in an eligibility, claim status
  or services review inquiry it is assigned per patient. It is **replaced**: under the Safe Harbor
  default by a sequence number counted in the order the distinct trace numbers are met in one call,
  the same one for the same trace number, so a trace a response echoes in the same interchange still
  matches the request's. It is computed from nothing about the trace number and means nothing outside
  the call, so a response transformed in a separate call no longer matches its request. A `TRN` with
  no trace type code (`TRN-01`) loses everything after it instead. The originating company id and its
  supplemental code (`TRN-03`, `TRN-04`) are kept when each is one value of printable text of the
  element's length; a value holding the component or the repetition separator is no single value and
  is removed, here and at every position kept as a bounded run of printable text. The repetition
  separator is `ISA-11` from version 00402 on. Before it (`ISA-12` of `00401` or earlier), `ISA-11` is
  the standards identifier `U` and the interchange has no repetition separator, so a `U` in a value is
  a letter and no reason to remove it. Where `ISA-12` cannot be read as a version, or `ISA-11` is a
  punctuation character, `ISA-11` is still read as the separator. A procedure code (`SV1-01`, `SV2-02`, `SV3-01`) is kept when it has the shape its qualifier
  gives it, which for a qualifier with no published code shape is 1 to 48 letters and digits. And a
  party whose role keeps it (a provider, a service location) keeps its name and identifier elements as
  they arrived, a repetition inside its identifier included.
- **X12 claim, authorization, referral and classification numbers are kept, and each ties to one
  person's visit.** A `REF-02` under an administrative qualifier the adapter keeps is kept whatever it
  holds: the payer claim control and claim numbers (`F8`, `D9`, `1K`), the line item control numbers
  (`6R`, `FJ`), the prior authorization, referral, authorization and predetermination numbers (`G1`,
  `9F`, `BB`, `G3`), the repriced claim numbers (`9A`, `9C`), and the classification codes (`APC`,
  `1S`, `RB`) among them. None is a name or a member id, but each identifies one claim or one
  authorization, and so one person's visit, to anyone who holds the payer's or the provider's records.
  A caller who needs them gone must remove them after the pass.
- **An X12 party number is kept only under a party its role keeps.** A `REF` that names a party's own
  number (a state license `0B`, a tax id `TJ`, an `EI`, a National Provider Identifier `HPI`, the
  provider numbers `1A` to `1D`, `1G`, `1J`, `G2`, `N5`, `N7`, `D3`, `EW`, `X4`, `LU`, and the payer,
  payee, submitter, receiver and claim office numbers `2U`, `PQ`, `EO`, `EV`, `FY`) is kept only when
  the last `NM1` or `N1` before it in its section is a party whose role keeps it, such as a provider,
  and that names itself (a name or an identifier). A section starts at the transaction set, at every
  `HL`, at every `ENT` of an 820 (one entity's remittance detail), and at every member `INS` of an 834.
  After the individual, a relative, an employer, an unknown party, a provider `NM1` that names
  nothing, or no party in its section, it is removed and recorded. That over-removes a well-formed
  value the TR3 places before any party, such as the 835 receiver id (`REF*EV`) in the header.
- **C-CDA:** in the header, a coded element the allow-list recognizes (`administrativeGenderCode`,
  `maritalStatusCode` and the others) keeps its `@code` and its `@displayName` as they arrived, and a
  person-role `<id>` that has an extension keeps its `@root`, the assigning authority. An `<id>` with
  no extension, or an empty one, is identified by its root alone, so the root is **replaced**: in the
  header, and in the document's own `id` and `setId`, by a stand-in in the root's shape (an OID under
  `2.25`, a UUID, or a plain token), the same one for the same root throughout the document, so a
  `setId` that repeats the `id`, or an author named in two places, still match. A root the header
  replaced is replaced on every element that carries it as its `@root`, with an extension or
  without: a header `<id>`, the document's own `id` and `setId`, and a clinical body `<id>` take the
  same stand-in, and an extension beside it is decided as before (transformed in the header, kept and
  counted in the body and on the document's own ids). Any other body `<id>` is a clinical record's own
  id and is kept and counted, as the body always was; the document `id` and `setId` with an extension
  and a root the header did not replace are kept and counted too. What this does not reach: a root the
  header replaced that also appears inside another attribute (an `@extension`, a `reference/@value`)
  or in narrative text is not found there, and a root that only body `<id>`s carry, with no extension,
  is kept and counted rather than replaced. Before this, a header `<id>` with no extension was
  removed, which cut its links, and the same root beside an extension was kept.
- **FHIR:** a person resource's `language` is kept only as a language tag in canonical form whose
  primary subtag is one of the 184 two-letter ISO 639-1 codes the library lists: the code in small
  letters, then optionally a four-letter script (`Hant`) and a region (`US`, `419`). A short name such
  as `Smith` or `Mary-Ann`, a tag with a three-letter primary subtag (`haw`), a variant, an extension
  or a private-use part, and a tag in other casing (`EN-us`) are removed and recorded. A two-letter
  surname that is a language code and is written in small letters is kept.
- **NCPDP Telecom:** the other payer id (`340-7C`) is kept only as five or six digits, the form of a
  BIN (six digits) or an NAIC company code (five). Up to ten letters, digits, spaces and hyphens would
  keep a short name or a member id, so any other value is removed and recorded; that over-removes a
  conforming other payer id in another form, such as a Health Industry Number. The other payer
  processor control number (`MH`) has no format that tells a plan's routing code from a short name,
  so it is removed and recorded whatever it holds.
- **DICOM:** none in the shapes the property generates.

The property generates the shapes listed above and no others, so a clean run says nothing about a
shape it does not write.

<a id="ages-over-89"></a>

## Ages over 89: what is removed, and what is not

§164.514(b)(2)(i)(C) lets a date keep its year, except that every element of a date, the year
included, that is indicative of an age over 89 is aggregated into a single category of age 90 or
older. Under a policy that generalizes dates (the `safe-harbor` default), a **date of birth** whose
year shows such an age is therefore **removed**, and the manifest records it as
`DEID_CATEGORY_GENERALIZED` with the disposition `removed`, never as a `DEID_RESIDUAL_RETAINED`
residual. A birth year under that line keeps its year and its residual row exactly as before.

- **The aggregate is the absence of the year.** None of the six formats has a field beside the birth
  date that could carry a "90 or older" category: a `90+` written into the date itself would not be a
  valid date in any of them, and DICOM's own Patient's Age `(0010,1010)` is removed by the Basic
  Profile. So the field is emptied. A recipient who sees a date of birth with no year, where every
  other date kept its year, can read it as 90 or older, and nothing narrower than that.
- **Where it applies.** HL7 v2 `PID-7`, the next of kin's `NK1-16`, the guarantor's `GT1-8` and the
  insured's `IN1-18`, and an OBX date result whose `OBX-3` codes it as a birth date (LOINC `21112-8`);
  every C-CDA `<birthTime>`, in the header or in the clinical body (a relative's in a family history),
  a bound of one given as an interval included; FHIR `birthDate` and `FamilyMemberHistory.bornDate`
  (each year-only included), each bound of `FamilyMemberHistory.bornPeriod`, `bornString` read for
  its leading year (and blocked when it has none), and an `Observation.valueDateTime` coded `21112-8`;
  X12 `DMG-02`; NCPDP Telecom `304-C4`. DICOM `(0010,0030)` Patient's Birth Date is emptied for
  everyone by the delegated Annex E Basic Profile, so no year survives there to aggregate. A date that
  is not a date of birth (a death date, a service date) keeps its year however old.
- **The reference date is the year the pass runs.** The age is measured against the UTC year of the
  call, not against a date in the document (`MSH-7`, `ISA-09`, the C-CDA `effectiveTime`, the NCPDP
  date of service). A document's date is earlier than the call in every ordinary case, so measuring
  from it would understate the age the person has when the output is released. It follows that the
  same input can give different output in a later year: a birth year that is 89 years back today is
  removed once the calendar turns. Release output soon after the pass, or run the pass again.
- **The comparison is by year alone.** A year 90 or more years before the year of the call is removed,
  so a person who turns 90 in that year is aggregated whether or not the birthday has passed. The year
  is all the output keeps, and it cannot say which side of the birthday the person is on.
- **The generic core needs the marker.** On the root entry, set `dateOfBirth: true` on a `date` locus
  for the engine to apply the rule; a locus without it keeps its year however old. A policy that
  date-shifts or retains dates does not aggregate either: the rule is part of the year generalization.
- **A removed C-CDA `birthTime` carries `nullFlavor="MSK"`.** The `value` attribute is dropped and
  `nullFlavor="MSK"` (masked: the sender has the value and withholds it) is written in its place, so
  the element reads `<birthTime nullFlavor="MSK"/>`, on a bound of an interval as on the element. A
  date that is not a date of birth and that the pass blocks is still written with no `value` and no
  `nullFlavor`, as before.

### An age held as a number

An age written as a number is located and aggregated too. Under a policy that generalizes dates, an
age over 89 is **removed** and recorded as `DEID_CATEGORY_GENERALIZED` with the disposition `removed`;
an age of 89 or under is kept **exactly as written**, with the disposition `retained` and the code
`DEID_RESIDUAL_RETAINED`, the same row a date-shift policy writes for a kept age. The ages located are:

- an HL7 v2 OBX result typed `NM` whose `OBX-3` (identifier or alternate identifier) codes it as an
  age, for example `OBX|1|NM|30525-0^Age^LN||93|a`. `OBX-5` is emptied and `OBX-6` keeps the unit;
- a FHIR `Age`: `Condition.onsetAge` and `abatementAge`, `FamilyMemberHistory.ageAge`, `deceasedAge`
  and `condition.onsetAge`, `AllergyIntolerance.onsetAge`, `Procedure.performedAge`, an action's
  `timingAge`, and an open `valueAge`; each bound of an age `Range` (`ageRange`, `deceasedRange`,
  `onsetRange`, `abatementRange`, `performedRange`); and an `Observation.valueQuantity`,
  `valueInteger` (read as years) or each bound of a `valueRange` (or a component's) whose `code` names
  an age. The quantity's `value` (or the integer) is dropped and its unit, system and code stay;
- a C-CDA observation in the clinical body whose `code` names an age (the Age Observation's SNOMED CT
  `445518008`, among others), its `PQ` `value`, or each bound of an `IVL_PQ`. The `value` attribute is
  dropped and `nullFlavor="MSK"` is written in its place.

The codes read as an age are LOINC `30525-0`, `21612-7`, `29553-5`, `21611-9` and `63900-5`, and
SNOMED CT `445518008` and `397659008`. A code with no stated system is matched against both lists.

- **The aggregate is the absence of the number.** A `90+` cannot be written into a number field (an
  HL7 v2 `NM`, a FHIR decimal, a CDA `PQ`), so the number is removed rather than replaced.
- **The unit is read.** An age in months, weeks, days, hours or minutes (UCUM `mo`, `wk`, `d`, `h`,
  `min`, or the word) is converted to years before the comparison; an age with no unit is read as
  years. An age whose unit is none of those, or whose value is not a plain number, is **blocked**.
- **Over 89 means more than 89 years.** An age of 89.5 years is over 89 and is removed.
- **A date-shift policy keeps every age.** A shift moves all of a patient's dates by one offset so
  intervals survive, and an age is an interval, so the shifted age is the age itself: it is kept and
  recorded as a residual. A custom policy that pseudonymizes or hashes dates writes its surrogate into
  an HL7 v2 `OBX-5`, and removes the FHIR or C-CDA number, which cannot hold one.
- **Residual: ages these rules do not read.** An age written as text (FHIR `ageString`,
  `deceasedString`, `onsetString`, an HL7 v2 OBX typed `ST`, which is blocked as free text anyway), an
  HL7 v2 OBX age typed `SN` (structured numeric) or any other structured type than `NM`, an age-coded
  FHIR `valueRatio`, and an age under a code outside the lists above all pass as before. A caller who builds
  loci by hand gets the rule by setting `ageUnit` on an `age` locus; without it the `generalize`
  transform turns an age over 89 into `90+`.

### Positions the maps now name, and what is still a residual

The HL7 v2 map names `NK1-12` (the associated party's employee number, blocked as the (R) catch-all),
`NK1-13` (the party's organisation name and identifier, removed as a name) and the v2.7
telecommunication fields `PID-40`, `NK1-40` and `NK1-41` (removed as phone numbers). `NK1-33` is now
read as the associated party's identifiers (one locus per repetition, as `PID-2` is) and `NK1-37`
as the contact person's Social Security number; the map had the two the other way round.

FHIR removes `Location.position`, recorded as geographic and blocked, unless the Location is
positively a fixed facility. **A facility Location must carry a facility `type` code to keep its
position.** It keeps it only when all of these hold:

- `type` carries at least one concept, and every coding on it is v3 RoleCode (by its URI or its OID
  `2.16.840.1.113883.5.111`) and one of `HOSP`, `ER`, `ICU`, `OR`, `PHARM`, `LAB`, `HU`, `SNF`,
  `PSYCHF`, `RH`, `CHR`. A Location with no `type` never keeps its position. The ambulance and
  mobile-unit codes (`AMB`, `MBL`) are not on the list: the vehicle may be parked at a home.
- `physicalType` can only remove it, never keep it. Building, wing, ward, level, corridor, room and
  bed describe physical form, which a house has too, so they leave the decision to `type`; `ho`
  (house), any other code, an unknown system, a coding with no system and an uncoded concept remove
  it.
- The Location has no `partOf`. What it is part of is not known within the resource, so any `partOf`
  removes the position.

Anything else removes it: `PTRES`, a local or unknown system, a coding with no system, an uncoded
concept, a list that mixes a facility code with anything else. A facility coded with a code or in a
system outside those lists, or one that is part of another Location, loses its position too, which is
the over-removal this rule accepts. What the rule still cannot see: free text that contradicts the
code, such as a `name`, `description` or `type.text` reading "patient home" beside a `HOSP` code, and a
`Coding.display` that contradicts its own code. The code decides, and a Location coded `HOSP` keeps its
position whatever its text says. A `geolocation` extension is removed by the extension rule wherever it
sits, and inside an `Address` by the address reduction.

Still not named, and so handed through and counted as unexamined residuals: `NK1-26` (the associated
party's mother's maiden name) and `NK1-38` (its birth place). Any other field of a mapped segment that
the maps do not list is handed through the same way.

## A keyed surrogate in a field shorter than 64 characters

A keyed surrogate (`pseudonymize`, `hash`) is 64 characters of lowercase hex. The X12 adapter bounds
every position it writes a value into by the maximum length of its data element, and the engine cuts
a surrogate to that length, 4 bits for each character kept
([the X12 guide](./guides-x12.md#a-keyed-surrogate-fits-its-field) lists each field, the bits kept and
the collision bound). What that leaves:

- **Linking is by prefix across fields of different lengths.** The same value under the same key gets
  the same surrogate in every field of one length; in a shorter field it gets the first characters of
  it. A member id in `NM1-09` (64 characters kept) and in `REF-02` (50) matches on its first 50
  characters, not on the whole value, and so does an X12 surrogate against the one another adapter
  writes for the same value.
- **A field shorter than 20 characters (80 bits) gets no surrogate.** The value is removed and
  recorded as blocked. In X12 that is a person's name that has a prefix or a suffix (`NM1-06`,
  `NM1-07`, 10 characters), a postal code (`N4-03`, 15), and every date, whose declared format fixes a
  length of 17 or fewer. A caller who needs those linked cannot link them through the X12 output.
- **A group whose `GS-08` does not name 005010 or later takes the 004010 maxima**, the shorter of the
  two, so a 005010 group with an unreadable version gets a 30-character `REF-02` surrogate where 50
  would fit.
- **The other adapters set no bound.** The HL7 v2, C-CDA, FHIR, NCPDP Telecom and DICOM adapters do
  not declare a maximum length on any position, so the engine writes the whole surrogate there (or the
  UUID or OID form of a referenced identifier), whatever the field allows. A caller who validates field
  lengths in those formats must check them after the pass.

A caller building loci by hand bounds a position with `GenericLocus.maxLength`; the same rule applies.

<a id="restricted-zip3"></a>

## The restricted three-digit ZIP list: where it comes from

§164.514(b)(2)(i)(B) keeps the first three digits of a ZIP code only when, according to the current
publicly available Census data, the area formed by every ZIP code with those three digits holds more
than 20,000 people; otherwise the three digits become `000`. `RESTRICTED_ZIP3` is the list of prefixes
that become `000`, and `RESTRICTED_ZIP3_SOURCE` names where it comes from.

The list follows the **2020 Census**, the most recent decennial count. We read table P1 (total
population) of the 2020 Demographic and Housing Characteristics File for every five-digit ZIP Code
Tabulation Area (ZCTA) from the Census Bureau's data.census.gov, summed the ZCTAs that share their
first three digits, and kept the prefixes at 20,000 people or fewer. That gives 18 prefixes, and the
2010 Census (Summary File 1, table P1, read the same way) gives the same 18:

| Prefix | 2020 population | Prefix | 2020 population | Prefix | 2020 population |
| ------ | --------------: | ------ | --------------: | ------ | --------------: |
| `036`  |          13,153 | `205`  |              44 | `772`  |           4,280 |
| `059`  |           3,352 | `369`  |          17,596 | `821`  |             392 |
| `102`  |          15,082 | `556`  |          16,415 | `823`  |          14,702 |
| `202`  |               0 | `692`  |           8,626 | `878`  |          17,364 |
| `203`  |             772 | `753`  |               0 | `879`  |          16,082 |
| `204`  |              60 | `893`  |          10,701 | `884`  |          16,740 |

The list also keeps the 17 prefixes the HHS guidance on de-identification (2012) names from the 2000
Census. Five of those are over 20,000 people in the 2020 Census (`063`, `790`, `830`, `831`, `890`);
they stay on the list so that no ZIP an earlier release reduced to `000` keeps its prefix now. The
list is 23 prefixes in all. Keeping the five costs some precision in those areas and never keeps a
prefix the 2020 Census restricts.

Two limits follow. A ZCTA approximates the area a ZIP code serves rather than matching it, and a ZIP
code with no ZCTA of its own (a post office box code, for one) counts toward no prefix. A prefix whose
ZCTAs hold no residents, such as `202` and `753`, shows 0 people and is restricted. And the
list is a fixed export, not an option: a caller who must apply a different list, for example a newer
census, cannot pass one in today.

**Updating it.** When the Census Bureau publishes a newer count, read total population by five-digit
ZCTA for the whole country (the Census Data API, or the matching table on data.census.gov), sum by
the first three digits, and take every prefix at 20,000 or fewer. Change `RESTRICTED_ZIP3` and
`RESTRICTED_ZIP3_SOURCE` in `src/restricted-zip.ts` and the pinned list in
`test/restricted-zip.test.ts` together; the change ships in a release whose notes name each prefix
added or removed, since it changes what a caller's output keeps.

<a id="policy-profiles"></a>

## Policy profiles, and the Limited Data Set caveat

- **`SAFE_HARBOR_PROFILE`**: the fail-closed default, dates generalized to year, the (R) catch-all
  blocked. It retains **no** identifying locus: an admission, discharge, or service date keeps only its
  year, and an encounter or order number is blocked. It emits **no keyed surrogate**: the medical
  record, health plan beneficiary, and account numbers are **removed**, because a surrogate derived
  from the individual's own value is not a §164.514(c)(1) code and the (R) exception does not reach
  it. A FHIR resource id, recorded as a medical record number, is removed the same way, and a per-call
  sequence number is written in its place so the references to it still resolve: it is computed from
  the order the ids are met, never from the id. It therefore **needs no key at all**.
- **`LIMITED_DATA_SET_PROFILE`**: a **research / longitudinal** preset that **date-shifts** dates
  (interval-preserving) rather than generalizing them, and that keeps a **consistent keyed surrogate**
  for the medical record, health plan beneficiary, and account numbers so cross-document linkage
  survives. It is deliberately **less protective than Safe Harbor** on both counts: a shifted-but-real
  date is still "an element of a date," and a keyed surrogate is a re-identification code anyone
  holding the key can reverse the linkage of. Therefore it is **not** labeled `safe-harbor`, it
  **requires** a keyed per-patient context, and it produces an **Expert-Determination-supporting**
  dataset, **not** a certified de-identification, and **not**, on its own, a HIPAA §164.514(e) Limited
  Data Set. Disclosing an actual Limited Data Set additionally requires a **Data Use Agreement**, which
  is the consumer's responsibility. Every keyed surrogate it emits is flagged `reidentificationCode`
  in the manifest and listed in the support report's keyed-surrogate residual inventory. That
  includes every FHIR resource id and the ids in the literals that name one, which it pseudonymizes as
  medical record numbers so a corpus keyed alike links.

  It also **keeps unchanged** the three classes §164.514(e)(2) permits and Safe Harbor does not: the
  **encounter dates** (admission / discharge / service / diagnosis), the **encounter and order
  identifiers** (a `VN`-typed or untyped visit number, and the placer and filler order numbers), and
  the **named parts of a postal address**. That list of sixteen direct identifiers names no date and
  has no catch-all, which is exactly why the first two survive here and are removed under Safe Harbor.
  It **does** name medical record, account, and social security numbers, so a PV1-19 typed as one of
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
  or household members", so the patient, the next of kin, the guarantor, the guarantor's employer, and
  the insured are all treated alike.
- **Every kept part is recorded**, as a `DEID_RESIDUAL_RETAINED` residual located to its own field,
  repetition, and component, so it reaches the determiner's residual inventory.
- **Nothing widens by omission.** A profile or an options bag that does not name the class reduces
  every address exactly as it always did. Options built by hand from a profile's `policy` alone keep
  nothing, and a profile derived from the Safe Harbor base may not add the class at all.
- **It fails closed.** An address whose zip code is not a whole zip code is not partially kept: the
  locus falls back to the Safe Harbor generalization, which drops the whole address when it cannot read
  a prefix. No residual is recorded for anything that was not actually retained.
- **The geographic allowance is honored by the HL7 v2 pass alone.** The **C-CDA, FHIR, X12, NCPDP, and
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

// The output is never labeled "de-identified".
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

The library's promise is narrow and honest: **structured-field, policy-driven Safe-Harbor
transformation with a value-free manifest, never a leaked patient, and never a claim of
"de-identified."**

## NCPDP Telecom: one transaction per message

`deidentifyTelecom` handles a Telecom message that carries one transaction. A message that carries
more than one is **refused** with a typed `DeidError` carrying `DEID_FORMAT_UNSUPPORTED`, and returns no
transformed message, no manifest and no partial output, so no transaction is dropped or returned
untransformed. Split such a message and de-identify each transaction on its own.

A transaction that carries more than one Patient (`01`) or Claim (`07`) segment is refused the same
way. A second patient's segments with no Group Separator in front of them decode as part of the one
transaction, and the caller's one patient context would give both patients one date-shift offset.

## One context per call, however many people the document names

A call takes one context, and a `date-shift` policy derives one offset from that context's patient
scope. Where a document is several documents read as one, the adapter refuses it: an NCPDP Telecom
transaction with a repeated Patient or Claim segment (above), and an HL7 v2 message with more than one
`MSH` segment, which is what messages written one after another with no batch envelope parse as. An
HL7 v2 batch with its `FHS` / `BHS` envelope is refused by `parseHL7` itself; split it with
`splitBatch` from `@cosyte/hl7` and de-identify each message on its own.

The X12 and HL7 v2 adapters do not refuse one document that names more than one person, because that
is their ordinary shape: an X12 `837` names a subscriber and a dependent patient, and an interchange
can carry many claims for many patients; an HL7 v2 `ADT^A17` swaps two patients' PID segments. Every
date in such a document is shifted by the same offset, so two people's shifted dates keep their real
distance from each other. Pseudonyms do not depend on the patient scope, only on the key. Under the
default Safe Harbor policy dates are generalized to the year and no offset is involved. When
per-patient offsets matter, split the document per patient and give each part its own context
(`registry.forPatient(...)`).

## Animal patients

Our categories are the 18 identifier categories of the HIPAA Safe Harbor method
(§164.514(b)(2)(i)), and HIPAA is about health information on people. A record about an animal is
outside HIPAA, so the Safe Harbor list was not written for it, and nothing here makes a veterinary
record compliant with anything. What a veterinary record does carry is its owner: a name, an
address, a phone number. That is personal data about a person, under privacy law in many places,
whatever the patient is. So the library handles an animal record as it handles a human one, and the
tables below say what that means for the fields only an animal record has. Each row is pinned by a
test on a synthetic record (`test/hl7/animal-patient.test.ts`, `test/dicom/animal-patient.test.ts`,
`test/fhir/patient-animal.test.ts`).

**HL7 v2.**

| Position                                                          | What happens                                                                      |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `PID-35` Species Code, `PID-36` Breed Code                        | kept whole: they describe a kind of animal, and the locus map does not name them  |
| `PID-37` Strain, `PID-38` Production Class Code                   | kept whole, for the same reason                                                   |
| `PID-5` Patient Name (the animal's name, often with the owner's)  | removed, recorded under Names                                                     |
| `PID-3` identifier list, a microchip number (type `MCN`) included | each identifier replaced or removed and recorded, as any other `PID-3` identifier |
| `NK1` the owner: name, address, phone                             | removed or generalized and recorded, as for a human patient's next of kin         |

**DICOM.** PS3.15 Table E.1-1 names three of the veterinary Patient Module attributes. This adapter
removes two more that it does not name.

| Attribute                                                                          | What happens                                                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Patient Species Description and Code Sequence `(0010,2201/2202)`                   | kept: Table E.1-1 has no row for them, so they are counted in `unexaminedResiduals` and get no manifest row                        |
| Patient Breed Description and Code Sequence `(0010,2292/2293)`                     | kept, the same way                                                                                                                 |
| Patient's Sex Neutered `(0010,2203)`                                               | removed and recorded under the Basic Profile; kept and recorded `retained` under Retain Patient Characteristics                    |
| Responsible Person `(0010,2297)`, Responsible Organization `(0010,2299)`           | removed and recorded (Table E.1-1 `X`)                                                                                             |
| Responsible Person Role `(0010,2298)`                                              | kept: a coded role such as `OWNER`, not a person                                                                                   |
| Breed Registration Sequence `(0010,2294)`, Breed Registration Number `(0010,2295)` | **removed beyond Table E.1-1**, recorded `removed` under category (R), and named by the `DICOM_BREED_REGISTRATION_REMOVED` warning |

A breed registration number names one animal, and the registry that issued it holds the owner's name
and address, so it leads to a person as surely as Responsible Person does. Table E.1-1 lists neither
attribute, so the delegated Annex E pass keeps them; this adapter removes them at the top level, where
the Patient Module puts them, and refuses a file that carries either one inside a sequence it keeps
(`DEID_FORMAT_UNSUPPORTED`). No Annex E option keeps them.

**FHIR R4.** The animal's kind is in the `patient-animal` extension, and every extension value is
blocked by default. The `keepPatientAnimal` option of the FHIR adapter, off by default, keeps part of
it.

| Position                                                                                                                                             | What happens                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `patient-animal` `species`, `breed`, `genderStatus`, their `valueCodeableConcept`                                                                    | removed by default, as every extension value is. With `keepPatientAnimal`, each `Coding`'s `system`, `version`, `code`, `userSelected` (a boolean) and `display` kept, counted in `unexaminedResiduals` |
| the same concept's `text`, an `id` or extension on it, a property R4 does not define on it or on a `Coding`, a `userSelected` that is not a boolean  | removed and recorded, with the option or without                                                                                                                                                        |
| any other `value[x]` on those three (a `valueString`), any other sub-extension, a repeat of one of the three, a second `patient-animal`              | removed and recorded, with the option or without                                                                                                                                                        |
| an extension whose `url` only looks like `patient-animal` (a version suffix, `https`, a trailing slash, another case or host), every other extension | removed and recorded, with the option or without                                                                                                                                                        |
| `Patient.name` (the animal's name), `Patient.identifier` (a microchip number), `Patient.contact` (the owner)                                         | removed, replaced or generalized and recorded, as for a human patient                                                                                                                                   |

With the option on, a kept code is not read: a code system is the sender's choice, and a code that
is really a name passes through. Keep it off unless the codes come from a terminology you trust.

## Put it to use

- [What the caller still owns](./what-the-caller-still-owns.md): the checklist before you release
  output
- [Choose a policy and read the manifest](./choose-a-policy.md): the profiles above, and what the
  manifest records
- [Keep a patient linkable across documents](./guides-longitudinal.md): the limited-data-set preset
  and the key contract
- [Redact free text with your own detector](./guides-freetext.md)
- [Build an Expert Determination support report](./guides-expert-determination.md)
- The format guides, each with its own limits: [HL7 v2](./guides-hl7.md), [C-CDA](./guides-ccda.md),
  [FHIR](./guides-fhir.md), [X12](./guides-x12.md), [NCPDP Telecom](./guides-ncpdp.md) and
  [DICOM](./guides-dicom.md)
