/**
 * **FHIR: resource ids and reference ids are replaced, and the wiring is kept.**
 *
 * A FHIR server assigns every resource a logical `id`, and the id of a `Patient` is very often the
 * medical record number itself or something one step from it. That id travels in three places: the
 * resource's own `id`, the `fullUrl` of its `Bundle` entry, and the `Reference.reference` of every
 * resource that points at it. Before this suite all three passed through verbatim, recorded only as
 * unexamined positions.
 *
 * The rule asserted here: every id is replaced, the same id by the same replacement throughout one
 * call, so every reference still resolves to the resource it named. Under a policy that withholds the
 * medical record number category (Safe Harbor) the replacement is a per-call sequence number, which
 * is not derived from the id; under a keyed policy it is the registry's keyed surrogate, so a corpus
 * keyed alike still links. Every replacement has a manifest row. Anything the pass cannot read as one
 * of the reference forms it knows, and an absolute reference to a server the Bundle does not carry, is
 * removed rather than kept.
 *
 * Every value is a synthetic sentinel (`ZZ...`) or a published code.
 */

import { describe, expect, it } from "vitest";
import { complex, list, parseResource, primitive, serializeResource } from "@cosyte/fhir";

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
import { deidentifyFhir } from "../../src/fhir/index.js";

/** Run one JSON value through the default (Safe Harbor) pass and return the output and its manifest. */
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

/** The manifest row at a locus (each position has exactly one). */
function row(manifest: readonly DeidManifestEntry[], locus: string): DeidManifestEntry | undefined {
  const rows = manifest.filter((e) => e.locus === locus);
  expect(rows.length).toBeLessThanOrEqual(1);
  return rows[0];
}

/** A synthetic Bundle whose Patient id, fullUrls and references all carry a sentinel. */
const SENTINEL_BUNDLE = {
  resourceType: "Bundle",
  id: "ZZBUNDLEID1",
  type: "collection",
  entry: [
    {
      fullUrl: "https://fhir.example.org/r4/Patient/ZZFHIRPATID1",
      resource: { resourceType: "Patient", id: "ZZFHIRPATID1", gender: "female" },
    },
    {
      fullUrl: "https://fhir.example.org/r4/Practitioner/ZZFHIRPRACID1",
      resource: { resourceType: "Practitioner", id: "ZZFHIRPRACID1" },
    },
    {
      fullUrl: "https://fhir.example.org/r4/Observation/ZZFHIROBSID1",
      resource: {
        resourceType: "Observation",
        id: "ZZFHIROBSID1",
        status: "final",
        code: { coding: [{ system: "http://loinc.org", code: "2951-2" }] },
        subject: { reference: "Patient/ZZFHIRPATID1" },
        performer: [{ reference: "https://fhir.example.org/r4/Practitioner/ZZFHIRPRACID1" }],
        valueQuantity: { value: 140, unit: "mmol/L", system: "http://unitsofmeasure.org" },
      },
    },
    {
      fullUrl: "https://fhir.example.org/r4/Encounter/ZZFHIRENCID1",
      resource: {
        resourceType: "Encounter",
        id: "ZZFHIRENCID1",
        status: "finished",
        class: { system: "http://terminology.hl7.org/CodeSystem/v3-ActCode", code: "AMB" },
        subject: { reference: "Patient/ZZFHIRPATID1/_history/ZZFHIRVERSION1" },
      },
    },
  ],
};

const SENTINELS = [
  "ZZBUNDLEID1",
  "ZZFHIRPATID1",
  "ZZFHIRPRACID1",
  "ZZFHIROBSID1",
  "ZZFHIRENCID1",
  "ZZFHIRVERSION1",
];

