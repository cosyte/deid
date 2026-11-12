/**
 * A FHIR primitive whose value does not fit the format R4 defines for its type is text a sender
 * chose: a name in a `dateTime`, a dashed number in a required `code`, a space in an `id`, an
 * `integer` past its range. It is blocked whole with a manifest row that carries no value, at every
 * depth and in choice elements, under Safe Harbor and the Limited Data Set. A code at an element R4
 * binds, required, to a value set R4 defines is held to that set. A value that fits is kept as it was.
 *
 * Also here: an extension's `url` that is no `uri` is blocked (one that is a `uri` is kept verbatim),
 * and a `_`-sibling written beside a structure, which the reader drops, gets a manifest row.
 *
 * Every value here is synthetic (`Zz` names, made-up numbers, example.org urls); the dashed number is
 * built from pieces so that no SSN shape sits in the source.
 */

import { describe, expect, it } from "vitest";
import { parseResource, serializeResource } from "@cosyte/fhir";

import {
  createDeidContext,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_PROFILE,
} from "../../src/index.js";
import { deidentifyFhir, deidentifyFhirJson, extractFhirLoci } from "../../src/fhir/index.js";
import { fitsFhirFormat } from "../../src/fhir/primitive-format.js";
import {
  FHIR_PRIMITIVE_FORMATS,
  FHIR_REQUIRED_BINDINGS,
  FHIR_REQUIRED_CODE_SETS,
  FHIR_UNCARRIED_REQUIRED_BINDINGS,
} from "../../src/fhir/generated/primitive-formats.js";

const ctx = createDeidContext({ key: "primitive-formats-synthetic-hmac", patientId: "p" });

const PROFILES = [SAFE_HARBOR_PROFILE, LIMITED_DATA_SET_PROFILE] as const;

function run(resource: unknown, profile: (typeof PROFILES)[number], keepPatientAnimal = false) {
  return deidentifyFhirJson(JSON.stringify(resource), {
    ...profileOptions(profile, ctx),
    keepPatientAnimal,
  });
}

const NAME = "Zzsmith Zzjohn";
const DASHED = ["999", "00", "1234"].join("-");

