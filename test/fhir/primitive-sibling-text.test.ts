/**
 * FHIR JSON gives a primitive's `_`-sibling an `Element` object (its `id` and `extension`) and
 * nothing else. When the sibling arrives as a string, a number, a boolean, a `null` or a list where
 * none belongs, the reader models no metadata from it but keeps its text so that the writer can hand
 * it back. That text is under a key the producer chose, so it can carry anything: it is removed from
 * every primitive the pass writes back, on every resource and at every depth, and recorded as a block
 * at the `_`-sibling's own locus with a manifest row that carries no value.
 *
 * Every value here is synthetic (`ZZ` tokens, example.org urls).
 */

import { describe, expect, it } from "vitest";
import { parseResource } from "@cosyte/fhir";

import { createDeidContext } from "../../src/index.js";
import { applyFhir, deidentifyFhirJson, extractFhirLoci } from "../../src/fhir/index.js";

const ctx = createDeidContext({ key: "primitive-sibling-text-synthetic-hmac", patientId: "p" });
const S = "ZZSIBLINGTEXT";
const ANIMAL_URL = "http://hl7.org/fhir/StructureDefinition/patient-animal";

function run(resource: unknown, options = {}) {
  return deidentifyFhirJson(JSON.stringify(resource), { context: ctx, ...options });
}

/** The output, read back, and the manifest as text: neither may hold the sibling text. */
function expectGone(result: ReturnType<typeof run>, text = S): void {
  expect(result.json).not.toContain(text);
  expect(JSON.stringify(result.manifest)).not.toContain(text);
}

/** The blocked row at a locus. */
function rowAt(result: ReturnType<typeof run>, locus: string) {
  return result.manifest.find((m) => m.locus === locus);
}

const observation = (extra: Record<string, unknown>) => ({
  resourceType: "Observation",
  status: "final",
  code: { text: "sodium" },
  ...extra,
});

