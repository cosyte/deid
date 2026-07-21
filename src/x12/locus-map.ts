/**
 * The **X12 locus map** — the cited table of *where* the 18 HIPAA Safe Harbor identifier categories
 * live in the `@cosyte/x12` structural model, per segment. This is the consumer-tier thesis (roadmap
 * §5) applied to HIPAA 005010 EDI: PHI is located **structurally at the parser's loci** (segment id +
 * 1-indexed element position), never by regex over the raw bytes. A name is at `NM1-03..07` because
 * the X12 TR3 says so, not because a string "looked like" a name.
 *
 * X12 is a flat, ordered segment stream (Interchange → Group → Transaction → Segment); loops (HL
 * hierarchical levels — subscriber 2000B/2010BA, patient 2000C/2010CA) are implicit. The map is
 * therefore expressed **per segment id** plus two **qualifier classifiers** that route an identifier by
 * its own qualifier element — the structural, parser-typed way to tell an SSN from a member id from a
 * provider NPI (§4.4 knife-edge), independent of loop position:
 *
 * - **{@link classifyNm1Entity}** — the `NM1-01` entity-identifier code decides whether an `NM1` names a
 *   **patient-side individual** (subscriber / patient / dependent → scrub name + id) or a **recognized
 *   provider / organization** (retained as non-patient identity, mirroring the HL7 adapter's retention of
 *   provider segments). An **unrecognized** entity code **fails closed** — its name and id are blocked,
 *   because an unknown entity could be the patient.
 * - **{@link classifyRefQualifier}** — the `REF-01` qualifier decides whether `REF-02` is a **patient
 *   identifier** (SSN removed; member / subscriber / group / medical-record pseudonymized) or a
 *   **recognized administrative / provider reference** (payer claim-control number, provider tax id,
 *   prior-authorization number → retained). An **unrecognized** qualifier **fails closed** (blocked) —
 *   the direct implementation of Safe Harbor category (R) for the "unusual REF qualifier" attack.
 *
 * Address (`N3` / `N4`), telecom (`PER`), and demographic date (`DMG-02`) loci are handled **universally**
 * (regardless of which loop's entity they belong to): a street / city / phone / date-of-birth is removed
 * or generalized wherever it sits. This is the fail-closed choice — it cannot miss a patient address by
 * mis-tracking an implicit loop boundary; it over-generalizes a *provider's* address instead, which is
 * safe (a provider address is never clinical data, so the over-scrub guard is untouched).
 *
 * Element positions are grounded in the HIPAA 005010 TR3 segment definitions (NM1, N3, N4, DMG, PER,
 * REF, DTP, DTM, CLM, CLP) and verified against the sibling `@cosyte/x12` transaction walkers.
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";

const C = SAFE_HARBOR_CATEGORIES;

/**
 * How the extractor turns a mapped X12 element into a locus and how the applier rewrites it:
 *
 * - `redact` — a whole-element direct identifier with no analytic value (a name component, a telecom
 *   number, a street line). The element is cleared to `""`.
 * - `date` — an element carrying a date/time (DOB, service/adjudication date). Generalized to year.
 * - `zip` — an element carrying a postal code (`N4-03`). Generalized to the safe 3-digit form.
 * - `id` — an element carrying an identifier value, its Safe Harbor category resolved **per element**
 *   from a sibling qualifier element via {@link classifyRefQualifier} / {@link classifyNm1Entity}: SSN
 *   removed, member / subscriber / account pseudonymized to a consistent surrogate.
 * - `block` — a geographic or unclassified value with no clean structured generalization (a city name,
 *   an unknown-entity name). Fails **closed**: removed and recorded as category (R), never passed
 *   through.
 */
export type X12ElementMode = "redact" | "date" | "zip" | "id" | "block";

/**
 * A mapped PHI-bearing element within a segment: the 1-indexed element position and how to handle it.
 * A `category` is carried for the direct modes; `id` mode resolves its category dynamically at
 * extraction time from the routing qualifier, so it omits a static category.
 */
