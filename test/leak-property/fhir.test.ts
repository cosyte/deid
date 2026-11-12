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
 * A sentinel under a key R4 does not define where it sits is held to more than the shared rule: it
 * must be gone from the output and from the manifest, because such a key is blocked whatever it holds.
 * That holds inside an extension (an `extension`, a `modifierExtension`, a nested extension, a
 * primitive's `_`-sibling extension, a kept address part's) and everywhere else: at every kind of
 * position (the top level, a datatype, a datatype inside one, a backbone, `meta`, the narrative, a
 * structure where R4 puts a primitive, a contained resource, a Bundle entry and its request) on a
 * person, a clinical and an infrastructure resource. So is a sentinel inside a part a reduced
 * `Address` keeps (`state`, `country`) that arrives as an object or a list rather than a string.
 *
 * A primitive's `_`-sibling is held to the same stricter rule when it arrives as something other than
 * the `Element` object FHIR JSON gives it: a string, a number, a boolean, an object holding a key R4
 * does not define there, or a list, at every kind of position (beside a top-level code, in an
 * extension, a modifier extension and a nested extension, on a kept address part and on an extension
 * on one, in a coding, a backbone, a contained resource, the slot of a repeating primitive and the
 * `patient-animal` extension). What it held must be gone from the output and from the manifest, and
 * no `_`-sibling in the output may hold anything but an `Element` object.
 *
 * So is a sentinel in a primitive that does not fit the format R4 defines for its type, or a code
 * outside the value set R4 binds it to, required: an `id` with a space, a name where a date, a time
 * or an instant belongs, a `uri` with white space, a `code` with a leading space, an `integer` or a
 * `positiveInt` past its range, a `base64Binary` with a character it does not use, a `SampledData`
 * series with a word in it, and an extension `url` that is no `uri`, on the resource's own `meta`,
 * `text` and extensions and in a contained resource.
 *
 * An element `id` is held to the stricter rule too: a sentinel written as the `id` of any element, at
 * every kind of position (a datatype, a `Coding`, a backbone, an extension at any depth, a primitive's
 * `_`-sibling, a kept address part and an extension on one, a contained resource, a Bundle entry, the
 * slot of a repeating primitive, the `patient-animal` extension), must be gone from the output and
 * from the manifest, since the pass replaces every element id.
 *
 * So is a sentinel in **embedded content** the pass does not read: a made-up note naming it, in
 * valid base64, at an `Attachment.data` (a `DocumentReference`, a `Media`, a `DiagnosticReport`'s
 * presented form, a `QuestionnaireResponse` answer, an extension's `valueAttachment`), an
 * `Attachment.hash`, a `Binary.data`, a `Signature.data`, a `Device`'s `carrierAIDC`, an
 * `AuditEvent` query and an extension's `valueBase64Binary`, or the sentinel itself in an
 * `Attachment.url` (a link, and a `data:` url) and in the narrative `div`. Each is removed by
 * default, so what it held must be gone from the output and from the manifest.
 *
 * Where a sentinel sits is read back from the input JSON, as the adapter writes a locus
 * (`Patient.name[0].family`), so the residual it must be named by is exact.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { parseResource, serializeResource } from "@cosyte/fhir";

import { createDeidContext, DeidError, FATAL_CODES } from "../../src/index.js";
import { deidentifyFhir, type FhirDeidOptions } from "../../src/fhir/index.js";
import { fhirElementsOf } from "../../src/fhir/element-names.js";
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
  "Device",
  "Provenance",
  "AuditEvent",
  "Endpoint",
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
 * Each kind of position an element `id` can sit at, each putting the case's sentinel there as the id:
 * a datatype, a `Coding`, a primitive's `_`-sibling (beside a top-level code, beside a coding's code,
 * beside a quantity's number), a backbone, an `Identifier` and a `Period` inside one, a `Reference` and
 * its `_reference`, `meta` and the narrative, an extension, a modifier extension and a nested one, an
 * extension on a primitive, a kept address part and an extension on one, an address, a contained
 * resource, an entry of a Bundle inside the resource, the slot of a repeating primitive, an element R4
 * does not define, and the `patient-animal` extension (its own id, a part's and a coding's).
 */
const ELEMENT_ID_SPOTS: readonly {
  readonly where: string;
  readonly put: (resource: JsonObject, id: string) => void;
}[] = [
  { where: "code.id", put: (r, id) => (r["code"] = { id, text: "zz sodium" }) },
  {
    where: "code.coding[0].id",
    put: (r, id) => (r["code"] = { coding: [{ id, system: "http://loinc.org", code: "2951-2" }] }),
  },
  { where: "_status.id", put: (r, id) => (r["_status"] = { id }) },
  {
    where: "code.coding[0]._code.id",
    put: (r, id) =>
      (r["code"] = { coding: [{ system: "http://loinc.org", code: "2951-2", _code: { id } }] }),
  },
  {
    where: "valueQuantity._value.id",
    put: (r, id) => (r["valueQuantity"] = { value: 140, _value: { id }, unit: "mmol/L" }),
  },
  { where: "valueQuantity.id", put: (r, id) => (r["valueQuantity"] = { id, value: 140 }) },
  {
    where: "component[].id",
    put: (r, id) => {
      pushTo(r, "component", { id, code: { text: "zz part" } });
    },
  },
  {
    where: "identifier[].id",
    put: (r, id) => {
      pushTo(r, "identifier", { id, system: "urn:oid:2.25.7", value: "zz1" });
    },
  },
  {
    where: "identifier[].period.id",
    put: (r, id) => {
      pushTo(r, "identifier", { system: "urn:oid:2.25.7", value: "zz1", period: { id } });
    },
  },
  {
    where: "subject.id",
    put: (r, id) => (r["subject"] = { id, reference: "Patient/zz1" }),
  },
  {
    where: "subject._reference.id",
    put: (r, id) => (r["subject"] = { reference: "Patient/zz1", _reference: { id } }),
  },
  { where: "meta.id", put: (r, id) => (r["meta"] = { id, versionId: "1" }) },
  {
    where: "text.id",
    put: (r, id) =>
      (r["text"] = {
        id,
        status: "generated",
        div: '<div xmlns="http://www.w3.org/1999/xhtml">zz</div>',
      }),
  },
  {
    where: "extension[].id",
    put: (r, id) => {
      pushTo(r, "extension", { id, url: "http://example.org/eid", valueBoolean: true });
    },
  },
  {
    where: "modifierExtension[].id",
    put: (r, id) => {
      pushTo(r, "modifierExtension", { id, url: "http://example.org/eid" });
    },
  },
  {
    where: "extension[].extension[0].id",
    put: (r, id) => {
      pushTo(r, "extension", { url: "http://example.org/eid", extension: [{ id, url: "in" }] });
    },
  },
  {
    where: "_status.extension[0].id",
    put: (r, id) => (r["_status"] = { extension: [{ id, url: "http://example.org/eid" }] }),
  },
  {
    where: "address[]._state.id",
    put: (r, id) => {
      pushTo(r, "address", { state: "MA", _state: { id }, postalCode: "02139" });
    },
  },
  {
    where: "address[]._state.extension[0].id",
    put: (r, id) => {
      pushTo(r, "address", {
        state: "MA",
        _state: { extension: [{ id, url: "http://example.org/eid" }] },
        postalCode: "02139",
      });
    },
  },
  {
    where: "address[].id",
    put: (r, id) => {
      pushTo(r, "address", { id, state: "MA", postalCode: "02139" });
    },
  },
  {
    where: "contained[].code.id",
    put: (r, id) => {
      pushTo(r, "contained", {
        resourceType: "Observation",
        id: "eid",
        status: "final",
        code: { id, text: "zz sodium" },
      });
    },
  },
  {
    where: "contained[].entry[0].id",
    put: (r, id) => {
      pushTo(r, "contained", {
        resourceType: "Bundle",
        type: "collection",
        entry: [{ id, resource: { resourceType: "Basic", code: { text: "zz" } } }],
      });
    },
  },
  {
    where: "zzCodes[1] slot id",
    put: (r, id) => {
      r["zzCodes"] = ["zza", "zzb"];
      r["_zzCodes"] = [null, { id }];
    },
  },
  { where: "zzNote.id", put: (r, id) => (r["zzNote"] = { id, text: "zz" }) },
  {
    where: "animal extension id",
    put: (r, id) => {
      pushTo(r, "extension", { id, url: ANIMAL_URL, extension: [animalPart("species", "zzdog")] });
    },
  },
  {
    where: "animal species part id",
    put: (r, id) => {
      pushTo(r, "extension", {
        url: ANIMAL_URL,
        extension: [{ id, url: "species", valueCodeableConcept: { coding: [{ code: "zzdog" }] } }],
      });
    },
  },
  {
    where: "animal coding id",
    put: (r, id) => {
      pushTo(r, "extension", {
        url: ANIMAL_URL,
        extension: [{ url: "species", valueCodeableConcept: { coding: [{ id, code: "zzdog" }] } }],
      });
    },
  },
];

const elementIdArb: fc.Arbitrary<number> = fc.nat({ max: ELEMENT_ID_SPOTS.length - 1 });

/**
 * Each kind of position a key R4 does not define can sit at, each putting the case's sentinel under
 * one: the top level (holding a string, a structure, a list), a datatype (`meta`, a `Coding` in
 * `meta.tag`, the narrative, an `Identifier`), a datatype inside one (an identifier's `type` coding,
 * `period` and `assigner`), a structure where R4 puts a primitive (`meta.versionId`), a backbone of
 * the resource's own type, a contained resource's top level and a datatype in it, and a Bundle
 * entry and its request (in a Bundle the resource contains).
 *
 * Then each kind of position a value of a shape R4 does not define can sit at, with the sentinel as
 * that value: a scalar where a datatype (`meta`, the narrative), a `Reference` (on the resource's own
 * type, and on a person, a clinical and an infrastructure resource it contains), a backbone or a
 * resource (contained, in a Bundle entry) belongs; a structure where a primitive belongs; a list
 * where one value belongs and one value where a list belongs; and a resource whose type is missing,
 * is the sentinel itself, or is one R4 does not define, contained or in a Bundle entry.
 *
 * Then each kind of position a primitive of a JSON type R4 does not give it can sit at: the sentinel
 * as a string where R4 puts a boolean, an integer or a decimal, and as a number
 * ({@link numericSentinel}) where R4 puts a string, at the top level, in a datatype, in a datatype
 * inside one, in a backbone, in a choice element and in a nested backbone, on a person, a clinical
 * and an infrastructure resource. And the sentinel as a key R4 does not define, which no row may
 * repeat: at the top level, in a datatype, in an extension and in a contained resource.
 *
 * A spot with a `text` places that text in place of the sentinel, and it is that text which must not
 * come back.
 */
const UNKNOWN_KEY_SPOTS: readonly {
  readonly where: string;
  readonly put: (resource: JsonObject, sentinel: string) => void;
  readonly text?: (sentinel: string) => string;
}[] = [
  { where: "zzTop", put: (r, s) => (r["zzTop"] = s) },
  { where: "zzDetail", put: (r, s) => (r["zzDetail"] = { who: s, list: [s] }) },
  { where: "zzItems", put: (r, s) => (r["zzItems"] = ["zz", s]) },
  { where: "meta.zzOwner", put: (r, s) => (r["meta"] = { versionId: "1", zzOwner: s }) },
  {
    where: "meta.tag[0].zzNote",
    put: (r, s) =>
      (r["meta"] = { tag: [{ system: "http://example.org/t", code: "t", zzNote: s }] }),
  },
  { where: "meta.versionId.zz", put: (r, s) => (r["meta"] = { versionId: { zz: s } }) },
  {
    where: "text.zzNote",
    put: (r, s) =>
      (r["text"] = {
        status: "generated",
        div: '<div xmlns="http://www.w3.org/1999/xhtml">zz</div>',
        zzNote: s,
      }),
  },
  {
    where: "identifier[].zzNote",
    put: (r, s) => {
      pushTo(r, "identifier", { system: "urn:oid:2.25.7", value: "zz1", zzNote: s });
    },
  },
  {
    where: "identifier[].type.coding[0].zzNote",
    put: (r, s) => {
      pushTo(r, "identifier", {
        type: { coding: [{ system: "http://example.org/it", code: "MR", zzNote: s }] },
        value: "zz1",
      });
    },
  },
  {
    where: "identifier[].period.zzNote",
    put: (r, s) => {
      pushTo(r, "identifier", { value: "zz1", period: { start: "2020", zzNote: s } });
    },
  },
  {
    where: "identifier[].assigner.zzNote",
    put: (r, s) => {
      pushTo(r, "identifier", {
        value: "zz1",
        assigner: { reference: "Organization/zz1", zzNote: s },
      });
    },
  },
  {
    where: "backbone.zzNote",
    put: (r, s) => {
      const type = typeof r["resourceType"] === "string" ? r["resourceType"] : "";
      const [key, item] = BACKBONES[type] ?? ["zzBackbone", {}];
      pushTo(r, key, { ...item, zzNote: s });
    },
  },
  {
    where: "contained[].zzNote",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Basic", id: "zzc", code: { text: "zz" }, zzNote: s });
    },
  },
  {
    where: "contained[].code.coding[0].zzNote",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "Patient",
        id: "zzp",
        maritalStatus: { coding: [{ code: "M", zzNote: s }] },
      });
    },
  },
  {
    where: "contained[].entry[0].zzNote",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "Bundle",
        type: "collection",
        entry: [{ zzNote: s, resource: { resourceType: "Basic", code: { text: "zz" } } }],
      });
    },
  },
  {
    where: "contained[].entry[0].request.zzNote",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "Bundle",
        type: "transaction",
        entry: [{ request: { method: "POST", url: "Basic", zzNote: s } }],
      });
    },
  },
  // A value of a shape R4 does not define where it sits: a scalar where a structure belongs, a
  // structure where a primitive belongs, a list where one value belongs and the reverse.
  { where: "meta as a scalar", put: (r, s) => (r["meta"] = s) },
  { where: "text as a scalar", put: (r, s) => (r["text"] = s) },
  {
    where: "a Reference as a scalar",
    put: (r, s) => {
      const type = typeof r["resourceType"] === "string" ? r["resourceType"] : "";
      (REFERENCES[type] ?? REFERENCES["Observation"])?.put(r, s);
    },
  },
  { where: "meta.versionId as a structure", put: (r, s) => (r["meta"] = { versionId: { zz: s } }) },
  { where: "meta.versionId as a list", put: (r, s) => (r["meta"] = { versionId: ["1", s] }) },
  { where: "meta.tag as one coding", put: (r, s) => (r["meta"] = { tag: { code: s } }) },
  {
    where: "meta.security[0].code as a list",
    put: (r, s) => (r["meta"] = { security: [{ system: "http://example.org/s", code: [s] }] }),
  },
  {
    where: "contained[] as a scalar",
    put: (r, s) => {
      pushTo(r, "contained", s);
    },
  },
  ...(
    [
      ["subject", (s: string): JsonObject => ({ subject: s })],
      ["performer[]", (s: string): JsonObject => ({ performer: [s] })],
      ["code", (s: string): JsonObject => ({ code: s })],
      ["valueQuantity", (s: string): JsonObject => ({ valueQuantity: s })],
      ["effectivePeriod", (s: string): JsonObject => ({ effectivePeriod: s })],
      ["component", (s: string): JsonObject => ({ component: s })],
      ["category as one concept", (s: string): JsonObject => ({ category: { text: s } })],
      ["status as a list", (s: string): JsonObject => ({ status: [s] })],
    ] as const
  ).map(([where, fields]) => ({
    where: `contained Observation ${where}`,
    put: (r: JsonObject, s: string) => {
      pushTo(r, "contained", { resourceType: "Observation", status: "final", ...fields(s) });
    },
  })),
  {
    where: "contained Patient generalPractitioner[] as a scalar",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Patient", generalPractitioner: [s] });
    },
  },
  {
    where: "contained Encounter participant[0].individual as a scalar",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "Encounter",
        status: "finished",
        participant: [{ individual: s }],
      });
    },
  },
  {
    where: "contained Provenance agent as a scalar",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Provenance", recorded: "2024", agent: s });
    },
  },
  {
    where: "contained Provenance agent[0].who as a scalar",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Provenance", recorded: "2024", agent: [{ who: s }] });
    },
  },
  {
    where: "contained AuditEvent agent[0].who as a scalar",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "AuditEvent",
        recorded: "2024-01-15T08:00:00Z",
        agent: [{ requestor: true, who: s }],
      });
    },
  },
  {
    where: "contained Device owner as a scalar",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Device", owner: s });
    },
  },
  {
    where: "contained Bundle entry[0].resource as a scalar",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "Bundle",
        type: "collection",
        entry: [{ resource: s }],
      });
    },
  },
  {
    where: "contained Bundle entry[0].resource of a type R4 does not define",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "Bundle",
        type: "collection",
        entry: [{ resource: { resourceType: s, language: "en" } }],
      });
    },
  },
  {
    where: "contained[] whose type is the sentinel",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: s, id: "zzt" });
    },
  },
  {
    where: "contained[] of a type R4 does not define, its base fields",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "ZzThing", implicitRules: s, language: s });
    },
  },
  {
    where: "contained[] with no type",
    put: (r, s) => {
      pushTo(r, "contained", { id: "zzn", implicitRules: s, meta: { source: s } });
    },
  }, // A string where R4 puts a boolean, an integer or a decimal.
  {
    where: "meta.tag[0].userSelected as a string",
    put: (r, s) => (r["meta"] = { tag: [{ code: "t", userSelected: s }] }),
  },
  ...(
    [
      ["valueBoolean", (s: string): JsonObject => ({ valueBoolean: s })],
      ["valueInteger", (s: string): JsonObject => ({ valueInteger: s })],
      ["valueQuantity.value", (s: string): JsonObject => ({ valueQuantity: { value: s } })],
      ["valueRange.low.value", (s: string): JsonObject => ({ valueRange: { low: { value: s } } })],
      [
        "component[0].valueBoolean",
        (s: string): JsonObject => ({ component: [{ code: { text: "zz" }, valueBoolean: s }] }),
      ],
      [
        "component[0].valueInteger",
        (s: string): JsonObject => ({ component: [{ code: { text: "zz" }, valueInteger: s }] }),
      ],
    ] as const
  ).map(([where, fields]) => ({
    where: `contained Observation ${where} as a string`,
    put: (r: JsonObject, s: string) => {
      pushTo(r, "contained", { resourceType: "Observation", status: "final", ...fields(s) });
    },
  })),
  ...(["valueBoolean", "valueInteger", "valueDecimal"] as const).map((key) => ({
    where: `contained QuestionnaireResponse item[0].answer[0].${key} as a string`,
    put: (r: JsonObject, s: string) => {
      pushTo(r, "contained", {
        resourceType: "QuestionnaireResponse",
        status: "completed",
        item: [{ linkId: "1", answer: [{ [key]: s }] }],
      });
    },
  })),
  {
    where: "contained Parameters parameter[0].valueBoolean as a string",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "Parameters",
        parameter: [{ name: "a", valueBoolean: s }],
      });
    },
  },
  {
    where: "contained Bundle total as a string",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Bundle", type: "searchset", total: s });
    },
  },
  {
    where: "contained Patient active as a string",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Patient", active: s });
    },
  },
  {
    where: "contained AuditEvent agent[0].requestor as a string",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "AuditEvent",
        recorded: "2024-01-15T08:00:00Z",
        agent: [{ requestor: s }],
      });
    },
  },
  // A number where R4 puts a string.
  {
    where: "meta.versionId as a number",
    put: (r, s) => (r["meta"] = { versionId: numericSentinel(s) }),
    text: numericText,
  },
  {
    where: "meta.tag[0].display as a number",
    put: (r, s) => (r["meta"] = { tag: [{ code: "t", display: numericSentinel(s) }] }),
    text: numericText,
  },
  ...(
    [
      ["valueString", (n: number): JsonObject => ({ valueString: n })],
      ["code.text", (n: number): JsonObject => ({ code: { text: n } })],
      [
        "component[0].valueString",
        (n: number): JsonObject => ({ component: [{ code: { text: "zz" }, valueString: n }] }),
      ],
    ] as const
  ).map(([where, fields]) => ({
    where: `contained Observation ${where} as a number`,
    put: (r: JsonObject, s: string) => {
      pushTo(r, "contained", {
        resourceType: "Observation",
        status: "final",
        ...fields(numericSentinel(s)),
      });
    },
    text: numericText,
  })),
  {
    where: "contained QuestionnaireResponse item[0].answer[0].valueString as a number",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "QuestionnaireResponse",
        status: "completed",
        item: [{ linkId: "1", answer: [{ valueString: numericSentinel(s) }] }],
      });
    },
    text: numericText,
  },
  {
    where: "contained Encounter reasonCode[0].text as a number",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "Encounter",
        status: "finished",
        reasonCode: [{ text: numericSentinel(s) }],
      });
    },
    text: numericText,
  },
  {
    where: "contained Patient name[0].family as a number",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Patient", name: [{ family: numericSentinel(s) }] });
    },
    text: numericText,
  },
  {
    where: "contained Device deviceName[0].name as a number",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "Device",
        deviceName: [{ name: numericSentinel(s), type: "user-friendly-name" }],
      });
    },
    text: numericText,
  },
  // The sentinel as a key R4 does not define, which no row may repeat.
  { where: "the sentinel as a top-level key", put: (r, s) => (r[s] = "zz") },
  {
    where: "the sentinel as a key in meta.tag[0]",
    put: (r, s) => (r["meta"] = { tag: [{ code: "t", [s]: true }] }),
  },
  {
    where: "the sentinel as a key in an extension",
    put: (r, s) => {
      pushTo(r, "extension", { url: "http://example.org/zz", [s]: "zz" });
    },
  },
  {
    where: "the sentinel as a key in a contained resource",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Basic", code: { text: "zz" }, [s]: { zz: "zz" } });
    },
  },
];

