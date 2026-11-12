/**
 * **FHIR: a contact's name, whatever shape it arrives in.**
 *
 * R4 puts a person's name on resources that are not person resources in two ways. An `Organization`
 * and an `InsurancePlan` each carry a `contact` backbone whose `name` is a `HumanName`. Every
 * conformance and knowledge resource (a `ValueSet`, a `Measure`, a `PlanDefinition`, and the rest)
 * carries `ContactDetail` elements (`contact`, and on the knowledge resources `author`, `editor`,
 * `reviewer` and `endorser`) whose `name` is a plain string R4 documents as the name of an individual
 * to contact. The open `value[x]` arms of `Task`, `Parameters`, `ElementDefinition` and
 * `StructureMap` can carry either datatype too.
 *
 * A person's name at any of those positions is removed and recorded, never handed through as an
 * unexamined residual: a string, a number, a `null`, a list of strings, or a `HumanName`. The
 * positions are the R4 core package's own list of every element typed `HumanName` or `ContactDetail`
 * outside the person resources, written out here rather than read from the source, so the test does
 * not agree with the code by construction.
 *
 * The mirror half: an organisation's own `name`, a `ValueSet`'s computer name, a `Parameters`
 * parameter name and a `name` on a backbone R4 does not type as a contact are kept as they arrived.
 *
 * Every value is a synthetic, ZZ-tagged sentinel declared in `scripts/phi-allow-list.txt`.
 */

import { complex, list, primitive, serializeResource, type FhirComplex } from "@cosyte/fhir";
import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  profileOptions,
  SAFE_HARBOR_CATEGORIES,
  SAFE_HARBOR_PROFILE,
} from "../../src/index.js";
import { deidentifyFhir, deidentifyFhirJson } from "../../src/fhir/index.js";
import { fhirElementsOf } from "../../src/fhir/element-names.js";

const C = SAFE_HARBOR_CATEGORIES;
const ctx = createDeidContext({ key: "contact-names-key-synthetic-hmac", patientId: "p-contact" });

function run(resource: unknown): ReturnType<typeof deidentifyFhirJson> {
  return deidentifyFhirJson(JSON.stringify(resource), profileOptions(SAFE_HARBOR_PROFILE, ctx));
}

function rows(result: { readonly manifest: readonly { locus: string; disposition: string }[] }) {
  return result.manifest.map((m) => `${m.locus} ${m.disposition}`);
}

function categories(result: {
  readonly manifest: readonly { locus: string; category: string }[];
}): string[] {
  return result.manifest.map((m) => `${m.locus} ${m.category}`);
}

function loci(result: { readonly unexaminedResiduals: readonly { locus: string }[] }): string[] {
  return result.unexaminedResiduals.map((r) => r.locus);
}

/** The shapes a name can arrive in that are not a `HumanName`, each with what reaches the wire. */
const ODD_SHAPES: readonly { readonly label: string; readonly value: unknown }[] = [
  { label: "a string", value: "ZZCONTACTNAME" },
  { label: "a number", value: 4 },
  { label: "a null", value: null },
  { label: "a list of strings", value: ["ZZCONTACTNAME", "ZZCONTACTOTHER"] },
];

