/**
 * The HL7 v2 **retain-list**: the explicit, auditable set of recognized segments the de-identifier
 * passes through untouched. It is the positive half of the **fail-closed** rule: a segment is retained
 * **only** if it is on this list; every other segment (whether unknown to the parser, a Z-segment, or a
 * *known* segment carrying patient/relative identifiers) is blocked.
 *
 * The list is the clinical / order / pharmacy / scheduling / financial / document / master-file / query /
 * envelope / provider-role segments: those that carry **no direct patient or relative Safe Harbor
 * identifier** (no name, SSN, MRN/account, address, or phone of the individual or a relative). The
 * patient/relative-identity segments are handled elsewhere: **PID / NK1 / GT1 / IN1 / IN2** are mapped
 * and selectively scrubbed ({@link HL7_LOCUS_MAP}); **OBX / NTE** free text fails closed; and the
 * pure-identity segments **MRG** (prior patient name + MRN on a merge/move), **ACC** (accident location),
 * **FAM** (family history, a relative), **PEO**, and **PDA** are deliberately **absent** from this list,
 * so they **fail closed** and are blocked.
 *
 * **Retaining the segment is not retaining every field in it.** {@link RETAINED_LOCUS_RULES} carves
 * the patient-related *dates* and the *encounter / order identifiers* back out of these segments and
 * hands them to the engine, so under a Safe-Harbor-labelled policy an admission date is reduced to its
 * year and a visit number is blocked as category (R). They survive only under a profile that names
 * their retention class, and even then they are **recorded**.
 *
 * **Documented limitation, and it is narrower than it was but real.** A field inside a retained segment
 * that is on **neither** list is still passed through untouched and is **not** recorded anywhere: the
 * specimen collection date (SPM-17), the attending / referring *provider* names (PV1-7/8, OBR-16), and
 * every other unmapped position. Forgetting a clinical segment here fails **safe**: it is blocked, not
 * leaked. Forgetting a *field* of a retained segment does not.
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";
import { RETAINED_LOCUS_CLASSES, type RetainedLocusClass } from "../retention.js";

/**
 * Recognized segments retained (passed through) by the HL7 v2 de-identifier. Anything not on this list,
 * and not a mapped PID-family segment or OBX/NTE: fails closed.
 *
 * @example
 * ```ts
 * import { RETAIN_SEGMENTS } from "@cosyte/deid/hl7";
 *
 * RETAIN_SEGMENTS.has("OBR"); // => true  (clinical order, retained)
 * RETAIN_SEGMENTS.has("MRG"); // => false (prior patient identity, fails closed)
 * ```
 */
export const RETAIN_SEGMENTS: ReadonlySet<string> = new Set<string>([
  // Envelope / acknowledgement / software / query + response
  "MSH",
  "MSA",
  "EVN",
  "ERR",
  "SFT",
  "DSC",
  "DSP",
  "QAK",
  "QPD",
  "QRF",
  "QRI",
  "QID",
  "RDF",
  "RDT",
  "EQL",
  "OMC",
  // Visit / additional demographics (the visit number and admit/discharge dates are carved out below)
  "PV1",
  "PV2",
  "PD1",
  "DB1",
  "PDC",
  // Insurance additional (certification / provider)
  "IN3",
  // Clinical: allergy / diagnosis / problem / goal / procedure / order / result / specimen / timing
  "AL1",
  "DG1",
  "PRB",
  "IAM",
  "GOL",
  "PR1",
  "OBR",
  "ORC",
  "SPM",
  "TQ1",
  "TQ2",
  // Financial
  "UB1",
  "UB2",
  "FT1",
  // Pharmacy / treatment
  "RXA",
  "RXC",
  "RXD",
  "RXE",
  "RXG",
  "RXO",
  "RXR",
  "RXV",
  // Scheduling
  "SCH",
  "AIG",
  "AIL",
  "AIP",
  "AIS",
  "ARQ",
  "APR",
  "RGS",
  // Document
  "TXA",
  // Master files
  "MFE",
  "MFI",
  "MFA",
  "MCP",
  "LDP",
  "LCH",
  "LOC",
  "LRL",
  "LCC",
  // Roles / staff / organizations (provider PII, out of Phase-2 scope, retained)
  "ROL",
  "STF",
  "PRA",
  "EDU",
  "CER",
  "CTD",
  "CTI",
  "ORG",
  "PRC",
  "PRD",
  // Batch / file envelope
  "FHS",
  "BHS",
  "BTS",
  "FTS",
  // Clinical study
  "CSR",
  "CSP",
  "CSS",
]);

