/**
 * The generated leak property for the **X12** leak property (the rule is in `./sweep.ts`).
 *
 * Interchanges come from the parser's own arbitraries (`@cosyte/x12/arbitraries`): generated
 * delimiters, sender and receiver ids, groups and transaction sets of the guides the library declares,
 * and generated body segments. Into the first transaction set the property adds segments carrying
 * tagged sentinels, in generated shapes: a plain element, a value where a composite is expected, an
 * extra repetition, an extra component, and a value in a qualifier or code position (an entity
 * identifier, an id qualifier, a reference qualifier, a date qualifier, a contact function).
 *
 * The builder releases every delimiter in a value, so a composite or a repetition is written with a
 * placeholder and the placeholder is swapped for the interchange's own delimiter in the text. The
 * builder counts the segments, so every control number and count still agrees.
 *
 * The X12 adapter decides every element it hands through, so its residual inventory is a measured
 * zero: any sentinel that survives is a violation, whatever the inventory says.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { buildInterchange, serializeX12, type InterchangeSpec } from "@cosyte/x12";
import { interchangeSpec } from "@cosyte/x12/arbitraries";

import { createDeidContext, DeidError, FATAL_CODES } from "../../src/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";
import {
  runLeakProperty,
  sentinelAt,
  sentinelStem,
  sweep,
  tamper,
  type LeakShape,
  type LeakTally,
  type PassOutcome,
  type Pin,
  type Placement,
} from "./sweep.js";

const FATAL = new Set<string>(Object.values(FATAL_CODES));
const ctx = createDeidContext({ key: "leak-property-x12-synthetic-key", patientId: "p-leak" });

/** Placeholders the builder writes as letters; swapped for the real delimiters afterwards. */
const REP = "QQREPQQ";
const COMP = "QQCOMPQQ";

/** Segment ids a sentinel is written into: party, demographic, claim, service, date and unknown. */
const SEGMENTS = [
  "NM1",
  "N1",
  "N2",
  "N3",
  "N4",
  "REF",
  "DMG",
  "PER",
  "DTP",
  "DTM",
  "CLM",
  "HI",
  "SV1",
  "SV2",
  "NTE",
  "PAT",
  "INS",
  "SBR",
  "AMT",
  "TRN",
  "EB",
  "MSG",
  "K3",
  "ZZZ",
] as const;

/** Qualifier and code positions: segment, element, and the other elements the segment carries. */
const CODE_POSITIONS: readonly (readonly [string, number])[] = [
  ["NM1", 1],
  ["NM1", 2],
  ["NM1", 8],
  ["N1", 1],
  ["N1", 3],
  ["REF", 1],
  ["DTP", 1],
  ["DTP", 2],
  ["DTM", 1],
  ["PER", 1],
  ["PER", 3],
  ["DMG", 1],
  ["DMG", 3],
  ["SBR", 2],
  ["PAT", 1],
  ["INS", 2],
  ["AMT", 1],
  ["HI", 1],
  ["CLM", 5],
];

const SHAPES: readonly LeakShape[] = [
  "plain",
  "plain-for-composite",
  "extra-repeat",
  "extra-component",
  "qualifier-or-code",
];

interface X12Placement {
  readonly segment: string;
  readonly element: number;
  readonly component: number;
  readonly shape: LeakShape;
  readonly code: readonly [string, number];
  /** Generated values for the segment's other elements. */
  readonly filler: readonly string[];
}

/** Filler values: letters and digits, so they never collide with a placeholder or a delimiter. */
const filler = fc.array(fc.stringMatching(/^[A-Z0-9]{1,6}$/), { minLength: 0, maxLength: 9 });

const placementArb: fc.Arbitrary<X12Placement> = fc.record({
  segment: fc.constantFrom(...SEGMENTS),
  element: fc.integer({ min: 1, max: 9 }),
  component: fc.integer({ min: 1, max: 5 }),
  shape: fc.constantFrom(...SHAPES),
  code: fc.constantFrom(...CODE_POSITIONS),
  filler,
});

/** One generated case: an interchange spec from the sibling's arbitraries and the placements. */
export const caseArb = fc.record({
  spec: interchangeSpec({ maxGroups: 1, maxTransactions: 1, maxSegments: 4, maxElements: 6 }),
  stem: sentinelStem,
  placements: fc.array(placementArb, { minLength: 1, maxLength: 5 }),
});

/** The element value for one placement's sentinel, written with placeholders. */
function sentinelValue(p: X12Placement, sentinel: string): string {
  switch (p.shape) {
    case "extra-repeat":
      return `A1${REP}${sentinel}`;
    case "extra-component":
      return `${"A1".concat(COMP).repeat(p.component - 1)}${sentinel}`;
    case "plain-for-composite":
    case "plain":
    case "qualifier-or-code":
    case "nested":
    case "subcomponent":
      return sentinel;
  }
}

