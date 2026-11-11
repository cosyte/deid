/**
 * The FHIR adapter's opt-in **transform labels**: a `meta.security` coding of `REDACTED` on every
 * resource the pass changed, and a Data Absent Reason of `masked` in place of a value the pass removed
 * where R4 requires the element. Off by default, so the output of a call without the option is
 * unchanged. Every labeled output is serialized and parsed again with `@cosyte/fhir`.
 *
 * All values are synthetic `ZZ` sentinels.
 */

import {
  complex,
  getProperty,
  isComplex,
  list,
  parseResource,
  primitive,
  serializeResource,
  type FhirComplex,
  type FhirNode,
} from "@cosyte/fhir";
import { describe, expect, it } from "vitest";

import { type TransformedLocus } from "../../src/index.js";
import {
  applyFhir,
  deidentifyFhirJson,
  FHIR_DATA_ABSENT_REASON,
  FHIR_TRANSFORMED_SECURITY_LABEL,
  type FhirCoord,
} from "../../src/fhir/index.js";

const SECURITY = {
  system: "http://terminology.hl7.org/CodeSystem/v3-ObservationValue",
  code: "REDACTED",
  display: "redacted",
};
const ABSENT = {
  url: "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
  valueCode: "masked",
};

/** The output as plain JSON, with the members these tests read. */
interface Out {
  readonly [name: string]: unknown;
  readonly meta?: unknown;
  readonly contained?: unknown;
  readonly entry?: unknown;
  readonly payload?: unknown;
  readonly target?: unknown;
}

/** De-identify a synthetic resource with the labels on, and prove the output parses again. */
function labeled(resource: unknown): Out {
  const { json } = deidentifyFhirJson(JSON.stringify(resource), { transformLabels: true });
  const reparsed = parseResource(json);
  expect(reparsed.issues).toEqual([]);
  expect(serializeResource(reparsed.resource)).toBe(json);
  return JSON.parse(json) as Out;
}

function plain(resource: unknown): Out {
  return JSON.parse(deidentifyFhirJson(JSON.stringify(resource)).json) as Out;
}

const removed = (path: string): TransformedLocus => ({
  path,
  kind: "unknown",
  value: null,
  disposition: "removed",
});

/** The node at a property of a complex, for a hand-built coordinate. */
function at(node: FhirNode | undefined, name: string): FhirNode {
  if (node === undefined || !isComplex(node)) throw new Error("fixture");
  const value = getProperty(node, name);
  if (value === undefined) throw new Error("fixture");
  return value;
}

function first(node: FhirNode): FhirNode {
  if (node.kind !== "list" || node.items[0] === undefined) throw new Error("fixture");
  return node.items[0];
}

describe("the published codes", () => {
  it("are the v3 REDACTED integrity code and the masked Data Absent Reason", () => {
    expect(FHIR_TRANSFORMED_SECURITY_LABEL).toEqual(SECURITY);
    expect(FHIR_DATA_ABSENT_REASON).toEqual(ABSENT);
  });
});

describe("off by default", () => {
  it("writes no label and no Data Absent Reason without the option", () => {
    const out = plain({
      resourceType: "Condition",
      code: { coding: [{ system: "http://snomed.info/sct", code: "38341003" }] },
      subject: { display: "ZZPATIENTNAME" },
    });
    // The emptied Reference is written as an empty object, with nothing to say why.
    expect(out).toEqual({
      resourceType: "Condition",
      code: { coding: [{ system: "http://snomed.info/sct", code: "38341003" }] },
      subject: {},
    });
  });
});

