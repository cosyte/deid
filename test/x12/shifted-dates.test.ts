/**
 * **X12: a value shifted left or right is removed, whichever way the separator went.** An extra
 * separator leaves a required position empty before a later value. A missing one moves every later
 * value one place left, and the first sign of it is a value that fails the shape of a position the
 * TR3 requires, or of a narrow position (a code, a date, a composite of codes): a unit code that is not
 * the one the TR3 allows, a payment method that is a date. The values between the last narrow position
 * that held and that one may all be shifted, and every value after it too, so they are removed and
 * recorded. Nothing the pass treats as a date of the individual leaves verbatim after a shift.
 *
 * `STC` keeps only its status composites and its payment method: its dates and amounts are removed
 * wherever they sit, since an amount before a date in the last position leaves nothing to fail.
 *
 * The positions a set's TR3 requires are read for that set: the 270, 271 and 278 `INS` and the 278
 * service lines keep every value of a well-formed segment.
 *
 * Every value is a synthetic, ZZ-tagged sentinel, a synthetic date, or a synthetic number.
 */

import { describe, expect, it } from "vitest";

import { createDeidContext, type DeidManifestEntry } from "../../src/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";
import * as shapes from "../../src/x12/element-shapes.js";

const ctx = createDeidContext({
  key: "x12-shifted-dates-synthetic-hmac-key",
  patientId: "p-x12-shifted-dates",
});

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000009*0*P*:~";

/** The transaction set id, functional identifier and implementation guide of each set the cases use. */
const SETS: Readonly<Record<string, readonly [st01: string, gs01: string, version: string]>> = {
  "837": ["837", "HC", "005010X222A1"],
  "835": ["835", "HP", "005010X221A1"],
  "277": ["277", "HN", "005010X212"],
  "277CA": ["277", "HN", "005010X214"],
  "270": ["270", "HS", "005010X279A1"],
  "271": ["271", "HB", "005010X279A1"],
  "278": ["278", "HI", "005010X217"],
  "834": ["834", "BE", "005010X220A1"],
};

/** Wrap body segments (no terminators) in one transaction set and run the pass. */
function run(
  set: string,
  segments: readonly string[],
): { x12: string; body: string[]; manifest: readonly DeidManifestEntry[]; residuals: number } {
  const [st01, gs01, version] = SETS[set] ?? ["837", "HC", "005010X222A1"];
  const raw =
    `${ISA}GS*${gs01}*A*B*20260615*0930*9*X*${version}~ST*${st01}*0009*${version}~` +
    `${segments.map((s) => `${s}~`).join("")}SE*${String(segments.length + 2)}*0009~GE*1*9~` +
    `IEA*1*000000009~`;
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  const all = x12.split("~");
  const st = all.findIndex((s) => s.startsWith("ST*"));
  const se = all.findIndex((s) => s.startsWith("SE*"));
  return { x12, body: all.slice(st + 1, se), manifest, residuals: unexaminedResiduals.length };
}

/** The blocked rows of a manifest, by locus. */
const blocked = (manifest: readonly DeidManifestEntry[]): string[] =>
  manifest.filter((e) => e.disposition === "blocked").map((e) => e.locus);

/** The rows `837/PAT[0]-a` to `-b`, one per position. */
const rows = (prefix: string, positions: readonly number[]): string[] =>
  positions.map((n) => `${prefix}-${String(n)}`);

describe("PAT: a date of death two places late is removed", () => {
  it("the patient shape: D8 at PAT-07 is a unit code, but not the pound the TR3s allow", () => {
    const result = run("837", ["PAT*19******D8*20250117*01*145*Y"]);
    expect(result.x12).not.toContain("20250117");
    expect(result.body).toEqual(["PAT*19**********"]);
    expect(blocked(result.manifest)).toEqual(rows("837/PAT[0]", [7, 8, 9, 10, 11]));
    expect(result.residuals).toBe(0);
  });

  it("the subscriber shape (no PAT-01): D8 at PAT-07 and the date in PAT-08", () => {
    const result = run("837", ["PAT*******D8*20250117"]);
    expect(result.x12).not.toContain("20250117");
    expect(result.body).toEqual(["PAT********"]);
    expect(blocked(result.manifest)).toEqual(rows("837/PAT[0]", [7, 8]));
  });

  it("PAT-07 keeps only 01, and any other unit takes the weight with it", () => {
    expect(run("837", ["PAT*******01*145"]).body).toEqual(["PAT*******01*145"]);
    const result = run("837", ["PAT*******LB*145"]);
    expect(result.body).toEqual(["PAT********"]);
    expect(blocked(result.manifest)).toEqual(rows("837/PAT[0]", [7, 8]));
  });

  it("a weight after a relationship code with no date of death between them is removed", () => {
    // PAT-05 and -06 both empty between PAT-01 and a weight: two extra separators can put a date
    // format and a date of death at PAT-07 and -08, so the values there cannot be placed.
    const result = run("837", ["PAT*19******01*145"]);
    expect(result.body).toEqual(["PAT*19*******"]);
    expect(blocked(result.manifest)).toEqual(rows("837/PAT[0]", [7, 8]));
  });

  it("a well-formed date of death and weight are kept, the date generalized", () => {
    const result = run("837", ["PAT*19****D8*20240105*01*165", "PAT*****D8*20240105"]);
    expect(result.body).toEqual(["PAT*19****D8*2024*01*165", "PAT*****D8*2024"]);
    expect(blocked(result.manifest)).toEqual([]);
  });
});