/** Build the interchange text with each placement added to the first transaction set. */
export function build(
  spec: InterchangeSpec,
  stem: string,
  specs: readonly X12Placement[],
): { raw: string; placed: Placement[] } {
  const placed: Placement[] = [];
  const added: string[][] = [];
  specs.forEach((p, i) => {
    const sentinel = sentinelAt(stem, i);
    const [segment, element] =
      p.shape === "qualifier-or-code"
        ? p.code
        : p.shape === "plain-for-composite"
          ? (["CLM", 5] as const)
          : ([p.segment, p.element] as const);
    const elements = [segment, ...p.filler];
    while (elements.length <= element) elements.push("A1");
    elements[element] = sentinelValue(p, sentinel);
    added.push(elements);
    placed.push({ sentinel, shape: p.shape, where: `${segment}-${String(element)}` });
  });
  const [group] = spec.groups;
  const [tx] = group?.transactions ?? [];
  if (group === undefined || tx === undefined) throw new Error("no transaction set");
  const withAdded: InterchangeSpec = {
    ...spec,
    groups: [{ ...group, transactions: [{ ...tx, segments: [...tx.segments, ...added] }] }],
  };
  const ix = buildInterchange(withAdded);
  const text = serializeX12(ix);
  const d = ix.delimiters;
  return { raw: text.split(REP).join(d.repetition).split(COMP).join(d.component), placed };
}

/** Run the adapter on the text and read back the outcome. */
export function pass(raw: string): PassOutcome {
  try {
    const result = deidentifyX12String(raw, { context: ctx });
    // ISA is fixed width: the element separator is its fourth byte, the terminator its 106th.
    const element = raw.charAt(3);
    const terminator = raw.charAt(105);
    const keptParties = new Set(
      result.manifest
        .filter((m) => m.code === "DEID_PARTY_ROLE_RETAINED")
        .map((m) => m.locus.replace(/^[^/]*\//, "").replace(/-\d+$/, "")),
    );
    return {
      decidedKeep: (s) => keptParties.has(segmentOf(raw, terminator, element, s)),
      output: result.x12,
      manifest: result.manifest,
      unexaminedResiduals: result.unexaminedResiduals,
      // The adapter decides every position: no residual may stand for a surviving sentinel.
      residualAt: () => false,
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

/**
 * The X12 keeps this suite pins rather than closes (named on the limitations page, pinned in
 * `./found.test.ts`): a trace number in `TRN` is kept when it is printable text of its length, a
 * procedure code is kept when it has the shape its qualifier gives it (any letters and digits for a
 * mutually defined one), and a party its role keeps (a provider) keeps its name and identifier
 * elements as they arrived.
 */
export const X12_PINS: readonly Pin[] = [
  { applies: (p) => /^TRN-[234]$/.test(p.where) },
  { applies: (p) => p.shape === "extra-component" && /^(SV1-1|SV2-2|SV3-1)$/.test(p.where) },
  {
    // Only where the manifest records that the party's role kept it: a person's party is never pinned.
    applies: (p, outcome) =>
      /^(NM1|N1)-\d$/.test(p.where) && outcome.decidedKeep?.(p.sentinel) === true,
  },
];

/**
 * The segment id and occurrence (`NM1[1]`) of the body segment holding the sentinel, counted the way
 * the adapter counts them within one transaction set (the generator writes a single one).
 */
function segmentOf(raw: string, terminator: string, element: string, sentinel: string): string {
  const counts = new Map<string, number>();
  for (const seg of raw.split(terminator)) {
    const id = seg.split(element)[0]?.trim() ?? "";
    const occ = counts.get(id) ?? 0;
    counts.set(id, occ + 1);
    if (seg.includes(sentinel)) return `${id}[${String(occ)}]`;
  }
  return "";
}

/** One case through the property: build, check the sentinels are in the input, run, sweep. */
export function checkCase(
  value: { spec: InterchangeSpec; stem: string; placements: readonly X12Placement[] },
  tally: LeakTally,
): string[] {
  const { raw, placed } = build(value.spec, value.stem, value.placements);
  // Non-vacuity: only a sentinel the input holds is swept, and a case must hold one. A later
  // placement can overwrite an earlier one at the same position.
  const present = placed.filter((p) => raw.includes(p.sentinel));
  if (present.length === 0) return ["no sentinel reached the input"];
  return sweep(present, pass(raw), tally, X12_PINS);
}

describe("the generated leak property: X12", () => {
  it("every sentinel is removed, or named as an unexamined residual at its locus", () => {
    runLeakProperty("x12", caseArb, checkCase);
  });

  it("the sweep has teeth: a sentinel put back into a real output, or the manifest, is caught", () => {
    const [sample] = fc.sample(caseArb, { seed: 7, numRuns: 1 });
    if (sample === undefined) throw new Error("no sample");
    const { raw, placed } = build(sample.spec, sample.stem, sample.placements);
    const caught = tamper(placed, pass(raw));
    expect(caught.inOutput).toContain("survives in the output");
    expect(caught.inManifest).toContain("is in the manifest");
  });
});
