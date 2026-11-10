/**
 * **X12: every code position is judged against the complete 005010 code list of its data element.**
 * A code position that checks its value against a hand-picked part of the list removes a real code
 * from well-formed input. So, for every position the shape table keeps and every code position the
 * locus rules route on, this reads which data element the 005010 segment definition puts there
 * (`test/fixtures/x12/segments-005010.json`) and requires the position to keep every code of that
 * element's complete list (`src/x12/code-lists.ts`) and to remove a value that is no code. It also
 * requires every code a role or reference table routes on to be a real code, so no route is dead, and
 * every code the `@cosyte/x12` library's own code tables name at a position to be kept there.
 *
 * Every value is a code from a published list, or a ZZ-tagged sentinel.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CARC,
  CLAIM_ADJUSTMENT_GROUP_CODES,
  CLAIM_STATUS_CATEGORY_CODES,
  CLAIM_STATUS_CODES,
  CLP_STATUS,
  HI_QUALIFIERS,
  MAINTENANCE_TYPE_CODES,
  RARC,
  SERVICE_TYPE_CODES,
} from "@cosyte/x12";
import { describe, expect, it } from "vitest";

import { X12_CODE_LIST_ELEMENTS, x12CodeList } from "../../src/x12/code-lists.js";
import {
  X12_ELEMENT_SHAPES,
  type X12ElementShape,
  type X12ShapeContext,
} from "../../src/x12/element-shapes.js";
import {
  EMPLOYER_ENTITY_CODES,
  PATIENT_ENTITY_CODES,
  PROVIDER_ENTITY_CODES,
  classifyRefQualifier,
  isRecognizedX12Code,
} from "../../src/x12/locus-map.js";

interface SegmentDefinitions {
  /** The data elements the 005010 dictionary gives a code list of their own. */
  readonly coded: readonly string[];
  /** Segment id, then 1-based position, then the element number (or the composite's elements). */
  readonly segments: Readonly<Record<string, Readonly<Record<string, string | readonly string[]>>>>;
}

const DEFINITIONS = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "fixtures", "x12", "segments-005010.json"), "utf8"),
) as SegmentDefinitions;
const CODED = new Set<string>(DEFINITIONS.coded);
const LISTED = new Set<string>(X12_CODE_LIST_ELEMENTS);

/** A value that is a code of no element: too long for any of them. */
const NO_CODE = "ZZNOTACODE";

const ctxFor = (components?: readonly string[]): X12ShapeContext => ({
  component: ":",
  repetition: "^",
  elements: [],
  ...(components === undefined ? {} : { components }),
});

/** The complete list of an element the module holds, which the coded check below guarantees. */
const listOf = (element: string): ReadonlySet<string> =>
  x12CodeList(element as (typeof X12_CODE_LIST_ELEMENTS)[number]);

/** The element the segment definition puts at one position. */
function definitionOf(segId: string, position: number): string | readonly string[] {
  const def = DEFINITIONS.segments[segId]?.[String(position)];
  if (def === undefined) throw new Error(`no 005010 definition for ${segId}-${String(position)}`);
  return def;
}

/** Every (segment, position, component) whose element carries a code list, with its shape test. */
function codedPositions(): {
  label: string;
  element: string;
  test: (value: string) => boolean;
}[] {
  const out: { label: string; element: string; test: (value: string) => boolean }[] = [];
  for (const [segId, positions] of Object.entries(X12_ELEMENT_SHAPES)) {
    for (const [p, shape] of Object.entries<X12ElementShape>(positions)) {
      const def = definitionOf(segId, Number(p));
      if (typeof def === "string") {
        if (!CODED.has(def)) continue;
        out.push({
          label: `${segId}-${p}`,
          element: def,
          test: (value) => shape.kind === "keep" && shape.test(value, ctxFor()),
        });
        continue;
      }
      if (shape.kind !== "composite") throw new Error(`${segId}-${p} is a composite`);
      shape.components.forEach((spec, i) => {
        const element = def[i] as string;
        if (!CODED.has(element)) return;
        out.push({
          label: `${segId}-${p}-${String(i + 1)}`,
          element,
          test: (value) => spec.kind === "keep" && spec.test(value, ctxFor([value])),
        });
      });
    }
  }
  return out;
}

