/**
 * A key R4 does not define where it sits is text a sender chose, so a name or an identifier placed in
 * one would leave the pass intact. It is blocked at any depth of any resource or datatype, with a
 * manifest row at its own locus that carries no value, under every profile and with every option at
 * its default. So is a value of a shape R4 does not define where it sits (a scalar where a structure
 * belongs, a structure where a primitive belongs, a list where one value belongs and the reverse),
 * and a resource whose type is missing or not one R4 defines, whole. An extension on a primitive's
 * `_`-sibling that the output does not carry gets a row of its own too.
 *
 * Every value here is synthetic (`ZZ` tokens, example.org urls).
 */

import { describe, expect, it } from "vitest";
import { parseResource } from "@cosyte/fhir";

import {
  createDeidContext,
  LIMITED_DATA_SET_PROFILE,
  profileOptions,
  SAFE_HARBOR_PROFILE,
} from "../../src/index.js";
import { deidentifyFhirJson, extractFhirLoci } from "../../src/fhir/index.js";
import {
  fhirElementsOf,
  fhirRepeatingElementsOf,
  fhirResourceStructure,
} from "../../src/fhir/element-names.js";

const ctx = createDeidContext({ key: "unknown-keys-synthetic-hmac", patientId: "p" });

function run(resource: unknown, options = {}) {
  return deidentifyFhirJson(JSON.stringify(resource), { context: ctx, ...options });
}

/** The manifest row at a locus, which must exist. */
function rowAt(manifest: readonly { locus: string }[], locus: string) {
  const row = manifest.find((m) => m.locus === locus);
  expect(row, `no row at ${locus}`).toBeDefined();
  return row;
}