describe("STC keeps its status codes and payment method; every date and amount is removed", () => {
  // STC-01, -10 and -11 (status composites) and STC-07 (payment method) are codes from their lists.
  // Every other position is removed and recorded on its own, wherever its separators put it: an amount
  // cannot tell a shifted date from a number, and a date in the last position has nothing after it to
  // fail.
  it("a date in the last position after a separator left out between the amounts", () => {
    const cases: readonly (readonly [input: string, body: string, removed: number[]])[] = [
      ["STC*F2:88*20260126**150*0*20260128", "STC*F2:88*****", [2, 4, 5, 6]],
      ["STC*F2:88*20260126**1500*20260128", "STC*F2:88****", [2, 4, 5]],
      ["STC*F2:88*20260126**150*020260128", "STC*F2:88****", [2, 4, 5]],
      ["STC*A1:20*20260126**150150*20260130", "STC*A1:20****", [2, 4, 5]],
      ["STC*A1:20*20260126**150*150***20260130*CHK20250117", "STC*A1:20********", [2, 4, 5, 8, 9]],
    ];
    for (const [input, body, removed] of cases) {
      const result = run("277", [input]);
      for (const value of ["20260126", "20260128", "20260130", "20250117", "150"]) {
        expect(result.x12, input).not.toContain(`*${value}`);
      }
      expect(result.body, input).toEqual([body]);
      expect(blocked(result.manifest), input).toEqual(rows("277/STC[0]", removed));
      expect(result.residuals, input).toBe(0);
    }
  });

  it("a date shifted into an amount, the method or the check number", () => {
    const cases: readonly (readonly [input: string, body: string, removed: number[]])[] = [
      // (a) STC-03's empty slot left out: the method lands in STC-06, a date in STC-07.
      [
        "STC*F1:65*20260126*150*100*20260128*ACH*20260129*ZZCHECK02",
        "STC*F1:65*******",
        [2, 3, 4, 5, 6, 7, 8],
      ],
      // (b) one extra separator before STC-08: the check issue date lands in STC-09.
      [
        "STC*A1:20*20260126**150*150*20260130*CHK**20260131",
        "STC*A1:20******CHK**",
        [2, 4, 5, 6, 9],
      ],
      // An extra separator at STC-03: the adjudication date lands in STC-07.
      [
        "STC*A1:20*20260126***150*150*20260130*CHK*20260131*ZZCHECK01",
        "STC*A1:20*********",
        [2, 5, 6, 7, 8, 9, 10],
      ],
      // Two amounts run together: the adjudication date in STC-05, the check date in STC-07.
      [
        "STC*A1:20*20260126**150150*20260130*CHK*20260131*ZZCHECK01",
        "STC*A1:20*******",
        [2, 4, 5, 6, 7, 8],
      ],
      ["STC*A1:20*ZZNOTDATE**150*150*20260130", "STC*A1:20*****", [2, 4, 5, 6]],
      ["STC*A1:20*20260126**150*150*20260130***ZZCHECK01", "STC*A1:20********", [2, 4, 5, 6, 9]],
    ];
    for (const [input, body, removed] of cases) {
      const result = run("277", [input]);
      for (const value of ["2026012", "2026013", "ZZCHECK", "ZZNOTDATE", "150"]) {
        expect(result.x12, input).not.toContain(`*${value}`);
      }
      expect(result.body, input).toEqual([body]);
      expect(blocked(result.manifest), input).toEqual(rows("277/STC[0]", removed));
      expect(result.residuals, input).toBe(0);
    }
  });

  it("277: a well-formed status keeps its codes and payment method, and loses its dates and amounts", () => {
    const result = run("277", [
      "STC*A1:20*20260126**150*150*20260130*CHK*20260131*ZZCHECKOK",
      "STC*F1:65*20260126**150*150*20260130*ACH*20260131*ZZCHECKOK*F1:107*F1:101:PR",
      "STC*A2:20*20260126*WQ*150",
    ]);
    expect(result.body).toEqual([
      "STC*A1:20******CHK**",
      "STC*F1:65******ACH***F1:107*F1:101:PR",
      "STC*A2:20***",
    ]);
    expect(blocked(result.manifest)).toEqual([
      ...rows("277/STC[0]", [2, 4, 5, 6, 8, 9]),
      ...rows("277/STC[1]", [2, 4, 5, 6, 8, 9]),
      ...rows("277/STC[2]", [2, 3, 4]),
    ]);
    expect(result.residuals).toBe(0);
  });

  it("277CA: a well-formed status keeps its three composites, and loses its date, amount and message", () => {
    const result = run("277CA", [
      "STC*A1:19:PR*20260126*WQ*150",
      "STC*A3:21*20260126*U*150******A3:562:85*A3:128*ZZ FREE TEXT",
    ]);
    expect(result.body).toEqual(["STC*A1:19:PR***", "STC*A3:21*********A3:562:85*A3:128*"]);
    expect(blocked(result.manifest)).toEqual([
      ...rows("277/STC[0]", [2, 3, 4]),
      ...rows("277/STC[1]", [2, 3, 4, 12]),
    ]);
    expect(result.residuals).toBe(0);
  });

  it("a code that fails its list is removed with every value after it", () => {
    // A date in STC-07, the payment method: every value after STC-01 is removed.
    const result = run("277", ["STC*A1:20*20260126*****20260130*A2:20"]);
    expect(result.body).toEqual(["STC*A1:20*******"]);
    expect(blocked(result.manifest)).toEqual(rows("277/STC[0]", [2, 7, 8]));
  });
});

