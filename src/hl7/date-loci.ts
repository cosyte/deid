/**
 * The **date-locus enumeration** for HL7 v2: every position inside a segment this adapter **passes
 * through** that the **HL7 v2.5.1** segment definitions type as a date or a date/time. It is the
 * auditable source of truth for the class the engine acts on, and it carries **no value**: a segment
 * name, a field number, an optional component number, the datatype, and the field name the standard
 * gives that position.
 *
 * **The domain is what survives the pass, not what a list happens to name.** That is
 * {@link HL7_PASSED_THROUGH_SEGMENTS}: every segment on the {@link RETAIN_SEGMENTS} retain-list, plus
 * **`OBX`**, which this adapter passes through by its own value-type branch rather than by the list.
 * Being passed through, not being on a list, is what makes a full-precision date inside a segment a
 * leak, so an `OBX` carrying its observation (`OBX-14`) and analysis (`OBX-19`) timestamps is swept
 * exactly like a retained segment. A segment that fails closed is blocked field by field and can leak
 * nothing, so it contributes no locus.
 *
 * **Why a table at all.** An HL7 v2 message does not declare its field datatypes: the datatype of
 * `ORC-9` is a fact about the standard, not about the message. Neither this package nor its parser
 * ships a per-segment field-datatype dictionary, so the classification is written down here, once,
 * beside the retain-list it extends, rather than guessed from the shape of a value at run time.
 * Guessing from the value is exactly the regex sniffing this library refuses: it is an over-scrub
 * hazard in one direction (an eight-digit lab result is not a date) and a leak in the other.
 *
 * **The version is fixed, deliberately.** Every row is derived from HL7 v2.5.1 and only from it, so
 * identical wire bytes yield an identical locus set whatever version `MSH-12` declares. The price is
 * stated rather than hidden: a position that only some other version of the standard types as a date
 * is **not** in this table and is a documented residual (see `docs-content/limitations.md`).
 *
 * **How to re-derive a row rather than trust it.** Each segment carries the chapter of the v2.5.1
 * standard that defines it and the number of fields that definition has, and each row carries the
 * field number, the component number where the date is a component of a composite, the datatype, and
 * the position's name. Open the chapter's segment table, walk it from field 1 to `fields`, and the
 * rows below are every `DT` / `TS` position in it (plus the date/time components of the composites
 * named in each row's `composite`).
 *
 * **What is deliberately NOT here.**
 *
 * - `OBX-5`. Its datatype is declared **by the message** at `OBX-2`, so it needs no table and is
 *   classified where it is read (see the extractor). Every OTHER date position of an `OBX` is a fact
 *   about the standard like any other and IS here.
 * - A segment this adapter **maps field by field** (`PID` / `NK1` / `GT1` / `IN1` / `IN2`). Its
 *   identifying positions are located by the locus map; its unmapped positions, including any the
 *   standard types as a date, are outside this enumeration's domain and are the pre-existing
 *   unmapped-position residual rather than part of the retained-segment class this table fixes.
 * - The **file and batch envelope headers** (`FHS`, `BHS`). Like `MSH` they carry the field separator
 *   in their first position, and the model this adapter writes back through applies that offset for
 *   `MSH` alone. Their creation timestamps are a stated residual rather than a position written at a
 *   number that may not be the one the standard means.
 * - The **date components of person-name and address composites** (`XCN` / `PPN` / `XAD` effective,
 *   expiration and action-performed dates, and the licence-expiry component of a driver's-licence
 *   composite where it rides a person field). Those sit inside the provider- and organization-name
 *   positions that this release leaves untouched; enumerating their dates while leaving the names they
 *   qualify would record half a position. They are a stated residual, named in the published
 *   limitations, not an oversight.
 * - Segments the retain-list keeps that the v2.5.1 chapter set does not define at all. They appear
 *   below with no locus and a note, because the class is fixed at that version.
 *
 * @packageDocumentation
 */

import { RETAIN_SEGMENTS } from "./retain.js";

/**
 * The version of the HL7 standard every row of {@link HL7_DATE_LOCI} is derived from. The
 * classification is fixed here and is never re-derived per message.
 *
 * @example
 * ```ts
 * import { HL7_DATE_LOCUS_VERSION } from "@cosyte/deid/hl7";
 *
 * HL7_DATE_LOCUS_VERSION; // => "2.5.1"
 * ```
 */