describe("a key R4 does not define is blocked at any depth", () => {
  it("in a Coding on a clinical resource: removed, a value-free blocked row at its locus", () => {
    const { json, manifest, unexaminedResiduals } = run({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "2951-2", zzNote: "ZZCODINGNOTE" }] },
    });
    expect(json).not.toContain("ZZCODINGNOTE");
    expect(json).not.toContain("zzNote");
    expect(json).toContain('"code":"2951-2"');
    const row = rowAt(manifest, "Observation.code.coding[0].zzNote");
    expect(row).toMatchObject({ disposition: "blocked" });
    expect(JSON.stringify(manifest)).not.toContain("ZZCODINGNOTE");
    expect(unexaminedResiduals.map((r) => r.locus)).not.toContain(
      "Observation.code.coding[0].zzNote",
    );
  });

  it("at the top level, in a backbone, in a datatype and in a structure it holds, whole", () => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: "final",
      zzTop: "ZZTOP",
      zzObject: { who: "ZZOBJ", list: ["ZZLIST"] },
      component: [{ code: { text: "zz part" }, zzPart: "ZZPART" }],
      valueQuantity: { value: 1, unit: "mg", zzUnitNote: "ZZQTY" },
      subject: { reference: "Patient/zz1", zzName: "ZZREF" },
      meta: { versionId: "1", zzOwner: "ZZMETA" },
    });
    for (const s of ["ZZTOP", "ZZOBJ", "ZZLIST", "ZZPART", "ZZQTY", "ZZREF", "ZZMETA"]) {
      expect(json).not.toContain(s);
    }
    for (const locus of [
      "Observation.zzTop",
      "Observation.zzObject",
      "Observation.component[0].zzPart",
      "Observation.valueQuantity.zzUnitNote",
      "Observation.subject.zzName",
      "Observation.meta.zzOwner",
    ]) {
      expect(rowAt(manifest, locus)).toMatchObject({ disposition: "blocked" });
    }
    // what R4 defines beside them is kept as before
    expect(json).toContain('"text":"zz part"');
    expect(json).toContain('"unit":"mg"');
    expect(json).toContain('"versionId":"1"');
    // one row for a key holding a structure, none below it
    expect(manifest.filter((m) => m.locus.startsWith("Observation.zzObject"))).toHaveLength(1);
  });

  it("on a person resource, below its top level, and in an infrastructure resource", () => {
    const { json, manifest } = run({
      resourceType: "Bundle",
      type: "collection",
      zzBundleNote: "ZZBUNDLE",
      entry: [
        {
          zzEntryNote: "ZZENTRY",
          request: { method: "POST", url: "Patient", zzRequestNote: "ZZREQUEST" },
          resource: {
            resourceType: "Patient",
            gender: "female",
            communication: [{ language: { text: "zz" }, zzNote: "ZZCOMM" }],
            maritalStatus: { coding: [{ code: "M", zzNote: "ZZMARITAL" }] },
          },
        },
        {
          resource: {
            resourceType: "Device",
            status: "active",
            deviceName: [{ name: "zz pump", type: "user-friendly-name", zzNote: "ZZDEVICE" }],
          },
        },
        {
          resource: {
            resourceType: "Provenance",
            recorded: "2024-01-15T08:00:00Z",
            agent: [{ who: { reference: "Device/zz1" }, zzNote: "ZZAGENT" }],
          },
        },
      ],
    });
    for (const s of [
      "ZZBUNDLE",
      "ZZENTRY",
      "ZZREQUEST",
      "ZZCOMM",
      "ZZMARITAL",
      "ZZDEVICE",
      "ZZAGENT",
    ]) {
      expect(json).not.toContain(s);
    }
    const loci = manifest.map((m) => m.locus);
    expect(loci).toContain("Bundle.zzBundleNote");
    expect(loci).toContain("Bundle.entry[0].zzEntryNote");
    expect(loci).toContain("Bundle.entry[0].request.zzRequestNote");
    expect(loci).toContain("Bundle.entry[0].resource.communication[0].zzNote");
    expect(loci).toContain("Bundle.entry[0].resource.maritalStatus.coding[0].zzNote");
    expect(loci).toContain("Bundle.entry[1].resource.deviceName[0].zzNote");
    expect(loci).toContain("Bundle.entry[2].resource.agent[0].zzNote");
    expect(json).toContain('"name":"zz pump"');
  });

  it("in a contained resource, read by its own type", () => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: "final",
      contained: [{ resourceType: "Organization", id: "o1", name: "zz org", zzNote: "ZZCONT" }],
    });
    expect(json).not.toContain("ZZCONT");
    expect(json).toContain('"name":"zz org"');
    expect(rowAt(manifest, "Observation.contained[0].zzNote")).toMatchObject({
      disposition: "blocked",
    });
  });

  it("a structure where R4 puts a primitive is blocked, whatever it holds", () => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: { zz: "ZZSTATUSOBJ" },
      category: [{ text: "zz" }],
      code: { text: { zz: "ZZTEXTOBJ" } },
      identifier: [{ system: "urn:oid:2.25.7", value: "zz1", use: [{ zz: "ZZUSELIST" }] }],
    });
    expect(json).not.toContain("ZZSTATUSOBJ");
    expect(json).not.toContain("ZZTEXTOBJ");
    expect(json).not.toContain("ZZUSELIST");
    const loci = manifest.map((m) => m.locus);
    expect(loci).toContain("Observation.status");
    expect(loci).toContain("Observation.code.text");
    expect(loci).toContain("Observation.identifier[0].use");
  });

  it("a string at a person resource's top level is still read by the person sweep", () => {
    // Each key here is one R4 defines, so the person sweep decides it as before: a string where R4
    // puts a structure (`period`, `link`), a gender outside its value set and a language that is not
    // a language tag are removed; a gender and a language tag in their sets are kept.
    const related = run({ resourceType: "RelatedPerson", period: "ZZPERIODTEXT" });
    expect(related.json).not.toContain("ZZPERIODTEXT");
    expect(related.manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "RelatedPerson.period blocked",
    ]);
    const patient = run({
      resourceType: "Patient",
      link: "ZZLINKTEXT",
      gender: "zzgender",
      language: "Zzsmith",
    });
    expect(patient.manifest.map((m) => m.locus)).toEqual([
      "Patient.link",
      "Patient.gender",
      "Patient.language",
    ]);
    const kept = run({ resourceType: "Patient", gender: "female", language: "en-US" });
    expect(kept.json).toBe('{"resourceType":"Patient","gender":"female","language":"en-US"}');
    expect(kept.manifest).toEqual([]);
  });

  it("an unknown key in an address is named, and gone", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      address: [{ state: "MA", postalCode: "02139", zzNote: "ZZADDRNOTE" }],
    });
    expect(json).not.toContain("ZZADDRNOTE");
    expect(json).toContain('"state":"MA"');
    expect(manifest.map((m) => m.locus)).toEqual(["Patient.address", "Patient.address.zzNote"]);

    // Two addresses are located by their index; what an Address defines is not named.
    const two = run({
      resourceType: "Patient",
      address: [
        { city: "ZZCITY", state: "MA", postalCode: "02139" },
        { country: "US", zzNote: "ZZADDRNOTE2" },
      ],
    });
    expect(two.json).not.toContain("ZZADDRNOTE2");
    expect(two.manifest.map((m) => m.locus)).toEqual([
      "Patient.address[0]",
      "Patient.address[1]",
      "Patient.address[1].zzNote",
    ]);
  });

  it("an Address with an unknown key on a resource that is not a person's goes whole", () => {
    // The datatype sweep reads only an Address closed to its own keys, so this one is blocked whole.
    const { json, manifest } = run({
      resourceType: "Organization",
      address: [{ city: "ZZCITY", state: "MA", zzNote: "ZZSWEPTNOTE" }],
    });
    expect(json).not.toContain("ZZSWEPTNOTE");
    expect(json).not.toContain("ZZCITY");
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Organization.address blocked",
    ]);
  });

  it("is blocked where the walk meets it, in document order", () => {
    const { manifest } = run({
      resourceType: "Patient",
      zzFirst: "ZZFIRST",
      name: [{ family: "ZZFAMILY" }],
      zzSecond: "ZZSECOND",
      birthDate: "1980-04-02",
    });
    expect(manifest.map((m) => m.locus)).toEqual([
      "Patient.zzFirst",
      "Patient.name",
      "Patient.zzSecond",
      "Patient.birthDate",
    ]);
  });

  it("adds no row below an element the pass removes, whose own row covers it", () => {
    const { manifest } = run({
      resourceType: "Patient",
      name: [{ family: "ZZFAMILY", zzNote: "ZZNAMENOTE" }],
      telecom: [{ value: "zz", zzNote: { deep: "ZZTELNOTE" } }],
    });
    expect(manifest.map((m) => m.locus)).toEqual(["Patient.name", "Patient.telecom"]);
  });

  it("a resourceType where no resource sits is a key like any other", () => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ resourceType: "Basic", code: "x" }] },
    });
    expect(json).not.toContain("Basic");
    expect(manifest.map((m) => m.locus)).toEqual(["Observation.code.coding[0].resourceType"]);
  });

  it("an extension and a modifier extension keep their own rule: the url stays, no extra row", () => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: "final",
      extension: [{ url: "http://example.org/e", valueBoolean: true }],
      modifierExtension: [{ url: "http://example.org/m", valueBoolean: true }],
      component: [{ code: { text: "zz" }, modifierExtension: [{ url: "http://example.org/c" }] }],
    });
    expect(json).toContain('"url":"http://example.org/e"');
    expect(json).toContain('"url":"http://example.org/m"');
    expect(json).toContain('"url":"http://example.org/c"');
    expect(manifest.map((m) => m.locus)).toEqual([
      "Observation.extension[0].valueBoolean",
      "Observation.modifierExtension[0].valueBoolean",
    ]);
  });

  it("is blocked under every profile, Limited Data Set included", () => {
    for (const profile of [SAFE_HARBOR_PROFILE, LIMITED_DATA_SET_PROFILE]) {
      const { json } = deidentifyFhirJson(
        JSON.stringify({
          resourceType: "Observation",
          status: "final",
          code: { coding: [{ code: "x", zzNote: "ZZPROFILE" }] },
        }),
        profileOptions(profile, ctx),
      );
      expect(json).not.toContain("ZZPROFILE");
    }
  });

  it("an element R4 defines is kept: ordinary codes, values and choice elements", () => {
    const doc = {
      resourceType: "Observation",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "2951-2", display: "Sodium" }] },
      valueQuantity: { value: 140, unit: "mmol/L", system: "http://unitsofmeasure.org" },
      interpretation: [{ coding: [{ code: "N" }] }],
      referenceRange: [{ low: { value: 135 }, high: { value: 145 } }],
      component: [{ code: { text: "zz" }, valueCodeableConcept: { text: "zz" } }],
    };
    const { resource } = parseResource(JSON.stringify(doc));
    const { loci } = extractFhirLoci(resource);
    expect(loci).toEqual([]);
  });
});

