/**
 * FHIR adapter on a bare string sent where an `Identifier` or an `Address` belongs: in a list or on its
 * own, at a person resource, at a contact, at a resource that is not a person, and in a model built by
 * hand. It is a shape the pass cannot locate a value in, so it is removed whole and recorded, never
 * handed through to the output.
 *
 * All values are synthetic `ZZ` sentinels.
 */

import { complex, list, primitive, serializeResource, type FhirComplex } from "@cosyte/fhir";
import { describe, expect, it } from "vitest";

import { createDeidContext, SAFE_HARBOR_CATEGORIES } from "../../src/index.js";
import { deidentifyFhir, deidentifyFhirJson } from "../../src/fhir/index.js";

const ctx = createDeidContext({ key: "bare-string-key-synthetic-hmac", patientId: "p" });
const C = SAFE_HARBOR_CATEGORIES;

function run(resource: unknown) {
  return deidentifyFhirJson(JSON.stringify(resource), { context: ctx });
}

function loci(result: { readonly unexaminedResiduals: readonly { locus: string }[] }): string[] {
  return result.unexaminedResiduals.map((r) => r.locus);
}

describe("a bare string where an Identifier or an Address is expected", () => {
  it("removes it and records the removal, in a list or on its own, at the patient or a contact", () => {
    const out = run({
      resourceType: "Patient",
      identifier: ["ZZBAREIDLIST", { system: "http://example.org/mrn", value: "ZZIDOBJECT" }],
      address: "ZZBAREADDRESS",
      contact: [{ address: ["ZZCONTACTADDRESS"] }],
    });
    expect(out.json).not.toContain("ZZBARE");
    expect(out.json).not.toContain("ZZIDOBJECT");
    expect(out.json).not.toContain("ZZCONTACTADDRESS");
    expect(out.manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Patient.identifier[0] blocked",
      // The reader models an object in an array that also holds a string as no object at all, so it
      // is removed whole as well.
      "Patient.identifier[1] blocked",
      "Patient.address blocked",
      "Patient.contact[0].address blocked",
    ]);
    expect(loci(out)).toEqual([]);
  });

  it("removes one on a resource that is not a person, where identifier is still read", () => {
    const out = run({ resourceType: "Observation", status: "final", identifier: "ZZOBSIDSTRING" });
    expect(out.json).toBe('{"resourceType":"Observation","status":"final"}');
    expect(out.manifest).toEqual([
      expect.objectContaining({
        locus: "Observation.identifier",
        disposition: "blocked",
        category: C.OTHER_UNIQUE_ID,
      }),
    ]);
  });

  it("removes one in a model built by hand", () => {
    const resource: FhirComplex = complex([
      { name: "resourceType", value: primitive("Patient") },
      { name: "identifier", value: list([primitive("ZZBAREIDENTIFIER")]) },
      { name: "address", value: list([primitive("ZZBAREADDRESS")]) },
    ]);
    const { document, manifest } = deidentifyFhir(resource, { context: ctx });
    expect(serializeResource(document)).toBe('{"resourceType":"Patient"}');
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Patient.identifier blocked",
      "Patient.address blocked",
    ]);
  });
});
