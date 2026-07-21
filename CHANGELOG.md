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
