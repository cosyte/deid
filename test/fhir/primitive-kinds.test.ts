/**
 * A primitive whose JSON type is not the one R4 defines at its position is text a sender chose: a
 * number where R4 puts a string (`"valueString": 987654321`), or a string where R4 puts a boolean,
 * an integer or a decimal (`"valueBoolean": "ZZLEAK"`). It is blocked whole with a manifest row that
 * carries no value, at every depth and in choice elements, under every profile. And a manifest row for
 * a key R4 does not define where it sits never repeats the key: the key is written as the withheld
 * token with its position, as the root does for a resource type R4 does not define.
 *
 * Every value here is synthetic (`ZZ` tokens, made-up numbers, example.org urls).
 */

import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_PROFILE,
  WITHHELD_LOCUS_TOKEN,
} from "../../src/index.js";
import { deidentifyFhirJson } from "../../src/fhir/index.js";
import { fhirElementsOf } from "../../src/fhir/element-names.js";

const ctx = createDeidContext({ key: "primitive-kinds-synthetic-hmac", patientId: "p" });

const PROFILES = [SAFE_HARBOR_PROFILE, LIMITED_DATA_SET_PROFILE] as const;

function run(resource: unknown, profile: (typeof PROFILES)[number], keepPatientAnimal = false) {
  return deidentifyFhirJson(JSON.stringify(resource), {
    ...profileOptions(profile, ctx),
    keepPatientAnimal,
  });
}

const NUMBER = 987654321;
const TEXT = "ZZLEAK";

/** A number where R4 puts a string: the document, and the locus of the one row it must draw. */
const NUMBER_WHERE_STRING: readonly (readonly [string, unknown, string])[] = [
  [
    "Observation.valueString",
    { resourceType: "Observation", status: "final", valueString: NUMBER },
    "Observation.valueString",
  ],
  [
    "Observation.code.text",
    { resourceType: "Observation", status: "final", code: { text: NUMBER } },
    "Observation.code.text",
  ],
  [
    "Observation.component[0].valueString",
    {
      resourceType: "Observation",
      status: "final",
      component: [{ code: { text: "a" }, valueString: NUMBER }],
    },
    "Observation.component[0].valueString",
  ],
  [
    "QuestionnaireResponse.item[0].answer[0].valueString",
    {
      resourceType: "QuestionnaireResponse",
      status: "completed",
      item: [{ linkId: "1", answer: [{ valueString: NUMBER }] }],
    },
    "QuestionnaireResponse.item[0].answer[0].valueString",
  ],
  [
    "Encounter.reasonCode[0].text",
    {
      resourceType: "Encounter",
      status: "finished",
      class: { code: "x" },
      reasonCode: [{ text: NUMBER }],
    },
    "Encounter.reasonCode[0].text",
  ],
  [
    "Observation.meta.versionId",
    { resourceType: "Observation", status: "final", meta: { versionId: NUMBER } },
    "Observation.meta.versionId",
  ],
  ["a resource id", { resourceType: "Observation", id: NUMBER, status: "final" }, "Observation.id"],
  [
    "a contained Device's deviceName[0].name",
    {
      resourceType: "Observation",
      status: "final",
      contained: [
        { resourceType: "Device", deviceName: [{ name: NUMBER, type: "user-friendly-name" }] },
      ],
    },
    "Observation.contained[0].deviceName[0].name",
  ],
];

/** A string where R4 puts a boolean, an integer or a decimal. */
const STRING_WHERE_SCALAR: readonly (readonly [string, unknown, string])[] = [
  [
    "Observation.valueBoolean",
    { resourceType: "Observation", status: "final", valueBoolean: TEXT },
    "Observation.valueBoolean",
  ],
  [
    "Observation.component[0].valueBoolean",
    {
      resourceType: "Observation",
      status: "final",
      component: [{ code: { text: "a" }, valueBoolean: TEXT }],
    },
    "Observation.component[0].valueBoolean",
  ],
  [
    "Observation.component[0].valueInteger",
    {
      resourceType: "Observation",
      status: "final",
      component: [{ code: { text: "a" }, valueInteger: TEXT }],
    },
    "Observation.component[0].valueInteger",
  ],
  ...(["valueBoolean", "valueInteger", "valueDecimal"] as const).map(
    (key) =>
      [
        `QuestionnaireResponse answer ${key}`,
        {
          resourceType: "QuestionnaireResponse",
          status: "completed",
          item: [{ linkId: "1", answer: [{ [key]: TEXT }] }],
        },
        `QuestionnaireResponse.item[0].answer[0].${key}`,
      ] as const,
  ),
  [
    "Parameters.parameter[0].valueBoolean",
    { resourceType: "Parameters", parameter: [{ name: "a", valueBoolean: TEXT }] },
    "Parameters.parameter[0].valueBoolean",
  ],
  ["Bundle.total", { resourceType: "Bundle", type: "searchset", total: TEXT }, "Bundle.total"],
  [
    "Coding.userSelected",
    {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ code: "1", userSelected: TEXT }] },
    },
    "Observation.code.coding[0].userSelected",
  ],
  [
    "Quantity.value",
    { resourceType: "Observation", status: "final", valueQuantity: { value: TEXT, unit: "mg" } },
    "Observation.valueQuantity.value",
  ],
  [
    "Range.low.value",
    { resourceType: "Observation", status: "final", valueRange: { low: { value: TEXT } } },
    "Observation.valueRange.low.value",
  ],
];

