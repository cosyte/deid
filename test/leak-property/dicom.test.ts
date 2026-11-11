/**
 * The generated leak property for the **DICOM** leak property (the rule is in `./sweep.ts`).
 *
 * `@cosyte/dicom` publishes no arbitraries, so this is a deid generator over the in-memory Part 10
 * builder the DICOM tests already use (`test/dicom/helpers/build-dicom.ts`). A dataset carries
 * generated attributes, and sentinels go in at generated tags in generated shapes: a plain value at a
 * person, description or comment attribute, a value in a component of a person name, an extra value
 * of a multi-valued attribute, a value in a code position (a coded string, a code value, a coding
 * scheme, a code meaning), a value under a VR the attribute does not have (`UN`), and nested sequence
 * items, two levels deep and with a private attribute inside.
 *
 * Where a sentinel sits is known from the generator, as the adapter writes a locus
 * (`(0008,1032)[0]/(0008,0104)`), and the residual it must be named by is matched on that.
 */

import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseDicom, serializeDicom } from "@cosyte/dicom";

import { DeidError, FATAL_CODES } from "../../src/index.js";
import { deidentifyDicom } from "../../src/dicom/index.js";
import {
  buildDicom,
  type BuildDicomElement,
  type BuildDicomSqElement,
} from "../dicom/helpers/build-dicom.js";
import { pad, TS_EXPLICIT_LE } from "../dicom/helpers/fixtures.js";
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

type Element = BuildDicomElement | BuildDicomSqElement;

/** Plain text attributes: person, identifier, description and comment positions. */
const PLAIN_TAGS: readonly (readonly [string, string])[] = [
  ["00100010", "PN"],
  ["00100020", "LO"],
  ["00080090", "PN"],
  ["00080080", "LO"],
  ["00080050", "SH"],
  ["00101040", "LO"],
  ["00081030", "LO"],
  ["0008103E", "LO"],
  ["00181030", "LO"],
  ["00204000", "LT"],
  ["001021B0", "LT"],
  ["00400254", "LO"],
  ["00321060", "LO"],
  ["00102180", "SH"],
  ["00081040", "LO"],
];

/** Coded string positions. */
const CODE_TAGS: readonly string[] = ["00100040", "00080060", "00080008", "00280301", "00081090"];

const SHAPES: readonly LeakShape[] = [
  "plain",
  "plain-for-composite",
  "extra-repeat",
  "qualifier-or-code",
  "nested",
];

const placementArb = fc.record({
  shape: fc.constantFrom(...SHAPES),
  plain: fc.constantFrom(...PLAIN_TAGS),
  code: fc.constantFrom(...CODE_TAGS),
  nest: fc.nat({ max: 5 }),
  asUn: fc.boolean(),
});

/** One generated case: the placements (one attribute each) and the stem of their sentinels. */
export const caseArb = fc.record({
  stem: sentinelStem,
  placements: fc.array(placementArb, { minLength: 1, maxLength: 5 }),
});

const text = (vr: string, value: string): Buffer =>
  vr === "UI" ? Buffer.from(value.length % 2 === 0 ? value : `${value}\0`, "latin1") : pad(value);

/** A code sequence item: value, scheme and meaning. */
function codeItem(value: string, scheme: string, meaning: string): BuildDicomElement[] {
  return [
    { tag: "00080100", vr: "SH", value: text("SH", value) },
    { tag: "00080102", vr: "SH", value: text("SH", scheme) },
    { tag: "00080104", vr: "LO", value: text("LO", meaning) },
  ];
}

interface Built {
  readonly element: Element;
  /** The locus the adapter writes for the attribute that holds the sentinel. */
  readonly locus: string;
  readonly where: string;
}

/** Format a tag as the adapter does: `(gggg,eeee)`, lower case. */
const fmt = (tag: string): string => `(${tag.slice(0, 4)},${tag.slice(4)})`.toLowerCase();

/** One placement as an attribute of the dataset. */
function placeOne(
  p: {
    shape: LeakShape;
    plain: readonly [string, string];
    code: string;
    nest: number;
    asUn: boolean;
  },
  s: string,
): Built {
  const [tag, vr] = p.plain;
  switch (p.shape) {
    case "plain": {
      const v = p.asUn ? "UN" : vr;
      return {
        element: { tag, vr: v, value: text(vr, s) },
        locus: fmt(tag),
        where: `${fmt(tag)} ${v}`,
      };
    }
    case "plain-for-composite":
      // A person name whose family component is ordinary and whose given or middle carries the value.
      return {
        element: { tag: "00100010", vr: "PN", value: text("PN", `ZZFAMILY^ZZGIVEN^${s}`) },
        locus: fmt("00100010"),
        where: "(0010,0010) component",
      };
    case "extra-repeat":
      return {
        element: { tag, vr, value: text(vr, `A1\\${s}`) },
        locus: fmt(tag),
        where: `${fmt(tag)} second value`,
      };
    case "qualifier-or-code":
      return {
        element: { tag: p.code, vr: p.code === "00081090" ? "LO" : "CS", value: text("CS", s) },
        locus: fmt(p.code),
        where: `${fmt(p.code)} code`,
      };
    case "nested":
    case "extra-component":
    case "subcomponent":
      return nested(p.nest, s);
  }
}

