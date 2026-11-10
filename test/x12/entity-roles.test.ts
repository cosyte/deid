/**
 * **X12: an entity code that can name the individual or a person around them is never a provider.**
 * `NM1-01` decides whether a party's name and identifier are retained (a provider, a payer, a facility)
 * or removed (the individual, a relative, a household member, the employer). Element 98 gives `GB` to
 * the Other Insured, and the 005010 TR3s use it for individuals: the 835 Other Subscriber (2100) and
 * the 834 responsible person (2100G). The other 834 responsible-person codes, the 834 drop-off
 * location (2100H, a person's name), and the 837 ambulance pick-up location (commonly the individual's
 * residence) are on the same side. Each one's name and identifier are removed and recorded, its code
 * is kept, and no row says it was retained.
 *
 * Every value is a synthetic, ZZ-tagged sentinel.
 */

import { describe, expect, it } from "vitest";

import { createDeidContext, type DeidManifestEntry } from "../../src/index.js";
import {
  EMPLOYER_ENTITY_CODES,
  EMPLOYER_ENTITY_CODES_BY_SET,
  PATIENT_ENTITY_CODES,
  PROVIDER_ENTITY_CODES,
  classifyNm1Entity,
  classifyNm1Party,
  deidentifyX12String,
} from "../../src/x12/index.js";

const ctx = createDeidContext({
  key: "x12-entity-roles-synthetic-hmac-key",
  patientId: "p-x12-entity-roles",
});

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000008*0*P*:~";

/** One body segment in a transaction set of `st01`, its output, and what was recorded. */
function one(
  st01: string,
  gs01: string,
  version: string,
  segment: string,
): { out: string; manifest: readonly DeidManifestEntry[]; residuals: number } {
  const raw =
    `${ISA}GS*${gs01}*A*B*20260615*0930*8*X*${version}~ST*${st01}*0008*${version}~` +
    `${segment}~SE*3*0008~GE*1*8~IEA*1*000000008~`;
  const { x12, manifest, unexaminedResiduals } = deidentifyX12String(raw, { context: ctx });
  const all = x12.split("~");
  const st = all.findIndex((s) => s.startsWith("ST*"));
  return { out: all[st + 1] ?? "", manifest, residuals: unexaminedResiduals.length };
}

const loci = (manifest: readonly DeidManifestEntry[]): string[] => manifest.map((e) => e.locus);
const retained = (manifest: readonly DeidManifestEntry[]): DeidManifestEntry[] =>
  manifest.filter((e) => e.partyRole !== undefined);

describe("the Other Insured (GB) is the individual's side, not a provider", () => {
  it("835 2100 Other Subscriber: the name and the member id are removed and recorded", () => {
    const { out, manifest, residuals } = one(
      "835",
      "HP",
      "005010X221A1",
      "NM1*GB*1*ZZOTHLAST*ZZOTHFIRST****MI*ZZOTHMEMBER",
    );
    expect(out).toBe("NM1*GB*1******MI*");
    expect(loci(manifest)).toEqual(["835/NM1[0]-3", "835/NM1[0]-9"]);
    expect(manifest.find((e) => e.locus === "835/NM1[0]-3")?.category).toBe("NAMES");
    expect(retained(manifest)).toEqual([]);
    expect(residuals).toBe(0);
  });

  it("834 2100G responsible person: the name is removed and recorded", () => {
    const { out, manifest } = one("834", "BE", "005010X220A1", "NM1*GB*1*ZZRESPLAST*ZZRESPFIRST");
    expect(out).toBe("NM1*GB*1**");
    expect(loci(manifest)).toEqual(["834/NM1[0]-3"]);
    expect(retained(manifest)).toEqual([]);
  });
});

describe("every 834 responsible person, and the locations that can be the individual's", () => {
  const PERSONS: readonly (readonly [code: string, role: string])[] = [
    ["6Y", "Case Manager"],
    ["9K", "Key Person"],
    ["E1", "Person or Other Entity Legally Responsible for a Child"],
    ["EI", "Executor of Estate"],
    ["EXS", "Ex-spouse"],
    ["GB", "Other Insured"],
    ["GD", "Guardian"],
    ["J6", "Power of Attorney"],
    ["LR", "Legal Representative"],
    ["QD", "Responsible Party"],
    ["S1", "Parent"],
    ["TZ", "Significant Other"],
    ["X4", "Spouse"],
    ["45", "Drop-off Location (834 2100H)"],
  ];
  for (const [code, role] of PERSONS) {
    it(`${code} (${role}) is removed and recorded, its code kept`, () => {
      const { out, manifest } = one(
        "834",
        "BE",
        "005010X220A1",
        `NM1*${code}*1*ZZRESPLAST*ZZRESPFIRST****34*999999999`,
      );
      expect(out).toBe(`NM1*${code}*1******34*`);
      expect(loci(manifest)).toEqual(["834/NM1[0]-3", "834/NM1[0]-9"]);
      expect(retained(manifest)).toEqual([]);
    });
  }

  it("837P 2310E ambulance pick-up location (PW) keeps its code and loses any name", () => {
    expect(one("837", "HC", "005010X222A1", "NM1*PW*2").out).toBe("NM1*PW*2");
    const { out, manifest } = one("837", "HC", "005010X222A1", "NM1*PW*2*ZZPICKUPNAME");
    expect(out).toBe("NM1*PW*2*");
    expect(loci(manifest)).toEqual(["837/NM1[0]-3"]);
    expect(retained(manifest)).toEqual([]);
  });
});

