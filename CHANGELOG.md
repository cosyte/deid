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

- **A brand image at the top of `README.md`.** The page opens with the Cosyte lockup, served as a
  `<picture>` with a light and a dark source so it follows the reader's theme, and carrying alt text
  that describes the mark for anyone reading with images off or a screen reader on. The block is
  copied byte for byte from the `hl7` README, which is the reference the suite mirrors, so every repo
  carrying it stays one string rather than drifting into hand-typed variants. Nothing else on the
  page moved: the title, the honesty line and every code sample are unchanged, and no API, `DEID_*`
  code, policy, manifest disposition or transformed value differs.
- **DEID-10 — release hardening (roadmap §Phase 10): policy profiles, a non-vacuous leak/over-scrub
  corpus + pipeline fuzz, a publish dry-run, and the honesty docs.** The final roadmap phase; the six
  format adapters, the longitudinal layer, the free-text BYO interface, and the ED report are unchanged.
  - **Policy profiles.** `SAFE_HARBOR_PROFILE` (the fail-closed default) and `LIMITED_DATA_SET_PROFILE`
    (a longitudinal research preset that **date-shifts** dates instead of generalizing — deliberately
    **less** protective, so it is **not** labelled `safe-harbor`, **requires** a keyed per-patient
    context, and is **not** a certified de-identification nor, on its own, a HIPAA §164.514(e) Limited
    Data Set). `defineDeidProfile()` derives a per-site profile under a fail-closed **widen-never-narrow**
    contract — a category may only move to an equal-or-**stronger** transform; a weakening override is a
    fatal `DEID_PROFILE_INVALID`. `profileOptions()` composes a profile into adapter `DeidOptions`. New
    public surface: `SAFE_HARBOR_PROFILE`, `LIMITED_DATA_SET_PROFILE`, `defineDeidProfile`,
    `profileOptions`, and the types `DeidProfile`, `DeidProfileSpec`, `DeidStandard`.
  - **Consolidated leak/over-scrub corpus + pipeline fuzz, gating CI (`test/corpus/`).** One suite runs
    the zero-leak and clinical-survivor gates across **all six** formats, proven **non-vacuous** two
    ways: every sentinel is asserted present in the _original_ wire (pre-condition), and a sentinel
    re-injected into a de-identified wire is _caught_ by the same sweep (tamper). Adds a pipeline fuzz —
    truncated fixtures never leak a full seeded sentinel; arbitrary byte-flips always terminate with a
    string or a bounded rejection (never a hang/OOM).
  - **Publish dry-run / release-shape smoke (`pnpm smoke`).** Loads **every** published subpath
    (`.`/`hl7`/`ccda`/`fhir`/`x12`/`ncpdp`/`dicom`) from the built `dist/` in **both** ESM and CJS,
    verifies each headline export, and asserts no HL7 leak. Runs after `build`, alongside `attw`, on the
    local verify ladder. (This line claimed it was a **CI gate**; it was not wired into any CI job
    until the entry under Security below. Corrected here rather than left to be made true later,
    because it has never been released and the claim was never DEID-10's to make.)
  - **The tsup shared-core chunk fix (`splitting: true`).** Each built subpath previously inlined its own
    copy of the core, so a `DeidContext` created via the root entry and used with a per-format
    `deidentify*` resolved to a _different_ module-private `WeakMap` registry → a fail-closed
    `DEID_NO_KEY` throw (it never leaked, but broke the documented "one context, any subpath" DX).
    Splitting emits the core (context, transforms, engine, manifest) as **one** shared chunk imported by
    every entry, so a single `DeidContext` registry is shared across all seven subpaths in ESM and CJS.
  - **Two date-shift fixes.** (1) ISO-datetime shifting is now **timezone-independent**: only the
    calendar-date portion is shifted (UTC math) and the time-of-day + zone travel through verbatim, so
    the same input yields the same output on every host regardless of `TZ` (the old path parsed a
    zoneless datetime as _local_ time and re-emitted UTC). (2) A `maxShiftDays` that floors to **0** now
    **fails closed** with the new fatal `DEID_CONTEXT_INVALID` — a zero-bound shift pins every offset to
    0, silently emitting the original real dates (a no-op shift is a leak).
  - **Honesty docs.** A new `docs-content/limitations.md` (the Known Limitations / honesty page) leads
    with _transforms per policy, never certifies; Safe Harbor implemented, Expert Determination supported
    not rendered; structured core only, free text block-by-default; DICOM metadata-only, pixel hazard
    flagged; NCPDP SCRIPT deferred; the ED report makes no determination; the LDS profile is not
    certified_ — wired into the docs sidebar.
  - **Fatal codes (additions-only):** `DEID_CONTEXT_INVALID`, `DEID_PROFILE_INVALID`. The stable code
    stability snapshot is updated deliberately.
  - **Founder-gated tail:** the actual `npm publish` and the public-repo flip (`PUB-FLIP`) remain the two
    standing human stops — this phase proves the package is release-shaped (dry-run only), it does not
    publish or flip.

- **DEID-9 — Expert-Determination _support_ report (never certification).** A new value-free reporting
  layer over the manifest every adapter emits (roadmap §Phase 9). `buildExpertDeterminationSupportReport`
  structures one manifest (or a corpus of manifests) into the facts a statistician reasons about for a
  HIPAA **Expert Determination** (45 CFR §164.514(b)(1)) — and the library **renders none**.
  - **Per-locus disposition, category coverage, retained-quasi-identifier inventory.** The report carries
    every acted-on locus (aggregated), coverage across **all 18** Safe Harbor categories in regulatory
    order (A→R, acted-on or not), a disposition roll-up, and — the residual an expert cares about most —
    the **retained-quasi-identifier inventory**: the coarse identifying residuals the pass recorded as
    `DEID_RESIDUAL_RETAINED` (year-only dates, safe 3-digit ZIP prefixes, exact ages ≤ 89), the
    §164.514(b)(2)(ii) actual-knowledge considerations.
  - **The hard boundary: `deid` makes NO determination.** The report **never** asserts the output "is
    de-identified", **never** computes or fabricates a re-identification **risk score**, and reaches no
    conclusion. `determination` is always `null`; `EXPERT_DETERMINATION_DISCLAIMER` leads. Over-claiming
    here would be a real compliance harm — the certification is the qualified expert's, always.
  - **Optional k-anonymity indicator — caller-supplied, descriptive only.** When the consumer supplies
    equivalence-class sizes (they hold the quasi-identifier values; the library has none), the report
    echoes the distinct-combination count, total records, sample-uniques, and the smallest
    equivalence-class size (the k-anonymity **indicator**) — stamped a descriptive input, **not** a risk
    score, **not** a determination, **not** a threshold the library evaluates. Absent when not supplied:
    the library never invents a number from the manifest alone.
  - **Value-free + deterministic + human-readable.** Like the manifest it summarizes, the report carries
    loci / categories / dispositions / counts, **never a PHI value**; it is deterministic and never
    mutates its input. `formatExpertDeterminationSupportReport` renders the same facts as Markdown for a
    statistician. New public surface: `buildExpertDeterminationSupportReport`,
    `formatExpertDeterminationSupportReport`, `EXPERT_DETERMINATION_DISCLAIMER`, and the types
    `ExpertDeterminationSupportReport`, `ExpertDeterminationReportOptions`, `CategoryCoverage`,
    `DispositionSummary`, `RetainedQuasiIdentifier`, `QuasiIdentifierClassInput`,
    `QuasiIdentifierStatistics`, `ReportDisposition`. `OUTPUT_LABEL` / `VERSION` moved to an internal
    `labels` module and re-exported unchanged (no consumer-visible change).

- **DEID-8 — free-text / narrative BYO redaction.** The known-hard concern, scoped honestly (roadmap
  §Phase 8). Free-text loci (HL7 `OBX-5` / `NTE`, C-CDA section `<text>`, FHIR `note` / `div`, X12 `MSG`
  / `NTE`, NCPDP free text) keep their **fail-closed default** (blocked, never emitted) and gain an
  **optional BYO redaction interface** so a consumer can redact prose in place instead of blocking it.
  - **BYO only — the library bundles no detector.** `DeidOptions.redactor` takes a consumer-supplied
    `FreeTextRedactor` (a function wrapping their regex/pattern engine or clinical-NER de-id model). The
    library ships **no** NLP model and **no** built-in regex scrub — a naive pass over clinical prose is
    a false-safety hazard — exactly the posture of the parsers' BYO profiles and terminology adapter.
  - **The fail-closed contract holds regardless of the redactor.** No redactor → block; the redactor
    throws → block; the redactor returns nothing (`null` / `undefined` / no string `text`) → block; the
    redactor returns `{ text }` → that prose is written back in place. A redactor is **never** allowed to
    leak free text through on failure.
  - **Consumer-asserted, surfaced as such.** A BYO-redacted locus is recorded with the new `byo-redact`
    transform and the new **additions-only** disposition code `DEID_FREETEXT_CONSUMER_REDACTED`. The
    engine does **not** re-scan the returned prose for residual PHI, and "no findings" from a BYO redactor
    is **not** an attestation — completeness is the consumer's responsibility (Expert-Determination
    territory). New types: `FreeTextRedactor`, `FreeTextRedactionRequest`, `FreeTextRedactionResult`.
  - **Structural guarantees unchanged.** The redactor handles the free _prose_ only. The structural PHI
    removal the six adapters perform and the clinical over-scrub guard are untouched; the manifest stays
    **value-free** on the redacted path (no input value, no redacted output, ever in the audit). The
    redactor flows through every text-format adapter (`hl7` / `ccda` / `fhir` / `x12` / `ncpdp`) via
    `DeidOptions`; DICOM's delegated PS3.15 metadata path is unaffected.

