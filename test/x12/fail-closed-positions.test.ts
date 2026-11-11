/**
 * **X12: every position the output carries is decided.** A position a locus rule acts on is
 * transformed. Every other position keeps a value only when it has the shape the position expects: a
 * code the position knows, a valid date in the format the segment declares, a number, a bounded
 * administrative reference. A value of any other shape, and a value at a position no rule names, is
 * removed and recorded as a blocked row at its own position.
 *
 * The cases are the ways a value lands where it does not belong: a missing element separator shifts an
 * identifier left into a code or date position, an extra one shifts it right past the last position a
 * rule names, and a segment can sit outside every transaction set. The controls are the other half:
 * recognized codes, dates and amounts on well-formed input keep their output.
 *
 * Every value is a synthetic, ZZ-tagged sentinel, a reserved 555 telephone number, or a synthetic date.
 */

import { describe, expect, it } from "vitest";
import { parseX12 } from "@cosyte/x12";

import { createDeidContext, type DeidManifestEntry } from "../../src/index.js";
import { deidentifyX12String } from "../../src/x12/index.js";

const ctx = createDeidContext({
  key: "x12-fail-closed-synthetic-hmac-key",
  patientId: "p-x12-fail-closed",
});

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000006*0*P*:~";
const GS = "GS*HC*A*B*20260615*0930*6*X*005010X222A2~";

/** Wrap one transaction body in an 837 interchange, with an optional segment between `GS` and `ST`. */
function wrap(body: string, segments: number, beforeSt = ""): string {
  return `${ISA}${GS}${beforeSt}ST*837*0006~${body}SE*${String(segments)}*0006~GE*1*6~IEA*1*000000006~`;
}

/** The body segments of the one transaction set, without the envelope, each with its terminator. */
function body(x12: string): string[] {
  const all = x12.split("~");
  const st = all.findIndex((s) => s.startsWith("ST*"));
  const se = all.findIndex((s) => s.startsWith("SE*"));
  return all.slice(st + 1, se).map((segment) => `${segment}~`);
}

function run(raw: string): {
  x12: string;
  manifest: readonly DeidManifestEntry[];
  residuals: readonly string[];
} {
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  return { x12, manifest, residuals: unexaminedResiduals.map((r) => r.locus) };
}

/** `true` when the manifest records a fail-closed block at exactly this position. */
function blockedAt(manifest: readonly DeidManifestEntry[], locus: string): boolean {
  return manifest.some((e) => e.locus === locus && e.disposition === "blocked");
}

