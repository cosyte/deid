/**
 * X12 adapter tests — the two headline gates (the **leak test** and the **over-scrub test**), the
 * per-segment structured behavior (`NM1` entity classification, `REF` qualifier classification, `N3` /
 * `N4` / `DMG` / `PER` / `DTP` / `CLM`), the unknown-segment / unknown-qualifier fail-closed defaults,
 * the keyed-context fatal, the value-free manifest, and immutability.
 *
 * Every seeded value is a synthetic, tagged sentinel (`ZZ…`, `9xx-xx-xxxx` SSN, `555…` phone) or a
 * synthetic clinical / financial value. The fixture is declared synthetic in `scripts/phi-allow-list.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseX12, serializeX12 } from "@cosyte/x12";

import {
  DEID_DISPOSITION_CODES,
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  createDeidContext,
} from "../../src/index.js";
import {
  classifyNm1Entity,
  categoryForNm1IdQualifier,
  classifyRefQualifier,
  deidentifyX12,
  deidentifyX12String,
  extractX12Loci,
} from "../../src/x12/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "x12");

function load(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.edi`), "utf8");
}

const ctx = createDeidContext({ key: "x12-test-key", patientId: "patient-x12-1" });

/** The synthetic PHI sentinels seeded into `837p.edi` — every one must be GONE after a de-id pass. */
const SENTINELS = [
  "ZZSUBLAST",
  "ZZSUBFIRST",
  "ZZMEMBERX12",
  "900000201",
  "ZZSUBSTREET",
  "ZZSUBCITY",
  "ZZSUBCONTACT",
  "5550000201",
  "ZZPATLAST",
  "ZZPATFIRST",
  "ZZPATMEMBER",
  "ZZPATSTREET",
  "ZZPATCITY",
  "19850302",
  "20211130",
  "ZZACCTX12",
  "ZZUNKNOWNREF",
  "ZZWEIRDPHI",
  "20260601",
  "ZZLOCID", // N4-06 location identifier — an unmapped geographic element, fails closed
  "ZZCHAMPUSID", // REF*1H CHAMPUS/TRICARE beneficiary id — reclassified as PHI, pseudonymized away
  "ZZPOLICY777", // SBR-03 insured group/policy number — pseudonymized (was silently retained)
  "ZZGROUPNAME", // SBR-04 insured group name — removed (employer/plan name)
  "ZZNTEPHI", // NTE-02 note free text — blocked (was unhandled)
  "ZZMSGPHI", // MSG-01 message free text — blocked (was retained wholesale)
  "ZZIIIPHI", // III-04 free-form message text — blocked (III codes retained)
  "ZZK3PHI", // K3-01 file information free text — blocked
  // Provider address / submitter contact are universally scrubbed (a safe over-reach, never a leak).
  "PROVIDER RD",
  "PROVCITY",
  "SUBMITCONTACT",
  "5550009999",
];

/** Synthetic clinical / financial / provider-identity values that MUST survive byte-identical. */
const SURVIVORS = [
  "BILLINGPROV",
  "1999999999",
  "990000111",
  "RENDERINGPROV",
  "1888888888",
  "CLAIMCTRL999",
  "E1165", // ICD-10 diagnosis code
  "99213", // CPT procedure code
  "100.00", // charge amount
  "OH", // retained state
  "2026", // service date generalized to year
  "1985", // DOB generalized to year
  "2021",
  "COMMERCIALPAYER", // N1*PR payer org name — retained (org identity, not the individual)
  "PAYERID12345", // N1*PR payer id — retained
];

describe("X12 de-identification — leak + over-scrub gates", () => {
  it("removes every seeded PHI sentinel (the leak test — must be ZERO survivors)", () => {
    const { x12 } = deidentifyX12String(load("837p"), { context: ctx });
    const leaked = SENTINELS.filter((s) => x12.includes(s));
    expect(leaked).toEqual([]);
  });

  it("retains every clinical / financial / provider value byte-identical (the over-scrub test)", () => {
    const { x12 } = deidentifyX12String(load("837p"), { context: ctx });
    const destroyed = SURVIVORS.filter((s) => !x12.includes(s));
    expect(destroyed).toEqual([]);
  });

  it("produces output that re-parses cleanly (structurally valid X12)", () => {
    const { x12 } = deidentifyX12String(load("837p"), { context: ctx });
    const reparsed = parseX12(x12);
    expect(reparsed.groups[0]?.transactions[0]?.st.elements[1]).toBe("837");
  });
});