/** A value that does not fit its type, where it sits: the document, the locus, and the text. */
const MISFITS: readonly (readonly [string, unknown, string, string])[] = [
  [
    "a name in Encounter.status (required binding)",
    { resourceType: "Encounter", status: "Zzsmith", class: { code: "x" } },
    "Encounter.status",
    "Zzsmith",
  ],
  [
    "a dashed number in Encounter.status (required binding)",
    { resourceType: "Encounter", status: DASHED, class: { code: "x" } },
    "Encounter.status",
    DASHED,
  ],
  [
    "a name in Observation.status (required binding)",
    { resourceType: "Observation", status: "Zzsmith" },
    "Observation.status",
    "Zzsmith",
  ],
  [
    "a name in Observation.effectiveDateTime",
    { resourceType: "Observation", status: "final", effectiveDateTime: NAME },
    "Observation.effectiveDateTime",
    NAME,
  ],
  [
    "a dashed number in Observation.effectiveDateTime",
    { resourceType: "Observation", status: "final", effectiveDateTime: DASHED },
    "Observation.effectiveDateTime",
    DASHED,
  ],
  [
    "a name in Observation.issued (instant)",
    { resourceType: "Observation", status: "final", issued: "Zzsmith" },
    "Observation.issued",
    "Zzsmith",
  ],
  [
    "a name in meta.versionId (id)",
    { resourceType: "Observation", status: "final", meta: { versionId: NAME } },
    "Observation.meta.versionId",
    NAME,
  ],
  [
    "a name in SampledData.data",
    {
      resourceType: "Observation",
      status: "final",
      valueSampledData: { origin: { value: 1 }, period: 1, dimensions: 1, data: "Zzsmith 1 2" },
    },
    "Observation.valueSampledData.data",
    "Zzsmith",
  ],
  [
    "a code with a leading space in Coding.code",
    {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://example.org/zz", code: " Zzsmith" }] },
    },
    "Observation.code.coding[0].code",
    "Zzsmith",
  ],
  [
    "a code with two spaces in a row in Coding.code",
    {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://example.org/zz", code: "Zzsmith  Zzjohn" }] },
    },
    "Observation.code.coding[0].code",
    "Zzsmith",
  ],
  [
    "a name in a component's valueDateTime (choice, at depth)",
    {
      resourceType: "Observation",
      status: "final",
      component: [{ code: { text: "a" }, valueDateTime: "Zzsmith" }],
    },
    "Observation.component[0].valueDateTime",
    "Zzsmith",
  ],
  [
    "a dashed number in a contained resource's issued",
    {
      resourceType: "Observation",
      status: "final",
      contained: [{ resourceType: "Observation", status: "final", issued: DASHED }],
    },
    "Observation.contained[0].issued",
    DASHED,
  ],
  [
    "a name in a Bundle entry's valueTime",
    {
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Observation", status: "final", valueTime: "Zzsmith" } }],
    },
    "Bundle.entry[0].resource.valueTime",
    "Zzsmith",
  ],
  [
    "a name in a Narrative.status (required binding)",
    {
      resourceType: "Observation",
      status: "final",
      text: { status: "Zzsmith", div: '<div xmlns="http://www.w3.org/1999/xhtml">a</div>' },
    },
    "Observation.text.status",
    "Zzsmith",
  ],
  [
    "a name in Quantity.comparator (required binding)",
    {
      resourceType: "Observation",
      status: "final",
      valueQuantity: { value: 1, comparator: "Zzsmith" },
    },
    "Observation.valueQuantity.comparator",
    "Zzsmith",
  ],
  [
    "a name in Attachment.data (base64Binary)",
    {
      resourceType: "DocumentReference",
      status: "current",
      content: [{ attachment: { data: NAME } }],
    },
    "DocumentReference.content[0].attachment.data",
    "Zzsmith",
  ],
  [
    "a name in a repeating code, alone",
    {
      resourceType: "AllergyIntolerance",
      patient: { reference: "#p" },
      category: ["food", "Zzsmith"],
    },
    "AllergyIntolerance.category[1]",
    "Zzsmith",
  ],
];

/** A value of each primitive kind that does not fit, in a `Parameters` choice element. */
const CHOICES: readonly (readonly [string, unknown, string])[] = [
  ["valueCode", " Zzsmith", "Zzsmith"],
  ["valueId", NAME, "Zzsmith"],
  ["valueDate", "Zzsmith", "Zzsmith"],
  ["valueDateTime", DASHED, DASHED],
  ["valueInstant", "Zzsmith", "Zzsmith"],
  ["valueTime", "Zzsmith", "Zzsmith"],
  ["valueUri", NAME, "Zzsmith"],
  ["valueUrl", NAME, "Zzsmith"],
  ["valueCanonical", NAME, "Zzsmith"],
  ["valueOid", "Zzsmith", "Zzsmith"],
  ["valueUuid", DASHED, DASHED],
  ["valueBase64Binary", "Zzsmith!", "Zzsmith"],
  ["valueInteger", 4242424242, "4242424242"],
  ["valueInteger", -4242424242, "4242424242"],
  ["valuePositiveInt", 0, '"valuePositiveInt":0'],
  ["valuePositiveInt", 4242424242, "4242424242"],
  ["valueUnsignedInt", -4242, "4242"],
  ["valueUnsignedInt", 4242424242, "4242424242"],
];

