/**
 * **X12: a value shifted into an amount, quantity or count position is removed.** A number shape
 * cannot tell a shifted date or account number from an amount: `20260118` and `4455667701` are both
 * numbers. So the pass detects the shift instead of judging the value. Within a segment or a composite,
 * a position the TR3s require, or one a qualifier implies (a date format implies a date, a quantity
 * qualifier implies a quantity, the paired positions the X12 syntax notes name), cannot be empty while
 * a later position holds a value: an extra separator put that value there. Every value after the empty
 * position is removed and recorded, each with its own row. The positions before it are decided as
 * usual, and well-formed input keeps its amounts.
 *
 * Every value is a synthetic, ZZ-tagged sentinel, a synthetic date, or a synthetic number.
 */

import { describe, expect, it } from "vitest";

import { createDeidContext, type DeidManifestEntry } from "../../src/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";
import { X12_ELEMENT_SHAPES, X12_SEGMENT_REQUIREMENTS } from "../../src/x12/element-shapes.js";

const ctx = createDeidContext({
  key: "x12-shifted-numbers-synthetic-hmac-key",
  patientId: "p-x12-shifted-numbers",
});

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000009*0*P*:~";

/** The functional identifier and implementation guide of each transaction set the cases use. */
const SETS: Readonly<Record<string, readonly [gs01: string, version: string]>> = {
  "837": ["HC", "005010X223A2"],
  "835": ["HP", "005010X221A1"],
  "277": ["HN", "005010X214"],
  "271": ["HB", "005010X279A1"],
  "278": ["HI", "005010X217"],
  "834": ["BE", "005010X220A1"],
  "999": ["FA", "005010X231A1"],
};

