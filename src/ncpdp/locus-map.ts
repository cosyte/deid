/**
 * The **NCPDP Telecommunication (vD.0) locus map**: the cited table of *where* the 18 HIPAA Safe
 * Harbor identifier categories live in the `@cosyte/ncpdp` Telecom model, per segment and field. PHI is
 * located **structurally** at the parser's loci: a value is the patient's last name because it sits in
 * field `311-CB` of the Patient segment (`01`), not because a string "looked like" a name.
 *
 * NCPDP Telecom is a flat sequence of segments (`TelecomSegment { segmentId, fields }`), each field a
 * `{ id, value }` pair keyed by its 2-character NCPDP field id. The 3-character-prefixed field numbers
 * (e.g. `311-CB`) are globally unique in the standard, so keying off the field id is correct and
 * bypass-resistant: a corrupt Segment Identification (`AM`) cannot route a value away from its rule.
 *
 * The PHI-bearing segments: Patient (`01`), Prescriber (`03`), Insurance (`04`), the other-payer
 * Coordination of Benefits segment (`05`), and Prior Authorization (`12`): carry the individual's, the
 * cardholder's or a representative's identity, and keep only the fields a list names. The clinical /
 * financial / pharmacy segments (`02`, `07`, `08`, `10`, `11`, `13`) and the adjudication response
 * segments carry NDC drug codes, quantities, days-supply, pricing, and DUR reason codes, and are
 * **retained** (the over-scrub guard), each for the reason {@link TELECOM_RETAIN_SEGMENT_REASONS} gives,
 * except a free-text field, which **fails closed**, and a field a rule names
 * ({@link TELECOM_RETAINED_SEGMENT_RULES}). A segment id that is neither mapped nor retained is blocked
 * field-by-field.
 *
 * Field positions are grounded in the NCPDP Telecommunication Standard vD.0 segment definitions and the
 * sibling `@cosyte/ncpdp` field model (`FIELD_NAMES`, the Patient / Insurance / Prescriber decoders).
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";

const C = SAFE_HARBOR_CATEGORIES;

/**
 * How the extractor turns a mapped NCPDP field into a locus and how the applier rewrites it: the same
 * mode vocabulary as the X12 adapter (the transform itself is chosen by the engine from the category):
 *
 * - `redact`: a direct identifier with no analytic value (a name, a phone number). Cleared to `""`.
 * - `date`: a date value (date of birth, other-payer date). Generalized to year.
 * - `zip`: a postal code (`325-CP`). Generalized to the safe 3-digit form.
 * - `id`: an identifier value (patient id, cardholder id, group id). Pseudonymized to a consistent
 *   keyed surrogate (or removed when the category resolves to SSN).
 * - `block`: a value with no clean structured generalization (a street line, a city, a prescriber
 *   identifier). Fails **closed**: removed and recorded as category (R).
 */
export type TelecomFieldMode = "redact" | "date" | "zip" | "id" | "block";

/** A mapped PHI-bearing field within a segment: the mode and (for the direct modes) its category. */
export interface TelecomFieldRule {
  /** How to extract and rewrite the field value. */
  readonly mode: TelecomFieldMode;
  /** The Safe Harbor category, for the direct modes (`redact` / `date` / `zip` / `id`). */
  readonly category?: SafeHarborCategory;
  /**
   * For `date` fields only: `true` when the field is a **date of birth**, so a year that shows an age
   * over 89 is removed rather than kept (see `GenericLocus.dateOfBirth`).
   */
  readonly dateOfBirth?: boolean;
}

/**
 * The **Patient segment (`01`)** field map. Name / street / city / phone removed; date of birth and any
 * date generalized to year; ZIP generalized to its safe 3-digit form; the patient identifier
 * pseudonymized to a consistent surrogate. Gender (`305-C5`) and state (`324-CO`) are recognized
 * non-identifying values and are **not** mapped: they are retained.
 */
const PATIENT_01: Readonly<Record<string, TelecomFieldRule>> = {
  CA: { mode: "redact", category: C.NAMES }, // 310-CA Patient First Name
  CB: { mode: "redact", category: C.NAMES }, // 311-CB Patient Last Name
  C4: { mode: "date", category: C.DATES, dateOfBirth: true }, // 304-C4 Date of Birth → year, or removed over 89
  CM: { mode: "block" }, // 322-CM Patient Street Address → removed
  CN: { mode: "block" }, // 323-CN Patient City → removed
  CP: { mode: "zip", category: C.GEOGRAPHIC }, // 325-CP Patient ZIP/Postal Zone → 3-digit
  CQ: { mode: "redact", category: C.PHONE }, // 326-CQ Patient Phone Number
  CY: { mode: "id", category: C.MRN }, // 332-CY Patient ID (pseudonymized; may carry an SSN)
};

