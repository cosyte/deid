/**
 * The generated leak property for the **FHIR R4** leak property (the rule is in `./sweep.ts`).
 *
 * `@cosyte/fhir` publishes no arbitraries, so this is a deid generator: a resource of a generated type
 * (person, clinical or administrative), alone or inside a Bundle entry, with generated ordinary content.
 * Sentinels go in at generated elements in generated shapes: a plain string where a datatype is
 * expected (a `HumanName`, an `Address`, a `ContactPoint`, an `Identifier`, a `CodeableConcept`, a
 * `Reference`), an extra list item, a property R4 does not define on a datatype, a value in a code or
 * qualifier position (a `use`, a `system`, a `type` code, a `gender`), and nested structures: a
 * contained resource, a nested extension, a Bundle inside a Bundle.
 *
 * Where a sentinel sits is read back from the input JSON, as the adapter writes a locus
 * (`Patient.name[0].family`), so the residual it must be named by is exact.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseResource, serializeResource } from "@cosyte/fhir";

import { createDeidContext, DeidError, FATAL_CODES } from "../../src/index.js";
import { deidentifyFhir } from "../../src/fhir/index.js";
import {
  runLeakProperty,
  sentinelAt,
  sentinelStem,
  sweep,
  tamper,
  type LeakShape,
  type LeakTally,
  type PassOutcome,
  type Placement,
} from "./sweep.js";

const FATAL = new Set<string>(Object.values(FATAL_CODES));
const ctx = createDeidContext({ key: "leak-property-fhir-synthetic-key", patientId: "p-leak" });

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const RESOURCE_TYPES = [
  "Patient",
  "RelatedPerson",
  "Practitioner",
  "Person",
  "Observation",
  "Encounter",
  "Condition",
  "Organization",
  "Location",
  "Coverage",
  "Claim",
  "DiagnosticReport",
] as const;

/** Elements typed as a datatype, where a plain string is the unexpected shape. */
const COMPOSITE_ELEMENTS = [
  "name",
  "address",
  "telecom",
  "identifier",
  "contact",
  "code",
  "subject",
  "patient",
  "valueQuantity",
  "period",
  "managingOrganization",
  "photo",
  "link",
] as const;

/** Positions that hold a code or a qualifier, written as a path of keys and list indexes. */
const CODE_PATHS: readonly (readonly (string | number)[])[] = [
  ["identifier", 0, "system"],
  ["identifier", 0, "type", "coding", 0, "code"],
  ["identifier", 0, "type", "text"],
  ["identifier", 0, "use"],
  ["name", 0, "use"],
  ["address", 0, "use"],
  ["address", 0, "type"],
  ["telecom", 0, "system"],
  ["telecom", 0, "use"],
  ["gender"],
  ["language"],
  ["code", "coding", 0, "code"],
  ["code", "coding", 0, "system"],
  ["code", "text"],
  ["status"],
  ["communication", 0, "language", "coding", 0, "code"],
  ["maritalStatus", "coding", 0, "code"],
  ["relationship", 0, "coding", 0, "code"],
  ["valueQuantity", "unit"],
  ["category", 0, "coding", 0, "display"],
];

/** Properties R4 does not define on the datatype they are put in. */
const EXTRA_PATHS: readonly (readonly (string | number)[])[] = [
  ["name", 0, "nickname"],
  ["address", 0, "street"],
  ["telecom", 0, "number"],
  ["identifier", 0, "label"],
  ["contact", 0, "name", "alias"],
  ["code", "label"],
  ["subject", "name"],
  ["meta", "owner"],
];

const SHAPES: readonly LeakShape[] = [
  "plain-for-composite",
  "extra-repeat",
  "extra-component",
  "qualifier-or-code",
  "nested",
];

interface FhirPlacement {
  readonly shape: LeakShape;
  readonly element: string;
  readonly code: readonly (string | number)[];
  readonly extra: readonly (string | number)[];
  readonly nest: number;
}