/** Every profile a value must not survive under. */
const PROFILES = [SAFE_HARBOR_PROFILE, LIMITED_DATA_SET_PROFILE] as const;

/**
 * Run a document under every profile and hold it to the shape rule: the sentinel is gone from the
 * output and the manifest, and each locus has a blocked row.
 */
function expectBlocked(doc: unknown, sentinel: string, loci: readonly string[]): void {
  for (const profile of PROFILES) {
    const { json, manifest } = deidentifyFhirJson(
      JSON.stringify(doc),
      profileOptions(profile, ctx),
    );
    expect(json, `${sentinel} under ${profile.name}`).not.toContain(sentinel);
    expect(JSON.stringify(manifest)).not.toContain(sentinel);
    for (const locus of loci) {
      expect(rowAt(manifest, locus)).toMatchObject({ disposition: "blocked" });
    }
  }
}

describe("a value of a shape R4 does not define where it sits is blocked", () => {
  it.each([
    [
      "a string list where a Patient's general practitioner references belong",
      { resourceType: "Patient", gender: "female", generalPractitioner: ["ZZLEAKGP"] },
      "ZZLEAKGP",
      ["Patient.generalPractitioner[0]"],
    ],
    [
      "a string where an Observation's subject reference belongs",
      { resourceType: "Observation", status: "final", subject: "ZZLEAKSUBJ" },
      "ZZLEAKSUBJ",
      ["Observation.subject"],
    ],
    [
      "a string list where an Observation's performers belong",
      { resourceType: "Observation", status: "final", performer: ["ZZLEAKPERF"] },
      "ZZLEAKPERF",
      ["Observation.performer[0]"],
    ],
    [
      "a string where an Encounter participant's individual belongs",
      {
        resourceType: "Encounter",
        status: "finished",
        participant: [{ individual: "ZZLEAKIND" }],
      },
      "ZZLEAKIND",
      ["Encounter.participant[0].individual"],
    ],
    [
      "a string where a Provenance's agents belong",
      { resourceType: "Provenance", recorded: "2024-01-15T08:00:00Z", agent: "ZZLEAKAGENT" },
      "ZZLEAKAGENT",
      ["Provenance.agent"],
    ],
    [
      "a string where a Provenance agent's who belongs",
      {
        resourceType: "Provenance",
        recorded: "2024-01-15T08:00:00Z",
        agent: [{ who: "ZZLEAKWHO" }],
      },
      "ZZLEAKWHO",
      ["Provenance.agent[0].who"],
    ],
    [
      "a string where an AuditEvent agent's who belongs",
      {
        resourceType: "AuditEvent",
        recorded: "2024-01-15T08:00:00Z",
        agent: [{ requestor: true, who: "ZZLEAKAUDIT" }],
      },
      "ZZLEAKAUDIT",
      ["AuditEvent.agent[0].who"],
    ],
    [
      "a string where a Device's owner belongs",
      { resourceType: "Device", status: "active", owner: "ZZLEAKOWNER" },
      "ZZLEAKOWNER",
      ["Device.owner"],
    ],
    [
      "a string where a resource sits in a Bundle entry",
      { resourceType: "Bundle", type: "collection", entry: [{ resource: "ZZLEAKENTRY" }] },
      "ZZLEAKENTRY",
      ["Bundle.entry[0].resource"],
    ],
    [
      "a string where a contained resource sits",
      { resourceType: "Observation", status: "final", contained: ["ZZLEAKCONT"] },
      "ZZLEAKCONT",
      ["Observation.contained[0]"],
    ],
  ] as const)("%s", (_name, doc, sentinel, loci) => {
    expectBlocked(doc, sentinel, loci);
  });

  it("a string at every datatype and backbone position of a clinical resource", () => {
    for (const key of ["code", "meta", "component", "valueQuantity", "effectivePeriod", "text"]) {
      const sentinel = `ZZLEAK${key.toUpperCase()}`;
      expectBlocked({ resourceType: "Observation", status: "final", [key]: sentinel }, sentinel, [
        `Observation.${key}`,
      ]);
    }
  });

  it("a number and a boolean where a structure belongs, a null where a structure belongs", () => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: "final",
      subject: 1234567,
      code: true,
      valueQuantity: null,
    });
    expect(json).not.toContain("1234567");
    expect(json).not.toContain("true");
    expect(json).not.toContain("valueQuantity");
    for (const locus of ["Observation.subject", "Observation.code", "Observation.valueQuantity"]) {
      expect(rowAt(manifest, locus)).toMatchObject({ disposition: "blocked" });
    }
  });

  it("in a contained resource and in a resource a Bundle entry holds, below their top level", () => {
    expectBlocked(
      {
        resourceType: "Bundle",
        type: "collection",
        entry: [
          {
            resource: {
              resourceType: "Observation",
              status: "final",
              contained: [
                { resourceType: "Patient", gender: "male", generalPractitioner: ["ZZLEAKDEEP"] },
              ],
              performer: [{ reference: "Practitioner/zz1" }, "ZZLEAKDEEP"],
            },
          },
        ],
      },
      "ZZLEAKDEEP",
      [
        "Bundle.entry[0].resource.contained[0].generalPractitioner[0]",
        "Bundle.entry[0].resource.performer[1]",
      ],
    );
  });

  it("a structure where R4 puts a primitive is blocked whole, one row", () => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: { zz: "ZZSTATUSOBJ" },
      issued: { family: "ZZFAMILY", given: ["ZZGIVEN"] },
      code: { coding: [{ code: [{ text: "ZZCODELIST" }] }] },
    });
    for (const s of ["ZZSTATUSOBJ", "ZZFAMILY", "ZZGIVEN", "ZZCODELIST"]) {
      expect(json).not.toContain(s);
    }
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Observation.status blocked",
      "Observation.issued blocked",
      "Observation.code.coding[0].code blocked",
    ]);
  });

  it("a list where R4 puts a single value is blocked whole", () => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: ["ZZSTATUSLIST"],
      code: [{ text: "zz" }],
      meta: { versionId: ["ZZVERSION"], tag: [{ code: "t" }] },
    });
    expect(json).not.toContain("ZZSTATUSLIST");
    expect(json).not.toContain("ZZVERSION");
    expect(json).not.toContain('"code":[');
    expect(json).toContain('"tag":[{"code":"t"}]');
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Observation.status blocked",
      "Observation.code blocked",
      "Observation.meta.versionId blocked",
    ]);
  });

  it("a single value where R4 puts a list is blocked whole", () => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: "final",
      code: { text: "zz" },
      category: { coding: [{ code: "ZZCATEGORY" }] },
      meta: { tag: { code: "ZZTAG" } },
    });
    expect(json).not.toContain("ZZCATEGORY");
    expect(json).not.toContain("ZZTAG");
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Observation.category blocked",
      "Observation.meta.tag blocked",
    ]);
  });

  it("a null where R4 does not allow one is blocked; one padding a repeating primitive is not", () => {
    const blocked = run({ resourceType: "Observation", status: null, code: { text: "zz" } });
    expect(blocked.manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Observation.status blocked",
    ]);
    const padded = run({
      resourceType: "Organization",
      alias: [null, "zz alias"],
      _alias: [{ id: "a0" }, null],
    });
    expect(padded.manifest.map((m) => m.locus)).not.toContain("Organization.alias[0]");
  });

  it("an array inside an array is blocked, where a primitive or a structure belongs", () => {
    const { json, manifest } = run({
      resourceType: "Organization",
      alias: ["zz alias", ["ZZNESTEDALIAS"]],
      partOf: { reference: "Organization/zz1" },
      endpoint: [{ reference: "Endpoint/zz1" }, ["ZZNESTEDREF"]],
    });
    expect(json).not.toContain("ZZNESTED");
    expect(json).toContain('"alias":["zz alias"]');
    // The references' ids are replaced as every resource id is; the nested arrays are blocked.
    const blocked = manifest.filter((m) => m.disposition === "blocked");
    expect(blocked.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Organization.alias[1] blocked",
      "Organization.endpoint[1] blocked",
    ]);
  });

  it("a list item of a shape R4 does not define is blocked before any rule reads it", () => {
    // A date-shaped string where a Reference belongs is not a date to generalize: it goes whole.
    const { json, manifest } = run({
      resourceType: "Observation",
      status: "final",
      code: { text: "zz" },
      performer: ["2020-03-04"],
    });
    expect(json).not.toContain("2020");
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Observation.performer[0] blocked",
    ]);
  });

  it("the shapes R4 defines are kept as they arrive", () => {
    const doc = {
      resourceType: "Observation",
      status: "final",
      category: [{ coding: [{ system: "http://example.org/c", code: "laboratory" }] }],
      code: { coding: [{ system: "http://loinc.org", code: "2951-2" }] },
      subject: { reference: "Patient/zz1" },
      performer: [{ reference: "Practitioner/zz1" }],
      meta: { versionId: "1", tag: [{ code: "t" }] },
      valueQuantity: { value: 140, unit: "mmol/L" },
    };
    const { json, manifest } = run(doc);
    expect(manifest.map((m) => m.locus)).not.toContain("Observation.category");
    expect(manifest.map((m) => m.locus)).not.toContain("Observation.meta.tag");
    expect(json).toContain('"versionId":"1"');
    expect(json).toContain('"code":"laboratory"');
  });
});