describe("FHIR resource ids: the sentinel Bundle under the Safe Harbor default", () => {
  const raw = JSON.stringify(SENTINEL_BUNDLE);
  const run = pass(SENTINEL_BUNDLE);

  it("the sentinels are really in the input (non-vacuity)", () => {
    for (const s of SENTINELS) expect(raw).toContain(s);
  });

  it("no sentinel survives in the output, the manifest or the residual inventory", () => {
    for (const s of SENTINELS) {
      expect(run.wire).not.toContain(s);
      expect(JSON.stringify(run.manifest)).not.toContain(s);
      expect(JSON.stringify(run.residuals)).not.toContain(s);
    }
  });

  it("every id is a per-call sequence number, first come first numbered", () => {
    expect(at(run.out, "id")).toBe("1");
    expect(at(run.out, "entry.0.resource.id")).toBe("2");
    expect(at(run.out, "entry.1.resource.id")).toBe("3");
    expect(at(run.out, "entry.2.resource.id")).toBe("4");
    expect(at(run.out, "entry.3.resource.id")).toBe("5");
  });

  it("every reference still resolves to the resource it named", () => {
    const patientId = at(run.out, "entry.0.resource.id") as string;
    const practitionerId = at(run.out, "entry.1.resource.id") as string;
    expect(at(run.out, "entry.0.fullUrl")).toBe(`https://fhir.example.org/r4/Patient/${patientId}`);
    expect(at(run.out, "entry.2.resource.subject.reference")).toBe(`Patient/${patientId}`);
    expect(at(run.out, "entry.2.resource.performer.0.reference")).toBe(
      `https://fhir.example.org/r4/Practitioner/${practitionerId}`,
    );
    expect(at(run.out, "entry.1.fullUrl")).toBe(
      `https://fhir.example.org/r4/Practitioner/${practitionerId}`,
    );
  });

  it("a version-specific reference loses its version and still resolves", () => {
    const patientId = at(run.out, "entry.0.resource.id") as string;
    expect(at(run.out, "entry.3.resource.subject.reference")).toBe(`Patient/${patientId}`);
  });

  it("the clinical content is untouched", () => {
    for (const survivor of ["2951-2", "140", "mmol/L", "final", "finished", "AMB"]) {
      expect(run.wire).toContain(survivor);
    }
  });

  it("each replacement has its own manifest row, as a medical record number substituted", () => {
    for (const locus of [
      "Bundle.id",
      "Bundle.entry[0].fullUrl",
      "Bundle.entry[0].resource.id",
      "Bundle.entry[2].resource.subject.reference",
      "Bundle.entry[2].resource.performer[0].reference",
      "Bundle.entry[3].resource.subject.reference",
    ]) {
      const entry = row(run.manifest, locus);
      expect(entry).toMatchObject({
        category: C.MRN,
        transform: "redact",
        disposition: "transformed",
        code: D.DEID_IDENTIFIER_SUBSTITUTED,
        count: 1,
        reidentificationCode: false,
      });
    }
  });

  it("no id position is left in the unexamined residual inventory", () => {
    for (const locus of run.residuals) {
      expect(locus.endsWith(".id") || locus === "Bundle.id").toBe(false);
      expect(locus.endsWith("fullUrl")).toBe(false);
      expect(locus.endsWith(".reference")).toBe(false);
    }
  });
});

describe("FHIR resource ids: the stand-in is not derived from the id", () => {
  it("two Bundles that differ only in their ids come out byte-identical", () => {
    const other = JSON.parse(
      JSON.stringify(SENTINEL_BUNDLE).replaceAll("ZZFHIRPATID1", "ZZFHIRPATID2"),
    ) as unknown;
    expect(pass(other).wire).toBe(pass(SENTINEL_BUNDLE).wire);
  });

  it("the same id is replaced by the same stand-in throughout one call, and nowhere else", () => {
    const run = pass({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { resource: { resourceType: "Patient", id: "ZZSAMEID" } },
        {
          resource: {
            resourceType: "Group",
            id: "ZZOTHERID",
            member: [{ entity: { reference: "Patient/ZZSAMEID" } }],
          },
        },
      ],
    });
    expect(at(run.out, "entry.0.resource.id")).toBe("1");
    expect(at(run.out, "entry.1.resource.id")).toBe("2");
    expect(at(run.out, "entry.1.resource.member.0.entity.reference")).toBe("Patient/1");
  });
});