/**
 * The **Insurance segment (`04`)** field map. The cardholder is the covered person: cardholder id and
 * group id pseudonymized (health-plan beneficiary numbers), cardholder name removed. Person Code
 * (`303-C3`, a 01/02/03 relationship code) is not identifying alone and is retained.
 */
const INSURANCE_04: Readonly<Record<string, TelecomFieldRule>> = {
  C2: { mode: "id", category: C.HEALTH_PLAN_BENEFICIARY }, // 302-C2 Cardholder ID
  C1: { mode: "id", category: C.HEALTH_PLAN_BENEFICIARY }, // 301-C1 Group ID
  CC: { mode: "redact", category: C.NAMES }, // 312-CC Cardholder First Name
  CD: { mode: "redact", category: C.NAMES }, // 313-CD Cardholder Last Name
};

/**
 * The **Prescriber segment (`03`)** field map. **Prescriber identifiers are in scope** for NCPDP
 * (unlike the X12 adapter, which retains provider identity): the prescriber id (`411-DB`, an NPI / DEA /
 * state-license value per its `468-EZ` qualifier) is **removed** (blocked). This is a deliberate
 * asymmetry between the two EDI adapters.
 */
const PRESCRIBER_03: Readonly<Record<string, TelecomFieldRule>> = {
  DB: { mode: "block" }, // 411-DB Prescriber ID → removed (a prescriber identifier)
};

/**
 * The **Coordination of Benefits / Other Payments segment (`05`)** field map. The other-payer
 * cardholder id and group id are the *patient's* identifiers at another payer (PHI); the other-payer
 * date is a date of the individual's coverage. The other-payer id itself (`340-7C`) is a payer
 * identifier, not the patient's, and is retained when it has the form of one (five or six digits).
 */
const COB_05: Readonly<Record<string, TelecomFieldRule>> = {
  NU: { mode: "id", category: C.HEALTH_PLAN_BENEFICIARY }, // 356-NU Other Payer Cardholder ID
  MJ: { mode: "id", category: C.HEALTH_PLAN_BENEFICIARY }, // 351-MJ Other Payer Group ID
  E8: { mode: "date", category: C.DATES }, // 443-E8 Other Payer Date → year
};

/**
 * The **Prior Authorization segment (`12`)** field map. Besides the authorization's type and number, the
 * segment may carry the name and address of a person acting for the patient and the dates of the
 * request, and the field tables we hold name only the type code (`461-EU`) and the number submitted
 * (`462-EV`). So the segment is mapped rather than retained: the number submitted, an authorization
 * number issued for this patient, is removed, the type code is kept in the form of a code, and every
 * other populated field fails closed like an unlisted field of any mapped segment.
 */
const PRIOR_AUTH_12: Readonly<Record<string, TelecomFieldRule>> = {
  EV: { mode: "block" }, // 462-EV Prior Authorization Number Submitted → removed
};

/**
 * The full NCPDP Telecom locus map: segment id → its mapped PHI-bearing fields. A segment absent from
 * this map is either a recognized clinical / financial segment (retained, {@link TELECOM_RETAIN_SEGMENTS})
 * or an unknown segment (failed closed by the extractor).
 *
 * @example
 * ```ts
 * import { TELECOM_LOCUS_MAP } from "@cosyte/deid/ncpdp";
 *
 * TELECOM_LOCUS_MAP["01"]?.CB?.category; // => "NAMES"  (Patient Last Name)
 * ```
 */
export const TELECOM_LOCUS_MAP: Readonly<
  Record<string, Readonly<Record<string, TelecomFieldRule>>>
> = Object.freeze({
  "01": PATIENT_01,
  "03": PRESCRIBER_03,
  "04": INSURANCE_04,
  "05": COB_05,
  "12": PRIOR_AUTH_12,
});

