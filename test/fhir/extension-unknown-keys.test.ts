/**
 * An extension is caller-defined, so a key inside one that is not `url`, `id`, `extension`,
 * `modifierExtension` or a `value[x]` (an unknown key such as `note`) is a place a producer can put
 * any free text. It is blocked like an extension value: on every resource, at every depth, inside a
 * modifier extension and inside a primitive's `_`-sibling extension, under every profile and with
 * every option at its default, with a manifest row that names the position and carries no value.
 *
 * Every value here is synthetic (`ZZ` tokens, example.org urls).
 */

import { describe, expect, it } from "vitest";
import { parseResource } from "@cosyte/fhir";

import {
  createDeidContext,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_PROFILE,
} from "../../src/index.js";
import { deidentifyFhirJson, extractFhirLoci } from "../../src/fhir/index.js";

const ctx = createDeidContext({ key: "extension-unknown-key-synthetic-hmac", patientId: "p" });

function run(resource: unknown, options = {}) {
  return deidentifyFhirJson(JSON.stringify(resource), { context: ctx, ...options });
}

const UNKNOWN = { url: "http://example.org/x", note: "ZZEXTNOTE" };

describe("an unknown key inside an extension is blocked", () => {
  it("on a clinical resource: removed, the url kept, a value-free blocked row at its position", () => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: "final",
      extension: [UNKNOWN],
    });
    expect(json).not.toContain("ZZEXTNOTE");
    expect(json).toContain('"url":"http://example.org/x"');
    const row = manifest.find((m) => m.locus === "Observation.extension[0].<withheld>[1]");
    expect(row?.disposition).toBe("blocked");
    expect(JSON.stringify(manifest)).not.toContain("ZZEXTNOTE");
    // the row names the key's position, never the key the sender chose
    expect(JSON.stringify(manifest)).not.toContain("note");
  });

  it("on a person resource and in a modifier extension", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      extension: [UNKNOWN],
      modifierExtension: [{ url: "http://example.org/m", comment: "ZZMODNOTE" }],
    });
    expect(json).not.toContain("ZZEXTNOTE");
    expect(json).not.toContain("ZZMODNOTE");
    const loci = manifest.map((m) => m.locus);
    expect(loci).toContain("Patient.extension[0].<withheld>[1]");
    expect(loci).toContain("Patient.modifierExtension[0].<withheld>[1]");
  });

  it("at every depth: a nested extension, a backbone, a contained resource, a Bundle entry", () => {
    const { json } = run({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          resource: {
            resourceType: "Observation",
            status: "final",
            extension: [{ url: "http://example.org/o", extension: [{ url: "in", zz: "ZZDEEP1" }] }],
            component: [
              {
                code: { coding: [{ system: "http://loinc.org", code: "2951-2" }] },
                modifierExtension: [{ url: "http://example.org/c", remark: "ZZDEEP2" }],
              },
            ],
            contained: [
              {
                resourceType: "Organization",
                extension: [
                  {
                    url: "http://example.org/g",
                    modifierExtension: [{ url: "in", text: "ZZDEEP3" }],
                  },
                ],
              },
            ],
          },
        },
      ],
    });
    expect(json).not.toContain("ZZDEEP1");
    expect(json).not.toContain("ZZDEEP2");
    expect(json).not.toContain("ZZDEEP3");
  });

  it("removes an unknown key that holds a structure, whole", () => {
    const { json } = run({
      resourceType: "Observation",
      status: "final",
      extension: [{ url: "http://example.org/x", detail: { who: "ZZOBJ", list: ["ZZLIST"] } }],
    });
    expect(json).not.toContain("ZZOBJ");
    expect(json).not.toContain("ZZLIST");
    expect(json).not.toContain('"detail"');
  });

  it("inside a primitive's `_`-sibling extension, a kept address part's included", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      gender: "female",
      _gender: { extension: [{ url: "http://example.org/g", note: "ZZGENDERNOTE" }] },
      address: [
        {
          state: "IL",
          _state: {
            id: "s1",
            extension: [
              { url: "http://example.org/s", note: "ZZSTATENOTE", valueString: "ZZSTATEVALUE" },
            ],
          },
          country: "US",
          _country: {
            extension: [{ url: "http://example.org/c", extension: [{ url: "in", n: "ZZCNOTE" }] }],
          },
          postalCode: "62704",
        },
      ],
    });
    expect(json).not.toContain("ZZGENDERNOTE");
    expect(json).not.toContain("ZZSTATENOTE");
    expect(json).not.toContain("ZZSTATEVALUE");
    expect(json).not.toContain("ZZCNOTE");
    // the kept parts keep their values and the extension's url; their element id is replaced
    expect(json).toContain('"state":"IL"');
    expect(json).toContain('"country":"US"');
    expect(json).not.toContain('"id":"s1"');
    expect(json).toMatch(/"_state":\{"id":"\d+"/);
    expect(json).toContain('"url":"http://example.org/s"');
    // a single address is located without an index, as every single occurrence is
    const loci = manifest.map((m) => m.locus);
    expect(loci).toContain("Patient.address._state.extension[0].<withheld>[1]");
    expect(loci).toContain("Patient.address._state.extension[0].valueString");
    expect(loci).toContain("Patient.address._country.extension[0].extension[0].<withheld>[1]");
    expect(JSON.stringify(manifest)).not.toMatch(/ZZ(STATE|C)(NOTE|VALUE)/);
  });

  it("records nothing for an extension on a part the address drops: the part goes whole", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      address: [
        {
          city: "Springfield",
          _city: { extension: [{ url: "http://example.org/c", note: "ZZCITYNOTE" }] },
          state: "IL",
          postalCode: "62704",
        },
      ],
    });
    expect(json).not.toContain("ZZCITYNOTE");
    expect(json).not.toContain("Springfield");
    expect(manifest.map((m) => m.locus).filter((l) => l.includes("_"))).toEqual([]);
  });

  it.each([
    ["an object", { a: "ZZPARTOBJ" }],
    ["an array", ["ZZPARTARR"]],
    ["a number", 900000007],
    ["a boolean", true],
  ])("blocks a kept address part that arrives as %s, on a person resource", (_name, part) => {
    const { json, manifest } = run({
      resourceType: "Patient",
      address: [{ state: part, country: part, postalCode: "62704" }],
    });
    expect(json).not.toMatch(/ZZPART|90000000|true/);
    expect(JSON.parse(json)).toEqual({ resourceType: "Patient", address: [{ postalCode: "627" }] });
    const loci = manifest.map((m) => m.locus);
    expect(loci).toContain("Patient.address.state");
    expect(loci).toContain("Patient.address.country");
    expect(JSON.stringify(manifest)).not.toMatch(/ZZPART|90000000/);
    const { resource } = parseResource(
      JSON.stringify({ resourceType: "Patient", address: [{ state: part, postalCode: "62704" }] }),
    );
    expect(extractFhirLoci(resource).unexaminedResiduals).toEqual([]);
  });

  it("counts what a kept string part hands through: its extension's url, not its replaced id", () => {
    const { resource } = parseResource(
      JSON.stringify({
        resourceType: "Patient",
        address: [
          {
            state: "IL",
            _state: {
              id: "s1",
              extension: [{ url: "http://example.org/s", valueString: "ZZSTATEVALUE" }],
            },
            postalCode: "62704",
            _postalCode: { id: "z1" },
          },
        ],
      }),
    );
    expect(
      extractFhirLoci(resource)
        .unexaminedResiduals.map((r) => r.locus)
        .sort(),
    ).toEqual(["Patient.address[0]._state.extension[0].url"]);
  });

  it("counts nothing of a blocked kept part, its element id included", () => {
    const { resource } = parseResource(
      JSON.stringify({
        resourceType: "Patient",
        address: [{ state: 900000009, _state: { id: "s9" }, postalCode: "62704" }],
      }),
    );
    expect(extractFhirLoci(resource).unexaminedResiduals).toEqual([]);
    const { json } = run({
      resourceType: "Patient",
      address: [{ state: 900000009, _state: { id: "s9" }, postalCode: "62704" }],
    });
    expect(json).not.toMatch(/900000009|s9/);
  });

  it("removes a swept address whose kept part is a number or a boolean", () => {
    const { json } = run({
      resourceType: "Organization",
      address: [{ city: "ZZCITY", state: 900000008, country: false, postalCode: "62704" }],
    });
    expect(json).not.toMatch(/ZZCITY|90000000|false/);
    // removed whole, as a swept address carrying an object there is: no ZIP fragment either
    expect(JSON.parse(json)).toEqual({ resourceType: "Organization" });
  });

  it("writes no empty extension list on a kept address part", () => {
    const { json } = run({
      resourceType: "Patient",
      address: [{ state: "IL", _state: { extension: [] }, postalCode: "62704" }],
    });
    expect(JSON.parse(json)).toEqual({
      resourceType: "Patient",
      address: [{ state: "IL", postalCode: "627" }],
    });
  });

  it.each([
    ["safe harbor", SAFE_HARBOR_PROFILE],
    ["limited data set", LIMITED_DATA_SET_PROFILE],
  ])("under the %s profile", (_name, profile) => {
    const { json } = deidentifyFhirJson(
      JSON.stringify({ resourceType: "Observation", status: "final", extension: [UNKNOWN] }),
      profileOptions(profile, ctx),
    );
    expect(json).not.toContain("ZZEXTNOTE");
  });

  it("is a located block, not an unexamined residual", () => {
    const { resource } = parseResource(
      JSON.stringify({ resourceType: "Observation", status: "final", extension: [UNKNOWN] }),
    );
    const { loci, unexaminedResiduals } = extractFhirLoci(resource);
    expect(loci.map((l) => l.path)).toContain("Observation.extension[0].<withheld>[1]");
    expect(unexaminedResiduals.map((r) => r.locus)).not.toContain(
      "Observation.extension[0].<withheld>[1]",
    );
  });

  it("blocks a url or an id that is not a single string", () => {
    const { json } = run({
      resourceType: "Observation",
      status: "final",
      extension: [{ id: { who: "ZZODDID" }, url: ["ZZODDURL"] }],
    });
    expect(json).not.toContain("ZZODDID");
    expect(json).not.toContain("ZZODDURL");
  });

  it.each([
    ["a number at the id", { url: "http://example.org/x", id: 900000001 }, "id"],
    ["a boolean at the id", { url: "http://example.org/x", id: true }, "id"],
    ["a number at the url", { url: 900000002 }, "url"],
    ["a boolean at the url", { url: false }, "url"],
  ])("blocks %s, with a value-free row at its position", (_name, ext, key) => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: "final",
      extension: [ext],
    });
    expect(json).not.toContain("90000000");
    // An extension left with nothing in it is removed whole, as every emptied element is.
    const out = JSON.parse(json) as { extension?: Record<string, unknown>[] };
    expect(out.extension?.[0] ?? {}).not.toHaveProperty(key);
    if (key === "url") expect(out).not.toHaveProperty("extension");
    const row = manifest.find((m) => m.locus === `Observation.extension[0].${key}`);
    expect(row?.disposition).toBe("blocked");
    expect(JSON.stringify(manifest)).not.toContain("90000000");
  });

  it("blocks a number or a boolean at the url or id of an extension on a kept address part", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      address: [
        {
          state: "IL",
          _state: { extension: [{ url: 900000003, id: true }] },
          country: "US",
          _country: { extension: [{ url: "http://example.org/c", id: 900000004 }] },
          postalCode: "62704",
        },
      ],
    });
    expect(json).not.toContain("90000000");
    expect(json).not.toContain("true");
    expect(json).toContain('"url":"http://example.org/c"');
    // The `_state` extension left with nothing in it is not written as `{}`.
    expect(json).not.toContain("{}");
    const loci = manifest.map((m) => m.locus);
    expect(loci).toContain("Patient.address._state.extension[0].url");
    expect(loci).toContain("Patient.address._state.extension[0].id");
    expect(loci).toContain("Patient.address._country.extension[0].id");
  });

  it("blocks a url or an id that is not a string inside the patient-animal extension", () => {
    const { json } = run(
      {
        resourceType: "Patient",
        extension: [
          {
            url: "http://hl7.org/fhir/StructureDefinition/patient-animal",
            id: 900000005,
            extension: [
              {
                url: "species",
                id: 900000006,
                valueCodeableConcept: { coding: [{ system: "http://example.org/s", code: "z" }] },
              },
            ],
          },
        ],
      },
      { keepPatientAnimal: true },
    );
    expect(json).not.toContain("90000000");
    expect(json).toContain('"code":"z"');
  });

  it("keeps an extension's url, which is structural, and replaces its id", () => {
    const { json } = run({
      resourceType: "Observation",
      status: "final",
      extension: [{ id: "e1", url: "http://example.org/x", valueBoolean: true }],
    });
    expect(json).not.toContain('"id":"e1"');
    expect(json).toMatch(/"extension":\[\{"id":"\d+"/);
    expect(json).toContain('"url":"http://example.org/x"');
    expect(json).not.toContain("valueBoolean");
  });
});