/** A nested placement: inside a code sequence, a request, a content item, or two levels deep. */
function nested(which: number, s: string): Built {
  switch (which) {
    case 0:
      return {
        element: { tag: "00081032", items: [{ elements: codeItem(s, "99ZZ", "Synthetic") }] },
        locus: "(0008,1032)[0]/(0008,0100)",
        where: "Procedure Code Sequence code value",
      };
    case 1:
      return {
        element: { tag: "00081032", items: [{ elements: codeItem("C1", "99ZZ", s) }] },
        locus: "(0008,1032)[0]/(0008,0104)",
        where: "Procedure Code Sequence code meaning",
      };
    case 2:
      return {
        element: {
          tag: "00400275",
          items: [{ elements: [{ tag: "00401001", vr: "SH", value: text("SH", s) }] }],
        },
        locus: "(0040,0275)[0]/(0040,1001)",
        where: "Request Attributes Sequence requested procedure id",
      };
    case 3:
      return {
        element: {
          tag: "0040A730",
          items: [
            {
              elements: [
                {
                  tag: "0040A730",
                  items: [{ elements: [{ tag: "0040A160", vr: "UT", value: text("UT", s) }] }],
                },
              ],
            },
          ],
        },
        locus: "(0040,a730)[0]/(0040,a730)[0]/(0040,a160)",
        where: "Content Sequence two levels deep, text value",
      };
    case 4:
      return {
        element: {
          tag: "00081111",
          items: [
            {
              elements: [
                { tag: "00090010", vr: "LO", value: text("LO", "ZZSYNTHETIC") },
                { tag: "00091001", vr: "LO", value: text("LO", s) },
              ],
            },
          ],
        },
        locus: "(0008,1111)[0]/(0009,1001)",
        where: "a private attribute inside a sequence item",
      };
    default:
      return {
        element: {
          tag: "00101002",
          items: [{ elements: [{ tag: "00100020", vr: "LO", value: text("LO", s) }] }],
        },
        locus: "(0010,1002)[0]/(0010,0020)",
        where: "Other Patient IDs Sequence patient id",
      };
  }
}

/** Build the Part 10 bytes with each placement as its own attribute. */
export function build(value: {
  stem: string;
  placements: readonly {
    shape: LeakShape;
    plain: readonly [string, string];
    code: string;
    nest: number;
    asUn: boolean;
  }[];
}): { buf: Buffer; placed: Placement[]; loci: Map<string, string> } {
  const byTag = new Map<string, Element>();
  const placed: Placement[] = [];
  const loci = new Map<string, string>();
  value.placements.forEach((p, i) => {
    const s = sentinelAt(value.stem, i);
    const b = placeOne(p, s);
    // One attribute per tag: a later placement at the same tag replaces the earlier one.
    const earlier = byTag.get(b.element.tag);
    if (earlier !== undefined) {
      const lost = placed.findIndex((q) => loci.get(q.sentinel)?.startsWith(fmt(b.element.tag)));
      if (lost >= 0) placed.splice(lost, 1);
    }
    byTag.set(b.element.tag, b.element);
    placed.push({ sentinel: s, shape: p.shape, where: b.where });
    loci.set(s, b.locus);
  });
  const elements = [...byTag.values()].sort((a, b) => a.tag.localeCompare(b.tag));
  const buf = buildDicom({
    transferSyntax: TS_EXPLICIT_LE,
    mediaStorageSOPInstanceUID: "1.2.826.0.1.3680043.8.498.1",
    elements,
  });
  return { buf, placed, loci };
}

/** Run the adapter on the bytes and read back the outcome. */
export function pass(buf: Buffer, loci: ReadonlyMap<string, string>): PassOutcome {
  try {
    const result = deidentifyDicom(parseDicom(buf));
    const residual = new Set(result.unexaminedResiduals.map((r) => r.locus.toLowerCase()));
    return {
      output: serializeDicom(result.dataset).toString("latin1"),
      manifest: result.manifest,
      unexaminedResiduals: result.unexaminedResiduals,
      residualAt: (s) => residual.has(loci.get(s) ?? ""),
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
export function checkCase(value: Parameters<typeof build>[0], tally: LeakTally): string[] {
  const { buf, placed, loci } = build(value);
  const before = buf.toString("latin1");
  // Non-vacuity: only a sentinel the input holds is swept, and a case must hold one. A later
  // placement can overwrite an earlier one at the same position.
  const present = placed.filter((p) => before.includes(p.sentinel));
  if (present.length === 0) return ["no sentinel reached the input"];
  return sweep(present, pass(buf, loci), tally);
}

describe("the generated leak property: DICOM", () => {
  it("every sentinel is removed, or named as an unexamined residual at its locus", () => {
    runLeakProperty("dicom", caseArb, checkCase);
  });

  it("the sweep has teeth: a sentinel put back into a real output, or the manifest, is caught", () => {
    const [sample] = fc.sample(caseArb, { seed: 7, numRuns: 1 });
    if (sample === undefined) throw new Error("no sample");
    const { buf, placed, loci } = build(sample);
    const caught = tamper(placed, pass(buf, loci));
    expect(caught.inOutput).toContain("survives in the output");
    expect(caught.inManifest).toContain("is in the manifest");
  });
});