/**
 * The **recognized non-identifier fields** retained within each mapped PHI segment: the positive
 * complement to {@link TELECOM_LOCUS_MAP} that closes the fail-closed frontier *inside* a PHI segment.
 *
 * A Patient / Prescriber / Insurance / COB segment carries many fields; the scrub map names only the
 * identifiers it transforms. Without this list an **unmapped** field in one of those segments would ride
 * through untouched, and the NCPDP standard defines identifier fields the scrub map does not enumerate
 * (e.g. `350-HN` Patient E-Mail, `359-2A` Medigap ID, a `990-MA`-style alternate id). So the extractor
 * treats a populated field in a PHI segment that is **neither** scrubbed **nor** on this retain list as a
 * candidate identifier and **blocks it** (Safe Harbor category (R)). This list therefore enumerates only
 * the fields that are positively **non-identifying**: coded demographics (gender, state, relationship,
 * place of service, smoker/pregnancy indicators, id-type qualifiers), non-patient payer references, and
 * monetary amounts / counts, so removing anything else can never destroy a clinical/financial value.
 *
 * Grounded in the NCPDP Telecommunication Standard vD.0 segment field lists and the sibling
 * `@cosyte/ncpdp` `FIELD_NAMES` registry.
 *
 * @example
 * ```ts
 * import { TELECOM_SEGMENT_RETAIN_FIELDS } from "@cosyte/deid/ncpdp";
 *
 * TELECOM_SEGMENT_RETAIN_FIELDS["01"]?.has("C5"); // => true  (gender, retained)
 * TELECOM_SEGMENT_RETAIN_FIELDS["01"]?.has("HN"); // => false (patient email, blocked)
 * ```
 */
export const TELECOM_SEGMENT_RETAIN_FIELDS: Readonly<Record<string, ReadonlySet<string>>> =
  Object.freeze({
    // Patient (01): coded demographics / clinical indicators, never an identifier.
    "01": new Set<string>([
      "C5", // 305-C5 Patient Gender Code
      "CO", // 324-CO Patient State/Province (the Safe Harbor geographic level that is retained)
      "C6", // 306-C6 Patient Relationship Code
      "C7", // 307-C7 Place of Service
      "CX", // 331-CX Patient ID Qualifier (the type code for the pseudonymized CY, metadata)
      "2C", // 335-2C Pregnancy Indicator (a coded clinical flag, not an identifier)
      "4X", // 384-4X Patient Residence (a coded residence type, not an address)
    ]),
    // Prescriber (03): the id qualifier only; the prescriber id (DB) is removed and any name/telecom
    // field falls through to a fail-closed block (provider identity is not clinical data).
    "03": new Set<string>(["EZ"]), // 466-EZ Prescriber ID Qualifier
    // Insurance (04): the relationship + eligibility codes (not identifiers).
    "04": new Set<string>([
      "C3", // 303-C3 Person Code (01/02/03 relationship indicator)
      "CE", // 309-CE Eligibility Clarification Code
    ]),
    // Coordination of Benefits (05): non-patient payer references, qualifiers, counts, and monetary
    // amounts: the financial/administrative fields that must survive; the patient's other-payer
    // cardholder (NU) and group (MJ) ids and the other-payer date (E8) are scrubbed by the map.
    "05": new Set<string>([
      "4C", // Coordination Of Benefits / Other Payments Count
      "5C", // Other Payer Coverage Type
      "6C", // Other Payer ID Qualifier
      "7C", // Other Payer ID (a payer identifier, not the patient's), kept only as five or six digits
      "HC", // Other Payer Amount Paid Qualifier
      "DV", // Other Payer Amount Paid (monetary)
      "6E", // Other Payer-Patient Responsibility Amount Qualifier
      "7E", // Other Payer-Patient Responsibility Amount (monetary)
      "NT", // Other Payer ID Count
      // Not "MH", the Other Payer Processor Control Number: up to ten letters or digits with no format
      // that tells a plan's routing code from a short name, so it is removed with the unlisted fields.
    ]),
    // Prior Authorization (12): the type code only; the number submitted (EV) is removed and every
    // other field (a representative's name or address, a request date) falls through to a block.
    "12": new Set<string>(["EU"]), // 461-EU Prior Authorization Type Code
  });

/**
 * NCPDP Telecom **free-text** field ids that carry human prose and therefore any of the 18 categories:
 * blocked by default, never scrubbed by a naive pass, wherever they appear (including
 * inside an otherwise-retained clinical / response segment). `544-FY` is the DUR free-text message,
 * `504-F4` is the response Message field, and `526-FQ` is the response Additional Message Information.
 *
 * @example
 * ```ts
 * import { TELECOM_FREE_TEXT_FIELDS } from "@cosyte/deid/ncpdp";
 *
 * TELECOM_FREE_TEXT_FIELDS.has("FY"); // => true (DUR free text, fails closed)
 * ```
 */
export const TELECOM_FREE_TEXT_FIELDS: ReadonlySet<string> = new Set<string>(["FY", "F4", "FQ"]);