- **DEID-7 — the longitudinal layer: cross-document consistency + the key contract.** A format-agnostic
  layer over the six shipped adapters that keeps a longitudinal record **linkable** after de-identification.
  - **The corpus registry (`createDeidRegistry` / `DeidRegistry`).** `registry.forPatient(patientKey)`
    returns a memoized, deterministically-scoped `DeidContext`, so the same patient's dates shift by the
    **same offset** — intervals preserved exactly — across every document and every run.
    `registry.pseudonym(id)` and `registry.remapUid(uid)` give corpus-wide **consistent** surrogates so
    the same identifier / UID links everywhere, while distinct inputs never collide (keyed-HMAC
    collision-resistance). The registry holds the consumer's key in a module-private `WeakMap` and
    **redacts itself through every stringify channel** — the key and the per-patient offset never appear
    in an output, a manifest, or an error.
  - **The key contract, formalized.** The consumer supplies the HMAC key (and an optional distinct
    date-shift seed). There is **no weak default** — an absent/empty key is a fatal `DEID_NO_KEY`, never a
    silent fallback that would produce a re-identifiable surrogate. **Key rotation is intentional linkage
    breakage:** a new key deterministically produces different offsets and pseudonyms, so a corpus
    de-identified under a rotated key no longer links to records made under the old key. The library holds
    **no persistent key store** — key custody and lifetime are the consumer's.
  - **The label contract (`DEID_POLICY_INVALID`).** A policy that applies the interval-preserving
    `date-shift` transform may **not** carry the reserved `safe-harbor` label — a shifted-but-real date is
    still a date element (§164.514(b)(2)(i)(C)), so date-shift is Expert-Determination-supporting, **not**
    Safe Harbor. Enforced both when a policy is minted (`defineDeidPolicy`) and at point of use
    (`resolvePolicy`), so a hand-built policy object cannot slip a mislabel past the engine. This is an
    **additions-only** new fatal code (per the DEID-1 contract); the six adapters' per-format leak and
    over-scrub guarantees are unchanged.

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

