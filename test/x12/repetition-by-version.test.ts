/**
 * The repetition separator is read by interchange version. From 00402 on, `ISA-11` is the repetition
 * separator; before it, `ISA-11` is the standards identifier `U` and the interchange has no repetition
 * separator, so a `U` in a value is a letter like any other and is no reason to remove it. Where the
 * version cannot be read, or `ISA-11` is a punctuation character, it is still read as the separator.
 *
 * All values are synthetic `ZZ` sentinels or published codes.
 */

import { describe, expect, it } from "vitest";

import { deidentifyX12String } from "../../src/x12/index.js";

/** An interchange with the given `ISA-11` and `ISA-12` around one transaction set. */
function interchange(isa11: string, isa12: string, st: string, body: string[]): string {
  return [
    `ISA*00*          *00*          *ZZ*COMMERCIAL     *ZZ*CLINICSUBMTR   *260615*0930*${isa11}*${isa12}*000000002*0*P*:~`,
    `GS*HB*COMMERCIAL*CLINICSUBMTR*20260615*0930*2*X*004010X092A1~`,
    `ST*${st}*0001~`,
    ...body.map((s) => `${s}~`),
    `SE*${String(body.length + 2)}*0001~`,
    "GE*1*2~",
    "IEA*1*000000002~",
  ].join("");
}

/** The elements of the first segment of the output whose identifier is `id`. */
function segment(x12: string, id: string): string[] {
  const found = x12.split("~").find((s) => s.startsWith(`${id}*`));
  if (found === undefined) throw new Error(`no ${id} segment`);
  return found.split("*");
}

describe("before 00402, ISA-11 is the standards identifier U, not a separator", () => {
  it.each(["00401", "00400", "00306", "00200"])(
    "%s: a reference holding a U is kept, and a repeating code holding one is read whole",
    (version) => {
      const raw = interchange("U", version, "271", [
        "BHT*0022*11*ZZREFU01*20260615*0930",
        "EB*1**UC",
      ]);
      const { x12, manifest } = deidentifyX12String(raw);
      expect(segment(x12, "BHT")[3]).toBe("ZZREFU01");
      expect(segment(x12, "EB")[3]).toBe("UC");
      expect(manifest.map((m) => m.locus)).not.toContain("271/BHT[0]-3");
      expect(manifest.map((m) => m.locus)).not.toContain("271/EB[0]-3");
    },
  );
});

describe("ISA-11 is still read as the separator wherever it may be one", () => {
  it.each([
    ["00501 with ^", "^", "00501", "ZZREF^01"],
    ["00402 with ^", "^", "00402", "ZZREF^01"],
    ["00401 with a punctuation ISA-11", "^", "00401", "ZZREF^01"],
    ["00501 with U", "U", "00501", "ZZREFU01"],
    ["a version that cannot be read, with U", "U", "0040X", "ZZREFU01"],
  ])("%s: a reference holding it is removed and recorded", (_label, isa11, isa12, value) => {
    const raw = interchange(isa11, isa12, "271", [`BHT*0022*11*${value}*20260615*0930`]);
    const { x12, manifest } = deidentifyX12String(raw);
    expect(x12).not.toContain(value);
    expect(manifest.find((m) => m.locus === "271/BHT[0]-3")?.disposition).toBe("blocked");
  });
});