/** A contained `Observation` holding one value, for a position every generated type can carry. */
function containedObservation(r: JsonObject, fields: JsonObject): void {
  pushTo(r, "contained", { resourceType: "Observation", status: "final", ...fields });
}

/**
 * Each place a primitive can arrive in a form that does not fit the format R4 defines for its type
 * (or, for a code R4 binds, required, to a value set it defines, outside that set), with the
 * sentinel in it: on the resource's own `meta`, `text` and extensions, which every generated type
 * carries, and in a contained resource, at every kind R4 constrains. Each is blocked whole, so the
 * sentinel is held to the stricter rule. `text` gives the form the sentinel takes in the input when
 * it is not the sentinel itself.
 */
const FORMAT_SPOTS: readonly {
  readonly where: string;
  readonly put: (resource: JsonObject, sentinel: string) => void;
  readonly text?: (sentinel: string) => string;
}[] = [
  { where: "meta.versionId (id)", put: (r, s) => (r["meta"] = { versionId: `${s} ${s}` }) },
  { where: "meta.lastUpdated (instant)", put: (r, s) => (r["meta"] = { lastUpdated: s }) },
  { where: "meta.source (uri)", put: (r, s) => (r["meta"] = { source: `urn:${s} zz` }) },
  {
    where: "meta.profile[1] (canonical)",
    put: (r, s) => (r["meta"] = { profile: ["http://example.org/zz", `http://example.org/ ${s}`] }),
  },
  {
    where: "meta.tag[0].code (code)",
    put: (r, s) => (r["meta"] = { tag: [{ system: "http://example.org/t", code: ` ${s}` }] }),
  },
  {
    where: "meta.security[0].system (uri)",
    put: (r, s) => (r["meta"] = { security: [{ system: `${s} zz`, code: "zz" }] }),
  },
  {
    where: "text.status (required code)",
    put: (r, s) =>
      (r["text"] = { status: s, div: '<div xmlns="http://www.w3.org/1999/xhtml">zz</div>' }),
  },
  { where: "implicitRules (uri)", put: (r, s) => (r["implicitRules"] = `${s} zz`) },
  {
    where: "extension[].url (uri)",
    put: (r, s) => {
      pushTo(r, "extension", { url: `http://example.org/${s} zz`, valueBoolean: true });
    },
  },
  {
    where: "a nested extension url (uri)",
    put: (r, s) => {
      pushTo(r, "extension", { url: "http://example.org/zz", extension: [{ url: `${s} zz` }] });
    },
  },
  {
    where: "contained Observation.status (required code)",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Observation", status: s });
    },
  },
  {
    where: "contained Encounter.status (required code)",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Encounter", status: s, class: { code: "zz" } });
    },
  },
  {
    where: "contained Observation.effectiveDateTime (dateTime)",
    put: (r, s) => {
      containedObservation(r, { effectiveDateTime: s });
    },
  },
  {
    where: "contained Observation.issued (instant)",
    put: (r, s) => {
      containedObservation(r, { issued: `${s}-01-01` });
    },
  },
  {
    where: "contained Observation.component[0].valueTime (time, choice)",
    put: (r, s) => {
      containedObservation(r, { component: [{ code: { text: "zz" }, valueTime: s }] });
    },
  },
  {
    where: "contained Observation.valueInteger (integer range)",
    put: (r, s) => {
      containedObservation(r, { valueInteger: numericSentinel(s) });
    },
    text: numericText,
  },
  {
    where: "contained Observation.effectiveTiming.repeat.count (positiveInt range)",
    put: (r, s) => {
      containedObservation(r, { effectiveTiming: { repeat: { count: numericSentinel(s) } } });
    },
    text: numericText,
  },
  {
    where: "contained Observation.valueSampledData.data",
    put: (r, s) => {
      containedObservation(r, {
        valueSampledData: { origin: { value: 0 }, period: 1, dimensions: 1, data: `1 ${s} 2` },
      });
    },
  },
  {
    where: "contained Observation.valueQuantity.comparator (required code)",
    put: (r, s) => {
      containedObservation(r, { valueQuantity: { value: 1, comparator: s } });
    },
  },
  {
    where: "contained Observation.code.coding[0].code (code)",
    put: (r, s) => {
      containedObservation(r, {
        code: { coding: [{ system: "http://example.org/zz", code: `${s}  zz` }] },
      });
    },
  },
  {
    where: "contained DocumentReference attachment.data (base64Binary)",
    put: (r, s) => {
      pushTo(r, "contained", {
        resourceType: "DocumentReference",
        status: "current",
        content: [{ attachment: { data: `${s}!` } }],
      });
    },
  },
  {
    where: "contained Device.udiCarrier[0].issuer (uri)",
    put: (r, s) => {
      pushTo(r, "contained", { resourceType: "Device", udiCarrier: [{ issuer: `${s} zz` }] });
    },
  },
];

