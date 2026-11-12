/**
 * **FHIR R4: every child of an `Identifier` is ruled, its assigner's `display` included.**
 *
 * An `Identifier` carries more than its `value`: a `use`, a `type`, a `system`, a `period` and an
 * `assigner`, which is a `Reference` with its own `reference`, `type`, `identifier` and `display`. The
 * pass decides each of them by the rule it applies to the same datatype anywhere else in the resource:
 *
 * - the `assigner`'s `display` is free text a sender fills (usually an organization's name, but nothing
 *   stops a person's name or a record number sitting there), so it is removed as every
 *   `Reference.display` is, with a blocked row that carries no value;
 * - the `period` dates are reduced to the year, as every date is;
 * - the `assigner`'s `reference` has its logical id replaced, as every reference does;
 * - the `assigner`'s own `identifier` goes through the identifier rule in turn;
 * - the `use`, the `type`, the `system` and the `assigner`'s `type` are kept and counted as
 *   unexamined, as a code or a uri is, and a `Coding.display` in the `type` is kept by the coded-term
 *   rule.
 *
 * The walk below reads every element R4 types as an `Identifier`, on every resource and backbone
 * element, from the generated R4 table, and checks each child at each of them, alone, in a contained
 * resource and in a `Bundle` entry, under Safe Harbor and the Limited Data Set.
 *
 * It also pins one rule for empty elements: a structure the pass leaves with nothing in it is removed,
 * as an emptied list is, because R4 does not allow an element with neither a value nor children.
 *
 * Every value is synthetic and built here.
 */

import { describe, expect, it } from "vitest";

import {
  createDeidContext,
  DEID_DISPOSITION_CODES,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_PROFILE,
} from "../../src/index.js";
import { deidentifyFhirJson } from "../../src/fhir/index.js";
import {
  fhirElementsOf,
  fhirRepeatingElementsOf,
  fhirResourceStructure,
} from "../../src/fhir/element-names.js";
import { FHIR_ELEMENT_NAMES } from "../../src/fhir/generated/element-names.js";

const ctx = createDeidContext({ key: "fhir-identifier-children-synthetic-key", patientId: "p" });

const PROFILES = [SAFE_HARBOR_PROFILE, LIMITED_DATA_SET_PROFILE] as const;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

/** The text an assigner's `display` holds: made up, and found nowhere else in a document. */
const ASSIGNER_NAME = "ZZ Smalltown Assigner Clinic";

/** The text the assigner's own identifier's assigner holds, one level further down. */
const NESTED_ASSIGNER_NAME = "ZZ Nested Assigner Office";

/**
 * An `Identifier` with every child R4 defines on it but `id` and `extension` (which the element-id and
 * extension rules decide wherever they sit), and an `assigner` with every child R4 defines on a
 * `Reference` but those two. Each primitive holds a value found nowhere else in the document.
 */
function fullIdentifier(): JsonObject {
  return {
    use: "secondary",
    type: {
      coding: [
        {
          system: "http://example.org/zz-identifier-type",
          code: "ZZTYPECODE",
          display: "zz type display",
        },
      ],
      text: "zz type text",
    },
    system: "http://example.org/zz-identifier-system",
    value: "ZZIDVALUE01",
    period: { start: "2020-03-04", end: "2021-05-06" },
    assigner: {
      reference: "Organization/zzassignerorg",
      type: "http://hl7.org/fhir/StructureDefinition/Organization",
      identifier: {
        system: "http://example.org/zz-assigner-system",
        value: "ZZASSIGNERID1",
        assigner: { display: NESTED_ASSIGNER_NAME },
      },
      display: ASSIGNER_NAME,
    },
  };
}

/** Run the pass under a profile. */
function run(doc: Json, profile: (typeof PROFILES)[number]) {
  return deidentifyFhirJson(JSON.stringify(doc), profileOptions(profile, ctx));
}

/** Every primitive in a JSON value, as `[locus, text]`, written as the adapter writes a locus. */
function leaves(node: Json, path: string, out: [string, string][] = []): [string, string][] {
  if (Array.isArray(node)) {
    node.forEach((item, i) => leaves(item, `${path}[${String(i)}]`, out));
  } else if (node !== null && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) leaves(value, `${path}.${key}`, out);
  } else if (node !== null) {
    out.push([path, String(node)]);
  }
  return out;
}

/**
 * One element R4 types as an `Identifier`: the structure it is on (a resource, or a backbone element
 * under one) and its name.
 */
interface IdentifierPosition {
  readonly structure: string;
  readonly name: string;
}

