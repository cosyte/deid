/**
 * **FHIR R4: a non-human patient, and the `keepPatientAnimal` option.**
 *
 * R4 records an animal patient's species, breed and gender status in the `patient-animal` extension,
 * three sub-extensions each carrying a `CodeableConcept`. Every extension value is blocked by default,
 * so those three go too. With `keepPatientAnimal: true` the coded value of exactly those three, under
 * exactly that URL on a `Patient`, is kept; everything else stays blocked, and a call without the
 * option returns the same bytes it always did.
 *
 * Every value is plainly fake and built here in the test: the codes come from a made-up system.
 */

import { describe, expect, it } from "vitest";

import { createDeidContext } from "../../src/index.js";
import {
  deidentifyFhirJson,
  FHIR_PATIENT_ANIMAL_URL,
  type FhirDeidOptions,
} from "../../src/fhir/index.js";

const ANIMAL_URL = "http://hl7.org/fhir/StructureDefinition/patient-animal";
const SYSTEM = "http://example.org/zz-synthetic-animal";

const ctx = createDeidContext({ key: "fhir-animal-patient-key", patientId: "animal-patient" });

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** One coded sub-extension of `patient-animal`, from the made-up code system. */
function part(url: string, code: string, display: string): Json {
  return { url, valueCodeableConcept: { coding: [{ system: SYSTEM, code, display }] } };
}

const SPECIES = part("species", "ZZSPC01", "ZZSYNTH CANINE");
const BREED = part("breed", "ZZBRD01", "ZZSYNTH BEAGLE");
const GENDER = part("genderStatus", "ZZGS01", "ZZSYNTH NEUTERED");

/** A synthetic dog: its own name, a microchip, and the animal extension with the given parts. */
function dog(extension: Json[]): string {
  return JSON.stringify({
    resourceType: "Patient",
    extension,
    identifier: [{ system: "urn:oid:2.25.999", value: "ZZCHIP000000001" }],
    name: [{ family: "ZZOWNERFAMILY", given: ["ZZPETNAME"] }],
    gender: "female",
    birthDate: "2020-03-15",
  });
}

/** The default dog: all three parts, under the real URL. */
const DOG = dog([{ url: ANIMAL_URL, extension: [SPECIES, BREED, GENDER] }]);

/** Run a document through the FHIR adapter. */
function run(raw: string, options: FhirDeidOptions = {}): ReturnType<typeof deidentifyFhirJson> {
  return deidentifyFhirJson(raw, { ...options, context: ctx });
}

/** The output's `extension`, parsed. */
function extensionOut(raw: string, options: FhirDeidOptions = {}): unknown {
  return (JSON.parse(run(raw, options).json) as { extension?: unknown }).extension;
}

/** The animal extension with only its URLs left: what the fail-closed rule leaves of it. */
const SKELETON = {
  url: ANIMAL_URL,
  extension: [{ url: "species" }, { url: "breed" }, { url: "genderStatus" }],
};

describe("off by default", () => {
  it("blocks the three values, as every extension value is blocked", () => {
    expect(extensionOut(DOG)).toEqual([SKELETON]);
    expect(extensionOut(DOG, { keepPatientAnimal: false })).toEqual([SKELETON]);
  });

  it("returns the same bytes with the option left out or set false", () => {
    const off = run(DOG);
    const asFalse = run(DOG, { keepPatientAnimal: false });
    expect(asFalse.json).toBe(off.json);
    expect(asFalse.manifest).toEqual(off.manifest);
    expect(asFalse.unexaminedResiduals).toEqual(off.unexaminedResiduals);
    expect(off.json).toBe(
      `{"resourceType":"Patient","extension":[${JSON.stringify(SKELETON)}],` +
        `"identifier":[{"system":"urn:oid:2.25.999"}],"gender":"female","birthDate":"2020"}`,
    );
  });
});