describe("FHIR resource ids: the logical forms", () => {
  const UUID_A = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
  const run = pass({
    resourceType: "Bundle",
    type: "transaction",
    entry: [
      {
        fullUrl: `urn:uuid:${UUID_A}`,
        resource: { resourceType: "Patient", id: UUID_A },
        request: { method: "PUT", url: `Patient/${UUID_A}` },
      },
      {
        fullUrl: "urn:oid:1.2.840.99999.4.1",
        resource: {
          resourceType: "Observation",
          status: "final",
          code: { text: "ZZCODETEXT" },
          subject: { reference: `urn:uuid:${UUID_A}` },
        },
        request: { method: "POST", url: "Observation" },
      },
      {
        fullUrl: "urn:uuid:ZZNOTAUUID",
        resource: { resourceType: "Encounter", status: "planned", class: { code: "AMB" } },
        request: { method: "POST", url: "Encounter?identifier=ZZCONDITIONALMRN" },
        response: { status: "201 Created", location: "Encounter/ZZLOCATIONID/_history/1" },
      },
    ],
  });

  it("a UUID is replaced by a UUID, the same one wherever the id appears", () => {
    const surrogate = "00000000-0000-4000-8000-000000000001";
    expect(at(run.out, "entry.0.fullUrl")).toBe(`urn:uuid:${surrogate}`);
    expect(at(run.out, "entry.0.resource.id")).toBe(surrogate);
    expect(at(run.out, "entry.0.request.url")).toBe(`Patient/${surrogate}`);
    expect(at(run.out, "entry.1.resource.subject.reference")).toBe(`urn:uuid:${surrogate}`);
  });

  it("an OID is replaced by an OID under 2.25", () => {
    expect(at(run.out, "entry.1.fullUrl")).toBe("urn:oid:2.25.2");
  });

  it("a urn:uuid whose tail is not a UUID still has its tail replaced", () => {
    expect(at(run.out, "entry.2.fullUrl")).toBe("urn:uuid:3");
  });

  it("a request url naming only a type is kept; a conditional one is removed", () => {
    expect(at(run.out, "entry.1.request.url")).toBe("Observation");
    expect(at(run.out, "entry.2.request.url")).toBeUndefined();
    expect(row(run.manifest, "Bundle.entry[2].request.url")).toMatchObject({
      disposition: "blocked",
      code: D.DEID_LOCUS_BLOCKED,
    });
  });

  it("a response location has its id replaced and its version removed", () => {
    expect(at(run.out, "entry.2.response.location")).toBe("Encounter/4");
  });

  it("nothing of the original ids survives", () => {
    for (const s of [
      UUID_A,
      "1.2.840.99999.4.1",
      "ZZNOTAUUID",
      "ZZCONDITIONALMRN",
      "ZZLOCATIONID",
    ]) {
      expect(run.wire).not.toContain(s);
    }
  });
});

describe("FHIR resource ids: contained resources and '#' references", () => {
  const run = pass({
    resourceType: "Observation",
    id: "ZZOBSID9",
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code: "2951-2" }] },
    contained: [{ resourceType: "Patient", id: "ZZCONTAINEDID", gender: "male" }],
    subject: { reference: "#ZZCONTAINEDID" },
    focus: [{ reference: "#" }],
  });

  it("a contained resource's id and the '#' reference to it are replaced alike", () => {
    const containedId = at(run.out, "contained.0.id") as string;
    expect(containedId).not.toBe("ZZCONTAINEDID");
    expect(at(run.out, "subject.reference")).toBe(`#${containedId}`);
    expect(run.wire).not.toContain("ZZCONTAINEDID");
    expect(row(run.manifest, "Observation.subject.reference")?.code).toBe(
      D.DEID_IDENTIFIER_SUBSTITUTED,
    );
  });

  it("a bare '#' (the container itself) carries no id and is kept", () => {
    expect(at(run.out, "focus.0.reference")).toBe("#");
    expect(row(run.manifest, "Observation.focus[0].reference")).toBeUndefined();
    expect(run.residuals).not.toContain("Observation.focus[0].reference");
  });
});