/**
 * **Why each kept Telecom segment is kept**: segment id → the reason it is retained rather than mapped.
 * A segment is kept whole only with a reason listed here, and {@link TELECOM_RETAIN_SEGMENTS} is read off
 * this table, so the two cannot drift apart. The reasons are the over-scrub guard: each segment carries
 * the drug, quantity, pricing, clinical or adjudication values a released claim exists to keep, and
 * removing them would destroy what the output is for.
 *
 * Kept is not unexamined: a free-text field in any of them fails closed, a field
 * {@link TELECOM_RETAINED_SEGMENT_RULES} names is transformed or removed, and every other populated field
 * is counted as an unexamined residual.
 *
 * @example
 * ```ts
 * import { TELECOM_RETAIN_SEGMENT_REASONS } from "@cosyte/deid/ncpdp";
 *
 * TELECOM_RETAIN_SEGMENT_REASONS["11"]; // => "Pricing: the amounts claimed and their qualifiers."
 * TELECOM_RETAIN_SEGMENT_REASONS["12"]; // => undefined (Prior Authorization is mapped, not kept)
 * ```
 */
export const TELECOM_RETAIN_SEGMENT_REASONS: Readonly<Record<string, string>> = Object.freeze({
  "02": "Pharmacy Provider: the dispensing pharmacy's own identifiers, not the patient's.",
  "07":
    "Claim: the product, quantity, days supply and fill of the prescription; its dates and " +
    "its scheduled prescription and alternate ids are reached by a rule.",
  "08": "DUR / PPS: the reason, professional service and result of service codes; free text fails closed.",
  "10": "Compound: the ingredient product ids, quantities and costs.",
  "11": "Pricing: the amounts claimed and their qualifiers.",
  "13":
    "Clinical: the diagnosis codes and measurements the claim carries; its measurement dates are " +
    "reached by a rule.",
  "20": "Response Message: the payer's message, which fails closed as free text.",
  "21":
    "Response Status: the status, reject codes and the payer's authorization number; the " +
    "additional message fails closed.",
  "22": "Response Claim: the reference number and qualifier of the claim answered.",
  "23": "Response Pricing: the amounts paid and the basis of reimbursement.",
  "24":
    "Response DUR / PPS: the alert codes and the quantity of a previous fill; its previous date " +
    "of fill is reached by a rule and its free text fails closed.",
});

/**
 * The recognized **clinical / financial / pharmacy** Telecom segments retained (passed through
 * untouched): the positive half of the fail-closed rule (the analogue of the HL7 / X12 retain lists),
 * read off {@link TELECOM_RETAIN_SEGMENT_REASONS}, so a segment is kept only with a listed reason. They
 * carry NDC drug codes, quantities, days-supply, pricing amounts, and DUR reason codes, so their values
 * survive the over-scrub test byte-identical. A free-text field inside one of these still fails closed.
 * A segment id that is neither mapped ({@link TELECOM_LOCUS_MAP}) nor on this list is blocked
 * field-by-field. Prior Authorization (`12`) is mapped, not kept.
 *
 * A retained segment keeps every field but the ones {@link TELECOM_RETAINED_SEGMENT_RULES} names: the
 * Claim segment's dates of the individual's care (`414-DE`, `457-EP`), the Clinical segment's
 * Measurement Date (`494-ZE`) and the response DUR segment's Previous Date Of Fill (`530-FU`) are
 * generalized like any other date, and the Claim segment's Scheduled Prescription ID Number
 * (`454-EK`) and Alternate ID (`330-CW`) are removed.
 *
 * **Documented limitation (mirrors the HL7 / X12 adapters).** A retained segment may carry a field the
 * field tables we hold do not place, or a per-prescription reference (`402-D2` Rx reference number).
 * Each is kept and counted as an unexamined residual, never passed through unrecorded; forgetting a
 * clinical segment here fails **safe**: blocked, not leaked.
 *
 * @example
 * ```ts
 * import { TELECOM_RETAIN_SEGMENTS } from "@cosyte/deid/ncpdp";
 *
 * TELECOM_RETAIN_SEGMENTS.has("07"); // => true (Claim, NDC / quantity / pricing retained)
 * TELECOM_RETAIN_SEGMENTS.has("12"); // => false (Prior Authorization, mapped)
 * ```
 */
export const TELECOM_RETAIN_SEGMENTS: ReadonlySet<string> = new Set<string>(
  Object.keys(TELECOM_RETAIN_SEGMENT_REASONS),
);

/**
 * The **Claim segment (`07`)** fields a rule reaches although the segment is retained: its two dates of
 * the individual's care, and two identifiers public payer sheets place in the segment.
 *
 * `454-EK` Scheduled Prescription ID Number names one scheduled (controlled) drug prescription, and
 * `330-CW` Alternate ID is an alternate claim or member reference (one sheet: Medicare's reference
 * number on a crossover claim). No public sheet gives the length or picture of either, so a surrogate
 * cannot be shaped to fit: each is removed and recorded, whatever the profile.
 */