describe("X12 structured behavior", () => {
  it("entity-classifies NM1: patient scrubbed, provider retained, unknown fails closed", () => {
    expect(classifyNm1Entity("IL")).toBe("patient");
    expect(classifyNm1Entity("QC")).toBe("patient");
    expect(classifyNm1Entity("85")).toBe("provider");
    expect(classifyNm1Entity("82")).toBe("provider");
    expect(classifyNm1Entity("ZQ")).toBe("unknown");
  });

  it("routes NM1-09 by the NM1-08 qualifier (SSN removed, member pseudonymized, unknown → block)", () => {
    expect(categoryForNm1IdQualifier("34")).toBe(C.SSN);
    expect(categoryForNm1IdQualifier("MI")).toBe(C.HEALTH_PLAN_BENEFICIARY);
    expect(categoryForNm1IdQualifier("QQ")).toBeUndefined();
  });

  it("classifies REF: patient id scrubbed, admin retained, unknown qualifier fails closed", () => {
    expect(classifyRefQualifier("SY")).toEqual({ kind: "phi", category: C.SSN });
    expect(classifyRefQualifier("1W")).toEqual({
      kind: "phi",
      category: C.HEALTH_PLAN_BENEFICIARY,
    });
    expect(classifyRefQualifier("F8")).toEqual({ kind: "retain" });
    expect(classifyRefQualifier("ZZ")).toEqual({ kind: "block" });
    // REF*1H (CHAMPUS/TRICARE beneficiary id) is the individual's — PHI, not a retained admin reference
    // (the DEID-5 refuter finding).
    expect(classifyRefQualifier("1H")).toEqual({
      kind: "phi",
      category: C.HEALTH_PLAN_BENEFICIARY,
    });
  });

  it("fails closed on an unmapped geographic element (N4-06 location identifier)", () => {
    const raw = wrap("N4*CITYNAME*OH*44101*US*CY*SECRETLOCID~");
    const { x12, manifest } = deidentifyX12String(raw, { context: ctx });
    expect(x12).not.toContain("SECRETLOCID"); // N4-06 blocked
    expect(x12).not.toContain("CITYNAME"); // N4-01 city blocked
    expect(x12).toContain("OH"); // N4-02 state retained
    expect(manifest.some((e) => e.locus.endsWith("N4[0]-6") && e.disposition === "blocked")).toBe(
      true,
    );
  });

  it("pseudonymizes the CLM-01 patient account number consistently but not reversibly", () => {
    const { x12 } = deidentifyX12String(load("837p"), { context: ctx });
    // The account number is gone and replaced by a hex surrogate; the sibling amount survives.
    expect(x12).not.toContain("ZZACCTX12");
    const clm = x12.split("~").find((s) => s.startsWith("CLM"));
    expect(clm).toMatch(/^CLM\*[0-9a-f]{64}\*100\.00/);
  });

  it("generalizes DTP/DMG dates to year and N4 ZIP to its 3-digit prefix", () => {
    const { x12 } = deidentifyX12String(load("837p"), { context: ctx });
    expect(x12).toContain("DTP*472*D8*2026");
    expect(x12).toContain("DMG*D8*1985*M");
    // Subscriber N4 city removed, state retained, ZIP → 441.
    const n4 = x12.split("~").filter((s) => s.startsWith("N4"));
    expect(n4.some((s) => s === "N4**OH*441")).toBe(true);
  });
});