export interface X12ElementRule {
  /** 1-based X12 element position (e.g. `3` for `NM1-03`). */
  readonly element: number;
  /** How to extract and rewrite the element. */
  readonly mode: X12ElementMode;
  /** The Safe Harbor category, for the direct modes (`redact` / `date` / `zip`). */
  readonly category?: SafeHarborCategory;
}

/**
 * The **provider / organization** `NM1-01` entity-identifier codes whose name and identifiers are
 * **retained** — they are the transaction's providers, payers, facilities, submitters, and receivers,
 * not the patient or a relative, so their identity is not the individual's Safe Harbor PHI (the X12
 * analogue of the HL7 adapter retaining `ROL` / `STF` / `PRD` provider segments untouched). Grounded in
 * the HIPAA 005010 TR3 entity-identifier code list (X12 element 98).
 *
 * @example
 * ```ts
 * import { PROVIDER_ENTITY_CODES } from "@cosyte/deid/x12";
 *
 * PROVIDER_ENTITY_CODES.has("85"); // => true  (billing provider — retained)
 * PROVIDER_ENTITY_CODES.has("QC"); // => false (patient — scrubbed)
 * ```
 */
export const PROVIDER_ENTITY_CODES: ReadonlySet<string> = new Set<string>([
  "85", // Billing Provider
  "87", // Pay-to Provider
  "82", // Rendering Provider
  "77", // Service Facility Location
  "FA", // Facility
  "80", // Hospital
  "71", // Attending Provider
  "72", // Operating Physician
  "73", // Other Physician (Operating)
  "DN", // Referring Provider
  "DK", // Ordering Provider
  "DQ", // Supervising Provider
  "P3", // Primary Care Provider
  "1P", // Provider
  "GB", // Other Provider (per-context provider role)
  "SJ", // Service Provider
  "DD", // Assistant Surgeon
  "PR", // Payer
  "PE", // Payee
  "2B", // Third-Party Administrator
  "36", // Employer (an organization, not the individual)
  "40", // Receiver
  "41", // Submitter
  "45", // Drop-off Location
  "TT", // Transfer To
  "GP", // Gateway Provider
  "AY", // Clearinghouse
]);

/**
 * The **patient-side individual** `NM1-01` entity-identifier codes whose name and identifiers are
 * **scrubbed** — the subscriber / insured, the patient, the dependent, and the responsible party are
 * the covered individual and their relatives (§4.6). Grounded in the HIPAA 005010 TR3 entity-identifier
 * code list (X12 element 98).
 *
 * @example
 * ```ts
 * import { PATIENT_ENTITY_CODES } from "@cosyte/deid/x12";
 *
 * PATIENT_ENTITY_CODES.has("IL"); // => true  (insured / subscriber — scrubbed)
 * ```
 */
export const PATIENT_ENTITY_CODES: ReadonlySet<string> = new Set<string>([
  "IL", // Insured or Subscriber
  "QC", // Patient
  "03", // Dependent
  "QD", // Responsible Party
  "GD", // Guardian
  "74", // Corrected Insured
  "S1", // Insured (secondary)
  "S3", // Legal Representative
]);

/** How an `NM1` segment is classified for de-identification. */
export type Nm1Disposition = "patient" | "provider" | "unknown";

/**
 * Classify an `NM1` from its `NM1-01` entity-identifier code (X12 element 98): a **patient-side**
 * individual (scrub name + id), a recognized **provider / organization** (retain), or an **unknown**
 * entity (fail closed — block name + id, because an unrecognized entity could be the patient). This is
 * the structural, parser-typed inversion of a shape guess: an `NM1` is the patient's because the TR3
 * entity code says so, never because a string "looked like" a name.
 *
 * @param entityCode - The `NM1-01` entity-identifier code (e.g. `"IL"`, `"QC"`, `"85"`).
 * @returns The disposition governing how the name and id elements are handled.
 * @example
 * ```ts
 * import { classifyNm1Entity } from "@cosyte/deid/x12";
 *
 * classifyNm1Entity("QC"); // => "patient"
 * classifyNm1Entity("85"); // => "provider"
 * classifyNm1Entity("ZZ"); // => "unknown"  (fails closed)
 * ```
 */
