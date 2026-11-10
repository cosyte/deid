/**
 * The **X12 element shapes**: for every segment the adapter keeps any part of, which element positions
 * it keeps and the shape a value must have to be kept there. This is the closing half of the X12
 * fail-closed rule.
 *
 * The locus rules in `./locus-map.js` name the positions that carry an identifier and transform them. Every
 * other position of a segment the pass hands through is decided here, exactly as written:
 *
 * - a **code** position keeps a value only when it is a code the position knows (a list, or the exact
 *   shape of a published code set such as ICD-10-CM or HCPCS);
 * - a **date** position keeps or transforms a value only when it is a valid date in the format the
 *   segment declares;
 * - an **amount**, **quantity** or **count** position keeps only a number;
 * - an **administrative reference** position (a trace number, a control number, a trading partner id)
 *   keeps a bounded run of printable characters, because the rule decided that value is not the
 *   individual's;
 * - a **free-text** component is always removed;
 * - and a position **no shape names** is not kept at all.
 *
 * A value that fails its shape, or that sits at a position no shape names, is removed and recorded as a
 * blocked row at its own position. The usual way a value lands somewhere it does not belong is a missing
 * or an extra element separator, which shifts every value after it by one position; an identifier
 * shifted into a code, date or unused position must never leave in the clear.
 *
 * Code lists are grounded in the HIPAA 005010 TR3s for 837P / 837I / 837D (X222A1, X223A2, X224A2),
 * 835 (X221A1), 270 / 271 (X279A1), 276 / 277 (X212), 278 (X217), 834 (X220A1), 999 (X231A1) and TA1,
 * and in the X12 envelope (`ISA` / `GS` / `ST` / `SE` / `GE` / `IEA`). Each list is the union of the
 * codes those TR3s name at that position, so a list shared by several segments (the date qualifier, the
 * amount qualifier, the relationship code) holds every transaction set's codes.
 *
 * @packageDocumentation
 * @internal
 */

/** What a shape test may read besides the value: the delimiters, and the segment the value sits in. */
export interface X12ShapeContext {
  /** The interchange's component separator (`ISA-16`). */
  readonly component: string;
  /** The interchange's repetition separator (`ISA-11`). */
  readonly repetition: string;
  /** The 1-indexed decoded elements of the segment the value sits in. */
  readonly elements: readonly string[];
  /** The components of the composite the value sits in, when it is a component. */
  readonly components?: readonly string[];
}

/** A test a value must pass to be kept at a position. */
export type X12ShapeTest = (value: string, ctx: X12ShapeContext) => boolean;

/** Where a date position reads its declared format: a sibling element (or component), or a fixed one. */
export type X12DateFormatSource =
  | { readonly from: "element"; readonly position: number }
  | { readonly from: "component"; readonly position: number }
  | { readonly from: "fixed"; readonly format: string };

/**
 * How one component of a composite element is decided:
 *
 * - `keep`: kept when its value passes {@link X12ComponentShape.test};
 * - `free`: free text, always removed (blocked at the component's own position);
 * - `date`: a date of the individual, transformed as a date when it is valid in the declared format, and
 *   removed otherwise.
 */
export type X12ComponentShape =
  | { readonly kind: "keep"; readonly test: X12ShapeTest }
  | { readonly kind: "free" }
  | { readonly kind: "date"; readonly format: X12DateFormatSource };

/**
 * How one element position is decided when no locus rule acted on it:
 *
 * - `keep`: kept when its value passes {@link X12ElementShape.test} (every repetition of it, when the
 *   element repeats);
 * - `date`: a date of the individual, transformed as a date when it is valid in the declared format;
 * - `composite`: split on the component separator and decided component by component. A composite
 *   with more components than the shape names, or a component that fails its test, is removed whole.
 */
export type X12ElementShape =
  | { readonly kind: "keep"; readonly test: X12ShapeTest }
  | { readonly kind: "date"; readonly format: X12DateFormatSource }
  | { readonly kind: "composite"; readonly components: readonly X12ComponentShape[] };

/* ------------------------------------------------------------------------- primitive tests */