- **The PHI commit gate's `--staged` route now enumerates a staged RENAME, and it was blind to one.**
  `R` (rename) and `C` (copy) are returned by none of `AM`, `AMT` or `AMTU`, so with git's rename
  detection on (the default, and `diff.renames` can turn copy detection on too) `git mv` of an
  already-tracked symlink into a scan root staged as `:120000 120000 <sha> <sha> R100`, the filter
  deleted the record before any mode could be read, and the route reported a clean corpus over a
  mode-120000 entry inside a scan root. Measured on git 2.39.5. Development tooling only
  (`scripts/phi-scan.ts` is not in `files` and ships in no tarball); no runtime code, public export,
  `DEID_*` code, policy, profile, manifest disposition or transformed value changes.
  - **The gap was at PRE-COMMIT, and the all-mode sweep was the backstop.** The walk refuses that
    same worktree, so the tree was not clean everywhere; `simple-git-hooks` runs
    `pnpm phi-scan --staged`, which is the route that missed it.
  - **It was never only a MODE gap.** A rename that also SUBSTITUTES a value stages as `R052`, and
    its new content went unread the same way: measured at exit 0, while naming the destination path
    directly returned the hits.
  - **The remedy is `--no-renames`, and it costs no stride work.** With detection off git emits no
    `R` and no `C` at all: the destination arrives as an ordinary single-path `A` and the source as a
    `D` the filter already drops. So the enumeration is a SUPERSET of the previous one (EQUAL when
    git emitted no `R` and no `C`, LARGER when it did), the
    two-field record stride is untouched, and the stride becomes STRUCTURAL rather than conditional
    on the caller's configuration. Swept across `diff.renames=true|copies|false|1` with
    `diff.renameLimit=1`: zero `R`/`C` records survive any of them.
  - **The previous disclosure was WRONG and is withdrawn, not deferred again.** The scanner's own
    banner and this repo's guide both said closing this needed "the two-path record shape handled,
    which is a scope decision". It needed one flag and no record-shape work at all.
  - **Pinned, and non-vacuous.** Five cases in `test/scripts/phi-scan.test.ts`: the moved symlink,
    the rename-plus-substitution, the configuration sweep, a real `C100` copy under
    `diff.renames=copies` (a copy is a distinct enumeration shape from a rename, not a spelling of
    it), and a no-regression control proving the source path's `D` is still dropped and other staged
    files still scan. Each asserts its premise
    (that git really emits `R`, and that `AMTU` really returns nothing for it) before asserting the
    remedy, so none can pass by fixture. **4 of the 5 run red against the previous scanner**; the
    fifth is the control and is green on both by design.
- **The PHI commit gate now sweeps all of `test/` and `scripts/`, not just `test/fixtures/` and
  `src/`.** 38 tracked files under `test/` were enumerated by **neither** of the scanner's routes —
  four of them already carrying inline HL7 `PID|…` literals — so a real name, MRN, DOB, SSN or email
  pasted into a test module committed with both gates green, in the package whose whole job is
  removing identifiers. Development tooling only (`scripts/phi-scan.ts` is not in `files` and ships
  in no tarball); no runtime code, public export, `DEID_*` code, policy, profile, manifest
  disposition or transformed value changes. Counted on the tree this landed on, not inherited.
  - **This is the WIDENING half.** The symbolic-link work below narrowed what the existing scopes
    ADMIT; it did not widen the scopes, and said so accurately. Both halves were needed.
  - **One scope, shared by both routes.** They disagreed before: the walk covered `test/fixtures/`
    plus all of `src/`, `--staged` covered `test/fixtures/**` plus `src/**.ts`. A single
    `isUnderScanRoot` now answers for both, so a path is in scope for the pre-commit hook exactly
    when it is in scope for the CI sweep. A staged `src/**.json`, anything under `test/` outside
    `fixtures/`, and all of `scripts/` — including the allow-list that DECLARES identifiers
    synthetic — were read by nothing.
  - **The roots were re-derived for this repo, not ported.** `mllp` walks `test/` but excludes `.ts`
    sources from it; copying that here would have closed **none** of the 38 files, because they are
    all `.ts`. `ccda` roots at the repo root, which this tree cannot do without walking
    `node_modules/`, `dist/`, `coverage/` and six binary `vendor/*.tgz`. Still out of scope, stated
    rather than implied: `.github/`, `docs-content/`, `vendor/`, and the root-level manifests.
  - **Enumerating the files was not enough, and shipping only that would have been a false claim.**
    Every HL7 message and NCPDP transmission here lives in a `.ts` module as a single-line string
    literal, so the bytes on disk carry a backslash and an `r` rather than a carriage return, and the
    structured detectors — which split on real CR/LF and on real `0x1C`/`0x1D`/`0x1E` — saw one
    undifferentiated line and detected nothing. Each file is now also scanned as its string literals,
    decoded and joined, IN ADDITION to its raw bytes. Measured: a name, MRN and DOB in an inline
    `PID` literal are reported at `PID-5.1` / `PID-3.1` / `PID-7.1`, and were silent before.
  - **And the RECOGNISERS had to be widened with it, or three formats got the floor and nothing
    else.** Every detector must recognise the document before it checks anything, and each was
    written for a file that IS the document. A conformance gate found four shapes the widened root
    swept and every detector then declined to read; each is now covered, each red before and green
    after, and each pinned:
    - **X12 required its 106-byte `ISA` at offset 0.** A `.ts` module never begins with `ISA` — its
      first bytes are an import statement — so three files carrying inline patient-entity
      interchanges read clean while the identical wire as a fixture returned five hard hits. The
      header is now found anywhere, on a non-alphanumeric boundary with a full 106 bytes and a
      non-alphanumeric terminator at the fixed offset, **and the same element separator again at
      offset 6, because ISA01 is exactly two characters wide** — without which a prose
      `ISA-IEA envelope` earlier in the file captured `-` as the separator and took a real
      interchange below it from four hits to one, or to none. Each terminator-delimited piece is
      then read **both** per LINE — so an interchange assembled from several literals, this repo's
      own `wrap()` idiom, is not glued to the literal before it — **and rejoined**, so a segment
      broken by a hard wrap does not lose every element after the break. In addition to, never
      instead of: dropping either loses real identifiers, each measured, each pinned by a case that
      goes red when its mechanism is removed.
    - **A bare `PID|…` line with no `MSH` above it read clean**, which is the single most likely
      thing to be pasted out of a ticket. A missing or mis-shaped header now falls back to the HL7
      default delimiters and keeps scanning, guarded by requiring the segment id to be followed by
      the field separator.
    - **An INDENTED segment** — a multi-line template literal, which is what prettier produces
      inside a nested block — was invisible to a column-0 segment anchor. Indentation is stripped
      **in the source-literal view only**: doing it in the raw view as well re-opened the "source
      syntax rides along on the last field" false red that taking the literals was introduced to
      fix, reporting a declared-synthetic DOB with a backtick and a semicolon attached.
    - **A source literal spells HL7's own backslash doubled**, so `MSH-2` arrived five characters
      long and the sub-component separator was read as the backslash rather than `&`.
      None of this is a claim that arbitrary embedded text is reached, and the banner in
      `scripts/phi-scan.ts` now says so: a fragment carrying neither a `urn:hl7-org:v3` namespace nor
      NCPDP control-char framing gets the floor only, a message assembled at run time from pieces no
      literal contains is not text this scan can see, two documents with different delimiters in one
      file are read with the first one's, prose that satisfies ISA's fixed widths by accident would
      still be preferred to the real header below it, and a segment broken across two source
      **literals** is not rejoined (across two **lines** it is).
  - **Widening a recogniser is a two-sided risk, and the second side cost a gate round.** The
    per-line X12 split that made the multi-literal idiom readable also stopped reading a segment
    broken by a hard wrap — a shape the code it replaced handled, because that code removed line
    breaks before splitting. A wrapped `NM1*IL` went from three patient identifiers at base to zero,
    silently, in the de-identification package. Every widened recogniser now carries a case that goes
    RED when its mechanism is removed, verified by removing each one.
  - **Two earlier drafts of that decode were wrong, both caught here.** Decoding the whole file in
    place carried the closing quote and comma of the source line onto the last field of the last
    segment, so a declared-synthetic DOB arrived with two characters of TypeScript attached and was
    reported as undeclared; and it took the delimiters from the first MSH-shaped text anywhere in the
    file, so an `MSH-9` in prose set the field separator to `-` and the detector then found nothing.
    Taking the literals fixes both: a literal's content is the wire text and nothing else, and prose
    in a comment is not a literal.
  - **A `${identifier.path}` substitution site is a hole, not a value.** Hand-written TypeScript
    reached the structured detectors for the first time, and a template that builds a document writes
    the placeholder, not the value. The rule is the tightest one that covers it — the WHOLE value must
    be a single placeholder containing only a dotted chain of identifiers — so `${"SMITH"}`,
    `${a + "SMITH"}` and `${t.given} SMITH` are all still hits.
  - **What the widened sweep found on this tree, and what was done about it.** Every value it
    surfaced was already synthetic and is now declared token-by-token in `scripts/phi-allow-list.txt`
    — except two in the release smoke, a plausible street and city, which were replaced with
    `ZZ`-tagged sentinels rather than declared. `19800101` is deliberately NOT declared and must stay
    undeclared: it is the date four positive tests use to prove the HL7, C-CDA, X12 and NCPDP
    detectors catch a real-looking DOB, so declaring it would make those four assert nothing. The two
    fixtures carrying it moved onto a declared date.
  - **One file is bypassed, and the cost is stated rather than hidden.** `test/scripts/phi-scan.test.ts`
    is the scanner's own suite, so its positive cases are necessarily real-looking violator literals;
    a suite that could pass its own scan would be asserting nothing. The bypass runs through the
    existing `--allow-fixture` + `phi-scan-overrides.md` mechanism, which now works in the two modes
    that actually run (the CI sweep and the pre-commit hook) instead of only in explicit-path mode.
    Real PHI pasted into that one file is not caught. Nothing else under `test/` is bypassed.
  - **A bypass may not rot, and may not be quiet.** A logged path must be an existing, non-`.md`
    regular file inside a scan root or the scan refuses (exit 2) — so a renamed, deleted or mistyped
    entry reddens instead of silently subtracting nothing, a directory can never be named, and a
    `.md` (never a scan target, so bypassing one subtracts nothing) is refused too. Every bypass that
    applies is announced on stderr on every run. The override log's own parser now skips fenced code
    blocks, because its `## Format` section shows the entry shape inside a fence and a flat sweep read
    that placeholder as a logged path.
  - **A scan ROOT that is not a directory now refuses the sweep.** The root is handed to
    `existsSync`/`readdirSync` directly, is never a `Dirent`, and both follow — so replacing `src`,
    `test` or `scripts` with a link to a directory made the sweep read a tree the repository does not
    contain. It gets the same lstat-based decision every entry under it already had.