describe("a primitive of a JSON type R4 does not define at its position is blocked whole", () => {
  it.each(NUMBER_WHERE_STRING)("a number at %s", (_where, doc, locus) => {
    for (const profile of PROFILES) {
      const { json, manifest } = run(doc, profile);
      expect(json, profile.name).not.toContain(String(NUMBER));
      const row = manifest.find((m) => m.locus === locus);
      expect(row, `${profile.name}: no row at ${locus}`).toMatchObject({ disposition: "blocked" });
      expect(JSON.stringify(manifest), profile.name).not.toContain(String(NUMBER));
    }
  });

  it.each(STRING_WHERE_SCALAR)("a string at %s", (_where, doc, locus) => {
    for (const profile of PROFILES) {
      const { json, manifest } = run(doc, profile);
      expect(json, profile.name).not.toContain(TEXT);
      const row = manifest.find((m) => m.locus === locus);
      expect(row, `${profile.name}: no row at ${locus}`).toMatchObject({ disposition: "blocked" });
      expect(JSON.stringify(manifest), profile.name).not.toContain(TEXT);
    }
  });

  it("a boolean where R4 puts a string or a number, and a number where it puts a boolean", () => {
    for (const profile of PROFILES) {
      const { json, manifest } = run(
        {
          resourceType: "Observation",
          id: true,
          status: "final",
          code: { text: true, coding: [{ code: "1", userSelected: 1 }] },
          valueQuantity: { value: false, unit: "mg" },
        },
        profile,
      );
      expect(JSON.parse(json)).toEqual({
        resourceType: "Observation",
        status: "final",
        code: { coding: [{ code: "1" }] },
        valueQuantity: { unit: "mg" },
      });
      for (const locus of [
        "Observation.id",
        "Observation.code.text",
        "Observation.code.coding[0].userSelected",
        "Observation.valueQuantity.value",
      ]) {
        expect(manifest.find((m) => m.locus === locus)).toMatchObject({ disposition: "blocked" });
      }
    }
  });

  it("an item of a repeating primitive of the wrong JSON type, alone", () => {
    for (const profile of PROFILES) {
      const { json, manifest } = run(
        {
          resourceType: "Observation",
          status: "final",
          meta: { profile: ["http://example.org/zz-profile", NUMBER] },
        },
        profile,
      );
      expect(json).not.toContain(String(NUMBER));
      expect(json).toContain("http://example.org/zz-profile");
      expect(manifest.map((m) => m.locus)).toEqual(["Observation.meta.profile[1]"]);
    }
  });

  it("each JSON type R4 defines at its position is kept as it arrives", () => {
    const doc = {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "2951-2", userSelected: true }] },
      valueQuantity: { value: 1.5, unit: "mg" },
      component: [
        { code: { text: "a" }, valueBoolean: false },
        { code: { text: "b" }, valueInteger: 3 },
        { code: { text: "c" }, valueRange: { low: { value: 0 } } },
      ],
    };
    for (const profile of PROFILES) {
      const { json, manifest } = run(doc, profile);
      expect(JSON.parse(json), profile.name).toMatchObject({
        code: { coding: [{ code: "2951-2", userSelected: true }] },
        valueQuantity: { value: 1.5, unit: "mg" },
        component: [
          { valueBoolean: false },
          { valueInteger: 3 },
          { valueRange: { low: { value: 0 } } },
        ],
      });
      expect(manifest, profile.name).toEqual([]);
    }
    const bundle = run(
      { resourceType: "Bundle", type: "searchset", total: 2 },
      SAFE_HARBOR_PROFILE,
    );
    expect(JSON.parse(bundle.json)).toMatchObject({ total: 2 });
    const answers = run(
      {
        resourceType: "QuestionnaireResponse",
        status: "completed",
        item: [{ linkId: "1", answer: [{ valueDecimal: 2.5 }, { valueInteger: 4 }] }],
      },
      SAFE_HARBOR_PROFILE,
    );
    expect(JSON.parse(answers.json)).toMatchObject({
      item: [{ answer: [{ valueDecimal: 2.5 }, { valueInteger: 4 }] }],
    });
  });

  it("the R4 table records the JSON type of each primitive it defines", () => {
    expect(fhirElementsOf("Observation").get("valueBoolean")).toBe("boolean");
    expect(fhirElementsOf("Observation").get("valueInteger")).toBe("number");
    expect(fhirElementsOf("Observation").get("valueString")).toBeNull();
    expect(fhirElementsOf("Observation").get("status")).toBeNull();
    expect(fhirElementsOf("Quantity").get("value")).toBe("number");
    expect(fhirElementsOf("Bundle").get("total")).toBe("number");
    expect(fhirElementsOf("Coding").get("userSelected")).toBe("boolean");
    expect(fhirElementsOf("Patient").get("active")).toBe("boolean");
    expect(fhirElementsOf("Patient").get("multipleBirthInteger")).toBe("number");
    expect(fhirElementsOf("Attachment").get("size")).toBe("number");
    expect(fhirElementsOf("QuestionnaireResponse.item.answer").get("valueDecimal")).toBe("number");
  });
});