describe("a primitive that does not fit the format R4 defines for its type is blocked whole", () => {
  it.each(MISFITS)("%s", (_what, doc, locus, text) => {
    for (const profile of PROFILES) {
      const { json, manifest } = run(doc, profile);
      expect(json, profile.name).not.toContain(text);
      const row = manifest.find((m) => m.locus === locus);
      expect(row, `${profile.name}: no row at ${locus}`).toMatchObject({ disposition: "blocked" });
      expect(JSON.stringify(manifest), profile.name).not.toContain(text);
    }
  });

  it.each(
    CHOICES.map(([key, value, text], i) => [`${key} ${String(i)}`, key, value, text] as const),
  )("%s in a choice element", (_label, key, value, text) => {
    for (const profile of PROFILES) {
      const { json, manifest } = run(
        { resourceType: "Parameters", parameter: [{ name: "a", [key]: value }] },
        profile,
      );
      expect(json, profile.name).not.toContain(text);
      expect(JSON.parse(json), profile.name).toEqual({
        resourceType: "Parameters",
        parameter: [{ name: "a" }],
      });
      expect(manifest.map((m) => [m.locus, m.disposition])).toEqual([
        [`Parameters.parameter[0].${key}`, "blocked"],
      ]);
    }
  });

  it("an integer kind is read by the exact text it arrived as", () => {
    // Past 2^53 a JavaScript number would round; the range is checked on the literal.
    const { json, manifest } = run(
      {
        resourceType: "Observation",
        status: "final",
        component: [{ code: { text: "a" }, valueInteger: 2147483648 }],
      },
      SAFE_HARBOR_PROFILE,
    );
    expect(json).not.toContain("2147483648");
    expect(manifest.map((m) => m.locus)).toEqual(["Observation.component[0].valueInteger"]);
    const huge = deidentifyFhirJson(
      '{"resourceType":"Observation","status":"final","valueInteger":98765432109876543210}',
      profileOptions(SAFE_HARBOR_PROFILE, ctx),
    );
    expect(huge.json).not.toContain("98765432109876543210");
    expect(huge.manifest.map((m) => m.locus)).toEqual(["Observation.valueInteger"]);
  });

  it("with transform labels, a required element removed for its format carries the Data Absent Reason", () => {
    const { json } = deidentifyFhirJson(
      JSON.stringify({ resourceType: "Encounter", status: "Zzsmith", class: { code: "x" } }),
      { ...profileOptions(SAFE_HARBOR_PROFILE, ctx), transformLabels: true },
    );
    expect(json).not.toContain("Zzsmith");
    expect(JSON.parse(json)).toMatchObject({
      _status: {
        extension: [
          {
            url: "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
            valueCode: "masked",
          },
        ],
      },
    });
  });
});