describe("a code or date position the rules keep accepts only a value of its shape", () => {
  it("DMG: a date of birth shifted into DMG-01 is removed, and DMG-02 is no date in a declared format", () => {
    const { x12, manifest, residuals } = run(wrap("DMG*19800101*F~", 3));
    expect(x12).not.toContain("19800101");
    expect(body(x12)).toEqual(["DMG**~"]);
    expect(blockedAt(manifest, "837/DMG[0]-1")).toBe(true);
    expect(blockedAt(manifest, "837/DMG[0]-2")).toBe(true);
    expect(residuals).toEqual([]);
    // Recorded in element order.
    expect(manifest.map((e) => e.locus)).toEqual(["837/DMG[0]-1", "837/DMG[0]-2"]);
  });

  it("DTP: a service date shifted into the format position is removed", () => {
    const { x12, manifest } = run(wrap("DTP*472*20260101~", 3));
    expect(x12).not.toContain("20260101");
    expect(body(x12)).toEqual(["DTP*472*~"]);
    expect(blockedAt(manifest, "837/DTP[0]-2")).toBe(true);
  });

  it("DTP: a date that is not valid in the declared format is removed, not cut to its front", () => {
    for (const bad of ["ZZ2026DATE", "20261341", "2026010", "20260101-ZZEND"]) {
      const { x12, manifest } = run(wrap(`DTP*472*D8*${bad}~`, 3));
      expect(x12).not.toContain(bad);
      expect(blockedAt(manifest, "837/DTP[0]-3")).toBe(true);
    }
    // A time of day declares no date, so there is no year to keep and the value is removed.
    const time = run(wrap("DTP*096*TM*1130~", 3));
    expect(body(time.x12)).toEqual(["DTP*096*TM*~"]);
    expect(blockedAt(time.manifest, "837/DTP[0]-3")).toBe(true);
  });

  it("DTM: a date shifted into the qualifier position is removed", () => {
    const { x12, manifest } = run(wrap("DTM*20260102~", 3));
    expect(x12).not.toContain("20260102");
    expect(blockedAt(manifest, "837/DTM[0]-1")).toBe(true);
  });

  it("PER: a telephone number shifted into a qualifier position is removed", () => {
    const { x12, manifest } = run(wrap("PER*IC*ZZCONTACT*5559876543~", 3));
    expect(x12).not.toContain("5559876543");
    expect(x12).not.toContain("ZZCONTACT");
    expect(body(x12)).toEqual(["PER*IC**~"]);
    expect(blockedAt(manifest, "837/PER[0]-3")).toBe(true);
  });

  it("SBR: a group number shifted into the relationship position is removed", () => {
    const { x12, manifest } = run(wrap("SBR*P*ZZGROUPNUM~", 3));
    expect(x12).not.toContain("ZZGROUPNUM");
    expect(body(x12)).toEqual(["SBR*P*~"]);
    expect(blockedAt(manifest, "837/SBR[0]-2")).toBe(true);
  });

  it("HI: an identifier where a diagnosis code belongs is removed with its entry and every entry after it", () => {
    // HI-01 is required, so a value there that fails its shape marks a shift: what follows is removed.
    const { x12, manifest } = run(wrap("HI*ABK:ZZHIMEMBER*ABF:E119~", 3));
    expect(x12).not.toContain("ZZHIMEMBER");
    expect(body(x12)).toEqual(["HI**~"]);
    expect(blockedAt(manifest, "837/HI[0]-1")).toBe(true);
    expect(blockedAt(manifest, "837/HI[0]-2")).toBe(true);
  });

  it("HI: an occurrence date is a date of the individual's care, generalized at its own component", () => {
    const { x12, manifest } = run(wrap("HI*BH:11:D8:20260103~", 3));
    expect(x12).not.toContain("20260103");
    expect(body(x12)).toEqual(["HI*BH:11:D8:2026~"]);
    expect(manifest.some((e) => e.locus === "837/HI[0]-1-4")).toBe(true);
  });

  it("CLM: an identifier in a coded or composite position is removed, the claim's codes stay", () => {
    const { x12, manifest } = run(wrap("CLM*ZZACCTFC*100.00***11:B:1*Y*A*Y*Y*P*ZZCLM11~", 3));
    expect(x12).not.toContain("ZZCLM11");
    expect(x12).not.toContain("ZZACCTFC");
    expect(body(x12)[0]).toMatch(/^CLM\*\*100\.00\*\*\*11:B:1\*Y\*A\*Y\*Y\*P\*~$/);
    expect(blockedAt(manifest, "837/CLM[0]-11")).toBe(true);
  });

  it("SV1: a free-text description component is removed, the procedure code beside it stays", () => {
    const { x12, manifest } = run(wrap("SV1*HC:99213:25::::ZZSV1DESC*100.00*UN*1***1:2~", 3));
    expect(x12).not.toContain("ZZSV1DESC");
    expect(body(x12)).toEqual(["SV1*HC:99213:25::::*100.00*UN*1***1:2~"]);
    expect(blockedAt(manifest, "837/SV1[0]-1-7")).toBe(true);
  });

  it("PAT: a date of death is generalized, and only when it is a date in the declared format", () => {
    const valid = run(wrap("PAT*19****D8*20260104~", 3));
    expect(valid.x12).not.toContain("20260104");
    expect(body(valid.x12)).toEqual(["PAT*19****D8*2026~"]);
    const shifted = run(wrap("PAT*19****20260104~", 3));
    expect(shifted.x12).not.toContain("20260104");
    expect(blockedAt(shifted.manifest, "837/PAT[0]-5")).toBe(true);
  });

  it("a 999 copy of a bad data element, and a business unit value, never leave", () => {
    const { x12, manifest } = run(wrap("IK4*2**7*ZZBADCOPY~CTX*CLM01:ZZACCT999~", 4));
    expect(x12).not.toContain("ZZBADCOPY");
    expect(x12).not.toContain("ZZACCT999");
    expect(body(x12)).toEqual(["IK4*2**7*~", "CTX*CLM01:~"]);
    expect(blockedAt(manifest, "837/IK4[0]-4")).toBe(true);
    expect(blockedAt(manifest, "837/CTX[0]-1-2")).toBe(true);
  });
});