/** Wrap body segments (no terminators) in one transaction set and run the pass. */
function run(
  st01: string,
  segments: readonly string[],
): { x12: string; body: string[]; manifest: readonly DeidManifestEntry[]; residuals: number } {
  const [gs01, version] = SETS[st01] ?? ["HC", "005010X222A1"];
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

describe("HI: a date shifted past its component lands in C022-05 or -06 and is removed", () => {
  const CASES: readonly (readonly [why: string, input: string, out: string, rows: string[]])[] = [
    [
      "an occurrence date one separator late (C022-04 empty after D8)",
      "HI*BH:11:D8::20260118",
      "HI*BH:11:D8::",
      ["837/HI[0]-1-5"],
    ],
    [
      "a principal procedure date one separator late",
      "HI*BBR:0DTJ0ZZ:D8::20260118",
      "HI*BBR:0DTJ0ZZ:D8::",
      ["837/HI[0]-1-5"],
    ],
    [
      "an occurrence span one separator late (C022-04 empty after RD8)",
      "HI*BI:70:RD8::20260101-20260103",
      "HI*BI:70:RD8::",
      ["837/HI[0]-1-5"],
    ],
    [
      "an occurrence span start alone, one separator late",
      "HI*BI:70:RD8::20260101",
      "HI*BI:70:RD8::",
      ["837/HI[0]-1-5"],
    ],
    [
      "the format one separator late too (C022-03 empty while C022-04 holds one)",
      "HI*BH:11::D8:20260118",
      "HI*BH:11:::",
      ["837/HI[0]-1-4", "837/HI[0]-1-5"],
    ],
    [
      "a date two separators late, in C022-06",
      "HI*BH:11:D8:::20260118",
      "HI*BH:11:D8:::",
      ["837/HI[0]-1-6"],
    ],
    [
      "a date in C022-05 under a qualifier that has no amount (only a value code does)",
      "HI*BH:11:::20260118",
      "HI*BH:11:::",
      ["837/HI[0]-1-5"],
    ],
    [
      "a value code's amount one separator late, in C022-06",
      "HI*BE:01::::4455667701",
      "HI*BE:01::::",
      ["837/HI[0]-1-6"],
    ],
    [
      "the second entry of the segment, its own row",
      "HI*BG:01*BH:11:D8::20260118",
      "HI*BG:01*BH:11:D8::",
      ["837/HI[0]-2-5"],
    ],
  ];
  for (const [why, input, out, rows] of CASES) {
    it(why, () => {
      const result = run("837", [input]);
      expect(result.body).toEqual([out]);
      expect(blocked(result.manifest)).toEqual(rows);
      expect(result.x12).not.toContain("20260118");
      expect(result.x12).not.toContain("4455667701");
      expect(result.residuals).toBe(0);
    });
  }

  it("well-formed entries keep their codes and amounts, and the date is generalized", () => {
    const result = run("837", [
      "HI*BE:80:::125.00*BE:01:::500:1*BG:01*BH:11:D8:20260118*BI:70:RD8:20260101-20260103",
      "HI*ABK:J449*ABF:E119:::::::Y",
    ]);
    expect(result.body).toEqual([
      "HI*BE:80:::125.00*BE:01:::500:1*BG:01*BH:11:D8:2026*BI:70:RD8:2026",
      "HI*ABK:J449*ABF:E119:::::::Y",
    ]);
    expect(blocked(result.manifest)).toEqual([]);
  });
});

describe("a required position left empty: every value after it is removed and recorded", () => {
  it("CLM: a numeric patient control number shifted into CLM-02 (CLM-01 empty)", () => {
    const result = run("837", ["CLM**4455667701*150***11:B:1*Y*A*Y*Y"]);
    expect(result.x12).not.toContain("4455667701");
    expect(result.body).toEqual(["CLM**********"]);
    expect(blocked(result.manifest)).toEqual([
      "837/CLM[0]-2",
      "837/CLM[0]-3",
      "837/CLM[0]-6",
      "837/CLM[0]-7",
      "837/CLM[0]-8",
      "837/CLM[0]-9",
      "837/CLM[0]-10",
    ]);
    expect(result.residuals).toBe(0);
  });

  it("CLM: an extra separator after CLM-01 empties CLM-02", () => {
    const result = run("837", ["CLM*ZZACCTSHIFT**4455667701***11:B:1*Y*A*Y*Y"]);
    expect(result.x12).not.toContain("4455667701");
    expect(result.x12).not.toContain("ZZACCTSHIFT");
    expect(blocked(result.manifest)).toEqual([
      "837/CLM[0]-3",
      "837/CLM[0]-6",
      "837/CLM[0]-7",
      "837/CLM[0]-8",
      "837/CLM[0]-9",
      "837/CLM[0]-10",
    ]);
  });

  it("CLP: a numeric patient control number two separators late, in CLP-03", () => {
    const result = run("835", ["CLP***4455667702*1*150*100**12*ZZCLAIMREF"]);
    expect(result.x12).not.toContain("4455667702");
    expect(result.body).toEqual(["CLP*********"]);
    expect(blocked(result.manifest)).toEqual([
      "835/CLP[0]-3",
      "835/CLP[0]-4",
      "835/CLP[0]-5",
      "835/CLP[0]-6",
      "835/CLP[0]-8",
      "835/CLP[0]-9",
    ]);
  });

  it("STC: a status date two separators late, in STC-04 (STC-01 empty)", () => {
    const result = run("277", ["STC***A1:20*20260126*WQ*150"]);
    expect(result.x12).not.toContain("20260126");
    expect(result.body).toEqual(["STC******"]);
    expect(blocked(result.manifest)).toEqual([
      "277/STC[0]-3",
      "277/STC[0]-4",
      "277/STC[0]-5",
      "277/STC[0]-6",
    ]);
  });

  it("STC: a status date two separators late, in STC-04 (STC-02 empty)", () => {
    const result = run("277", ["STC*A1:20***20260126"]);
    expect(result.x12).not.toContain("20260126");
    expect(result.body).toEqual(["STC*A1:20***"]);
    expect(blocked(result.manifest)).toEqual(["277/STC[0]-4"]);
  });

  // One case per segment whose number position follows a required position: the required position is
  // left empty and the number position holds a shifted value the number shape alone would keep.
  const SEGMENTS: readonly (readonly [st01: string, input: string, rows: string[]])[] = [
    ["837", "AMT**4455667701", ["837/AMT[0]-2"]],
    ["837", "QTY**4455667701", ["837/QTY[0]-2"]],
    ["835", "CAS*CO*45**4455667701", ["835/CAS[0]-4"]],
    ["835", "CAS*CO*45*10*1*96**4455667701", ["835/CAS[0]-7"]],
    ["835", "CAS*CO*45*10*1**4455667701", ["835/CAS[0]-6"]],
    ["835", "MIA**4455667701", ["835/MIA[0]-2"]],
    ["835", "SVC**4455667701", ["835/SVC[0]-2"]],
    ["835", "BPR**4455667701*C*ACH", ["835/BPR[0]-2", "835/BPR[0]-3", "835/BPR[0]-4"]],
    ["837", "LX**4455667701", ["837/LX[0]-2"]],
    ["837", "HL**4455667701*22*0", ["837/HL[0]-2", "837/HL[0]-3", "837/HL[0]-4"]],
    ["837", "SV1*HC:99213*100.00**4455667701", ["837/SV1[0]-4"]],
    ["837", "SV2**HC:99213*4455667701", ["837/SV2[0]-2", "837/SV2[0]-3"]],
    ["837", "SV3**4455667701", ["837/SV3[0]-2"]],
    ["837", "SV5*HC:E0100**4455667701", ["837/SV5[0]-3"]],
    ["837", "SVD**4455667701", ["837/SVD[0]-2"]],
    ["837", "CR1*LB***A*DH*4455667701", ["837/CR1[0]-4", "837/CR1[0]-5", "837/CR1[0]-6"]],
    ["837", "CR3*I**4455667701", ["837/CR3[0]-3"]],
    ["837", "HCP**4455667701", ["837/HCP[0]-2"]],
    ["837", "CN1**4455667701", ["837/CN1[0]-2"]],
    ["837", "PS1**4455667701", ["837/PS1[0]-2"]],
    ["837", "MEA*TR**4455667701", ["837/MEA[0]-3"]],
    ["837", "DN2**M*4455667701", ["837/DN2[0]-2", "837/DN2[0]-3"]],
    ["837", "PAT*19*******4455667701", ["837/PAT[0]-8"]],
    ["837", "PAT*19****D8***20250117", ["837/PAT[0]-8"]],
    ["278", "HSD*VS***4455667701", ["278/HSD[0]-4"]],
    ["271", "EB*1*IND*30*******4455667701", ["271/EB[0]-10"]],
    ["834", "INS*Y*18*030**A******D8******4455667701", ["834/INS[0]-17"]],
    ["834", "REL**4455667701", ["834/REL[0]-2"]],
    ["999", "AK1**445566770*005010X222A1", ["999/AK1[0]-2", "999/AK1[0]-3"]],
    ["999", "IK3**445566770", ["999/IK3[0]-2"]],
    ["999", "IK4**445566770*8", ["999/IK4[0]-2", "999/IK4[0]-3"]],
    ["999", "AK9*A**445566770*1", ["999/AK9[0]-3", "999/AK9[0]-4"]],
    ["999", "CTX**NM1*445566770", ["999/CTX[0]-2", "999/CTX[0]-3"]],
  ];
  for (const [st01, input, rows] of SEGMENTS) {
    it(`${input.slice(0, input.indexOf("*"))}: ${input}`, () => {
      const result = run(st01, [input]);
      expect(result.x12).not.toContain("445566770");
      expect(result.x12).not.toContain("20250117");
      expect(blocked(result.manifest)).toEqual(rows);
      expect(result.residuals).toBe(0);
    });
  }

  it("the envelope: a control number after an empty count in GE and IEA", () => {
    const raw =
      `${ISA}GS*HC*A*B*20260615*0930*9*X*005010X222A1~ST*837*0009*005010X222A1~` +
      `HI*ABK:J449~SE*3*0009~GE**445566770~IEA**445566770~`;
    const { x12, manifest } = deidentifyX12String(raw, { context: ctx });
    expect(x12).not.toContain("445566770");
    expect(blocked(manifest)).toEqual(["GE[0]-2", "IEA[0]-2"]);
  });

  it("every segment the table names: an empty first required position takes every later value", () => {
    for (const [segId, requirements] of Object.entries(X12_SEGMENT_REQUIREMENTS)) {
      const first = requirements.required?.[0];
      // The envelope segments are not body segments; the envelope case above covers them.
      if (first === undefined || ["ISA", "TA1", "GS", "GE", "IEA", "ST", "SE"].includes(segId)) {
        continue;
      }
      const last = Math.max(...Object.keys(X12_ELEMENT_SHAPES[segId] ?? {}).map(Number));
      const elements = Array.from({ length: last }, (_, i) => (i + 1 > first ? "445566770" : ""));
      const result = run("837", [`${segId}*${elements.join("*")}`]);
      expect(result.x12, segId).not.toContain("445566770");
      expect(blocked(result.manifest), segId).toEqual(
        elements.flatMap((_, i) => (i + 1 > first ? [`837/${segId}[0]-${String(i + 1)}`] : [])),
      );
    }
  });
});

describe("well-formed input keeps its amounts, quantities and counts", () => {
  it("claim, remittance and benefit segments are byte-identical with no blocked row", () => {
    const claim = [
      "CLM*ZZACCTOK*150.00***11:B:1*Y*A*Y*Y",
      "AMT*F5*25.00",
      "PAT*19****D8*20260104*01*165",
      "LX*1",
      "SV1*HC:99213:25*100.00*UN*1***1:2",
      "SV2*0450*HC:99283*500.00*UN*1",
      "CR1*LB*165**A*DH*12",
      "CR3*I*MO*6",
      "HCP*00*100.00*80.00",
      "MEA*TR*R1*12.5",
      "QTY*PT*2",
    ];
    const result = run("837", claim);
    // CLM-01 is the patient account number, transformed; the rest is byte-identical.
    expect(result.body.slice(1)).toEqual(
      claim.slice(1).map((s) => s.replace("D8*20260104", "D8*2026")),
    );
    expect(result.body[0]).toMatch(/^CLM\*[^*]*\*150\.00\*\*\*11:B:1\*Y\*A\*Y\*Y$/);
    expect(blocked(result.manifest)).toEqual([]);

    const remit = [
      "CLP*ZZACCTOK*1*150*100**12*ZZCLAIMREF",
      "CAS*CO*45*50*1",
      "SVC*HC:99213*150*100",
    ];
    const r835 = run("835", remit);
    expect(r835.body.slice(1)).toEqual(remit.slice(1));
    expect(blocked(r835.manifest)).toEqual([]);

    // STC keeps no amount or date at all (see shifted-dates.test.ts): only its status composite.
    const status = run("277", ["STC*A1:20*20260126*WQ*150"]);
    expect(status.body).toEqual(["STC*A1:20***"]);
    expect(blocked(status.manifest)).toEqual(["277/STC[0]-2", "277/STC[0]-3", "277/STC[0]-4"]);

    const benefit = ["EB*1*IND*30******VS*30"];
    expect(run("271", benefit).body).toEqual(benefit);
  });
});