describe("the HumanName on an Organization's or an InsurancePlan's contact", () => {
  for (const resourceType of ["Organization", "InsurancePlan"]) {
    for (const { label, value } of ODD_SHAPES) {
      it(`removes and records ${label} at ${resourceType}.contact.name`, () => {
        const out = run({
          resourceType,
          name: "ZZORGOWNNAME",
          contact: [{ name: value, purpose: { text: "ADMIN" } }],
        });
        expect(out.json).not.toContain("ZZCONTACT");
        expect(out.json).toContain("ZZORGOWNNAME");
        expect(out.json).not.toContain('"name":4');
        expect(out.json).not.toContain('"name":null');
        // A list where R4 puts one name is blocked whole, like every other shape here.
        expect(out.manifest.map((m) => m.locus)).toEqual([`${resourceType}.contact[0].name`]);
        for (const row of out.manifest) expect(row.disposition).toBe("blocked");
        // Nothing at the contact's name is left to count as unexamined.
        expect(loci(out).filter((l) => l.includes("contact"))).toEqual([
          `${resourceType}.contact[0].purpose.text`,
        ]);
        expect(JSON.stringify(out.manifest)).not.toContain("ZZCONTACT");
      });
    }

    it(`removes a HumanName at ${resourceType}.contact.name as a name`, () => {
      const out = run({
        resourceType,
        contact: [{ name: { family: "ZZORGCONTACTFAM", given: ["ZZORGCONTACTGIV"] } }],
      });
      expect(out.json).not.toContain("ZZORGCONTACT");
      expect(categories(out)).toEqual([`${resourceType}.contact[0].name NAMES`]);
    });
  }

  it("reaches a string contact name inside a Bundle entry and inside a contained resource", () => {
    const bundle = run({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { resource: { resourceType: "InsurancePlan", contact: [{ name: "ZZCONTACTNAME" }] } },
      ],
    });
    expect(bundle.json).not.toContain("ZZCONTACTNAME");
    expect(rows(bundle)).toEqual(["Bundle.entry[0].resource.contact[0].name blocked"]);

    const contained = run({
      resourceType: "Coverage",
      status: "active",
      contained: [{ resourceType: "Organization", contact: [{ name: "ZZCONTACTNAME" }] }],
    });
    expect(contained.json).not.toContain("ZZCONTACTNAME");
    expect(rows(contained)).toEqual(["Coverage.contained[0].contact[0].name blocked"]);
  });

  it("removes a contact that arrives as one object rather than a list, whole", () => {
    const out = run({ resourceType: "Organization", contact: { name: "ZZCONTACTNAME" } });
    expect(out.json).not.toContain("ZZCONTACTNAME");
    expect(rows(out)).toEqual(["Organization.contact blocked"]);
  });

  it("removes one in a model built by hand", () => {
    const resource: FhirComplex = complex([
      { name: "resourceType", value: primitive("Organization") },
      {
        name: "contact",
        value: list([complex([{ name: "name", value: list([primitive("ZZCONTACTNAME")]) }])]),
      },
    ]);
    const { document, manifest } = deidentifyFhir(resource, { context: ctx });
    expect(serializeResource(document)).not.toContain("ZZCONTACTNAME");
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Organization.contact[0].name blocked",
    ]);
  });
});

/**
 * Every R4 resource element typed `ContactDetail`, from the R4 core package (4.0.1): `contact` on
 * every conformance and knowledge resource, and `author`, `editor`, `endorser` and `reviewer` on the
 * knowledge resources that define them.
 */
const CONTACT_ONLY = [
  "CapabilityStatement",
  "ChargeItemDefinition",
  "CodeSystem",
  "CompartmentDefinition",
  "ConceptMap",
  "ExampleScenario",
  "GraphDefinition",
  "ImplementationGuide",
  "MessageDefinition",
  "NamingSystem",
  "OperationDefinition",
  "Questionnaire",
  "ResearchStudy",
  "SearchParameter",
  "StructureDefinition",
  "StructureMap",
  "TerminologyCapabilities",
  "TestScript",
  "ValueSet",
];
const WITH_AUTHORSHIP = [
  "ActivityDefinition",
  "EffectEvidenceSynthesis",
  "EventDefinition",
  "Evidence",
  "EvidenceVariable",
  "Library",
  "Measure",
  "PlanDefinition",
  "ResearchDefinition",
  "ResearchElementDefinition",
  "RiskEvidenceSynthesis",
];
const CONTACT_DETAIL_ELEMENTS: readonly (readonly [string, string])[] = [
  ...CONTACT_ONLY.map((rt) => [rt, "contact"] as const),
  ...WITH_AUTHORSHIP.flatMap((rt) =>
    ["contact", "author", "editor", "endorser", "reviewer"].map((el) => [rt, el] as const),
  ),
];