const formatArb: fc.Arbitrary<number> = fc.nat({ max: FORMAT_SPOTS.length - 1 });

/** A made-up note naming the sentinel, in valid base64: what an embedded document looks like. */
function embeddedNote(sentinel: string): string {
  return Buffer.from(`<note>Patient ${sentinel}</note>`).toString("base64");
}

/** Push a contained resource of the given type and fields. */
function containedOf(r: JsonObject, resourceType: string, fields: JsonObject): void {
  pushTo(r, "contained", { resourceType, ...fields });
}

/**
 * Each place embedded content can sit, with a sentinel in it: in a contained resource (which every
 * generated type can carry), in an extension and in the narrative. Each is removed by default, so the
 * sentinel is held to the stricter rule. `text` gives what must not come back when it is not the
 * sentinel itself (the base64 of the note naming it).
 */
const EMBEDDED_SPOTS: readonly {
  readonly where: string;
  readonly put: (resource: JsonObject, sentinel: string) => void;
  readonly text?: (sentinel: string) => string;
}[] = [
  {
    where: "contained DocumentReference attachment.data",
    put: (r, s) => {
      containedOf(r, "DocumentReference", {
        status: "current",
        content: [{ attachment: { contentType: "text/plain", data: embeddedNote(s) } }],
      });
    },
    text: embeddedNote,
  },
  {
    where: "contained DocumentReference attachment.url (link)",
    put: (r, s) => {
      containedOf(r, "DocumentReference", {
        status: "current",
        content: [{ attachment: { url: `http://example.org/fhir/Binary/${s}` } }],
      });
    },
  },
  {
    where: "contained DocumentReference attachment.url (data: url)",
    put: (r, s) => {
      containedOf(r, "DocumentReference", {
        status: "current",
        content: [{ attachment: { url: `data:text/plain;base64,${embeddedNote(s)}` } }],
      });
    },
    text: embeddedNote,
  },
  {
    where: "contained DocumentReference attachment.hash",
    put: (r, s) => {
      containedOf(r, "DocumentReference", {
        status: "current",
        content: [{ attachment: { hash: embeddedNote(s) } }],
      });
    },
    text: embeddedNote,
  },
  {
    where: "contained Media content.data",
    put: (r, s) => {
      containedOf(r, "Media", { status: "completed", content: { data: embeddedNote(s) } });
    },
    text: embeddedNote,
  },
  {
    where: "contained DiagnosticReport presentedForm[0].data",
    put: (r, s) => {
      containedOf(r, "DiagnosticReport", {
        status: "final",
        code: { text: "zz" },
        presentedForm: [{ data: embeddedNote(s) }],
      });
    },
    text: embeddedNote,
  },
  {
    where: "contained QuestionnaireResponse answer valueAttachment.data",
    put: (r, s) => {
      containedOf(r, "QuestionnaireResponse", {
        status: "completed",
        item: [{ linkId: "1", answer: [{ valueAttachment: { data: embeddedNote(s) } }] }],
      });
    },
    text: embeddedNote,
  },
  {
    where: "contained Binary.data",
    put: (r, s) => {
      containedOf(r, "Binary", { contentType: "text/plain", data: embeddedNote(s) });
    },
    text: embeddedNote,
  },
  {
    where: "contained Provenance signature[0].data",
    put: (r, s) => {
      containedOf(r, "Provenance", {
        target: [{ reference: "#zz" }],
        recorded: "2020-01-01T00:00:00Z",
        agent: [{ who: { display: "zz" } }],
        signature: [
          {
            type: [{ system: "urn:iso-astm:E1762-95:2013", code: "1.2.840.10065.1.12.1.1" }],
            when: "2020-01-01T00:00:00Z",
            who: { display: "zz" },
            data: embeddedNote(s),
          },
        ],
      });
    },
    text: embeddedNote,
  },
  {
    where: "contained Device udiCarrier[0].carrierAIDC",
    put: (r, s) => {
      containedOf(r, "Device", { udiCarrier: [{ carrierAIDC: embeddedNote(s) }] });
    },
    text: embeddedNote,
  },
  {
    where: "contained AuditEvent entity[0].query",
    put: (r, s) => {
      containedOf(r, "AuditEvent", {
        type: { code: "zz" },
        recorded: "2020-01-01T00:00:00Z",
        agent: [{ requestor: true }],
        source: { observer: { display: "zz" } },
        entity: [{ query: embeddedNote(s) }],
      });
    },
    text: embeddedNote,
  },
  {
    where: "extension[].valueBase64Binary",
    put: (r, s) => {
      pushTo(r, "extension", { url: "http://example.org/zz", valueBase64Binary: embeddedNote(s) });
    },
    text: embeddedNote,
  },
  {
    where: "extension[].valueAttachment.data",
    put: (r, s) => {
      pushTo(r, "extension", {
        url: "http://example.org/zz",
        valueAttachment: { data: embeddedNote(s) },
      });
    },
    text: embeddedNote,
  },
  {
    where: "text.div",
    put: (r, s) =>
      (r["text"] = {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml">${s}</div>`,
      }),
  },
];