describe("keepPatientAnimal: true", () => {
  it("exports the URL it matches", () => {
    expect(FHIR_PATIENT_ANIMAL_URL).toBe(ANIMAL_URL);
  });

  it("keeps each part of a Coding R4 defines", () => {
    const coding = {
      system: SYSTEM,
      version: "ZZV1",
      code: "ZZSPC01",
      display: "ZZSYNTH CANINE",
      userSelected: true,
    };
    const species = { url: "species", valueCodeableConcept: { coding: [coding] } };
    expect(
      extensionOut(dog([{ url: ANIMAL_URL, extension: [species] }]), { keepPatientAnimal: true }),
    ).toEqual([{ url: ANIMAL_URL, extension: [species] }]);
  });

  it("keeps the coded species, breed and gender status", () => {
    expect(extensionOut(DOG, { keepPatientAnimal: true })).toEqual([
      { url: ANIMAL_URL, extension: [SPECIES, BREED, GENDER] },
    ]);
  });

  it("changes nothing else in the resource", () => {
    const on = JSON.parse(run(DOG, { keepPatientAnimal: true }).json) as Record<string, unknown>;
    const off = JSON.parse(run(DOG).json) as Record<string, unknown>;
    expect({ ...on, extension: undefined }).toEqual({ ...off, extension: undefined });
  });

  it("records nothing for a kept code, and counts each as an unexamined residual", () => {
    const { manifest, unexaminedResiduals } = run(DOG, { keepPatientAnimal: true });
    expect(manifest.some((row) => row.locus.includes("valueCodeableConcept"))).toBe(false);
    const loci = unexaminedResiduals.map((r) => r.locus);
    for (const i of [0, 1, 2]) {
      const coding = `Patient.extension[0].extension[${String(i)}].valueCodeableConcept.coding[0]`;
      expect(loci).toContain(`${coding}.system`);
      expect(loci).toContain(`${coding}.code`);
      expect(loci).toContain(`${coding}.display`);
    }
  });

  it("keeps the parts in a contained Patient and a Bundle entry", () => {
    const patient = JSON.parse(DOG) as Json;
    const bundle = JSON.stringify({
      resourceType: "Bundle",
      type: "collection",
      entry: [{ resource: patient }],
    });
    expect(run(bundle, { keepPatientAnimal: true }).json).toContain("ZZSYNTH BEAGLE");
    const container = JSON.stringify({
      resourceType: "Observation",
      status: "final",
      code: { text: "x" },
      contained: [patient],
    });
    expect(run(container, { keepPatientAnimal: true }).json).toContain("ZZSYNTH BEAGLE");
  });
});

/** Run the option on a document and return the output JSON text. */
function onJson(raw: string): string {
  return run(raw, { keepPatientAnimal: true }).json;
}