describe("a `_`-sibling that is not an object, inside an extension", () => {
  it.each([
    ["the url of an extension", { extension: [{ url: "u", _url: S }] }, "extension[0]._url"],
    ["the id of an extension", { extension: [{ url: "u", id: "e1", _id: S }] }, "extension[0]._id"],
    [
      "the url of a modifier extension",
      { modifierExtension: [{ url: "u", _url: S }] },
      "modifierExtension[0]._url",
    ],
    [
      "the url of a nested extension",
      { extension: [{ url: "u", extension: [{ url: "v", _url: S }] }] },
      "extension[0].extension[0]._url",
    ],
  ])("is removed and recorded at %s", (_name, extra, locus) => {
    const result = run(observation(extra));
    expectGone(result);
    expect(rowAt(result, `Observation.${locus}`)?.disposition).toBe("blocked");
    // the url the sibling sat beside is kept
    expect(result.json).toContain('"url":"u"');
  });

  it.each([false, true])(
    "is removed on the patient-animal species url, keepPatientAnimal %s",
    (keepPatientAnimal) => {
      const result = run(
        {
          resourceType: "Patient",
          extension: [
            {
              url: ANIMAL_URL,
              extension: [
                {
                  url: "species",
                  _url: S,
                  valueCodeableConcept: {
                    coding: [{ system: "http://example.org/zz-animal", code: "zzdog" }],
                  },
                },
              ],
            },
          ],
        },
        { keepPatientAnimal },
      );
      expectGone(result);
      expect(rowAt(result, "Patient.extension[0].extension[0]._url")?.disposition).toBe("blocked");
    },
  );

  it("is removed on a kept animal code's code and userSelected, keepPatientAnimal on", () => {
    const result = run(
      {
        resourceType: "Patient",
        extension: [
          {
            url: ANIMAL_URL,
            extension: [
              {
                url: "species",
                valueCodeableConcept: {
                  coding: [
                    {
                      system: "http://example.org/zz-animal",
                      code: "zzdog",
                      _code: S,
                      userSelected: true,
                      _userSelected: `${S}2`,
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
      { keepPatientAnimal: true },
    );
    expectGone(result);
    expect(result.json).toContain('"code":"zzdog"');
    expect(result.json).toContain('"userSelected":true');
    const coding = "Patient.extension[0].extension[0].valueCodeableConcept.coding[0]";
    expect(rowAt(result, `${coding}._code`)?.disposition).toBe("blocked");
    expect(rowAt(result, `${coding}._userSelected`)?.disposition).toBe("blocked");
  });
});

describe("a `_`-sibling that is not an object, on a part a reduced address keeps", () => {
  it("is removed from the state on a person resource, and the state is kept", () => {
    const result = run({
      resourceType: "Patient",
      address: [{ state: "MA", _state: S, postalCode: "02139" }],
    });
    expectGone(result);
    expect(JSON.parse(result.json)).toEqual({
      resourceType: "Patient",
      address: [{ state: "MA", postalCode: "021" }],
    });
    expect(rowAt(result, "Patient.address._state")?.disposition).toBe("blocked");
  });

  it("is removed from the country of a swept address on a non-person resource", () => {
    const result = run({
      resourceType: "Organization",
      address: [{ country: "US", _country: S, postalCode: "02139" }],
    });
    expectGone(result);
    expect(result.json).toContain('"country":"US"');
    expect(rowAt(result, "Organization.address._country")?.disposition).toBe("blocked");
  });

  it("is located with an index when the resource has more than one address", () => {
    const result = run({
      resourceType: "Patient",
      address: [
        { state: "MA", postalCode: "02139" },
        { state: "IL", _state: S, postalCode: "62704" },
      ],
    });
    expectGone(result);
    expect(rowAt(result, "Patient.address[1]._state")?.disposition).toBe("blocked");
  });

  it("is removed from the url of an extension on a kept part", () => {
    const result = run({
      resourceType: "Patient",
      address: [
        {
          state: "MA",
          _state: { extension: [{ url: "http://example.org/s", _url: S }] },
          postalCode: "02139",
        },
      ],
    });
    expectGone(result);
    expect(result.json).toContain('"url":"http://example.org/s"');
    expect(rowAt(result, "Patient.address._state.extension[0]._url")?.disposition).toBe("blocked");
  });

  it("is removed in a contained resource and in a Bundle entry", () => {
    const result = run({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          resource: {
            resourceType: "Patient",
            address: [{ state: "MA", _state: S }],
          },
        },
        {
          resource: observation({
            contained: [
              {
                resourceType: "Organization",
                id: "o1",
                address: [{ country: "US", _country: `${S}2` }],
              },
            ],
          }),
        },
      ],
    });
    expectGone(result);
    const loci = result.manifest.map((m) => m.locus);
    expect(loci).toContain("Bundle.entry[0].resource.address._state");
    expect(loci).toContain("Bundle.entry[1].resource.contained[0].address._country");
  });

  it("records nothing for a part the address drops: the part goes whole", () => {
    const result = run({
      resourceType: "Patient",
      address: [{ city: "Springfield", _city: S, state: "MA", postalCode: "02139" }],
    });
    expectGone(result);
    expect(result.manifest.map((m) => m.locus).filter((l) => l.includes("_"))).toEqual([]);
  });
});

describe("a `_`-sibling that is not an object, anywhere else", () => {
  it.each([
    ["a string", S, S],
    ["a number", 900000021, "900000021"],
    ["a boolean", true, "true"],
    ["a null", null, "null"],
  ])("is removed as %s beside a clinical status", (_name, sibling, text) => {
    const result = run(observation({ _status: sibling }));
    expectGone(result, text);
    expect(JSON.parse(result.json)).toEqual(observation({}));
    expect(rowAt(result, "Observation._status")?.disposition).toBe("blocked");
  });

  it("is removed beside a person's gender, and the gender is kept", () => {
    const result = run({ resourceType: "Patient", gender: "other", _gender: S });
    expectGone(result);
    expect(JSON.parse(result.json)).toEqual({ resourceType: "Patient", gender: "other" });
    expect(rowAt(result, "Patient._gender")?.disposition).toBe("blocked");
  });

  it("goes with a primitive the pass removes, whose own row covers it", () => {
    const result = run({ resourceType: "Patient", zzNote: "ZZTOPNOTE", _zzNote: S });
    expectGone(result);
    expect(result.json).not.toContain("ZZTOPNOTE");
    const loci = result.manifest.map((m) => m.locus);
    expect(loci).toContain("Patient.<withheld>[1]");
    expect(loci.filter((l) => l.includes("zzNote"))).toEqual([]);
  });

  it("records nothing inside an element the pass removes whole", () => {
    const result = run({
      resourceType: "Patient",
      name: [{ family: "Zzfamily", _family: S, given: ["Zzgiven"], _given: [`${S}2`] }],
    });
    expectGone(result);
    const loci = result.manifest.map((m) => m.locus);
    expect(loci).toContain("Patient.name");
    expect(loci.filter((l) => l.includes("_"))).toEqual([]);
  });

  it("is removed where the primitive has no value of its own", () => {
    const result = run({ resourceType: "Observation", code: { text: "sodium" }, _status: S });
    expectGone(result);
    expect(rowAt(result, "Observation._status")?.disposition).toBe("blocked");
  });

  it("is removed as a list in the slot of a repeating primitive", () => {
    const result = run({
      resourceType: "ServiceRequest",
      status: "active",
      intent: "order",
      instantiatesUri: ["http://example.org/a", "http://example.org/b"],
      _instantiatesUri: [null, [S]],
    });
    expectGone(result);
    expect(result.json).toContain(
      '"instantiatesUri":["http://example.org/a","http://example.org/b"]',
    );
    expect(rowAt(result, "ServiceRequest._instantiatesUri[1]")?.disposition).toBe("blocked");
  });

  it("is removed beside a value the pass rewrote, and the new value is kept", () => {
    const result = run({
      resourceType: "Patient",
      birthDate: "1980-05-17",
      _birthDate: S,
    });
    expectGone(result);
    expect(result.json).toContain('"birthDate":"1980"');
    expect(rowAt(result, "Patient._birthDate")?.disposition).toBe("blocked");
  });

  it("is removed beside a code inside a backbone and a coding", () => {
    const result = run(
      observation({
        identifier: [{ system: "http://example.org/ids", _system: S, value: "zz1" }],
        category: [{ coding: [{ system: "http://example.org/c", code: "lab", _code: `${S}2` }] }],
      }),
    );
    expectGone(result);
    const loci = result.manifest.map((m) => m.locus);
    expect(loci).toContain("Observation.identifier[0]._system");
    expect(loci).toContain("Observation.category[0].coding[0]._code");
  });

  it("labels the resource it was removed from, and no other", () => {
    const labeled = run(observation({ _status: S }), { transformLabels: true });
    expectGone(labeled);
    expect(labeled.json).toContain('"security"');
    const untouched = run(observation({}), { transformLabels: true });
    expect(untouched.json).not.toContain('"security"');
  });

  it("is not a residual: what the pass removes is not handed through", () => {
    const { resource } = parseResource(JSON.stringify(observation({ _status: S })));
    const { loci, coords, unexaminedResiduals } = extractFhirLoci(resource);
    expect(loci.map((l) => l.path)).toContain("Observation._status");
    expect(loci).toHaveLength(coords.length);
    expect(unexaminedResiduals.map((r) => r.locus)).not.toContain("Observation._status");
  });
});

describe("the applier writes a primitive from its value, its id and the extensions it decided", () => {
  it("writes no `null` where FHIR JSON defines no value", () => {
    const { json } = run({ resourceType: "Observation", status: null, code: { text: "sodium" } });
    expect(JSON.parse(json)).toEqual({ resourceType: "Observation", code: { text: "sodium" } });
  });

  it("drops the sibling text even when no coordinate names it", () => {
    const { resource } = parseResource(JSON.stringify(observation({ _status: S })));
    const rebuilt = applyFhir(resource, [], []);
    const status = rebuilt.properties.find((p) => p.name === "status")?.value;
    expect(status).toEqual({ kind: "primitive", value: "final" });
  });
});