describe("a value of a shape R4 defines still reaches its own rule", () => {
  it("a single Identifier where R4 puts one, in a Reference: its value is removed", () => {
    const { json, manifest } = run({
      resourceType: "Observation",
      status: "final",
      code: { text: "zz" },
      subject: { identifier: { system: "http://example.org/mrn", value: "ZZSUBJECTMRN" } },
    });
    expect(json).not.toContain("ZZSUBJECTMRN");
    expect(json).toContain('"system":"http://example.org/mrn"');
    expect(manifest.map((m) => m.locus)).toEqual(["Observation.subject.identifier.value"]);
  });

  it("a `reference` R4 writes as a list of References is walked item by item", () => {
    const { json, manifest } = run({
      resourceType: "Contract",
      term: [
        {
          offer: {
            party: [{ reference: [{ reference: "Patient/ZZPARTYA" }, { display: "ZZPARTYB" }] }],
          },
        },
      ],
    });
    expect(json).not.toContain("ZZPARTYA");
    expect(json).not.toContain("ZZPARTYB");
    expect(json).toContain('"reference":"Patient/1"');
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Contract.term[0].offer.party[0].reference[0].reference transformed",
      "Contract.term[0].offer.party[0].reference[1].display blocked",
    ]);
  });

  it("a string at a person resource's top level that R4 types as a string the pass cannot check", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      implicitRules: "ZZRULES",
      active: "ZZACTIVE",
    });
    expect(json).toBe('{"resourceType":"Patient"}');
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual([
      "Patient.implicitRules blocked",
      "Patient.active blocked",
    ]);
  });
});

