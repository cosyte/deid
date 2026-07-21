/**
 * Unit tests for the cited C-CDA locus map — the element-type rules, the retain (over-scrub) predicate,
 * the document-envelope set, and the SSN-vs-MRN id-root routing.
 */

import { describe, expect, it } from "vitest";

import { SAFE_HARBOR_CATEGORIES } from "../../src/index.js";
import {
  CCDA_ENVELOPE_ELEMENTS,
  CCDA_LOCUS_MAP,
  categoryForIdRoot,
  isRetainedCcdaElement,
} from "../../src/ccda/index.js";

const C = SAFE_HARBOR_CATEGORIES;

describe("CCDA_LOCUS_MAP", () => {
  it("maps the person PHI element types to their Safe Harbor category + mode", () => {
    expect(CCDA_LOCUS_MAP["name"]).toEqual({ mode: "name", category: C.NAMES });
    expect(CCDA_LOCUS_MAP["telecom"]).toEqual({ mode: "telecom", category: C.PHONE });
    expect(CCDA_LOCUS_MAP["addr"]).toEqual({ mode: "addr", category: C.GEOGRAPHIC });
    expect(CCDA_LOCUS_MAP["birthTime"]).toEqual({ mode: "date", category: C.DATES });
    expect(CCDA_LOCUS_MAP["time"]).toEqual({ mode: "date", category: C.DATES });
    expect(CCDA_LOCUS_MAP["effectiveTime"]).toEqual({ mode: "date", category: C.DATES });
    expect(CCDA_LOCUS_MAP["id"]).toEqual({ mode: "id", category: C.MRN });
  });
});

describe("isRetainedCcdaElement — the over-scrub guard", () => {
  it("retains coded/administrative elements untouched", () => {
    for (const el of [
      "code",
      "administrativeGenderCode",
      "raceCode",
      "ethnicGroupCode",
      "maritalStatusCode",
      "statusCode",
      "confidentialityCode",
      "languageCode",
      "templateId",
      "realmCode",
      "typeId",
      "assignedAuthoringDevice",
    ]) {
      expect(isRetainedCcdaElement(el)).toBe(true);
    }
  });

  it("does not retain PHI-bearing or unknown elements", () => {
    for (const el of ["name", "addr", "telecom", "birthTime", "streetAddressLine", "vendorNote"]) {
      expect(isRetainedCcdaElement(el)).toBe(false);
    }
  });
});

describe("CCDA_ENVELOPE_ELEMENTS", () => {
  it("treats the document envelope (like HL7 MSH) as retained", () => {
    expect(CCDA_ENVELOPE_ELEMENTS.has("id")).toBe(true);
    expect(CCDA_ENVELOPE_ELEMENTS.has("code")).toBe(true);
    expect(CCDA_ENVELOPE_ELEMENTS.has("title")).toBe(true);
    expect(CCDA_ENVELOPE_ELEMENTS.has("setId")).toBe(true);
    expect(CCDA_ENVELOPE_ELEMENTS.has("recordTarget")).toBe(false);
    expect(CCDA_ENVELOPE_ELEMENTS.has("effectiveTime")).toBe(false); // the document date is generalized
  });
});

describe("categoryForIdRoot — structural SSN-vs-MRN routing", () => {
  it("routes the SSN assigning-authority OID to the SSN category", () => {
    expect(categoryForIdRoot("2.16.840.1.113883.4.1")).toBe(C.SSN);
  });

  it("defaults every other (or absent) root to MRN (consistent surrogate)", () => {
    expect(categoryForIdRoot("2.16.840.1.113883.19.5")).toBe(C.MRN);
    expect(categoryForIdRoot("2.16.840.1.113883.4.6")).toBe(C.MRN); // NPI
    expect(categoryForIdRoot(undefined)).toBe(C.MRN);
  });
});