const embeddedArb: fc.Arbitrary<number> = fc.nat({ max: EMBEDDED_SPOTS.length - 1 });

/** Write one sentinel, inside embedded content, into the resource. */
function placeEmbedded(resource: JsonObject, spot: number, sentinel: string): FormatPlaced {
  const at = EMBEDDED_SPOTS[spot % EMBEDDED_SPOTS.length];
  if (at === undefined) throw new Error("no embedded spot");
  at.put(resource, sentinel);
  return { where: at.where, sentinel: at.text?.(sentinel) ?? sentinel };
}

/**
 * The stricter rule for embedded content: what it held is gone from the output and from the
 * manifest. Being named as a residual is not enough, because it is removed by default.
 */
export function embeddedKept(placed: readonly FormatPlaced[], outcome: PassOutcome): string[] {
  const violations: string[] = [];
  const manifest = JSON.stringify(outcome.manifest);
  for (const p of placed) {
    const label = `${p.sentinel} (embedded content at ${p.where})`;
    if (outcome.output.includes(p.sentinel)) violations.push(`${label} survives in the output`);
    if (manifest.includes(p.sentinel)) violations.push(`${label} is in the manifest`);
  }
  return violations;
}

/** A sentinel in a primitive that does not fit its type, as placed: where, and what must not come back. */
interface FormatPlaced {
  readonly where: string;
  readonly sentinel: string;
}

