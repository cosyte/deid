/**
 * FHIR adapter on the shapes the headline fixtures never send: an `Identifier` with no `value` or no
 * `system`, a bare primitive where an `Identifier` or `Address` is expected, a `text` that is not a
 * Narrative, a `note` sent as one Annotation rather than a list, a `false` extension value, a
 * primitive's `_`-sibling carrying both an `id` and an `extension`, and a model a JavaScript caller
 * built by hand. Each one either keeps its value out of the output or counts it as an unexamined
 * position; none passes a value through in silence.
 *
 * All values are synthetic `ZZ` sentinels.
 */

import {
  complex,
  primitive,
  serializeResource,
  type FhirComplex,
  type FhirNode,
} from "@cosyte/fhir";
import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  DeidError,
  FATAL_CODES,
  SAFE_HARBOR_CATEGORIES,
  type TransformedLocus,
} from "../../src/index.js";
import {
  applyFhir,
  deidentifyFhir,
  deidentifyFhirJson,
  extractFhirLoci,
  type FhirCoord,
} from "../../src/fhir/index.js";

const ctx = createDeidContext({ key: "odd-shape-key-synthetic-hmac", patientId: "p" });
const C = SAFE_HARBOR_CATEGORIES;

function run(resource: unknown, redact?: (input: { text: string }) => { text: string }) {
  return deidentifyFhirJson(JSON.stringify(resource), {
    context: ctx,
    ...(redact === undefined ? {} : { redactor: redact }),
  });
}

function loci(result: { readonly unexaminedResiduals: readonly { locus: string }[] }): string[] {
  return result.unexaminedResiduals.map((r) => r.locus);
}

describe("primitive metadata and free text in an unexpected shape", () => {
  it("drops a primitive's extension and replaces its id when its _-sibling carries both", () => {
    const out = run({
      resourceType: "Observation",
      status: "final",
      _status: {
        id: "s1",
        extension: [{ url: "http://example.org/x", valueString: "ZZSTATUSEXT" }],
      },
    });
    expect(out.json).not.toContain("ZZSTATUSEXT");
    expect(out.json).toMatch(/"_status":\{"id":"\d+"\}/);
    // The id is replaced, so it has a manifest row and is not counted as handed through.
    expect(loci(out)).not.toContain("Observation._status.id");
    expect(out.manifest.map((m) => m.locus)).toContain("Observation._status.id");
  });

  it("drops a primitive's _-sibling whole when it carries an extension and no id", () => {
    const out = run({
      resourceType: "Observation",
      status: "final",
      _status: { extension: [{ url: "http://example.org/x", valueString: "ZZSTATUSEXT" }] },
    });
    expect(out.json).toBe('{"resourceType":"Observation","status":"final"}');
  });

  it("writes a BYO redaction back into a note sent as a single Annotation, dropping author and time", () => {
    const out = run(
      {
        resourceType: "Observation",
        status: "final",
        note: { text: "ZZNOTETEXT", authorString: "ZZNOTEAUTHOR", time: "2020-01-02T03:04:05Z" },
      },
      () => ({ text: "[REDACTED]" }),
    );
    expect(out.json).toContain('"note":{"text":"[REDACTED]"}');
    expect(out.json).not.toContain("ZZNOTE");
    expect(out.json).not.toContain("2020-01-02");
    expect(out.manifest).toEqual([
      expect.objectContaining({
        locus: "Observation.note",
        code: "DEID_FREETEXT_CONSUMER_REDACTED",
        disposition: "transformed",
      }),
    ]);
  });

  it("keeps a text element that carries no div and counts its fields as unexamined", () => {
    const out = run({
      resourceType: "Observation",
      status: "final",
      text: { status: "generated" },
    });
    expect(out.json).toContain('"text":{"status":"generated"}');
    expect(out.manifest).toEqual([]);
    expect(loci(out)).toContain("Observation.text.status");
  });

  it("blocks a false extension value as it blocks any other, keeping the url and replacing the id", () => {
    const out = run({
      resourceType: "Patient",
      extension: [{ url: "http://example.org/flag", id: "e1", valueBoolean: false }],
    });
    expect(out.json).not.toContain("valueBoolean");
    expect(out.json).toContain('"url":"http://example.org/flag"');
    expect(out.json).not.toContain('"e1"');
    expect(out.manifest).toEqual([
      expect.objectContaining({
        locus: "Patient.extension[0].valueBoolean",
        disposition: "blocked",
        category: C.OTHER_UNIQUE_ID,
      }),
      expect.objectContaining({
        locus: "Patient.extension[0].id",
        disposition: "transformed",
        category: C.MRN,
      }),
    ]);
  });
});

