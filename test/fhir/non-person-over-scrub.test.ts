/**
 * **FHIR: the mirror gate on the widened sweep.**
 *
 * Reaching further into a graph is only half a change, and it is the safe-looking half. The sweep now
 * visits every resource in the document rather than the four person types, so a rule that mis-typed a
 * clinical or administrative value as a name or an address would destroy a dose, a unit, a status or a
 * facility's own identity in data a consumer has already released, and no re-run recalls a release.
 *
 * So this suite asserts the other direction: a document carrying **none** of the newly-swept elements
 * comes out of the pass **byte for byte** as it went in, with an empty manifest and an unchanged
 * residual inventory. Byte identity is the assertion deliberately, because "the values I remembered to
 * check are still there" is exactly the shape of test that misses the one nobody listed.
 *
 * The suite would be worthless if the sweep never ran, so the last case is the non-vacuity control:
 * the same document with one `HumanName` added does change, and changes only there.
 *
 * Every value is a synthetic sentinel or a published code.
 */

import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { parseResource, serializeResource } from "@cosyte/fhir";

import {
  createDeidContext,
  profileOptions,
  SAFE_HARBOR_PROFILE,
  SAFE_HARBOR_CATEGORIES,
} from "../../src/index.js";
import { deidentifyFhir } from "../../src/fhir/index.js";

const ctx = createDeidContext({ key: "over-scrub-key", patientId: "p-over-scrub" });
const options = (): ReturnType<typeof profileOptions> => profileOptions(SAFE_HARBOR_PROFILE, ctx);

/** The same compact fingerprint the cross-format corpus uses; it carries nothing of the document. */
const digest = (wire: string): string =>
  createHash("sha256").update(wire, "utf8").digest("hex").slice(0, 32);

/**
 * A graph of NON-person resources built entirely from the values the widened sweep must not touch: an
 * organisation's own `name` (a plain string, not a `HumanName`), a `Coding.display`, an `Observation`
 * code, value, unit and status, `Reference.reference` wiring, and every resource's logical `id`. It
 * deliberately carries no date, no identifier, no narrative and no extension either, so the expected
 * outcome is the strongest one available: nothing at all happens to it.
 */
const OVER_SCRUB_GRAPH = {
  resourceType: "Bundle",
  type: "collection",
  entry: [
    {
      fullUrl: "urn:uuid:organization-9",
      resource: {
        resourceType: "Organization",
        id: "org9",
        active: true,
        name: "ZZORGOWNNAME",
        alias: ["ZZORGALIAS"],
        type: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/organization-type",
                code: "prov",
                display: "ZZORGTYPEDISPLAY",
              },
            ],
          },
        ],
        telecom: [{ system: "phone", value: "555-000-8881", use: "work" }],
        partOf: { reference: "Organization/org8" },
      },
    },
    {
      fullUrl: "urn:uuid:location-9",
      resource: {
        resourceType: "Location",
        id: "loc9",
        status: "active",
        name: "ZZLOCNAME",
        physicalType: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/location-physical-type",
              code: "bu",
              display: "Building",
            },
          ],
        },
        position: { longitude: -71.1, latitude: 42.3 },
        managingOrganization: { reference: "Organization/org9" },
      },
    },
    {
      fullUrl: "urn:uuid:observation-9",
      resource: {
        resourceType: "Observation",
        id: "obs9",
        status: "final",
        code: {
          coding: [
            {
              system: "http://loinc.org",
              code: "2951-2",
              display: "Sodium [Moles/volume] in Serum or Plasma",
            },
          ],
        },
        valueQuantity: {
          value: 140,
          unit: "mmol/L",
          system: "http://unitsofmeasure.org",
          code: "mmol/L",
        },
        referenceRange: [{ low: { value: 135, unit: "mmol/L" } }],
        subject: { reference: "Patient/pat9" },
      },
    },
  ],
};

function pass(graph: unknown): {
  before: string;
  after: string;
  manifest: readonly { locus: string }[];
  residuals: string[];
} {
  const raw = JSON.stringify(graph);
  const { resource } = parseResource(raw);
  const { document, manifest, unexaminedResiduals } = deidentifyFhir(resource, options());
  return {
    before: serializeResource(resource),
    after: serializeResource(document),
    manifest,
    residuals: unexaminedResiduals.map((r) => r.locus),
  };
}