describe("an element no rule names is removed and recorded", () => {
  it("NM1-02: a patient last name shifted into the entity type qualifier", () => {
    const { x12, manifest, residuals } = run(
      wrap("NM1*QC*ZZPATLAST*ZZPATFIRST****MI*ZZPATMEMBER~", 3),
    );
    for (const value of ["ZZPATLAST", "ZZPATFIRST", "ZZPATMEMBER"])
      expect(x12).not.toContain(value);
    expect(body(x12)).toEqual(["NM1*QC*******~"]);
    expect(blockedAt(manifest, "837/NM1[0]-2")).toBe(true);
    expect(residuals).toEqual([]);
  });

  it("NM1-10: a member id shifted right by one extra separator", () => {
    const { x12, manifest } = run(wrap("NM1*QC*1*ZZPATLAST*ZZPATFIRST*****MI*ZZPATMEMBER~", 3));
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(body(x12)).toEqual(["NM1*QC*1********~"]);
    expect(blockedAt(manifest, "837/NM1[0]-10")).toBe(true);
  });

  it("N1-05: a member id shifted right past the identifier", () => {
    const { x12, manifest } = run(wrap("N1*IL*ZZSUBNAME**MI*ZZPATMEMBER~", 3));
    expect(x12).not.toContain("ZZPATMEMBER");
    expect(x12).not.toContain("ZZSUBNAME");
    expect(blockedAt(manifest, "837/N1[0]-5")).toBe(true);
  });

  it("N1: an unknown party with no name records the identifier it carries, and nothing for the name", () => {
    // `A0` is no entity identifier code (element 98), so the code goes too.
    const { x12, manifest } = run(wrap("N1*A0**PI*ZZN1UNKNOWNID~", 3));
    expect(x12).not.toContain("ZZN1UNKNOWNID");
    expect(body(x12)).toEqual(["N1***PI*~"]);
    expect(manifest.map((e) => e.locus)).toEqual(["837/N1[0]-1", "837/N1[0]-4"]);
  });

  it("REF-03: a name shifted right past the reference, on a reference the rules keep", () => {
    const { x12, manifest } = run(wrap("REF*F8*ZZCLAIMCTRL*ZZPATNAME~", 3));
    expect(x12).not.toContain("ZZPATNAME");
    expect(body(x12)).toEqual(["REF*F8*ZZCLAIMCTRL*~"]);
    expect(blockedAt(manifest, "837/REF[0]-3")).toBe(true);
  });

  it("an element past the last one a retained segment's shape names", () => {
    const { x12, manifest } = run(wrap("HL*1**20*1*ZZHLEXTRA~", 3));
    expect(x12).not.toContain("ZZHLEXTRA");
    expect(body(x12)).toEqual(["HL*1**20*1*~"]);
    expect(blockedAt(manifest, "837/HL[0]-5")).toBe(true);
  });

  it("a whitespace-only element outside the fixed-width ISA is a value, and is decided", () => {
    const { x12, manifest } = run(wrap("NTE*ADD*ZZNOTE*   *ZZTAIL~", 3));
    expect(x12).not.toContain("ZZTAIL");
    expect(body(x12)).toEqual(["NTE*ADD***~"]);
    expect(blockedAt(manifest, "837/NTE[0]-3")).toBe(true);
    expect(blockedAt(manifest, "837/NTE[0]-4")).toBe(true);
  });
});

