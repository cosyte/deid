/**
 * The **HL7 v2 locus map** — the cited table of *where* the 18 HIPAA Safe Harbor identifier categories
 * live in the `@cosyte/hl7` structural model, per segment. This is the whole thesis of the consumer
 * tier (roadmap §5): PHI is located **structurally at the parser's loci**, never by regex over the raw
 * bytes. A name is at PID-5 because the HL7 v2 standard says PID-5 is the patient name — not because a
 * string "looked like" a name.
 *
 * Each rule names a segment field, the Safe Harbor category it carries, and the **handling mode** that
 * tells the extractor how to turn it into a generic {@link LocusRule} the format-agnostic engine can
 * transform. Relatives / guarantor / insured loci (NK1 / GT1 / IN1 / IN2) are first-class — Safe Harbor
 * removes identifiers of the individual **and of relatives, employers, and household members**
 * (§164.514(b)(2)(i); roadmap §4.6), and missing them is the common real-world leak.
 *
 * Field positions are grounded in the HL7 v2.x segment definitions (PID, NK1, GT1, IN1, IN2). Only the
 * well-known PHI-bearing fields are mapped; a field absent from this map inside a **mapped** segment is
 * a recognized non-identifier position (e.g. PID-8 sex, PID-15 language) and is **retained untouched**
 * (the over-scrub guard). Genuinely unrecognized structure — Z-segments and segments unknown to the
 * parser — fails **closed** (see `../hl7/extract`).
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";

/**
 * How the extractor turns a mapped HL7 field into loci and how the applier writes the result back:
 *
 * - `redact` — a whole-field direct identifier with no analytic value (name, phone, email, SSN,
 *   licence). One locus per field; the field is cleared (or, under a deviating policy, replaced).
 * - `date` — a whole-field date/timestamp (DOB, death date). One locus per field; generalized to year.
 * - `id` — a repeating identifier field (CX list: MRN / account / member id). **One locus per
 *   repetition** so each identifier gets its own consistent surrogate; only the id-number component
 *   (CX.1) is replaced, the assigning authority / type code are retained.
 * - `address` — a structured address (XAD). **One locus per repetition**; the Safe Harbor 3-digit-ZIP
 *   generalization is applied and every finer geographic component (street / city / county) is dropped.
 * - `block` — a geographic or other identifier with no clean structured generalization (county code,
 *   birth place). Fails **closed**: removed and recorded, never passed through.
 */
export type Hl7FieldMode = "redact" | "date" | "id" | "address" | "block";

/**
 * A single mapped PHI-bearing field within a segment.
 */
export interface Hl7FieldRule {
  /** 1-based HL7 field number (e.g. `5` for PID-5). */
  readonly field: number;
  /** The Safe Harbor category this field carries. */
  readonly category: SafeHarborCategory;
  /** How to extract and write the field back. */
  readonly mode: Hl7FieldMode;
  /**
   * For `id` fields only: when `true`, the category is resolved **per repetition** from the CX-5
   * identifier-type code (`SS` → SSN, `MR` → MRN, `AN`/`AC` → account, `MA`/`MB`/`PN` → beneficiary),
   * falling back to {@link category} for an unrecognized or absent type code. This is the structural,
   * parser-typed way to tell an SSN from an MRN inside one PID-3 list (§4.4 knife-edge).
   */
  readonly routeByTypeCode?: boolean;
}

const C = SAFE_HARBOR_CATEGORIES;

/**
 * **PID — Patient Identification.** The patient's own identifiers and demographics.
 * Grounded in the HL7 v2.x PID segment definition.
 */
