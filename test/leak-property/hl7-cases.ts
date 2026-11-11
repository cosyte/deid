/**
 * The generated leak property for the **HL7 v2** adapter (the rule is in `./sweep.ts`).
 *
 * Messages come from the parser's own arbitraries (`@cosyte/hl7/arbitraries`): generated encoding
 * characters, escape sequences, common message types and generated body segments. Into each one the
 * property writes tagged sentinels at generated positions of the segments this adapter decides
 * (person, relative, guarantor and insurance segments, retained visit and order segments, OBX, NTE,
 * the envelope, a merge and a site-defined `Z` segment), in generated shapes: a plain string where a
 * composite is expected, an extra repetition, an extra component, a subcomponent, and a value in a
 * code or qualifier position (an identifier type, a name type, a value type, a relationship).
 *
 * Where a sentinel sits is read back from the PARSED input, so the locus the residual inventory must
 * name is the parser's, not the generator's intent.
 */

import fc from "fast-check";
import { parseHL7, type Hl7Message } from "@cosyte/hl7";
import { message } from "@cosyte/hl7/arbitraries";

import {
  createDeidContext,
  DeidError,
  FATAL_CODES,
  type UnexaminedResidual,
} from "../../src/index.js";
import { deidentifyHl7 } from "../../src/hl7/index.js";
import {
  sentinelAt,
  sentinelStem,
  sweep,
  type LeakShape,
  type LeakTally,
  type PassOutcome,
  type Placement,
} from "./sweep.js";

const FATAL = new Set<string>(Object.values(FATAL_CODES));
const ctx = createDeidContext({ key: "leak-property-hl7-synthetic-key", patientId: "p-leak" });

/** The segments a sentinel is written into: one of every kind of decision the adapter makes. */
const SEGMENTS = [
  "MSH",
  "EVN",
  "PID",
  "PD1",
  "NK1",
  "PV1",
  "PV2",
  "GT1",
  "IN1",
  "IN2",
  "ORC",
  "OBR",
  "OBX",
  "NTE",
  "DG1",
  "AL1",
  "MRG",
  "ZPI",
] as const;

/**
 * Code and qualifier positions, as segment, field and component: the identifier type of a CX, the
 * assigning authority's namespace, the name type of an XPN, the address type of an XAD, the
 * telecommunication use code, a relationship, the OBX value type and observation identifier, and the
 * visit number's identifier type.
 */
const CODE_POSITIONS: readonly (readonly [string, number, number])[] = [
  ["PID", 3, 5],
  ["PID", 3, 4],
  ["PID", 5, 7],
  ["PID", 11, 7],
  ["PID", 13, 2],
  ["PID", 18, 5],
  ["NK1", 2, 7],
  ["NK1", 3, 1],
  ["NK1", 33, 5],
  ["GT1", 2, 5],
  ["IN1", 17, 1],
  ["IN1", 49, 5],
  ["PV1", 19, 5],
  ["PV1", 7, 13],
  ["OBX", 2, 1],
  ["OBX", 3, 1],
  ["OBX", 3, 3],
  ["MRG", 1, 5],
];

const SHAPES: readonly LeakShape[] = [
  "plain-for-composite",
  "extra-repeat",
  "extra-component",
  "subcomponent",
  "qualifier-or-code",
];

interface HL7Placement {
  readonly segment: string;
  readonly field: number;
  readonly component: number;
  readonly shape: LeakShape;
  readonly code: readonly [string, number, number];
  readonly append: boolean;
}

const placementArb: fc.Arbitrary<HL7Placement> = fc.record({
  segment: fc.constantFrom(...SEGMENTS),
  field: fc.integer({ min: 1, max: 40 }),
  component: fc.integer({ min: 1, max: 12 }),
  shape: fc.constantFrom(...SHAPES),
  code: fc.constantFrom(...CODE_POSITIONS),
  append: fc.boolean(),
});

/** One generated case: a message from the sibling's arbitraries and the placements to write into it. */
export const caseArb = fc.record({
  msg: message({ maxExtraSegments: 3, maxFields: 10 }),
  stem: sentinelStem,
  placements: fc.array(placementArb, { minLength: 1, maxLength: 5 }),
});

interface Delims {
  readonly field: string;
  readonly component: string;
  readonly repetition: string;
  readonly subcomponent: string;
}

/** The delimiters a written message declares in MSH-1 and MSH-2. */
function delimsOf(wire: string): Delims {
  return {
    field: wire.charAt(3),
    component: wire.charAt(4),
    repetition: wire.charAt(5),
    subcomponent: wire.charAt(7),
  };
}

/** Set one field of a segment line, padding with empty fields. MSH numbers from its separator. */
function setField(line: string, d: Delims, field: number, text: string): string {
  const parts = line.split(d.field);
  const index = parts[0] === "MSH" ? field - 1 : field;
  while (parts.length <= index) parts.push("");
  parts[index] = text;
  return parts.join(d.field);
}

/** Read one field of a segment line as written. */
function getField(line: string, d: Delims, field: number): string {
  const parts = line.split(d.field);
  const index = parts[0] === "MSH" ? field - 1 : field;
  return parts[index] ?? "";
}

