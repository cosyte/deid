/**
 * The generated leak property for the **NCPDP Telecom** leak property (the rule is in `./sweep.ts`).
 *
 * `@cosyte/ncpdp` publishes no arbitraries, so this is a deid generator over the sibling's own
 * builder: a B1 request whose segments are drawn from the person, insurance, prescriber, pharmacy,
 * claim, coordination of benefits, DUR, pricing, clinical and an unknown segment, each carrying
 * generated fields. Sentinels go into generated fields in generated shapes: a plain value at a
 * mapped or unmapped field, an extra repeat of a field already in the segment, a value in a
 * qualifier or code field (a patient id qualifier, a relationship, a gender, a product id qualifier,
 * an other payer id qualifier), and a field id the segment does not define.
 *
 * Telecom fields are flat (no components), so the composite shapes of the other formats have no
 * place here; the repeat and the unknown field id are the shapes this wire format can take.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  buildTelecomRequest,
  serializeTelecom,
  type TelecomSegmentInput,
} from "@cosyte/ncpdp/telecom";

import { createDeidContext, DeidError, FATAL_CODES } from "../../src/index.js";
import { deidentifyTelecomString } from "../../src/ncpdp/index.js";
import {
  runLeakProperty,
  sentinelAt,
  sentinelStem,
  sweep,
  tamper,
  type LeakShape,
  type LeakTally,
  type PassOutcome,
  type Placement,
} from "./sweep.js";

const FATAL = new Set<string>(Object.values(FATAL_CODES));
const ctx = createDeidContext({ key: "leak-property-ncpdp-synthetic-key", patientId: "p-leak" });

/** The segments of a request and some of the field ids each defines (NCPDP Telecom vD.0). */
const SEGMENT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  "01": ["C4", "C5", "CA", "CB", "CM", "CN", "CO", "CP", "CQ", "CX", "CY", "HN", "4X", "2C", "1C"],
  "02": ["EY", "E9"],
  "03": ["EZ", "DB", "DR", "PM", "2J", "2K", "2M", "2N", "2P"],
  "04": ["C2", "CC", "CD", "C1", "C3", "C6", "C9", "FO", "2A", "2B"],
  "05": ["4C", "5C", "6C", "7C", "E8"],
  "07": ["EM", "D2", "E1", "D7", "E7", "D3", "D5", "D6", "D8", "DE", "DF", "DJ"],
  "08": ["7E", "E4", "E5", "E6", "8E", "J9"],
  "11": ["D9", "DC", "DQ", "DU", "DN"],
  "13": ["VE", "WE", "DO"],
  "99": ["ZA", "ZB"],
};

/** Qualifier and code fields: segment and field id. */
const CODE_FIELDS: readonly (readonly [string, string])[] = [
  ["01", "CX"],
  ["01", "C5"],
  ["01", "4X"],
  ["03", "EZ"],
  ["04", "C6"],
  ["04", "C3"],
  ["02", "EY"],
  ["05", "6C"],
  ["05", "5C"],
  ["07", "E1"],
  ["07", "EM"],
  ["08", "7E"],
];

const SHAPES: readonly LeakShape[] = ["plain", "extra-repeat", "qualifier-or-code", "nested"];

interface NcpdpPlacement {
  readonly segment: string;
  readonly field: number;
  readonly shape: LeakShape;
  readonly code: readonly [string, string];
  readonly unknownId: string;
}

const placementArb: fc.Arbitrary<NcpdpPlacement> = fc.record({
  segment: fc.constantFrom(...Object.keys(SEGMENT_FIELDS)),
  field: fc.nat({ max: 20 }),
  shape: fc.constantFrom(...SHAPES),
  code: fc.constantFrom(...CODE_FIELDS),
  unknownId: fc.stringMatching(/^[0-9A-Z]{2}$/),
});

/** Generated fill: which segments are present and short alphanumeric values for their fields. */
const fillArb = fc.record({
  segments: fc.subarray(Object.keys(SEGMENT_FIELDS), { minLength: 1 }),
  value: fc.stringMatching(/^[0-9A-Z]{1,8}$/),
});

/** One generated case: the segments with generated values and the placements to add. */
export const caseArb = fc.record({
  fill: fillArb,
  stem: sentinelStem,
  placements: fc.array(placementArb, { minLength: 1, maxLength: 4 }),
});