describe("FHIR resource ids: absolute references", () => {
  const run = pass({
    resourceType: "Bundle",
    type: "searchset",
    entry: [
      {
        fullUrl: "https://fhir.example.org/r4/Observation/ZZOBSABS1",
        resource: {
          resourceType: "Observation",
          id: "ZZOBSABS1",
          status: "final",
          code: { coding: [{ system: "http://loinc.org", code: "2951-2" }] },
          subject: { reference: "https://fhir.example.org/r4/Patient/ZZSAMESERVERID" },
          performer: [
            { reference: "https://other.example.net/fhir/Practitioner/ZZOTHERSERVERID" },
            { reference: "http://fhir.example.org/r4/Practitioner/ZZSCHEMEDIFFERS" },
          ],
        },
      },
    ],
  });

  it("a reference to the server the Bundle's own fullUrls name keeps that base", () => {
    expect(at(run.out, "entry.0.resource.subject.reference")).toBe(
      "https://fhir.example.org/r4/Patient/2",
    );
  });

  it("a reference to any other server cannot resolve inside the Bundle, so it is removed", () => {
    expect(at(run.out, "entry.0.resource.performer.0.reference")).toBeUndefined();
    expect(at(run.out, "entry.0.resource.performer.1.reference")).toBeUndefined();
    expect(run.wire).not.toContain("other.example.net");
    expect(run.wire).not.toContain("ZZOTHERSERVERID");
    expect(run.wire).not.toContain("ZZSCHEMEDIFFERS");
    expect(row(run.manifest, "Bundle.entry[0].resource.performer[0].reference")).toMatchObject({
      category: C.OTHER_UNIQUE_ID,
      disposition: "blocked",
      code: D.DEID_LOCUS_BLOCKED,
    });
  });

  it("a single resource names no server, so every absolute reference in it is removed", () => {
    const single = pass({
      resourceType: "Observation",
      status: "final",
      code: { text: "x" },
      subject: { reference: "https://fhir.example.org/r4/Patient/ZZLONEID" },
    });
    expect(at(single.out, "subject.reference")).toBeUndefined();
    expect(single.wire).not.toContain("ZZLONEID");
  });
});