describe("every code position the shape table keeps uses its element's complete 005010 list", () => {
  const positions = codedPositions();

  it("finds the coded positions (the definitions cover every segment the table keeps)", () => {
    // AMT-01, QTY-01, REF-free shapes and the 999 codes among them; a broken fixture finds none.
    expect(positions.length).toBeGreaterThan(150);
    expect(positions.map((p) => p.label)).toEqual(
      expect.arrayContaining(["AMT-1", "QTY-1", "HI-1-1", "STC-1-3", "PRV-2", "DN2-2", "OI-4"]),
    );
  });

  for (const { label, element, test } of positions) {
    it(`${label} (element ${element}) keeps every code of the list and removes a value that is no code`, () => {
      expect(LISTED.has(element)).toBe(true);
      const missed = [...listOf(element)].filter((code) => !test(code));
      expect(missed).toEqual([]);
      expect(test(NO_CODE)).toBe(false);
    });
  }
});

describe("the code positions the locus rules route on use the complete lists", () => {
  const ROUTED: readonly (readonly [string, number])[] = [
    ["NM1", 1],
    ["NM1", 8],
    ["N1", 1],
    ["N1", 3],
    ["REF", 1],
    ["N4", 4],
  ];
  for (const [segId, position] of ROUTED) {
    it(`${segId}-${String(position)}`, () => {
      const element = definitionOf(segId, position) as string;
      expect(CODED.has(element)).toBe(true);
      const missed = [...listOf(element)].filter(
        (code) => !isRecognizedX12Code(segId, position, code),
      );
      expect(missed).toEqual([]);
      expect(isRecognizedX12Code(segId, position, NO_CODE)).toBe(false);
    });
  }

  it("every code a role table routes on is a real entity identifier code", () => {
    const roles = [...PATIENT_ENTITY_CODES, ...EMPLOYER_ENTITY_CODES, ...PROVIDER_ENTITY_CODES];
    expect(roles.filter((code) => !x12CodeList("98").has(code))).toEqual([]);
  });

  it("every code a REF table routes on is a real reference identification qualifier", () => {
    const routed = [...x12CodeList("128")].filter((q) => classifyRefQualifier(q).kind !== "block");
    // The two tables hold 65 qualifiers between them; each of them is a code of element 128.
    expect(routed).toHaveLength(65);
  });
});

describe("every code the @cosyte/x12 code tables name is kept where it belongs", () => {
  const keeps = (segId: string, position: number, value: string, component?: number): boolean => {
    const shape = X12_ELEMENT_SHAPES[segId]?.[position];
    if (shape === undefined) return false;
    if (component === undefined) return shape.kind === "keep" && shape.test(value, ctxFor());
    const spec = shape.kind === "composite" ? shape.components[component - 1] : undefined;
    return spec?.kind === "keep" && spec.test(value, ctxFor([value]));
  };

  const TABLES: readonly {
    readonly name: string;
    readonly codes: readonly string[];
    readonly at: readonly [string, number, number?];
  }[] = [
    {
      name: "claim adjustment group",
      codes: Object.keys(CLAIM_ADJUSTMENT_GROUP_CODES),
      at: ["CAS", 1],
    },
    { name: "claim adjustment reason", codes: Object.keys(CARC.codes), at: ["CAS", 2] },
    { name: "remittance advice remark", codes: Object.keys(RARC.codes), at: ["MOA", 3] },
    { name: "claim status (CLP)", codes: Object.keys(CLP_STATUS.codes), at: ["CLP", 2] },
    { name: "maintenance type", codes: Object.keys(MAINTENANCE_TYPE_CODES.codes), at: ["INS", 3] },
    { name: "service type", codes: Object.keys(SERVICE_TYPE_CODES.codes), at: ["EB", 3] },
    {
      name: "claim status category",
      codes: Object.keys(CLAIM_STATUS_CATEGORY_CODES.codes),
      at: ["STC", 1, 1],
    },
    { name: "claim status", codes: Object.keys(CLAIM_STATUS_CODES.codes), at: ["STC", 1, 2] },
    { name: "HI qualifier", codes: Object.keys(HI_QUALIFIERS), at: ["HI", 1, 1] },
  ];

  for (const { name, codes, at } of TABLES) {
    it(name, () => {
      expect(codes.length).toBeGreaterThan(0);
      expect(codes.filter((code) => !keeps(at[0], at[1], code, at[2]))).toEqual([]);
    });
  }
});