describe("a resource whose type R4 does not define is removed whole", () => {
  it("at the root: nothing of it is written, one blocked row that names no type", () => {
    for (const profile of PROFILES) {
      const { json, manifest } = deidentifyFhirJson(
        JSON.stringify({
          resourceType: "ZZLEAKTYPE",
          implicitRules: "ZZLEAKRULES",
          language: "ZZLEAKLANG",
          meta: { source: "ZZLEAKSOURCE" },
        }),
        profileOptions(profile, ctx),
      );
      expect(json).toBe("{}");
      expect(JSON.stringify(manifest)).not.toContain("ZZLEAK");
      expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual(["<withheld> blocked"]);
    }
  });

  it("an abstract type and a datatype's name are not a resource type either", () => {
    for (const type of ["Resource", "DomainResource", "Coding", "Observation.component"]) {
      const { json } = run({ resourceType: type, language: "ZZLEAKLANG" });
      expect(json).toBe("{}");
    }
  });

  it("with no resourceType at all", () => {
    const { json, manifest } = run({ id: "zz1", implicitRules: "ZZLEAKRULES" });
    expect(json).toBe("{}");
    expect(manifest.map((m) => `${m.locus} ${m.disposition}`)).toEqual(["<withheld> blocked"]);
  });

  it("when contained or in a Bundle entry: blocked at its own locus", () => {
    expectBlocked(
      {
        resourceType: "Bundle",
        type: "collection",
        entry: [
          { resource: { resourceType: "ZZLEAKENTRYTYPE", language: "en" } },
          {
            resource: {
              resourceType: "Observation",
              status: "final",
              contained: [
                { resourceType: "ZzThing", id: "c1", implicitRules: "ZZLEAKCONTRULES" },
                { id: "c2", language: "ZZLEAKNOTYPE" },
              ],
            },
          },
        ],
      },
      "ZZLEAK",
      [
        "Bundle.entry[0].resource",
        "Bundle.entry[1].resource.contained[0]",
        "Bundle.entry[1].resource.contained[1]",
      ],
    );
  });
});

