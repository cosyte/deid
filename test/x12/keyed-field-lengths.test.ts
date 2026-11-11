/**
 * Under a keyed policy every X12 position the pass writes a keyed surrogate into gets one that fits
 * the element's maximum length: the 005010 maximum in a group whose `GS-08` names 005010, the 004010
 * one otherwise. A surrogate is the keyed digest cut to that length, so the same value under the same
 * key still gets the same surrogate in a field of one length, and a prefix of it in a shorter one. A
 * position shorter than 20 characters (80 bits) takes no surrogate: the value is removed and recorded
 * as blocked.
 *
 * All values are synthetic `ZZ` sentinels.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseX12 } from "@cosyte/x12";

import {
  DEID_DISPOSITION_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
  defineDeidPolicy,
  keyedHash,
  pseudonymize,
  type TransformName,
} from "../../src/index.js";
import { deidentifyX12String, extractX12Loci } from "../../src/x12/index.js";

const D = DEID_DISPOSITION_CODES;
const ctx = createDeidContext({ key: "x12-field-length-key-synthetic", patientId: "p-x12-fl" });

/** A policy that writes `transform` for every category. */
function every(transform: TransformName): ReturnType<typeof defineDeidPolicy> {
  return defineDeidPolicy({
    name: `every-${transform}`,
    transforms: Object.fromEntries(
      Object.values(SAFE_HARBOR_CATEGORIES).map((c) => [c, transform]),
    ),
  });
}

const PSEUDONYMIZE = every("pseudonymize");

/** One interchange of one group and one transaction set, at the given version. */
function interchange(body: string[], version: "5010" | "4010"): string {
  const isa =
    version === "5010"
      ? "ISA*00*          *00*          *ZZ*COMMERCIAL     *ZZ*CLINICSUBMTR   *260615*0930*^*00501*000000002*0*P*:~"
      : "ISA*00*          *00*          *ZZ*COMMERCIAL     *ZZ*CLINICSUBMTR   *260615*0930*U*00401*000000002*0*P*:~";
  const gs08 = version === "5010" ? "005010X222A2" : "004010X098A1";
  return [
    isa,
    `GS*HC*COMMERCIAL*CLINICSUBMTR*20260615*0930*2*X*${gs08}~`,
    "ST*837*0001~",
    ...body.map((s) => `${s}~`),
    `SE*${String(body.length + 2)}*0001~`,
    "GE*1*2~",
    "IEA*1*000000002~",
  ].join("");
}

/** The elements of the `index`-th segment of the output whose identifier is `id`. */
function segment(x12: string, id: string, index = 0): string[] {
  const found = x12.split("~").filter((s) => s.startsWith(`${id}*`))[index];
  if (found === undefined) throw new Error(`no ${id} segment`);
  return found.split("*");
}

/** Run one body under the all-pseudonymize policy. */
function run(body: string[], version: "5010" | "4010" = "5010") {
  return deidentifyX12String(interchange(body, version), { context: ctx, policy: PSEUDONYMIZE });
}

/** The keyed surrogate of `value` cut to `length`. */
function cut(value: string, length: number): string {
  return pseudonymize(value, ctx).slice(0, length);
}

describe("005010: each position's surrogate is cut to its element's maximum", () => {
  it.each([
    ["REF-02 (element 127, 50)", ["REF*1W*ZZMEMBERREF01"], "REF", 2, "ZZMEMBERREF01", 50],
    ["TRN-02 (element 127, 50)", ["TRN*1*ZZTRACE0001*1999999999"], "TRN", 2, "ZZTRACE0001", 50],
    ["SBR-03 (element 127, 50)", ["SBR*P*18*ZZGROUP777******CI"], "SBR", 3, "ZZGROUP777", 50],
    ["CLM-01 (element 1028, 38)", ["CLM*ZZACCOUNT01*100.00"], "CLM", 1, "ZZACCOUNT01", 38],
    ["CLP-01 (element 1028, 38)", ["CLP*ZZACCOUNT02*1*100*80"], "CLP", 1, "ZZACCOUNT02", 38],
    ["N1-02 (element 93, 60)", ["N1*IL*ZZNAMEONE"], "N1", 2, "ZZNAMEONE", 60],
    ["SBR-04 (element 93, 60)", ["SBR*P*18**ZZGROUPNAME*****CI"], "SBR", 4, "ZZGROUPNAME", 60],
    ["PER-02 (element 93, 60)", ["PER*IC*ZZCONTACT*TE*5550000001"], "PER", 2, "ZZCONTACT", 60],
    ["NM1-09 (element 67, 80)", ["NM1*IL*1*ZZLAST*****MI*ZZMEMBER01"], "NM1", 9, "ZZMEMBER01", 64],
    ["N1-04 (element 67, 80)", ["N1*IL**MI*ZZMEMBER02"], "N1", 4, "ZZMEMBER02", 64],
    ["PER-04 (element 364, 256)", ["PER*IC**TE*5550000002"], "PER", 4, "5550000002", 64],
  ])("%s", (_label, body, id, element, value, length) => {
    const { x12, manifest } = run(body);
    expect(segment(x12, id)[element]).toBe(cut(value, length));
    expect(x12).not.toContain(value);
    const row = manifest.find((m) => m.locus === `837/${id}[0]-${String(element)}`);
    expect(row?.disposition).toBe("transformed");
  });

  it("writes a person's name across NM1-03 to -07 at the shortest maximum among them", () => {
    // Last (60) and first (35): 35. With a middle name (25): 25.
    expect(segment(run(["NM1*IL*1*ZZLAST*ZZFIRST"]).x12, "NM1")[3]).toBe(cut("ZZLAST ZZFIRST", 35));
    const withMiddle = segment(run(["NM1*IL*1*ZZLAST*ZZFIRST*ZZMIDDLE"]).x12, "NM1");
    expect(withMiddle.slice(3, 6)).toEqual(Array(3).fill(cut("ZZLAST ZZFIRST ZZMIDDLE", 25)));
  });

  it("links: the same value gets the same surrogate, cut to each field's length", () => {
    const { x12 } = run([
      "NM1*IL*1*ZZLAST*****MI*ZZSAMEID01",
      "REF*1W*ZZSAMEID01",
      "REF*SY*ZZSAMEID01",
      "REF*1W*ZZOTHERID01",
    ]);
    const nm109 = segment(x12, "NM1")[9] as string;
    const ref1 = segment(x12, "REF", 0)[2] as string;
    expect(nm109).toHaveLength(64);
    expect(ref1).toHaveLength(50);
    expect(nm109.startsWith(ref1)).toBe(true);
    expect(segment(x12, "REF", 1)[2]).toBe(ref1);
    expect(segment(x12, "REF", 2)[2]).not.toBe(ref1);
  });

  it("cuts a keyed hash the same way", () => {
    const { x12 } = deidentifyX12String(interchange(["CLM*ZZACCOUNT03*100.00"], "5010"), {
      context: ctx,
      policy: every("hash"),
    });
    expect(segment(x12, "CLM")[1]).toBe(keyedHash("ZZACCOUNT03", ctx).slice(0, 38));
  });
});

