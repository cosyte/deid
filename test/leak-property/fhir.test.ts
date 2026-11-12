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
 * A sentinel under a key R4 does not define on an extension (in an `extension`, a `modifierExtension`,
 * a nested extension, a primitive's `_`-sibling extension, a kept address part's) is held to more than
 * the shared rule: it must be gone from the output, because an extension is blocked whatever it holds.
 * So is a sentinel inside a part a reduced `Address` keeps (`state`, `country`) that arrives as an
 * object or a list rather than a string. A sentinel under an unknown key anywhere else is held to the
 * shared rule.
 *
 * A primitive's `_`-sibling is held to the same stricter rule when it arrives as something other than
 * the `Element` object FHIR JSON gives it: a string, a number, a boolean, an object holding a key R4
 * does not define there, or a list, at every kind of position (beside a top-level code, in an
 * extension, a modifier extension and a nested extension, on a kept address part and on an extension
 * on one, in a coding, a backbone, a contained resource, the slot of a repeating primitive and the
 * `patient-animal` extension). What it held must be gone from the output and from the manifest, and
 * no `_`-sibling in the output may hold anything but an `Element` object.
 *
 * Where a sentinel sits is read back from the input JSON, as the adapter writes a locus
 * (`Patient.name[0].family`), so the residual it must be named by is exact.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseResource, serializeResource } from "@cosyte/fhir";

import { createDeidContext, DeidError, FATAL_CODES } from "../../src/index.js";
import { deidentifyFhir, type FhirDeidOptions } from "../../src/fhir/index.js";
import {
  newTally,
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
  ["zzNote"],
  ["code", "coding", 0, "zzNote"],
  ["component", 0, "zzNote"],
  ["communication", 0, "zzNote"],
];

/**
 * Where a sentinel sits under a key R4 does not define on an extension, as {@link place} and
 * {@link animalExtension} describe it. A sentinel placed at one of these must be removed.
 */
const UNKNOWN_EXTENSION_KEY_SPOTS: readonly string[] = [
  "extension[0].note",
  "modifierExtension[0].comment",
  "extension[0].extension[0].detail",
  "_status.extension[0].note",
  "address[]._state.extension[0].note",
  "animal part note",
  "animal extension note",
  "animal userSelected",
];

/**
 * Where a sentinel sits inside a kept address part that is not a string, as {@link place} describes
 * it. A sentinel placed at one of these must be removed too: the part is blocked whole.
 */
const KEPT_ADDRESS_PART_SPOTS: readonly string[] = ["address[].state.zz", "address[].country[]"];

/** The R4 `patient-animal` extension, the one the `keepPatientAnimal` option reads. */
const ANIMAL_URL = "http://hl7.org/fhir/StructureDefinition/patient-animal";

/**
 * The JSON forms a primitive's `_`-sibling can arrive in other than the `Element` object FHIR JSON
 * gives it: each holds the case's test value, or is the test value (a number, a boolean).
 */
const SIBLING_FORMS = ["string", "number", "boolean", "object", "list"] as const;
type SiblingForm = (typeof SIBLING_FORMS)[number];

/** One `_`-sibling placement: where it goes and in which form. */
interface SiblingPlacement {
  readonly spot: number;
  readonly form: SiblingForm;
}

/** A `_`-sibling as placed: where, in which form, and the text that must not come back. */
interface SiblingPlaced {
  readonly where: string;
  readonly form: SiblingForm;
  /** The sentinel or the number the sibling holds; `undefined` for a boolean, which holds neither. */
  readonly text: string | undefined;
}

/** Append an item to a list property, making the list if the property holds anything else. */
function pushTo(resource: JsonObject, key: string, item: Json): void {
  const existing = resource[key];
  const list = Array.isArray(existing) ? existing : [];
  list.push(item);
  resource[key] = list;
}

/**
 * A `patient-animal` extension with a `_`-sibling beside its species part's `url`, its kept code or
 * its kept `userSelected`. `withValue` false leaves that primitive without a value of its own.
 */
