/**
 * **FHIR: every element id is replaced, and the links to one still resolve.**
 *
 * FHIR lets every element carry an `id`: a datatype (`Observation.code.id`), a backbone element, a
 * `Coding`, an extension, and a primitive through its `_`-sibling (`_status.id`). R4 gives it no
 * meaning outside the document, and a sender can write anything there, a name or a record number
 * among them. So the pass treats it as it treats a resource's logical id: it is replaced, the same id
 * by the same replacement throughout one call, and the one R4 element that points at an element id
 * (`relatedAction.actionId` in a `RequestGroup` or a `PlanDefinition`) is replaced alike, so the link
 * still resolves. Under Safe Harbor the replacement is a per-call sequence number; under a keyed
 * policy it is the keyed surrogate. Every replacement has a manifest row, and no row carries a value.
 *
 * Every value is a synthetic sentinel (`ZZ...`) or a published code.
 */

import { describe, expect, it } from "vitest";
import { parseResource, serializeResource } from "@cosyte/fhir";

import {
  createDeidRegistry,
  defineDeidPolicy,
  DEID_DISPOSITION_CODES as D,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_CATEGORIES as C,
  SAFE_HARBOR_PROFILE,
  type DeidManifestEntry,
} from "../../src/index.js";
import { deidentifyFhir, extractFhirLoci } from "../../src/fhir/index.js";

/** Run one JSON value through the pass and return the output, its manifest and its residuals. */
function pass(
  json: unknown,
  options: Parameters<typeof deidentifyFhir>[1] = {},
): {
  readonly out: Record<string, unknown>;
  readonly wire: string;
  readonly manifest: readonly DeidManifestEntry[];
  readonly residuals: readonly string[];
} {
  const { resource } = parseResource(JSON.stringify(json));
  const result = deidentifyFhir(resource, options);
  const wire = serializeResource(result.document);
  return {
    out: JSON.parse(wire) as Record<string, unknown>,
    wire,
    manifest: result.manifest,
    residuals: result.unexaminedResiduals.map((r) => r.locus),
  };
}

/** Read a nested value by a dotted path with numeric list indexes. */
function at(value: unknown, path: string): unknown {
  let node: unknown = value;
  for (const seg of path.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[seg];
  }
  return node;
}

/** The manifest rows at a locus. */
function rows(manifest: readonly DeidManifestEntry[], locus: string): DeidManifestEntry[] {
  return manifest.filter((e) => e.locus === locus);
}

/**
 * A synthetic Observation with an element id at every kind of position: each id is a sentinel, and
 * where it sits is the locus its manifest row must name.
 */
const OBSERVATION = {
  resourceType: "Observation",
  id: "zz-obs-1",
  meta: { id: "ZZEIDMETA", versionId: "1" },
  text: {
    id: "ZZEIDTEXT",
    status: "generated",
    div: '<div xmlns="http://www.w3.org/1999/xhtml">zz</div>',
  },
  contained: [
    {
      resourceType: "Observation",
      id: "zz-contained-1",
      status: "final",
      code: { id: "ZZEIDCONTAINEDCODE", text: "zz sodium" },
    },
  ],
  extension: [
    {
      id: "ZZEIDEXT",
      url: "http://example.org/zz-ext",
      valueBoolean: true,
      extension: [{ id: "ZZEIDNESTEDEXT", url: "inner", valueBoolean: false }],
    },
  ],
  modifierExtension: [{ id: "ZZEIDMODEXT", url: "http://example.org/zz-mod", valueBoolean: true }],
  identifier: [
    {
      id: "ZZEIDIDENTIFIER",
      system: "urn:oid:2.25.9",
      value: "zz1",
      period: { id: "ZZEIDPERIOD" },
    },
  ],
  status: "final",
  _status: { id: "ZZEIDSTATUS" },
  code: {
    id: "ZZEIDCODE",
    coding: [
      {
        id: "ZZEIDCODING",
        system: "http://loinc.org",
        code: "2951-2",
        _code: { id: "ZZEIDCODINGCODE" },
      },
    ],
  },
  subject: { id: "ZZEIDSUBJECT", reference: "#zz-contained-1", _reference: { id: "ZZEIDREF" } },
  valueQuantity: {
    id: "ZZEIDQUANTITY",
    value: 140,
    _value: { id: "ZZEIDQUANTITYVALUE" },
    unit: "mmol/L",
  },
  component: [{ id: "ZZEIDCOMPONENT", code: { text: "zz part" } }],
};