/** Build the request text with each placement added. */
export function build(
  fill: { segments: readonly string[]; value: string },
  stem: string,
  specs: readonly NcpdpPlacement[],
): { raw: string; placed: Placement[]; at: Map<string, string> } {
  const segments = new Map<string, { id: string; value: string }[]>();
  for (const seg of fill.segments) {
    const ids = SEGMENT_FIELDS[seg] ?? [];
    segments.set(
      seg,
      ids.slice(0, 3).map((id) => ({ id, value: fill.value })),
    );
  }
  const placed: Placement[] = [];
  const at = new Map<string, string>();
  specs.forEach((p, i) => {
    const sentinel = sentinelAt(stem, i);
    let seg = p.segment;
    let id: string;
    const ids = SEGMENT_FIELDS[seg] ?? [];
    switch (p.shape) {
      case "qualifier-or-code":
        [seg, id] = p.code;
        break;
      case "nested":
        // A field id the segment does not define.
        id = ids.includes(p.unknownId) ? "ZY" : p.unknownId;
        break;
      case "plain":
      case "extra-repeat":
      case "extra-component":
      case "plain-for-composite":
      case "subcomponent":
        id = ids[p.field % ids.length] ?? "ZA";
    }
    const fields = segments.get(seg) ?? [];
    segments.set(seg, fields);
    if (p.shape === "extra-repeat") fields.push({ id, value: fill.value });
    fields.push({ id, value: sentinel });
    placed.push({ sentinel, shape: p.shape, where: `${seg}/${id}` });
    at.set(sentinel, `${seg}/${id}`);
  });
  // The claim segment is always present, so the request is a claim.
  if (!segments.has("07")) segments.set("07", [{ id: "D7", value: "00000000000" }]);
  const ordered: TelecomSegmentInput[] = [...segments.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([segmentId, fields]) => ({ segmentId, fields }));
  const tx = buildTelecomRequest({
    header: { transactionCode: "B1", binNumber: "999999", dateOfService: "20260115" },
    segments: ordered,
  });
  return { raw: serializeTelecom(tx), placed, at };
}

/** Whether the inventory names `segment/field`, at any occurrence of either. */
function namesField(loci: readonly string[], where: string): boolean {
  const [seg, id] = where.split("/");
  const pattern = new RegExp(`^${seg ?? ""}(\\[\\d+\\])?/${id ?? ""}(\\[\\d+\\])?$`);
  return loci.some((l) => pattern.test(l));
}

/** Run the adapter on the text and read back the outcome. */
export function pass(raw: string, at: ReadonlyMap<string, string>): PassOutcome {
  try {
    const result = deidentifyTelecomString(raw, { context: ctx });
    const loci = result.unexaminedResiduals.map((r) => r.locus);
    return {
      output: result.telecom,
      manifest: result.manifest,
      unexaminedResiduals: result.unexaminedResiduals,
      residualAt: (s) => namesField(loci, at.get(s) ?? ""),
      refused: false,
    };
  } catch (err) {
    if (err instanceof DeidError && FATAL.has(err.code)) {
      return {
        output: "",
        manifest: [],
        unexaminedResiduals: [],
        residualAt: () => false,
        refused: true,
      };
    }
    throw err;
  }
}

/** One case through the property: build, check the sentinels are in the input, run, sweep. */
export function checkCase(
  value: {
    fill: { segments: readonly string[]; value: string };
    stem: string;
    placements: readonly NcpdpPlacement[];
  },
  tally: LeakTally,
): string[] {
  const { raw, placed, at } = build(value.fill, value.stem, value.placements);
  // Non-vacuity: only a sentinel the input holds is swept, and a case must hold one. A later
  // placement can overwrite an earlier one at the same position.
  const present = placed.filter((p) => raw.includes(p.sentinel));
  if (present.length === 0) return ["no sentinel reached the input"];
  return sweep(present, pass(raw, at), tally);
}

describe("the generated leak property: NCPDP Telecom", () => {
  it("every sentinel is removed, or named as an unexamined residual at its locus", () => {
    runLeakProperty("ncpdp", caseArb, checkCase);
  });

  it("the sweep has teeth: a sentinel put back into a real output, or the manifest, is caught", () => {
    const [sample] = fc.sample(caseArb, { seed: 7, numRuns: 1 });
    if (sample === undefined) throw new Error("no sample");
    const { raw, placed, at } = build(sample.fill, sample.stem, sample.placements);
    const caught = tamper(placed, pass(raw, at));
    expect(caught.inOutput).toContain("survives in the output");
    expect(caught.inManifest).toContain("is in the manifest");
  });
});