describe("an extension on a primitive's `_`-sibling the output does not carry gets a row", () => {
  it("beside a code kept as it arrived, and beside a date the pass generalizes", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      gender: "female",
      _gender: { extension: [{ url: "http://example.org/g", valueString: "ZZGENDERX" }] },
      birthDate: "1980-04-02",
      _birthDate: {
        extension: [
          {
            url: "http://hl7.org/fhir/StructureDefinition/patient-birthTime",
            valueDateTime: "1980-04-02T10:15:00Z",
          },
        ],
      },
    });
    expect(json).not.toContain("ZZGENDERX");
    expect(json).not.toContain("birthTime");
    expect(rowAt(manifest, "Patient._gender.extension[0]")).toMatchObject({
      disposition: "blocked",
    });
    expect(rowAt(manifest, "Patient._birthDate.extension[0]")).toMatchObject({
      disposition: "blocked",
    });
  });

  it("on every item of a repeating primitive, and in an element id's sibling", () => {
    const { manifest } = run({
      resourceType: "Observation",
      status: "final",
      code: {
        id: "c1",
        _id: { extension: [{ url: "http://example.org/i" }] },
        text: "zz",
      },
      category: [
        { coding: [{ code: "laboratory", _code: { extension: [{ url: "u" }, { url: "v" }] } }] },
      ],
    });
    const loci = manifest.map((m) => m.locus);
    expect(loci).toContain("Observation.code._id.extension[0]");
    expect(loci).toContain("Observation.category[0].coding[0]._code.extension[0]");
    expect(loci).toContain("Observation.category[0].coding[0]._code.extension[1]");
  });

  it("no row beside a primitive the pass removes, whose own row covers it", () => {
    const { manifest } = run({
      resourceType: "Observation",
      status: "final",
      valueString: "ZZFREE",
      _valueString: { extension: [{ url: "http://example.org/v" }] },
    });
    const loci = manifest.map((m) => m.locus);
    expect(loci).toContain("Observation.valueString");
    expect(loci).not.toContain("Observation._valueString.extension[0]");
  });

  it("a kept address part's extension keeps its own rule, and no extra row", () => {
    const { json, manifest } = run({
      resourceType: "Patient",
      address: [
        {
          state: "MA",
          _state: { extension: [{ url: "http://example.org/s" }] },
          postalCode: "02139",
        },
      ],
    });
    expect(json).toContain('"url":"http://example.org/s"');
    expect(manifest.map((m) => m.locus)).not.toContain("Patient.address._state.extension[0]");
  });
});