describe("a position shorter than 20 characters takes no surrogate: removed, recorded as blocked", () => {
  it.each([
    ["a name with a suffix (NM1-07, 10)", ["NM1*IL*1*ZZLAST*ZZFIRST***JR"], "NM1", [3, 4, 7]],
    ["a name with a prefix (NM1-06, 10)", ["NM1*IL*1*ZZLAST*ZZFIRST**DR"], "NM1", [3, 4, 6]],
    ["a postal code (N4-03, 15)", ["N4*ZZCITY*MA*02139"], "N4", [3]],
    ["a D8 date (8)", ["DMG*D8*19850302*F"], "DMG", [2]],
    ["a date in a DTP (8)", ["DTP*472*D8*20260601"], "DTP", [3]],
  ])("%s", (_label, body, id, elements) => {
    const { x12, manifest } = run(body);
    const seg = segment(x12, id);
    for (const element of elements) expect(seg[element] ?? "").toBe("");
    const row = manifest.find((m) => m.locus === `837/${id}[0]-${String(elements[0])}`);
    expect(row).toMatchObject({
      disposition: "blocked",
      transform: "block",
      code: D.DEID_LOCUS_BLOCKED,
      reidentificationCode: false,
    });
  });
});

describe("004010: the shorter 004010 maxima", () => {
  it.each([
    ["REF-02 (30)", ["REF*1W*ZZMEMBERREF01"], "REF", 2, "ZZMEMBERREF01", 30],
    ["TRN-02 (30)", ["TRN*1*ZZTRACE0001*1999999999"], "TRN", 2, "ZZTRACE0001", 30],
    ["SBR-03 (30)", ["SBR*P*18*ZZGROUP777******CI"], "SBR", 3, "ZZGROUP777", 30],
    ["NM1-03 alone (35)", ["NM1*IL*1*ZZLAST"], "NM1", 3, "ZZLAST", 35],
    ["NM1-03 and -04 (25)", ["NM1*IL*1*ZZLAST*ZZFIRST"], "NM1", 3, "ZZLAST ZZFIRST", 25],
    ["CLM-01 (38)", ["CLM*ZZACCOUNT01*100.00"], "CLM", 1, "ZZACCOUNT01", 38],
    ["PER-04 (80)", ["PER*IC**TE*5550000002"], "PER", 4, "5550000002", 64],
  ])("%s", (_label, body, id, element, value, length) => {
    const { x12 } = run(body, "4010");
    expect(segment(x12, id)[element]).toBe(cut(value, length));
  });

  it("reads a group whose GS-08 is not a version it can read as 004010", () => {
    const raw = interchange(["REF*1W*ZZMEMBERREF01"], "5010").replace("005010X222A2", "X");
    const { x12 } = deidentifyX12String(raw, { context: ctx, policy: PSEUDONYMIZE });
    expect(segment(x12, "REF")[2]).toBe(cut("ZZMEMBERREF01", 30));
  });
});

describe("a caller's redactor writes free text back within the element's maximum", () => {
  it("keeps prose that fits NTE-02 (element 352, 80) and blocks prose that does not", () => {
    const raw = interchange(["NTE*ADD*ZZNOTEPHI"], "5010");
    const fits = deidentifyX12String(raw, { redactor: () => ({ text: "A".repeat(80) }) });
    expect(segment(fits.x12, "NTE")[2]).toBe("A".repeat(80));
    const long = deidentifyX12String(raw, { redactor: () => ({ text: "A".repeat(81) }) });
    expect(segment(long.x12, "NTE")[2] ?? "").toBe("");
    expect(long.manifest.find((m) => m.locus === "837/NTE[0]-2")?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });
});

describe("every position the engine may write into declares its maximum", () => {
  const dir = join(import.meta.dirname, "..", "fixtures", "x12");
  it.each(readdirSync(dir).filter((f) => f.endsWith(".edi")))("%s", (file) => {
    const { loci } = extractX12Loci(parseX12(readFileSync(join(dir, file), "utf8")));
    const written = loci.filter((l) => l.category !== undefined);
    expect(written.length).toBeGreaterThan(0);
    for (const locus of written) {
      // A date is bounded by its own length; every other position by a row of the table.
      if (locus.kind === "date") expect(locus.maxLength, locus.path).toBe(locus.value.length);
      else expect(locus.maxLength, locus.path).toBeGreaterThan(0);
    }
  });
});