/** Each sentinel id in {@link OBSERVATION} and the locus its manifest row names. */
const OBSERVATION_IDS: readonly (readonly [string, string])[] = [
  ["ZZEIDMETA", "Observation.meta.id"],
  ["ZZEIDTEXT", "Observation.text.id"],
  ["ZZEIDCONTAINEDCODE", "Observation.contained[0].code.id"],
  ["ZZEIDEXT", "Observation.extension[0].id"],
  ["ZZEIDNESTEDEXT", "Observation.extension[0].extension[0].id"],
  ["ZZEIDMODEXT", "Observation.modifierExtension[0].id"],
  ["ZZEIDIDENTIFIER", "Observation.identifier[0].id"],
  ["ZZEIDPERIOD", "Observation.identifier[0].period.id"],
  ["ZZEIDSTATUS", "Observation._status.id"],
  ["ZZEIDCODE", "Observation.code.id"],
  ["ZZEIDCODING", "Observation.code.coding[0].id"],
  ["ZZEIDCODINGCODE", "Observation.code.coding[0]._code.id"],
  ["ZZEIDSUBJECT", "Observation.subject.id"],
  ["ZZEIDQUANTITY", "Observation.valueQuantity.id"],
  ["ZZEIDQUANTITYVALUE", "Observation.valueQuantity._value.id"],
  ["ZZEIDCOMPONENT", "Observation.component[0].id"],
];

describe("FHIR element ids under the Safe Harbor default", () => {
  const raw = JSON.stringify(OBSERVATION);
  const run = pass(OBSERVATION);

  it("the sentinels are really in the input (non-vacuity)", () => {
    for (const [s] of OBSERVATION_IDS) expect(raw).toContain(s);
  });

  it("no element id survives in the output, the manifest or the residual inventory", () => {
    for (const [s] of OBSERVATION_IDS) {
      expect(run.wire).not.toContain(s);
      expect(JSON.stringify(run.manifest)).not.toContain(s);
      expect(JSON.stringify(run.residuals)).not.toContain(s);
    }
  });

  it("each element id has one manifest row at its locus, recorded as substituted", () => {
    for (const [, locus] of OBSERVATION_IDS) {
      expect(rows(run.manifest, locus)).toEqual([
        {
          category: C.MRN,
          transform: "redact",
          locus,
          disposition: "transformed",
          code: D.DEID_IDENTIFIER_SUBSTITUTED,
          count: 1,
          reidentificationCode: false,
        },
      ]);
    }
  });

  it("no element id is counted as an unexamined residual", () => {
    for (const [, locus] of OBSERVATION_IDS) expect(run.residuals).not.toContain(locus);
  });

  it("an element id is replaced in place, not removed", () => {
    expect(at(run.out, "code.id")).toMatch(/^\d+$/);
    expect(at(run.out, "code.coding.0.id")).toMatch(/^\d+$/);
    expect(at(run.out, "_status.id")).toMatch(/^\d+$/);
    expect(at(run.out, "valueQuantity._value.id")).toMatch(/^\d+$/);
    expect(at(run.out, "extension.0.id")).toMatch(/^\d+$/);
    expect(at(run.out, "component.0.id")).toMatch(/^\d+$/);
    // What the element carries beside its id is kept as before.
    expect(at(run.out, "status")).toBe("final");
    expect(at(run.out, "valueQuantity.value")).toBe(140);
    expect(at(run.out, "code.coding.0.code")).toBe("2951-2");
  });

  it("the contained reference still resolves to the contained resource", () => {
    const containedId = at(run.out, "contained.0.id") as string;
    expect(at(run.out, "subject.reference")).toBe(`#${containedId}`);
  });
});

describe("the same element id is replaced by the same value throughout a call", () => {
  it("two elements carrying one id get one replacement, and a different id another", () => {
    const run = pass({
      resourceType: "Observation",
      status: "final",
      code: { id: "ZZEIDSAME", text: "x" },
      component: [
        { id: "ZZEIDSAME", code: { text: "y" } },
        { id: "ZZEIDOTHER", code: { text: "z" } },
      ],
    });
    expect(at(run.out, "component.0.id")).toBe(at(run.out, "code.id"));
    expect(at(run.out, "component.1.id")).not.toBe(at(run.out, "code.id"));
    expect(run.wire).not.toContain("ZZEID");
  });
});