describe("every date the pass treats as the individual's, shifted by one separator, is removed", () => {
  /**
   * Well-formed segments, each with a date of the individual (`2025` dates). Each segment the pass
   * transforms such a date in appears once ending at its date, so a shift can move the date into the
   * last position, where nothing after it can fail: the date's format or qualifier code sits right
   * before it, so a separator left out puts the date in that code's place, and one added puts it in a
   * position that is a code, a date, or not kept. `STC` keeps no date or amount at all.
   */
  const SAMPLES: readonly (readonly [set: string, segment: string])[] = [
    ["837", "PAT*19****D8*20250117*01*145*Y"],
    ["837", "PAT*****D8*20250117*01*145"],
    ["837", "PAT*19****D8*20250117"],
    ["837", "PAT*****D8*20250117"],
    ["837", "DTP*472*D8*20250117"],
    ["837", "DTP*472*RD8*20250117-20250118"],
    ["837", "DMG*D8*20250117*F"],
    ["837", "DMG*D8*20250117"],
    ["837", "HI*BH:11:D8:20250117*BH:12:D8:20250118"],
    ["837", "HI*BI:70:RD8:20250117-20250118"],
    ["837", "HI*BH:11:D8:20250117"],
    ["835", "DTM*405*20250117"],
    ["834", "INS*Y*18*030*XN*A*E**FT*N*N*D8*20250117"],
    ["834", "INS*Y*18*030*XN*A*E**FT*N*N*D8*20250117*U"],
    ["277", "STC*A1:20*20250117**150*150*20250118*CHK*20250119*ZZCHECK01"],
    ["277", "STC*A1:20:PR*20250117*WQ*150"],
    ["277", "STC*A1:20*20250117"],
    ["277", "STC*F2:88*20250117**150*0*20250118"],
    ["277", "STC*A1:20*20250117**150*150*20250118*CHK*20250119"],
    ["277CA", "STC*A3:21*20250117*U*150******A3:562:85*A3:128*ZZ FREE TEXT"],
  ];

  /** Each one-separator change: one or two added, two values run together, one empty dropped. */
  function shifts(segment: string, separator: string): string[] {
    const parts = segment.split(separator);
    const out: string[] = [];
    for (let i = 1; i <= parts.length; i += 1) {
      out.push([...parts.slice(0, i), "", ...parts.slice(i)].join(separator));
      out.push([...parts.slice(0, i), "", "", ...parts.slice(i)].join(separator));
    }
    for (let i = 1; i < parts.length - 1; i += 1) {
      const merged = `${parts[i] ?? ""}${parts[i + 1] ?? ""}`;
      out.push([...parts.slice(0, i), merged, ...parts.slice(i + 2)].join(separator));
    }
    for (let i = 1; i < parts.length; i += 1) {
      if (parts[i] === "") out.push([...parts.slice(0, i), ...parts.slice(i + 1)].join(separator));
    }
    return out;
  }

  /** The same changes inside each composite element. */
  function componentShifts(segment: string): string[] {
    const elements = segment.split("*");
    return elements.flatMap((element, k) => {
      if (k === 0 || !element.includes(":")) return [];
      return shifts(`X:${element}`, ":").map((changed) => {
        const next = [...elements];
        next[k] = changed.slice(2);
        return next.join("*");
      });
    });
  }

  for (const [set, segment] of SAMPLES) {
    it(`${set} ${segment}`, () => {
      const changed = [...shifts(segment, "*"), ...componentShifts(segment)];
      expect(changed.length).toBeGreaterThan(5);
      for (const input of changed) {
        const result = run(set, [input]);
        for (const date of ["20250117", "20250118", "20250119"]) {
          expect(result.body.join("~"), input).not.toContain(date);
        }
        expect(result.residuals, input).toBe(0);
      }
    });
  }
});