export function classifyNm1Entity(entityCode: string): Nm1Disposition {
  const code = entityCode.toUpperCase();
  if (PATIENT_ENTITY_CODES.has(code)) return "patient";
  if (PROVIDER_ENTITY_CODES.has(code)) return "provider";
  return "unknown";
}

/**
 * Resolve the Safe Harbor category for an `NM1-09` identifier from its `NM1-08` identification-code
 * qualifier (X12 element 66): `34` is an **SSN** (removed); `MI` / `II` / `MC` / `MA` / `MB` denote a
 * **member / beneficiary** number (pseudonymized); an **unrecognized** qualifier returns `undefined`,
 * which the extractor turns into a fail-closed block (an unknown identifier at a patient locus is
 * category (R)). A provider `NM1` never reaches here — it is retained whole.
 *
 * @param qualifier - The `NM1-08` identification-code qualifier.
 * @returns The resolved Safe Harbor category, or `undefined` to force a fail-closed block.
 * @example
 * ```ts
 * import { categoryForNm1IdQualifier } from "@cosyte/deid/x12";
 *
 * categoryForNm1IdQualifier("34"); // => "SSN"
 * categoryForNm1IdQualifier("MI"); // => "HEALTH_PLAN_BENEFICIARY"
 * ```
 */
export function categoryForNm1IdQualifier(qualifier: string): SafeHarborCategory | undefined {
  switch (qualifier.toUpperCase()) {
    case "34": // Social Security Number
      return C.SSN;
    case "MI": // Member Identification Number
    case "II": // Standard Unique Health Identifier for each Individual
    case "MC": // Medicaid / Medicare
    case "MA": // Medicare
    case "MB": // Member (alt)
    case "C": // Insured's Changed Unique Identification Number
    case "ZZ": // Mutually defined (member context) — conservative: treat as member id
      return C.HEALTH_PLAN_BENEFICIARY;
    default:
      return undefined; // fail closed
  }
}

/** How a `REF` value is classified for de-identification. */
export type RefDisposition =
  | { readonly kind: "phi"; readonly category: SafeHarborCategory }
  | { readonly kind: "retain" }
  | { readonly kind: "block" };

/**
 * The `REF-01` qualifiers whose `REF-02` value is a **patient / member identifier** — removed (SSN) or
 * pseudonymized (member / subscriber / group / medical-record). Grounded in the HIPAA 005010 TR3
 * reference-identification qualifier list (X12 element 128).
 */
const REF_PHI_QUALIFIERS: Readonly<Record<string, SafeHarborCategory>> = {
  SY: C.SSN, // Social Security Number
  "1W": C.HEALTH_PLAN_BENEFICIARY, // Member Identification Number
  "0F": C.HEALTH_PLAN_BENEFICIARY, // Subscriber Number
  "1L": C.HEALTH_PLAN_BENEFICIARY, // Group or Policy Number
  IG: C.HEALTH_PLAN_BENEFICIARY, // Insurance Policy Number
  EA: C.MRN, // Medical Record Identification Number
  "23": C.ACCOUNT, // Client Number
  "6P": C.HEALTH_PLAN_BENEFICIARY, // Group Number
  "1H": C.HEALTH_PLAN_BENEFICIARY, // CHAMPUS/TRICARE Identification Number — the individual's beneficiary id
};

/**
 * The `REF-01` qualifiers whose `REF-02` value is a **recognized administrative / provider reference** —
 * a payer claim-control number, a provider tax / license / commercial id, a prior-authorization or
 * referral number, a location number. These are not the patient's identifiers and carry no clinical
 * meaning to destroy, so they are **retained** (the over-scrub guard for X12 references). Grounded in
 * the HIPAA 005010 TR3 reference-identification qualifier list (X12 element 128).
 */