describe("a relatedAction's actionId resolves to the replaced action id", () => {
  const requestGroup = {
    resourceType: "RequestGroup",
    status: "active",
    intent: "plan",
    action: [
      { id: "ZZEIDACTIONA", title: "first" },
      {
        id: "ZZEIDACTIONB",
        title: "second",
        relatedAction: [{ actionId: "ZZEIDACTIONA", relationship: "after-end" }],
        action: [
          {
            id: "ZZEIDACTIONC",
            relatedAction: [{ actionId: "ZZEIDACTIONB", relationship: "concurrent" }],
          },
        ],
      },
    ],
  };

  it("in a RequestGroup, at every depth of nested actions", () => {
    const run = pass(requestGroup);
    expect(run.wire).not.toContain("ZZEIDACTION");
    const a = at(run.out, "action.0.id");
    const b = at(run.out, "action.1.id");
    expect(a).toMatch(/^\d+$/);
    expect(at(run.out, "action.1.relatedAction.0.actionId")).toBe(a);
    expect(at(run.out, "action.1.action.0.relatedAction.0.actionId")).toBe(b);
    expect(rows(run.manifest, "RequestGroup.action[1].relatedAction[0].actionId")).toEqual([
      {
        category: C.MRN,
        transform: "redact",
        locus: "RequestGroup.action[1].relatedAction[0].actionId",
        disposition: "transformed",
        code: D.DEID_IDENTIFIER_SUBSTITUTED,
        count: 1,
        reidentificationCode: false,
      },
    ]);
  });

  it("in a PlanDefinition", () => {
    const run = pass({ ...requestGroup, resourceType: "PlanDefinition" });
    expect(run.wire).not.toContain("ZZEIDACTION");
    expect(at(run.out, "action.1.relatedAction.0.actionId")).toBe(at(run.out, "action.0.id"));
  });

  it("an actionId anywhere else is not read as a link", () => {
    const run = pass({
      resourceType: "Basic",
      code: { text: "x" },
      relatedAction: [{ actionId: "zzplain" }],
    });
    expect(at(run.out, "relatedAction.0.actionId")).toBe("zzplain");
    expect(run.residuals).toContain("Basic.relatedAction[0].actionId");
  });
});

describe("element ids in a person resource, a Bundle and a kept address part", () => {
  it("a Patient contact, a Bundle entry and an address state lose their ids to replacements", () => {
    const run = pass({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          id: "ZZEIDENTRY",
          resource: {
            resourceType: "Patient",
            gender: "female",
            _gender: { id: "ZZEIDGENDER" },
            contact: [{ id: "ZZEIDCONTACT", gender: "male" }],
            address: [
              {
                id: "ZZEIDADDRESS",
                state: "MA",
                _state: {
                  id: "ZZEIDSTATE",
                  extension: [{ id: "ZZEIDSTATEEXT", url: "http://example.org/zz-a" }],
                },
                postalCode: "02139",
              },
            ],
          },
        },
      ],
    });
    expect(run.wire).not.toContain("ZZEID");
    expect(JSON.stringify(run.manifest)).not.toContain("ZZEID");
    expect(at(run.out, "entry.0.id")).toMatch(/^\d+$/);
    expect(at(run.out, "entry.0.resource._gender.id")).toMatch(/^\d+$/);
    expect(at(run.out, "entry.0.resource.contact.0.id")).toMatch(/^\d+$/);
    expect(at(run.out, "entry.0.resource.address.0.state")).toBe("MA");
    expect(at(run.out, "entry.0.resource.address.0._state.id")).toMatch(/^\d+$/);
    expect(at(run.out, "entry.0.resource.address.0._state.extension.0.id")).toMatch(/^\d+$/);
    for (const locus of [
      "Bundle.entry[0].id",
      "Bundle.entry[0].resource._gender.id",
      "Bundle.entry[0].resource.contact[0].id",
      "Bundle.entry[0].resource.address._state.id",
      "Bundle.entry[0].resource.address._state.extension[0].id",
    ]) {
      expect(rows(run.manifest, locus)).toHaveLength(1);
      expect(run.residuals).not.toContain(locus);
    }
  });
});