/** Every element R4 types as an `Identifier` on a resource or a backbone element of one. */
const POSITIONS: readonly IdentifierPosition[] = Object.keys(FHIR_ELEMENT_NAMES).flatMap(
  (structure) => {
    const root = structure.split(".")[0];
    if (fhirResourceStructure(root) === undefined) return [];
    return [...fhirElementsOf(structure)]
      .filter(([, type]) => type === "Identifier")
      .map(([name]) => ({ structure, name }));
  },
);

/**
 * Build a resource holding one full `Identifier` at the position, two of them where R4 lets the
 * element repeat (so every locus carries its index), and return it with the locus of the full one.
 */
function placeAt(position: IdentifierPosition): { resource: JsonObject; at: string } {
  const [root, ...steps] = position.structure.split(".");
  if (root === undefined) throw new Error("no root");
  const resource: JsonObject = { resourceType: root };
  let node = resource;
  let structure = root;
  let at = root;
  for (const step of steps) {
    const child: JsonObject = {};
    const many = fhirRepeatingElementsOf(structure).has(step);
    node[step] = many ? [child] : child;
    at = many ? `${at}.${step}[0]` : `${at}.${step}`;
    node = child;
    structure = `${structure}.${step}`;
  }
  const many = fhirRepeatingElementsOf(position.structure).has(position.name);
  node[position.name] = many
    ? [fullIdentifier(), { system: "http://example.org/zz-other", value: "ZZSECONDID" }]
    : fullIdentifier();
  return { resource, at: many ? `${at}.${position.name}[0]` : `${at}.${position.name}` };
}

/** The three places a resource can sit: alone, contained in another, and as a `Bundle` entry. */
function wrappings(resource: JsonObject, at: string): readonly [string, JsonObject, string][] {
  const tail = at.slice(at.indexOf("."));
  return [
    ["alone", resource, at],
    [
      "contained",
      { resourceType: "Basic", code: { text: "zz" }, contained: [resource] },
      `Basic.contained[0]${tail}`,
    ],
    [
      "a Bundle entry",
      { resourceType: "Bundle", type: "collection", entry: [{ resource }] },
      `Bundle.entry[0].resource${tail}`,
    ],
  ];
}

/**
 * The children a rule keeps without counting them, by the locus's ending: a `Coding.display`, a coded
 * term the coded-term rule keeps on purpose.
 */
const KEPT_BY_RULE = [".type.coding[0].display"];

/**
 * The children kept as they arrived, by the locus's ending: the codes and uris (`use`, the `type`, a
 * `system`, the assigner's `type`), as a code or a uri is kept anywhere. Every other child (the
 * `value`, the `period` dates, the assigner's `reference`, `display` and its own identifier's `value`)
 * is one the rule for its datatype removes or changes.
 */
const KEPT_AS_ARRIVED = [
  ".use",
  ".type.coding[0].system",
  ".type.coding[0].code",
  ".type.text",
  ".system",
  ".assigner.type",
];

/** What one pass hands back that the check reads. */
interface Outcome {
  readonly json: string;
  readonly manifest: readonly { readonly locus: string }[];
  readonly unexaminedResiduals: readonly { readonly locus: string }[];
}

/**
 * What is wrong with one pass over an `Identifier` at `at`: a child left unruled (in the output, as it
 * arrived, and not counted as unexamined), a removed or transformed child with no row at its locus or
 * above it, or an assigner's name anywhere in the output, the manifest or the residuals.
 */