function animalWith(at: "url" | "code" | "userSelected", sibling: Json, withValue: boolean): Json {
  const part: JsonObject = { url: "species" };
  const coding: JsonObject = { system: "http://example.org/zz-animal", code: "zzdog" };
  const holder = at === "url" ? part : coding;
  if (!withValue) delete holder[at];
  else if (at === "userSelected") holder[at] = true;
  holder[`_${at}`] = sibling;
  part["valueCodeableConcept"] = { coding: [coding] };
  return { url: ANIMAL_URL, extension: [part] };
}

/**
 * Each kind of position a primitive's `_`-sibling can sit at: beside a top-level code on any
 * resource, in an extension (its `url`, its `id`), a modifier extension and a nested extension,
 * beside a part a reduced address keeps and on the url of an extension on one, in a coding, a
 * backbone, a contained resource, the slot of a repeating primitive, and in the `patient-animal`
 * extension (its part's url, a kept code, a kept `userSelected`). `withValue` false leaves the
 * primitive without a value of its own: the reader refuses a list beside a single value, so that is
 * how the list form reaches it.
 */
const SIBLING_SPOTS: readonly {
  readonly where: string;
  readonly put: (resource: JsonObject, sibling: Json, withValue: boolean) => void;
}[] = [
  {
    where: "_status",
    put: (r, s, v) => {
      if (!v) delete r["status"];
      r["_status"] = s;
    },
  },
  {
    where: "_gender",
    put: (r, s, v) => {
      if (v) r["gender"] = "other";
      else delete r["gender"];
      r["_gender"] = s;
    },
  },
  {
    where: "extension[]._url",
    put: (r, s, v) => {
      pushTo(r, "extension", { ...(v ? { url: "http://example.org/sib" } : {}), _url: s });
    },
  },
  {
    where: "extension[]._id",
    put: (r, s, v) => {
      pushTo(r, "extension", {
        url: "http://example.org/sib",
        ...(v ? { id: "e1" } : {}),
        _id: s,
      });
    },
  },
  {
    where: "modifierExtension[]._url",
    put: (r, s, v) => {
      pushTo(r, "modifierExtension", { ...(v ? { url: "http://example.org/m" } : {}), _url: s });
    },
  },
  {
    where: "extension[].extension[0]._url",
    put: (r, s, v) => {
      pushTo(r, "extension", {
        url: "http://example.org/sib",
        extension: [{ ...(v ? { url: "in" } : {}), _url: s }],
      });
    },
  },
  {
    where: "address[]._state",
    put: (r, s, v) => {
      pushTo(r, "address", { ...(v ? { state: "MA" } : {}), _state: s, postalCode: "02139" });
    },
  },
  {
    where: "address[]._country",
    put: (r, s, v) => {
      pushTo(r, "address", { ...(v ? { country: "US" } : {}), _country: s, postalCode: "02139" });
    },
  },
  {
    where: "address[]._state.extension[0]._url",
    put: (r, s, v) => {
      pushTo(r, "address", {
        state: "MA",
        _state: { extension: [{ ...(v ? { url: "http://example.org/a" } : {}), _url: s }] },
        postalCode: "02139",
      });
    },
  },
  {
    where: "code.coding[]._code",
    put: (r, s, v) => {
      r["code"] = {
        coding: [{ system: "http://loinc.org", ...(v ? { code: "2951-2" } : {}), _code: s }],
      };
    },
  },
  {
    where: "identifier[]._system",
    put: (r, s, v) => {
      pushTo(r, "identifier", {
        ...(v ? { system: "urn:oid:2.25.7" } : {}),
        _system: s,
        value: "zz1",
      });
    },
  },
  {
    where: "contained[]._status",
    put: (r, s, v) => {
      pushTo(r, "contained", {
        resourceType: "Observation",
        id: "sib",
        ...(v ? { status: "final" } : {}),
        _status: s,
        code: { text: "sodium" },
      });
    },
  },
  {
    where: "zzCodes[1] slot",
    put: (r, s) => {
      // A slot of a repeating primitive takes a list as well as a scalar, beside its value.
      r["zzCodes"] = ["zza", "zzb"];
      r["_zzCodes"] = [null, s];
    },
  },
  {
    where: "animal species _url",
    put: (r, s, v) => {
      pushTo(r, "extension", animalWith("url", s, v));
    },
  },
  {
    where: "animal coding _code",
    put: (r, s, v) => {
      pushTo(r, "extension", animalWith("code", s, v));
    },
  },
  {
    where: "animal coding _userSelected",
    put: (r, s, v) => {
      pushTo(r, "extension", animalWith("userSelected", s, v));
    },
  },
];