- **`--staged` now enumerates an UNMERGED (`U`) entry, and refuses it.** Neither `AM` nor `AMT`
  returned one, so a path left conflicted by a merge was seen by that route at all. Measured on git
  2.39.5: `:100644 000000 <sha> 0000000 U` — a single path, so the record stride is unchanged, and
  the all-zero destination mode lands it in the existing non-regular refusal rather than in a read.
  That is the honest answer: `git show :<path>` has no stage-0 blob to hand back for a conflicted
  path, so the route cannot vouch for what would be committed. Development tooling only.

- **The scanner's exit codes now mean what they are documented to mean: 1 is HITS FOUND, and nothing
  else spends it.** `loadAllowList()` sat outside every handler and `readdirSync` inside the walk
  threw a plain `Error` that no `instanceof` arm matched, so a missing allow-list and an unreadable
  directory both escaped as uncaught exceptions — which Node exits **1** for. A gate that could not
  read its own allow-list reported the code that means "I read your corpus and found identifiers in
  it", and a caller distinguishing 1 from 2 was told the opposite of the truth. Catching by type was
  the mistake: the set of things that can fail is open, so failure is now the default path and a hit
  is the exception. Development tooling only.

- **The PHI commit gate no longer reads a symbolic link under a scan root as clean.** A link
  pointing at a file full of real identifiers passed **both** of the scanner's enumerating routes,
  in the package whose whole job is removing identifiers. Development tooling only
  (`scripts/phi-scan.ts` is not in `files` and ships in no tarball); no runtime code, public export,
  `DEID_*` code, policy, profile, manifest disposition or transformed value changes.
  - **Reproduced before any fix.** A synthetic name-bearing payload — an HL7 v2 message carrying a
    person name, a DOB, an MRN, a dashed SSN and an email at a non-test domain — placed outside the
    walk roots, with a link to it at `src/leak.ts`. The all-mode sweep printed `OK — no hits` and
    exited 0; the `--staged` sweep, after `git add`, did the same. Naming the link's **target**
    explicitly returned 8 hits and exited 1 — the two floor shapes plus six from this repo's own
    structured HL7 detector. The payload was never marginal; the two routes never looked at it.
  - **Two mechanisms, two fixes.** The walk enumerates `Dirent.isFile()`, an **lstat** answer, so a
    link is neither a file nor a directory and fell out of the loop with no record that anything was
    skipped; `isDirectory()` answers false for a linked directory too, so a whole subtree vanished
    the same way (measured). The `--staged` route reads content with `git show :<path>`, and git
    stores a symbolic link as its **target path** under mode `120000`, so it scanned the path text
    and never the target's bytes. That second route is this repo's `pre-commit` hook.
  - **Neither route follows the link.** Following would read bytes the enumeration does not control
    — outside the repo, a loop, a device, a FIFO that blocks the gate forever — and git does not
    carry those bytes anyway, so a hit on them would be a claim about something no commit contains.
    The enumeration is narrowed instead: an **in-scope** entry that is not a regular file **refuses
    the scan** (exit 2, the code the scanner already used for "could not complete"), naming every
    offender rather than the first. The decision is structural on both routes — the walk admits
    `isDirectory()` and `isFile()` and refuses what is left, `--staged` admits the two regular blob
    modes and refuses what is left — so an entry kind nobody enumerated is refused too, and the kind
    tokens are labels on that decision rather than the decision itself. `--staged` reads
    `git diff --cached --raw -z` instead of `--name-only` so the destination mode is visible at all;
    a `--raw` record that does not parse refuses rather than being skipped into a shortened list.
  - **`T` (typechange) is in the `--diff-filter`, and leaving it out made the mode check unreachable
    whenever the file being replaced was already tracked.** Replacing a **tracked** regular file
    with a link is neither an add nor a modify: git raises `:100644 120000 <sha> <sha> T`, so
    `--diff-filter=AM` deleted the record before any mode could be read and the hook passed the link
    green. Measured on git 2.39.5: with `AM` the raw output for that stage is empty. Typechange
    carries a single path, exactly like `A` and `M`, so admitting it costs the record stride
    nothing — and the reverse typechange, a link replaced by a real file bearing identifiers, is now
    scanned as the ordinary file it became.
  - **A refusal names the entry's own repo-relative path and an engine-owned kind token, never the
    link target** — a target path is text off the working tree and can itself carry identifiers.
    Asserted rather than argued: the pinning payload and the link target's own filename both carry a
    synthetic person name and DOB, and every refusal message is checked to contain none of it. No
    example target path is written into this entry or the source docblock for the same reason; the
    shape is described instead.
  - **What this does not cover, each measured.** Explicit-path mode already read through a link and
    reported the target's hits; unchanged. The `--staged` path scope is unchanged (`test/fixtures/**`
    and `src/**.ts`), so a staged link outside it is still not looked at — narrowing what a scope
    admits is not widening it. That scope also bounds the gitlink half: a submodule staged at
    `test/fixtures/nested` is refused, one at `src/nested` fails the `.ts` suffix and is not looked
    at. `R` (rename) and `C` (copy) are still **not** enumerated by `--staged` at all, and that
    costs the route a **mode** check as well as content: a staged rename that also appends
    identifiers passes it, and so does renaming an **already-tracked symlink**, which git raises as
    an `R` record with a `120000` destination — in scope by path, dropped by the filter before any
    mode is read (measured on git 2.39.5; `--staged` exits 0 while the all-mode walk refuses that
    same worktree with exit 2). The `--diff-filter` is part of this route's boundary, not just the
    path set, so "refuses mode `120000`" holds only of the records the filter admits. Pre-existing
    and a scope decision, not this one; if one ever reaches the parser the stride desyncs and it
    refuses. This repo has never
    had a rule that a scan observing **no** targets should refuse, and still does not. And the
    scanner still has no tolerance for a file that vanishes between enumeration and read — a
    different defect, which fails **closed** (a read failure refuses the whole sweep with exit 2,
    measured), deliberately not addressed here.