describe("what a kept address part hands through once its id is replaced", () => {
  /** The residual loci of one Patient address, read straight from the extractor. */
  function residualsOf(address: unknown): string[] {
    const { resource } = parseResource(
      JSON.stringify({ resourceType: "Patient", address: [address] }),
    );
    return extractFhirLoci(resource).unexaminedResiduals.map((r) => r.locus);
  }

  it("a kept part with a replaced id still hands through its extension's url, and it is counted", () => {
    expect(
      residualsOf({
        state: "IL",
        _state: { id: "ZZEIDSTATE", extension: [{ url: "http://example.org/zz-s" }] },
        postalCode: "62704",
      }),
    ).toEqual(["Patient.address[0]._state.extension[0].url"]);
  });

  it("a kept part with no id hands through its extension's url as before", () => {
    expect(
      residualsOf({
        state: "IL",
        _state: { extension: [{ url: "http://example.org/zz-s" }] },
        postalCode: "62704",
      }),
    ).toEqual(["Patient.address[0]._state.extension[0].url"]);
  });

  it("a kept part the pass blocked hands nothing through, the extension beside it included", () => {
    expect(
      residualsOf({
        state: 900000011,
        _state: { extension: [{ url: "http://example.org/zz-s" }] },
        postalCode: "62704",
      }),
    ).toEqual([]);
  });
});

describe("an element id that is not a string, or is empty", () => {
  it("an id holding an object or a list is removed whole and recorded", () => {
    const run = pass({
      resourceType: "Observation",
      status: "final",
      code: { id: { zz: "ZZEIDOBJECT" }, text: "x" },
      component: [{ id: ["ZZEIDLIST"], code: { text: "y" } }],
    });
    expect(run.wire).not.toContain("ZZEID");
    expect(at(run.out, "code.id")).toBeUndefined();
    expect(at(run.out, "component.0.id")).toBeUndefined();
    expect(rows(run.manifest, "Observation.code.id")).toHaveLength(1);
    expect(rows(run.manifest, "Observation.component[0].id")).toHaveLength(1);
  });

  it("an id holding a number is replaced like a string", () => {
    const run = pass({
      resourceType: "Observation",
      status: "final",
      code: { id: 900000017, text: "x" },
    });
    expect(run.wire).not.toContain("900000017");
    expect(at(run.out, "code.id")).toMatch(/^\d+$/);
  });

  it("an empty id carries nothing and gets no row", () => {
    const run = pass({ resourceType: "Observation", status: "final", code: { id: "", text: "x" } });
    expect(rows(run.manifest, "Observation.code.id")).toEqual([]);
  });
});