const REF_RETAIN_QUALIFIERS: ReadonlySet<string> = new Set<string>([
  "F8", // Original Reference Number / Payer Claim Control Number
  "D9", // Claim Number
  "6R", // Provider Control Number (line item control number)
  "EI", // Employer's Identification Number (EIN)
  "TJ", // Federal Taxpayer's Identification Number
  "2U", // Payer Identification Number
  "G1", // Prior Authorization Number
  "9F", // Referral Number
  "BB", // Authorization Number
  "G3", // Predetermination of Benefits Identification Number
  "1G", // Provider UPIN Number
  "1J", // Facility ID Number
  "0B", // State License Number
  "G2", // Provider Commercial Number
  "LU", // Location Number
  "N5", // Provider Plan Network Identification Number
  "N7", // Facility Network Identification Number
  "1B", // Blue Shield Provider Number
  "1C", // Medicare Provider Number
  "1D", // Medicaid Provider Number
  "FY", // Claim Office Number
  "PQ", // Payee Identification
  "RB", // Rate Code Number
  "EO", // Submitter Identification Number
  "4N", // Special Payment Reference Number
]);

/**
 * Classify a `REF` from its `REF-01` qualifier (X12 element 128): a **patient identifier** (SSN removed;
 * member / subscriber / group / medical-record pseudonymized), a recognized **administrative /
 * provider reference** (retained), or an **unrecognized** qualifier (fail closed — blocked). Blocking
 * the unknown qualifier is the direct implementation of Safe Harbor category (R): a value the map
 * cannot positively classify as safe at an identifier-bearing locus is treated as a candidate
 * identifier and removed, never passed through.
 *
 * @param qualifier - The `REF-01` reference-identification qualifier.
 * @returns The disposition governing how `REF-02` is handled.
 * @example
 * ```ts
 * import { classifyRefQualifier } from "@cosyte/deid/x12";
 *
 * classifyRefQualifier("SY"); // => { kind: "phi", category: "SSN" }
 * classifyRefQualifier("F8"); // => { kind: "retain" }
 * classifyRefQualifier("ZZ"); // => { kind: "block" }  (unknown → fail closed)
 * ```
 */
export function classifyRefQualifier(qualifier: string): RefDisposition {
  const q = qualifier.toUpperCase();
  const phi = REF_PHI_QUALIFIERS[q];
  if (phi !== undefined) return { kind: "phi", category: phi };
  if (REF_RETAIN_QUALIFIERS.has(q)) return { kind: "retain" };
  return { kind: "block" };
}

/**
 * The universal (loop-independent) segment element rules — applied to every occurrence of these
 * segments regardless of which loop's entity they belong to. `NM1`, `REF`, `CLM`, and `CLP` are handled
 * by dedicated logic (entity / qualifier classification) in the extractor and are not listed here.
 *
 * - `N3` — Address Information: both address lines removed (street PHI, no clean generalization).
 * - `N4` — Geographic Location: city removed, ZIP generalized to 3 digits; state / country retained.
 * - `DMG` — Demographic Information: `DMG-02` date of birth generalized to year (only ever the
 *   individual's — `DMG` appears solely in member loops); `DMG-03` gender retained.
 * - `PER` — Administrative Communications Contact: contact name and every communication number removed;
 *   the function and qualifier codes retained.
 * - `DTP` — Date or Time Period: `DTP-03` date value generalized to year (a date of the individual's
 *   care under §164.514(b)(2)(i)(C)); qualifier / format retained.
 * - `DTM` — Date/Time Reference (835): `DTM-02` date value generalized to year.
 *
 * @example
 * ```ts
 * import { X12_UNIVERSAL_SEGMENT_RULES } from "@cosyte/deid/x12";
 *
 * X12_UNIVERSAL_SEGMENT_RULES.N4?.find((r) => r.element === 3)?.mode; // => "zip"
 * ```
 */