describe("a row for a key R4 does not define never repeats the key", () => {
  const withheld = (i: number) => `${WITHHELD_LOCUS_TOKEN}[${String(i)}]`;

  it("at the top level of a resource", () => {
    for (const profile of PROFILES) {
      const { json, manifest } = run(
        { resourceType: "Observation", status: "final", ZZLEAKSmithJohn: "x" },
        profile,
      );
      expect(json).not.toContain("ZZLEAK");
      expect(JSON.stringify(manifest), profile.name).not.toContain("ZZLEAK");
      expect(manifest.find((m) => m.locus === `Observation.${withheld(2)}`)).toMatchObject({
        disposition: "blocked",
      });
    }
  });

  it("in a Coding below the top level", () => {
    for (const profile of PROFILES) {
      const { json, manifest } = run(
        {
          resourceType: "Observation",
          status: "final",
          code: { coding: [{ code: "1", ZZLEAKMRN12345: true }] },
        },
        profile,
      );
      expect(json).not.toContain("ZZLEAK");
      expect(JSON.stringify(manifest), profile.name).not.toContain("ZZLEAK");
      expect(
        manifest.find((m) => m.locus === `Observation.code.coding[0].${withheld(1)}`),
      ).toMatchObject({ disposition: "blocked" });
    }
  });

  it("on an extension, a reduced address and a kept animal code", () => {
    const { json, manifest } = run(
      {
        resourceType: "Patient",
        extension: [{ url: "http://example.org/x", ZZLEAKExtKey: "x" }],
        address: [{ state: "ZZ", ZZLEAKAddrKey: "x" }],
      },
      SAFE_HARBOR_PROFILE,
    );
    expect(json).not.toContain("ZZLEAK");
    expect(JSON.stringify(manifest)).not.toContain("ZZLEAK");
    const animal = run(
      {
        resourceType: "Patient",
        extension: [
          {
            url: "http://hl7.org/fhir/StructureDefinition/patient-animal",
            extension: [
              {
                url: "species",
                valueCodeableConcept: {
                  ZZLEAKConceptKey: "x",
                  coding: [{ code: "zz", ZZLEAKCodingKey: "x" }],
                },
              },
            ],
          },
        ],
      },
      SAFE_HARBOR_PROFILE,
      true,
    );
    expect(animal.json).not.toContain("ZZLEAK");
    expect(JSON.stringify(animal.manifest)).not.toContain("ZZLEAK");
  });

  it("a key R4 defines, of a shape it does not define, is still named", () => {
    const { manifest } = run(
      { resourceType: "Observation", status: "final", valueString: NUMBER },
      SAFE_HARBOR_PROFILE,
    );
    expect(manifest.map((m) => m.locus)).toEqual(["Observation.valueString"]);
  });
});
