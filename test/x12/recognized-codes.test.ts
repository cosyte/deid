/**
 * **X12: a real code is kept; what the pass cannot route behind it is removed.** A code position keeps
 * any code of its data element's complete 005010 list, exactly as written. When the code is one no
 * classifier routes on (a `REF` qualifier on neither `REF` table, an entity code on no role table, an
 * `HI` qualifier whose code shape the pass does not know), the code stays and only the value it
 * qualifies is removed and recorded. A value that is no code for the element is removed with it, which
 * keeps an identifier shifted into a code position from leaving.
 *
 * Each case is one a 005010 TR3 uses. Every value is a synthetic, ZZ-tagged sentinel.
 */

import { describe, expect, it } from "vitest";

import { createDeidContext, type DeidManifestEntry } from "../../src/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";

const ctx = createDeidContext({
  key: "x12-recognized-codes-synthetic-hmac-key",
  patientId: "p-x12-recognized-codes",
});

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000009*0*P*:~";

/** One body segment in a transaction set of `st01`: its output and the loci recorded. */
function one(
  st01: string,
  gs01: string,
  version: string,
  segment: string,
): { out: string; loci: string[]; residuals: number } {
  const raw =
    `${ISA}GS*${gs01}*A*B*20260615*0930*9*X*${version}~ST*${st01}*0009*${version}~` +
    `${segment}~SE*3*0009~GE*1*9~IEA*1*000000009~`;
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  const all = x12.split("~");
  const st = all.findIndex((s) => s.startsWith("ST*"));
  return {
    out: all[st + 1] ?? "",
    loci: manifest.map((e: DeidManifestEntry) => e.locus),
    residuals: unexaminedResiduals.length,
  };
}

const SETS = {
  "837": ["HC", "005010X222A1"],
  "835": ["HP", "005010X221A1"],
  "271": ["HB", "005010X279A1"],
  "278": ["HI", "005010X217"],
  "834": ["BE", "005010X220A1"],
  "277": ["HN", "005010X214"],
} as const;

const run = (st01: keyof typeof SETS, segment: string): ReturnType<typeof one> =>
  one(st01, SETS[st01][0], SETS[st01][1], segment);

describe("REF-01: a TR3 qualifier on neither REF table keeps its code; its value is removed", () => {
  const QUALIFIERS: readonly (readonly [keyof typeof SETS, string, string])[] = [
    ["837", "XZ", "2410 prescription number"],
    ["837", "VY", "2410 link sequence number"],
    ["837", "9B", "2400 repriced line item reference number"],
    ["837", "9D", "2400 adjusted repriced line item reference number"],
    ["835", "CE", "2100 class of contract code"],
    ["835", "E9", "2110 attachment code"],
    ["271", "18", "plan number"],
    ["271", "N6", "plan network identification number"],
    ["278", "NT", "administrator's reference number"],
    ["834", "17", "client reporting category"],
    ["834", "6O", "cross reference number"],
    ["834", "DX", "department or agency number"],
    ["834", "P5", "position code"],
    ["834", "QQ", "unit number"],
  ];
  for (const [st01, qualifier, use] of QUALIFIERS) {
    it(`${st01} REF*${qualifier} (${use})`, () => {
      const { out, loci, residuals } = run(st01, `REF*${qualifier}*ZZREFVALUE`);
      expect(out).toBe(`REF*${qualifier}*`);
      expect(loci).toEqual([`${st01}/REF[0]-2`]);
      expect(residuals).toBe(0);
    });
  }

  it("a value that is no qualifier at all still goes, with the value it would route", () => {
    const { out, loci } = run("837", "REF*Q0*ZZREFVALUE");
    expect(out).toBe("REF**");
    expect(loci).toEqual(["837/REF[0]-1", "837/REF[0]-2"]);
  });
});

describe("NM1-01: a TR3 entity code on no role table keeps its code; the party's identity goes", () => {
  it("837I 2310C other operating physician (ZZ)", () => {
    const { out, loci } = run("837", "NM1*ZZ*1*ZZOPLAST*ZZOPFIRST****XX*1999999999");
    expect(out).toBe("NM1*ZZ*1******XX*");
    expect(loci).toEqual(["837/NM1[0]-3", "837/NM1[0]-9"]);
  });
});

describe("AMT-01 and QTY-01 keep the 277CA codes", () => {
  for (const segment of ["AMT*YU*5000", "AMT*YY*150", "QTY*AA*1", "QTY*90*1"]) {
    it(segment, () => {
      const { out, loci } = run("277", segment);
      expect(out).toBe(segment);
      expect(loci).toEqual([]);
    });
  }
  it("a value that is no amount qualifier is removed", () => {
    expect(run("277", "AMT*ZZPATMEMBER*5000")).toMatchObject({
      out: "AMT**5000",
      loci: ["277/AMT[0]-1"],
    });
  });
});

describe("HI: a real code list qualifier with no code shape keeps its place; its code goes", () => {
  it("keeps the qualifier and the rest of the entry, and removes only the code", () => {
    // `JP` is a real code list qualifier (the tooth designation), which no HI code shape names.
    const { out, loci, residuals } = run("837", "HI*JP:ZZCODE*ABF:I10");
    expect(out).toBe("HI*JP:*ABF:I10");
    expect(loci).toEqual(["837/HI[0]-1-2"]);
    expect(residuals).toBe(0);
  });

  it("removes the whole entry when the qualifier is no code", () => {
    const { out, loci } = run("837", "HI*ZZQ:ZZCODE");
    expect(out).toBe("HI*");
    expect(loci).toEqual(["837/HI[0]-1"]);
  });

  it("keeps the 837I Advanced Billing Concepts principal procedure", () => {
    expect(run("837", "HI*CAH:AAAAB")).toMatchObject({ out: "HI*CAH:AAAAB", loci: [] });
  });
});

describe("PRV, OI, DN1 and DN2 keep their codes", () => {
  const KEPT: readonly (readonly [keyof typeof SETS, string])[] = [
    ["837", "PRV*BI*PXC*207Q00000X"],
    ["837", "PRV*PE*PXC*1223G0001X"],
    ["271", "PRV*RF*PXC*207Q00000X"],
    ["837", "OI***Y*P**Y"],
    ["837", "DN1*12*6**Y"],
    ["837", "DN2*12*M"],
    ["837", "DN2*A*E****JP"],
  ];
  for (const [st01, segment] of KEPT) {
    it(segment, () => {
      expect(run(st01, segment)).toMatchObject({ out: segment, loci: [], residuals: 0 });
    });
  }

  it("removes what is not a code or a taxonomy code", () => {
    expect(run("837", "PRV*BI*PXC*ZZPATMEMBER")).toMatchObject({
      out: "PRV*BI*PXC*",
      loci: ["837/PRV[0]-3"],
    });
    expect(run("837", "DN1*12*6**ZZPATNOTE")).toMatchObject({
      out: "DN1*12*6**",
      loci: ["837/DN1[0]-4"],
    });
    expect(run("837", "OI***ZZ")).toMatchObject({ out: "OI***", loci: ["837/OI[0]-3"] });
  });
});