describe("a primitive that fits the format R4 defines for its type is kept as it was", () => {
  const conformant = {
    resourceType: "Parameters",
    parameter: [
      { name: "a", valueCode: "zz-code one" },
      { name: "b", valueId: "Zz-1.a" },
      { name: "c", valueTime: "10:20:30.5" },
      { name: "d", valueUri: "http://example.org/zz" },
      { name: "e", valueUrl: "http://example.org/zz" },
      { name: "f", valueCanonical: "http://example.org/zz|1" },
      { name: "g", valueOid: "urn:oid:2.16.840.1.113883" },
      { name: "h", valueUuid: "urn:uuid:0a1b2c3d-0000-4000-8000-00000000abcd" },
      { name: "i", valueBase64Binary: "WlpaWg==" },
      { name: "j", valueInteger: -2147483648 },
      { name: "k", valuePositiveInt: 2147483647 },
      { name: "l", valueUnsignedInt: 0 },
      { name: "m", valueDecimal: 1.5e3 },
      { name: "n", valueBoolean: false },
      { name: "o", valueMarkdown: "*zz*" },
    ],
  };

  it("each kind, under every profile, with no row", () => {
    for (const profile of PROFILES) {
      const { json, manifest } = run(conformant, profile);
      expect(JSON.parse(json), profile.name).toEqual(
        JSON.parse(serializeResource(parseResource(JSON.stringify(conformant)).resource)),
      );
      expect(manifest, profile.name).toEqual([]);
    }
  });

  it("a code in the value set of its required binding, and SampledData.data in its form", () => {
    for (const profile of PROFILES) {
      const doc = {
        resourceType: "Observation",
        status: "amended",
        code: { coding: [{ system: "http://example.org/zz", code: "zz code" }] },
        valueSampledData: {
          origin: { value: 0 },
          period: 1,
          dimensions: 1,
          data: "1.5 -2 E L U 3e2",
        },
      };
      const { json, manifest } = run(doc, profile);
      expect(JSON.parse(json), profile.name).toEqual(doc);
      expect(manifest, profile.name).toEqual([]);
    }
  });

  it("a date the date rule reads, where R4 puts a finer precision, is left to that rule", () => {
    const { json, manifest } = run(
      { resourceType: "Observation", status: "final", issued: "2020-03-04" },
      SAFE_HARBOR_PROFILE,
    );
    expect(JSON.parse(json)).toEqual({
      resourceType: "Observation",
      status: "final",
      issued: "2020",
    });
    expect(manifest.map((m) => [m.locus, m.disposition])).toEqual([
      ["Observation.issued", "transformed"],
    ]);
    // A time where a `date` belongs, and a time with no seconds where a `dateTime` belongs.
    const params = run(
      {
        resourceType: "Parameters",
        parameter: [
          { name: "a", valueDate: "2020-03-04T10:00:00Z" },
          { name: "b", valueDateTime: "2020-03-04T10:00" },
        ],
      },
      SAFE_HARBOR_PROFILE,
    );
    expect(JSON.parse(params.json)).toEqual({
      resourceType: "Parameters",
      parameter: [
        { name: "a", valueDate: "2020" },
        { name: "b", valueDateTime: "2020" },
      ],
    });
  });

  it("an empty value holds no text and is left as it was", () => {
    const { manifest } = run(
      { resourceType: "Observation", status: "final", meta: { versionId: "" } },
      SAFE_HARBOR_PROFILE,
    );
    expect(manifest).toEqual([]);
  });

  it("a code at a required binding the definitions do not carry is held to the code format alone", () => {
    expect(FHIR_UNCARRIED_REQUIRED_BINDINGS["Attachment.contentType"]).toBe(
      "http://hl7.org/fhir/ValueSet/mimetypes",
    );
    const doc = {
      resourceType: "DocumentReference",
      status: "current",
      content: [{ attachment: { contentType: "application/zz-made-up" } }],
    };
    const kept = run(doc, SAFE_HARBOR_PROFILE);
    expect(JSON.parse(kept.json)).toEqual(doc);
    const blocked = run(
      {
        resourceType: "DocumentReference",
        status: "current",
        content: [{ attachment: { contentType: "Zzsmith  Zzjohn" } }],
      },
      SAFE_HARBOR_PROFILE,
    );
    expect(blocked.json).not.toContain("Zzsmith");
  });
});