const PID_RULES: readonly Hl7FieldRule[] = [
  { field: 2, category: C.MRN, mode: "id" }, // PID-2  Patient ID (external, CX)
  { field: 3, category: C.MRN, mode: "id", routeByTypeCode: true }, // PID-3  Patient Identifier List (CX~), route SS/MR/AN
  { field: 4, category: C.MRN, mode: "id" }, // PID-4  Alternate Patient ID (CX)
  { field: 5, category: C.NAMES, mode: "redact" }, // PID-5  Patient Name (XPN~)
  { field: 6, category: C.NAMES, mode: "redact" }, // PID-6  Mother's Maiden Name (XPN) — relative
  { field: 7, category: C.DATES, mode: "date" }, // PID-7  Date/Time of Birth (TS)
  { field: 9, category: C.NAMES, mode: "redact" }, // PID-9  Patient Alias (XPN~)
  { field: 11, category: C.GEOGRAPHIC, mode: "address" }, // PID-11 Patient Address (XAD~)
  { field: 12, category: C.GEOGRAPHIC, mode: "block" }, // PID-12 County Code — geographic < state, no clean generalization
  { field: 13, category: C.PHONE, mode: "redact" }, // PID-13 Home Phone / email (XTN~)
  { field: 14, category: C.PHONE, mode: "redact" }, // PID-14 Business Phone (XTN~)
  { field: 18, category: C.ACCOUNT, mode: "id" }, // PID-18 Patient Account Number (CX)
  { field: 19, category: C.SSN, mode: "redact" }, // PID-19 SSN (ST)
  { field: 20, category: C.CERTIFICATE_LICENSE, mode: "redact" }, // PID-20 Driver's Licence
  { field: 21, category: C.MRN, mode: "id" }, // PID-21 Mother's Identifier (CX) — relative
  { field: 23, category: C.GEOGRAPHIC, mode: "block" }, // PID-23 Birth Place (ST) — geographic
  { field: 29, category: C.DATES, mode: "date" }, // PID-29 Patient Death Date/Time (TS)
];

/**
 * **NK1 — Next of Kin / Associated Parties.** Relatives and contacts (roadmap §4.6).
 */
const NK1_RULES: readonly Hl7FieldRule[] = [
  { field: 2, category: C.NAMES, mode: "redact" }, // NK1-2  Name (XPN~)
  { field: 4, category: C.GEOGRAPHIC, mode: "address" }, // NK1-4  Address (XAD~)
  { field: 5, category: C.PHONE, mode: "redact" }, // NK1-5  Phone Number (XTN~)
  { field: 6, category: C.PHONE, mode: "redact" }, // NK1-6  Business Phone Number (XTN~)
  { field: 30, category: C.NAMES, mode: "redact" }, // NK1-30 Contact Person's Name (XPN~)
  { field: 31, category: C.PHONE, mode: "redact" }, // NK1-31 Contact Person's Phone (XTN~)
  { field: 32, category: C.GEOGRAPHIC, mode: "address" }, // NK1-32 Contact Person's Address (XAD~)
  { field: 33, category: C.SSN, mode: "redact" }, // NK1-33 Next of Kin/Associated Party's SSN
  { field: 37, category: C.MRN, mode: "id" }, // NK1-37 Contact Person Social Security Number / identifiers (CX)
];

/**
 * **GT1 — Guarantor.** The financially-responsible party — frequently a relative (roadmap §4.6).
 */
const GT1_RULES: readonly Hl7FieldRule[] = [
  { field: 2, category: C.ACCOUNT, mode: "id" }, // GT1-2  Guarantor Number (CX~)
  { field: 3, category: C.NAMES, mode: "redact" }, // GT1-3  Guarantor Name (XPN~)
  { field: 4, category: C.NAMES, mode: "redact" }, // GT1-4  Guarantor Spouse Name (XPN~)
  { field: 5, category: C.GEOGRAPHIC, mode: "address" }, // GT1-5  Guarantor Address (XAD~)
  { field: 6, category: C.PHONE, mode: "redact" }, // GT1-6  Guarantor Home Phone (XTN~)
  { field: 7, category: C.PHONE, mode: "redact" }, // GT1-7  Guarantor Business Phone (XTN~)
  { field: 8, category: C.DATES, mode: "date" }, // GT1-8  Guarantor Date/Time of Birth (TS)
  { field: 12, category: C.SSN, mode: "redact" }, // GT1-12 Guarantor SSN (ST)
  { field: 19, category: C.MRN, mode: "id" }, // GT1-19 Guarantor Employer ID Number (CX~)
];

/**
 * **IN1 — Insurance.** Insured party demographics and plan identifiers. Company-level fields
 * (IN1-3/4/5/7 — insurer name/address/phone) are the organisation's, not the individual's, and are
 * intentionally left untouched.
 */