describe("the widened sweep changes nothing about a document that carries none of it", () => {
  const run = pass(OVER_SCRUB_GRAPH);

  it("the transformed document is byte-identical to the document that went in", () => {
    expect(run.after).toBe(run.before);
  });

  it("and its digest is the one the pass produced before the sweep widened", () => {
    // Captured by running this exact graph through the pass at the pin, with the datatype sweep
    // stashed out of `src/fhir/`. It is here as a HISTORICAL pin rather than as a restatement of the
    // assertion above: byte identity says the pass did nothing today, this says it also did nothing
    // yesterday, so a future change that starts acting here has to move a written-down number.
    expect(digest(run.after)).toMatchInlineSnapshot(`"b460b9f6640bf68ba1534c0170c4c5d6"`);
  });

  it("nothing is recorded as acted on", () => {
    expect(run.manifest).toEqual([]);
  });

  it("every named value survives, spelled out so a reader can see which ones were checked", () => {
    for (const survivor of [
      "ZZORGOWNNAME", // an organisation's own name: a string, never a HumanName
      "ZZORGALIAS",
      "ZZORGTYPEDISPLAY", // a Coding.display: a coded term, positively typed as one
      "Sodium [Moles/volume] in Serum or Plasma",
      "2951-2", // the Observation code
      "140", // its value
      "mmol/L", // its unit
      "final", // its status
      "Organization/org9", // reference wiring
      "Patient/pat9",
      "org9", // a resource logical id
      "loc9",
      "obs9",
    ]) {
      expect(run.after).toContain(survivor);
    }
  });

  it("and the residual inventory still measures every one of those positions", () => {
    for (const locus of [
      "Bundle.entry[0].resource.name",
      "Bundle.entry[0].resource.alias[0]",
      "Bundle.entry[2].resource.code.coding[0].code",
      "Bundle.entry[2].resource.valueQuantity.unit",
      "Bundle.entry[2].resource.status",
      "Bundle.entry[2].resource.subject.reference",
    ]) {
      expect(run.residuals).toContain(locus);
    }
    // A `Coding.display` is the one exception and it is not a gap: the pass positively typed it as a
    // coded term rather than a person label, so it is examined, and it stays out of this inventory
    // exactly as it did before the sweep widened.
    for (const locus of run.residuals) expect(locus.endsWith("coding[0].display")).toBe(false);
  });
});

describe("NON-VACUITY: the same graph with one name added does change, and only there", () => {
  const withName = pass({
    ...OVER_SCRUB_GRAPH,
    entry: [
      {
        ...OVER_SCRUB_GRAPH.entry[0],
        resource: {
          ...OVER_SCRUB_GRAPH.entry[0]?.resource,
          contact: [{ name: { family: "ZZORGCONTACTFAM" } }],
        },
      },
      ...OVER_SCRUB_GRAPH.entry.slice(1),
    ],
  });

  it("the added HumanName is removed and recorded", () => {
    expect(withName.after).not.toBe(withName.before);
    expect(withName.after).not.toContain("ZZORGCONTACTFAM");
    expect(withName.manifest.map((m) => m.locus)).toEqual([
      "Bundle.entry[0].resource.contact[0].name",
    ]);
  });

  it("and taking it back out reproduces the untouched document exactly", () => {
    const run = pass(OVER_SCRUB_GRAPH);
    expect(withName.after.replace(',"contact":[{}]', "").replace('"contact":[{}],', "")).toBe(
      run.after,
    );
  });
});