export const HL7_DATE_LOCUS_VERSION = "2.5.1";

/**
 * The **domain** of {@link HL7_DATE_LOCI}: every segment whose bytes this adapter can pass through, so
 * every segment inside which a full-precision date could survive the pass. It is the
 * {@link RETAIN_SEGMENTS} retain-list **plus `OBX`**, the one segment the adapter passes through by its
 * own `OBX-2` value-type branch instead of by the list.
 *
 * The distinction is deliberate and is the reason this set exists rather than the retain-list alone:
 * membership of a list is not what makes a date position dangerous, surviving the pass is. A segment
 * that fails closed is blocked field by field and leaks nothing, so it is not here; `OBX` is not on the
 * retain-list yet keeps every field the value-type branch does not touch, which is exactly the shape
 * that hides a date. **This set adds no segment to the retain-list**: what the adapter retains is
 * unchanged, and this only fixes what the date enumeration must be complete over.
 *
 * @example
 * ```ts
 * import { HL7_PASSED_THROUGH_SEGMENTS, RETAIN_SEGMENTS } from "@cosyte/deid/hl7";
 *
 * HL7_PASSED_THROUGH_SEGMENTS.has("OBX"); // => true  (passed through, not retain-listed)
 * RETAIN_SEGMENTS.has("OBX"); // => false (the retain-list is unchanged)
 * ```
 */
export const HL7_PASSED_THROUGH_SEGMENTS: ReadonlySet<string> = new Set<string>([
  ...RETAIN_SEGMENTS,
  "OBX",
]);

/**
 * The datatypes that make a position a date locus. `DT` is a calendar date, `TS` a time stamp, and
 * `DTM` a date/time as later versions of the standard spell it (reachable only through an `OBX-2`
 * value type, never through a v2.5.1 field definition). A `TM` time of day is **not** here: a time of
 * day carries no element of a date.
 *
 * @example
 * ```ts
 * import { type Hl7DateDatatype } from "@cosyte/deid/hl7";
 *
 * const dt: Hl7DateDatatype = "TS";
 * ```
 */
export type Hl7DateDatatype = "DT" | "DTM" | "TS";

/**
 * One date position of one retained segment. `component` is present exactly when the date is a
 * component of a composite field, in which case the locus is that component and never the field that
 * contains it.
 *
 * @example
 * ```ts
 * import { HL7_DATE_LOCI } from "@cosyte/deid/hl7";
 *
 * HL7_DATE_LOCI.ORC?.loci.find((l) => l.field === 9)?.datatype; // => "TS"
 * ```
 */
export interface Hl7DateLocusRule {
  /** 1-based HL7 field number. */
  readonly field: number;
  /** 1-based component number, when the date is a component of a composite field. */
  readonly component?: number;
  /** The datatype the v2.5.1 definition gives the position. */
  readonly datatype: Hl7DateDatatype;
  /** The composite field datatype the component sits in (`DR`, `TQ`, `DLD`, …), when it is one. */
  readonly composite?: string;
  /** The name the v2.5.1 segment (or composite) definition gives the position. Never a value. */
  readonly name: string;
}

/**
 * One retained segment's date positions, plus the citation a reviewer re-derives them from.
 *
 * @example
 * ```ts
 * import { HL7_DATE_LOCI } from "@cosyte/deid/hl7";
 *
 * HL7_DATE_LOCI.EVN?.chapter; // => "3"
 * ```
 */
export interface Hl7SegmentDateLoci {
  /** The chapter of the v2.5.1 standard that defines the segment. */
  readonly chapter: string;
  /** How many fields that definition has: the extent of the walk these rows came from. */
  readonly fields: number;
  /** Every date position of the segment, in ascending field then component order. */
  readonly loci: readonly Hl7DateLocusRule[];
  /** Why the row set is what it is, where that is not obvious from the segment definition alone. */
  readonly note?: string;
}

/** Shorthand for a whole-field date position. */
function f(field: number, datatype: Hl7DateDatatype, name: string): Hl7DateLocusRule {
  return { field, datatype, name };
}

