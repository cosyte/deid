/**
 * A key R4 does not define where it sits is text a sender chose, so a name or an identifier placed in
 * one would leave the pass intact. It is blocked at any depth of any resource or datatype, with a
 * manifest row at its own locus that carries no value, under every profile and with every option at
 * its default. So is a structure where R4 puts a primitive. An extension on a primitive's
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
import { fhirElementsOf, fhirResourceStructure } from "../../src/fhir/element-names.js";

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

  it("every key of a structure where R4 puts a primitive is blocked", () => {
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
    expect(loci).toContain("Observation.status.zz");
    expect(loci).toContain("Observation.code.text.zz");
    expect(loci).toContain("Observation.identifier[0].use[0].zz");
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

  it("a resource of a type R4 does not define keeps only what every resource carries", () => {
    const { json, manifest } = run({
      resourceType: "ZzThing",
      id: "t1",
      status: "ZZSTATUS",
      language: "en",
    });
    expect(json).not.toContain("ZZSTATUS");
    expect(json).toContain('"language":"en"');
    expect(manifest.map((m) => m.locus)).toContain("ZzThing.status");
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

  it("reads a resource type R4 defines as itself, and anything else as a bare resource", () => {
    expect(fhirResourceStructure("Patient")).toBe("Patient");
    expect(fhirResourceStructure("Bundle")).toBe("Bundle");
    for (const odd of [undefined, "ZzThing", "Coding", "Observation.component", "toString"]) {
      expect(fhirResourceStructure(odd)).toBe("DomainResource");
    }
  });
});