describe("the envelope and a segment outside every transaction set", () => {
  it("a segment between GS and ST is removed whole and recorded under `orphan`", () => {
    const raw = wrap("HI*ABK:E1165~", 3, "NM1*QC*1*ZZORPHANLAST*ZZORPHANFIRST~");
    expect(parseX12(raw).orphanSegments).toHaveLength(1);
    const { x12, manifest, residuals } = run(raw);
    expect(x12).not.toContain("ZZORPHANLAST");
    expect(x12).not.toContain("ZZORPHANFIRST");
    // Nothing of it is re-emitted, its identifier included.
    expect(x12).toContain(`${GS}ST*837*0006~`);
    for (const element of [0, 1, 2, 3, 4]) {
      expect(blockedAt(manifest, `orphan/NM1[0]-${String(element)}`)).toBe(true);
    }
    expect(residuals).toEqual([]);
  });

  it("an envelope element of the wrong shape is removed from the envelope and recorded", () => {
    // GS-04 is a required date: a value there that is no date marks a shift. GS-01 is the last code
    // before it that held, so the sender and receiver ids between them go too, with what follows.
    const raw = wrap("HI*ABK:E1165~", 3).replace("GS*HC*A*B*20260615*", "GS*HC*A*B*ZZGSDATE*");
    const { x12, manifest } = run(raw);
    expect(x12).not.toContain("ZZGSDATE");
    expect(x12).toContain("GS*HC*******~");
    for (const element of [2, 3, 4, 5, 6, 7, 8]) {
      expect(blockedAt(manifest, `GS[0]-${String(element)}`)).toBe(true);
    }
  });

  it("a removed ISA element is written as blanks of its own width, so the header keeps 106 bytes", () => {
    const raw = wrap("HI*ABK:E1165~", 3).replace("*260615*0930*", "*ZZDATE*0930*");
    // The parser reads the ISA at fixed positions, so the sentinel has to keep the element's width.
    const isa = raw.slice(0, raw.indexOf("~") + 1);
    expect(isa).toHaveLength(106);
    const { x12, manifest } = run(raw);
    expect(x12).not.toContain("ZZDATE");
    expect(x12.slice(0, x12.indexOf("~") + 1)).toHaveLength(106);
    expect(x12).toContain("*      *0930*");
    expect(blockedAt(manifest, "ISA[0]-9")).toBe(true);
    // The output still parses as an interchange.
    expect(parseX12(x12).groups).toHaveLength(1);
  });

  it("a TA1 and a second group are decided like any other envelope segment", () => {
    const raw = [
      "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000009*0*P*:",
      "TA1*000000008*ZZTA1D*1200*A*000",
      "GS*HC*A*B*20260615*0930*11*X*005010X222A2",
      "ST*837*0001",
      "BHT*0019*00*REF01*20260615*0930*CH",
      "SE*3*0001",
      "GE*1*11*ZZGEEXTRA",
      "IEA*1*000000009",
      "",
    ].join("~");
    const { x12, manifest } = run(raw);
    expect(x12).not.toContain("ZZTA1D");
    expect(x12).not.toContain("ZZGEEXTRA");
    // TA1-02 is a required date: a value there that is no date marks a shift. No code or date before
    // it held, so the control number before it goes too.
    expect(x12).toContain("TA1*****~");
    expect(x12).toContain("GE*1*11*~");
    for (const element of [1, 2, 3, 4, 5]) {
      expect(blockedAt(manifest, `TA1[0]-${String(element)}`)).toBe(true);
    }
    expect(blockedAt(manifest, "GE[0]-3")).toBe(true);
  });

  it("bytes after the IEA, here a whole second interchange, are removed and recorded", () => {
    const first = wrap("HI*ABK:E1165~", 3);
    const second = wrap("NM1*QC*1*ZZSECONDLAST*ZZSECONDFIRST~", 3);
    const parsed = parseX12(first + second);
    expect(parsed.trailingBytes).toContain("ZZSECONDLAST");
    const { x12, manifest } = run(first + second);
    expect(x12).not.toContain("ZZSECONDLAST");
    expect(x12).toBe(first);
    expect(blockedAt(manifest, "trailingBytes")).toBe(true);
  });

  it("blank bytes after the IEA carry no value: kept, and no row", () => {
    const raw = `${wrap("HI*ABK:E1165~", 3)}  ~`;
    expect(parseX12(raw).trailingBytes).toBe("  ~");
    const { x12, manifest } = run(raw);
    expect(x12.endsWith("IEA*1*000000006~  ~")).toBe(true);
    expect(manifest).toEqual([]);
  });

  it("an unknown transaction set id and an unknown control number shape are removed", () => {
    const raw = wrap("HI*ABK:E1165~", 3)
      .replace("ST*837*0006~", "ST*837*ZZ-CTRL~")
      .replace("SE*3*0006~", "SE*3*ZZ-CTRL~");
    const { x12, manifest } = run(raw);
    expect(x12).not.toContain("ZZ-CTRL");
    expect(blockedAt(manifest, "837/ST[0]-2")).toBe(true);
    expect(blockedAt(manifest, "837/SE[0]-2")).toBe(true);
  });
});