/** Shorthand for a date position that is a component of a composite field. */
function c(
  field: number,
  component: number,
  datatype: Hl7DateDatatype,
  composite: string,
  name: string,
): Hl7DateLocusRule {
  return { field, component, datatype, composite, name };
}

/**
 * The enumeration: every segment of {@link HL7_PASSED_THROUGH_SEGMENTS}, and every date position HL7
 * v2.5.1 gives it.
 *
 * Every segment of that domain appears here, including the ones with no date position at all, so that
 * "this segment was walked and carries none" and "this segment was never walked" are different facts
 * rather than the same silence.
 *
 * @example
 * ```ts
 * import { HL7_DATE_LOCI } from "@cosyte/deid/hl7";
 *
 * HL7_DATE_LOCI.SPM?.loci.filter((l) => l.field === 17).length; // => 2 (a date range: two components)
 * ```
 */
export const HL7_DATE_LOCI: Readonly<Record<string, Hl7SegmentDateLoci>> = Object.freeze({
  // ── Envelope / acknowledgement / software / query + response ──────────────────────────────────
  MSH: Object.freeze({
    chapter: "2",
    fields: 21,
    loci: Object.freeze([f(7, "TS", "Date/Time of Message")]),
  }),
  MSA: Object.freeze({ chapter: "2", fields: 6, loci: Object.freeze([]) }),
  EVN: Object.freeze({
    chapter: "3",
    fields: 7,
    loci: Object.freeze([
      f(2, "TS", "Recorded Date/Time"),
      f(3, "TS", "Date/Time Planned Event"),
      f(6, "TS", "Event Occurred"),
    ]),
  }),
  ERR: Object.freeze({ chapter: "2", fields: 12, loci: Object.freeze([]) }),
  SFT: Object.freeze({
    chapter: "2",
    fields: 6,
    loci: Object.freeze([f(6, "TS", "Software Install Date")]),
  }),
  DSC: Object.freeze({ chapter: "2", fields: 2, loci: Object.freeze([]) }),
  DSP: Object.freeze({ chapter: "5", fields: 5, loci: Object.freeze([]) }),
  QAK: Object.freeze({ chapter: "5", fields: 6, loci: Object.freeze([]) }),
  QPD: Object.freeze({
    chapter: "5",
    fields: 3,
    loci: Object.freeze([]),
    note: "QPD-3 and beyond are query-parameter positions typed by the conformance statement rather than by the segment definition; v2.5.1 types none of them as a date.",
  }),
  QRF: Object.freeze({
    chapter: "5",
    fields: 9,
    loci: Object.freeze([
      f(2, "TS", "When Data Start Date/Time"),
      f(3, "TS", "When Data End Date/Time"),
      c(9, 4, "TS", "TQ", "When Quantity/Timing Qualifier: start date/time"),
      c(9, 5, "TS", "TQ", "When Quantity/Timing Qualifier: end date/time"),
    ]),
  }),
  QRI: Object.freeze({ chapter: "5", fields: 3, loci: Object.freeze([]) }),
  QID: Object.freeze({ chapter: "5", fields: 2, loci: Object.freeze([]) }),
  RDF: Object.freeze({ chapter: "5", fields: 2, loci: Object.freeze([]) }),
  RDT: Object.freeze({
    chapter: "5",
    fields: 0,
    loci: Object.freeze([]),
    note: "Row data columns are typed by the preceding row-definition segment, not by a fixed segment definition, so v2.5.1 fixes no date position here.",
  }),
  EQL: Object.freeze({ chapter: "5", fields: 4, loci: Object.freeze([]) }),
  OMC: Object.freeze({ chapter: "8", fields: 15, loci: Object.freeze([]) }),

  // ── Visit / additional demographics ───────────────────────────────────────────────────────────
  PV1: Object.freeze({
    chapter: "3",
    fields: 52,
    loci: Object.freeze([
      c(37, 2, "TS", "DLD", "Discharged to Location: effective date"),
      f(44, "TS", "Admit Date/Time"),
      f(45, "TS", "Discharge Date/Time"),
    ]),
  }),
  PV2: Object.freeze({
    chapter: "3",
    fields: 49,
    loci: Object.freeze([
      f(8, "TS", "Expected Admit Date/Time"),
      f(9, "TS", "Expected Discharge Date/Time"),
      f(14, "DT", "Previous Service Date"),
      f(17, "DT", "Purge Status Date"),
      f(26, "DT", "Previous Treatment Date"),
      f(28, "DT", "Signature on File Date"),
      f(29, "DT", "First Similar Illness Date"),
      f(33, "TS", "Expected Surgery Date and Time"),
      f(46, "DT", "Patient Status Effective Date"),
      f(47, "TS", "Expected LOA Return Date/Time"),
      f(48, "TS", "Expected Pre-admission Testing Date/Time"),
    ]),
  }),
  PD1: Object.freeze({
    chapter: "3",
    fields: 21,
    loci: Object.freeze([
      f(13, "DT", "Protection Indicator Effective Date"),
      f(17, "DT", "Immunization Registry Status Effective Date"),
      f(18, "DT", "Publicity Code Effective Date"),
    ]),
  }),
  DB1: Object.freeze({
    chapter: "3",
    fields: 8,
    loci: Object.freeze([
      f(5, "DT", "Disability Start Date"),
      f(6, "DT", "Disability End Date"),
      f(7, "DT", "Disability Return to Work Date"),
      f(8, "DT", "Disability Unable to Work Date"),
    ]),
  }),
  PDC: Object.freeze({
    chapter: "7",
    fields: 15,
    loci: Object.freeze([f(14, "TS", "Date First Marketed"), f(15, "TS", "Date Last Marketed")]),
  }),

  // ── Insurance additional ──────────────────────────────────────────────────────────────────────
  IN3: Object.freeze({
    chapter: "6",
    fields: 25,
    loci: Object.freeze([
      f(6, "TS", "Certification Date/Time"),
      f(7, "TS", "Certification Modify Date/Time"),
      f(9, "DT", "Certification Begin Date"),
      f(10, "DT", "Certification End Date"),
      f(13, "TS", "Non-Concur Effective Date/Time"),
      c(20, 3, "TS", "ICD", "Pre-Certification Requirement: date/time certification required"),
      f(22, "DT", "Second Opinion Date"),
    ]),
  }),

  // ── Clinical: allergy / diagnosis / problem / goal / procedure / order / result / specimen ─────
  AL1: Object.freeze({
    chapter: "3",
    fields: 6,
    loci: Object.freeze([f(6, "DT", "Identification Date")]),
  }),
  DG1: Object.freeze({
    chapter: "6",
    fields: 21,
    loci: Object.freeze([f(5, "TS", "Diagnosis Date/Time"), f(19, "TS", "Attestation Date/Time")]),
  }),
  PRB: Object.freeze({
    chapter: "12",
    fields: 25,
    loci: Object.freeze([
      f(2, "TS", "Action Date/Time"),
      f(7, "TS", "Problem Established Date/Time"),
      f(8, "TS", "Anticipated Problem Resolution Date/Time"),
      f(9, "TS", "Actual Problem Resolution Date/Time"),
      f(15, "TS", "Problem Life Cycle Status Date/Time"),
      f(16, "TS", "Problem Date of Onset"),
    ]),
  }),
  IAM: Object.freeze({
    chapter: "3",
    fields: 20,
    loci: Object.freeze([
      f(11, "DT", "Onset Date"),
      f(13, "TS", "Reported Date/Time"),
      f(20, "TS", "Statused at Date/Time"),
    ]),
  }),
  GOL: Object.freeze({
    chapter: "12",
    fields: 21,
    loci: Object.freeze([
      f(2, "TS", "Action Date/Time"),
      f(7, "TS", "Goal Established Date/Time"),
      f(8, "TS", "Expected Goal Achieve Date/Time"),
      f(12, "TS", "Current Goal Review Date/Time"),
      f(13, "TS", "Next Goal Review Date/Time"),
      f(14, "TS", "Previous Goal Review Date/Time"),
      c(15, 4, "TS", "TQ", "Goal Review Interval: start date/time"),
      c(15, 5, "TS", "TQ", "Goal Review Interval: end date/time"),
      f(19, "TS", "Goal Life Cycle Status Date/Time"),
    ]),
  }),
  PR1: Object.freeze({
    chapter: "6",
    fields: 20,
    loci: Object.freeze([f(5, "TS", "Procedure Date/Time")]),
  }),
  OBR: Object.freeze({
    chapter: "4",
    fields: 49,
    loci: Object.freeze([
      f(6, "TS", "Requested Date/Time"),
      f(7, "TS", "Observation Date/Time"),
      f(8, "TS", "Observation End Date/Time"),
      f(14, "TS", "Specimen Received Date/Time"),
      f(22, "TS", "Results Report/Status Change Date/Time"),
      c(27, 4, "TS", "TQ", "Quantity/Timing: start date/time"),
      c(27, 5, "TS", "TQ", "Quantity/Timing: end date/time"),
      c(32, 2, "TS", "NDL", "Principal Result Interpreter: start date/time"),
      c(32, 3, "TS", "NDL", "Principal Result Interpreter: end date/time"),
      c(33, 2, "TS", "NDL", "Assistant Result Interpreter: start date/time"),
      c(33, 3, "TS", "NDL", "Assistant Result Interpreter: end date/time"),
      c(34, 2, "TS", "NDL", "Technician: start date/time"),
      c(34, 3, "TS", "NDL", "Technician: end date/time"),
      c(35, 2, "TS", "NDL", "Transcriptionist: start date/time"),
      c(35, 3, "TS", "NDL", "Transcriptionist: end date/time"),
      f(36, "TS", "Scheduled Date/Time"),
    ]),
  }),
  ORC: Object.freeze({
    chapter: "4",
    fields: 31,
    loci: Object.freeze([
      c(7, 4, "TS", "TQ", "Quantity/Timing: start date/time"),
      c(7, 5, "TS", "TQ", "Quantity/Timing: end date/time"),
      f(9, "TS", "Date/Time of Transaction"),
      f(15, "TS", "Order Effective Date/Time"),
      f(27, "TS", "Filler's Expected Availability Date/Time"),
    ]),
  }),

  // ── Result: passed through by the OBX-2 value-type branch, not by the retain-list ──────────────
  OBX: Object.freeze({
    chapter: "7",
    fields: 25,
    loci: Object.freeze([
      f(12, "TS", "Effective Date of Reference Range"),
      f(14, "TS", "Date/Time of the Observation"),
      f(19, "TS", "Date/Time of the Analysis"),
    ]),
    note: "OBX-5 is absent on purpose: the message types it at OBX-2, so it is classified where it is read rather than from this table. OBX-20 to OBX-22 are reserved in v2.5.1 and define no position. The date components inside OBX-16 / OBX-24 / OBX-25 (a responsible observer, a performing organization's address and its medical director) ride person-name and address composites and are covered by the person-composite residual.",
  }),

  SPM: Object.freeze({
    chapter: "7",
    fields: 29,
    loci: Object.freeze([
      c(17, 1, "TS", "DR", "Specimen Collection Date/Time: range start"),
      c(17, 2, "TS", "DR", "Specimen Collection Date/Time: range end"),
      f(18, "TS", "Specimen Received Date/Time"),
      f(19, "TS", "Specimen Expiration Date/Time"),
    ]),
  }),
  TQ1: Object.freeze({
    chapter: "4",
    fields: 14,
    loci: Object.freeze([f(7, "TS", "Start date/time"), f(8, "TS", "End date/time")]),
    note: "TQ1-4 Explicit Time is a TM time of day and carries no element of a date, so it is out of the class.",
  }),
  TQ2: Object.freeze({ chapter: "4", fields: 10, loci: Object.freeze([]) }),

  // ── Financial ─────────────────────────────────────────────────────────────────────────────────
  UB1: Object.freeze({
    chapter: "6",
    fields: 23,
    loci: Object.freeze([
      f(14, "DT", "Approved Stay: from date"),
      f(15, "DT", "Approved Stay: to date"),
      c(16, 2, "DT", "OCD", "Occurrence: occurrence date"),
      f(18, "DT", "Occurrence Span Start Date"),
      f(19, "DT", "Occurrence Span End Date"),
    ]),
  }),
  UB2: Object.freeze({
    chapter: "6",
    fields: 17,
    loci: Object.freeze([
      c(7, 2, "DT", "OCD", "Occurrence Code and Date: occurrence date"),
      c(8, 2, "DT", "OSP", "Occurrence Span Code and Dates: span start date"),
      c(8, 3, "DT", "OSP", "Occurrence Span Code and Dates: span end date"),
    ]),
  }),
  FT1: Object.freeze({
    chapter: "6",
    fields: 29,
    loci: Object.freeze([
      c(4, 1, "TS", "DR", "Transaction Date: range start"),
      c(4, 2, "TS", "DR", "Transaction Date: range end"),
      f(5, "TS", "Transaction Posting Date"),
    ]),
  }),

  // ── Pharmacy / treatment ──────────────────────────────────────────────────────────────────────
  RXA: Object.freeze({
    chapter: "4",
    fields: 27,
    loci: Object.freeze([
      f(3, "TS", "Date/Time Start of Administration"),
      f(4, "TS", "Date/Time End of Administration"),
      f(16, "TS", "Substance Expiration Date"),
      f(22, "TS", "System Entry Date/Time"),
    ]),
  }),
  RXC: Object.freeze({ chapter: "4", fields: 9, loci: Object.freeze([]) }),
  RXD: Object.freeze({
    chapter: "4",
    fields: 26,
    loci: Object.freeze([
      f(3, "TS", "Date/Time Dispensed"),
      f(19, "TS", "Substance Expiration Date"),
    ]),
  }),
  RXE: Object.freeze({
    chapter: "4",
    fields: 44,
    loci: Object.freeze([
      c(1, 4, "TS", "TQ", "Quantity/Timing: start date/time"),
      c(1, 5, "TS", "TQ", "Quantity/Timing: end date/time"),
      f(18, "TS", "Date/Time of Most Recent Refill or Dose Dispensed"),
      f(32, "TS", "Original Order Date/Time"),
    ]),
  }),
  RXG: Object.freeze({
    chapter: "4",
    fields: 26,
    loci: Object.freeze([
      c(3, 4, "TS", "TQ", "Quantity/Timing: start date/time"),
      c(3, 5, "TS", "TQ", "Quantity/Timing: end date/time"),
      f(20, "TS", "Substance Expiration Date"),
    ]),
  }),
  RXO: Object.freeze({ chapter: "4", fields: 25, loci: Object.freeze([]) }),
  RXR: Object.freeze({ chapter: "4", fields: 6, loci: Object.freeze([]) }),
  RXV: Object.freeze({
    chapter: "n/a",
    fields: 0,
    loci: Object.freeze([]),
    note: "The retain-list keeps this segment, and the v2.5.1 chapter set does not define it. The class is fixed at that version, so it contributes no locus; a message that carries it is covered by the version residual in the published limitations.",
  }),

  // ── Scheduling ────────────────────────────────────────────────────────────────────────────────
  SCH: Object.freeze({
    chapter: "10",
    fields: 27,
    loci: Object.freeze([
      c(11, 4, "TS", "TQ", "Appointment Timing Quantity: start date/time"),
      c(11, 5, "TS", "TQ", "Appointment Timing Quantity: end date/time"),
    ]),
  }),
  AIG: Object.freeze({
    chapter: "10",
    fields: 14,
    loci: Object.freeze([f(8, "TS", "Start Date/Time")]),
  }),
  AIL: Object.freeze({
    chapter: "10",
    fields: 12,
    loci: Object.freeze([f(6, "TS", "Start Date/Time")]),
  }),
  AIP: Object.freeze({
    chapter: "10",
    fields: 12,
    loci: Object.freeze([f(6, "TS", "Start Date/Time")]),
  }),
  AIS: Object.freeze({
    chapter: "10",
    fields: 12,
    loci: Object.freeze([f(4, "TS", "Start Date/Time")]),
  }),
  ARQ: Object.freeze({
    chapter: "10",
    fields: 25,
    loci: Object.freeze([
      c(11, 1, "TS", "DR", "Requested Start Date/Time Range: range start"),
      c(11, 2, "TS", "DR", "Requested Start Date/Time Range: range end"),
    ]),
  }),
  APR: Object.freeze({ chapter: "10", fields: 5, loci: Object.freeze([]) }),
  RGS: Object.freeze({ chapter: "10", fields: 3, loci: Object.freeze([]) }),

  // ── Document ──────────────────────────────────────────────────────────────────────────────────
  TXA: Object.freeze({
    chapter: "9",
    fields: 23,
    loci: Object.freeze([
      f(4, "TS", "Activity Date/Time"),
      f(6, "TS", "Origination Date/Time"),
      f(7, "TS", "Transcription Date/Time"),
      f(8, "TS", "Edit Date/Time"),
    ]),
    note: "TXA-22 Authentication Person, Time Stamp carries its date inside a person-name composite and is covered by the person-composite residual.",
  }),

  // ── Master files ──────────────────────────────────────────────────────────────────────────────
  MFE: Object.freeze({
    chapter: "8",
    fields: 5,
    loci: Object.freeze([f(3, "TS", "Effective Date/Time")]),
  }),
  MFI: Object.freeze({
    chapter: "8",
    fields: 6,
    loci: Object.freeze([f(4, "TS", "Entered Date/Time"), f(5, "TS", "Effective Date/Time")]),
  }),
  MFA: Object.freeze({
    chapter: "8",
    fields: 6,
    loci: Object.freeze([f(3, "TS", "Event Completion Date/Time")]),
  }),
  MCP: Object.freeze({ chapter: "8", fields: 5, loci: Object.freeze([]) }),
  LDP: Object.freeze({
    chapter: "8",
    fields: 12,
    loci: Object.freeze([f(7, "TS", "Activation Date"), f(8, "TS", "Inactivation Date")]),
  }),
  LCH: Object.freeze({ chapter: "8", fields: 5, loci: Object.freeze([]) }),
  LOC: Object.freeze({ chapter: "8", fields: 9, loci: Object.freeze([]) }),
  LRL: Object.freeze({ chapter: "8", fields: 6, loci: Object.freeze([]) }),
  LCC: Object.freeze({ chapter: "8", fields: 4, loci: Object.freeze([]) }),
  PRC: Object.freeze({
    chapter: "8",
    fields: 18,
    loci: Object.freeze([f(11, "TS", "Effective Start Date"), f(12, "TS", "Effective End Date")]),
  }),

  // ── Roles / staff / organizations / contacts ──────────────────────────────────────────────────
  ROL: Object.freeze({
    chapter: "15",
    fields: 12,
    loci: Object.freeze([f(5, "TS", "Role Begin Date/Time"), f(6, "TS", "Role End Date/Time")]),
  }),
  STF: Object.freeze({
    chapter: "15",
    fields: 29,
    loci: Object.freeze([
      f(6, "TS", "Date/Time of Birth"),
      c(12, 1, "TS", "DIN", "Institution Activation Date: date"),
      c(13, 1, "TS", "DIN", "Institution Inactivation Date: date"),
      c(22, 3, "DT", "DLN", "Driver's License Number: expiration date"),
      f(24, "DT", "Automobile Insurance Expires"),
      f(25, "DT", "Date Last DMV Review"),
      f(26, "DT", "Date Next DMV Review"),
    ]),
  }),
  PRA: Object.freeze({
    chapter: "15",
    fields: 12,
    loci: Object.freeze([
      c(5, 4, "DT", "SPD", "Specialty: date of certification"),
      c(6, 4, "DT", "PLN", "Practitioner ID Numbers: expiration date"),
      c(7, 3, "DT", "PIP", "Privileges: expiration date"),
      c(7, 4, "DT", "PIP", "Privileges: activation date"),
      f(8, "DT", "Date Entered Practice"),
      f(10, "DT", "Date Left Practice"),
    ]),
  }),
  EDU: Object.freeze({
    chapter: "15",
    fields: 9,
    loci: Object.freeze([
      c(3, 1, "TS", "DR", "Academic Degree Program Date Range: range start"),
      c(3, 2, "TS", "DR", "Academic Degree Program Date Range: range end"),
      c(4, 1, "TS", "DR", "Academic Degree Program Participation Date Range: range start"),
      c(4, 2, "TS", "DR", "Academic Degree Program Participation Date Range: range end"),
      f(5, "DT", "Academic Degree Granted Date"),
    ]),
  }),
  CER: Object.freeze({
    chapter: "15",
    fields: 31,
    loci: Object.freeze([
      f(23, "TS", "Granting Date"),
      f(24, "TS", "Issuing Date"),
      f(25, "TS", "Activation Date"),
      f(26, "TS", "Inactivation Date"),
      f(27, "TS", "Expiration Date"),
      f(28, "TS", "Renewal Date"),
      f(29, "TS", "Revocation Date"),
    ]),
  }),
  CTD: Object.freeze({
    chapter: "11",
    fields: 7,
    loci: Object.freeze([c(7, 4, "DT", "PLN", "Contact Identifiers: expiration date")]),
  }),
  CTI: Object.freeze({ chapter: "7", fields: 3, loci: Object.freeze([]) }),
  ORG: Object.freeze({
    chapter: "15",
    fields: 13,
    loci: Object.freeze([
      c(9, 1, "TS", "DR", "Effective Date Range: range start"),
      c(9, 2, "TS", "DR", "Effective Date Range: range end"),
    ]),
  }),
  PRD: Object.freeze({
    chapter: "11",
    fields: 9,
    loci: Object.freeze([
      f(8, "TS", "Effective Start Date of Provider Role"),
      f(9, "TS", "Effective End Date of Provider Role"),
    ]),
  }),

  // ── Batch / file envelope ─────────────────────────────────────────────────────────────────────
  FHS: Object.freeze({
    chapter: "2",
    fields: 12,
    loci: Object.freeze([]),
    note: "The file header carries the field separator in its first position, exactly as MSH does, and the write-back model applies that offset for MSH alone. Its creation date/time is a stated residual rather than a position written at a number that may not be the one the standard means.",
  }),
  BHS: Object.freeze({
    chapter: "2",
    fields: 12,
    loci: Object.freeze([]),
    note: "The batch header carries the field separator in its first position; see the file header note.",
  }),
  BTS: Object.freeze({ chapter: "2", fields: 3, loci: Object.freeze([]) }),
  FTS: Object.freeze({ chapter: "2", fields: 2, loci: Object.freeze([]) }),

  // ── Clinical study ────────────────────────────────────────────────────────────────────────────
  CSR: Object.freeze({
    chapter: "7",
    fields: 16,
    loci: Object.freeze([
      f(6, "TS", "Date/Time of Patient Study Registration"),
      f(9, "TS", "Date/Time Patient Study Consent Signed"),
      f(11, "TS", "Study Randomization Date/Time"),
      f(15, "TS", "Date/Time Ended Study"),
    ]),
  }),
  CSP: Object.freeze({
    chapter: "7",
    fields: 4,
    loci: Object.freeze([
      f(2, "TS", "Date/Time Study Phase Began"),
      f(3, "TS", "Date/Time Study Phase Ended"),
    ]),
  }),
  CSS: Object.freeze({
    chapter: "7",
    fields: 3,
    loci: Object.freeze([f(2, "TS", "Study Scheduled Patient Time Point")]),
  }),
});

/**
 * The `OBX-2` value types that make `OBX-5` a date locus. Unlike every position in
 * {@link HL7_DATE_LOCI}, this one is **declared by the message**: `OBX-2` types the value carried at
 * `OBX-5`, so no table is needed and none is consulted. `DR` makes the locus **component-granular**
 * (a range start and a range end); the other three make it the field.
 *
 * @example
 * ```ts
 * import { OBX_DATE_VALUE_TYPES } from "@cosyte/deid/hl7";
 *
 * OBX_DATE_VALUE_TYPES.has("TM"); // => false (a time of day is not an element of a date)
 * ```
 */
export const OBX_DATE_VALUE_TYPES: ReadonlySet<string> = new Set(["DT", "DTM", "TS", "DR"]);

/**
 * The number of date components a `DR` (date/time range) carries: a range start and a range end, at
 * components 1 and 2.
 *
 * @internal
 */
export const DR_DATE_COMPONENTS: readonly number[] = Object.freeze([1, 2]);