describe("FHIR resource ids: fail closed on what the pass cannot read", () => {
  it.each([
    ["an unknown resource type", "ZZSMITH/123"],
    ["a search", "Patient?identifier=ZZSEARCHMRN"],
    ["an id outside the FHIR id alphabet", "Patient/ZZ BAD ID"],
    ["a scheme it does not know", "ftp://fhir.example.org/Patient/ZZFTPID"],
    ["an empty urn tail", "urn:uuid:"],
    ["an empty string", ""],
  ])("%s is removed and recorded as blocked", (_label, reference) => {
    const run = pass({
      resourceType: "Observation",
      status: "final",
      code: { text: "x" },
      subject: { reference },
    });
    expect(at(run.out, "subject.reference")).toBeUndefined();
    if (reference !== "") {
      expect(row(run.manifest, "Observation.subject.reference")).toMatchObject({
        disposition: "blocked",
        code: D.DEID_LOCUS_BLOCKED,
      });
    }
  });

  it("a reference held as a number is removed", () => {
    const run = pass({
      resourceType: "Observation",
      status: "final",
      code: { text: "x" },
      subject: { reference: 987654321 },
    });
    expect(run.wire).not.toContain("987654321");
    expect(at(run.out, "subject.reference")).toBeUndefined();
  });

  it("a reference held as a list, where R4 puts one, is removed whole", () => {
    const run = pass({
      resourceType: "Observation",
      status: "final",
      code: { text: "x" },
      contained: [{ resourceType: "Patient", id: "ZZLISTREFID" }],
      subject: { reference: ["#ZZLISTREFID", "ZZLISTFREETEXT"] },
    });
    expect(at(run.out, "subject.reference")).toBeUndefined();
    expect(run.wire).not.toContain("ZZLISTFREETEXT");
    expect(run.wire).not.toContain("ZZLISTREFID");
    expect(row(run.manifest, "Observation.subject.reference")?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });

  it("a Reference datatype R4 names `reference` is walked, and its own reference read", () => {
    const run = pass({
      resourceType: "Consent",
      status: "active",
      scope: { text: "x" },
      category: [{ text: "x" }],
      provision: {
        data: [{ meaning: "instance", reference: { reference: "Patient/ZZCONSENTREF" } }],
      },
    });
    expect(at(run.out, "provision.data.0.reference.reference")).toBe("Patient/1");
    expect(run.wire).not.toContain("ZZCONSENTREF");
  });

  it("a Bundle literal position holding an object is removed whole", () => {
    const run = pass({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        {
          fullUrl: { value: "ZZOBJECTURL" },
          resource: { resourceType: "Basic", code: { text: "x" } },
        },
      ],
    });
    expect(run.wire).not.toContain("ZZOBJECTURL");
  });

  it("a '#' where no container is meant is removed", () => {
    const run = pass({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ fullUrl: "#", resource: { resourceType: "Basic", code: { text: "x" } } }],
    });
    expect(at(run.out, "entry.0.fullUrl")).toBeUndefined();
  });

  it("a policy whose transform for the category can neither withhold nor key removes every id", () => {
    const policy = defineDeidPolicy({
      name: "zz-generalize-mrn",
      transforms: { [C.MRN]: "generalize" },
    });
    const run = pass(SENTINEL_BUNDLE, { policy });
    for (const s of SENTINELS) expect(run.wire).not.toContain(s);
    expect(at(run.out, "entry.2.resource.subject.reference")).toBeUndefined();
    expect(at(run.out, "entry.0.fullUrl")).toBeUndefined();
    expect(row(run.manifest, "Bundle.entry[0].resource.id")?.disposition).toBe("blocked");
  });

  it("a resource id held as a list is removed", () => {
    const run = pass({ resourceType: "Patient", id: ["ZZLISTID"], gender: "male" });
    expect(run.wire).not.toContain("ZZLISTID");
    expect(at(run.out, "id")).toBeUndefined();
    expect(row(run.manifest, "Patient.id")?.disposition).toBe("blocked");
  });

  it("an unreadable fullUrl is removed", () => {
    const run = pass({
      resourceType: "Bundle",
      type: "collection",
      entry: [
        { fullUrl: "ZZFREEFORMURL", resource: { resourceType: "Basic", code: { text: "x" } } },
      ],
    });
    expect(run.wire).not.toContain("ZZFREEFORMURL");
    expect(at(run.out, "entry.0.fullUrl")).toBeUndefined();
  });
});

describe("FHIR resource ids under a keyed policy", () => {
  const registry = createDeidRegistry({ key: "fhir-resource-id-synthetic-key" });
  const keyed = (): Parameters<typeof deidentifyFhir>[1] =>
    profileOptions(LIMITED_DATA_SET_PROFILE, registry.forPatient("zz-patient"));

  it("the id is the registry's keyed surrogate, so two calls under one key link", () => {
    const first = pass(SENTINEL_BUNDLE, keyed());
    const second = pass({ resourceType: "Patient", id: "ZZFHIRPATID1" }, keyed());
    const surrogate = registry.pseudonym("ZZFHIRPATID1");
    expect(at(first.out, "entry.0.resource.id")).toBe(surrogate);
    expect(at(first.out, "entry.2.resource.subject.reference")).toBe(`Patient/${surrogate}`);
    expect(at(second.out, "id")).toBe(surrogate);
    for (const s of SENTINELS) expect(first.wire).not.toContain(s);
  });

  it("each surrogate is flagged as a re-identification code, as a pseudonym is", () => {
    const run = pass(SENTINEL_BUNDLE, keyed());
    expect(row(run.manifest, "Bundle.entry[0].resource.id")).toMatchObject({
      category: C.MRN,
      transform: "pseudonymize",
      disposition: "transformed",
      code: D.DEID_CATEGORY_PSEUDONYMIZED,
      reidentificationCode: true,
    });
  });

  it("a UUID keeps the shape of a UUID and an OID the shape of an OID", () => {
    const uuid = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
    const run = pass(
      {
        resourceType: "Bundle",
        type: "collection",
        entry: [
          { fullUrl: `urn:uuid:${uuid}`, resource: { resourceType: "Patient", id: uuid } },
          {
            fullUrl: "urn:oid:1.2.840.99999.4.2",
            resource: { resourceType: "Basic", code: { text: "x" } },
          },
        ],
      },
      keyed(),
    );
    const id = at(run.out, "entry.0.resource.id") as string;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(at(run.out, "entry.0.fullUrl")).toBe(`urn:uuid:${id}`);
    expect(at(run.out, "entry.1.fullUrl")).toMatch(/^urn:oid:2\.25\.\d+$/);
    expect(run.wire).not.toContain(uuid);
  });
});