/** Write one sentinel, in a form its type does not admit, into the resource. */
function placeFormat(resource: JsonObject, spot: number, sentinel: string): FormatPlaced {
  const at = FORMAT_SPOTS[spot % FORMAT_SPOTS.length];
  if (at === undefined) throw new Error("no format spot");
  at.put(resource, sentinel);
  return { where: at.where, sentinel: at.text?.(sentinel) ?? sentinel };
}

/**
 * The stricter rule for a primitive that does not fit the format R4 defines for its type: the
 * sentinel is gone from the output and from the manifest. Being named as a residual is not enough.
 */
export function formatKept(placed: readonly FormatPlaced[], outcome: PassOutcome): string[] {
  const violations: string[] = [];
  const manifest = JSON.stringify(outcome.manifest);
  for (const p of placed) {
    const label = `${p.sentinel} (a value that does not fit its type at ${p.where})`;
    if (outcome.output.includes(p.sentinel)) violations.push(`${label} survives in the output`);
    if (manifest.includes(p.sentinel)) violations.push(`${label} is in the manifest`);
  }
  return violations;
}

/** A backbone element R4 defines on each generated resource type: its key and an ordinary item. */
const BACKBONES: Readonly<Record<string, readonly [string, JsonObject]>> = {
  Patient: ["communication", { language: { text: "zz" } }],
  RelatedPerson: ["communication", { language: { text: "zz" } }],
  Practitioner: ["qualification", { code: { text: "zz" } }],
  Person: ["link", { target: { reference: "Patient/zz1" } }],
  Observation: ["component", { code: { text: "zz" } }],
  Encounter: ["statusHistory", { status: "planned" }],
  Condition: ["stage", { summary: { text: "zz" } }],
  Organization: ["contact", { purpose: { text: "zz" } }],
  Location: ["hoursOfOperation", { allDay: true }],
  Coverage: ["class", { value: "zz" }],
  Claim: ["supportingInfo", { sequence: 1 }],
  DiagnosticReport: ["media", { link: { reference: "Media/zz1" } }],
  Device: ["deviceName", { name: "zz pump", type: "user-friendly-name" }],
  Provenance: ["agent", { who: { reference: "Device/zz1" } }],
  AuditEvent: ["entity", { what: { reference: "Device/zz1" } }],
  Endpoint: ["contact", { system: "url" }],
};