/**
 * Outside an extension the rule is the same: an unknown key is blocked at any depth of any resource,
 * with a value-free row at its locus, and is no longer an unexamined residual
 * (`./unknown-keys.test.ts` has the rest).
 */
describe("an unknown key elsewhere in a resource", () => {
  function residuals(resource: unknown): string[] {
    const { resource: parsed } = parseResource(JSON.stringify(resource));
    return extractFhirLoci(parsed).unexaminedResiduals.map((r) => r.locus);
  }

  it("on a person resource's own top level: removed", () => {
    const { json, manifest } = run({ resourceType: "Patient", gender: "male", zzNote: "ZZTOP" });
    expect(json).not.toContain("ZZTOP");
    expect(manifest.map((m) => m.locus)).toContain("Patient.<withheld>[2]");
  });

  it("on a clinical resource, in a backbone and in a coding: removed, not counted", () => {
    const resource = {
      resourceType: "Observation",
      status: "final",
      zzNote: "ZZCLIN1",
      code: { coding: [{ system: "http://loinc.org", code: "2951-2", zzNote: "ZZCLIN2" }] },
      component: [{ code: { text: "sodium" }, zzNote: "ZZCLIN3" }],
    };
    const { json, manifest } = run(resource);
    for (const v of ["ZZCLIN1", "ZZCLIN2", "ZZCLIN3"]) expect(json).not.toContain(v);
    const loci = [
      "Observation.<withheld>[2]",
      "Observation.code.coding[0].<withheld>[2]",
      "Observation.component[0].<withheld>[1]",
    ];
    expect(manifest.map((m) => m.locus)).toEqual(expect.arrayContaining(loci));
    for (const locus of loci) expect(residuals(resource)).not.toContain(locus);
  });

  it("on a `_`-sibling itself: not read by the parser, so it never reaches the output", () => {
    const { json } = run({
      resourceType: "Observation",
      status: "final",
      _status: { id: "s1", note: "ZZSIBLINGNOTE" },
    });
    expect(json).not.toContain("ZZSIBLINGNOTE");
    expect(json).toMatch(/"_status":\{"id":"\d+"\}/);
  });

  it("below a person resource's top level: removed, not counted", () => {
    const resource = {
      resourceType: "Patient",
      communication: [{ language: { text: "en" }, zzNote: "ZZPERSONDEEP" }],
    };
    const { json, manifest } = run(resource);
    expect(json).not.toContain("ZZPERSONDEEP");
    expect(manifest.map((m) => m.locus)).toContain("Patient.communication[0].<withheld>[1]");
    expect(residuals(resource)).not.toContain("Patient.communication[0].<withheld>[1]");
  });
});
