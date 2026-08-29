/**
 * **The employer is the individual's, not an unrelated organisation** (X12 half).
 *
 * §164.514(b)(2)(i) removes "the following identifiers of the individual **or of relatives, employers,
 * or household members** of the individual", so an X12 party whose entity-identifier code is `36`
 * (Employer) is a Safe Harbor subject however organisational it looks. This suite pins that, together
 * with the two controls that keep the fix from becoming an over-scrub:
 *
 * - **AC1** an employer party's name components and identifiers are transformed and recorded;
 * - **AC2** a provider / facility / payer / payee / submitter / receiver / clearinghouse party is
 *   byte-identical in the serialized output (the negative control);
 * - **AC3** a party retained because its role is outside the clause names the **role code** it was
 *   classified on, value-free, at its own structural locus;
 * - **AC7** an absent / empty / unrecognized role code blocks the party's name and identifiers;
 * - **AC8** `SBR-04` is still removed: the contradiction is resolved by bringing the employer inside
 *   Safe Harbor, never by relaxing a removal that was already correct.
 *
 * Every seeded value is a synthetic, tagged sentinel; the fixture and the inline literals are declared
 * synthetic in `scripts/phi-allow-list.txt`.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parseX12 } from "@cosyte/x12";

import {
  DEID_DISPOSITION_CODES,
  SAFE_HARBOR_CATEGORIES,
  buildExpertDeterminationSupportReport,
  createDeidContext,
  type DeidManifestEntry,
} from "../../src/index.js";
import {
  EMPLOYER_ENTITY_CODES,
  PROVIDER_ENTITY_CODES,
  classifyNm1Entity,
  classifyNm1Party,
  deidentifyX12String,
} from "../../src/x12/index.js";

const C = SAFE_HARBOR_CATEGORIES;
const D = DEID_DISPOSITION_CODES;
const FIXTURES = join(import.meta.dirname, "..", "fixtures", "x12");

const ctx = createDeidContext({ key: "x12-employer-key", patientId: "patient-x12-emp" });

const ISA =
  "ISA*00*          *00*          *ZZ*A              *ZZ*B              *260615*0930*^*00501*000000002*0*P*:~";

/** Wrap body segments (each terminated by `~`) in a minimal 837 envelope. */
function wrap(body: string): string {
  return `${ISA}GS*HC*A*B*20260615*0930*2*X*005010X222A2~ST*837*0002~${body}SE*9*0002~GE*1*2~IEA*1*000000002~`;
}

/** The party-role rows of a manifest: the value-free record of a party left in place. */
function partyRows(manifest: readonly DeidManifestEntry[]): readonly DeidManifestEntry[] {
  return manifest.filter((e) => e.code === D.DEID_PARTY_ROLE_RETAINED);
}

describe("AC1: the employer party is a Safe Harbor subject", () => {
  it("classifies entity code 36 as the employer, not as a retained organisation", () => {
    expect(classifyNm1Entity("36")).toBe("employer");
    expect(PROVIDER_ENTITY_CODES.has("36")).toBe(false);
    expect(EMPLOYER_ENTITY_CODES.has("36")).toBe(true);
    // Lower case on the wire resolves to the same committed code.
    expect(classifyNm1Party("36")).toEqual({ scope: "safe-harbor-subject", roleCode: "36" });
  });

  it("transforms an NM1*36 employer's name components and identifier, and records each with its locus", () => {
    const { x12, manifest } = deidentifyX12String(
      wrap("NM1*36*2*ZZEMPLOYERX12*****FI*ZZEMPEIN12~"),
      { context: ctx },
    );
    expect(x12).not.toContain("ZZEMPLOYERX12");
    expect(x12).not.toContain("ZZEMPEIN12");
    // The name is recorded as (A) names at NM1-03, on the same footing as a patient-side party.
    const name = manifest.find((e) => e.locus === "837/NM1[0]-3");
    expect(name?.category).toBe(C.NAMES);
    expect(name?.disposition).toBe("removed");
    // The identifier is recorded at NM1-09. `FI` is not a member-id qualifier, so it fails closed as
    // the (R) catch-all rather than being handed through.
    const id = manifest.find((e) => e.locus === "837/NM1[0]-9");
    expect(id?.disposition).toBe("blocked");
    expect(id?.category).toBe(C.OTHER_UNIQUE_ID);
    // An employer party is NOT recorded as a retained party: it is inside the scope clause.
    expect(partyRows(manifest)).toEqual([]);
  });

  it("treats an N1*36 employer party the same way (name and identifier both acted on)", () => {
    const { x12, manifest } = deidentifyX12String(wrap("N1*36*ZZEMPLOYERX12*FI*ZZEMPEIN12~"), {
      context: ctx,
    });
    expect(x12).not.toContain("ZZEMPLOYERX12");
    expect(x12).not.toContain("ZZEMPEIN12");
    expect(manifest.find((e) => e.locus === "837/N1[0]-2")?.category).toBe(C.NAMES);
    expect(manifest.find((e) => e.locus === "837/N1[0]-4")?.disposition).toBe("blocked");
  });

  it("routes an employer's member-shaped identifier by its NM1-08 qualifier, like a patient's", () => {
    const { x12, manifest } = deidentifyX12String(
      wrap("NM1*36*2*ZZEMPLOYERX12*****MI*ZZEMPEIN12~"),
      { context: ctx },
    );
    expect(x12).not.toContain("ZZEMPEIN12");
    expect(manifest.find((e) => e.locus === "837/NM1[0]-9")?.category).toBe(
      C.HEALTH_PLAN_BENEFICIARY,
    );
  });

  it("removes the employer party seeded in the 837 fixture (the whole-document leak check)", () => {
    const raw = readFileSync(join(FIXTURES, "837p.edi"), "utf8");
    expect(raw).toContain("ZZEMPLOYERX12"); // the sentinel is really there before the pass
    expect(raw).toContain("ZZEMPEIN12");
    const { x12 } = deidentifyX12String(raw, { context: ctx });
    expect(x12).not.toContain("ZZEMPLOYERX12");
    expect(x12).not.toContain("ZZEMPEIN12");
  });
});