/** A `Reference` R4 defines: its key, the structure it sits in, and how a string is put there. */
interface ReferenceSpot {
  readonly key: string;
  readonly in: string;
  readonly put: (r: JsonObject, s: string) => void;
}

/**
 * An element R4 types as a `Reference` on each generated resource type, each putting the sentinel
 * there as a bare string: a repeating element as a list of one string, one in a backbone as an item.
 */
const REFERENCES: Readonly<Record<string, ReferenceSpot>> = {
  Patient: {
    key: "generalPractitioner",
    in: "Patient",
    put: (r, s) => (r["generalPractitioner"] = [s]),
  },
  RelatedPerson: { key: "patient", in: "RelatedPerson", put: (r, s) => (r["patient"] = s) },
  Practitioner: {
    key: "issuer",
    in: "Practitioner.qualification",
    put: (r, s) => {
      pushTo(r, "qualification", { code: { text: "zz" }, issuer: s });
    },
  },
  Person: {
    key: "managingOrganization",
    in: "Person",
    put: (r, s) => (r["managingOrganization"] = s),
  },
  Observation: { key: "subject", in: "Observation", put: (r, s) => (r["subject"] = s) },
  Encounter: { key: "subject", in: "Encounter", put: (r, s) => (r["subject"] = s) },
  Condition: { key: "subject", in: "Condition", put: (r, s) => (r["subject"] = s) },
  Organization: { key: "partOf", in: "Organization", put: (r, s) => (r["partOf"] = s) },
  Location: {
    key: "managingOrganization",
    in: "Location",
    put: (r, s) => (r["managingOrganization"] = s),
  },
  Coverage: { key: "beneficiary", in: "Coverage", put: (r, s) => (r["beneficiary"] = s) },
  Claim: { key: "patient", in: "Claim", put: (r, s) => (r["patient"] = s) },
  DiagnosticReport: { key: "subject", in: "DiagnosticReport", put: (r, s) => (r["subject"] = s) },
  Device: { key: "owner", in: "Device", put: (r, s) => (r["owner"] = s) },
  Provenance: { key: "target", in: "Provenance", put: (r, s) => (r["target"] = [s]) },
  AuditEvent: {
    key: "who",
    in: "AuditEvent.agent",
    put: (r, s) => {
      pushTo(r, "agent", { requestor: true, who: s });
    },
  },
  Endpoint: {
    key: "managingOrganization",
    in: "Endpoint",
    put: (r, s) => (r["managingOrganization"] = s),
  },
};

/**
 * A number standing for a sentinel, for a position where the sentinel is placed as a JSON number: twelve
 * digits read from the sentinel's own characters, so two sentinels of a case give two numbers.
 */
export function numericSentinel(sentinel: string): number {
  let hash = 2166136261;
  for (const ch of sentinel) hash = Math.imul(hash ^ (ch.codePointAt(0) ?? 0), 16777619) >>> 0;
  return 800_000_000_000 + (hash % 100_000_000_000);
}

/** {@link numericSentinel} as the text it is written as. */
function numericText(sentinel: string): string {
  return String(numericSentinel(sentinel));
}

const unknownKeyArb: fc.Arbitrary<number> = fc.nat({ max: UNKNOWN_KEY_SPOTS.length - 1 });

/** A sentinel under an unknown key as placed: where, and the sentinel that must not come back. */
interface UnknownKeyPlaced {
  readonly where: string;
  readonly sentinel: string;
}

/** Write one sentinel under an unknown key into the resource. */
function placeUnknownKey(resource: JsonObject, spot: number, sentinel: string): UnknownKeyPlaced {
  const at = UNKNOWN_KEY_SPOTS[spot % UNKNOWN_KEY_SPOTS.length];
  if (at === undefined) throw new Error("no unknown key spot");
  at.put(resource, sentinel);
  return { where: at.where, sentinel: at.text?.(sentinel) ?? sentinel };
}

/**
 * The stricter rule for a key R4 does not define: the sentinel is gone from the output and from the
 * manifest. Being named as a residual is not enough.
 */
export function unknownKeyKept(
  placed: readonly UnknownKeyPlaced[],
  outcome: PassOutcome,
): string[] {
  const violations: string[] = [];
  const manifest = JSON.stringify(outcome.manifest);
  for (const p of placed) {
    const label = `${p.sentinel} (unknown key at ${p.where})`;
    if (outcome.output.includes(p.sentinel)) violations.push(`${label} survives in the output`);
    if (manifest.includes(p.sentinel)) violations.push(`${label} is in the manifest`);
  }
  return violations;
}

/** An element id as placed: where, and the sentinel that must not come back. */
interface ElementIdPlaced {
  readonly where: string;
  readonly sentinel: string;
}

/** Write one sentinel element id into the resource. */
function placeElementId(resource: JsonObject, spot: number, sentinel: string): ElementIdPlaced {
  const at = ELEMENT_ID_SPOTS[spot % ELEMENT_ID_SPOTS.length];
  if (at === undefined) throw new Error("no element id spot");
  at.put(resource, sentinel);
  return { where: at.where, sentinel };
}

