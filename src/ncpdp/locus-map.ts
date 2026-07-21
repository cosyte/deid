/**
 * The **NCPDP Telecommunication (vD.0) locus map** — the cited table of *where* the 18 HIPAA Safe
 * Harbor identifier categories live in the `@cosyte/ncpdp` Telecom model, per segment and field. PHI is
 * located **structurally** at the parser's loci: a value is the patient's last name because it sits in
 * field `311-CB` of the Patient segment (`01`), not because a string "looked like" a name.
 *
 * NCPDP Telecom is a flat sequence of segments (`TelecomSegment { segmentId, fields }`), each field a
 * `{ id, value }` pair keyed by its 2-character NCPDP field id. The 3-character-prefixed field numbers
 * (e.g. `311-CB`) are globally unique in the standard, so keying off the field id is correct and
 * bypass-resistant — a corrupt Segment Identification (`AM`) cannot route a value away from its rule.
 *
 * The three PHI-bearing segments — Patient (`01`), Prescriber (`03`), Insurance (`04`), and the other-payer
 * Coordination of Benefits segment (`05`) — carry the individual's and the cardholder's identity. The
 * clinical / financial / pharmacy segments (`02`, `07`, `08`, `10`, `11`, `12`, `13`) and the adjudication
 * response segments carry NDC drug codes, quantities, days-supply, pricing, and DUR reason codes — no
 * direct patient identifier — and are **retained untouched** (the over-scrub guard), except a free-text
 * field, which **fails closed**. A segment id that is neither mapped nor retained is blocked field-by-field.
 *
 * Field positions are grounded in the NCPDP Telecommunication Standard vD.0 segment definitions and the
 * sibling `@cosyte/ncpdp` field model (`FIELD_NAMES`, the Patient / Insurance / Prescriber decoders).
 *
 * @packageDocumentation
 */

import { SAFE_HARBOR_CATEGORIES, type SafeHarborCategory } from "../categories.js";

const C = SAFE_HARBOR_CATEGORIES;

/**
 * How the extractor turns a mapped NCPDP field into a locus and how the applier rewrites it — the same
 * mode vocabulary as the X12 adapter (the transform itself is chosen by the engine from the category):
 *
 * - `redact` — a direct identifier with no analytic value (a name, a phone number). Cleared to `""`.
 * - `date` — a date value (date of birth, other-payer date). Generalized to year.
 * - `zip` — a postal code (`325-CP`). Generalized to the safe 3-digit form.
 * - `id` — an identifier value (patient id, cardholder id, group id). Pseudonymized to a consistent
 *   keyed surrogate (or removed when the category resolves to SSN).
 * - `block` — a value with no clean structured generalization (a street line, a city, a prescriber
 *   identifier). Fails **closed**: removed and recorded as category (R).
 */
export type TelecomFieldMode = "redact" | "date" | "zip" | "id" | "block";

/** A mapped PHI-bearing field within a segment: the mode and (for the direct modes) its category. */
export interface TelecomFieldRule {
  /** How to extract and rewrite the field value. */
  readonly mode: TelecomFieldMode;
  /** The Safe Harbor category, for the direct modes (`redact` / `date` / `zip` / `id`). */
  readonly category?: SafeHarborCategory;
}

/**
 * The **Patient segment (`01`)** field map. Name / street / city / phone removed; date of birth and any
 * date generalized to year; ZIP generalized to its safe 3-digit form; the patient identifier
 * pseudonymized to a consistent surrogate. Gender (`305-C5`) and state (`324-CO`) are recognized
 * non-identifying values and are **not** mapped — they are retained.
 */