describe("the R4 element table", () => {
  it("reads a resource, a datatype, a backbone, a reused definition and a choice element", () => {
    expect(fhirElementsOf("Observation")?.get("status")).toBeNull();
    expect(fhirElementsOf("Observation")?.get("code")).toBe("CodeableConcept");
    expect(fhirElementsOf("Observation")?.get("component")).toBe("Observation.component");
    expect(fhirElementsOf("Observation")?.get("valueQuantity")).toBe("Quantity");
    expect(fhirElementsOf("Observation")?.get("valueString")).toBeNull();
    expect(fhirElementsOf("Observation")?.get("value")).toBeUndefined();
    expect(fhirElementsOf("Observation")?.get("contained")).toBe("Resource");
    expect(fhirElementsOf("Observation")?.get("extension")).toBeNull();
    expect(fhirElementsOf("Coding")?.get("zzNote")).toBeUndefined();
    expect(fhirElementsOf("Coding")?.get("id")).toBeNull();
    expect(fhirElementsOf("Questionnaire.item")?.get("item")).toBe("Questionnaire.item");
    expect(fhirElementsOf("Timing")?.get("repeat")).toBe("Timing.repeat");
    expect(fhirElementsOf("Bundle")?.has("text")).toBe(false);
    for (const none of ["ZzThing", "toString", null]) expect(fhirElementsOf(none).size).toBe(0);
  });

  it("reads a resource type R4 defines as itself, and nothing else as a resource", () => {
    expect(fhirResourceStructure("Patient")).toBe("Patient");
    expect(fhirResourceStructure("Bundle")).toBe("Bundle");
    expect(fhirResourceStructure("Binary")).toBe("Binary");
    for (const odd of [
      undefined,
      "ZzThing",
      "Coding",
      "Observation.component",
      "toString",
      "Resource",
      "DomainResource",
    ]) {
      expect(fhirResourceStructure(odd)).toBeUndefined();
    }
  });

  it("reads which elements repeat, the base ones included", () => {
    const observation = fhirRepeatingElementsOf("Observation");
    for (const many of ["identifier", "category", "performer", "component", "contained"]) {
      expect(observation.has(many)).toBe(true);
    }
    for (const one of ["status", "code", "subject", "valueQuantity", "meta", "text", "id"]) {
      expect(observation.has(one)).toBe(false);
    }
    expect(fhirRepeatingElementsOf("HumanName").has("given")).toBe(true);
    expect(fhirRepeatingElementsOf("HumanName").has("family")).toBe(false);
    expect(fhirRepeatingElementsOf("Bundle.entry").has("link")).toBe(true);
    expect(fhirRepeatingElementsOf("Bundle.entry").has("resource")).toBe(false);
    expect(fhirRepeatingElementsOf("Meta").has("tag")).toBe(true);
    expect(fhirRepeatingElementsOf("Coding").has("extension")).toBe(true);
    for (const none of ["ZzThing", null]) expect(fhirRepeatingElementsOf(none).size).toBe(0);
  });
});