- **The `attw` publish gate no longer passes a tarball that carries no type declarations.**
  `attw`'s CLI exits **0** when the analysed package contains no types — `getExitCode()` opens with
  `if (!analysis.types) return 0`, before the problem list is read — so for a package that ships
  declarations for seven entry points, a broken `dist/` was reported in prose and scored as a pass.
  No `--profile`, `--ignore-rules` or config value reaches that early return.
  - **Measured on this package, with the invocation it runs (`--profile node16`).** `dist/` absent,
    and `dist/` built with every `.d.ts`/`.d.cts` deleted, both printed "This package does not
    contain types." and exited 0. Deleting only the **entry** declarations exits non-zero instead:
    the build emits shared declaration chunks the manifest never names, so a partial loss leaves
    `attw` something to analyse. It is total loss that is silent. Deleting only `dist/index.mjs` and
    `dist/index.cjs` still reports every `node16` resolution green and exits 0, a missing JavaScript
    entry point being invisible to a tool that analyses types.
  - **Total loss is a window in every build, not an exotic state.** The bundler writes JavaScript in
    one pass and declarations in a later one, leaving `dist/` with `.mjs`/`.cjs` and no declarations
    for a few seconds — 6.9 s and 10.0 s across two builds measured here, on a CPU-constrained
    machine where the figure moves with load. Deliberately **not** answered with a lock, lease or
    build queue: the gate must be able to report that its own inputs were missing, whatever removed
    them.
  - **Two nets, catching different things.** A preflight requires every relative path
    `package.json` promises — `main`, `module`, `types`, `typings`, every string leaf of `exports` —
    to exist and be non-empty, and names the ones that do not; it reaches the build window and the
    missing-JavaScript case. A post-check promotes an untyped report to a failure, reaching what the
    preflight structurally cannot: declarations on disk but excluded from the tarball by `files` or
    `.npmignore`. No instance of the latter has occurred here.
  - **The post-check reads printed output, so what would hide it is refused, not tolerated.**
    `--quiet`, `--format json` and an `.attw.json` setting either were each measured to return exit 0
    with the untyped sentence unreadable; `--config-path` is refused by inference rather than
    measurement, as it moves the config file out of view. Refusal is by option name and never by
    value, over two shapes: an argv token, and a combined short-option cluster containing `q` or `f`
    — `-Pf json` means `--pack --format json`, so `-f` is never a token, and a whole-token-only
    draft of this guard returned exit 0 on an untyped pack through it. Both shapes are asserted
    against the real tool; that is a statement about two shapes, not a guarantee that none remains,
    which is what the empty-transcript check is for.
  - **`--profile node16` is unchanged, and asserted rather than assumed.** The suite pins a fixture
    shaped like this package — subpath exports into a directory — that fails without the flag and
    passes with it, through the wrapper, plus the manifest line that supplies it.
  - **No consumer-visible behaviour moved**: no API, `DEID_*` code, policy, profile, manifest
    disposition, locus or transformed value changes. What changes is that a release cannot be cut
    from a `dist/` that failed to produce its declarations.

