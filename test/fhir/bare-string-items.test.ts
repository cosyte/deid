/**
 * FHIR adapter on a bare string sent where an `Identifier`, an `Address` or a `HumanName` belongs: in
 * a list or on its own, at a person resource, at a contact, at a resource that is not a person, and in
 * a model built by hand. It is a shape the pass cannot locate a value in, so it is removed whole and
 * recorded, never handed through to the output. The two elements R4 itself types as a string at one of
 * those names, an organisation's own `name` and an `Endpoint`'s `address` (a url), are kept.
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

describe("a bare string where an Address or a HumanName is expected, outside a person resource", () => {
  function rows(result: { readonly manifest: readonly { locus: string; disposition: string }[] }) {
    return result.manifest.map((m) => `${m.locus} ${m.disposition}`);
  }

  it("removes it at an organisation's address, a location's address and a contact's address", () => {
    const org = run({ resourceType: "Organization", name: "ZZORGOWNNAME", address: ["ZZORGADDR"] });
    expect(org.json).toBe('{"resourceType":"Organization","name":"ZZORGOWNNAME"}');
    expect(rows(org)).toEqual(["Organization.address blocked"]);
    expect(loci(org)).toEqual(["Organization.name"]);

    const location = run({ resourceType: "Location", status: "active", address: "ZZLOCADDR" });
    expect(location.json).toBe('{"resourceType":"Location","status":"active"}');
    expect(rows(location)).toEqual(["Location.address blocked"]);

    const contact = run({
      resourceType: "Organization",
      contact: [{ address: "ZZORGCONTACTADDR" }],
    });
    expect(contact.json).not.toContain("ZZORGCONTACTADDR");
    expect(rows(contact)).toEqual(["Organization.contact[0].address blocked"]);
    expect(loci(contact)).toEqual([]);
  });

  it("removes it at the choice-type and open-type elements R4 types as an Address or a HumanName", () => {
    const claim = run({ resourceType: "Claim", accident: { locationAddress: "ZZCLAIMADDR" } });
    expect(claim.json).not.toContain("ZZCLAIMADDR");
    expect(rows(claim)).toEqual(["Claim.accident.locationAddress blocked"]);

    const params = run({
      resourceType: "Parameters",
      parameter: [
        { name: "home", valueAddress: "ZZVALUEADDR" },
        { name: "who", valueHumanName: "ZZVALUENAME" },
      ],
    });
    expect(params.json).toBe(
      '{"resourceType":"Parameters","parameter":[{"name":"home"},{"name":"who"}]}',
    );
    expect(rows(params)).toEqual([
      "Parameters.parameter[0].valueAddress blocked",
      "Parameters.parameter[1].valueHumanName blocked",
    ]);
  });

  it("removes every item of a list that mixes a string with an Address, and a null or a number", () => {
    const mixed = run({
      resourceType: "Organization",
      address: ["ZZORGADDR", { city: "ZZCITY", state: "MA" }],
    });
    expect(mixed.json).toBe('{"resourceType":"Organization"}');
    expect(rows(mixed)).toEqual([
      "Organization.address[0] blocked",
      // The reader models an object in an array that also holds a string as no object at all.
      "Organization.address[1] blocked",
    ]);

    const empty = run({ resourceType: "Location", address: null });
    expect(empty.json).toBe('{"resourceType":"Location"}');
    expect(rows(empty)).toEqual(["Location.address blocked"]);

    const numeric = run({ resourceType: "Location", address: 4 });
    expect(numeric.json).toBe('{"resourceType":"Location"}');
    expect(rows(numeric)).toEqual(["Location.address blocked"]);
  });

  it("keeps Endpoint.address, a url string in R4, on its own, in a Bundle and contained", () => {
    const url = "https://example.org/fhir/endpoint";
    const flat = run({ resourceType: "Endpoint", status: "active", address: url });
    expect(flat.json).toBe(`{"resourceType":"Endpoint","status":"active","address":"${url}"}`);
    expect(flat.manifest).toEqual([]);
    expect(loci(flat)).toEqual(["Endpoint.status", "Endpoint.address"]);

    const bundle = run({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { resource: { resourceType: "Endpoint", address: url } },
        { resource: { resourceType: "Organization", address: "ZZORGADDR" } },
      ],
    });
    expect(bundle.json).toContain(url);
    expect(bundle.json).not.toContain("ZZORGADDR");
    expect(rows(bundle)).toEqual(["Bundle.entry[1].resource.address blocked"]);

    const contained = run({
      resourceType: "Patient",
      contained: [{ resourceType: "Endpoint", address: url }],
    });
    expect(contained.json).toContain(url);
    expect(contained.manifest).toEqual([]);
  });

  it("removes a string at `address` on anything but the Endpoint itself", () => {
    // An Endpoint's own `address` is the one plain string R4 puts at that name. A backbone inside
    // some other resource that carries one is not that element, wherever the resource points.
    const out = run({
      resourceType: "Organization",
      endpoint: [{ reference: "Endpoint/ep1", address: "ZZREFADDR" }],
    });
    expect(out.json).toBe(
      '{"resourceType":"Organization","endpoint":[{"reference":"Endpoint/ep1"}]}',
    );
    expect(rows(out)).toEqual(["Organization.endpoint[0].address blocked"]);
  });

  it("removes a list nested in a list, which only a model built by hand can hold", () => {
    const resource: FhirComplex = complex([
      { name: "resourceType", value: primitive("Organization") },
      { name: "address", value: list([list([primitive("ZZORGADDR")])]) },
    ]);
    const { document, manifest, unexaminedResiduals } = deidentifyFhir(resource, { context: ctx });
    expect(serializeResource(document)).toBe('{"resourceType":"Organization"}');
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Organization.address blocked",
    ]);
    expect(unexaminedResiduals).toEqual([]);
  });

  it("still keeps an organisation's own name, a plain string R4 puts at `name`", () => {
    const out = run({ resourceType: "Location", name: "ZZLOCNAME", status: "active" });
    expect(out.json).toBe('{"resourceType":"Location","name":"ZZLOCNAME","status":"active"}');
    expect(out.manifest).toEqual([]);
  });
});