describe("FHIR resource ids under the Safe Harbor profile", () => {
  it("needs no key: the stand-in is not a keyed transform", () => {
    expect(() => pass(SENTINEL_BUNDLE, profileOptions(SAFE_HARBOR_PROFILE))).not.toThrow();
  });
});

describe("FHIR resource ids: the other transforms and shapes", () => {
  const registry = createDeidRegistry({ key: "fhir-resource-id-shape-synthetic-key" });
  const ctx = registry.forPatient("zz-shape");

  it("a policy that blocks the category writes the same stand-ins and records the block", () => {
    const policy = defineDeidPolicy({ name: "zz-block-mrn", transforms: { [C.MRN]: "block" } });
    const run = pass(SENTINEL_BUNDLE, { policy });
    expect(at(run.out, "entry.2.resource.subject.reference")).toBe("Patient/2");
    expect(row(run.manifest, "Bundle.entry[0].resource.id")).toMatchObject({
      transform: "block",
      code: D.DEID_IDENTIFIER_SUBSTITUTED,
    });
  });

  it("a policy that hashes the category writes the keyed hash, flagged as a re-identification code", () => {
    const policy = defineDeidPolicy({ name: "zz-hash-mrn", transforms: { [C.MRN]: "hash" } });
    const run = pass(SENTINEL_BUNDLE, { policy, context: ctx });
    const id = at(run.out, "entry.0.resource.id") as string;
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(id).not.toBe(registry.pseudonym("ZZFHIRPATID1"));
    expect(at(run.out, "entry.2.resource.subject.reference")).toBe(`Patient/${id}`);
    expect(row(run.manifest, "Bundle.entry[0].resource.id")).toMatchObject({
      transform: "hash",
      code: D.DEID_CATEGORY_HASHED,
      reidentificationCode: true,
    });
  });

  it("a resource id with no value (only `_id` metadata) carries nothing to replace", () => {
    const run = pass({
      resourceType: "Basic",
      _id: { extension: [{ url: "http://example.org/zz", valueString: "ZZIDEXTENSION" }] },
      code: { text: "x" },
    });
    expect(run.wire).not.toContain("ZZIDEXTENSION");
    expect(row(run.manifest, "Basic.id")).toBeUndefined();
  });

  it("a `reference` string at a person resource's own top level is not a Reference: it is blocked", () => {
    const run = pass({ resourceType: "Patient", gender: "male", reference: "Patient/ZZTOPREF" });
    expect(run.wire).not.toContain("ZZTOPREF");
    expect(row(run.manifest, "Patient.reference")?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });

  it("a `reference` list holding a Reference object, where R4 puts one, is removed whole", () => {
    const run = pass({
      resourceType: "Consent",
      status: "active",
      scope: { text: "x" },
      category: [{ text: "x" }],
      provision: {
        data: [
          {
            meaning: "instance",
            reference: [{ reference: "Patient/ZZMIXEDA" }, "Patient/ZZMIXEDB"],
          },
        ],
      },
    });
    expect(at(run.out, "provision.data.0.reference")).toBeUndefined();
    expect(row(run.manifest, "Consent.provision.data[0].reference")?.code).toBe(
      D.DEID_LOCUS_BLOCKED,
    );
    expect(run.wire).not.toContain("ZZMIXEDA");
    expect(run.wire).not.toContain("ZZMIXEDB");
  });

  it("a Bundle literal held as a list, where R4 puts one, is removed whole", () => {
    // Built from the model directly: the reader does not hand an object through at a uri, but a model
    // a caller builds by hand can hold one, and the pass must not keep it.
    const str = (value: string) => primitive(value);
    const bundle = complex([
      { name: "resourceType", value: str("Bundle") },
      { name: "type", value: str("batch") },
      {
        name: "entry",
        value: list([
          complex([
            {
              name: "resource",
              value: complex([
                { name: "resourceType", value: str("Basic") },
                { name: "code", value: complex([{ name: "text", value: str("x") }]) },
              ]),
            },
            {
              name: "request",
              value: complex([
                { name: "method", value: str("POST") },
                {
                  name: "url",
                  value: list([
                    str("Basic"),
                    complex([{ name: "value", value: str("ZZOBJECTITEM") }]),
                  ]),
                },
              ]),
            },
          ]),
        ]),
      },
    ]);
    const { document, manifest } = deidentifyFhir(bundle);
    const wire = serializeResource(document);
    expect(wire).not.toContain("ZZOBJECTITEM");
    expect(wire).not.toContain('"url"');
    expect(row(manifest, "Bundle.entry[0].request.url")?.code).toBe(D.DEID_LOCUS_BLOCKED);
  });

  it("a Bundle whose entry is a single object, or holds a non-object, has it removed whole", () => {
    const run = pass({
      resourceType: "Bundle",
      type: "collection",
      entry: {
        fullUrl: "https://fhir.example.org/r4/Basic/ZZSINGLEENTRY",
        resource: {
          resourceType: "Basic",
          code: { text: "x" },
          subject: { reference: "https://fhir.example.org/r4/Patient/ZZSINGLEREF" },
        },
      },
    });
    // R4 puts a list of entries there, so a single entry is removed whole, with what it holds.
    expect(at(run.out, "entry")).toBeUndefined();
    expect(run.wire).not.toContain("ZZSINGLE");
    expect(row(run.manifest, "Bundle.entry")?.code).toBe(D.DEID_LOCUS_BLOCKED);
    const odd = pass({ resourceType: "Bundle", type: "collection", entry: ["ZZSTRINGENTRY"] });
    expect(odd.out["resourceType"]).toBe("Bundle");
    expect(odd.wire).not.toContain("ZZSTRINGENTRY");
    expect(row(odd.manifest, "Bundle.entry[0]")?.code).toBe(D.DEID_LOCUS_BLOCKED);
    const empty = pass({ resourceType: "Bundle", type: "collection" });
    expect(empty.manifest).toEqual([]);
  });

  it.each([
    ["a contained id outside the FHIR id alphabet", "#ZZ BAD"],
    ["a version id outside the FHIR id alphabet", "Patient/ZZVERSIONED/_history/ZZ BAD"],
  ])("%s is removed", (_label, reference) => {
    const run = pass({ resourceType: "Basic", code: { text: "x" }, subject: { reference } });
    expect(at(run.out, "subject.reference")).toBeUndefined();
    expect(run.wire).not.toContain("ZZ BAD");
  });
});

describe("FHIR resource ids: a transform that cannot replace an id never runs on one", () => {
  it("a date-shift policy removes an id that happens to look like a date, rather than shift it", () => {
    const registry = createDeidRegistry({ key: "fhir-resource-id-shift-synthetic-key" });
    const policy = defineDeidPolicy({
      name: "zz-shift-mrn",
      transforms: { [C.MRN]: "date-shift" },
    });
    const run = pass(
      {
        resourceType: "Bundle",
        type: "collection",
        entry: [
          { resource: { resourceType: "Patient", id: "2020-01-15" } },
          {
            resource: {
              resourceType: "Basic",
              code: { text: "x" },
              subject: { reference: "Patient/2020-01-15" },
            },
          },
        ],
      },
      { policy, context: registry.forPatient("zz-shift") },
    );
    expect(run.wire).not.toMatch(/20\d\d-\d\d-\d\d/);
    expect(at(run.out, "entry.0.resource.id")).toBeUndefined();
    expect(at(run.out, "entry.1.resource.subject.reference")).toBeUndefined();
    expect(row(run.manifest, "Bundle.entry[0].resource.id")).toMatchObject({
      disposition: "blocked",
      code: D.DEID_LOCUS_BLOCKED,
    });
  });
});