- **A C-CDA manifest row now names one position rather than several.** A C-CDA locus is a `/`-joined
  path of element names, and the manifest aggregates entries agreeing on **all five** of locus,
  category, transform, disposition and code — and two narratives blocked the same way agree on the
  other four — so two narrative positions printing the same path arrived as a single entry with
  `count: 2`. The body narrative descent printed no sibling index at all, so on the shipped
  two-section fixture both section narratives — Results and Medications — arrived as **one** row,
  `component/structuredBody/component/section/text`, `count: 2`.
  Both narratives were still blocked, and no dose, allergy, code system or patient identifier was
  ever mis-read; what was lost was the artifact's ability to say **which** narratives it had blocked,
  in the package whose README calls that artifact the value-free manifest. A `structuredBody` is a run
  of same-named `<component>`s and a `<section>` a run of same-named `<entry>`s, so this was the
  ordinary shape of the descent, not an edge case.
  - **One rule now, in one function, for both descents.** The header sweep and the body narrative
    descent compose a path segment the same way: the bounded local name, plus `[n]` — its index
    **among its document siblings that print the same segment name** — whenever more than one sibling
    prints that name, and always when the name was refused. Previously the two descents used
    different and undocumented bases (same-named siblings in the header, all children in the body),
    so a manifest could show `<withheld>[1]` and `<withheld>[3]` with nothing between them and no way
    to tell which scheme was in play.
  - **The index is a document position, not a row number, and `docs-content/guides-ccda.md` says so.**
    A sibling that yields no locus contributes no manifest row — an empty `<text>`, an `<entry>` whose
    narrative is a `<reference value="#…"/>` into the section rather than character data, a
    `nullFlavor`-only `<id>` — and the surviving rows keep their document indices. So a manifest can
    show `component[2]` with no `component[0]` or `component[1]`, which means those two siblings had
    nothing to record, not that rows are missing. The index is therefore **not** a counter derivable
    from the manifest alone, and the guide says to count the rows rather than the indices. (The
    header has always been able to gap this way — a `nullFlavor`-only `<id>` between two real ones
    yields `id[0]`, `id[2]` on every version — and that is now explained rather than only true.)
  - **A second collision, in the header counter, measured rather than reasoned about.** Its bucket key
    was `namespaceURI|name`, a distinction a path never prints: two refused siblings in _different_
    namespaces each counted as the only one of its kind, both printed a bare `<withheld>`, and
    aggregated into one row with `count: 2`. Reproduced with a `urn:hl7-org:v3` and a
    `urn:hl7-org:sdtc` sibling under one `<patient>`. The counter now keys on the printed name, which
    closes it — and the Security entry below, whose claim that "two refused positions remain distinct
    manifest rows" did not hold in exactly that case, holds now.
  - **A refused segment always carries its index**, where a lone refusal previously printed a bare
    `<withheld>`. It is not needed for distinctness there; it is needed because `<withheld>` names
    nothing, so the index is the only "where" that position has left.
  - **What existing C-CDA manifests do and do not lose.** C-CDA loci only — no other adapter shares
    this code, and the other five are untouched. A path changes only where more than one sibling
    prints the same segment name, or a name was refused; every other path is byte-identical. Measured
    on the shipped fixture: the transformed document is byte-for-byte unchanged and exactly one
    manifest row becomes two. Surrogates and date-shift offsets derive from the value and the key,
    never from a path, so no pseudonym moved. The one place a path change is more than cosmetic is a
    consumer routing a **BYO free-text redactor** on an exact C-CDA narrative path:
    `FreeTextRedactRequest.locus` carries the same path, so a route matching
    `component/structuredBody/component/section/text` exactly now needs the indexed form.
  - **Nothing about what is de-identified moved.** Every scrub decision dispatches on the **raw**
    local name and namespace, never on the printed segment, so a refused or re-indexed segment
    degrades an audit label and changes no transform.
  - **Not closed, and deliberately.** Some segments are fixed strings rather than element names —
    `structuredBody`, `nonXMLBody/text`, and an interval's `low` / `high` / `center` bounds. CDA
    allows each at most once at its position; a document that repeats one anyway still prints one path
    for both, exactly as before. `docs-content/guides-ccda.md` now states the index rule and this
    scope.
- **`README.md` no longer claims the package is absent from npm.** The opening summary read "not yet
  published to npm" on the very page npm renders, directly beneath the version in npm's own header,
  so the page contradicted itself and a reader had no way to tell which half was true. It now says
  the package is published and names no version, leaving `npm view @cosyte/deid version` as the one
  source of that fact; a quoted version is exactly how the equivalent line drifted elsewhere. The
  identical claim in `CLAUDE.md` is deliberately left alone, and so is this file's future-tense
  preamble about a release that has shipped: both belong to cross-repo items spanning several repos,
  and correcting one repo's copy inside this change would fragment them.