const placementArb: fc.Arbitrary<FhirPlacement> = fc.record({
  shape: fc.constantFrom(...SHAPES),
  element: fc.constantFrom(...COMPOSITE_ELEMENTS),
  code: fc.constantFrom(...CODE_PATHS),
  extra: fc.constantFrom(...EXTRA_PATHS),
  nest: fc.nat({ max: 4 }),
});

/** One generated case: the resource type, whether it rides in a Bundle, and the placements. */
export const caseArb = fc.record({
  type: fc.constantFrom(...RESOURCE_TYPES),
  inBundle: fc.boolean(),
  filler: fc.stringMatching(/^[a-z]{3,8}$/),
  stem: sentinelStem,
  placements: fc.array(placementArb, { minLength: 1, maxLength: 4 }),
});

/** Set a value at a path of keys and indexes, creating objects and lists on the way. */
function setPath(root: JsonObject, path: readonly (string | number)[], value: Json): void {
  let node: Json = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i] as string | number;
    const next = path[i + 1];
    const container = node as Record<string | number, Json>;
    let child: Json | undefined = container[key];
    if (child === undefined || child === null || typeof child !== "object") {
      child = typeof next === "number" ? [] : {};
      container[key] = child;
    }
    node = child;
  }
  const last = path[path.length - 1] as string | number;
  (node as Record<string | number, Json>)[last] = value;
}

/** Place one sentinel into the resource in the placement's shape. */
function place(resource: JsonObject, p: FhirPlacement, sentinel: string, filler: string): string {
  switch (p.shape) {
    case "plain-for-composite":
      resource[p.element] = sentinel;
      return p.element;
    case "extra-repeat": {
      const lists: Record<string, Json> = {
        name: { family: filler, given: [filler, sentinel] },
        identifier: { system: "urn:oid:2.25.1", value: sentinel },
        telecom: { system: "phone", value: sentinel },
        address: { line: [sentinel], postalCode: "02139" },
        contact: { name: { family: sentinel } },
      };
      const key = Object.keys(lists)[p.nest % 5] as string;
      const existing = resource[key];
      const list = Array.isArray(existing) ? existing : [];
      list.push(lists[key] as Json);
      resource[key] = list;
      return `${key}[]`;
    }
    case "extra-component":
      setPath(resource, p.extra, sentinel);
      return p.extra.join(".");
    case "qualifier-or-code":
      setPath(resource, p.code, sentinel);
      return p.code.join(".");
    case "nested":
    case "plain":
    case "subcomponent": {
      // Nested: a contained resource, a nested extension, a modifier extension, a resource in a
      // resource, or a Coding nested under an extension.
      switch (p.nest) {
        case 0: {
          const contained = Array.isArray(resource["contained"]) ? resource["contained"] : [];
          contained.push({ resourceType: "Patient", id: "c1", name: [{ family: sentinel }] });
          resource["contained"] = contained;
          return "contained[].name";
        }
        case 1:
          setPath(resource, ["extension", 0], {
            url: "http://example.org/x",
            extension: [{ url: "inner", valueString: sentinel }],
          });
          return "extension[0].extension";
        case 2:
          setPath(resource, ["modifierExtension", 0], {
            url: "http://example.org/m",
            valueCode: sentinel,
          });
          return "modifierExtension[0]";
        case 3:
          setPath(resource, ["contained", 0], {
            resourceType: "Bundle",
            type: "collection",
            entry: [{ resource: { resourceType: "Patient", name: [{ text: sentinel }] } }],
          });
          return "contained[0].entry";
        default:
          setPath(resource, ["extension", 0], {
            url: "http://example.org/c",
            valueCoding: { system: "http://example.org/cs", code: sentinel },
          });
          return "extension[0].valueCoding";
      }
    }
  }
}

/** Build the document text with each placement written into it. */
export function build(value: {
  type: string;
  inBundle: boolean;
  filler: string;
  stem: string;
  placements: readonly FhirPlacement[];
}): { raw: string; placed: Placement[] } {
  const resource: JsonObject = {
    resourceType: value.type,
    status: "active",
    code: { coding: [{ system: "http://loinc.org", code: "2951-2" }] },
  };
  const placed: Placement[] = [];
  value.placements.forEach((p, i) => {
    const sentinel = sentinelAt(value.stem, i);
    const where = place(resource, p, sentinel, value.filler);
    placed.push({ sentinel, shape: p.shape, where: `${value.type}.${where}` });
  });
  const doc: JsonObject = value.inBundle
    ? { resourceType: "Bundle", type: "collection", entry: [{ resource }] }
    : resource;
  return { raw: JSON.stringify(doc), placed };
}