describe("a conformant R4 element that merely shares a property NAME with an Address", () => {
  // R4 gives several resources an element called `country`, and every one of them is a
  // `CodeableConcept` while `Address.country` is a `string`. The backbones carrying them make every
  // child optional, so a conformant instance can arrive with `country` and nothing else: closed for
  // `Address`, marked for `Address`, and not remotely an address. The classifier reads the marker's
  // VALUE SHAPE, which is what tells the two apart at the position instead of by luck.
  it("leaves MedicinalProductAuthorization.jurisdictionalAuthorization exactly as it arrived", () => {
    const run = pass({
      resourceType: "MedicinalProductAuthorization",
      jurisdictionalAuthorization: [{ country: { text: "US" } }],
    });
    expect(run.after).toBe(run.before);
    expect(run.manifest).toEqual([]);
  });

  it("leaves the same element alone when its other optional children are present", () => {
    const run = pass({
      resourceType: "MedicinalProductAuthorization",
      jurisdictionalAuthorization: [
        { country: { text: "US" }, legalStatusOfSupply: { text: "Rx" } },
      ],
    });
    expect(run.after).toBe(run.before);
    expect(run.manifest).toEqual([]);
  });

  it("leaves a Questionnaire.item alone: `prefix` is a HumanName marker and this is not a name", () => {
    // The mirror of the case above on the name side, and the reason the fail-closed block on a
    // marker-bearing complex is scoped to a position R4 TYPES as one of the two datatypes: at an
    // arbitrary element name the same evidence is a conformant structural backbone.
    const run = pass({
      resourceType: "Questionnaire",
      status: "active",
      item: [{ linkId: "q1", prefix: "A.", text: "ZZORGOWNNAME", type: "string" }],
    });
    expect(run.after).toBe(run.before);
    expect(run.manifest).toEqual([]);
  });

  it("leaves a MedicinalProduct.name backbone alone, at the typed element name `name` itself", () => {
    const run = pass({
      resourceType: "MedicinalProduct",
      name: [
        {
          productName: "ZZORGOWNNAME",
          namePart: [{ part: "ZZORGALIAS", type: { text: "invented" } }],
        },
      ],
    });
    expect(run.after).toBe(run.before);
    expect(run.manifest).toEqual([]);
  });

  it("leaves a SubstanceSpecification.name backbone alone, at that same element name", () => {
    // The other of exactly two conformant R4 backbones that sit at `name`. At a typed element name
    // the fail-closed rule blocks whatever the classifier cannot pin down, so these two are excluded
    // POSITIVELY, by the property R4 makes 1..1 on each plus the backbone's own closed property set.
    const run = pass({
      resourceType: "SubstanceSpecification",
      name: [
        {
          name: "ZZORGOWNNAME",
          type: { text: "Systematic" },
          preferred: true,
          official: [{ authority: { text: "USP" }, status: { text: "current" } }],
        },
      ],
    });
    expect(run.after).toBe(run.before);
    expect(run.manifest).toEqual([]);
  });

  it("blocks a product name carrying a property R4 does not define on that backbone", () => {
    // The exclusion is closed for the same reason the classification is: an unrecognized sibling
    // means the pass is not looking at the backbone it thinks it is. Fail closed there, and pay the
    // cost on NON-conformant input rather than on a released person name.
    const run = pass({
      resourceType: "MedicinalProduct",
      name: [{ productName: "ZZORGOWNNAME", vendorLabel: "ZZORGALIAS" }],
    });
    expect(run.after).not.toBe(run.before);
    expect(run.after).not.toContain("ZZORGOWNNAME");
    expect(run.manifest.map((m) => m.locus)).toEqual(["MedicinalProduct.name"]);
  });

  it("blocks a person's name hidden behind a product name's required property", () => {
    // The mirror half: carrying `productName` is not on its own a licence to descend, or a producer
    // could park a HumanName beside it and walk the family name out one primitive at a time.
    const run = pass({
      resourceType: "MedicinalProduct",
      name: [
        { productName: "ZZORGOWNNAME", family: "ZZORGCONTACTFAM", given: ["ZZORGCONTACTGIV"] },
      ],
    });
    expect(run.after).not.toContain("ZZORGCONTACTFAM");
    expect(run.after).not.toContain("ZZORGCONTACTGIV");
    expect(run.manifest.map((m) => m.locus)).toEqual(["MedicinalProduct.name"]);
  });

  it("does not extend the product-name exclusion to an element name R4 types as an Address", () => {
    // Both backbones sit at `name` and the exclusion is read at the position: the same bytes at
    // `address` are a shape the pass cannot read where R4 promised an Address, and are blocked.
    const run = pass({
      resourceType: "Location",
      address: { productName: "ZZORGOWNNAME" },
    });
    expect(run.after).not.toContain("ZZORGOWNNAME");
    expect(run.manifest.map((m) => m.locus)).toEqual(["Location.address"]);
  });
});

describe("the sweep is keyed on the datatype, never on the category name", () => {
  it("a GEOGRAPHIC category still reaches only elements the classifier typed as an Address", () => {
    const run = pass({
      resourceType: "Location",
      id: "loc9",
      // `Endpoint.address` is a url string in R4 and this shape is its analogue: a plain string at a
      // name the sweep watches. It is not an Address, so it is not swept.
      address: "https://example.com/endpoint",
      status: "active",
    });
    expect(run.after).toBe(run.before);
    expect(run.manifest).toEqual([]);
    expect(SAFE_HARBOR_CATEGORIES.GEOGRAPHIC).toBe("GEOGRAPHIC");
  });
});