describe("the R4 format table", () => {
  it("holds each primitive type's pattern and range, as R4 publishes them", () => {
    expect(Object.keys(FHIR_PRIMITIVE_FORMATS).sort()).toEqual([
      "base64Binary",
      "boolean",
      "canonical",
      "code",
      "date",
      "dateTime",
      "decimal",
      "id",
      "instant",
      "integer",
      "oid",
      "positiveInt",
      "time",
      "unsignedInt",
      "uri",
      "url",
      "uuid",
    ]);
    expect(FHIR_PRIMITIVE_FORMATS["id"]?.pattern).toBe("[A-Za-z0-9\\-\\.]{1,64}");
    expect(FHIR_PRIMITIVE_FORMATS["integer"]).toMatchObject({
      min: -2147483648,
      max: 2147483647,
    });
    expect(FHIR_PRIMITIVE_FORMATS["positiveInt"]?.max).toBe(2147483647);
  });

  it("binds the required codes R4 defines, and names the ones it cannot carry", () => {
    expect(FHIR_REQUIRED_BINDINGS["Encounter.status"]).toBe("encounter-status");
    expect(FHIR_REQUIRED_BINDINGS["Observation.status"]).toBe("observation-status");
    expect(FHIR_REQUIRED_BINDINGS["Questionnaire.item.type"]).toBe("item-type");
    expect(FHIR_REQUIRED_CODE_SETS["encounter-status"]?.split(" ")).toContain("finished");
    expect(Object.keys(FHIR_UNCARRIED_REQUIRED_BINDINGS).sort()).toContain("Money.currency");
    expect(Object.keys(FHIR_UNCARRIED_REQUIRED_BINDINGS)).toContain("Composition.confidentiality");
  });

  it("reads a whole value, and a string kind as fitting", () => {
    expect(fitsFhirFormat("id", undefined, "a b")).toBe(false);
    expect(fitsFhirFormat("id", undefined, "ab")).toBe(true);
    expect(fitsFhirFormat("date", undefined, "2020-01-01x")).toBe(false);
    expect(fitsFhirFormat(null, undefined, "  any text  ")).toBe(true);
    expect(fitsFhirFormat("integer", undefined, "-2147483649")).toBe(false);
    expect(fitsFhirFormat("integer", undefined, "-2147483648")).toBe(true);
    expect(fitsFhirFormat("unsignedInt", undefined, "2147483648")).toBe(false);
    expect(fitsFhirFormat("code", "Encounter.status", "finished")).toBe(true);
    expect(fitsFhirFormat("code", "Encounter.status", "Finished")).toBe(false);
    expect(fitsFhirFormat(null, "SampledData.data", "1 2  3")).toBe(false);
    expect(fitsFhirFormat(null, "SampledData.data", "1 X")).toBe(false);
  });
});

describe("an extension's url", () => {
  it("is kept verbatim when it is a uri", () => {
    for (const profile of PROFILES) {
      const { json } = run(
        {
          resourceType: "Observation",
          status: "final",
          extension: [{ url: "http://example.org/zz-ext", valueBoolean: true }],
        },
        profile,
      );
      expect(JSON.parse(json)).toMatchObject({ extension: [{ url: "http://example.org/zz-ext" }] });
    }
  });

  it("is blocked when it is no uri, at any depth", () => {
    for (const profile of PROFILES) {
      const { json, manifest } = run(
        {
          resourceType: "Observation",
          status: "final",
          extension: [{ url: NAME }],
          code: {
            coding: [
              {
                code: "1",
                extension: [{ url: "http://example.org/x", extension: [{ url: NAME }] }],
              },
            ],
          },
        },
        profile,
      );
      expect(json).not.toContain("Zzsmith");
      expect(manifest.map((m) => m.locus)).toEqual(
        expect.arrayContaining([
          "Observation.extension[0].url",
          "Observation.code.coding[0].extension[0].extension[0].url",
        ]),
      );
    }
  });
});

describe("an extension's id", () => {
  it("is replaced as every element id is, not held to the uri format", () => {
    const { json, manifest } = run(
      {
        resourceType: "Observation",
        status: "final",
        extension: [{ id: "zz a", url: "http://example.org/zz-ext" }],
      },
      SAFE_HARBOR_PROFILE,
    );
    const out = JSON.parse(json) as { extension: { id?: string; url: string }[] };
    expect(out.extension[0]?.url).toBe("http://example.org/zz-ext");
    expect(out.extension[0]?.id).toBeDefined();
    expect(out.extension[0]?.id).not.toBe("zz a");
    expect(manifest.find((m) => m.locus === "Observation.extension[0].id")?.disposition).not.toBe(
      "blocked",
    );
  });
});

