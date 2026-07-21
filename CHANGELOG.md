# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions and publishing are managed with [Changesets](https://github.com/changesets/changesets);
this file is maintained by hand (Changesets handles the version bump and publish only).

## [Unreleased]

The first pre-alpha release (`0.0.1`) will ship the initial public API surface. The package begins
its public history at `0.0.x`, per the cosyte version ladder (`0.0.x` until first alpha).

### Added

- **DEID-6 — the DICOM de-identification adapter (`@cosyte/deid/dicom`).** The one adapter that
  **delegates rather than reimplements**: `@cosyte/dicom` already ships the PS3.15 **Annex E**
  de-identification (the Basic Application Level Confidentiality Profile), so this adapter **orchestrates**
  that pass under the unified policy and **folds its value-free report into the unified manifest** — it
  never re-does Annex E. `@cosyte/dicom` is an **optional peer dep** (vendored `pnpm pack` tarball at a
  pinned commit pre PUB-FLIP), consumed only from this subpath, so the core stays third-party-dep-free.
  - **API.** `deidentifyDicom(dataset, { policy?, uidMap?, uidRoot? })` returns the fresh de-identified
    `Dataset`, the value-free manifest, the warnings, and the honest `metadataOnly: true` stance; the
    convenience `deidentifyDicomBuffer(bytes, …)` parses → de-identifies → re-serializes in one call. No
    key context is needed (Annex E dummying and content-derived UID remapping do not consume the
    pseudonymization key).
  - **What it does (the full Basic Profile, fail-closed default).** Patient Name/ID/Birth Date, Other
    Patient IDs, institution, referring/performing physicians, dates, accession and device identifiers
    **removed**; **Study/Series/SOP Instance UIDs consistently remapped** (`U`) so study/series/image
    relationships survive; **private tags removed** (kept only when a known-safe retain list names them —
    empty by default); Modality, image geometry, coded technique and **pixel bytes retained untouched**
    (the over-scrub guard); `Patient Identity Removed = YES` + a policy-named De-identification Method
    inserted. The input dataset is never mutated.
  - **The burned-in-pixel hazard — flagged, never cleaned.** This is a **metadata-only** de-identifier:
    it cannot inspect or clean pixels, so recognizable text **burned into the image** (Safe Harbor
    category Q) is not removed. When Pixel Data may carry burned-in annotation the result sets
    `burnedInAnnotationHazard === true` and carries `DICOM_BURNED_IN_ANNOTATION_NOT_REMOVED` — such output
    is **not** safe to release on metadata alone. Pixel cleaning is a future `@cosyte/dicom-pixel`.
  - **Value-free manifest.** Each acted-on tag is folded into a `DeidManifestEntry` carrying the Safe
    Harbor category, the transform, the locus (`(gggg,eeee) Keyword`, with any sequence context path), the
    disposition and the code — **never** a decoded value. The category is a coarse audit label that **falls
    closed to (R)** for anything it cannot positively classify; the source→replacement UID map is never
    surfaced (it is a re-linking vector). Leak, over-scrub, consistent-UID, immutability and fuzz tests
    cover the boundary. **The structured-format core is now feature-complete across all six formats.**
