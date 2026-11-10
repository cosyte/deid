/**
 * **X12 element shapes, position by position.** Each row is one segment: the value a position keeps,
 * and a value of the wrong shape that the position must remove and record. The kept row is the
 * over-scrub control for the removed one, so a shape that refuses everything fails here as surely as a
 * shape that accepts everything.
 *
 * Every value is a synthetic code, amount or date, or a ZZ-tagged sentinel.
 */

import { describe, expect, it } from "vitest";

import { createDeidContext, type DeidManifestEntry } from "../../src/index.js";
import { isX12DateInFormat } from "../../src/x12/element-shapes.js";
import { deidentifyX12String } from "../../src/x12/index.js";

const ctx = createDeidContext({
  key: "x12-element-shapes-synthetic-hmac-key",
  patientId: "p-x12-element-shapes",
});

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000007*0*P*:~";

function wrap(body: string): string {
  return `${ISA}GS*HC*A*B*20260615*0930*7*X*005010X222A2~ST*837*0007~${body}SE*3*0007~GE*1*7~IEA*1*000000007~`;
}

/** The one body segment's output and the loci the pass blocked. */
function one(segment: string): { out: string; blocked: string[] } {
  const { x12, manifest } = deidentifyX12String(wrap(segment), { context: ctx });
  const all = x12.split("~");
  const st = all.findIndex((s) => s.startsWith("ST*"));
  return {
    out: `${all[st + 1] ?? ""}~`,
    blocked: manifest
      .filter((e: DeidManifestEntry) => e.disposition === "blocked")
      .map((e) => e.locus.replace(/^837\//, "")),
  };
}

describe("isX12DateInFormat", () => {
  it("reads D8, RD8 and DT, and nothing else, as a date format", () => {
    expect(isX12DateInFormat("20240229", "D8")).toBe(true);
    expect(isX12DateInFormat("20230229", "D8")).toBe(false);
    expect(isX12DateInFormat("20261301", "D8")).toBe(false);
    expect(isX12DateInFormat("20260100", "D8")).toBe(false);
    expect(isX12DateInFormat("2026010", "D8")).toBe(false);
    expect(isX12DateInFormat("20260101-20260105", "RD8")).toBe(true);
    expect(isX12DateInFormat("20260101", "RD8")).toBe(false);
    expect(isX12DateInFormat("20260101-20260105-20260106", "RD8")).toBe(false);
    expect(isX12DateInFormat("20260101-ZZEND", "RD8")).toBe(false);
    expect(isX12DateInFormat("202601011230", "DT")).toBe(true);
    expect(isX12DateInFormat("202601012460", "DT")).toBe(false);
    expect(isX12DateInFormat("20260101123", "DT")).toBe(false);
    expect(isX12DateInFormat("1130", "TM")).toBe(false);
    expect(isX12DateInFormat("20260101", "")).toBe(false);
    expect(isX12DateInFormat("20260101", "d8")).toBe(false);
  });
});

/** `[kept segment, segment with one wrong value, the position that value must be removed from]`. */
const CASES: readonly (readonly [string, string, string])[] = [
  // Procedure composites: the code is shaped by the qualifier in front of it.
  ["SV1*HC:99213*100.00~", "SV1*HC:ZZPATID*100.00~", "SV1[0]-1"],
  ["SV3*AD:D0120*50.00~", "SV3*AD:0120*50.00~", "SV3[0]-1"],
  ["SV5*HC:E0100*DA*1~", "SV5*HC:E0100*A0*1~", "SV5[0]-2"],
  ["SVC*N4:12345678901*10.00*8.00~", "SVC*N4:1234*10.00*8.00~", "SVC[0]-1"],
  ["SV2*0450*NU:0450*10.00~", "SV2*0450*NU:045*10.00~", "SV2[0]-2"],
  ["SV2*0023*HP:ABC12*10.00~", "SV2*0023*HP:ABC1*10.00~", "SV2[0]-2"],
  ["SV2*0450*ER:ZZ01*10.00~", "SV2*0450*ER:zz01*10.00~", "SV2[0]-2"],
  ["SV2*0450*HC:99213*10.00~", "SV2*ZZREV*HC:99213*10.00~", "SV2[0]-1"],
  ["SV1*HC:99213:25*100.00~", "SV1*HC:99213:ZZMOD*100.00~", "SV1[0]-1"],
  ["SV1*HC:99213*100.00*UN*1***1:2:3:4~", "SV1*HC:99213*100.00*UN*1***1:13~", "SV1[0]-7"],
  ["SV1*HC:99213*100.00~", "SV1*XX:99213*100.00~", "SV1[0]-1"],
  // HI: the code is shaped by its qualifier; an unknown qualifier, or an extra component, is removed.
  ["HI*ABK:E1165~", "HI*ZZQ:E1165~", "HI[0]-1"],
  ["HI*BK:25000~", "HI*BK:ZZ250~", "HI[0]-1"],
  ["HI*BBR:0DTJ4ZZ~", "HI*BBR:0DTJ4ZZ:::::::Y:ZZ~", "HI[0]-1"],
  ["HI*DR:470~", "HI*DR:ZZDRG~", "HI[0]-1"],
  ["HI*BE:80:::125.00~", "HI*BE:80:::ZZAMT~", "HI[0]-1"],
  ["HI*ABF:E119:::::::Y~", "HI*ABF:E119:::::::Q~", "HI[0]-1"],
  ["HI*ABF:E119~", "HI*ABF:E119:::::ZZV~", "HI[0]-1"],
  // Dates, times, numbers, references and repeating elements.
  ["BHT*0019*00*REF01*20260615*093015*CH~", "BHT*0019*00*REF01*20260615*0961*CH~", "BHT[0]-5"],
  ["BHT*0019*00*REF01*20260615*0930*CH~", "BHT*0019*00*   *20260615*0930*CH~", "BHT[0]-3"],
  ["AMT*F5*.50~", "AMT*F5*1e5~", "AMT[0]-2"],
  ["AMT*F5*-12.5~", "AMT*F5*1234567890123456789~", "AMT[0]-2"],
  ["LX*12~", "LX*1.5~", "LX[0]-1"],
  ["EB*1*IND*30^1^33*HM~", "EB*1*IND*30^ZZPATID*HM~", "EB[0]-3"],
  ["CAS*CO*45*10.00*1*A1*2.00~", "CAS*CO*ZZ45*10.00~", "CAS[0]-2"],
  ["MOA***MA01*N123~", "MOA***ZZREMARK~", "MOA[0]-3"],
  ["MIA*1*10.00****5.00~", "MIA*1*10.00***ZZRARC~", "MIA[0]-5"],
  ["TOO*JP*3*M:O~", "TOO*JP*ZZTOOTH~", "TOO[0]-2"],
  ["CTP****2*UN~", "CTP****2*A0~", "CTP[0]-5"],
  ["LIN**N4*12345678901~", "LIN**N4*ZZ NDC~", "LIN[0]-3"],
  ["INS*Y*18*001*25~", "INS*Y*18*ZZINS~", "INS[0]-3"],
  ["AK9*A*1*1*1~", "AK9*A*1*ZZ*1~", "AK9[0]-3"],
  // A 999 loop id: four characters, or a TR3 loop id with its letters, as `@cosyte/x12` emits it.
  ["IK3*NM1*8*2010BA*8~", "IK3*NM1*8*ZZ2010BAX*8~", "IK3[0]-3"],
  ["IK5*A~", "IK5*ZZ~", "IK5[0]-1"],
];

describe("each position keeps a value of its shape and removes any other", () => {
  for (const [kept, wrong, position] of CASES) {
    it(`${position}: keeps \`${kept}\`, removes the wrong value in \`${wrong}\``, () => {
      const good = one(kept);
      expect(good.out).toBe(kept);
      expect(good.blocked).toEqual([]);
      const bad = one(wrong);
      expect(bad.blocked).toContain(position);
    });
  }

  // CLM-01 is the patient account number, which the pass transforms, so these compare the output with
  // it removed. CLM-01 cannot be empty here: it is required, and an empty one before a value is a shift.
  it("CLM composites: too many components removes the composite, the claim's codes stay", () => {
    const CLAIM: readonly (readonly [
      kept: string,
      out: string,
      wrong: string,
      position: string,
    ])[] = [
      [
        "CLM*ZZACCTES*1.00***11:B:1~",
        "CLM**1.00***11:B:1~",
        "CLM*ZZACCTES*1.00***11:B:1:ZZ~",
        "CLM[0]-5",
      ],
      [
        "CLM*ZZACCTES*1.00***11:B:1*Y*A*Y*Y**AA:::OH:US~",
        "CLM**1.00***11:B:1*Y*A*Y*Y**AA:::OH:US~",
        "CLM*ZZACCTES*1.00***11:B:1*Y*A*Y*Y**AA:::ZZ:US~",
        "CLM[0]-11",
      ],
    ];
    for (const [kept, out, wrong, position] of CLAIM) {
      const good = one(kept);
      expect(good.out).toBe(out);
      expect(good.blocked).toEqual([]);
      expect(one(wrong).blocked).toEqual([position]);
    }
  });

  it("a date component that is no date in its declared format is removed at that component", () => {
    const bad = one("HI*BH:11:D8:20261399~");
    expect(bad.out).toBe("HI*BH:11:D8:~");
    expect(bad.blocked).toEqual(["HI[0]-1-4"]);
  });

  it("an INS date of death is generalized in the INS-11 format", () => {
    const { out } = one("INS*Y*18*001*25*A******D8*20260104~");
    expect(out).toBe("INS*Y*18*001*25*A******D8*2026~");
  });
});
