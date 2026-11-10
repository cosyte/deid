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
 * A code position whose data element has an X12 code list is checked against that element's **complete
 * 005010 code list** (`./code-lists.js`), never a hand-picked part of it: a value that is a real code
 * for the element is kept, and anything else is removed. A position whose codes come from an external
 * code source (a CARC, a RARC, a claim status, a NUBC code, a procedure or diagnosis code) is checked
 * against the shape that source publishes. The positions are those the HIPAA 005010 TR3s use for 837P /
 * 837I / 837D (X222A1, X223A2, X224A2), 835 (X221A1), 270 / 271 (X279A1), 276 / 277 (X212), 277CA
 * (X214), 278 (X217), 834 (X220A1), 999 (X231A1) and TA1, and the X12 envelope (`ISA` / `GS` / `ST` /
 * `SE` / `GE` / `IEA`).
 *
 * @packageDocumentation
 * @internal
 */

import { x12CodeList, type X12CodeListElement } from "./code-lists.js";

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
 * - `keep`: kept when its value passes {@link X12ComponentShape.test}. A value that fails takes the whole
 *   composite with it, unless `alone` holds for the composite: then it is removed on its own and the
 *   rest is decided as usual. `alone` marks a value whose qualifier is a real code with no published
 *   shape the pass knows, so the qualifier is kept and only the value it qualifies is removed;
 * - `free`: free text, always removed (blocked at the component's own position);
 * - `date`: a date of the individual, transformed as a date when it is valid in the declared format, and
 *   removed otherwise.
 */
export type X12ComponentShape =
  | { readonly kind: "keep"; readonly test: X12ShapeTest; readonly alone?: X12ShapeTest }
  | { readonly kind: "free" }
  | { readonly kind: "date"; readonly format: X12DateFormatSource };

/**
 * How one element position is decided when no locus rule acted on it:
 *
 * - `keep`: kept when its value passes {@link X12ElementShape.test} (every repetition of it, when the
 *   element repeats). `anchor` marks a shape narrow enough that a value failing it shows a shift on its
 *   own: a code from the element's list, or a date. Every value after it is then removed too;
 * - `date`: a date of the individual, transformed as a date when it is valid in the declared format;
 * - `composite`: split on the component separator and decided component by component. A composite
 *   with more components than the shape names, or a component that fails its test, is removed whole.
 */
export type X12ElementShape =
  | { readonly kind: "keep"; readonly test: X12ShapeTest; readonly anchor?: boolean }
  | { readonly kind: "date"; readonly format: X12DateFormatSource }
  | {
      readonly kind: "composite";
      readonly components: readonly X12ComponentShape[];
      /** The components that cannot be empty while a later one holds a value. */
      readonly requirements?: X12PositionRequirements;
    };

/**
 * The positions of a segment, or the components of a composite, that cannot be empty while a later one
 * holds a value. When one is, a separator was added before it, and every value after it was shifted
 * there: a number shape cannot tell a shifted date or account number from an amount, so the shift is
 * detected instead, and every value after the empty position is removed and recorded.
 *
 * - `required`: a position the 005010 TR3 of the transaction set requires;
 * - `implied`: `[when, then]`, a position another one implies: when `when` holds a value, `then` must
 *   too. A date format implies a date, and the X12 syntax notes pair a qualifier with its value;
 * - `spans`: `{ gap, after }`, a run of positions that cannot all be empty while a value sits before
 *   the run and another sits at one of the `after` positions.
 *
 * Every position these name is also checked by shape: a value there that fails the shape its position
 * expects marks a shift too, and every value after it is removed.
 */
export interface X12PositionRequirements {
  /** The 1-based positions the TR3s require. */
  readonly required?: readonly number[];
  /** `[when, then]` pairs: when position `when` holds a value, position `then` must too. */
  readonly implied?: readonly (readonly [when: number, then: number])[];
  /** Runs that cannot all be empty between a value before them and a value at one of `after`. */
  readonly spans?: readonly {
    readonly gap: readonly number[];
    readonly after: readonly number[];
  }[];
}

/** What {@link x12ShiftPoint} reads about each 1-based position of a segment or a composite. */
export interface X12ShiftProbe {
  /** Whether the position holds a value. */
  readonly present: (position: number) => boolean;
  /** Whether the value at the position fails the shape its position expects (`false` with no shape). */
  readonly fails: (position: number) => boolean;
  /**
   * Whether the position's shape is narrow (a code, a date, a composite of codes), so that a value
   * failing it marks a shift, and a value passing it shows the values before it are in place.
   */
  readonly anchored: (position: number) => boolean;
}

/**
 * The **shift point** of a segment or a composite: the position after which a separator was added or
 * left out. Every value after it may have been shifted, and is removed. It is the first of:
 *
 * - a position the requirements say must hold a value, that is empty while a later position holds one;
 * - a run of `spans` that is empty between a value before it and a value at one of its `after` positions;
 * - for a position the requirements name, or one whose shape is narrow, that holds a value failing its
 *   shape: the last narrow position before it whose value passed. A missing separator shifts every
 *   later value one place left, so the values between the last position known to be in place and the
 *   first one that is not can all be shifted ones: a date moved into an amount passes the amount's
 *   shape. This catches a value shifted left as well as one shifted right.
 *
 * `undefined` when there is none, and `0` when no value of the segment or composite can be placed.
 *
 * @param probe - What the pass reads about each position.
 * @param last - The last position there is.
 * @param requirements - The positions that cannot be empty while a later one holds a value.
 * @returns The 1-based shift point, `0`, or `undefined`.
 * @internal
 */
export function x12ShiftPoint(
  probe: X12ShiftProbe,
  last: number,
  requirements: X12PositionRequirements,
): number | undefined {
  const { present } = probe;
  let lastPresent = 0;
  for (let n = last; n > 0; n -= 1) {
    if (present(n)) {
      lastPresent = n;
      break;
    }
  }
  const named = new Set<number>(requirements.required);
  const needed = new Set<number>(requirements.required);
  for (const [when, then] of requirements.implied ?? []) {
    named.add(when).add(then);
    if (present(when)) needed.add(then);
  }
  const points = [...needed].filter((n) => n < lastPresent && !present(n));
  for (const { gap, after } of requirements.spans ?? []) {
    const first = Math.min(...gap);
    for (const n of [...gap, ...after]) named.add(n);
    let before = false;
    for (let n = 1; n < first; n += 1) before ||= present(n);
    if (before && !gap.some(present) && after.some(present)) points.push(first);
  }
  for (let n = 1; n <= lastPresent; n += 1) {
    if (present(n) && (named.has(n) || probe.anchored(n)) && probe.fails(n)) {
      let held = n - 1;
      while (held > 0 && !(present(held) && probe.anchored(held) && !probe.fails(held))) held -= 1;
      points.push(held);
      break;
    }
  }
  return points.length === 0 ? undefined : Math.min(...points);
}

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
      const range = /^(\d{8})-(\d{8})$/.exec(value);
      return range !== null && isD8(range[1] as string) && isD8(range[2] as string);
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

/** Keep a value the complete 005010 code list of data element `element` holds, exactly as written. */
function codeOf(element: X12CodeListElement): X12ShapeTest {
  return inSet(x12CodeList(element));
}

const keep = (test: X12ShapeTest): X12ElementShape => ({ kind: "keep", test });
/** A code or a date position: a value failing its shape marks a shift (see {@link x12ShiftPoint}). */
const anchor = (test: X12ShapeTest): X12ElementShape => ({ kind: "keep", test, anchor: true });
/** A position whose data element has a code list: kept when it holds one of the element's codes. */
const code = (element: X12CodeListElement): X12ElementShape => anchor(codeOf(element));
const part = (test: X12ShapeTest): X12ComponentShape => ({ kind: "keep", test });
/** A component whose data element has a code list: kept when it holds one of the element's codes. */
const codePart = (element: X12CodeListElement): X12ComponentShape => part(codeOf(element));
const FREE: X12ComponentShape = { kind: "free" };
/** A component the TR3s mark not used: any value there makes the composite untrusted. */
const NOT_USED: X12ComponentShape = { kind: "keep", test: () => false };
const composite = (...components: X12ComponentShape[]): X12ElementShape => ({
  kind: "composite",
  components,
});

/** `[when, then]` both ways: two positions the X12 syntax notes pair, each implying the other. */
const paired = (a: number, b: number): readonly (readonly [number, number])[] => [
  [a, b],
  [b, a],
];

const DATE8 = anchor(isD8);
const DATE6 = anchor(isD6);
const TIME = keep(isTime);
const TIME4 = keep(isTime4);
const DECIMAL = keep(isDecimal);
const WHOLE = keep(isWhole);
/** Element 1073, the yes / no condition or response code. */
const YES_NO = code("1073");
/** Element 1250, the date time period format qualifier. */
const DATE_FORMAT = code("1250");

/* ------------------------------------------------------------------------------ code lists */

/** Element 365, communication number qualifier (`PER-03` / `05` / `07`). */
const COMMUNICATION_QUALIFIER = code("365");

/** Element 1336, insurance type code (`SBR-05`, `EB-04`). */
const INSURANCE_TYPE = code("1336");

/** Element 1032, claim filing indicator code (`SBR-09`, `CLP-06`). */
const CLAIM_FILING = code("1032");

/** Element 1069, individual relationship code (`SBR-02`, `PAT-01`, `INS-02`, `REL-01`). */
const RELATIONSHIP = code("1069");

/** Element 374, date/time qualifier (`DTP-01`, `DTM-01`). */
const DATE_QUALIFIER = code("374");

/** Element 522, amount qualifier code (`AMT-01`). */
const AMOUNT_QUALIFIER = code("522");

/** Element 673, quantity qualifier (`QTY-01`, `EB-09`, `HSD-01`). */
const QUANTITY_QUALIFIER = code("673");

/** Element 355, unit or basis for measurement code. */
const UNIT = code("355");

/**
 * `PAT-07`, the unit of the patient's weight: the 837 TR3s allow only `01` (actual pounds) of element
 * 355. Any other unit there, `D8` above all, is a value shifted out of `PAT-05`.
 */
const PATIENT_WEIGHT_UNIT = anchor(inSet(new Set<string>(["01"])));

/** Element 1365, service type code (`EB-03`, `EQ-01`, `UM-03`); the first two repeat. */
const SERVICE_TYPE = anchor(repeating(codeOf("1365")));

/** The qualifier of the composite a component test is reading. */
function firstComponent(ctx: X12ShapeContext): string {
  // A component test is only ever called with the composite's components, the first one included.
  return (ctx.components as readonly string[])[0] as string;
}

/** A procedure or product code, shaped by the qualifier the composite's first component names. */
function serviceCode(value: string, ctx: X12ShapeContext): boolean {
  // Element 235 holds every qualifier; the ones with a published code shape are checked against it.
  switch (firstComponent(ctx)) {
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
  codePart("235"),
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

/** A US state or territory, a military post, or a Canadian province (element 156). */
export const STATE_OR_PROVINCE_CODES: ReadonlySet<string> = new Set<string>(
  (
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM " +
    "NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY " +
    "AS GU MP PR VI UM FM MH PW AA AE AP " +
    "AB BC MB NB NL NS NT NU ON PE QC SK YT"
  ).split(" "),
);

/**
 * Element 26, the country code: the complete 005010 list, which holds the ISO 3166 two- and
 * three-letter codes. The TR3s ask for the two-letter one.
 */
export const COUNTRY_CODES: ReadonlySet<string> = x12CodeList("26");

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
  // Treatment codes, and the Advanced Billing Concepts principal procedure (837I).
  TC: /^[A-Z0-9]{1,30}$/,
  CAH: /^[A-Z0-9]{1,30}$/,
  // An ICD-9-CM other procedure: in the `@cosyte/x12` qualifier table, though not in the 005010 list.
  BBA: /^\d{2,4}$/,
};

/** The shape of the code an `HI` qualifier qualifies, when the pass knows one. */
function healthCareCodeShape(qualifier: string): RegExp | undefined {
  return Object.hasOwn(HEALTH_CARE_CODE, qualifier) ? HEALTH_CARE_CODE[qualifier] : undefined;
}

/** The `HI` qualifier of a value code (837I value information), the only one with an amount. */
const VALUE_CODE_QUALIFIER = "BE";

/**
 * C022-05 and C022-06, the amount and quantity of an `HI` entry: the TR3s use them for a value code
 * (`BE`) alone. Under any other qualifier a value there is removed on its own, because the usual way
 * one gets there is a date or an identifier shifted past its component, and a number shape cannot tell
 * it from an amount.
 */
const VALUE_CODE_NUMBER: X12ComponentShape = {
  kind: "keep",
  test: (value, ctx) => firstComponent(ctx) === VALUE_CODE_QUALIFIER && isDecimal(value),
  alone: (_value, ctx) => firstComponent(ctx) !== VALUE_CODE_QUALIFIER,
};

/**
 * Composite C022, one `HI` entry: qualifier (element 1270, or a qualifier the `@cosyte/x12` table
 * names), code (shaped by the qualifier), the format of the date that follows, the date (a date of the
 * individual's care, transformed as a date), a value code's amount and quantity, and the
 * present-on-admission indicator (element 1073, and the `1` the CMS POA reporting uses for exempt).
 *
 * A real qualifier whose code shape the pass does not know keeps its place, and the code it qualifies is
 * removed on its own. The qualifier and the code are required; a date format implies a date and a date
 * implies its format (the X12 syntax note pairs C022-03 and -04); a quantity implies the amount before
 * it. So `BH:11:D8::20260118`, a date one separator late, has its shifted value removed.
 */
const HEALTH_CARE_CODE_INFO: X12ElementShape = {
  kind: "composite",
  components: [
    part((value) => x12CodeList("1270").has(value) || healthCareCodeShape(value) !== undefined),
    {
      kind: "keep",
      test: (value, ctx) => healthCareCodeShape(firstComponent(ctx))?.test(value) === true,
      alone: (_value, ctx) => healthCareCodeShape(firstComponent(ctx)) === undefined,
    },
    codePart("1250"),
    { kind: "date", format: { from: "component", position: 3 } },
    VALUE_CODE_NUMBER,
    VALUE_CODE_NUMBER,
    NOT_USED, // C022-07, version identifier
    NOT_USED, // C022-08, a range end code
    part((value) => value === "1" || x12CodeList("1073").has(value)),
  ],
  requirements: { required: [1, 2], implied: [...paired(3, 4), [6, 5]] },
};

/* ----------------------------------------------------------------------- the segment shapes */

/** Twelve `HI` entries. */
const HI_SHAPES: Record<number, X12ElementShape> = {};
for (let n = 1; n <= 12; n += 1) HI_SHAPES[n] = HEALTH_CARE_CODE_INFO;

/** The `CAS` adjustment triples: reason, amount, quantity, six times over. */
const CAS_SHAPES: Record<number, X12ElementShape> = {
  1: code("1033"),
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
const INTERCHANGE_ID_QUALIFIER = code("I05");

/** The functional identifier code (element 479, `GS-01`, `AK1-01`). */
const FUNCTIONAL_ID = code("479");

/** The transaction set identifier code (element 143, `ST-01`, `AK2-01`). */
const TRANSACTION_SET_ID = code("143");

/** A transaction set control number (`ST-02`, `SE-02`, `AK2-02`). */
const TRANSACTION_CONTROL = keep(matching(/^[A-Za-z0-9]{4,9}$/));

/** An implementation convention reference (`ST-03`, `AK2-03`): a version and its industry identifier. */
const isVersion = matching(/^\d{6}([A-Z]\d{3}([A-Z]\d)?)?$/);
const VERSION = keep(isVersion);

/**
 * A version, release, or industry identifier code (element 480, `GS-08`, `AK1-03`): a code of the
 * element's list, or a version followed by the industry identifier a TR3 names (`005010X222A1`).
 */
const GROUP_VERSION = keep((value, ctx) => x12CodeList("480").has(value) || isVersion(value, ctx));

/** A segment id code a 999 names (`IK3-01`, `CTX-02`). */
const SEGMENT_ID_CODE = keep(matching(/^[A-Z][A-Z0-9]{1,2}$/));

/**
 * A loop identifier code a 999 names (`IK3-03`, `CTX-04`) or a loop marker carries (`LS-01`, `LE-01`):
 * up to four letters or digits, or a TR3 loop id such as `2010BA`, which the `@cosyte/x12` 999 builder
 * emits.
 */
const LOOP_ID = keep(matching(/^(\d{4}[A-Z]{0,2}|[A-Z0-9]{1,4})$/));

/** The 999 syntax error codes (elements 620, 621, 618 and 716). */
const SEGMENT_ERROR = code("620");
const ELEMENT_ERROR = code("621");
const TRANSACTION_ERROR = code("618");
const GROUP_ERROR = code("716");

/**
 * Composite C043, a health care claim status (`STC-01`, `STC-10`, `STC-11`): the category code (code
 * source 507, `A1`, `F3F`), the status code (code source 508), the entity identifier code (element 98),
 * and the code list qualifier (element 1270).
 */
const CLAIM_STATUS = composite(
  part(matching(/^[A-Z]\d{1,2}[A-Z]?$/)),
  part(matching(/^\d{1,3}$/)),
  codePart("98"),
  codePart("1270"),
);

/** Composite C030, a position in a segment (`IK4-01`, `CTX-05`). */
const POSITION_IN_SEGMENT = composite(part(isWhole), part(isWhole), part(isWhole));

/** Composite C023, a facility code: place of service (code source 237), qualifier, frequency (NUBC). */
const FACILITY = composite(
  part(matching(/^\d{2}$/)),
  codePart("1332"),
  part(matching(/^[0-9A-Z]$/)),
);

/** Composite C024, related causes: three related-causes codes (element 1362), a state and a country. */
const RELATED_CAUSES = composite(
  codePart("1362"),
  codePart("1362"),
  codePart("1362"),
  part(inSet(STATE_OR_PROVINCE_CODES)),
  part(inSet(COUNTRY_CODES)),
);

/** A tooth number: the Universal National Tooth Designation System, permanent 1 to 32 or primary A to T. */
const TOOTH = keep(matching(/^(\d{1,2}|[A-T]S?)$/));

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
    1: code("I01"),
    2: keep(reference(10)),
    3: code("I03"),
    4: keep(reference(10)),
    5: INTERCHANGE_ID_QUALIFIER,
    6: keep(reference(15)),
    7: INTERCHANGE_ID_QUALIFIER,
    8: keep(reference(15)),
    9: DATE6,
    10: TIME4,
    11: keep(matching(/^[^A-Za-z0-9 ]$|^U$/)),
    12: code("I11"),
    13: keep(matching(/^\d{9}$/)),
    14: code("I13"),
    15: code("I14"),
    16: keep(matching(/^[^A-Za-z0-9 ]$/)),
  },
  TA1: {
    1: keep(matching(/^\d{9}$/)),
    2: DATE6,
    3: TIME4,
    4: code("I17"),
    5: code("I18"),
  },
  GS: {
    1: FUNCTIONAL_ID,
    2: keep(reference(15)),
    3: keep(reference(15)),
    4: DATE8,
    5: TIME,
    6: keep(matching(/^\d{1,9}$/)),
    7: code("455"),
    8: GROUP_VERSION,
  },
  GE: { 1: WHOLE, 2: keep(matching(/^\d{1,9}$/)) },
  IEA: { 1: WHOLE, 2: keep(matching(/^\d{9}$/)) },
  ST: { 1: TRANSACTION_SET_ID, 2: TRANSACTION_CONTROL, 3: VERSION },
  SE: { 1: WHOLE, 2: TRANSACTION_CONTROL },

  /* ---- the transaction header ---- */
  BHT: {
    1: code("1005"),
    2: code("353"),
    3: keep(reference(50)),
    4: DATE8,
    5: TIME,
    6: code("640"),
  },
  BGN: {
    1: code("353"),
    2: keep(reference(50)),
    3: DATE8,
    4: TIME,
    5: code("623"),
    6: keep(reference(50)),
    7: code("640"),
    8: code("306"),
    9: code("786"),
  },
  BPR: {
    1: code("305"),
    2: DECIMAL,
    3: code("478"),
    4: code("591"),
    5: code("812"),
    6: code("506"),
    7: keep(matching(/^[A-Z0-9]{3,12}$/)),
    8: code("569"),
    9: keep(reference(35)),
    10: keep(reference(10)),
    11: keep(reference(9)),
    12: code("506"),
    13: keep(matching(/^[A-Z0-9]{3,12}$/)),
    14: code("569"),
    15: keep(reference(35)),
    16: DATE8,
  },
  TRN: {
    1: code("481"),
    2: keep(reference(50)),
    3: keep(reference(10)),
    4: keep(reference(50)),
  },
  HL: {
    1: WHOLE,
    2: WHOLE,
    3: code("735"),
    4: code("736"),
  },

  /* ---- the mapped segments: the positions their rules leave ---- */
  NM1: { 2: code("1065") },
  DMG: {
    1: DATE_FORMAT,
    3: code("1068"),
    // The 834 marital status, race or ethnicity (code, code list qualifier, CDC code) and citizenship.
    4: code("1067"),
    5: composite(codePart("1109"), codePart("1270"), part(matching(/^\d{4}-\d$/))),
    6: code("1066"),
  },
  PER: {
    1: code("366"),
    3: COMMUNICATION_QUALIFIER,
    5: COMMUNICATION_QUALIFIER,
    7: COMMUNICATION_QUALIFIER,
  },
  DTP: { 1: DATE_QUALIFIER, 2: DATE_FORMAT },
  DTM: { 1: DATE_QUALIFIER },
  SBR: {
    1: code("1138"),
    2: RELATIONSHIP,
    5: INSURANCE_TYPE,
    9: CLAIM_FILING,
  },
  CLM: {
    2: DECIMAL,
    5: FACILITY,
    6: YES_NO,
    7: code("1359"),
    8: YES_NO,
    9: code("1363"),
    10: code("1351"),
    11: RELATED_CAUSES,
    12: code("1366"),
    19: code("1383"), // 837D predetermination of benefits
    20: code("1514"),
  },
  CLP: {
    2: code("1029"),
    3: DECIMAL,
    4: DECIMAL,
    5: DECIMAL,
    6: CLAIM_FILING,
    7: keep(reference(50)),
    8: keep(matching(/^\d{1,2}$/)),
    9: keep(matching(/^[0-9A-Z]$/)),
    11: keep(matching(/^\d{3,4}$/)),
    12: DECIMAL,
    13: DECIMAL,
  },
  MSG: {},
  III: {
    1: code("1270"),
    2: keep(matching(/^[A-Z0-9]{1,8}$/)),
    3: code("1136"),
  },
  K3: {},
  NTE: {
    1: code("363"),
  },

  /* ---- the retained clinical, financial and control segments ---- */
  AMT: { 1: AMOUNT_QUALIFIER, 2: DECIMAL, 3: code("478") },
  PAT: {
    1: RELATIONSHIP,
    4: code("1220"),
    5: DATE_FORMAT,
    6: { kind: "date", format: { from: "element", position: 5 } },
    7: PATIENT_WEIGHT_UNIT,
    8: DECIMAL,
    9: YES_NO,
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
  QTY: { 1: QUANTITY_QUALIFIER, 2: DECIMAL },
  LQ: { 1: code("1270"), 2: keep(matching(/^[A-Z0-9]{1,8}$/)) },
  LX: { 1: WHOLE },
  HI: HI_SHAPES,
  SV1: {
    1: PROCEDURE,
    2: DECIMAL,
    3: UNIT,
    4: DECIMAL,
    5: keep(matching(/^\d{2}$/)),
    7: DIAGNOSIS_POINTERS,
    9: YES_NO,
    11: YES_NO,
    12: YES_NO,
    15: code("1327"),
  },
  SV2: {
    1: keep(matching(/^\d{4}$/)),
    2: PROCEDURE,
    3: DECIMAL,
    4: UNIT,
    5: DECIMAL,
    6: DECIMAL,
    7: DECIMAL,
  },
  SV3: {
    1: PROCEDURE,
    2: DECIMAL,
    3: keep(matching(/^\d{2}$/)),
    // C006 oral cavity designation (code source 135): an area code, or L / R for the left or right side.
    4: composite(
      part(matching(/^(\d{2}|L|R)$/)),
      part(matching(/^(\d{2}|L|R)$/)),
      part(matching(/^(\d{2}|L|R)$/)),
      part(matching(/^(\d{2}|L|R)$/)),
      part(matching(/^(\d{2}|L|R)$/)),
    ),
    5: code("1358"),
    6: WHOLE,
    11: DIAGNOSIS_POINTERS,
  },
  SV5: {
    1: PROCEDURE,
    2: UNIT,
    3: DECIMAL,
    4: DECIMAL,
    5: DECIMAL,
    6: code("594"),
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
    1: code("1270"),
    2: TOOTH,
    3: composite(
      codePart("1369"),
      codePart("1369"),
      codePart("1369"),
      codePart("1369"),
      codePart("1369"),
    ),
  },
  CR1: {
    1: UNIT,
    2: DECIMAL,
    4: code("1317"),
    5: UNIT,
    6: DECIMAL,
  },
  CR2: {
    1: WHOLE,
    2: DECIMAL,
    3: code("1367"),
    4: code("1367"),
    5: UNIT,
    6: DECIMAL,
    7: DECIMAL,
    8: code("1342"),
    9: YES_NO,
  },
  CR3: { 1: code("1322"), 2: UNIT, 3: DECIMAL },
  CRC: {
    1: code("1136"),
    2: YES_NO,
    3: code("1321"),
    4: code("1321"),
    5: code("1321"),
    6: code("1321"),
    7: code("1321"),
  },
  HCP: {
    1: code("1473"),
    2: DECIMAL,
    3: DECIMAL,
    4: keep(reference(50)),
    5: DECIMAL,
    6: keep(reference(50)),
    7: DECIMAL,
    8: keep(matching(/^[A-Z0-9]{1,48}$/)),
    9: code("235"),
    10: keep(matching(/^[A-Z0-9]{1,48}$/)),
    11: UNIT,
    12: DECIMAL,
    13: code("901"),
    14: code("1526"),
    15: code("1527"),
  },
  CN1: {
    1: code("1166"),
    2: DECIMAL,
    3: DECIMAL,
    4: keep(reference(50)),
    5: DECIMAL,
    6: keep(reference(30)),
  },
  PS1: { 1: keep(reference(50)), 2: DECIMAL },
  MEA: {
    1: code("737"),
    2: code("738"),
    3: DECIMAL,
  },
  PWK: {
    1: code("755"),
    2: code("756"),
    5: code("66"),
    6: keep(reference(80)),
  },
  LIN: {
    2: code("235"),
    3: keep(matching(/^[A-Z0-9-]{1,48}$/)),
  },
  CTP: { 4: DECIMAL, 5: composite(codePart("355")) },
  HSD: {
    1: QUANTITY_QUALIFIER,
    2: DECIMAL,
    3: UNIT,
    4: DECIMAL,
    5: code("615"),
    6: WHOLE,
    7: code("678"),
    8: code("679"),
  },
  UR: { 1: keep(matching(/^[A-Z0-9]{1,2}$/)) },
  EB: {
    1: code("1390"),
    2: code("1207"),
    3: SERVICE_TYPE,
    4: INSURANCE_TYPE,
    6: code("615"),
    7: DECIMAL,
    8: DECIMAL,
    9: QUANTITY_QUALIFIER,
    10: DECIMAL,
    11: YES_NO,
    12: YES_NO,
    13: PROCEDURE,
    14: DIAGNOSIS_POINTERS,
  },
  EQ: {
    1: SERVICE_TYPE,
    2: PROCEDURE,
    3: code("1207"),
    4: INSURANCE_TYPE,
    5: DIAGNOSIS_POINTERS,
  },
  AAA: {
    1: YES_NO,
    3: code("901"),
    4: code("889"),
  },
  INS: {
    1: YES_NO,
    2: RELATIONSHIP,
    3: code("875"),
    4: code("1203"),
    5: code("1216"),
    6: composite(codePart("1218")), // C052 Medicare plan code
    7: code("1219"),
    8: code("584"),
    9: code("1220"),
    10: YES_NO,
    11: DATE_FORMAT,
    12: { kind: "date", format: { from: "element", position: 11 } },
    13: code("1165"),
    17: WHOLE,
  },
  HD: {
    1: code("875"),
    3: code("1205"),
    5: code("1207"),
    9: YES_NO, // late enrollment indicator
  },
  DSB: {
    1: code("1146"),
    7: code("235"),
    8: keep(matching(/^[A-Z0-9]{3,7}$/)),
  },
  REL: { 1: RELATIONSHIP, 2: WHOLE },
  // CL1 institutional claim code (837I): admission type, admission source, patient status (NUBC).
  CL1: {
    1: keep(matching(/^\d$/)),
    2: keep(matching(/^[0-9A-Z]$/)),
    3: keep(matching(/^\d{2}$/)),
  },
  // STC claim status (277, 277CA): only the status composites (STC-01, -10, -11) and the payment method
  // (STC-07), each checked against its code list (the category and status codes against the form of
  // their external code sources, 507 and 508). Every other position is removed and recorded: the status,
  // adjudication and check dates (dates of the individual's claim), the amounts, the action code, the
  // check or EFT trace number and the free-form message. An amount sits right before the adjudication
  // date, and a missing separator runs them together or moves the date into the amount, where it passes
  // as a number; with the date in the last position nothing after it can fail its shape and show the
  // shift. So no STC date or amount is kept, wherever it sits.
  STC: {
    1: CLAIM_STATUS,
    7: code("591"),
    10: CLAIM_STATUS,
    11: CLAIM_STATUS,
  },
  // UM health care services review (278): request category, certification type, service type,
  // facility code, related causes, level of service, prognosis.
  UM: {
    1: code("1525"),
    2: code("1322"),
    3: SERVICE_TYPE,
    4: FACILITY,
    5: RELATED_CAUSES,
    6: code("1338"),
    8: code("923"),
  },
  // HCR health care services review decision (278 response): action, the certification number (an
  // administrative reference, like a prior authorization number), the decision reason (code source
  // 886), and the second surgical opinion indicator.
  HCR: {
    1: code("306"),
    2: keep(reference(50)),
    3: keep(matching(/^[A-Z0-9]{1,2}$/)),
    4: YES_NO,
  },
  // The 271 and 834 loop markers: a loop identifier code and nothing else.
  LS: { 1: LOOP_ID },
  LE: { 1: LOOP_ID },
  // PRV provider information (837, 270 / 271, 278): the provider's role, the reference qualifier, and a
  // health care provider taxonomy code (code source 682), always ten characters ending in X.
  PRV: {
    1: code("1221"),
    2: code("128"),
    3: keep(matching(/^[0-9A-Z]{9}X$/)),
  },
  // OI other insurance coverage information (837 2320): the coded indicators. None names anyone.
  OI: {
    1: CLAIM_FILING,
    2: code("1383"),
    3: YES_NO,
    4: code("1351"),
    5: code("1360"),
    6: code("1363"),
  },
  // DN1 orthodontic information (837D): the months of treatment and remaining, the indicator, and
  // DN1-04, a description element the TR3 uses only for the orthodontic treatment indicator `Y`; any
  // other text there is not kept.
  DN1: { 1: DECIMAL, 2: DECIMAL, 3: YES_NO, 4: keep(matching(/^Y$/)) },
  // DN2 tooth summary (837D): the tooth, its status, and the code list qualifier (JP).
  DN2: { 1: TOOTH, 2: code("1368"), 3: DECIMAL, 4: DATE_FORMAT, 6: code("1270") },

  /* ---- the 999 acknowledgment ---- */
  AK1: { 1: FUNCTIONAL_ID, 2: keep(matching(/^\d{1,9}$/)), 3: GROUP_VERSION },
  AK2: { 1: TRANSACTION_SET_ID, 2: TRANSACTION_CONTROL, 3: VERSION },
  IK3: { 1: SEGMENT_ID_CODE, 2: WHOLE, 3: LOOP_ID, 4: SEGMENT_ERROR },
  // IK4-04 is a copy of the bad data element, which can be anything the sender wrote: never kept.
  IK4: { 1: POSITION_IN_SEGMENT, 2: WHOLE, 3: ELEMENT_ERROR },
  IK5: {
    1: code("717"),
    2: TRANSACTION_ERROR,
    3: TRANSACTION_ERROR,
    4: TRANSACTION_ERROR,
    5: TRANSACTION_ERROR,
    6: TRANSACTION_ERROR,
  },
  AK9: {
    1: code("715"),
    2: WHOLE,
    3: WHOLE,
    4: WHOLE,
    5: GROUP_ERROR,
    6: GROUP_ERROR,
    7: GROUP_ERROR,
    8: GROUP_ERROR,
    9: GROUP_ERROR,
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

/** The `CAS` adjustment triples: a reason implies its amount, and an amount or a quantity its reason. */
const CAS_IMPLIED: (readonly [number, number])[] = [];
for (let n = 5; n <= 17; n += 3) CAS_IMPLIED.push([n, n + 1], [n + 1, n], [n + 2, n]);

/**
 * The **positions each segment cannot leave empty while a later one holds a value** (see
 * {@link X12PositionRequirements}), for every segment with an amount, quantity, count, control number or
 * reference after a position the 005010 TR3s require or a qualifier implies. When one is empty, every
 * value after it is removed and recorded, each at its own position: a number shape cannot tell a shifted
 * date or account number from an amount (`CLM**4455667701*150...` puts the account number in `CLM-02`).
 *
 * `required` lists the positions the TR3s mark required, so a well-formed segment never has one empty
 * before a value. This table holds the usage of the transaction sets the segment is built for (the 837
 * for a claim segment, the 834 for `INS`); a set whose TR3 uses the segment differently has its own
 * entry in {@link X12_SEGMENT_REQUIREMENTS_BY_SET}, read first. `implied` lists the pairs a qualifier
 * implies: a date format and its date (`PAT-05` / `06`, `INS-11` / `12`), a unit or a qualifier and its
 * value (`PAT-07` / `08`, `CR1-01` / `02`, `EB-09` / `10`, `HSD-01` / `02`), and the `CAS` adjustment
 * triples. Keyed by segment id.
 *
 * Every position named here, and every code or date position of the segment, is also checked by shape:
 * a value there that fails its shape marks a shift, so a value shifted left by a missing separator is
 * caught as well as one shifted right.
 *
 * @internal
 */
export const X12_SEGMENT_REQUIREMENTS: Readonly<Record<string, X12PositionRequirements>> =
  Object.freeze({
    /* ---- the envelope: every position the counts and control numbers follow is required ---- */
    // The ISA has none: the parser reads it at fixed byte positions and refuses one whose separators
    // are not all in place, so no value in it can be shifted.
    TA1: { required: [1, 2, 3, 4, 5] },
    GS: { required: [1, 2, 3, 4, 5, 6, 7, 8] },
    GE: { required: [1, 2] },
    IEA: { required: [1, 2] },
    ST: { required: [1, 2] },
    SE: { required: [1, 2] },

    /* ---- the transaction header ---- */
    BHT: { required: [1, 2, 4] },
    BGN: { required: [1, 2, 3] },
    BPR: { required: [1, 2, 3, 4] },
    TRN: { required: [1, 2] },
    HL: { required: [1, 3] },

    /* ---- claims, remittances and their lines ---- */
    CLM: { required: [1, 2, 5, 7, 8, 9] },
    CLP: { required: [1, 2, 3, 4, 6] },
    AMT: { required: [1, 2] },
    QTY: { required: [1, 2] },
    // A weight (PAT-07 / 08) with no date of death before it, after a relationship code: two extra
    // separators before PAT-05 put the date format and the date of death there.
    PAT: {
      implied: [...paired(5, 6), ...paired(7, 8)],
      spans: [{ gap: [5, 6], after: [7, 8] }],
    },
    CAS: { required: [1, 2, 3], implied: CAS_IMPLIED },
    MIA: { required: [1] },
    LX: { required: [1] },
    HI: { required: [1] },
    SV1: { required: [1, 2, 3, 4, 7] },
    SV2: { required: [1, 3, 4, 5] },
    SV3: { required: [1, 2] },
    SV5: { required: [1, 2, 3] },
    SVC: { required: [1, 2] },
    SVD: { required: [1, 2, 3, 5] },
    TOO: { required: [1, 2] },
    CR1: { required: [4, 5, 6], implied: paired(1, 2) },
    CR2: { implied: [...paired(1, 2), ...paired(5, 6)] },
    CR3: { required: [1, 2, 3] },
    HCP: { required: [1, 2] },
    CN1: { required: [1] },
    PS1: { required: [1, 2] },
    MEA: { required: [1, 2, 3] },
    DN2: { required: [1, 2] },

    /* ---- eligibility, services review, enrollment and claim status ---- */
    HSD: { implied: [...paired(1, 2), [6, 5]] },
    EB: { required: [1], implied: paired(9, 10) },
    INS: { required: [1, 2, 3, 5], implied: paired(11, 12) },
    REL: { required: [1] },
    // STC has no entry: it keeps only codes (the status composites and the payment method), whose
    // shapes still mark a shift, and removes every date, amount and number wherever it sits.
    HCR: { required: [1] },

    /* ---- the 999 acknowledgment ---- */
    AK1: { required: [1, 2, 3] },
    AK2: { required: [1, 2] },
    IK3: { required: [1, 2] },
    IK4: { required: [1, 3] },
    IK5: { required: [1] },
    AK9: { required: [1, 2, 3, 4] },
    CTX: { required: [1] },
  });

/**
 * The **requirements of a segment in a transaction set whose TR3 uses it differently** from the default
 * table ({@link X12_SEGMENT_REQUIREMENTS}), keyed by `ST-01` and then by segment id. A position that is
 * situational or not used in a set is never required there, so a well-formed segment of that set keeps
 * its values.
 *
 * - The 270 and 271 `INS` (2100C / 2100D) carry `INS-01` and `-02`, then `INS-17`, the birth sequence
 *   number. `INS-03` and `-04` are situational in the 271 and `INS-05` is not used in either set.
 * - The 278 `INS` (2010C subscriber and 2010D dependent) carries the same: `INS-01`, `-02` and `INS-17`.
 *   `INS-05` is not used there. It carries no date of the individual.
 * - In the 278 (X217) the `SV1`, `SV2` and `SV3` line charge is situational, and so is the unit and
 *   count that follow it; a unit still implies its count. `SV101` and `SV301` stay required. `CR1` and
 *   `CR3` keep only their paired positions there.
 *
 * No requirement differs between implementation guides that share an `ST-01` (the 837P, 837I and 837D,
 * or the 277 and 277CA), so the set id alone keys the table.
 *
 * @internal
 */
export const X12_SEGMENT_REQUIREMENTS_BY_SET: Readonly<
  Record<string, Readonly<Record<string, X12PositionRequirements>>>
> = Object.freeze({
  "270": { INS: { required: [1, 2] } },
  "271": { INS: { required: [1, 2] } },
  "278": {
    INS: { required: [1, 2] },
    SV1: { required: [1], implied: paired(3, 4) },
    SV2: { implied: paired(4, 5) },
    SV3: { required: [1] },
    CR1: { implied: [...paired(1, 2), ...paired(5, 6)] },
    CR3: { implied: paired(2, 3) },
  },
});

/**
 * The requirements of segment `segId` in the transaction set `ST-01` names: the set's own entry when
 * its TR3 uses the segment differently ({@link X12_SEGMENT_REQUIREMENTS_BY_SET}), and the default table
 * otherwise. An envelope segment has no set (`""`).
 *
 * @param segId - The segment id.
 * @param transactionSetId - The `ST-01` of the transaction set the segment sits in.
 * @returns The requirements, or `undefined` when the segment has none.
 * @internal
 */
export function x12SegmentRequirements(
  segId: string,
  transactionSetId: string,
): X12PositionRequirements | undefined {
  const bySet = Object.hasOwn(X12_SEGMENT_REQUIREMENTS_BY_SET, transactionSetId)
    ? X12_SEGMENT_REQUIREMENTS_BY_SET[transactionSetId]
    : undefined;
  if (bySet !== undefined && Object.hasOwn(bySet, segId)) return bySet[segId];
  return Object.hasOwn(X12_SEGMENT_REQUIREMENTS, segId)
    ? X12_SEGMENT_REQUIREMENTS[segId]
    : undefined;
}

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