/** Every locus, as the adapter writes one, at which a string holding the sentinel sits. */
function lociOf(node: Json, path: string, sentinel: string, out: string[]): void {
  if (typeof node === "string") {
    if (node.includes(sentinel)) out.push(path);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => lociOf(item, `${path}[${String(i)}]`, sentinel, out));
    return;
  }
  if (node !== null && typeof node === "object") {
    for (const [key, child] of Object.entries(node)) {
      lociOf(child, `${path}.${key}`, sentinel, out);
    }
  }
}

/** Run the adapter on the text and read back the outcome. */
export function pass(raw: string): PassOutcome {
  const parsed = JSON.parse(raw) as JsonObject;
  const rootType = typeof parsed["resourceType"] === "string" ? parsed["resourceType"] : "";
  try {
    const { resource } = parseResource(raw);
    const result = deidentifyFhir(resource, { context: ctx });
    const residualLoci = new Set(result.unexaminedResiduals.map((r) => r.locus));
    return {
      output: serializeResource(result.document),
      manifest: result.manifest,
      unexaminedResiduals: result.unexaminedResiduals,
      residualAt: (s) => {
        const loci: string[] = [];
        for (const [key, child] of Object.entries(parsed)) {
          lociOf(child, `${rootType}.${key}`, s, loci);
        }
        return loci.length > 0 && loci.every((l) => residualLoci.has(l));
      },
      refused: false,
    };
  } catch (err) {
    if (err instanceof DeidError && FATAL.has(err.code)) {
      return {
        output: "",
        manifest: [],
        unexaminedResiduals: [],
        residualAt: () => false,
        refused: true,
      };
    }
    throw err;
  }
}

/** One case through the property: build, check the sentinels are in the input, run, sweep. */
export function checkCase(
  value: {
    type: string;
    inBundle: boolean;
    filler: string;
    stem: string;
    placements: readonly FhirPlacement[];
  },
  tally: LeakTally,
): string[] {
  const { raw, placed } = build(value);
  // Non-vacuity: only a sentinel the input holds is swept, and a case must hold one. A later
  // placement can overwrite an earlier one at the same position.
  const present = placed.filter((p) => raw.includes(p.sentinel));
  if (present.length === 0) return ["no sentinel reached the input"];
  return sweep(present, pass(raw), tally);
}

describe("the generated leak property: FHIR R4", () => {
  it("every sentinel is removed, or named as an unexamined residual at its locus", () => {
    runLeakProperty("fhir", caseArb, checkCase);
  });

  it("the sweep has teeth: a sentinel put back into a real output, or the manifest, is caught", () => {
    // One fixed case for the tamper proof, not a property, so the shared depth does not apply.
    const [sample] = fc.sample(caseArb, { seed: 7, numRuns: 1 });
    if (sample === undefined) throw new Error("no sample");
    const { raw, placed } = build(sample);
    const caught = tamper(placed, pass(raw));
    expect(caught.inOutput).toContain("survives in the output");
    expect(caught.inManifest).toContain("is in the manifest");
  });
});

/**
 * The keep the adapter closes, put through the same sweep as a generated case: with its fix taken out
 * of the adapter, the sweep reports each one.
 */
describe("the FHIR sweep reports a short name kept as a language", () => {
  it.each(["ZQVABA", "Zqvaba", "Zqv-Aba"])("Patient.language: %s", (sentinel) => {
    const raw = JSON.stringify({ resourceType: "Patient", language: sentinel });
    const placed: Placement[] = [{ sentinel, shape: "qualifier-or-code", where: "language" }];
    expect(sweep(placed, pass(raw))).toEqual([]);
  });
});