/** `true` when `year`, `month` and `day` name a real calendar day. */
function isCalendarDay(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

/** `CCYYMMDD`, a real calendar day. */
function isD8(value: string): boolean {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (match === null) return false;
  return isCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** `YYMMDD`, a real calendar day in either century. */
function isD6(value: string): boolean {
  const match = /^(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (match === null) return false;
  return isCalendarDay(2000 + Number(match[1]), Number(match[2]), Number(match[3]));
}

/** `HHMM`, optionally followed by seconds and decimal seconds: a real time of day. */
function isTime(value: string): boolean {
  return /^([01]\d|2[0-3])[0-5]\d([0-5]\d\d{0,2})?$/.test(value);
}

/** `HHMM` exactly, the width the `ISA` and `TA1` declare. */
function isTime4(value: string): boolean {
  return /^([01]\d|2[0-3])[0-5]\d$/.test(value);
}

/**
 * `true` when `value` is a valid date in the X12 date-time period format `format` names (element
 * 1250). Only the formats that carry a calendar date are dates: `D8` (`CCYYMMDD`), `RD8`
 * (`CCYYMMDD-CCYYMMDD`) and `DT` (`CCYYMMDDHHMM`). Any other format, `TM` (a time of day) included,
 * declares no date, so no value is a valid date in it.
 *
 * @param value - The element or component value.
 * @param format - The declared format code, exactly as written.
 * @returns Whether the value is a valid date in that format.
 * @internal
 */
export function isX12DateInFormat(value: string, format: string): boolean {
  switch (format) {
    case "D8":
      return isD8(value);
    case "RD8": {
      const parts = value.split("-");
      return parts.length === 2 && isD8(parts[0] ?? "") && isD8(parts[1] ?? "");
    }
    case "DT":
      return value.length === 12 && isD8(value.slice(0, 8)) && isTime4(value.slice(8));
    default:
      return false;
  }
}

/** A decimal number of at most 18 digits, optionally signed (X12 data element type `R`). */
function isDecimal(value: string): boolean {
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(value)) return false;
  return value.replace(/[^0-9]/g, "").length <= 18;
}

/** A whole number of at most 15 digits, optionally signed (X12 data element type `N0`). */
function isWhole(value: string): boolean {
  return /^-?\d{1,15}$/.test(value);
}

/** Keep a value from this fixed list, exactly as written. */
function oneOf(codes: string): X12ShapeTest {
  const set = new Set<string>(codes.trim().split(/\s+/));
  return (value) => set.has(value);
}

/** Keep a value from this set, exactly as written. */
function inSet(set: ReadonlySet<string>): X12ShapeTest {
  return (value) => set.has(value);
}

/** Keep a value matching this whole pattern. */
function matching(pattern: RegExp): X12ShapeTest {
  return (value) => pattern.test(value);
}

/**
 * An **administrative reference** of at most `max` printable characters, not blank: a trace number, a
 * control number, a trading partner or payer id. The rule that names it decided the value is not the
 * individual's; the shape only bounds what may sit there.
 */
function reference(max: number): X12ShapeTest {
  const pattern = new RegExp(`^[\\x20-\\x7E]{1,${String(max)}}$`);
  return (value) => pattern.test(value) && value.trim().length > 0;
}

/** Keep every repetition of a repeating element when each passes `test`. */
function repeating(test: X12ShapeTest): X12ShapeTest {
  return (value, ctx) => value.split(ctx.repetition).every((part) => test(part, ctx));
}

const keep = (test: X12ShapeTest): X12ElementShape => ({ kind: "keep", test });
const part = (test: X12ShapeTest): X12ComponentShape => ({ kind: "keep", test });
const FREE: X12ComponentShape = { kind: "free" };
/** A component the TR3s mark not used: any value there makes the composite untrusted. */
const NOT_USED: X12ComponentShape = { kind: "keep", test: () => false };
const composite = (...components: X12ComponentShape[]): X12ElementShape => ({
  kind: "composite",
  components,
});

const DATE8 = keep(isD8);
const DATE6 = keep(isD6);
const TIME = keep(isTime);
const TIME4 = keep(isTime4);
const DECIMAL = keep(isDecimal);
const WHOLE = keep(isWhole);
const YES_NO = keep(oneOf("Y N"));
const DATE_FORMAT = keep(oneOf("D8 RD8 DT TM"));

/* ------------------------------------------------------------------------------ code lists */

/** Element 365, communication number qualifier (`PER-03` / `05` / `07`), the 834 phones included. */
const COMMUNICATION_QUALIFIER = keep(oneOf("AP BN CP ED EM EX FX HP TE UR WP"));

/** Element 1336, insurance type code (`SBR-05`, `EB-04`). */
const INSURANCE_TYPE = oneOf(
  "12 13 14 15 16 41 42 43 47 AP C1 CO CP D DB EP FF GP HM HN HS IN IP LC LD LI LT MA MB MC MH MI " +
    "MP OT PE PL PP PR PS QM RP SP TF WC WU",
);

/** Element 1032, claim filing indicator code (`SBR-09`, `CLP-06`). */
const CLAIM_FILING = oneOf("11 12 13 14 15 16 17 AM BL CH CI DS FI HM LM MA MB MC OF TV VA WC ZZ");

/**
 * Element 1069, individual relationship code (`SBR-02`, `PAT-01`, `INS-02`): the 837, 271 and 278
 * codes, and the 834 member relationships (`25` to `60`, `D2`, `G9`).
 */
const RELATIONSHIP = oneOf(
  "01 03 04 05 07 09 10 15 17 18 19 20 21 22 23 24 25 26 29 31 32 33 34 36 38 39 40 41 43 48 49 53 " +
    "60 76 D2 G8 G9",
);

/**
 * Element 374, date/time qualifier: the codes the TR3s use at `DTP-01` and `DTM-01`. That includes the
 * 837D appliance placement (`452`), the 271 certification, policy and status dates (`458`, `539`,
 * `540`, `771`), the 278 effective and estimated-birth dates (`007`, `ABC`), and the 834 member,
 * employment, coverage and coordination-of-benefits dates.
 */
const DATE_QUALIFIER = oneOf(
  "007 009 011 036 050 090 091 096 102 139 150 151 152 193 194 196 198 232 233 286 290 291 292 " +
    "295 296 297 300 301 303 304 307 314 318 336 337 338 339 340 341 342 343 344 345 346 347 348 " +
    "349 350 351 356 357 360 361 368 382 383 385 386 388 393 394 405 431 434 435 438 439 441 442 " +
    "444 446 452 453 454 455 456 458 461 463 471 472 473 474 484 539 540 543 573 607 636 695 738 " +
    "739 771 AAH ABC",
);

/**
 * Element 522, amount qualifier code (`AMT-01`): the 837 and 835 codes, the 276 total submitted
 * charges (`T3`), and the 834 coverage amounts (`B9`, `C1`, `D2`, `EBA`, `FK`, `P3`, `R`).
 */
const AMOUNT_QUALIFIER = oneOf(
  "A8 AU B6 B9 C1 D D2 D8 DY EAF F3 F4 F5 FK I KH NL P3 R T T2 T3 ZK ZL ZM ZN ZO ZT",
);

/**
 * Element 673, quantity qualifier (`QTY-01`, `EB-09`), with the 834 header totals (`DT`, `ET`, `TO`).
 */
const QUANTITY_QUALIFIER = oneOf(
  "8H 90 91 99 CA CD CE D3 DB DT DY ET FL HS LA LE M2 MN NA NE NR OU P6 PS PT QA S7 S8 TO VS YY " +
    "ZK ZL ZM ZN ZO",
);

/** Element 235, product or service id qualifier (the first component of a procedure composite). */
const SERVICE_QUALIFIER = new Set<string>([
  "AD",
  "CJ",
  "ER",
  "HC",
  "HP",
  "ID",
  "IV",
  "N4",
  "NU",
  "WK",
  "ZZ",
]);

/** A procedure or product code, shaped by the qualifier the composite's first component names. */
function serviceCode(value: string, ctx: X12ShapeContext): boolean {
  switch (ctx.components?.[0] ?? "") {
    case "HC": // HCPCS Level I (CPT) or Level II
      return /^[A-Z0-9]\d{3}[A-Z0-9]$/.test(value);
    case "AD": // ADA CDT
      return /^D\d{4}$/.test(value);
    case "N4": // NDC in 5-4-2 form
      return /^\d{11}$/.test(value);
    case "NU": // NUBC revenue code
      return /^\d{4}$/.test(value);
    case "HP": // HIPPS rate code
      return /^[A-Z0-9]{5}$/.test(value);
    default: // a jurisdiction, ABC, HIEC, CPT, ICD procedure or mutually defined code
      return /^[A-Z0-9]{1,48}$/.test(value);
  }
}

const MODIFIER = part(matching(/^[A-Z0-9]{2}$/));

/**
 * Composite C003, a procedure: qualifier, code, up to four modifiers, and a free-text description that
 * is always removed.
 */
const PROCEDURE = composite(
  part(inSet(SERVICE_QUALIFIER)),
  part(serviceCode),
  MODIFIER,
  MODIFIER,
  MODIFIER,
  MODIFIER,
  FREE,
);

/** Composite C004, a diagnosis code pointer: up to four pointers, each 1 to 12. */
const POINTER = part(matching(/^([1-9]|1[0-2])$/));
const DIAGNOSIS_POINTERS = composite(POINTER, POINTER, POINTER, POINTER);

/** CARC, a claim adjustment reason code. */
const ADJUSTMENT_REASON = keep(matching(/^([1-9]\d{0,2}|[ABDPWY]\d{1,2})$/));

/** RARC, a remittance advice remark code. */
const REMARK = keep(matching(/^(MA\d{1,3}|M\d{1,3}|N\d{1,4})$/));

/** An implementation or 999 error code: one to three letters or digits. */
const ERROR_CODE = keep(matching(/^[A-Z0-9]{1,3}$/));

/** A US state or territory, a military post, or a Canadian province (element 156). */
export const STATE_OR_PROVINCE_CODES: ReadonlySet<string> = new Set<string>(
  (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM " +
    "NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY " +
    "AS GU MP PR VI UM FM MH PW AA AE AP " +
    "AB BC MB NB NL NS NT NU ON PE QC SK YT"
  ).split(" "),
);

/** ISO 3166-1 alpha-2, the code source the TR3s name for a country (element 26). */
export const COUNTRY_CODES: ReadonlySet<string> = new Set<string>(
  (
    "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS " +
    "BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE " +
    "EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM " +
    "HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC " +
    "LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA " +
    "NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
    "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO " +
    "TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
  ).split(" "),
);

/* -------------------------------------------------------------------------- the HI composite */

/** The `HI` code list qualifiers (element 1270), each with the shape of the code it qualifies. */
const HEALTH_CARE_CODE: Readonly<Record<string, RegExp>> = {
  // ICD-10-CM diagnoses: principal, other, admitting, external cause, patient reason for visit.
  ABK: /^[A-Z]\d[A-Z0-9]{1,5}$/,
  ABF: /^[A-Z]\d[A-Z0-9]{1,5}$/,
  ABJ: /^[A-Z]\d[A-Z0-9]{1,5}$/,
  ABN: /^[A-Z]\d[A-Z0-9]{1,5}$/,
  APR: /^[A-Z]\d[A-Z0-9]{1,5}$/,
  // ICD-9-CM diagnoses, for a claim from before the ICD-10 date.
  BK: /^(\d{3,5}|V\d{2,4}|E\d{3,4})$/,
  BF: /^(\d{3,5}|V\d{2,4}|E\d{3,4})$/,
  BJ: /^(\d{3,5}|V\d{2,4}|E\d{3,4})$/,
  BN: /^(\d{3,5}|V\d{2,4}|E\d{3,4})$/,
  PR: /^(\d{3,5}|V\d{2,4}|E\d{3,4})$/,
  // ICD-10-PCS procedures: principal and other.
  BBR: /^[0-9A-HJ-NP-Z]{7}$/,
  BBQ: /^[0-9A-HJ-NP-Z]{7}$/,
  // ICD-9-CM procedures.
  BR: /^\d{2,4}$/,
  BQ: /^\d{2,4}$/,
  // HCPCS procedures (anesthesia-related and other).
  BP: /^[A-Z0-9]\d{3}[A-Z0-9]$/,
  BO: /^[A-Z0-9]\d{3}[A-Z0-9]$/,
  // DRG.
  DR: /^\d{3,4}$/,
  // NUBC condition, occurrence, occurrence span and value codes.
  BG: /^[A-Z0-9]{2}$/,
  BH: /^[A-Z0-9]{2}$/,
  BI: /^[A-Z0-9]{2}$/,
  BE: /^[A-Z0-9]{2}$/,
  // Treatment codes.
  TC: /^[A-Z0-9]{1,30}$/,
};

/**
 * Composite C022, one `HI` entry: qualifier, code (shaped by the qualifier), the format of the date that
 * follows, the date (a date of the individual's care, transformed as a date), an amount (a value code's
 * value), a quantity, and the present-on-admission indicator.
 */
const HEALTH_CARE_CODE_INFO = composite(
  part((value) => Object.prototype.hasOwnProperty.call(HEALTH_CARE_CODE, value)),
  part((value, ctx) => HEALTH_CARE_CODE[ctx.components?.[0] ?? ""]?.test(value) === true),
  part(oneOf("D8 RD8")),
  { kind: "date", format: { from: "component", position: 3 } },
  part(isDecimal),
  part(isDecimal),
  NOT_USED, // C022-07, version identifier
  NOT_USED, // C022-08, a range end code
  part(oneOf("N U W Y 1")),
);

/* ----------------------------------------------------------------------- the segment shapes */

/** Twelve `HI` entries. */
const HI_SHAPES: Record<number, X12ElementShape> = {};
for (let n = 1; n <= 12; n += 1) HI_SHAPES[n] = HEALTH_CARE_CODE_INFO;

/** The `CAS` adjustment triples: reason, amount, quantity, six times over. */
const CAS_SHAPES: Record<number, X12ElementShape> = {
  1: keep(oneOf("CO CR OA PI PR")),
};
for (let n = 2; n <= 17; n += 3) {
  CAS_SHAPES[n] = ADJUSTMENT_REASON;
  CAS_SHAPES[n + 1] = DECIMAL;
  CAS_SHAPES[n + 2] = DECIMAL;
}

/** The `MIA` inpatient adjudication: amounts and quantities, with remark codes at 5 and 20 to 23. */
const MIA_SHAPES: Record<number, X12ElementShape> = {};
for (let n = 1; n <= 24; n += 1) MIA_SHAPES[n] = [5, 20, 21, 22, 23].includes(n) ? REMARK : DECIMAL;

/** The interchange id qualifier (element I05). */
const INTERCHANGE_ID_QUALIFIER = keep(oneOf("01 14 20 27 28 29 30 33 ZZ"));

/** The functional identifier code (element 479, `GS-01`, `AK1-01`). */
const FUNCTIONAL_ID = keep(oneOf("BE FA HB HC HI HN HP HR HS RA"));

/** The transaction set identifier code (element 143, `ST-01`, `AK2-01`). */
const TRANSACTION_SET_ID = keep(oneOf("270 271 275 276 277 278 820 824 834 835 837 997 999"));

/** A transaction set control number (`ST-02`, `SE-02`, `AK2-02`). */
const TRANSACTION_CONTROL = keep(matching(/^[A-Za-z0-9]{4,9}$/));

/** A version, release, or industry identifier code (`GS-08`, `AK1-03`, `ST-03`). */
const VERSION = keep(matching(/^\d{6}([A-Z]\d{3}([A-Z]\d)?)?$/));

/** A segment id code a 999 names (`IK3-01`, `CTX-02`). */
const SEGMENT_ID_CODE = keep(matching(/^[A-Z][A-Z0-9]{1,2}$/));

/** A loop identifier code a 999 names (`IK3-03`, `CTX-04`). */
const LOOP_ID = keep(matching(/^[A-Z0-9]{1,4}$/));

/**
 * Composite C043, a health care claim status (`STC-01`, `STC-10`, `STC-11`): the category code (code
 * source 507, `A1`, `F3F`), the status code (code source 508), the entity identifier code, and the code
 * list qualifier.
 */
const CLAIM_STATUS = composite(
  part(matching(/^[A-Z]\d{1,2}[A-Z]?$/)),
  part(matching(/^\d{1,3}$/)),
  part(matching(/^[A-Z0-9]{2,3}$/)),
  part(matching(/^[A-Z0-9]{1,3}$/)),
);

/** Composite C030, a position in a segment (`IK4-01`, `CTX-05`). */
const POSITION_IN_SEGMENT = composite(part(isWhole), part(isWhole), part(isWhole));

/**
 * The shapes of the positions each segment keeps, keyed by segment id and then by 1-based element
 * position. A position missing from its segment's entry is not kept. A segment missing from this table
 * keeps nothing beyond what a locus rule acts on.
 *
 * The positions a locus rule acts on (a name, an identifier, an address line, a city, a ZIP, a
 * telecom number, a group name, a patient account number, a free-text message) are not listed: the rule
 * decides them. The positions a locus rule reads a code from (`NM1-01` / `N1-01`, `NM1-08` / `N1-03`,
 * `REF-01`, `N4-02` / `N4-04`) are decided by the rule's own code list.
 *
 * @internal
 */
export const X12_ELEMENT_SHAPES: Readonly<
  Record<string, Readonly<Record<number, X12ElementShape>>>
> = Object.freeze({
  /* ---- the envelope ---- */
  ISA: {
    1: keep(oneOf("00 03")),
    2: keep(reference(10)),
    3: keep(oneOf("00 01")),
    4: keep(reference(10)),
    5: INTERCHANGE_ID_QUALIFIER,
    6: keep(reference(15)),
    7: INTERCHANGE_ID_QUALIFIER,
    8: keep(reference(15)),
    9: DATE6,
    10: TIME4,
    11: keep(matching(/^[^A-Za-z0-9 ]$|^U$/)),
    12: keep(matching(/^\d{5}$/)),
    13: keep(matching(/^\d{9}$/)),
    14: keep(oneOf("0 1")),
    15: keep(oneOf("I P T")),
    16: keep(matching(/^[^A-Za-z0-9 ]$/)),
  },
  TA1: {
    1: keep(matching(/^\d{9}$/)),
    2: DATE6,
    3: TIME4,
    4: keep(oneOf("A E R")),
    5: keep(matching(/^\d{3}$/)),
  },
  GS: {
    1: FUNCTIONAL_ID,
    2: keep(reference(15)),
    3: keep(reference(15)),
    4: DATE8,
    5: TIME,
    6: keep(matching(/^\d{1,9}$/)),
    7: keep(oneOf("T X")),
    8: VERSION,
  },
  GE: { 1: WHOLE, 2: keep(matching(/^\d{1,9}$/)) },
  IEA: { 1: WHOLE, 2: keep(matching(/^\d{9}$/)) },
  ST: { 1: TRANSACTION_SET_ID, 2: TRANSACTION_CONTROL, 3: VERSION },
  SE: { 1: WHOLE, 2: TRANSACTION_CONTROL },

  /* ---- the transaction header ---- */
  BHT: {
    1: keep(oneOf("0007 0010 0019 0022 0078 0085")),
    2: keep(oneOf("00 01 05 06 08 11 13 15 18 22 36 RU")),
    3: keep(reference(50)),
    4: DATE8,
    5: TIME,
    // 837 chargeable, reporting and subrogation demand; 277 response (DG) and 277CA receipt (TH).
    6: keep(oneOf("31 CH DG RP RT RU TH")),
  },
  BGN: {
    1: keep(oneOf("00 15 22")),
    2: keep(reference(50)),
    3: DATE8,
    4: TIME,
    5: keep(
      oneOf(
        "01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 AD AS AT CD CS CT ED ES ET GM HD HS HT LT MD MS MT PD PS PT TD TS TT UT",
      ),
    ),
    6: keep(reference(50)),
    8: keep(oneOf("2 4 RX")),
  },
  BPR: {
    1: keep(oneOf("C D H I P U X")),
    2: DECIMAL,
    3: keep(oneOf("C D")),
    4: keep(oneOf("ACH BOP CHK FWT NON")),
    5: keep(oneOf("CCP CTX")),
    6: keep(oneOf("01 04")),
    7: keep(matching(/^[A-Z0-9]{3,12}$/)),
    8: keep(oneOf("DA")),
    9: keep(reference(35)),
    10: keep(reference(10)),
    11: keep(reference(9)),
    12: keep(oneOf("01 04")),
    13: keep(matching(/^[A-Z0-9]{3,12}$/)),
    14: keep(oneOf("DA SG")),
    15: keep(reference(35)),
    16: DATE8,
  },
  TRN: {
    1: keep(oneOf("1 2")),
    2: keep(reference(50)),
    3: keep(reference(10)),
    4: keep(reference(50)),
  },
  HL: {
    1: WHOLE,
    2: WHOLE,
    3: keep(oneOf("19 20 21 22 23 EV PT SS")),
    4: keep(oneOf("0 1")),
  },

  /* ---- the mapped segments: the positions their rules leave ---- */
  NM1: { 2: keep(oneOf("1 2")) },
  DMG: {
    1: keep(oneOf("D8")),
    3: keep(oneOf("F M U")),
    // The 834 marital status, race or ethnicity (code, `RET` list qualifier, CDC code) and citizenship.
    4: keep(oneOf("B D I M R S U W X")),
    5: composite(
      part(oneOf("7 8 A B C D E F G H I J N O P Z")),
      part(oneOf("RET")),
      part(matching(/^\d{4}-\d$/)),
    ),
    6: keep(oneOf("1 2 3 4 5 6 7")),
  },
  PER: {
    1: keep(oneOf("BL CX IC IP SU")),
    3: COMMUNICATION_QUALIFIER,
    5: COMMUNICATION_QUALIFIER,
    7: COMMUNICATION_QUALIFIER,
  },
  DTP: { 1: keep(DATE_QUALIFIER), 2: DATE_FORMAT },
  DTM: { 1: keep(DATE_QUALIFIER) },
  SBR: {
    1: keep(oneOf("A B C D E F G H P S T U")),
    2: keep(RELATIONSHIP),
    5: keep(INSURANCE_TYPE),
    9: keep(CLAIM_FILING),
  },
  CLM: {
    2: DECIMAL,
    5: composite(part(matching(/^\d{2}$/)), part(oneOf("A B")), part(matching(/^[0-9A-Z]$/))),
    6: YES_NO,
    7: keep(oneOf("A B C")),
    8: keep(oneOf("N W Y")),
    9: keep(oneOf("I Y")),
    10: keep(oneOf("P")),
    11: composite(
      part(oneOf("AA AP EM OA")),
      part(oneOf("AA AP EM OA")),
      part(oneOf("AA AP EM OA")),
      part(inSet(STATE_OR_PROVINCE_CODES)),
      part(inSet(COUNTRY_CODES)),
    ),
    12: keep(oneOf("02 03 05 09")),
    19: keep(oneOf("PB")), // 837D predetermination of benefits
    20: keep(oneOf("1 2 3 4 5 6 7 8 9 10 11 15")),
  },
  CLP: {
    2: keep(oneOf("1 2 3 4 19 20 21 22 23 25")),
    3: DECIMAL,
    4: DECIMAL,
    5: DECIMAL,
    6: keep(CLAIM_FILING),
    7: keep(reference(50)),
    8: keep(matching(/^\d{1,2}$/)),
    9: keep(matching(/^[0-9A-Z]$/)),
    11: keep(matching(/^\d{3,4}$/)),
    12: DECIMAL,
    13: DECIMAL,
  },
  MSG: {},
  III: {
    1: keep(oneOf("ABF ABK BF BK GR NI ZZ")),
    2: keep(matching(/^[A-Z0-9]{1,8}$/)),
    3: keep(matching(/^[A-Z0-9]{2}$/)),
  },
  K3: {},
  NTE: {
    1: keep(oneOf("ADD ALG CER DCP DGN DME MED NTR ODT PMT RHB RLH RNH SET SFM SPT TPO UPI")),
  },

  /* ---- the retained clinical, financial and control segments ---- */
  AMT: { 1: keep(AMOUNT_QUALIFIER), 2: DECIMAL, 3: keep(oneOf("C D")) },
  PAT: {
    1: keep(RELATIONSHIP),
    4: keep(oneOf("F N P")),
    5: keep(oneOf("D8")),
    6: { kind: "date", format: { from: "element", position: 5 } },
    7: keep(oneOf("01")),
    8: DECIMAL,
    9: keep(oneOf("Y")),
  },
  CAS: CAS_SHAPES,
  MOA: {
    1: DECIMAL,
    2: DECIMAL,
    3: REMARK,
    4: REMARK,
    5: REMARK,
    6: REMARK,
    7: REMARK,
    8: DECIMAL,
    9: DECIMAL,
  },
  MIA: MIA_SHAPES,
  QTY: { 1: keep(QUANTITY_QUALIFIER), 2: DECIMAL },
  LQ: { 1: keep(oneOf("AS HE RX UT")), 2: keep(matching(/^[A-Z0-9]{1,8}$/)) },
  LX: { 1: WHOLE },
  HI: HI_SHAPES,
  SV1: {
    1: PROCEDURE,
    2: DECIMAL,
    3: keep(oneOf("MJ UN")),
    4: DECIMAL,
    5: keep(matching(/^\d{2}$/)),
    7: DIAGNOSIS_POINTERS,
    9: keep(oneOf("Y")),
    11: keep(oneOf("Y")),
    12: keep(oneOf("Y")),
    15: keep(oneOf("0")),
  },
  SV2: {
    1: keep(matching(/^\d{4}$/)),
    2: PROCEDURE,
    3: DECIMAL,
    4: keep(oneOf("DA UN")),
    5: DECIMAL,
    6: DECIMAL,
    7: DECIMAL,
  },
  SV3: {
    1: PROCEDURE,
    2: DECIMAL,
    3: keep(matching(/^\d{2}$/)),
    // C006 oral cavity designation: an area code, or L / R for the left or right side.
    4: composite(
      part(matching(/^(\d{2}|L|R)$/)),
      part(matching(/^(\d{2}|L|R)$/)),
      part(matching(/^(\d{2}|L|R)$/)),
      part(matching(/^(\d{2}|L|R)$/)),
      part(matching(/^(\d{2}|L|R)$/)),
    ),
    5: keep(oneOf("I M R")),
    6: WHOLE,
    11: DIAGNOSIS_POINTERS,
  },
  SV5: {
    1: PROCEDURE,
    2: keep(oneOf("DA")),
    3: DECIMAL,
    4: DECIMAL,
    5: DECIMAL,
    6: keep(oneOf("1 4 6")),
  },
  SVC: {
    1: PROCEDURE,
    2: DECIMAL,
    3: DECIMAL,
    4: keep(matching(/^\d{4}$/)),
    5: DECIMAL,
    6: PROCEDURE,
    7: DECIMAL,
  },
  SVD: {
    1: keep(reference(80)),
    2: DECIMAL,
    3: PROCEDURE,
    5: DECIMAL,
    6: WHOLE,
  },
  TOO: {
    1: keep(oneOf("JP")),
    2: keep(matching(/^(\d{1,2}|[A-T]S?)$/)),
    3: composite(
      part(oneOf("B D F I L M O")),
      part(oneOf("B D F I L M O")),
      part(oneOf("B D F I L M O")),
      part(oneOf("B D F I L M O")),
      part(oneOf("B D F I L M O")),
    ),
  },
  CR1: {
    1: keep(oneOf("LB")),
    2: DECIMAL,
    4: keep(oneOf("A B C D E")),
    5: keep(oneOf("DH")),
    6: DECIMAL,
  },
  CR2: {
    1: WHOLE,
    2: DECIMAL,
    3: keep(matching(/^[A-Z0-9]{1,3}$/)),
    4: keep(matching(/^[A-Z0-9]{1,3}$/)),
    5: keep(oneOf("DA MO WK YR")),
    6: DECIMAL,
    7: DECIMAL,
    8: keep(oneOf("A C D E F G M")),
    9: YES_NO,
  },
  CR3: { 1: keep(oneOf("I R S")), 2: keep(oneOf("MO")), 3: DECIMAL },
  CRC: {
    1: keep(oneOf("07 08 09 11 12 70 75 E1 E2 E3 ZZ")),
    2: YES_NO,
    3: keep(matching(/^[A-Z0-9]{2,3}$/)),
    4: keep(matching(/^[A-Z0-9]{2,3}$/)),
    5: keep(matching(/^[A-Z0-9]{2,3}$/)),
    6: keep(matching(/^[A-Z0-9]{2,3}$/)),
    7: keep(matching(/^[A-Z0-9]{2,3}$/)),
  },
  HCP: {
    1: keep(matching(/^\d{2}$/)),
    2: DECIMAL,
    3: DECIMAL,
    4: keep(reference(50)),
    5: DECIMAL,
    6: keep(reference(50)),
    7: DECIMAL,
    8: keep(matching(/^[A-Z0-9]{1,48}$/)),
    9: keep(oneOf("ER HC HP IV WK")),
    10: keep(matching(/^[A-Z0-9]{1,48}$/)),
    11: keep(oneOf("DA UN")),
    12: DECIMAL,
    13: keep(oneOf("T1 T2 T3 T4 T5 T6")),
    14: keep(oneOf("1 2 3 4 5")),
    15: keep(oneOf("1 2 3 4 5 6")),
  },
  CN1: {
    1: keep(oneOf("01 02 03 04 05 06 09")),
    2: DECIMAL,
    3: DECIMAL,
    4: keep(reference(50)),
    5: DECIMAL,
    6: keep(reference(30)),
  },
  PS1: { 1: keep(reference(50)), 2: DECIMAL },
  MEA: {
    1: keep(oneOf("OG TR")),
    2: keep(oneOf("CON GRA HT R1 R2 R3 R4 ZO")),
    3: DECIMAL,
  },
  PWK: {
    1: keep(
      oneOf(
        "03 04 05 06 07 08 09 10 11 13 15 21 A3 A4 AM AS B2 B3 B4 BR BS BT CB CK CT D2 DA DB DG DJ DS " +
          "EB HC HR I5 IR LA M1 MT NN OB OC OD OE OX OZ P4 P5 PE PN PO PQ PY PZ RB RR RT RX SG V5 XP",
      ),
    ),
    2: keep(oneOf("AA BM EL EM FT FX")),
    5: keep(oneOf("AC")),
    6: keep(reference(80)),
  },
  LIN: {
    2: keep(oneOf("EN EO HI N4 N5 N6 UK UP")),
    3: keep(matching(/^[A-Z0-9-]{1,48}$/)),
  },
  CTP: { 4: DECIMAL, 5: composite(part(oneOf("F2 GR ME ML UN"))) },
  HSD: {
    1: keep(oneOf("DY FL HS MN VS")),
    2: DECIMAL,
    3: keep(oneOf("DA DY HS MN MO VS WK YR")),
    4: DECIMAL,
    5: keep(oneOf("6 7 21 26 27 34 35")),
    6: WHOLE,
    7: keep(matching(/^[A-Z0-9]{1,2}$/)),
    8: keep(oneOf("A B C D E F Y")),
  },
  UR: { 1: keep(matching(/^[A-Z0-9]{1,2}$/)) },
  EB: {
    1: keep(matching(/^([0-9A-Z]|CB|MC)$/)),
    2: keep(oneOf("CHD DEP ECH EMP ESP FAM IND SPC SPO TWO")),
    3: keep(repeating(matching(/^[A-Z0-9]{1,2}$/))),
    4: keep(INSURANCE_TYPE),
    6: keep(oneOf("6 7 13 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36")),
    7: DECIMAL,
    8: DECIMAL,
    9: keep(QUANTITY_QUALIFIER),
    10: DECIMAL,
    11: keep(oneOf("N U W Y")),
    12: keep(oneOf("N U W Y")),
    13: PROCEDURE,
    14: DIAGNOSIS_POINTERS,
  },
  EQ: {
    1: keep(repeating(matching(/^[A-Z0-9]{1,2}$/))),
    2: PROCEDURE,
    3: keep(oneOf("CHD DEP ECH EMP ESP FAM IND SPC SPO TWO")),
    5: DIAGNOSIS_POINTERS,
  },
  AAA: {
    1: YES_NO,
    3: keep(matching(/^\d{2}$/)),
    4: keep(oneOf("C N P R S W X Y")),
  },
  INS: {
    1: YES_NO,
    2: keep(RELATIONSHIP),
    3: keep(oneOf("001 021 024 025 030 032")),
    4: keep(matching(/^[A-Z0-9]{2}$/)),
    5: keep(oneOf("A C S T")),
    6: composite(part(oneOf("A B C D E"))), // C052 Medicare plan code
    7: keep(matching(/^(\d{1,2}|ZZ)$/)),
    8: keep(oneOf("AC AU FT L1 PT RT TE")),
    9: keep(oneOf("F N P")),
    10: YES_NO,
    11: keep(oneOf("D8")),
    12: { kind: "date", format: { from: "element", position: 11 } },
    13: keep(oneOf("R U")),
    17: WHOLE,
  },
  HD: {
    1: keep(oneOf("001 002 021 024 025 026 030 032")),
    3: keep(
      oneOf("AG AH AJ AK DCP DEN EPO FAC HE HLT HMO LTC LTD MM MOD PDG POS PPO PRA STD UR VIS"),
    ),
    5: keep(oneOf("CHD DEP E1D E2D E3D E5D E6D E7D E8D E9D ECH EMP ESP FAM IND SPC SPO TWO")),
    9: YES_NO, // late enrollment indicator
  },
  DSB: {
    1: keep(oneOf("1 2 3 4")),
    7: keep(oneOf("DX ZZ")),
    8: keep(matching(/^[A-Z0-9]{3,7}$/)),
  },
  REL: { 1: keep(matching(/^[A-Z0-9]{1,2}$/)), 2: keep(RELATIONSHIP) },
  // CL1 institutional claim code (837I): admission type, admission source, patient status.
  CL1: {
    1: keep(matching(/^\d$/)),
    2: keep(matching(/^[0-9A-Z]$/)),
    3: keep(matching(/^\d{2}$/)),
  },
  // STC claim status (277): the category / status / entity composites, the status, adjudication and
  // check dates (dates of the individual's claim, generalized like a DTP date), the amounts, the payment
  // method, and the check or EFT trace number. STC-12, a free-form message, is not kept.
  STC: {
    1: CLAIM_STATUS,
    2: { kind: "date", format: { from: "fixed", format: "D8" } },
    3: keep(oneOf("U WQ")),
    4: DECIMAL,
    5: DECIMAL,
    6: { kind: "date", format: { from: "fixed", format: "D8" } },
    7: keep(oneOf("ACH BOP CHK FWT NON")),
    8: { kind: "date", format: { from: "fixed", format: "D8" } },
    9: keep(reference(16)),
    10: CLAIM_STATUS,
    11: CLAIM_STATUS,
  },
  // UM health care services review (278): request category, certification type, service type,
  // facility code, related causes, level of service, prognosis.
  UM: {
    1: keep(oneOf("AR HS IN SC")),
    2: keep(oneOf("1 2 3 4 I N R S")),
    3: keep(matching(/^[A-Z0-9]{1,2}$/)),
    4: composite(part(matching(/^\d{2}$/)), part(oneOf("A B"))),
    5: composite(
      part(oneOf("AA AP EM OA")),
      part(oneOf("AA AP EM OA")),
      part(oneOf("AA AP EM OA")),
      part(inSet(STATE_OR_PROVINCE_CODES)),
      part(inSet(COUNTRY_CODES)),
    ),
    6: keep(oneOf("03 E U")),
    8: keep(oneOf("1 2 3 4 5 6 7 8")),
  },
  // HCR health care services review decision (278 response): action, the certification number (an
  // administrative reference, like a prior authorization number), the decision reason, and the second
  // surgical opinion indicator.
  HCR: {
    1: keep(oneOf("A1 A2 A3 A4 A6 C CT D IP NA")),
    2: keep(reference(50)),
    3: keep(matching(/^[A-Z0-9]{1,2}$/)),
    4: YES_NO,
  },
  // The 271 and 834 loop markers: a loop identifier code and nothing else.
  LS: { 1: LOOP_ID },
  LE: { 1: LOOP_ID },

  /* ---- the 999 acknowledgment ---- */
  AK1: { 1: FUNCTIONAL_ID, 2: keep(matching(/^\d{1,9}$/)), 3: VERSION },
  AK2: { 1: TRANSACTION_SET_ID, 2: TRANSACTION_CONTROL, 3: VERSION },
  IK3: { 1: SEGMENT_ID_CODE, 2: WHOLE, 3: LOOP_ID, 4: ERROR_CODE },
  // IK4-04 is a copy of the bad data element, which can be anything the sender wrote: never kept.
  IK4: { 1: POSITION_IN_SEGMENT, 2: WHOLE, 3: ERROR_CODE },
  IK5: {
    1: keep(oneOf("A E M R W X")),
    2: ERROR_CODE,
    3: ERROR_CODE,
    4: ERROR_CODE,
    5: ERROR_CODE,
    6: ERROR_CODE,
  },
  AK9: {
    1: keep(oneOf("A E M P R W X")),
    2: WHOLE,
    3: WHOLE,
    4: WHOLE,
    5: ERROR_CODE,
    6: ERROR_CODE,
    7: ERROR_CODE,
    8: ERROR_CODE,
    9: ERROR_CODE,
  },
  // CTX-01-2 is the value of the business unit the context names (a patient control number, say), a
  // copy of a document value: always removed. The context name before it is kept.
  CTX: {
    1: composite(part(matching(/^(SITUATIONAL TRIGGER|[A-Z][A-Z0-9]{1,2}\d{2})$/)), FREE),
    2: SEGMENT_ID_CODE,
    3: WHOLE,
    4: LOOP_ID,
    5: POSITION_IN_SEGMENT,
    6: composite(part(isWhole), part(isWhole)),
  },
});

/**
 * The **date positions a locus rule transforms**, each with where it reads its declared format:
 * `DMG-02` from `DMG-01`, `DTP-03` from `DTP-02`, and `DTM-02`, which is always `CCYYMMDD`. A value
 * there is transformed as a date only when it is a valid date in that format; anything else is removed
 * and recorded at its own position. Keyed `<segment id>-<element>`.
 *
 * @internal
 */
export const X12_RULE_DATE_FORMATS: ReadonlyMap<string, X12DateFormatSource> = new Map<
  string,
  X12DateFormatSource
>([
  ["DMG-2", { from: "element", position: 1 }],
  ["DTP-3", { from: "element", position: 2 }],
  ["DTM-2", { from: "fixed", format: "D8" }],
]);