- **DEID-5 — the X12 EDI and NCPDP Telecom de-identification adapters (`@cosyte/deid/x12`,
  `@cosyte/deid/ncpdp`).** Two structured-EDI bindings of the core: each locates PHI **structurally** in a
  parsed `@cosyte/x12` / `@cosyte/ncpdp` model (never by regex over the bytes) and returns the
  de-identified byte stream plus the value-free manifest. `@cosyte/x12` and `@cosyte/ncpdp` are **optional
  peer deps**, consumed only from their own subpaths (vendored `pnpm pack` tarballs at pinned commits pre
  PUB-FLIP), so the core stays third-party-dep-free.
  - **X12 (`@cosyte/deid/x12`).** `deidentifyX12(interchange, { policy?, context? })` and the convenience
    `deidentifyX12String(raw, …)`; plus `extractX12Loci`, `applyX12`, the cited `PROVIDER_ENTITY_CODES` /
    `PATIENT_ENTITY_CODES` / `X12_UNIVERSAL_SEGMENT_RULES` / `X12_ACCOUNT_SEGMENTS` /
    `X12_RETAIN_SEGMENTS`, and the classifiers `classifyNm1Entity`, `categoryForNm1IdQualifier`,
    `classifyRefQualifier`. Across the subscriber (2000B/2010BA) and patient (2000C/2010CA) loops of
    837/835/270-271: **`NM1`** entity-classified — a subscriber / patient / dependent name (`NM1-03..07`)
    removed and its identifier (`NM1-09`) routed by the `NM1-08` qualifier (SSN removed, member id
    pseudonymized); a recognized provider / organization `NM1` **retained** (non-patient identity,
    mirroring the HL7 adapter's provider retention); an **unknown entity code fails closed**. `N3`/`N4`
    street + city removed, ZIP → safe 3-digit, state retained; `DMG-02` DOB → year; `PER` name + telecom
    removed; `DTP-03`/`DTM-02` dates → year; **`REF`** qualifier-classified (patient / member / subscriber
    / group / medical-record identifier removed or pseudonymized; recognized administrative / provider
    reference retained — including `REF*1H` CHAMPUS/TRICARE beneficiary ids reclassified as the
    individual's PHI; **unknown REF qualifier fails closed** — the "unusual REF qualifier" category (R)
    frontier); a geographic `N3`/`N4` segment also **fails closed on any unmapped element** (a `N4-06`
    location identifier is blocked; only state + country are retained); `SBR-03` insured group/policy
    number **pseudonymized** and `SBR-04` group name **removed** (the same health-plan-beneficiary
    identifier `REF*1L`/`REF*6P` carry — previously retained wholesale); `N1` party identification
    **entity-classified** like `NM1` (recognized payer/provider org retained; a patient-side or unknown
    party's name + id scrubbed / blocked); `CLM-01`/`CLP-01` patient account number pseudonymized. The
    `@cosyte/x12` serializer is
    byte-faithful, so a segment the map does not touch keeps its **verbatim** raw — diagnosis / procedure /
    revenue codes, monetary amounts, and quantities survive the over-scrub test byte-identical.
    **Free-form message text fails closed:** `MSG-01`, `III-04`, `K3-01`, and `NTE-02` are blocked (their
    coded siblings retained) — the X12 analogue of the HL7 `OBX-5`/`NTE` and NCPDP `FY`/`F4`/`FQ` blocks.
  - **NCPDP (`@cosyte/deid/ncpdp`).** `deidentifyTelecom(tx, …)` / `deidentifyTelecomString(raw, …)`; plus
    `extractTelecomLoci`, `applyTelecom`, the cited `TELECOM_LOCUS_MAP` / `TELECOM_FREE_TEXT_FIELDS` /
    `TELECOM_RETAIN_SEGMENTS`. Telecom vD.0: Patient (`01`) name / phone removed, street / city removed,
    ZIP → 3-digit, DOB → year, patient id pseudonymized; Insurance (`04`) cardholder id / group id
    pseudonymized, cardholder name removed; Prescriber (`03`) id removed (the roadmap scopes prescriber
    identifiers for NCPDP — a deliberate asymmetry with the X12 provider-retention stance); Coordination of
    Benefits (`05`) other-payer cardholder / group ids pseudonymized, other-payer date → year; header Date
    of Service → year. Fail closed inside a PHI segment too: a free-text field (`544-FY` DUR, `504-F4`
    message, `526-FQ` additional message information), an **unmapped field in a Patient / Prescriber /
    Insurance / COB segment** (a `350-HN` patient e-mail, a `359-2A` Medigap id — anything not on the
    explicit per-segment non-identifier retain list), and any unknown segment are all **blocked**; the
    clinical / financial segments (NDC, quantities, days-supply, pricing, DUR codes) and the recognized
    non-identifier fields (gender, state, `335-2C` pregnancy indicator, person code, other-payer amounts)
    are retained.
  - **NCPDP SCRIPT is deferred** (a documented non-goal of this phase): `@cosyte/ncpdp`'s SCRIPT surface
    cannot be de-identified faithfully through its public API — `serializeScript` emits only the modeled
    fields (a round-trip drops unmodeled XML) and the SCRIPT `Patient` model has no address / phone /
    patient-id field, so a partial pass would silently drop content and leave unmodeled identifiers
    unhandled, a false-safety hazard the fail-closed posture forbids.
  - **PHI-scan gate extended** with structured X12 (`scanX12Structured`) and NCPDP Telecom
    (`scanTelecomStructured`) detectors and their positive tests, plus the synthetic X12 / NCPDP token
    declarations in `scripts/phi-allow-list.txt`. Both headline gates pass on all-synthetic fixtures — the
    **leak test** (zero seeded-sentinel survivors) and the **over-scrub test** (every clinical / financial
    value byte-identical). `verify.sh deid` green (typecheck, lint, format, phi-scan, coverage per-dir ≥90
    incl. the new `x12/` + `ncpdp/` dirs, build, attw); the `conformance-refuter` gate returned NOT
    REFUTED.
- **DEID-4 — the FHIR R4 de-identification adapter (`@cosyte/deid/fhir`).** The FHIR binding of the core:
  it locates PHI **structurally** in a parsed `@cosyte/fhir` resource (never by regex over the JSON) and
  returns a transformed resource model plus the value-free manifest.
  - `deidentifyFhir(resource, { policy?, context? })` and the convenience `deidentifyFhirJson(json, …)` —
    the top-level entries; plus `extractFhirLoci`, `applyFhir`, the cited `PERSON_RESOURCE_TYPES`,
    `FHIR_DEMOGRAPHIC_ELEMENTS`, `RECOGNIZED_PERSON_ELEMENTS`, `categoryForIdentifierSystem` (identifier
    `system` → Safe Harbor category), and `isFhirDateValue` (the date/over-scrub knife-edge).
  - **Role-split locus map.** FHIR is a graph of typed resources, so the map splits by role. **Person
    resources** — `Patient` / `RelatedPerson` / `Practitioner` / `Person` (+ the nested `Patient.contact`
    relative — Safe Harbor removes relatives'/employers'/household members' identifiers): `name` /
    `telecom` / `photo` removed; `address` → safe 3-digit ZIP (`000` for restricted prefixes), finer
    geography dropped; `birthDate` and every date → year. **Universal vectors on every resource:**
    `identifier` pseudonymized by `system` (keyed HMAC; a US-SSN system removed, `system` retained);
    PHI-bearing dates → year; narrative `text.div` blocked at any depth; `extension` / `modifierExtension`
    values blocked; a `Reference.display` person label blocked (a `Coding.display` coded term retained —
    the two told apart structurally). **Contained resources and `Bundle` entries** are walked, re-deriving
    each resource's role at its own `resourceType`.
  - **Fail closed** on the frontier: a bare unrecognized string at a person resource top level is blocked
    (an open-ended allow-list can never satisfy category (R)); a `display` that is **not** on a `Coding`
    (identified positively by a `code`/`system` sibling) is a Reference person-label and is blocked —
    including a **display-only** (`{ display }`) or type+display reference that names no target;
    every extension value — a complex `valueAddress` / `valueHumanName` / `valueIdentifier`, a nested
    extension, or a primitive-level `_`-sibling extension (the applier strips these) — is dropped; and
    **free-text prose** (`note` Annotations, `contentString`, an uncoded `valueString`) is blocked, the
    FHIR analogue of the HL7 adapter's OBX-5-`ST` / NTE fail-closed default. Clinical resources
    (`Observation` structured values, codes, units, statuses, reference ranges) are **retained untouched**
    (the over-scrub guard), and reference **wiring** (`Reference.reference` pointers) is preserved so
    linkage survives.
  - `@cosyte/fhir` is an **optional peer dependency** consumed only from the `/fhir` subpath (vendored as a
    packed tarball for dev/test, matching the `mllp`→`hl7` pattern). The adapter reaches FHIR data only
    through `@cosyte/fhir`'s exported model and `parseResource`/`serializeResource` codec — never a direct
    third-party import — and rebuilds the immutable model into a fresh tree (the input is never mutated),
    so `@cosyte/deid` declares no third-party runtime dependency of its own.
  - Accuracy gates as tests: the **leak test** (zero surviving sentinels across person resources, the
    universal vectors, the nested `contact`, extensions, and a contained resource) and the **over-scrub
    test** (clinical values / codes / units / statuses and reference wiring survive), plus a fail-safe
    property (arbitrary synthetic tokens never leak into the output or the manifest).
  - **Known limitations:** extension values are block-only (no profile-aware retention yet); reference
    wiring and resource logical `id`s are preserved structurally (coordinated cross-corpus id
    pseudonymization is a later phase); free-text **prose** loci fail closed, but a semantic (NLP)
    narrative scrub, `contentAttachment` binary content, and person names embedded in non-person
    resources (`Organization.contact.name`, `Location.address`) remain out of scope.

- **DEID-3 — the C-CDA de-identification adapter (`@cosyte/deid/ccda`).** The C-CDA binding of the core:
  it locates PHI **structurally** in a parsed `@cosyte/ccda` document (never by regex over the XML) and
  returns a transformed `CcdaDocument` plus the value-free manifest.
  - `deidentifyCcda(doc, { policy?, context? })` — the top-level entry; plus `extractCcdaLoci`,
    `applyCcda`, the cited `CCDA_LOCUS_MAP`, `isRetainedCcdaElement`, `CCDA_ENVELOPE_ELEMENTS`, and
    `categoryForIdRoot` (id `root` OID → Safe Harbor category).
  - **Structured locus map** over the CDA **header participations** — `recordTarget/patientRole` (+ nested
    `guardian`) and `author` / `dataEnterer` / `informant` / `authenticator` / `legalAuthenticator` /
    `participant` / `custodian` / `documentationOf` / `componentOf` (relatives / providers / contacts —
    Safe Harbor removes relatives'/employers'/household members' identifiers): person `name`/`telecom`
    removed; person-role `id` pseudonymized (SSN-rooted id removed, assigning `root` retained); `addr` →
    safe 3-digit ZIP (`000` for restricted prefixes); `birthTime` and participation/encounter dates →
    year. Dosing-period `effectiveTime` (`PIVL_TS`/`EIVL_TS`) is never treated as a date.
  - **Fail closed** everywhere else via a **positive allow-list**: a recognized coded/structural element
    (`CCDA_CODED_ELEMENTS`) is retained but still **descended into** (so a `<name>`/free text nested under
    a coded element cannot ride through), and any stray direct character text on such an element is
    blocked; every value-bearing element that is neither mapped PHI nor on the allow-list blocks (an
    open-ended `endsWith("Code")` would have leaked an unknown vendor `*Code`). Section narrative `<text>`
    at any depth (section- and entry-level) and the unstructured `nonXMLBody` block; foreign / `sdtc`
    elements block. The document `id`/`code`/`title` envelope is retained (like HL7's MSH), and the
    clinical `structuredBody` entries are **retained untouched** (the over-scrub guard) — a body `<name>`
    is a drug/material name, never a person.
  - `@cosyte/ccda` is an **optional peer dependency** consumed only from the `/ccda` subpath (vendored as a
    packed tarball for dev/test, matching the `mllp`→`hl7` pattern). The adapter reaches the CDA DOM only
    through `@cosyte/ccda`'s XXE-hardened `parseSecureXml` and re-serializes the node the parser hands
    back — it never imports the XML substrate (`@xmldom/xmldom`, the parser's own ratified dependency)
    directly, so `@cosyte/deid` declares no third-party runtime dependency of its own.
  - Accuracy gates as tests: the **leak test** (zero surviving sentinels across the header participations
    and the section narrative, including adversarial `sdtc`/vendor placements) and the **over-scrub test**
    (coded clinical values, units, statuses, drug name, and dosing period byte-identical), plus a
    fail-safe property (arbitrary synthetic tokens never leak into the output or the manifest).
  - The `phi-scan` gate gains **C-CDA structured, header-element detection** — every header person-name /
    address element and `birthTime` is checked against the synthetic allow-list, scoped to the header so a
    clinical-body drug `<name>` is not a false positive.
  - **Known limitations:** narrative is block-only (no NLP scrub yet); within the retained clinical body,
    entry service dates, entry ids, in-entry performer names, and family-history relative demographics are
    a deferred later phase (mirroring the HL7 adapter's retained-clinical-segment boundary).

- **DEID-2 — the HL7 v2 de-identification adapter (`@cosyte/deid/hl7`).** The first end-to-end format
  binding of the core: it locates PHI **structurally** in the parsed `@cosyte/hl7` model (never by regex
  over raw bytes) and returns a transformed `Hl7Message` plus the value-free manifest.
  - `deidentifyHl7(msg, { policy?, context? })` — the top-level entry; plus `extractHl7Loci`, `applyHl7`,
    the cited `HL7_LOCUS_MAP`, and `categoryForIdentifierType` (CX-5 → Safe Harbor category).
  - **Structured locus map** over **PID** (patient) and **NK1 / GT1 / IN1 / IN2** (relatives / guarantor
    / insured — Safe Harbor removes relatives'/employers'/household members' identifiers, not only the
    patient's): names/phone/SSN/licence removed; MRN/account/beneficiary pseudonymized (keyed HMAC, the
    assigning authority retained); DOB → year; address → safe 3-digit ZIP (`000` for restricted
    prefixes); PID-3 identifiers routed by CX-5 type code (SS/MR/AN/MA…).
  - **Fail closed** via an explicit clinical/administrative retain-list: a recognized segment is passed
    through only if it is retained, so a _known_ patient-identity segment absent from the map (**MRG**
    prior name + MRN on a merge, **FAM**, **ACC**, **PEO**, **PDA**) is blocked, as are Z-segments /
    structure unknown to the parser. **OBX-5** is retained only when OBX-2 types it structured (numeric /
    coded / date); narrative (`TX`/`FT`), ambiguous String (`ST`), and empty/unknown OBX-2 block, as does
    **NTE-3**. Clinical values, units, codes, and statuses are **retained untouched** (the over-scrub
    guard).
  - `@cosyte/hl7` is an **optional peer dependency** consumed only from the `/hl7` subpath (vendored as a
    packed tarball for dev/test, matching the `mllp`→`hl7` pattern); the core stays third-party-dep-free.
  - Accuracy gates as tests: the **leak test** (zero surviving sentinels across all mapped loci +
    adversarial placements) and the **over-scrub test** (clinical values byte-identical), plus a
    fail-safe property (arbitrary messages never throw a non-fatal, never leak, never mutate the input).
  - The `phi-scan` gate gains **HL7 v2 structured, field-level detection** — every PID/NK1/GT1/IN1/IN2
    PHI field is checked against the synthetic allow-list, so a real name/DOB/MRN cannot ride into a
    fixture unnoticed.
- **DEID-1 — the format-agnostic de-identification core.** The foundation every format plugs into,
  tested against a generic locus model (no parser wired yet):
  - **Policy engine** — `deidentify(model, { policy, context })`, the built-in `SAFE_HARBOR_POLICY`,
    and `defineDeidPolicy()` (deviate from the safe default, never forget a category).
  - **The five transforms** (`node:crypto`-backed) — `redact`; `generalizeDate` (→ year),
    `generalizeZip` (→ initial 3 digits, or `000` for the cited ≤20,000-population prefixes),
    `generalizeAge` (→ `90+` for ages over 89); deterministic per-patient `dateShift`
    (interval-preserving; the offset never leaks); keyed-HMAC-SHA-256 `pseudonymize`; keyed `keyedHash`.
    `unkeyedHash` is exported only to demonstrate the reversibility hazard and is non-conforming.
  - **The 18 HIPAA Safe Harbor categories** (`SAFE_HARBOR_CATEGORIES`, `SAFE_HARBOR_CATEGORY_META`) —
    45 CFR §164.514(b)(2)(i)(A)–(R), including the open-ended catch-all (R).
  - **The fail-closed rule** — an unrecognized structure / un-locatable identifier / uncertain field /
    free-text locus is blocked, never passed through; clinical loci are retained untouched (over-scrub
    guard).
  - **The value-free manifest** — `DeidManifestEntry` (category + transform + locus + count +
    disposition + code); never a value, never the HMAC key, never the date-shift offset.
  - **The self-redacting `DeidContext`** — the consumer's key lives in a module-private `WeakMap` and
    redacts through every stringify channel.
  - Stable code registries `FATAL_CODES` (`EMPTY_INPUT`, `DEID_NO_KEY`) and `DEID_DISPOSITION_CODES`;
    the cited `RESTRICTED_ZIP3` list (HHS 2012 guidance / 2000 Census); the `OUTPUT_LABEL`
    ("Safe-Harbor-transformed per the configured policy").
- Mandatory accuracy gates as tests: the ZIP-`000` threshold, the age-`90+` aggregation, the
  unsalted-hash-reversibility proof (keyed HMAC is not reversible without the key), date-shift interval
  preservation, and the offset/key-never-leak assertion.

### Changed

- Replaced the parser-template scaffold stubs (`parseDeid`, `WARNING_CODES`) with the de-identification
  engine surface. `@cosyte/deid` is a de-identifier, not a parser — the public API and docs reflect the
  inverted (fail-closed) reflex.

### Deprecated

### Removed

- The archetype parser stubs `parseDeid` / `ParsedDeid` / `WARNING_CODES` and the `round-trip` property
  scaffold — not applicable to a de-identifier.

### Fixed

### Security

- Pseudonymization/keyed-hash are **keyed** (HMAC-SHA-256) by design: an unsalted hash of an identifier
  is re-identifiable (§164.514(c)). The engine never falls back to an unkeyed transform; the key and the
  per-patient date-shift offset never appear in the output or manifest.

[Unreleased]: https://github.com/cosyte/deid/commits/main