describe("a kept patient-animal code that does not fit its type", () => {
  it("is blocked, and one that fits is kept", () => {
    const { json, manifest } = run(
      {
        resourceType: "Patient",
        extension: [
          {
            url: "http://hl7.org/fhir/StructureDefinition/patient-animal",
            extension: [
              {
                url: "species",
                valueCodeableConcept: {
                  coding: [
                    { system: "http://example.org/zz animal", code: "zz-dog" },
                    { system: "http://example.org/zz-animal", code: "  Zzsmith" },
                  ],
                },
              },
            ],
          },
        ],
      },
      SAFE_HARBOR_PROFILE,
      true,
    );
    expect(json).not.toContain("Zzsmith");
    expect(json).not.toContain("zz animal");
    expect(json).toContain("zz-dog");
    expect(manifest.map((m) => m.locus)).toEqual([
      "Patient.extension[0].extension[0].valueCodeableConcept.coding[0].system",
      "Patient.extension[0].extension[0].valueCodeableConcept.coding[1].code",
    ]);
  });
});

describe("a `_`-sibling beside a structure gets a manifest row", () => {
  const misplaced = {
    resourceType: "Bundle",
    type: "collection",
    entry: [
      {
        resource: {
          resourceType: "Observation",
          status: "final",
          code: { text: "a" },
          _code: { extension: [{ url: "http://example.org/x", valueString: "Zzsmith" }] },
          performer: [{ display: "x" }],
          _performer: "Zzsmith",
          zzKey: { code: { text: "b" }, _code: { id: "q" } },
        },
      },
    ],
  };

  it("from the JSON entry point, with no value", () => {
    for (const profile of PROFILES) {
      const { json, manifest } = run(misplaced, profile);
      expect(json).not.toContain("Zzsmith");
      expect(JSON.stringify(manifest)).not.toContain("Zzsmith");
      expect(JSON.stringify(manifest)).not.toContain("zzKey");
      const loci = manifest.map((m) => m.locus);
      expect(loci).toEqual(
        expect.arrayContaining([
          "Bundle.entry[0].resource._code",
          "Bundle.entry[0].resource._performer",
        ]),
      );
      for (const locus of [
        "Bundle.entry[0].resource._code",
        "Bundle.entry[0].resource._performer",
      ]) {
        expect(manifest.find((m) => m.locus === locus)).toMatchObject({ disposition: "blocked" });
      }
      // The sibling under a key R4 does not define is written at the root, withheld, and nothing
      // below that key is named.
      expect(loci.filter((l) => l.startsWith("Bundle._<withheld>["))).toHaveLength(1);
      expect(loci.filter((l) => l.endsWith("._code"))).toEqual(["Bundle.entry[0].resource._code"]);
    }
  });

  it("from the model entry point when the caller passes the parse issues, and not otherwise", () => {
    const { resource, issues } = parseResource(
      JSON.stringify({
        resourceType: "Observation",
        status: "final",
        code: { text: "a" },
        _code: { id: "q" },
      }),
    );
    const withIssues = deidentifyFhir(resource, {
      ...profileOptions(SAFE_HARBOR_PROFILE, ctx),
      parseIssues: issues,
    });
    expect(withIssues.manifest.map((m) => m.locus)).toEqual(["Observation._code"]);
    const without = deidentifyFhir(resource, profileOptions(SAFE_HARBOR_PROFILE, ctx));
    expect(without.manifest).toEqual([]);
  });

  it("an issue whose position the tree does not hold is written as the withheld token", () => {
    const { resource } = parseResource('{"resourceType":"Observation","status":"final"}');
    const { loci } = extractFhirLoci(resource, {
      parseIssues: [
        {
          code: "MISPLACED_PRIMITIVE_EXTENSION",
          severity: "warning",
          expression: "Observation.zzGone",
        },
        { code: "UNKNOWN_PROPERTY", severity: "warning", expression: "Observation.zzOther" },
      ],
    });
    expect(loci.map((l) => l.path)).toEqual(["Observation._<withheld>[0]"]);
  });
});