/** The stricter rule for an element id: the sentinel is gone from the output and from the manifest. */
export function elementIdKept(placed: readonly ElementIdPlaced[], outcome: PassOutcome): string[] {
  const violations: string[] = [];
  const manifest = JSON.stringify(outcome.manifest);
  for (const p of placed) {
    const label = `${p.sentinel} (element id at ${p.where})`;
    if (outcome.output.includes(p.sentinel)) violations.push(`${label} survives in the output`);
    if (manifest.includes(p.sentinel)) violations.push(`${label} is in the manifest`);
  }
  return violations;
}

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
  elementIds: fc.array(elementIdArb, { maxLength: 2 }),
  unknownKeys: fc.array(unknownKeyArb, { maxLength: 2 }),
  formats: fc.array(formatArb, { maxLength: 2 }),
  embedded: fc.array(embeddedArb, { maxLength: 2 }),
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
  elementIds?: readonly number[];
  unknownKeys?: readonly number[];
  formats?: readonly number[];
  embedded?: readonly number[];
}): {
  raw: string;
  placed: Placement[];
  siblings: SiblingPlaced[];
  elementIds: ElementIdPlaced[];
  unknownKeys: UnknownKeyPlaced[];
  formats: FormatPlaced[];
  embedded: FormatPlaced[];
} {
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
  const idOffset = offset + siblings.length;
  const elementIds = (value.elementIds ?? []).map((spot, i) => {
    const placedId = placeElementId(resource, spot, sentinelAt(value.stem, idOffset + i));
    return { ...placedId, where: `${value.type}.${placedId.where}` };
  });
  const keyOffset = idOffset + elementIds.length;
  const unknownKeys = (value.unknownKeys ?? []).map((spot, i) => {
    const placedKey = placeUnknownKey(resource, spot, sentinelAt(value.stem, keyOffset + i));
    return { ...placedKey, where: `${value.type}.${placedKey.where}` };
  });
  const formatOffset = keyOffset + unknownKeys.length;
  const formats = (value.formats ?? []).map((spot, i) => {
    const placedFormat = placeFormat(resource, spot, sentinelAt(value.stem, formatOffset + i));
    return { ...placedFormat, where: `${value.type}.${placedFormat.where}` };
  });
  const embeddedOffset = formatOffset + formats.length;
  const embedded = (value.embedded ?? []).map((spot, i) => {
    const placedEmbedded = placeEmbedded(
      resource,
      spot,
      sentinelAt(value.stem, embeddedOffset + i),
    );
    return { ...placedEmbedded, where: `${value.type}.${placedEmbedded.where}` };
  });
  const doc: JsonObject = value.inBundle
    ? { resourceType: "Bundle", type: "collection", entry: [{ resource }] }
    : resource;
  return {
    raw: JSON.stringify(doc),
    placed,
    siblings,
    elementIds,
    unknownKeys,
    formats,
    embedded,
  };
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
    elementIds?: readonly number[];
    unknownKeys?: readonly number[];
    formats?: readonly number[];
    embedded?: readonly number[];
  },
  tally: LeakTally,
  options: FhirDeidOptions = {},
): string[] {
  const { raw, placed, siblings, elementIds, unknownKeys, formats, embedded } = build(value);
  // A `_`-sibling the input does not hold (a later write replaced it) is not swept.
  const held = siblings.filter((s) => s.text === undefined || raw.includes(s.text));
  // Likewise an element id a later write replaced.
  const ids = elementIds.filter((p) => raw.includes(p.sentinel));
  // Likewise a sentinel under an unknown key.
  const keys = unknownKeys.filter((p) => raw.includes(p.sentinel));
  // Likewise a sentinel in a primitive that does not fit its type.
  const misfits = formats.filter((p) => raw.includes(p.sentinel));
  // Likewise a sentinel in embedded content.
  const contents = embedded.filter((p) => raw.includes(p.sentinel));
  // Non-vacuity: only a sentinel the input holds is swept, and a case must hold one. A later
  // placement can overwrite an earlier one at the same position.
  const present = placed.filter((p) => raw.includes(p.sentinel));
  if (
    present.length === 0 &&
    held.length === 0 &&
    ids.length === 0 &&
    keys.length === 0 &&
    misfits.length === 0 &&
    contents.length === 0
  ) {
    return ["no sentinel reached the input"];
  }
  const outcome = pass(raw, options);
  return [
    ...sweep(present, outcome, tally),
    ...unknownExtensionKeyKept(present, outcome),
    ...siblingTextKept(held, outcome),
    ...elementIdKept(ids, outcome),
    ...unknownKeyKept(keys, outcome),
    ...formatKept(misfits, outcome),
    ...embeddedKept(contents, outcome),
  ];
}

/**
 * The stricter rule for a sentinel under a key R4 does not define, on an extension or on a datatype
 * (an extra component), or inside a kept address part that is not a string: it is gone from the
 * output. Being named as a residual is not enough there, because such a key is blocked whatever it
 * holds and so is a part of that shape.
 */