describe("AC2: a party outside the scope clause is byte-identical (the negative control)", () => {
  const OUTSIDE: readonly { readonly code: string; readonly what: string }[] = [
    { code: "85", what: "billing provider" },
    { code: "82", what: "rendering provider" },
    { code: "77", what: "service facility" },
    { code: "PR", what: "payer" },
    { code: "PE", what: "payee" },
    { code: "41", what: "submitter" },
    { code: "40", what: "receiver" },
    { code: "AY", what: "clearinghouse" },
  ];

  for (const { code, what } of OUTSIDE) {
    it(`leaves an NM1*${code} (${what}) name and identifier byte-identical`, () => {
      const segment = `NM1*${code}*2*OUTSIDEPARTY LLC*****XX*1999999999~`;
      const raw = wrap(segment);
      const { x12 } = deidentifyX12String(raw, { context: ctx });
      // Not merely "the value is still somewhere": the whole segment survives byte for byte.
      expect(x12).toContain(segment.slice(0, -1));
      expect(x12).toBe(raw);
    });
  }

  it("leaves an N1 payer party byte-identical too", () => {
    const raw = wrap("N1*PR*ACME PAYER*PI*PID999~");
    expect(deidentifyX12String(raw, { context: ctx }).x12).toBe(raw);
  });
});

describe("AC3: a retained party names the role code it was classified on", () => {
  it("records the entity-identifier code at the party's own locus, value-free", () => {
    const { manifest } = deidentifyX12String(wrap("NM1*85*2*BILLINGPROV LLC*****XX*1999999999~"), {
      context: ctx,
    });
    const rows = partyRows(manifest);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row?.locus).toBe("837/NM1[0]-1"); // the party's locus: where the role code sits
    expect(row?.partyRole).toBe("85");
    expect(row?.disposition).toBe("retained");
    expect(row?.transform).toBe("retain");
    expect(row?.reidentificationCode).toBe(false);
    // And it carries no name, no identifier, no other value.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain("BILLINGPROV");
    expect(serialized).not.toContain("1999999999");
  });

  it("records the N1-01 code as readily as the NM1-01 one", () => {
    const { manifest } = deidentifyX12String(wrap("N1*PR*ACME PAYER*PI*PID999~"), { context: ctx });
    const rows = partyRows(manifest);
    expect(rows.map((e) => [e.locus, e.partyRole])).toEqual([["837/N1[0]-1", "PR"]]);
  });

  it("names one role code per retained party across a whole document", () => {
    const raw = readFileSync(join(FIXTURES, "837p.edi"), "utf8");
    const { manifest } = deidentifyX12String(raw, { context: ctx });
    expect(partyRows(manifest).map((e) => [e.locus, e.partyRole])).toEqual([
      ["837/N1[0]-1", "PR"], // the payer
      ["837/NM1[0]-1", "41"], // the submitter
      ["837/NM1[1]-1", "85"], // the billing provider
      ["837/NM1[5]-1", "82"], // the rendering provider
    ]);
  });

  it("emits no row for a retained party that carried neither a name nor an identifier", () => {
    // Nothing was left in place, so there is nothing to explain.
    const { manifest } = deidentifyX12String(wrap("NM1*85*2~"), { context: ctx });
    expect(partyRows(manifest)).toEqual([]);
  });

  it("keeps the role code out of the determiner's retained-quasi-identifier inventory", () => {
    // A party outside the scope clause is not a residual of the INDIVIDUAL's identity, so it must not
    // be inventoried beside a kept year or a safe ZIP prefix.
    const { manifest } = deidentifyX12String(wrap("NM1*85*2*BILLINGPROV LLC*****XX*1999999999~"), {
      context: ctx,
    });
    const report = buildExpertDeterminationSupportReport(manifest, { policy: "safe-harbor" });
    expect(report.retainedQuasiIdentifiers).toEqual([]);
    expect(report.dispositionSummary.retained).toBe(1);
    expect(report.perLocus.find((e) => e.locus === "837/NM1[0]-1")?.partyRole).toBe("85");
  });

  it("never carries a value into the role-code row, however the pass is driven", () => {
    const raw = readFileSync(join(FIXTURES, "837p.edi"), "utf8");
    const { manifest } = deidentifyX12String(raw, { context: ctx });
    for (const row of partyRows(manifest)) {
      // Only a code from this library's own entity-identifier table can appear here.
      expect(PROVIDER_ENTITY_CODES.has(row.partyRole ?? "")).toBe(true);
    }
  });
});