describe("X12 fail-closed + manifest + immutability", () => {
  it("blocks an unknown segment element-by-element (fails closed)", () => {
    const { x12, manifest } = deidentifyX12String(load("837p"), { context: ctx });
    expect(x12).toContain("ZZZ*~"); // the unknown segment's value is cleared
    expect(manifest.some((e) => e.locus.includes("ZZZ") && e.disposition === "blocked")).toBe(true);
  });

  it("blocks free-text message segments (MSG/III/K3/NTE) but retains their coded elements", () => {
    const { x12, manifest } = deidentifyX12String(load("837p"), { context: ctx });
    // The free-text values are gone; the coded siblings survive.
    expect(x12).toContain("MSG*~"); // MSG-01 message text blocked
    expect(x12).toContain("III*ZZ*21**~"); // III-01/02 codes retained, III-04 blocked
    expect(x12).toContain("NTE*ADD*~"); // NTE-01 note code retained, NTE-02 blocked
    expect(x12).toContain("K3*~"); // K3-01 blocked
    // Recorded as fail-closed free-text blocks.
    const freetext = manifest.filter((e) => e.code === D.DEID_FREETEXT_BLOCKED);
    expect(freetext.some((e) => e.locus.includes("MSG"))).toBe(true);
    expect(freetext.some((e) => e.locus.includes("NTE"))).toBe(true);
  });

  it("emits a value-free manifest (no sentinel value ever appears in a locus or elsewhere)", () => {
    const { manifest } = deidentifyX12String(load("837p"), { context: ctx });
    const serialized = JSON.stringify(manifest);
    for (const s of SENTINELS) expect(serialized).not.toContain(s);
    // Every entry carries a category, a registered code, a positional locus, and a positive count.
    for (const e of manifest) {
      expect(e.locus).toMatch(/-\d+$|\//);
      expect(e.count).toBeGreaterThan(0);
      expect(Object.values(D)).toContain(e.code);
    }
  });

  it("never mutates the input interchange", () => {
    const ix = parseX12(load("837p"));
    const before = serializeX12(ix);
    deidentifyX12(ix, { context: ctx });
    expect(serializeX12(ix)).toBe(before);
  });

  it("throws DEID_NO_KEY when a keyed transform is required but no key context is supplied", () => {
    expect(() => deidentifyX12String(load("837p"), {})).toThrowError(
      expect.objectContaining({ code: FATAL_CODES.DEID_NO_KEY }),
    );
  });

  it("extracts loci without throwing on an interchange with no transactions", () => {
    // A bare ISA/IEA with an empty group list yields no loci.
    const { loci } = extractX12Loci(parseX12(load("837p")));
    expect(loci.length).toBeGreaterThan(0);
    expect(loci.every((l) => typeof l.path === "string" && l.path.length > 0)).toBe(true);
  });
});

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000002*0*P*:~";
/** Wrap body segments (each terminated by `~`) in a minimal 837 envelope. */
function wrap(body: string): string {
  return `${ISA}GS*HC*A*B*20260615*0930*2*X*005010X222A2~ST*837*0002~${body}SE*9*0002~GE*1*2~IEA*1*000000002~`;
}

describe("X12 edge cases (branch coverage of the fail-closed frontier)", () => {
  it("fails closed on an unknown NM1 entity — name AND identifier are blocked (removed)", () => {
    const raw = wrap("NM1*ZQ*1*UNKNOWNPERSON*FIRST****QQ*SECRETID~");
    const { x12, manifest } = deidentifyX12String(raw, { context: ctx });
    expect(x12).not.toContain("UNKNOWNPERSON");
    expect(x12).not.toContain("SECRETID");
    // Both the name and the id are recorded as fail-closed blocks (category R).
    expect(manifest.filter((e) => e.disposition === "blocked").length).toBeGreaterThanOrEqual(2);
  });

  it("fails closed on a patient NM1 whose id qualifier is unrecognized", () => {
    const raw = wrap("NM1*IL*1*ZZSUBLAST*****QQ*MYSTERYID~");
    const { x12, manifest } = deidentifyX12String(raw, { context: ctx });
    expect(x12).not.toContain("MYSTERYID"); // unknown NM1-08 qualifier → id blocked
    expect(manifest.some((e) => e.locus.endsWith("NM1[0]-9") && e.disposition === "blocked")).toBe(
      true,
    );
  });

  it("returns the interchange unchanged (no edits) when a transaction carries only retained segments", () => {
    const raw = wrap("HI*ABK:E1165~AMT*D*100.00~");
    const { x12, manifest } = deidentifyX12String(raw, { context: ctx });
    expect(manifest).toEqual([]);
    expect(x12).toContain("HI*ABK:E1165");
    expect(x12).toContain("AMT*D*100.00");
  });

  it("emits no locus for an empty CLM-01 (nothing to pseudonymize)", () => {
    const raw = wrap("CLM**100.00***11:B:1~");
    const { manifest } = deidentifyX12String(raw, { context: ctx });
    expect(manifest.some((e) => e.locus.includes("CLM"))).toBe(false);
  });

  it("scrubs the SBR insured group/policy number and group name (was a silent retained leak)", () => {
    const raw = wrap("SBR*P*18*POLICY-SECRET*ACME GROUP*****CI~");
    const { x12, manifest } = deidentifyX12String(raw, { context: ctx });
    expect(x12).not.toContain("POLICY-SECRET"); // SBR-03 pseudonymized
    expect(x12).not.toContain("ACME GROUP"); // SBR-04 removed
    expect(x12).toContain("SBR*P*18*"); // relationship codes retained
    expect(
      manifest.some(
        (e) => e.locus.endsWith("SBR[0]-3") && e.category === C.HEALTH_PLAN_BENEFICIARY,
      ),
    ).toBe(true);
  });

  it("entity-classifies N1: recognized org retained, patient-side scrubbed, unknown fails closed", () => {
    // Recognized payer org — retained wholesale.
    const org = deidentifyX12String(wrap("N1*PR*ACME PAYER*PI*PID999~"), { context: ctx });
    expect(org.x12).toContain("ACME PAYER");
    expect(org.x12).toContain("PID999");
    // Unknown entity code — name and id fail closed (blocked).
    const unknown = deidentifyX12String(wrap("N1*ZQ*MYSTERY PARTY*XX*SECRETNPI~"), {
      context: ctx,
    });
    expect(unknown.x12).not.toContain("MYSTERY PARTY");
    expect(unknown.x12).not.toContain("SECRETNPI");
    // Patient-side party — name removed, id (N1-04) routed by the N1-03 qualifier and pseudonymized.
    const patient = deidentifyX12String(wrap("N1*IL*PATIENT PARTY*MI*PATMEMBER~"), {
      context: ctx,
    });
    expect(patient.x12).not.toContain("PATIENT PARTY"); // N1-02 name removed
    expect(patient.x12).not.toContain("PATMEMBER"); // N1-04 member id pseudonymized
    expect(patient.manifest.some((e) => e.locus.endsWith("N1[0]-2"))).toBe(true);
  });
});
