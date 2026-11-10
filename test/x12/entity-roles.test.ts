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
  PATIENT_ENTITY_CODES,
  PROVIDER_ENTITY_CODES,
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