describe("AC7: a role code that cannot be established fails closed", () => {
  const UNESTABLISHED: readonly { readonly label: string; readonly nm1: string }[] = [
    { label: "unrecognized", nm1: "NM1*ZQ*2*MYSTERY PARTY*****XX*SECRETNPI~" },
    { label: "empty", nm1: "NM1**2*MYSTERY PARTY*****XX*SECRETNPI~" },
  ];

  for (const { label, nm1 } of UNESTABLISHED) {
    it(`blocks the name and the identifier of a party whose role code is ${label}`, () => {
      const { x12, manifest } = deidentifyX12String(wrap(nm1), { context: ctx });
      expect(x12).not.toContain("MYSTERY PARTY");
      expect(x12).not.toContain("SECRETNPI");
      const blocks = manifest.filter((e) => e.disposition === "blocked");
      expect(blocks.map((e) => e.locus).sort()).toEqual(["837/NM1[0]-3", "837/NM1[0]-9"]);
      // A stable disposition code, and never a retained party row.
      expect(blocks.every((e) => e.code === D.DEID_LOCUS_BLOCKED)).toBe(true);
      expect(partyRows(manifest)).toEqual([]);
    });
  }

  it("blocks an N1 party whose role code is absent", () => {
    const { x12, manifest } = deidentifyX12String(wrap("N1**MYSTERY PARTY*XX*SECRETNPI~"), {
      context: ctx,
    });
    expect(x12).not.toContain("MYSTERY PARTY");
    expect(x12).not.toContain("SECRETNPI");
    expect(manifest.every((e) => e.code !== D.DEID_PARTY_ROLE_RETAINED)).toBe(true);
  });
});

describe("AC8: the SBR-04 removal that was already correct is untouched", () => {
  it("still removes the insured group name and records it", () => {
    const { x12, manifest } = deidentifyX12String(wrap("SBR*P*18*ZZPOLICY777*ACME GROUP*****CI~"), {
      context: ctx,
    });
    expect(x12).not.toContain("ACME GROUP");
    const row = manifest.find((e) => e.locus === "837/SBR[0]-4");
    expect(row?.category).toBe(C.NAMES);
    expect(row?.disposition).toBe("removed");
  });

  it("still removes SBR-04 in the fixture, alongside the newly scrubbed employer party", () => {
    const raw = readFileSync(join(FIXTURES, "837p.edi"), "utf8");
    const { x12 } = deidentifyX12String(raw, { context: ctx });
    expect(x12).not.toContain("ZZGROUPNAME");
    expect(x12).not.toContain("ZZEMPLOYERX12");
  });
});

describe("the de-identified interchange still re-parses", () => {
  it("round-trips the fixture with the employer party in it", () => {
    const raw = readFileSync(join(FIXTURES, "837p.edi"), "utf8");
    const { x12 } = deidentifyX12String(raw, { context: ctx });
    expect(parseX12(x12).groups[0]?.transactions[0]?.st.elements[1]).toBe("837");
  });
});