/**
 * One field carved back out of a retained segment: an identifying locus a profile may keep, but only
 * by naming its {@link RetainedLocusClass}. Absent that, the engine acts on it under the policy.
 */
export interface Hl7RetainedFieldRule {
  /** 1-based HL7 field number (e.g. `44` for PV1-44). */
  readonly field: number;
  /** The retention class a profile must name for this locus to survive. */
  readonly retention: RetainedLocusClass;
  /** The Safe Harbor category the locus carries when the policy acts on it. */
  readonly category: SafeHarborCategory;
  /** `date` generalizes to year under Safe Harbor; `identifier` is blocked as the (R) catch-all. */
  readonly kind: "date" | "identifier";
}

const R = RETAINED_LOCUS_CLASSES;
const C_DATES = SAFE_HARBOR_CATEGORIES.DATES;
const C_OTHER = SAFE_HARBOR_CATEGORIES.OTHER_UNIQUE_ID;

/**
 * The **carve-out table**: for each retained segment, the fields that are identifying rather than
 * clinical. Every position is grounded in the HL7 v2.x segment definitions.
 *
 * The dates are elements of dates directly related to the individual, which §164.514(b)(2)(i)(C)
 * removes (admission and discharge are named in the regulation text itself); the visit number and the
 * placer / filler order numbers are unique identifying codes, which §164.514(b)(2)(i)(R) removes. Both
 * groups are absent from §164.514(e)(2)'s sixteen direct identifiers, so a limited data set may keep
 * them, which is what the retention classes express.
 *
 * @example
 * ```ts
 * import { RETAINED_LOCUS_RULES } from "@cosyte/deid/hl7";
 *
 * RETAINED_LOCUS_RULES.PV1?.find((r) => r.field === 44)?.retention; // => "encounter-dates"
 * ```
 */
export const RETAINED_LOCUS_RULES: Readonly<Record<string, readonly Hl7RetainedFieldRule[]>> =
  Object.freeze({
    PV1: [
      // PV1-19 Visit Number (CX): the encounter identifier.
      { field: 19, retention: R.ENCOUNTER_IDENTIFIERS, category: C_OTHER, kind: "identifier" },
      // PV1-44 Admit Date/Time (TS) and PV1-45 Discharge Date/Time (TS).
      { field: 44, retention: R.ENCOUNTER_DATES, category: C_DATES, kind: "date" },
      { field: 45, retention: R.ENCOUNTER_DATES, category: C_DATES, kind: "date" },
    ],
    OBR: [
      // OBR-2 Placer Order Number (EI) and OBR-3 Filler Order Number (EI).
      { field: 2, retention: R.ENCOUNTER_IDENTIFIERS, category: C_OTHER, kind: "identifier" },
      { field: 3, retention: R.ENCOUNTER_IDENTIFIERS, category: C_OTHER, kind: "identifier" },
      // OBR-7 Observation Date/Time (TS): the service date.
      { field: 7, retention: R.ENCOUNTER_DATES, category: C_DATES, kind: "date" },
    ],
    ORC: [
      // ORC-2 Placer Order Number (EI) and ORC-3 Filler Order Number (EI): the same two identifiers
      // the order-control segment carries alongside OBR.
      { field: 2, retention: R.ENCOUNTER_IDENTIFIERS, category: C_OTHER, kind: "identifier" },
      { field: 3, retention: R.ENCOUNTER_IDENTIFIERS, category: C_OTHER, kind: "identifier" },
    ],
    DG1: [
      // DG1-5 Diagnosis Date/Time (TS).
      { field: 5, retention: R.ENCOUNTER_DATES, category: C_DATES, kind: "date" },
    ],
  });