describe("recognized codes, dates and amounts on well-formed input keep their output", () => {
  it("keeps every coded, dated and numeric position of a well-formed claim", () => {
    const segments = [
      "BHT*0019*00*REF01*20260615*0930*CH~",
      "HL*1**20*1~",
      "NM1*85*2*ZZBILLINGORG*****XX*1999999999~",
      "HL*2*1*22*0~",
      "SBR*P*18*******CI~",
      "DMG*D8*19850302*M~",
      "PER*IC**TE*~",
      "PAT*19~",
      "CLM*ZZACCT*100.00***11:B:1*Y*A*Y*Y~",
      "AMT*F5*20.00~",
      "HI*ABK:E1165*ABF:I10*BG:01~",
      "LX*1~",
      "SV1*HC:99213:25*100.00*UN*1*11**1:2~",
      "DTP*472*RD8*20260601-20260602~",
      "CAS*CO*45*10.00**2*5.00~",
      "QTY*PT*1~",
      "NTE*ADD~",
    ];
    const { x12, manifest, residuals } = run(wrap(segments.join(""), segments.length + 2));
    const out = body(x12);
    // The positions a locus rule transforms move as before; every other position is byte-identical.
    expect(out).toEqual([
      "BHT*0019*00*REF01*20260615*0930*CH~",
      "HL*1**20*1~",
      "NM1*85*2*ZZBILLINGORG*****XX*1999999999~",
      "HL*2*1*22*0~",
      "SBR*P*18*******CI~",
      "DMG*D8*1985*M~",
      "PER*IC**TE*~",
      "PAT*19~",
      expect.stringMatching(/^CLM\*\*100\.00\*\*\*11:B:1\*Y\*A\*Y\*Y~$/),
      "AMT*F5*20.00~",
      "HI*ABK:E1165*ABF:I10*BG:01~",
      "LX*1~",
      "SV1*HC:99213:25*100.00*UN*1*11**1:2~",
      "DTP*472*RD8*2026~",
      "CAS*CO*45*10.00**2*5.00~",
      "QTY*PT*1~",
      "NTE*ADD~",
    ]);
    expect(manifest.filter((e) => e.disposition === "blocked")).toEqual([]);
    expect(residuals).toEqual([]);
  });

  it("keeps a well-formed 835 remittance and a 271 benefit line", () => {
    const segments = [
      "BPR*I*100.00*C*ACH*CCP*01*999999999*DA*123456*1999999999**01*999999999*DA*654321*20260615~",
      "TRN*1*ZZTRACE1*1999999999~",
      "CLP*ZZACCT*1*100.00*80.00*20.00*12*ZZPAYERCLAIM*11*1~",
      "SVC*HC:99213*100.00*80.00**1~",
      "DTM*472*20260601~",
      "EB*1*IND*30^1^33*HM~",
      "MOA***MA01~",
    ];
    const { x12, manifest } = run(wrap(segments.join(""), segments.length + 2));
    const out = body(x12);
    expect(out[0]).toBe(segments[0]);
    // The trace number is replaced by a sequence number; the rest of the TRN is kept.
    expect(out[1]).toBe("TRN*1*1*1999999999~");
    expect(out[2]).toMatch(/^CLP\*\*1\*100\.00\*80\.00\*20\.00\*12\*ZZPAYERCLAIM\*11\*1~$/);
    expect(out[3]).toBe(segments[3]);
    expect(out[4]).toBe("DTM*472*2026~");
    expect(out[5]).toBe(segments[5]);
    expect(out[6]).toBe(segments[6]);
    expect(manifest.filter((e) => e.disposition === "blocked")).toEqual([]);
  });
});