export const X12_UNIVERSAL_SEGMENT_RULES: Readonly<Record<string, readonly X12ElementRule[]>> =
  Object.freeze({
    N3: [
      // Street lines are geographic PHI with no clean structured generalization — removed (fail closed,
      // category (R)), never generalized: a street number ("100 MAIN ST") would survive a ZIP-style
      // digit reduction, so it must be blocked outright, exactly as the city (N4-01) is.
      { element: 1, mode: "block" }, // N3-01 Address Line 1
      { element: 2, mode: "block" }, // N3-02 Address Line 2
    ],
    N4: [
      { element: 1, mode: "block" }, // N4-01 City (geographic, no clean generalization → removed)
      { element: 3, mode: "zip", category: C.GEOGRAPHIC }, // N4-03 Postal Code → 3-digit
    ],
    DMG: [
      { element: 2, mode: "date", category: C.DATES }, // DMG-02 Date of Birth → year
    ],
    PER: [
      { element: 2, mode: "redact", category: C.NAMES }, // PER-02 Name
      { element: 4, mode: "redact", category: C.PHONE }, // PER-04 Communication Number
      { element: 6, mode: "redact", category: C.PHONE }, // PER-06 Communication Number
      { element: 8, mode: "redact", category: C.PHONE }, // PER-08 Communication Number
    ],
    DTP: [
      { element: 3, mode: "date", category: C.DATES }, // DTP-03 Date/Time Value → year
    ],
    DTM: [
      { element: 2, mode: "date", category: C.DATES }, // DTM-02 Date → year
    ],
  });

/**
 * The **geographic** segments (`N3` address lines, `N4` city/state/ZIP) whose *unmapped* elements must
 * **fail closed** — unlike the demographic segments (`DMG`/`PER`), a geographic segment can carry an
 * un-enumerated location identifier (`N4-06` Location Identifier could be a county / geocode). So for
 * these segments the extractor blocks any populated element that is neither a mapped rule nor on the
 * per-segment {@link X12_GEO_RETAIN_ELEMENTS} safe list — rather than retaining it. `N3` retains nothing
 * (both lines are removed); `N4` retains only the state and country (the Safe Harbor geographic level
 * that is kept), so the city, ZIP, and any finer location identifier are handled or blocked.
 */
export const X12_GEO_SEGMENTS: ReadonlySet<string> = new Set<string>(["N3", "N4"]);

/**
 * The `N3` / `N4` element positions that are recognized **non-identifying** geography and are retained:
 * `N4-02` (state) and `N4-04` (country). Every other populated element of a geographic segment is either
 * a mapped rule (city removed, ZIP generalized) or an unmapped element that **fails closed** (blocked).
 *
 * @example
 * ```ts
 * import { X12_GEO_RETAIN_ELEMENTS } from "@cosyte/deid/x12";
 *
 * X12_GEO_RETAIN_ELEMENTS.N4?.has(2); // => true  (state — retained)
 * X12_GEO_RETAIN_ELEMENTS.N4?.has(6); // => false (a location identifier — blocked)
 * ```
 */
export const X12_GEO_RETAIN_ELEMENTS: Readonly<Record<string, ReadonlySet<number>>> = Object.freeze(
  {
    N3: new Set<number>(),
    N4: new Set<number>([2, 4]),
  },
);

/**
 * Segments whose `-01` element is a **patient account / control number** (Safe Harbor category (J)),
 * pseudonymized to a consistent surrogate so claims still link without the number being reversible.
 * The rest of the segment (charge amounts, facility-code composites, frequency codes) is clinical /
 * financial and retained.
 *
 * - `CLM-01` (837) — Patient Control Number / Claim Submitter's Identifier.
 * - `CLP-01` (835) — Patient Control Number (echoed from the claim).
 *
 * @example
 * ```ts
 * import { X12_ACCOUNT_SEGMENTS } from "@cosyte/deid/x12";
 *
 * X12_ACCOUNT_SEGMENTS.has("CLM"); // => true
 * ```
 */
export const X12_ACCOUNT_SEGMENTS: ReadonlySet<string> = new Set<string>(["CLM", "CLP"]);