const IN1_RULES: readonly Hl7FieldRule[] = [
  { field: 8, category: C.HEALTH_PLAN_BENEFICIARY, mode: "id" }, // IN1-8  Group Number
  { field: 16, category: C.NAMES, mode: "redact" }, // IN1-16 Name of Insured (XPN~)
  { field: 18, category: C.DATES, mode: "date" }, // IN1-18 Insured's Date of Birth (TS)
  { field: 19, category: C.GEOGRAPHIC, mode: "address" }, // IN1-19 Insured's Address (XAD~)
  { field: 36, category: C.HEALTH_PLAN_BENEFICIARY, mode: "id" }, // IN1-36 Policy Number
  { field: 49, category: C.HEALTH_PLAN_BENEFICIARY, mode: "id" }, // IN1-49 Insured's ID Number (CX~)
];

/**
 * **IN2 — Insurance Additional Information.** Insured identifiers and employer.
 */
const IN2_RULES: readonly Hl7FieldRule[] = [
  { field: 2, category: C.SSN, mode: "redact" }, // IN2-2  Insured's SSN
  { field: 3, category: C.NAMES, mode: "redact" }, // IN2-3  Insured's Employer Name (XCN~) — employer
  { field: 6, category: C.HEALTH_PLAN_BENEFICIARY, mode: "id" }, // IN2-6  Medicare Health Ins Card Number
  { field: 7, category: C.HEALTH_PLAN_BENEFICIARY, mode: "id" }, // IN2-7  Medicaid Case Number
  { field: 8, category: C.NAMES, mode: "redact" }, // IN2-8  Medicaid Case Name (XPN~)
  { field: 61, category: C.HEALTH_PLAN_BENEFICIARY, mode: "id" }, // IN2-61 Patient Member Number (CX)
  { field: 63, category: C.PHONE, mode: "redact" }, // IN2-63 Insured's Phone Number - Home (XTN~)
];

/**
 * The full HL7 v2 locus map — segment type → its mapped PHI-bearing fields. A segment absent from this
 * map is either free text (OBX/NTE — handled by the extractor's free-text path), unknown structure
 * (Z-segments / segments unknown to the parser — failed closed), or a recognized non-PHI segment
 * (retained untouched).
 *
 * @example
 * ```ts
 * import { HL7_LOCUS_MAP } from "@cosyte/deid/hl7";
 *
 * HL7_LOCUS_MAP.PID?.find((r) => r.field === 5)?.category; // => "NAMES"
 * ```
 */
export const HL7_LOCUS_MAP: Readonly<Record<string, readonly Hl7FieldRule[]>> = Object.freeze({
  PID: PID_RULES,
  NK1: NK1_RULES,
  GT1: GT1_RULES,
  IN1: IN1_RULES,
  IN2: IN2_RULES,
});

/**
 * Resolve a Safe Harbor category from an HL7 CX-5 identifier-type code (HL7 Table 0203), for a `id`
 * field mapped with `routeByTypeCode`. Unrecognized or absent codes fall back to `fallback`.
 *
 * @param typeCode - The CX-5 identifier type code (e.g. `"MR"`, `"SS"`, `"AN"`).
 * @param fallback - The category to use when the code is unrecognized or absent.
 * @returns The resolved Safe Harbor category.
 * @example
 * ```ts
 * import { categoryForIdentifierType, SAFE_HARBOR_CATEGORIES } from "@cosyte/deid/hl7";
 *
 * categoryForIdentifierType("SS", SAFE_HARBOR_CATEGORIES.MRN); // => "SSN"
 * ```
 */
export function categoryForIdentifierType(
  typeCode: string | undefined,
  fallback: SafeHarborCategory,
): SafeHarborCategory {
  switch ((typeCode ?? "").toUpperCase()) {
    case "SS": // Social Security number
      return C.SSN;
    case "MR": // Medical record number
    case "PI": // Patient internal identifier
    case "PT": // Patient external identifier
      return C.MRN;
    case "AN": // Account number
    case "AC":
      return C.ACCOUNT;
    case "MA": // Medicaid number
    case "MB": // Member number
    case "MC": // Medicare number
    case "PN": // Person number (health plan)
      return C.HEALTH_PLAN_BENEFICIARY;
    case "DL": // Driver's licence number
      return C.CERTIFICATE_LICENSE;
    default:
      return fallback;
  }
}
