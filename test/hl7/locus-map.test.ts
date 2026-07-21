/**
 * Unit tests for the HL7 v2 locus map — the CX-5 identifier-type routing and the map's shape.
 */

import { describe, expect, it } from "vitest";

import { SAFE_HARBOR_CATEGORIES } from "../../src/index.js";
import { HL7_LOCUS_MAP, categoryForIdentifierType } from "../../src/hl7/index.js";

const C = SAFE_HARBOR_CATEGORIES;

describe("categoryForIdentifierType — HL7 Table 0203 routing", () => {
  it("routes each known identifier-type code to its Safe Harbor category", () => {
    expect(categoryForIdentifierType("SS", C.MRN)).toBe(C.SSN);
    expect(categoryForIdentifierType("MR", C.MRN)).toBe(C.MRN);
    expect(categoryForIdentifierType("PI", C.MRN)).toBe(C.MRN);
    expect(categoryForIdentifierType("AN", C.MRN)).toBe(C.ACCOUNT);
    expect(categoryForIdentifierType("AC", C.MRN)).toBe(C.ACCOUNT);
    expect(categoryForIdentifierType("MA", C.MRN)).toBe(C.HEALTH_PLAN_BENEFICIARY);
    expect(categoryForIdentifierType("MC", C.MRN)).toBe(C.HEALTH_PLAN_BENEFICIARY);
    expect(categoryForIdentifierType("PN", C.MRN)).toBe(C.HEALTH_PLAN_BENEFICIARY);
    expect(categoryForIdentifierType("DL", C.MRN)).toBe(C.CERTIFICATE_LICENSE);
  });

  it("is case-insensitive", () => {
    expect(categoryForIdentifierType("ss", C.MRN)).toBe(C.SSN);
  });

  it("falls back to the supplied category on an unrecognized or absent code", () => {
    expect(categoryForIdentifierType("ZZ", C.ACCOUNT)).toBe(C.ACCOUNT);
    expect(categoryForIdentifierType(undefined, C.MRN)).toBe(C.MRN);
    expect(categoryForIdentifierType("", C.HEALTH_PLAN_BENEFICIARY)).toBe(
      C.HEALTH_PLAN_BENEFICIARY,
    );
  });
});

describe("HL7_LOCUS_MAP — shape", () => {
  it("maps the five relative-bearing PHI segments and nothing else", () => {
    expect(Object.keys(HL7_LOCUS_MAP).sort()).toEqual(["GT1", "IN1", "IN2", "NK1", "PID"]);
  });

  it("types PID-5 as a name and PID-7 as a date", () => {
    expect(HL7_LOCUS_MAP["PID"]?.find((r) => r.field === 5)?.category).toBe(C.NAMES);
    expect(HL7_LOCUS_MAP["PID"]?.find((r) => r.field === 7)?.mode).toBe("date");
  });

  it("only the PID-3 identifier list routes by CX-5 type code", () => {
    const routed = Object.values(HL7_LOCUS_MAP)
      .flat()
      .filter((r) => r.routeByTypeCode === true);
    expect(routed).toHaveLength(1);
    expect(HL7_LOCUS_MAP["PID"]?.find((r) => r.field === 3)?.routeByTypeCode).toBe(true);
  });
});