/**
 * The recognized **clinical / financial / envelope** segments retained (passed through untouched) — the
 * positive half of the fail-closed rule for X12 (the analogue of the HL7 adapter's `RETAIN_SEGMENTS`).
 * These carry diagnosis / procedure / revenue codes, monetary amounts, quantities, adjustments, and
 * control structure — **no direct patient or relative Safe Harbor identifier** — so their values must
 * survive the over-scrub test byte-identical. A segment that is neither mapped (`NM1` / `N3` / `N4` /
 * `DMG` / `PER` / `REF` / `DTP` / `DTM` / `CLM` / `CLP`) nor on this list **fails closed** — every one
 * of its elements is blocked, so an unknown segment can never ride a patient identifier through in the
 * clear.
 *
 * **Documented Phase-5 limitation (mirrors the HL7 adapter).** Retained clinical segments may still
 * carry patient-related *dates* not surfaced as `DTP` / `DTM` (e.g. a `DTM` inside a retained 837 loop
 * the map does not descend, or a service-line date), and administrative per-claim references (a
 * prescription number, a prior-authorization number). Selective scrubbing of those residual loci is a
 * later phase; forgetting a clinical segment here fails **safe** — it is blocked, not leaked.
 *
 * @example
 * ```ts
 * import { X12_RETAIN_SEGMENTS } from "@cosyte/deid/x12";
 *
 * X12_RETAIN_SEGMENTS.has("HI");  // => true  (diagnosis codes — retained)
 * X12_RETAIN_SEGMENTS.has("NM1"); // => false (identity — mapped, not retained)
 * ```
 */
export const X12_RETAIN_SEGMENTS: ReadonlySet<string> = new Set<string>([
  // Envelope / control (ISA/GS/GE/IEA/ST/SE are outside the transaction body walk, but listed for safety)
  "ST",
  "SE",
  "BHT",
  "BGN",
  // Hierarchy spine
  "HL",
  // Claim structure / financial (CLM/CLP are handled by X12_ACCOUNT_SEGMENTS, not retained wholesale)
  "AMT",
  "SBR", // Subscriber Information (relationship / group name codes, no direct identifier value)
  "PAT", // Patient Information (relationship / weight / date-qualifier — dates handled via DTP)
  "CAS", // Claim/Line Adjustment (group + reason codes + amounts)
  "MOA", // Outpatient Adjudication remarks (codes/amounts)
  "MIA", // Inpatient Adjudication remarks
  "QTY", // Quantity
  "LQ", // Industry Code (remark codes)
  "LX", // Transaction Set Line Number
  // Diagnosis / procedure / clinical codes
  "HI", // Health Care Diagnosis / procedure codes
  "SV1", // Professional Service
  "SV2", // Institutional Service Line
  "SV3", // Dental Service
  "SV5", // Durable Medical Equipment Service
  "SVC", // Service Payment Information (835)
  "SVD", // Service Line Adjudication
  "TOO", // Tooth Identification
  "CR1", // Ambulance Certification
  "CR2", // Chiropractic Certification
  "CR3", // Durable Medical Equipment Certification
  "CRC", // Conditions Indicator
  "HCP", // Health Care Pricing
  "CN1", // Contract Information
  "PS1", // Purchased Service
  "K3", // File Information
  "MEA", // Measurements
  "PWK", // Paperwork
  "LIN", // Item Identification (NDC drug code)
  "CTP", // Pricing Information
  "HSD", // Health Care Services Delivery
  "UR", // Peer Review Organization
  // Eligibility / benefit (271)
  "EB", // Eligibility or Benefit Information (coded)
  "EQ", // Eligibility or Benefit Inquiry
  "III", // Information (coded)
  "MSG", // Message Text (retained; free-text handled below only where flagged)
  "TRN", // Trace (reassociation trace — payer/provider control, not patient-derived)
  "AAA", // Request Validation
  "INS", // Insured Benefit (relationship / maintenance codes)
  "HD", // Health Coverage (coverage codes)
  "DSB", // Disability Information
  "REL", // Relationship
  // 820 premium
  "BPR", // Beginning Segment for Payment Order/Remittance (bank/amount)
  "ENT", // Entity
  "RMR", // Remittance Advice Accounts Receivable Open Item Reference
  "ADX", // Adjustment
  "N1", // Party Identification (organization name — payer/provider org, not the individual)
  // 999 / TA1 acknowledgements (structurally PHI-free)
  "AK1",
  "AK2",
  "AK9",
  "IK3",
  "IK4",
  "IK5",
  "CTX",
]);
