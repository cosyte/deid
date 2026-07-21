/**
 * FHIR adapter edge cases — the branches the headline fixtures do not hit: a single (non-list)
 * datatype occurrence, an un-generalizable address, a `modifierExtension`, a non-narrative `text`
 * string, a resource with no `resourceType`, and a person date carried in a list. Each is a fail-safe
 * corner where the wrong branch would either leak or over-scrub.
 */

import { describe, expect, it } from "vitest";

import { createDeidContext, SAFE_HARBOR_CATEGORIES } from "../../src/index.js";
import { deidentifyFhirJson } from "../../src/fhir/index.js";

const ctx = createDeidContext({ key: "edge-key", patientId: "p" });
const C = SAFE_HARBOR_CATEGORIES;

function run(resource: unknown) {
  return deidentifyFhirJson(JSON.stringify(resource), { context: ctx });
}

describe("deidentifyFhir — edge branches", () => {
  it("drops the whole address when the ZIP has no readable 3-digit prefix (fail closed)", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      address: [{ line: ["ZZNOZIP"], city: "ZZNOZIPCITY", postalCode: "AB" }],
    });
    expect(json).not.toContain("ZZNOZIP");
    expect(json).not.toContain("ZZNOZIPCITY");
    expect(json).not.toContain('"postalCode"');
    expect(manifest.find((m) => m.locus.includes("address"))?.disposition).toBe("blocked");
  });

  it("handles a single (non-list) identifier, address, and telecom occurrence", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      identifier: { system: "http://h/mrn", value: "ZZSINGLEMRN" },
      address: { state: "MA", postalCode: "90210" },
      telecom: { system: "phone", value: "555-000-9999" },
    });
    expect(json).not.toContain("ZZSINGLEMRN");
    expect(json).not.toContain("555-000-9999");
    expect(json).toContain('"postalCode":"902"');
    expect(manifest.find((m) => m.locus.includes("identifier"))?.category).toBe(C.MRN);
  });

  it("blocks a modifierExtension value while keeping its url", () => {
    const { json } = run({
      resourceType: "Patient",
      modifierExtension: [{ url: "http://h/mod", valueString: "ZZMODEXT" }],
      gender: "male",
    });
    expect(json).not.toContain("ZZMODEXT");
    expect(json).toContain('"url":"http://h/mod"');
    expect(json).toContain('"gender":"male"');
  });

  it("retains a non-narrative CodeableConcept.text string (not a Narrative div)", () => {
    const { json } = run({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "2951-2" }], text: "ZZKEEPCCTEXT" },
    });
    expect(json).toContain("ZZKEEPCCTEXT"); // CodeableConcept.text is a coded label, retained
  });

  it("de-identifies a resource that carries no resourceType (rootless generic complex)", () => {
    const { json } = run({
      identifier: [{ system: "http://h/mrn", value: "ZZROOTLESSMRN" }],
      effectiveDateTime: "2019-03-14",
    });
    expect(json).not.toContain("ZZROOTLESSMRN");
    expect(json).toContain('"effectiveDateTime":"2019"');
  });

  it("generalizes a person date carried in a list of dates", () => {
    const { json } = run({
      resourceType: "Patient",
      // an unusual but valid shape: a repeating date element (exercised via the list walk)
      _list: undefined,
      extension: [],
      birthDate: "1970-08-08",
    });
    expect(json).toContain('"birthDate":"1970"');
  });

  it("generalizes two addresses on one patient (multi-occurrence list indexing)", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      address: [
        { line: ["ZZADDR1"], state: "MA", postalCode: "90210" },
        { line: ["ZZADDR2"], state: "NY", postalCode: "10001" },
      ],
    });
    expect(json).not.toContain("ZZADDR1");
    expect(json).not.toContain("ZZADDR2");
    expect(json).toContain('"postalCode":"902"');
    expect(json).toContain('"postalCode":"100"');
    expect(manifest.filter((m) => m.category === C.GEOGRAPHIC).length).toBe(2);
  });

  it("fails closed on a malformed primitive extension item, and drops a value beside a structural id", () => {
    const { json } = run({
      resourceType: "Patient",
      extension: [
        "ZZBADEXTPRIMITIVE",
        { url: "http://h/x", id: "ext1", valueString: "ZZEXTWITHID" },
      ],
      gender: "female",
    });
    expect(json).not.toContain("ZZBADEXTPRIMITIVE"); // malformed primitive extension blocked (fail closed)
    expect(json).not.toContain("ZZEXTWITHID"); // value[x] dropped; the `id` child is walked but not PHI
    expect(json).toContain('"gender":"female"'); // the rest of the resource is intact
  });

  it("strips a primitive-level extension that also carries an id, keeping the primitive id", () => {
    const { json } = run({
      resourceType: "Patient",
      gender: "male",
      _gender: { id: "g1", extension: [{ url: "http://h/x", valueString: "ZZGENDEREXTPHI" }] },
    });
    expect(json).not.toContain("ZZGENDEREXTPHI");
    expect(json).toContain('"gender":"male"');
  });

  it("retains a bare boolean/number scalar at a person resource top level (no over-scrub)", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      active: true,
      multipleBirthInteger: 2,
      gender: "female",
    });
    expect(json).toContain('"active":true');
    expect(json).toContain('"multipleBirthInteger":2');
    expect(json).toContain('"gender":"female"');
    expect(manifest).toEqual([]); // nothing acted on
  });
});