export function unknownExtensionKeyKept(
  placed: readonly Placement[],
  outcome: PassOutcome,
): string[] {
  return placed
    .filter(
      (p) =>
        p.shape === "extra-component" ||
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
  elementIds: fc.array(elementIdArb, { maxLength: 2 }),
  unknownKeys: fc.array(unknownKeyArb, { maxLength: 2 }),
  formats: fc.array(formatArb, { maxLength: 2 }),
  embedded: fc.array(embeddedArb, { maxLength: 2 }),
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

/**
 * Each place an element `id` can sit, on a person and on a clinical resource, alone and in a Bundle
 * entry, with the patient-animal option off and on, through the same check as a generated case, so
 * every one is run on every pull request whatever the seed draws.
 */
describe("the FHIR sweep removes a sentinel written as an element id", () => {
  const spots = ELEMENT_ID_SPOTS.map((spot, i) => [spot.where, i] as const);

  it.each(spots)("%s", (_where, spot) => {
    for (const type of ["Patient", "Observation"]) {
      for (const inBundle of [false, true]) {
        for (const keepPatientAnimal of [false, true]) {
          const value = {
            type,
            inBundle,
            filler: "abc",
            stem: "ZQLKELID",
            placements: [],
            elementIds: [spot],
          };
          expect(checkCase(value, newTally(), { keepPatientAnimal })).toEqual([]);
        }
      }
    }
  });

  it("the case holds what it placed: the sentinel is in the input", () => {
    for (const [, spot] of spots) {
      const { raw, elementIds } = build({
        type: "Observation",
        inBundle: false,
        filler: "abc",
        stem: "ZQLKELID",
        placements: [],
        elementIds: [spot],
      });
      expect(elementIds).toHaveLength(1);
      expect(raw).toContain(elementIds[0]?.sentinel);
    }
  });

  it("the stricter rule has teeth: an element id in the output or the manifest is caught", () => {
    const placed: ElementIdPlaced[] = [{ where: "Observation.code.id", sentinel: "ZQLKTEETH02X" }];
    const clean: PassOutcome = {
      output: '{"resourceType":"Observation","code":{"id":"1"}}',
      manifest: [],
      unexaminedResiduals: [],
      residualAt: () => true,
      refused: false,
    };
    expect(elementIdKept(placed, clean)).toEqual([]);
    expect(elementIdKept(placed, { ...clean, output: '{"code":{"id":"ZQLKTEETH02X"}}' })).toEqual([
      "ZQLKTEETH02X (element id at Observation.code.id) survives in the output",
    ]);
    expect(elementIdKept(placed, { ...clean, manifest: [{ locus: "ZQLKTEETH02X" }] })).toEqual([
      "ZQLKTEETH02X (element id at Observation.code.id) is in the manifest",
    ]);
  });
});

/**
 * Each kind of position a key R4 does not define can sit at, on a person, a clinical and two
 * infrastructure resources, alone and in a Bundle entry, through the same check as a generated case,
 * so every one is run on every pull request whatever the seed draws. So is every extra component the
 * generated placements use.
 */
describe("the FHIR sweep removes a sentinel under a key R4 does not define", () => {
  const types = ["Patient", "Observation", "Device", "Provenance"];
  const spots = UNKNOWN_KEY_SPOTS.map((spot, i) => [spot.where, i] as const);

  it.each(spots)("%s", (_where, spot) => {
    for (const type of types) {
      for (const inBundle of [false, true]) {
        const value = {
          type,
          inBundle,
          filler: "abc",
          stem: "ZQLKUKEY",
          placements: [],
          unknownKeys: [spot],
        };
        expect(checkCase(value, newTally())).toEqual([]);
      }
    }
  });

  it.each(EXTRA_PATHS.map((path) => [path.join(".")] as const))("extra component %s", (where) => {
    const extra = EXTRA_PATHS.find((path) => path.join(".") === where) ?? [];
    for (const type of types) {
      const placement: FhirPlacement = {
        shape: "extra-component",
        element: "name",
        code: ["status"],
        extra,
        nest: 0,
      };
      const value = {
        type,
        inBundle: false,
        filler: "abc",
        stem: "ZQLKXTRA",
        placements: [placement],
      };
      expect(checkCase(value, newTally())).toEqual([]);
    }
  });

  it("the case holds what it placed: the sentinel is in the input", () => {
    for (const [, spot] of spots) {
      for (const type of types) {
        const { raw, unknownKeys } = build({
          type,
          inBundle: false,
          filler: "abc",
          stem: "ZQLKUKEY",
          placements: [],
          unknownKeys: [spot],
        });
        expect(unknownKeys).toHaveLength(1);
        expect(raw).toContain(unknownKeys[0]?.sentinel);
      }
    }
  });

  it("each Reference spot names an element R4 types as a Reference, on every generated type", () => {
    for (const [type, ref] of Object.entries(REFERENCES)) {
      expect(fhirElementsOf(ref.in).get(ref.key), type).toBe("Reference");
    }
    for (const type of RESOURCE_TYPES) expect(REFERENCES[type], type).toBeDefined();
  });

  it("the stricter rule has teeth: a sentinel under an unknown key in the output or the manifest is caught", () => {
    const placed: UnknownKeyPlaced[] = [{ where: "Observation.zzTop", sentinel: "ZQLKTEETH03X" }];
    const clean: PassOutcome = {
      output: '{"resourceType":"Observation"}',
      manifest: [],
      unexaminedResiduals: [],
      residualAt: () => true,
      refused: false,
    };
    expect(unknownKeyKept(placed, clean)).toEqual([]);
    expect(unknownKeyKept(placed, { ...clean, output: '{"zzTop":"ZQLKTEETH03X"}' })).toEqual([
      "ZQLKTEETH03X (unknown key at Observation.zzTop) survives in the output",
    ]);
    expect(unknownKeyKept(placed, { ...clean, manifest: [{ locus: "ZQLKTEETH03X" }] })).toEqual([
      "ZQLKTEETH03X (unknown key at Observation.zzTop) is in the manifest",
    ]);
    const extra: Placement[] = [
      { sentinel: "ZQLKTEETH04X", shape: "extra-component", where: "Observation.code.label" },
    ];
    expect(
      unknownExtensionKeyKept(extra, { ...clean, output: '{"code":{"label":"ZQLKTEETH04X"}}' }),
    ).toHaveLength(1);
  });
});

/**
 * Each place a primitive can arrive in a form that does not fit the format R4 defines for its type,
 * on a person, a clinical and two infrastructure resources, alone and in a Bundle entry, with
 * `keepPatientAnimal` off and on, through the same check as a generated case, so every one is run on
 * every pull request whatever the seed draws.
 */
describe("the FHIR sweep removes a sentinel in a primitive that does not fit its type", () => {
  const types = ["Patient", "Observation", "Device", "Provenance"];
  const spots = FORMAT_SPOTS.map((spot, i) => [spot.where, i] as const);

  it.each(spots)("%s", (_where, spot) => {
    for (const type of types) {
      for (const inBundle of [false, true]) {
        for (const keepPatientAnimal of [false, true]) {
          const value = {
            type,
            inBundle,
            filler: "abc",
            stem: "ZQLKFRMT",
            placements: [],
            formats: [spot],
          };
          expect(checkCase(value, newTally(), { keepPatientAnimal })).toEqual([]);
        }
      }
    }
  });

  it("the case holds what it placed: the sentinel is in the input", () => {
    for (const [, spot] of spots) {
      const { raw, formats } = build({
        type: "Observation",
        inBundle: false,
        filler: "abc",
        stem: "ZQLKFRMT",
        placements: [],
        formats: [spot],
      });
      expect(formats).toHaveLength(1);
      expect(raw).toContain(formats[0]?.sentinel);
    }
  });

  it("the stricter rule has teeth: a misfit in the output or the manifest is caught", () => {
    const placed: FormatPlaced[] = [{ where: "Observation.issued", sentinel: "ZQLKTEETH05X" }];
    const clean: PassOutcome = {
      output: '{"resourceType":"Observation"}',
      manifest: [],
      unexaminedResiduals: [],
      residualAt: () => true,
      refused: false,
    };
    expect(formatKept(placed, clean)).toEqual([]);
    expect(formatKept(placed, { ...clean, output: '{"issued":"ZQLKTEETH05X"}' })).toEqual([
      "ZQLKTEETH05X (a value that does not fit its type at Observation.issued) survives in the output",
    ]);
    expect(formatKept(placed, { ...clean, manifest: [{ locus: "ZQLKTEETH05X" }] })).toEqual([
      "ZQLKTEETH05X (a value that does not fit its type at Observation.issued) is in the manifest",
    ]);
  });
});

/**
 * Each place embedded content can sit, on a person, a clinical and two infrastructure resources,
 * alone and in a Bundle entry, with `keepPatientAnimal` off and on, through the same check as a
 * generated case, so every one is run on every pull request whatever the seed draws.
 */
describe("the FHIR sweep removes a sentinel in embedded content the pass does not read", () => {
  const types = ["Patient", "Observation", "Device", "Provenance"];
  const spots = EMBEDDED_SPOTS.map((spot, i) => [spot.where, i] as const);

  it.each(spots)("%s", (_where, spot) => {
    for (const type of types) {
      for (const inBundle of [false, true]) {
        for (const keepPatientAnimal of [false, true]) {
          const value = {
            type,
            inBundle,
            filler: "abc",
            stem: "ZQLKEMBD",
            placements: [],
            embedded: [spot],
          };
          expect(checkCase(value, newTally(), { keepPatientAnimal })).toEqual([]);
        }
      }
    }
  });

  it("the case holds what it placed: the content is in the input", () => {
    for (const [, spot] of spots) {
      const { raw, embedded } = build({
        type: "Observation",
        inBundle: false,
        filler: "abc",
        stem: "ZQLKEMBD",
        placements: [],
        embedded: [spot],
      });
      expect(embedded).toHaveLength(1);
      expect(raw).toContain(embedded[0]?.sentinel);
    }
  });

  it("the stricter rule has teeth: content in the output or the manifest is caught", () => {
    const placed: FormatPlaced[] = [{ where: "Binary.data", sentinel: "ZQLKTEETH06X" }];
    const clean: PassOutcome = {
      output: '{"resourceType":"Binary"}',
      manifest: [],
      unexaminedResiduals: [],
      residualAt: () => true,
      refused: false,
    };
    expect(embeddedKept(placed, clean)).toEqual([]);
    expect(embeddedKept(placed, { ...clean, output: '{"data":"ZQLKTEETH06X"}' })).toEqual([
      "ZQLKTEETH06X (embedded content at Binary.data) survives in the output",
    ]);
    expect(embeddedKept(placed, { ...clean, manifest: [{ locus: "ZQLKTEETH06X" }] })).toEqual([
      "ZQLKTEETH06X (embedded content at Binary.data) is in the manifest",
    ]);
  });
});