describe("keepPatientAnimal: true still blocks", () => {
  it.each([
    ["a version suffix", `${ANIMAL_URL}|4.0.1`],
    ["https", ANIMAL_URL.replace("http:", "https:")],
    ["a trailing slash", `${ANIMAL_URL}/`],
    ["another case", ANIMAL_URL.replace("patient-animal", "Patient-animal")],
    ["another host", "http://example.org/StructureDefinition/patient-animal"],
  ])("a look-alike URL: %s", (_label, url) => {
    const out = onJson(dog([{ url, extension: [SPECIES, BREED, GENDER] }]));
    expect(out).not.toContain("ZZSPC01");
    expect(out).not.toContain("ZZSYNTH");
  });

  it("an extra sub-extension, and keeps the three beside it", () => {
    const extra = { url: "registration", valueString: "ZZREG000001" };
    const out = onJson(dog([{ url: ANIMAL_URL, extension: [SPECIES, extra, BREED] }]));
    expect(out).not.toContain("ZZREG000001");
    expect(out).toContain("ZZSYNTH CANINE");
    expect(out).toContain("ZZSYNTH BEAGLE");
  });

  it("a valueString holding a name under species", () => {
    const named = { url: "species", valueString: "ZZPETNAME" };
    const out = onJson(dog([{ url: ANIMAL_URL, extension: [named, BREED] }]));
    expect(out).not.toContain("ZZPETNAME");
    expect(out).toContain("ZZSYNTH BEAGLE");
  });

  it("a value[x] other than valueCodeableConcept beside the kept one", () => {
    const both = {
      url: "breed",
      valueCodeableConcept: { coding: [{ system: SYSTEM, code: "ZZBRD01" }] },
      valueCoding: { system: SYSTEM, code: "ZZOTHER01" },
    };
    const out = onJson(dog([{ url: ANIMAL_URL, extension: [both] }]));
    expect(out).toContain("ZZBRD01");
    expect(out).not.toContain("ZZOTHER01");
  });

  it("the concept's free text, an id, and a property R4 does not define there", () => {
    const species = {
      url: "species",
      valueCodeableConcept: {
        id: "ZZELEMID",
        coding: [{ system: SYSTEM, code: "ZZSPC01" }],
        text: "ZZPETNAME the dog",
        owner: "ZZOWNERFAMILY",
      },
    };
    const out = onJson(dog([{ url: ANIMAL_URL, extension: [species] }]));
    expect(out).toContain("ZZSPC01");
    for (const leak of ["ZZPETNAME", "ZZELEMID", "ZZOWNERFAMILY"]) expect(out).not.toContain(leak);
  });

  it("an extension, a nested structure and an undefined property on a coding", () => {
    const species = {
      url: "species",
      valueCodeableConcept: {
        coding: [
          {
            system: SYSTEM,
            code: "ZZSPC01",
            extension: [{ url: "x", valueString: "ZZCODEEXT" }],
            version: { nested: "ZZNESTED" },
            owner: "ZZOWNERFAMILY",
          },
        ],
      },
    };
    const out = onJson(dog([{ url: ANIMAL_URL, extension: [species] }]));
    expect(out).toContain("ZZSPC01");
    for (const leak of ["ZZCODEEXT", "ZZNESTED", "ZZOWNERFAMILY"]) expect(out).not.toContain(leak);
  });

  it("a userSelected that is not a boolean, keeping one that is", () => {
    // R4 types `Coding.userSelected` as a boolean; a string or a number there is content in a field
    // the keep would otherwise hand through.
    for (const odd of ["ZZPETNAME", 7]) {
      const species = {
        url: "species",
        valueCodeableConcept: { coding: [{ system: SYSTEM, code: "ZZSPC01", userSelected: odd }] },
      };
      const { json, manifest } = run(dog([{ url: ANIMAL_URL, extension: [species] }]), {
        keepPatientAnimal: true,
      });
      expect(json).toContain("ZZSPC01");
      expect(json).not.toContain("userSelected");
      expect(manifest.map((row) => row.locus)).toContain(
        "Patient.extension[0].extension[0].valueCodeableConcept.coding[0].userSelected",
      );
    }
    const kept = {
      url: "species",
      valueCodeableConcept: { coding: [{ system: SYSTEM, code: "ZZSPC01", userSelected: false }] },
    };
    expect(onJson(dog([{ url: ANIMAL_URL, extension: [kept] }]))).toContain('"userSelected":false');
  });

  it("a key R4 does not define on the animal extension or on one of its parts", () => {
    const species = { ...(SPECIES as Record<string, Json>), note: "ZZPARTNOTE" };
    const animal = { url: ANIMAL_URL, comment: "ZZANIMALNOTE", extension: [species] };
    const { json, manifest } = run(dog([animal]), { keepPatientAnimal: true });
    expect(json).toContain("ZZSYNTH CANINE");
    expect(json).not.toContain("ZZPARTNOTE");
    expect(json).not.toContain("ZZANIMALNOTE");
    expect(manifest.map((row) => row.locus)).toEqual(
      expect.arrayContaining([
        "Patient.extension[0].<withheld>[1]",
        "Patient.extension[0].extension[0].<withheld>[2]",
      ]),
    );
    // each row names the key's position, never the key the sender chose
    expect(JSON.stringify(manifest)).not.toMatch(/comment|note/);
  });

  it("a display with no code or system beside it, keeping the coding's other parts", () => {
    const breed = {
      url: "breed",
      valueCodeableConcept: { coding: [{ version: "ZZV1", display: "ZZPETNAME" }] },
    };
    const out = onJson(dog([{ url: ANIMAL_URL, extension: [breed] }]));
    expect(out).not.toContain("ZZPETNAME");
    expect(out).toContain("ZZV1");
  });

  it("a list R4 does not define on the concept, even one of codings", () => {
    const species = {
      url: "species",
      valueCodeableConcept: {
        coding: [{ system: SYSTEM, code: "ZZSPC01" }],
        extra: [{ system: SYSTEM, code: "ZZLISTCODE" }],
      },
    };
    const out = onJson(dog([{ url: ANIMAL_URL, extension: [species] }]));
    expect(out).toContain("ZZSPC01");
    expect(out).not.toContain("ZZLISTCODE");
  });

  it("records each block at its own locus", () => {
    const species = {
      url: "species",
      valueCodeableConcept: {
        coding: [{ system: SYSTEM, code: "ZZSPC01", owner: "ZZOWNERFAMILY" }],
        text: "ZZPETNAME",
        extra: [{ code: "ZZLISTCODE" }],
      },
    };
    const animal = {
      url: ANIMAL_URL,
      modifierExtension: [{ url: "m", valueCode: "ZZMODIFIER" }],
      extension: [species, { url: "registration", valueString: "ZZREG000001" }],
    };
    const { manifest } = run(dog([animal]), { keepPatientAnimal: true });
    const concept = "Patient.extension[0].extension[0].valueCodeableConcept";
    expect(manifest.map((row) => row.locus)).toEqual(
      expect.arrayContaining([
        "Patient.extension[0].modifierExtension[0].valueCode",
        `${concept}.coding[0].<withheld>[2]`,
        `${concept}.text`,
        `${concept}.<withheld>[2]`,
        "Patient.extension[0].extension[1].valueString",
      ]),
    );
  });

  it("records a bare string where an extension or a coding belongs, at its locus", () => {
    // A list of strings alone: the reader keeps each as a primitive (in a list beside an object it
    // becomes an empty object instead).
    const bareItem = run(dog(["ZZBAREITEM"]), { keepPatientAnimal: true });
    expect(bareItem.json).not.toContain("ZZBAREITEM");
    expect(bareItem.manifest.map((row) => row.locus)).toContain("Patient.extension[0]");
    const bareCoding = {
      url: ANIMAL_URL,
      extension: [{ url: "species", valueCodeableConcept: { coding: ["ZZBARE"] } }],
    };
    const coding = run(dog([bareCoding]), { keepPatientAnimal: true });
    expect(coding.json).not.toContain("ZZBARE");
    expect(coding.manifest.map((row) => row.locus)).toContain(
      "Patient.extension[0].extension[0].valueCodeableConcept.coding[0]",
    );
  });

  it("a part repeated, keeping the first", () => {
    const again = part("species", "ZZSPC02", "ZZPETNAME");
    const out = onJson(dog([{ url: ANIMAL_URL, extension: [SPECIES, again] }]));
    expect(out).toContain("ZZSYNTH CANINE");
    expect(out).not.toContain("ZZSPC02");
    expect(out).not.toContain("ZZPETNAME");
  });

  it("a second patient-animal extension, keeping the first", () => {
    const second = { url: ANIMAL_URL, extension: [part("species", "ZZSPC02", "ZZPETNAME")] };
    const out = onJson(dog([{ url: ANIMAL_URL, extension: [SPECIES] }, second]));
    expect(out).toContain("ZZSYNTH CANINE");
    expect(out).not.toContain("ZZSPC02");
  });

  it("a value and a modifierExtension on the animal extension itself, and an extension in a part", () => {
    const species = {
      ...(SPECIES as Record<string, Json>),
      extension: [{ url: "n", valueString: "ZZINNER" }],
    };
    const animal = {
      url: ANIMAL_URL,
      valueString: "ZZOWNVALUE",
      modifierExtension: [{ url: "m", valueCode: "ZZMODIFIER" }],
      extension: [species],
    };
    const out = onJson(dog([animal]));
    expect(out).toContain("ZZSYNTH CANINE");
    for (const leak of ["ZZOWNVALUE", "ZZMODIFIER", "ZZINNER"]) expect(out).not.toContain(leak);
  });

  it("shapes that are not the ones R4 gives", () => {
    const shapes: Json[] = [
      { url: ANIMAL_URL, extension: ["ZZBARESTRING1"] },
      { url: ANIMAL_URL, extension: [{ url: "species", valueCodeableConcept: "ZZBARESTRING2" }] },
      {
        url: ANIMAL_URL,
        extension: [
          { url: "species", valueCodeableConcept: { coding: { system: SYSTEM, code: "ZZOBJ3" } } },
        ],
      },
      {
        url: ANIMAL_URL,
        extension: [{ url: "species", valueCodeableConcept: { coding: ["ZZBARESTRING4"] } }],
      },
      { url: ANIMAL_URL, extension: { url: "species", valueString: "ZZOBJ5" } },
      { url: ANIMAL_URL, extension: [{ valueString: "ZZNOURL6" }] },
    ];
    for (const shape of shapes) {
      const out = onJson(dog([shape]));
      expect(out).not.toMatch(/ZZBARESTRING|ZZOBJ|ZZNOURL/);
    }
  });

  it("the animal extension anywhere but a Patient's own extension list", () => {
    const animal = { url: ANIMAL_URL, extension: [SPECIES] };
    const elsewhere = [
      JSON.stringify({ resourceType: "RelatedPerson", extension: [animal] }),
      JSON.stringify({ resourceType: "Observation", status: "final", extension: [animal] }),
      JSON.stringify({ resourceType: "Patient", modifierExtension: [animal] }),
      JSON.stringify({ resourceType: "Patient", name: [{ extension: [animal] }] }),
      JSON.stringify({ resourceType: "Patient", extension: animal }),
    ];
    for (const raw of elsewhere) expect(onJson(raw)).not.toContain("ZZSYNTH");
  });
});