describe("the name on every ContactDetail element R4 defines", () => {
  it("covers the R4 list: 19 resources with a contact, 11 with authorship as well", () => {
    expect(CONTACT_DETAIL_ELEMENTS).toHaveLength(19 + 11 * 5);
  });

  for (const [resourceType, element] of CONTACT_DETAIL_ELEMENTS) {
    it(`removes a string name at ${resourceType}.${element}.name as a name`, () => {
      // The resource's own string, at `name` where R4 defines one and at `title` where it does not
      // (`ChargeItemDefinition`, `ResearchStudy`): a key R4 does not define would be blocked.
      const own = fhirElementsOf(resourceType)?.has("name") === true ? "name" : "title";
      const out = run({
        resourceType,
        [own]: "ZZOWNCOMPUTERNAME",
        [element]: [{ name: "ZZCONTACTNAME" }],
      });
      expect(out.json).not.toContain("ZZCONTACTNAME");
      expect(out.json).toContain("ZZOWNCOMPUTERNAME");
      expect(out.manifest).toEqual([
        expect.objectContaining({
          locus: `${resourceType}.${element}[0].name`,
          category: C.NAMES,
          disposition: "removed",
        }),
      ]);
      expect(loci(out)).toEqual([`${resourceType}.${own}`]);
    });
  }

  for (const { label, value } of ODD_SHAPES.filter((s) => typeof s.value !== "string")) {
    it(`removes and records ${label} at a ContactDetail's name`, () => {
      const out = run({ resourceType: "ValueSet", status: "draft", contact: [{ name: value }] });
      expect(out.json).toBe('{"resourceType":"ValueSet","status":"draft","contact":[{}]}');
      expect(out.manifest.length).toBeGreaterThan(0);
      for (const row of out.manifest)
        expect(row.locus.startsWith("ValueSet.contact[0].name")).toBe(true);
      expect(loci(out)).toEqual(["ValueSet.status"]);
    });
  }

  it("blocks a ContactDetail's name that carries only a `_`-sibling, its extension with it", () => {
    // A name with no value of its own is no string the pass can remove as a name, so it goes whole.
    const out = run({
      resourceType: "ValueSet",
      status: "draft",
      contact: [
        {
          _name: { extension: [{ url: "http://example.org/zz", valueString: "ZZCONTACTEXT" }] },
        },
      ],
    });
    expect(out.json).not.toContain("ZZCONTACTEXT");
    expect(rows(out)).toEqual(["ValueSet.contact[0].name blocked"]);
  });

  it("removes a list of strings at a ContactDetail's name whole", () => {
    const out = run({
      resourceType: "Measure",
      author: [{ name: ["ZZCONTACTNAME", "ZZCONTACTOTHER"] }],
    });
    expect(out.json).not.toContain("ZZCONTACT");
    expect(rows(out)).toEqual(["Measure.author[0].name blocked"]);
  });

  it("blocks a HumanName sent at a ContactDetail's name, and any other object there", () => {
    const named = run({
      resourceType: "ValueSet",
      contact: [{ name: { family: "ZZORGCONTACTFAM", given: ["ZZORGCONTACTGIV"] } }],
    });
    expect(named.json).not.toContain("ZZORGCONTACT");
    // R4 puts a string there, so a structure is blocked whole, a HumanName among them.
    expect(rows(named)).toEqual(["ValueSet.contact[0].name blocked"]);

    // `{ name }` is the shape of a substance's name backbone where R4 types one at `name`. At a
    // contact's name it is a name the pass cannot read, so it goes whole rather than being descended.
    const nested = run({
      resourceType: "ValueSet",
      contact: [{ name: { name: "ZZCONTACTNAME" } }],
    });
    expect(nested.json).not.toContain("ZZCONTACTNAME");
    expect(rows(nested)).toEqual(["ValueSet.contact[0].name blocked"]);

    // An empty object is a structure where R4 puts a string too, so it goes the same way.
    const empty = run({ resourceType: "ValueSet", contact: [{ name: {} }] });
    expect(empty.json).toBe('{"resourceType":"ValueSet","contact":[{}]}');
    expect(rows(empty)).toEqual(["ValueSet.contact[0].name blocked"]);
  });

  it("removes a contact that arrives as a bare string where the ContactDetail belongs", () => {
    const out = run({
      resourceType: "Library",
      contact: ["ZZCONTACTNAME"],
      author: "ZZCONTACTOTHER",
    });
    expect(out.json).toBe('{"resourceType":"Library"}');
    expect(rows(out)).toEqual(["Library.contact blocked", "Library.author blocked"]);

    const org = run({ resourceType: "Organization", contact: "ZZCONTACTNAME" });
    expect(org.json).toBe('{"resourceType":"Organization"}');
    expect(rows(org)).toEqual(["Organization.contact blocked"]);
  });

  it("removes an InsurancePlan contact that arrives as a bare string", () => {
    const out = run({ resourceType: "InsurancePlan", contact: "ZZCONTACTNAME" });
    expect(out.json).toBe('{"resourceType":"InsurancePlan"}');
    expect(rows(out)).toEqual(["InsurancePlan.contact blocked"]);
    expect(loci(out)).toEqual([]);
  });

  it("reaches a contact name in a Bundle entry and in a contained resource", () => {
    const bundle = run({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: { resourceType: "Library", reviewer: [{ name: "ZZCONTACTNAME" }] } }],
    });
    expect(bundle.json).not.toContain("ZZCONTACTNAME");
    expect(categories(bundle)).toEqual(["Bundle.entry[0].resource.reviewer[0].name NAMES"]);

    const contained = run({
      resourceType: "Questionnaire",
      status: "draft",
      contained: [{ resourceType: "ValueSet", contact: [{ name: "ZZCONTACTNAME" }] }],
    });
    expect(contained.json).not.toContain("ZZCONTACTNAME");
    expect(categories(contained)).toEqual(["Questionnaire.contained[0].contact[0].name NAMES"]);
  });
});