const siblingArb: fc.Arbitrary<SiblingPlacement> = fc.record({
  spot: fc.nat({ max: SIBLING_SPOTS.length - 1 }),
  form: fc.constantFrom(...SIBLING_FORMS),
});

/**
 * The number a `_`-sibling in the number form holds: twelve digits, from the case's sentinel, so no
 * ordinary content of a generated case can hold it by chance.
 */
function siblingNumber(sentinel: string): number {
  let n = 0;
  for (const ch of sentinel) n = (n * 31 + ch.charCodeAt(0)) % 1e11;
  return 9e11 + n;
}

/** Write one `_`-sibling into the resource in its form, and say what must not come back. */
function placeSibling(resource: JsonObject, p: SiblingPlacement, sentinel: string): SiblingPlaced {
  const spot = SIBLING_SPOTS[p.spot % SIBLING_SPOTS.length];
  if (spot === undefined) throw new Error("no sibling spot");
  const number = siblingNumber(sentinel);
  const forms: Record<SiblingForm, readonly [Json, string | undefined]> = {
    string: [sentinel, sentinel],
    number: [number, String(number)],
    boolean: [true, undefined],
    object: [{ note: sentinel }, sentinel],
    list: [[sentinel], sentinel],
  };
  const [sibling, text] = forms[p.form];
  // The reader refuses a list beside a single value, so the list form goes where there is none.
  spot.put(resource, sibling, p.form !== "list" || spot.where.endsWith("slot"));
  return { where: spot.where, form: p.form, text };
}

/**
 * Every `_`-sibling key in a JSON value that holds anything but an `Element` object (or, in a
 * repeating primitive's list, an object or a `null` padding a slot), by its path.
 */
function oddSiblings(node: Json, path: string, out: string[]): string[] {
  if (Array.isArray(node)) {
    node.forEach((item, i) => oddSiblings(item, `${path}[${String(i)}]`, out));
    return out;
  }
  if (node === null || typeof node !== "object") return out;
  for (const [key, child] of Object.entries(node)) {
    const at = `${path}.${key}`;
    if (key.startsWith("_")) {
      const slots = Array.isArray(child) ? child : [child];
      const odd = slots.some(
        (slot) =>
          (slot === null && !Array.isArray(child)) ||
          (slot !== null && (typeof slot !== "object" || Array.isArray(slot))),
      );
      if (odd) out.push(at);
    }
    oddSiblings(child, at, out);
  }
  return out;
}

/**
 * The stricter rule for a `_`-sibling that is not an object: what it held is gone from the output and
 * from the manifest, and no `_`-sibling in the output holds anything but an `Element` object.
 */
export function siblingTextKept(placed: readonly SiblingPlaced[], outcome: PassOutcome): string[] {
  const violations: string[] = [];
  const manifest = JSON.stringify(outcome.manifest);
  for (const p of placed) {
    if (p.text === undefined) continue;
    const label = `${p.text} (${p.form} at ${p.where})`;
    if (outcome.output.includes(p.text)) violations.push(`${label} survives in the output`);
    if (manifest.includes(p.text)) violations.push(`${label} is in the manifest`);
  }
  if (outcome.output.length > 0) {
    for (const at of oddSiblings(JSON.parse(outcome.output) as Json, "", [])) {
      violations.push(`a _-sibling that is not an object survives at ${at}`);
    }
  }
  return violations;
}

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
  nest: fc.nat({ max: 11 }),
});