describe("the meta.security label", () => {
  it("marks a resource the pass changed, after its id", () => {
    const { json } = deidentifyFhirJson(
      JSON.stringify({ resourceType: "Patient", id: "zz1", name: [{ family: "ZZFAMILY" }] }),
      { transformLabels: true },
    );
    expect(json).toBe(
      `{"resourceType":"Patient","id":"1","meta":{"security":[${JSON.stringify(SECURITY)}]}}`,
    );
  });

  it("goes after the resourceType when the resource has no id", () => {
    const { json } = deidentifyFhirJson(
      JSON.stringify({ resourceType: "Patient", gender: "male", name: [{ family: "ZZFAMILY" }] }),
      { transformLabels: true },
    );
    expect(json).toBe(
      `{"resourceType":"Patient","meta":{"security":[${JSON.stringify(SECURITY)}]},"gender":"male"}`,
    );
  });

  it("leaves a resource the pass did not change unlabeled", () => {
    const out = labeled({ resourceType: "Patient", gender: "female", active: true });
    expect(out).toEqual({ resourceType: "Patient", gender: "female", active: true });
  });

  it("marks a resource whose only change was a primitive extension the pass dropped", () => {
    const out = labeled({
      resourceType: "Patient",
      gender: "female",
      _gender: { extension: [{ url: "http://example.com/zz", valueString: "ZZNOTE" }] },
    });
    expect(out).toEqual({
      resourceType: "Patient",
      meta: { security: [SECURITY] },
      gender: "female",
    });
  });

  it("joins an existing meta: kept in place, the label before any tag, never twice", () => {
    const tag = { system: "http://example.com/tags", code: "zz-tag" };
    const other = { system: "http://example.com/labels", code: "zz-label" };
    const out = labeled({
      resourceType: "Patient",
      meta: { lastUpdated: "2020-01-01T00:00:00Z", security: [other], tag: [tag] },
      name: [{ family: "ZZFAMILY" }],
    });
    // The pass generalizes the instant to its year, as it does every date.
    expect(out.meta).toEqual({
      lastUpdated: "2020",
      security: [other, SECURITY],
      tag: [tag],
    });
    expect(Object.keys(out.meta as object)).toEqual(["lastUpdated", "security", "tag"]);

    const again = labeled({
      resourceType: "Patient",
      meta: { security: [SECURITY], tag: [tag] },
      name: [{ family: "ZZFAMILY" }],
    });
    expect(again.meta).toEqual({ security: [SECURITY], tag: [tag] });
  });

  it("adds a security list to a meta that has none, before its tag", () => {
    const tag = { system: "http://example.com/tags", code: "zz-tag" };
    const out = labeled({
      resourceType: "Patient",
      meta: { tag: [tag] },
      name: [{ family: "ZZFAMILY" }],
    });
    expect(Object.keys(out.meta as object)).toEqual(["security", "tag"]);
    const tail = labeled({
      resourceType: "Patient",
      meta: { lastUpdated: "2020-01-01T00:00:00Z" },
      name: [{ family: "ZZFAMILY" }],
    });
    expect(tail.meta).toEqual({ lastUpdated: "2020", security: [SECURITY] });
  });

  it("reads a single security coding sent without its array, and a coding with no system", () => {
    const other = { code: "zz-label" };
    const out = labeled({
      resourceType: "Patient",
      meta: { security: other },
      name: [{ family: "ZZFAMILY" }],
    });
    expect(out.meta).toEqual({ security: [other, SECURITY] });
  });

  it("leaves a meta that is not an object as it arrived in a hand-built model", () => {
    const resource = complex([
      { name: "resourceType", value: primitive("Patient") },
      { name: "meta", value: primitive("zz") },
      { name: "gender", value: primitive("male") },
    ]);
    const gender = at(resource, "gender");
    const out = applyFhir(resource, [removed("gender")], [{ node: gender, edit: "drop" }], {
      transformLabels: true,
    });
    expect(out).toEqual(
      complex([
        { name: "resourceType", value: primitive("Patient") },
        { name: "meta", value: primitive("zz") },
      ]),
    );
  });

  it("labels the container, never a contained resource (dom-5)", () => {
    const out = labeled({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "2951-2" }] },
      contained: [{ resourceType: "Patient", name: [{ family: "ZZFAMILY" }] }],
    });
    expect(out.meta).toEqual({ security: [SECURITY] });
    expect(out.contained).toEqual([{ resourceType: "Patient" }]);
  });

  it("labels each Bundle entry by what happened to it", () => {
    const out = labeled({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { resource: { resourceType: "Patient", name: [{ family: "ZZFAMILY" }] } },
        { resource: { resourceType: "Patient", gender: "male" } },
      ],
    });
    expect(out.meta).toBeUndefined();
    expect(out.entry).toEqual([
      { resource: { resourceType: "Patient", meta: { security: [SECURITY] } } },
      { resource: { resourceType: "Patient", gender: "male" } },
    ]);
  });

  it("reads past a security entry it cannot read, and appends the label", () => {
    const odd = list([
      primitive("zz"),
      complex([{ name: "system", value: complex([]) }]),
      complex([{ name: "code", value: primitive("REDACTED") }]),
    ]);
    const gender = primitive("male");
    const resource = complex([
      { name: "resourceType", value: primitive("Patient") },
      { name: "meta", value: complex([{ name: "security", value: odd }]) },
      { name: "gender", value: gender },
    ]);
    const out = applyFhir(resource, [removed("gender")], [{ node: gender, edit: "drop" }], {
      transformLabels: true,
    });
    const security = at(at(out, "meta"), "security");
    expect(security.kind === "list" ? security.items.length : 0).toBe(4);
  });

  it("types only a string resourceType as a resource", () => {
    const name = list([complex([{ name: "family", value: primitive("ZZFAMILY") }])]);
    const resource = complex([
      { name: "resourceType", value: primitive("Basic") },
      { name: "code", value: complex([{ name: "text", value: primitive("zz") }]) },
      {
        name: "extension",
        value: list([
          complex([
            { name: "resourceType", value: primitive(true) },
            { name: "name", value: name },
          ]),
          complex([{ name: "resourceType", value: complex([]) }]),
        ]),
      },
    ]);
    const out = applyFhir(resource, [removed("name")], [{ node: name, edit: "drop" }], {
      transformLabels: true,
    });
    // Neither odd complex is a resource of its own, so the change counts for the Basic around it.
    expect(at(out, "meta")).toEqual(
      complex([
        {
          name: "security",
          value: list([
            complex([
              { name: "system", value: primitive(SECURITY.system) },
              { name: "code", value: primitive(SECURITY.code) },
              { name: "display", value: primitive(SECURITY.display) },
            ]),
          ]),
        },
      ]),
    );
  });

  it("does not count a retained locus as a change", () => {
    const resource = complex([
      { name: "resourceType", value: primitive("Patient") },
      { name: "birthDate", value: primitive("1970-01-01") },
    ]);
    const coords: FhirCoord[] = [{ node: at(resource, "birthDate"), edit: "set-primitive" }];
    const kept: TransformedLocus = {
      path: "Patient.birthDate",
      kind: "date",
      value: "1970-01-01",
      disposition: "retained",
    };
    const out = applyFhir(resource, [kept], coords, { transformLabels: true });
    expect(serializeResource(out)).toBe('{"resourceType":"Patient","birthDate":"1970-01-01"}');
  });
});