describe("identifiers and addresses in an unexpected shape", () => {
  it("treats an Identifier with no system as a medical record number", () => {
    const out = run({ resourceType: "Patient", identifier: [{ value: "ZZNOSYSTEMMRN" }] });
    expect(out.json).not.toContain("ZZNOSYSTEMMRN");
    expect(out.manifest).toEqual([
      expect.objectContaining({ locus: "Patient.identifier.value", category: C.MRN }),
    ]);
  });

  it("emits no locus for an Identifier with no readable value, and counts what it does carry", () => {
    const out = run({
      resourceType: "Patient",
      identifier: [{ system: "http://example.org/mrn" }, { value: { nested: "ZZNESTEDID" } }],
    });
    expect(out.manifest).toEqual([]);
    expect(loci(out)).toEqual([
      "Patient.identifier[0].system",
      "Patient.identifier[1].value.nested",
    ]);
  });

  it("reduces an Address with no postalCode to its kept parts", () => {
    const out = run({
      resourceType: "Patient",
      address: [{ line: ["ZZSTREET"], city: "ZZCITY", state: "MA" }],
    });
    expect(out.json).not.toContain("ZZSTREET");
    expect(out.json).not.toContain("ZZCITY");
    expect(out.json).toContain('"address":[{"state":"MA"}]');
  });

  it("removes a swept Address whole when its postalCode is not a primitive", () => {
    const out = run({
      resourceType: "Observation",
      status: "final",
      valueAddress: { city: "ZZSWEPTCITY", postalCode: { nested: "02139" } },
    });
    expect(out.json).not.toContain("ZZSWEPTCITY");
    expect(out.json).not.toContain("valueAddress");
    expect(out.manifest).toEqual([
      expect.objectContaining({
        locus: "Observation.valueAddress",
        category: C.GEOGRAPHIC,
        disposition: "blocked",
      }),
    ]);
  });
});

describe("a model built by hand", () => {
  it("fails closed with a typed fatal on an extension node of no known kind", () => {
    const unknownKind: unknown = { kind: "unknown", value: "ZZFORGED" };
    const forged = complex([
      { name: "resourceType", value: primitive("Patient") },
      { name: "extension", value: unknownKind as FhirNode },
    ]);
    let thrown: unknown;
    try {
      deidentifyFhir(forged, { context: ctx });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(DeidError);
    expect((thrown as DeidError).code).toBe(FATAL_CODES.DEID_POSITIONS_UNENUMERABLE);
    expect((thrown as DeidError).message).not.toContain("ZZFORGED");
  });
});

describe("a root that is not a complex", () => {
  it("counts a root forged as a primitive and returns an empty resource rather than its value", () => {
    const forged = {
      kind: "primitive",
      value: "ZZFORGEDROOT",
      id: "r1",
      properties: [{ name: "resourceType", value: primitive("Patient") }],
    } as unknown as FhirComplex;
    const { document, manifest, unexaminedResiduals } = deidentifyFhir(forged, { context: ctx });
    expect(document).toEqual(complex([]));
    // Its id at the root's `_`-sibling is replaced, as every element id is, and its value is counted.
    expect(manifest.map((m) => m.locus)).toEqual(["_Patient.id"]);
    expect(JSON.stringify(manifest)).not.toContain("r1");
    expect(unexaminedResiduals.map((r) => r.locus)).toEqual(["Patient"]);
  });
});

describe("applyFhir, hand-built coordinates", () => {
  const removed = (path: string): TransformedLocus => ({
    path,
    kind: "identifier",
    value: null,
    disposition: "removed",
  });

  function patient(): { resource: FhirComplex; gender: FhirComplex["properties"][number] } {
    const resource = complex([
      { name: "resourceType", value: primitive("Patient") },
      { name: "gender", value: primitive("male") },
      { name: "birthDate", value: primitive("1970-01-01") },
    ]);
    const gender = resource.properties[1];
    if (gender === undefined) throw new Error("fixture");
    return { resource, gender };
  }

  it("skips a coordinate with no transformed locus beside it, and a hole in the coordinate list", () => {
    const { resource, gender } = patient();
    const coords: FhirCoord[] = [];
    coords[1] = { node: gender.value, edit: "drop" }; // index 0 is a hole
    coords[2] = { node: gender.value, edit: "drop" }; // no transformed[2]
    const out = applyFhir(resource, [removed("a"), removed("b")], coords);
    // Only index 1 pairs a coordinate with a locus, and it removes gender.
    expect(serializeResource(out)).toBe('{"resourceType":"Patient","birthDate":"1970-01-01"}');
    const untouched = applyFhir(resource, [], coords);
    expect(serializeResource(untouched)).toContain('"gender":"male"');
  });

  it("removes a node an address edit names when it is not an Address complex", () => {
    const { resource, gender } = patient();
    const out = applyFhir(
      resource,
      [{ path: "Patient.gender", kind: "zip", value: "021", disposition: "transformed" }],
      [{ node: gender.value, edit: "address" }],
    );
    expect(serializeResource(out)).toBe('{"resourceType":"Patient","birthDate":"1970-01-01"}');
  });

  it("returns an empty resource, never the original, when the root itself is dropped", () => {
    const { resource } = patient();
    const out = applyFhir(resource, [removed("Patient")], [{ node: resource, edit: "drop" }]);
    expect(out).toEqual(complex([]));
    expect(serializeResource(out)).not.toContain("1970");
  });

  it("extracts from a hand-built model exactly as from a parsed one", () => {
    const { resource } = patient();
    expect(extractFhirLoci(resource).loci).toEqual([
      expect.objectContaining({ path: "Patient.birthDate", kind: "date", value: "1970-01-01" }),
    ]);
  });
});