/** One generated case: the resource type, whether it rides in a Bundle, and the placements. */
export const caseArb = fc.record({
  type: fc.constantFrom(...RESOURCE_TYPES),
  inBundle: fc.boolean(),
  filler: fc.stringMatching(/^[a-z]{3,8}$/),
  stem: sentinelStem,
  placements: fc.array(placementArb, { minLength: 1, maxLength: 4 }),
  siblings: fc.array(siblingArb, { maxLength: 2 }),
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
      // resource, a Coding nested under an extension, a key R4 does not define on an extension, or a
      // kept address part that is an object or a list.
      switch (p.nest) {
        case 5:
          setPath(resource, ["extension", 0], { url: "http://example.org/n", note: sentinel });
          return "extension[0].note";
        case 6:
          setPath(resource, ["modifierExtension", 0], {
            url: "http://example.org/m",
            comment: sentinel,
          });
          return "modifierExtension[0].comment";
        case 7:
          setPath(resource, ["extension", 0], {
            url: "http://example.org/x",
            extension: [{ url: "inner", detail: { text: sentinel } }],
          });
          return "extension[0].extension[0].detail";
        case 8:
          resource["_status"] = {
            extension: [{ url: "http://example.org/s", note: sentinel }],
          };
          return "_status.extension[0].note";
        case 9: {
          const existing = resource["address"];
          const list = Array.isArray(existing) ? existing : [];
          list.push({
            state: "MA",
            _state: { extension: [{ url: "http://example.org/a", note: sentinel }] },
            postalCode: "02139",
          });
          resource["address"] = list;
          return "address[]._state.extension[0].note";
        }
        case 10:
        case 11: {
          const existing = resource["address"];
          const list = Array.isArray(existing) ? existing : [];
          list.push(
            p.nest === 10
              ? { state: { zz: sentinel }, postalCode: "02139" }
              : { country: [sentinel], postalCode: "02139" },
          );
          resource["address"] = list;
          return p.nest === 10 ? "address[].state.zz" : "address[].country[]";
        }
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

/** How many places {@link animalExtension} can put a sentinel. */
const ANIMAL_SPOTS = 15;

/** A coded animal part, with an ordinary generated code. */
function animalPart(url: string, filler: string): JsonObject {
  return {
    url,
    valueCodeableConcept: { coding: [{ system: "http://example.org/zz-animal", code: filler }] },
  };
}

/**
 * A `patient-animal` extension with a sentinel at one of {@link ANIMAL_SPOTS} places: three a kept
 * code holds (which the pass must name as a residual), and the rest where the option still blocks (a
 * `valueString`, a fourth sub-extension, a look-alike URL, the concept's `text`, an extension on a
 * coding, a repeated part, a value on the extension itself, a display with no code, a nested
 * extension, a key R4 does not define on a part or on the extension itself, a `userSelected` that is
 * not a boolean).
 */
function animalExtension(
  spot: number,
  sentinel: string,
  filler: string,
): {
  readonly ext: JsonObject;
  readonly shape: LeakShape;
  readonly where: string;
} {
  const species = animalPart("species", filler);
  const breed = animalPart("breed", filler);
  const gender = animalPart("genderStatus", filler);
  const coded = (system: string, code: string, display?: string): JsonObject => ({
    url: "species",
    valueCodeableConcept: {
      coding: [{ system, code, ...(display === undefined ? {} : { display }) }],
    },
  });
  const ext = (parts: Json[], extra: JsonObject = {}, url = ANIMAL_URL): JsonObject => ({
    url,
    extension: parts,
    ...extra,
  });
  switch (spot) {
    case 0:
      return {
        ext: ext([coded("http://example.org/zz-animal", sentinel), breed]),
        shape: "qualifier-or-code",
        where: "animal species code",
      };
    case 1:
      return {
        ext: ext([coded("http://example.org/zz-animal", filler, sentinel), breed]),
        shape: "qualifier-or-code",
        where: "animal species display",
      };
    case 2:
      return {
        ext: ext([coded(sentinel, filler), gender]),
        shape: "qualifier-or-code",
        where: "animal species system",
      };
    case 3:
      return {
        ext: ext([{ url: "species", valueString: sentinel }, breed]),
        shape: "nested",
        where: "animal species valueString",
      };
    case 4:
      return {
        ext: ext([species, { url: "registration", valueString: sentinel }]),
        shape: "nested",
        where: "animal extra sub-extension",
      };
    case 5:
      return {
        ext: ext([coded("http://example.org/zz-animal", sentinel)], {}, `${ANIMAL_URL}|4.0.1`),
        shape: "nested",
        where: "look-alike animal url",
      };
    case 6:
      return {
        ext: ext([
          {
            url: "species",
            valueCodeableConcept: { coding: [{ code: filler }], text: sentinel },
          },
        ]),
        shape: "nested",
        where: "animal species text",
      };
    case 7:
      return {
        ext: ext([
          species,
          {
            url: "genderStatus",
            valueCodeableConcept: {
              coding: [{ code: filler, extension: [{ url: "x", valueString: sentinel }] }],
            },
          },
        ]),
        shape: "nested",
        where: "animal coding extension",
      };
    case 8:
      return {
        ext: ext([species, coded("http://example.org/zz-animal", sentinel)]),
        shape: "nested",
        where: "repeated animal species",
      };
    case 9:
      return {
        ext: ext([species], { valueString: sentinel }),
        shape: "nested",
        where: "animal extension value",
      };
    case 10:
      return {
        ext: ext([
          {
            url: "breed",
            valueCodeableConcept: { coding: [{ display: sentinel }] },
          },
        ]),
        shape: "nested",
        where: "animal display with no code",
      };
    case 12:
      return {
        ext: ext([{ ...species, note: sentinel }, breed]),
        shape: "nested",
        where: "animal part note",
      };
    case 13:
      return {
        ext: ext([species, gender], { note: sentinel }),
        shape: "nested",
        where: "animal extension note",
      };
    case 14:
      return {
        ext: ext([
          {
            url: "species",
            valueCodeableConcept: {
              coding: [
                { system: "http://example.org/zz-animal", code: filler, userSelected: sentinel },
              ],
            },
          },
        ]),
        shape: "qualifier-or-code",
        where: "animal userSelected",
      };
    default:
      return {
        ext: ext([{ ...species, extension: [{ url: "note", valueString: sentinel }] }]),
        shape: "nested",
        where: "animal nested extension",
      };
  }
}

/** Build the document text with each placement written into it. */
export function build(value: {
  type: string;
  inBundle: boolean;
  filler: string;
  stem: string;
  placements: readonly FhirPlacement[];
  animalSpot?: number;
  siblings?: readonly SiblingPlacement[];
}): { raw: string; placed: Placement[]; siblings: SiblingPlaced[] } {
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
  if (value.animalSpot !== undefined) {
    const sentinel = sentinelAt(value.stem, value.placements.length);
    const animal = animalExtension(value.animalSpot, sentinel, value.filler);
    const existing = resource["extension"];
    resource["extension"] = [...(Array.isArray(existing) ? existing : []), animal.ext];
    placed.push({ sentinel, shape: animal.shape, where: `${value.type}.${animal.where}` });
  }
  const offset = placed.length;
  const siblings = (value.siblings ?? []).map((p, i) => {
    const sib = placeSibling(resource, p, sentinelAt(value.stem, offset + i));
    return { ...sib, where: `${value.type}.${sib.where}` };
  });
  const doc: JsonObject = value.inBundle
    ? { resourceType: "Bundle", type: "collection", entry: [{ resource }] }
    : resource;
  return { raw: JSON.stringify(doc), placed, siblings };
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
export function pass(raw: string, options: FhirDeidOptions = {}): PassOutcome {
  const parsed = JSON.parse(raw) as JsonObject;
  const rootType = typeof parsed["resourceType"] === "string" ? parsed["resourceType"] : "";
  try {
    const { resource } = parseResource(raw);
    const result = deidentifyFhir(resource, { ...options, context: ctx });
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
    animalSpot?: number;
    siblings?: readonly SiblingPlacement[];
  },
  tally: LeakTally,
  options: FhirDeidOptions = {},
): string[] {
  const { raw, placed, siblings } = build(value);
  // A `_`-sibling the input does not hold (a later write replaced it) is not swept.
  const held = siblings.filter((s) => s.text === undefined || raw.includes(s.text));
  // Non-vacuity: only a sentinel the input holds is swept, and a case must hold one. A later
  // placement can overwrite an earlier one at the same position.
  const present = placed.filter((p) => raw.includes(p.sentinel));
  if (present.length === 0 && held.length === 0) return ["no sentinel reached the input"];
  const outcome = pass(raw, options);
  return [
    ...sweep(present, outcome, tally),
    ...unknownExtensionKeyKept(present, outcome),
    ...siblingTextKept(held, outcome),
  ];
}

/**
 * The stricter rule for a sentinel under a key R4 does not define on an extension, or inside a kept
 * address part that is not a string: it is gone from the output. Being named as a residual is not
 * enough there, because an extension is blocked whatever it holds and so is a part of that shape.
 */
export function unknownExtensionKeyKept(
  placed: readonly Placement[],
  outcome: PassOutcome,
): string[] {
  return placed
    .filter((p) =>
      [...UNKNOWN_EXTENSION_KEY_SPOTS, ...KEPT_ADDRESS_PART_SPOTS].some((spot) =>
        p.where.endsWith(spot),
      ),
    )
    .filter((p) => outcome.output.includes(p.sentinel))
    .map((p) => `${p.sentinel} (${p.shape} at ${p.where}) survives where it must be removed`);
}

/**
 * One generated case for the property with `keepPatientAnimal` on: a `patient-animal` extension with a
 * sentinel in it, on a `Patient` half the time, beside up to three ordinary placements.
 */
export const animalCaseArb = fc.record({
  type: fc.oneof(fc.constant("Patient"), fc.constantFrom(...RESOURCE_TYPES)),
  inBundle: fc.boolean(),
  filler: fc.stringMatching(/^[a-z]{3,8}$/),
  stem: sentinelStem,
  placements: fc.array(placementArb, { maxLength: 3 }),
  animalSpot: fc.nat({ max: ANIMAL_SPOTS - 1 }),
  siblings: fc.array(siblingArb, { maxLength: 2 }),
});

describe("the generated leak property: FHIR R4", () => {
  it("every sentinel is removed, or named as an unexamined residual at its locus", () => {
    runLeakProperty("fhir", caseArb, checkCase);
  });

  it("with keepPatientAnimal on, the same holds, the patient-animal extension included", () => {
    runLeakProperty("fhir-animal", animalCaseArb, (value, tally) =>
      checkCase(value, tally, { keepPatientAnimal: true }),
    );
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
 * Each place an unknown extension key can sit, on a person and on a clinical resource, through the
 * same check as a generated case, so every one is run on every pull request whatever the seed draws.
 */
describe("the FHIR sweep removes a sentinel under an unknown extension key or in an odd kept part", () => {
  const base = { inBundle: false, filler: "abc", stem: "ZQLKUNKN" };
  const nested = (nest: number): FhirPlacement => ({
    shape: "nested",
    element: "name",
    code: ["status"],
    extra: ["meta", "owner"],
    nest,
  });

  it.each([
    ["Patient", 5],
    ["Patient", 6],
    ["Patient", 7],
    ["Patient", 9],
    ["Observation", 5],
    ["Observation", 6],
    ["Observation", 7],
    ["Observation", 8],
    ["Organization", 9],
    ["Patient", 10],
    ["Patient", 11],
    ["Organization", 10],
    ["Organization", 11],
  ])("%s, nest %i", (type, nest) => {
    const violations = checkCase({ ...base, type, placements: [nested(nest)] }, newTally());
    expect(violations).toEqual([]);
  });

  it.each([12, 13, 14])("the patient-animal extension, spot %i", (animalSpot) => {
    const value = { ...base, type: "Patient", placements: [], animalSpot };
    expect(checkCase(value, newTally(), { keepPatientAnimal: true })).toEqual([]);
  });

  it("the stricter rule has teeth: a residual is not enough under an unknown extension key", () => {
    const placed: Placement[] = [
      { sentinel: "ZQLKTEETH00X", shape: "nested", where: "Observation.extension[0].note" },
    ];
    const outcome: PassOutcome = {
      output: '{"note":"ZQLKTEETH00X"}',
      manifest: [],
      unexaminedResiduals: [],
      residualAt: () => true,
      refused: false,
    };
    expect(unknownExtensionKeyKept(placed, outcome)).toHaveLength(1);
  });
});

/**
 * Each place a `_`-sibling can sit, in each form, on a person and on a clinical resource, with the
 * patient-animal option off and on, through the same check as a generated case, so every one is run
 * on every pull request whatever the seed draws.
 */
describe("the FHIR sweep removes what a `_`-sibling that is not an object held", () => {
  const cases = SIBLING_SPOTS.flatMap((spot, i) =>
    SIBLING_FORMS.map((form) => [spot.where, form, i] as const),
  );

  it.each(cases)("%s, as a %s", (_where, form, spot) => {
    for (const type of ["Patient", "Observation"]) {
      for (const keepPatientAnimal of [false, true]) {
        const value = {
          type,
          inBundle: false,
          filler: "abc",
          stem: "ZQLKSIBL",
          placements: [],
          siblings: [{ spot, form }],
        };
        expect(checkCase(value, newTally(), { keepPatientAnimal })).toEqual([]);
      }
    }
  });

  it("the case holds what it placed: the text is in the input, in its form", () => {
    for (const [, form, spot] of cases) {
      const { raw, siblings } = build({
        type: "Observation",
        inBundle: true,
        filler: "abc",
        stem: "ZQLKSIBL",
        placements: [],
        siblings: [{ spot, form }],
      });
      const [placed] = siblings;
      expect(placed?.form).toBe(form);
      if (placed?.text !== undefined) expect(raw).toContain(placed.text);
      else expect(raw).toMatch(/"_[A-Za-z]+":(\[null,)?true/);
    }
  });

  it("the stricter rule has teeth: sibling text in the output or the manifest is caught", () => {
    const placed: SiblingPlaced[] = [
      { where: "Observation._status", form: "string", text: "ZQLKTEETH01X" },
    ];
    const clean: PassOutcome = {
      output: '{"resourceType":"Observation","_status":{"id":"s1"}}',
      manifest: [],
      unexaminedResiduals: [],
      residualAt: () => false,
      refused: false,
    };
    expect(siblingTextKept(placed, clean)).toEqual([]);
    expect(
      siblingTextKept(placed, {
        ...clean,
        output: '{"resourceType":"Observation","_status":"ZQLKTEETH01X"}',
      }),
    ).toHaveLength(2);
    expect(siblingTextKept(placed, { ...clean, manifest: [{ locus: "ZQLKTEETH01X" }] })).toEqual([
      "ZQLKTEETH01X (string at Observation._status) is in the manifest",
    ]);
    for (const odd of ["true", "900000000001", "null", "[[1]]", "[true]"]) {
      expect(
        siblingTextKept([], {
          ...clean,
          output: `{"resourceType":"Observation","_status":${odd}}`,
        }),
      ).toEqual(["a _-sibling that is not an object survives at ._status"]);
    }
    expect(
      siblingTextKept([], { ...clean, output: '{"zz":["a","b"],"_zz":[null,{"id":"x"}]}' }),
    ).toEqual([]);
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