/** Set one component of the first repetition of a field's text, padding with empty components. */
function withComponent(fieldText: string, d: Delims, component: number, text: string): string {
  const reps = fieldText.split(d.repetition);
  const comps = (reps[0] ?? "").split(d.component);
  while (comps.length < component) comps.push("");
  comps[component - 1] = text;
  reps[0] = comps.join(d.component);
  return reps.join(d.repetition);
}

/** Write each placement into the message text; returns the text and what was placed where. */
export function build(
  msg: Hl7Message,
  stem: string,
  specs: readonly HL7Placement[],
): { raw: string; placed: Placement[] } {
  const wire = msg.toString();
  const d = delimsOf(wire);
  const lines = wire.split("\r").filter((l) => l.length > 0);
  const placed: Placement[] = [];
  specs.forEach((spec, i) => {
    const sentinel = sentinelAt(stem, i);
    const [segment, field, component] =
      spec.shape === "qualifier-or-code"
        ? spec.code
        : ([
            spec.segment,
            spec.segment === "MSH" ? Math.max(spec.field, 3) : spec.field,
            spec.component,
          ] as const);
    // MSH-1 and MSH-2 are the delimiters themselves; a sentinel there is not a message.
    let target =
      spec.append || segment === "MSH"
        ? -1
        : lines.findIndex((l) => l.startsWith(`${segment}${d.field}`) || l === segment);
    if (segment === "MSH") target = 0;
    if (target < 0) {
      lines.push(segment);
      target = lines.length - 1;
    }
    const line = lines[target] ?? segment;
    const existing = getField(line, d, field);
    let text: string;
    switch (spec.shape) {
      case "plain-for-composite":
        text = sentinel;
        break;
      case "extra-repeat":
        text = `${existing.length > 0 ? existing : "A1"}${d.repetition}${sentinel}`;
        break;
      case "extra-component":
        text = withComponent(existing, d, component, sentinel);
        break;
      case "subcomponent":
        text = withComponent(existing, d, component, `Q1${d.subcomponent}${sentinel}`);
        break;
      case "qualifier-or-code":
      case "nested":
      case "plain":
        text = withComponent(existing, d, component, sentinel);
    }
    lines[target] = setField(line, d, field, text);
    placed.push({
      sentinel,
      shape: spec.shape,
      where: `${segment}-${String(field)}.${String(component)}`,
    });
  });
  return { raw: lines.join("\r"), placed };
}

/** A position in the parsed input, as the residual inventory names one. */
interface Hl7Position {
  readonly type: string;
  readonly occ: number;
  readonly field: number;
  readonly rep: number;
  readonly component: number;
}

/** Every position in the parsed message whose component carries the sentinel. */
function positionsOf(msg: Hl7Message, sentinel: string): Hl7Position[] {
  const found: Hl7Position[] = [];
  const occurrences = new Map<string, number>();
  for (const seg of msg.allSegments()) {
    const type = seg.type;
    const occ = occurrences.get(type) ?? 0;
    occurrences.set(type, occ + 1);
    const highest = type === "MSH" ? seg.fields.length : seg.fields.length - 1;
    for (let field = 1; field <= highest; field += 1) {
      seg.field(field).repetitions.forEach((rep, r) => {
        rep.components.forEach((comp, c) => {
          if (comp.subcomponents.some((s) => s.includes(sentinel))) {
            found.push({ type, occ, field, rep: r, component: c + 1 });
          }
        });
      });
    }
  }
  return found;
}

/** Parse an HL7 residual locus: `TYPE[occ]-field[rep].component`. */
const RESIDUAL = /^([^[-]+)(?:\[(\d+)\])?-(\d+)(?:\[(\d+)\])?(?:\.(\d+))?$/;

/** Whether the inventory names this position. */
function namesPosition(residuals: readonly UnexaminedResidual[], p: Hl7Position): boolean {
  return residuals.some((r) => {
    const m = RESIDUAL.exec(r.locus);
    if (m === null) return false;
    return (
      m[1] === p.type &&
      Number(m[2] ?? "0") === p.occ &&
      Number(m[3]) === p.field &&
      Number(m[4] ?? "0") === p.rep &&
      Number(m[5] ?? "1") === p.component
    );
  });
}

/** Run the adapter on the text and read back the outcome. */
export function pass(raw: string): PassOutcome {
  const input = parseHL7(raw);
  try {
    const result = deidentifyHl7(input, { context: ctx });
    return {
      output: result.hl7,
      manifest: result.manifest,
      unexaminedResiduals: result.unexaminedResiduals,
      // Every position the sentinel occupies must be named: one unnamed copy is a leak.
      residualAt: (s) => {
        const positions = positionsOf(input, s);
        return (
          positions.length > 0 &&
          positions.every((p) => namesPosition(result.unexaminedResiduals, p))
        );
      },
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
  value: { msg: Hl7Message; stem: string; placements: readonly HL7Placement[] },
  tally: LeakTally,
): string[] {
  const { raw, placed } = build(value.msg, value.stem, value.placements);
  const before = parseHL7(raw).toString();
  // Non-vacuity: every sentinel is in the parsed input before the pass.
  // Non-vacuity: only a sentinel the input holds is swept, and a case must hold one. A later
  // placement can overwrite an earlier one at the same position.
  const present = placed.filter((p) => before.includes(p.sentinel));
  if (present.length === 0) return ["no sentinel reached the input"];
  return sweep(present, pass(raw), tally);
}