describe("the Data Absent Reason", () => {
  it("stands in for a required Reference the pass emptied", () => {
    const out = labeled({
      resourceType: "Condition",
      code: { coding: [{ system: "http://snomed.info/sct", code: "38341003" }] },
      subject: { display: "ZZPATIENTNAME" },
    });
    expect(out).toEqual({
      resourceType: "Condition",
      meta: { security: [SECURITY] },
      code: { coding: [{ system: "http://snomed.info/sct", code: "38341003" }] },
      subject: { extension: [ABSENT] },
    });
  });

  it("stands in for a required choice primitive, on its own _ sibling", () => {
    const { json } = deidentifyFhirJson(
      JSON.stringify({
        resourceType: "Communication",
        status: "completed",
        payload: [{ contentString: "ZZMESSAGEBODY" }],
      }),
      { transformLabels: true },
    );
    expect(json).not.toContain("ZZMESSAGEBODY");
    const out = labeled({
      resourceType: "Communication",
      status: "completed",
      payload: [{ contentString: "ZZMESSAGEBODY" }],
    });
    expect(out.payload).toEqual([{ _contentString: { extension: [ABSENT] } }]);
  });

  it("stands in for a required list the pass emptied, with one absent item", () => {
    const out = labeled({
      resourceType: "Provenance",
      recorded: "2020-01-01T00:00:00Z",
      target: [{ display: "ZZTARGET" }],
    });
    expect(out.target).toEqual([{ extension: [ABSENT] }]);
  });

  it("writes nothing in place of a required element the sender sent empty", () => {
    const { json } = deidentifyFhirJson(
      JSON.stringify({ resourceType: "Provenance", target: [{}], recorded: "2020-01-01" }),
      { transformLabels: true },
    );
    expect(json).not.toContain("data-absent-reason");
  });

  it("writes nothing in place of an optional element", () => {
    const out = labeled({ resourceType: "Patient", telecom: [{ value: "555-000-1234" }] });
    expect(out).toEqual({ resourceType: "Patient", meta: { security: [SECURITY] } });
  });

  it("reads a nested element through the definition it reuses", () => {
    const linkId = primitive("zz-q1");
    const resource = complex([
      { name: "resourceType", value: primitive("Questionnaire") },
      { name: "status", value: primitive("active") },
      {
        name: "item",
        value: list([
          complex([
            { name: "linkId", value: primitive("zz-q0") },
            { name: "type", value: primitive("group") },
            {
              name: "item",
              value: list([
                complex([
                  { name: "linkId", value: linkId },
                  { name: "type", value: primitive("string") },
                ]),
              ]),
            },
          ]),
        ]),
      },
    ]);
    const out = applyFhir(resource, [removed("linkId")], [{ node: linkId, edit: "drop" }], {
      transformLabels: true,
    });
    const json = JSON.parse(serializeResource(out)) as { item: { item: unknown[] }[] };
    expect(json.item[0]?.item).toEqual([{ _linkId: { extension: [ABSENT] }, type: "string" }]);
  });

  it("keeps a primitive list a primitive list", () => {
    const variable = list([primitive("zzvar")]);
    const resource = complex([
      { name: "resourceType", value: primitive("StructureMap") },
      {
        name: "group",
        value: list([
          complex([
            {
              name: "rule",
              value: list([
                complex([
                  {
                    name: "dependent",
                    value: list([
                      complex([
                        { name: "name", value: primitive("zzdep") },
                        { name: "variable", value: variable },
                      ]),
                    ]),
                  },
                ]),
              ]),
            },
          ]),
        ]),
      },
    ]);
    const out = applyFhir(resource, [removed("variable")], [{ node: variable, edit: "drop" }], {
      transformLabels: true,
    });
    const dependent = first(at(first(at(first(at(out, "group")), "rule")), "dependent"));
    const absent = at(dependent, "variable");
    expect(absent).toEqual(
      list([
        primitive(undefined, {
          extension: [
            complex([
              { name: "url", value: primitive(ABSENT.url) },
              { name: "valueCode", value: primitive(ABSENT.valueCode) },
            ]),
          ],
        }),
      ]),
    );
  });

  it("leaves the hand-built root it cannot type unlabeled", () => {
    const name = list([complex([{ name: "family", value: primitive("ZZFAMILY") }])]);
    const resource: FhirComplex = complex([{ name: "name", value: name }]);
    const out = applyFhir(resource, [removed("name")], [{ node: name, edit: "drop" }], {
      transformLabels: true,
    });
    expect(out).toEqual(complex([]));
  });
});