function problemsIn(outcome: Outcome, at: string, valueKept = false): string[] {
  const { json, manifest, unexaminedResiduals } = outcome;
  const residuals = new Set(unexaminedResiduals.map((r) => r.locus));
  const rows = manifest.map((m) => m.locus);
  const audit = JSON.stringify({ manifest, unexaminedResiduals });
  const problems: string[] = [];
  for (const name of [ASSIGNER_NAME, NESTED_ASSIGNER_NAME]) {
    if (json.includes(name)) problems.push(`${at}: an assigner's display survives in the output`);
    if (audit.includes(name)) problems.push(`${at}: an assigner's display is in the audit`);
  }
  for (const [locus, text] of leaves(fullIdentifier(), at)) {
    if (KEPT_BY_RULE.some((end) => locus.endsWith(end))) continue;
    if (json.includes(JSON.stringify(text))) {
      const keptValue = valueKept && locus === `${at}.value`;
      if (!keptValue && !KEPT_AS_ARRIVED.some((end) => locus.endsWith(end))) {
        problems.push(`${locus}: kept where the rule for its datatype changes it`);
      }
      if (!residuals.has(locus)) problems.push(`${locus}: kept and not counted as unexamined`);
      continue;
    }
    // Gone or changed: a row names its position, or one above it (an identifier list of one item
    // writes its row without the index).
    const covered = rows.some(
      (row) => locus.startsWith(row) || locus.replace(/\[0\](?=[^[]*$)/, "").startsWith(row),
    );
    if (!covered) problems.push(`${locus}: removed or changed with no row`);
  }
  return problems;
}

/** {@link problemsIn} for one real pass. */
function unruled(
  doc: JsonObject,
  at: string,
  profile: (typeof PROFILES)[number],
  valueKept = false,
): string[] {
  return problemsIn(run(doc, profile), at, valueKept);
}

describe("the probe the review ran: an identifier's assigner display", () => {
  it("does not come out unchanged under Safe Harbor or the Limited Data Set", () => {
    const doc = {
      resourceType: "Patient",
      identifier: [
        {
          system: "http://example.org/zz-mrn",
          value: "ZZMRN0001",
          assigner: { display: ASSIGNER_NAME },
        },
      ],
    };
    for (const profile of PROFILES) {
      const { json, manifest, unexaminedResiduals } = run(doc, profile);
      expect(json).not.toContain(ASSIGNER_NAME);
      expect(manifest).toContainEqual(
        expect.objectContaining({
          locus: "Patient.identifier[0].assigner.display",
          disposition: "blocked",
          code: DEID_DISPOSITION_CODES.DEID_LOCUS_BLOCKED,
        }),
      );
      expect(JSON.stringify(manifest)).not.toContain(ASSIGNER_NAME);
      expect(JSON.stringify(unexaminedResiduals)).not.toContain("assigner");
    }
  });

  it("is removed at every other place an identifier sits: a Reference, a nested assigner, a Device", () => {
    const docs: readonly [string, JsonObject][] = [
      [
        "Observation.subject.identifier.assigner.display",
        {
          resourceType: "Observation",
          status: "final",
          code: { text: "zz" },
          subject: {
            identifier: {
              system: "http://example.org/zz-mrn",
              assigner: { display: ASSIGNER_NAME },
            },
          },
        },
      ],
      [
        "Organization.identifier[0].assigner.identifier.assigner.display",
        {
          resourceType: "Organization",
          identifier: [
            {
              system: "http://example.org/zz-org",
              assigner: { identifier: { value: "zz1", assigner: { display: ASSIGNER_NAME } } },
            },
          ],
        },
      ],
      [
        "Device.identifier[0].assigner.display",
        {
          resourceType: "Device",
          identifier: [{ value: "ZZDEVSN01", assigner: { display: ASSIGNER_NAME } }],
        },
      ],
    ];
    for (const profile of PROFILES) {
      for (const [locus, doc] of docs) {
        const { json, manifest } = run(doc, profile);
        expect(json, locus).not.toContain(ASSIGNER_NAME);
        expect(manifest, locus).toContainEqual(
          expect.objectContaining({ locus, disposition: "blocked" }),
        );
        expect(JSON.stringify(manifest), locus).not.toContain(ASSIGNER_NAME);
      }
    }
  });

  it("the value is decided once, by the identifier rule, even when it looks like a date", () => {
    const doc = {
      resourceType: "Patient",
      identifier: [{ system: "http://example.org/zz-mrn", value: "2020-03-04", use: "official" }],
    };
    for (const profile of PROFILES) {
      const { json, manifest } = run(doc, profile);
      expect(json).not.toContain("2020-03-04");
      expect(manifest.map((m) => m.locus)).toEqual(["Patient.identifier.value"]);
    }
  });

  it("an extension holding an Identifier is removed whole, its assigner with it", () => {
    const doc = {
      resourceType: "Patient",
      extension: [
        {
          url: "http://example.org/zz-ext",
          valueIdentifier: { value: "ZZEXTID1", assigner: { display: ASSIGNER_NAME } },
        },
      ],
    };
    for (const profile of PROFILES) {
      const { json, manifest } = run(doc, profile);
      expect(json).not.toContain(ASSIGNER_NAME);
      expect(json).not.toContain("ZZEXTID1");
      expect(JSON.stringify(manifest)).not.toContain(ASSIGNER_NAME);
    }
  });
});

describe("every child of an Identifier is ruled, at every position R4 types as one", () => {
  it("the fixture fills every child R4 defines on an Identifier and on its assigner Reference", () => {
    const defined = (structure: string): string[] =>
      [...fhirElementsOf(structure).keys()].filter((n) => n !== "id" && n !== "extension").sort();
    const identifier = fullIdentifier();
    expect(Object.keys(identifier).sort()).toEqual(defined("Identifier"));
    expect(Object.keys(identifier["assigner"] as JsonObject).sort()).toEqual(defined("Reference"));
    expect(Object.keys(identifier["period"] as JsonObject).sort()).toEqual(defined("Period"));
    expect(Object.keys(identifier["type"] as JsonObject).sort()).toEqual(
      defined("CodeableConcept"),
    );
  });

  it("the walk reaches the positions it names: identifier, masterIdentifier, a backbone's, a value[x]", () => {
    const named = POSITIONS.map((p) => `${p.structure}.${p.name}`);
    expect(named.length).toBeGreaterThan(140);
    for (const expected of [
      "Patient.identifier",
      "DocumentReference.masterIdentifier",
      "Specimen.accessionIdentifier",
      "Encounter.hospitalization.preAdmissionIdentifier",
      "Task.input.valueIdentifier",
      "Claim.related.reference",
    ]) {
      expect(named).toContain(expected);
    }
  });

  for (const profile of PROFILES) {
    it(`under ${profile.name}`, () => {
      const problems: string[] = [];
      for (const position of POSITIONS) {
        const { resource, at } = placeAt(position);
        // The identifier rule reads an element named `identifier`; an Identifier R4 names otherwise
        // (`masterIdentifier`, `accessionIdentifier`, a `valueIdentifier`) keeps its `value` and
        // counts it as unexamined, and every other child is ruled the same way at both.
        const valueKept = position.name !== "identifier";
        for (const [, doc, locus] of wrappings(resource, at)) {
          problems.push(...unruled(doc, locus, profile, valueKept));
        }
      }
      expect(problems).toEqual([]);
    });
  }

  it("the check has teeth: a display kept, a child kept uncounted, or one removed silently, is caught", () => {
    const { resource, at } = placeAt({ structure: "Patient", name: "identifier" });
    const real = run(resource, SAFE_HARBOR_PROFILE);
    expect(problemsIn(real, at)).toEqual([]);
    const withDate = { ...real, json: `${real.json} "2020-03-04"` };
    expect(problemsIn(withDate, at)).toEqual([
      `${at}.period.start: kept where the rule for its datatype changes it`,
      `${at}.period.start: kept and not counted as unexamined`,
    ]);
    const withName = { ...real, json: `${real.json} ${ASSIGNER_NAME}` };
    expect(problemsIn(withName, at)).toContain(
      `${at}: an assigner's display survives in the output`,
    );
    const inAudit = { ...real, manifest: [...real.manifest, { locus: NESTED_ASSIGNER_NAME }] };
    expect(problemsIn(inAudit, at)).toContain(`${at}: an assigner's display is in the audit`);
    const uncounted = {
      ...real,
      unexaminedResiduals: real.unexaminedResiduals.filter((r) => !r.locus.endsWith(".use")),
    };
    expect(problemsIn(uncounted, at)).toEqual([`${at}.use: kept and not counted as unexamined`]);
    const silent = { ...real, manifest: real.manifest.filter((m) => !m.locus.includes("period")) };
    expect(problemsIn(silent, at)).toEqual([
      `${at}.period.start: removed or changed with no row`,
      `${at}.period.end: removed or changed with no row`,
    ]);
  });
});

describe("an element the pass empties is removed, not written as an empty object", () => {
  it("a udiCarrier whose only field was removed goes, and the list with it", () => {
    for (const profile of PROFILES) {
      const { json } = run(
        { resourceType: "Device", status: "active", udiCarrier: [{ deviceIdentifier: "ZZDI01" }] },
        profile,
      );
      expect(JSON.parse(json)).toEqual({ resourceType: "Device", status: "active" });
    }
  });

  it("an assigner whose only field was its display goes", () => {
    for (const profile of PROFILES) {
      const { json } = run(
        {
          resourceType: "Patient",
          identifier: [
            { system: "http://example.org/zz-mrn", assigner: { display: ASSIGNER_NAME } },
          ],
        },
        profile,
      );
      expect(JSON.parse(json)).toEqual({
        resourceType: "Patient",
        identifier: [{ system: "http://example.org/zz-mrn" }],
      });
    }
  });

  it("the output holds no empty object and no empty list anywhere", () => {
    const empty = /\{\}|\[\]/;
    for (const profile of PROFILES) {
      for (const position of POSITIONS.slice(0, 20)) {
        const { resource } = placeAt(position);
        expect(run(resource, profile).json).not.toMatch(empty);
      }
    }
  });
});