describe("the open value[x] arms R4 types as a HumanName, a ContactDetail or a Contributor", () => {
  it("removes a contact name sent as a valueContactDetail on a Task or a Parameters", () => {
    const task = run({
      resourceType: "Task",
      status: "draft",
      intent: "order",
      input: [{ type: { text: "who" }, valueContactDetail: { name: "ZZCONTACTNAME" } }],
      output: [{ type: { text: "who" }, valueContactDetail: { name: "ZZCONTACTOTHER" } }],
    });
    expect(task.json).not.toContain("ZZCONTACT");
    expect(categories(task)).toEqual([
      "Task.input[0].valueContactDetail.name NAMES",
      "Task.output[0].valueContactDetail.name NAMES",
    ]);

    const params = run({
      resourceType: "Parameters",
      parameter: [{ name: "who", valueContactDetail: { name: "ZZCONTACTNAME" } }],
    });
    expect(params.json).toBe(
      '{"resourceType":"Parameters","parameter":[{"name":"who","valueContactDetail":{}}]}',
    );
    expect(categories(params)).toEqual(["Parameters.parameter[0].valueContactDetail.name NAMES"]);
  });

  it("removes a contact name inside a Contributor's ContactDetail", () => {
    const out = run({
      resourceType: "Parameters",
      parameter: [
        {
          name: "by",
          valueContributor: { type: "author", contact: [{ name: "ZZCONTACTNAME" }] },
        },
      ],
    });
    expect(out.json).not.toContain("ZZCONTACTNAME");
    expect(categories(out)).toEqual([
      "Parameters.parameter[0].valueContributor.contact[0].name NAMES",
    ]);
  });

  it("removes a contact name inside a Contributor on the ElementDefinition and StructureMap arms", () => {
    const out = run({
      resourceType: "StructureDefinition",
      snapshot: {
        element: [
          {
            path: "Library.author",
            fixedContributor: { type: "author", contact: [{ name: "ZZCONTACTNAME" }] },
            patternContributor: { type: "editor", contact: [{ name: "ZZCONTACTOTHER" }] },
            defaultValueContributor: { type: "reviewer", contact: [{ name: "ZZORGCONTACTFAM" }] },
          },
        ],
      },
    });
    expect(out.json).not.toContain("ZZCONTACT");
    expect(out.json).not.toContain("ZZORGCONTACT");
    expect(out.json).toContain('"path":"Library.author"');
    expect(categories(out)).toEqual([
      "StructureDefinition.snapshot.element[0].fixedContributor.contact[0].name NAMES",
      "StructureDefinition.snapshot.element[0].patternContributor.contact[0].name NAMES",
      "StructureDefinition.snapshot.element[0].defaultValueContributor.contact[0].name NAMES",
    ]);

    const map = run({
      resourceType: "StructureMap",
      group: [
        {
          name: "main",
          rule: [
            {
              name: "r1",
              source: [
                {
                  context: "src",
                  defaultValueContributor: { type: "author", contact: [{ name: "ZZCONTACTNAME" }] },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(map.json).not.toContain("ZZCONTACTNAME");
    expect(categories(map)).toEqual([
      "StructureMap.group[0].rule[0].source[0].defaultValueContributor.contact[0].name NAMES",
    ]);
  });

  it("removes a name on the ElementDefinition and StructureMap arms, whatever its shape", () => {
    const out = run({
      resourceType: "StructureDefinition",
      snapshot: {
        element: [
          {
            path: "Patient.name",
            fixedHumanName: "ZZCONTACTNAME",
            patternHumanName: ["ZZCONTACTOTHER"],
            defaultValueHumanName: { family: "ZZORGCONTACTFAM" },
            example: [{ label: "x", valueHumanName: "ZZORGCONTACTGIV" }],
          },
        ],
      },
      differential: {
        element: [
          {
            path: "Organization.contact",
            fixedContactDetail: { name: "ZZCONTACTNAME" },
            patternContactDetail: { name: "ZZCONTACTOTHER" },
            defaultValueContactDetail: { name: "ZZORGCONTACTFAM" },
            example: [{ label: "y", valueContactDetail: { name: "ZZORGCONTACTGIV" } }],
          },
        ],
      },
    });
    expect(out.json).not.toContain("ZZCONTACT");
    expect(out.json).not.toContain("ZZORGCONTACT");
    expect(out.json).toContain('"path":"Patient.name"');
    expect(categories(out)).toEqual([
      "StructureDefinition.snapshot.element[0].fixedHumanName OTHER_UNIQUE_ID",
      "StructureDefinition.snapshot.element[0].patternHumanName OTHER_UNIQUE_ID",
      "StructureDefinition.snapshot.element[0].defaultValueHumanName NAMES",
      "StructureDefinition.snapshot.element[0].example[0].valueHumanName OTHER_UNIQUE_ID",
      "StructureDefinition.differential.element[0].fixedContactDetail.name NAMES",
      "StructureDefinition.differential.element[0].patternContactDetail.name NAMES",
      "StructureDefinition.differential.element[0].defaultValueContactDetail.name NAMES",
      "StructureDefinition.differential.element[0].example[0].valueContactDetail.name NAMES",
    ]);

    const map = run({
      resourceType: "StructureMap",
      group: [
        {
          name: "main",
          rule: [
            {
              name: "r1",
              source: [
                { context: "src", defaultValueHumanName: "ZZCONTACTNAME" },
                { context: "src", defaultValueContactDetail: { name: "ZZCONTACTOTHER" } },
              ],
            },
          ],
        },
      ],
    });
    expect(map.json).not.toContain("ZZCONTACT");
    expect(map.json).toContain('"name":"main"');
    expect(map.json).toContain('"name":"r1"');
    expect(categories(map)).toEqual([
      "StructureMap.group[0].rule[0].source[0].defaultValueHumanName OTHER_UNIQUE_ID",
      "StructureMap.group[0].rule[0].source[1].defaultValueContactDetail.name NAMES",
    ]);
  });
});

describe("a name that is not a contact's, kept as it arrived", () => {
  it("keeps an organisation's, a value set's and a parameter's own name", () => {
    for (const resource of [
      { resourceType: "Organization", name: "ZZORGOWNNAME" },
      { resourceType: "InsurancePlan", name: "ZZORGOWNNAME" },
      { resourceType: "ValueSet", name: "ZZOWNCOMPUTERNAME" },
      { resourceType: "Parameters", parameter: [{ name: "ZZOWNCOMPUTERNAME" }] },
      { resourceType: "StructureMap", group: [{ name: "ZZOWNCOMPUTERNAME" }] },
    ]) {
      const out = run(resource);
      expect(out.json).toBe(JSON.stringify(resource));
      expect(out.manifest).toEqual([]);
    }
  });

  it("keeps an Endpoint's ContactPoint, and blocks a contact R4 does not define", () => {
    // `Endpoint.contact` is a ContactPoint, not a ContactDetail, and is kept. A `contact` R4 never put
    // on an Observation is a key it does not define there, so it is blocked whole, not read as one, and
    // its row names its position, not the key.
    const endpoint = {
      resourceType: "Endpoint",
      status: "active",
      contact: [{ system: "url", value: "https://example.org/fhir/endpoint" }],
    };
    const out = run(endpoint);
    expect(out.json).toBe(JSON.stringify(endpoint));
    expect(out.manifest).toEqual([]);

    const lookalike = {
      resourceType: "Observation",
      status: "final",
      contact: [{ name: "ZZOWNCOMPUTERNAME" }],
    };
    const blocked = run(lookalike);
    expect(blocked.json).toBe('{"resourceType":"Observation","status":"final"}');
    expect(rows(blocked)).toEqual(["Observation.<withheld>[2] blocked"]);
    expect(loci(blocked)).toEqual(["Observation.status"]);
  });
});
