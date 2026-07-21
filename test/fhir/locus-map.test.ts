/**
 * FHIR locus-map unit tests — the cited, structural routing decisions the extractor relies on: the
 * person-resource set, identifier-system → category routing (SSN vs MRN), the date-value knife-edge
 * (a real calendar date is generalized; a clinical code that merely looks date-ish is not), and the
 * demographic element map.
 */

import { describe, expect, it } from "vitest";

import { SAFE_HARBOR_CATEGORIES } from "../../src/index.js";
import {
  FHIR_DEMOGRAPHIC_ELEMENTS,
  PERSON_RESOURCE_TYPES,
  categoryForIdentifierSystem,
  isFhirDateValue,
} from "../../src/fhir/locus-map.js";

const C = SAFE_HARBOR_CATEGORIES;

describe("PERSON_RESOURCE_TYPES", () => {
  it("covers the four identifying resources and excludes clinical/administrative ones", () => {
    for (const t of ["Patient", "RelatedPerson", "Practitioner", "Person"]) {
      expect(PERSON_RESOURCE_TYPES.has(t)).toBe(true);
    }
    for (const t of ["Observation", "Encounter", "Organization", "Location", "Bundle"]) {
      expect(PERSON_RESOURCE_TYPES.has(t)).toBe(false);
    }
  });
});

describe("categoryForIdentifierSystem", () => {
  it("routes a US-SSN system (URL and OID forms) to SSN", () => {
    expect(categoryForIdentifierSystem("http://hl7.org/fhir/sid/us-ssn")).toBe(C.SSN);
    expect(categoryForIdentifierSystem("urn:oid:2.16.840.1.113883.4.1")).toBe(C.SSN);
  });

  it("defaults every other / absent identifier system to MRN (pseudonymized)", () => {
    expect(categoryForIdentifierSystem("http://hospital.example/mrn")).toBe(C.MRN);
    expect(categoryForIdentifierSystem("http://hl7.org/fhir/sid/us-npi")).toBe(C.MRN);
    expect(categoryForIdentifierSystem("urn:vendor:weird")).toBe(C.MRN);
    expect(categoryForIdentifierSystem(undefined)).toBe(C.MRN);
  });
});

describe("isFhirDateValue — the date/over-scrub knife-edge", () => {
  it("recognizes real calendar dates, dateTimes, and instants (month precision or finer)", () => {
    for (const v of [
      "2019-03",
      "2019-03-14",
      "2019-03-14T09:32:00Z",
      "2019-03-14T09:32:00+05:00",
    ]) {
      expect(isFhirDateValue(v)).toBe(true);
    }
  });

  it("does NOT treat a bare year, a code, or an impossible date as a date (no over-scrub)", () => {
    expect(isFhirDateValue("1985")).toBe(false); // year only — already Safe-Harbor-safe
    expect(isFhirDateValue("2951-2")).toBe(false); // a LOINC code (one-digit tail)
    expect(isFhirDateValue("1234-56")).toBe(false); // impossible month 56 — a local code, not a date
    expect(isFhirDateValue("2020-13-01")).toBe(false); // impossible month 13
    expect(isFhirDateValue("2020-06-40")).toBe(false); // impossible day 40
    expect(isFhirDateValue("140")).toBe(false); // a numeric result value
    expect(isFhirDateValue("")).toBe(false);
  });
});

describe("FHIR_DEMOGRAPHIC_ELEMENTS", () => {
  it("maps the person demographic datatypes to their handling mode", () => {
    expect(FHIR_DEMOGRAPHIC_ELEMENTS["name"]).toBe("redact");
    expect(FHIR_DEMOGRAPHIC_ELEMENTS["telecom"]).toBe("redact");
    expect(FHIR_DEMOGRAPHIC_ELEMENTS["photo"]).toBe("redact");
    expect(FHIR_DEMOGRAPHIC_ELEMENTS["address"]).toBe("address");
    expect(FHIR_DEMOGRAPHIC_ELEMENTS["gender"]).toBeUndefined(); // a code, never redacted
  });
});