describe("an element id beside a value the pass replaces, and in places the walk does not read", () => {
  it("a primitive whose value is replaced is written with no id and gets no id row", () => {
    const run = pass({
      resourceType: "Observation",
      status: "final",
      code: { text: "x" },
      effectiveDateTime: "2020-03-04",
      _effectiveDateTime: { id: "ZZEIDDATE" },
    });
    expect(run.wire).not.toContain("ZZEIDDATE");
    expect(at(run.out, "effectiveDateTime")).toBe("2020");
    expect(at(run.out, "_effectiveDateTime")).toBeUndefined();
    expect(rows(run.manifest, "Observation._effectiveDateTime.id")).toEqual([]);
  });

  it("an empty element id is kept empty, and the id on its own `_`-sibling is replaced", () => {
    const run = pass({
      resourceType: "Observation",
      status: "final",
      code: { id: "", _id: { id: "ZZEIDOFID" }, text: "x" },
    });
    expect(run.wire).not.toContain("ZZEIDOFID");
    expect(at(run.out, "code.id")).toBe("");
    expect(at(run.out, "code._id.id")).toMatch(/^\d+$/);
    expect(rows(run.manifest, "Observation.code._id.id")).toHaveLength(1);
  });

  it("the id of a resource-shaped object the walk does not read as a resource is replaced", () => {
    const run = pass({
      resourceType: "Observation",
      status: "final",
      code: { text: "x" },
      identifier: [
        {
          system: "urn:oid:2.25.9",
          value: "zz1",
          zzInner: { resourceType: "Basic", id: "ZZEIDINNER" },
        },
      ],
    });
    expect(run.wire).not.toContain("ZZEIDINNER");
    expect(rows(run.manifest, "Observation.identifier[0].zzInner.id")).toHaveLength(1);
  });

  it("a date-shaped action id and the actionId naming it get the same replacement", () => {
    const run = pass({
      resourceType: "RequestGroup",
      status: "active",
      intent: "plan",
      action: [
        { id: "2020-01-02" },
        { relatedAction: [{ actionId: "2020-01-02", relationship: "after" }] },
      ],
    });
    expect(run.wire).not.toContain("2020-01-02");
    expect(at(run.out, "action.1.relatedAction.0.actionId")).toBe(at(run.out, "action.0.id"));
    expect(rows(run.manifest, "RequestGroup.action[1].relatedAction[0].actionId")).toEqual([
      expect.objectContaining({ category: C.MRN, code: D.DEID_IDENTIFIER_SUBSTITUTED }),
    ]);
  });

  it("an empty actionId names nothing: it is kept empty and gets no row", () => {
    const run = pass({
      resourceType: "RequestGroup",
      status: "active",
      intent: "plan",
      action: [{ relatedAction: [{ actionId: "", relationship: "after" }] }],
    });
    expect(at(run.out, "action.0.relatedAction.0.actionId")).toBe("");
    expect(rows(run.manifest, "RequestGroup.action[0].relatedAction[0].actionId")).toEqual([]);
  });

  it("an actionId held as an object is removed and recorded", () => {
    const run = pass({
      resourceType: "PlanDefinition",
      status: "active",
      action: [{ relatedAction: [{ actionId: { zz: "ZZEIDACTIONOBJ" }, relationship: "after" }] }],
    });
    expect(run.wire).not.toContain("ZZEIDACTIONOBJ");
    expect(rows(run.manifest, "PlanDefinition.action[0].relatedAction[0].actionId")).toHaveLength(
      1,
    );
  });

  it("a key beside a relatedAction's actionId that only starts like it is not read as a link", () => {
    const run = pass({
      resourceType: "RequestGroup",
      status: "active",
      intent: "plan",
      action: [{ relatedAction: [{ actionIdZz: "zzplain", relationship: "after" }] }],
    });
    expect(at(run.out, "action.0.relatedAction.0.actionIdZz")).toBe("zzplain");
    expect(run.residuals).toContain("RequestGroup.action[0].relatedAction[0].actionIdZz");
  });
});

describe("FHIR element ids under the other profiles and transforms", () => {
  const registry = createDeidRegistry({ key: "fhir-element-id-synthetic-key" });

  it("the Safe Harbor profile needs no key and leaves no element id", () => {
    const run = pass(OBSERVATION, profileOptions(SAFE_HARBOR_PROFILE));
    for (const [s] of OBSERVATION_IDS) expect(run.wire).not.toContain(s);
  });

  it("a keyed policy writes the keyed surrogate, flagged as a re-identification code", () => {
    const run = pass(
      OBSERVATION,
      profileOptions(LIMITED_DATA_SET_PROFILE, registry.forPatient("zz")),
    );
    for (const [s] of OBSERVATION_IDS) expect(run.wire).not.toContain(s);
    expect(at(run.out, "code.id")).toBe(registry.pseudonym("ZZEIDCODE"));
    expect(rows(run.manifest, "Observation.code.id")[0]).toMatchObject({
      transform: "pseudonymize",
      code: D.DEID_CATEGORY_PSEUDONYMIZED,
      reidentificationCode: true,
    });
  });

  it("a policy that retains the category removes every element id rather than keep it", () => {
    const policy = defineDeidPolicy({ name: "zz-retain-mrn", transforms: { [C.MRN]: "retain" } });
    const run = pass(OBSERVATION, { policy });
    for (const [s] of OBSERVATION_IDS) expect(run.wire).not.toContain(s);
    expect(at(run.out, "code.id")).toBeUndefined();
    expect(at(run.out, "_status")).toBeUndefined();
    expect(at(run.out, "status")).toBe("final");
  });

  it("with transformLabels on, a resource whose element ids were replaced is labeled", () => {
    const run = pass(
      { resourceType: "Observation", status: "final", _status: { id: "ZZEIDLABEL" } },
      { transformLabels: true },
    );
    expect(run.wire).not.toContain("ZZEIDLABEL");
    expect(JSON.stringify(at(run.out, "meta.security"))).toContain("REDACTED");
  });
});
