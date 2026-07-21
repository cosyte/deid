/**
 * The HL7 v2 **retain-list** — the explicit, auditable set of recognized segments the de-identifier
 * passes through untouched. It is the positive half of the **fail-closed** rule: a segment is retained
 * **only** if it is on this list; every other segment (whether unknown to the parser, a Z-segment, or a
 * *known* segment carrying patient/relative identifiers) is blocked (§4).
 *
 * The list is the clinical / order / pharmacy / scheduling / financial / document / master-file / query /
 * envelope / provider-role segments — those that carry **no direct patient or relative Safe Harbor
 * identifier** (no name, SSN, MRN/account, address, or phone of the individual or a relative). The
 * patient/relative-identity segments are handled elsewhere: **PID / NK1 / GT1 / IN1 / IN2** are mapped
 * and selectively scrubbed ({@link HL7_LOCUS_MAP}); **OBX / NTE** free text fails closed; and the
 * pure-identity segments **MRG** (prior patient name + MRN on a merge/move), **ACC** (accident location),
 * **FAM** (family history — a relative), **PEO**, and **PDA** are deliberately **absent** from this list,
 * so they **fail closed** and are blocked.
 *
 * **Documented Phase-2 limitation.** Retained clinical/visit segments may still carry patient-related
 * *dates* (OBR observation date, DG1 diagnosis date, PV1 admit/discharge date, SPM collection date) and
 * *visit identifiers* (PV1-19), and *provider* names (PV1-7/8, OBR-16). Selective scrubbing of those loci
 * is a later phase; Phase 2 covers the PID-family patient/relative demographics and the free-text /
 * unknown-structure fail-closed defaults. Forgetting a clinical segment here fails **safe** — it is
 * blocked, not leaked.
 *
 * @packageDocumentation
 */

/**
 * Recognized segments retained (passed through) by the HL7 v2 de-identifier. Anything not on this list —
 * and not a mapped PID-family segment or OBX/NTE — fails closed.
 *
 * @example
 * ```ts
 * import { RETAIN_SEGMENTS } from "@cosyte/deid/hl7";
 *
 * RETAIN_SEGMENTS.has("OBR"); // => true  (clinical order — retained)
 * RETAIN_SEGMENTS.has("MRG"); // => false (prior patient identity — fails closed)
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
  // Visit / additional demographics (deferred date/visit-id limitation)
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
  // Roles / staff / organizations (provider PII — out of Phase-2 scope, retained)
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