- **`PUBLIC-SURFACE-HYGIENE` (founder directive 2026-07-27): internal project bookkeeping removed from
  every surface a consumer reads, and the corrections that fell out of it.** Item identifiers, phase
  and roadmap-section language and ADR numbers are gone from `README.md`, `docs-content/` and the
  `src/` JSDoc that compiles into `dist/**/*.d.ts` + `*.d.cts` and renders on hover in a consumer's
  editor. Measured on `d105b6d` with the rule set that shipped with the gate: `src/` doc comments
  **105 hits (60 line-pass + 45 reflow-only) across 30 of 44 source files**, built `dist/**/*.d.ts`
  **49 lines** and `*.d.cts` **49 more**, npm metadata **0**, `src/` string literals **0** (over 1,134
  extracted literal lines), public markdown **0 by rule**. All now 0.
  - **The "0 by rule" figure was an artefact of the rule set, and this is the finding worth keeping.**
    The public markdown still carried **18 lines** of "arrive in later phases" / "are a deferred later
    phase", the clause-terminal shape the phase rule deliberately does not match, because
    determiner-plus-`phase` collides with ordinary clinical English ("the acute phase reactant", "a
    Phase III trial"). Cleared by hand, along with **19** bare `(§4.6)` roadmap-section citations and
    **17** clause-terminal instances in `src/`. A count is a function of the rule set.
  - **Seven of those 18 markdown lines were also factually false**, on pages published to
    docs.cosyte.com: they said no format adapter was wired and that the remaining adapters were still
    to come, in a package shipping all six, and that the bring-your-own free-text redaction interface
    was not yet available when it is (`redactor`). Corrected.
  - **Two limitations restated exactly rather than as pending work, because cutting the roadmap
    pointer would otherwise have upgraded each into a capability the code does not provide.** The X12
    guide and adapter docs said provider / organization identity could be suppressed with a widening
    policy. It cannot: the retention is structural, in the extractor, and no `DeidOptions`, policy or
    profile setting reaches it. `restricted-zip.ts` said a consumer needing a different Census vintage
    supplies their own via a policy. They cannot: `RESTRICTED_ZIP3` is a fixed export and
    `DeidPolicy` carries only `name` + `transforms`. Neither behaviour changed; both descriptions did.
  - **The class is now gated, which is the half that stops it regrowing.**
    `scripts/check-no-internal-refs.sh` (`pnpm check:no-internal-refs`) plus
    `.github/workflows/no-internal-refs.yml` scan `README.md`, `LICENSE`, `docs-content/`, the npm
    `description` + `keywords`, `src/` doc comments and `src/` string literals, line by line and
    paragraph-joined, and self-test in both directions before reporting. Ported from `ncpdp`'s copy
    (which carries the string-literal fourth pass, the plural phase stem and `/` in the ADR separator
    class) with `transform`'s `roadmap §` arms, which alone found 35 of this repo's citations. The
    negative self-tests pin the reference material a shape-keyed rule would destroy: `PID-3`, `OBX-5`,
    `CX-5`, `NM1-03`, `REF-01`, `ICD-10-CM`, `HL7-V2`, `FHIR-R4`, `DICOM-SR`, `NCPDP-SCRIPT`,
    `X12-837P`, and (checked against every rule) a bare `§164.514(b)(2)(i)(C)`. A rule keyed on `§`
    alone was considered and refused: `§` here is how this package cites the regulation it implements.
  - **A refuter refuted the first version of this gate, and the finding is worth keeping.** Three
    source files embed raw NUL bytes inside string literals: two in `context.ts` as an HMAC domain
    separator, eight in `manifest.ts` and `report.ts` as the field separator in a composite Map key.
    `awk` passed them into the string-literal pass buffer, GNU grep classified that whole buffer as
    binary, and a seeded violation therefore reported "binary file matches" against an already-deleted
    temp path, with no rule, no source file, no line number and remediation advice pointing at an
    encoding that is valid UTF-8. It exited through the incomplete-scan refusal, which runs before the
    located hits from the other three passes print. The gate still failed closed throughout, so
    nothing could escape it, but it could not say what it had caught. Both extractors now strip the
    byte, and the script header (which had asserted "it costs this pass nothing", naming one file
    instead of three) is corrected.
  - **A third pass then refuted the correction, which is the part worth recording.** The fix worked;
    the sentence justifying it did not. It claimed deleting the NUL "can only ever join two tokens
    into an over-report", and a refuter demonstrated the opposite on two inputs where deleting the
    byte erases a word boundary or completes a clinical lookbehind and flips a red to a green. It
    also called all ten NULs cryptography when eight are Map-key separators. The code is unchanged
    and the under-report is now written down as a residual with both demonstrated inputs, rather than
    traded for an equal and opposite one.
  - **No runtime behaviour, public API, policy, transform, disposition code, locus map or leak
    guarantee changed.** The full local ladder was green on the remediated tree: typecheck, lint,
    `format:check`, the PHI scan, 372 tests in 33 files, the gating coverage run, `build`, `attw` and
    `pnpm smoke`.
  - **Deferred, recorded rather than silently skipped.** Nine of this repo's thirteen pending
    changesets carry item identifiers, phase or roadmap-section language. The release pipeline's
    `release-notes.mjs` translates before it refuses, so it is not known whether they block a release
    here; that is a separate surface with a separate gate and it was not touched, because a live
    release run and an open version PR were in flight.

### Security

- **The value-free manifest could carry clinical narrative from a malformed document, on defaults,
  with no options set, and the Expert-Determination support report carried it onward.** Each
  per-format adapter names a manifest `locus` by interpolating the identifier at that position: an
  HL7 v2 segment id, a C-CDA element local name, a FHIR element name and `resourceType`, an X12
  segment id and `ST-01`, an NCPDP segment code. None of those was checked before it was
  interpolated, and none of the upstream parsers is obliged to hand back an identifier there: on a
  line or an element it cannot recognize, a parser reports whatever bytes stood in that position. On
  an unrecognized HL7 narrative continuation line that content is clinical prose, and it was written
  verbatim and unbounded into the manifest. Measured on the affected builds: a locus of 200,039 bytes
  from a 200,010-byte input, reproduced on `deidentifyHl7(msg, {})`, with the equivalent reproduced
  for C-CDA, FHIR, X12 and NCPDP. `buildExpertDeterminationSupportReport()` copies each locus into
  `perLocus`, so the leak travelled into the structured object a consumer is meant to hand to an
  outside statistician. `formatExpertDeterminationSupportReport()`'s Markdown rendering does not print
  loci and was not affected.

  **Every identifier read out of a document is now checked against the shape its position promises
  before it enters a locus**, against the cited spec for that format (HL7 v2 Ch. 2 §2.5 three-character
  segment identifiers; ASC X12.6 two-to-three-character segment ids and the three-character `ST-01`;
  the FHIR `[A-Za-z][A-Za-z0-9]{0,63}` element-name rule; an ASCII XML name with an explicit
  64-character ceiling, since the XML `Name` production has none; two-character NCPDP codes). A
  conforming identifier is returned **byte-identical**, so a well-formed document produces exactly the
  manifest it produced before.

  **The DICOM manifest is deliberately unchanged**, because its locus is not built from document bytes:
  the tag is normalised by the parser, the keyword is a static table string, and a sequence-context
  entry is a composed `TAG[index]`. Two regression tests now pin that, one on a sequence-context entry
  and one on a Part 6 attribute name longer than 64 characters.

  **A refusal is recorded rather than silently truncated.** A non-conforming identifier is refused
  whole (truncating to N characters would still emit the first N characters of the content) and the
  locus reads the new public `WITHHELD_LOCUS_TOKEN` (`<withheld>`) plus the structural index of that
  position, so two refused positions remain distinct manifest rows and no count is quietly merged.
  **Stated as a bound, not an impossibility:** content that happens to match the shape, such as a
  narrative line whose entire content is three letters, is indistinguishable from a real segment
  identifier and is still echoed.

  **Error messages were not affected and are unchanged.** Every `DeidError` this package raises is a
  fixed sentence with nothing interpolated.

  **If you have `0.0.2` installed:** upgrade, and treat any manifest, log, or Expert-Determination
  support report produced by `0.0.2` or earlier from input that was not spec-clean as potentially
  carrying PHI, on the same footing as the input document itself. The de-identified output documents
  were never affected: this was the audit artifact, not the wire.

- **`deidentifyDicom()` no longer returns a dataset carrying the input file's parse warnings.** The
  delegated PS3.15 Annex E pass copies `Dataset.warnings` across from the source dataset, so the
  de-identified `Dataset` arrived holding diagnostics written about the bytes as they were _before_
  anything was removed, and an upstream parse warning may quote a value it could not interpret (a
  55,093-byte warning was reproduced end to end from an unsupported Specific Character Set term). A
  parse warning about the input is not part of the de-identification contract, which is the same
  reasoning the C-CDA adapter already applies at its own re-parse. The warnings raised by the pass
  itself are unchanged and still returned on `DicomDeidResult.warnings`.

- **The CI checks that run on a pull request now block the merge.** Until now `main` had no
  branch-protection rules at all, so `ci` (typecheck, lint, format, the PHI scan, the tests, the
  gating coverage run, the build, `attw`, the dual ESM/CJS root-entry import check) and CodeQL could
  every one go red
  and the merge would still land, on the branch that publishes a de-identification package. A
  repository ruleset now requires those checks, restricted to the GitHub Actions app so a status of
  the same name cannot be posted by anything else, and blocks branch deletion and force-push on
  `main`. **Scope of the claim, stated narrowly:** this makes a red check _binding_; it does not make
  a check _correct_, and nothing inside this repository can observe the ruleset; the protection is
  not verifiable from these files. See the banner in `.github/workflows/ci.yml` before splitting a
  required job.
- **The release smoke (`pnpm smoke`) now runs in CI, and a red one blocks the merge.** It had been
  described in this file and in its own header as a CI gate after `build` while running in **no job**,
  here or in the shared pipeline; it had only ever run on the local verify ladder. A documented gate
  that never executes is worse than a missing one, because the description asserts a protection
  nothing provides. `.github/workflows/smoke.yml` now runs `pnpm build` then `pnpm smoke` on every
  pull request on the Node 22 and 24 matrix, and the branch ruleset requires both of its contexts.
  **This is not the same check as the shared pipeline's root-entry `Dual ESM/CJS smoke` step,** which
  stats and loads `dist/index.*` only and is blind to a broken subpath, a missing headline export, a
  regressed shared-core chunk and an HL7 leak through the built artifact. (That last one is scoped to
  HL7 on purpose; the cross-format zero-leak and clinical-survivor gates are `test/corpus/`, which
  runs from source under `pnpm test`.) **The smoke's scope is now derived rather than listed:** it
  reads the published subpaths out of `package.json`'s `exports`, excludes only entries that are
  structurally data (a bare `.json` target) rather than any hand-maintained key list, and refuses to
  run when its headline-export map disagrees with the rest. A subpath published without coverage
  fails the gate instead of being silently skipped.
- **What the required test job SELECTS is now checked, not just that the job ran.** A required job
  gates its steps; it does not gate what those steps select. `pnpm test` / `pnpm test:coverage` run
  whatever the `include` glob in `vitest.config.ts` selects, and the shared `@cosyte/vitest-config`
  supplies no `include` of its own, so that single repo-local line was the sole selector for every
  test here. Narrowing it to the per-format directories stopped `test/corpus/leak-corpus.test.ts` —
  the cross-format zero-leak and over-scrub corpus, this package's headline safety gate — with every
  required check still green. **Coverage could not backstop it:** coverage is measured over `src/`
  only, and the corpus re-walks `src/` paths the per-format suites already cover, so dropping it cost
  close to zero coverage percent, which is what made it silent rather than merely risky.
  `scripts/check-test-selection.ts` (`pnpm check:test-selection`, and
  `.github/workflows/test-selection.yml` under it) now asks vitest for its resolved selection and
  reds when a module in its subject is missing from it, so an `exclude`, a `projects` split and a
  narrowed `include` are all caught alike. Because resolving the config cannot see the command line,
  it separately requires the two test scripts CI invokes to equal one of two exact bodies, so a path
  filter, an alternate config, a project filter, a shard, a wrapper and a delegation to another
  script are simply not one of those bodies. **Its subject is derived, not listed:** the modules that
  must run are those importing one of the seven published `exports` subpaths, plus those referencing
  the PHI scanner, so no hand-editable list inside the gate decides its own scope. It re-proves on
  every run that it can still red, by seeding the removals it exists to catch, and it seeds three of
  its own derivations, which is not the same as proving the subject is derived large enough: it does
  not check that each subpath maps to its own source, and it does not cover the specifier resolver,
  so a change to either of those two functions is reviewed by a person or not at all. **Scope of the
  claim, stated
  narrowly:** 32 of the 33 test files are watched by a name-independent rule and the remaining one by
  the filename shape alone, which the check prints as a number; a config that can tell which run it
  is in is not caught (29 of 33 suites can stop running with the check green); a specifier rewritten
  into a form the check does not resolve, such as a substitution, a query suffix or a resolver alias,
  leaves its subject and is caught today by `typecheck` or `lint` rather than by this check; `.skip`
  inside a selected file is not selection and is not seen; and the new context is deliberately not
  required by the ruleset until it has run on `main`.
- **Weekly dependency version updates are now watched.** The repository had no Dependabot
  configuration, so its zero open update PRs meant nothing was looking, not that nothing was stale.
  Scoped honestly: this buys _version_ updates on a schedule, not automatic security-fix PRs, which
  are a repository setting rather than a config key. The config records what it still cannot see
  either, chiefly that the sibling parsers are consumed from `file:` tarballs under `vendor/`, which
  Dependabot does not bump.
- Pseudonymization/keyed-hash are **keyed** (HMAC-SHA-256) by design: an unsalted hash of an identifier
  is re-identifiable (§164.514(c)). The engine never falls back to an unkeyed transform; the key and the
  per-patient date-shift offset never appear in the output or manifest.

[Unreleased]: https://github.com/cosyte/deid/commits/main