describe("the provider list names no party that can be the individual or a person around them", () => {
  it("no code is on both sides of the scope clause", () => {
    const subject = new Set<string>([...PATIENT_ENTITY_CODES, ...EMPLOYER_ENTITY_CODES]);
    expect([...PROVIDER_ENTITY_CODES].filter((code) => subject.has(code))).toEqual([]);
  });

  it("every code a 005010 TR3 uses for such a person is on the individual's side", () => {
    // The individual, the relatives and household members, the people who stand for the individual,
    // the other insured, and the 834 member-side parties and locations.
    const persons = [
      ...["IL", "QC", "03", "74", "70", "31", "GB", "QD", "GD", "S1", "S3", "E1", "EI", "EXS"],
      ...["J6", "LR", "TZ", "X4", "6Y", "9K", "45", "PW"],
    ];
    expect(persons.filter((code) => !PATIENT_ENTITY_CODES.has(code))).toEqual([]);
    expect(persons.filter((code) => PROVIDER_ENTITY_CODES.has(code))).toEqual([]);
  });
});

describe("820: the premium payer is the employer of the individuals the payment lists", () => {
  // The 005010X218 payroll-deducted and other group premium payment: 1000A is the premium receiver (the
  // health plan), 1000B the premium payer, which is the employer of the members listed in 2000B. Element
  // 98 calls `PR` a payer, and in every other set a `PR` party is a health plan; in the 820 it is the
  // individuals' employer, so its name and identifier are removed and recorded, as the 834 sponsor
  // (`P5`) is. The shape is the x12 library's golden and canonical 820.
  const PREMIUM = [
    "BPR*C*12500.00*C*ACH*CCP*01*999000011*DA*123456789*1111111111**01*888000022*DA*987654321*20260601",
    "TRN*1*PREM-202606*1111111111",
    "N1*PE*ZZPREMRECEIVER*FI*111223333",
    "N1*PR*ZZPREMPAYER*FI*ZZPREMPAYEREIN",
    "N3*ZZPREMPAYERSTREET",
    "N4*ZZPREMPAYERCITY*OH*43215",
    "NM1*IL*1*ZZPREMLAST*ZZPREMFIRST****MI*ZZPREMMEMBER",
  ];

  function premium(st01: string): { body: string[]; manifest: readonly DeidManifestEntry[] } {
    const raw =
      `${ISA}GS*RA*A*B*20260601*1200*8*X*005010X218~ST*${st01}*0008~` +
      `${PREMIUM.map((s) => `${s}~`).join("")}SE*${String(PREMIUM.length + 2)}*0008~GE*1*8~` +
      `IEA*1*000000008~`;
    const { x12, manifest } = deidentifyX12String(raw, { context: ctx });
    const all = x12.split("~");
    const st = all.findIndex((s) => s.startsWith("ST*"));
    const se = all.findIndex((s) => s.startsWith("SE*"));
    return { body: all.slice(st + 1, se), manifest };
  }

  it("N1*PR in an 820: the name and identifier are removed and recorded, no row says retained", () => {
    const { body, manifest } = premium("820");
    expect(body[3]).toBe("N1*PR**FI*");
    expect(body.join("~")).not.toContain("ZZPREMPAYER");
    const rows = manifest.filter((e) => e.locus.startsWith("820/N1[1]"));
    expect(rows.map((e) => [e.locus, e.disposition])).toEqual([
      ["820/N1[1]-2", expect.not.stringMatching(/retained/)],
      ["820/N1[1]-4", "blocked"],
    ]);
    expect(rows[0]?.category).toBe("NAMES");
    expect(retained(manifest).map((e) => e.locus)).toEqual(["820/N1[0]-1"]);
  });

  it("the premium receiver (PE) is still the health plan, and NM1*PR in an 820 is the employer too", () => {
    const { body } = premium("820");
    expect(body[2]).toBe("N1*PE*ZZPREMRECEIVER*FI*111223333");
    const raw =
      `${ISA}GS*RA*A*B*20260601*1200*8*X*005010X218~ST*820*0008~NM1*PR*2*ZZPREMPAYERNM1~` +
      `SE*3*0008~GE*1*8~IEA*1*000000008~`;
    const { x12, manifest } = deidentifyX12String(raw, { context: ctx });
    expect(x12).not.toContain("ZZPREMPAYERNM1");
    expect(retained(manifest)).toEqual([]);
  });

  it("outside the 820, PR is the payer: an 835 payer keeps its name and identifier", () => {
    const { out, manifest } = one("835", "HP", "005010X221A1", "N1*PR*ZZPAYERORG*XV*ZZPAYERID");
    expect(out).toBe("N1*PR*ZZPAYERORG*XV*ZZPAYERID");
    expect(retained(manifest).map((e) => e.locus)).toEqual(["835/N1[0]-1"]);
  });
});

describe("the classifiers read a code in the transaction set it sits in", () => {
  it("PR is the employer in an 820 and the payer anywhere else", () => {
    expect(EMPLOYER_ENTITY_CODES_BY_SET["820"]?.has("PR")).toBe(true);
    expect(classifyNm1Party("PR", "820")).toEqual({ scope: "safe-harbor-subject", roleCode: "PR" });
    expect(classifyNm1Entity("PR", "820")).toBe("employer");
    expect(classifyNm1Entity("PR", "835")).toBe("provider");
    expect(classifyNm1Entity("PR")).toBe("provider");
    expect(classifyNm1Entity("PE", "820")).toBe("provider");
    expect(classifyNm1Entity("IL", "820")).toBe("patient");
    expect(classifyNm1Entity("36", "820")).toBe("employer");
    // A set id that is an inherited property name is no set.
    expect(classifyNm1Entity("PR", "constructor")).toBe("provider");
  });
});
