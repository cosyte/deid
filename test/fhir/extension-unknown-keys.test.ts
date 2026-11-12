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
    const row = manifest.find((m) => m.locus === "Observation.extension[0].note");
    expect(row?.disposition).toBe("blocked");
    expect(JSON.stringify(manifest)).not.toContain("ZZEXTNOTE");
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
    expect(loci).toContain("Patient.extension[0].note");
    expect(loci).toContain("Patient.modifierExtension[0].comment");
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
    // the kept parts keep their values, their element id and the extension's url
    expect(json).toContain('"state":"IL"');
    expect(json).toContain('"country":"US"');
    expect(json).toContain('"id":"s1"');
    expect(json).toContain('"url":"http://example.org/s"');
    // a single address is located without an index, as every single occurrence is
    const loci = manifest.map((m) => m.locus);
    expect(loci).toContain("Patient.address._state.extension[0].note");
    expect(loci).toContain("Patient.address._state.extension[0].valueString");
    expect(loci).toContain("Patient.address._country.extension[0].extension[0].n");
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
    expect(loci.map((l) => l.path)).toContain("Observation.extension[0].note");
    expect(unexaminedResiduals.map((r) => r.locus)).not.toContain("Observation.extension[0].note");
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

  it("keeps an extension's url and id, which are structural", () => {
    const { json } = run({
      resourceType: "Observation",
      status: "final",
      extension: [{ id: "e1", url: "http://example.org/x", valueBoolean: true }],
    });
    expect(json).toContain('"id":"e1"');
    expect(json).toContain('"url":"http://example.org/x"');
    expect(json).not.toContain("valueBoolean");
  });
});

/**
 * Outside an extension the rule is the one the limitations page states: an unknown key on a person
 * resource's own top level is removed by the fail-closed person sweep, and an unknown key anywhere
 * else is handed through and named as an unexamined residual at its locus, never silently.
 */
describe("an unknown key elsewhere in a resource", () => {
  function residuals(resource: unknown): string[] {
    const { resource: parsed } = parseResource(JSON.stringify(resource));
    return extractFhirLoci(parsed).unexaminedResiduals.map((r) => r.locus);
  }

  it("on a person resource's own top level: removed", () => {
    const { json, manifest } = run({ resourceType: "Patient", gender: "male", zzNote: "ZZTOP" });
    expect(json).not.toContain("ZZTOP");
    expect(manifest.map((m) => m.locus)).toContain("Patient.zzNote");
  });

  it("on a clinical resource, in a backbone and in a coding: handed through and counted", () => {
    const resource = {
      resourceType: "Observation",
      status: "final",
      zzNote: "ZZCLIN1",
      code: { coding: [{ system: "http://loinc.org", code: "2951-2", zzNote: "ZZCLIN2" }] },
      component: [{ code: { text: "sodium" }, zzNote: "ZZCLIN3" }],
    };
    const { json } = run(resource);
    for (const v of ["ZZCLIN1", "ZZCLIN2", "ZZCLIN3"]) expect(json).toContain(v);
    expect(residuals(resource)).toEqual(
      expect.arrayContaining([
        "Observation.zzNote",
        "Observation.code.coding[0].zzNote",
        "Observation.component[0].zzNote",
      ]),
    );
  });

  it("on a `_`-sibling itself: not read by the parser, so it never reaches the output", () => {
    const { json } = run({
      resourceType: "Observation",
      status: "final",
      _status: { id: "s1", note: "ZZSIBLINGNOTE" },
    });
    expect(json).not.toContain("ZZSIBLINGNOTE");
    expect(json).toContain('"_status":{"id":"s1"}');
  });

  it("below a person resource's top level: handed through and counted", () => {
    const resource = {
      resourceType: "Patient",
      communication: [{ language: { text: "en" }, zzNote: "ZZPERSONDEEP" }],
    };
    const { json } = run(resource);
    expect(json).toContain("ZZPERSONDEEP");
    expect(residuals(resource)).toContain("Patient.communication[0].zzNote");
  });
});