const PATIENT_01: Readonly<Record<string, TelecomFieldRule>> = {
  CA: { mode: "redact", category: C.NAMES }, // 310-CA Patient First Name
  CB: { mode: "redact", category: C.NAMES }, // 311-CB Patient Last Name
  C4: { mode: "date", category: C.DATES }, // 304-C4 Date of Birth → year
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
 * The **Prescriber segment (`03`)** field map. The roadmap scopes **prescriber identifiers** for NCPDP
 * (unlike the X12 adapter, which retains provider identity): the prescriber id (`411-DB`, an NPI / DEA /
 * state-license value per its `468-EZ` qualifier) is **removed** (blocked). This is the deliberate,
 * roadmap-grounded asymmetry between the two EDI adapters in this phase.
 */
const PRESCRIBER_03: Readonly<Record<string, TelecomFieldRule>> = {
  DB: { mode: "block" }, // 411-DB Prescriber ID → removed (roadmap-scoped prescriber identifier)
};

/**
 * The **Coordination of Benefits / Other Payments segment (`05`)** field map. The other-payer
 * cardholder id and group id are the *patient's* identifiers at another payer (PHI); the other-payer
 * date is a date of the individual's coverage. The other-payer id itself (`340-7C`) is a payer
 * identifier, not the patient's, and is retained.
 */
const COB_05: Readonly<Record<string, TelecomFieldRule>> = {
  NU: { mode: "id", category: C.HEALTH_PLAN_BENEFICIARY }, // 356-NU Other Payer Cardholder ID
  MJ: { mode: "id", category: C.HEALTH_PLAN_BENEFICIARY }, // 351-MJ Other Payer Group ID
  E8: { mode: "date", category: C.DATES }, // 443-E8 Other Payer Date → year
};

/**
 * The full NCPDP Telecom locus map — segment id → its mapped PHI-bearing fields. A segment absent from
 * this map is either a recognized clinical / financial segment (retained — {@link TELECOM_RETAIN_SEGMENTS})
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
});

/**
 * NCPDP Telecom **free-text** field ids that carry human prose and therefore any of the 18 categories —
 * blocked by default (roadmap §4.5), never scrubbed by a naive pass, wherever they appear (including
 * inside an otherwise-retained clinical / response segment). `544-FY` is the DUR free-text message and
 * `504-F4` is the response Message field.
 *
 * @example
 * ```ts
 * import { TELECOM_FREE_TEXT_FIELDS } from "@cosyte/deid/ncpdp";
 *
 * TELECOM_FREE_TEXT_FIELDS.has("FY"); // => true (DUR free text — fails closed)
 * ```
 */
export const TELECOM_FREE_TEXT_FIELDS: ReadonlySet<string> = new Set<string>(["FY", "F4"]);

/**
 * The recognized **clinical / financial / pharmacy** Telecom segments retained (passed through
 * untouched) — the positive half of the fail-closed rule (the analogue of the HL7 / X12 retain lists).
 * They carry NDC drug codes, quantities, days-supply, pricing amounts, and DUR reason codes — no direct
 * patient identifier — so their values survive the over-scrub test byte-identical. A free-text field
 * inside one of these still fails closed. A segment id that is neither mapped ({@link TELECOM_LOCUS_MAP})
 * nor on this list is blocked field-by-field.
 *
 * **Documented Phase-5 limitation (mirrors the HL7 / X12 adapters).** A retained segment may carry a
 * residual patient-related date (a `456-EW` associated prescription date, a `530-FU` previous date of
 * fill) or a per-prescription reference (`402-D2` Rx reference number). Selective scrubbing of those
 * residual loci is a later phase; forgetting a clinical segment here fails **safe** — blocked, not leaked.
 *
 * @example
 * ```ts
 * import { TELECOM_RETAIN_SEGMENTS } from "@cosyte/deid/ncpdp";
 *
 * TELECOM_RETAIN_SEGMENTS.has("07"); // => true (Claim — NDC / quantity / pricing retained)
 * ```
 */
export const TELECOM_RETAIN_SEGMENTS: ReadonlySet<string> = new Set<string>([
  "02", // Pharmacy Provider (the pharmacy's own id — not the patient)
  "07", // Claim (NDC, quantity, days supply, DAW, Rx reference number)
  "08", // DUR / PPS (reason / professional-service / result-of-service codes)
  "10", // Compound (ingredient NDCs, quantities, costs)
  "11", // Pricing (ingredient cost, dispensing fee, patient pay — monetary)
  "12", // Prior Authorization (type / number)
  "13", // Clinical (diagnosis codes, measurements)
  // Response segments (adjudication results — status / pricing / DUR codes and amounts).
  "20", // Response Message (free-text 504-F4 still fails closed)
  "21", // Response Status
  "22", // Response Claim
  "23", // Response Pricing
  "24", // Response DUR / PPS
]);