describe("the positions a set's TR3 requires are read for that set", () => {
  it("270: INS-01, -02 and the birth sequence number INS-17 are kept", () => {
    const result = run("270", ["INS*Y*18***************1"]);
    expect(result.body).toEqual(["INS*Y*18***************1"]);
    expect(blocked(result.manifest)).toEqual([]);
  });

  it("271: INS-01 to -04 and INS-17 are kept", () => {
    const result = run("271", ["INS*Y*18*001*25*************1"]);
    expect(result.body).toEqual(["INS*Y*18*001*25*************1"]);
    expect(blocked(result.manifest)).toEqual([]);
  });

  it("278: INS-01, -02 and the birth sequence number INS-17 are kept (2010C and 2010D)", () => {
    const result = run("278", ["INS*Y*18***************1", "INS*N*19***************2"]);
    expect(result.body).toEqual(["INS*Y*18***************1", "INS*N*19***************2"]);
    expect(blocked(result.manifest)).toEqual([]);
  });

  it("834: INS-05 is still required, so a value after an empty one is removed", () => {
    const result = run("834", ["INS*Y*18*030*XN**E**FT*********1"]);
    expect(result.body).toEqual(["INS*Y*18*030*XN*************"]);
    expect(blocked(result.manifest)).toEqual(rows("834/INS[0]", [6, 8, 17]));
  });

  it("278: a service line with no charge keeps its unit and count", () => {
    const lines = ["SV1*HC:99213**UN*1", "SV2*0300*HC:80053**UN*1", "SV3*AD:D2391*****1"];
    const result = run("278", lines);
    expect(result.body).toEqual(lines);
    expect(blocked(result.manifest)).toEqual([]);
  });

  it("278: a unit still implies its count, and SV1-01 and SV3-01 are still required", () => {
    const result = run("278", ["SV1*HC:99213**UN**4455667701", "SV3**4455667701"]);
    expect(result.x12).not.toContain("4455667701");
    expect(blocked(result.manifest)).toEqual(["278/SV1[0]-5", "278/SV3[0]-2"]);
  });

  it("837: the same service lines with no charge are still a shift", () => {
    const result = run("837", ["SV1*HC:99213**UN*1", "SV3*AD:D2391*****1"]);
    expect(blocked(result.manifest)).toEqual(["837/SV1[0]-3", "837/SV1[0]-4", "837/SV3[0]-6"]);
  });

  it("the table: a set's own entry is read first, and the default otherwise", () => {
    const lookup = shapes.x12SegmentRequirements;
    for (const [set, entries] of Object.entries(shapes.X12_SEGMENT_REQUIREMENTS_BY_SET)) {
      for (const [segId, requirements] of Object.entries(entries)) {
        expect(lookup(segId, set)).toBe(requirements);
        expect(lookup(segId, "837")).toBe(shapes.X12_SEGMENT_REQUIREMENTS[segId]);
        expect(lookup(segId, "")).toBe(shapes.X12_SEGMENT_REQUIREMENTS[segId]);
      }
    }
    expect(lookup("INS", "834")).toBe(shapes.X12_SEGMENT_REQUIREMENTS["INS"]);
    expect(lookup("INS", "278")).toEqual({ required: [1, 2] });
    expect(lookup("DTP", "278")).toBeUndefined();
    expect(lookup("DTP", "837")).toBeUndefined();
  });
});

describe("the ISA is read at fixed byte positions, so no value in it is a shift", () => {
  it("an ISA date of the wrong shape is removed alone; the separators after it stay", () => {
    const raw =
      "ISA*00*          *00*          *ZZ*A              *ZZ*B              *ZZDATE*0930*^*00501*000000009*0*P*:~" +
      "GS*HC*A*B*20260615*0930*9*X*005010X222A1~ST*837*0009*005010X222A1~HI*ABK:J449~SE*3*0009~" +
      "GE*1*9~IEA*1*000000009~";
    const { x12, manifest } = deidentifyX12String(raw, { context: ctx });
    expect(x12).not.toContain("ZZDATE");
    expect(x12).toContain("*      *0930*^*00501*000000009*0*P*:~");
    expect(blocked(manifest)).toEqual(["ISA[0]-9"]);
  });
});