const CLAIM_07_RULES: Readonly<Record<string, TelecomFieldRule>> = Object.freeze({
  DE: { mode: "date", category: C.DATES }, // 414-DE Date Prescription Written → year
  EP: { mode: "date", category: C.DATES }, // 457-EP Associated Prescription/Service Date → year
  EK: { mode: "block" }, // 454-EK Scheduled Prescription ID Number → removed
  CW: { mode: "block" }, // 330-CW Alternate ID → removed
});

/**
 * The **Clinical segment (`13`)** field a rule reaches although the segment is retained: the Measurement
 * Date (`494-ZE`, `CCYYMMDD`), the day a measurement of the patient was taken. It may repeat, once per
 * measurement, and every occurrence is reached.
 */
const CLINICAL_13_DATES: Readonly<Record<string, TelecomFieldRule>> = Object.freeze({
  ZE: { mode: "date", category: C.DATES }, // 494-ZE Measurement Date → year
});

/**
 * The **Response DUR / PPS segment (`24`)** field a rule reaches although the segment is retained: the
 * Previous Date Of Fill, the day the patient's earlier, conflicting prescription was filled.
 */
const RESPONSE_DUR_24_DATES: Readonly<Record<string, TelecomFieldRule>> = Object.freeze({
  FU: { mode: "date", category: C.DATES }, // 530-FU Previous Date Of Fill → year
});

/**
 * The **ruled fields of a retained segment**: the fields of a recognized clinical / financial segment
 * ({@link TELECOM_RETAIN_SEGMENTS}) that a rule reaches although the segment itself is retained. Every
 * other field of such a segment is kept untouched and counted as an unexamined residual; a field named
 * here is located and transformed by its rule, the same way a field in a mapped segment is.
 *
 * The Claim segment (`07`) carries two dates of the individual's care, and Safe Harbor removes every
 * element of a date but the year from a date directly related to an individual:
 *
 * - `414-DE` Date Prescription Written, the day the prescriber wrote the patient's prescription;
 * - `457-EP` Associated Prescription/Service Date, the date of the patient's earlier fill or service
 *   this claim is tied to (a partial fill's completion, say).
 *
 * The Clinical segment (`13`) carries `494-ZE` Measurement Date, the day a measurement of the patient
 * was taken, once per measurement. Public payer sheets place it there, in `CCYYMMDD` form.
 *
 * The response DUR / PPS segment (`24`) carries one: `530-FU` Previous Date Of Fill, the day the
 * patient's earlier prescription that the alert is about was filled. `@cosyte/ncpdp` names it in its
 * field table and lifts it as the alert's previous date of fill.
 *
 * Each is treated as the header Date of Service (`401-D1`) and the other payer date (`443-E8`) are:
 * generalized to the year under Safe Harbor, shifted under a profile that shifts dates.
 *
 * The Claim segment also carries two identifiers that public payer sheets place there: `454-EK`
 * Scheduled Prescription ID Number, which names one scheduled (controlled) drug prescription, and
 * `330-CW` Alternate ID, an alternate claim or member reference. Each is removed and recorded under
 * every profile: no public sheet gives its length or picture, so no surrogate can be shaped to it. The
 * Pricing
 * segment (`11`) carries amounts and codes and no date, so it has no entry here; the Prescriber segment
 * (`03`) is a mapped segment, where every field but its id qualifier is removed.
 *
 * @example
 * ```ts
 * import { TELECOM_RETAINED_SEGMENT_RULES } from "@cosyte/deid/ncpdp";
 *
 * TELECOM_RETAINED_SEGMENT_RULES["07"]?.DE?.mode; // => "date"  (Date Prescription Written)
 * TELECOM_RETAINED_SEGMENT_RULES["07"]?.D7; // => undefined (the NDC, retained)
 * TELECOM_RETAINED_SEGMENT_RULES["07"]?.EK?.mode; // => "block" (Scheduled Prescription ID Number)
 * TELECOM_RETAINED_SEGMENT_RULES["13"]?.ZE?.mode; // => "date"  (Measurement Date)
 * TELECOM_RETAINED_SEGMENT_RULES["24"]?.FU?.mode; // => "date"  (Previous Date Of Fill)
 * ```
 */
export const TELECOM_RETAINED_SEGMENT_RULES: Readonly<
  Record<string, Readonly<Record<string, TelecomFieldRule>>>
> = Object.freeze({
  "07": CLAIM_07_RULES,
  "13": CLINICAL_13_DATES,
  "24": RESPONSE_DUR_24_DATES,
});
